/**
 * T38 ZCode 4.0 adaptation:
 *   A startup probe: class-less 4.0 body + #loading waits; 3.18 class still
 *     waits; WorkBuddy skeleton still waits; a missing <body> is tolerated;
 *   B waiter lifecycle: disable while parked, reload/replay idempotence, clean
 *     teardown of startupMO/pendingBootstrap/panelMO;
 *   C chat width: the 4.0 `@min-[624px]/conversation:max-w-xl` holder and the
 *     version-proof `conversation:max-w-` selector;
 *   D manifest/surface protocol: ui.surfaces rules and MCP arg/env templates;
 *   E read-only session store: the 4.0 session/message/part/session_target
 *     columns still feed 会话预览 and the goal map.
 *
 * Run: npx tsx test/t38-zcode4.ts   (also part of: npm test)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { buildBootstrapScript, buildResetScript, isUpdaterTarget, pickRendererTargets, type InjectionPayload } from "../src/core/cdp.js";
import { buildPanelScript } from "../src/panel/panelScript.js";
import { buildPayload, DEFAULT_CONFIG, normalizeChatLook, type BeautifyConfig } from "../src/core/inject.js";
import { readGoalSessions, readSessionPreview, sessionDbPath } from "../src/core/sessionStore.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const root = fileURLToPath(new URL("../", import.meta.url));

function bootPayload(overrides: Partial<InjectionPayload> = {}): InjectionPayload {
  const config: BeautifyConfig = {
    ...DEFAULT_CONFIG,
    monet: false,
    wallpaperVisible: true,
    chatLook: { ...normalizeChatLook(), widthCapRem: 72, widthInsetRem: 12 },
  };
  return {
    css: buildPayload(config).css,
    wallpaperDataUri: "data:image/jpeg;base64,AAAA",
    videoSrc: "",
    fit: "cover",
    transition: "fade",
    chatLook: config.chatLook as Required<NonNullable<BeautifyConfig["chatLook"]>>,
    bubbleLook: { preset: "default", tint: 28, radius: 12, width: 70, align: "right" },
    spinnerLook: { mode: "default", image: "", spin: true, size: 16 },
    chatLoadLook: { mode: "default", image: "", spin: true, size: 16 },
    listPaging: { initial: 0, step: 0, collapse: 0, showTotal: 0, collapseAll: 0 },
    startupClean: true,
    chatUi: true,
    startupProbe: "zcode-body-class",
    ...overrides,
  };
}
function makeDom(html: string) {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: "http://127.0.0.1/",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  }).window as any;
}
async function waitFor(fn: () => boolean, ms = 1200): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(20);
  }
  return fn();
}
const hasWallpaper = (w: any) => !!w.document.getElementById("zcode-beautify-wallpaper");
const hasPanel = (w: any) => !!w.document.getElementById("zcode-beautify-panel-root");

// --- A: startup probes -------------------------------------------------------
{
  // ZCode 4.0: class-less body + full-screen #loading until zcode-startup-ready.
  const w = makeDom('<div id="root"></div><div id="loading"></div>');
  w.eval(buildBootstrapScript(bootPayload()));
  check("A1 4.0 startup screen: no wallpaper while #loading is visible", !hasWallpaper(w));
  check("A2 4.0 startup screen: a waiter is armed", !!w.__zcodeBeautify?.startupMO);
  w.document.body.className = "zcode-startup-ready";
  w.document.getElementById("loading").remove();
  check("A3 4.0 ready: wallpaper mounts", await waitFor(() => hasWallpaper(w)));
  check("A4 4.0 ready: waiter disarmed", !w.__zcodeBeautify?.startupMO);

  // ZCode 3.18: body carries zcode-startup* until -ready.
  const old = makeDom('<div id="root"></div>');
  old.document.body.className = "zcode-startup";
  old.eval(buildBootstrapScript(bootPayload()));
  check("A5 3.18 startup class still waits", !hasWallpaper(old));
  old.document.body.className = "zcode-startup-ready";
  check("A6 3.18 ready mounts", await waitFor(() => hasWallpaper(old)));

  // WorkBuddy skeleton overlay keeps its own probe.
  const wb = makeDom('<div id="root"></div><div id="sk-overlay">loading</div>');
  wb.eval(buildBootstrapScript(bootPayload({ startupProbe: "workbuddy-skeleton" })));
  check("A7 WorkBuddy skeleton waits", !hasWallpaper(wb));
  wb.document.getElementById("sk-overlay").remove();
  wb.document.getElementById("root").appendChild(wb.document.createElement("div"));
  check("A8 WorkBuddy ready mounts", await waitFor(() => hasWallpaper(wb)));

  // document-start replay: <body> does not exist yet.
  const early = makeDom('<div id="root"></div>');
  const body = early.document.body;
  early.document.documentElement.removeChild(body);
  early.eval(buildBootstrapScript(bootPayload()));
  check("A9 missing <body> arms the waiter instead of throwing", !early.__zcodeBeautify?.timing?.bootstrapMs);
  const fresh = early.document.createElement("body");
  fresh.innerHTML = '<div id="root"></div><div id="loading"></div>';
  early.document.documentElement.appendChild(fresh);
  check("A10 body created during startup still waits", !hasWallpaper(early));
  fresh.className = "zcode-startup-ready";
  fresh.querySelector("#loading").remove();
  check("A11 body + ready mounts", await waitFor(() => hasWallpaper(early)));
}

// --- B: disable/replay/idempotence -------------------------------------------
{
  // Disable while the bootstrap is parked behind the startup screen.
  const w = makeDom('<div id="root"></div><div id="loading"></div>');
  w.eval(buildBootstrapScript(bootPayload()));
  await sleep(30);
  w.eval(buildResetScript("zcode-beautify", { disable: true }));
  w.document.body.className = "zcode-startup-ready";
  w.document.getElementById("loading").remove();
  await sleep(200);
  check("B1 disable while waiting cancels the parked mount", !hasWallpaper(w));
  check("B2 disable disconnects startupMO", !w.__zcodeBeautify?.startupMO);
  check("B3 disable clears pendingBootstrap", !w.__zcodeBeautify?.pendingBootstrap);
  check("B4 disable marker persisted", w.localStorage.getItem("zcode-beautify:disabled") === "1");

  // Replay/reload idempotence: several registrations evaluate the bootstrap.
  const r = makeDom('<div id="root"></div>');
  r.eval(buildBootstrapScript(bootPayload()));
  r.eval(buildBootstrapScript(bootPayload()));
  check("B5 repeated startup evals keep one waiter", r.document.querySelectorAll("#zcode-beautify-style").length === 1);
  r.document.body.className = "zcode-startup-ready";
  await waitFor(() => hasWallpaper(r));
  check("B6 one wallpaper after replay", r.document.querySelectorAll("#zcode-beautify-wallpaper").length === 1);
  r.eval(buildBootstrapScript(bootPayload()));
  check("B7 eval after ready is idempotent", r.document.querySelectorAll("#zcode-beautify-wallpaper").length === 1);

  // Panel: waits on the same startup screen, disarms on disable, is idempotent.
  const p = makeDom('<div id="root"></div><div id="loading"></div>');
  p.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  p.eval(buildPanelScript(9223, "tok", true, { appName: "ZCode" }));
  check("B8 panel waits during startup", !hasPanel(p));
  p.document.body.className = "zcode-startup-ready";
  p.document.getElementById("loading").remove();
  check("B9 panel mounts after ready", await waitFor(() => hasPanel(p)));
  p.eval(buildPanelScript(9223, "tok", true, { appName: "ZCode" }));
  check("B10 repeated panel eval keeps one root", p.document.querySelectorAll("#zcode-beautify-panel-root").length === 1);

  const pd = makeDom('<div id="root"></div><div id="loading"></div>');
  pd.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  pd.eval(buildPanelScript(9223, "tok", true, { appName: "ZCode" }));
  await sleep(30);
  pd.eval(buildResetScript("zcode-beautify", { disable: true }));
  pd.document.body.className = "zcode-startup-ready";
  pd.document.getElementById("loading").remove();
  await sleep(250);
  check("B11 disable while panel waits cancels the mount", !hasPanel(pd));
  check("B12 panel waiter disarmed", !pd.__zcodeBeautify?.panelMO && !pd.__zcodeBeautify?.pendingPanel);
}

// --- C: 4.0 chat width anchor ------------------------------------------------
{
  const boot = buildBootstrapScript(bootPayload());
  check("C1 4.0 width holder selector baked", boot.includes('[class*="/conversation:max-w-xl"]'));
  check("C2 624px container tier baked", boot.includes("@container conversation (min-width:624px)"));
  const runtimeCapNeedle = `[class*="/conversation:max-w-xl"]{max-width:' + cap + 'rem!important`;
  check("C3 4.0 rule reads the runtime cap", boot.includes(runtimeCapNeedle));
  check("C4 drag/JS uses the version-proof holder selector", boot.includes(`querySelector('[class*="conversation:max-w-"]')`));

  const drag = buildBootstrapScript(bootPayload({
    chatLook: { ...normalizeChatLook(), widthCapRem: 72, widthInsetRem: 12, dragResize: 1 },
  }));
  check("C5 drag tiers include the 4.0 holder", drag.includes('[class*="/conversation:max-w-xl"]{max-width:var(--zb-chat-w'));
  check("C6 grip transition rule is generic", drag.includes('html.zb-grip-active [class*="conversation:max-w-"]{transition:none'));
}

// --- D: manifest / ui.surfaces protocol --------------------------------------
{
  const manifest = JSON.parse(fs.readFileSync(path.join(root, ".zcode-plugin/plugin.json"), "utf8"));
  const servers = Object.keys(manifest.mcpServers ?? {});
  const args = manifest.mcpServers?.["zcode-beautify"]?.args ?? [];
  const env = manifest.mcpServers?.["zcode-beautify"]?.env ?? {};
  check("D1 MCP command exists", manifest.mcpServers?.["zcode-beautify"]?.command === "node");
  check("D2 MCP entry uses ${CLAUDE_PLUGIN_ROOT}", args.some((a: string) => a.includes("${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js")));
  check("D3 MCP env uses ${ZCODE_PLUGIN_DATA}", env.ZCODE_BEAUTIFY_DATA_DIR === "${ZCODE_PLUGIN_DATA}");

  const surfaces = manifest.ui?.surfaces ?? [];
  check("D4 exactly one surface declared", surfaces.length === 1);
  const s = surfaces[0] ?? {};
  check("D5 surface id matches the 4.0 [A-Za-z0-9][A-Za-z0-9_.-]{0,127} rule",
    typeof s.id === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(s.id));
  check("D6 surface title has a non-empty locale map", s.title && typeof s.title.en === "string" && typeof s.title["zh-CN"] === "string");
  check("D7 surface server names a declared MCP server", servers.includes(s.server));
  check("D8 surface resourceUri is ui:// and <=2048", typeof s.resourceUri === "string" && s.resourceUri.startsWith("ui://") && s.resourceUri.length <= 2048);
  check("D9 surface availability is session", s.availability === "session");
}

// --- F: 4.0 target identification -------------------------------------------
{
  const base = "file:///D:/soft/zcode/resources/app.asar/out/renderer/index.html";
  const targets = [
    { id: "main", type: "page", title: "ZCode", url: `${base}?restoreSession=true&supportsSettings=true&zcodeLaunchMarks=%7B%7D`, webSocketDebuggerUrl: "ws://x/main" },
    { id: "updater", type: "page", title: "ZCode", url: `${base}?windowKind=update-status`, webSocketDebuggerUrl: "ws://x/upd" },
    { id: "sandbox", type: "page", title: "", url: "file:///D:/soft/zcode/resources/app.asar/out/renderer/plugin-sandbox.html", webSocketDebuggerUrl: "ws://x/sb" },
    { id: "resources", type: "page", title: "Resource Manager", url: "file:///D:/soft/zcode/resources/app.asar/out/renderer/resource-manager.html", webSocketDebuggerUrl: "ws://x/rm" },
    { id: "worker", type: "worker", title: "", url: "", webSocketDebuggerUrl: "ws://x/w" },
  ];
  const picked = pickRendererTargets(targets as any[]);
  check("F1 4.0 main window is picked (restoreSession URL)", picked.some((t) => t.id === "main"));
  check("F2 update-status window is picked for its opt-in scrub path", picked.some((t) => t.id === "updater"));
  check("F3 plugin-sandbox/resource-manager pages are not picked", !picked.some((t) => t.id === "sandbox" || t.id === "resources"));
  check("F4 workers are never picked", !picked.some((t) => t.id === "worker"));
  check("F5 windowKind=update-status is identified as the updater", isUpdaterTarget(targets[1]) && !isUpdaterTarget(targets[0]));
}

// --- E: 4.0 read-only session store -----------------------------------------
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zb-t38-db-"));
  const dbPath = sessionDbPath(home);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, time_updated INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, sequence INTEGER, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, sequence INTEGER, data TEXT);
    CREATE TABLE session_target (session_id TEXT PRIMARY KEY, status TEXT, summary_title TEXT);
    INSERT INTO session VALUES ('sess_4x', 'Title 4.0', 1700000000000);
    INSERT INTO message VALUES ('msg_1', 'sess_4x', 1, 1700000000000, '{"role":"user","time":{"created":1700000000000}}');
    INSERT INTO part VALUES ('part_1', 'msg_1', 'sess_4x', 1, '{"type":"text","text":"prompt from 4.0"}');
    INSERT INTO session_target VALUES ('sess_4x', 'active', 'Goal from 4.0');
  `);
  db.close();
  const preview = await readSessionPreview("sess_4x", home);
  check("E1 4.0 session preview reads the real prompt", preview.ok && preview.data.prompts.length === 1 && preview.data.prompts[0].text === "prompt from 4.0");
  const goals = await readGoalSessions(home);
  check("E2 4.0 goal map reads session_target.summary_title", goals.ok && goals.sessions["sess_4x"]?.title === "Goal from 4.0");
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(failed === 0 ? "\nT38 all green" : `\nT38: ${failed} check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
