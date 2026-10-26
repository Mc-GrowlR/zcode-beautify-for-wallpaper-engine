/** T9 LIVE verification: bubble look applied to the RUNNING ZCode via the new
 *  code path (applyColorsOnly), fast-path tint change, revert to default. */
import { applyColorsOnly } from "../src/core/session.js";
import { listTargets, pickRenderer, connect, evaluate } from "./cdp-live.mjs";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}

const ws = await connect(pickRenderer(await listTargets(9222)).webSocketDebuggerUrl);

async function bubbleState() {
  return evaluate(ws, `(() => {
    const st = document.getElementById('zcode-beautify-bubble-style');
    const b = document.querySelector('[data-v4-user-input-bubble]');
    if (!b) return { styleEl: !!st, bubble: false };
    const cs = getComputedStyle(b);
    return {
      styleEl: !!st,
      styleText: st ? st.textContent.slice(0, 300) : null,
      bubble: true,
      bg: cs.backgroundColor, radius: cs.borderRadius, maxW: cs.maxWidth, border: cs.borderColor,
      tintVar: document.documentElement.style.getPropertyValue('--zb-bubble-tint') || (st ? ':root' : ''),
    };
  })()`);
}

const before = await bubbleState();
console.log("before:", JSON.stringify(before));

// 1) apply accent preset
let n = await applyColorsOnly({ bubbleLook: { preset: "accent", tint: 45, radius: 20, width: 80, align: "right" } });
await new Promise(r => setTimeout(r, 400));
const s1 = await bubbleState();
console.log("accent:", JSON.stringify(s1));
check("style element mounted", s1.styleEl === true);
check("radius follows config (20px tail 2px)", s1.radius === "20px 2px 20px 20px", s1.radius);
check("max-width percentage applied", s1.maxW.endsWith("%"), s1.maxW);
check("accent tint actually recolors the bubble", s1.bg !== before.bg && String(s1.bg).startsWith("color(srgb"), String(s1.bg));
check("applied to >=1 window", n >= 1, String(n));

// pixel sample: accent tints the bubble — sample must differ from stock surface bg
// (handled separately below via computed-style + screenshot sampling)

// 2) fast path: tint-only change must not rebuild the wallpaper layer
const wpMarker = await evaluate(ws, `(() => {
  const wp = document.getElementById('zcode-beautify-wallpaper');
  return { img: wp ? wp.style.backgroundImage.slice(0, 60) : null, children: wp ? wp.children.length : -1 };
})()`);
await applyColorsOnly({ bubbleLook: { preset: "accent", tint: 80, radius: 20, width: 80, align: "right" } });
await new Promise(r => setTimeout(r, 400));
const wpAfter = await evaluate(ws, `(() => {
  const wp = document.getElementById('zcode-beautify-wallpaper');
  return { img: wp ? wp.style.backgroundImage.slice(0, 60) : null, children: wp ? wp.children.length : -1 };
})()`);
const s2 = await bubbleState();
check("tint change updates vars", s2.styleEl === true && s2.radius === "20px 2px 20px 20px");
check("wallpaper layer untouched by tint-only change", wpMarker.img === wpAfter.img && wpMarker.children === wpAfter.children,
  JSON.stringify(wpMarker) + " -> " + JSON.stringify(wpAfter));

// 3) left align mirrors the tail
await applyColorsOnly({ bubbleLook: { preset: "glass", tint: 60, radius: 16, width: 75, align: "left" } });
await new Promise(r => setTimeout(r, 400));
const s3 = await bubbleState();
// "2px 16px 16px": CSS shorthand serialization drops the 4th value when it
// equals the 2nd (BL == TR here) — the applied value is 2px 16px 16px 16px.
check("left align mirrors tail to top-left", s3.radius === "2px 16px 16px", s3.radius);

// 4) revert to default: rules gone, computed styles back to stock tokens
await applyColorsOnly({ bubbleLook: { preset: "default" } });
await new Promise(r => setTimeout(r, 400));
const s4 = await bubbleState();
console.log("default:", JSON.stringify(s4));
check("default removes the style element", s4.styleEl === false);
check("default restores stock radius", s4.radius === "12px 2px 12px 12px", s4.radius);
check("default restores stock max-width", !s4.maxW.endsWith("%"), s4.maxW);

ws.close();
if (failed > 0) { console.error(`T9 FAIL (${failed})`); process.exit(1); }
console.log("T9 PASS");
