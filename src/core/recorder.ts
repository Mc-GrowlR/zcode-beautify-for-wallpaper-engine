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

import { mkdirSync, rmSync } from "node:fs";
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
  /** Capture backend: ddagrab (DXGI desktop duplication, default) or
   * gdigrab (GDI). WE windows sometimes present on a private swap chain
   * that DXGI duplication records as solid black while GDI sees them
   * fine — the black-frame retry switches to GDI. */
  capture?: "dda" | "gdi";
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
  const absX = x, absY = y; // gdigrab wants virtual-desktop coords
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
  // Capture via PowerShell CopyFromScreen frame grabbing. In some machine
  // states EVERY ffmpeg capture backend (ddagrab AND gdigrab) records this
  // WE window as solid black, while a plain GDI BitBlt through .NET
  // Graphics.CopyFromScreen sees the window fine — this path is the only
  // one verified end-to-end. Frames land as PNGs, then ffmpeg muxes them.
  const framesDir = `${out}.frames-${process.pid}-${Date.now().toString(36)}`;
  mkdirSync(framesDir, { recursive: true });
  const frameCount = Math.max(1, Math.round(opts.duration * opts.fps));
  const delayMs = Math.max(5, Math.floor(1000 / opts.fps) - 15);
  const winDir = framesDir.replace(/\\/g, "/");
  const grab = [
    "Add-Type -AssemblyName System.Drawing",
    "$h = [IntPtr]" + handle.hwnd,
    "$n = " + frameCount + "; $delay = " + delayMs,
    "for ($i = 0; $i -lt $n; $i++) {",
    "  $r = New-Object RECT_T",
    "  [WING]::GetWindowRect($h, [ref]$r) | Out-Null",
    "  $w = $r.Rt - $r.L; $hh = $r.B - $r.T",
    "  if ($w -gt 0 -and $hh -gt 0) {",
    "    $bmp = New-Object System.Drawing.Bitmap($w, $hh)",
    "    $g = [System.Drawing.Graphics]::FromImage($bmp)",
    "    $g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)",
    "    $bmp.Save((Join-Path '" + winDir + "' ('f{0:d4}.png' -f $i)), [System.Drawing.Imaging.ImageFormat]::Png)",
    "    $g.Dispose(); $bmp.Dispose()",
    "  }",
    "  Start-Sleep -Milliseconds $delay",
    "}",
    "Write-Output done",
  ].join("\n");
  const psScript = [
    "Add-Type @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public struct RECT_T { public int L, T, Rt, B; }",
    "public class WING {",
    '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT_T r);',
    '  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f);',
    "}",
    "'@",
    "[WING]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x0003) | Out-Null # topmost",
    grab,
  ].join("\n");
  try {
    await setTopmost(handle.hwnd, true);
    await exec("powershell", ["-NoProfile", "-Command", psScript], {
      timeout: (opts.duration + 60) * 1000,
      maxBuffer: 16 * 1024 * 1024,
      signal: opts.signal,
    });
    const mux = [
      "-y", "-hide_banner", "-loglevel", "warning",
      "-framerate", String(opts.fps),
      "-i", path.join(framesDir, "f%04d.png"),
      "-vf", `scale=${outW}:${outH}`,
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-an", out,
    ];
    await exec(ffmpeg, mux, { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    throw new RecordError(`PowerShell frame capture failed: ${(err as Error).message}`);
  } finally {
    await setTopmost(handle.hwnd, false).catch(() => undefined);
    try { rmSync(framesDir, { recursive: true, force: true }); } catch { /* locked */ }
  }
  return;
}

export async function recordSceneWindowLegacy(
  handle: SceneWindowHandle,
  out: string,
  opts: RecordOptions,
  ffmpegPath?: string,
): Promise<void> {
  // ffmpeg-based capture (gdigrab/ddagrab) — kept for reference; the
  // PowerShell path above is the verified one on this machine.
  const ffmpeg = ffmpegPath ?? (await checkFfmpeg()).path;
  if (!ffmpeg) throw new RecordError("ffmpeg not found — cannot record scene window");
  const client = await measureClientRect(handle.hwnd, handle.title);
  const { x, y, width, height } = client;
  const outW = opts.outWidth ?? 1920;
  const outH = opts.outHeight ?? 1080;
  const args = [
    "-y", "-hide_banner", "-loglevel", "warning",
    "-f", "gdigrab", "-framerate", String(opts.fps), "-draw_mouse", "0", "-i", "desktop",
    "-t", String(opts.duration),
    "-vf", `crop=${width}:${height}:${Math.max(0, x)}:${Math.max(0, y)},scale=${outW}:${outH}`,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-an", out,
  ];
  await setTopmost(handle.hwnd, true);
  try {
    await exec(ffmpeg, args, { timeout: (opts.duration + 30) * 1000, maxBuffer: 16 * 1024 * 1024, signal: opts.signal });
  } catch (err) {
    throw new RecordError(`ffmpeg capture failed: ${(err as Error).message}`);
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
