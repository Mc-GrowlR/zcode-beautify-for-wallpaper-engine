/**
 * Launcher repair. Ported from upstream Logocceai/zcode-beautify 0.3.3
 * (commit 4099c2d), replacing the fork's simpler shortcuts.ts.
 *
 * ZCode only opens its CDP port when it is started with
 * `--remote-debugging-port=<port>`, and that argument has to come from whatever
 * launches it — the app cannot add it to itself once it is running. A typical
 * machine has several entry points (desktop shortcut, Start Menu shortcut, the
 * pinned taskbar shortcut, the machine-wide Public Desktop shortcut, the
 * `zcode://` protocol handler and the Explorer context-menu verbs) and usually
 * only some of them carry the flag.
 *
 * This module finds the ones that don't and adds it. All writes are per-user:
 * shortcuts in the user's own Desktop / Start Menu / pinned taskbar, plus
 * ZCode's HKCU protocol and shell handlers. The machine-wide Public Desktop and
 * Start Menu are reported as failures rather than attempted, because they need
 * elevation.
 *
 * Two caveats the user is told about in the docs: ZCode's updater rebuilds the
 * Start Menu shortcut without the flag, and the app re-registers its HKCU
 * handlers on every start, so the registry entries only stay fixed until the
 * next launch. Shortcuts are the durable entries.
 *
 * Fork additions on top of the port:
 * - OneDrive-redirected Desktop is scanned too (kept from the old shortcuts.ts).
 * - registryKeys is injectable so the verify scripts can run the real script
 *   against a sandbox registry key instead of ZCode's live handlers.
 * - psScript is exported for the test/ verify scripts.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { target } from "./target.js";

const execFileAsync = promisify(execFile);

export type LauncherKind = "shortcut" | "registry";

export interface LauncherFix {
  kind: LauncherKind;
  path: string;
  before: string;
  after: string;
  status: "updated" | "already-ok" | "failed";
  reason?: string;
}

export interface RepairOptions {
  port: number;
  /** Report what would change without writing anything. */
  dryRun?: boolean;
  /**
   * HKCU registry command keys to repair instead of ZCode's default three.
   * Only the verify scripts override this; production always repairs the
   * zcode:// protocol handler and the two Explorer context-menu verbs.
   */
  registryKeys?: string[];
}

export interface RepairReport {
  supported: boolean;
  dryRun: boolean;
  fixes: LauncherFix[];
  /** Set when the platform is unsupported or PowerShell could not be run. */
  error?: string;
}

/** ZCode's per-user deep-link and Explorer context-menu launch commands. */
export const DEFAULT_REGISTRY_KEYS = [
  "HKCU:\\Software\\Classes\\zcode\\shell\\open\\command",
  "HKCU:\\Software\\Classes\\Directory\\shell\\ZCode.OpenInZCode\\command",
  "HKCU:\\Software\\Classes\\Drive\\shell\\ZCode.OpenInZCode\\command",
];

export function psScript(
  port: number,
  dryRun: boolean,
  registryKeys: string[] = DEFAULT_REGISTRY_KEYS,
  shortcutMatch = "*ZCode.exe",
  exeName = "ZCode.exe"
): string {
  return `
$ErrorActionPreference = 'Continue'
# Without this, Chinese Windows error strings come back as mojibake through
# Node's UTF-8 stdout decoding.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$port = ${port}
$dryRun = $${dryRun ? "true" : "false"}
$flag = ' --remote-debugging-port=' + $port
$exeMatch = '${shortcutMatch.replace(/'/g, "''")}'
$exeName = '${exeName.replace(/'/g, "''")}'
$results = New-Object System.Collections.ArrayList

function Add-Result($kind, $p, $before, $after, $status, $reason) {
  [void]$results.Add([pscustomobject]@{
    kind = $kind; path = $p; before = $before; after = $after
    status = $status; reason = $reason
  })
}

# --- shortcuts -------------------------------------------------------------
$dirs = @(
  (Join-Path $env:USERPROFILE 'Desktop'),
  $(if ($env:OneDrive) { Join-Path $env:OneDrive 'Desktop' }),
  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'),
  # Pinned taskbar shortcuts are plain .lnk files; start-menu search and most
  # third-party launchers (Flow Launcher, PowerToys Run, …) index the Start Menu
  # copy, but users who pin the app read this one.
  (Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar'),
  (Join-Path $env:PUBLIC 'Desktop'),
  (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs')
)

$lnks = @()
foreach ($d in $dirs) {
  if ($d -and (Test-Path -LiteralPath $d)) {
    $lnks += @(Get-ChildItem -LiteralPath $d -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue)
  }
}

$wsh = New-Object -ComObject WScript.Shell
foreach ($item in $lnks) {
  try { $sc = $wsh.CreateShortcut($item.FullName) } catch { continue }
  $target = [string]$sc.TargetPath
  if ($target -notlike $exeMatch) { continue }

  $before = [string]$sc.Arguments
  if ($before -match 'remote-debugging-port') {
    Add-Result 'shortcut' $item.FullName $before $before 'already-ok' $null
    continue
  }

  $after = ($before.Trim() + $flag).Trim()
  if ($dryRun) {
    Add-Result 'shortcut' $item.FullName $before $after 'updated' 'dry-run'
    continue
  }
  try {
    $sc.Arguments = $after
    $sc.Save()
    Add-Result 'shortcut' $item.FullName $before $after 'updated' $null
  } catch {
    Add-Result 'shortcut' $item.FullName $before $after 'failed' $_.Exception.Message
  }
}

# --- HKCU protocol / shell handlers ----------------------------------------
$keys = @(${registryKeys.map((k) => `'${k.replace(/'/g, "''")}'`).join(",")})

foreach ($k in $keys) {
  if (-not (Test-Path -LiteralPath $k)) { continue }
  try {
    $key = Get-Item -LiteralPath $k
    $before = [string]$key.GetValue('')
    if ($before -notmatch [regex]::Escape($exeName)) { continue }
    if ($before -match 'remote-debugging-port') {
      Add-Result 'registry' $k $before $before 'already-ok' $null
      continue
    }
    # Insert the flag directly after the executable token, keeping any
    # placeholders ("%1") and quoting untouched.
    $after = $before -replace '^(\\s*("[^"]+"|\\S+))', ('$1' + $flag)
    if ($dryRun) {
      Add-Result 'registry' $k $before $after 'updated' 'dry-run'
      continue
    }
    try {
      # Get-Item hands back a read-only handle, so the default value can only be
      # changed through a .NET key opened with write access.
      $sub = $k -replace '^HKCU:\\\\', ''
      $writable = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($sub, $true)
      if (-not $writable) { throw 'cannot open the key for writing' }
      $writable.SetValue('', $after, [Microsoft.Win32.RegistryValueKind]::String)
      $writable.Close()
      Add-Result 'registry' $k $before $after 'updated' $null
    } catch {
      Add-Result 'registry' $k $before $after 'failed' $_.Exception.Message
    }
  } catch {
    Add-Result 'registry' $k '' '' 'failed' $_.Exception.Message
  }
}

@($results) | ConvertTo-Json -Depth 4 -Compress
`;
}

interface RawResult {
  kind: string;
  path: string;
  before: string;
  after: string;
  status: string;
  reason: string | null;
}

/**
 * Scans every launcher of the active target app and adds the CDP flag where it
 * is missing. Never throws: a platform without these mechanisms, or a missing
 * PowerShell, comes back as a report with `error` set.
 */
export async function repairLaunchers(opts: RepairOptions): Promise<RepairReport> {
  const dryRun = opts.dryRun ?? false;
  if (process.platform !== "win32") {
    return {
      supported: false,
      dryRun,
      fixes: [],
      error: "launcher repair is only implemented for Windows; on other platforms edit your app shortcut manually",
    };
  }

  const app = target();
  const keys = opts.registryKeys ?? app.launcher.registryKeys;
  const encoded = Buffer.from(
    psScript(opts.port, dryRun, keys, app.launcher.shortcutMatch, app.exeName),
    "utf16le"
  ).toString("base64");
  try {
    const { stdout } = await execFileAsync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { maxBuffer: 8 * 1024 * 1024, timeout: 120_000, windowsHide: true }
    );
    const trimmed = stdout.trim();
    if (!trimmed) return { supported: true, dryRun, fixes: [] };
    const raw = JSON.parse(trimmed) as RawResult | RawResult[];
    const list = Array.isArray(raw) ? raw : [raw];
    return {
      supported: true,
      dryRun,
      fixes: list.map((r) => ({
        kind: (r.kind === "registry" ? "registry" : "shortcut") as LauncherKind,
        path: r.path,
        before: r.before,
        after: r.after,
        status: r.status === "updated" || r.status === "already-ok" ? r.status : "failed",
        reason: r.reason ?? undefined,
      })),
    };
  } catch (err) {
    return { supported: true, dryRun, fixes: [], error: (err as Error).message };
  }
}
