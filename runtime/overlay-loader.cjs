/* zcode-beautify startup overlay loader (main process).
 *
 * Installed by appending one dynamic import line to ZCode's app.asar main
 * entry (`out/main/index.js`). That line runs before `app.ready` and loads
 * this file, which:
 *   1) forces the CDP debug port on, because a packaged ZCode does not open
 *      one by itself and a client update rebuilds the shortcut without the
 *      --remote-debugging-port flag;
 *   2) keeps the detached beautify `serve` daemon alive, so the wallpaper,
 *      theme and settings panel load even when the plugin manager's settings
 *      were cleared and the MCP bootstrap never ran.
 *
 * It never paints the renderer directly: serve attaches over CDP and owns the
 * whole injection pipeline. Every failure is logged and swallowed — a broken
 * overlay must never prevent ZCode from starting.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const HERE = __dirname;
const CONFIG = path.join(HERE, "..", "config.json");
const OPTOUT = path.join(HERE, ".plugin-overlay-optout");
const CLI = path.join(HERE, "beautify-cli.mjs");
const LOG = path.join(HERE, "overlay.log");
const MAX_LOG = 256 * 1024;

function log() {
  try {
    const line = `[${new Date().toISOString()}] ${Array.prototype.join.call(arguments, " ")}\n`;
    try {
      if (fs.statSync(LOG).size > MAX_LOG) {
        fs.rmSync(LOG + ".1", { force: true });
        fs.renameSync(LOG, LOG + ".1");
      }
    } catch (e) { /* no log yet */ }
    fs.appendFileSync(LOG, line);
  } catch (e) { /* logging must never throw */ }
}

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch (e) {
    return undefined;
  }
}

/* Host plugin-manager switch: an explicit false stops the overlay even though
 * it was installed. A missing/cleared config is fail-open — that is exactly
 * the "settings were wiped by an update" case this feature exists for. */
function hostPluginEnabled() {
  const override = process.env.ZCODE_BEAUTIFY_HOST_CONFIG;
  const file = override && override.trim()
    ? override.trim()
    : path.join(os.homedir(), ".zcode", "cli", "config.json");
  const cfg = readJson(file);
  if (!cfg) return true;
  const maps = [];
  if (cfg.plugins && typeof cfg.plugins === "object") maps.push(cfg.plugins.enabledPlugins);
  maps.push(cfg.enabledPlugins);
  let sawEntry = false;
  for (const map of maps) {
    if (!map || typeof map !== "object") continue;
    for (const key of Object.keys(map)) {
      const name = key.split("@")[0];
      if (name !== "zcode-beautify" && name !== "zcode-beautify-workbuddy") continue;
      if (map[key] === false) return false;
      if (map[key] === true) sawEntry = true;
    }
  }
  return true;
}

function overlayEnabled() {
  if (fs.existsSync(OPTOUT)) {
    log("disabled: .plugin-overlay-optout present");
    return false;
  }
  if (!hostPluginEnabled()) {
    log("disabled: plugin switched off in ZCode's plugin manager");
    return false;
  }
  const cfg = readJson(CONFIG);
  // A missing config is treated as enabled (overlay installation is explicit
  // consent); an explicit experimental.enabled=false is the user's disable.
  if (cfg && cfg.experimental && cfg.experimental.enabled === false) {
    log("disabled: experimental.enabled=false");
    return false;
  }
  return true;
}

function getConfig() {
  const cfg = readJson(CONFIG) || {};
  return {
    port: Number(cfg.port) > 0 ? Number(cfg.port) : 9222,
    apiPort: Number(cfg.apiPort) > 0 ? Number(cfg.apiPort) : 9223,
  };
}

function forceCdp(port) {
  const electron = require("electron");
  const app = electron && electron.app;
  if (!app || !app.commandLine) return false;
  if (typeof app.commandLine.hasSwitch === "function" && app.commandLine.hasSwitch("remote-debugging-port")) {
    log("CDP port already supplied by the launch command; leaving it alone");
    return false;
  }
  app.commandLine.appendSwitch("remote-debugging-port", String(port));
  // Keep wallpaper video/timers alive while the window is unfocused. Merge
  // into an existing --disable-features list instead of replacing it.
  try {
    const feature = "CalculateNativeWinOcclusion";
    const current = typeof app.commandLine.getSwitchValue === "function"
      ? app.commandLine.getSwitchValue("disable-features")
      : "";
    const parts = String(current || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.includes(feature)) {
      parts.push(feature);
      app.commandLine.appendSwitch("disable-features", parts.join(","));
    }
    app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
    app.commandLine.appendSwitch("disable-renderer-backgrounding");
  } catch (e) {
    log("extra launch switches failed:", e && e.message ? e.message : String(e));
  }
  log("forced --remote-debugging-port=" + port);
  return true;
}

function probe(apiPort, callback) {
  let settled = false;
  const finish = (ok) => {
    if (settled) return;
    settled = true;
    callback(ok);
  };
  try {
    const req = http.get(
      { host: "127.0.0.1", port: apiPort, path: "/api/health", timeout: 1200 },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          try {
            const health = JSON.parse(body);
            finish(health && health.service === "zcode-beautify");
          } catch (e) {
            finish(false);
          }
        });
      }
    );
    req.on("timeout", () => { req.destroy(); finish(false); });
    req.on("error", () => finish(false));
  } catch (e) {
    finish(false);
  }
}

let attempts = 0;
let lastSpawnAt = 0;
let healthy = false;

function spawnServe(kind, port, apiPort) {
  const args = [CLI, "serve", "--detach", "--port", String(port), "--api-port", String(apiPort)];
  const env = Object.assign({}, process.env);
  let command;
  if (kind === "electron") {
    command = process.execPath;
    env.ELECTRON_RUN_AS_NODE = "1";
  } else {
    command = "node";
  }
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env,
      cwd: HERE,
    });
    child.on("error", (e) => log("serve spawn (" + kind + ") failed:", e && e.message ? e.message : String(e)));
    child.unref();
    log("spawned serve via " + kind + " (api port " + apiPort + ")");
  } catch (e) {
    log("serve spawn (" + kind + ") threw:", e && e.message ? e.message : String(e));
  }
}

function ensureServe() {
  if (attempts > 12) return;
  if (!fs.existsSync(CLI)) {
    log("beautify-cli.mjs missing; overlay cannot start serve");
    return;
  }
  const cfg = getConfig();
  probe(cfg.apiPort, (ok) => {
    if (ok) {
      if (!healthy) log("serve is healthy on api port " + cfg.apiPort);
      healthy = true;
      attempts = 0;
      return;
    }
    healthy = false;
    if (Date.now() - lastSpawnAt < 15000) return;
    lastSpawnAt = Date.now();
    attempts += 1;
    // Node from PATH is the normal route (the plugin host launches MCP with
    // it); every third attempt falls back to Electron-as-Node in case the
    // app's PATH differs from a shell's.
    spawnServe(attempts % 3 === 0 ? "electron" : "node", cfg.port, cfg.apiPort);
    setTimeout(() => probe(cfg.apiPort, (up) => { if (up) healthy = true; }), 4000);
  });
}

function boot() {
  if (!overlayEnabled()) return;
  const cfg = getConfig();
  forceCdp(cfg.port);
  log("overlay loaded (version marker v" + (readJson(path.join(HERE, "overlay.json")) || {}).version + ", cdp " + cfg.port + ", api " + cfg.apiPort + ")");
  ensureServe();
  const timer = setInterval(ensureServe, 45000);
  if (timer && typeof timer.unref === "function") timer.unref();
  try {
    const electron = require("electron");
    if (electron && electron.app && typeof electron.app.once === "function") {
      electron.app.once("ready", () => {
        setTimeout(ensureServe, 1500);
      });
    }
  } catch (e) { /* app unavailable: the interval still retries */ }
}

try {
  boot();
} catch (e) {
  log("overlay boot failed:", e && e.stack ? e.stack : String(e));
}
