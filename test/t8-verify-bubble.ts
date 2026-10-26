/** T8 verification: user message bubble look (聊天气泡) end to end. */
import { buildPayload, DEFAULT_CONFIG, normalizeBubbleLook } from "../src/core/inject.js";
import { buildBootstrapScript, buildResetScript } from "../src/core/cdp.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}

// --- normalizeBubbleLook ------------------------------------------------------
const n0 = normalizeBubbleLook(undefined);
check("normalize defaults to preset default", n0.preset === "default" && n0.tint === 28 && n0.radius === 12 && n0.width === 70 && n0.align === "right");
const n1 = normalizeBubbleLook({ preset: "glass", tint: 300, radius: 0, width: 500, align: "left" });
check("normalize clamps out-of-range values", n1.tint === 100 && n1.radius === 4 && n1.width === 90, JSON.stringify(n1));
const n2 = normalizeBubbleLook({ preset: "nope" as never, align: "left" });
check("unknown preset degrades to default, align kept", n2.preset === "default" && n2.align === "left");
const n3 = normalizeBubbleLook({ preset: "accent", tint: Number.NaN });
check("NaN falls back to default value", n3.tint === 28);

// --- buildPayload passthrough -------------------------------------------------
const p0 = buildPayload(DEFAULT_CONFIG);
check("payload without config carries normalized default bubble", p0.bubbleLook?.preset === "default");
const p1 = buildPayload({ ...DEFAULT_CONFIG, bubbleLook: { preset: "accent", tint: 50, radius: 18, width: 80, align: "left" } });
check("payload passes bubble config through", p1.bubbleLook?.tint === 50 && p1.bubbleLook?.align === "left");

// --- bootstrap: rules, fast paths, reset --------------------------------------
// BUBBLE is double-JSON-encoded into the script source, so "preset":"accent"
// appears as {\"preset\":\"accent\"}.
const boot = buildBootstrapScript({ css: "x{}", bubbleLook: p1.bubbleLook });
check("bootstrap carries bubble payload", boot.includes('\\"preset\\":\\"accent\\"'));
check("rules target the v4 bubble attribute", boot.includes("[data-v4-user-input-bubble]"));
check("row alignment targets the named group word-match", boot.includes('[class~="group/user-row"]'));
check("radius tail mirrored for left align", boot.includes("'2px ' + r + 'px ' + r + 'px ' + r + 'px'"));
check("right align keeps tail top-right", boot.includes("r + 'px 2px ' + r + 'px ' + r + 'px'"));
check("rules color-mix the live tokens", boot.includes("color-mix(in srgb,var(--color-primary)"));
check("vars drive radius/maxw/align", boot.includes("--zb-bubble-radius") && boot.includes("--zb-bubble-maxw") && boot.includes("--zb-bubble-align"));
check("default preset removes the style element", boot.includes("B.preset === 'default'"));
check("bubble fast path guards on other state", boot.includes("window.__zcodeBeautify.bubbleKey !== BUBBLE"));
check("chat fast path respects bubble changes", /chatOnly = [^;]*bubbleKey === BUBBLE/.test(boot));
check("main no-op checks bubbleKey", /chatKey === CHAT && window\.__zcodeBeautify\.bubbleKey === BUBBLE/.test(boot));
check("main flow applies bubble look", /window\.__zcodeBeautify\.bubbleKey = BUBBLE;\s*applyBubbleLook\(\);/.test(boot));
check("all four presets have recipes", ["accent", "glass", "outline", "flat"].every((k) => boot.includes(k + ": ")));

const bootDefault = buildBootstrapScript({ css: "x{}" });
check("bootstrap without bubbleLook serializes default", bootDefault.includes('\\"preset\\":\\"default\\"'));

const reset = buildResetScript();
check("reset removes bubble style element", reset.includes("-bubble-style')?.remove()"));
check("reset clears bubbleKey", reset.includes("bubbleKey = null"));

// --- panel wiring -------------------------------------------------------------
const { buildPanelScript } = await import("../src/panel/panelScript.js");
const panel = buildPanelScript("9223", "tok", false) as unknown as string;
check("panel has bubble preset select", panel.includes('id="zb-bubble-preset"'));
check("panel has tint/radius/width sliders", ["zb-bubble-tint", "zb-bubble-radius", "zb-bubble-width"].every((id) => panel.includes(`id="${id}"`)));
check("panel has align toggle", panel.includes('id="zb-bubble-align"'));
check("panel pushes bubbleLook to serve", panel.includes("bubbleLook: bubbleUIState()"));
check("panel reads bubbleLook from config", panel.includes("setBubbleUI(c.bubbleLook"));
check("panel previews via inline vars", panel.includes("--zb-bubble-tint"));

if (failed > 0) { console.error(`T8 FAIL (${failed})`); process.exit(1); }
console.log("T8 PASS");
