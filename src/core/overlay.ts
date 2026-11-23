/**
 * Startup overlay: a tiny loader line appended to the client's app.asar main
 * entry. It runs in the Electron main process before `app.ready`, forces the
 * CDP debug port on, and keeps the beautify serve daemon alive. This is the
 * only injection path that survives a cleared plugin manager / lost shortcut
 * flag, because it does not depend on either.
 *
 * Modeled on zcode-token-usage-statusbar's overlay installer:
 *   - the asar is patched by appending a dynamic import of a .cjs loader
 *     (the entry is ESM in current ZCode builds, so dynamic import works);
 *   - install/remove only add or strip our own line — never a backup restore,
 *     so a client update that replaced the asar is never downgraded;
 *   - while the client is running Windows locks app.asar, so the patched copy
 *     is staged as app.asar.beautify.tmp and a detached monitor swaps it in
 *     after the client fully exits.
 *
 * Everything here is explicit opt-in: installOverlay() is called by
 * `/install-overlay` (or the auto-heal path after a previous explicit
 * install). A `.plugin-overlay-optout` marker blocks both the loader and
 * auto-heal until the next explicit install.
 */

import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { dataDir, experimentalEnabled, loadConfig } from "./launch.js";
import { findExecutable, target } from "./target.js";
import { VERSION } from "../version.js";

const ALIGN = 4;
const BLOCK = 4 * 1024 * 1024;
const MAX_HEADER = 64 * 1024 * 1024;
const COPY_CHUNK = 4 * 1024 * 1024;
const TMP_SUFFIX = ".beautify.tmp";
const LOCK_STALE_MS = 10 * 60_000;
const PENDING_MAX_AGE_MS = 24 * 60 * 60_000;

/* ------------------------------------------------------------------ paths */

export function overlayDir(): string {
  const override = process.env.ZCODE_BEAUTIFY_OVERLAY_DIR?.trim();
  return override ? path.resolve(override) : path.join(dataDir(), "overlay");
}

export interface OverlayPaths {
  dir: string;
  loader: string;
  cli: string;
  monitor: string;
  state: string;
  pending: string;
  optOut: string;
  log: string;
  lock: string;
  autoHealStamp: string;
}

export function overlayPaths(): OverlayPaths {
  const dir = overlayDir();
  return {
    dir,
    loader: path.join(dir, "overlay-loader.cjs"),
    cli: path.join(dir, "beautify-cli.mjs"),
    monitor: path.join(dir, "overlay-monitor.cjs"),
    state: path.join(dir, "overlay.json"),
    pending: path.join(dir, "overlay-pending.json"),
    optOut: path.join(dir, ".plugin-overlay-optout"),
    log: path.join(dir, "overlay.log"),
    lock: path.join(dir, "overlay-install.lock"),
    autoHealStamp: path.join(dir, "autoheal.stamp"),
  };
}

/** app.asar for the active target, or an env override (tests / custom dirs). */
export function findAppAsar(app = target()): string {
  const envName = app.id === "zcode" ? "ZCODE_BEAUTIFY_ASAR" : "WORKBUDDY_BEAUTIFY_ASAR";
  const override = process.env[envName]?.trim();
  if (override) return path.resolve(override);
  const exe = findExecutable(app);
  if (!exe) {
    throw new Error(
      `${app.appName} executable not found; set ${app.exeEnvVars[0]} (or install the client) and retry — ` +
        `the overlay patches <install dir>/resources/app.asar`
    );
  }
  const exeDir = path.dirname(exe);
  if (process.platform === "darwin" && app.id === "zcode") {
    // …/ZCode.app/Contents/MacOS/ZCode → …/ZCode.app/Contents/Resources/app.asar
    return path.resolve(exeDir, "..", "Resources", "app.asar");
  }
  return path.join(exeDir, "resources", "app.asar");
}

/** Locate the plugin root (the folder carrying runtime/ and dist/). */
export function defaultPluginRoot(): string {
  const env = process.env.ZCODE_BEAUTIFY_PLUGIN_ROOT?.trim();
  if (env && fs.existsSync(path.join(env, "runtime", "overlay-loader.cjs"))) return path.resolve(env);
  const starts: string[] = [];
  if (process.argv[1]) starts.push(path.dirname(path.resolve(process.argv[1])));
  starts.push(process.cwd());
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(dir, "runtime", "overlay-loader.cjs"))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(
    "cannot locate the zcode-beautify plugin root (runtime/overlay-loader.cjs missing); pass --plugin-root <dir>"
  );
}

/* --------------------------------------------------------------- asar I/O */

export interface AsarNode {
  size?: number;
  offset?: string;
  unpacked?: boolean;
  link?: string;
  integrity?: unknown;
  files?: Record<string, AsarNode>;
  [key: string]: unknown;
}

export interface AsarHeader {
  files: Record<string, AsarNode>;
  [key: string]: unknown;
}

export interface AsarLayout {
  header: AsarHeader;
  /** Byte offset of the file-data area. */
  dataStart: number;
  /** Entry path inside the asar, e.g. "out/main/index.js". */
  entryPath: string;
  entryNode: AsarNode;
}

function readExact(fd: number, length: number, position: number): Buffer {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const n = fs.readSync(fd, buf, done, length - done, position + done);
    if (n <= 0) throw new Error(`unexpected end of file at byte ${position + done}`);
    done += n;
  }
  return buf;
}

function writeAll(fd: number, buf: Buffer): void {
  let done = 0;
  while (done < buf.length) done += fs.writeSync(fd, buf, done, buf.length - done);
}

function nodeAt(header: AsarHeader, filePath: string): AsarNode | undefined {
  let cur: AsarNode | undefined = { files: header.files };
  for (const segment of filePath.split("/").filter(Boolean)) {
    cur = cur?.files?.[segment];
    if (!cur) return undefined;
  }
  return cur;
}

function flatten(node: AsarNode, prefix = ""): Array<{ path: string; node: AsarNode }> {
  const out: Array<{ path: string; node: AsarNode }> = [];
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const p = `${prefix}/${name}`;
    if (child && typeof child === "object" && child.files) out.push(...flatten(child, p));
    else out.push({ path: p, node: child });
  }
  return out;
}

function readInlineFile(fd: number, layout: AsarLayout, node: AsarNode): Buffer {
  if (node.unpacked) throw new Error("file is unpacked; not inside app.asar");
  const size = Number(node.size);
  const offset = Number(node.offset);
  if (!Number.isFinite(size) || !Number.isFinite(offset) || size < 0 || offset < 0) {
    throw new Error(`invalid asar file entry (size=${String(node.size)}, offset=${String(node.offset)})`);
  }
  return readExact(fd, size, layout.dataStart + offset);
}

/**
 * Parse the asar header. Layout (Electron pickle):
 *   u32 4 | u32 headerSize | u32 stringSize | u32 jsonSize | JSON | padding
 * data starts at 8 + headerSize; JSON at 16.
 */
export function readAsarLayout(fd: number): AsarLayout {
  const head = readExact(fd, 16, 0);
  const prefix = head.readUInt32LE(0);
  const headerSize = head.readUInt32LE(4);
  const stringSize = head.readUInt32LE(8);
  const jsonSize = head.readUInt32LE(12);
  if (prefix !== 4) throw new Error(`not an Electron asar (pickle prefix ${prefix})`);
  if (headerSize < 8 || jsonSize === 0 || jsonSize > MAX_HEADER || stringSize < jsonSize + 4) {
    throw new Error(`unsupported asar header (header=${headerSize}, string=${stringSize}, json=${jsonSize})`);
  }
  if (headerSize !== stringSize + 4) {
    throw new Error(`unsupported asar header layout (header=${headerSize}, string=${stringSize})`);
  }
  let header: AsarHeader;
  try {
    header = JSON.parse(readExact(fd, jsonSize, 16).toString("utf8")) as AsarHeader;
  } catch (err) {
    throw new Error(`cannot parse app.asar header: ${(err as Error).message}`);
  }
  if (!header || typeof header !== "object" || !header.files) throw new Error("app.asar header has no files map");

  const packageNode = header.files["package.json"];
  if (!packageNode || packageNode.unpacked || packageNode.link) {
    throw new Error("app.asar root package.json is missing or unpacked");
  }
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readInlineFile(fd, { header, dataStart: 8 + headerSize, entryPath: "", entryNode: {} }, packageNode).toString("utf8"));
  } catch (err) {
    throw new Error(`cannot read app.asar package.json: ${(err as Error).message}`);
  }
  const main = typeof pkg.main === "string" ? pkg.main : "";
  const entryPath = main.replace(/^[.][\\/]+/, "").replace(/^[\\/]+/, "").replace(/\\/g, "/");
  if (!entryPath || entryPath.split("/").includes("..")) throw new Error(`app.asar package.json has an invalid main entry: ${main || "(empty)"}`);
  const entryNode = nodeAt(header, entryPath);
  if (!entryNode || entryNode.unpacked || entryNode.link) throw new Error(`app.asar main entry ${entryPath} is missing or unpacked`);
  if (typeof entryNode.size !== "number") throw new Error(`app.asar main entry ${entryPath} has no size`);
  return { header, dataStart: 8 + headerSize, entryPath, entryNode };
}

/**
 * Read one inline file out of an asar (diagnostics/tests). The entry itself is
 * covered by inspectAsar(); this reads arbitrary files like package.json.
 */
export function readAsarFile(asarPath: string, filePath: string): Buffer {
  const fd = fs.openSync(asarPath, "r");
  try {
    const layout = readAsarLayout(fd);
    const node = nodeAt(layout.header, filePath.replace(/^\/+/, "").replace(/\\/g, "/"));
    if (!node) throw new Error(`file not found in app.asar: ${filePath}`);
    return readInlineFile(fd, layout, node);
  } finally {
    try { fs.closeSync(fd); } catch { /* closed */ }
  }
}

/* -------------------------------------------------------- injection line */

export function overlayInjectionLine(loaderPath: string): string {
  const url = pathToFileURL(loaderPath).href;
  return `\n;import(${JSON.stringify(url)}).then(() => null, (e) => console.error("[zcode-beautify] overlay load failed", e));`;
}

/** Matches any beautify overlay line, including ones pointing at an old dir. */
export const OVERLAY_LINE_RE =
  /\n?;import\("[^"]*overlay-loader\.cjs"\)\.then\(\(\) => null, \(e\) => console\.error\("\[zcode-beautify\] overlay load failed", e\)\);?/g;

export function stripOverlayLine(entry: Buffer | string): string {
  return entry.toString("utf8").replace(OVERLAY_LINE_RE, "");
}

export function hasOverlayLine(entry: Buffer | string): boolean {
  OVERLAY_LINE_RE.lastIndex = 0;
  return OVERLAY_LINE_RE.test(entry.toString("utf8"));
}

/* ---------------------------------------------------------------- inspect */

export interface AsarInspection {
  asar: string;
  exists: boolean;
  entryPath?: string;
  injected: boolean;
  /** The line points at this runtime's loader (not an old install path). */
  current: boolean;
  loaderUrls: string[];
  fileCount?: number;
  error?: string;
}

export function inspectAsar(asarPath: string, loaderPath = overlayPaths().loader): AsarInspection {
  const result: AsarInspection = { asar: asarPath, exists: false, injected: false, current: false, loaderUrls: [] };
  let fd: number | undefined;
  try {
    fd = fs.openSync(asarPath, "r");
    result.exists = true;
    const layout = readAsarLayout(fd);
    result.entryPath = layout.entryPath;
    result.fileCount = flatten(layout.header).length;
    const entry = readInlineFile(fd, layout, layout.entryNode).toString("utf8");
    result.injected = hasOverlayLine(entry);
    result.loaderUrls = [...entry.matchAll(/import\("([^"]*overlay-loader\.cjs)"\)/g)].map((m) => m[1]);
    const wanted = pathToFileURL(path.resolve(loaderPath)).href;
    result.current = result.injected && result.loaderUrls.length > 0 && result.loaderUrls.every((u) => u === wanted);
  } catch (err) {
    result.error = (err as Error).message;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* closed */ }
    }
  }
  return result;
}

/* --------------------------------------------------------------- patching */

export interface PatchStats {
  entryPath: string;
  files: number;
  bytes: number;
  entryBytes: number;
  injected: boolean;
  /** Source asar fingerprint captured before reading; the swap must match it. */
  source: { size: number; mtimeMs: number };
}

function integrityFor(data: Buffer): Record<string, unknown> {
  const blocks: string[] = [];
  for (let i = 0; i < data.length; i += BLOCK) {
    blocks.push(createHash("sha256").update(data.subarray(i, Math.min(i + BLOCK, data.length))).digest("hex"));
  }
  return {
    algorithm: "SHA256",
    hash: createHash("sha256").update(data).digest("hex"),
    blockSize: BLOCK,
    blocks,
  };
}

function fileStamp(file: string): { size: number; mtimeMs: number; ino: number; dev: number } {
  const st = fs.statSync(file);
  return { size: st.size, mtimeMs: st.mtimeMs, ino: st.ino, dev: st.dev };
}

function sameStamp(a: ReturnType<typeof fileStamp>, b: ReturnType<typeof fileStamp>): boolean {
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino && a.dev === b.dev;
}

function copyRange(src: number, dst: number, start: number, length: number, buf: Buffer): void {
  let done = 0;
  while (done < length) {
    const want = Math.min(buf.length, length - done);
    const n = fs.readSync(src, buf, 0, want, start + done);
    if (n <= 0) throw new Error(`unexpected end of source asar at byte ${start + done}`);
    let written = 0;
    while (written < n) written += fs.writeSync(dst, buf, written, n - written);
    done += n;
  }
}

/**
 * Rebuild `src` into `dst` with the main entry patched (install) or stripped
 * (remove). Streams unchanged files; never holds more than one chunk plus the
 * header/entry in memory. The caller swaps `dst` over `src` atomically.
 */
export function buildPatchedAsar(
  srcPath: string,
  dstPath: string,
  mode: "install" | "remove",
  loaderPath: string
): PatchStats {
  const before = fileStamp(srcPath);
  const src = fs.openSync(srcPath, "r");
  let dst: number | undefined;
  try {
    const layout = readAsarLayout(src);
    const oldEntry = readInlineFile(src, layout, layout.entryNode);
    const stripped = stripOverlayLine(oldEntry);
    const newEntry = Buffer.from(
      mode === "install" ? stripped + overlayInjectionLine(loaderPath) : stripped,
      "utf8"
    );

    const header = JSON.parse(JSON.stringify(layout.header)) as AsarHeader;
    const entryNode = nodeAt(header, layout.entryPath);
    if (!entryNode) throw new Error(`main entry ${layout.entryPath} vanished from the cloned header`);
    entryNode.size = newEntry.length;
    entryNode.integrity = integrityFor(newEntry);

    // Order inline files by their current data offset, then lay them out
    // contiguously. Unpacked files and symlinks carry no inline bytes.
    const files = flatten(header)
      .filter((f) => !f.node.unpacked && !f.node.link)
      .sort((a, b) => Number(a.node.offset ?? 0) - Number(b.node.offset ?? 0));
    if (files.length === 0) throw new Error("app.asar has no inline files");

    let offset = 0;
    const plan: Array<{ path: string; node: AsarNode; srcOffset: number; size: number; replaced?: Buffer }> = [];
    for (const file of files) {
      const isEntry = file.path === `/${layout.entryPath}`;
      const size = isEntry ? newEntry.length : Number(file.node.size);
      const srcOffset = Number(file.node.offset ?? 0);
      if (!Number.isFinite(size) || size < 0 || !Number.isFinite(srcOffset) || srcOffset < 0) {
        throw new Error(`invalid asar file entry: ${file.path}`);
      }
      file.node.offset = String(offset);
      plan.push({ path: file.path, node: file.node, srcOffset, size, replaced: isEntry ? newEntry : undefined });
      offset += size;
    }

    const headerJson = Buffer.from(JSON.stringify(header), "utf8");
    const stringSize = Math.ceil((headerJson.length + 4) / ALIGN) * ALIGN;
    const headerSize = stringSize + 4;
    const dataStart = 8 + headerSize;
    const totalBytes = dataStart + offset;

    fs.rmSync(dstPath, { force: true });
    dst = fs.openSync(dstPath, "w");
    const prefix = Buffer.alloc(16);
    prefix.writeUInt32LE(4, 0);
    prefix.writeUInt32LE(headerSize, 4);
    prefix.writeUInt32LE(stringSize, 8);
    prefix.writeUInt32LE(headerJson.length, 12);
    writeAll(dst, prefix);
    writeAll(dst, headerJson);
    const padding = stringSize - headerJson.length - 4;
    if (padding > 0) writeAll(dst, Buffer.alloc(padding));
    if (fs.fstatSync(dst).size !== dataStart) throw new Error("internal error: asar header padding mismatch");

    const chunk = Buffer.alloc(COPY_CHUNK);
    for (const part of plan) {
      if (part.replaced) writeAll(dst, part.replaced);
      else copyRange(src, dst, layout.dataStart + part.srcOffset, part.size, chunk);
    }
    if (fs.fstatSync(dst).size !== totalBytes) {
      throw new Error(`internal error: asar length ${fs.fstatSync(dst).size} != expected ${totalBytes}`);
    }
    fs.fsyncSync(dst);
    fs.closeSync(dst);
    dst = undefined;

    const after = fileStamp(srcPath);
    if (!sameStamp(before, after)) {
      fs.rmSync(dstPath, { force: true });
      throw new Error("app.asar changed while it was being read (client update in progress?) — nothing was replaced");
    }

    // Verify structure + the injected line before the caller swaps it in.
    const check = inspectAsar(dstPath, loaderPath);
    if (!check.exists || check.error) {
      fs.rmSync(dstPath, { force: true });
      throw new Error(`patched asar failed verification: ${check.error ?? "unreadable"}`);
    }
    if (check.entryPath !== layout.entryPath) {
      fs.rmSync(dstPath, { force: true });
      throw new Error(`patched asar entry changed: ${check.entryPath} != ${layout.entryPath}`);
    }
    if (mode === "install" && !check.current) {
      fs.rmSync(dstPath, { force: true });
      throw new Error("patched asar does not carry the expected loader line — nothing was replaced");
    }
    if (mode === "remove" && check.injected) {
      fs.rmSync(dstPath, { force: true });
      throw new Error("patched asar still carries a loader line — nothing was replaced");
    }
    return {
      entryPath: layout.entryPath,
      files: plan.length,
      bytes: totalBytes,
      entryBytes: newEntry.length,
      injected: mode === "install",
      source: { size: before.size, mtimeMs: before.mtimeMs },
    };
  } finally {
    try { fs.closeSync(src); } catch { /* closed */ }
    if (dst !== undefined) {
      try { fs.closeSync(dst); } catch { /* closed */ }
      try { fs.rmSync(dstPath, { force: true }); } catch { /* best effort */ }
    }
  }
}

/* ------------------------------------------------------------- app state */

export function isAppRunning(app = target()): boolean {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("tasklist", ["/NH", "/FI", `IMAGENAME eq ${app.exeName}`], {
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true,
      });
      return out.toLowerCase().includes(app.exeName.toLowerCase());
    }
    const out = execFileSync("pgrep", ["-x", app.exeName.replace(/\.exe$/i, "")], {
      encoding: "utf8",
      timeout: 10000,
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- state file */

export interface OverlayState {
  schema: 1;
  installed: boolean;
  version: string;
  pluginRoot?: string;
  asarPath?: string;
  loaderPath?: string;
  installedAt?: string;
  updatedAt?: string;
  removedAt?: string;
  lastResult?: string;
}

export function readOverlayState(): OverlayState | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(overlayPaths().state, "utf8")) as OverlayState;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeOverlayState(patch: Partial<OverlayState> & { installed: boolean }): OverlayState {
  const paths = overlayPaths();
  fs.mkdirSync(paths.dir, { recursive: true });
  const previous = readOverlayState();
  const now = new Date().toISOString();
  const next: OverlayState = {
    schema: 1,
    version: VERSION,
    ...previous,
    ...patch,
    installedAt: previous?.installedAt ?? (patch.installed ? now : undefined),
    updatedAt: now,
  };
  const tmp = paths.state + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, paths.state);
  return next;
}

export interface PendingInfo {
  schema: 1;
  mode: "install" | "remove";
  asar: string;
  tmp: string;
  source: { size: number; mtimeMs: number };
  entryPath?: string;
  createdAt: number;
  version: string;
}

export function readPending(): PendingInfo | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(overlayPaths().pending, "utf8")) as PendingInfo;
    return parsed && typeof parsed === "object" && parsed.tmp ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writePending(info: PendingInfo): void {
  const paths = overlayPaths();
  fs.mkdirSync(paths.dir, { recursive: true });
  const tmp = paths.pending + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(info, null, 2));
  fs.renameSync(tmp, paths.pending);
}

function cancelPending(): void {
  const paths = overlayPaths();
  const pending = readPending();
  if (pending) {
    try { fs.rmSync(pending.tmp, { force: true }); } catch { /* best effort */ }
  }
  try { fs.rmSync(paths.pending, { force: true }); } catch { /* best effort */ }
}

/* --------------------------------------------------------------- runtime */

export interface RuntimeSync {
  dir: string;
  loader: string;
  cli: string;
  monitor: string;
  copied: string[];
}

function copyAtomic(src: string, dst: string): void {
  const tmp = `${dst}.tmp-${process.pid}`;
  fs.copyFileSync(src, tmp);
  try {
    fs.renameSync(tmp, dst);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw err;
  }
}

/**
 * Copy the loader, monitor and a standalone CLI bundle into the stable
 * overlay dir. The asar line points here, not into the plugin cache, so a
 * plugin update that moves cache folders does not orphan the loader.
 */
export function syncRuntime(pluginRoot = defaultPluginRoot()): RuntimeSync {
  const paths = overlayPaths();
  const sources: Array<{ src: string; dst: string; label: string }> = [
    { src: path.join(pluginRoot, "runtime", "overlay-loader.cjs"), dst: paths.loader, label: "overlay-loader.cjs" },
    { src: path.join(pluginRoot, "runtime", "overlay-monitor.cjs"), dst: paths.monitor, label: "overlay-monitor.cjs" },
    { src: path.join(pluginRoot, "dist", "cli.js"), dst: paths.cli, label: "dist/cli.js" },
  ];
  fs.mkdirSync(paths.dir, { recursive: true });
  const copied: string[] = [];
  for (const file of sources) {
    if (!fs.existsSync(file.src)) {
      throw new Error(
        `overlay runtime file missing: ${file.src} — the plugin package is incomplete (run \`npm run bundle\` before installing)`
      );
    }
    copyAtomic(file.src, file.dst);
    copied.push(file.label);
  }
  return { dir: paths.dir, loader: paths.loader, cli: paths.cli, monitor: paths.monitor, copied };
}

/* ------------------------------------------------------------ lock + swap */

function sleep(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) { /* brief spin on exotic runtimes */ }
  }
}

function withLock<T>(fn: () => T): T {
  const paths = overlayPaths();
  fs.mkdirSync(paths.dir, { recursive: true });
  let fd: number | null = null;
  const deadline = Date.now() + 2500;
  for (;;) {
    try {
      fd = fs.openSync(paths.lock, "wx");
      break;
    } catch {
      try {
        const age = Date.now() - fs.statSync(paths.lock).mtimeMs;
        if (age > LOCK_STALE_MS) {
          fs.rmSync(paths.lock, { force: true });
          continue;
        }
      } catch { /* lock vanished */ }
      if (Date.now() > deadline) {
        throw new Error(`another overlay install is already running (lock: ${paths.lock})`);
      }
      sleep(100);
    }
  }
  try {
    fs.writeFileSync(fd, String(process.pid));
    return fn();
  } finally {
    try { fs.closeSync(fd); } catch { /* closed */ }
    try { fs.rmSync(paths.lock, { force: true }); } catch { /* best effort */ }
  }
}

function spawnMonitor(): boolean {
  const paths = overlayPaths();
  if (!fs.existsSync(paths.monitor)) return false;
  try {
    const nodeExe = process.env.ZCODE_BEAUTIFY_NODE?.trim() || process.execPath;
    const child = spawn(nodeExe, [paths.monitor], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      cwd: paths.dir,
      env: { ...process.env },
    });
    child.on("error", () => { /* logged by the command output */ });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

interface ApplyResult {
  applied: boolean;
  pending?: PendingInfo;
  error?: string;
}

function applyBuiltAsar(
  asar: string,
  tmp: string,
  mode: "install" | "remove",
  entryPath: string,
  source: { size: number; mtimeMs: number }
): ApplyResult {
  try {
    fs.renameSync(tmp, asar);
    return { applied: true };
  } catch (err) {
    const message = (err as Error).message;
    if (!isAppRunning()) return { applied: false, error: message };
    const pending: PendingInfo = {
      schema: 1,
      mode,
      asar,
      tmp,
      source,
      entryPath,
      createdAt: Date.now(),
      version: VERSION,
    };
    writePending(pending);
    const monitor = spawnMonitor();
    return { applied: false, pending, error: monitor ? undefined : "could not start the background swap monitor; after quitting the client run `overlay finalize`" };
  }
}

/* ---------------------------------------------------------------- install */

export interface InstallOptions {
  asarPath?: string;
  pluginRoot?: string;
  dryRun?: boolean;
  /** Auto-heal path: do not touch the experimental gate; quieter result. */
  auto?: boolean;
}

export interface InstallResult {
  ok: boolean;
  asar: string;
  entryPath?: string;
  runtimeDir?: string;
  alreadyInjected: boolean;
  applied: boolean;
  pending: boolean;
  injected: boolean;
  error?: string;
  warning?: string;
  stats?: PatchStats;
}

export function installOverlay(options: InstallOptions = {}): InstallResult {
  const paths = overlayPaths();
  if (target().id !== "zcode") {
    return {
      ok: false, asar: options.asarPath ?? "", alreadyInjected: false, applied: false, pending: false, injected: false,
      error: "the startup overlay is currently implemented for ZCode only (WorkBuddy uses the CDP launch path)",
    };
  }
  if (options.dryRun) {
    let asar: string;
    try {
      asar = options.asarPath ? path.resolve(options.asarPath) : findAppAsar();
    } catch (err) {
      return { ok: false, asar: options.asarPath ?? "", alreadyInjected: false, applied: false, pending: false, injected: false, error: (err as Error).message };
    }
    const inspection = inspectAsar(asar, paths.loader);
    if (!inspection.exists || inspection.error) {
      return {
        ok: false, asar, alreadyInjected: false, applied: false, pending: false, injected: false,
        error: `cannot read ${asar}: ${inspection.error ?? "file missing"}`,
      };
    }
    return {
      ok: true, asar, entryPath: inspection.entryPath, alreadyInjected: inspection.current,
      applied: false, pending: false, injected: inspection.injected,
    };
  }
  fs.mkdirSync(paths.dir, { recursive: true });
  return withLock(() => {
    let asar: string;
    try {
      asar = options.asarPath ? path.resolve(options.asarPath) : findAppAsar();
    } catch (err) {
      return { ok: false, asar: options.asarPath ?? "", alreadyInjected: false, applied: false, pending: false, injected: false, error: (err as Error).message };
    }
    const inspection = inspectAsar(asar, paths.loader);
    if (!inspection.exists || inspection.error) {
      return {
        ok: false, asar, alreadyInjected: false, applied: false, pending: false, injected: false,
        error: `cannot read ${asar}: ${inspection.error ?? "file missing"}`,
      };
    }
    const runtime = syncRuntime(options.pluginRoot);
    try { fs.rmSync(paths.optOut, { force: true }); } catch { /* best effort */ }

    if (inspection.current) {
      writeOverlayState({
        installed: true,
        asarPath: asar,
        pluginRoot: options.pluginRoot ?? readOverlayState()?.pluginRoot,
        loaderPath: paths.loader,
        lastResult: "already-injected",
      });
      return {
        ok: true, asar, entryPath: inspection.entryPath, runtimeDir: runtime.dir,
        alreadyInjected: true, applied: false, pending: false, injected: true,
      };
    }

    // A stale pending package from an older asar (or an old install path) must
    // not be left behind waiting to overwrite the client.
    cancelPending();
    const tmp = asar + TMP_SUFFIX;
    let stats: PatchStats;
    try {
      stats = buildPatchedAsar(asar, tmp, "install", paths.loader);
    } catch (err) {
      return {
        ok: false, asar, entryPath: inspection.entryPath, runtimeDir: runtime?.dir,
        alreadyInjected: false, applied: false, pending: false, injected: false, error: (err as Error).message,
      };
    }
    const swap = applyBuiltAsar(asar, tmp, "install", stats.entryPath, stats.source);
    if (!swap.applied && !swap.pending) {
      return {
        ok: false, asar, entryPath: stats.entryPath, runtimeDir: runtime?.dir,
        alreadyInjected: false, applied: false, pending: false, injected: false,
        error: `cannot replace app.asar: ${swap.error ?? "unknown error"}`,
        stats,
      };
    }
    writeOverlayState({
      installed: true,
      asarPath: asar,
      pluginRoot: options.pluginRoot ?? readOverlayState()?.pluginRoot,
      loaderPath: paths.loader,
      lastResult: swap.applied ? "applied" : "pending",
    });
    return {
      ok: true, asar, entryPath: stats.entryPath, runtimeDir: runtime.dir,
      alreadyInjected: false, applied: swap.applied, pending: Boolean(swap.pending),
      injected: swap.applied, stats,
      warning: swap.pending && swap.error ? swap.error : undefined,
    };
  });
}

/* ----------------------------------------------------------------- remove */

export interface RemoveOptions {
  asarPath?: string;
  /** Keep the experimental gate as-is (default false: caller disables it). */
  keepExperimental?: boolean;
  dryRun?: boolean;
}

export interface RemoveResult {
  ok: boolean;
  asar: string;
  entryPath?: string;
  injected: boolean;
  applied: boolean;
  pending: boolean;
  alreadyClean: boolean;
  optOut: boolean;
  error?: string;
  warning?: string;
}

export function removeOverlay(options: RemoveOptions = {}): RemoveResult {
  const paths = overlayPaths();
  if (options.dryRun) {
    let asar: string;
    try {
      asar = options.asarPath ? path.resolve(options.asarPath) : findAppAsar();
    } catch (err) {
      return { ok: false, asar: options.asarPath ?? "", injected: false, applied: false, pending: false, alreadyClean: true, optOut: fs.existsSync(paths.optOut), error: (err as Error).message };
    }
    const inspection = inspectAsar(asar, paths.loader);
    return {
      ok: true, asar, entryPath: inspection.entryPath, injected: inspection.injected,
      applied: false, pending: false, alreadyClean: !inspection.injected,
      optOut: fs.existsSync(paths.optOut), error: inspection.error,
    };
  }
  fs.mkdirSync(paths.dir, { recursive: true });
  // The opt-out marker goes first: even if the asar cannot be repaired right
  // now, the loader must stop on the next start and auto-heal must not fight
  // the uninstall.
  fs.writeFileSync(paths.optOut, `zcode-beautify overlay uninstalled ${new Date().toISOString()}\n`);
  return withLock(() => {
    let asar: string;
    try {
      asar = options.asarPath ? path.resolve(options.asarPath) : findAppAsar();
    } catch (err) {
      return { ok: false, asar: options.asarPath ?? "", injected: false, applied: false, pending: false, alreadyClean: true, optOut: true, error: (err as Error).message };
    }
    cancelPending();
    const inspection = inspectAsar(asar, paths.loader);
    if (!inspection.exists || inspection.error) {
      writeOverlayState({ installed: false, asarPath: asar, removedAt: new Date().toISOString(), lastResult: "asar-unreadable" });
      return {
        ok: true, asar, injected: false, applied: false, pending: false, alreadyClean: true, optOut: true,
        error: inspection.error,
      };
    }
    if (!inspection.injected) {
      writeOverlayState({ installed: false, asarPath: asar, removedAt: new Date().toISOString(), lastResult: "already-clean" });
      return { ok: true, asar, entryPath: inspection.entryPath, injected: false, applied: false, pending: false, alreadyClean: true, optOut: true };
    }
    const tmp = asar + TMP_SUFFIX;
    let stats: PatchStats;
    try {
      stats = buildPatchedAsar(asar, tmp, "remove", paths.loader);
    } catch (err) {
      return {
        ok: false, asar, entryPath: inspection.entryPath, injected: true, applied: false, pending: false,
        alreadyClean: false, optOut: true, error: (err as Error).message,
      };
    }
    const swap = applyBuiltAsar(asar, tmp, "remove", stats.entryPath, stats.source);
    if (!swap.applied && !swap.pending) {
      writeOverlayState({ installed: true, asarPath: asar, lastResult: "remove-failed" });
      return {
        ok: false, asar, entryPath: stats.entryPath, injected: true, applied: false, pending: false,
        alreadyClean: false, optOut: true, error: `cannot replace app.asar: ${swap.error ?? "unknown error"}`,
      };
    }
    writeOverlayState({
      installed: Boolean(swap.pending),
      asarPath: asar,
      removedAt: swap.applied ? new Date().toISOString() : undefined,
      lastResult: swap.applied ? "removed" : "remove-pending",
    });
    return {
      ok: true, asar, entryPath: stats.entryPath, injected: !swap.applied,
      applied: swap.applied, pending: Boolean(swap.pending), alreadyClean: false, optOut: true,
      warning: swap.pending && swap.error ? swap.error : undefined,
    };
  });
}

/* ---------------------------------------------------------------- finalize */

export interface FinalizeResult {
  ok: boolean;
  applied: boolean;
  pending?: PendingInfo;
  error?: string;
}

/** Apply a pending swap by hand (the detached monitor normally does this). */
export function finalizePending(): FinalizeResult {
  const pending = readPending();
  if (!pending) return { ok: true, applied: false };
  const paths = overlayPaths();
  return withLock(() => {
    const current = readPending();
    if (!current) return { ok: true, applied: false };
    if (!fs.existsSync(current.tmp)) {
      fs.rmSync(paths.pending, { force: true });
      return { ok: false, applied: false, error: "pending package is missing" };
    }
    if (isAppRunning()) return { ok: true, applied: false, pending: current };
    try {
      const st = fs.statSync(current.asar);
      if (st.size !== current.source.size || Math.abs(st.mtimeMs - current.source.mtimeMs) > 1) {
        fs.rmSync(current.tmp, { force: true });
        fs.rmSync(paths.pending, { force: true });
        return { ok: false, applied: false, error: "app.asar changed after the package was staged; discarded the stale pending package" };
      }
      fs.renameSync(current.tmp, current.asar);
      fs.rmSync(paths.pending, { force: true });
      writeOverlayState({
        installed: current.mode === "install",
        asarPath: current.asar,
        lastResult: current.mode === "install" ? "applied" : "removed",
        removedAt: current.mode === "remove" ? new Date().toISOString() : undefined,
      });
      return { ok: true, applied: true };
    } catch (err) {
      return { ok: false, applied: false, pending: current, error: (err as Error).message };
    }
  });
}

/* ----------------------------------------------------------------- status */

export interface OverlayStatus {
  app: string;
  version: string;
  asar: string;
  asarExists: boolean;
  entryPath?: string;
  injected: boolean;
  current: boolean;
  loaderUrls: string[];
  optOut: boolean;
  experimentalEnabled: boolean;
  runtimeDir: string;
  runtimeFiles: { loader: boolean; cli: boolean; monitor: boolean };
  state?: OverlayState;
  pending?: PendingInfo;
  error?: string;
}

export function overlayStatus(options: { asarPath?: string } = {}): OverlayStatus {
  const paths = overlayPaths();
  let asar = "";
  let inspection: AsarInspection | undefined;
  let asarError: string | undefined;
  try {
    asar = options.asarPath ? path.resolve(options.asarPath) : findAppAsar();
    inspection = inspectAsar(asar, paths.loader);
    asarError = inspection.error;
  } catch (err) {
    asarError = (err as Error).message;
  }
  return {
    app: target().appName,
    version: VERSION,
    asar,
    asarExists: Boolean(inspection?.exists),
    entryPath: inspection?.entryPath,
    injected: Boolean(inspection?.injected),
    current: Boolean(inspection?.current),
    loaderUrls: inspection?.loaderUrls ?? [],
    optOut: fs.existsSync(paths.optOut),
    experimentalEnabled: experimentalEnabled(loadConfig()),
    runtimeDir: paths.dir,
    runtimeFiles: {
      loader: fs.existsSync(paths.loader),
      cli: fs.existsSync(paths.cli),
      monitor: fs.existsSync(paths.monitor),
    },
    state: readOverlayState(),
    pending: readPending(),
    error: asarError,
  };
}

/* --------------------------------------------------------------- auto-heal */

/**
 * After a client update replaces app.asar, the overlay line is gone. If the
 * user installed the overlay before (state.installed) and never opted out,
 * stage a fresh patch from the MCP bootstrap. The heavy 380 MB rebuild runs
 * in a detached CLI process so it never blocks or dies with the session.
 *
 * Throttled by (plugin version, asar size, asar mtime) for 10 minutes so
 * several sessions starting together do not race.
 */
export function autoHealOverlay(): void {
  try {
    const state = readOverlayState();
    if (!state?.installed) return;
    const paths = overlayPaths();
    if (fs.existsSync(paths.optOut)) return;
    if (!experimentalEnabled(loadConfig())) return;
    const pending = readPending();
    if (pending) return;
    const asar = state.asarPath && fs.existsSync(state.asarPath) ? state.asarPath : findAppAsar();
    const inspection = inspectAsar(asar, paths.loader);
    if (!inspection.exists || inspection.error || inspection.current) return;
    const st = fs.statSync(asar);
    const key = `${VERSION} ${st.size} ${Math.round(st.mtimeMs)}`;
    try {
      const previous = fs.readFileSync(paths.autoHealStamp, "utf8").trim();
      const age = Date.now() - fs.statSync(paths.autoHealStamp).mtimeMs;
      if (previous === key && age < 10 * 60_000) return;
    } catch { /* no stamp yet */ }
    fs.mkdirSync(paths.dir, { recursive: true });
    fs.writeFileSync(paths.autoHealStamp, key);
    const root = defaultPluginRoot();
    const cli = path.join(root, "dist", "cli.js");
    if (!fs.existsSync(cli)) return;
    const child = spawn(process.execPath, [cli, "overlay", "install", "--auto", "--no-enable", "--quiet"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env },
    });
    child.on("error", () => { /* best effort */ });
    child.unref();
  } catch {
    /* auto-heal must never break the MCP bootstrap */
  }
}

/** Pending packages older than their deadline are discarded by the monitor. */
export const PENDING_DEADLINE_MS = PENDING_MAX_AGE_MS;
