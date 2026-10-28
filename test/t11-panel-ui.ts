/**
 * T11 PANEL UI verification: the injected settings panel built by
 * src/panel/panelScript.ts — the sidebar-navigation window layout
 * (壁纸 / 外观 / 聊天 / 轮播 / 通用, row-style settings).
 *
 * Two tiers, no live ZCode and no live serve needed:
 *   part 1  static contract on the generated script string — nav/pane
 *           structure, every JS-referenced element id exists in the HTML,
 *           no stale pre-redesign selectors survive;
 *   part 2  behavioral — the script runs inside jsdom against a mocked
 *           serve API, then is driven like a user: open, navigate, search,
 *           fold, tune sliders, flip switches, offline/online, Alt+B, close.
 *
 * Run: npx tsx test/t11-panel-ui.ts   (or: npm test)
 */
import { JSDOM, VirtualConsole } from "jsdom";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { buildPanelScript } from "../src/panel/panelScript.js";
import { VERSION } from "../src/version.js";
import {
  sanitizeCustomBubbleCss,
  rewriteCustomBubbleCss,
  BUBBLE_SELECTOR_REAL,
  BUBBLE_ROW_SELECTOR_REAL,
} from "../src/core/bubbleRecipes.js";
import { normalizeBubbleLook, buildPayload, DEFAULT_CONFIG } from "../src/core/inject.js";
import { buildBootstrapScript } from "../src/core/cdp.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SCRIPT = buildPanelScript(9223, "t11-token", false);

// --- part 1: static contract on the generated script -------------------------
{
  check("script embeds API base + token", SCRIPT.includes('"http://127.0.0.1:9223"') && SCRIPT.includes('"t11-token"'));

  // Navigation: six pages, one pane per page, one button per page.
  const TABS = ["main", "look", "chat", "sched", "settings", "about"];
  for (const t of TABS) check(`nav button data-tab=${t}`, SCRIPT.includes(`data-tab="${t}"`));
  for (const t of TABS) check(`pane #zb-tab-${t} exists`, SCRIPT.includes(`id="zb-tab-${t}"`));
  const tabButtons = SCRIPT.match(/class="zb-tab"/g)?.length ?? 0;
  check("exactly 6 nav buttons", tabButtons === 6, String(tabButtons));
  check("pane-in animation covers all six panes", TABS.every((t) => SCRIPT.includes(`#zb-tab-${t}.zb-pane-in`)));
  check("关于 nav pinned to the sidebar bottom", SCRIPT.includes('#zb-tabs .zb-tab[data-tab="about"] { margin-top: auto; }'));

  // Version module is the panel/health source of truth — must match package.json.
  const pkgVersion = JSON.parse(
    fs.readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  ).version as string;
  check("src/version.ts matches package.json", VERSION === pkgVersion, `${VERSION} vs ${pkgVersion}`);
  check("panel script bakes the version", SCRIPT.includes(`var VERSION = "${VERSION}"`));

  // Window shell + sidebar chrome.
  for (const id of [
    "zb-panel", "zb-head", "zb-close", "zb-mid", "zb-side", "zb-brand",
    "zb-search", "zb-nav-search", "zb-tabs", "zb-body", "zb-status",
    "zb-fab", "zb-hover-preview", "zb-offline", "zb-retry",
  ]) {
    check(`shell id #${id} in HTML`, SCRIPT.includes(`id="${id}"`));
  }
  // The status bar is a footer INSIDE the panel (before the panel closes,
  // before the hover preview that follows it in the DOM).
  const iPanel = SCRIPT.indexOf('id="zb-panel"');
  const iStatus = SCRIPT.indexOf('id="zb-status"');
  const iHover = SCRIPT.indexOf('id="zb-hover-preview"');
  check("status bar inside the panel shell", iPanel >= 0 && iPanel < iStatus && iStatus < iHover);

  // ID contract: every element id the JS grabs must exist as a static id=""
  // in the panel HTML — the regression net for HTML restructuring (a removed
  // id silently breaks $() lookups at click time, far from the change).
  const htmlIds = new Set(SCRIPT.match(/id="([A-Za-z0-9-]+)"/g)?.map((s) => s.slice(4, -1)) ?? []);
  const referenced = new Set<string>();
  for (const m of SCRIPT.matchAll(/\$\('([A-Za-z0-9-]+)'\)/g)) referenced.add(m[1]);
  for (const m of SCRIPT.matchAll(/getElementById\('([A-Za-z0-9-]+)'\)/g)) referenced.add(m[1]);
  // Array-driven lookups pass variables, so the regexes above cannot see them.
  for (const id of [
    "zb-lib-scenes", "zb-lib-images", "zb-rows-scenes", "zb-rows-images",
    "zb-dn-on", "zb-dn-start", "zb-dn-end", "zb-dn-daydim", "zb-dn-nightdim",
    "zb-dn-dayblur", "zb-dn-nightblur", "zb-res-w", "zb-res-h",
  ]) referenced.add(id);
  // Elements the SERVE side injects, or the panel creates at runtime (its own
  // <style>); pane ids are composed at runtime (zb-tab-<name>) and checked
  // explicitly above.
  const external = new Set(["zcode-beautify-wallpaper", "zcode-beautify-style", "zcode-beautify-panel-style"]);
  const missing = [...referenced].filter((id) => !htmlIds.has(id) && !external.has(id) && !id.startsWith("zb-tab-"));
  check("every JS-referenced id exists in panel HTML", missing.length === 0, missing.join(","));

  // The redesigned shell's load-bearing CSS.
  for (const sel of [
    "#zb-side {", "#zb-mid {", "#zb-search input {", "#zb-close {",
    ".zb-tab[data-active=\"1\"]::before", ".zb-block-title {", ".zb-card {",
    ".zb-set {", ".zb-set-main {", ".zb-sw input[type=checkbox]", ".zb-slide input[type=range]",
    ".zb-collapsed .zb-collapse-wrap", "#zb-status { flex: none",
  ]) {
    check(`css has ${sel}`, SCRIPT.includes(sel));
  }
  check("panel is a column window with FIXED height (pages never resize it)",
    SCRIPT.includes("flex-direction: column") && SCRIPT.includes("width: min(680px") && SCRIPT.includes("height: min(620px") && !SCRIPT.includes("max-height: min(620px"));
  // Short pages must not show raw blank below the last card: the visible
  // pane's last block stretches so its card runs to the bottom edge. Blocks
  // live inside pane divs (not directly under #zb-body), and the pane flex
  // rule must exclude [hidden] or it would un-hide inactive pages.
  check("visible pane fills the body as a flex column", SCRIPT.includes('[id^="zb-tab-"]:not([hidden]) { flex: 1; display: flex; flex-direction: column; }'));
  check("last block stretches to fill the pane", SCRIPT.includes('> .zb-block:last-child { flex: 1; display: flex; flex-direction: column; }'));
  check("stretch chain reaches foldable inners", SCRIPT.includes(".zb-collapse-inner { display: flex; flex-direction: column; flex: 1; }"));
  check("last card fills its block", SCRIPT.includes(".zb-card:last-child { flex: 1; }"));
  check("no stretch rule leaks onto hidden panes", !SCRIPT.includes('[id^="zb-tab-"] {'));

  // Stale pre-redesign structure must be gone.
  for (const stale of [
    ".zb-toggles", ".zb-sec ", ".zb-g2", "zb-sched-head",       // dropped classes
    'class="zb-card zb-collapsible"',                           // folds moved out of cards
    ">定时播放<",                                                // old top-tab label
    "right: '296px'",                                           // old hardcoded hover offset
  ]) {
    check(`stale marker gone: ${stale.trim()}`, !SCRIPT.includes(stale));
  }

  // Custom bubble style: dedicated editor WINDOW (✏️ button), sandboxed preview.
  check("preset dropdown has custom option", SCRIPT.includes('<option value="custom">自定义 CSS</option>'));
  // sandbox="allow-same-origin", NOT the empty sandbox: this Electron renderer
  // never commits an opaque-origin srcdoc document, so sandbox="" left the
  // preview blank forever (verified live via CDP). allow-same-origin commits
  // the frame AND still blocks scripts (no allow-scripts).
  check("preview iframe sandboxed without allow-scripts", SCRIPT.includes('sandbox="allow-same-origin"') && !SCRIPT.includes("allow-scripts"));
  check("empty sandbox removed (srcdoc never commits under it)", !SCRIPT.includes('sandbox=""'));
  check("preview recipes baked", SCRIPT.includes("var PV_RECIPES ="));
  check("✏️ edit button next to the preset dropdown", SCRIPT.includes('id="zb-bubble-edit"'));
  check("editor window exists", SCRIPT.includes('id="zb-bubble-win"'));
  check("window display:flex coexists with [hidden]", SCRIPT.includes("#zb-bubble-win[hidden] { display: none; }"));
  check("inline editor block gone (moved into the window)", !SCRIPT.includes('id="zb-bubble-editor"') && !SCRIPT.includes('id="zb-bubble-pv-block"'));
  // Re-examined editor: labeled sections + mirror sliders + explicit mode gate.
  check("window has labeled sections", SCRIPT.includes("实时预览") && SCRIPT.includes("基础参数") && SCRIPT.includes(".zb-win-sec {"));
  check("window mirrors the page sliders", SCRIPT.includes('id="zb-bubble-tint-w"') && SCRIPT.includes('id="zb-bubble-radius-w"') && SCRIPT.includes('id="zb-bubble-width-w"'));
  check("custom css is mode-gated", SCRIPT.includes('id="zb-bubble-css-gate"') && SCRIPT.includes('id="zb-bubble-gate-on"'));
  check("footer states the live-apply contract", SCRIPT.includes("所有更改实时生效并保存"));
  // Saved custom styles (我的样式): ➕ 存为样式 button + named chip library.
  check("➕ 存为样式 button exists", SCRIPT.includes('id="zb-bubble-add-style"'));
  check("name row + chip list exist", SCRIPT.includes('id="zb-bubble-style-name-row"') && SCRIPT.includes('id="zb-bubble-style-chips"'));
  check("flex chip containers carry the [hidden] guard", SCRIPT.includes("#zb-bubble-style-name-row[hidden], #zb-bubble-style-chips[hidden] { display: none; }"));
  check("style library persists in localStorage", SCRIPT.includes("'zcode-beautify:bubble-styles'"));
}

// --- part 1.5: custom-css pipeline units --------------------------------------
{
  check("sanitize strips </style", !sanitizeCustomBubbleCss(".zb-bubble{x}</style>").includes("</style"));
  check("sanitize strips @import", !sanitizeCustomBubbleCss("@import url(evil);.a{b:c}").includes("@import"));
  check("sanitize strips javascript: urls", !sanitizeCustomBubbleCss("background:url(javascript:1)").includes("javascript:"));
  check("sanitize caps length", sanitizeCustomBubbleCss("a".repeat(9000)).length <= 8000);
  check("sanitize passes plain css through", sanitizeCustomBubbleCss(".zb-bubble{color:red}") === ".zb-bubble{color:red}");
  const rw = rewriteCustomBubbleCss(".zb-bubble-row{a:1}.zb-bubble{b:2}.zb-bubble-x{c:3}", BUBBLE_SELECTOR_REAL, BUBBLE_ROW_SELECTOR_REAL);
  check("rewrite maps the row selector", rw.startsWith(BUBBLE_ROW_SELECTOR_REAL + "{a:1}"));
  check("rewrite maps the bubble selector", rw.includes(BUBBLE_SELECTOR_REAL + "{b:2}"));
  check("rewrite leaves similar class names alone", rw.includes(".zb-bubble-x{c:3}"));
  const nl = normalizeBubbleLook({ preset: "custom", customCss: ".zb-bubble{x}</style>", tint: 200 });
  check("normalize accepts the custom preset", nl.preset === "custom");
  check("normalize sanitizes customCss", !nl.customCss!.includes("</style"));
  check("normalize still clamps knobs", nl.tint === 100);
}

// --- part 1.6: queue wraps the input's two top rounded corners ----------------
// The queue (data-testid="v4-queue") sits 28px behind the input card's top
// edge. Stock ZCode is opaque, so only the notches outside the input's rounded
// corners show queue surface. With a translucent input the whole strip shows as
// a dark band; masking it away entirely leaves a hard cut. The theme therefore
// keeps queue paint only in those two corner notches, so the queue wraps the
// input's corners. Always-on theme css.
{
  const payload = buildPayload({ ...DEFAULT_CONFIG, port: 9222, dim: 0 });
  const css = payload.css;
  check("theme css carries the queue rule", css.includes('[data-testid="v4-queue"]'));
  const m = css.match(/\[data-testid="v4-queue"\]\s*\{([^}]*)\}/);
  const rule = m?.[1] ?? "";
  check("queue rule parsed from theme css", !!m);
  check("queue overlap matches pb-7/-mb-7 (28px)", rule.includes("--zb-queue-overlap: 28px"));
  check("queue corner radius matches rounded-2xl (16px)", rule.includes("--zb-queue-radius: 16px"));
  check("queue strip masked transparent", rule.includes("linear-gradient(to bottom, #000 calc(100% - var(--zb-queue-overlap)), transparent"));
  check("queue re-paints the corner notches",
    rule.includes("radial-gradient(circle at 100% 100%, transparent calc(var(--zb-queue-radius) - 1px), #000 var(--zb-queue-radius))") &&
    rule.includes("radial-gradient(circle at 0% 100%, transparent calc(var(--zb-queue-radius) - 1px), #000 var(--zb-queue-radius))"));
  check("queue wrap offset uses the calibrated position", rule.includes("0 var(--zb-queue-wrap-y)"));
  check("queue wrap offset lands on the input edge", rule.includes("calc(100% - (var(--zb-queue-overlap) - var(--zb-queue-radius)))"));
  check("queue mask has the -webkit- fallback", rule.includes("-webkit-mask-image"));
  check("queue rule paints no veil/stack (no band)", !rule.includes("background"));
  const sq = css.match(/body:has\(\[data-testid="v4-queue"\]\)[^{]*\{/);
  check("input card stays stock (no corner surgery)", !sq);
  const boot = buildBootstrapScript({
    css: "",
    chatLook: { chatDim: 40, maskTop: 0, maskBottom: 0, frost: 0, widthCapRem: 0, widthInsetRem: 0 },
    bubbleLook: { preset: "default", tint: 28, radius: 12, width: 70, align: "right" },
  });
  check("chat-dim still paints the column", boot.includes("--zb-chat-dim"));
}

// --- part 2: behavioral (jsdom + mocked serve API) ----------------------------
// A realistic /api/config payload (shape copied from a live serve response).
const FIXTURE = {
  blur: 7, dim: 25, monet: true, wallpaperVisible: true, kenBurns: false,
  videoVolume: 35, themeColor: null,
  dayNight: { enabled: true, start: "06:30", end: "18:30", dayDim: 20, nightDim: 55, dayBlur: 0, nightBlur: 6 },
  chatLook: { chatDim: 12, maskTop: 20, maskBottom: 10, frost: 5, widthCapRem: 0, widthInsetRem: 0, perfSmooth: 0 },
  bubbleLook: { preset: "glass", tint: 28, radius: 12, width: 70, align: "left", customCss: ".zb-bubble { outline: 1px dashed test; }" },
  startupClean: true, showOnUpdater: false, importRes: { mode: "auto" },
  fit: "contain", wallpaperSet: true, hasBackup: false,
  mediaType: "image", sceneHash: null, wallpaperPath: "C:/wp/a.png",
};

type Call = { method: string; path: string; body?: Record<string, unknown> };
const calls: Call[] = [];
let apiMode: "ok" | "down" = "ok";

function routeGet(path: string): unknown {
  if (path.startsWith("/api/config")) return FIXTURE;
  if (path.startsWith("/api/history")) return { items: [] };
  if (path.startsWith("/api/library")) return { scenes: [], images: [] };
  if (path.startsWith("/api/rotation")) return { rotation: { plans: [], activePlanId: null, enabled: false } };
  if (path.startsWith("/api/rotation-state")) return { on: false };
  if (path.startsWith("/api/storage")) return { scenesBytes: 2097152, thumbsBytes: 1048576 };
  if (path.startsWith("/api/palette")) return { colors: [], pinned: false };
  if (path.startsWith("/api/health")) return { ok: true, service: "zcode-beautify", pid: 4242, version: VERSION, uptimeMs: 65_000, cdpPort: 9222 };
  return {};
}

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://zb.test/",
  pretendToBeVisual: true,
  runScripts: "outside-only", // window.eval must run inside the jsdom realm
  // hideHoverPreview pauses the preview <video> on fold/close — jsdom's
  // "Not implemented" media complaints are noise, not failures.
  virtualConsole: new VirtualConsole(),
});
const w = dom.window as unknown as {
  fetch: unknown; eval: (s: string) => unknown; localStorage: Storage;
  clearInterval: (id: number) => void; Event: typeof Event; KeyboardEvent: typeof KeyboardEvent;
  __zbTimers?: number[]; document: Document;
};
w.fetch = (input: unknown, init?: { method?: string; body?: string }) => {
  const path = String(input).replace(/^https?:\/\/[^/]+/, "");
  calls.push({
    method: init?.method || "GET",
    path,
    body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
  });
  if (apiMode === "down") return Promise.reject(new Error("service down"));
  const data = init?.method === "POST" && path.startsWith("/api/config")
    ? { ok: true, windows: 1 }
    : routeGet(path);
  return Promise.resolve({ ok: true, json: async () => data });
};

w.eval(SCRIPT);
await sleep(150); // mount + initial refresh + first-open loaders settle

const doc = w.document;
const $id = (id: string) => doc.getElementById(id)!;
const input = (id: string) => $id(id) as HTMLInputElement;
const select = (id: string) => $id(id) as HTMLSelectElement;
const tabButton = (label: string) =>
  Array.from(doc.querySelectorAll<HTMLElement>(".zb-tab")).find((b) => (b.textContent || "").includes(label))!;
const fire = (el: Element, type: string) => el.dispatchEvent(new w.Event(type, { bubbles: true }));

// mount
check("panel root mounted", !!$id("zcode-beautify-panel-root"));
check("panel stylesheet injected", !!doc.getElementById("zcode-beautify-panel-style"));
check("panel starts closed", $id("zb-panel").hidden);
check("fab present", !!$id("zb-fab"));

// open + server config reflected into controls
$id("zb-fab").click();
await sleep(120);
check("fab opens the panel", !$id("zb-panel").hidden);
// Freeze the background timers NOW: the 4s beat refresh would otherwise race
// the hand-driven edits below (server fixture overwriting in-progress input).
for (const t of w.__zbTimers ?? []) w.clearInterval(t);
w.__zbTimers = [];
check("blur slider filled from server", input("zb-blur").value === "7");
check("monet switch filled", input("zb-monet").checked === true);
check("fit select filled", select("zb-fit").value === "contain");
check("video volume filled", input("zb-vol").value === "35");
check("bubble preset filled", select("zb-bubble-preset").value === "glass");
check("bubble align button follows fixture", $id("zb-bubble-align").textContent!.includes("靠左"));
check("day/night switch + times filled", input("zb-dn-on").checked && input("zb-dn-start").value === "06:30");
check("chat slider label formatted 0..1", $id("zb-chat-dim-val").textContent === "0.12");
check("storage line rendered", $id("zb-storage-text").textContent === "2.0 MB 缓存");
check("rotation status line rendered", $id("zb-rot-state").textContent === "未启用");

// navigation
tabButton("外观").click();
await sleep(60);
check("look pane visible, others hidden",
  !$id("zb-tab-look").hidden && $id("zb-tab-main").hidden && $id("zb-tab-chat").hidden && $id("zb-tab-sched").hidden && $id("zb-tab-settings").hidden && $id("zb-tab-about").hidden);
check("active nav highlight follows", tabButton("外观").getAttribute("data-active") === "1");
check("tab choice persisted", w.localStorage.getItem("zcode-beautify:tab") === "look");

// sidebar search
const search = input("zb-nav-search");
search.value = "聊";
fire(search, "input");
check("search narrows nav to 聊天",
  tabButton("聊天").style.display !== "none" && tabButton("壁纸").style.display === "none" && tabButton("外观").style.display === "none");
search.value = "";
fire(search, "input");
check("clearing search restores all nav items",
  Array.from(doc.querySelectorAll<HTMLElement>(".zb-tab")).every((b) => b.style.display !== "none"));

// fold blocks (title sits OUTSIDE the card now)
const scenesTitle = doc.querySelector("#zb-card-scenes .zb-card-title") as HTMLElement;
scenesTitle.click();
check("title click folds the scenes block", $id("zb-card-scenes").classList.contains("zb-collapsed"));
check("fold state persisted", w.localStorage.getItem("zcode-beautify:fold-scenes") === "1");
scenesTitle.click();
check("second click unfolds", !$id("zb-card-scenes").classList.contains("zb-collapsed"));

// ✕ close + reopen restores the last page
$id("zb-close").click();
check("✕ closes the panel", $id("zb-panel").hidden);
$id("zb-fab").click();
await sleep(60);
check("reopen restores last page (外观)", tabButton("外观").getAttribute("data-active") === "1");
// Reopening the panel re-armed the 4s beat interval; freeze it again or a
// beat tick can land inside any later assertion's async window (it did: the
// width tests below stretched the timeline until one tick hit the bubble
// css preview check and yanked the textarea back to the fixture value).
for (const t of w.__zbTimers ?? []) w.clearInterval(t);
w.__zbTimers = [];

// slider tuning: live label + preview var + debounced POST
// (wait for switchTab's refresh() to land first — a human cannot outrun it,
// and firing input before it resolves would post the pre-refresh value)
tabButton("聊天").click();
await sleep(150);
input("zb-chat-dim").value = "40";
fire(input("zb-chat-dim"), "input");
check("chat slider live label", $id("zb-chat-dim-val").textContent === "0.40");
check("chat preview css var set", doc.documentElement.style.getPropertyValue("--zb-chat-dim") === "0.4");
await sleep(420); // pushChatLook debounce is 300ms
const chatPost = calls.filter((c) => c.method === "POST" && c.path === "/api/config" && c.body && "chatLook" in c.body).pop();
check("chat look posted to serve", !!chatPost && (chatPost.body!.chatLook as { chatDim: number }).chatDim === 40);

// column width (消息流宽度): gears post cap+inset; 自定义 is a ➕ BUTTON now
// (select option is a disabled reflect-only marker) whose editor survives the
// 4s beat and only pushes on ✓ 应用 — the old select-option version used to
// snap shut on the next beat.
const chatLookPosts = () => calls.filter((c) => c.method === "POST" && c.path === "/api/config" && c.body && "chatLook" in c.body);
const lastChatLook = () => (chatLookPosts().pop()!.body!.chatLook as Record<string, number>);
check("perf toggle starts off", (input("zb-chat-perf") as unknown as HTMLInputElement).checked === false);
(input("zb-chat-perf") as unknown as HTMLInputElement).checked = true;
fire(input("zb-chat-perf"), "change");
await sleep(420);
check("perf toggle posts perfSmooth 1", lastChatLook().perfSmooth === 1);
check("width select starts at 原生", select("zb-chat-width").value === "0");
check("editor hidden at 原生", $id("zb-chat-width-custom").hidden);
select("zb-chat-width").value = "90:8";
fire(select("zb-chat-width"), "change");
await sleep(420);
check("wide gear posts cap+inset", lastChatLook().widthCapRem === 90 && lastChatLook().widthInsetRem === 8);
check("gear fills the editor numbers", input("zb-chat-width-cap").value === "90" && input("zb-chat-width-inset").value === "8");
check("editor stays hidden for a gear", $id("zb-chat-width-custom").hidden);
select("zb-chat-width").value = "56:24";
fire(select("zb-chat-width"), "change");
await sleep(420);
check("narrow gear posts 56:24", lastChatLook().widthCapRem === 56 && lastChatLook().widthInsetRem === 24);

// ➕ 自定义 editor: opens via button, survives beats, pushes only on ✓
$id("zb-chat-width-add").click();
check("➕ button reveals the editor", !$id("zb-chat-width-custom").hidden);
input("zb-chat-width-cap").value = "110";
fire(input("zb-chat-width-cap"), "change");
const postsBeforeBeat = chatLookPosts().length;
// a beat (tab switch → refresh) mid-edit must NOT close the editor or snap
// the select — the 自动关闭 regression
FIXTURE.chatLook = { chatDim: 12, maskTop: 20, maskBottom: 10, frost: 5, widthCapRem: 56, widthInsetRem: 24 };
tabButton("通用").click();
tabButton("聊天").click();
await sleep(150);
check("beat mid-edit keeps the editor open", !$id("zb-chat-width-custom").hidden);
check("beat mid-edit never posted the half-typed width", chatLookPosts().length === postsBeforeBeat);
// dragging a MASK slider mid-edit must push the SERVER width, not the editor's
input("zb-chat-dim").value = "30";
fire(input("zb-chat-dim"), "input");
await sleep(420);
check("mask push mid-edit carries server width (56), not the editor (110)",
  lastChatLook().widthCapRem === 56 && lastChatLook().widthInsetRem === 24 && lastChatLook().chatDim === 30);
check("editor still open after the mask push", !$id("zb-chat-width-custom").hidden);
$id("zb-chat-width-ok").click();
await sleep(420);
check("✓ 应用 posts the edited cap", lastChatLook().widthCapRem === 110);
check("✓ 应用 closes the editor", $id("zb-chat-width-custom").hidden);
check("applied value reflects to the 自定义 marker", select("zb-chat-width").value === "custom");

// ✕ cancel: discards — no post, editor closed, next beat restores truth
FIXTURE.chatLook = { chatDim: 30, maskTop: 20, maskBottom: 10, frost: 5, widthCapRem: 56, widthInsetRem: 24 };
tabButton("通用").click();
tabButton("聊天").click();
await sleep(150);
$id("zb-chat-width-add").click();
input("zb-chat-width-cap").value = "118";
fire(input("zb-chat-width-cap"), "change");
const beforeCancel = chatLookPosts().length;
$id("zb-chat-width-cancel").click();
await sleep(420);
check("✕ cancel posts nothing", chatLookPosts().length === beforeCancel);
check("✕ cancel closes the editor", $id("zb-chat-width-custom").hidden);
FIXTURE.chatLook = { chatDim: 30, maskTop: 20, maskBottom: 10, frost: 5, widthCapRem: 84, widthInsetRem: 12 };
tabButton("通用").click();
tabButton("聊天").click();
await sleep(150);
check("preset width reflects to the gear option", select("zb-chat-width").value === "84:12");
// The ➕ editor focused zb-chat-width-cap; leaving it focused would defeat the
// bubble textarea's activeElement guard for the tests below (jsdom keeps it).
(input("zb-chat-width-cap") as HTMLElement).blur?.();

// custom bubble style: dedicated editor WINDOW (✏️ button, still on 聊天)
const srcdoc = () => $id("zb-bubble-pv-frame").getAttribute("srcdoc") || "";
check("preview iframe has sandbox attr (scripts stay blocked)", $id("zb-bubble-pv-frame").getAttribute("sandbox") === "allow-same-origin");
check("preview renders built-in recipe (glass)", srcdoc().includes("backdrop-filter:blur(8px)!important"));
check("preview carries tint var", srcdoc().includes("--zb-bubble-tint:0.28"));
check("preview carries align var (fixture left)", srcdoc().includes("flex-start"));
check("textarea prefilled from server customCss", input("zb-bubble-css").value.includes("dashed"));
check("editor window starts hidden", $id("zb-bubble-win").hidden);
$id("zb-bubble-edit").click();
check("✏️ button opens the editor window", !$id("zb-bubble-win").hidden);
check("opening keeps the current preset", select("zb-bubble-preset").value === "glass");
check("mode chip shows the active preset", $id("zb-bubble-win-mode").textContent === "毛玻璃");
check("gate shown while a built-in preset is active", !$id("zb-bubble-css-gate").hidden);
check("css area hidden while gated", $id("zb-bubble-css-wrap").hidden);
check("gate names the active preset", $id("zb-bubble-gate-name").textContent === "毛玻璃");
check("window mirrors the page sliders", input("zb-bubble-tint-w").value === input("zb-bubble-tint").value);
$id("zb-bubble-gate-on").click();
check("启用自定义 CSS switches the preset", select("zb-bubble-preset").value === "custom");
check("mode chip flips to 自定义", $id("zb-bubble-win-mode").textContent === "自定义 CSS");
check("css area revealed after enabling", $id("zb-bubble-css-wrap").hidden === false && $id("zb-bubble-css-gate").hidden === true);
check("preview switches to the custom css after enabling", srcdoc().includes("dashed"));
check("window slider drives the page slider", (input("zb-bubble-tint-w").value = "55", fire(input("zb-bubble-tint-w"), "input"), input("zb-bubble-tint").value === "55" && $id("zb-bubble-tint-val").textContent === "55"));
check("window slider updates its own label", $id("zb-bubble-tint-w-val").textContent === "55%");
input("zb-bubble-tint-w").value = "28";
fire(input("zb-bubble-tint-w"), "input");
input("zb-bubble-css").value = ".zb-bubble{box-shadow:0 0 20px gold}";
fire(input("zb-bubble-css"), "input");
await sleep(300); // 120ms preview debounce
check("preview updates while editing", srcdoc().includes("0 0 20px gold"));
await sleep(250); // 300ms push debounce
const customPost = calls.filter((c) => c.method === "POST" && c.path === "/api/config" && c.body && "bubbleLook" in c.body).pop();
check("custom css posted to serve", !!customPost && String((customPost.body!.bubbleLook as { customCss?: string }).customCss || "").includes("0 0 20px gold"));
input("zb-bubble-css").value = ".zb-bubble{color:red}</style>";
fire(input("zb-bubble-css"), "input");
await sleep(250);
check("</style stripped in preview (own closing tag only)", (srcdoc().match(/<\/style/g) || []).length === 1 && srcdoc().includes("color:red"));
$id("zb-bubble-example").click();
check("example button fills the editor", input("zb-bubble-css").value.includes("linear-gradient"));
check("example renders in preview", srcdoc().includes("linear-gradient"));

// ➕ 存为样式: save the CSS above as a named style, chip lifecycle (panel-local)
$id("zb-bubble-add-style").click();
check("➕ reveals the name row", !$id("zb-bubble-style-name-row").hidden);
input("zb-bubble-style-name").value = "测试毛玻璃";
$id("zb-bubble-style-save").click();
const savedStyles = JSON.parse(w.localStorage.getItem("zcode-beautify:bubble-styles") || "[]") as { name: string; css: string }[];
check("saved style lands in localStorage", savedStyles.length === 1 && savedStyles[0].name === "测试毛玻璃" && savedStyles[0].css.includes("linear-gradient"));
check("name row hides after saving", $id("zb-bubble-style-name-row").hidden);
check("chip appears after saving", !$id("zb-bubble-style-chips").hidden && $id("zb-bubble-style-chips").textContent!.includes("测试毛玻璃"));
select("zb-bubble-preset").value = "glass";
fire(select("zb-bubble-preset"), "change");
check("preset moved away before chip apply", select("zb-bubble-preset").value === "glass");
($id("zb-bubble-style-chips").querySelector(".zb-style-chip") as HTMLElement).click();
check("chip click re-selects custom", select("zb-bubble-preset").value === "custom");
check("chip click loads its css", input("zb-bubble-css").value.includes("linear-gradient"));
await sleep(420); // 120ms preview debounce + 300ms push debounce
const chipPost = calls.filter((c) => c.method === "POST" && c.path === "/api/config" && c.body && "bubbleLook" in c.body).pop();
check("chip apply posts the custom css to serve", !!chipPost && String((chipPost.body!.bubbleLook as { customCss?: string }).customCss || "").includes("linear-gradient"));
check("chip apply re-renders the preview", srcdoc().includes("linear-gradient"));
($id("zb-bubble-style-chips").querySelector(".zb-chip-del") as HTMLElement).click();
check("delete empties the library and hides the chips", $id("zb-bubble-style-chips").hidden && JSON.parse(w.localStorage.getItem("zcode-beautify:bubble-styles") || "[]").length === 0);
$id("zb-bubble-add-style").click();
input("zb-bubble-css").value = "";
$id("zb-bubble-style-save").click();
check("empty css refuses to save", JSON.parse(w.localStorage.getItem("zcode-beautify:bubble-styles") || "[]").length === 0);
$id("zb-bubble-style-cancel").click();
check("cancel hides the name row", $id("zb-bubble-style-name-row").hidden);

// dropdown change while the window is open must re-sync the editor chrome
select("zb-bubble-preset").value = "accent";
fire(select("zb-bubble-preset"), "change");
check("dropdown change re-syncs the mode chip", $id("zb-bubble-win-mode").textContent === "主题色染色");
check("dropdown change re-shows the gate", !$id("zb-bubble-css-gate").hidden && $id("zb-bubble-css-wrap").hidden);
select("zb-bubble-preset").value = "custom";
fire(select("zb-bubble-preset"), "change");
check("switching back re-hides the gate", $id("zb-bubble-css-gate").hidden && !$id("zb-bubble-css-wrap").hidden);

$id("zb-bubble-win-close").click();
check("✕ closes the window", $id("zb-bubble-win").hidden);
select("zb-bubble-preset").value = "custom";
fire(select("zb-bubble-preset"), "change");
check("picking 自定义 CSS opens the window", !$id("zb-bubble-win").hidden);
doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
check("Esc closes the window", $id("zb-bubble-win").hidden);
select("zb-bubble-preset").value = "glass";
fire(select("zb-bubble-preset"), "change");
await sleep(220); // 120ms preview debounce
check("preview returns to recipe css", srcdoc().includes("backdrop-filter:blur(8px)!important"));

// switch tuning: POST carries the flipped value (same refresh-first ordering)
tabButton("外观").click();
await sleep(150);
input("zb-monet").checked = false;
fire(input("zb-monet"), "change");
await sleep(420);
const monetPost = calls.filter((c) => c.method === "POST" && c.path === "/api/config" && c.body && "monet" in c.body).pop();
check("monet switch posts config", !!monetPost && monetPost.body!.monet === false);

// offline → online self-heal
apiMode = "down";
tabButton("通用").click(); // switchTab triggers refresh() → fetch fails → setOffline
await sleep(120);
const root = $id("zcode-beautify-panel-root");
check("offline flag set on root", root.getAttribute("data-offline") === "1");
check("offline banner shown", !$id("zb-offline").hidden);
check("offline parks sliders at neutral", input("zb-blur").value === "0");
apiMode = "ok";
$id("zb-retry").click();
await sleep(120);
check("retry recovers + refills from server", root.getAttribute("data-offline") === "0" && input("zb-blur").value === "7");

// 关于 page: identity baked in, live status from /api/health
(w.navigator as unknown as { clipboard?: unknown }).clipboard = { writeText: () => Promise.resolve() };
tabButton("关于").click();
await sleep(120);
check("about pane visible", !$id("zb-tab-about").hidden);
check("hero version chip filled", $id("zb-ab-ver").textContent === `v${VERSION}`);
check("license row filled", $id("zb-ab-license").textContent === "MIT");
check("author row filled", $id("zb-ab-author").textContent.length > 0);
check("api port row filled", $id("zb-ab-api").textContent === "9223");
check("service row shows running + pid", $id("zb-ab-svc").textContent!.includes("运行中") && $id("zb-ab-svc").textContent!.includes("pid 4242"));
check("service row shows serve version", $id("zb-ab-svc").textContent!.includes(`v${VERSION}`));
check("uptime formatted from health", $id("zb-ab-uptime").textContent === "1 分钟");
check("cdp port from health", $id("zb-ab-cdp").textContent === "9222");
check("wallpaper row from config", $id("zb-ab-wp").textContent === "图片壁纸");
$id("zb-ab-copy").click();
await sleep(30);
check("upstream repo copy feedback", $id("zb-status").textContent!.includes("已复制上游仓库地址"));
$id("zb-ab-copy-fork").click();
await sleep(30);
check("fork repo copy feedback", $id("zb-status").textContent!.includes("已复制 Fork 仓库地址"));
check("fork repo row shows the fork url", $id("zb-tab-about").textContent!.includes("Mc-GrowlR/zcode-beautify-for-wallpaper-engine"));
check("upstream row shows the upstream url", $id("zb-tab-about").textContent!.includes("Logocceai/zcode-beautify"));

// Alt+B global toggle
const hiddenBeforeAltB = $id("zb-panel").hidden;
doc.dispatchEvent(new w.KeyboardEvent("keydown", { altKey: true, key: "b", bubbles: true }));
check("Alt+B toggles the panel", $id("zb-panel").hidden === !hiddenBeforeAltB);

// Re-injection (every serve restart re-evaluates the script) must not stack
// document-level keydown handlers: N stale Alt+B listeners meant N fab clicks
// per keypress — toggles cancel by parity and Alt+B "worked randomly"
// (observed 23 live). The generation guard keeps exactly one active.
{
  w.eval(SCRIPT); // second generation, same document
  await sleep(150);
  const clicks = await new Promise<number>((res) => {
    let n = 0;
    const cnt = (e: Event) => { if ((e.target as HTMLElement).id === "zb-fab") n++; };
    doc.addEventListener("click", cnt, true);
    doc.dispatchEvent(new w.KeyboardEvent("keydown", { altKey: true, key: "b", bubbles: true }));
    setTimeout(() => { doc.removeEventListener("click", cnt, true); res(n); }, 30);
  });
  check("re-injection leaves exactly one Alt+B handler", clicks === 1, `${clicks} clicks`);
}

// cleanup: kill the panel's intervals so the process can exit
for (const t of w.__zbTimers ?? []) w.clearInterval(t);
dom.window.close();

console.log(failed ? `\nT11: ${failed} check(s) FAILED` : "\nT11: all checks passed");
process.exit(failed ? 1 : 0);
