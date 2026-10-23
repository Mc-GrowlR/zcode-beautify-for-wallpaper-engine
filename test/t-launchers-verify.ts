/**
 * T-LAUNCHERS verification: launcher repair (src/core/launchers.ts, ported
 * from upstream 0.3.3). Everything runs against a SANDBOX — process env is
 * pointed at temp dirs and a throwaway HKCU key, so the real machine's
 * shortcuts, ZCode's protocol handler and the Explorer verbs are never touched.
 *
 * Run: npx tsx test/t-launchers-verify.ts
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { psScript, repairLaunchers, DEFAULT_REGISTRY_KEYS } from "../src/core/launchers.js";

if (process.platform !== "win32") {
  console.log("T-LAUNCHERS SKIP (win32 only)");
  process.exit(0);
}

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}

const PORT = 9321;
const FLAG = `--remote-debugging-port=${PORT}`;
const TEST_KEY = "HKCU:\\Software\\zb-launchers-test\\shell\\open\\command";

function runPs(script: string): string {
  return execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    timeout: 30_000,
  }).trim();
}

// --- part 1: generated script content --------------------------------------
{
  const s = psScript(PORT, true);
  check("script renders the port", s.includes(`$port = ${PORT}`));
  check("script renders dry-run true/false", s.includes("$dryRun = $true") && !psScript(PORT, false).includes("$dryRun = $true"));
  check("script forces UTF-8 stdout (GBK mojibake guard)", s.includes("[Console]::OutputEncoding"));
  for (const marker of ["$env:USERPROFILE", "OneDrive", "$env:APPDATA", "Quick Launch", "$env:PUBLIC", "$env:ProgramData"]) {
    check(`script scans ${marker}`, s.includes(marker));
  }
  check("script scans shortcuts recursively", s.includes("-Recurse"));
  for (const k of DEFAULT_REGISTRY_KEYS) {
    check(`default registry key …${k.slice(-30)}`, s.includes(k));
  }
  check("custom registryKeys land in the script (quotes doubled)", psScript(PORT, false, ["HKCU:\\a'b"]).includes("'HKCU:\\a''b'"));
  check("empty registryKeys disable the registry pass", psScript(PORT, false, []).includes("$keys = @()"));
  check("registry insert rewrites after the exe token", s.includes("-replace") && s.includes("|\\S+))'"));
}

// --- part 2: sandboxed repair (shortcuts + registry) ------------------------
// realpath.native expands 8.3 short names (os.tmpdir() may return
// C:\Users\ADMINI~1\...): PowerShell's FullName comes back in long form, and
// path-equality assertions below would otherwise compare short vs long.
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "zb-launchers-")));
const home = path.join(root, "home");
const appDataRoaming = path.join(home, "AppData", "Roaming");
const startMenu = path.join(appDataRoaming, "Microsoft", "Windows", "Start Menu", "Programs");
const oneDrive = path.join(root, "onedrive");
const publicDesk = path.join(root, "public", "Desktop");
const programDataMenu = path.join(root, "programdata", "Microsoft", "Windows", "Start Menu", "Programs");
const taskBar = path.join(appDataRoaming, "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar");
const binZcode = path.join(root, "bin", "ZCode.exe");
const binOther = path.join(root, "bin", "other.exe");

const ENV_KEYS = ["USERPROFILE", "APPDATA", "PUBLIC", "ProgramData", "OneDrive"] as const;
const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((k) => [k, process.env[k]]));

function withSandboxEnv(fn: () => Promise<void>): Promise<void> {
  process.env.USERPROFILE = home;
  process.env.APPDATA = appDataRoaming;
  process.env.PUBLIC = path.dirname(publicDesk);
  process.env.ProgramData = path.join(root, "programdata");
  process.env.OneDrive = oneDrive;
  return fn().finally(() => {
    for (const [k, v] of savedEnv) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

const psq = (p: string) => `'${p.replace(/'/g, "''")}'`;

function makeLnk(lnkPath: string, target: string, args: string): void {
  fs.mkdirSync(path.dirname(lnkPath), { recursive: true });
  runPs(
    `$ws = New-Object -ComObject WScript.Shell\n` +
      `$s = $ws.CreateShortcut(${psq(lnkPath)})\n` +
      `$s.TargetPath = ${psq(target)}\n` +
      `$s.Arguments = ${psq(args)}\n` +
      `$s.Save()`
  );
}

function lnkArgs(lnkPath: string): string {
  return runPs(`(New-Object -ComObject WScript.Shell).CreateShortcut(${psq(lnkPath)}).Arguments`).trim();
}

try {
  fs.mkdirSync(path.dirname(binZcode), { recursive: true });
  fs.writeFileSync(binZcode, "stub");
  fs.writeFileSync(binOther, "stub");

  // The shortcut matrix: name vs target vs existing args vs location.
  const lnkPlain = path.join(home, "Desktop", "ZCode.lnk"); // → updated
  const lnkHasFlag = path.join(home, "Desktop", "ZCode with-flag.lnk"); // → already-ok
  const lnkForeign = path.join(home, "Desktop", "记事本.lnk"); // → not ZCode, ignored
  const lnkDeepRenamed = path.join(home, "Desktop", "folder", "我的ZCode工具.lnk"); // → updated (nested + non-ASCII + non-ZCode name)
  const lnkOneDrive = path.join(oneDrive, "Desktop", "ZCode.lnk"); // → updated (OneDrive redirect)
  const lnkTaskbar = path.join(taskBar, "ZCode.lnk"); // → updated (pinned)
  const lnkStartNested = path.join(startMenu, "工具集", "ZCode.lnk"); // → updated
  const lnkPublic = path.join(publicDesk, "ZCode.lnk"); // → updated (Public Desktop)
  const lnkProgramData = path.join(programDataMenu, "ZCode.lnk"); // → updated (all-users Start Menu)
  const lnkDry = path.join(home, "Desktop", "dryme.lnk"); // dry-run only

  makeLnk(lnkPlain, binZcode, "");
  makeLnk(lnkHasFlag, binZcode, "--remote-debugging-port=9222");
  makeLnk(lnkForeign, binOther, "");
  makeLnk(lnkDeepRenamed, binZcode, "");
  makeLnk(lnkOneDrive, binZcode, "");
  makeLnk(lnkTaskbar, binZcode, "");
  makeLnk(lnkStartNested, binZcode, "");
  makeLnk(lnkPublic, binZcode, "");
  makeLnk(lnkProgramData, binZcode, "");

  // Throwaway HKCU handler mimicking ZCode's zcode:// command.
  runPs(
    `New-Item -Path ${TEST_KEY} -Force | Out-Null\n` +
      `Set-ItemProperty -Path ${TEST_KEY} -Name '(default)' -Value ${psq(`"${binZcode}" "%1"`)}`
  );

  const run1 = await withSandboxEnv(() => repairLaunchers({ port: PORT, registryKeys: [TEST_KEY] }));

  check("run1: no error, supported", !run1.error && run1.supported, run1.error ?? "");
  const shortcuts = run1.fixes.filter((f) => f.kind === "shortcut");
  const registry = run1.fixes.filter((f) => f.kind === "registry");
  check("run1: 8 shortcut fixes found (foreign .lnk ignored)", shortcuts.length === 8, `${shortcuts.length}`);
  check("run1: 7 updated", shortcuts.filter((f) => f.status === "updated").length === 7);
  check("run1: 1 already-ok", shortcuts.filter((f) => f.status === "already-ok").length === 1);
  check("run1: foreign shortcut absent from report", !shortcuts.some((f) => f.path === lnkForeign));
  const deep = shortcuts.find((f) => f.path === lnkDeepRenamed);
  check("run1: deep non-ASCII shortcut found & updated (UTF-8 round-trip)", !!deep && deep.status === "updated", deep?.path ?? "missing");
  check("run1: OneDrive shortcut found & updated", shortcuts.find((f) => f.path === lnkOneDrive)?.status === "updated");
  check("run1: registry handler updated", registry.length === 1 && registry[0].status === "updated", JSON.stringify(registry));
  check(
    "run1: registry flag inserted after exe, %1 preserved",
    registry[0]?.after === `"${binZcode}" ${FLAG} "%1"`,
    registry[0]?.after ?? ""
  );

  check("disk: plain shortcut gained the flag", lnkArgs(lnkPlain).includes(FLAG), lnkArgs(lnkPlain));
  check("disk: foreign shortcut untouched", lnkArgs(lnkForeign) === "");
  check("disk: already-flagged shortcut untouched", lnkArgs(lnkHasFlag) === "--remote-debugging-port=9222");

  const run2 = await withSandboxEnv(() => repairLaunchers({ port: PORT, registryKeys: [TEST_KEY] }));
  check("run2: idempotent — everything already-ok", run2.fixes.length === 9 && run2.fixes.every((f) => f.status === "already-ok"), JSON.stringify(run2.fixes.map((f) => f.status)));

  makeLnk(lnkDry, binZcode, "");
  const run3 = await withSandboxEnv(() => repairLaunchers({ port: PORT, dryRun: true, registryKeys: [] }));
  const dryFix = run3.fixes.find((f) => f.path === lnkDry);
  check("dry-run: would-be update reported", !!dryFix && dryFix.status === "updated" && dryFix.reason === "dry-run");
  check("dry-run: nothing written to disk", lnkArgs(lnkDry) === "", lnkArgs(lnkDry));
} finally {
  for (const [k, v] of savedEnv) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { runPs(`Remove-Item -Path 'HKCU:\\Software\\zb-launchers-test' -Recurse -Force -ErrorAction SilentlyContinue`); } catch { /* gone */ }
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(failed === 0 ? "T-LAUNCHERS PASS" : `T-LAUNCHERS FAIL (${failed} check(s))`);
process.exit(failed === 0 ? 0 : 1);
