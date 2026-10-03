/**
 * Screen capture of the Wallpaper Engine scene window via ffmpeg ddagrab
 * (Desktop Duplication API), the only capture path proven to record DirectX
 * scene content reliably (docs/spike-notes.md).
 *
 * Hard-won constraints encoded here:
 * - ddagrab captures the composited desktop, so the target window MUST be
 *   topmost for the duration of the recording (restored afterwards).
 * - `crop` silently no-ops on d3d11 hardware frames: the chain must be
 *   ddagrab -> hwdownload,format=bgra -> crop -> scale.
 * - The crop rect is the client rect measured by the launcher AFTER
 *   positioning (outer-window rects would record the title bar).
 * - draw_mouse=0 keeps the cursor out of the loop video.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { checkFfmpeg } from "./dependencyCheck.js";
import { execFileP } from "./exec.js";
import { measureClientRect, type SceneWindowHandle } from "./weLauncher.js";

const exec = execFileP;

export interface RecordOptions {
  duration: number;
  fps: number;
  /** Output size; defaults to 1920x1080. */
  outWidth?: number;
  outHeight?: number;
  /** AbortSignal: aborting kills the running ffmpeg (import cancellation). */
  signal?: AbortSignal;
}

export class RecordError extends Error {}

/** Virtual-screen bounds of every display, in ddagrab enumeration order
 *  (EnumDisplayDevices ordinal). Empty on any failure → primary-only fallback. */
async function displayLayout(): Promise<Array<{ x: number; y: number; w: number; h: number }>> {
  const script = `Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$screens = [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { '{0},{1},{2},{3}' -f $_.Bounds.X, $_.Bounds.Y, $_.Bounds.Width, $_.Bounds.Height }
$screens -join ';'`;
  try {
    const { stdout } = await exec("powershell", ["-NoProfile", "-Command", script], { timeout: 15_000 });
    return stdout.trim().split(";").filter(Boolean).map((s) => {
      const [x, y, w, h] = s.split(",").map(Number);
      return { x, y, w, h };
    });
  } catch {
    return [];
  }
}

export async function recordSceneWindow(
  handle: SceneWindowHandle,
  out: string,
  opts: RecordOptions,
  ffmpegPath?: string,
): Promise<void> {
  const ffmpeg = ffmpegPath ?? (await checkFfmpeg()).path;
  if (!ffmpeg) throw new RecordError("ffmpeg not found — cannot record scene window");

  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

  // WE moves/resizes its play window asynchronously, so re-measure the client
  // rect right before capturing (the window is topmost at this point) instead
  // of trusting the rect from open time.
  const client = await measureClientRect(handle.hwnd, handle.title);
  let { x, y, width, height } = client;
  // ddagrab captures ONE output; the crop coordinates must be relative to
  // that output. A window on a secondary monitor needs its output_idx and
  // the origin subtracted, or the crop rect falls outside the captured frame.
  const displays = await displayLayout();
  let outputIdx = 0;
  for (let i = 0; i < displays.length; i++) {
    const d = displays[i];
    if (x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) {
      outputIdx = i;
      x -= d.x;
      y -= d.y;
      break;
    }
  }
  // Clamp the crop to the chosen display: .NET screen ordinals and ddagrab's
  // DXGI output ordinals can disagree on hybrid-GPU systems, and a window
  // straddling two monitors produces an out-of-frame rect — a garbage or
  // failed capture. Clamped-but-partial beats entirely wrong output.
  const outW = opts.outWidth ?? 1920;
  const outH = opts.outHeight ?? 1080;
  const picked = displays[outputIdx];
  if (picked) {
    if (x + width > picked.w) width = Math.max(16, picked.w - x);
    if (y + height > picked.h) height = Math.max(16, picked.h - y);
    if (x < 0) { width = Math.max(16, width + x); x = 0; }
    if (y < 0) { height = Math.max(16, height + y); y = 0; }
  }
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel", "warning",
    "-f", "lavfi",
    "-i", `ddagrab=output_idx=${outputIdx}:framerate=${opts.fps}:draw_mouse=0`,
    "-t", String(opts.duration),
    "-vf", `hwdownload,format=bgra,crop=${width}:${height}:${x}:${y},scale=${outW}:${outH}`,
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-pix_fmt", "yuv420p",
    "-an",
    out,
  ];

  await setTopmost(handle.hwnd, true);
  try {
    await exec(ffmpeg, args, { timeout: (opts.duration + 30) * 1000, maxBuffer: 16 * 1024 * 1024, signal: opts.signal });
  } catch (err) {
    throw new RecordError(`ffmpeg ddagrab capture failed: ${(err as Error).message}`);
  } finally {
    await setTopmost(handle.hwnd, false).catch(() => undefined);
  }
}

export interface BlacknessReport {
  /** Fraction (0-1) of playback time detected as black. */
  blackFraction: number;
  /** Mean luma 0-255 across frames (signalstats YAVG). */
  meanLuma: number;
  /** Duration of the analyzed video in seconds. */
  durationSec: number;
}

/**
 * Advisory self-check for captured footage (see spike: dark wallpapers can
 * legitimately score a low meanLuma — use as a warning, not a hard failure).
 */
export async function analyzeBlackness(file: string, ffmpegPath?: string): Promise<BlacknessReport> {
  const ffmpeg = ffmpegPath ?? (await checkFfmpeg()).path;
  if (!ffmpeg) throw new RecordError("ffmpeg not found — cannot analyze footage");

  let stderr = "";
  try {
    await exec(ffmpeg, [
      "-hide_banner",
      "-i", file,
      "-vf", "blackdetect=d=0.5:pix_th=0.05",
      "-an",
      "-f", "null", "-",
    ], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }).then((r) => (stderr = r.stderr));
  } catch (err) {
    stderr = (err as { stderr?: string }).stderr ?? String(err);
  }

  const durationSec = Number(/Duration: (\d+):(\d+):([\d.]+)/.exec(stderr)?.slice(1).reduce((acc, v) => acc * 60 + Number(v), 0) ?? 0);
  const blackRanges = [...stderr.matchAll(/black_start:[\d.]+ black_end:([\d.]+) black_duration:([\d.]+)/g)];
  const blackSec = blackRanges.reduce((sum, m) => sum + Number(m[2]), 0);
  // Unparsable duration (probe failure) must read "unknown", not "100% black".
  const blackFraction = durationSec > 0 ? blackSec / durationSec : -1;

  const meanLuma = await meanLumaOf(file, ffmpeg);
  return { blackFraction, meanLuma, durationSec };
}

async function meanLumaOf(file: string, ffmpeg: string): Promise<number> {
  try {
    const { stdout } = await exec(ffmpeg, [
      "-hide_banner",
      "-i", file,
      "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-",
      "-an",
      "-f", "null", "-",
    ], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    const values = [...stdout.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
    if (values.length === 0) return -1;
    return values.reduce((a, b) => a + b, 0) / values.length;
  } catch {
    return -1;
  }
}

async function setTopmost(hwnd: number, topmost: boolean): Promise<void> {
  // -1 = HWND_TOPMOST, -2 = HWND_NOTOPMOST; SWP_NOMOVE(0x2) | SWP_NOSIZE(0x1)
  // — do NOT touch position/size, only the z-order.
  const after = topmost ? -1 : -2;
  await exec("powershell", [
    "-NoProfile", "-Command",
    `Add-Type -Namespace N -Name W -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);'
[N.W]::SetWindowPos([IntPtr]${hwnd}, [IntPtr]${after}, 0, 0, 0, 0, 0x0003)`,
  ], { timeout: 10_000 });
}
