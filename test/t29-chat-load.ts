/**
 * T29 CHAT LOAD LOOK + COMPOSER FADE verification (会话底部加载图标 + 输入框透明度):
 *   A  normalizeChatLoadLook gates/clamps every field (classic passes without
 *      an image; image without a ref degrades to default; size clamps 10-28);
 *   B  chatLook composerFade normalizes 0-100 (pct semantics);
 *   C  buildPayload bakes the normalized chatLoadLook with the image resolved,
 *      and WorkBuddy is forced to stock exactly like the other chat extras;
 *   D  the bootstrap carries applyLoadLook + the classic wave CSS markers
 *      (@property registrations, ONE comma-listed animation, chat-loading
 *      selectors) + the loadKey fast path + the composer-fade var rule;
 *   E  the reset script cleans up -load-style and loadKey;
 *   F  the panel ships the new UI (mode select / pick / preview rows,
 *      composer slider) and posts chatLoadLook + composerFade;
 *   G  serve wiring: sanitize accepts chatLoadLook, the loading upload slot
 *      routes into chatLoadLook, publicConfig exposes chatLoadImageUrl.
 *
 * Run: npx tsx test/t29-chat-load.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeChatLoadLook, normalizeChatLook, buildPayload, DEFAULT_CONFIG, resolveSpinnerImageRef, type BeautifyConfig } from "../src/core/inject.js";
import { buildBootstrapScript, buildResetScript } from "../src/core/cdp.js";
import { buildPanelScript } from "../src/panel/panelScript.js";
import { baseConfig } from "../src/core/session.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}
const root = fileURLToPath(new URL("../", import.meta.url));
function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

process.env.ZCODE_BEAUTIFY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zb-t29-"));
const dataDirPath = process.env.ZCODE_BEAUTIFY_DATA_DIR;

const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

// --- part A: normalize -------------------------------------------------------
{
  const classic = normalizeChatLoadLook({ mode: "classic" });
  check("classic needs no image", classic.mode === "classic" && classic.spin === true && classic.size === 16);
  const img = normalizeChatLoadLook({ mode: "image", image: "  C:/x/cat.gif  ", spin: false, size: 99 });
  check("image mode trims the ref, drops spin, clamps size to 28",
    img.mode === "image" && img.image === "C:/x/cat.gif" && img.spin === false && img.size === 28,
    JSON.stringify(img));
  const tiny = normalizeChatLoadLook({ mode: "image", image: "a.gif", size: 3 });
  check("size below 10 clamps to 10", tiny.size === 10);
  const noImg = normalizeChatLoadLook({ mode: "image" });
  check("image mode without a ref degrades to default", noImg.mode === "default");
  const junk = normalizeChatLoadLook({ mode: "banana" as never });
  check("unknown mode falls back to default", junk.mode === "default");
  const empty = normalizeChatLoadLook();
  check("absent input → full default look",
    empty.mode === "default" && empty.image === "" && empty.spin === true && empty.size === 16);
}

// --- part B: composerFade normalize -----------------------------------------
{
  const n = normalizeChatLook({ composerFade: 40, chatDim: 200 });
  check("composerFade survives normalize as an int pct", n.composerFade === 40);
  check("composerFade 0 = explicit opaque (kept)", normalizeChatLook({ composerFade: 0 }).composerFade === 0);
  check("composerFade junk → 50 (stock-look default)", normalizeChatLook({ composerFade: "x" as never }).composerFade === 50);
  check("default composerFade = 50 (≈ stock, old configs unchanged)", normalizeChatLook().composerFade === 50);
}

// --- part C: payload ---------------------------------------------------------
{
  const base: BeautifyConfig = { ...DEFAULT_CONFIG, apiPort: 9223 };
  const config: BeautifyConfig = {
    ...base,
    chatLoadLook: { mode: "classic" },
    chatLook: { composerFade: 55 },
  };
  const payload = buildPayload(config, undefined, "tok");
  check("payload carries classic chatLoadLook", payload.chatLoadLook?.mode === "classic");
  check("payload carries composerFade", payload.chatLook?.composerFade === 55);

  // image mode with a spinner/-subdir file resolves to the spinner media URL
  const spinnerDir = path.join(dataDirPath, "spinner");
  fs.mkdirSync(spinnerDir, { recursive: true });
  const gifPath = path.join(spinnerDir, "spinner-loading.gif");
  fs.writeFileSync(gifPath, Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
  const p2 = buildPayload({ ...base, chatLoadLook: { mode: "image", image: gifPath } }, undefined, "tok");
  check("chatLoadLook image resolves to media URL",
    p2.chatLoadLook?.image === `http://127.0.0.1:9223/media/spinner/spinner-loading.gif?t=tok`,
    p2.chatLoadLook?.image ?? "");
  // unresolvable ref degrades to default (never a broken url() in the CSS)
  const p3 = buildPayload({ ...base, chatLoadLook: { mode: "image", image: "Z:/nope.gif" } }, undefined, "");
  check("unresolvable ref degrades to default", p3.chatLoadLook?.mode === "default" && p3.chatLoadLook.image === "");

  // baseConfig partial merge keeps the stored look (MCP path)
  const stored: Partial<BeautifyConfig> = { ...base, chatLoadLook: { mode: "image", image: "D:/icons/cat.gif", spin: false, size: 18 } };
  const untouched = baseConfig({}, stored);
  check("opts without chatLoadLook keep the stored look",
    untouched.chatLoadLook?.mode === "image" && untouched.chatLoadLook.image === "D:/icons/cat.gif");
  const patched = baseConfig({ chatLoadLook: { mode: "classic" } }, stored);
  check("classic patch keeps the stored ref for later",
    patched.chatLoadLook?.mode === "classic" && patched.chatLoadLook.image === "D:/icons/cat.gif");
}

// --- part D: behavioral (real bootstrap, fresh jsdom per scenario) -----------
{
  const { JSDOM } = await import("jsdom");
  const makeWindow = () => new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://127.0.0.1/",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  }).window;

  // D1: classic mode — the wave CSS is built at RUNTIME by applyLoadLook, so
  // assert on the style element's actual textContent, not the bootstrap source.
  {
    const w = makeWindow();
    w.eval(buildBootstrapScript({
      css: "",
      chatLoadLook: { mode: "classic", image: "", spin: true, size: 16 },
      chatLook: { ...normalizeChatLook({ composerFade: 30 }) },
    }));
    const st = w.document.getElementById("zcode-beautify-load-style");
    check("classic mounts the -load-style element", !!st);
    const css = st?.textContent ?? "";
    check("classic registers all eight @property drivers",
      Array.from({ length: 8 }, (_, i) => `@property --zb-ld-p${i}{syntax:"<number>";inherits:false;initial-value:0}`).every((s) => css.includes(s)));
    check("classic uses ONE comma-listed staggered animation",
      css.includes("animation:zb-ld-w0 950ms linear infinite 0ms,zb-ld-w1 950ms linear infinite 110ms,")
      && css.includes("zb-ld-w7 950ms linear infinite 770ms!important"));
    check("classic anchors the 3.18 loading row",
      css.includes('[data-chat-loading-icon="true"]') && css.includes("width:13px!important;height:13px!important"));
    check("classic hides the stock glyph", css.includes("[data-chat-loading-icon=\"true\"]>*{display:none!important}"));
    check("classic paints nine gradient tiles incl. the static center",
      (css.match(/radial-gradient\(circle,/g) || []).length === 9 && css.includes("/ .07) 0 62%"));
    check("classic guards relative-color support", css.includes("@supports (color: rgb(from red r g b / 50%))"));
    check("classic colors ride the foreground token", css.includes("var(--color-foreground"));

    // D1b: composer fade rule in the chatlook style — the token's OWN alpha is
    // stripped (rgb(from …)) so the slider is the single source of truth.
    const cl = w.document.getElementById("zcode-beautify-chatlook-style")?.textContent ?? "";
    check("composer fade rule forces alpha 1 then mixes live",
      cl.includes("[data-composer-layout]{background-color:color-mix(in srgb, rgb(from var(--color-input, rgba(128,128,128,.35)) r g b / 1) calc(100% - var(--zb-composer-fade, 50)*1%), transparent) !important}"));
    check("composer fade var baked at 30", cl.includes("--zb-composer-fade:30}"));
    check("chatlook style stays mounted with every other feature off",
      cl.length > 0 && cl.includes("--zb-composer-fade:"));
  }

  // D2: image mode — url painted, spin toggle decides the rotation rule.
  {
    const w = makeWindow();
    const dataUri = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    w.eval(buildBootstrapScript({ css: "", chatLoadLook: { mode: "image", image: dataUri, spin: false, size: 20 } }));
    const css = w.document.getElementById("zcode-beautify-load-style")?.textContent ?? "";
    check("image mode paints the url with the custom size",
      css.includes(`background:url("${dataUri}") center/contain no-repeat!important`) && css.includes("width:20px!important"));
    check("spin=false bakes no rotation", !css.includes("zb-ld-rot"));
  }
  {
    const w = makeWindow();
    const dataUri = "data:image/png;base64,iVBORw0KGgo=";
    w.eval(buildBootstrapScript({ css: "", chatLoadLook: { mode: "image", image: dataUri, spin: true, size: 16 } }));
    const css = w.document.getElementById("zcode-beautify-load-style")?.textContent ?? "";
    check("spin=true adds the rotation rule", css.includes("zb-ld-rot 1s linear infinite!important"));
  }

  // D3: default mode injects nothing (and removes a stale style element).
  {
    const w = makeWindow();
    w.eval(buildBootstrapScript({ css: "", chatLoadLook: { mode: "classic", image: "", spin: true, size: 16 } }));
    check("D3 setup: classic style present", !!w.document.getElementById("zcode-beautify-load-style"));
    w.eval(buildBootstrapScript({ css: "", chatLoadLook: { mode: "default", image: "", spin: true, size: 16 } }));
    check("default mode removes the style element (fast path)",
      !w.document.getElementById("zcode-beautify-load-style"));
  }
}

// --- part E: reset ----------------------------------------------------------
{
  const reset = buildResetScript();
  check("reset removes -load-style and clears loadKey",
    reset.includes("'-load-style'") && reset.includes("loadKey = null"));
}

// --- part F: panel ----------------------------------------------------------
{
  const panel = buildPanelScript(9223, "tok", true, { appName: "ZCode", chatUi: true, hasUpdater: false });
  check("panel ships the 会话底部加载图标 block", panel.includes("会话底部加载图标"));
  check("panel mode select carries all three modes",
    panel.includes('<option value="default">新版(原生)</option>') && panel.includes('<option value="classic">旧版波浪</option>') && panel.includes('<option value="image">自定义图片</option>'));
  check("panel load picker + preview + spin + size rows exist",
    panel.includes('id="zb-load-pick"') && panel.includes('id="zb-load-preview"') && panel.includes('id="zb-load-spin"') && panel.includes('id="zb-load-size"'));
  check("panel uploads through the loading slot", panel.includes("slot: 'loading'"));
  check("panel pushes chatLoadLook", panel.includes("chatLoadLook: loadUIState()"));
  check("panel ships the composer fade slider", panel.includes('id="zb-chat-composer"'));
  check("panel composer slider previews via the var", panel.includes("--zb-composer-fade"));
  check("panel push carries composerFade", panel.includes("composerFade: Number($('zb-chat-composer').value)"));
  check("panel images-list fill sized against the pane", panel.includes("sizeImagesList") && panel.includes("zb-card-images"));
  check("panel fill honors the rows-preference floor", panel.includes("zbRowH * libRows.images"));
}

// --- part G: serve wiring ---------------------------------------------------
{
  const serveSrc = read(path.join(root, "src", "core", "server.ts"));
  check("sanitize accepts chatLoadLook", serveSrc.includes("out.chatLoadLook = normalizeChatLoadLook(body.chatLoadLook)"));
  check("upload slot loading routes into chatLoadLook", serveSrc.includes('body?.slot === "loading"') && serveSrc.includes("chatLoadLook: { ...look, mode: \"image\""));
  check("publicConfig exposes the resolved preview URL", serveSrc.includes("chatLoadImageUrl"));
  const mcpSrc = read(path.join(root, "src", "mcp", "server.ts"));
  check("MCP apply_options exposes chat_loading_icon + chat_composer_fade",
    mcpSrc.includes("chat_loading_icon") && mcpSrc.includes("chat_composer_fade"));
}

console.log(failed ? `T29: ${failed} check(s) FAILED` : "T29 all green");
process.exit(failed ? 1 : 0);
