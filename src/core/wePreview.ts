/**
 * Lightweight on-demand scene previews: render the WE scene in a small
 * offscreen window for a few seconds and keep the raw recording as an mp4.
 * No seamless-loop processing, no poster — a fraction of the import cost.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { openSceneWindow, closeSceneWindow } from "./weLauncher.js";
import { recordSceneWindow } from "./recorder.js";
import { checkWallpaperEngine, checkFfmpeg } from "./dependencyCheck.js";

export async function generateScenePreview(
  pkgPath: string,
  outPath: string,
  ffmpegPath?: string
): Promise<void> {
  if (!(await checkWallpaperEngine()).ok) throw new Error("Wallpaper Engine 不可用");
  const ffmpeg = ffmpegPath ?? (await checkFfmpeg()).path;
  if (!ffmpeg) throw new Error("ffmpeg 不可用");

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await ensureWallpaperEngineWarm();
  const handle = await openSceneWindow(pkgPath, { width: 640, height: 360, title: "WE_Preview" });
  try {
    await new Promise((r) => setTimeout(r, 2500)); // let the scene settle
    const tmp = `${outPath}.tmp-${process.pid}.mp4`;
    try {
      await recordSceneWindow(handle, tmp, { duration: 6, fps: 24, outWidth: 640, outHeight: 360 }, ffmpeg);
      fs.renameSync(tmp, outPath);
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
      throw err;
    }
  } finally {
    await closeSceneWindow(handle).catch(() => undefined);
  }
}

/**
 * A COLD wallpaper64 ignores -control arguments (the process comes up for
 * the Steam DRM check and never acts on them); a RUNNING instance executes
 * them immediately. If nothing is running, start a bare instance first and
 * give it a moment to initialize.
 */
async function ensureWallpaperEngineWarm(): Promise<void> {
  const status = await checkWallpaperEngine();
  if (!status.ok || !status.path) throw new Error(status.detail ?? "Wallpaper Engine 不可用");
  if (status.detail?.includes("running")) return; // already hot
  const child = spawn(status.path, [], { stdio: "ignore" });
  child.unref();
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const again = await checkWallpaperEngine();
    if (again.detail?.includes("running")) return;
  }
}
