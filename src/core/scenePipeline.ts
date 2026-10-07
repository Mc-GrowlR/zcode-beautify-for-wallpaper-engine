/**
 * End-to-end scene wallpaper import pipeline:
 *
 *   detect -> check deps -> cache lookup -> open WE window -> record (ddagrab)
 *   -> close window -> seamless loop -> poster frame -> cache -> enforce LRU
 *
 * Every stage reports progress via onProgress. Rendering happens on the
 * machine itself, so the panel just passes the local wallpaper path — no
 * upload — and the result is served over the serve-mode media endpoint.
 */

import fs from "node:fs";
import path from "node:path";
import { detectWallpaperType } from "./wallpaperType.js";
import { execFileP } from "./exec.js";
import { checkWallpaperEngine, checkFfmpeg } from "./dependencyCheck.js";
import { openSceneWindow, closeSceneWindow, closeWeUi, reopenWeUi, killWallpaperAll } from "./weLauncher.js";
import { recordSceneWindow, analyzeBlackness } from "./recorder.js";
import { makeSeamless, probeDuration } from "./loopProcessor.js";
import { computeHash, getCachePath, hasCache, touchCache, enforceLimit } from "./cacheManager.js";

export interface SceneImportOptions {
  width?: number;
  height?: number;
  fps?: number;
  /** Raw capture length in seconds; the loop ends up duration - fade. */
  duration?: number;
  fadeSec?: number;
  /** Video imports longer than this are truncated to a middle segment. */
  maxSeconds?: number;
  /** Cap the loop width (eco spec = 1280). */
  maxWidth?: number;
  /** Keep the source audio (ambient-sound wallpapers). */
  keepAudio?: boolean;
  /** Window title for the temporary WE render window. */
  title?: string;
  maxCacheBytes?: number;
}

export interface SceneImportResult {
  /** Cached seamless loop video, ready to serve. */
  loopPath: string;
  /** Extracted poster frame (for Monet theming), next to the loop. */
  posterPath: string;
  hash: string;
  /** Advisory footage check: dark wallpapers legitimately score low. */
  blackness: { blackFraction: number; meanLuma: number; durationSec: number };
  /** True when an existing cache entry was reused (no rendering happened). */
  fromCache: boolean;
}

export class MissingDependencyError extends Error {
  constructor(public readonly missing: Array<"we" | "ffmpeg">) {
    super(`Missing dependencies: ${missing.join(", ")}`);
  }
}

export class SceneImportError extends Error {}

/** First .mp4/.webm in the directory root, then its files/ subfolder. */
function findVideoInDir(dir: string): string | undefined {
  for (const subdir of ["", "files"]) {
    const base = path.join(dir, subdir);
    let entries: string[];
    try {
      entries = fs.readdirSync(base);
    } catch {
      continue;
    }
    const hit = entries.find((e) => /\.(mp4|webm)$/i.test(e));
    if (hit) return path.join(base, hit);
  }
  return undefined;
}

/**
 * Accepts the many ways a user can point at a scene wallpaper: a `.pkg`
 * file, the wallpaper directory, or ANY file inside it (file dialogs make
 * users pick something concrete like preview.gif) — walks up to the nearest
 * enclosing `project.json` in that case.
 */
export function resolveSceneInput(input: string): string {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(input);
  } catch {
    return input; // nonexistent: let detectWallpaperType report it
  }
  if (stat.isDirectory()) return input;
  if (input.toLowerCase().endsWith(".pkg")) return input;
  let dir = path.dirname(path.resolve(input));
  for (let hop = 0; hop < 4; hop++) {
    if (fs.existsSync(path.join(dir, "project.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return input;
}

export const DEFAULT_SCENE_OPTIONS: Required<Pick<SceneImportOptions, "width" | "height" | "fps" | "duration" | "fadeSec" | "title" | "maxCacheBytes" | "maxSeconds">> = {
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 15,
  fadeSec: 1,
  title: "WE_Render",
  maxCacheBytes: 10 * 1024 ** 3,
  maxSeconds: 60,
};

export async function importScene(
  pkgPath: string,
  onProgress: (stage: string, detail?: string) => void = () => undefined,
  options: SceneImportOptions = {},
  ffmpegPath?: string,
  signal?: AbortSignal
): Promise<SceneImportResult> {
  const opts = { ...DEFAULT_SCENE_OPTIONS, ...options };
  /** Cancellation checkpoint between stages; ffmpeg runs also get the signal. */
  const checkCancel = (): void => {
    if (signal?.aborted) throw new SceneImportError("导入已取消");
  };

  onProgress("detect", pkgPath);
  let type = detectWallpaperType(pkgPath);

  // A video input stays a file (the footage itself); a video-type DIRECTORY
  // (WE video wallpapers have project.json too) resolves to the video inside.
  // Everything else may point at any file inside the wallpaper directory.
  try {
    if (type === "video" && fs.statSync(pkgPath).isDirectory()) {
      const videoFile = findVideoInDir(pkgPath);
      if (!videoFile) throw new SceneImportError(`No .mp4/.webm inside video wallpaper directory: ${pkgPath}`);
      pkgPath = videoFile;
    } else if (type !== "video") {
      pkgPath = resolveSceneInput(pkgPath);
      type = detectWallpaperType(pkgPath);
    }
  } catch (err) {
    if (err instanceof SceneImportError) throw err;
    /* stat failed on a nonexistent path — detect below reports it */
  }
  if (type !== "scene" && type !== "video") {
    throw new SceneImportError(`Not a scene or video wallpaper (${type}): ${pkgPath}`);
  }
  const isVideo = type === "video";

  onProgress("deps");
  // Video imports need no Wallpaper Engine — ffmpeg alone suffices.
  const missing: Array<"we" | "ffmpeg"> = [];
  if (!isVideo && !(await checkWallpaperEngine()).ok) missing.push("we");
  if (!(await checkFfmpeg()).ok) missing.push("ffmpeg");
  if (missing.length > 0) throw new MissingDependencyError(missing);

  const hash = isVideo
    ? await computeHash(pkgPath, { kind: "video", maxWidth: 1920, maxSeconds: opts.maxSeconds, fadeSec: opts.fadeSec })
    : await computeHash(pkgPath, {
        width: opts.width,
        height: opts.height,
        fps: opts.fps,
        duration: opts.duration,
        fadeSec: opts.fadeSec,
      });
  const loopPath = getCachePath(hash);
  const posterPath = path.join(path.dirname(loopPath), "poster.jpg");
  // Unique temp name: two concurrent imports of the same wallpaper used to
  // interleave writes into one fixed .tmp.mp4 and publish a truncated loop.
  const tmpLoop = `${loopPath}.tmp-${process.pid}-${Date.now().toString(36)}.mp4`;

  if (hasCache(hash)) {
    onProgress("cache-hit", hash);
    touchCache(hash);
    enforceLimit(opts.maxCacheBytes);
    return { loopPath, posterPath, hash, blackness: { blackFraction: -1, meanLuma: -1, durationSec: -1 }, fromCache: true };
  }

  if (isVideo) {
    // Direct video wallpaper: no WE window, no recording — the source IS the
    // footage. Normalize (truncate long clips, cap width), loop, poster, cache.
    checkCancel();
    onProgress("analyzing", pkgPath);
    const sourceDuration = await probeDuration(pkgPath, ffmpegPath ?? (await checkFfmpeg()).path!);
    const trim =
      sourceDuration > opts.maxSeconds
        ? { startAt: (sourceDuration - opts.maxSeconds) / 2, seconds: opts.maxSeconds }
        : undefined;
    if (trim) onProgress("truncating", `${sourceDuration.toFixed(1)}s -> ${opts.maxSeconds}s`);

    checkCancel();
    onProgress("processing", `crossfade ${opts.fadeSec}s`);
    try {
      await makeSeamless(pkgPath, tmpLoop, opts.fadeSec, ffmpegPath, {
        startAt: trim?.startAt,
        seconds: trim?.seconds,
        maxWidth: opts.maxWidth ?? 1920,
        fps: opts.fps,
        keepAudio: opts.keepAudio,
        signal,
      });

      checkCancel();
      onProgress("poster");
      await extractPoster(tmpLoop, posterPath, ffmpegPath);

      onProgress("saving", hash);
      fs.mkdirSync(path.dirname(loopPath), { recursive: true });
      fs.renameSync(tmpLoop, loopPath);
    } finally {
      // A failure (or cancel) must not leave tens of MB of temp behind —
      // stale temps inflate dirSize and skew the LRU eviction order.
      try { fs.rmSync(tmpLoop, { force: true }); } catch { /* locked */ }
    }

    const blackness = await analyzeBlackness(loopPath, ffmpegPath);
    enforceLimit(opts.maxCacheBytes);

    onProgress("done", loopPath);
    return { loopPath, posterPath, hash, blackness, fromCache: false };
  }

  checkCancel();
  // An open Wallpaper Engine UI suppresses -playInWindow rendering — the
  // recording would be pitch black. Close it first; the core keeps running.
  onProgress("closing-we-ui", "Wallpaper Engine UI");
  const uiWasOpen = await closeWeUi();
  // Some wallpaper64 instance states render -playInWindow windows pitch
  // black (seen with the UI open AND with freshly bare-spawned cores); the
  // cause is not observable from outside. Detect a black capture and retry
  // ONCE after a full WE restart — openSceneWindow re-warms the core.
  let rawPath = "";
  let blacknessPre: { blackFraction: number; meanLuma: number } | undefined;
  for (let attempt = 0; ; attempt++) {
    onProgress("opening", `window "${opts.title}"`);
    // Render in a SMALL window (640x360) and scale up in ffmpeg: large
    // play-windows present on a private swap chain that goes black the
    // moment a capture session (any backend) is active — small windows
    // were verified fine repeatedly. Visual quality barely suffers on
    // wallpapers; a black import is not an import.
    const handle = await openSceneWindow(pkgPath, { width: 640, height: 360, title: opts.title });
    try {
      onProgress("render-ready", JSON.stringify(handle.client));
      await new Promise((r) => setTimeout(r, 3000)); // let the scene settle

      checkCancel();
      onProgress("recording", `${opts.duration}s @ ${opts.fps}fps`);
      rawPath = path.join(path.dirname(loopPath), `raw-${Date.now().toString(36)}-${process.pid}.mp4`);
      fs.mkdirSync(path.dirname(rawPath), { recursive: true });
      try {
        await recordSceneWindow(handle, rawPath, { duration: opts.duration, fps: opts.fps, outWidth: opts.width, outHeight: opts.height, signal, capture: attempt === 0 ? "dda" : "ps" }, ffmpegPath);
      } finally {
        onProgress("closing");
        await closeSceneWindow(handle).catch(() => undefined);
      }
    } finally {
      // If anything above threw (or cancelled), make sure the window closes;
      // the UI restore only happens on the success path below.
      await closeSceneWindow(handle).catch(() => undefined);
    }
    blacknessPre = await analyzeBlackness(rawPath, ffmpegPath);
    // blackdetect already demands ~95% sub-threshold pixels for 0.5s+ runs;
    // a wedged render measures ~0.997. Do NOT gate on meanLuma: the corner
    // watermark alone pushes a pitch-black capture to luma 16 (measured).
    const pitchBlack = blacknessPre.blackFraction >= 0.95;
    if (!pitchBlack || attempt >= 1) break;
    onProgress("black-retry", "restarting Wallpaper Engine");
    console.log(`serve: scene import came out black (fraction=${blacknessPre.blackFraction.toFixed(3)} luma=${blacknessPre.meanLuma.toFixed(2)}) — restarting WE and retrying`);
    fs.rmSync(rawPath, { force: true });
    rawPath = "";
    await killWallpaperAll();
  }

  try {
    checkCancel();
    onProgress("processing", `crossfade ${opts.fadeSec}s`);
    await makeSeamless(rawPath, tmpLoop, opts.fadeSec, ffmpegPath, { signal });

    checkCancel();
    onProgress("poster");
    await extractPoster(tmpLoop, posterPath, ffmpegPath);

    onProgress("saving", hash);
    fs.mkdirSync(path.dirname(loopPath), { recursive: true });
    fs.renameSync(tmpLoop, loopPath);
    fs.rmSync(rawPath, { force: true });
    rawPath = "";

    const blackness = await analyzeBlackness(loopPath, ffmpegPath);
    enforceLimit(opts.maxCacheBytes);

    onProgress("done", loopPath);
    return { loopPath, posterPath, hash, blackness, fromCache: false };
  } finally {
    // If anything above threw (or cancelled), make sure neither the temp
    // captures linger.
    if (rawPath) { try { fs.rmSync(rawPath, { force: true }); } catch { /* locked */ } }
    try { fs.rmSync(tmpLoop, { force: true }); } catch { /* locked */ }
    // Give the user their WE UI back if the import closed it (win: black
    // render fix; lose: the window they had open vanishes without this).
    if (uiWasOpen) {
      const we = await import('./dependencyCheck.js').then((m) => m.checkWallpaperEngine()).catch(() => undefined);
      if (we && we.path) reopenWeUi(we.path);
    }
  }
}

/** Grabs a representative frame for Monet color extraction. */
export async function extractPoster(loopFile: string, posterPath: string, ffmpegPath?: string): Promise<void> {
  const ffmpeg = ffmpegPath ?? (await checkFfmpeg()).path;
  if (!ffmpeg) throw new SceneImportError("ffmpeg not found");
  fs.mkdirSync(path.dirname(path.resolve(posterPath)), { recursive: true });
  await execFileP(ffmpeg, [
    "-y", "-loglevel", "error",
    "-ss", "1", // skip the crossfade's darkest opening moment
    "-i", loopFile,
    "-frames:v", "1", "-update", "1",
    "-q:v", "2",
    posterPath,
  ], { timeout: 60_000 });
}

