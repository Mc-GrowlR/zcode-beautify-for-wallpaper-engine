/**
 * Target app profiles.
 *
 * The same injection pipeline can beautify more than one Electron desktop
 * client. Everything that differs between clients lives here: executable
 * discovery, process name, data dir, renderer target matching, which CSS
 * variable family carries the theme, and which chat-area extras the DOM
 * actually supports.
 *
 * Targets:
 *   zcode     — ZCode desktop client (Tailwind v4 `--color-*` tokens).
 *   workbuddy — WorkBuddy desktop client (`--wb-*` design tokens, CodeBuddy
 *               plugin format `.codebuddy-plugin/`).
 *
 * The active target is picked once per process from, in order:
 *   --target <id>  →  BEAUTIFY_TARGET env  →  auto-detect.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type TargetId = "zcode" | "workbuddy";

export interface AppTarget {
  id: TargetId;
  /** Product name shown in the panel, CLI and MCP tool descriptions. */
  appName: string;
  exeName: string;
  /** Env vars that may hold an install dir or a full executable path. */
  exeEnvVars: string[];
  /** Where the theme/CSS variable family lives. */
  tokens: "color" | "wb";
  /** Data dir for config/wallpapers; env override comes first. */
  dataDirEnvVars: string[];
  /** Default CDP debug port. Distinct per client so two running clients can
   *  never share one debug endpoint (9222 is ZCode's long-standing default). */
  cdpPort: number;
  /** Default local control-API port for `serve`. */
  apiPort: number;
  defaultDataDir(): string;
  /** URL fragments / window titles that identify the main renderer page. */
  rendererUrlIncludes: string[];
  rendererTitles: string[];
  /** Query marker of an update-progress window; empty when the app has none. */
  updaterUrlIncludes: string[];
  /** Extra Chromium switches for a beautified launch (beyond the CDP port). */
  launchArgs: string[];
  /** Left sidebar container, used by 侧边栏压暗. */
  sidebarSelector?: string;
  /**
   * Chat-area extras (bubbles, message-column width, spinner icons) were
   * reverse-engineered from ZCode's DOM and are only wired for that client.
   */
  supportsChatUi: boolean;
  /** How to tell the app is still on its startup screen. */
  startupProbe: "zcode-body-class" | "workbuddy-skeleton";
  /** Per-user launcher entries worth keeping the CDP flag on. */
  launcher: {
    /** PowerShell wildcard matched against a shortcut's target path. */
    shortcutMatch: string;
    /** Explorer / protocol handler keys under HKCU. */
    registryKeys: string[];
  };
}

function localAppData(): string {
  return process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
}

function workbuddyCandidates(): string[] {
  const out: string[] = [];
  for (const key of ["WORKBUDDY_EXE_PATH", "WORKBUDDY_WINDOWS_APP_INSTALL_DIR", "WORKBUDDY_APP_INSTALL_DIR"]) {
    const v = process.env[key];
    if (!v) continue;
    out.push(v.toLowerCase().endsWith(".exe") ? v : path.join(v, "WorkBuddy.exe"));
  }
  out.push(
    path.join(localAppData(), "Programs", "WorkBuddy", "WorkBuddy.exe"),
    "C:\\Program Files\\WorkBuddy\\WorkBuddy.exe",
    path.join(os.homedir(), "AppData", "Local", "WorkBuddy", "WorkBuddy.exe")
  );
  const discovered = readWindowsInstallPath("WorkBuddy");
  if (discovered) out.push(discovered);
  return out.filter(Boolean);
}

function zcodeCandidates(): string[] {
  const out: string[] = [];
  const dir = process.env.ZCODE_WINDOWS_APP_INSTALL_DIR;
  if (dir) out.push(path.join(dir, "ZCode.exe"));
  out.push(
    "C:\\Program Files\\ZCode\\ZCode.exe",
    path.join(localAppData(), "Programs", "ZCode", "ZCode.exe")
  );
  const discovered = readWindowsInstallPath("ZCode");
  if (discovered) out.push(discovered);
  return out.filter(Boolean);
}

/**
 * Reads an install path Windows already knows about: the per-user/machine
 * Uninstall entry's DisplayIcon ("D:\\soft\\WorkBuddy\\WorkBuddy.exe,0") or the
 * App Paths registration. Lets non-default install locations (D:\\soft\\…,
 * portable dirs) work without asking the user to set an env var.
 */
let installPathCache: Map<string, string | undefined> | undefined;

function safeIsFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function readWindowsInstallPath(product: string): string | undefined {
  if (process.platform !== "win32") return undefined;
  installPathCache ??= new Map();
  if (installPathCache.has(product)) return installPathCache.get(product);

  const result = queryRegistry(product) ?? queryRegistryViaPowerShell(product);

  installPathCache.set(product, result);
  return result;
}

function queryRegistry(product: string): string | undefined {
  // App Paths first: one tiny key, one value, no subtree walk.
  for (const root of ["HKCU", "HKLM"]) {
    const key = `${root}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${product}.exe`;
    try {
      const stdout = execFileSync("reg", ["query", key, "/ve"], {
        encoding: "utf8",
        timeout: 4000,
        windowsHide: true,
      });
      const match = stdout.match(/([A-Za-z]:\\[^"\r\n]*?\.exe)/i);
      if (match && safeIsFile(match[1])) return match[1];
    } catch {
      /* not registered, or reg.exe unavailable */
    }
  }
  // Uninstall entries: filtered query (/f + /d) so the subtree walk stays
  // cheap even with hundreds of installed programs.
  for (const root of ["HKCU", "HKLM"]) {
    const key = `${root}\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall`;
    try {
      const stdout = execFileSync(
        "reg",
        ["query", key, "/s", "/f", `${product}.exe`, "/d"],
        { encoding: "utf8", timeout: 8000, windowsHide: true }
      );
      for (const line of stdout.split(/\r?\n/)) {
        if (!new RegExp(`${product}\\.exe`, "i").test(line)) continue;
        const match = line.match(/([A-Za-z]:\\[^",\r\n]*?\.exe)/i);
        if (match && safeIsFile(match[1])) return match[1];
      }
    } catch {
      /* not found under this hive */
    }
  }
  return undefined;
}

/**
 * Fallback for locked-down machines where reg.exe is blocked by policy.
 * Reads the same two sources through PowerShell and prints the candidate
 * paths one per line; the first existing file wins.
 */
function queryRegistryViaPowerShell(product: string): string | undefined {
  const script = [
    `$p='${product.replace(/'/g, "''")}'`,
    `$out=@()`,
    `foreach($r in 'HKCU','HKLM'){`,
    `  try{ $k=Get-Item "Registry::$r\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\$p.exe" -ErrorAction Stop; $d=$k.GetValue(''); if($d){$out+=$d} }catch{}`,
    `  try{ Get-ChildItem "Registry::$r\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall" -ErrorAction SilentlyContinue | ForEach-Object {`,
    `    $v=Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue`,
    `    if($v.DisplayIcon -and $v.DisplayIcon -match [regex]::Escape($p)){ $out+=$v.DisplayIcon }`,
    `  } }catch{}`,
    `}`,
    `$out | ForEach-Object { if($_ -match '([A-Za-z]:\\\\[^",]*?\\.exe)'){ $Matches[1] } }`,
  ].join("\n");
  try {
    const stdout = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      timeout: 12000,
      windowsHide: true,
    });
    for (const line of stdout.split(/\r?\n/)) {
      const candidate = line.trim();
      if (candidate && safeIsFile(candidate)) return candidate;
    }
  } catch {
    /* no PowerShell, or the query timed out */
  }
  return undefined;
}

const ZCODE: AppTarget = {
  id: "zcode",
  appName: "ZCode",
  exeName: "ZCode.exe",
  exeEnvVars: ["ZCODE_WINDOWS_APP_INSTALL_DIR"],
  tokens: "color",
  dataDirEnvVars: ["ZCODE_BEAUTIFY_DATA_DIR"],
  cdpPort: 9222,
  apiPort: 9223,
  defaultDataDir: () => path.join(os.homedir(), ".zcode", "cli", "plugins", "data", "zcode-beautify"),
  rendererUrlIncludes: ["out/renderer/index.html"],
  rendererTitles: ["ZCode"],
  updaterUrlIncludes: ["windowKind=update-status"],
  launchArgs: [
    // A transparent window gets misjudged as fully occluded, which stops all
    // renderer painting and throttles timers past 1s.
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ],
  sidebarSelector: "#sidebar",
  supportsChatUi: true,
  startupProbe: "zcode-body-class",
  launcher: {
    shortcutMatch: "*ZCode.exe",
    registryKeys: [
      "HKCU:\\Software\\Classes\\zcode\\shell\\open\\command",
      "HKCU:\\Software\\Classes\\Directory\\shell\\ZCode.OpenInZCode\\command",
      "HKCU:\\Software\\Classes\\Drive\\shell\\ZCode.OpenInZCode\\command",
    ],
  },
};

const WORKBUDDY: AppTarget = {
  id: "workbuddy",
  appName: "WorkBuddy",
  exeName: "WorkBuddy.exe",
  exeEnvVars: ["WORKBUDDY_EXE_PATH", "WORKBUDDY_WINDOWS_APP_INSTALL_DIR", "WORKBUDDY_APP_INSTALL_DIR"],
  tokens: "wb",
  dataDirEnvVars: ["WORKBUDDY_BEAUTIFY_DATA_DIR"],
  cdpPort: 9333,
  apiPort: 9334,
  defaultDataDir: () => path.join(os.homedir(), ".workbuddy", "plugins", "data", "zcode-beautify"),
  // file:///<install>/resources/app.asar/renderer/index.html?windowTheme=…
  // …/resources/app.asar/renderer/index.html (ZCode's is app.asar/out/renderer,
  // so the anchored fragment keeps the two apart when both clients run).
  rendererUrlIncludes: ["/app.asar/renderer/index.html"],
  rendererTitles: ["WorkBuddy"],
  updaterUrlIncludes: [],
  launchArgs: [
    // Same rationale as ZCode minus the occlusion experiment: a wallpaper
    // <video> must keep decoding while the window sits in the background.
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ],
  sidebarSelector: "[data-sidebar-motion]",
  supportsChatUi: false,
  startupProbe: "workbuddy-skeleton",
  launcher: {
    shortcutMatch: "*WorkBuddy.exe",
    // Only the deep-link handler: WorkBuddy also registers file-type handlers
    // (WorkBuddy.image / .pdfX / …) whose command lines are shared with the
    // shell's "open with" flow — rewriting those risks breaking file open.
    registryKeys: ["HKCU:\\Software\\Classes\\workbuddy\\shell\\open\\command"],
  },
};

export const TARGETS: Record<TargetId, AppTarget> = { zcode: ZCODE, workbuddy: WORKBUDDY };

let activeId: TargetId | undefined;

export function isTargetId(v: unknown): v is TargetId {
  return v === "zcode" || v === "workbuddy";
}

/** Executable candidates for a target, most specific first. */
export function executableCandidates(app: AppTarget = target()): string[] {
  if (process.platform === "win32") {
    return app.id === "workbuddy" ? workbuddyCandidates() : zcodeCandidates();
  }
  if (process.platform === "darwin") {
    return app.id === "workbuddy"
      ? ["/Applications/WorkBuddy.app/Contents/MacOS/WorkBuddy"]
      : ["/Applications/ZCode.app/Contents/MacOS/ZCode"];
  }
  return app.id === "workbuddy" ? ["/usr/bin/workbuddy", "/opt/WorkBuddy/workbuddy"] : ["/usr/bin/zcode", "/opt/ZCode/zcode"];
}

export function findExecutable(app: AppTarget = target()): string | undefined {
  return executableCandidates(app).find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * Resolves the active target without side effects.
 *
 * Precedence: explicit `--target` → BEAUTIFY_TARGET env → ZCode.
 * ZCode stays the default so existing installs and scripts keep working; a
 * WorkBuddy install is opted in by the plugin manifest (`BEAUTIFY_TARGET`) or
 * `--target workbuddy`. `--target auto` (or BEAUTIFY_TARGET=auto) picks the
 * client that is actually installed.
 */
export function resolveTargetId(requested?: string | TargetId): TargetId {
  if (isTargetId(requested)) return requested;
  if (requested === "auto") return detectTargetId();
  const env = process.env.BEAUTIFY_TARGET;
  if (isTargetId(env)) return env;
  if (env === "auto") return detectTargetId();
  if (process.env.WORKBUDDY_BEAUTIFY_DATA_DIR && !process.env.ZCODE_BEAUTIFY_DATA_DIR) return "workbuddy";
  return "zcode";
}

function detectTargetId(): TargetId {
  const zcode = findExecutable(ZCODE);
  const workbuddy = findExecutable(WORKBUDDY);
  if (workbuddy && !zcode) return "workbuddy";
  return "zcode";
}

export function setTarget(requested?: string | TargetId): AppTarget {
  const id = resolveTargetId(requested);
  activeId = id;
  return TARGETS[id];
}

export function target(): AppTarget {
  return TARGETS[activeId ?? (activeId = resolveTargetId())];
}

/** Value of the first set env var in the target's list. */
export function targetEnv(app: AppTarget, names: string[]): string | undefined {
  for (const name of names) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}
