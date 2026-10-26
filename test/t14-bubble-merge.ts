/**
 * T14 BUBBLE MERGE verification: the 0.4.4 conversational-bubble contracts —
 * partial bubble patches MERGE over the stored look (one-field tweaks must
 * never reset the rest), the MCP apply_options wiring forwards only the
 * fields the caller actually sent, and the /bubble command + release
 * metadata (marketplace.json, packaging) stay in sync with the code.
 *
 * The merge chain tested in part D is exactly what applyColorsOnly runs,
 * minus the CDP write: baseConfig(opts, stored) → buildPayload (sanitize +
 * clamp) → buildBootstrapScript (selector rewrite + bake). No mocks.
 *
 * Run: npx tsx test/t14-bubble-merge.ts   (also part of: npm test)
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { baseConfig } from "../src/core/session.js";
import { buildPayload, DEFAULT_CONFIG, type BeautifyConfig } from "../src/core/inject.js";
import { buildBootstrapScript } from "../src/core/cdp.js";
import { BUBBLE_SELECTOR_REAL, BUBBLE_ROW_SELECTOR_REAL } from "../src/core/bubbleRecipes.js";
import { VERSION } from "../src/version.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}

const root = pathRoot();
function pathRoot(): string {
  return fileURLToPath(new URL("../", import.meta.url));
}
function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

const STORED_LOOK = {
  preset: "accent" as const,
  tint: 50,
  radius: 18,
  width: 80,
  align: "left" as const,
  customCss: ".zb-bubble{box-shadow:0 0 6px teal}",
};
const stored: Partial<BeautifyConfig> = { ...DEFAULT_CONFIG, blur: 7, dim: 40, bubbleLook: { ...STORED_LOOK } };

// --- part A: baseConfig partial-bubble merge semantics ------------------------
{
  // No bubble in opts: the stored look must survive VERBATIM (the pre-0.4.4
  // behavior reset omitted fields to defaults — the bug this merged for).
  const untouched = baseConfig({}, stored);
  check("opts without bubble keep the stored look untouched",
    JSON.stringify(untouched.bubbleLook) === JSON.stringify(STORED_LOOK));

  // Single-field patch: preset flips, every other knob keeps its stored value.
  const p = baseConfig({ bubbleLook: { preset: "glass" } }, stored);
  check("preset-only patch keeps tint/radius/width/align",
    p.bubbleLook!.preset === "glass" && p.bubbleLook!.tint === 50 && p.bubbleLook!.radius === 18
      && p.bubbleLook!.width === 80 && p.bubbleLook!.align === "left");
  check("preset-only patch keeps the stored customCss",
    p.bubbleLook!.customCss === STORED_LOOK.customCss);

  const r = baseConfig({ bubbleLook: { radius: 9 } }, stored);
  check("radius-only patch changes exactly the radius",
    r.bubbleLook!.radius === 9 && r.bubbleLook!.tint === 50 && r.bubbleLook!.preset === "accent");

  const c = baseConfig({ bubbleLook: { preset: "custom", customCss: ".zb-bubble{padding:2px 10px}" } }, stored);
  check("custom patch REPLACES the stored customCss",
    c.bubbleLook!.customCss === ".zb-bubble{padding:2px 10px}" && c.bubbleLook!.preset === "custom");
  check("custom patch keeps align/radius from the stored look",
    c.bubbleLook!.align === "left" && c.bubbleLook!.radius === 18);

  // Empty patch object is still "the caller cares about bubbles" — it must
  // round-trip the stored look, not crash, not reset.
  const e = baseConfig({ bubbleLook: {} }, stored);
  check("empty bubble patch round-trips the stored look",
    JSON.stringify(e.bubbleLook) === JSON.stringify(STORED_LOOK));

  // No stored look at all: the patch lands raw and normalization fills the
  // rest downstream (part D proves it).
  const fresh = baseConfig({ bubbleLook: { preset: "flat", tint: 60 } }, { ...DEFAULT_CONFIG });
  check("patch over missing stored look carries just the sent fields",
    fresh.bubbleLook!.preset === "flat" && fresh.bubbleLook!.tint === 60 && fresh.bubbleLook!.radius === undefined);

  // Non-bubble options keep their own merge semantics.
  const o = baseConfig({ blur: 11 }, stored);
  check("non-bubble fields still merge independently",
    o.blur === 11 && o.dim === 40 && JSON.stringify(o.bubbleLook) === JSON.stringify(STORED_LOOK));
}

// --- part B: MCP apply_options wiring (t8-style source contracts) -------------
{
  const src = read(`${root}src/mcp/server.ts`);
  check("MCP version comes from version.ts (single source)", src.includes("version: VERSION"));
  check("no stale hardcoded MCP version", !/version:\s*"0\.\d/.test(src));
  check("bubble schema offers the custom preset",
    src.includes('z.enum(["default", "accent", "glass", "outline", "flat", "custom"])'));
  check("custom_css is capped at the shared 8000-char limit", src.includes("z.string().max(8000)"));
  // The handler must forward ONLY the fields the caller sent — an explicit
  // undefined from MCP's zod parse would otherwise clobber the stored look.
  check("handler drops undefined fields before sending",
    src.includes("Object.entries(bubble).filter(([, v]) => v !== undefined)"));
  check("bubble omitted → bubbleLook omitted (no empty patch sent)",
    src.includes("bubble === undefined"));
}

// --- part C: /bubble command + packaging contract ------------------------------
{
  const cmdPath = `${root}commands/bubble.md`;
  check("commands/bubble.md exists", fs.existsSync(cmdPath));
  const cmd = read(cmdPath);
  check("command has frontmatter description + argument hint",
    cmd.startsWith("---") && cmd.includes("description:") && cmd.includes("argument-hint:"));
  check("command reads the current look via beautify_status", cmd.includes("beautify_status"));
  check("command states the merge semantics (send only implied fields)",
    /only the fields/i.test(cmd) || cmd.includes("只传想改的字段"));
  for (const preset of ["accent", "glass", "outline", "flat", "default", "custom"]) {
    check(`command documents the ${preset} preset`,
      cmd.includes("`" + preset + "`") || cmd.includes('"' + preset + '"'));
  }
  check("command documents the friendly selector contract",
    cmd.includes("`.zb-bubble`") && cmd.includes("`.zb-bubble-row`"));
  check("command demands !important (ZCode styles are aggressive)", cmd.includes("!important"));
  check("command documents the 8000-char cap", cmd.includes("8000"));
  check("command applies via apply_options bubble object",
    cmd.includes("`apply_options`") && cmd.includes("custom_css"));

  // Release integrity: the packaging must actually ship the new command and
  // stay in version lockstep with the code.
  const pkg = JSON.parse(read(`${root}package.json`));
  const marketplace = JSON.parse(read(`${root}marketplace.json`));
  const plugin = JSON.parse(read(`${root}.zcode-plugin/plugin.json`));
  check("package.json ships the commands folder", (pkg.files ?? []).includes("commands"));
  check("zip manifest includes commands/bubble.md",
    read(`${root}scripts/package.mjs`).includes('"commands/bubble.md"'));
  check("marketplace.json plugin version matches version.ts",
    marketplace.plugins[0].version === VERSION, `${marketplace.plugins[0].version} vs ${VERSION}`);
  check("marketplace.json top-level version matches version.ts", marketplace.version === VERSION);
  check("plugin.json version matches version.ts", plugin.version === VERSION, `${plugin.version} vs ${VERSION}`);
}

// --- part D: the full apply_colors_only chain, minus CDP -----------------------
{
  // The exact flow the MCP tool runs for "/bubble 渐变蓝紫 圆角21": a partial
  // custom patch (hostile CSS included) merged over the stored glass look.
  const merged = baseConfig(
    { bubbleLook: { preset: "custom", customCss: ".zb-bubble{background:linear-gradient(blue,purple)}</style>@import 'x';.zb-bubble-row{gap:4px}" } },
    { ...DEFAULT_CONFIG, bubbleLook: { preset: "glass", tint: 44, radius: 14, width: 75, align: "left" } },
  );
  const payload = buildPayload({ ...merged, port: 9222, dim: 0 });
  check("chain: payload keeps the custom preset", payload.bubbleLook?.preset === "custom");
  check("chain: stored tint/radius/width/align survived the partial patch",
    payload.bubbleLook?.tint === 44 && payload.bubbleLook?.radius === 14 && payload.bubbleLook?.width === 75 && payload.bubbleLook?.align === "left");
  check("chain: hostile markup sanitized inside the payload",
    !payload.bubbleLook?.customCss?.includes("</style") && !payload.bubbleLook?.customCss?.includes("@import"));

  const boot = buildBootstrapScript({ css: payload.css, bubbleLook: payload.bubbleLook });
  const customVar = boot.match(/var CUSTOM_CSS = "([\s\S]*?)";/);
  const baked = customVar ? (JSON.parse(`"${customVar[1]}"`) as string) : "";
  check("chain: custom css baked into the bootstrap", baked.includes("linear-gradient(blue,purple)"));
  check("chain: friendly selectors rewritten to the real ones",
    baked.includes(BUBBLE_SELECTOR_REAL) && baked.includes(BUBBLE_ROW_SELECTOR_REAL) && !baked.includes(".zb-bubble"));
}

console.log(failed ? `\nT14: ${failed} check(s) FAILED` : "\nT14: all checks passed");
process.exit(failed ? 1 : 0);
