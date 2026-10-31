/**
 * Config persistence + app launcher.
 *
 * Production Electron builds have no built-in CDP port, so the launcher starts
 * the target app (ZCode or WorkBuddy) with --remote-debugging-port. These apps
 * enforce a single instance via requestSingleInstanceLock, so we detect an
 * already-running instance first.
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { listTargets } from "./cdp.js";
import { executableCandidates, findExecutable, target, type AppTarget } from "./target.js";

export interface StoredConfig extends Partial<Omit<import("./inject.js").BeautifyConfig, "port">> {
  port?: number;
}

/** Data dir for the active target; env override wins (plugin host sets it). */
export function dataDir(): string {
  const t = target();
  for (const name of t.dataDirEnvVars) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim();
  }
  return t.defaultDataDir();
}

export function configFile(): string {
  return path.join(dataDir(), "config.json");
}

export function loadConfig(): StoredConfig {
  try {
    return JSON.parse(fs.readFileSync(configFile(), "utf8")) as StoredConfig;
  } catch (err) {
    // A PARSE error (not "file missing") means the stored config is corrupt:
    // quarantine it so the next save does not silently cement the wipe, and
    // the user's settings stay recoverable.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      try {
        fs.copyFileSync(configFile(), configFile() + `.corrupt-${Date.now().toString(36)}`);
      } catch {
        /* best effort */
      }
    }
    return {};
  }
}

/**
 * Cross-process serialized write. The serve daemon and MCP tool calls run in
 * different processes, both doing load→mutate→save on the same file; a bare
 * write can interleave and silently drop the other's settings. A lock file
 * (O_EXCL + retry) serializes writers; saveConfig is sync-friendly, so the
 * lock is acquired with a bounded busy-wait.
 */
function withConfigLock<T>(fn: () => T): T {
  const lock = configFile() + ".lock";
  fs.mkdirSync(dataDir(), { recursive: true });
  const deadline = Date.now() + 1500;
  let fd: number | null = null;
  for (;;) {
    try {
      fd = fs.openSync(lock, "wx");
      break;
    } catch {
      // A crash between open and the finally leaves the lock behind forever.
      // Break locks older than 5s (writes never take that long) instead of
      // spinning to the deadline — a hot 3s spin would freeze the event loop.
      try {
        const age = Date.now() - fs.statSync(lock).mtimeMs;
        if (age > 5000) {
          fs.rmSync(lock, { force: true });
          continue;
        }
      } catch {
        /* lock vanished — retry immediately */
      }
      if (Date.now() > deadline) return fn(); // contended: proceed unlocked
      const waitMs = Date.now();
      while (Date.now() - waitMs < 20) {
        /* brief spin */
      }
    }
  }
  try {
    return fn();
  } finally {
    try { fs.closeSync(fd!); } catch { /* closed */ }
    try { fs.rmSync(lock, { force: true }); } catch { /* locked */ }
  }
}

export function saveConfig(config: StoredConfig): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  withConfigLock(() => {
    // Write-then-rename: a full disk (ENOSPC) or crash mid-write must never
    // leave a truncated config.json behind — a corrupt file silently resets
    // every setting, which is exactly how rotation plans were lost once.
    const file = configFile();
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
    fs.renameSync(tmp, file);
  });
}

export function findAppExecutable(t: AppTarget = target()): string | undefined {
  return findExecutable(t);
}

/** @deprecated kept for callers written against the ZCode-only API. */
export const findZcodeExecutable = findAppExecutable;

const execFileAsync = promisify(execFile);

/**
 * Detects a live instance of the target app. A running instance without the
 * debug port triggers the Electron single-instance lock: a newly spawned app
 * binds the CDP port, forwards its args to the existing instance, then exits —
 * closing the port again. Launching must refuse upfront instead of racing.
 */
export async function isAppProcessRunning(t: AppTarget = target()): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("tasklist", ["/NH", "/FI", `IMAGENAME eq ${t.exeName}`]);
      return stdout.toLowerCase().includes(t.exeName.toLowerCase());
    }
    const name = t.exeName.replace(/\.exe$/i, "");
    const { stdout } = await execFileAsync("pgrep", ["-x", name]);
    return stdout.trim().length > 0;
  } catch {
    return false; // pgrep exits non-zero when no process matches
  }
}

/** @deprecated kept for callers written against the ZCode-only API. */
export const isZcodeProcessRunning = isAppProcessRunning;

export interface LaunchResult {
  started: boolean;
  reason?: string;
}

/**
 * Starts the target app with the CDP port enabled. If a CDP endpoint is
 * already reachable we are done; if an instance runs *without* CDP, the
 * single-instance lock blocks us and the user must restart it themselves.
 */
export async function launchApp(port: number, t: AppTarget = target()): Promise<LaunchResult> {
  try {
    await listTargets(port);
    return { started: false, reason: "already-running-with-cdp" };
  } catch {
    /* not reachable yet */
  }

  const exe = findAppExecutable(t);
  if (!exe) {
    const manual = executableCandidates(t).slice(0, 3).join(", ");
    throw new Error(
      `${t.appName} executable not found; set ${t.exeEnvVars[0]} (or the install dir) and retry. Looked in: ${manual}`
    );
  }

  if (await isAppProcessRunning(t)) {
    return { started: false, reason: "running-without-cdp" };
  }

  // Beyond the CDP port: occlusion / background throttling switches keep
  // wallpaper transitions and timers alive while the window is unfocused.
  const child = spawn(exe, [`--remote-debugging-port=${port}`, ...t.launchArgs], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  // Wait for the CDP endpoint to come up.
  let up = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      await listTargets(port);
      up = true;
      break;
    } catch {
      /* keep waiting */
    }
  }
  if (!up) {
    // Never leave the orphan we spawned: without the port it is unusable to
    // us, and its single-instance lock blocks every later launch attempt.
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    throw new Error(
      `${t.appName} was started but no CDP endpoint appeared. Another instance may already be running without the debug port — quit ${t.appName} completely and run \`zcode-beautify launch\` again.`
    );
  }

  // Confirm the endpoint stays up: a second instance racing the single-instance
  // lock binds the port briefly and then quits, which would look like success.
  await new Promise((r) => setTimeout(r, 2000));
  try {
    await listTargets(port);
  } catch {
    throw new Error(
      "CDP came up but closed again immediately — a running instance took over via the single-instance lock. Quit the app completely and run `zcode-beautify launch` again."
    );
  }
  return { started: true };
}

/** @deprecated kept for callers written against the ZCode-only API. */
export const launchZcode = launchApp;
