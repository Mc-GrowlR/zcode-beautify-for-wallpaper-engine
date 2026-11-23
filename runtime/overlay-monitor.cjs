/* zcode-beautify overlay pending-swap monitor.
 *
 * Windows keeps app.asar locked while ZCode runs, and the `/install-overlay`
 * command itself runs inside a ZCode session — so the patched asar is staged
 * as `app.asar.beautify.tmp` plus `overlay-pending.json`, and this detached
 * process swaps it in after the client fully exits.
 *
 * It re-reads the pending record every tick, so a newer install/remove request
 * replaces the older plan. The source asar's size/mtime are checked before the
 * rename: if ZCode updated while we waited, the staged copy is stale and is
 * discarded (its injection line would not match the new build anyway).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const HERE = __dirname;
const PENDING = path.join(HERE, "overlay-pending.json");
const STATE = path.join(HERE, "overlay.json");
const LOG = path.join(HERE, "overlay.log");
const MAX_LOG = 256 * 1024;
const TICK_MS = 10000;
const FAST_TICK_MS = 2000;
const FAST_WINDOW_MS = 2 * 60 * 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STARTED_AT = Date.now();

function log() {
  try {
    const line = `[${new Date().toISOString()}] [monitor] ${Array.prototype.join.call(arguments, " ")}\n`;
    try {
      if (fs.statSync(LOG).size > MAX_LOG) {
        fs.rmSync(LOG + ".1", { force: true });
        fs.renameSync(LOG, LOG + ".1");
      }
    } catch (e) { /* no log yet */ }
    fs.appendFileSync(LOG, line);
  } catch (e) { /* never throw */ }
}

function readPending() {
  try {
    const parsed = JSON.parse(fs.readFileSync(PENDING, "utf8"));
    return parsed && parsed.tmp && parsed.asar ? parsed : undefined;
  } catch (e) {
    return undefined;
  }
}

function updateState(mode) {
  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE, "utf8")) || {}; } catch (e) { /* first run */ }
  const now = new Date().toISOString();
  state.schema = 1;
  state.installed = mode === "install";
  state.updatedAt = now;
  state.lastResult = mode === "install" ? "applied" : "removed";
  if (mode === "remove") state.removedAt = now;
  try {
    const tmp = STATE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE);
  } catch (e) {
    log("state update failed:", e && e.message ? e.message : String(e));
  }
}

function appRunning() {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("tasklist", ["/NH", "/FI", "IMAGENAME eq ZCode.exe"], {
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true,
      });
      return out.toLowerCase().includes("zcode.exe");
    }
    for (const name of ["ZCode", "zcode"]) {
      try {
        const out = execFileSync("pgrep", ["-x", name], { encoding: "utf8", timeout: 10000 });
        if (out.trim().length > 0) return true;
      } catch (e) { /* not this name */ }
    }
    return false;
  } catch (e) {
    return false;
  }
}

function discard(pending, reason) {
  log("discarding pending " + pending.mode + ": " + reason);
  try { fs.rmSync(pending.tmp, { force: true }); } catch (e) { /* best effort */ }
  try { fs.rmSync(PENDING, { force: true }); } catch (e) { /* best effort */ }
  process.exit(0);
}

function tick() {
  const pending = readPending();
  if (!pending) {
    log("no pending package; exiting");
    process.exit(0);
  }
  if (!fs.existsSync(pending.tmp)) discard(pending, "staged package is missing");
  if (Date.now() - Number(pending.createdAt || 0) > MAX_AGE_MS) discard(pending, "older than 24h");
  let st;
  try { st = fs.statSync(pending.asar); }
  catch (e) { discard(pending, "target asar disappeared"); }
  if (st.size !== pending.source.size || Math.abs(st.mtimeMs - pending.source.mtimeMs) > 1) {
    discard(pending, "app.asar changed after staging (client update?)");
  }
  if (appRunning()) return;
  try {
    fs.renameSync(pending.tmp, pending.asar);
    updateState(pending.mode);
    try { fs.rmSync(PENDING, { force: true }); } catch (e) { /* best effort */ }
    log("applied " + pending.mode + " to " + pending.asar);
    process.exit(0);
  } catch (e) {
    log("swap failed, retrying:", e && e.message ? e.message : String(e));
  }
}

log("started for " + (readPending() || {}).asar);
(function schedule() {
  tick();
  const delay = Date.now() - STARTED_AT < FAST_WINDOW_MS ? FAST_TICK_MS : TICK_MS;
  setTimeout(schedule, delay);
})();
