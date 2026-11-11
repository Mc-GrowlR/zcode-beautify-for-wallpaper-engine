/**
 * T28 组件精修 (WorkBuddy component look) verification:
 *   A  normalization: defaults, clamping, strict `enabled` gate;
 *   B  CSS builder: disabled = empty, enabled = the four groups and the exact
 *      values, colors expressed through --wb-* tokens (no fixed literals);
 *   C  pipeline: WorkBuddy payload carries the sheet only when enabled, ZCode
 *      forces it back to stock even if a copied config enables it;
 *   D  panel: the 组件 tab, the control ids and the POST contract exist, and
 *      the tab is removed at runtime on non-WorkBuddy clients.
 *
 * Run: npx tsx test/t28-component-look.ts
 */
import { buildPayload, DEFAULT_CONFIG, type BeautifyConfig } from "../src/core/inject.js";
import { DEFAULT_COMPONENT_LOOK, normalizeComponentLook, workbuddyComponentCss } from "../src/core/componentLook.js";
import { buildPanelScript } from "../src/panel/panelScript.js";
import { setTarget } from "../src/core/target.js";
import { themeFromSourceColor, argbFromRgb } from "@material/material-color-utilities";
import type { WallpaperAssets } from "../src/core/monet.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}

const theme = themeFromSourceColor(argbFromRgb(42, 96, 153));
const assets: WallpaperAssets = {
  dataUri: "data:image/jpeg;base64,AAAA",
  sourceArgb: argbFromRgb(42, 96, 153),
  theme,
  focus: { fit: "cover", x: 0.5, y: 0.5 },
};
const base: BeautifyConfig = { ...DEFAULT_CONFIG, monet: true, wallpaperVisible: true };

// --- A: normalization ---------------------------------------------------------
{
  const d = normalizeComponentLook(undefined);
  check("default is off", d.enabled === false);
  check("defaults are the stock values", JSON.stringify(d) === JSON.stringify(DEFAULT_COMPONENT_LOOK));

  const clamped = normalizeComponentLook({
    enabled: true,
    sidebarTone: 400,
    menubarText: -5,
    composerTone: -20,
    composerBorder: 500,
    composerRadius: 2,
    toolRadius: 99,
    controlRadius: -3,
    modalRadius: 1,
    syncCrTokens: false,
  });
  check("percentages clamp to 0-100", clamped.sidebarTone === 100 && clamped.composerTone === 0 && clamped.composerBorder === 100);
  check("menubar floor is 20", clamped.menubarText === 20);
  check("radii clamp to their ranges", clamped.composerRadius === 8 && clamped.toolRadius === 20 && clamped.controlRadius === 0 && clamped.modalRadius === 8);
  check("sync toggle honours an explicit false", clamped.syncCrTokens === false);
  check("enabled requires strict true", normalizeComponentLook({ enabled: "yes" as unknown as boolean }).enabled === false);
  check("garbage numbers fall back", normalizeComponentLook({ sidebarTone: NaN }).sidebarTone === DEFAULT_COMPONENT_LOOK.sidebarTone);
}

// --- B: CSS builder -----------------------------------------------------------
{
  check("disabled look emits nothing", workbuddyComponentCss(normalizeComponentLook({ enabled: false })) === "");

  const css = workbuddyComponentCss(normalizeComponentLook({
    enabled: true,
    sidebarTone: 61,
    menubarText: 84,
    composerTone: 47,
    composerBorder: 33,
    composerRadius: 19,
    toolRadius: 11,
    controlRadius: 7,
    modalRadius: 21,
    syncCrTokens: true,
  }));
  check("sidebar surface is mixed from the design token", css.includes(".conversation-list") && css.includes("--wb-bg-secondary) 61%"));
  check("menubar labels follow the text token", css.includes(".menubar-menu-title") && css.includes("--wb-color-text-primary) 84%"));
  check("composer shell is overridden", css.includes(".cr-input-container") && css.includes("--wb-bg-card) 47%") && css.includes("--wb-border-strong) 33%"));
  check("composer radius is applied", css.includes("border-radius: 19px"));
  check("tool cards get their radius", css.includes(".assistant-message-tool") && css.includes("border-radius: 11px"));
  check("control radius overrides both md and lg", css.includes("--wb-radius-md: 7px") && css.includes("--wb-radius-lg: 7px"));
  check("modal radius is overridden", css.includes("--wb-modal-radius: 21px"));
  check("conversation tokens are bridged", css.includes("--cr-text-primary: var(--wb-color-text-primary)") && css.includes("--cr-internal-text-primary"));
  check("bridge only when enabled", workbuddyComponentCss(normalizeComponentLook({ enabled: true, syncCrTokens: false })).includes("--cr-text-primary") === false);

  // Theme-safety: every color must come from a token, never a literal.
  const colorDecls = css.split("\n").filter((l) => /(^|\s)(color|background-color|border-color)\s*:/.test(l));
  check("no literal hex colors", !colorDecls.some((l) => /#[0-9a-f]{3,8}\b/i.test(l)), colorDecls.find((l) => /#[0-9a-f]{3,8}\b/i.test(l)) ?? "");
  check("no rgb()/hsl() literals", !colorDecls.some((l) => /\brgba?\(|\bhsla?\(/i.test(l)));
}

// --- C: injection pipeline ----------------------------------------------------
{
  setTarget("workbuddy");
  const off = buildPayload(base, assets);
  check("off by default: no component sheet", !off.css.includes(".conversation-list {"));
  check("payload still reports the normalized look", off.componentLook.enabled === false);

  const on = buildPayload({ ...base, componentLook: { enabled: true, composerRadius: 30 } }, assets);
  check("enabled: shell override reaches the payload", on.css.includes(".cr-input-container") && on.css.includes("border-radius: 30px"));
  check("enabled: bridge reaches the payload", on.css.includes("--cr-text-primary: var(--wb-color-text-primary)"));
  check("component rules come after the token block", on.css.indexOf("--wb-color-text-primary:") < on.css.indexOf(".conversation-list {"));
  check("payload echoes the live values", on.componentLook.composerRadius === 30 && on.componentLook.enabled === true);

  setTarget("zcode");
  const zc = buildPayload({ ...base, componentLook: { enabled: true } }, assets);
  check("ZCode never receives the WorkBuddy sheet", !zc.css.includes(".conversation-list {") && !zc.css.includes("--cr-text-primary"));
  check("ZCode payload reports it as off", zc.componentLook.enabled === false);
}

// --- D: panel contract --------------------------------------------------------
{
  const wbScript = buildPanelScript(9334, "t28", false, { appName: "WorkBuddy", chatUi: false });
  for (const id of [
    "zb-cp-on", "zb-cp-sidebar", "zb-cp-menubar", "zb-cp-composer-radius", "zb-cp-composer-tone",
    "zb-cp-composer-border", "zb-cp-tool-radius", "zb-cp-cr-sync", "zb-cp-control-radius", "zb-cp-modal-radius",
  ]) {
    check(`panel carries control ${id}`, wbScript.includes(`id="${id}"`));
  }
  check("panel carries the 组件 tab", wbScript.includes('data-tab="components"'));
  check("panel posts the componentLook contract", wbScript.includes("componentLook: componentUIState()"));
  check("master switch disables the sliders", wbScript.includes("cpSetEnabled"));
  check("WorkBuddy script selects the WB probe", wbScript.includes(`var PROBE = "workbuddy-skeleton"`));

  const zcScript = buildPanelScript(9223, "t28", false);
  check("ZCode script still removes the tab at runtime", zcScript.includes('querySelector(\'.zb-tab[data-tab="components"]\')'));
  check("ZCode does not bind the component controls", zcScript.includes("if (IS_WB) {"));
}

console.log(failed ? `T28: ${failed} check(s) FAILED` : "T28: all checks passed");
process.exit(failed ? 1 : 0);
