/**
 * The injected settings panel: a floating, draggable panel in the ZCode
 * renderer for live-tuning blur/dim, toggling Monet colors and wallpaper
 * visibility, and swapping the wallpaper image — all via the local API
 * started by `zcode-beautify serve`.
 *
 * The script always rebuilds the panel, so a stale copy left in the DOM can
 * never shadow a newer script version, and it is safe to re-evaluate on every
 * injection or reload.
 */

import { VERSION, REPO_URL, FORK_URL, AUTHOR, LICENSE } from "../version.js";
import { bubbleRecipes, BUBBLE_SELECTOR_PREVIEW } from "../core/bubbleRecipes.js";

export const PANEL_ROOT_ID = "zcode-beautify-panel-root";

export function buildPanelScript(apiPort: number, apiToken = "", startupClean = true): string {
  const api = `http://127.0.0.1:${apiPort}`;
  return `(function(){
  var API = ${JSON.stringify(api)};
  var TOKEN = ${JSON.stringify(apiToken)};
  var STARTUP_CLEAN = ${JSON.stringify(startupClean !== false)};
  var VERSION = ${JSON.stringify(VERSION)};
  var REPO_URL = ${JSON.stringify(REPO_URL)};
  var FORK_URL = ${JSON.stringify(FORK_URL)};
  var AUTHOR = ${JSON.stringify(AUTHOR)};
  var LICENSE = ${JSON.stringify(LICENSE)};
  // Preview recipes mirror serve's injection table (core/bubbleRecipes.ts):
  // same CSS, but bound to the PREVIEW class names the iframe uses, so a
  // built-in preset previews identically to how it lands in ZCode.
  var PV_RECIPES = ${JSON.stringify(bubbleRecipes(BUBBLE_SELECTOR_PREVIEW))};
  var ZB_BUBBLE_EXAMPLE = ${JSON.stringify(`.zb-bubble {
  background: linear-gradient(135deg,
    color-mix(in srgb, var(--color-primary) calc(var(--zb-bubble-tint) * 100%), transparent),
    transparent) !important;
  border: 1px solid color-mix(in srgb, var(--color-primary) 60%, transparent) !important;
  box-shadow: 0 6px 24px rgb(0 0 0 / .35) !important;
  backdrop-filter: blur(10px);
}
.zb-bubble-row { gap: 4px; }`)};
  /** Authenticated fetch: every API call carries the per-start token.
   * Non-2xx responses REJECT — a 401 body like {"error":...} otherwise
   * parses as valid data (undefined fields) and quietly poisons every
   * consumer (the 轮播状态 "未启用" ghost came exactly from there). */
  function apiFetch(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'X-Beautify-Token': TOKEN }, opts.headers || {});
    return fetch(API + path, opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + path);
      return r;
    });
  }
  /** Media URLs (<img>/<video> cannot send headers) authenticate via ?t=. */
  function mt(url) { return TOKEN ? url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + TOKEN : url; }
  var ROOT_ID = ${JSON.stringify(PANEL_ROOT_ID)};
  var runPanel = function() {
  // Always rebuild: an older panel left in the DOM would otherwise shadow the
  // current script version forever (the old build skipped installation).
  var stale = document.getElementById(ROOT_ID);
  if (stale) stale.remove();
  var staleStyle = document.getElementById('zcode-beautify-panel-style');
  if (staleStyle) staleStyle.remove();
  // A popup the previous panel version left open survives its panel root;
  // it belongs to a dead closure now — sweep it so it cannot shadow the
  // next openWePop.
  var stalePops = document.querySelectorAll('body > .zb-we-pop');
  for (var spi = 0; spi < stalePops.length; spi++) stalePops[spi].remove();
  // Kill the PREVIOUS panel generation's intervals: every serve restart
  // re-evaluates this script, and old closures kept polling forever with
  // their dead tokens — each 401 body parsed as data and fought the new
  // panel (the 轮播状态 line flipped to 未启用 once a second). All panel
  // intervals register through zbEvery so this sweep reaches them.
  if (window.__zbTimers) {
    for (var zti = 0; zti < window.__zbTimers.length; zti++) {
      try { clearInterval(window.__zbTimers[zti]); } catch (e) {}
    }
  }
  window.__zbTimers = [];
  var zbEvery = function (fn, ms) {
    var id = setInterval(fn, ms);
    window.__zbTimers.push(id);
    return id;
  };

  var css = [
    '#zcode-beautify-panel-root, #zcode-beautify-panel-root * { box-sizing: border-box; font-family: system-ui, sans-serif; }',
    '#zcode-beautify-panel-root { position: fixed; inset: auto; z-index: 2147483647; font-size: 12px; color: #e8e8ea; }',
    '#zb-fab { position: fixed; right: 18px; bottom: 18px; width: 34px; height: 34px; border-radius: 50%;',
      ' background: rgba(32,32,38,.78); border: 1px solid rgba(255,255,255,.12); cursor: pointer;',
      ' display: flex; align-items: center; justify-content: center; backdrop-filter: blur(10px);',
      ' box-shadow: 0 2px 12px rgba(0,0,0,.35); user-select: none; font-size: 15px; line-height: 1; }',
    '#zb-fab:hover { background: rgba(52,52,60,.85); }',
    // Window shell: sidebar + content settings window (the reference layout),
    // still one floating draggable panel over ZCode. Only the body column
    // scrolls, so the sidebar stays put.
    '#zb-panel { position: fixed; right: 18px; bottom: 60px; width: min(680px, calc(100vw - 36px));',
      // FIXED height (not max-height): every settings page renders in the
      // same-size window — switching tabs must not resize the panel.
      ' height: min(620px, calc(100vh - 68px)); display: flex; flex-direction: column; padding: 0;',
      ' background: rgba(22,22,28,.92); border: 1px solid rgba(255,255,255,.12); border-radius: 14px;',
      ' backdrop-filter: blur(22px); box-shadow: 0 12px 44px rgba(0,0,0,.5); user-select: none; overflow: hidden; }',
    '#zb-panel[hidden] { display: none; }',
    '#zb-head { flex: none; height: 40px; padding: 0 8px 0 16px; font-weight: 600; font-size: 13px; cursor: move;',
      ' border-bottom: 1px solid rgba(255,255,255,.09); display: flex; justify-content: space-between; align-items: center; }',
    '#zb-head .zb-head-sub { font-weight: 400; font-size: 11px; opacity: .5; margin-left: 8px; }',
    '#zb-close { width: 28px; height: 28px; border-radius: 7px; background: none; border: none; color: inherit;',
      ' opacity: .55; font-size: 14px; line-height: 1; cursor: pointer; }',
    '#zb-close:hover { opacity: 1; background: rgba(255,255,255,.1); }',
    '#zb-mid { flex: 1; min-height: 0; display: flex; }',
    // Sidebar: brand, search, nav. The selected item carries an accent bar on
    // its left edge (the reference's selection bar, in our blue).
    '#zb-side { flex: none; width: 158px; display: flex; flex-direction: column; gap: 10px; padding: 12px 10px;',
      ' background: rgba(0,0,0,.2); border-right: 1px solid rgba(255,255,255,.07); }',
    '#zb-brand { display: flex; align-items: center; gap: 7px; padding: 0 4px; font-size: 15px; font-weight: 700;',
      ' color: #9db8ff; }',
    '#zb-search { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 8px;',
      ' background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.08); }',
    '#zb-search input { flex: 1; min-width: 0; background: none; border: none; outline: none; color: inherit;',
      ' font-size: 12px; padding: 0; }',
    '#zb-search input::placeholder { color: rgba(255,255,255,.35); }',
    '#zb-search .zb-search-ico { opacity: .45; font-size: 11px; flex: none; }',
    '#zb-tabs { display: flex; flex-direction: column; gap: 2px; flex: 1; }',
    // 关于 sits at the BOTTOM of the sidebar, like the reference layout.
    '#zb-tabs .zb-tab[data-tab="about"] { margin-top: auto; }',
    '.zb-tab { position: relative; display: flex; align-items: center; gap: 9px; text-align: left; padding: 8px 10px;',
      ' border-radius: 8px; cursor: pointer; background: none; border: none; color: inherit; font-size: 12.5px;',
      ' opacity: .75; transition: background .12s ease, opacity .12s ease; }',
    '.zb-tab:hover { background: rgba(255,255,255,.07); opacity: 1; }',
    '.zb-tab .zb-ico { flex: none; width: 18px; text-align: center; font-size: 14px; }',
    '.zb-tab[data-active="1"] { background: rgba(122,162,247,.16); opacity: 1; color: #dbe6ff; font-weight: 600; }',
    '.zb-tab[data-active="1"]::before { content: ""; position: absolute; left: -10px; top: 7px; bottom: 7px; width: 3px;',
      ' border-radius: 2px; background: #7aa2f7; }',
    '#zb-tab-main.zb-pane-in, #zb-tab-look.zb-pane-in, #zb-tab-chat.zb-pane-in, #zb-tab-sched.zb-pane-in, #zb-tab-settings.zb-pane-in, #zb-tab-about.zb-pane-in { animation: zb-pane-in 150ms ease; }',
    '@keyframes zb-pane-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }',
    '#zb-body { flex: 1; min-width: 0; overflow-y: auto; overscroll-behavior: contain; padding: 12px 16px 16px;',
      ' display: flex; flex-direction: column; }',
    '#zb-body::-webkit-scrollbar { width: 5px; }',
    '#zb-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 3px; }',
    // A block = section label sitting ABOVE its card (the reference layout).
    '.zb-block { margin-bottom: 14px; }',
    '[id^="zb-tab-"]:not([hidden]) > .zb-block:last-child { margin-bottom: 0; }',
    // Fixed-height window + short page = leftover blank under the last card.
    // Stretch the visible pane's LAST block (and its last card) to fill the
    // column so the card surface runs to the bottom edge instead of raw empty
    // space. (Blocks sit inside pane divs, not directly under #zb-body — and
    // :not([hidden]) keeps display:flex from un-hiding the inactive panes.)
    // Pages taller than the window keep scrolling — flex-grow only claims
    // leftover space.
    '[id^="zb-tab-"]:not([hidden]) { flex: 1; display: flex; flex-direction: column; }',
    '[id^="zb-tab-"]:not([hidden]) > .zb-block:last-child { flex: 1; display: flex; flex-direction: column; }',
    '[id^="zb-tab-"]:not([hidden]) > .zb-block:last-child .zb-collapse-wrap { flex: 1; }',
    '[id^="zb-tab-"]:not([hidden]) > .zb-block:last-child .zb-collapse-inner { display: flex; flex-direction: column; flex: 1; }',
    '[id^="zb-tab-"]:not([hidden]) > .zb-block:last-child .zb-card:last-child { flex: 1; }',
    '.zb-block-title { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600;',
      ' opacity: .55; margin: 0 2px 7px; }',
    '.zb-block-title .zb-fold { margin-left: auto; }',
    '.zb-sub-title { font-size: 11px; opacity: .45; margin: 0 2px 6px; }',
    // About page: centered hero + plain info rows.
    '.zb-ab-hero { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 20px 0 16px; }',
    '.zb-ab-hero .zb-ab-logo { font-size: 38px; line-height: 1; filter: saturate(1.2); }',
    '.zb-ab-hero .zb-ab-name { font-size: 16px; font-weight: 700; letter-spacing: .3px; }',
    '.zb-ab-hero .zb-ab-ver { font-size: 11px; padding: 2px 10px; border-radius: 999px;',
      ' background: rgba(122,162,247,.16); border: 1px solid rgba(122,162,247,.4); color: #dbe6ff; }',
    '.zb-ab-hero .zb-ab-tag { font-size: 11px; opacity: .55; text-align: center; }',
    '.zb-set .zb-set-val { font-size: 12px; opacity: .75; text-align: right; max-width: 55%;',
      ' overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    // Repo rows stack: name/sub on line 1, full-width URL + copy button on
    // line 2 (fork URLs are long — inline they squeeze the label column).
    '.zb-ab-repo { flex-wrap: wrap; row-gap: 5px; }',
    '.zb-ab-repo .zb-set-main { flex: 1 1 100%; }',
    '.zb-ab-repo .zb-ctrl { flex: 1 1 100%; min-width: 0; justify-content: flex-end; }',
    '.zb-ab-repo .zb-set-val { flex: 1 1 auto; min-width: 0; max-width: none; text-align: left;',
      ' font-size: 11.5px; letter-spacing: .2px; }',
    '.zb-ab-tips { font-size: 11.5px; line-height: 1.9; opacity: .8; padding: 10px 0; user-select: text; }',
    '.zb-ab-tips b { font-weight: 600; opacity: 1; }',
    // Bubble style editor WINDOW (modal, opened by the ✏️ button or by
    // picking 自定义 CSS in the preset dropdown). The preview iframe and CSS
    // textarea live here; user CSS cannot leak into the panel or ZCode (style
    // sheets never cross documents) and scripts inside the sandboxed iframe
    // are dead (the sandbox grants no script permission). The sandbox keeps
    // allow-same-origin — NOT an empty sandbox: this Electron renderer never
    // commits an opaque-origin srcdoc document, so an empty sandbox leaves
    // the frame tree (and the preview) blank forever. Verified live via CDP
    // (2026-10-24): allow-same-origin commits the srcdoc AND still blocks
    // script execution.
    '#zb-bubble-win { position: fixed; inset: 0; z-index: 2147483647; display: flex;',
      ' align-items: center; justify-content: center; }',
    '#zb-bubble-win[hidden] { display: none; }',
    '#zb-bubble-win-mask { position: absolute; inset: 0; background: rgba(0,0,0,.45); backdrop-filter: blur(2px); }',
    '#zb-bubble-win-card { position: relative; width: min(600px, calc(100vw - 48px));',
      ' max-height: calc(100vh - 80px); display: flex; flex-direction: column; overflow-y: auto;',
      ' background: rgba(22,22,28,.97); border: 1px solid rgba(255,255,255,.14); border-radius: 14px;',
      ' padding: 14px 16px; box-shadow: 0 16px 56px rgba(0,0,0,.55); user-select: none; }',
    '#zb-bubble-win-head { display: flex; align-items: center; justify-content: space-between;',
      ' font-size: 13px; font-weight: 600; margin-bottom: 8px; }',
    '#zb-bubble-win-close { width: 28px; height: 28px; border-radius: 7px; background: none; border: none;',
      ' color: inherit; opacity: .55; font-size: 14px; line-height: 1; cursor: pointer; }',
    '#zb-bubble-win-close:hover { opacity: 1; background: rgba(255,255,255,.1); }',
    // Labeled sections: each block states WHAT it affects, so controls read
    // against the preview above them instead of a dense hint paragraph.
    '.zb-win-sec { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; margin: 12px 0 7px; }',
    '.zb-win-sec .zb-win-sec-sub { font-weight: 400; font-size: 11px; opacity: .5; }',
    '.zb-win-sec .zb-win-mode { margin-left: auto; font-size: 11px; font-weight: 500; padding: 2px 9px;',
      ' border-radius: 999px; background: rgba(122,162,247,.16); border: 1px solid rgba(122,162,247,.4); color: #dbe6ff; }',
    // Mirror slider rows (基础参数): delegate to the canonical chat-page sliders.
    '.zb-wrow { display: flex; align-items: center; gap: 10px; padding: 4px 0; }',
    '.zb-wrow > span:first-child { flex: none; width: 62px; font-size: 12px; opacity: .85; }',
    '.zb-wrow input[type=range] { flex: 1; min-width: 60px; accent-color: #7aa2f7; height: 18px; margin: 0; cursor: pointer; }',
    '.zb-wrow .zb-val { flex: none; min-width: 46px; text-align: right; font-size: 11.5px; opacity: .8;',
      ' font-variant-numeric: tabular-nums; }',
    '.zb-wrow .zb-wrow-sub { flex: 1; text-align: right; font-size: 11px; opacity: .45; }',
    // Mode gate: custom code is a no-op under built-in presets — say so and
    // offer the explicit switch instead of a silently dead textarea.
    '#zb-bubble-css-gate { display: flex; align-items: center; gap: 10px; padding: 10px 12px; margin-bottom: 8px;',
      ' border-radius: 8px; background: rgba(255,255,255,.05); border: 1px dashed rgba(255,255,255,.22);',
      ' font-size: 11.5px; opacity: .9; }',
    '#zb-bubble-css-gate[hidden] { display: none; }',
    '#zb-bubble-css-gate .zb-btn { margin-left: auto; flex: none; }',
    '.zb-win-foot { font-size: 11px; opacity: .45; text-align: center; margin-top: 8px; }',
    '#zb-bubble-win-card #zb-bubble-pv-frame { display: block; width: 100%; height: 150px; border: none;',
      ' border-radius: 8px; background: transparent; margin-bottom: 2px; }',
    '#zb-bubble-win-card .zb-actions { padding: 10px 0 0; justify-content: flex-end; }',
    '#zb-bubble-css { display: block; width: 100%; min-height: 150px; resize: vertical; padding: 8px 10px;',
      ' border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.35); color: #dce4f5;',
      ' font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: 11.5px; line-height: 1.55;',
      ' outline: none; user-select: text; white-space: pre; }',
    '#zb-bubble-css:focus { border-color: rgba(122,162,247,.6); }',
    // Saved custom styles (我的样式): name-entry row + chip list below the
    // textarea. Both are display:flex containers, so each needs the explicit
    // [hidden] guard — author display beats the UA hidden rule otherwise.
    '#zb-bubble-style-name-row[hidden], #zb-bubble-style-chips[hidden] { display: none; }',
    '#zb-bubble-style-name { flex: 1; min-width: 0; padding: 5px 9px; border-radius: 8px;',
      ' border: 1px solid rgba(255,255,255,.16); background: rgba(0,0,0,.35); color: #dce4f5;',
      ' font-size: 12px; outline: none; user-select: text; }',
    '#zb-bubble-style-name:focus { border-color: rgba(122,162,247,.6); }',
    '#zb-bubble-style-name::placeholder { color: rgba(255,255,255,.35); }',
    '#zb-bubble-style-chips { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 8px; }',
    '.zb-style-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 3px 9px;',
      ' border-radius: 999px; background: rgba(122,162,247,.14); border: 1px solid rgba(122,162,247,.4);',
      ' color: #dbe6ff; font-size: 11.5px; cursor: pointer; user-select: none; }',
    '.zb-style-chip:hover { background: rgba(122,162,247,.28); }',
    '.zb-style-chip .zb-chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.zb-style-chip .zb-chip-del { flex: none; width: 14px; height: 14px; line-height: 13px; text-align: center;',
      ' border-radius: 50%; font-size: 10px; opacity: .5; }',
    '.zb-style-chip .zb-chip-del:hover { opacity: 1; background: rgba(255,255,255,.2); }',
    '.zb-card { background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.08);',
      ' border-radius: 12px; padding: 2px 14px; }',
    '.zb-card .zb-set:last-child, .zb-card .zb-actions:last-child, .zb-card .zb-import-row:last-child { padding-bottom: 10px; }',
    // Collapsible blocks (壁纸库/显示调节): clicking the section label folds
    // the card body. The grid-rows 1fr→0fr trick animates to any height.
    '.zb-collapsible .zb-block-title { cursor: pointer; user-select: none; }',
    '.zb-collapse-wrap { display: grid; grid-template-rows: 1fr; transition: grid-template-rows .18s ease; }',
    '.zb-collapse-wrap > .zb-collapse-inner { overflow: hidden; min-height: 0; }',
    '.zb-collapsed .zb-collapse-wrap { grid-template-rows: 0fr; }',
    // Collapsed = the card chrome folds away too, leaving just the label row.
    '.zb-collapsed .zb-card { border-color: transparent; background: none; padding-top: 0; padding-bottom: 0; }',
    '.zb-fold { width: 20px; height: 17px; border-radius: 5px; background: rgba(255,255,255,.09);',
      ' border: 1px solid rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center;',
      ' font-size: 10px; line-height: 1; color: inherit; flex: none;',
      ' transition: transform .15s ease, background .15s ease, border-color .15s ease; }',
    '.zb-collapsible .zb-block-title:hover .zb-fold { background: rgba(122,162,247,.35); border-color: rgba(122,162,247,.6); }',
    // Collapsed = arrow rotated right AND the chip lights up blue — the
    // direction alone was too subtle to tell collapsed blocks apart.
    '.zb-collapsed .zb-fold { transform: rotate(-90deg); background: rgba(122,162,247,.5);',
      ' border-color: rgba(122,162,247,.9); color: #d6e2ff; }',
    // Settings row: label (name + optional sub) on the left, control on the
    // right — the row pattern the whole reference panel is built from.
    '.zb-set { display: flex; align-items: center; gap: 12px; padding: 9px 0; }',
    '.zb-set + .zb-set, .zb-set + .zb-sched-mode, .zb-sched-mode + .zb-set { border-top: 1px solid rgba(255,255,255,.06); }',
    '.zb-set-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }',
    '.zb-set-name { font-size: 12.5px; }',
    '.zb-set-sub { font-size: 11px; opacity: .5; line-height: 1.45; }',
    '.zb-ctrl { flex: none; display: flex; align-items: center; gap: 8px; }',
    // Toggle switch (reference-style pill), used via <label class="zb-sw">.
    '.zb-sw { display: inline-flex; align-items: center; cursor: pointer; flex: none; }',
    '.zb-sw input[type=checkbox] { appearance: none; -webkit-appearance: none; width: 34px; height: 20px; margin: 0;',
      ' border-radius: 999px; background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.22);',
      ' position: relative; cursor: pointer; outline: none; transition: background .15s ease, border-color .15s ease; }',
    '.zb-sw input[type=checkbox]::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;',
      ' border-radius: 50%; background: #cfd3dc; transition: transform .15s ease, background .15s ease; }',
    '.zb-sw input[type=checkbox]:checked { background: rgba(122,162,247,.85); border-color: rgba(122,162,247,.9); }',
    '.zb-sw input[type=checkbox]:checked::after { transform: translateX(14px); background: #fff; }',
    // Slider row: label left, track fills the middle, value pinned right.
    '#zb-panel input[type=range] { width: 100%; accent-color: #7aa2f7; height: 18px; margin: 0; cursor: pointer; }',
    '.zb-slide input[type=range] { flex: 1; min-width: 60px; width: auto; }',
    '.zb-set .zb-val { flex: none; min-width: 48px; text-align: right; font-size: 11.5px; opacity: .8;',
      ' font-variant-numeric: tabular-nums; }',
    // Shared control chrome for selects / time / number inputs inside rows.
    '.zb-set select, .zb-sched-mode select, .zb-sched-plan select, .zb-sched-row select { padding: 4px 8px; border-radius: 8px;',
      ' border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.3); color: inherit; font-size: 12px;',
      ' outline: none; color-scheme: dark; cursor: pointer; }',
    '.zb-set input[type=time], .zb-sched-mode input[type=time], .zb-set input[type=number],',
      ' .zb-sched-mode input[type=number] { padding: 4px 6px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14);',
      ' background: rgba(0,0,0,.3); color: inherit; font-size: 12px; outline: none; color-scheme: dark; }',
    '.zb-set input[type=time] { width: 80px; }',
    '.zb-set input[type=number] { width: 56px; }',
    '.zb-actions { display: flex; gap: 8px; flex-wrap: wrap; padding: 10px 0 8px; }',
    '.zb-cfg-row .zb-btn { flex: 1 1 0; min-width: 0; padding-left: 2px; padding-right: 2px; }',
    '.zb-btn { display: inline-block; padding: 6px 10px; text-align: center; border-radius: 999px; cursor: pointer;',
      ' background: rgba(255,255,255,.09); border: 1px solid rgba(255,255,255,.14); color: inherit; font-size: 12px;',
      ' white-space: nowrap; flex: 0 1 auto; }',
    '.zb-btn:hover { background: rgba(255,255,255,.16); }',
    '#zb-status { flex: none; min-height: 24px; padding: 4px 16px 6px; opacity: .6; font-size: 11px;',
      ' border-top: 1px solid rgba(255,255,255,.07); }',
    // Import row: picker + paste field + action on ONE line (the old stacked
    // button/input/button block ate three rows for two functions).
    '.zb-import-row { display: flex; align-items: center; gap: 6px; margin: 0; padding: 10px 0 8px; }',
    '.zb-import-row .zb-btn { padding: 4px 9px; font-size: 11px; flex: none; }',
    '.zb-import-row .zb-icon-btn { padding: 4px 7px; line-height: 1; }',
    '.zb-import-row .zb-grow { flex: 1; min-width: 0; }',
    '#zb-scene-path { flex: 1; min-width: 0; padding: 4px 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14);',
      ' background: rgba(0,0,0,.3); color: inherit; font-size: 11px; outline: none; }',
    '#zb-scene-path:focus { border-color: rgba(122,162,247,.6); }',
    '#zb-progress { position: relative; height: 14px; border-radius: 7px; overflow: hidden;',
      ' background: rgba(255,255,255,.08); font-size: 10px; line-height: 14px; text-align: center; }',
    '#zb-progress-bar { position: absolute; inset: 0; width: 0%; background: rgba(122,162,247,.5); transition: width .4s; }',
    '#zb-progress span { position: relative; }',
    '#zb-guide { padding: 8px 10px; background: rgba(120,53,15,.55); border-radius: 8px; font-size: 11px;',
      ' line-height: 1.5; white-space: pre-wrap; user-select: text; max-height: 180px; overflow: auto; }',
    '.zb-lib { font-size: 11px; }',
    '.zb-lib .zb-lib-head { opacity: .55; margin: 4px 0 2px; }',
    '.zb-lib-list { max-height: 110px; overflow: auto; }',
    // Hover peek: a bigger wallpaper preview that opens to the LEFT of the
    // panel when the cursor rests on any thumbnail-bearing item.
    '#zb-hover-preview { position: fixed; z-index: 2147483647; width: 320px; border-radius: 8px;',
    '  border: 1px solid rgba(255,255,255,.18); box-shadow: 0 8px 28px rgba(0,0,0,.55); background: #000;',
    '  overflow: hidden; pointer-events: none; }',
    '#zb-hover-preview img { display: block; width: 100%; max-height: 240px; object-fit: cover; }',
    '#zb-hover-preview video { display: block; width: 100%; max-height: 240px; object-fit: contain; background: #000; }',
    '#zb-hover-preview .zb-hv-off { display: none; }',
    '#zb-hover-preview[hidden] { display: none; }',
    '.zb-sched-plan { display: flex; align-items: center; gap: 6px; }',
    '.zb-sched-plan select { flex: 0 1 auto; min-width: 140px; }',
    '.zb-sched-plan .zb-act { font-size: 12px; }',
    '.zb-sched-mode { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: 12px; }',
    '.zb-sched-mode + .zb-sched-mode { border-top: 1px solid rgba(255,255,255,.06); }',
    '.zb-sched-mode > span:first-child { flex: 1; min-width: 0; text-align: left; }',
    '.zb-sched-mode > label { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; margin: 0; cursor: pointer; }',
    '.zb-sched-mode select { flex: 0 1 auto; min-width: 130px; }',
    '.zb-sched-mode input[type=number] { width: 58px; }',
    '#zb-sched-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 6px; max-height: 200px; overflow-y: auto; overflow-anchor: none; padding-right: 2px; }',
    '.zb-sched-row { display: flex; align-items: center; gap: 4px; }',
    '.zb-sched-row input[type=number], .zb-sched-row input[type=time], .zb-sched-row select { padding: 3px 5px; border-radius: 6px;',
      ' border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.3); color: inherit; font-size: 11px;',
      ' outline: none; color-scheme: dark; }',
    '.zb-sched-row input[type=number] { width: 52px; flex: none; }',
    '.zb-sched-row input[type=time] { width: 66px; flex: none; }',
    '.zb-sched-row select { flex: 1; min-width: 0; }',
    '.zb-sched-dur { flex: none; opacity: .7; font-size: 11px; }',
    '.zb-wp-picker { position: relative; flex: 1; min-width: 0; }',
    '.zb-wp-btn { display: flex; align-items: center; gap: 5px; width: 100%; padding: 2px 5px; border-radius: 6px;',
      ' border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.3); color: inherit; font-size: 11px; cursor: pointer; }',
    '.zb-wp-btn img { width: 42px; height: 24px; object-fit: cover; border-radius: 3px; flex: none; background: #000; }',
    '.zb-wp-btn span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }',
    // The popup is position:fixed on <body>: an absolutely positioned popup
    // inside the scrolling playlist gets clipped by the list's overflow window
    // (and the browser scrolls the list to reveal it, cutting off row 1).
    // z-index ties with the panel root (2147483647 is the ceiling) — the popup
    // is appended later, so DOM order paints it ABOVE the panel card.
    '.zb-wp-pop { position: fixed; z-index: 2147483647; color: #e8e8ea;',
      ' background: rgba(16,16,22,.98); border: 1px solid rgba(255,255,255,.16); border-radius: 8px; padding: 3px; }',
    // Each group scrolls independently (its own scrollbar), capped at five
    // visible rows — measured .zb-wp-item height is 32px: 5x32 = 160px.
    '.zb-wp-group-list { max-height: 160px; overflow-y: auto; overscroll-behavior: contain; }',
    '.zb-wp-group { padding: 4px 6px 2px; font-size: 10px; opacity: .55; }',
    '.zb-wp-item { display: flex; align-items: center; gap: 6px; padding: 3px 5px; border-radius: 6px; cursor: pointer; font-size: 11px; }',
    '.zb-wp-item:hover { background: rgba(255,255,255,.12); }',
    '.zb-wp-item[data-cur="1"] { background: rgba(122,162,247,.28); }',
    '.zb-wp-item img { width: 46px; height: 26px; object-fit: cover; border-radius: 3px; flex: none; background: #000; }',
    '.zb-wp-item span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    // WE library browser popup: same fixed-on-body scheme as the wallpaper
    // picker (panel is narrow, so it opens as its own window to the LEFT).
    // Grid of cards: bigger previews, click-to-multi-select, bottom bar.
    '.zb-we-pop { position: fixed; z-index: 2147483647; color: #e8e8ea;',
      ' background: rgba(16,16,22,.98); border: 1px solid rgba(255,255,255,.16); border-radius: 10px; padding: 10px; width: 560px; }',
    '.zb-we-head { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 0 2px 8px; }',
    '.zb-we-head .zb-we-total { opacity: .55; font-size: 11px; flex: none; }',
    '.zb-we-search { flex: 1; min-width: 0; background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.18);',
      ' border-radius: 5px; color: inherit; font-size: 12px; padding: 4px 8px; outline: none; }',
    '.zb-we-act { cursor: pointer; background: none; border: none; color: inherit; opacity: .6; font-size: 13px; padding: 0 4px; flex: none; }',
    '.zb-we-act:hover { opacity: 1; }',
    // View-mode segmented control: group by wallpaper type, or by the user's
    // own WE browser folders.
    '.zb-we-mode { display: flex; flex: none; border: 1px solid rgba(255,255,255,.2); border-radius: 5px; overflow: hidden; }',
    '.zb-we-mode button { background: none; border: none; color: inherit; font-size: 11px; padding: 3px 9px; cursor: pointer; opacity: .55; }',
    '.zb-we-mode button:hover { opacity: .9; }',
    '.zb-we-mode button[data-on="1"] { background: rgba(122,162,247,.4); opacity: 1; }',
    // Folder-mode file-browser look: folder cards in the root view and a
    // back row above a folder's wallpaper grid.
    '.zb-we-fcard { border: 1px solid rgba(255,255,255,.14); border-radius: 8px; overflow: hidden; cursor: pointer;',
      ' background: rgba(255,255,255,.04); padding: 14px 8px 10px; text-align: center; }',
    '.zb-we-fcard:hover { border-color: rgba(122,162,247,.7); background: rgba(255,255,255,.08); }',
    '.zb-we-fcard .zb-we-fico { font-size: 36px; line-height: 1; filter: saturate(1.3); }',
    '.zb-we-fcard .zb-we-fname { font-size: 12px; margin-top: 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.zb-we-fcard .zb-we-fcount { font-size: 10px; opacity: .5; margin-top: 2px; }',
    '.zb-we-fcard[hidden] { display: none; }',
    '.zb-we-back { display: flex; align-items: center; gap: 6px; width: 100%; box-sizing: border-box; padding: 5px 8px;',
      ' margin-bottom: 4px; border-radius: 6px; cursor: pointer; font-size: 11px; background: rgba(255,255,255,.06);',
      ' border: 1px solid rgba(255,255,255,.12); color: inherit; }',
    '.zb-we-back:hover { background: rgba(255,255,255,.12); }',
    // Natural-aspect preview: width fixed, height follows the image. The
    // position is recomputed on load (an unsized <img> measures 0px tall,
    // so the initial clamp cannot know the real height) and again clamped
    // to the viewport — hovering the last row must stay fully on screen.
    '.zb-we-hover { position: fixed; z-index: 2147483647; width: 320px; max-height: 78vh;',
      ' border-radius: 8px; overflow: hidden;',
      ' border: 1px solid rgba(255,255,255,.18); box-shadow: 0 8px 28px rgba(0,0,0,.55); background: #000;',
      ' pointer-events: none; }',
    '.zb-we-hover img, .zb-we-hover video { display: block; width: 100%; max-height: 78vh; object-fit: contain; }',
    '.zb-we-list { max-height: 430px; overflow-y: auto; overscroll-behavior: contain; margin-right: -4px; padding-right: 4px; }',
    '.zb-we-group { padding: 6px 4px 4px; font-size: 11px; opacity: .6; }',
    '.zb-we-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }',
    '.zb-we-card { position: relative; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; overflow: hidden;',
      ' cursor: pointer; background: rgba(255,255,255,.04); }',
    '.zb-we-card:hover { border-color: rgba(122,162,247,.7); background: rgba(255,255,255,.08); }',
    '.zb-we-card[data-sel="1"] { border-color: #7aa2f7; background: rgba(122,162,247,.16); }',
    '.zb-we-card[data-off="1"] { opacity: .45; cursor: default; }',
    '.zb-we-card img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: #000; }',
    '.zb-we-ph { width: 100%; aspect-ratio: 16 / 9; display: flex; align-items: center; justify-content: center;',
      ' font-size: 12px; opacity: .5; background: rgba(255,255,255,.06); }',
    '.zb-we-name { font-size: 12px; line-height: 1.35; padding: 5px 6px 6px; display: -webkit-box;',
      ' -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }',
    '.zb-we-tick { position: absolute; top: 6px; right: 6px; width: 18px; height: 18px; border-radius: 50%;',
      ' background: #7aa2f7; color: #0d0d14; font-size: 12px; font-weight: 700; line-height: 18px; text-align: center; display: none; }',
    '.zb-we-card[data-sel="1"] .zb-we-tick { display: block; }',
    '.zb-we-done { position: absolute; top: 6px; left: 6px; font-size: 10px; padding: 1px 6px; border-radius: 4px;',
      ' background: rgba(74,222,128,.9); color: #0d0d14; }',
    '.zb-we-tag { position: absolute; bottom: 6px; right: 6px; font-size: 10px; padding: 1px 5px; border-radius: 4px;',
      ' background: rgba(0,0,0,.55); border: 1px solid rgba(255,255,255,.25); }',
    '.zb-we-foot { display: flex; align-items: center; gap: 8px; padding-top: 8px; font-size: 12px; }',
    '.zb-we-selinfo { flex: 1; opacity: .75; }',
    '.zb-we-foot .zb-btn { font-size: 12px; padding: 4px 12px; }',
    '.zb-we-foot .zb-btn[disabled] { opacity: .45; cursor: default; }',
    '.zb-we-card[hidden] { display: none; }',
    '.zb-we-empty { padding: 18px 10px; font-size: 12px; opacity: .7; line-height: 1.7; text-align: center; }',
    '.zb-item { display: flex; align-items: center; gap: 4px; padding: 3px 6px; border-radius: 6px; }',
    '.zb-item:hover { background: rgba(255,255,255,.1); }',
    '.zb-item[data-current="1"] { background: rgba(122,162,247,.25); }',
    '.zb-item .zb-item-img { width: 44px; height: 25px; object-fit: cover; border-radius: 3px; flex: none; background: #000; }',
    '.zb-item .zb-label { flex: 1; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.zb-item .zb-label-input { flex: 1; min-width: 0; padding: 1px 4px; border-radius: 4px; border: 1px solid rgba(122,162,247,.6);',
      ' background: rgba(0,0,0,.35); color: inherit; font-size: 11px; outline: none; }',
    '.zb-item .zb-act { cursor: pointer; opacity: .5; padding: 0 3px; font-size: 11px; background: none; border: none; color: inherit; }',
    '.zb-item .zb-act:hover { opacity: 1; }',
    '.zb-item .zb-act[data-armed="1"] { opacity: 1; color: #f87171; }',
    '#zb-offline { display: flex; flex-direction: column; gap: 6px; align-items: center;',
      ' padding: 10px 12px; background: rgba(120,53,15,.55); font-size: 11px; line-height: 1.5; text-align: center; }',
    '#zb-offline[hidden] { display: none; }',
    '#zb-offline code { background: rgba(0,0,0,.35); padding: 1px 4px; border-radius: 4px;',
      ' font-size: 10px; user-select: text; }',
    '#zb-offline .zb-hint { opacity: .85; }',
    // While offline the controls hold nothing we could read, so they must not
    // look interactive — a slider parked mid-track next to a "0px" label reads
    // as a real (wrong) setting.
    '#zcode-beautify-panel-root[data-offline="1"] #zb-body { opacity: .45; pointer-events: none; }',
    '#zcode-beautify-panel-root[data-offline="1"] #zb-status { display: none; }',
    '#zcode-beautify-panel-root[data-offline="1"] #zb-fab { border-color: rgba(248,113,113,.7); }'
  ].join('');

  var style = document.createElement('style');
  style.id = 'zcode-beautify-panel-style';
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  var root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML =
    '<div id="zb-fab" title="ZCode Beautify">🎨</div>' +
    '<div id="zb-panel" hidden>' +
    '  <div id="zb-head"><span>ZCode Beautify<span class="zb-head-sub">设置</span></span><button id="zb-close" title="关闭面板 (Alt+B)">✕</button></div>' +
    '  <div id="zb-offline" hidden>' +
    '    <div>⚠ 美化服务未运行,面板不可用</div>' +
    '    <div class="zb-hint">在插件目录执行 <code>node dist/cli.js serve --detach</code> 启动</div>' +
    '    <button class="zb-btn" id="zb-retry">重试连接</button>' +
    '  </div>' +
    '  <div id="zb-mid">' +
    '  <div id="zb-side">' +
    '    <div id="zb-brand"><span>🎨</span><span>Beautify</span></div>' +
    '    <div id="zb-search"><span class="zb-search-ico">🔍</span><input id="zb-nav-search" placeholder="搜索" spellcheck="false"></div>' +
    '    <div id="zb-tabs">' +
    '      <button class="zb-tab" data-tab="main"><span class="zb-ico">🖼</span><span>壁纸</span></button>' +
    '      <button class="zb-tab" data-tab="look"><span class="zb-ico">🎨</span><span>外观</span></button>' +
    '      <button class="zb-tab" data-tab="chat"><span class="zb-ico">💬</span><span>聊天</span></button>' +
    '      <button class="zb-tab" data-tab="sched"><span class="zb-ico">⏱</span><span>轮播</span></button>' +
    '      <button class="zb-tab" data-tab="settings"><span class="zb-ico">⚙</span><span>通用</span></button>' +
    '      <button class="zb-tab" data-tab="about"><span class="zb-ico">ℹ</span><span>关于</span></button>' +
    '    </div>' +
    '  </div>' +
    '  <div id="zb-body">' +
    '    <div id="zb-tab-main">' +
    '    <div class="zb-block zb-collapsible" id="zb-card-history">' +
    '      <div class="zb-block-title zb-card-title"><span>最近使用</span><button class="zb-act" id="zb-stats" title="壁纸累计展示时长排行">📊</button><span class="zb-fold">▾</span></div>' +
    '      <div class="zb-card"><div class="zb-collapse-wrap"><div class="zb-collapse-inner">' +
    '      <div class="zb-lib-list" id="zb-history" style="max-height:192px"></div>' +
    '      </div></div></div>' +
    '    </div>' +
    '    <div class="zb-block zb-collapsible" id="zb-card-scenes">' +
    '      <div class="zb-block-title zb-card-title"><span>壁纸库 · 动态</span><span class="zb-fold">▾</span></div>' +
    '      <div class="zb-card"><div class="zb-collapse-wrap"><div class="zb-collapse-inner">' +
    '      <div class="zb-import-row">' +
    '        <button class="zb-btn zb-icon-btn" id="zb-pick" title="打开文件选择器(可多选):选 .pkg(场景)或 .mp4(视频),选完自动排队导入">📁</button>' +
    '        <button class="zb-btn zb-icon-btn" id="zb-we-lib" title="浏览本机 Wallpaper Engine 壁纸库(创意工坊/自建项目),点击即可导入">🧩</button>' +
    '        <input type="text" id="zb-scene-path" placeholder="粘贴 .pkg/.mp4/目录路径,回车导入" spellcheck="false">' +
    '        <button class="zb-btn" id="zb-import" title="渲染并录制场景壁纸,生成无缝循环动态背景">导入</button>' +
    '      </div>' +
    '      <div id="zb-progress" hidden><div id="zb-progress-bar"></div><span>…</span></div>' +
    '      <div id="zb-guide" hidden></div>' +
    '      <div class="zb-actions" style="padding-top:0"><button class="zb-btn" id="zb-guide-retry" hidden>已安装,重试</button></div>' +
    '      <div class="zb-lib-list" id="zb-lib-scenes"></div>' +
    '      <div class="zb-lib-head" id="zb-storage" style="display:flex;align-items:center;gap:6px;margin:6px 0 8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.06)">' +
    '        <span id="zb-storage-text" style="flex:1">…</span>' +
    '        <button class="zb-act" id="zb-open-scenes" title="在资源管理器中打开动态壁纸缓存目录">📂</button>' +
    '        <button class="zb-act" id="zb-compress" title="省电压缩:把动态壁纸循环重编码为 720p/24fps,显著降低 GPU 解码占用与体积(使用中的跳过,可重新导入恢复原画质)">⚡ 压缩</button>' +
    '        <button class="zb-act" id="zb-purge" title="删除全部已缓存的动态壁纸循环(正在使用的除外)">🗑 清理</button>' +
    '      </div>' +
    '      </div></div></div>' +
    '    </div>' +
    '    <div class="zb-block zb-collapsible" id="zb-card-images">' +
    '      <div class="zb-block-title zb-card-title"><span>壁纸库 · 图片</span><span class="zb-fold">▾</span></div>' +
    '      <div class="zb-card"><div class="zb-collapse-wrap"><div class="zb-collapse-inner">' +
    '      <div class="zb-import-row">' +
    '        <label class="zb-btn zb-grow" for="zb-file" title="选择一张图片作为背景壁纸,UI 配色随之更新">🖼 更换图片…</label>' +
    '        <button class="zb-act" id="zb-img-sort" title="切换排序:按时间(新→旧)/按名称">⇅ 时间</button>' +
    '        <button class="zb-act" id="zb-img-batch" title="批量删除:勾选多个条目后一次删除">☰ 批量</button>' +
    '        <button class="zb-act" id="zb-open-images" title="在资源管理器中打开图片壁纸目录">📂</button>' +
    '        <input type="file" id="zb-file" accept="image/*" hidden>' +
    '      </div>' +
    '      <div class="zb-lib-list" id="zb-lib-images"></div>' +
    '      </div></div></div>' +
    '    </div>' +
    '    </div>' +
    '    <div id="zb-tab-look" hidden>' +
    '    <div class="zb-block zb-collapsible" id="zb-card-display">' +
    '      <div class="zb-block-title zb-card-title"><span>显示调节</span><span class="zb-fold">▾</span></div>' +
    '      <div class="zb-collapse-wrap"><div class="zb-collapse-inner">' +
    '      <div class="zb-card">' +
    '      <div class="zb-sub-title">画面</div>' +
    '      <div class="zb-set zb-slide"><div class="zb-set-main"><span class="zb-set-name">背景模糊</span><span class="zb-set-sub">背景壁纸的模糊程度(像素)</span></div>' +
    '        <input type="range" id="zb-blur" min="0" max="30" step="1" value="0"><span class="zb-val"><span id="zb-blur-val">0</span>px</span></div>' +
    '      <div class="zb-set zb-slide"><div class="zb-set-main"><span class="zb-set-name">背景压暗</span><span class="zb-set-sub">背景压暗程度(百分比,越高越暗)</span></div>' +
    '        <input type="range" id="zb-dim" min="0" max="80" step="1" value="0"><span class="zb-val"><span id="zb-dim-val">0</span>%</span></div>' +
    '      <div class="zb-set zb-slide"><div class="zb-set-main"><span class="zb-set-name">侧边栏压暗</span><span class="zb-set-sub">在背景压暗之上单独加深左侧会话栏;跟随宽度拖动与折叠</span></div>' +
    '        <input type="range" id="zb-sidebar-dim" min="0" max="80" step="1" value="0"><span class="zb-val"><span id="zb-sidebar-dim-val">0</span>%</span></div>' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">填充方式</span><span class="zb-set-sub">背景铺满窗口的策略</span></div>' +
    '        <select id="zb-fit" title="背景填充方式:填满裁剪铺满窗口 / 完整显示不裁剪(模糊垫底)/ 智能适配自动分析画面主体">' +
    '          <option value="cover">填满裁剪</option>' +
    '          <option value="contain">完整显示</option>' +
    '          <option value="smart">智能适配</option>' +
    '        </select></div>' +
    '      <div class="zb-set zb-slide"><div class="zb-set-main"><span class="zb-set-name">视频音量</span><span class="zb-set-sub">0 = 静音,仅对保留了声音的导入生效</span></div>' +
    '        <input type="range" id="zb-vol" min="0" max="100" step="1" value="0"><span class="zb-val"><span id="zb-vol-val">0</span>%</span></div>' +
    '      </div>' +
    '      <div class="zb-sub-title" style="margin-top:14px">界面</div>' +
    '      <div class="zb-card">' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">UI 莫奈取色</span><span class="zb-set-sub">根据壁纸自动生成 UI 配色;关闭则保留 ZCode 原生颜色</span></div>' +
    '        <div class="zb-ctrl"><label class="zb-sw"><input type="checkbox" id="zb-monet"></label>' +
    '        <button class="zb-btn" id="zb-pin" title="从壁纸主色锁定主题色(取色偏色时手工钉一个)">🎨 锁色</button></div></div>' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">显示壁纸</span><span class="zb-set-sub">关闭后隐藏背景壁纸</span></div>' +
    '        <label class="zb-sw"><input type="checkbox" id="zb-vis"></label></div>' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">图片缓动</span><span class="zb-set-sub">图片壁纸缓慢缩放平移(呼吸感);模糊开启时自动停用</span></div>' +
    '        <label class="zb-sw"><input type="checkbox" id="zb-kb"></label></div>' +
    '      </div>' +
    '      <div class="zb-sub-title" style="margin-top:14px">昼夜护眼</div>' +
    '      <div class="zb-card">' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">按时段自动调暗</span><span class="zb-set-sub">在白天 / 夜间两套显示参数间定时切换</span></div>' +
    '        <label class="zb-sw"><input type="checkbox" id="zb-dn-on"></label></div>' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">白天时段</span></div>' +
    '        <div class="zb-ctrl"><input type="time" id="zb-dn-start"><span style="opacity:.5">至</span><input type="time" id="zb-dn-end"></div></div>' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">白天参数</span></div>' +
    '        <div class="zb-ctrl"><span style="opacity:.6">压暗</span><input type="number" id="zb-dn-daydim" min="0" max="80">%' +
    '        <span style="opacity:.6">模糊</span><input type="number" id="zb-dn-dayblur" min="0" max="30">px</div></div>' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">夜间参数</span></div>' +
    '        <div class="zb-ctrl"><span style="opacity:.6">压暗</span><input type="number" id="zb-dn-nightdim" min="0" max="80">%' +
    '        <span style="opacity:.6">模糊</span><input type="number" id="zb-dn-nightblur" min="0" max="30">px</div></div>' +
    '      </div>' +
    '      </div></div>' +
    '    </div>' +
    '    </div>' +
    '    <div id="zb-tab-chat" hidden>' +
    '    <div class="zb-block">' +
    '      <div class="zb-block-title">聊天区</div>' +
    '      <div class="zb-card">' +
      '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">消息流宽度</span><span class="zb-set-sub">中间对话列的宽度档位;始终跟随窗口缩放,原生=不改宽度</span></div>' +
      '        <div class="zb-ctrl"><select id="zb-chat-width" title="中间对话列的宽度档位;公式化上限+两侧留白,窗口缩放时自动跟随">' +
      '          <option value="0">原生</option>' +
      '          <option value="48:24">很窄</option>' +
      '          <option value="56:24">窄</option>' +
      '          <option value="64:24">偏窄</option>' +
      '          <option value="84:12">宽</option>' +
      '          <option value="90:8">更宽</option>' +
      '          <option value="100:4">极限</option>' +
      // 回显专用:当前 cap/inset 不匹配任何档位时选中;disabled 防止被点到
      '          <option value="custom" disabled>自定义</option>' +
      '        </select>' +
      '        <button class="zb-btn" id="zb-chat-width-add" title="打开自定义宽度编辑:上限与两侧留白(rem),应用后生效">➕ 自定义…</button></div></div>' +
      '      <div class="zb-set" id="zb-chat-width-custom" hidden><div class="zb-set-main"><span class="zb-set-name">自定义宽度</span><span class="zb-set-sub">上限=对话列最大宽度(rem,0=原生);留白=两侧收缩(rem,越小越宽)</span></div>' +
      '        <div class="zb-ctrl"><input type="number" id="zb-chat-width-cap" min="0" max="120" step="1" title="对话列宽度上限,单位 rem(0=原生;40-120 有效)"><span class="zb-val">rem上限</span>' +
      '        <input type="number" id="zb-chat-width-inset" min="0" max="24" step="1" title="两侧留白,单位 rem(原生 24;0=贴边)"><span class="zb-val">rem留白</span>' +
      '        <button class="zb-btn" id="zb-chat-width-ok" title="应用这两个数值并关闭编辑">✓ 应用</button>' +
      '        <button class="zb-btn" id="zb-chat-width-cancel" title="放弃修改并关闭编辑">✕</button></div></div>' +
      '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">大会话流畅模式</span><span class="zb-set-sub">消息行屏外跳过渲染(官方仅分享视图有此优化);大上下文会话的打开与滚动更省,首次渲染可能轻微高度跳动</span></div>' +
      '        <label class="zb-sw"><input type="checkbox" id="zb-chat-perf" title="给消息行注入 content-visibility:auto:视口外的行跳过绘制与布局,滚入时再渲染;行高记忆上次实测值,不影响虚拟滚动"></label></div>' +
      '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">耗时秒数去小数</span><span class="zb-set-sub">对话下方"工作中"耗时的秒数不带小数位(53.4 秒 → 53 秒)</span></div>' +
      '        <label class="zb-sw"><input type="checkbox" id="zb-chat-elapsed" title="隐藏对话下方运行耗时的秒数小数:实时改写渲染文本,只保留整秒;关闭后恢复原生显示"></label></div>' +
      '      <div class="zb-set zb-slide"><div class="zb-set-main"><span class="zb-set-name">聊天区暗度</span><span class="zb-set-sub">对话列背后的额外压暗,消息文字浮在其上不受影响</span></div>' +
    '        <input type="range" id="zb-chat-dim" min="0" max="100" step="1" value="0"><span class="zb-val"><span id="zb-chat-dim-val">0.00</span></span></div>' +
    '      <div class="zb-set zb-slide"><div class="zb-set-main"><span class="zb-set-name">遮罩上端</span><span class="zb-set-sub">窗口顶部向下渐隐遮罩的浓度</span></div>' +
    '        <input type="range" id="zb-chat-top" min="0" max="100" step="1" value="0"><span class="zb-val"><span id="zb-chat-top-val">0.00</span></span></div>' +
    '      <div class="zb-set zb-slide"><div class="zb-set-main"><span class="zb-set-name">遮罩下端</span><span class="zb-set-sub">窗口底部向上渐隐遮罩的浓度(输入框附近)</span></div>' +
    '        <input type="range" id="zb-chat-bot" min="0" max="100" step="1" value="0"><span class="zb-val"><span id="zb-chat-bot-val">0.00</span></span></div>' +
    '      <div class="zb-set zb-slide"><div class="zb-set-main"><span class="zb-set-name">大容器偏白</span><span class="zb-set-sub">整窗白色薄纱浓度,暗色壁纸下提升文字可读性</span></div>' +
    '        <input type="range" id="zb-chat-frost" min="0" max="100" step="1" value="0"><span class="zb-val"><span id="zb-chat-frost-val">0.00</span></span></div>' +
    '      </div>' +
    '    </div>' +
    '    <div class="zb-block">' +
    '      <div class="zb-block-title">聊天气泡</div>' +
    '      <div class="zb-card">' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">气泡样式</span><span class="zb-set-sub">你发出消息的气泡预设;原生 = 完全不改样式</span></div>' +
    '        <div class="zb-ctrl"><select id="zb-bubble-preset" title="你发出消息的气泡预设;原生=完全不改样式">' +
    '          <option value="default">原生</option>' +
    '          <option value="accent">主题色染色</option>' +
    '          <option value="glass">毛玻璃</option>' +
    '          <option value="outline">描边</option>' +
    '          <option value="flat">扁平</option>' +
    '          <option value="custom">自定义 CSS</option>' +
    '        </select>' +
    '        <button class="zb-btn" id="zb-bubble-edit" title="打开气泡样式编辑器窗口:编辑并启用自定义 CSS,实时预览">✏️ 编辑样式</button>' +
    '        <button class="zb-btn" id="zb-bubble-align" title="气泡靠右(ZCode 原生)或靠左显示">↔ 靠右</button></div></div>' +
    '      <div class="zb-set zb-slide"><div class="zb-set-main"><span class="zb-set-name">染色浓度</span><span class="zb-set-sub">主题色掺入气泡背景的浓度</span></div>' +
    '        <input type="range" id="zb-bubble-tint" min="0" max="100" step="1" value="28"><span class="zb-val"><span id="zb-bubble-tint-val">28</span>%</span></div>' +
    '      <div class="zb-set zb-slide"><div class="zb-set-main"><span class="zb-set-name">圆角</span><span class="zb-set-sub">气泡圆角;对齐侧保留原生 2px 小角</span></div>' +
    '        <input type="range" id="zb-bubble-radius" min="4" max="24" step="1" value="12"><span class="zb-val"><span id="zb-bubble-radius-val">12</span>px</span></div>' +
    '      <div class="zb-set zb-slide"><div class="zb-set-main"><span class="zb-set-name">最大宽度</span><span class="zb-set-sub">气泡最大宽度占对话列宽度的比例</span></div>' +
    '        <input type="range" id="zb-bubble-width" min="40" max="90" step="1" value="70"><span class="zb-val"><span id="zb-bubble-width-val">70</span>%</span></div>' +
    '      </div>' +
    '    </div>' +
    '    <div class="zb-block">' +
    '      <div class="zb-block-title">运行中图标</div>' +
    '      <div class="zb-card">' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">转圈样式</span><span class="zb-set-sub">会话列表左侧“正在对话”的转圈标志;原生 = 不改</span></div>' +
    '        <div class="zb-ctrl"><select id="zb-spinner-mode" title="会话列表左侧正在对话标志:原生=保持 ZCode 自带转圈;自定义图片=换成图片或 GIF 动图">' +
    '          <option value="default">原生</option>' +
    '          <option value="image">自定义图片</option>' +
    '        </select>' +
    '        <button class="zb-btn" id="zb-spinner-pick" title="选择本地图片或 GIF 动图(≤2MB,支持 gif/png/webp/jpeg/svg)">📁 选图</button>' +
    '        <input type="file" id="zb-spinner-file" accept="image/gif,image/png,image/webp,image/jpeg,image/svg+xml" hidden></div></div>' +
    '      <div class="zb-set" id="zb-spinner-img-row" hidden><div class="zb-set-main"><span class="zb-set-name">当前图标</span></div>' +
    '        <div class="zb-ctrl"><img id="zb-spinner-preview" alt="当前运行中图标" title="当前运行中图标" style="width:22px;height:22px;object-fit:contain;border-radius:5px;background:rgba(128,128,128,.18)">' +
    '        <button class="zb-btn" id="zb-spinner-clear" title="恢复 ZCode 原生转圈图标">✕ 恢复原生</button></div></div>' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">完成标志</span><span class="zb-set-sub">会话跑完且有未读回复时的圆点;留空 = 原生蓝点</span></div>' +
    '        <div class="zb-ctrl"><img id="zb-spinner-unread-preview" alt="当前完成标志" title="当前完成标志" style="width:22px;height:22px;object-fit:contain;border-radius:5px;background:rgba(128,128,128,.18)">' +
    '        <button class="zb-btn" id="zb-spinner-unread-pick" title="选择完成标志的图片或 GIF(≤2MB)">📁 选图</button>' +
    '        <button class="zb-btn" id="zb-spinner-unread-clear" title="清除图片,恢复原生蓝点" hidden>✕</button>' +
    '        <input type="file" id="zb-spinner-unread-file" accept="image/gif,image/png,image/webp,image/jpeg,image/svg+xml" hidden></div></div>' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">错误标志</span><span class="zb-set-sub">会话出错时的圆点;留空 = 原生红点</span></div>' +
    '        <div class="zb-ctrl"><img id="zb-spinner-error-preview" alt="当前错误标志" title="当前错误标志" style="width:22px;height:22px;object-fit:contain;border-radius:5px;background:rgba(128,128,128,.18)">' +
    '        <button class="zb-btn" id="zb-spinner-error-pick" title="选择错误标志的图片或 GIF(≤2MB)">📁 选图</button>' +
    '        <button class="zb-btn" id="zb-spinner-error-clear" title="清除图片,恢复原生红点" hidden>✕</button>' +
    '        <input type="file" id="zb-spinner-error-file" accept="image/gif,image/png,image/webp,image/jpeg,image/svg+xml" hidden></div></div>' +
    '      <div class="zb-set" id="zb-spinner-opts" hidden><div class="zb-set-main"><span class="zb-set-name">保留旋转</span><span class="zb-set-sub">静态图建议开;GIF 动图建议关(自带动画)</span></div>' +
    '        <label class="zb-sw"><input type="checkbox" id="zb-spinner-spin" title="自定义图标是否沿用原生的旋转动画"></label></div>' +
    '      <div class="zb-set zb-slide" id="zb-spinner-size-row" hidden><div class="zb-set-main"><span class="zb-set-name">图标大小</span><span class="zb-set-sub">原生槽位约 16px,过大可能挤到行内其他元素</span></div>' +
    '        <input type="range" id="zb-spinner-size" min="10" max="24" step="1" value="16" title="自定义图标的显示尺寸(10-24px)"><span class="zb-val"><span id="zb-spinner-size-val">16</span>px</span></div>' +
    '      </div>' +
    '    </div>' +
    '    </div>' +
    '    <div id="zb-tab-settings" hidden>' +
    '    <div class="zb-block" id="zb-card-config">' +
    '      <div class="zb-block-title">配置</div>' +
    '      <div class="zb-card">' +
    '      <div class="zb-actions zb-cfg-row" style="padding-top:12px">' +
    '        <button class="zb-btn" id="zb-reset" title="移除壁纸与配色,还原 ZCode 默认外观(壁纸会被记住,可再次恢复)">还原外观</button>' +
    '        <button class="zb-btn" id="zb-cfg-export" title="导出当前壁纸/外观/播放方案为 JSON 文件">⬇ 导出</button>' +
    '        <button class="zb-btn" id="zb-cfg-import" title="从导出的 JSON 文件恢复配置">⬆ 导入</button>' +
    '        <input type="file" id="zb-cfg-file" accept="application/json,.json" hidden>' +
    '      </div>' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">启动屏时隐藏壁纸与面板</span><span class="zb-set-sub">ZCode 启动屏(加载页)期间不显示壁纸与美化面板,主界面就绪后再出现</span></div>' +
    '        <label class="zb-sw"><input type="checkbox" id="zb-startup-clean"></label></div>' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">ZCode 更新界面显示壁纸</span><span class="zb-set-sub">下载/安装更新的进度窗口默认不显示壁纸;勾选后更新窗口显示壁纸(仅壁纸,不显示美化面板)</span></div>' +
    '        <label class="zb-sw"><input type="checkbox" id="zb-updater-wp"></label></div>' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">WE 预览播放真实视频</span><span class="zb-set-sub">悬停 WE 库中的视频壁纸时直接播放其真实画面(而非封面图);场景壁纸仍显示封面</span></div>' +
    '        <label class="zb-sw"><input type="checkbox" id="zb-we-live"></label></div>' +
    '      <div class="zb-sched-mode"><span title="壁纸库·动态列表一次最多可见的行数(其余滚动查看)">动态库行数</span>' +
    '        <input type="number" id="zb-rows-scenes" min="3" max="20" step="1" title="动态壁纸列表最多显示行数">' +
    '        <span title="壁纸库·图片列表一次最多可见的行数(其余滚动查看)">图片库行数</span>' +
    '        <input type="number" id="zb-rows-images" min="3" max="20" step="1" title="图片壁纸列表最多显示行数"></div>' +
    '      <div class="zb-sched-mode"><span title="场景壁纸录制输出的分辨率;默认=壁纸项目自带尺寸">录制分辨率</span>' +
    '        <select id="zb-import-res"><option value="auto">默认(跟随壁纸)</option><option value="1920x1080">1920×1080</option><option value="1280x720">1280×720(省电)</option><option value="custom">自定义…</option></select>' +
    '        <input type="number" id="zb-res-w" min="256" max="3840" step="2" hidden>' +
    '        <input type="number" id="zb-res-h" min="144" max="2160" step="2" hidden></div>' +
    '      </div>' +
    '    </div>' +
    '    </div>' +
    '    <div id="zb-tab-about" hidden>' +
    '    <div class="zb-ab-hero">' +
    '      <div class="zb-ab-logo">🎨</div>' +
    '      <div class="zb-ab-name">ZCode Beautify</div>' +
    '      <div class="zb-ab-ver" id="zb-ab-ver">v0.0.0</div>' +
    '      <div class="zb-ab-tag">动态壁纸 · 莫奈取色 · 聊天气泡 —— ZCode 桌面端美化插件</div>' +
    '    </div>' +
    '    <div class="zb-block">' +
    '      <div class="zb-block-title">运行状态</div>' +
    '      <div class="zb-card">' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">美化服务</span></div><span class="zb-set-val" id="zb-ab-svc">检测中…</span></div>' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">运行时长</span></div><span class="zb-set-val" id="zb-ab-uptime">—</span></div>' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">CDP 端口</span><span class="zb-set-sub">ZCode 调试接口,注入壁纸与面板</span></div><span class="zb-set-val" id="zb-ab-cdp">—</span></div>' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">API 端口</span><span class="zb-set-sub">本机控制服务,面板数据来源</span></div><span class="zb-set-val" id="zb-ab-api">—</span></div>' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">当前壁纸</span></div><span class="zb-set-val" id="zb-ab-wp">—</span></div>' +
    '      </div>' +
    '    </div>' +
    '    <div class="zb-block">' +
    '      <div class="zb-block-title">插件信息</div>' +
    '      <div class="zb-card">' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">版本更新</span><span class="zb-set-sub" id="zb-ab-upd-sub">对照 GitHub 最新发布检查当前安装</span></div>' +
    '        <div class="zb-ctrl"><button class="zb-btn" id="zb-ab-check" title="向 GitHub 查询最新发布并与当前版本对比">⟳ 检查更新</button>' +
    '        <button class="zb-btn" id="zb-ab-copy-rel" hidden title="复制最新发布的下载页地址">⧉ 链接</button></div></div>' +
    '      <div class="zb-set zb-ab-repo"><div class="zb-set-main"><span class="zb-set-name">上游仓库</span></div>' +
    '        <div class="zb-ctrl"><span class="zb-set-val" title="${REPO_URL}">${REPO_URL.replace(/^https?:\/\//, "")}</span>' +
    '        <button class="zb-btn" id="zb-ab-copy" title="复制上游仓库地址">⧉ 复制</button></div></div>' +
    '      <div class="zb-set zb-ab-repo"><div class="zb-set-main"><span class="zb-set-name">本 Fork 仓库</span><span class="zb-set-sub">当前安装来源:面板重构/自定义气泡/队列修复等改动均在此维护</span></div>' +
    '        <div class="zb-ctrl"><span class="zb-set-val" title="${FORK_URL}">${FORK_URL.replace(/^https?:\/\//, "")}</span>' +
    '        <button class="zb-btn" id="zb-ab-copy-fork" title="复制 Fork 仓库地址">⧉ 复制</button></div></div>' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">开源许可</span></div><span class="zb-set-val" id="zb-ab-license">—</span></div>' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">作者</span></div><span class="zb-set-val" id="zb-ab-author">—</span></div>' +
    '      </div>' +
    '    </div>' +
    '    <div class="zb-block">' +
    '      <div class="zb-block-title">使用提示</div>' +
    '      <div class="zb-card"><div class="zb-ab-tips">' +
    '        <b>Alt + B</b> 随时开关本面板;拖动标题栏可移动位置<br>' +
    '        悬停缩略图放大预览;动态壁纸悬停直接播放循环视频<br>' +
    '        美化服务未运行时面板会提示,在插件目录执行 <b>node dist/cli.js serve --detach</b> 启动' +
    '      </div></div>' +
    '    </div>' +
    '    </div>' +
    '    <div id="zb-tab-sched" hidden>' +
    '    <div class="zb-block">' +
    '      <div class="zb-block-title">轮播状态</div>' +
    '      <div class="zb-card"><div class="zb-set"><div class="zb-set-main">' +
    '        <span class="zb-set-name" id="zb-rot-state" style="opacity:.8;font-weight:400">…</span></div></div></div>' +
    '    </div>' +
    '    <div class="zb-block">' +
    '      <div class="zb-block-title">方案</div>' +
    '      <div class="zb-card">' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">启用轮播</span><span class="zb-set-sub">启用后按所选模式自动切换壁纸</span></div>' +
    '        <label class="zb-sw"><input type="checkbox" id="zb-sched-on"></label></div>' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">当前方案</span></div>' +
    '        <div class="zb-ctrl zb-sched-plan"><select id="zb-plan" title="播放方案"></select>' +
    '        <button class="zb-act" id="zb-plan-add" title="新建播放方案">➕</button>' +
    '        <button class="zb-act" id="zb-plan-ren" title="重命名当前方案">✎</button>' +
    '        <button class="zb-act" id="zb-plan-del" title="删除当前方案">🗑</button></div></div>' +
    '      </div>' +
    '    </div>' +
    '    <div class="zb-block">' +
    '      <div class="zb-block-title">播放设置</div>' +
    '      <div class="zb-card">' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">模式</span></div>' +
    '        <select id="zb-sched-mode">' +
    '          <option value="sequence">顺序轮播</option>' +
    '          <option value="random">随机轮播</option>' +
    '          <option value="schedule">定时切换</option>' +
    '        </select></div>' +
    '      <div class="zb-set"><div class="zb-set-main"><span class="zb-set-name">切换特效</span><span class="zb-set-sub">本方案播放时的壁纸切换特效</span></div>' +
    '        <select id="zb-fx">' +
    '          <option value="fade">交叉淡入</option>' +
    '          <option value="slide">右侧滑入</option>' +
    '          <option value="zoom">缩放浮现</option>' +
    '          <option value="blur">模糊渐清</option>' +
    '          <option value="none">直接切换</option>' +
    '        </select></div>' +
    '      <div class="zb-set" title="方案生效时段:留空 = 全天生效;跨夜(如 20:00-06:00)支持"><div class="zb-set-main"><span class="zb-set-name">生效时段</span><span class="zb-set-sub">留空 = 全天生效;跨夜(如 20:00-06:00)支持</span></div>' +
    '        <div class="zb-ctrl"><input type="time" id="zb-win-start" step="60">' +
    '        <span style="opacity:.5">至</span>' +
    '        <input type="time" id="zb-win-end" step="60">' +
    '        <button class="zb-act" id="zb-win-clear" title="清除时段(全天生效)">✕</button></div></div>' +
    '      </div>' +
    '    </div>' +
    '    <div class="zb-block">' +
    '      <div class="zb-block-title">播放列表</div>' +
    '      <div class="zb-card">' +
    '      <div id="zb-sched-list"></div>' +
    '      <div class="zb-actions">' +
    '        <button class="zb-btn" id="zb-sched-add" title="添加一条:选择壁纸并设定时长或时间点">➕ 添加</button>' +
    '        <button class="zb-btn" id="zb-sched-save" title="保存全部方案(不改变启用状态)">💾 保存</button>' +
    '        <button class="zb-btn" id="zb-sched-play" title="保存并立即启用当前方案开始播放">▶ 播放</button>' +
    '        <button class="zb-btn" id="zb-sched-next" title="跳过当前时长,立即切换到下一张壁纸">⏭ 立即切换</button>' +
    '      </div>' +
    '      <div class="zb-lib-head" id="zb-sched-hint" style="margin:4px 0 8px"></div>' +
    '      </div>' +
    '    </div>' +
    '    </div>' +
    '  </div>' +
    '  </div>' +
    '  <div id="zb-status"></div>' +
    '</div>' +
    '<div id="zb-bubble-win" hidden>' +
    '  <div id="zb-bubble-win-mask"></div>' +
    '  <div id="zb-bubble-win-card">' +
    '    <div id="zb-bubble-win-head"><span>🎨 气泡样式编辑器</span>' +
    '      <button id="zb-bubble-win-close" title="关闭 (Esc)">✕</button></div>' +
    '    <div class="zb-win-sec">实时预览<span class="zb-win-mode" id="zb-bubble-win-mode">…</span><span class="zb-win-sec-sub">改动立即反映</span></div>' +
    '    <iframe id="zb-bubble-pv-frame" sandbox="allow-same-origin" title="聊天气泡预览"></iframe>' +
    '    <div class="zb-win-sec">基础参数<span class="zb-win-sec-sub">作用于所有样式,注入为 CSS 变量</span></div>' +
    '    <div class="zb-wrow"><span title="注入为 --zb-bubble-tint">染色浓度</span><input type="range" id="zb-bubble-tint-w" min="0" max="100" step="1" value="28"><span class="zb-val" id="zb-bubble-tint-w-val">28%</span></div>' +
    '    <div class="zb-wrow"><span title="注入为 --zb-bubble-radius">圆角</span><input type="range" id="zb-bubble-radius-w" min="4" max="24" step="1" value="12"><span class="zb-val" id="zb-bubble-radius-w-val">12px</span></div>' +
    '    <div class="zb-wrow"><span title="注入为 --zb-bubble-maxw">最大宽度</span><input type="range" id="zb-bubble-width-w" min="40" max="90" step="1" value="70"><span class="zb-val" id="zb-bubble-width-w-val">70%</span></div>' +
    '    <div class="zb-wrow"><span>对齐</span><button class="zb-btn" id="zb-bubble-align-w" title="气泡靠右(ZCode 原生)或靠左显示">↔ 靠右</button><span class="zb-wrow-sub">对齐侧保留原生 2px 小角</span></div>' +
    '    <div class="zb-win-sec">自定义 CSS<span class="zb-win-sec-sub">.zb-bubble = 气泡本体;.zb-bubble-row = 所在行;可引用 --color-primary 等主题变量</span></div>' +
    '    <div id="zb-bubble-css-gate" hidden>当前使用预设「<span id="zb-bubble-gate-name">…</span>」,自定义代码不生效' +
    '      <button class="zb-btn" id="zb-bubble-gate-on" title="切换到自定义 CSS,下方代码才会生效">启用自定义 CSS</button></div>' +
    '    <div id="zb-bubble-css-wrap">' +
    '      <textarea id="zb-bubble-css" spellcheck="false" placeholder="/* 例:.zb-bubble { background:…; border:…; } */"></textarea>' +
    '      <div class="zb-actions" style="padding-top:6px">' +
    '        <button class="zb-btn" id="zb-bubble-add-style" title="把上方 CSS 保存为一个命名的自定义样式,以后一键套用">➕ 存为样式</button>' +
    '        <button class="zb-btn" id="zb-bubble-example" title="填入一个渐变毛玻璃示例,可在此基础上修改">✨ 插入示例</button>' +
    '        <button class="zb-btn" id="zb-bubble-clear" title="清空自定义 CSS(仅保留基础参数控制的效果)">清空</button>' +
    '      </div>' +
    '      <div class="zb-actions" id="zb-bubble-style-name-row" hidden>' +
    '        <input id="zb-bubble-style-name" type="text" maxlength="24" placeholder="样式名称,如:薄荷毛玻璃">' +
    '        <button class="zb-btn" id="zb-bubble-style-save" title="保存为自定义样式">💾 保存</button>' +
    '        <button class="zb-btn" id="zb-bubble-style-cancel" title="不保存">取消</button>' +
    '      </div>' +
    '      <div id="zb-bubble-style-chips" hidden></div>' +
    '    </div>' +
    '    <div class="zb-win-foot">所有更改实时生效并保存;✓ 完成 / Esc 仅关闭窗口</div>' +
    '    <div class="zb-actions" style="justify-content:flex-end;padding-top:4px"><button class="zb-btn" id="zb-bubble-done" title="关闭窗口(更改已实时应用)">✓ 完成</button></div>' +
    '  </div>' +
    '</div>' +
    '<div id="zb-hover-preview" hidden><video muted autoplay loop playsinline></video><img alt=""></div>';
  document.body.appendChild(root);

  function $(id) { return document.getElementById(id); }
  function wallpaperEl() { return document.getElementById('zcode-beautify-wallpaper'); }
  function status(msg) {
    var el = $('zb-status'); if (!el) return;
    el.textContent = msg;
    setTimeout(function () { if (el.textContent === msg) el.textContent = ''; }, 2200);
  }
  function post(path, body, cb) {
    apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (cb) cb(d); })
      .catch(function () {
        status('无法连接美化服务 service unreachable');
        // Callers count completions inside cb (batch delete); an unreachable
        // request must still drain the counter or the UI sticks mid-action.
        if (cb) cb(undefined);
      });
  }

  // --- hover peek: resting the cursor on a wallpaper thumbnail (library rows,
  // picker popup items, picker buttons) opens a bigger preview to the LEFT of
  // the panel. The 260ms delay keeps a cursor merely sweeping past quiet.
  var ZB_HOVER_SEL = '.zb-item .zb-item-img, .zb-wp-item img, .zb-wp-btn img';
  var zbHoverTimer = null;
  var zbHvPending = 0;
  function hideHoverPreview() {
    zbHvPending++;
    if (zbHoverTimer) { clearTimeout(zbHoverTimer); zbHoverTimer = null; }
    var box = $('zb-hover-preview');
    if (box) {
      box.hidden = true;
      var v = box.querySelector('video');
      if (v) { v.pause(); }
    }
  }
  function zbHvReveal(box, thumb) {
    box.hidden = false;
    var r = thumb.getBoundingClientRect();
    box.style.left = 'auto';
    // To the LEFT of the panel, whatever its current (draggable) position.
    var panel = $('zb-panel');
    var pr = panel && !panel.hidden ? panel.getBoundingClientRect() : null;
    box.style.right = pr ? Math.max(8, window.innerWidth - pr.left + 14) + 'px' : '18px';
    var top = r.top + r.height / 2 - box.offsetHeight / 2;
    if (top < 8) top = 8;
    if (top + box.offsetHeight > window.innerHeight - 8) top = window.innerHeight - box.offsetHeight - 8;
    box.style.top = Math.round(top) + 'px';
  }
  function showHoverPreview(thumb) {
    var box = $('zb-hover-preview');
    if (!box) return;
    // Scene wallpapers get a LIVE preview: the loop video streams from serve,
    // so hovering plays the actual wallpaper instead of an enlarged poster.
    // Everything else (image library, playlists without a row key) keeps the
    // enlarged image. Swapping src while visible showed the PREVIOUS item
    // until the new one decoded (the flicker) — content is swapped while
    // hidden and the box revealed only when the new medium is ready; a
    // same-src re-hover reveals immediately.
    var item = thumb.closest('.zb-item');
    var key = item ? (item.getAttribute('data-key') || '') : '';
    var isScene = /^[a-f0-9]{32}$/.test(key);
    var vid = box.querySelector('video');
    var img = box.querySelector('img');
    zbHvPending++;
    var myTicket = zbHvPending;
    var reveal = function () {
      if (myTicket !== zbHvPending) return; // a newer hover superseded us
      vid.classList.toggle('zb-hv-off', !isScene);
      img.classList.toggle('zb-hv-off', isScene);
      if (isScene) vid.play().catch(function () {});
      zbHvReveal(box, thumb);
    };
    if (isScene) {
      var src = mt(API + '/media/scene/' + key + '.mp4');
      var vReady = function () { vid.removeEventListener('loadeddata', vReady); reveal(); };
      if (vid.getAttribute('src') === src && vid.readyState >= 2) { reveal(); return; }
      box.hidden = true; // old content must not flash while the new loads
      vid.pause();
      vid.src = src;
      vid.addEventListener('loadeddata', vReady);
      setTimeout(function () { if (myTicket === zbHvPending && box.hidden) reveal(); }, 1200);
    } else {
      var iSrc = thumb.getAttribute('src') || thumb.src;
      if (img.getAttribute('src') === iSrc && img.complete && img.naturalWidth > 0) { reveal(); return; }
      box.hidden = true;
      vid.pause();
      vid.removeAttribute('src');
      img.onload = function () { img.onload = null; reveal(); };
      img.onerror = function () { img.onerror = null; reveal(); };
      img.src = iSrc;
      setTimeout(function () { if (myTicket === zbHvPending && box.hidden) reveal(); }, 1200);
    }
  }
  var zbHvOver = function (e) {
    if (zbHvGen !== window.__zbHvGen) { document.removeEventListener('mouseover', zbHvOver); return; }
    var t = e.target;
    if (!t || !t.closest) return;
    var thumb = t.closest(ZB_HOVER_SEL);
    if (!thumb || thumb.tagName !== 'IMG') return;
    if (zbHoverTimer) clearTimeout(zbHoverTimer);
    zbHoverTimer = setTimeout(function () { zbHoverTimer = null; showHoverPreview(thumb); }, 260);
  };
  document.addEventListener('mouseover', zbHvOver);
  var zbHvOut = function (e) {
    if (zbHvGen !== window.__zbHvGen) { document.removeEventListener('mouseout', zbHvOut); return; }
    var t = e.target;
    if (!t || !t.closest) return;
    var thumb = t.closest(ZB_HOVER_SEL);
    if (!thumb) return;
    if (e.relatedTarget && thumb.contains(e.relatedTarget)) return;
    hideHoverPreview();
  };
  document.addEventListener('mouseout', zbHvOut);
  window.addEventListener('scroll', hideHoverPreview, true);

  // Local live preview; the server re-injects the authoritative CSS right after.
  function preview() {
    var w = wallpaperEl(); if (!w) return;
    var b = Number($('zb-blur').value), d = Number($('zb-dim').value), sd = Number($('zb-sidebar-dim').value);
    w.style.filter = b > 0 ? 'blur(' + b + 'px)' : 'none';
    w.style.transform = b > 0 ? 'scale(1.04)' : 'none';
    document.documentElement.style.setProperty('--zcode-beautify-dim', String(d / 100));
    // 侧边栏压暗: the scrim rule only exists server-side once the value > 0,
    // so the first notch appears after the push lands; adjustments preview live.
    document.documentElement.style.setProperty('--zb-sidebar-dim', String(sd / 100));
  }

  var pushTimer = null;
  function pushConfig() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      post('/api/config', {
        blur: Number($('zb-blur').value),
        dim: Number($('zb-dim').value),
        sidebarDim: Number($('zb-sidebar-dim').value),
        monet: $('zb-monet').checked,
        wallpaperVisible: $('zb-vis').checked,
        kenBurns: $('zb-kb').checked,
        startupClean: (document.getElementById('zb-startup-clean') || {}).checked !== false,
        showOnUpdater: (document.getElementById('zb-updater-wp') || {}).checked === true,
        videoVolume: Number($('zb-vol').value)
      }, function (d) { status(d && d.windows > 0 ? '已应用 applied' : '已保存(ZCode 未连接)'); });
    }, 300);
  }

  // The control service lives in a separate process that can stop or die. When
  // it is unreachable the panel must say so instead of rendering values it
  // never read, and it must recover on its own once the service is back.
  var beatTimer = null;
  function panelOpen() { return !$('zb-panel').hidden; }
  /** Re-check the service: while the panel is open, and always while offline. */
  function beat(on) {
    if (on && !beatTimer) beatTimer = zbEvery(refresh, 4000);
    if (!on && beatTimer) { clearInterval(beatTimer); beatTimer = null; }
  }

  function setOffline(on) {
    root.setAttribute('data-offline', on ? '1' : '0');
    $('zb-offline').hidden = !on;
    $('zb-retry').textContent = '重试连接';
    $('zb-fab').title = on ? 'ZCode Beautify — 美化服务未运行' : 'ZCode Beautify';
    if (on) {
      $('zb-blur').value = 0; $('zb-blur-val').textContent = '0';
      $('zb-dim').value = 0; $('zb-dim-val').textContent = '0';
      $('zb-sidebar-dim').value = 0; $('zb-sidebar-dim-val').textContent = '0';
      setChatSliders(0, 0, 0, 0, 0, 0, 0);
      $('zb-monet').checked = false;
      $('zb-vis').checked = false;
      $('zb-fit').value = 'cover';
      $('zb-reset').textContent = '还原外观';
      $('zb-reset').setAttribute('data-mode', 'reset');
      beat(true);
    } else {
      if (!panelOpen()) beat(false);
    }
  }

  // Last /api/config seen by refresh(); the add-button uses it to preselect
  // the currently applied wallpaper in a new rotation row.
  var lastConfig = null;
  function currentWallpaperKey() {
    if (lastConfig) {
      if (lastConfig.mediaType === 'video' && lastConfig.sceneHash) return 'h:' + lastConfig.sceneHash;
      if (lastConfig.wallpaperPath) return 'p:' + lastConfig.wallpaperPath;
      return '';
    }
    try { return localStorage.getItem('zcode-beautify:current-key') || ''; } catch (e) { return ''; }
  }

  function refresh() {
    apiFetch('/api/config')
      .then(function (r) { return r.json(); })
      .then(function (c) {
        setOffline(false);
        lastConfig = c;
        $('zb-blur').value = c.blur; $('zb-blur-val').textContent = c.blur;
        $('zb-dim').value = c.dim; $('zb-dim-val').textContent = c.dim;
        $('zb-sidebar-dim').value = c.sidebarDim ?? 0; $('zb-sidebar-dim-val').textContent = String(c.sidebarDim ?? 0);
        $('zb-monet').checked = !!c.monet;
        $('zb-vis').checked = !!c.wallpaperVisible;
        $('zb-kb').checked = !!c.kenBurns;
        $('zb-vol').value = c.videoVolume ?? 0;
        $('zb-vol-val').textContent = String(c.videoVolume ?? 0);
        $('zb-pin').textContent = c.themeColor ? '🎨 已锁' : '🎨 锁色';
        $('zb-pin').style.color = c.themeColor ? (c.themeColor) : '';
        var dn = c.dayNight;
        $('zb-dn-on').checked = !!(dn && dn.enabled);
        if (dn) {
          $('zb-dn-start').value = dn.start; $('zb-dn-end').value = dn.end;
          $('zb-dn-daydim').value = dn.dayDim; $('zb-dn-nightdim').value = dn.nightDim;
          $('zb-dn-dayblur').value = dn.dayBlur; $('zb-dn-nightblur').value = dn.nightBlur;
        }
        var cl = c.chatLook || {};
        setChatSliders(cl.chatDim ?? 0, cl.maskTop ?? 0, cl.maskBottom ?? 0, cl.frost ?? 0, cl.widthCapRem ?? 0, cl.widthInsetRem ?? 0, cl.perfSmooth ?? 0, cl.hideElapsedDecimal ?? 0);
        setBubbleUI(c.bubbleLook || {});
        setSpinnerUI(c.taskSpinnerLook || {});
        $('zb-fit') && applyFitLabel($('zb-fit'), c.fit || 'cover');
        var sc = document.getElementById('zb-startup-clean');
        if (sc) sc.checked = c.startupClean !== false;
        var uw = document.getElementById('zb-updater-wp');
        if (uw) uw.checked = c.showOnUpdater === true;
        var resetBtn = $('zb-reset');
        if (c.wallpaperSet) {
          resetBtn.textContent = '还原外观';
          resetBtn.setAttribute('data-mode', 'reset');
          resetBtn.title = '移除壁纸与配色,还原 ZCode 默认外观(壁纸会被记住,可再次恢复)';
        } else if (c.hasBackup) {
          resetBtn.textContent = '恢复壁纸';
          resetBtn.setAttribute('data-mode', 'restore');
          resetBtn.title = '从备份恢复你之前的壁纸与配色';
        } else {
          resetBtn.textContent = '还原外观';
          resetBtn.setAttribute('data-mode', 'reset');
          resetBtn.title = '当前已是默认外观';
        }
      })
      .catch(function () { setOffline(true); });
  }

  $('zb-blur').addEventListener('input', function () {
    $('zb-blur-val').textContent = this.value; preview(); pushConfig();
  });
  $('zb-dim').addEventListener('input', function () {
    $('zb-dim-val').textContent = this.value; preview(); pushConfig();
  });
  $('zb-sidebar-dim').addEventListener('input', function () {
    $('zb-sidebar-dim-val').textContent = this.value; preview(); pushConfig();
  });
  $('zb-monet').addEventListener('change', pushConfig);
  $('zb-vis').addEventListener('change', pushConfig);
  $('zb-kb').addEventListener('change', pushConfig);
  $('zb-vol').addEventListener('input', function () {
    $('zb-vol-val').textContent = this.value;
    pushConfig();
  });

  // --- day/night look schedule (护眼) --------------------------------------
  function pushDayNight() {
    var dn = {
      enabled: $('zb-dn-on').checked,
      start: $('zb-dn-start').value || '06:00',
      end: $('zb-dn-end').value || '18:00',
      dayDim: Number($('zb-dn-daydim').value) || 20,
      nightDim: Number($('zb-dn-nightdim').value) || 55,
      dayBlur: Number($('zb-dn-dayblur').value) || 0,
      nightBlur: Number($('zb-dn-nightblur').value) || 6
    };
    post('/api/config', { dayNight: dn }, function (d) { if (d && d.error) status(d.error); });
  }
  // Import resolution (录制分辨率): persisted in localStorage, sent with
  // every import POST; "auto" lets serve follow the wallpaper project size.
  var zbResSel = document.getElementById('zb-import-res');
  var zbResW = document.getElementById('zb-res-w');
  var zbResH = document.getElementById('zb-res-h');
  function resCustomVisible() {
    var on = zbResSel.value === 'custom';
    zbResW.hidden = !on; zbResH.hidden = !on;
  }
  function resPayload() {
    var mode = zbResSel.value;
    var p = { mode: mode };
    if (mode === 'custom') {
      p.width = Math.max(256, Math.min(3840, Number(zbResW.value) || 1920));
      p.height = Math.max(144, Math.min(2160, Number(zbResH.value) || 1080));
    }
    return p;
  }
  function resPersist() {
    try { localStorage.setItem('zcode-beautify:import-res', JSON.stringify(resPayload())); } catch (e) {}
  }
  if (zbResSel) {
    try {
      var savedRes = JSON.parse(localStorage.getItem('zcode-beautify:import-res') || 'null');
      if (savedRes && savedRes.mode) {
        zbResSel.value = savedRes.mode === 'custom' || /^\d+x\d+$/.test(savedRes.mode) ? savedRes.mode : 'auto';
        if (savedRes.width) zbResW.value = savedRes.width;
        if (savedRes.height) zbResH.value = savedRes.height;
      }
    } catch (e) {}
    resCustomVisible();
    zbResSel.addEventListener('change', function () { resCustomVisible(); resPersist(); });
    zbResW.addEventListener('change', resPersist);
    zbResH.addEventListener('change', resPersist);
  }
  var zbWeLive = document.getElementById('zb-we-live');
  if (zbWeLive) {
    try { zbWeLive.checked = localStorage.getItem('zcode-beautify:we-live') !== '0'; } catch (e) {}
    zbWeLive.addEventListener('change', function () {
      try { localStorage.setItem('zcode-beautify:we-live', this.checked ? '1' : '0'); } catch (e) {}
    });
  }
  var zbScEl = document.getElementById('zb-startup-clean');
  if (zbScEl) zbScEl.addEventListener('change', pushConfig);
  var zbUwEl = document.getElementById('zb-updater-wp');
  if (zbUwEl) zbUwEl.addEventListener('change', pushConfig);
  // Per-library visible row counts (设置 → 配置): stored in localStorage —
  // pure panel preference, no serve round-trip needed.
  // Hover delegation is DOCUMENT-level and cannot be swept like intervals —
  // handlers from previous panel generations keep firing after a serve
  // restart re-evaluates this script. Each generation mints a token; stale
  // handlers see a foreign token, unbind themselves and step aside.
  var zbHvGen = (window.__zbHvGen = (window.__zbHvGen || 0) + 1);
  var zbRowH = 32;
  var libRows = { scenes: 3, images: 3 };
  try {
    var savedRows = JSON.parse(localStorage.getItem('zcode-beautify:lib-rows') || 'null');
    if (savedRows && typeof savedRows === 'object') {
      if (savedRows.scenes >= 3 && savedRows.scenes <= 20) libRows.scenes = savedRows.scenes;
      if (savedRows.images >= 3 && savedRows.images <= 20) libRows.images = savedRows.images;
    }
  } catch (e) {}
  function applyLibRows() {
    var targets = [['zb-lib-scenes', libRows.scenes], ['zb-lib-images', libRows.images]];
    for (var i = 0; i < targets.length; i++) {
      var el = document.getElementById(targets[i][0]);
      if (!el) continue;
      var first = el.querySelector('.zb-item');
      var h = first ? first.offsetHeight : 0;
      // A hidden pane measures 0 — keep the last REAL measurement so
      // changing rows from the settings tab stays pixel-accurate.
      if (h > 5) zbRowH = h;
      var rowH = zbRowH;
      el.style.maxHeight = rowH * targets[i][1] + 'px';
    }
    var a = document.getElementById('zb-rows-scenes');
    var b = document.getElementById('zb-rows-images');
    if (a) a.value = libRows.scenes;
    if (b) b.value = libRows.images;
  }
  ['zb-rows-scenes', 'zb-rows-images'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', function () {
      var v = Math.max(3, Math.min(20, Math.round(Number(this.value) || 3)));
      this.value = v;
      if (this.id === 'zb-rows-scenes') libRows.scenes = v; else libRows.images = v;
      try { localStorage.setItem('zcode-beautify:lib-rows', JSON.stringify(libRows)); } catch (e) {}
      applyLibRows();
    });
  });
  ['zb-dn-on', 'zb-dn-start', 'zb-dn-end', 'zb-dn-daydim', 'zb-dn-nightdim', 'zb-dn-dayblur', 'zb-dn-nightblur'].forEach(function (id) {
    $(id).addEventListener('change', pushDayNight);
  });

  // --- chat-area zone look (聊天界面) ----------------------------------------
  var CHAT_WIDTH_PRESETS = { '48:24': 1, '56:24': 1, '64:24': 1, '84:12': 1, '90:8': 1, '100:4': 1 };
  // The custom editor is user-owned UI state: while it is open the 4s beat
  // must NOT re-reflect (it used to snap the select back to the stored gear
  // and silently close the editor mid-typing — the "自动关闭" bug).
  var widthEditing = false;
  // Authoritative width the SERVER holds (updated by reflect / gear / apply).
  // pushChatLook sends these — NOT the editor inputs, so dragging a mask
  // slider while the editor holds half-typed numbers can't leak them.
  var widthServerCap = 0, widthServerInset = 0;
  // cap 0 → 原生; a stored (cap,inset) matching a preset option selects it,
  // anything else falls to the disabled 自定义 marker option.
  function reflectChatWidth(cap, inset) {
    cap = Math.max(0, Math.min(120, Math.round(Number(cap) || 0)));
    inset = Math.max(0, Math.min(24, Math.round(Number(inset) || 0)));
    widthServerCap = cap; widthServerInset = cap > 0 ? inset : 0;
    if (widthEditing) return;
    var key = cap + ':' + inset;
    $('zb-chat-width').value = cap === 0 ? '0' : (CHAT_WIDTH_PRESETS[key] ? key : 'custom');
    $('zb-chat-width-cap').value = cap;
    $('zb-chat-width-inset').value = cap > 0 ? inset : 12;
  }
  function setChatSliders(d, mu, mb, f, cap, inset, perf, dec) {
    $('zb-chat-dim').value = d; $('zb-chat-dim-val').textContent = (d / 100).toFixed(2);
    $('zb-chat-top').value = mu; $('zb-chat-top-val').textContent = (mu / 100).toFixed(2);
    $('zb-chat-bot').value = mb; $('zb-chat-bot-val').textContent = (mb / 100).toFixed(2);
    $('zb-chat-frost').value = f; $('zb-chat-frost-val').textContent = (f / 100).toFixed(2);
    var perfEl = $('zb-chat-perf');
    if (perfEl) perfEl.checked = perf === 1;
    var decEl = $('zb-chat-elapsed');
    if (decEl) decEl.checked = dec === 1;
    reflectChatWidth(cap ?? 0, inset ?? 0);
    // Reflecting SERVER state: drop the drag-preview inline vars so the
    // injected :root block (the authoritative values) rules again — inline
    // vars outrank the stylesheet and would otherwise pin stale previews.
    var rs = document.documentElement.style;
    rs.removeProperty('--zb-chat-dim');
    rs.removeProperty('--zb-mask-top');
    rs.removeProperty('--zb-mask-bot');
    rs.removeProperty('--zb-frost');
  }
  // Live preview via the same CSS vars the injected style consumes — inline
  // vars outrank the :root block, so drags feel instant; the server push
  // re-applies the authoritative values right after.
  function chatPreview(d, mu, mb, f) {
    var rs = document.documentElement.style;
    rs.setProperty('--zb-chat-dim', String(d / 100));
    rs.setProperty('--zb-mask-top', String(mu / 100));
    rs.setProperty('--zb-mask-bot', String(mb / 100));
    rs.setProperty('--zb-frost', String(f / 100));
  }
  var chatPushTimer = null;
  function pushChatLook() {
    clearTimeout(chatPushTimer);
    chatPushTimer = setTimeout(function () {
      post('/api/config', {
        chatLook: {
          chatDim: Number($('zb-chat-dim').value),
          maskTop: Number($('zb-chat-top').value),
          maskBottom: Number($('zb-chat-bot').value),
          frost: Number($('zb-chat-frost').value),
          widthCapRem: widthServerCap,
          widthInsetRem: widthServerInset,
          perfSmooth: $('zb-chat-perf') && $('zb-chat-perf').checked ? 1 : 0,
          hideElapsedDecimal: $('zb-chat-elapsed') && $('zb-chat-elapsed').checked ? 1 : 0
        }
      }, function (d) { if (d && d.error) status(d.error); });
    }, 300);
  }
  [['zb-chat-dim', 'zb-chat-dim-val'], ['zb-chat-top', 'zb-chat-top-val'], ['zb-chat-bot', 'zb-chat-bot-val'], ['zb-chat-frost', 'zb-chat-frost-val']].forEach(function (pair) {
    $(pair[0]).addEventListener('input', function () {
      var v = Number(this.value);
      $(pair[1]).textContent = (v / 100).toFixed(2);
      chatPreview(Number($('zb-chat-dim').value), Number($('zb-chat-top').value), Number($('zb-chat-bot').value), Number($('zb-chat-frost').value));
      pushChatLook();
    });
  });
  // Column width: a gear writes both numbers and pushes immediately. The
  // custom editor is opened by the ➕ button and only pushes on ✓ 应用 —
  // typing in it never pushes, and the beat never touches it while open.
  $('zb-chat-width').addEventListener('change', function () {
    if (this.value === 'custom') return; // disabled marker; reflect-only
    if (this.value === '0') { reflectChatWidth(0, 0); pushChatLook(); return; }
    var parts = this.value.split(':');
    reflectChatWidth(parts[0], parts[1] || 12);
    pushChatLook();
  });
  $('zb-chat-width-add').addEventListener('click', function () {
    widthEditing = true;
    // Prefill from the live select/inputs so editing starts from the truth.
    if ($('zb-chat-width').value !== 'custom' && $('zb-chat-width').value !== '0') {
      var parts = $('zb-chat-width').value.split(':');
      $('zb-chat-width-cap').value = parts[0];
      $('zb-chat-width-inset').value = parts[1] || 12;
    }
    $('zb-chat-width-custom').hidden = false;
    $('zb-chat-width-cap').focus();
  });
  $('zb-chat-width-ok').addEventListener('click', function () {
    var cap = Math.max(0, Math.min(120, Math.round(Number($('zb-chat-width-cap').value) || 0)));
    var inset = Math.max(0, Math.min(24, Math.round(Number($('zb-chat-width-inset').value) || 0)));
    $('zb-chat-width-cap').value = cap;
    $('zb-chat-width-inset').value = cap > 0 ? inset : 0;
    widthEditing = false;
    $('zb-chat-width-custom').hidden = true;
    reflectChatWidth(cap, $('zb-chat-width-inset').value);
    pushChatLook();
  });
  // Cancel keeps the select untouched; the next beat re-reflects the stored
  // server truth (the inputs may hold half-edited numbers).
  $('zb-chat-width-cancel').addEventListener('click', function () {
    widthEditing = false;
    $('zb-chat-width-custom').hidden = true;
  });
  $('zb-chat-perf') && $('zb-chat-perf').addEventListener('change', pushChatLook);
  $('zb-chat-elapsed') && $('zb-chat-elapsed').addEventListener('change', pushChatLook);
  ['zb-chat-width-cap', 'zb-chat-width-inset'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      var max = id === 'zb-chat-width-cap' ? 120 : 24;
      this.value = Math.max(0, Math.min(max, Math.round(Number(this.value) || 0)));
    });
    $(id).addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') $('zb-chat-width-ok').click();
      if (ev.key === 'Escape') $('zb-chat-width-cancel').click();
    });
  });

  // --- user message bubble look (聊天气泡) -----------------------------------
  function bubbleUIState() {
    return {
      preset: $('zb-bubble-preset').value,
      tint: Number($('zb-bubble-tint').value),
      radius: Number($('zb-bubble-radius').value),
      width: Number($('zb-bubble-width').value),
      align: $('zb-bubble-align').getAttribute('data-left') === '1' ? 'left' : 'right',
      customCss: $('zb-bubble-css') ? $('zb-bubble-css').value : ''
    };
  }
  function setBubbleUI(b) {
    b = b || {};
    var preset = ['default', 'accent', 'glass', 'outline', 'flat'].indexOf(b.preset) >= 0 ? b.preset : 'default';
    $('zb-bubble-preset').value = preset;
    $('zb-bubble-tint').value = b.tint ?? 28; $('zb-bubble-tint-val').textContent = String(b.tint ?? 28);
    $('zb-bubble-radius').value = b.radius ?? 12; $('zb-bubble-radius-val').textContent = String(b.radius ?? 12);
    $('zb-bubble-width').value = b.width ?? 70; $('zb-bubble-width-val').textContent = String(b.width ?? 70);
    var left = b.align === 'left';
    $('zb-bubble-align').setAttribute('data-left', left ? '1' : '0');
    $('zb-bubble-align').textContent = left ? '↔ 靠左' : '↔ 靠右';
    var cssEl = $('zb-bubble-css');
    // Never yank the textarea under an actively typing user — the 4s beat
    // refresh would otherwise revert chars typed since the last push.
    if (cssEl && typeof b.customCss === 'string' && document.activeElement !== cssEl) cssEl.value = b.customCss;
    updateBubblePreview();
    // Server state is authoritative: drop drag-preview inline vars (same
    // reason as setChatSliders).
    ['--zb-bubble-tint', '--zb-bubble-radius', '--zb-bubble-maxw', '--zb-bubble-align'].forEach(function (p) {
      document.documentElement.style.removeProperty(p);
    });
  }
  // Live preview for slider-driven fields via the same vars the injected
  // style consumes. Preset changes can't preview locally (new rules needed);
  // they round-trip through serve (~300ms).
  function bubblePreview() {
    var s = bubbleUIState();
    var r = s.radius;
    var rs = document.documentElement.style;
    rs.setProperty('--zb-bubble-tint', String(s.tint / 100));
    rs.setProperty('--zb-bubble-radius', s.align === 'left' ? '2px ' + r + 'px ' + r + 'px ' + r + 'px' : r + 'px 2px ' + r + 'px ' + r + 'px');
    rs.setProperty('--zb-bubble-maxw', s.width + '%');
    rs.setProperty('--zb-bubble-align', s.align === 'left' ? 'flex-start' : 'flex-end');
  }
  var bubblePushTimer = null;
  function pushBubbleLook() {
    clearTimeout(bubblePushTimer);
    bubblePushTimer = setTimeout(function () {
      post('/api/config', { bubbleLook: bubbleUIState() }, function (d) { if (d && d.error) status(d.error); });
    }, 300);
  }
  $('zb-bubble-preset').addEventListener('change', function () {
    // Re-sync the editor window (mode badge, gate, mirror labels) on EVERY
    // preset change — the window can be open while the dropdown on the chat
    // page flips, and a stale badge there lies about the active mode.
    zbWinSync();
    zbPvSchedule();
    pushBubbleLook();
    // Picking 自定义 CSS opens the editor window — that is where the CSS
    // lives now (the dropdown only selects the preset).
    if (this.value === 'custom') zbBubbleWinOpen();
  });
  $('zb-bubble-align').addEventListener('click', function () {
    var left = this.getAttribute('data-left') === '1';
    this.setAttribute('data-left', left ? '0' : '1');
    this.textContent = left ? '↔ 靠右' : '↔ 靠左';
    bubblePreview();
    zbPvSchedule();
    pushBubbleLook();
  });
  [['zb-bubble-tint', 'zb-bubble-tint-val'], ['zb-bubble-radius', 'zb-bubble-radius-val'], ['zb-bubble-width', 'zb-bubble-width-val']].forEach(function (pair) {
    $(pair[0]).addEventListener('input', function () {
      $(pair[1]).textContent = this.value;
      bubblePreview();
      zbPvSchedule();
      pushBubbleLook();
    });
  });

  // --- session-list running indicator (运行中图标) -----------------------------
  // mode/spin/size ride /api/config like the bubble look; the IMAGE itself is
  // uploaded once through /api/spinner (which saves it into the data dir and
  // flips mode to "image" serve-side). The panel never invents an image ref —
  // it echoes the stored one so partial pushes never blank the icon.
  // The 完成标志 (unread) and 错误标志 (error) slots follow the same echo
  // contract through their own refs; they are independent of the loading slot.
  var spinnerImageRef = '';
  var spinnerUnreadRef = '';
  var spinnerErrorRef = '';
  function spinnerUIState() {
    return {
      mode: $('zb-spinner-mode').value,
      image: spinnerImageRef,
      unreadImage: spinnerUnreadRef,
      errorImage: spinnerErrorRef,
      spin: $('zb-spinner-spin').checked,
      size: Number($('zb-spinner-size').value)
    };
  }
  function reflectSpinnerRows(mode) {
    var on = mode === 'image' && Boolean(spinnerImageRef);
    $('zb-spinner-img-row').hidden = !on;
    $('zb-spinner-opts').hidden = mode !== 'image';
    $('zb-spinner-size-row').hidden = mode !== 'image';
    if (on && lastConfig && lastConfig.spinnerImageUrl) $('zb-spinner-preview').src = lastConfig.spinnerImageUrl;
    reflectTerminalSlot('zb-spinner-unread-preview', 'zb-spinner-unread-clear', spinnerUnreadRef, 'spinnerUnreadUrl');
    reflectTerminalSlot('zb-spinner-error-preview', 'zb-spinner-error-clear', spinnerErrorRef, 'spinnerErrorUrl');
  }
  function reflectTerminalSlot(imgId, clearId, ref, urlField) {
    var has = Boolean(ref);
    $(clearId).hidden = !has;
    var img = $(imgId);
    img.style.visibility = has ? 'visible' : 'hidden';
    if (has && lastConfig && lastConfig[urlField]) img.src = lastConfig[urlField];
  }
  function setSpinnerUI(s) {
    s = s || {};
    var mode = s.mode === 'image' ? 'image' : 'default';
    spinnerImageRef = typeof s.image === 'string' ? s.image : '';
    spinnerUnreadRef = typeof s.unreadImage === 'string' ? s.unreadImage : '';
    spinnerErrorRef = typeof s.errorImage === 'string' ? s.errorImage : '';
    $('zb-spinner-mode').value = mode;
    $('zb-spinner-spin').checked = s.spin !== false;
    $('zb-spinner-size').value = s.size ?? 16;
    $('zb-spinner-size-val').textContent = String(s.size ?? 16);
    reflectSpinnerRows(mode);
  }
  function pushSpinnerLook() {
    post('/api/config', { taskSpinnerLook: spinnerUIState() }, function (d) { if (d && d.error) status(d.error); });
  }
  $('zb-spinner-mode').addEventListener('change', function () {
    reflectSpinnerRows(this.value);
    pushSpinnerLook();
  });
  $('zb-spinner-spin').addEventListener('change', pushSpinnerLook);
  $('zb-spinner-size').addEventListener('input', function () {
    $('zb-spinner-size-val').textContent = this.value;
  });
  $('zb-spinner-size').addEventListener('change', pushSpinnerLook);
  $('zb-spinner-pick').addEventListener('click', function () {
    $('zb-spinner-file').click();
  });
  $('zb-spinner-file').addEventListener('change', function () {
    spinnerUpload(this, 'running');
  });
  // 完成标志 / 错误标志 pickers share the upload pipeline with a slot tag.
  $('zb-spinner-unread-pick').addEventListener('click', function () { $('zb-spinner-unread-file').click(); });
  $('zb-spinner-unread-file').addEventListener('change', function () {
    spinnerUpload(this, 'unread');
  });
  $('zb-spinner-error-pick').addEventListener('click', function () { $('zb-spinner-error-file').click(); });
  $('zb-spinner-error-file').addEventListener('change', function () {
    spinnerUpload(this, 'error');
  });
  function spinnerUpload(input, slot) {
    var f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { status('图片超过 2MB,16px 图标请选小一点的文件'); return; }
    var fr = new FileReader();
    fr.onload = function () {
      post('/api/spinner', { dataUri: fr.result, name: f.name, slot: slot }, function (d) {
        if (d && d.error) { status(d.error); return; }
        if (d && d.taskSpinnerLook) {
          if (slot === 'running' && d.taskSpinnerLook.image) {
            spinnerImageRef = d.taskSpinnerLook.image;
            $('zb-spinner-mode').value = 'image';
            reflectSpinnerRows('image');
          } else if (slot === 'unread' && d.taskSpinnerLook.unreadImage) {
            spinnerUnreadRef = d.taskSpinnerLook.unreadImage;
            lastConfig = d; // resolved preview URL rides on the same payload
            reflectSpinnerRows($('zb-spinner-mode').value);
          } else if (slot === 'error' && d.taskSpinnerLook.errorImage) {
            spinnerErrorRef = d.taskSpinnerLook.errorImage;
            lastConfig = d;
            reflectSpinnerRows($('zb-spinner-mode').value);
          }
        }
        var label = slot === 'running' ? '运行中图标' : slot === 'unread' ? '完成标志' : '错误标志';
        status(d && d.windows > 0 ? label + '已应用' : label + '已保存(ZCode 未连接)');
      });
    };
    fr.readAsDataURL(f);
  }
  $('zb-spinner-clear').addEventListener('click', function () {
    $('zb-spinner-mode').value = 'default';
    reflectSpinnerRows('default');
    pushSpinnerLook();
    status('已恢复原生转圈图标');
  });
  $('zb-spinner-unread-clear').addEventListener('click', function () {
    spinnerUnreadRef = '';
    reflectSpinnerRows($('zb-spinner-mode').value);
    pushSpinnerLook();
    status('已恢复原生完成标志');
  });
  $('zb-spinner-error-clear').addEventListener('click', function () {
    spinnerErrorRef = '';
    reflectSpinnerRows($('zb-spinner-mode').value);
    pushSpinnerLook();
    status('已恢复原生错误标志');
  });

  // --- custom bubble CSS editor WINDOW + sandboxed live preview --------------
  // Every knob sits next to the preview so its effect is immediately visible:
  // 基础参数 sliders are MIRRORS of the canonical chat-page controls (one
  // push pipeline, both stay in lockstep), and the custom-CSS area is
  // mode-gated — editing code means nothing under a built-in preset, so other
  // presets get an explicit 启用 gate instead of a silently dead textarea.
  var ZB_PRESET_LABELS = { 'default': '原生', 'accent': '主题色染色', 'glass': '毛玻璃', 'outline': '描边', 'flat': '扁平', 'custom': '自定义 CSS' };
  function zbWinSync() {
    var pairs = [['zb-bubble-tint', 'zb-bubble-tint-w'], ['zb-bubble-radius', 'zb-bubble-radius-w'], ['zb-bubble-width', 'zb-bubble-width-w']];
    for (var i = 0; i < pairs.length; i++) {
      var src = $(pairs[i][0]), dst = $(pairs[i][1]);
      dst.value = src.value;
      $(pairs[i][1] + '-val').textContent = src.value + (pairs[i][0] === 'zb-bubble-radius' ? 'px' : '%');
    }
    var pa = $('zb-bubble-align'), wa = $('zb-bubble-align-w');
    wa.textContent = pa.textContent;
    wa.setAttribute('data-left', pa.getAttribute('data-left'));
    var preset = $('zb-bubble-preset').value;
    $('zb-bubble-win-mode').textContent = ZB_PRESET_LABELS[preset] || preset;
    var custom = preset === 'custom';
    $('zb-bubble-css-gate').hidden = custom;
    $('zb-bubble-css-wrap').hidden = !custom;
    if (!custom) $('zb-bubble-gate-name').textContent = ZB_PRESET_LABELS[preset] || preset;
  }
  function zbBubbleWinOpen() {
    zbWinSync();
    $('zb-bubble-win').hidden = false;
    updateBubblePreview(); // refresh to the current state on every open
  }
  function zbBubbleWinClose() {
    $('zb-bubble-win').hidden = true;
  }
  // Mirrors sanitizeCustomBubbleCss (core/bubbleRecipes.ts) for the preview
  // iframe; serve re-sanitizes before the real injection.
  function zbPvSanitize(css) {
    // NOTE: this lives inside a template literal — the backslash must be
    // doubled or the generated script would read /</style/gi (broken regex).
    css = String(css || '').slice(0, 8000)
      .replace(/<\\/style/gi, '')
      .replace(/@import[^;{]*[;{]?/gi, '')
      .replace(/javascript:/gi, '');
    return css.trim();
  }
  var zbPvTimer = null;
  function zbPvSchedule() {
    clearTimeout(zbPvTimer);
    zbPvTimer = setTimeout(updateBubblePreview, 120);
  }
  /** Rebuild the preview iframe document from the CURRENT editor state — the
   * recipe tables and var plumbing are the same ones ZCode receives, bound to
   * the preview's own class names, so what you see is what gets applied. */
  function updateBubblePreview() {
    var frame = $('zb-bubble-pv-frame');
    if (!frame) return;
    var s = bubbleUIState();
    var r = Math.max(2, Math.round(s.radius));
    var corners = s.align === 'left' ? '2px ' + r + 'px ' + r + 'px ' + r + 'px' : r + 'px 2px ' + r + 'px ' + r + 'px';
    var body = s.preset === 'custom' ? zbPvSanitize(s.customCss) : (PV_RECIPES[s.preset] || '');
    var doc = '<!doctype html><html><head><meta charset="utf-8"><style>'
      + 'html,body{margin:0;padding:0}'
      // Approximations of the live --color-* tokens so color-mix recipes and
      // custom styles referencing them render faithfully in the sandbox.
      + ':root{--color-primary:#7aa2f7;--color-surface:#26262e}'
      + 'body{font:12.5px/1.55 system-ui,sans-serif;color:#e9e9ef;padding:14px 16px;'
      + ' background:linear-gradient(135deg,#242a3d 0%,#3a2f45 55%,#2b3550 100%)}'
      + '.zb-chat{display:flex;flex-direction:column;gap:9px;max-width:540px;margin:0 auto}'
      + '.zb-row{display:flex}'
      + '.zb-row-o{justify-content:flex-start}'
      + '.zb-bubble-row{justify-content:flex-end}'
      + '.zb-bub{padding:7px 12px;border-radius:12px 2px 12px 12px;max-width:78%}'
      + '.zb-o{background:#2b2b35;border-radius:2px 12px 12px 12px}'
      + '.zb-me{background:#39435e}'
      + ':root{--zb-bubble-tint:' + (s.tint / 100)
      + ';--zb-bubble-radius:' + corners
      + ';--zb-bubble-maxw:' + s.width + '%'
      + ';--zb-bubble-align:' + (s.align === 'left' ? 'flex-start' : 'flex-end') + '}'
      + '.zb-bubble{border-radius:var(--zb-bubble-radius)!important;max-width:var(--zb-bubble-maxw)!important}'
      + '.zb-bubble-row{align-items:var(--zb-bubble-align)!important;justify-content:var(--zb-bubble-align)!important}'
      + (body || '')
      + '</style></head><body><div class="zb-chat">'
      + '<div class="zb-row zb-row-o"><div class="zb-bub zb-o">收到,正在预览这个气泡样式。</div></div>'
      + '<div class="zb-row zb-bubble-row"><div class="zb-bub zb-me zb-bubble">帮我把气泡换成这种效果</div></div>'
      + '</div></body></html>';
    frame.setAttribute('srcdoc', doc);
  }
  $('zb-bubble-css').addEventListener('input', function () {
    zbPvSchedule();
    pushBubbleLook();
  });
  $('zb-bubble-example').addEventListener('click', function () {
    $('zb-bubble-css').value = ZB_BUBBLE_EXAMPLE;
    zbPvSchedule();
    pushBubbleLook();
  });
  $('zb-bubble-clear').addEventListener('click', function () {
    $('zb-bubble-css').value = '';
    zbPvSchedule();
    pushBubbleLook();
  });
  // --- saved custom styles (我的样式): a panel-local name-and-reuse library.
  // Lives in localStorage — it is editor UX state, not server appearance
  // config, so the serve schema stays untouched. Clicking a chip applies the
  // CSS and flips the preset to custom through the select's own change event,
  // so gate/mode-badge/preview/push all run exactly as if hand-picked.
  var ZB_STYLE_KEY = 'zcode-beautify:bubble-styles';
  function zbStylesLoad() {
    try {
      var v = JSON.parse(localStorage.getItem(ZB_STYLE_KEY) || '[]');
      if (!Array.isArray(v)) return [];
      return v.filter(function (s) { return s && typeof s.name === 'string' && typeof s.css === 'string'; });
    } catch (e) { return []; }
  }
  function zbStylesSave(list) {
    try { localStorage.setItem(ZB_STYLE_KEY, JSON.stringify(list.slice(0, 24))); } catch (e) {}
  }
  function zbRenderStyleChips() {
    var box = $('zb-bubble-style-chips');
    if (!box) return;
    var list = zbStylesLoad();
    box.hidden = list.length === 0;
    box.innerHTML = '';
    for (var i = 0; i < list.length; i++) {
      (function (s) {
        var chip = document.createElement('span');
        chip.className = 'zb-style-chip';
        chip.setAttribute('title', '点击套用样式「' + s.name + '」');
        var nm = document.createElement('span');
        nm.className = 'zb-chip-name';
        nm.textContent = s.name;
        chip.appendChild(nm);
        chip.addEventListener('click', function () {
          var sel = $('zb-bubble-preset');
          if (sel.value !== 'custom') {
            sel.value = 'custom';
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
          $('zb-bubble-css').value = s.css;
          zbPvSchedule();
          pushBubbleLook();
          status('已套用样式「' + s.name + '」');
        });
        var del = document.createElement('span');
        del.className = 'zb-chip-del';
        del.textContent = '✕';
        del.setAttribute('title', '删除样式「' + s.name + '」');
        del.addEventListener('click', function (e) {
          e.stopPropagation();
          // Filter by name: zbStylesLoad() re-parses localStorage on every
          // call, so object-identity against the closure's captured style
          // object never matches.
          zbStylesSave(zbStylesLoad().filter(function (x) { return x.name !== s.name; }));
          zbRenderStyleChips();
          status('已删除样式「' + s.name + '」');
        });
        chip.appendChild(del);
        box.appendChild(chip);
      })(list[i]);
    }
  }
  $('zb-bubble-add-style').addEventListener('click', function () {
    $('zb-bubble-style-name-row').hidden = false;
    var inp = $('zb-bubble-style-name');
    inp.value = '';
    inp.placeholder = '样式名称,如:薄荷毛玻璃';
    inp.focus();
  });
  $('zb-bubble-style-cancel').addEventListener('click', function () {
    $('zb-bubble-style-name-row').hidden = true;
  });
  $('zb-bubble-style-save').addEventListener('click', function () {
    var css = $('zb-bubble-css').value.trim();
    if (!css) { status('CSS 为空,没有可保存的内容'); return; }
    var name = $('zb-bubble-style-name').value.trim() || ('我的样式 ' + (zbStylesLoad().length + 1));
    // Same name overwrites — renaming is the only way to duplicate on purpose.
    var list = zbStylesLoad().filter(function (x) { return x.name !== name; });
    list.push({ name: name, css: css });
    zbStylesSave(list);
    $('zb-bubble-style-name-row').hidden = true;
    zbRenderStyleChips();
    status('已保存样式「' + name + '」');
  });
  $('zb-bubble-style-name').addEventListener('keydown', function (e) {
    // Enter saves; Esc cancels WITHOUT closing the editor window (stop the
    // event before the document-level Esc handler sees it).
    if (e.key === 'Enter') { e.preventDefault(); $('zb-bubble-style-save').click(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); $('zb-bubble-style-cancel').click(); }
  });
  zbRenderStyleChips();
  // Window wiring: the ✏️ button opens it, ✕/完成/mask/Esc close it. Picking
  // 自定义 CSS in the dropdown opens it too (see the change handler above).
  $('zb-bubble-edit').addEventListener('click', zbBubbleWinOpen);
  $('zb-bubble-win-close').addEventListener('click', zbBubbleWinClose);
  $('zb-bubble-done').addEventListener('click', zbBubbleWinClose);
  $('zb-bubble-win-mask').addEventListener('click', zbBubbleWinClose);
  var zbWinEsc = function (e) {
    if (zbHvGen !== window.__zbHvGen) { document.removeEventListener('keydown', zbWinEsc); return; }
    if (e.key === 'Escape' && !$('zb-bubble-win').hidden) zbBubbleWinClose();
  };
  document.addEventListener('keydown', zbWinEsc);
  // Mirror controls delegate to the canonical chat-page controls: set the
  // source value, refresh the mirror label, then fire the source's own input
  // event so the existing pipeline (label/preview/debounced push) runs once.
  [['zb-bubble-tint', 'zb-bubble-tint-w'], ['zb-bubble-radius', 'zb-bubble-radius-w'], ['zb-bubble-width', 'zb-bubble-width-w']].forEach(function (pair) {
    var unit = pair[0] === 'zb-bubble-radius' ? 'px' : '%';
    $(pair[1]).addEventListener('input', function () {
      var src = $(pair[0]);
      src.value = this.value;
      $(pair[1] + '-val').textContent = this.value + unit;
      src.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  $('zb-bubble-align-w').addEventListener('click', function () {
    $('zb-bubble-align').click();
    zbWinSync();
  });
  // Gate switch: flip the preset to custom through its own change handler so
  // push/preview/open-sync all run exactly as if the user picked it.
  $('zb-bubble-gate-on').addEventListener('click', function () {
    var sel = $('zb-bubble-preset');
    sel.value = 'custom';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  updateBubblePreview();

  // --- pinned theme color (🎨) ---------------------------------------------
  $('zb-pin').addEventListener('click', function () {
    apiFetch('/api/palette')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var existing = document.querySelector('body > .zb-wp-pop');
        if (existing) { existing.remove(); return; }
        var pop = document.createElement('div');
        pop.className = 'zb-wp-pop';
        var colors = (d && d.colors) || [];
        if (d && d.pinned) {
          var auto = document.createElement('div');
          auto.className = 'zb-wp-item';
          auto.textContent = '✕ 解除锁定(恢复自动取色)';
          auto.addEventListener('click', function () {
            post('/api/config', { themeColor: null }, function () { refresh(); pop.remove(); status('已恢复自动取色'); });
          });
          pop.appendChild(auto);
        }
        colors.forEach(function (hex) {
          var it = document.createElement('div');
          it.className = 'zb-wp-item';
          var sw = document.createElement('span');
          sw.style.cssText = 'width:46px;height:26px;border-radius:3px;flex:none;background:' + hex + ';border:1px solid rgba(255,255,255,.2)';
          var name = document.createElement('span');
          name.textContent = hex;
          it.appendChild(sw); it.appendChild(name);
          it.addEventListener('click', function () {
            post('/api/config', { themeColor: hex }, function () { refresh(); pop.remove(); status('已锁定主题色 ' + hex); });
          });
          pop.appendChild(it);
        });
        if (!pop.children.length) pop.textContent = '当前壁纸没有可用色板';
        document.body.appendChild(pop);
      (function () { var wep = document.querySelector('body > .zb-we-pop'); if (wep) document.body.appendChild(wep); })(); // keep the WE window on top (equal z)
        var btn = $('zb-pin').getBoundingClientRect();
        pop.style.left = Math.max(8, Math.min(btn.left, window.innerWidth - 216)) + 'px';
        pop.style.width = '208px';
        pop.style.bottom = 'auto';
        pop.style.top = (btn.bottom + 4) + 'px';
        setTimeout(function () {
          var close = function (e) {
            if (!pop.contains(e.target) && e.target !== $('zb-pin')) { pop.remove(); document.removeEventListener('mousedown', close, true); }
          };
          document.addEventListener('mousedown', close, true);
        }, 0);
      })
      .catch(function () { status('服务未连接'); });
  });

  // --- Alt+B panel shortcut -------------------------------------------------
  // Document-level listeners survive panel rebuilds: every serve restart
  // re-evaluates this script, and N stale generations meant N fab clicks per
  // keypress (observed 23 — toggles cancel out by parity, so Alt+B "worked
  // randomly"). Same generation-token guard as the hover handlers: a stale
  // listener no-ops and unbinds itself on the first keydown it sees.
  var zbAltB = function (e) {
    if (zbHvGen !== window.__zbHvGen) { document.removeEventListener('keydown', zbAltB); return; }
    if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      $('zb-fab').click();
    }
  };
  document.addEventListener('keydown', zbAltB);

  var FITS = ['cover', 'contain', 'smart'];
  var FIT_LABELS = { cover: '填满裁剪', contain: '完整显示', smart: '智能适配' };
  function applyFitLabel(sel, fit) {
    sel.value = FIT_LABELS[fit] ? fit : 'cover';
  }
  $('zb-fit').addEventListener('change', function () {
    var next = this.value;
    post('/api/config', { fit: next }, function (d) { status(d && d.windows > 0 ? '已应用:' + FIT_LABELS[next] : '已保存(ZCode 未连接)'); });
  });

  var FXS = ['fade', 'slide', 'zoom', 'blur', 'none'];
  var FX_LABELS = { fade: '交叉淡入', slide: '右侧滑入', zoom: '缩放浮现', blur: '模糊渐清', none: '直接切换' };
  function applyFxLabel(sel, fx) {
    sel.value = FX_LABELS[fx] ? fx : 'fade';
  }
  // The effect is a per-plan setting; the dropdown edits the plan in the
  // editor and persists immediately (playback is not disturbed — the effect
  // is read from the active plan on every switch).
  $('zb-fx').addEventListener('change', function () {
    var plan = schedPlans[schedIdx];
    if (!plan) return;
    plan.transition = this.value;
    persistPlans();
  });

  $('zb-file').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { status('图片过大,上限 20 MB'); return; }
    var fr = new FileReader();
    fr.onload = function () {
      post('/api/wallpaper', { dataUri: fr.result, name: f.name }, function (d) {
        if (d && d.error) { status(d.error); return; }
        status('已添加并应用:' + f.name);
        // Server adopted the upload as current — reflect it in the highlight
        // immediately (the rows are not rebuilt anymore).
        if (d && d.wallpaperPath) {
          try { localStorage.setItem('zcode-beautify:current-key', d.wallpaperPath); } catch (e) {}
          markCurrent(d.wallpaperPath);
        }
        markLibDirty();
      });
    };
    fr.readAsDataURL(f);
  });

  // --- scene wallpaper import ------------------------------------------------
  var STAGE_LABELS = {
    starting: '准备中', detect: '识别中', deps: '检查依赖', opening: '渲染中', 'render-ready': '渲染中',
    recording: '录制中', closing: '录制中', processing: '处理中', poster: '处理中', saving: '保存中',
    'cache-hit': '缓存命中', done: '完成', error: '失败'
  };
  var importTimer = null;
  // Batch progress ("第 i/N 个") shown alongside the per-import stage while a
  // multi-file queue runs; null for single imports.
  var batchInfo = null;
  function setProgress(on, stage, fromCache) {
    var box = $('zb-progress');
    box.hidden = !on;
    if (on) {
      var label = STAGE_LABELS[stage] || stage || '…';
      if (batchInfo) label += ' (第 ' + batchInfo.i + '/' + batchInfo.n + ' 个)';
      // The pipeline stages advance in order; map them onto a smooth bar.
      var order = ['starting', 'detect', 'deps', 'opening', 'render-ready', 'recording', 'closing', 'processing', 'poster', 'saving', 'done'];
      var pct = stage === 'done' ? 100 : (stage === 'cache-hit' ? 100 : 8 + 88 * Math.max(0, order.indexOf(stage)) / (order.length - 1));
      $('zb-progress-bar').style.width = pct + '%';
      box.firstElementChild.nextSibling.textContent = label + (stage === 'cache-hit' ? '(缓存)' : '');
    }
  }
  function showGuide(guide, retryable) {
    var g = $('zb-guide');
    g.hidden = !guide;
    g.textContent = guide || '';
    $('zb-guide-retry').hidden = !retryable;
  }
  $('zb-pick').addEventListener('click', function () {
    var btn = this;
    btn.textContent = '…';
    apiFetch('/api/pick-scene', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        btn.textContent = '📁';
        if (!d || !d.ok || !d.path) return; // user cancelled the dialog
        var paths = (d.paths && d.paths.length) ? d.paths : [d.path];
        if (paths.length > 1) { startImportQueue(paths); return; }
        $('zb-scene-path').value = d.path;
        $('zb-import').click();
      })
      .catch(function () { btn.textContent = '📁'; status('无法连接美化服务 service unreachable'); });
  });

  // --- Wallpaper Engine library browser (🧩) -----------------------------------
  // Lists the machine's local WE wallpapers (workshop + myprojects) with
  // previews; picking one feeds its directory into the normal import queue.
  var wePop = null;
  /** Set while the WE popup is open: hides its hover preview. */
  var weHoverHide = null;
  function closeWePop() {
    // Sweep EVERY .zb-we-pop on <body>: after a serve restart the panel
    // script is re-evaluated and this closure's wePop is null again, while
    // the previous panel's popup element still sits in the DOM — clearing
    // only our own reference would leave that stale popup shadowing
    // querySelector('body > .zb-we-pop') and breaking the next open.
    if (weHoverHide) weHoverHide();
    var pops = document.querySelectorAll('body > .zb-we-pop, body > .zb-we-hover');
    for (var i = 0; i < pops.length; i++) pops[i].remove();
    wePop = null;
    document.removeEventListener('wheel', weScrollClose, true);
    document.removeEventListener('keydown', weEscClose, true);
  }
  // Dismiss on USER scrolling outside the popup (wheel only — a scroll EVENT
  // also fires from programmatic scrolls, and ZCode's chat column
  // auto-follows streaming output, which closed the popup the instant any
  // in-popup click coincided with a chat autoscroll). Scrolling the popup's
  // own list must not close it.
  var weScrollClose = function (e) {
    if (wePop && wePop.contains(e.target)) return;
    closeWePop();
  };
  var weEscClose = function (e) {
    if (e.key === 'Escape') closeWePop();
  };
  function openWePop(items) {
    closeWePop();
    var selected = {};
    var hasFolders = items.some(function (it) { return it.folder; });
    var weMode = localStorage.getItem('zcode-beautify:we-mode') === 'folder' && hasFolders ? 'folder' : 'type';
    wePop = document.createElement('div');
    wePop.className = 'zb-we-pop';

    var head = document.createElement('div');
    head.className = 'zb-we-head';
    var titleEl = document.createElement('span');
    titleEl.textContent = 'WE 壁纸库';
    var modeWrap = document.createElement('div');
    modeWrap.className = 'zb-we-mode';
    var modeType = document.createElement('button');
    modeType.textContent = '类型';
    var modeFolder = document.createElement('button');
    modeFolder.textContent = '文件夹';
    modeFolder.hidden = !hasFolders;
    modeWrap.appendChild(modeType);
    modeWrap.appendChild(modeFolder);
    var countEl = document.createElement('span');
    countEl.className = 'zb-we-total';
    countEl.textContent = items.length + ' 个 · 点击卡片多选';
    var search = document.createElement('input');
    search.className = 'zb-we-search';
    search.type = 'text';
    search.placeholder = '搜索标题…';
    search.spellcheck = false;
    var closeBtn = document.createElement('button');
    closeBtn.className = 'zb-we-act';
    closeBtn.textContent = '✕';
    closeBtn.title = '关闭 (Esc)';
    closeBtn.addEventListener('click', closeWePop);
    head.appendChild(titleEl); head.appendChild(modeWrap); head.appendChild(countEl);
    head.appendChild(search); head.appendChild(closeBtn);
    wePop.appendChild(head);

    var list = document.createElement('div');
    list.className = 'zb-we-list';
    var groupEls = [];
    // Folder mode navigates like a real file browser: the root shows one
    // card per WE folder (📁 + name + count); clicking one descends into it
    // with a back row on top. 未分类 is just another folder card.
    var folderNav = 'root';
    var curFolder = '';
    var selInfo = document.createElement('span');
    var impBtn = document.createElement('button');
    function refreshSel() {
      var n = Object.keys(selected).length;
      selInfo.textContent = n > 0 ? ('已选 ' + n + ' 项') : '未选择';
      impBtn.disabled = n === 0;
    }
    function refreshModeBtns() {
      modeType.setAttribute('data-on', weMode === 'type' ? '1' : '0');
      modeFolder.setAttribute('data-on', weMode === 'folder' ? '1' : '0');
    }
    function setWeMode(m) {
      if (!hasFolders || weMode === m) return;
      weMode = m;
      folderNav = 'root';
      curFolder = '';
      try { localStorage.setItem('zcode-beautify:we-mode', m); } catch (e) {}
      refreshModeBtns();
      renderGroups();
    }
    modeType.addEventListener('click', function () { setWeMode('type'); });
    modeFolder.addEventListener('click', function () { setWeMode('folder'); });
    refreshModeBtns();

    function buildCard(it) {
      var card = document.createElement('div');
      card.className = 'zb-we-card';
      card.setAttribute('data-title', it.title.toLowerCase());
      card.setAttribute('data-dir', it.dir);
      if (!it.importable) card.setAttribute('data-off', '1');
      if (selected[it.dir]) card.setAttribute('data-sel', '1');
      // Real-preview chain, best first: the wallpaper's OWN material —
      // source video for video wallpapers, its own WE preview GIF for
      // scenes — and only then the recorded loop, which is
      // content-addressed: reposts of the SAME wallpaper share one cache
      // entry, and leading with it made a folder of reposts all preview
      // as 'the same video'.
      if (it.videoUrl) card.setAttribute('data-video', it.videoUrl);
      card.title = it.title + '\\n' + it.dir + (it.folder ? '\\n📁 ' + it.folder : '') + (it.imported ? '\\n(已导入过,再次导入秒完成)' : '');
      if (it.imported) {
        var done = document.createElement('span');
        done.className = 'zb-we-done';
        done.textContent = '已导入';
        card.appendChild(done);
      }
      var tick = document.createElement('span');
      tick.className = 'zb-we-tick';
      tick.textContent = '✓';
      card.appendChild(tick);
      if (it.previewUrl) {
        var img = document.createElement('img');
        img.loading = 'lazy';
        // previewUrl is serve-relative (/media/...) — resolve against API or
        // the img loads against the ZCode app origin and 404s.
        img.src = mt(API + it.previewUrl);
        img.alt = '';
        card.appendChild(img);
      } else {
        var ph = document.createElement('div');
        ph.className = 'zb-we-ph';
        ph.textContent = '无预览';
        card.appendChild(ph);
      }
      if (!it.importable) {
        var tag = document.createElement('span');
        tag.className = 'zb-we-tag';
        tag.textContent = '网页';
        card.appendChild(tag);
      }
      var t = document.createElement('div');
      t.className = 'zb-we-name';
      t.textContent = it.title;
      card.appendChild(t);
      card.addEventListener('click', function () {
        if (!it.importable) return;
        if (selected[it.dir]) { delete selected[it.dir]; card.removeAttribute('data-sel'); }
        else { selected[it.dir] = 1; card.setAttribute('data-sel', '1'); }
        refreshSel();
      });
      return card;
    }
    function renderGroups() {
      groupEls = [];
      list.textContent = '';
      var groups;
      if (weMode === 'folder' && folderNav === 'root') {
        // Root of the folder view: folder cards only (real-file-browser
        // look), 未分类 last. Folder titles come from WE's own browser
        // folder tree (config.json → browser.folders).
        var titles = [];
        items.forEach(function (it) {
          var f = it.folder || '未分类';
          if (titles.indexOf(f) < 0) titles.push(f);
        });
        titles.sort(function (a, b) {
          return (a === '未分类' ? 1 : 0) - (b === '未分类' ? 1 : 0) || a.localeCompare(b, 'zh');
        });
        var fgrid = document.createElement('div');
        fgrid.className = 'zb-we-grid';
        titles.forEach(function (t) {
          var cnt = items.filter(function (it) { return (it.folder || '未分类') === t; }).length;
          var fc = document.createElement('div');
          fc.className = 'zb-we-fcard';
          fc.setAttribute('data-title', t.toLowerCase());
          fc.title = t + ' — ' + cnt + ' 个壁纸,点击进入';
          var ico = document.createElement('div');
          ico.className = 'zb-we-fico';
          ico.textContent = t === '未分类' ? '🗃' : '📁';
          fc.appendChild(ico);
          var fn = document.createElement('div');
          fn.className = 'zb-we-fname';
          fn.textContent = t;
          fc.appendChild(fn);
          var fcnt = document.createElement('div');
          fcnt.className = 'zb-we-fcount';
          fcnt.textContent = cnt + ' 个';
          fc.appendChild(fcnt);
          fc.addEventListener('click', function () {
            curFolder = t;
            folderNav = 'inside';
            search.value = '';
            renderGroups();
          });
          fgrid.appendChild(fc);
        });
        list.appendChild(fgrid);
        groupEls.push(fgrid);
        applyFilter();
        return;
      }
      if (weMode === 'folder' && folderNav === 'inside') {
        // Inside one folder: back row + its wallpapers as a flat grid.
        var back = document.createElement('button');
        back.className = 'zb-we-back';
        back.innerHTML = '← 返回文件夹列表';
        back.title = '返回上一层';
        back.addEventListener('click', function () {
          folderNav = 'root';
          curFolder = '';
          search.value = '';
          renderGroups();
        });
        list.appendChild(back);
        var lab = document.createElement('div');
        lab.className = 'zb-we-group';
        lab.textContent = (curFolder === '未分类' ? '🗃 ' : '📁 ') + curFolder;
        list.appendChild(lab);
        var grid = document.createElement('div');
        grid.className = 'zb-we-grid';
        items.filter(function (it) { return (it.folder || '未分类') === curFolder; })
          .forEach(function (it) { grid.appendChild(buildCard(it)); });
        list.appendChild(grid);
        groupEls.push(grid);
        applyFilter();
        return;
      }
      groups = [
        { label: '场景', list: items.filter(function (it) { return it.type === 'scene'; }) },
        { label: '视频', list: items.filter(function (it) { return it.type === 'video'; }) },
        { label: '网页 · 暂不支持导入', list: items.filter(function (it) { return it.type === 'web'; }) },
      ];
      groups.forEach(function (g) {
        if (!g.list.length) return;
        var wrap = document.createElement('div');
        var lab = document.createElement('div');
        lab.className = 'zb-we-group';
        lab.textContent = g.label + ' · ' + g.list.length;
        wrap.appendChild(lab);
        var grid = document.createElement('div');
        grid.className = 'zb-we-grid';
        g.list.forEach(function (it) { grid.appendChild(buildCard(it)); });
        wrap.appendChild(grid);
        groupEls.push(wrap);
        list.appendChild(wrap);
      });
      if (!items.length) {
        var empty = document.createElement('div');
        empty.className = 'zb-we-empty';
        empty.textContent = '未找到 Wallpaper Engine 壁纸。需要 Steam 创意工坊内容(场景/视频壁纸),或 wallpaper_engine\\\\projects\\\\myprojects 下的自建项目。';
        list.appendChild(empty);
      }
      applyFilter();
    }
    function applyFilter() {
      var q = search.value.trim().toLowerCase();
      var cards = list.querySelectorAll('.zb-we-card, .zb-we-fcard');
      for (var i = 0; i < cards.length; i++) {
        cards[i].hidden = Boolean(q) && cards[i].getAttribute('data-title').indexOf(q) < 0;
      }
      groupEls.forEach(function (g) {
        var visible = 0;
        // Count BOTH wallpaper and folder cards: the folder-view root grid
        // holds only .zb-we-fcard, and matching .zb-we-card alone read as
        // "empty group" — hiding the whole folder grid, which is exactly the
        // "popup opens blank" bug.
        var gr = g.querySelectorAll('.zb-we-card, .zb-we-fcard');
        for (var j = 0; j < gr.length; j++) if (!gr[j].hidden) visible++;
        g.hidden = visible === 0;
      });
    }
    renderGroups();
    wePop.appendChild(list);

    // Bottom action bar: multi-select summary + one-shot queued import.
    var foot = document.createElement('div');
    foot.className = 'zb-we-foot';
    selInfo.className = 'zb-we-selinfo';
    impBtn.className = 'zb-btn';
    impBtn.textContent = '导入所选';
    impBtn.title = '将选中的壁纸逐个排队导入(规格/保留声音跟随上方导入设置)';
    impBtn.disabled = true;
    impBtn.addEventListener('click', function () {
      var dirs = Object.keys(selected);
      if (!dirs.length) return;
      closeWePop();
      startImportQueue(dirs);
    });
    var clearBtn = document.createElement('button');
    clearBtn.className = 'zb-btn';
    clearBtn.textContent = '清空选择';
    clearBtn.title = '取消全部选择';
    clearBtn.addEventListener('click', function () {
      selected = {};
      var cards = list.querySelectorAll('.zb-we-card[data-sel]');
      for (var i = 0; i < cards.length; i++) cards[i].removeAttribute('data-sel');
      refreshSel();
    });
    refreshSel();
    foot.appendChild(selInfo); foot.appendChild(clearBtn); foot.appendChild(impBtn);
    wePop.appendChild(foot);
    document.body.appendChild(wePop);

    // Opens to the LEFT of the panel (the panel hugs the right edge).
    var anchor = $('zb-we-lib').getBoundingClientRect();
    wePop.style.left = Math.max(8, Math.min(window.innerWidth - 568, anchor.left - 570)) + 'px';
    wePop.style.top = Math.max(8, Math.min(window.innerHeight - wePop.offsetHeight - 8, anchor.top)) + 'px';
    document.addEventListener('wheel', weScrollClose, { capture: true, passive: true });
    document.addEventListener('keydown', weEscClose, true);

    search.addEventListener('input', applyFilter);
    setTimeout(function () { search.focus(); }, 30);

    // Hover preview: rest on a card 300ms and a large version of its
    // preview appears beside the popup (WE preview GIFs animate there).
    weHoverHide = function () {
      if (weHoverTimer) { clearTimeout(weHoverTimer); weHoverTimer = null; }
      var p = document.querySelector('body > .zb-we-hover');
      if (p) p.remove();
    };
    var weHoverTimer = null;
    list.addEventListener('mouseover', function (e) {
      var card = e.target && e.target.closest ? e.target.closest('.zb-we-card') : null;
      if (!card) return;
      weHoverHide();
      weHoverTimer = setTimeout(function () {
        weHoverTimer = null;
        var img = card.querySelector('img');
        if (!img) return;
        weHoverHide();
        // Real preview: video wallpapers play their actual footage when the
        // setting allows it; everything else (and scenes, whose only real
        // preview would be a render) shows the cover image.
        var vUrl = card.getAttribute('data-video');
        var live = false;
        try { live = localStorage.getItem('zcode-beautify:we-live') !== '0'; } catch (e) {}
        var prev = document.createElement('div');
        prev.className = 'zb-we-hover';
        var media;
        if (vUrl && live) {
          media = document.createElement('video');
          media.muted = true;
          media.loop = true;
          media.playsInline = true;
          media.autoplay = true;
          media.src = mt(API + vUrl);
        } else {
          media = document.createElement('img');
          media.src = img.src;
        }
        media.alt = '';
        prev.appendChild(media);
        // Vertical placement is derived from the CURRENT box height: centered
        // on the card, clamped to the viewport, pinned to the top when a
        // very tall preview cannot fit at all. Runs once with the estimate
        // and again when the medium is ready with its real aspect.
        var place = function () {
          var r = card.getBoundingClientRect();
          var h = prev.offsetHeight || 180;
          var top = r.top + r.height / 2 - h / 2;
          if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
          if (top < 8) top = 8;
          prev.style.top = Math.round(top) + 'px';
          prev.style.right = Math.max(8, window.innerWidth - r.left + 10) + 'px';
        };
        media.onload = place;
        media.addEventListener('loadedmetadata', place);
        document.body.appendChild(prev);
        place();
        if (media.tagName === 'VIDEO') media.play().catch(function () {});
      }, 300);
    });
    list.addEventListener('mouseout', function (e) {
      var card = e.target && e.target.closest ? e.target.closest('.zb-we-card') : null;
      if (!card) return;
      if (e.relatedTarget && card.contains(e.relatedTarget)) return;
      weHoverHide();
    });
  }
  $('zb-we-lib').addEventListener('click', function () {
    var btn = this;
    btn.textContent = '…';
    apiFetch('/api/we-library')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        btn.textContent = '🧩';
        if (!d || d.error) { status((d && d.error) || '读取 WE 壁纸库失败'); return; }
        openWePop(d.items || []);
      })
      .catch(function () { btn.textContent = '🧩'; status('无法连接美化服务 service unreachable'); });
  });
  /** Resolves once no import job is running (multi-file queue pacing). */
  function importIdle() {
    return new Promise(function (resolve) {
      var t = zbEvery(function () {
        apiFetch('/api/import-status')
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (!j || !j.running) { clearInterval(t); setTimeout(resolve, 400); }
          })
          .catch(function () { clearInterval(t); resolve(); });
      }, 800);
    });
  }
  /** Serial import queue for multi-selected files (one job at a time). */
  function startImportQueue(paths) {
    status('已选 ' + paths.length + ' 个,开始排队导入…');
    batchInfo = { i: 0, n: paths.length };
    var i = 0;
    var next = function () {
      if (i >= paths.length) {
        batchInfo = null;
        status('队列完成:' + paths.length + ' 个'); markLibDirty(); return;
      }
      $('zb-scene-path').value = paths[i];
      i++;
      batchInfo.i = i;
      status('导入 ' + i + '/' + paths.length + '…');
      $('zb-import').click();
      void importIdle().then(next);
    };
    next();
  }
  $('zb-scene-path').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') $('zb-import').click();
  });

  $('zb-import').addEventListener('click', function () {
    var p = $('zb-scene-path').value.trim();
    if (!p) { status('请先粘贴场景壁纸路径'); return; }
    showGuide('', false);
    post('/api/import-scene', { path: p, importRes: zbResSel ? resPayload() : undefined }, function (d) {
      if (d && d.error) { status(d.error); return; }
      setProgress(true, 'starting');
      if (importTimer) clearInterval(importTimer);
      importTimer = zbEvery(pollImport, 600);
    });
  });
  function pollImport() {
    apiFetch('/api/import-status')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        setProgress(j.running || j.stage === 'done', j.stage);
        if (j.error) {
          clearInterval(importTimer); importTimer = null;
          setProgress(false);
          showGuide(j.guide || ('导入失败: ' + j.error), Boolean(j.guide));
          return;
        }
        if (!j.running && j.stage === 'done') {
          clearInterval(importTimer); importTimer = null;
          status(j.result && j.result.fromCache ? '已从缓存载入' : '动态壁纸已应用');
          refresh();
          markLibDirty();
        }
      })
      .catch(function () { /* transient */ });
  }
  $('zb-guide-retry').addEventListener('click', function () {
    showGuide('', false);
    $('zb-import').click();
  });

  // --- library (dynamic + images, each with its import entry up front) -----
  // Collapsible library cards: clicking the title folds the body; the state
  // survives panel reopens (localStorage) per card.
  function bindFold(cardId, storeKey) {
    var card = document.getElementById(cardId);
    if (!card) return;
    var title = card.querySelector('.zb-card-title');
    var apply = function (collapsed) {
      card.classList.toggle('zb-collapsed', collapsed);
      title.title = collapsed ? '展开' : '折叠';
    };
    var saved = null;
    try { saved = localStorage.getItem(storeKey); } catch (e) {}
    apply(saved === '1');
    title.addEventListener('click', function () {
      var next = !card.classList.contains('zb-collapsed');
      apply(next);
      try { localStorage.setItem(storeKey, next ? '1' : '0'); } catch (e) {}
      hideHoverPreview(); // thumbnails vanish under the fold
    });
  }
  bindFold('zb-card-display', 'zcode-beautify:fold-display');
  bindFold('zb-card-history', 'zcode-beautify:fold-history');
  bindFold('zb-card-scenes', 'zcode-beautify:fold-scenes');
  bindFold('zb-card-images', 'zcode-beautify:fold-images');

  // Image sort mode (F6): default newest first; toggles to name order.
  var imgSort = 'time';
  var LIB_QUERY = '';
  function applyLibQuery() {
    LIB_QUERY = imgSort === 'name' ? '?sort=name' : '';
    $('zb-img-sort').textContent = imgSort === 'name' ? '⇅ 名称' : '⇅ 时间';
  }
  var batchMode = false;
  function loadLibrary() {
    apiFetch('/api/library' + LIB_QUERY)
      .then(function (r) { return r.json(); })
      .then(function (lib) {
        var scenes = $('zb-lib-scenes');
        var images = $('zb-lib-images');
        scenes.innerHTML = '';
        images.innerHTML = '';
        (lib.scenes || []).forEach(function (s) {
          var item = libItem(s.name || ('场景 ' + s.hash.slice(0, 8)), { hash: s.hash }, s.hash, 'scene', s.hash, mt(API + '/media/poster/' + s.hash + '.jpg'), s.favorite);
          if (typeof s.sizeBytes === 'number' && s.sizeBytes > 0) item.title = (s.name || s.hash.slice(0, 8)) + ' — ' + (s.sizeBytes / 1048576).toFixed(1) + ' MB';
          scenes.appendChild(item);
        });
        if (!(lib.scenes || []).length) {
          scenes.innerHTML = '<div class="zb-lib-head">暂无动态壁纸 — 用上方导入</div>';
        }
        (lib.images || []).forEach(function (im) {
          images.appendChild(libItem(im.name, { path: im.path }, im.path, 'image', im.path, mt(API + '/media/lib/' + encodeURIComponent(im.name)), im.favorite));
        });
        if (!(lib.images || []).length) {
          images.innerHTML = '<div class="zb-lib-head">暂无图片壁纸 — 用上方更换图片</div>';
        }
        if (batchMode) enterBatchMode(false); // re-arm checkboxes on the fresh rows
      })
      .catch(function () { /* offline */ });
  }
  applyLibQuery();
  $('zb-img-sort').addEventListener('click', function () {
    imgSort = imgSort === 'time' ? 'name' : 'time';
    applyLibQuery();
    markLibDirty();
  });
  $('zb-open-images').addEventListener('click', function () {
    post('/api/open-folder', { target: 'images' }, function () { status('已在资源管理器打开'); });
  });
  $('zb-open-scenes').addEventListener('click', function () {
    post('/api/open-folder', { target: 'scenes' }, function () { status('已在资源管理器打开'); });
  });
  // Batch delete (F6): checkboxes on image rows, one shot for the selection.
  function enterBatchMode(on) {
    batchMode = on;
    var btn = $('zb-img-batch');
    var images = $('zb-lib-images');
    if (on) {
      btn.textContent = '🗑 删所选';
      var rows = images.querySelectorAll('.zb-item');
      for (var i = 0; i < rows.length; i++) {
        if (!rows[i].querySelector('.zb-item-img')) continue;
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'zb-batch-cb';
        cb.setAttribute('data-key', rows[i].getAttribute('data-key'));
        rows[i].insertBefore(cb, rows[i].firstChild);
      }
    } else {
      btn.textContent = '☰ 批量';
      var cbs = images.querySelectorAll('.zb-batch-cb');
      for (var j = 0; j < cbs.length; j++) cbs[j].remove();
    }
  }
  $('zb-img-batch').addEventListener('click', function () {
    if (!batchMode) { enterBatchMode(true); status('勾选要删除的图片,再点"删所选"'); return; }
    var checked = document.querySelectorAll('#zb-lib-images .zb-batch-cb:checked');
    if (!checked.length) { enterBatchMode(false); status('未勾选任何条目'); return; }
    // Image rows carry their raw absolute path in data-key (scene rows hold a
    // hex hash and never get checkboxes) — anything non-hex is a path.
    var paths = [];
    for (var i = 0; i < checked.length; i++) {
      var k = checked[i].getAttribute('data-key') || '';
      if (k && !/^[a-f0-9]{8,64}$/.test(k)) paths.push(k);
    }
    if (!paths.length) { enterBatchMode(false); return; }
    var self = this;
    var pending = paths.length, failed = 0;
    paths.forEach(function (p) {
      post('/api/library-delete', { kind: 'image', path: p }, function (d) {
        if (!d || !d.ok) failed++;
        if (--pending === 0) {
          enterBatchMode(false);
          markLibDirty();
          status(failed ? ('部分未删除:' + failed + ' 条(使用中的需先切换)') : ('已删除 ' + (paths.length - failed) + ' 张'));
        }
      });
    });
  });

  // --- scene cache storage line (F2) ---------------------------------------
  function loadStorage() {
    apiFetch('/api/storage')
      .then(function (r) { return r.json(); })
      .then(function (s) {
        var txt = $('zb-storage-text');
        var mb = (s.scenesBytes || 0) / 1048576;
        txt.textContent = mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB 缓存' : mb.toFixed(1) + ' MB 缓存';
        txt.title = '壁纸缩略图 ' + ((s.thumbsBytes || 0) / 1048576).toFixed(1) + ' MB';
      })
      .catch(function () { $('zb-storage-text').textContent = ''; });
  }
  $('zb-compress').addEventListener('click', function () {
    var btn = this;
    if (btn.getAttribute('data-armed') !== '1') {
      btn.setAttribute('data-armed', '1');
      status('再点一次确认:全部动态壁纸压缩为 720p/24fps(使用中的跳过,耗时数秒)');
      setTimeout(function () { btn.removeAttribute('data-armed'); }, 5000);
      return;
    }
    btn.removeAttribute('data-armed');
    btn.textContent = '⚡ 压缩中…';
    post('/api/scenes-recompress', {}, function (d) {
      btn.textContent = '⚡ 压缩';
      if (!d || !d.ok) { status('压缩失败:' + ((d && d.error) || '服务未连接')); return; }
      var mb = (d.savedBytes || 0) / 1048576;
      status('已压缩 ' + d.done + ' 个' + (d.skipped ? '(跳过 ' + d.skipped + ' 个使用中)' : '') + ' 省 ' + mb.toFixed(1) + ' MB');
      markLibDirty();
    });
  });
  $('zb-purge').addEventListener('click', function () {
    var btn = this;
    if (btn.getAttribute('data-armed') !== '1') {
      btn.setAttribute('data-armed', '1');
      status('再点一次确认:清理全部动态壁纸缓存(使用中的保留)');
      setTimeout(function () { btn.removeAttribute('data-armed'); }, 5000);
      return;
    }
    btn.removeAttribute('data-armed');
    post('/api/scenes-purge', {}, function (d) {
      status(d && d.ok ? '已清理 ' + (d.removed || 0) + ' 项缓存' : '清理失败');
      markLibDirty();
    });
  });

  // --- recently used (F8) ---------------------------------------------------
  function loadHistory() {
    apiFetch('/api/history')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var box = $('zb-history');
        box.innerHTML = '';
        var items = (d && d.items) || [];
        if (!items.length) { box.innerHTML = '<div class="zb-lib-head">暂无记录</div>'; return; }
        items.slice(0, 10).forEach(function (it) {
          var el = document.createElement('div');
          el.className = 'zb-item';
          var img = document.createElement('img');
          img.className = 'zb-item-img';
          img.src = mt(it.thumbUrl || '');
          img.loading = 'lazy';
          var lb = document.createElement('span');
          lb.className = 'zb-label';
          lb.textContent = it.label;
          lb.title = it.label + (it.at ? ' — ' + new Date(it.at).toLocaleString() : '');
          lb.addEventListener('click', function () {
            post('/api/apply-wallpaper', it.hash ? { hash: it.hash } : { path: it.path }, function (r) {
              if (r && r.error) { status(r.error); return; }
              try { localStorage.setItem('zcode-beautify:current-key', it.hash ? it.hash : it.path); } catch (e) {}
              markCurrent(it.hash ? it.hash : it.path);
              markLibDirty();
            });
          });
          el.appendChild(img);
          el.appendChild(lb);
          box.appendChild(el);
        });
      })
      .catch(function () { /* offline */ });
  }

  // --- playlist status line (第 N/M 张 · 剩余 Xs), 1s while the panel is open
  var rotStateTimer = null;
  function pollRotState() {
    apiFetch('/api/rotation-state')
      .then(function (r) { return r.json(); })
      .then(function (s) {
        var el = $('zb-rot-state');
        if (!s || !s.on) { el.textContent = '未启用'; return; }
        if (s.mode === 'schedule') { el.textContent = '定点模式 ' + s.planName; return; }
        var remain = Math.ceil((s.remainMs || 0) / 1000);
        el.textContent = '第 ' + (s.index + 1) + '/' + s.total + ' 张 · ' + (s.frozen ? '已暂停(后台)' : remain + 's');
      })
      .catch(function () { /* offline */ });
  }
  // The rot-state poller starts/stops in the MAIN click handler below — a
  // capture-phase variant ran BEFORE the panel toggled, so "open" read as
  // "closed" and killed the interval the moment the panel opened, freezing
  // the status line ("第 N/M 张 · Xs" never changed).
  rotStateTimer = panelOpen() ? zbEvery(pollRotState, 1000) : null;

  // --- usage-time ranking (📊) ----------------------------------------------
  $('zb-stats').addEventListener('click', function () {
    apiFetch('/api/stats')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var existing = document.querySelector('body > .zb-wp-pop');
        if (existing) { existing.remove(); return; }
        var pop = document.createElement('div');
        pop.className = 'zb-wp-pop';
        var items = (d && d.items) || [];
        if (!items.length) pop.textContent = '暂无使用记录';
        items.forEach(function (it, i) {
          var row = document.createElement('div');
          row.className = 'zb-wp-item';
          var rank = document.createElement('span');
          rank.textContent = (i + 1) + '.';
          rank.style.cssText = 'width:16px;flex:none;opacity:.6';
          var name = document.createElement('span');
          name.textContent = it.label;
          name.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
          var t = document.createElement('span');
          var min = Math.round(it.seconds / 60);
          t.textContent = min >= 60 ? (Math.round(min / 60 * 10) / 10) + '小时' : min + '分钟';
          t.style.opacity = '.7';
          row.appendChild(rank); row.appendChild(name); row.appendChild(t);
          pop.appendChild(row);
        });
        document.body.appendChild(pop);
      (function () { var wep = document.querySelector('body > .zb-we-pop'); if (wep) document.body.appendChild(wep); })(); // keep the WE window on top (equal z)
        var btn = $('zb-stats').getBoundingClientRect();
        pop.style.left = Math.max(8, Math.min(btn.left, window.innerWidth - 216)) + 'px';
        pop.style.width = '208px';
        pop.style.bottom = 'auto';
        pop.style.top = (btn.bottom + 4) + 'px';
        setTimeout(function () {
          var close = function (e) {
            if (!pop.contains(e.target) && e.target !== $('zb-stats')) { pop.remove(); document.removeEventListener('mousedown', close, true); }
          };
          document.addEventListener('mousedown', close, true);
        }, 0);
      })
      .catch(function () { status('服务未连接'); });
  });
  // --- config export / import (F3) -----------------------------------------
  $('zb-cfg-export').addEventListener('click', function () {
    apiFetch('/api/export')
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        var blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'zcode-beautify-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        status('已导出配置文件');
      })
      .catch(function () { status('导出失败,服务未连接'); });
  });
  $('zb-cfg-import').addEventListener('click', function () { $('zb-cfg-file').click(); });
  $('zb-cfg-file').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      var body;
      try { body = JSON.parse(fr.result); } catch (e) { status('文件不是有效的 JSON'); return; }
      post('/api/import-config', body, function (d) {
        if (d && d.error) { status(d.error); return; }
        status('配置已导入并应用');
        refresh();
        markLibDirty();
        loadRotation();
      });
    };
    fr.readAsText(f);
  });

  /** Flip the data-current highlight in place. Rebuilding the whole list on
   *  every apply (loadLibrary) destroys and re-decodes every thumbnail <img>,
   *  which reads as the whole library flickering on each wallpaper switch. */
  function markCurrent(key) {
    var rows = document.querySelectorAll('#' + ROOT_ID + ' .zb-item[data-key]');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-key') === key) rows[i].setAttribute('data-current', '1');
      else rows[i].removeAttribute('data-current');
    }
  }
  /** One library row: click-to-apply label + rename (inline) + two-step delete. */
  function libItem(label, applyBody, key, kind, ref, thumbUrl, favorite) {
    var row = document.createElement('div');
    row.className = 'zb-item';
    row.setAttribute('data-key', key);
    var cur = localStorage.getItem('zcode-beautify:current-key');
    if (cur === key) row.setAttribute('data-current', '1');

    // Favorite pin: floats to the top of the list (server sorts), survives
    // restarts in favorites.json.
    var star = document.createElement('button');
    star.className = 'zb-act';
    star.textContent = favorite ? '★' : '☆';
    star.title = favorite ? '取消收藏' : '收藏置顶';
    star.addEventListener('click', function (e) {
      e.stopPropagation();
      post('/api/favorite', { on: !favorite, hash: applyBody.hash, path: applyBody.path }, function (d) {
        if (d && d.ok) markLibDirty();
      });
    });
    row.appendChild(star);

    if (thumbUrl) {
      var thumb = document.createElement('img');
      thumb.className = 'zb-item-img';
      thumb.src = thumbUrl;
      thumb.loading = 'lazy';
      row.appendChild(thumb);
    }

    var labelEl = document.createElement('span');
    labelEl.className = 'zb-label';
    labelEl.textContent = label;
    labelEl.title = label;
    labelEl.addEventListener('click', function () {
      post('/api/apply-wallpaper', applyBody, function (r) {
        if (r && r.error) { status(r.error); return; }
        try { localStorage.setItem('zcode-beautify:current-key', key); } catch (e) {}
        status('已应用 applied');
        markCurrent(key);
        markLibDirty();
      });
    });
    row.appendChild(labelEl);

    function renameEditor() {
      var input = document.createElement('input');
      input.className = 'zb-label-input';
      input.value = label;
      row.replaceChild(input, labelEl);
      input.focus(); input.select();
      var done = function (save) {
        if (save && input.value.trim() && input.value.trim() !== label) {
          post('/api/library-rename', { kind: kind, hash: applyBody.hash, path: applyBody.path, name: input.value.trim() },
            function (r) {
              if (r && r.error) { status(r.error); }
              markLibDirty();
            });
        } else {
          markLibDirty();
        }
      };
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') done(true);
        if (e.key === 'Escape') done(false);
      });
      input.addEventListener('blur', function () { done(true); });
    }

    var ren = document.createElement('button');
    ren.className = 'zb-act'; ren.textContent = '✎'; ren.title = '重命名';
    ren.addEventListener('click', renameEditor);
    row.appendChild(ren);

    var del = document.createElement('button');
    del.className = 'zb-act'; del.textContent = '🗑'; del.title = '删除';
    var disarm = null;
    del.addEventListener('click', function () {
      if (del.getAttribute('data-armed') !== '1') {
        del.setAttribute('data-armed', '1'); del.textContent = '确认删除?';
        status('再点一次确认删除 ' + label);
        disarm = setTimeout(function () { del.removeAttribute('data-armed'); del.textContent = '🗑'; }, 5000);
        return;
      }
      clearTimeout(disarm);
      post('/api/library-delete', { kind: kind, hash: applyBody.hash, path: applyBody.path }, function (r) {
        if (r && r.error) { status(r.error); del.removeAttribute('data-armed'); del.textContent = '🗑'; return; }
        if (localStorage.getItem('zcode-beautify:current-key') === key) {
          try { localStorage.removeItem('zcode-beautify:current-key'); } catch (e) {}
        }
        status('已删除 deleted');
        markLibDirty();
      });
    });
    row.appendChild(del);
    return row;
  }

  // --- wallpaper rotation (定时播放: plans, each with its own mode) ---------
  var schedOptions = [];
  var schedPlans = [];        // plans being edited (id/name/mode/entries)
  var schedIdx = 0;           // plan currently shown in the editor
  var schedActiveId = null;   // which plan plays (server side)
  var SCHED_DEFAULT_TIMES = ['09:00', '12:00', '18:00', '21:00'];
  var MODE_HINTS = {
    sequence: '每张播放设定的时长后自动切下一张,顺序循环;保存即开始',
    random: '随机顺序播放,同一张不会连续出现;保存即开始',
    schedule: '每天到设定的时间点切换到对应壁纸;保存后到点生效'
  };
  function schedMode() { return $('zb-sched-mode').value || 'sequence'; }
  function applyModeHint() { $('zb-sched-hint').textContent = MODE_HINTS[schedMode()] || ''; }
  function fetchScheduleOptions() {
    return apiFetch('/api/library' + LIB_QUERY)
      .then(function (r) { return r.json(); })
      .then(function (lib) {
        schedOptions = [];
        (lib.scenes || []).forEach(function (s) {
          schedOptions.push({
            value: 'h:' + s.hash,
            label: s.name || ('场景 ' + s.hash.slice(0, 8)),
            thumb: mt(API + '/media/poster/' + s.hash + '.jpg'),
            group: 'scene'
          });
        });
        (lib.images || []).forEach(function (im) {
          schedOptions.push({
            value: 'p:' + im.path,
            label: im.name,
            thumb: mt(API + '/media/lib/' + encodeURIComponent(im.name)),
            group: 'image'
          });
        });
        if (!schedOptions.length) schedOptions = [{ value: '', label: '(壁纸库为空)' }];
      })
      .catch(function () { /* offline */ });
  }
  /**
   * Wallpaper picker with thumbnail previews (native <option> elements cannot
   * show images). The row keeps its current value in a data-wp attribute; the
   * button shows the selected wallpaper's poster, clicking opens a popup list
   * where every option carries a preview image.
   */
  function wallpaperPicker(row, val) {
    var wrap = document.createElement('div');
    wrap.className = 'zb-wp-picker';
    var cur = null;
    for (var i = 0; i < schedOptions.length; i++) if (schedOptions[i].value === val) cur = schedOptions[i];
    var hasLib = schedOptions.length && schedOptions[0].value !== '';
    if (!cur) {
      if (!val && hasLib) { cur = schedOptions[0]; val = cur.value; }
      else cur = { value: val, label: val ? '(壁纸已失效)' : '(壁纸库为空)', thumb: null };
    }
    row.setAttribute('data-wp', val);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'zb-wp-btn';
    var img = document.createElement('img');
    if (cur.thumb) img.src = cur.thumb; else img.style.visibility = 'hidden';
    var span = document.createElement('span');
    span.textContent = cur.label;
    btn.appendChild(img); btn.appendChild(span);
    var pop = null;
    function closePop() {
      if (!pop) return;
      pop.remove(); pop = null;
      hideHoverPreview();
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('wheel', onScrollClose, true);
    }
    function onDoc(e) {
      if (pop && !pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closePop();
    }
    // A fixed popup does not follow scrolling — a USER wheel scroll in the
    // background closes it. wheel (not scroll): ZCode's chat column scrolls
    // programmatically while streaming, and a scroll EVENT would close the
    // popup without any user intent. Scrolling inside the popup itself is
    // ordinary browsing and must leave it open.
    function onScrollClose(e) {
      if (pop && e && e.target && pop.contains(e.target)) return;
      closePop();
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (pop) { closePop(); return; }
      if (!hasLib) return;
      pop = document.createElement('div');
      pop.className = 'zb-wp-pop';
      // Grouped: 动态壁纸 first, then 图片壁纸 (skips empty groups); each
      // group lives in its own scroll window with its own scrollbar.
      var groups = [{ key: 'scene', label: '动态壁纸' }, { key: 'image', label: '图片壁纸' }];
      var groupLists = [];
      groups.forEach(function (g) {
        var items = schedOptions.filter(function (o) { return (o.group || '') === g.key; });
        if (!items.length) return;
        var head = document.createElement('div');
        head.className = 'zb-wp-group';
        head.textContent = g.label;
        pop.appendChild(head);
        var glist = document.createElement('div');
        glist.className = 'zb-wp-group-list';
        items.forEach(function (o) {
          var it = document.createElement('div');
          it.className = 'zb-wp-item';
          if (o.value === row.getAttribute('data-wp')) it.setAttribute('data-cur', '1');
          var t = document.createElement('img');
          if (o.thumb) t.src = o.thumb; else t.style.visibility = 'hidden';
          var s = document.createElement('span');
          s.textContent = o.label;
          it.appendChild(t); it.appendChild(s);
          it.addEventListener('click', function (ev) {
            ev.stopPropagation();
            row.setAttribute('data-wp', o.value);
            if (o.thumb) { img.src = o.thumb; img.style.visibility = 'visible'; }
            else img.style.visibility = 'hidden';
            span.textContent = o.label;
            closePop();
          });
          glist.appendChild(it);
        });
        pop.appendChild(glist);
        groupLists.push(glist);
      });
      document.body.appendChild(pop);
      (function () { var wep = document.querySelector('body > .zb-we-pop'); if (wep) document.body.appendChild(wep); })(); // keep the WE window on top (equal z)
      // Fixed placement anchored to the button: opens above it when the full
      // two-column list fits; below otherwise, shrinking the group windows
      // proportionally when the viewport runs out of room.
      var r = btn.getBoundingClientRect();
      var w = Math.max(r.width, 200);
      pop.style.width = w + 'px';
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
      var needed = pop.offsetHeight + 4;
      if (r.top >= needed + 8) {
        pop.style.top = 'auto';
        pop.style.bottom = (window.innerHeight - r.top + 4) + 'px';
      } else {
        pop.style.bottom = 'auto';
        pop.style.top = (r.bottom + 4) + 'px';
        var space = window.innerHeight - r.bottom - 12;
        if (space < needed && groupLists.length) {
          var chromeH = needed - groupLists.reduce(function (a, el) { return a + el.offsetHeight; }, 0);
          var per = Math.max(64, Math.floor((space - chromeH) / groupLists.length));
          groupLists.forEach(function (el) { el.style.maxHeight = per + 'px'; });
        }
      }
      document.addEventListener('mousedown', onDoc, true);
      document.addEventListener('wheel', onScrollClose, { capture: true, passive: true });
    });
    wrap.appendChild(btn);
    return wrap;
  }
  function schedRow(entry) {
    var row = document.createElement('div');
    row.className = 'zb-sched-row';
    if (schedMode() === 'schedule') {
      var t = document.createElement('input');
      t.type = 'time';
      t.value = entry.time || '09:00';
      row.appendChild(t);
    } else {
      var d = document.createElement('input');
      d.type = 'number';
      d.min = '0.5'; d.step = '0.5';
      d.value = entry.seconds ? String(Math.round((entry.seconds / 60) * 10) / 10) : '5';
      d.title = '播放时长(分钟)';
      row.appendChild(d);
      var u = document.createElement('span');
      u.className = 'zb-sched-dur'; u.textContent = '分';
      row.appendChild(u);
    }
    var val = entry.hash ? ('h:' + entry.hash) : (entry.path ? ('p:' + entry.path) : '');
    row.appendChild(wallpaperPicker(row, val));
    var del = document.createElement('button');
    del.className = 'zb-act'; del.textContent = '✕'; del.title = '删除此条';
    del.addEventListener('click', function () { row.remove(); });
    row.appendChild(del);
    return row;
  }
  function renderSchedRows(entries) {
    var list = $('zb-sched-list');
    list.innerHTML = '';
    (entries || []).forEach(function (e) { list.appendChild(schedRow(e)); });
    // A rebuilt list must start at the top — a stale scrollTop (left by scroll
    // anchoring or a clipped popup) cut off row 1's upper half.
    list.scrollTop = 0;
  }
  function renderPlanSelect() {
    var sel = $('zb-plan');
    sel.innerHTML = '';
    schedPlans.forEach(function (p, i) {
      var op = document.createElement('option');
      op.value = String(i);
      op.textContent = p.name + (p.id === schedActiveId ? ' (生效中)' : '');
      if (i === schedIdx) op.selected = true;
      sel.appendChild(op);
    });
  }
  function renderPlanEditor() {
    var plan = schedPlans[schedIdx];
    if (!plan) return;
    $('zb-sched-mode').value = plan.mode || 'sequence';
    $('zb-fx') && applyFxLabel($('zb-fx'), plan.transition || 'fade');
    $('zb-win-start').value = plan.window ? plan.window.start : '';
    $('zb-win-end').value = plan.window ? plan.window.end : '';
    applyModeHint();
    renderSchedRows(plan.entries || []);
  }
  /** Persist the per-plan activation window (F5) as the inputs change. */
  function pushPlanWindow() {
    var plan = schedPlans[schedIdx];
    if (!plan) return;
    var s = $('zb-win-start').value, e = $('zb-win-end').value;
    if (s && e && s !== e) plan.window = { start: s, end: e };
    else plan.window = undefined;
    persistPlans();
  }
  $('zb-win-start').addEventListener('change', pushPlanWindow);
  $('zb-win-end').addEventListener('change', pushPlanWindow);
  $('zb-win-clear').addEventListener('click', function () {
    $('zb-win-start').value = '';
    $('zb-win-end').value = '';
    pushPlanWindow();
    status('已清除时段,全天生效');
  });
  /** Reads the row editor into entry objects for the currently shown mode. */
  function collectPlanEntries() {
    var entries = [];
    var rows = document.querySelectorAll('#zb-sched-list .zb-sched-row');
    var isSchedule = schedMode() === 'schedule';
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i].getAttribute('data-wp') || '';
      if (!v || v.length < 3) continue;
      var hash = v.slice(0, 2) === 'h:' ? v.slice(2) : undefined;
      var imgPath = v.slice(0, 2) !== 'h:' ? v.slice(2) : undefined;
      if (isSchedule) {
        var time = rows[i].querySelector('input[type=time]').value;
        if (!time) continue;
        entries.push({ time: time, hash: hash, path: imgPath });
      } else {
        var minutes = Number(rows[i].querySelector('input[type=number]').value);
        if (!isFinite(minutes) || minutes <= 0) continue;
        var seconds = Math.round(minutes * 60);
        if (seconds < 10) seconds = 10;
        entries.push({ seconds: seconds, hash: hash, path: imgPath });
      }
    }
    return entries;
  }
  /** Writes the editor (mode + rows) back into the plan being edited. */
  function syncEditorIntoPlan() {
    var plan = schedPlans[schedIdx];
    if (!plan) return;
    plan.mode = schedMode();
    plan.entries = collectPlanEntries();
  }
  function plansPayload() {
    return schedPlans.map(function (p) {
      var out = { id: p.id, name: p.name, mode: p.mode, transition: p.transition || 'fade', entries: p.entries };
      if (p.window) out.window = p.window;
      return out;
    });
  }
  /**
   * Auto-persists plan structure edits (rename / create / delete): what the
   * dropdown already shows must survive a reopen without requiring 保存.
   * Keeps the current enabled state and active plan so playback is not
   * disturbed; the editor is NOT reloaded afterwards.
   */
  function persistPlans() {
    syncEditorIntoPlan();
    var activeId = null;
    for (var i = 0; i < schedPlans.length; i++) if (schedPlans[i].id === schedActiveId) activeId = schedActiveId;
    post('/api/rotation', {
      rotation: {
        enabled: $('zb-sched-on').checked,
        activePlanId: activeId,
        plans: plansPayload()
      }
    }, function (d) {
      if (d && d.error) { status(d.error); return; }
      if (d && d.rotation) schedActiveId = d.rotation.activePlanId || schedActiveId;
      renderPlanSelect();
    });
  }
  /** Cross-mode conversion: keeps the wallpaper refs, carries over seconds
   *  when present, spreads default times when switching to schedule. */
  function convertEntries(rawEntries, toMode) {
    return (rawEntries || []).map(function (e, i) {
      var out = e.hash ? { hash: e.hash } : { path: e.path };
      if (toMode === 'schedule') out.time = e.time || SCHED_DEFAULT_TIMES[i % SCHED_DEFAULT_TIMES.length];
      else out.seconds = e.seconds || 300;
      return out;
    });
  }
  function loadRotation() {
    fetchScheduleOptions().then(function () {
      return apiFetch('/api/rotation').then(function (r) { return r.json(); });
    }).then(function (d) {
      var rot = (d && d.rotation) || {};
      schedPlans = rot.plans && rot.plans.length
        ? rot.plans
        : [{ id: 'default', name: '方案 1', mode: 'sequence', entries: [] }];
      schedActiveId = rot.activePlanId || (schedPlans[0] && schedPlans[0].id) || null;
      var activeIdx = -1;
      for (var i = 0; i < schedPlans.length; i++) if (schedPlans[i].id === schedActiveId) activeIdx = i;
      schedIdx = activeIdx >= 0 ? activeIdx : 0;
      $('zb-sched-on').checked = !!rot.enabled;
      renderPlanSelect();
      renderPlanEditor();
    }).catch(function () { /* offline */ });
  }
  // Plan switching keeps the edited plan's state; the editor loads the newly
  // selected plan from schedPlans.
  $('zb-plan').addEventListener('change', function () {
    syncEditorIntoPlan();
    schedIdx = Number(this.value) || 0;
    renderPlanSelect();
    renderPlanEditor();
  });
  $('zb-plan-add').addEventListener('click', function () {
    syncEditorIntoPlan();
    schedPlans.push({ id: 'p' + Date.now().toString(36), name: '方案 ' + (schedPlans.length + 1), mode: 'sequence', entries: [] });
    schedIdx = schedPlans.length - 1;
    renderPlanSelect();
    renderPlanEditor();
    persistPlans();
  });
  $('zb-plan-ren').addEventListener('click', function () {
    var row = document.querySelector('.zb-sched-plan');
    var sel = $('zb-plan');
    var plan = schedPlans[schedIdx];
    if (!plan || !row) return;
    var input = document.createElement('input');
    input.type = 'text';
    input.value = plan.name;
    input.className = 'zb-label-input';
    input.style.flex = '1';
    row.replaceChild(input, sel);
    input.focus(); input.select();
    // One-shot guard: restoring the select unfocuses the input and fires
    // blur, which would otherwise run done() a second time (and an Escape
    // cancel would still commit the typed name).
    var finished = false;
    var done = function (save) {
      if (finished) return;
      finished = true;
      if (save && input.value.trim()) plan.name = input.value.trim().slice(0, 20);
      row.replaceChild(sel, input);
      renderPlanSelect();
      if (save) persistPlans();
    };
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
    input.addEventListener('blur', function () { done(true); });
  });
  $('zb-plan-del').addEventListener('click', function () {
    var btn = this;
    if (schedPlans.length <= 1) { status('至少保留一个方案'); return; }
    if (btn.getAttribute('data-armed') !== '1') {
      btn.setAttribute('data-armed', '1'); btn.textContent = '确认?';
      setTimeout(function () { btn.removeAttribute('data-armed'); btn.textContent = '🗑'; }, 3000);
      return;
    }
    btn.removeAttribute('data-armed'); btn.textContent = '🗑';
    var removed = schedPlans.splice(schedIdx, 1)[0];
    if (schedActiveId === removed.id) schedActiveId = null;
    schedIdx = Math.min(schedIdx, schedPlans.length - 1);
    renderPlanSelect();
    renderPlanEditor();
    persistPlans();
  });
  // Switching modes re-renders the rows in the new editor shape, keeping the
  // wallpapers and converting timing fields with sensible defaults.
  $('zb-sched-mode').addEventListener('change', function () {
    applyModeHint();
    var plan = schedPlans[schedIdx];
    if (!plan) return;
    plan.mode = schedMode();
    plan.entries = convertEntries(collectPlanEntries(), plan.mode);
    renderSchedRows(plan.entries);
  });
  $('zb-sched-add').addEventListener('click', function () {
    var doAdd = function () {
      // The server caps plans at 20 entries and silently drops the rest —
      // stop at the source instead of letting rows vanish after a reload.
      if (document.querySelectorAll('#zb-sched-list .zb-sched-row').length >= 20) {
        status('播放列表最多 20 条');
        return;
      }
      var entry = schedMode() === 'schedule' ? { time: '09:00' } : { seconds: 300 };
      var key = currentWallpaperKey();
      if (key.slice(0, 2) === 'h:') entry.hash = key.slice(2);
      else if (key.length > 2) entry.path = key.slice(2);
      var row = schedRow(entry);
      $('zb-sched-list').appendChild(row);
      // A full scroll window can hide the new row entirely.
      row.scrollIntoView({ block: 'nearest' });
    };
    if (!schedOptions.length || schedOptions[0].value === '') {
      fetchScheduleOptions().then(function () {
        if (!schedOptions.length || schedOptions[0].value === '') { status('壁纸库为空,先导入或更换壁纸'); return; }
        doAdd();
      });
      return;
    }
    doAdd();
  });
  // 启用开关立即提交:服务端 startRotation() 收到后马上开播/停播。之前它
  // 只是个表单值,要再点「保存/播放」才随 payload 生效,读起来像"没反应"。
  // 语义与 persistPlans 一致:不换活动方案,只翻 enabled;任何失败回滚勾选。
  $('zb-sched-on').addEventListener('change', function () {
    var want = this.checked;
    var self = this;
    syncEditorIntoPlan();
    var activeId = null;
    for (var i = 0; i < schedPlans.length; i++) if (schedPlans[i].id === schedActiveId) activeId = schedActiveId;
    if (!activeId && schedPlans[schedIdx]) activeId = schedPlans[schedIdx].id;
    fetch(API + '/api/rotation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Beautify-Token': TOKEN },
      body: JSON.stringify({ rotation: { enabled: want, activePlanId: activeId, plans: plansPayload() }, resume: true })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.error) { self.checked = !want; status(d.error); return; }
        status(want ? '已启用,开始按方案播放' : '已停止播放');
        loadRotation();
      })
      .catch(function () {
        self.checked = !want;
        status('无法连接美化服务 service unreachable');
      });
  });
  $('zb-sched-save').addEventListener('click', function () {
    syncEditorIntoPlan();
    var payload = {
      enabled: $('zb-sched-on').checked,
      activePlanId: schedPlans[schedIdx] ? schedPlans[schedIdx].id : undefined,
      plans: plansPayload()
    };
    post('/api/rotation', { rotation: payload }, function (d) {
      if (d && d.error) { status(d.error); return; }
      status(payload.enabled ? '已保存,当前方案生效' : '已保存(未启用)');
      loadRotation();
    });
  });
  // 播放 = save everything AND force-enable the edited plan right now —
  // one click from any state to visible playback.
  $('zb-sched-play').addEventListener('click', function () {
    syncEditorIntoPlan();
    var plan = schedPlans[schedIdx];
    var payload = {
      enabled: true,
      activePlanId: plan ? plan.id : undefined,
      plans: plansPayload()
    };
    post('/api/rotation', { rotation: payload }, function (d) {
      if (d && d.error) { status(d.error); return; }
      $('zb-sched-on').checked = true;
      status(plan ? '开始播放:' + plan.name : '开始播放');
      loadRotation();
    });
  });
  // 立即切换: skip the current entry's remaining duration, next wallpaper now.
  $('zb-sched-next').addEventListener('click', function () {
    post('/api/rotation-next', {}, function (d) {
      if (d && d.error) { status(d.error); return; }
      status('已切换到下一张');
    });
  });

  $('zb-reset').addEventListener('click', function () {
    var mode = this.getAttribute('data-mode') || 'reset';
    post(mode === 'restore' ? '/api/restore' : '/api/reset', {}, function () {
      if (mode === 'reset') {
        try { localStorage.removeItem('zcode-beautify:css'); localStorage.removeItem('zcode-beautify:wallpaper'); } catch (e) {}
        status('已还原默认外观');
      } else {
        status('已恢复你的壁纸');
      }
      refresh();
    });
  });

  $('zb-retry').addEventListener('click', function () {
    this.textContent = '正在重试…';
    refresh();
  });

  // --- tabs (壁纸 / 定时播放) ------------------------------------------------
  // Library/history rebuilds are DIRTY-driven: re-rendering the lists on
  // every tab switch recreated every <img> and the panel flashed black
  // while they decoded. switchTab now only refreshes control VALUES; the
  // DOM rebuilds happen when something actually changed the data.
  var zbLibDirty = true;
  function markLibDirty() {
    zbLibDirty = true;
    if (!$('zb-tab-main').hidden) { reloadMainLists(); }
  }
  function reloadMainLists() {
    zbLibDirty = false;
    loadLibrary();
    loadStorage();
    loadHistory();
    // Row height is only measurable once list items exist — re-apply the
    // per-library row limits after the rebuild settles.
    setTimeout(function () { if (typeof applyLibRows === 'function') applyLibRows(); }, 350);
  }
  var ZB_TABS = ['main', 'look', 'chat', 'sched', 'settings', 'about'];
  function switchTab(name) {
    if (ZB_TABS.indexOf(name) < 0) name = 'main';
    var tabs = document.querySelectorAll('.zb-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].setAttribute('data-active', tabs[i].getAttribute('data-tab') === name ? '1' : '0');
    }
    var pane = null;
    for (var p = 0; p < ZB_TABS.length; p++) {
      var el = $('zb-tab-' + ZB_TABS[p]);
      el.hidden = ZB_TABS[p] !== name;
      if (ZB_TABS[p] === name) pane = el;
    }
    // Silk: a short fade-and-rise so the pane change reads as one motion.
    pane.classList.remove('zb-pane-in');
    void pane.offsetWidth;
    pane.classList.add('zb-pane-in');
    try { localStorage.setItem('zcode-beautify:tab', name); } catch (e) {}
    if (name === 'sched') loadRotation();
    else if (name === 'about') { refresh(); updateAbout(); }
    else {
      refresh();
      if (zbLibDirty) reloadMainLists();
    }
  }
  $('zb-tabs').addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.zb-tab') : null;
    if (b) switchTab(b.getAttribute('data-tab'));
  });
  function activateSavedTab() {
    var saved = 'main';
    try { saved = localStorage.getItem('zcode-beautify:tab') || 'main'; } catch (e) {}
    switchTab(ZB_TABS.indexOf(saved) >= 0 ? saved : 'main');
  }
  // Header ✕ — reuse the FAB's close path so the beat/poll cleanup runs.
  $('zb-close').addEventListener('click', function () {
    if (!$('zb-panel').hidden) $('zb-fab').click();
  });
  // Sidebar search: live-filter the nav items, like the reference sidebar.
  $('zb-nav-search').addEventListener('input', function () {
    var q = this.value.trim().toLowerCase();
    var items = document.querySelectorAll('#zb-tabs .zb-tab');
    for (var i = 0; i < items.length; i++) {
      items[i].style.display = !q || (items[i].textContent || '').toLowerCase().indexOf(q) >= 0 ? '' : 'none';
    }
  });

  // --- 关于 page: plugin identity + live serve status -------------------------
  function fmtUptime(ms) {
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + ' 秒';
    var m = Math.floor(s / 60);
    if (m < 60) return m + ' 分钟';
    return Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分';
  }
  function updateAbout() {
    $('zb-ab-ver').textContent = 'v' + VERSION;
    $('zb-ab-license').textContent = LICENSE;
    $('zb-ab-author').textContent = AUTHOR;
    $('zb-ab-api').textContent = API.replace(/^.*:/, '');
    $('zb-ab-svc').textContent = '检测中…';
    $('zb-ab-uptime').textContent = '—';
    $('zb-ab-cdp').textContent = '—';
    if (lastConfig) {
      $('zb-ab-wp').textContent = lastConfig.wallpaperSet
        ? (lastConfig.mediaType === 'video' ? '动态壁纸' : '图片壁纸')
        : '未设置';
    } else {
      $('zb-ab-wp').textContent = '未知(切到其他页后返回可刷新)';
    }
    apiFetch('/api/health')
      .then(function (r) { return r.json(); })
      .then(function (h) {
        $('zb-ab-svc').textContent = '运行中 · v' + (h.version || '?') + ' (pid ' + h.pid + ')';
        if (typeof h.uptimeMs === 'number') $('zb-ab-uptime').textContent = fmtUptime(h.uptimeMs);
        if (h.cdpPort) $('zb-ab-cdp').textContent = h.cdpPort;
      })
      .catch(function () {
        $('zb-ab-svc').textContent = '未运行(仅静态信息可用)';
      });
  }
  function zbCopyRepo(url, label) {
    var fail = function () { status(label + '地址复制失败,详见 README'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { status('已复制' + label + '地址'); }, fail);
    } else fail();
  }
  $('zb-ab-copy').addEventListener('click', function () { zbCopyRepo(REPO_URL, '上游仓库'); });
  $('zb-ab-copy-fork').addEventListener('click', function () { zbCopyRepo(FORK_URL, ' Fork 仓库'); });

  // --- 关于 page: check for updates (检查更新) --------------------------------
  // One button, three states: idle "⟳ 检查更新" → "检查中…" → result. When a
  // newer release exists the SAME button becomes "打开发布页" (window.open,
  // falling back to the ⧉ 链接 copy button when popups are blocked).
  var zbLastReleaseUrl = '';
  $('zb-ab-check').addEventListener('click', function () {
    var btn = this;
    if (btn.disabled) return;
    if (zbLastReleaseUrl) {
      var opened = null;
      try { opened = window.open(zbLastReleaseUrl, '_blank'); } catch (e) { opened = null; }
      status(opened ? '已打开发布页' : '打开被拦截,已改为复制链接');
      if (!opened) zbCopyRepo(zbLastReleaseUrl, '发布页');
      return;
    }
    btn.disabled = true;
    btn.textContent = '检查中…';
    $('zb-ab-upd-sub').textContent = '正在向 GitHub 查询…';
    apiFetch('/api/update-check')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        btn.disabled = false;
        var sub = $('zb-ab-upd-sub');
        if (d && d.ok && d.hasUpdate) {
          btn.textContent = '打开发布页';
          sub.textContent = '发现新版本 v' + d.latest + '(当前 v' + d.current + ')';
          zbLastReleaseUrl = d.releaseUrl || (FORK_URL + '/releases');
          $('zb-ab-copy-rel').hidden = false;
        } else if (d && d.ok) {
          btn.textContent = '⟳ 再查一次';
          sub.textContent = d.latest ? '已是最新版本 v' + d.current : '尚无正式发布(当前 v' + d.current + ')';
        } else {
          btn.textContent = '⟳ 重试';
          sub.textContent = '检查失败(' + (d && d.error === 'network' ? '无法访问 GitHub' : '服务异常') + ')';
        }
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = '⟳ 重试';
        $('zb-ab-upd-sub').textContent = '检查失败(美化服务未响应)';
      });
  });
  $('zb-ab-copy-rel').addEventListener('click', function () {
    if (zbLastReleaseUrl) zbCopyRepo(zbLastReleaseUrl, '发布页');
  });

  $('zb-fab').addEventListener('click', function () {
    var p = $('zb-panel');
    p.hidden = !p.hidden;
    if (!p.hidden) {
      // A previously dragged panel can sit (partially) outside the viewport,
      // which reads as "the panel did not open". Pull it back in.
      var r = p.getBoundingClientRect();
      if (r.width && (r.right < 40 || r.bottom < 40 || r.left > window.innerWidth - 40 || r.top > window.innerHeight - 40)) {
        p.style.left = ''; p.style.top = ''; p.style.right = ''; p.style.bottom = '';
      }
      activateSavedTab();
      beat(true);
      if (!rotStateTimer) { pollRotState(); rotStateTimer = zbEvery(pollRotState, 1000); }
    } else {
      hideHoverPreview(); // thumbnails vanish under the closed panel
      if (root.getAttribute('data-offline') !== '1') beat(false);
      if (rotStateTimer) { clearInterval(rotStateTimer); rotStateTimer = null; }
    }
  });

  // Fill in the fit label (and control values) right away, not just on open.
  refresh();
  setTimeout(applyLibRows, 400);
  setTimeout(applyLibRows, 1500);

  (function () {
    var head = $('zb-head'), panel = $('zb-panel');
    var sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    head.addEventListener('pointerdown', function (e) {
      // The ✕ lives inside the drag bar; capturing the pointer here would
      // retarget its click to the bar and swallow the close.
      if (e.target && e.target.closest && e.target.closest('#zb-close')) return;
      dragging = true; sx = e.clientX; sy = e.clientY;
      var r = panel.getBoundingClientRect(); ox = r.left; oy = r.top;
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var x = Math.max(4, Math.min(window.innerWidth - 80, ox + e.clientX - sx));
      var y = Math.max(4, Math.min(window.innerHeight - 60, oy + e.clientY - sy));
      panel.style.left = x + 'px'; panel.style.top = y + 'px';
    });
    head.addEventListener('pointerup', function () { dragging = false; });
  })();

  // Self-heal: if the theme style is missing but a previous injection saved it,
  // restore it from localStorage.
  if (!document.getElementById('zcode-beautify-style')) {
    var savedCss = null, savedWp = null;
    try {
      savedCss = localStorage.getItem('zcode-beautify:css');
      savedWp = localStorage.getItem('zcode-beautify:wallpaper');
    } catch (e) {}
    if (savedCss) {
      var s = document.createElement('style');
      s.id = 'zcode-beautify-style';
      s.textContent = savedCss;
      (document.head || document.documentElement).appendChild(s);
      if (savedWp && !wallpaperEl()) {
        var w = document.createElement('div');
        w.id = 'zcode-beautify-wallpaper';
        document.documentElement.appendChild(w);
        w.style.backgroundImage = 'url(' + savedWp + ')';
      }
    }
  }
  };
  // The registration replays at document creation where <body> does not exist
  // yet — document.body.appendChild would throw and the panel would never
  // come back after a reload. Wait for the parser (a few ms at most).
  var zbStartupOn = function() {
    if (!document.body) return false;
    var cls = document.body.className || '';
    return /zcode-startup/.test(cls) && !/ready/.test(cls);
  };
  var zbMount = function() { runPanel(); };
  var zbPanelWait = function() {
    if (!document.body) { setTimeout(zbPanelWait, 20); return; }
    // The startup screen shows loading art — mounting the FAB/panel on top
    // of it looks broken; hold off until the app marks itself ready.
    if (STARTUP_CLEAN && zbStartupOn()) {
      var mo = new MutationObserver(function() {
        if (!zbStartupOn()) { mo.disconnect(); zbMount(); }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      return;
    }
    zbMount();
  };
  zbPanelWait();
})();`;
}
