/**
 * T27 OPT-IN GATE verification: the experimental CDP injection is off by
 * default (0.6.0+), pre-gate installs migrate to enabled with a `migrated`
 * marker, launcher repair gained a non-destructive "remove" action, and the
 * enable/disable surfaces are wired on every layer (MCP / CLI / panel).
 *
 * Three tiers, no live ZCode and no real launch entries touched:
 *   part A  config gate in a sandboxed dataDir — fresh install stays off,
 *           a used pre-gate config migrates on, explicit states are kept;
 *   part B  the real repairLaunchers round-trips add→remove against a
 *           sandboxed home tree (USERPROFILE/APPDATA/PUBLIC/ProgramData/
 *           OneDrive pointed at temp dirs, per t-launchers-verify) and a
 *           throwaway HKCU key — the real Desktop / Start Menu scan never
 *           runs against the actual machine;
 *   part C  static contracts — MCP/CLI/panel wiring, reset script clears
 *           the renderer cache, serve route exists.
 *
 * Run: npx tsx test/t27-optin-gate.ts   (also part of: npm test)
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}
const execFileAsync = promisify(execFile);

// Sandbox the data dir BEFORE importing anything that resolves dataDir().
const sandbox = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "zb-t27-")));
process.env.ZCODE_BEAUTIFY_DATA_DIR = sandbox;

const { configFile, ensureExperimentalGate, experimentalEnabled, saveConfig } = await import("../src/core/launch.js");
const { repairLaunchers, psScript } = await import("../src/core/launchers.js");
const { buildResetScript } = await import("../src/core/cdp.js");
const { buildPanelScript } = await import("../src/panel/panelScript.js");
const { VERSION } = await import("../src/version.js");

// --- part A: config gate ------------------------------------------------------
{
  let cfg = ensureExperimentalGate();
  check("A: fresh install keeps the gate closed", cfg.experimental?.enabled !== true);
  check("A: fresh install writes no config file", !fs.existsSync(configFile()));
  check("A: experimentalEnabled() reads false", experimentalEnabled() === false);

  // A pre-gate config with real prior use inherits enabled=true (migrated).
  fs.writeFileSync(configFile(), JSON.stringify({ port: 9222, wallpaperPath: "D:/wp/old.jpg", blur: 12 }));
  cfg = ensureExperimentalGate();
  check("A: used pre-gate config migrates to enabled", cfg.experimental?.enabled === true);
  check("A: migration carries the migrated marker", cfg.experimental?.migrated === true);
  check("A: migration stamps the plugin version", cfg.experimental?.consentVersion === VERSION);
  check("A: migration keeps prior settings", cfg.wallpaperPath === "D:/wp/old.jpg" && cfg.blur === 12);
  const onDisk = JSON.parse(fs.readFileSync(configFile(), "utf8"));
  check("A: migration persisted to disk", onDisk.experimental?.enabled === true && onDisk.experimental?.migrated === true);
  check("A: migration is idempotent", ensureExperimentalGate().experimental?.migrated === true);

  // A bare config (installed but never used) stays off.
  fs.writeFileSync(configFile(), JSON.stringify({ port: 9333 }));
  cfg = ensureExperimentalGate();
  check("A: never-used config stays disabled", cfg.experimental?.enabled !== true);

  // Explicit states are respected verbatim.
  saveConfig({ port: 9222, experimental: { enabled: false } });
  cfg = ensureExperimentalGate();
  check("A: explicit off is kept (no re-migration)", cfg.experimental?.enabled === false && cfg.experimental?.migrated !== true);
  saveConfig({ port: 9222, experimental: { enabled: true, consentedAt: "2026-01-01T00:00:00.000Z", consentVersion: VERSION } });
  cfg = ensureExperimentalGate();
  check("A: explicit consent is kept and not marked migrated", cfg.experimental?.enabled === true && cfg.experimental?.migrated !== true);
}

// --- part B: launcher add/remove round-trip (sandboxed home) --------------------
if (process.platform !== "win32") {
  console.log("B: SKIP (win32 only)");
} else {
  const home = path.join(sandbox, "home");
  const appDataRoaming = path.join(home, "AppData", "Roaming");
  const binZcode = path.join(sandbox, "bin", "ZCode.exe");
  const lnkPath = path.join(home, "Desktop", "ZCode.lnk");
  const regKey = "HKCU:\\Software\\zb-t27\\shell\\open\\command";
  fs.mkdirSync(path.dirname(lnkPath), { recursive: true });
  fs.mkdirSync(path.dirname(binZcode), { recursive: true });
  fs.writeFileSync(binZcode, "dummy");

  // .lnk + registry seeding via a .ps1 FILE — inline -Command with Windows
  // paths is how NUL-byte breakage happened before; never again.
  const psq = (p: string) => `'${p.replace(/'/g, "''")}'`;
  const runPsFile = async (name: string, lines: string[]): Promise<string> => {
    const file = path.join(sandbox, name);
    fs.writeFileSync(file, lines.join("\r\n"));
    const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file], {
      timeout: 60_000,
    });
    return stdout;
  };

  await runPsFile("seed.ps1", [
    `$ws = New-Object -ComObject WScript.Shell`,
    `$sc = $ws.CreateShortcut(${psq(lnkPath)})`,
    `$sc.TargetPath = ${psq(binZcode)}`,
    `$sc.Arguments = '--existing-arg'`,
    `$sc.Save()`,
    `New-Item -Path ${psq(regKey)} -Force | Out-Null`,
    `Set-Item -Path ${psq(regKey)} -Value '"${binZcode.replace(/'/g, "''")}" "%1"'`,
  ]);

  const readBack = async (): Promise<{ args: string; reg: string }> => {
    const out = await runPsFile("read.ps1", [
      `$ws = New-Object -ComObject WScript.Shell`,
      `Write-Output $ws.CreateShortcut(${psq(lnkPath)}).Arguments`,
      `Write-Output (Get-Item -LiteralPath ${psq(regKey)}).GetValue('')`,
    ]);
    const lines = out.trim().split(/\r?\n/);
    return { args: (lines[0] ?? "").trim(), reg: (lines[1] ?? "").trim() };
  };

  // Point the scan at the sandbox home while the script runs — the same
  // pattern as t-launchers-verify: PowerShell inherits these, so the real
  // Desktop / Start Menu / taskbar are never even enumerated.
  const ENV_KEYS = ["USERPROFILE", "APPDATA", "PUBLIC", "ProgramData", "OneDrive"] as const;
  const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.USERPROFILE = home;
  process.env.APPDATA = appDataRoaming;
  process.env.PUBLIC = path.join(sandbox, "public");
  process.env.ProgramData = path.join(sandbox, "programdata");
  process.env.OneDrive = path.join(sandbox, "onedrive");

  try {
    const run = async (action: "add" | "remove", dryRun = false) =>
      repairLaunchers({ port: 9223, action, dryRun, registryKeys: [regKey] });
    const lnkResult = (fixes: Array<{ kind: string; status: string; after?: string }>) =>
      fixes.find((f) => f.kind === "shortcut");
    const regResult = (fixes: Array<{ kind: string; status: string; after?: string }>) =>
      fixes.find((f) => f.kind === "registry");

    // add: dry run reports but writes nothing
    let report = await run("add", true);
    check("B: add dry-run reports the shortcut", lnkResult(report.fixes)?.status === "updated" && lnkResult(report.fixes)?.after === "--existing-arg --remote-debugging-port=9223");
    check("B: add dry-run sees only the sandbox pair", report.fixes.length === 2, JSON.stringify(report.fixes.map((f) => f.path)));
    check("B: add dry-run wrote nothing", (await readBack()).args === "--existing-arg");

    // add: real write, idempotent
    report = await run("add");
    check("B: add updates the shortcut", lnkResult(report.fixes)?.status === "updated");
    check("B: add updates the registry handler", regResult(report.fixes)?.status === "updated" && regResult(report.fixes)?.after?.includes("--remote-debugging-port=9223"));
    check("B: flag landed in the .lnk", (await readBack()).args === "--existing-arg --remote-debugging-port=9223");
    report = await run("add");
    check("B: second add is already-ok", lnkResult(report.fixes)?.status === "already-ok" && regResult(report.fixes)?.status === "already-ok");

    // remove: dry run reports, then strips — any port, other args and %1 intact
    report = await run("remove", true);
    check("B: remove dry-run reports the strip", lnkResult(report.fixes)?.status === "updated" && lnkResult(report.fixes)?.after === "--existing-arg");
    check("B: remove dry-run wrote nothing", (await readBack()).args.includes("remote-debugging-port"));
    report = await run("remove");
    check("B: remove strips the flag from the shortcut", lnkResult(report.fixes)?.status === "updated" && lnkResult(report.fixes)?.after === "--existing-arg");
    check("B: remove keeps the other arguments", (await readBack()).args === "--existing-arg");
    check("B: remove keeps registry quoting and %1", (await readBack()).reg === `"${binZcode}" "%1"`);
    report = await run("remove");
    check("B: second remove is already-ok", lnkResult(report.fixes)?.status === "already-ok" && regResult(report.fixes)?.status === "already-ok");
  } finally {
    for (const [k, v] of savedEnv) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await runPsFile("clean.ps1", [`Remove-Item -Path ${psq(regKey)} -Recurse -Force -ErrorAction SilentlyContinue`]).catch(() => undefined);
  }

  // Mode selection happens at PS runtime (both branches render); the remove
  // script must select the remove branch — behavior is proven above.
  const removeScript = psScript(9223, false, [regKey], "*ZCode.exe", "ZCode.exe", "remove");
  check("B: remove-mode script selects the remove branch", removeScript.includes("$mode = 'remove'") && !psScript(9223, false, [regKey], "*ZCode.exe", "ZCode.exe", "add").includes("$mode = 'remove'"));
}

// --- part C: static contracts ---------------------------------------------------
{
  const serverSrc = fs.readFileSync(new URL("../src/mcp/server.ts", import.meta.url), "utf8");
  check("C: MCP exposes the gate tools", serverSrc.includes('"enable_experimental"') && serverSrc.includes('"disable_experimental"'));
  check("C: bootstrap gates daemon + self-heal on the opt-in", serverSrc.includes("cfg.experimental?.enabled"));
  check(
    "C: all four injection tools check the gate",
    (serverSrc.match(/experimentalEnabled\(loadConfig\(\)\)/g) ?? []).length >= 4
  );
  check("C: repair_launchers accepts the remove action", serverSrc.includes('"add", "remove"'));

  const cliSrc = fs.readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8");
  check("C: CLI enable/disable share the core module", cliSrc.includes("enableExperimental") && cliSrc.includes("disableExperimental"));
  check("C: CLI repair-launchers has --remove", cliSrc.includes('"remove" as const'));
  check("C: CLI migrates the gate on startup", cliSrc.includes("ensureExperimentalGate()"));

  const panel = buildPanelScript(9223, "t27-token", false);
  check("C: panel renders the experimental card", panel.includes("zb-exp-state") && panel.includes("zb-exp-disable") && panel.includes("zb-exp-sub"));
  check("C: panel wires the disable route", panel.includes("/api/experimental/disable"));

  const serveSrc = fs.readFileSync(new URL("../src/core/server.ts", import.meta.url), "utf8");
  check("C: serve implements the disable route", serveSrc.includes('"/api/experimental/disable"'));
  check("C: health reports the experimental state", serveSrc.includes("experimental: { enabled: exp?.enabled === true"));
  check("C: publicConfig mirrors the gate for the panel", serveSrc.includes("experimental: config.experimental"));

  const reset = buildResetScript();
  check("C: reset clears the renderer's cached look", reset.includes("removeItem") && reset.includes("':css'") && reset.includes("':wallpaper'"));

  const coreSrc = fs.readFileSync(new URL("../src/core/experimental.ts", import.meta.url), "utf8");
  check("C: shared core records consent", coreSrc.includes("consentedAt") && coreSrc.includes("consentVersion"));
  check("C: shared core strips the flag on disable", coreSrc.includes('action: "remove"'));
}

fs.rmSync(sandbox, { recursive: true, force: true });
console.log(failed === 0 ? "\nt27: all checks passed" : `\nt27: ${failed} check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
