/**
 * `serve` mode: a localhost-only control API plus persistent injection
 * sessions.
 *
 * The injected settings panel (src/panel) talks to this API to read and change
 * the live configuration. Injection connections are held open so that
 * Page.addScriptToEvaluateOnNewDocument keeps re-running across renderer
 * reloads for as long as this process lives — no polling reinjection needed
 * while a session is healthy.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  CdpConnection,
  buildBootstrapScript,
  buildResetScript,
  listTargets,
  pickRendererTargets,
} from "./cdp.js";
import { buildPayload, DEFAULT_CONFIG, type BeautifyConfig, type RotationConfig, type RotationEntry, type RotationMode, type RotationPlan } from "./inject.js";
import { loadWallpaper, type WallpaperAssets } from "./monet.js";
import { buildPanelScript } from "../panel/panelScript.js";
import { dataDir, loadConfig, saveConfig } from "./launch.js";
import { sendMediaFile } from "./media.js";
import { importScene, MissingDependencyError, type SceneImportResult } from "./scenePipeline.js";
import { getInstallGuide, checkFfmpeg } from "./dependencyCheck.js";
import { execFileP } from "./exec.js";
import { scenesCacheRoot } from "./cacheManager.js";

const MAX_WALLPAPER_BYTES = 20 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_WALLPAPER_BYTES + 1024 * 1024;
const POLL_MS = 1500;

export interface ServeOptions {
  cdpPort: number;
  apiPort: number;
}

interface HeldSession {
  conn: CdpConnection;
  themeScriptId?: string;
}

// Decoded image + extracted theme, reused across slider updates so the panel
// feels instant. A small LRU (not a single slot): rotation and library clicks
// alternate between several wallpapers and a single slot re-decoded on every
// switch.
const assetsCache = new Map<string, { mtimeMs: number; assets: WallpaperAssets }>();

function rememberAssets(file: string, mtimeMs: number, assets: WallpaperAssets): void {
  assetsCache.set(file, { mtimeMs, assets });
  if (assetsCache.size > 6) {
    assetsCache.delete(assetsCache.keys().next().value as string);
  }
}

// --- palette thumbs -----------------------------------------------------------
// jimp is a pure-JS decoder: an 8K wallpaper takes ~4s and blows its decode
// memory cap (the switch then silently loses the theme — or worse). ffmpeg
// downscales to a tiny thumb once; jimp only ever decodes that.
let ffmpegPathCache: string | undefined;
async function ffmpegPath(): Promise<string | undefined> {
  if (ffmpegPathCache !== undefined) return ffmpegPathCache || undefined;
  const st = await checkFfmpeg();
  ffmpegPathCache = st.ok && st.path ? st.path : "";
  return ffmpegPathCache || undefined;
}

function thumbDir(): string {
  return path.join(dataDir(), "thumbs");
}

/** The file Monet should sample: a generated thumb when possible, else the original. */
async function themeThumbFor(source: string): Promise<string> {
  if (!isInsideDataDir(source)) return source;
  const thumb = path.join(thumbDir(), path.basename(source) + ".jpg");
  try {
    if (!fs.existsSync(thumb)) {
      const exe = await ffmpegPath();
      if (!exe) return source;
      fs.mkdirSync(thumbDir(), { recursive: true });
      await execFileP(exe, ["-y", "-hide_banner", "-loglevel", "error", "-i", source, "-vf", "scale=160:-2", "-frames:v", "1", "-q:v", "4", thumb], { timeout: 20_000 });
    }
    return fs.existsSync(thumb) ? thumb : source;
  } catch {
    return source; // no ffmpeg / decode trouble: fall back to the original
  }
}

async function getAssets(config: BeautifyConfig): Promise<WallpaperAssets | undefined> {
  const wallpaperPath = config.wallpaperPath;
  if (!wallpaperPath || !fs.existsSync(wallpaperPath)) return undefined;
  // Scene wallpaper: wallpaperPath is the loop VIDEO — jimp can't decode it.
  // The poster frame next to the loop carries the Monet source colors.
  // Library images sample a small ffmpeg-generated thumb instead.
  const sourcePath =
    config.mediaType === "video"
      ? path.join(path.dirname(wallpaperPath), "poster.jpg")
      : await themeThumbFor(wallpaperPath);
  if (!fs.existsSync(sourcePath)) return undefined;
  const mtimeMs = fs.statSync(sourcePath).mtimeMs;
  const cached = assetsCache.get(sourcePath);
  if (cached?.mtimeMs === mtimeMs) {
    assetsCache.delete(sourcePath);
    assetsCache.set(sourcePath, cached); // refresh LRU position
    return cached.assets;
  }
  try {
    const assets = await loadWallpaper(sourcePath);
    rememberAssets(sourcePath, mtimeMs, assets);
    return assets;
  } catch {
    return undefined; // undecodable wallpaper: inject without Monet rather than not at all
  }
}

function currentConfig(): BeautifyConfig {
  return { ...DEFAULT_CONFIG, ...loadConfig() };
}

function backupFile(): string {
  return path.join(dataDir(), "config.backup.json");
}

function hasBackup(): boolean {
  return fs.existsSync(backupFile());
}

function publicConfig(config: BeautifyConfig) {
  return {
    blur: config.blur,
    dim: config.dim,
    monet: config.monet,
    wallpaperVisible: config.wallpaperVisible,
    kenBurns: config.kenBurns ?? false,
    fit: config.fit,
    wallpaperSet: Boolean(config.wallpaperPath && fs.existsSync(config.wallpaperPath)),
    hasBackup: hasBackup(),
    cdpPort: config.port,
    mediaType: config.mediaType ?? "image",
    sceneHash: config.sceneHash,
    /** Current wallpaper file (image mode) — lets the panel preselect it. */
    wallpaperPath: config.mediaType === "video" ? undefined : config.wallpaperPath,
  };
}

function sanitize(body: any): Partial<BeautifyConfig> {
  const out: Partial<BeautifyConfig> = {};
  if (typeof body?.blur === "number" && body.blur >= 0 && body.blur <= 100) out.blur = body.blur;
  if (typeof body?.dim === "number" && body.dim >= 0 && body.dim <= 100) out.dim = body.dim;
  if (typeof body?.monet === "boolean") out.monet = body.monet;
  if (typeof body?.wallpaperVisible === "boolean") out.wallpaperVisible = body.wallpaperVisible;
  if (typeof body?.kenBurns === "boolean") out.kenBurns = body.kenBurns;
  if (body?.fit === "cover" || body?.fit === "contain" || body?.fit === "smart") out.fit = body.fit;
  return out;
}

// --- scene import job (one at a time; the panel polls for progress) ----------

interface ImportJob {
  running: boolean;
  stage: string;
  detail?: string;
  error?: string;
  guide?: string;
  /** Live controller for /api/import-cancel (F4). */
  abort?: AbortController;
  result?: { loopPath: string; posterPath: string; hash: string; fromCache: boolean };
}

let importJob: ImportJob = { running: false, stage: "idle" };

// --- injection session management -------------------------------------------

const held = new Map<string, HeldSession>();

/** Per-start random API token; handed to the injected panel and appended to
 *  media URLs. Without it any web page open on this machine could read the
 *  wallpaper library, delete entries, or exfiltrate images via CORS:*. */
let mediaToken = "";

function withMediaToken(url: string): string {
  if (!mediaToken) return url;
  return url + (url.includes("?") ? "&" : "?") + "t=" + mediaToken;
}

async function registerScript(
  session: HeldSession,
  source: string
): Promise<string> {
  const { identifier } = await session.conn.send("Page.addScriptToEvaluateOnNewDocument", { source });
  return identifier;
}

async function holdSession(
  target: { id: string; webSocketDebuggerUrl?: string },
  config: BeautifyConfig,
  apiPort: number
): Promise<void> {
  if (!target.webSocketDebuggerUrl) return;
  const conn = await CdpConnection.connect(target.webSocketDebuggerUrl);
  await conn.send("Page.enable");
  const session: HeldSession = { conn };

  const assets = await getAssets(config);
  const payload = buildPayload(config, assets, mediaToken);
  const bootstrap = buildBootstrapScript({
    css: payload.css,
    wallpaperDataUri: payload.wallpaperDataUri,
    videoSrc: payload.videoSrc,
    fit: payload.fit,
    transition: payload.transition,
    kenBurns: payload.kenBurns,
  });
  const { identifier } = await conn.send("Page.addScriptToEvaluateOnNewDocument", {
    source: bootstrap,
  });
  session.themeScriptId = identifier;
  // Runtime.evaluate does NOT reject when the script throws — same check as
  // the panel below, or a broken theme fails silently.
  const bootEval = await conn.send("Runtime.evaluate", { expression: bootstrap, returnByValue: true });
  if (bootEval?.exceptionDetails) {
    console.error(`serve: theme bootstrap threw — ${JSON.stringify(bootEval.exceptionDetails).slice(0, 400)}`);
  }

  const panelScript = buildPanelScript(apiPort, mediaToken);
  await conn.send("Page.addScriptToEvaluateOnNewDocument", { source: panelScript });
  // Runtime.evaluate does NOT reject when the script itself throws — surface
  // exceptionDetails or a broken panel fails silently ("injected" in the log).
  const panelEval = await conn.send("Runtime.evaluate", { expression: panelScript, returnByValue: true });
  if (panelEval?.exceptionDetails) {
    console.error(`serve: panel script threw — ${JSON.stringify(panelEval.exceptionDetails).slice(0, 400)}`);
  }

  held.set(target.id, session);
}

/** Re-evaluates the theme bootstrap in every live session after a config change. */
async function pushConfigToSessions(config: BeautifyConfig): Promise<number> {
  const assets = await getAssets(config);
  const payload = buildPayload(config, assets, mediaToken);
  const bootstrap = buildBootstrapScript({
    css: payload.css,
    wallpaperDataUri: payload.wallpaperDataUri,
    videoSrc: payload.videoSrc,
    fit: payload.fit,
    transition: payload.transition,
    kenBurns: payload.kenBurns,
  });
  let ok = 0;
  for (const [id, session] of held) {
    try {
      if (session.themeScriptId) {
        await session.conn
          .send("Page.removeScriptToEvaluateOnNewDocument", { identifier: session.themeScriptId })
          .catch(() => {});
      }
      session.themeScriptId = await registerScript(session, bootstrap);
      await session.conn.send("Runtime.evaluate", { expression: bootstrap, returnByValue: true });
      ok++;
    } catch {
      session.conn.close();
      held.delete(id);
    }
  }
  return ok;
}

async function poll(config: BeautifyConfig, apiPort: number): Promise<void> {
  try {
    const targets = pickRendererTargets(await listTargets(config.port));
    const current = new Set(targets.map((t) => t.id));
    // Liveness check: a renderer reload can leave a half-open socket whose
    // sends "succeed" while nothing lands — the push counts a window that
    // never renders (zombie session). Ping each held session with a timeout
    // and drop the ones that do not answer.
    for (const [id, session] of [...held]) {
      const alive = await Promise.race([
        session.conn.send("Runtime.evaluate", { expression: "1" }).then(() => true, () => false),
        new Promise<boolean>((r) => setTimeout(() => r(false), 1500)),
      ]);
      if (!alive) {
        session.conn.close();
        held.delete(id);
      }
    }
    for (const t of targets) {
      if (!held.has(t.id)) {
        try {
          await holdSession(t, config, apiPort);
          console.log(`serve: panel + theme injected into "${t.title}" (${t.id})`);
        } catch {
          /* retry next tick */
        }
      }
    }
    for (const id of [...held.keys()]) {
      if (!current.has(id)) {
        held.get(id)!.conn.close();
        held.delete(id);
      }
    }
  } catch {
    /* CDP not reachable; keep polling */
  }
}

// --- HTTP API ----------------------------------------------------------------

function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
  // The client can vanish mid-request (panel closed, renderer reloaded); a
  // write to a dead socket must not escape as a rejection.
  try {
    res.writeHead(code, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end(JSON.stringify(body));
  } catch {
    /* response already finished or socket gone */
  }
}

/** True when another `serve` of this plugin already owns the port. */
export async function existingServePid(apiPort: number): Promise<number | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${apiPort}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    const body = (await res.json()) as { service?: string; pid?: number };
    return body?.service === "zcode-beautify" ? body.pid : undefined;
  } catch {
    return undefined;
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const IMAGE_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
};

export async function startServe(opts: ServeOptions): Promise<void> {
  const { cdpPort, apiPort } = opts;

  // Fresh random token every start; scripts on this machine (watchdog, CLI)
  // read it from <dataDir>/serve.token. The panel receives it in its injected
  // source and sends it as a header; media URLs carry it as ?t=.
  mediaToken = crypto.randomBytes(24).toString("hex");
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(path.join(dataDir(), "serve.token"), mediaToken, { encoding: "utf8" });
  } catch {
    /* best effort — auth degrades to tokenless only for /api/health */
  }

  // --- recently-used wallpaper history (F8) --------------------------------
  const historyFile = (): string => path.join(dataDir(), "history.json");
  function readHistory(): Array<{ at: number; label: string; kind: "image" | "video"; hash?: string; path?: string; thumbUrl?: string }> {
    try {
      return JSON.parse(fs.readFileSync(historyFile(), "utf8"));
    } catch {
      return [];
    }
  }
  function recordHistory(entry: { label: string; kind: "image" | "video"; hash?: string; path?: string; thumbUrl?: string }): void {
    try {
      const list = readHistory().filter((e) => e.hash !== entry.hash || e.path !== entry.path);
      list.unshift({ at: Date.now(), ...entry });
      fs.writeFileSync(historyFile(), JSON.stringify(list.slice(0, 20), null, 2));
    } catch {
      /* history is best effort */
    }
  }

  // `serve --port N` must win over the port stored in the config file: reading
  // the merged config alone silently dialed the stored port while still
  // printing the flag's value.
  const runtimeConfig = (): BeautifyConfig => ({ ...currentConfig(), port: cdpPort });
  /** What actually goes to disk — the CLI's --port is not a persisted setting. */
  const persisted = (config: BeautifyConfig): BeautifyConfig => ({
    ...config,
    port: currentConfig().port,
  });

  /**
   * Applies a library wallpaper (scene loop by hash, or image by path).
   * Shared by the /api/apply-wallpaper endpoint and the schedule timer, so
   * a scheduled switch behaves exactly like clicking the item in the panel.
   */
  const applyRef = async (ref: { hash?: string; path?: string }): Promise<{ windows: number }> => {
    const config = runtimeConfig();
    if (typeof ref.hash === "string") {
      const loopPath = path.join(scenesCacheRoot(), ref.hash, "loop.mp4");
      if (!fs.existsSync(loopPath)) throw new Error("unknown scene hash");
      let label = ref.hash.slice(0, 8);
      try {
        label = (JSON.parse(fs.readFileSync(path.join(scenesCacheRoot(), ref.hash, "name.json"), "utf8")) as { name?: string }).name || label;
      } catch {
        /* unnamed */
      }
      const next: BeautifyConfig = {
        ...config,
        mediaType: "video",
        sceneHash: ref.hash,
        wallpaperPath: loopPath,
        apiPort,
        sceneVideoUrl: `http://127.0.0.1:${apiPort}/media/scene/${ref.hash}.mp4`,
      };
      saveConfig(persisted(next));
      recordHistory({ label, kind: "video", hash: ref.hash, thumbUrl: `http://127.0.0.1:${apiPort}/media/poster/${ref.hash}.jpg` });
      return { windows: await pushConfigToSessions(next).catch(() => 0) };
    }
    if (typeof ref.path === "string" && fs.existsSync(ref.path)) {
      const next: BeautifyConfig = {
        ...config,
        wallpaperPath: ref.path,
        mediaType: "image",
        sceneHash: undefined,
        sceneVideoUrl: undefined,
      };
      saveConfig(persisted(next));
      recordHistory({ label: path.basename(ref.path), kind: "image", path: ref.path, thumbUrl: `http://127.0.0.1:${apiPort}/media/lib/${encodeURIComponent(path.basename(ref.path))}` });
      return { windows: await pushConfigToSessions(next).catch(() => 0) };
    }
    throw new Error("provide hash or existing path");
  };

  const already = await existingServePid(apiPort);
  if (already !== undefined) {
    throw new Error(
      `a beautify service is already running on http://127.0.0.1:${apiPort} (pid ${already}) — ` +
        `open its panel, or stop that process first`
    );
  }

  // A request handler that rejects would otherwise take the whole process down
  // (unhandled rejection), killing every held injection session with it.
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      try {
        res.destroy();
      } catch {
        /* socket gone */
      }
    });
  });

  async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (req.method === "OPTIONS") {
        // Preflight carries no secrets; approving the header list lets the
        // injected panel (origin null) send its token header. Actual requests
        // still 401 without a valid token.
        try {
          res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Beautify-Token",
          });
          res.end();
        } catch {
          /* socket gone */
        }
        return;
      }

      // Auth: everything except the health probe requires the per-start token
      // (header for API calls, ?t= for <video>/<img> media URLs). Without it
      // any web page on this machine could drive this API and read media.
      if (url.pathname !== "/api/health") {
        const presented = String(req.headers["x-beautify-token"] ?? url.searchParams.get("t") ?? "");
        if (presented !== mediaToken) {
          sendJson(res, 401, { error: "unauthorized" });
          return;
        }
      }

      if (req.method === "GET" && url.pathname === "/api/config") {
        sendJson(res, 200, publicConfig(runtimeConfig()));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/config") {
        const patch = sanitize(JSON.parse(await readBody(req)));
        const config = { ...runtimeConfig(), ...patch };
        saveConfig(persisted(config));
        const windows = await pushConfigToSessions(config).catch(() => 0);
        sendJson(res, 200, { ok: true, windows, ...publicConfig(config) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/wallpaper") {
        const body = JSON.parse(await readBody(req));
        const dataUri = typeof body?.dataUri === "string" ? body.dataUri : "";
        const m = /^data:(image\/(?:jpeg|png|webp|gif|bmp));base64,(.+)$/.exec(dataUri);
        if (!m) throw new Error("dataUri must be a base64 image data URI");
        const bytes = Buffer.from(m[2], "base64");
        if (bytes.length > MAX_WALLPAPER_BYTES) {
          throw new Error(`image too large (max ${MAX_WALLPAPER_BYTES / 1024 / 1024} MB)`);
        }
        const config = runtimeConfig();
        fs.mkdirSync(dataDir(), { recursive: true });
        // Save under the ORIGINAL filename (sanitized): the old fixed
        // "wallpaper.<ext>" destination silently overwrote the previous
        // upload, so the library never gained an entry and a new pick looked
        // like "nothing was added". Collisions get a numeric suffix.
        const ext = IMAGE_EXT[m[1]];
        const safeBase = (typeof body?.name === "string" ? path.basename(body.name) : "wallpaper")
          .replace(/[\\/:*?"<>|]/g, "_")
          .replace(new RegExp("\\" + ext + "$", "i"), "")
          .trim() || "wallpaper";
        let dest = path.join(dataDir(), safeBase + ext);
        for (let i = 2; fs.existsSync(dest); i++) {
          dest = path.join(dataDir(), `${safeBase}(${i})${ext}`);
        }
        fs.writeFileSync(dest, bytes);
        // Leaving the video fields set made buildPayload keep injecting the
        // OLD loop video: the upload "applied" while the wallpaper never
        // changed. An upload is always an image — clear the scene state.
        const themeSrc = await themeThumbFor(dest);
        rememberAssets(themeSrc, fs.statSync(themeSrc).mtimeMs, await loadWallpaper(themeSrc));
        const nextCfg: BeautifyConfig = {
          ...config,
          wallpaperPath: dest,
          mediaType: "image",
          sceneHash: undefined,
          sceneVideoUrl: undefined,
        };
        saveConfig(persisted(nextCfg));
        recordHistory({ label: safeBase + ext, kind: "image", path: dest, thumbUrl: `http://127.0.0.1:${apiPort}/media/lib/${encodeURIComponent(path.basename(dest))}` });
        const windows = await pushConfigToSessions(nextCfg).catch(() => 0);
        sendJson(res, 200, { ok: true, windows, ...publicConfig(nextCfg) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/reset") {
        const stored = loadConfig();
        // Back up the wallpaper config so /api/restore can bring it back
        // without re-importing the image.
        if (stored.wallpaperPath && fs.existsSync(stored.wallpaperPath)) {
          fs.mkdirSync(dataDir(), { recursive: true });
          fs.writeFileSync(backupFile(), JSON.stringify(stored));
        }
        for (const [id, session] of held) {
          try {
            if (session.themeScriptId) {
              await session.conn
                .send("Page.removeScriptToEvaluateOnNewDocument", { identifier: session.themeScriptId })
                .catch(() => {});
              session.themeScriptId = undefined;
            }
            await session.conn.send("Runtime.evaluate", { expression: buildResetScript() });
          } catch {
            session.conn.close();
            held.delete(id);
          }
        }
        // Without this the next rotation tick re-applied a playlist wallpaper
        // seconds after the reset — "restore default appearance" read broken.
        stopRotationTimers();
        saveConfig({ ...stored, wallpaperPath: undefined, mediaType: undefined, sceneHash: undefined, sceneVideoUrl: undefined });
        assetsCache.clear();
        sendJson(res, 200, { ok: true, hasBackup: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/restore") {
        let saved: Partial<BeautifyConfig>;
        try {
          saved = JSON.parse(fs.readFileSync(backupFile(), "utf8"));
        } catch {
          throw new Error("no wallpaper backup available");
        }
        const config: BeautifyConfig = { ...DEFAULT_CONFIG, ...saved };
        saveConfig(config);
        const windows = await pushConfigToSessions(config).catch(() => 0);
        sendJson(res, 200, { ok: true, windows, ...publicConfig(config) });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/health") {
        sendJson(res, 200, { ok: true, service: "zcode-beautify", pid: process.pid });
        return;
      }

      // --- scene wallpaper import -------------------------------------------

      // Opens a native file dialog and returns the picked path. The panel is
      // a web page and cannot see absolute paths (browser security), but this
      // local serve process can — so the dialog lives here.
      if (req.method === "POST" && url.pathname === "/api/pick-scene") {
        const picked = await pickFileViaDialog();
        sendJson(res, 200, { ok: Boolean(picked), path: picked });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/import-scene") {
        const body = JSON.parse(await readBody(req));
        const scenePath = typeof body?.path === "string" ? body.path.trim() : "";
        const sceneOpts = typeof body?.maxSeconds === "number" && body.maxSeconds >= 5 && body.maxSeconds <= 60 ? { maxSeconds: body.maxSeconds } : {};
        if (!scenePath) throw new Error("path is required");
        if (importJob.running) {
          sendJson(res, 409, { error: "another import is already running", stage: importJob.stage });
          return;
        }
        const abort = new AbortController();
        importJob = { running: true, stage: "starting", abort };
        // Fire-and-forget: the panel polls /api/import-status for progress;
        // /api/import-cancel aborts the controller (kills ffmpeg, cleans up).
        void importScene(scenePath, (stage, detail) => {
          importJob.stage = stage;
          importJob.detail = detail;
        }, sceneOpts, undefined, abort.signal)
          .then(async (result: SceneImportResult) => {
            importJob = {
              running: false,
              stage: "done",
              result: { loopPath: result.loopPath, posterPath: result.posterPath, hash: result.hash, fromCache: result.fromCache },
            };
            // Adopt the imported scene as the current wallpaper right away.
            const config = runtimeConfig();
            const next: BeautifyConfig = {
              ...config,
              mediaType: "video",
              sceneHash: result.hash,
              wallpaperPath: result.loopPath,
              apiPort,
              sceneVideoUrl: `http://127.0.0.1:${apiPort}/media/scene/${result.hash}.mp4`,
            };
            saveConfig(persisted(next));
            let label = result.hash.slice(0, 8);
            try {
              label = (JSON.parse(fs.readFileSync(path.join(scenesCacheRoot(), result.hash, "name.json"), "utf8")) as { name?: string }).name || label;
            } catch {
              /* unnamed */
            }
            recordHistory({ label, kind: "video", hash: result.hash, thumbUrl: `http://127.0.0.1:${apiPort}/media/poster/${result.hash}.jpg` });
            await pushConfigToSessions(next).catch(() => 0);
          })
          .catch((err: Error) => {
            importJob = {
              running: false,
              stage: "error",
              error: err.message,
              guide: err instanceof MissingDependencyError ? getInstallGuide(err.missing) : undefined,
            };
          });
        sendJson(res, 200, { ok: true, started: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/import-cancel") {
        if (importJob.running && importJob.abort) {
          importJob.abort.abort();
          sendJson(res, 200, { ok: true, message: "已请求取消" });
        } else {
          sendJson(res, 200, { ok: false, error: "没有进行中的导入" });
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/import-status") {
        sendJson(res, 200, importJob);
        return;
      }

      // Apply an item from the library: image by path, scene by cache hash.
      if (req.method === "POST" && url.pathname === "/api/apply-wallpaper") {
        const body = JSON.parse(await readBody(req));
        const r = await applyRef({
          hash: typeof body?.hash === "string" ? body.hash : undefined,
          path: typeof body?.path === "string" ? body.path : undefined,
        });
        sendJson(res, 200, { ok: true, windows: r.windows, ...publicConfig(runtimeConfig()) });
        return;
      }

      // Library listing for the panel: static images + cached scene loops.
      // ?sort=name orders by filename; default is newest first (mtime desc).
      if (req.method === "GET" && url.pathname === "/api/library") {
        const images: Array<{ name: string; path: string; mtimeMs: number }> = [];
        for (const f of fs.readdirSync(dataDir())) {
          if (/\.(jpe?g|png|webp|bmp)$/i.test(f)) {
            try {
              images.push({ name: f, path: path.join(dataDir(), f), mtimeMs: fs.statSync(path.join(dataDir(), f)).mtimeMs });
            } catch {
              /* vanished */
            }
          }
        }
        if (url.searchParams.get("sort") === "name") images.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
        else images.sort((a, b) => b.mtimeMs - a.mtimeMs);
        const scenes: Array<{ hash: string; name?: string; sizeBytes: number; mtimeMs: number }> = [];
        try {
          for (const d of fs.readdirSync(scenesCacheRoot())) {
            const loop = path.join(scenesCacheRoot(), d, "loop.mp4");
            try {
              const st = fs.statSync(loop);
              let name: string | undefined;
              try {
                name = (JSON.parse(fs.readFileSync(path.join(scenesCacheRoot(), d, "name.json"), "utf8")) as { name?: string }).name;
              } catch {
                /* unnamed entry */
              }
              scenes.push({ hash: d, name, sizeBytes: st.size, mtimeMs: st.mtimeMs });
            } catch {
              /* incomplete entry */
            }
          }
        } catch {
          /* no scenes dir yet */
        }
        scenes.sort((a, b) => b.mtimeMs - a.mtimeMs);
        sendJson(res, 200, { images, scenes });
        return;
      }

      // Rename / delete library entries. Scenes are content-addressed, so a
      // display name lives in a small sidecar (name.json) and never affects
      // cache identity; images are plain files inside dataDir.
      if (req.method === "POST" && url.pathname === "/api/library-rename") {
        const body = JSON.parse(await readBody(req));
        const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
        if (!name) throw new Error("name is required");
        if (name.includes("/") || name.includes("\\") || name.includes("..")) throw new Error("invalid name");

        if (body?.kind === "scene" && typeof body?.hash === "string" && /^[a-f0-9]{8,64}$/.test(body.hash)) {
          const dir = path.join(scenesCacheRoot(), body.hash);
          if (!fs.existsSync(dir)) throw new Error("unknown scene hash");
          fs.writeFileSync(path.join(dir, "name.json"), JSON.stringify({ name }));
          sendJson(res, 200, { ok: true });
          return;
        }
        if (body?.kind === "image" && typeof body?.path === "string") {
          const oldPath = path.resolve(body.path);
          const renamed = renameLibraryImage(oldPath, name);
          // Resolve both sides: a config stored with forward slashes must
          // still count as the same file (strict === once missed and the
          // config kept pointing at the no-longer-existing old name).
          const cfg = runtimeConfig();
          if (cfg.wallpaperPath && path.resolve(cfg.wallpaperPath) === oldPath) {
            saveConfig(persisted({ ...cfg, wallpaperPath: renamed }));
          }
          sendJson(res, 200, { ok: true, path: renamed });
          return;
        }
        throw new Error("kind must be scene (with hash) or image (with path)");
      }

      if (req.method === "POST" && url.pathname === "/api/library-delete") {
        const body = JSON.parse(await readBody(req));
        const config = runtimeConfig();
        /** Also drops the deleted wallpaper from every rotation plan so the
         *  playlist does not error on a dead reference until the next save.
         *  The running timers keep the OLD entry list — restart so playback
         *  continues on the cleaned plans instead of erroring every tick. */
        const dropFromPlans = (match: (e: RotationEntry) => boolean): void => {
          const rot = normalizeRotation(runtimeConfig().rotation);
          let touched = false;
          for (const plan of rot.plans) {
            const kept = plan.entries.filter((e) => !match(e));
            if (kept.length !== plan.entries.length) {
              plan.entries = kept;
              touched = true;
            }
          }
          if (touched) {
            saveConfig(persisted({ ...runtimeConfig(), rotation: rot }));
            if (rot.enabled) startRotation(true);
          }
        };
        if (body?.kind === "scene" && typeof body?.hash === "string" && /^[a-f0-9]{8,64}$/.test(body.hash)) {
          if (config.sceneHash === body.hash) {
            throw new Error("该壁纸正在使用中 — 先切换到其他壁纸再删除");
          }
          const dir = path.join(scenesCacheRoot(), body.hash);
          if (!fs.existsSync(dir)) throw new Error("unknown scene hash");
          fs.rmSync(dir, { recursive: true, force: true });
          dropFromPlans((e) => e.hash === body.hash);
          sendJson(res, 200, { ok: true });
          return;
        }
        if (body?.kind === "image" && typeof body?.path === "string") {
          const target = path.resolve(body.path);
          // Normalize both sides: a config applied with forward slashes must
          // still count as "in use" (this guard once missed and an active
          // wallpaper got deleted).
          if (config.wallpaperPath && path.resolve(config.wallpaperPath) === target) {
            throw new Error("该壁纸正在使用中 — 先切换到其他壁纸再删除");
          }
          if (!isInsideDataDir(target) || !/\.(jpe?g|png|webp|bmp)$/i.test(target)) {
            throw new Error("only plugin-managed wallpapers can be deleted here");
          }
          fs.rmSync(target, { force: true });
          const thumb = path.join(thumbDir(), path.basename(target) + ".jpg");
          if (isInsideDataDir(thumb)) fs.rmSync(thumb, { force: true });
          dropFromPlans((e) => Boolean(e.path && path.resolve(e.path) === target));
          sendJson(res, 200, { ok: true });
          return;
        }
        throw new Error("kind must be scene (with hash) or image (with path)");
      }

      // --- wallpaper rotation (定时播放: duration-based playlist) -------------

      if (req.method === "GET" && url.pathname === "/api/rotation") {
        // Legacy mode+entries configs normalize into a single 默认方案.
        sendJson(res, 200, { rotation: normalizeRotation(runtimeConfig().rotation) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/rotation") {
        const body = JSON.parse(await readBody(req));
        const next = sanitizeRotation(body?.rotation);
        const stored = persisted({ ...runtimeConfig(), rotation: next });
        // Drop the legacy clock-time `schedule` field from the first version.
        delete (stored as unknown as Record<string, unknown>).schedule;
        delete (stored as unknown as Record<string, unknown>).transition;
        saveConfig(stored);
        // resume=true (the enable checkbox) continues from each plan's saved
        // position; an explicit 播放 keeps its restart-from-zero semantics.
        startRotation(body?.resume === true);
        sendJson(res, 200, { ok: true, rotation: next });
        return;
      }

      // 立即切换: skip ahead to the next playlist entry right now.
      if (req.method === "POST" && url.pathname === "/api/rotation-next") {
        sendJson(res, 200, skipRotation());
        return;
      }

      // --- storage stats + scene cache purge (F2) ---------------------------
      if (req.method === "GET" && url.pathname === "/api/storage") {
        let scenesBytes = 0;
        const entries: Array<{ hash: string; name?: string; sizeBytes: number }> = [];
        try {
          for (const d of fs.readdirSync(scenesCacheRoot())) {
            try {
              let size = 0;
              const walk = (dir: string): void => {
                for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
                  const p = path.join(dir, f.name);
                  if (f.isDirectory()) walk(p);
                  else { try { size += fs.statSync(p).size; } catch { /* gone */ } }
                }
              };
              walk(path.join(scenesCacheRoot(), d));
              let name: string | undefined;
              try {
                name = (JSON.parse(fs.readFileSync(path.join(scenesCacheRoot(), d, "name.json"), "utf8")) as { name?: string }).name;
              } catch {
                /* unnamed */
              }
              entries.push({ hash: d, name, sizeBytes: size });
              scenesBytes += size;
            } catch {
              /* partial entry */
            }
          }
        } catch {
          /* no scenes dir */
        }
        let thumbsBytes = 0;
        try {
          for (const f of fs.readdirSync(thumbDir())) {
            try { thumbsBytes += fs.statSync(path.join(thumbDir(), f)).size; } catch { /* gone */ }
          }
        } catch {
          /* no thumbs dir */
        }
        sendJson(res, 200, { scenesBytes, thumbsBytes, entries: entries.sort((a, b) => b.sizeBytes - a.sizeBytes) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/scenes-purge") {
        const config = runtimeConfig();
        let removed = 0;
        try {
          for (const d of fs.readdirSync(scenesCacheRoot())) {
            if (config.sceneHash === d) continue; // the playing loop must survive
            try {
              fs.rmSync(path.join(scenesCacheRoot(), d), { recursive: true, force: true });
              removed++;
            } catch {
              /* locked */
            }
          }
        } catch {
          /* no scenes dir */
        }
        if (removed) {
          // Plans referencing purged scenes must not keep dead entries.
          const rot = normalizeRotation(runtimeConfig().rotation);
          for (const plan of rot.plans) plan.entries = plan.entries.filter((e) => !e.hash || fs.existsSync(path.join(scenesCacheRoot(), e.hash, "loop.mp4")));
          saveConfig(persisted({ ...runtimeConfig(), rotation: rot }));
          if (rot.enabled) startRotation(true);
        }
        sendJson(res, 200, { ok: true, removed });
        return;
      }

      // --- config export / import (F3) --------------------------------------
      if (req.method === "GET" && url.pathname === "/api/export") {
        const stored = runtimeConfig();
        sendJson(res, 200, {
          kind: "zcode-beautify-config",
          version: 1,
          exportedAt: new Date().toISOString(),
          config: {
            blur: stored.blur,
            dim: stored.dim,
            monet: stored.monet,
            wallpaperVisible: stored.wallpaperVisible,
            kenBurns: stored.kenBurns ?? false,
            fit: stored.fit,
            wallpaperPath: stored.wallpaperPath,
            mediaType: stored.mediaType,
            sceneHash: stored.sceneHash,
            rotation: normalizeRotation(stored.rotation),
          },
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/import-config") {
        const body = JSON.parse(await readBody(req));
        if (body?.kind !== "zcode-beautify-config" || !body?.config) {
          throw new Error("not a zcode-beautify config export");
        }
        const incoming = body.config as Record<string, unknown>;
        const patch = sanitize(incoming); // blur/dim/monet/visible/kenBurns/fit
        const withWp: BeautifyConfig = { ...runtimeConfig(), ...patch };
        if (typeof incoming.wallpaperPath === "string" && fs.existsSync(incoming.wallpaperPath)) {
          withWp.wallpaperPath = incoming.wallpaperPath;
          withWp.mediaType = incoming.mediaType === "video" ? "video" : "image";
          withWp.sceneHash = typeof incoming.sceneHash === "string" ? incoming.sceneHash : undefined;
          withWp.sceneVideoUrl = withWp.mediaType === "video" && withWp.sceneHash
            ? `http://127.0.0.1:${apiPort}/media/scene/${withWp.sceneHash}.mp4`
            : undefined;
        }
        if (incoming.rotation) withWp.rotation = sanitizeRotation(incoming.rotation);
        saveConfig(persisted(withWp));
        const windows = await pushConfigToSessions(withWp).catch(() => 0);
        startRotation(true);
        sendJson(res, 200, { ok: true, windows });
        return;
      }

      // --- open library folders in Explorer (F6) ----------------------------
      if (req.method === "POST" && url.pathname === "/api/open-folder") {
        const body = JSON.parse(await readBody(req));
        const target =
          body?.target === "scenes" ? scenesCacheRoot()
          : body?.target === "thumbs" ? thumbDir()
          : dataDir();
        fs.mkdirSync(target, { recursive: true });
        spawn("explorer", [target], { detached: true, stdio: "ignore" }).unref();
        sendJson(res, 200, { ok: true, path: target });
        return;
      }

      // --- recently-used wallpapers (F8) -------------------------------------
      if (req.method === "GET" && url.pathname === "/api/history") {
        sendJson(res, 200, { items: readHistory() });
        return;
      }

      // Loop video streaming for the injected <video> layer (Range-capable).
      if (req.method === "GET" && url.pathname.startsWith("/media/scene/")) {
        const hash = /^\/media\/scene\/([a-f0-9]{8,64})\.mp4$/.exec(url.pathname)?.[1];
        if (!hash) {
          sendJson(res, 400, { error: "bad scene media path" });
          return;
        }
        const file = path.join(scenesCacheRoot(), hash, "loop.mp4");
        if (!sendMediaFile(req, res, file)) {
          sendJson(res, 404, { error: "scene media not found" });
        }
        return;
      }

      // Poster thumbnails (panel wallpaper previews).
      if (req.method === "GET" && url.pathname.startsWith("/media/poster/")) {
        const hash = /^\/media\/poster\/([a-f0-9]{8,64})\.jpg$/.exec(url.pathname)?.[1];
        if (!hash) {
          sendJson(res, 400, { error: "bad poster path" });
          return;
        }
        const file = path.join(scenesCacheRoot(), hash, "poster.jpg");
        if (!sendMediaFile(req, res, file)) {
          sendJson(res, 404, { error: "poster not found" });
        }
        return;
      }

      // Library image thumbnails: only plain image files inside the data dir.
      if (req.method === "GET" && url.pathname.startsWith("/media/lib/")) {
        const name = decodeURIComponent(url.pathname.slice("/media/lib/".length));
        // Allow any single filename component (incl. CJK); block traversal.
        if (name.includes("..") || name.includes("/") || name.includes("\\") || !/^[^:"<>|*?]+\.(jpe?g|png|webp|bmp)$/i.test(name)) {
          sendJson(res, 400, { error: "bad library media path" });
          return;
        }
        const file = path.join(dataDir(), name);
        if (!isInsideDataDir(file) || !sendMediaFile(req, res, file)) {
          sendJson(res, 404, { error: "library media not found" });
        }
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 400, { error: (err as Error).message });
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(apiPort, "127.0.0.1", resolve);
  });

  // The listen-time listener above is one-shot; without a permanent one, any
  // later server error would be an unhandled 'error' event and crash serve.
  server.on("error", (err) => {
    console.error(`serve: http server error — ${(err as Error).message}`);
  });

  console.log(`serve: control API on http://127.0.0.1:${apiPort} — Ctrl+C to stop`);
  console.log(`serve: injecting into ZCode renderers on CDP port ${cdpPort}`);

  // --- wallpaper rotation (定时播放) ------------------------------------------
  // Three modes: "sequence" plays every entry for its duration in order and
  // loops; "random" does the same but never plays the same entry twice in a
  // row; "schedule" switches at daily HH:MM clock times and leaves the
  // wallpaper alone in between. A plan may also declare a daily time window
  // (F5): while "now" falls inside it, that plan plays regardless of
  // activePlanId. Re-enabling after a pause resumes each plan's saved
  // position (F1) instead of always restarting at entry 0.
  let rotationTimer: NodeJS.Timeout | undefined;
  let rotationTick: NodeJS.Timeout | undefined;
  let lastScheduleFire = "";
  let randomAvoid = -1;
  let rotationIndex = 0;
  /** Generation guard: a restart while an applyRef is in flight must leave
   *  the OLD timer chain dead — without it two chains both schedule switches. */
  let rotationGen = 0;
  /** Where each plan left off (F1), keyed by plan id. */
  const resumeIndex = new Map<string, number>();
  /** The plan id the window watcher currently has active (F5). */
  let windowPlanId: string | undefined;

  const hhmmNow = (): string =>
    `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`;

  /** Daily-window containment; start > end means an overnight span. */
  function inWindow(win: { start: string; end: string } | undefined, hhmm: string): boolean {
    if (!win) return false;
    return win.start <= win.end
      ? hhmm >= win.start && hhmm <= win.end
      : hhmm >= win.start || hhmm <= win.end;
  }

  /** The rotation as it should play right now (normalized + active plan). */
  function rotationNow(): { on: boolean; plan?: RotationPlan } {
    const norm = normalizeRotation(runtimeConfig().rotation);
    if (!norm.enabled || !norm.plans.length) return { on: false };
    const hhmm = hhmmNow();
    const windowed = norm.plans.find((p) => inWindow(p.window, hhmm) && p.entries.length);
    const plan = windowed ?? norm.plans.find((p) => p.id === norm.activePlanId) ?? norm.plans[0];
    if (!plan || !plan.entries.length) return { on: false };
    return { on: true, plan };
  }

  function stopRotationTimers(): void {
    rotationGen++;
    if (rotationTimer) {
      clearTimeout(rotationTimer);
      rotationTimer = undefined;
    }
    if (rotationTick) {
      clearInterval(rotationTick);
      rotationTick = undefined;
    }
  }

  async function playRotationEntry(index: number): Promise<void> {
    const gen = rotationGen;
    const s = rotationNow();
    if (!s.on || !s.plan || s.plan.mode === "schedule") return;
    const rot = s.plan;
    const n = rot.entries.length;
    const i = ((index % n) + n) % n;
    const entry = rot.entries[i];
    randomAvoid = i;
    rotationIndex = i;
    resumeIndex.set(rot.id, i);
    try {
      const r = await applyRef(entry);
      console.log(`serve: rotation [${rot.name}/${rot.mode}] ${i + 1}/${n} -> ${entry.hash ?? entry.path} for ${entry.seconds}s (${r.windows} window(s))`);
    } catch (err) {
      console.error(`serve: rotation apply failed — ${(err as Error).message}`);
    }
    // A restart raced this apply: its chain owns the future; drop out here so
    // this stale chain can never schedule a second, competing timer.
    if (gen !== rotationGen) return;
    if (rotationTimer) clearTimeout(rotationTimer);
    rotationTimer = setTimeout(() => {
      if (gen !== rotationGen) return;
      const cur = rotationNow();
      if (!cur.on || !cur.plan || cur.plan.mode === "schedule" || !cur.plan.entries.length) return;
      const total = cur.plan.entries.length;
      let next: number;
      if (cur.plan.mode === "random" && total > 1) {
        do {
          next = Math.floor(Math.random() * total);
        } while (next === randomAvoid);
      } else {
        next = (i + 1) % total;
      }
      void playRotationEntry(next);
    }, Math.max(10, entry.seconds ?? 60) * 1000);
    rotationTimer.unref?.();
  }

  /** Schedule-mode minute check; the "date + HH:MM" key fires each entry at
   *  most once per day even though several ticks land inside its minute. */
  function checkRotationSchedule(): void {
    const s = rotationNow();
    if (!s.on || !s.plan || s.plan.mode !== "schedule") return;
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const fireKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()} ${hhmm}`;
    if (fireKey === lastScheduleFire) return;
    const due = s.plan.entries.filter((e) => e.time === hhmm);
    if (!due.length) return;
    lastScheduleFire = fireKey;
    const entry = due[due.length - 1];
    void applyRef(entry)
      .then((r) => console.log(`serve: rotation [${s.plan!.name}/schedule] ${hhmm} -> ${entry.hash ?? entry.path} (${r.windows} window(s))`))
      .catch((err: Error) => console.error(`serve: rotation schedule fire failed — ${err.message}`));
  }

  /** 20s watchdog for duration plans: switches to a plan whose window just
   *  opened (F5). Fires only on CHANGES — entry timing stays with the timers. */
  function rotationWatch(): void {
    const norm = normalizeRotation(runtimeConfig().rotation);
    if (!norm.enabled) return;
    const hhmm = hhmmNow();
    const windowed = norm.plans.find((p) => inWindow(p.window, hhmm) && p.entries.length);
    if (windowed && windowed.id !== windowPlanId) {
      console.log(`serve: rotation window -> plan "${windowed.name}" (${hhmm})`);
      startRotation(true);
    }
  }

  /**
   * 立即切换: skip the rest of the current entry's duration and jump to the
   * next wallpaper right now (same next-pick logic as the timer callback).
   */
  function skipRotation(): { ok: boolean; error?: string } {
    const s = rotationNow();
    if (!s.on || !s.plan) return { ok: false, error: "定时播放未启用或方案为空" };
    if (s.plan.mode === "schedule") return { ok: false, error: "定时切换模式按时间点播放,无下一张" };
    if (rotationTimer) clearTimeout(rotationTimer);
    const total = s.plan.entries.length;
    let next: number;
    if (s.plan.mode === "random" && total > 1) {
      do {
        next = Math.floor(Math.random() * total);
      } while (next === rotationIndex);
    } else {
      next = rotationIndex + 1;
    }
    void playRotationEntry(next);
    return { ok: true };
  }

  /** (Re)starts or stops the playlist per the current stored rotation.
   *  resume=true continues each plan from its saved position (F1). */
  function startRotation(resume = false): void {
    stopRotationTimers();
    lastScheduleFire = "";
    randomAvoid = -1;
    const norm = normalizeRotation(runtimeConfig().rotation);
    const hhmm = hhmmNow();
    windowPlanId = (
      norm.plans.find((p) => inWindow(p.window, hhmm) && p.entries.length) ??
      norm.plans.find((p) => p.id === norm.activePlanId) ??
      norm.plans[0]
    )?.id;
    const s = rotationNow();
    if (!s.on || !s.plan) return;
    if (s.plan.mode === "schedule") {
      rotationTick = setInterval(checkRotationSchedule, 20_000);
      rotationTick.unref?.();
      checkRotationSchedule();
    } else {
      rotationTick = setInterval(rotationWatch, 20_000);
      rotationTick.unref?.();
      void playRotationEntry(resume ? (resumeIndex.get(s.plan.id) ?? 0) : 0);
    }
  }

  // Initial pass, then keep polling so restarts of the app get re-injected.
  await poll(runtimeConfig(), apiPort);
  // Resume an enabled rotation playlist (re-applies entry 0).
  startRotation();
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    await poll(runtimeConfig(), apiPort);
  }
}

/** Entries valid for the given mode; invalid ones are dropped silently. */
function validPlanEntries(mode: RotationMode, raw: unknown): RotationEntry[] {
  const out: RotationEntry[] = [];
  if (!Array.isArray(raw)) return out;
  const seenTimes = new Set<string>();
  for (const e of raw.slice(0, 20)) {
    if (!e || typeof e !== "object") continue;
    const { seconds, time, hash, path: imgPath } = e as { seconds?: unknown; time?: unknown; hash?: unknown; path?: unknown };
    const ref =
      typeof hash === "string" && /^[a-f0-9]{8,64}$/.test(hash) && fs.existsSync(path.join(scenesCacheRoot(), hash, "loop.mp4"))
        ? { hash }
        : typeof imgPath === "string" && fs.existsSync(imgPath)
          ? { path: imgPath }
          : undefined;
    if (!ref) continue;
    if (mode === "schedule") {
      if (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) continue;
      if (seenTimes.has(time)) continue;
      seenTimes.add(time);
      out.push({ time, ...ref });
    } else {
      if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 10 || seconds > 86400) continue;
      out.push({ seconds: Math.round(seconds), ...ref });
    }
  }
  return out;
}

/**
 * Normalizes whatever is stored (pre-plans legacy shape or current shape)
 * into the plans form; a legacy playlist becomes the single 默认方案.
 */
function normalizeRotation(stored: unknown): RotationConfig {
  const legacy = stored as { enabled?: unknown; mode?: unknown; entries?: unknown } | undefined;
  const plansShape = stored as { plans?: unknown } | undefined;
  if (Array.isArray(plansShape?.plans) && (plansShape!.plans as unknown[]).length) {
    return sanitizeRotation(stored);
  }
  const mode: RotationMode = legacy?.mode === "random" || legacy?.mode === "schedule" ? legacy.mode : "sequence";
  return {
    enabled: typeof legacy?.enabled === "boolean" ? legacy.enabled : false,
    activePlanId: "default",
    plans: [{ id: "default", name: "默认方案", mode, entries: validPlanEntries(mode, legacy?.entries) }],
  };
}

/**
 * Validates a rotation config posted by the panel. Accepts both the current
 * {enabled, activePlanId, plans[]} shape and the legacy flat playlist. Plans
 * keep their identity (id) when it looks sane; names default to 方案 N; a
 * plan with no valid entries is dropped; at least one plan always remains.
 */
function sanitizeRotation(raw: unknown): RotationConfig {
  const r = (raw ?? {}) as { enabled?: unknown; activePlanId?: unknown; plans?: unknown; mode?: unknown; entries?: unknown };
  const plansRaw: unknown[] = Array.isArray(r.plans) && r.plans.length
    ? r.plans.slice(0, 10)
    : [{ mode: r.mode, entries: r.entries }];
  const plans: RotationPlan[] = [];
  const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  plansRaw.forEach((p, i) => {
    if (!p || typeof p !== "object") return;
    const q = p as { id?: unknown; name?: unknown; mode?: unknown; transition?: unknown; window?: unknown; entries?: unknown };
    const mode: RotationMode = q.mode === "random" || q.mode === "schedule" ? q.mode : "sequence";
    // Plans without (valid) entries are kept: a freshly created plan in the
    // panel starts empty, and dropping it here would make it vanish on save.
    const entries = validPlanEntries(mode, q.entries);
    const transition =
      q.transition === "fade" || q.transition === "none" || q.transition === "slide" || q.transition === "zoom" || q.transition === "blur"
        ? q.transition
        : undefined;
    const id = typeof q.id === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(q.id) ? q.id : `p${Date.now().toString(36)}${i}`;
    const name = typeof q.name === "string" && q.name.trim() ? q.name.trim().slice(0, 20) : `方案 ${i + 1}`;
    const plan: RotationPlan = { id, name, mode, entries };
    if (transition) plan.transition = transition;
    // Optional daily activation window (F5): "HH:MM"-"HH:MM", overnight spans
    // (start > end) allowed. Only stored when both ends parse.
    const w = q.window as { start?: unknown; end?: unknown } | undefined;
    if (w && typeof w.start === "string" && typeof w.end === "string" && HHMM_RE.test(w.start) && HHMM_RE.test(w.end) && w.start !== w.end) {
      plan.window = { start: w.start, end: w.end };
    }
    plans.push(plan);
  });
  if (!plans.length) {
    plans.push({ id: "default", name: "方案 1", mode: "sequence", entries: [] });
  }
  const activePlanId =
    typeof r.activePlanId === "string" && plans.some((p) => p.id === r.activePlanId) ? r.activePlanId : plans[0].id;
  return { enabled: r.enabled === true, activePlanId, plans };
}

/**
 * Native wallpaper file picker, shown from the serve process via PowerShell
 * WinForms (STA + a topmost owner form so it surfaces above ZCode). The
 * panel is a web page and cannot read absolute paths from <input type=file>,
 * so the dialog has to live in this local process. Resolves "" on cancel.
 */
async function pickFileViaDialog(): Promise<string> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Title = '选择动态壁纸 (场景 .pkg / 视频 .mp4, 或壁纸目录内任意文件)'
$d.Filter = '动态壁纸 (*.pkg;*.json;*.gif;*.jpg;*.png;*.mp4;*.webm)|*.pkg;*.json;*.gif;*.jpg;*.png;*.mp4;*.webm|所有文件 (*.*)|*.*'
if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName }`;
  try {
    const { stdout } = await promisify(execFile)("powershell", ["-STA", "-NoProfile", "-Command", script], { timeout: 300_000, windowsHide: true });
    return stdout.trim();
  } catch {
    return "";
  }
}

/** Renames a plugin-managed wallpaper image, keeping its extension.
 *  Collisions get a numeric suffix — a bare rename would SILENTLY OVERWRITE
 *  the existing file (Windows MoveFileEx semantics). */
function renameLibraryImage(oldPath: string, name: string): string {
  if (!isInsideDataDir(oldPath) || !/\.(jpe?g|png|webp|bmp)$/i.test(oldPath)) {
    throw new Error("only plugin-managed wallpapers can be renamed here");
  }
  const ext = path.extname(oldPath);
  const safe = name.replace(/[\/:*?"<>|]/g, "").trim() || "wallpaper";
  let newPath = path.join(path.dirname(oldPath), safe + ext);
  if (newPath.toLowerCase() !== path.resolve(oldPath).toLowerCase()) {
    for (let i = 2; fs.existsSync(newPath); i++) {
      newPath = path.join(path.dirname(oldPath), `${safe}(${i})${ext}`);
    }
    fs.renameSync(oldPath, newPath);
  }
  // Keep the palette thumb beside it (keyed by basename); the old one would
  // orphan and slowly pile up in thumbs/.
  const oldThumb = path.join(thumbDir(), path.basename(oldPath) + ".jpg");
  if (fs.existsSync(oldThumb)) {
    try {
      fs.renameSync(oldThumb, path.join(thumbDir(), path.basename(newPath) + ".jpg"));
    } catch {
      /* cosmetic only */
    }
  }
  return newPath;
}

function isInsideDataDir(target: string): boolean {
  const rel = path.relative(path.resolve(dataDir()), path.resolve(target));
  return rel !== "" && !rel.startsWith("..");
}
