/**
 * T23 WORKBUDDY TARGET verification: the same injection pipeline must produce
 * WorkBuddy's `--wb-*` design-token overrides instead of ZCode's `--color-*`
 * family, drop the chat-area extras the WorkBuddy DOM does not expose, and
 * re-brand the panel copy.
 *
 * Run: npx tsx test/t23-workbuddy-target.ts   (also part of: npm test)
 */
import { themeFromSourceColor, argbFromRgb } from "@material/material-color-utilities";
import { buildPayload, DEFAULT_CONFIG, type BeautifyConfig } from "../src/core/inject.js";
import type { WallpaperAssets } from "../src/core/monet.js";
import { buildBootstrapScript } from "../src/core/cdp.js";
import { buildPanelScript } from "../src/panel/panelScript.js";
import { setTarget } from "../src/core/target.js";

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

function config(extra: Partial<BeautifyConfig> = {}): BeautifyConfig {
  return { ...DEFAULT_CONFIG, monet: true, wallpaperVisible: true, sidebarDim: 20, ...extra };
}

// --- part A: WorkBuddy token family ------------------------------------------
{
  setTarget("workbuddy");
  const payload = buildPayload(config(), assets);

  check("surfaces go transparent so the wallpaper shows", payload.css.includes("--wb-bg-primary:transparent"));
  check("dark block targets data-theme", payload.css.includes('html[data-theme="dark"]'));
  check("light block targets data-theme", payload.css.includes('html[data-theme="light"]'));
  check("brand ramp is rebuilt from the wallpaper", payload.css.includes("--wb-palette-brand-8:"));
  check("text tokens are re-colored", payload.css.includes("--wb-color-text-primary:"));
  check("border tokens are re-colored", payload.css.includes("--wb-border-default:"));
  check("no ZCode token leaks into the WorkBuddy payload", !payload.css.includes("--color-background:"));
  check("no ZCode queue mask for WorkBuddy", !payload.css.includes('data-testid="v4-queue"'));
  check("sidebar dim uses WorkBuddy's sidebar anchor", payload.css.includes("[data-sidebar-motion]"));
  check("dim variable still drives the wallpaper scrim", payload.css.includes("--zcode-beautify-dim:"));

  // Chat extras must be forced to stock, not merely ignored.
  check("chat look forced to stock", JSON.stringify(payload.chatLook) === JSON.stringify({ chatDim: 0, maskTop: 0, maskBottom: 0, frost: 0, widthCapRem: 0, widthInsetRem: 0, perfSmooth: 0, hideElapsedDecimal: 0, dragResize: 0 }));
  check("bubble look forced to stock", payload.bubbleLook?.preset === "default");
  check("spinner look forced to stock", payload.taskSpinnerLook?.mode === "default");
  check("payload flags the chat UI as unavailable", payload.chatUi === false);
  check("payload selects the WorkBuddy startup probe", payload.startupProbe === "workbuddy-skeleton");

  const boot = buildBootstrapScript(payload);
  check("bootstrap bakes CHAT_UI=false", boot.includes("var CHAT_UI = false"));
  check("bootstrap bakes the WorkBuddy probe", boot.includes('var PROBE = "workbuddy-skeleton"'));
  check("bootstrap watches for the skeleton overlay", boot.includes("#sk-overlay, #skeleton-root"));

  const panel = buildPanelScript(9223, "tok", true, { appName: "WorkBuddy", chatUi: false, hasUpdater: false });
  check("panel copy is re-branded", panel.includes('var APP_NAME = "WorkBuddy"'));
  check("panel keeps no stale ZCode prose", !panel.includes("ZCode"));
  check("panel hides the chat tab", panel.includes("if (!CHAT_UI)"));
  check("panel bakes the WorkBuddy probe", panel.includes('var PROBE = "workbuddy-skeleton"'));
}

// --- part B: ZCode stays untouched -------------------------------------------
{
  setTarget("zcode");
  const payload = buildPayload(config(), assets);
  check("ZCode still gets --color-* tokens", payload.css.includes("--color-background:transparent"));
  check("ZCode keeps the queue mask", payload.css.includes('data-testid="v4-queue"'));
  check("ZCode keeps chat extras enabled", payload.chatUi === true);
  check("ZCode sidebar anchor is #sidebar", payload.css.includes("#sidebar {"));
  check("ZCode payload has no --wb-* tokens", !payload.css.includes("--wb-bg-primary"));

  const panel = buildPanelScript(9223, "", true);
  check("default panel copy stays ZCode", panel.includes('var APP_NAME = "ZCode"'));
}

// reset for any later tests in the same process
setTarget("zcode");

console.log(failed === 0 ? "\nT23 all green" : `\nT23: ${failed} check(s) FAILED`);
if (failed > 0) process.exitCode = 1;
