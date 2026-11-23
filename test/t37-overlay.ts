/**
 * T37 startup overlay: asar patch/strip correctness, stable runtime sync,
 * command docs, and the full install/remove state machine against a synthetic
 * asar. The real ZCode app.asar is never read or written — ZCODE_BEAUTIFY_ASAR
 * and ZCODE_BEAUTIFY_OVERLAY_DIR point at a temp folder.
 *
 * Run: npx tsx test/t37-overlay.ts   (also part of: npm test)
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPatchedAsar,
  defaultPluginRoot,
  inspectAsar,
  autoHealOverlay,
  installOverlay,
  overlayInjectionLine,
  overlayStatus,
  readAsarFile,
  readAsarLayout,
  removeOverlay,
  stripOverlayLine,
  syncRuntime,
} from "../src/core/overlay.js";
import { saveConfig } from "../src/core/launch.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "zb-t37-"));
const overlayDir = path.join(sandbox, "overlay");
const asarPath = path.join(sandbox, "app.asar");
process.env.ZCODE_BEAUTIFY_OVERLAY_DIR = overlayDir;
process.env.ZCODE_BEAUTIFY_DATA_DIR = path.join(sandbox, "data");
process.env.ZCODE_BEAUTIFY_ASAR = asarPath;
process.env.ZCODE_BEAUTIFY_PLUGIN_ROOT = root;
delete process.env.BEAUTIFY_TARGET;

function integrity(data: Buffer) {
  const blockSize = 4 * 1024 * 1024;
  const blocks: string[] = [];
  for (let i = 0; i < data.length; i += blockSize) {
    blocks.push(createHash("sha256").update(data.subarray(i, i + blockSize)).digest("hex"));
  }
  return { algorithm: "SHA256", hash: createHash("sha256").update(data).digest("hex"), blockSize, blocks };
}

/** Minimal Electron asar writer for fixtures (same header layout we parse). */
function makeAsar(file: string, files: Record<string, string | Buffer>, main = "out/main/index.js"): void {
  const header: any = { files: {} };
  const put = (p: string, node: any) => {
    const segs = p.split("/");
    let cur = header;
    for (let i = 0; i < segs.length - 1; i++) {
      cur.files[segs[i]] ??= { files: {} };
      cur = cur.files[segs[i]];
    }
    cur.files[segs[segs.length - 1]] = node;
  };
  const payloads: Buffer[] = [];
  let offset = 0;
  const all: Record<string, Buffer> = {
    "package.json": Buffer.from(JSON.stringify({ name: "fixture", type: "module", main })),
  };
  for (const [k, v] of Object.entries(files)) all[k] = Buffer.isBuffer(v) ? v : Buffer.from(v);
  for (const [p, data] of Object.entries(all)) {
    put(p, { size: data.length, offset: String(offset), integrity: integrity(data) });
    payloads.push(data);
    offset += data.length;
  }
  const json = Buffer.from(JSON.stringify(header));
  const stringSize = Math.ceil((json.length + 4) / 4) * 4;
  const headerSize = stringSize + 4;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(headerSize, 4);
  prefix.writeUInt32LE(stringSize, 8);
  prefix.writeUInt32LE(json.length, 12);
  const pad = Buffer.alloc(stringSize - json.length - 4);
  fs.writeFileSync(file, Buffer.concat([prefix, json, pad, ...payloads]));
}

const entrySource = `import { app } from "electron";\napp.whenReady().then(() => console.log("fixture"));\n`;
const other = Buffer.from("other file payload \u0000 binary-ish bytes", "utf8");
makeAsar(asarPath, {
  "out/main/index.js": entrySource,
  "other.bin": other,
});
const loaderA = path.join(sandbox, "runtime-a", "overlay-loader.cjs");
const loaderB = path.join(sandbox, "runtime-b", "overlay-loader.cjs");

// --- A: asar parse + patch ------------------------------------------------
{
  const clean = inspectAsar(asarPath);
  check("A1 clean asar is readable", clean.exists && !clean.error, clean.error);
  check("A2 clean asar entry detected", clean.entryPath === "out/main/index.js");
  check("A3 clean asar is not injected", clean.injected === false);

  const patched = path.join(sandbox, "patched.asar");
  const stats = buildPatchedAsar(asarPath, patched, "install", loaderA);
  check("A4 patch stats: entry replaced", stats.entryPath === "out/main/index.js" && stats.injected);
  const checkInjected = inspectAsar(patched, loaderA);
  check("A5 patched asar reports current injection", checkInjected.injected && checkInjected.current);
  const entry = readAsarFile(patched, "out/main/index.js").toString("utf8");
  check("A6 entry starts with the original code", entry.startsWith(entrySource.trimEnd().slice(0, 20)));
  check("A7 loader line appended once", (entry.match(/overlay-loader\.cjs/g) ?? []).length === 1);
  check("A8 other file bytes preserved", readAsarFile(patched, "other.bin").equals(other));
  check("A9 package.json preserved", JSON.parse(readAsarFile(patched, "package.json").toString("utf8")).main === "out/main/index.js");
  const fd = fs.openSync(patched, "r");
  try {
    const layout = readAsarLayout(fd);
    const node = layout.header.files.out.files.main.files["index.js"];
    const integ = node.integrity as any;
    check("A10 entry integrity recomputed", integ && integ.hash === createHash("sha256").update(Buffer.from(entry)).digest("hex"));
    check("A11 file count preserved", Object.keys(layout.header.files).length === 3);
  } finally {
    fs.closeSync(fd);
  }

  // Re-install over an already patched asar with a different loader path:
  // strip the old line, append the new one, still exactly one line.
  const repatched = path.join(sandbox, "repatched.asar");
  buildPatchedAsar(patched, repatched, "install", loaderB);
  const reEntry = readAsarFile(repatched, "out/main/index.js").toString("utf8");
  check("A12 old loader line replaced (not duplicated)", (reEntry.match(/overlay-loader\.cjs/g) ?? []).length === 1);
  check("A13 new loader path wins", reEntry.includes("runtime-b")); // URL-encoded path may be runtime-b
  const reInspect = inspectAsar(repatched, loaderB);
  check("A14 re-patched reports current", reInspect.current === true, reInspect.loaderUrls.join(","));

  const stripped = path.join(sandbox, "stripped.asar");
  buildPatchedAsar(repatched, stripped, "remove", loaderB);
  const strippedEntry = readAsarFile(stripped, "out/main/index.js").toString("utf8");
  check("A15 remove strips the loader line", stripOverlayLine(strippedEntry) === strippedEntry && !inspectAsar(stripped).injected);
  check("A16 remove preserves other bytes", readAsarFile(stripped, "other.bin").equals(other));
  check("A17 remove preserves the original entry", strippedEntry === entrySource);
}

// --- B: corruption / line matching ---------------------------------------
{
  const broken = path.join(sandbox, "broken.asar");
  fs.writeFileSync(broken, "not an asar at all");
  const bad = inspectAsar(broken);
  check("B1 non-asar is rejected without throwing", bad.exists && bad.injected === false && Boolean(bad.error));
  check("B2 injection line builder is absolute file URL", overlayInjectionLine(loaderA).includes("file:///"));
  const oldLine = `\n;import("file:///C:/old/place/overlay-loader.cjs").then(() => null, (e) => console.error("[zcode-beautify] overlay load failed", e));`;
  check("B3 strip matches an old install path", !stripOverlayLine(`x${oldLine};`).includes("overlay-loader.cjs"));
}

// --- C: stable runtime sync ----------------------------------------------
{
  const paths = syncRuntime(root);
  check("C1 runtime dir created", fs.existsSync(paths.dir));
  check("C2 loader copied", fs.existsSync(paths.loader) && fs.readFileSync(paths.loader, "utf8").includes("remote-debugging-port"));
  check("C3 monitor copied", fs.existsSync(paths.monitor) && fs.readFileSync(paths.monitor, "utf8").includes("renameSync"));
  check("C4 standalone CLI copied", fs.existsSync(paths.cli) && fs.statSync(paths.cli).size > 1_000_000);
  check("C5 plugin root autodetected", defaultPluginRoot() === root, defaultPluginRoot());
  const loader = fs.readFileSync(paths.loader, "utf8");
  check("C6 loader honours the opt-out marker", loader.includes(".plugin-overlay-optout"));
  check("C7 loader honours the plugin-manager gate", loader.includes("enabledPlugins"));
  check("C8 loader falls back to Electron-as-Node", loader.includes("ELECTRON_RUN_AS_NODE"));
}

// --- D: install/remove state machine on the fixture -----------------------
{
  const install = installOverlay({ asarPath, pluginRoot: root });
  check("D1 install applies to an unlocked fixture asar", install.ok && install.applied && install.injected, install.error);
  check("D2 installed asar carries the loader", inspectAsar(asarPath, path.join(overlayDir, "overlay-loader.cjs")).current);
  const statePath = path.join(overlayDir, "overlay.json");
  check("D3 state file records installed", JSON.parse(fs.readFileSync(statePath, "utf8")).installed === true);
  const status = overlayStatus({ asarPath });
  check("D4 status reports installed/current", status.injected && status.current && !status.optOut);
  check("D4b status honours an explicit --asar path", path.resolve(status.asar) === path.resolve(asarPath));
  check("D5 status reports runtime files present", status.runtimeFiles.loader && status.runtimeFiles.cli && status.runtimeFiles.monitor);

  const again = installOverlay({ asarPath, pluginRoot: root });
  check("D6 install is idempotent", again.ok && again.alreadyInjected && !again.applied, again.error);

  fs.rmSync(path.join(overlayDir, ".plugin-overlay-optout"), { force: true });
  const dry = removeOverlay({ asarPath, dryRun: true });
  check("D7 dry-run remove reports injected but writes no marker", dry.injected && !fs.existsSync(path.join(overlayDir, ".plugin-overlay-optout")));
  check("D8 dry-run did not strip the line", inspectAsar(asarPath).injected);

  const removed = removeOverlay({ asarPath });
  check("D9 remove applies and strips the line", removed.ok && removed.applied && !removed.injected, removed.error);
  check("D10 remove writes the opt-out marker", fs.existsSync(path.join(overlayDir, ".plugin-overlay-optout")));
  check("D11 state records not installed", JSON.parse(fs.readFileSync(statePath, "utf8")).installed === false);
  const clean = overlayStatus();
  check("D12 status reports not installed + opt-out", !clean.injected && clean.optOut);

  const beforeFiles = fs.readdirSync(overlayDir).sort().join("|");
  const dryInstall = installOverlay({ asarPath, pluginRoot: root, dryRun: true });
  const afterFiles = fs.readdirSync(overlayDir).sort().join("|");
  check("D12b dry-run install writes nothing and keeps opt-out", dryInstall.ok && beforeFiles === afterFiles && fs.existsSync(path.join(overlayDir, ".plugin-overlay-optout")));

  const reinstalled = installOverlay({ asarPath, pluginRoot: root });
  check("D13 explicit install clears the opt-out marker", reinstalled.ok && !fs.existsSync(path.join(overlayDir, ".plugin-overlay-optout")));
}

// --- D2: client update + auto-heal + rollback -----------------------------
{
  // Simulate a client update replacing app.asar with a clean build: the loader
  // line is gone while the overlay state still says "installed".
  saveConfig({ experimental: { enabled: true, consentedAt: new Date().toISOString(), consentVersion: "test" } } as any);
  fs.rmSync(path.join(overlayDir, "autoheal.stamp"), { force: true });
  makeAsar(asarPath, {
    "out/main/index.js": entrySource,
    "other.bin": other,
  });
  check("D2-1 update replaced the asar (not injected)", !inspectAsar(asarPath).injected);
  check("D2-2 overlay state still records the prior install", JSON.parse(fs.readFileSync(path.join(overlayDir, "overlay.json"), "utf8")).installed === true);

  autoHealOverlay();
  let healed = false;
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (inspectAsar(asarPath, path.join(overlayDir, "overlay-loader.cjs")).current) { healed = true; break; }
  }
  check("D2-3 auto-heal re-applies the loader after an update", healed);
  check("D2-4 healed asar carries exactly one loader line",
    (readAsarFile(asarPath, "out/main/index.js").toString("utf8").match(/overlay-loader\.cjs/g) ?? []).length === 1);

  // Rollback: remove, then simulate another update. The opt-out marker must
  // stop auto-heal from resurrecting the overlay.
  const rolledBack = removeOverlay({ asarPath });
  check("D2-5 rollback strips the loader", rolledBack.ok && !readAsarFile(asarPath, "out/main/index.js").toString("utf8").includes("overlay-loader.cjs"));
  makeAsar(asarPath, { "out/main/index.js": entrySource, "other.bin": other });
  fs.rmSync(path.join(overlayDir, "autoheal.stamp"), { force: true });
  autoHealOverlay();
  await new Promise((r) => setTimeout(r, 1500));
  check("D2-6 opt-out keeps auto-heal from re-patching", !inspectAsar(asarPath).injected);
}

// --- E: command/docs wiring ----------------------------------------------
{
  for (const [file, needle] of [
    ["commands/install-overlay.md", "overlay install"],
    ["commands/uninstall-overlay.md", "overlay remove"],
  ] as const) {
    const full = path.join(root, file);
    check(`E1 ${file} exists`, fs.existsSync(full));
    const text = fs.readFileSync(full, "utf8");
    check(`E2 ${file} tells the agent the exact CLI`, text.includes(needle) && text.includes("dist/cli.js"));
    check(`E3 ${file} has frontmatter description`, /^---[\s\S]*description:[\s\S]*---/.test(text));
  }
  const mcp = fs.readFileSync(path.join(root, "src", "mcp", "server.ts"), "utf8");
  check("E4 status passes an explicit --asar override through the CLI",
    fs.readFileSync(path.join(root, "src/cli.ts"), "utf8").includes("overlayStatus({ asarPath: flag(\"--asar\") })"));
  check("E4b MCP bootstrap calls autoHealOverlay", mcp.includes("autoHealOverlay()"));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  check("E5 runtime/ ships with the package", Array.isArray(pkg.files) && pkg.files.includes("runtime"));
}

// --- F: real loader against a stubbed Electron main process --------------
{
  const dataDir = path.join(sandbox, "loader-data");
  const dir = path.join(dataDir, "overlay");
  fs.mkdirSync(dir, { recursive: true });
  const loader = path.join(dir, "overlay-loader.cjs");
  fs.copyFileSync(path.join(root, "runtime", "overlay-loader.cjs"), loader);
  const spawnLog = path.join(dir, "spawned.log");
  fs.writeFileSync(
    path.join(dir, "beautify-cli.mjs"),
    `import fs from "node:fs"; fs.appendFileSync(${JSON.stringify(spawnLog)}, process.argv.slice(2).join(" ") + "\\n");\n`
  );
  fs.writeFileSync(path.join(dataDir, "config.json"), JSON.stringify({ port: 59422, apiPort: 59423, experimental: { enabled: true } }));
  const hostConfig = path.join(sandbox, "host-config.json");
  fs.writeFileSync(hostConfig, JSON.stringify({ plugins: { enabledPlugins: { "zcode-beautify@zcode-beautify": true } } }));
  const switchLog = path.join(dir, "switch.log");
  const childScript = `
    const Module = require("module");
    const original = Module._load;
    Module._load = function (request) {
      if (request === "electron") {
        return { app: { commandLine: {
          hasSwitch: () => false,
          appendSwitch: (key, value) => require("fs").appendFileSync(${JSON.stringify(switchLog)}, key + "=" + (value === undefined ? "1" : value) + "\\n"),
        }, once: () => {} } };
      }
      return original.apply(this, arguments);
    };
    require(${JSON.stringify(loader)});
    setTimeout(() => process.exit(0), 1200);
  `;
  const env = { ...process.env, ZCODE_BEAUTIFY_HOST_CONFIG: hostConfig };
  delete env.ZCODE_BEAUTIFY_OVERLAY_DIR;
  delete env.ZCODE_BEAUTIFY_ASAR;
  delete env.ZCODE_BEAUTIFY_PLUGIN_ROOT;
  delete env.ZCODE_BEAUTIFY_DATA_DIR;
  const run = spawnSync(process.execPath, ["-e", childScript], { encoding: "utf8", timeout: 15000, env });
  check("F1 loader child exits cleanly", run.status === 0, run.stderr?.slice(0, 200));
  const switches = fs.existsSync(switchLog) ? fs.readFileSync(switchLog, "utf8") : "";
  check("F2 loader forces the configured CDP port", switches.includes("remote-debugging-port=59422"));
  check("F3 loader keeps wallpaper timers alive", switches.includes("disable-backgrounding-occluded-windows"));
  let spawned = "";
  for (let i = 0; i < 40 && !spawned; i++) {
    if (fs.existsSync(spawnLog)) spawned = fs.readFileSync(spawnLog, "utf8");
    if (!spawned) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  check("F4 loader spawns serve with the configured ports", /serve\s+--detach\s+--port\s+59422\s+--api-port\s+59423/.test(spawned), spawned.trim());

  fs.writeFileSync(path.join(dir, ".plugin-overlay-optout"), "test\n");
  const before = fs.readFileSync(switchLog, "utf8");
  const again = spawnSync(process.execPath, ["-e", childScript], { encoding: "utf8", timeout: 15000, env });
  const after = fs.readFileSync(switchLog, "utf8");
  check("F5 opt-out marker stops the loader", again.status === 0 && after === before);
}

try {
  fs.rmSync(sandbox, { recursive: true, force: true });
} catch {
  /* Windows may still hold the copied CLI open; temp cleanup is best effort */
}

console.log(failed === 0 ? "\nall overlay checks passed" : `\n${failed} overlay check(s) failed`);
if (failed > 0) process.exit(1);
