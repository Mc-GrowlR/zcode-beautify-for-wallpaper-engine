// Registers (or repairs) the zcode-beautify entry in ZCode's plugin registry.
//
// Why this exists: Route B of INSTALL-FOR-AI.md ends by writing
// `~/.zcode/cli/plugins/installed_plugins.json`. A Windows path spliced through
// a JS string literal loses its separators — "C:\Users\...\0.4.6" becomes
// "C:Users...<NUL>.4.6" — and that single NUL byte makes ZCode build
// "<installPath>.transaction.json" and throw ERR_INVALID_ARG_VALUE from every
// plugin RPC: the plugin list shows "no plugins installed" and new chats report
// "初始化失败，暂时无法发送". The file is still valid JSON, so nothing warns you.
//
// This script is the only supported way to write that record: it derives the
// identity from the repo manifests, merges into the existing registry, validates
// installPath, backs the old file up and writes atomically.
//
// Usage:
//   node scripts/record-install.mjs                 # merge + validate + write
//   node scripts/record-install.mjs --dry-run       # validate + print, write nothing
//   node scripts/record-install.mjs --verify        # only check the registry as-is
//   node scripts/record-install.mjs --plugins-root <dir>   # default ~/.zcode/cli/plugins
//
// Exit codes: 0 ok, 1 fatal problem (corrupted or relative path, unreadable registry).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);

const USAGE = `usage: node scripts/record-install.mjs [--dry-run | --verify] [--plugins-root <dir>]

  (no flags)            merge this repo's record into the registry, validate, write
  --dry-run             print the record that would be written; touches nothing
  --verify              validate the registry as it is; exits 1 on fatal problems
  --plugins-root <dir>  registry location (default ~/.zcode/cli/plugins)
  -h, --help            show this text

Unknown flags are rejected on purpose: a typo must never fall through to write mode.`;

const fail = (message) => {
  console.error(`error: ${message}`);
  process.exit(1);
};

let dryRun = false;
let verifyOnly = false;
let pluginsRootArg = path.join(os.homedir(), ".zcode", "cli", "plugins");

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--dry-run") dryRun = true;
  else if (arg === "--verify") verifyOnly = true;
  else if (arg === "--plugins-root") {
    const next = argv[++i];
    if (!next || next.startsWith("--")) fail("--plugins-root requires a directory");
    pluginsRootArg = next;
  } else if (arg === "--help" || arg === "-h") {
    console.log(USAGE);
    process.exit(0);
  } else {
    console.error(USAGE);
    fail(`unknown argument "${arg}" — nothing was written`);
  }
}
if (dryRun && verifyOnly) fail("--dry-run and --verify are mutually exclusive");

const pluginsRoot = path.resolve(pluginsRootArg);
const registryPath = path.join(pluginsRoot, "installed_plugins.json");

function readJson(file, label) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    return fail(`cannot read ${label} at ${file} (${err.code ?? err.message})`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    return fail(
      `${label} at ${file} is not valid JSON (${err.message}). ` +
        `Restore the newest ${path.basename(file)}.bak-* next to it and retry.`,
    );
  }
}

/**
 * Classify one registry record. Fatal problems poison every ZCode plugin RPC;
 * warnings only affect that one plugin.
 */
function inspect(record) {
  const fatal = [];
  const warnings = [];
  const show = (v) => (typeof v === "string" ? v.replace(/\u0000/g, "<NUL>") : String(v));

  if (!record || typeof record !== "object") return { fatal: ["record is not an object"], warnings };
  for (const key of ["id", "name", "marketplace", "version", "installPath"]) {
    if (typeof record[key] !== "string" || !record[key].trim()) {
      fatal.push(`${key} is not a non-empty string (got ${show(record[key])})`);
    }
  }
  const p = record.installPath;
  if (typeof p !== "string") return { fatal, warnings };

  if (p.includes("\u0000")) {
    fatal.push(
      `installPath contains a NUL byte: ${show(p)} — a Windows path was spliced through a JS string literal`,
    );
    return { fatal, warnings }; // further checks are meaningless on a corrupted string
  }
  if (!path.isAbsolute(p)) {
    fatal.push(`installPath is not absolute: ${p}`);
    return { fatal, warnings };
  }
  const manifest = path.join(p, ".zcode-plugin", "plugin.json");
  if (!fs.existsSync(p)) {
    warnings.push(`installPath does not exist: ${p}`);
  } else if (!fs.existsSync(manifest)) {
    warnings.push(`installPath has no .zcode-plugin/plugin.json: ${p}`);
  } else {
    try {
      const installed = JSON.parse(fs.readFileSync(manifest, "utf8"));
      if (installed.version !== record.version) {
        warnings.push(`record says ${record.version} but ${manifest} says ${installed.version}`);
      }
    } catch {
      warnings.push(`cannot parse ${manifest}`);
    }
  }
  return { fatal, warnings };
}

function readRegistry() {
  if (!fs.existsSync(registryPath)) return { version: 1, plugins: [] };
  const parsed = readJson(registryPath, "installed_plugins.json");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`${registryPath} is not a JSON object`);
  }
  if (!Array.isArray(parsed.plugins)) {
    fail(`${registryPath} has no "plugins" array (found keys: ${Object.keys(parsed).join(", ")})`);
  }
  return parsed;
}

function report(records) {
  let fatalCount = 0;
  let warningCount = 0;
  for (const record of records) {
    const { fatal, warnings } = inspect(record);
    const label = `${record?.id ?? "<no id>"} ${record?.version ?? "?"}`;
    if (fatal.length) {
      fatalCount += fatal.length;
      for (const problem of fatal) console.error(`FATAL  ${label}: ${problem}`);
    }
    if (warnings.length) {
      warningCount += warnings.length;
      for (const warning of warnings) console.warn(`warn   ${label}: ${warning}`);
    }
    if (!fatal.length && !warnings.length) console.log(`ok     ${label}`);
  }
  return { fatalCount, warningCount };
}

const registry = readRegistry();

if (verifyOnly) {
  console.log(`registry: ${registryPath} (${registry.plugins.length} record(s))`);
  const { fatalCount, warningCount } = report(registry.plugins);
  if (fatalCount) fail(`${fatalCount} fatal problem(s) — ZCode's plugin list and new chat sessions will fail`);
  console.log(warningCount ? `done with ${warningCount} warning(s)` : "done: no problems");
  process.exit(0);
}

// --- write mode ------------------------------------------------------------
const pluginManifest = readJson(path.join(repoRoot, ".zcode-plugin", "plugin.json"), ".zcode-plugin/plugin.json");
const marketplaceManifest = readJson(path.join(repoRoot, "marketplace.json"), "marketplace.json");
const marketplaceId = marketplaceManifest.name || "zcode-beautify";
const name = pluginManifest.name;
const version = pluginManifest.version;
if (typeof name !== "string" || !name || typeof version !== "string" || !version) {
  fail(".zcode-plugin/plugin.json must declare a name and a version");
}

const installPath = path.join(pluginsRoot, "cache", marketplaceId, name, version);
if (!fs.existsSync(path.join(installPath, ".zcode-plugin", "plugin.json"))) {
  fail(
    `cache folder ${installPath} is missing or incomplete — finish step 4 first ` +
      `(copy the repo, including .zcode-plugin/, to that exact folder, whose name must equal the version)`,
  );
}

const id = `${name}@${marketplaceId}`;
const now = new Date().toISOString();
const previous = registry.plugins.find((entry) => entry?.id === id);
const record = {
  id,
  name,
  marketplace: marketplaceId,
  version,
  installPath,
  installedAt: typeof previous?.installedAt === "string" ? previous.installedAt : now,
  updatedAt: now,
  scope: "user",
  source: { source: "directory", path: repoRoot },
};

const { fatal, warnings } = inspect(record);
if (fatal.length) fail(`refusing to write an invalid record:\n  - ${fatal.join("\n  - ")}`);
for (const warning of warnings) console.warn(`warn: ${warning}`);

const plugins = registry.plugins.filter((entry) => entry?.id !== id).concat(record);
registry.plugins = plugins;
const payload = `${JSON.stringify(registry, null, 2)}\n`;

console.log(`registry:    ${registryPath}`);
console.log(`record:      ${id} ${version}`);
console.log(`installPath: ${installPath}`);
console.log(`action:      ${previous ? "update existing record" : "append new record"} (${plugins.length} total)`);

if (dryRun) {
  console.log("\n--dry-run: nothing written. Record that would be saved:\n");
  console.log(JSON.stringify(record, null, 2));
  process.exit(0);
}

const tmp = `${registryPath}.tmp-${process.pid}`;
try {
  if (fs.existsSync(registryPath)) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const backup = `${registryPath}.bak-${stamp}`;
    fs.copyFileSync(registryPath, backup);
    console.log(`backup:      ${backup}`);
  }
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(tmp, payload, "utf8");
  fs.renameSync(tmp, registryPath);
} catch (err) {
  try {
    fs.rmSync(tmp, { force: true });
  } catch {
    /* best-effort cleanup */
  }
  fail(
    `cannot write ${registryPath}: ${err.code ?? err.message}. ` +
      `Fully quit ZCode first (it may hold the file) and re-run; the existing registry was left untouched.`,
  );
}

// Read back through a real JSON parser: the whole point is to catch a path that
// only looked fine while it lived in this process.
const written = readJson(registryPath, "installed_plugins.json");
const saved = written.plugins.find((entry) => entry?.id === id);
const check = inspect(saved);
if (check.fatal.length) fail(`write verification failed:\n  - ${check.fatal.join("\n  - ")}`);

console.log(`written:     ${written.plugins.length} record(s), installPath verified`);
console.log("next:        fully quit ZCode (tray included) and start it again");
