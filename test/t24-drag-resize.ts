/**
 * T24 DRAG RESIZE verification (两侧拖拽调宽): the 0.5.1 toggle that mounts
 * two hidden vertical strips hugging the conversation column's edges — hover
 * reveals an accent line, dragging writes the --zb-chat-w (px) var that the
 * drag width tiers consume, the dragged width persists in localStorage and
 * outranks the 消息流宽度 tier, double-click resets to the tier.
 *   A  normalizeChatLook carries/clamps the flag (1/true → 1, else 0);
 *   B  buildPayload passes it through into the chatLook payload;
 *   C  behavioral, real bootstrap inside jsdom — one FRESH window per
 *      scenario (the bootstrap's payload-idempotency guard makes a same-
 *      payload re-eval a no-op by design; a fresh window equals a fresh
 *      page load, which is the real reload path):
 *      drag on → both strips mount + drag tiers/grip CSS in the sheet;
 *      stock fallbacks (56/6, 72/24) and config-tier fallbacks reproduce
 *      the tier formulas exactly; a stored localStorage width applies as
 *      px (rem × font size); double-click clears it; flag off → strips,
 *      observers and the var all leave; stock boot mounts nothing.
 *
 * Run: npx tsx test/t24-drag-resize.ts   (also part of: npm test)
 */
import { JSDOM } from "jsdom";
import { normalizeChatLook, buildPayload, DEFAULT_CONFIG, type BeautifyConfig } from "../src/core/inject.js";
import { buildBootstrapScript } from "../src/core/cdp.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const base: BeautifyConfig = { ...DEFAULT_CONFIG, monet: false, wallpaperVisible: false };

// --- part A: normalize --------------------------------------------------------
{
  const n = normalizeChatLook({ dragResize: 1 });
  check("normalize keeps 1", n.dragResize === 1);
  check("normalize maps true → 1", normalizeChatLook({ dragResize: true }).dragResize === 1);
  check("absent → 0 (old configs stay stock)", normalizeChatLook().dragResize === 0);
  check("junk → 0", normalizeChatLook({ dragResize: "on" as never }).dragResize === 0);
}

// --- part B: payload passthrough ---------------------------------------------
{
  const p = buildPayload({ ...base, chatLook: { dragResize: 1 } });
  check("payload.chatLook carries the flag", p.chatLook?.dragResize === 1);
  const off = buildPayload(base);
  check("absent flag normalizes to 0", off.chatLook?.dragResize === 0);
  check("payload still declares chatUi (strips are ZCode-only)", typeof off.chatUi === "boolean");
}

// --- part C: behavioral (real bootstrap, fresh window per scenario) -----------
const chatDefaults = { chatDim: 0, maskTop: 0, maskBottom: 0, frost: 0, widthCapRem: 0, widthInsetRem: 0, perfSmooth: 0, hideElapsedDecimal: 0 };

function makeWindow(seed?: { pct?: string; legacy?: string }) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://127.0.0.1/",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const { window } = dom;
  if (seed?.pct) window.localStorage.setItem("zcode-beautify:chat-drag-pct", seed.pct);
  if (seed?.legacy) window.localStorage.setItem("zcode-beautify:chat-drag-w", seed.legacy);
  const boot = (chatLook: Record<string, number>) =>
    window.eval(buildBootstrapScript({
      css: buildPayload(base).css,
      chatLook: { ...chatDefaults, ...chatLook },
      wallpaperDataUri: "",
      videoSrc: "",
    }) as string);
  return { window, boot };
}

const styleText = (w: typeof window) => w.document.getElementById("zcode-beautify-chatlook-style")?.textContent ?? "";
const widthVar = (w: typeof window) => w.document.documentElement.style.getPropertyValue("--zb-chat-w");

// C1: drag on, stock config — mounts, fallbacks reproduce the stock tiers.
{
  const { window, boot } = makeWindow();
  boot({ dragResize: 1 });
  await sleep(80); // mount + at least one rAF-coalesced sync pass
  const gl = window.document.getElementById("zcode-beautify-grip-l");
  const gr = window.document.getElementById("zcode-beautify-grip-r");
  check("both strips mounted", !!gl && !!gr);
  check("strips live on documentElement", gl!.parentElement === window.document.documentElement);
  const st = styleText(window);
  check("drag tiers present (mid first, wide second)", st.indexOf("@container conversation (min-width:864px)") > -1 && st.indexOf("@container conversation (min-width:864px)") < st.indexOf("@container conversation (min-width:1280px)"));
  check("stock mid fallback (56rem cap / 6rem inset)", st.includes("var(--zb-chat-w,56rem)") && st.includes("width:calc(100% - var(--zb-chat-inset,6rem))"));
  check("stock wide fallback (72rem cap / 24rem inset)", st.includes("var(--zb-chat-w,72rem)") && st.includes("width:calc(100% - var(--zb-chat-inset,24rem))"));
  check("no raw tier rules beside the drag tiers", !st.includes("max-width:72rem!important"));
  check("grip css mounted", st.includes("cursor:col-resize") && st.includes("zb-grip-drag"));
  check("composer floor + transition cut while dragging", st.includes("min-width:460px!important") && st.includes("transition:none!important"));
  check("strips version-marked for stale-engine remount", gl!.getAttribute("data-zb-ver") === "4");
  check("strips hidden without chat layout (jsdom rects are 0)", gl!.style.display === "none" && gr!.style.display === "none");
  check("no width var written before a drag", widthVar(window) === "");
}

// C2: pct persistence — a legacy rem key is dropped on mount; a stored
// percent is the source of truth (px derivation needs a real layout, so
// zero-width jsdom correctly writes nothing).
{
  const { window, boot } = makeWindow({ legacy: "90" });
  boot({ dragResize: 1 });
  await sleep(80);
  check("legacy rem key dropped on mount", window.localStorage.getItem("zcode-beautify:chat-drag-w") === null);
  check("legacy value does not become the drag width", widthVar(window) === "");
  const { window: w2, boot: boot2 } = makeWindow({ pct: "75" });
  boot2({ dragResize: 1 });
  await sleep(80);
  check("stored pct kept (px derives from live layout, none in jsdom)",
    w2.localStorage.getItem("zcode-beautify:chat-drag-pct") === "75" && widthVar(w2) === "");
  check("inset var skipped on bogus layout (jsdom clientWidth=0)",
    w2.document.documentElement.style.getPropertyValue("--zb-chat-inset") === "");
}

// C3: double-click resets — storage cleared, var dropped, fallbacks rule again.
{
  const { window, boot } = makeWindow({ pct: "75" });
  boot({ dragResize: 1 });
  await sleep(80);
  window.document.getElementById("zcode-beautify-grip-l")!.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
  await sleep(80);
  check("dblclick clears the stored percent", window.localStorage.getItem("zcode-beautify:chat-drag-pct") === null);
  check("dblclick drops the var", widthVar(window) === "");
}

// C4: config tier fallbacks — a set 消息流宽度 cap rides inside the drag
// tiers (84rem ceiling, 8rem inset) instead of the stock ones.
{
  const { window, boot } = makeWindow();
  boot({ dragResize: 1, widthCapRem: 84, widthInsetRem: 8 });
  await sleep(80);
  const st = styleText(window);
  check("config cap becomes the fallback (84rem cap / 8rem inset)", st.includes("var(--zb-chat-w,84rem)") && st.includes("width:calc(100% - var(--zb-chat-inset,8rem))"));
  check("stock fallbacks gone while a cap is set", !st.includes("var(--zb-chat-w,72rem)"));
}

// C5: flag off through a changed payload — strips, observers and var leave
// (the stored percent survives: it is user data, not engine state).
{
  const { window, boot } = makeWindow({ pct: "75" });
  boot({ dragResize: 1 });
  await sleep(80);
  boot({ dragResize: 0, widthCapRem: 84, widthInsetRem: 8 });
  await sleep(80);
  check("flag off removes both strips", !window.document.getElementById("zcode-beautify-grip-l")
    && !window.document.getElementById("zcode-beautify-grip-r"));
  const st = window.__zcodeBeautify as unknown as { gripObs: unknown; dragOn: unknown; gripWinResize: unknown };
  check("flag off drops the observers", !st.gripObs && !st.gripWinResize && st.dragOn === false);
  check("flag off drops the width var", widthVar(window) === "");
  check("flag off keeps the stored percent", window.localStorage.getItem("zcode-beautify:chat-drag-pct") === "75");
  // cap stays on via the config tiers; now drop everything at once.
  boot({ dragResize: 0, widthCapRem: 0, widthInsetRem: 0 });
  await sleep(80);
  check("all-off removes the chat style element", !window.document.getElementById("zcode-beautify-chatlook-style"));
}

// C6: stock boot never mounts anything.
{
  const { window, boot } = makeWindow();
  boot({ dragResize: 0 });
  await sleep(60);
  check("stock boot mounts no strips", !window.document.getElementById("zcode-beautify-grip-l")
    && !window.document.getElementById("zcode-beautify-grip-r"));
  check("stock boot writes no width var", widthVar(window) === "");
}

console.log(failed ? `\n${failed} FAILED` : "\nall ok");
process.exit(failed ? 1 : 0);
