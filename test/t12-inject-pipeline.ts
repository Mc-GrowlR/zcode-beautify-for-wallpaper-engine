/**
 * T12 INJECTION PIPELINE verification: the serve-side chain that turns panel
 * settings into injected code — normalizeBubbleLook → buildPayload (theme
 * css) → buildBootstrapScript (RECIPES/CUSTOM_CSS/CHAT baking). These are
 * the contracts the jsdom panel suite (t11) cannot see: everything here runs
 * against the REAL production builders, no mocks.
 *
 * Run: npx tsx test/t12-inject-pipeline.ts   (also part of: npm test)
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  normalizeBubbleLook,
  normalizeChatLook,
  STOCK_CHAT_WIDTH,
  buildPayload,
  DEFAULT_CONFIG,
  DEFAULT_BUBBLE_LOOK,
} from "../src/core/inject.js";
import { buildBootstrapScript } from "../src/core/cdp.js";
import {
  sanitizeCustomBubbleCss,
  rewriteCustomBubbleCss,
  bubbleRecipes,
  BUBBLE_SELECTOR_REAL,
  BUBBLE_ROW_SELECTOR_REAL,
  BUBBLE_SELECTOR_PREVIEW,
  CUSTOM_CSS_MAX,
} from "../src/core/bubbleRecipes.js";
import { VERSION, REPO_URL, FORK_URL } from "../src/version.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}

// --- part A: version consistency across every metadata file -------------------
{
  const root = fileURLToPath(new URL("../", import.meta.url));
  const pkg = JSON.parse(fs.readFileSync(`${root}package.json`, "utf8"));
  const plugin = JSON.parse(fs.readFileSync(`${root}.zcode-plugin/plugin.json`, "utf8"));
  check("version.ts matches package.json", VERSION === pkg.version, `${VERSION} vs ${pkg.version}`);
  check("version.ts matches .zcode-plugin/plugin.json", VERSION === plugin.version, `${VERSION} vs ${plugin.version}`);
  check("repo urls are distinct and well-formed",
    REPO_URL.startsWith("https://github.com/") && FORK_URL.startsWith("https://github.com/") && REPO_URL !== FORK_URL);
}

// --- part B: normalizeBubbleLook matrix ----------------------------------------
{
  const d = normalizeBubbleLook();
  check("empty input → full defaults",
    d.preset === DEFAULT_BUBBLE_LOOK.preset && d.tint === 28 && d.radius === 12 && d.width === 70 && d.align === "right");

  const c = normalizeBubbleLook({ tint: -5, radius: 2, width: 99, align: "junk" as unknown as "left" });
  check("knobs clamp to their ranges", c.tint === 0 && c.radius === 4 && c.width === 90, JSON.stringify(c));
  const hi = normalizeBubbleLook({ tint: 300, radius: 99, width: 10 });
  check("knobs clamp from above too", hi.tint === 100 && hi.radius === 24 && hi.width === 40);

  check("unknown preset falls back to default", normalizeBubbleLook({ preset: "nope" as never }).preset === "default");
  check("custom preset survives", normalizeBubbleLook({ preset: "custom" }).preset === "custom");
  check("align left survives", normalizeBubbleLook({ align: "left" }).align === "left");
  check("non-string customCss → empty", normalizeBubbleLook({ customCss: 42 as never }).customCss === "");
  const n = normalizeBubbleLook({ preset: "custom", customCss: ".zb-bubble{x}</style>@import url(e);" });
  check("normalize sanitizes customCss", !n.customCss!.includes("</style") && !n.customCss!.includes("@import"));
}

// --- part C: sanitizeCustomBubbleCss + rewriteCustomBubbleCss ------------------
{
  check("sanitize hard cap", sanitizeCustomBubbleCss("a".repeat(CUSTOM_CSS_MAX + 5000)).length <= CUSTOM_CSS_MAX);
  check("sanitize neutralizes escaping + imports + js: urls",
    sanitizeCustomBubbleCss("</style><style>@import 'x';a{b:url(javascript:1)}").includes("javascript") === false
      && sanitizeCustomBubbleCss("</style><style>@import 'x';a{b:url(javascript:1)}").includes("@import") === false);
  check("sanitize keeps ordinary rules intact", sanitizeCustomBubbleCss(".zb-bubble{border-radius:4px 12px}") === ".zb-bubble{border-radius:4px 12px}");

  const rw = rewriteCustomBubbleCss(
    ".zb-bubble-row{gap:4px}.zb-bubble{color:red}.zb-bubble-rowkit{keep}",
    BUBBLE_SELECTOR_REAL,
    BUBBLE_ROW_SELECTOR_REAL,
  );
  check("row selector rewritten (before bubble)", rw.startsWith(BUBBLE_ROW_SELECTOR_REAL + "{gap:4px}"));
  check("bubble selector rewritten", rw.includes(BUBBLE_SELECTOR_REAL + "{color:red}"));
  check("lookahead spares longer class names", rw.includes(".zb-bubble-rowkit{keep}"));
  check("no friendly selector survives the rewrite", !rw.includes(".zb-bubble{") && !rw.includes(".zb-bubble-row{"));

  // One source of truth: preview recipes must use the preview class names,
  // the real ones are baked separately (no selector drift between the two).
  const pv = bubbleRecipes(BUBBLE_SELECTOR_PREVIEW);
  const real = bubbleRecipes(BUBBLE_SELECTOR_REAL);
  check("preview recipes bound to preview selector", pv.accent.startsWith(BUBBLE_SELECTOR_PREVIEW + "{"));
  check("real recipes bound to the real selector", real.accent.startsWith(BUBBLE_SELECTOR_REAL + "{"));
  check("all four presets exist in both bindings",
    ["accent", "glass", "outline", "flat"].every((k) => k in pv && k in real));
}

// --- part D: buildBootstrapScript baking ---------------------------------------
{
  const real = bubbleRecipes(BUBBLE_SELECTOR_REAL);
  const boot = buildBootstrapScript({
    css: "",
    chatLook: { chatDim: 40, maskTop: 5, maskBottom: 6, frost: 7, widthCapRem: 0, widthInsetRem: 0, perfSmooth: 0 },
    bubbleLook: {
      preset: "custom",
      tint: 28,
      radius: 12,
      width: 70,
      align: "right",
      // RAW friendly selectors: production normalizes first, the bootstrap
      // bakes the rewritten form — this asserts the rewrite really happened.
      customCss: ".zb-bubble{box-shadow:0 0 9px gold}.zb-bubble-row{gap:6px}",
    },
  });
  check("recipes baked with the real bubble selector", boot.includes(real.accent));
  // CUSTOM_CSS is baked JSON.stringify'd (quotes inside the row selector get
  // escaped) — extract the var and un-JSON it before asserting.
  const customVar = boot.match(/var CUSTOM_CSS = "([\s\S]*?)";/);
  const customBaked = customVar ? JSON.parse(`"${customVar[1]}"`) as string : "";
  check("CUSTOM_CSS var extracted from the bootstrap", customBaked.length > 0);
  check("custom css baked REWRITTEN to the real selector", customBaked.includes(BUBBLE_SELECTOR_REAL + "{box-shadow:0 0 9px gold}"));
  check("custom row css rewritten too", customBaked.includes(BUBBLE_ROW_SELECTOR_REAL + "{gap:6px}"));
  check("no friendly selectors inside CUSTOM_CSS", !customBaked.includes(".zb-bubble"));
  check("chat look values baked as json", boot.includes('"chatDim":40') || boot.includes("\\\"chatDim\\\":40") || boot.includes("chatDim"));
  check("default preset removes the bubble style (guard baked)", boot.includes("B.preset === 'default'"));
  check("custom preset keeps base rules even with empty css (guard baked)", boot.includes("B.preset !== 'custom'"));
}

// --- part E: buildPayload theme css --------------------------------------------
{
  const payload = buildPayload({
    ...DEFAULT_CONFIG,
    port: 9222,
    dim: 0,
    bubbleLook: { preset: "custom", customCss: ".zb-bubble{x}</style>" },
  });
  check("payload wallpaper layer present", payload.css.includes("#zcode-beautify-wallpaper"));
  check("payload bakes the queue overlap mask", payload.css.includes("[data-testid=\"v4-queue\"]"));
  check("queue mask is transparent (no veil/stack band)", payload.css.includes("mask-image") && !payload.css.includes("--color-popover"));
  check("payload normalizes bubbleLook.customCss (serve-side sanitize)", !payload.bubbleLook?.customCss?.includes("</style"));
  check("payload keeps the custom preset", payload.bubbleLook?.preset === "custom");
  check("no dim overlay at dim=0", !payload.css.includes("--zcode-beautify-dim"));

  const dimmed = buildPayload({ ...DEFAULT_CONFIG, port: 9222, dim: 25 });
  check("dim overlay present at dim>0", dimmed.css.includes("--zcode-beautify-dim"));
  check("payload transition defaults to fade", dimmed.transition === "fade");
}

// --- part F: conversation column width (消息流宽度) ------------------------------
{
  const d = normalizeChatLook();
  check("width defaults to stock (0/0)", d.widthCapRem === 0 && d.widthInsetRem === 0, JSON.stringify(d));
  const w = normalizeChatLook({ widthCapRem: 84, widthInsetRem: 12 });
  check("cap+inset survive", w.widthCapRem === 84 && w.widthInsetRem === 12);
  const defInset = normalizeChatLook({ widthCapRem: 90 });
  check("cap without inset defaults inset to 12", defInset.widthInsetRem === 12);
  const clamped = normalizeChatLook({ widthCapRem: 300, widthInsetRem: 99 });
  check("cap clamps to 120, inset to 24", clamped.widthCapRem === 120 && clamped.widthInsetRem === 24);
  const tiny = normalizeChatLook({ widthCapRem: 20 });
  check("cap below 40 reads as stock (0)", tiny.widthCapRem === 0 && tiny.widthInsetRem === 0);
  const off = normalizeChatLook({ widthCapRem: 0, widthInsetRem: 12 });
  check("inset ignored when cap is off", off.widthInsetRem === 0);
  check("stock constants stay documented", STOCK_CHAT_WIDTH.capRem === 72 && STOCK_CHAT_WIDTH.insetRem === 24);

  const wide = buildBootstrapScript({
    css: "",
    chatLook: { chatDim: 0, maskTop: 0, maskBottom: 0, frost: 0, widthCapRem: 90, widthInsetRem: 8 },
  });
  // The bootstrap assembles the CSS at RUNTIME (applyChatLook), so these
  // assert the baked CODE, not the final string; the resulting CSS itself is
  // verified end-to-end against a live ZCode (test/cdp-live.mjs flow).
  check("wide tier rule construction baked",
    wide.includes("@container conversation (min-width:1280px)") &&
    wide.includes("[class*=\"conversation:max-w-6xl\"]"));
  check("width stays a formula (calc + rem), never a fixed width",
    wide.includes("width:calc(100% - ' + inset + 'rem)!important") &&
    wide.includes("max-width:' + cap + 'rem!important"));
  check("mid tier raises only the 4xl ceiling",
    wide.includes("@container conversation (min-width:864px)") &&
    wide.includes("[class*=\"conversation:max-w-4xl\"]") &&
    !wide.includes("max-w-4xl\"]{max-width:' + cap + 'rem!important;width:"));
  check("width-only look keeps the chatlook style mounted (widthCapRem>=40 gate baked)",
    wide.includes("widthCapRem") && wide.includes("masksOn"));

  const stock = buildBootstrapScript({
    css: "",
    chatLook: { chatDim: 30, maskTop: 0, maskBottom: 0, frost: 0, widthCapRem: 0, widthInsetRem: 0, perfSmooth: 0 },
  });
  check("stock width config bakes cap 0 (runtime emits no container rules)",
    stock.includes('widthCapRem\\":0') && stock.includes("var widthOn = cap >= 40"));

  const viaPayload = buildPayload({ ...DEFAULT_CONFIG, port: 9222, chatLook: { widthCapRem: 84 } });
  check("buildPayload normalizes chatLook width (default inset)", viaPayload.chatLook?.widthCapRem === 84 && viaPayload.chatLook?.widthInsetRem === 12);

  // perfSmooth (大会话流畅模式): content-visibility injection
  check("perfSmooth defaults off", normalizeChatLook().perfSmooth === 0);
  check("perfSmooth accepts 1 only", normalizeChatLook({ perfSmooth: 1 }).perfSmooth === 1
    && normalizeChatLook({ perfSmooth: 2 }).perfSmooth === 0);
  const smooth = buildBootstrapScript({ css: "", chatLook: { chatDim: 0, maskTop: 0, maskBottom: 0, frost: 0, widthCapRem: 0, widthInsetRem: 0, perfSmooth: 1 } });
  // The engine is measure-then-skip: real height goes into an inline
  // contain-intrinsic-size BEFORE content-visibility turns on, so the
  // dynamic-height virtualizer's total size never lies (a global CSS rule
  // with a 420px estimate measurably shrank it 6x — scrollbar distortion).
  check("smooth engine bakes measure-then-skip functions",
    smooth.includes("function perfSched") && smooth.includes("function perfApply") &&
    smooth.includes("containIntrinsicSize") && smooth.includes("contentVisibility"));
  check("smooth engine marks processed rows for clean teardown",
    smooth.includes("data-zb-cv") && smooth.includes("setAttribute('data-zb-cv', '1')"));
  check("smooth gate is perfSmooth===1", smooth.includes("Number(C.perfSmooth) === 1"));
  check("no global CV stylesheet rule (the 6x-distortion approach stays dead)",
    !smooth.includes("contain-intrinsic-size:auto 420px") && !smooth.includes("content-visibility:auto!important"));
}

console.log(failed ? `\nT12: ${failed} check(s) FAILED` : "\nT12: all checks passed");
process.exit(failed ? 1 : 0);
