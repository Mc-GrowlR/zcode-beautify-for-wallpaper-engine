/**
 * T36 install-record repair: reproduce the observed cache/record version drift
 * (record 0.6.0, but the same cache folder carries the current 6.3.6 manifest)
 * and verify the writer repairs it without touching other records.
 *
 * The fixture is a temporary plugin inventory; the real ~/.zcode registry and
 * cache are never read or written.
 *
 * Run: npx tsx test/t36-record-install.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const manifest = JSON.parse(fs.readFileSync(path.join(root, ".zcode-plugin", "plugin.json"), "utf8"));
const version: string = manifest.version;
const driftName = version === "0.6.0" ? "0.0.1" : "0.6.0";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zbeautify-record-install-"));
const plugins = path.join(tmp, "plugins");
const cacheRoot = path.join(plugins, "cache", "zcode-beautify", "zcode-beautify");
const oldCache = path.join(cacheRoot, driftName);
const target = path.join(cacheRoot, version);
const registryPath = path.join(plugins, "installed_plugins.json");

function copyCache(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  for (const rel of [".zcode-plugin", "dist", "commands", "skills", "marketplace.json", "package.json"]) {
    const src = path.join(root, rel);
    if (!fs.existsSync(src)) continue;
    fs.cpSync(src, path.join(dir, rel), { recursive: true });
  }
}

function otherRecord() {
  const dir = path.join(plugins, "cache", "zcode-plugins-official", "lark-cli", "0.1.2");
  fs.mkdirSync(path.join(dir, ".zcode-plugin"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".zcode-plugin", "plugin.json"),
    JSON.stringify({ name: "lark-cli", version: "0.1.2" }));
  return {
    id: "lark-cli@zcode-plugins-official", name: "lark-cli",
    marketplace: "zcode-plugins-official", version: "0.1.2", installPath: dir,
    installedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    scope: "user", source: { source: "directory", path: dir },
  };
}

function writeRegistry(beautifyVersion: string, installPath: string) {
  fs.writeFileSync(registryPath, JSON.stringify({
    version: 1,
    plugins: [
      otherRecord(),
      {
        id: "zcode-beautify@zcode-beautify", name: "zcode-beautify",
        marketplace: "zcode-beautify", version: beautifyVersion, installPath,
        installedAt: "2026-10-23T16:04:18.82Z", updatedAt: "2026-11-01T14:39:13.398Z",
        scope: "user", source: { source: "directory", path: root },
      },
    ],
  }, null, 2));
}

function run(args: string[]) {
  return spawnSync(process.execPath, [path.join(root, "scripts", "record-install.mjs"), ...args], {
    cwd: root, encoding: "utf8",
  });
}

function readRegistry() {
  return JSON.parse(fs.readFileSync(registryPath, "utf8"));
}

function beautifyRecord(registry: ReturnType<typeof readRegistry>) {
  return registry.plugins.find((row: { id?: string }) => row.id === "zcode-beautify@zcode-beautify");
}

try {
  fs.mkdirSync(oldCache, { recursive: true });
  copyCache(oldCache);
  writeRegistry(driftName, oldCache);

  // 1) verify reports the drift but stays non-fatal (one plugin only)
  const verify = run(["--verify", "--plugins-root", plugins]);
  check("verify exits 0 on version drift", verify.status === 0, verify.stderr);
  check("verify names the record/manifest mismatch",
    `${verify.stdout}${verify.stderr}`.includes(`record says ${driftName}`) &&
    `${verify.stdout}${verify.stderr}`.includes(`says ${version}`));

  // 2) dry-run plans the repair, proves the target absent, writes nothing
  const dry = run(["--dry-run", "--plugins-root", plugins]);
  check("dry-run exits 0 and plans the migration",
    dry.status === 0 && dry.stdout.includes("would migrate") && dry.stdout.includes(target),
    dry.stderr);
  check("dry-run does not create the target", !fs.existsSync(target));
  check("dry-run leaves the registry record untouched",
    beautifyRecord(readRegistry()).version === driftName);

  // 3) write mode atomically migrates and records the manifest version
  const write = run(["--plugins-root", plugins]);
  check("write exits 0", write.status === 0, write.stderr);
  check("version-named cache folder exists", fs.existsSync(path.join(target, ".zcode-plugin", "plugin.json")));
  check("migrated cache carries the current manifest",
    JSON.parse(fs.readFileSync(path.join(target, ".zcode-plugin", "plugin.json"), "utf8")).version === version);
  check("old cache folder is retained as a backup", fs.existsSync(oldCache));
  const registry = readRegistry();
  const record = beautifyRecord(registry);
  check("record now carries the manifest version", record.version === version);
  check("record points at the version-named cache", record.installPath === target);
  check("installedAt is preserved", record.installedAt === "2026-10-23T16:04:18.82Z");
  check("other inventory records survive", registry.plugins.length === 2 &&
    registry.plugins.some((row: { id?: string }) => row.id === "lark-cli@zcode-plugins-official"));
  check("no staging directory is left behind",
    fs.readdirSync(cacheRoot).every((name) => !name.includes(".staging-")));
  check("migration output names both folders",
    write.stdout.includes("migrated") && write.stdout.includes(oldCache) && write.stdout.includes(target));

  // 4) the repaired inventory is clean, and a second write is idempotent
  const verify2 = run(["--verify", "--plugins-root", plugins]);
  check("verify is clean after repair", verify2.status === 0 && !/warn/.test(verify2.stdout + verify2.stderr));
  const second = run(["--plugins-root", plugins]);
  check("second write stays idempotent", second.status === 0 &&
    readRegistry().plugins.length === 2 &&
    beautifyRecord(readRegistry()).installPath === target);

  // 5) ambiguous candidates fail closed instead of guessing
  const ambiguous = path.join(tmp, "ambiguous");
  const ambRoot = path.join(ambiguous, "cache", "zcode-beautify", "zcode-beautify");
  fs.mkdirSync(path.join(ambRoot, "1.0.0"), { recursive: true });
  fs.mkdirSync(path.join(ambRoot, "2.0.0"), { recursive: true });
  copyCache(path.join(ambRoot, "1.0.0"));
  copyCache(path.join(ambRoot, "2.0.0"));
  fs.writeFileSync(path.join(ambiguous, "installed_plugins.json"), JSON.stringify({ version: 1, plugins: [] }));
  const amb = run(["--dry-run", "--plugins-root", ambiguous]);
  check("ambiguous cache candidates are refused", amb.status === 1 &&
    `${amb.stdout}${amb.stderr}`.includes("multiple cache folders"));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failed ? `\nT36: ${failed} check(s) FAILED` : "\nT36: all checks passed");
process.exit(failed ? 1 : 0);
