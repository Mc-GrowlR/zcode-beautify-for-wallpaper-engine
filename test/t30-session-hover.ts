/**
 * T30 SESSION HOVER PREVIEW (会话概览悬停卡) verification:
 *   A  normalizeChatLook sessionHover semantics (1/true pass, junk/absent → 0);
 *   B  buildPayload bakes previewApi only when the toggle is on AND a token
 *      exists; toggle off / no token → "" (bootstrap never mounts listeners);
 *   C  behavioral, real bootstrap inside jsdom — style + card mount on a
 *      300ms hover, rows render oldest→newest with the newest bold, the
 *      native task-row-details card is hidden while on, close on
 *      mouse-out/Escape/pointerdown/scroll, toggle-off tears everything down,
 *      fetch failure falls back to the row's full title, and a re-injected
 *      bootstrap generation takes the bindings over (stale-token eviction);
 *   D  the sessionStore reader against a fixture db (real user prompts
 *      filtered from runtime/synthetic noise; bad/unknown ids; missing db);
 *   E  serve wiring: the /api/session-preview route, sanitize accepting
 *      sessionHover, BOTH manual buildBootstrapScript assembly sites carrying
 *      previewApi, the MCP flag, and the panel toggle UI.
 *
 * Run: npx tsx test/t30-session-hover.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { normalizeChatLook, buildPayload, DEFAULT_CONFIG, type BeautifyConfig } from "../src/core/inject.js";
import { buildBootstrapScript } from "../src/core/cdp.js";
import { readSessionPreview, sessionDbPath, MAX_PROMPTS, MAX_PROMPT_CHARS } from "../src/core/sessionStore.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}
const root = fileURLToPath(new URL("../", import.meta.url));
const read = (p: string) => fs.readFileSync(p, "utf8");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- part A: normalize -------------------------------------------------------
{
  check("sessionHover 1 passes", normalizeChatLook({ sessionHover: 1 }).sessionHover === 1);
  check("sessionHover true passes", normalizeChatLook({ sessionHover: true }).sessionHover === 1);
  check("sessionHover junk → 0", normalizeChatLook({ sessionHover: "x" as never }).sessionHover === 0);
  check("sessionHover absent → 0 (old configs keep the feature off)", normalizeChatLook().sessionHover === 0);
  // side: absent = 1 (rows anchor on — old configs expect it), explicit 0 off
  check("sessionHoverSide absent → 1 (sidebar rows stay anchors)", normalizeChatLook().sessionHoverSide === 1);
  check("sessionHoverSide 0 passes", normalizeChatLook({ sessionHoverSide: 0 }).sessionHoverSide === 0);
  check("sessionHoverSide 1 passes", normalizeChatLook({ sessionHoverSide: 1 }).sessionHoverSide === 1);
  // max: absent/junk → 10, valid clamped into 1..60
  check("sessionHoverMax absent → 10", normalizeChatLook().sessionHoverMax === 10);
  check("sessionHoverMax junk → 10", normalizeChatLook({ sessionHoverMax: "x" as never }).sessionHoverMax === 10);
  check("sessionHoverMax 3 passes", normalizeChatLook({ sessionHoverMax: 3 }).sessionHoverMax === 3);
  check("sessionHoverMax clamps up high values (60)", normalizeChatLook({ sessionHoverMax: 500 }).sessionHoverMax === 60);
  check("sessionHoverMax clamps down sub-1 values (10)", normalizeChatLook({ sessionHoverMax: 0 }).sessionHoverMax === 10);
}

// --- part B: payload ---------------------------------------------------------
{
  const base: BeautifyConfig = { ...DEFAULT_CONFIG, apiPort: 9223 };
  const on = buildPayload({ ...base, chatLook: { sessionHover: 1 } }, undefined, "tok123");
  check("previewApi baked with token when on",
    on.previewApi === "http://127.0.0.1:9223/api/session-preview?t=tok123", on.previewApi);
  check("chatLook survives with sessionHover", on.chatLook?.sessionHover === 1);
  const noTok = buildPayload({ ...base, chatLook: { sessionHover: 1 } }, undefined, "");
  check("no serve token → bare URL (renderer degrades to the DOM fallback)",
    noTok.previewApi === "http://127.0.0.1:9223/api/session-preview", noTok.previewApi);
  const off = buildPayload({ ...base, chatLook: { sessionHover: 0 } }, undefined, "tok123");
  check("toggle off → empty previewApi", off.previewApi === "");
  const absent = buildPayload(base, undefined, "tok123");
  check("absent chatLook → empty previewApi + normalized 0", absent.previewApi === "" && absent.chatLook?.sessionHover === 0);
}

// --- part C: behavioral (real bootstrap in jsdom) -----------------------------
const chatDefaults = { chatDim: 0, maskTop: 0, maskBottom: 0, frost: 0, widthCapRem: 0, widthInsetRem: 0, perfSmooth: 0, hideElapsedDecimal: 0, dragResize: 0, sessionHover: 0, composerFade: 50 };

interface FetchLog { url: string; }
function makeWindow(fetchImpl?: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>) {
  const dom = new JSDOM(`<!doctype html><html><body><ul>
    <li data-testid="task-item-sess_aaa" class="bg-selected" data-task-item-key="C:/w:sess_aaa"><p><span data-task-title-copy="original">第一条会话的完整标题文本</span></p></li>
    <li data-testid="task-item-sess_bbb"><p><span data-task-title-copy="original">第二条会话</span></p></li>
    <li data-testid="row-not-a-task"><p>nope</p></li>
  </ul>
  <div id="conv"><div class="min-h-0 flex-1 overflow-y-auto scrollbar-gutter:stable_both-edges"><div data-row-id="r1">turn row</div></div><button data-testid="v4-turn-navigator-item-msg_x:query:2" data-turn-id="msg_x"></button></div>
  </body></html>`, {
    url: "http://127.0.0.1/",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const { window } = dom;
  // jsdom rects are all-zero — give the rows a plausible box so the open
  // guard (recycled/virtualized rows) lets the card mount. The dy offset is
  // mutable so tests can simulate the row MOVING (real list scroll) vs
  // spurious scroll events (streaming storms — scrollTop never changes).
  (window as any).__rectDy = 0;
  // __rowOff simulates the blank-landing bug: content rows report an
  // off-screen rect until something (the tick click in the recovery flow)
  // flips the flag back — exactly how a re-measured virtualizer re-mounts
  // rows into the viewport.
  (window as any).__rowOff = 0;
  (window as any).Element.prototype.getBoundingClientRect = function () {
    const dy = (window as any).__rectDy || 0;
    if ((window as any).__rowOff && typeof (this as any).hasAttribute === "function" && (this as any).hasAttribute("data-row-id")) {
      return { x: 8, y: 99990, top: 99990, bottom: 99998, left: 8, right: 260, width: 252, height: 8, toJSON() {} };
    }
    return { x: 8, y: 40 + dy, top: 40 + dy, bottom: 72 + dy, left: 8, right: 260, width: 252, height: 32, toJSON() {} };
  };
  const calls: FetchLog[] = [];
  (window as any).fetch = (url: string) => {
    calls.push({ url });
    return fetchImpl
      ? fetchImpl(url)
      : Promise.reject(new Error("no fetch impl"));
  };
  const boot = (over: Record<string, unknown>, previewApi: string) =>
    (window as any).eval(buildBootstrapScript({
      css: "/*t*/",
      chatLook: { ...chatDefaults, ...over } as never,
      previewApi,
      wallpaperDataUri: "",
      videoSrc: "",
    }));
  return { window, boot, calls };
}

const hover = (w: JSDOM["window"], sel: string, type = "mouseover", related?: Node) =>
  w.document.querySelector(sel)!.dispatchEvent(new (w as any).MouseEvent(type, { bubbles: true, cancelable: true, relatedTarget: related ?? null }));

const fixtureSession = {
  ok: true,
  title: "把玩会话概览",
  updatedAt: Date.now() - 3600_000,
  omitted: 0,
  prompts: [
    { at: 1, text: "第一条提问", mid: "msg_x" },
    { at: 2, text: "第二条 提问\n带换行", mid: "msg_y" },
    { at: 3, text: "最新一条提问", mid: "msg_z" },
  ],
};

// C1: mount + render on hover, hide-native CSS, newest bold.
{
  const { window: w, boot, calls } = makeWindow(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureSession) }));
  // ZCode's React root stops propagation on bubbled mouseover before it can
  // reach document (verified live on 3.18) — the binding must be capture.
  w.document.body.addEventListener("mouseover", (e: Event) => e.stopPropagation());
  boot({ sessionHover: 1 }, "http://127.0.0.1:9223/api/session-preview?t=T1");
  check("style element mounts (native card hidden)", !!(w.document.getElementById("zcode-beautify-hover-style")
    && (w.document.getElementById("zcode-beautify-hover-style")!.textContent || "").includes('[data-testid="task-row-details"]{display:none!important}')));
  check("no card before hover", !w.document.getElementById("zcode-beautify-hover-card"));
  hover(w, '[data-testid="task-item-sess_aaa"]');
  await sleep(80);
  check("card not opened before the 300ms delay", !w.document.getElementById("zcode-beautify-hover-card"));
  await sleep(320);
  const card = w.document.getElementById("zcode-beautify-hover-card");
  check("card opens after the delay", !!card);
  check("fetch hit the tokened URL with the session id",
    calls.length === 1 && calls[0].url === "http://127.0.0.1:9223/api/session-preview?t=T1&session=sess_aaa", JSON.stringify(calls));
  const rows = card ? card.querySelectorAll(".zcode-beautify-hov-row") : [];
  check("three prompt rows rendered", rows.length === 3);
  check("newlines collapse to one line", rows[1]?.textContent === "第二条 提问 带换行");
  check("newest row is bold-marked", rows[2]?.className.includes("zcode-beautify-hov-last") === true);
  // Reference-design card: headless (no title/meta rows)…
  check("headless card — no title row", !card?.querySelector(".zcode-beautify-hov-title"));
  check("headless card — no meta row", !card?.querySelector(".zcode-beautify-hov-meta"));
  const css = w.document.getElementById("zcode-beautify-hover-style")!.textContent || "";
  // …left-aligned rows (ZCode's list is on the LEFT; the reference's
  // right-hugging rows were an artifact of ITS right-side list)…
  check("rows left-aligned (facing ZCode's left-side list)",
    css.includes(".zcode-beautify-hov-row{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left"));
  check("leading dash marker shipped", css.includes('.zcode-beautify-hov-row::before{content:"–"'));
  // …and a flat near-black borderless panel (no border rule, big radius).
  check("flat dark card paint", css.includes("border-radius:16px") && css.includes("color-mix(in srgb,var(--color-menu")
    && !css.includes("border:1px solid"));
  // Motion contract: entry animation, hover brighten (no bg slab), the
  // sliding indicator (shorter than the current row's long bar), and the
  // reduced-motion opt-out.
  check("card entry animation shipped", css.includes("-hov-in .16s ease-out") && css.includes("translateY(6px)"));
  check("hover brightens text instead of a bg slab", css.includes(".zcode-beautify-hov-row:hover{color:")
    && !css.includes("-hov-row:hover{background"));
  check("current row keeps the LONG bar", css.includes('.zcode-beautify-hov-last::after{content:""'));
  check("sliding hover indicator shipped (shorter, animated)", css.includes("#zcode-beautify-hover-ind{position:absolute")
    && css.includes("width:78%") && css.includes("transition:top .14s ease-out"));
  // The motion must NOT be gated on prefers-reduced-motion: the user's OS
  // ships animations off (the query matches — measured live), which silently
  // swallowed every explicitly requested effect.
  check("motion not gated on prefers-reduced-motion", !css.includes("prefers-reduced-motion"));
  // motion behavior: the indicator survives the fill wipe and follows hover
  const ind = card!.querySelector("#zcode-beautify-hover-ind") as HTMLElement | null;
  check("indicator mounted inside the list", !!ind && (ind.parentElement!.className || "").includes("zcode-beautify-hov-list"));
  rows[1]!.dispatchEvent(new (w as any).MouseEvent("mouseover", { bubbles: true }));
  check("indicator reveals + positions on row hover", !!ind && ind.style.opacity === "1" && ind.style.top.endsWith("px"));
  (card!.querySelector(".zcode-beautify-hov-list") as HTMLElement)!.dispatchEvent(new (w as any).MouseEvent("mouseleave"));
  check("indicator hides when the list is left", ind!.style.opacity === "0");

  // 15s cache: a re-hover of the same session must not refetch.
  hover(w, '[data-testid="task-item-sess_aaa"] > p', "mouseout", w.document.body);
  await sleep(300);
  hover(w, '[data-testid="task-item-sess_aaa"]');
  await sleep(400);
  check("cache absorbs the immediate re-hover", calls.length === 1, `calls=${calls.length}`);
}

// C1b: click-to-jump — two landing paths. The OPEN conversation (selected row
// / tick anchor) clicks the prompt's own turn tick (native scroll-to-turn);
// a DIFFERENT session opens via its sidebar row's native click, then the poll
// lands on the prompt's turn once its strip mounts. Hint rows are inert.
{
  // path 1: hovering the SELECTED session (sess_aaa is bg-selected in the
  // fixture) — clicking a row must drive the TICK, not the sidebar row.
  const { window: w, boot } = makeWindow(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureSession) }));
  boot({ sessionHover: 1 }, "http://127.0.0.1:9223/api/session-preview?t=T1");
  let rowOpened = "";
  let tickClicked = "";
  w.document.querySelector('[data-testid="task-item-sess_aaa"]')!.addEventListener("click", () => { rowOpened = "sess_aaa"; });
  w.document.querySelector("[data-turn-id]")!.addEventListener("click", () => { tickClicked = "msg_x"; });
  hover(w, '[data-testid="task-item-sess_aaa"]');
  await sleep(400);
  const card = w.document.getElementById("zcode-beautify-hover-card");
  check("tick path: card open with rows", !!card && card.querySelectorAll(".zcode-beautify-hov-row").length === 3);
  check("mid carried onto the row", (card!.querySelectorAll(".zcode-beautify-hov-row")[0] as HTMLElement).getAttribute("data-mid") === "msg_x");
  (card!.querySelectorAll(".zcode-beautify-hov-row")[0] as HTMLElement).click();
  check("selected-session click drives the TURN TICK", tickClicked === "msg_x");
  check("selected-session click does not re-open the row", rowOpened === "");
  check("card STAYS OPEN after the jump", !!w.document.getElementById("zcode-beautify-hover-card"));
  w.document.dispatchEvent(new (w as any).KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape still closes the kept-open card", !w.document.getElementById("zcode-beautify-hover-card"));

  // path 2: a DIFFERENT session (sess_bbb) — sidebar row click first, then
  // the poll clicks the turn tick with landing self-heal. __rowOff=1
  // simulates the blank landing (rows off-viewport); the first tick click
  // flips it back (the re-measure), so the SECOND poll sees rows in view and
  // stops — exactly one click, never a click storm.
  const { window: w2, boot: boot2 } = makeWindow(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureSession) }));
  boot2({ sessionHover: 1 }, "http://127.0.0.1:9223/api/session-preview?t=T1");
  let rowOpened2 = "";
  let tickClicks2 = 0;
  (w2 as any).__rowOff = 1;
  w2.document.querySelector('[data-testid="task-item-sess_bbb"]')!.addEventListener("click", () => { rowOpened2 = "sess_bbb"; });
  w2.document.querySelector("[data-turn-id]")!.addEventListener("click", () => { tickClicks2++; (w2 as any).__rowOff = 0; });
  hover(w2, '[data-testid="task-item-sess_bbb"]');
  await sleep(400);
  const card2 = w2.document.getElementById("zcode-beautify-hover-card");
  check("cross path: card open", !!card2);
  (card2!.querySelectorAll(".zcode-beautify-hov-row")[0] as HTMLElement).click();
  check("cross-session click opens via the sidebar row", rowOpened2 === "sess_bbb");
  await sleep(1150); // poll#1 clicks (blank) → poll#2 sees landed rows → stops
  check("poll clicks the turn tick despite the blank landing", tickClicks2 === 1, `clicks=${tickClicks2}`);
  await sleep(1100); // interval must be cleared — no further clicks
  check("recovery stops once rows are visible (no click storm)", tickClicks2 === 1, `clicks=${tickClicks2}`);
  check("cross path: card STAYS OPEN after the jump", !!w2.document.getElementById("zcode-beautify-hover-card"));
  w2.document.body.dispatchEvent(new (w as any).MouseEvent("pointerdown", { bubbles: true }));
  check("pointerdown outside still closes the kept-open card", !w2.document.getElementById("zcode-beautify-hover-card"));

  // hint rows must NOT jump or close: unavailable-serve fallback card.
  const { window: w3, boot: boot3 } = makeWindow(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
  boot3({ sessionHover: 1 }, "http://127.0.0.1:9223/api/session-preview?t=T1");
  let opened3 = "";
  w3.document.querySelector('[data-testid="task-item-sess_aaa"]')!.addEventListener("click", () => { opened3 = "sess_aaa"; });
  hover(w3, '[data-testid="task-item-sess_aaa"]');
  await sleep(420);
  const card3 = w3.document.getElementById("zcode-beautify-hover-card");
  check("hint test: fallback card open", !!card3);
  (card3!.querySelector(".zcode-beautify-hov-hint") as HTMLElement | null)?.click();
  check("hint click is inert (no jump)", opened3 === "");
  check("hint click keeps the card", !!w3.document.getElementById("zcode-beautify-hover-card"));
}

// C1c: sessionHoverSide=0 — the LEFT task-list rows stop opening the card and
// ZCode's own workspace hover card comes back; the turn ticks keep working.
{
  const { window: w, boot } = makeWindow(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureSession) }));
  boot({ sessionHover: 1, sessionHoverSide: 0 }, "http://127.0.0.1:9223/api/session-preview?t=T1");
  const cssOff = w.document.getElementById("zcode-beautify-hover-style")!.textContent || "";
  check("side=0 keeps the native sidebar card (no hide rule)", !cssOff.includes('[data-testid="task-row-details"]{display:none'));
  check("side=0 still hides the turn tooltip", cssOff.includes('[data-testid^="v4-turn-navigator-tooltip-"]{display:none'));
  hover(w, '[data-testid="task-item-sess_aaa"]');
  await sleep(420);
  check("side=0: sidebar row hover opens NO card", !w.document.getElementById("zcode-beautify-hover-card"));
  hover(w, '[data-testid="v4-turn-navigator-item-msg_x:query:2"]');
  await sleep(420);
  check("side=0: turn tick still opens the card", !!w.document.getElementById("zcode-beautify-hover-card"));
}

// C1d: sessionHoverMax lists EXACTLY the newest N prompts — a short,
// naturally-ending list; older prompts are simply not rendered, and no
// scroll-capping inline styles are involved anymore.
{
  const { window: w, boot } = makeWindow(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureSession) }));
  boot({ sessionHover: 1, sessionHoverMax: 2 }, "http://127.0.0.1:9223/api/session-preview?t=T1");
  hover(w, '[data-testid="task-item-sess_aaa"]');
  await sleep(420);
  const card = w.document.getElementById("zcode-beautify-hover-card");
  const rows = card ? Array.from(card.querySelectorAll(".zcode-beautify-hov-row")) : [];
  const list = card?.querySelector(".zcode-beautify-hov-list") as HTMLElement | null;
  check("max=2: exactly 2 rows rendered (the NEWEST two)", rows.length === 2
    && rows[0]?.textContent === "第二条 提问 带换行" && rows[1]?.textContent === "最新一条提问");
  check("max=2: newest row still the bold last", rows[1]?.className.includes("zcode-beautify-hov-last") === true);
  check("no scroll-capping inline maxHeight", !!list && list.style.maxHeight === "");

  const { window: w2, boot: boot2 } = makeWindow(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureSession) }));
  boot2({ sessionHover: 1, sessionHoverMax: 10 }, "http://127.0.0.1:9223/api/session-preview?t=T1");
  hover(w2, '[data-testid="task-item-sess_aaa"]');
  await sleep(420);
  const rows2 = w2.document.getElementById("zcode-beautify-hover-card")?.querySelectorAll(".zcode-beautify-hov-row");
  check("within max: all 3 rows listed", !!rows2 && rows2.length === 3);
}

// C1e: 大会话流畅模式 v2 lifecycle — far off-screen rows get content-visibility
// with their real height baked; rows back in range unmark; the LAST row and
// rows carrying the streaming marker are never marked; while a turn streams
// no NEW marks happen at all (the 8x total-height oscillation guard).
{
  const mkRow = (w: JSDOM["window"], top: number, bottom: number, streamingMarker = false) => {
    const d = w.document.createElement("div");
    d.className = "history-message";
    d.textContent = "row";
    if (streamingMarker) {
      const s = w.document.createElement("div");
      s.setAttribute("data-testid", "chat-loading");
      d.appendChild(s);
    }
    d.getBoundingClientRect = () => ({ x: 300, y: top, top, bottom, left: 300, right: 900, width: 600, height: bottom - top, toJSON() {} }) as DOMRect;
    w.document.body.appendChild(d);
    return d;
  };

  const { window: w, boot } = makeWindow();
  const farAbove = mkRow(w, -3000, -2000);   // far off-screen → marked
  mkRow(w, 40, 200);                          // in range → untouched
  const farBelow = mkRow(w, 3000, 3100);      // far off-screen but NOT last… (see order)
  const lastRow = mkRow(w, 3200, 3300);       // last row → never marked (live tail)
  boot({ perfSmooth: 1 }, "");
  await sleep(450); // perf debounce 250ms
  const marks1 = Array.from(w.document.querySelectorAll("[data-zb-cv]"));
  check("v2: far off-screen rows marked", marks1.includes(farAbove) && marks1.includes(farBelow), `marks=${marks1.length}`);
  check("v2: last row never marked (live tail)", !marks1.includes(lastRow));
  check("v2: in-range row untouched", marks1.every((m) => m !== w.document.querySelectorAll(".history-message")[1]));

  // scroll back: the far-above row returns to range → unmarked on the next pass
  farAbove.getBoundingClientRect = () => ({ x: 300, y: 40, top: 40, bottom: 240, left: 300, right: 900, width: 600, height: 200, toJSON() {} }) as DOMRect;
  w.document.body.dispatchEvent(new (w as any).Event("scroll"));
  await sleep(450);
  check("v2: returning row unmarked", !farAbove.hasAttribute("data-zb-cv")
    && farAbove.style.contentVisibility === "" && farAbove.style.containIntrinsicSize === "");

  // streaming: a turn is working → NO new marks appear even far off-screen
  const { window: w2, boot: boot2 } = makeWindow();
  const streamFlag = w2.document.createElement("div");
  streamFlag.setAttribute("data-testid", "chat-loading");
  w2.document.body.appendChild(streamFlag);
  const far2 = mkRow(w2, -3000, -2000);
  const last2 = mkRow(w2, 3200, 3300);
  boot2({ perfSmooth: 1 }, "");
  await sleep(450);
  check("v2: streaming freezes new marks (8x-oscillation guard)",
    !far2.hasAttribute("data-zb-cv") && !last2.hasAttribute("data-zb-cv")
    && w2.document.querySelectorAll("[data-zb-cv]").length === 0);
}

// C2: close behaviors — mouse-out grace, Escape, pointerdown, scroll.
{
  const { window: w, boot } = makeWindow(() => Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureSession) }));
  boot({ sessionHover: 1 }, "http://127.0.0.1:9223/api/session-preview?t=T1");
  hover(w, '[data-testid="task-item-sess_bbb"]');
  await sleep(400);
  check("card opened for the second session", !!w.document.getElementById("zcode-beautify-hover-card"));
  hover(w, '[data-testid="task-item-sess_bbb"]', "mouseout", w.document.body);
  await sleep(60);
  check("grace window keeps the card (gap crossing)", !!w.document.getElementById("zcode-beautify-hover-card"));
  await sleep(220);
  check("card closes after the grace window outside row+card", !w.document.getElementById("zcode-beautify-hover-card"));

  hover(w, '[data-testid="task-item-sess_bbb"]');
  await sleep(400);
  w.document.dispatchEvent(new (w as any).KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape closes", !w.document.getElementById("zcode-beautify-hover-card"));

  hover(w, '[data-testid="task-item-sess_bbb"]');
  await sleep(400);
  w.document.body.dispatchEvent(new (w as any).MouseEvent("pointerdown", { bubbles: true }));
  check("pointerdown outside closes", !w.document.getElementById("zcode-beautify-hover-card"));

  hover(w, '[data-testid="task-item-sess_bbb"]');
  await sleep(400);
  const before = w.document.getElementById("zcode-beautify-hover-card")?.style.top;
  // a scroll that MOVES the row repositions the open card (native-popper
  // behaviour) instead of blinking it away
  (w as any).__rectDy = 24;
  w.document.body.dispatchEvent(new (w as any).Event("scroll", { bubbles: true }));
  const afterCard = w.document.getElementById("zcode-beautify-hover-card");
  check("open card FOLLOWS a moved row instead of closing", !!afterCard && afterCard.style.top !== before,
    `${before} → ${afterCard?.style.top}`);
  (w as any).__rectDy = 0;
}

// C3: fetch failure → DOM fallback (full marquee title + hint).
{
  const { window: w, boot } = makeWindow(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
  boot({ sessionHover: 1 }, "http://127.0.0.1:9223/api/session-preview?t=T1");
  hover(w, '[data-testid="task-item-sess_aaa"]');
  await sleep(420);
  const card = w.document.getElementById("zcode-beautify-hover-card");
  check("fallback card still opens", !!card);
  check("fallback shows the full row title", card?.querySelector(".zcode-beautify-hov-row")?.textContent === "第一条会话的完整标题文本");
  check("fallback hint present", !!(card?.querySelector(".zcode-beautify-hov-hint")));
}

// C4: toggle off tears everything down; off-from-start mounts nothing.
{
  const { window: w, boot } = makeWindow(() => Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureSession) }));
  boot({ sessionHover: 1 }, "http://127.0.0.1:9223/api/session-preview?t=T1");
  await sleep(50);
  boot({ sessionHover: 0 }, "");
  check("style removed on off", !w.document.getElementById("zcode-beautify-hover-style"));
  check("no listeners left behind", !(w as any).__zcodeBeautify.hoverTeardown);
  hover(w, '[data-testid="task-item-sess_aaa"]');
  await sleep(420);
  check("off never opens a card", !w.document.getElementById("zcode-beautify-hover-card"));

  const { window: w2, boot: boot2 } = makeWindow(() => Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureSession) }));
  boot2({}, "");
  check("off-from-start mounts no style", !w2.document.getElementById("zcode-beautify-hover-style"));
}

// C5: generation hand-off — a second bootstrap evaluation (new closure, new
// token) must evict the first's bindings or hovers keep 401ing forever.
{
  const { window: w, boot, calls } = makeWindow((url) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureSession) }));
  boot({ sessionHover: 1 }, "http://127.0.0.1:9223/api/session-preview?t=OLD");
  await sleep(30);
  boot({ sessionHover: 1 }, "http://127.0.0.1:9223/api/session-preview?t=NEW");
  hover(w, '[data-testid="task-item-sess_aaa"]');
  await sleep(420);
  check("re-injection re-binds with the NEW token",
    calls.length === 1 && calls[0].url.includes("t=NEW"), JSON.stringify(calls));
}

// C6: fast-path rebinding — toggling the panel switch pushes through the
// CHAT FAST PATH, where the second eval returns before the var initializers
// below the fast paths ever run. A generation bound that way once closed over
// an undefined zbHoverCache and every hover threw (live regression); the
// state now lives above the fast paths, so off→on via fast paths must still
// render rows.
{
  const { window: w, boot, calls } = makeWindow(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureSession) }));
  boot({ sessionHover: 1 }, "http://127.0.0.1:9223/api/session-preview?t=T1"); // full body, binds
  boot({ sessionHover: 0 }, ""); // chat fast path → teardown
  boot({ sessionHover: 1 }, "http://127.0.0.1:9223/api/session-preview?t=T1"); // chat fast path → rebind
  w.document.getElementById("zcode-beautify-hover-card")?.remove(); // fresh card
  hover(w, '[data-testid="task-item-sess_aaa"]');
  await sleep(430);
  const card = w.document.getElementById("zcode-beautify-hover-card");
  const rows = card ? card.querySelectorAll(".zcode-beautify-hov-row") : [];
  check("fast-path-rebound generation renders rows (zbHoverCache initialized)", rows.length === 3, `rows=${rows.length}`);
  check("its fetch went out (no silent throw)", calls.length >= 1, `calls=${calls.length}`);
}

// C7: streaming scroll isolation — live measurement: while a session
// streams, the SIDEBAR LIST's own overflow layer fires scroll storms (47
// events / 12s, scrollTop pinned at 0) and the conversation column scrolls
// constantly; a blanket scroll-close killed every hover attempt. Only a
// scroll that MOVES the hovered row (rect compare) may close.
{
  const { window: w, boot } = makeWindow(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureSession) }));
  boot({ sessionHover: 1 }, "http://127.0.0.1:9223/api/session-preview?t=T1");
  const chatCol = w.document.createElement("div");
  chatCol.id = "chat-col-scroller";
  w.document.body.appendChild(chatCol);
  const row = w.document.querySelector('[data-testid="task-item-sess_aaa"]')!;
  const wrap = w.document.createElement("div");
  wrap.id = "side-scroller";
  row.closest("ul")!.parentElement!.appendChild(wrap);
  wrap.appendChild(row.closest("ul")!);
  hover(w, '[data-testid="task-item-sess_aaa"]');
  // storm BOTH scrollers without any actual movement — pending survives
  for (let i = 0; i < 6; i++) {
    chatCol.dispatchEvent(new (w as any).Event("scroll", { bubbles: true }));
    wrap.dispatchEvent(new (w as any).Event("scroll", { bubbles: true }));
    await sleep(50);
  }
  await sleep(300);
  const card = w.document.getElementById("zcode-beautify-hover-card");
  check("spurious scroll storm (streaming) does not cancel the open", !!card);
  check("rows still rendered after the storm", !!card && card.querySelectorAll(".zcode-beautify-hov-row").length === 3);
  // a scroll that MOVES the anchor while OPEN repositions (follows) it
  const topBefore = w.document.getElementById("zcode-beautify-hover-card")?.style.top;
  (w as any).__rectDy = 18;
  wrap.dispatchEvent(new (w as any).Event("scroll", { bubbles: true }));
  await sleep(60);
  const movedCard = w.document.getElementById("zcode-beautify-hover-card");
  check("a scroll that really moves the row REPOSITIONS the open card",
    !!movedCard && movedCard.style.top !== topBefore, `${topBefore} → ${movedCard?.style.top}`);
  // …but a moved anchor while still PENDING cancels the open (scrolling gesture)
  w.document.dispatchEvent(new (w as any).KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  (w as any).__rectDy = 0;
  hover(w, '[data-testid="task-item-sess_aaa"]');
  await sleep(80); // inside the 300ms pending window
  (w as any).__rectDy = 40;
  wrap.dispatchEvent(new (w as any).Event("scroll", { bubbles: true }));
  await sleep(400);
  check("a scroll during the pending delay cancels the open", !w.document.getElementById("zcode-beautify-hover-card"));
  (w as any).__rectDy = 0;
}

// C8: turn-navigator ticks (对话概要标示) — hovering a tick shows the OPEN
// conversation's list, resolved through the sidebar's selected row; the
// native per-turn tooltip is hidden while the feature is on.
{
  const { window: w, boot, calls } = makeWindow(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureSession) }));
  boot({ sessionHover: 1 }, "http://127.0.0.1:9223/api/session-preview?t=T1");
  check("native turn tooltip hidden too",
    (w.document.getElementById("zcode-beautify-hover-style")?.textContent || "").includes('[data-testid^="v4-turn-navigator-tooltip-"]{display:none!important}'));
  hover(w, '[data-testid="v4-turn-navigator-item-msg_x:query:2"]');
  await sleep(430);
  const card = w.document.getElementById("zcode-beautify-hover-card");
  check("tick hover opens the card", !!card);
  check("tick resolves the OPEN session via the selected row",
    calls.length >= 1 && calls[calls.length - 1].url.includes("session=sess_aaa"), JSON.stringify(calls));
  check("tick card renders the prompt rows",
    !!card && card.querySelectorAll(".zcode-beautify-hov-row").length === 3);
  w.document.dispatchEvent(new (w as any).KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  // fallback when serve is down: the selected row's full title shows
  const { window: w2, boot: boot2 } = makeWindow(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
  boot2({ sessionHover: 1 }, "http://127.0.0.1:9223/api/session-preview?t=T1");
  hover(w2, '[data-testid="v4-turn-navigator-item-msg_x:query:2"]');
  await sleep(430);
  const card2 = w2.document.getElementById("zcode-beautify-hover-card");
  check("tick fallback shows the selected row's full title",
    card2?.querySelector(".zcode-beautify-hov-row")?.textContent === "第一条会话的完整标题文本");
}

// --- part D: sessionStore reader (fixture db, skipped without node:sqlite) ----
{
  const sqlite: { DatabaseSync?: any } = await import("node:sqlite").catch(() => ({})) as never;
  if (!sqlite.DatabaseSync) {
    console.log("skip D: node:sqlite unavailable on this runtime");
  } else {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "zb-t30-home-"));
    fs.mkdirSync(path.dirname(sessionDbPath(home)), { recursive: true });
    const db = new sqlite.DatabaseSync(sessionDbPath(home));
    db.exec(`
      CREATE TABLE session (id TEXT, title TEXT, time_updated INTEGER);
      CREATE TABLE message (id TEXT, session_id TEXT, sequence INTEGER, time_created INTEGER, data TEXT);
      CREATE TABLE part (id INTEGER PRIMARY KEY, message_id TEXT, session_id TEXT, sequence INTEGER, data TEXT);
    `);
    const addMsg = (mid: string, seq: number, mdata: unknown, pdata: unknown, at: number) => {
      db.prepare("INSERT INTO message VALUES (?,?,?,?,?)").run(mid, "sess_fix", seq, at, JSON.stringify(mdata));
      db.prepare("INSERT INTO part VALUES (?,?,?,?,?)").run(null, mid, "sess_fix", 0, JSON.stringify(pdata));
    };
    db.prepare("INSERT INTO session VALUES (?,?,?)").run("sess_fix", "夹具会话", 1794000000000);
    addMsg("msg_m0", 0, { role: "user", time: { created: 1793000000000 }, metadata: { inputIntent: { inputOrigin: "desktop" } } }, { type: "text", text: "真实提问一" }, 1793000000000);
    addMsg("msg_m1", 1, { role: "user", metadata: { runtimeMessage: { source: "environment" }, visibility: "model-only" } }, { type: "text", text: "# Environment", synthetic: true }, 1793000000001);
    addMsg("msg_m2", 2, { role: "user" }, { type: "text", text: "真实提问二" }, 1793000000002);
    addMsg("msg_m3", 3, { role: "user", metadata: { runtimeMessage: { source: "total_tokens_reminder" } } }, { type: "text", text: "<total_tokens>", synthetic: true }, 1793000000003);
    addMsg("msg_m4", 4, { role: "assistant" }, { type: "text", text: "助手回复不该出现" }, 1793000000004);
    addMsg("legacy_id", 5, { role: "user" }, { type: "text", text: "旧格式 id 的真实提问" }, 1793000000005);
    addMsg("msg_m5", 6, { role: "user" }, { type: "text", text: "  \n " }, 1793000000006); // blank → dropped
    db.close();

    const r = await readSessionPreview("sess_fix", home);
    check("fixture read ok", r.ok === true);
    if (r.ok) {
      check("only real prompts survive (3 of 7)", r.data.prompts.length === 3, JSON.stringify(r.data.prompts));
      check("blank real part dropped", !r.data.prompts.some((p) => !p.text.trim()));
      check("prompt order oldest → newest", r.data.prompts[0]?.text === "真实提问一" && r.data.prompts[1]?.text === "真实提问二");
      check("message ids carried as mid (tick data-turn-id counterpart)", r.data.prompts[0]?.mid === "msg_m0" && r.data.prompts[1]?.mid === "msg_m2");
      check("non-msg_ ids degrade to empty mid", r.data.prompts[2]?.mid === "");
      check("title + updatedAt carried", r.data.title === "夹具会话" && r.data.updatedAt === 1794000000000);
    }
    check("unknown id → not-found", (await readSessionPreview("sess_missing", home)).ok === false);
    const nf = await readSessionPreview("sess_missing", home) as { reason?: string };
    check("not-found reason", nf.reason === "not-found");
    const bad = await readSessionPreview("../etc/passwd");
    check("path-shaped id → bad-id", bad.ok === false && bad.reason === "bad-id");
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "zb-t30-empty-"));
    check("missing db → unavailable", (await readSessionPreview("sess_fix", emptyHome)).ok === false);
    check("cap constants sane", MAX_PROMPTS > 0 && MAX_PROMPT_CHARS > 0);
  }
}

// --- part E: wiring (source-level) -------------------------------------------
{
  const serveSrc = read(path.join(root, "src", "core", "server.ts"));
  check("serve exposes /api/session-preview", serveSrc.includes('"/api/session-preview"') && serveSrc.includes("readSessionPreview(session)"));
  check("sanitize accepts sessionHover", serveSrc.includes("sessionHover: cl.sessionHover === 1"));
  const both = serveSrc.split("previewApi: payload.previewApi").length - 1;
  check("BOTH manual bootstrap assembly sites carry previewApi", both === 2, `sites=${both}`);
  const injectSrc = read(path.join(root, "src", "core", "inject.ts"));
  check("previewApi gated on chatUi (non-ZCode targets stay stock)",
    injectSrc.includes("chatUi && normalizeChatLook(config.chatLook).sessionHover === 1"));
  const mcpSrc = read(path.join(root, "src", "mcp", "server.ts"));
  check("MCP apply_options exposes chat_session_hover",
    mcpSrc.includes("chat_session_hover") && mcpSrc.includes("sessionHover: chat_session_hover ? 1 : 0"));
  const panelSrc = read(path.join(root, "src", "panel", "panelScript.ts"));
  check("panel ships the toggle", panelSrc.includes('id="zb-chat-hover"'));
  check("panel posts sessionHover", panelSrc.includes("sessionHover: $('zb-chat-hover')") && panelSrc.includes("$('zb-chat-hover') && $('zb-chat-hover').addEventListener('change', pushChatLook)"));
  check("panel reflects sessionHover from config", panelSrc.includes("cl.sessionHover ?? 0"));
  // the two new dials ship on the panel: side toggle + max-rows number input
  check("panel ships the sidebar-side toggle", panelSrc.includes('id="zb-chat-hover-side"')
    && panelSrc.includes("sessionHoverSide: $('zb-chat-hover-side')"));
  check("panel ships the max-rows input", panelSrc.includes('id="zb-chat-hover-max"')
    && panelSrc.includes("sessionHoverMax:") && panelSrc.includes("zb-chat-hover-max').addEventListener('input', pushChatLook)"));
  check("panel reflects side(?? 1) + max(?? 10) from config", panelSrc.includes("cl.sessionHoverSide ?? 1") && panelSrc.includes("cl.sessionHoverMax ?? 10"));
  // The emitted bootstrap must carry the whitespace regex with a SINGLE
  // backslash (template-string doubling trap — checked against dist output
  // shape here via the source having the doubled form).
  check("collapse regex double-written in source", read(path.join(root, "src", "core", "cdp.ts")).includes("/\\\\s+/g"));
}

console.log(failed ? `T30: ${failed} check(s) FAILED` : "T30 all green");
process.exit(failed ? 1 : 0);
