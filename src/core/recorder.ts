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
}

export class RecordError extends Error {}

/**
 * BACKGROUND capture via PrintWindow(PW_RENDERFULLCONTENT): the DWM-
 * composited window surface is copied into a GDI bitmap, so the window
 * renders into the capture even when fully OCCLUDED — no topmost, no
 * Desktop Duplication, nothing on-screen changes while recording. Frames
 * are grabbed in a single PowerShell loop (frame-paced by a Stopwatch)
 * and encoded from the BMP sequence afterwards.
 */
async function recordWindowBackground(
  handle: SceneWindowHandle,
  out: string,
  opts: Required<Pick<RecordOptions, "duration" | "fps" | "outWidth" | "outHeight">>,
  ffmpeg: string,
): Promise<void> {
  const seqDir = path.join(path.dirname(path.resolve(out)), `seq-${process.pid}-${Date.now().toString(36)}`);
  mkdirSync(seqDir, { recursive: true });
  const frameMs = Math.max(20, Math.round(1000 / opts.fps));
  const script = `
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class PW {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
}
'@
$target = [IntPtr]${handle.hwnd}
$r = New-Object PW+RECT
[PW]::GetClientRect($target, [ref]$r) | Out-Null
$w = $r.R - $r.L; $h = $r.B - $r.T
if ($w -le 0 -or $h -le 0) { Write-Output "0"; exit 1 }
$dir = '${seqDir.replace(/\\/g, "\\\\") }'
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$n = 0
while ($sw.ElapsedMilliseconds -lt ${opts.duration * 1000}) {
  $targetMs = [math]::Floor(($sw.ElapsedMilliseconds + $frameMs) / $frameMs) * $frameMs
  # frame-pace to the requested cadence
  while ($sw.ElapsedMilliseconds -lt $targetMs) { Start-Sleep -Milliseconds 1 }
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  [PW]::PrintWindow($target, $hdc, 2) | Out-Null   # PW_RENDERFULLCONTENT
  $g.ReleaseHdc($hdc); $g.Dispose()
  $bmp.Save((Join-Path $dir ('f_{0:d6}.bmp' -f $n)), [System.Drawing.Imaging.ImageFormat]::Bmp)
  $bmp.Dispose()
  $n++
}
$sw.Stop()
Write-Output $n`;
  let frames = 0;
  try {
    const { stdout } = await exec("powershell", ["-NoProfile", "-Command", script], {
      timeout: (opts.duration + 40) * 1000,
      maxBuffer: 4 * 1024 * 1024,
    });
    frames = Number(stdout.trim().split(/\r?\n/).pop() ?? "0");
  } catch (err) {
    throw new RecordError(`PrintWindow capture failed: ${(err as Error).message}`);
  } finally {
    // sequence files are removed no matter what happens to the encode
  }
  if (frames < 10) throw new RecordError(`PrintWindow captured too few frames (${frames})`);
  const outW = opts.outWidth ?? 1920;
  const outH = opts.outHeight ?? 1080;
  try {
    await exec(ffmpeg, [
      "-y", "-hide_banner", "-loglevel", "warning",
      "-framerate", String(opts.fps),
      "-i", path.join(seqDir, "f_%06d.bmp"),
      "-vf", `scale=${outW}:${outH}`,
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-an",
      out,
    ], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    throw new RecordError(`frame-sequence encode failed: ${(err as Error).message}`);
  } finally {
    rmSync(seqDir, { recursive: true, force: true });
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

  // DEFAULT PATH: background PrintWindow capture (occlusion-proof, nothing
  // forced on-screen). Falls back to the ddagrab desktop capture below only
  // when PrintWindow yields nothing (e.g. driver blocks full-content redirect).
  try {
    await recordWindowBackground(handle, out, {
      duration: opts.duration,
      fps: opts.fps,
      outWidth: opts.outWidth ?? 1920,
      outHeight: opts.outHeight ?? 1080,
    }, ffmpeg);
    return;
  } catch (err) {
    if (!(err instanceof RecordError)) throw err;
    // fall through to ddagrab
  }

  // ddagrab captures the COMPOSITED DESKTOP, so the window must stay
  // topmost for the duration (legacy fallback path only).
  const client = await measureClientRect(handle.hwnd, handle.title);
  const { x, y, width, height } = client;
  const outW = opts.outWidth ?? 1920;
  const outH = opts.outHeight ?? 1080;
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel", "warning",
    "-f", "lavfi",
    "-i", `ddagrab=output_idx=0:framerate=${opts.fps}:draw_mouse=0`,
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
    await exec(ffmpeg, args, { timeout: (opts.duration + 30) * 1000, maxBuffer: 16 * 1024 * 1024 });
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
  const blackFraction = durationSec > 0 ? blackSec / durationSec : 1;

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
