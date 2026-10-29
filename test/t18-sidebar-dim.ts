/**
 * T18 SIDEBAR DIM verification (侧边栏压暗): the 0.4.8 sidebar-only
 * darkening contracts —
 *   A  buildPayload injects the #sidebar scrim only when sidebarDim > 0,
 *      with the var indirection (--zb-sidebar-dim) and !important;
 *   B  sidebarDim = 0 / absent injects nothing (stock sidebar);
 *   C  baseConfig merge: opts win over stored, stored wins over the default 0
 *      (MCP apply_options partial-patch path);
 *   D  DEFAULT_CONFIG carries sidebarDim 0 so old configs stay stock.
 *
 * No mocks and no running ZCode needed.
 *
 * Run: npx tsx test/t18-sidebar-dim.ts
 */
import { buildPayload, DEFAULT_CONFIG, type BeautifyConfig } from "../src/core/inject.js";
import { baseConfig } from "../src/core/session.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}

const base: BeautifyConfig = { ...DEFAULT_CONFIG, monet: false, wallpaperVisible: false };

// --- part A: scrim injected when on ----------------------------------------
{
  const css = buildPayload({ ...base, sidebarDim: 45 }).css;
  check("scrim rule present when sidebarDim = 45", css.includes("#sidebar"));
  check(
    "scrim uses the --zb-sidebar-dim var with 0.45 fallback",
    /#sidebar\s*{[^}]*var\(--zb-sidebar-dim,\s*0\.45\)/.test(css),
  );
  check("scrim is !important (desktop #sidebar paints nothing, we must win)", /#sidebar\s*{[^}]*!important/.test(css));
}

// --- part B: nothing injected when off -------------------------------------
{
  check("no #sidebar rule at sidebarDim 0", !buildPayload({ ...base, sidebarDim: 0 }).css.includes("#sidebar"));
  check("no #sidebar rule when absent (old configs)", !buildPayload({ ...base }).css.includes("#sidebar"));
}

// --- part C: baseConfig merge precedence -----------------------------------
{
  const merged = baseConfig({ sidebarDim: 30 }, { dim: 40, sidebarDim: 10 } as never);
  check("opts win: 30", merged.sidebarDim === 30, `got ${merged.sidebarDim}`);
  const kept = baseConfig({}, { dim: 40, sidebarDim: 10 } as never);
  check("stored wins when opts omit it: 10", kept.sidebarDim === 10, `got ${kept.sidebarDim}`);
  const fresh = baseConfig({}, {});
  check("default 0 when neither has it", fresh.sidebarDim === 0, `got ${fresh.sidebarDim}`);
  // The panel's push always posts the slider value; day/night only derives
  // dim/blur, so a schedule flip must not touch sidebarDim.
  const withLook = baseConfig({ sidebarDim: 25 }, { sidebarDim: 25 } as never);
  check("merge keeps the exact value", withLook.sidebarDim === 25);
}

// --- part D: default --------------------------------------------------------
check("DEFAULT_CONFIG.sidebarDim = 0 (stock out of the box)", DEFAULT_CONFIG.sidebarDim === 0);

console.log(failed === 0 ? "\nT18 all green" : `\nT18 FAILED (${failed})`);
process.exit(failed === 0 ? 0 : 1);
