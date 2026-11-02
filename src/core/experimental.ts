/**
 * Mechanics of the experimental opt-in gate, shared by the MCP tools and the
 * CLI. Messaging stays at the surfaces; this module only touches config, the
 * launch entries, and the live service.
 *
 * Enabled (default OFF since 0.6.0): the serve daemon auto-starts, launch
 * entries self-heal, and the injection tools act. Disabled: the plugin stays
 * inert — no daemon, no launch-entry writes — and `disableExperimental` rolls
 * back what enabling wrote. The stored wallpaper settings are kept on disable,
 * so re-enabling later restores the look.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { dataDir, ensureExperimentalGate, loadConfig, saveConfig } from "./launch.js";
import { resetZCode } from "./inject.js";
import { target } from "./target.js";
import { VERSION } from "../version.js";
import type { RepairReport } from "./launchers.js";

export interface GateReport {
  enabled: boolean;
  port: number;
  apiPort: number;
  /** add/remove report from the launcher pass (undefined when skipped). */
  launchers?: RepairReport;
}

/** Spawn the detached serve daemon unless a healthy one owns the API port. */
export function spawnServeDetached(apiPort: number, cliJs: string): void {
  fetch(`http://127.0.0.1:${apiPort}/api/health`, { signal: AbortSignal.timeout(1500) })
    .then((r) => {
      if (!r.ok) throw new Error("unhealthy");
      return r.json();
    })
    .then((body) => {
      const h = body as { service?: string; target?: string };
      if (h?.service !== "zcode-beautify" || (h.target ?? "zcode") !== target().id) {
        throw new Error("foreign service");
      }
    })
    .catch(() => {
      try {
        const childEnv = { ...process.env };
        spawn(process.execPath, [cliJs, "serve", "--detach", "--api-port", String(apiPort)], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
          env: childEnv,
        }).unref();
      } catch {
        /* best effort */
      }
    });
}

/**
 * Records explicit consent (timestamp + version) and repairs the launch
 * entries. The client itself still needs one full restart unless it already
 * runs with the flag; the caller decides whether to spawn the daemon now.
 */
export async function enableExperimental(): Promise<GateReport> {
  const cfg = ensureExperimentalGate();
  cfg.experimental = {
    enabled: true,
    consentedAt: new Date().toISOString(),
    consentVersion: VERSION,
  };
  saveConfig(cfg);
  const port = cfg.port ?? target().cdpPort;
  const apiPort = cfg.apiPort ?? target().apiPort;
  const { repairLaunchers } = await import("./launchers.js");
  const launchers = await repairLaunchers({ port });
  return { enabled: true, port, apiPort, launchers };
}

export interface DisableTeardown {
  /** "service" = daemon route (also wipes the renderer cache), "cdp" = direct
   *  reset over CDP, "none" = nothing was live. */
  via: "service" | "cdp" | "none";
  windows: number;
}

/**
 * Tears the live injection down. The daemon route is preferred because it also
 * wipes the renderer's cached copy (localStorage) — a reset that left it would
 * let the look walk right back after restart.
 */
async function teardownLive(): Promise<DisableTeardown> {
  const cfg = loadConfig();
  const port = cfg.port ?? target().cdpPort;
  try {
    const tokenFile = path.join(dataDir(), "serve.token");
    if (existsSync(tokenFile)) {
      const token = readFileSync(tokenFile, "utf8").trim();
      const apiPort = cfg.apiPort ?? target().apiPort;
      const res = await fetch(`http://127.0.0.1:${apiPort}/api/experimental/disable`, {
        method: "POST",
        headers: { "X-Beautify-Token": token },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) return { via: "service", windows: 0 };
    }
  } catch {
    /* service not running */
  }
  try {
    const windows = await resetZCode(port);
    return { via: "cdp", windows };
  } catch {
    return { via: "none", windows: 0 };
  }
}

/** Gate off + live teardown + (by default) strip the flag from launch entries. */
export async function disableExperimental(
  opts: { cleanLaunchers?: boolean } = {}
): Promise<GateReport & { teardown: DisableTeardown }> {
  const cfg = loadConfig();
  const port = cfg.port ?? target().cdpPort;
  const teardown = await teardownLive();
  cfg.experimental = { enabled: false };
  saveConfig(cfg);
  let launchers: RepairReport | undefined;
  if (opts.cleanLaunchers ?? true) {
    const { repairLaunchers } = await import("./launchers.js");
    launchers = await repairLaunchers({ port, action: "remove" });
  }
  return { enabled: false, port, apiPort: cfg.apiPort ?? target().apiPort, launchers, teardown };
}
