/**
 * Host plugin-manager gate.
 *
 * ZCode / WorkBuddy only launch a plugin's MCP server while the plugin is
 * enabled in their own plugin manager. That switch lives in the host's user
 * config (`~/.zcode/cli/config.json` or `~/.workbuddy/settings.json`, under
 * `enabledPlugins`). The beautify serve daemon is deliberately detached so it
 * survives MCP/session restarts — which also means it survived the plugin
 * being switched off, and kept repainting the old theme on every CDP attach.
 *
 * This module is the single place that answers "did the host switch us off?".
 * Fail-open is deliberate: a missing/unreadable/invalid config, or a config
 * with no entry for our ids, is "unknown" and never stops a running daemon.
 * Only an explicit `false` is authoritative.
 *
 * The user-level (global) false wins over a workspace-level true: the daemon
 * is a single global process, and the plugin manager's main switch is expected
 * to turn the injection off everywhere. A workspace-level false still stops
 * it for the workspace whose config we can see (the process cwd tree).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { target, type TargetId } from "./target.js";

/** Manifest names this plugin is installed under, one per host. */
const PLUGIN_NAMES = ["zcode-beautify", "zcode-beautify-workbuddy"] as const;

const HOST_CONFIG_ENV: Record<TargetId, string> = {
  zcode: "ZCODE_BEAUTIFY_HOST_CONFIG",
  workbuddy: "WORKBUDDY_BEAUTIFY_HOST_CONFIG",
};

export interface HostPluginState {
  /** At least one matching `enabledPlugins` entry was found. */
  known: boolean;
  /** Effective state when known; false only when the host switched us off. */
  enabled: boolean;
  /** Config file that supplied the decisive entry (for logs/tests). */
  source?: string;
}

export interface HostPluginOptions {
  targetId?: TargetId;
  home?: string;
  env?: NodeJS.ProcessEnv;
  /** Usually process.cwd(); used to find the workspace `.zcode/config.json`. */
  workingDirectory?: string;
}

interface ScopeValues {
  file: string;
  scope: "user" | "workspace";
  values: boolean[];
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** `plugins.enabledPlugins` (ZCode) or top-level `enabledPlugins` (WorkBuddy). */
function enabledPluginsMap(raw: unknown, targetId: TargetId): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const plugins =
    record.plugins && typeof record.plugins === "object" && !Array.isArray(record.plugins)
      ? (record.plugins as Record<string, unknown>)
      : undefined;
  const maps =
    targetId === "workbuddy"
      ? [record.enabledPlugins, plugins?.enabledPlugins]
      : [plugins?.enabledPlugins, record.enabledPlugins];
  for (const map of maps) {
    if (map && typeof map === "object" && !Array.isArray(map)) {
      return map as Record<string, unknown>;
    }
  }
  return undefined;
}

function matchingValues(map: Record<string, unknown> | undefined): boolean[] {
  if (!map) return [];
  const values: boolean[] = [];
  for (const [id, value] of Object.entries(map)) {
    if (typeof value !== "boolean") continue;
    const name = id.split("@", 1)[0];
    if (PLUGIN_NAMES.includes(name as (typeof PLUGIN_NAMES)[number])) values.push(value);
  }
  return values;
}

function readScope(file: string, scope: "user" | "workspace", targetId: TargetId): ScopeValues | undefined {
  const values = matchingValues(enabledPluginsMap(readJson(file), targetId));
  return values.length ? { file, scope, values } : undefined;
}

/** Default user config for the active host. */
function userConfigPath(targetId: TargetId, home: string, env: NodeJS.ProcessEnv): string {
  const override = env[HOST_CONFIG_ENV[targetId]]?.trim();
  if (override) return path.resolve(override);
  return targetId === "workbuddy"
    ? path.join(home, ".workbuddy", "settings.json")
    : path.join(home, ".zcode", "cli", "config.json");
}

/**
 * Nearest ancestor `.zcode/config.json` (ZCode merges project configs; this
 * is the one that applies to the workspace launching the MCP server).
 */
function workspaceConfigPath(workingDirectory: string): string | undefined {
  let dir = path.resolve(workingDirectory);
  for (;;) {
    const candidate = path.join(dir, ".zcode", "config.json");
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function samePath(a: string, b: string): boolean {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  return process.platform === "win32" ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

export function hostPluginState(options: HostPluginOptions = {}): HostPluginState {
  const targetId = options.targetId ?? target().id;
  const home = options.home ?? os.homedir();
  const env = options.env ?? process.env;
  const cwd = options.workingDirectory ?? process.cwd();

  const userFile = userConfigPath(targetId, home, env);
  const found: ScopeValues[] = [];
  const user = readScope(userFile, "user", targetId);
  if (user) found.push(user);
  if (targetId === "zcode") {
    const workspace = workspaceConfigPath(cwd);
    if (workspace && !samePath(workspace, userFile)) {
      const scope = readScope(workspace, "workspace", targetId);
      if (scope) found.push(scope);
    }
  }
  if (!found.length) return { known: false, enabled: true };

  const userValues = found.filter((f) => f.scope === "user").flatMap((f) => f.values);
  const workspaceValues = found.filter((f) => f.scope === "workspace").flatMap((f) => f.values);
  const userEnabled = userValues.includes(true) ? true : userValues.includes(false) ? false : undefined;
  const workspaceEnabled = workspaceValues.includes(true)
    ? true
    : workspaceValues.includes(false)
      ? false
      : undefined;

  // Global off beats a workspace override: one daemon serves every window.
  if (userEnabled === false) {
    return { known: true, enabled: false, source: found.find((f) => f.scope === "user")?.file };
  }
  if (workspaceEnabled === false) {
    return { known: true, enabled: false, source: found.find((f) => f.scope === "workspace")?.file };
  }
  if (userEnabled === true || workspaceEnabled === true) {
    return { known: true, enabled: true, source: (found.find((f) => f.values.includes(true)) ?? found[0]).file };
  }
  return { known: false, enabled: true };
}

/** Convenience: true only on an explicit host `false` for this plugin. */
export function hostPluginDisabled(options: HostPluginOptions = {}): boolean {
  const state = hostPluginState(options);
  return state.known && !state.enabled;
}
