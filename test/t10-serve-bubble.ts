/** T10: production path — serve API push + panel section present. */
import { listTargets, pickRenderer, connect, evaluate } from "./cdp-live.mjs";
import { readFileSync } from "node:fs";

const token = readFileSync("C:/Users/Administrator/.zcode/cli/plugins/data/zcode-beautify/serve.token", "utf8").trim();
let failed = 0;
const check = (l, c, x = "") => { if (!c) failed++; console.log(`${c ? "ok  " : "FAIL"} ${l}${x ? ` (${x})` : ""}`); };

const post = async (body) =>
  (await fetch("http://127.0.0.1:9223/api/config", {
    method: "POST", headers: { "X-Beautify-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })).json();

const ws = await connect(pickRenderer(await listTargets(9222)).webSocketDebuggerUrl);

// 1) panel from the NEW serve carries the bubble section
const panel = await evaluate(ws, `(() => ({
  preset: !!document.getElementById('zb-bubble-preset'),
  tint: !!document.getElementById('zb-bubble-tint'),
  align: !!document.getElementById('zb-bubble-align'),
  panelRoot: !!document.querySelector('[id^="zb-panel"], #zb-panel, .zb-root, [class*="zb-panel"]'),
}))()`);
console.log("panel:", JSON.stringify(panel));
check("panel has bubble preset select", panel.preset);
check("panel has tint slider", panel.tint);
check("panel has align toggle", panel.align);

// 2) POST bubbleLook through the serve API
const r1 = await post({ bubbleLook: { preset: "glass", tint: 60, radius: 16, width: 70, align: "left" } });
console.log("POST:", JSON.stringify(r1).slice(0, 200));
await new Promise(r => setTimeout(r, 600));

const st = await evaluate(ws, `(() => {
  const st = document.getElementById('zcode-beautify-bubble-style');
  const b = document.querySelector('[data-v4-user-input-bubble]');
  return st && b ? { styleEl: true, bg: getComputedStyle(b).backgroundColor, radius: getComputedStyle(b).borderRadius,
    backdrop: getComputedStyle(b).backdropFilter, align: getComputedStyle(document.querySelector('[class~="group/user-row"]')).alignItems } : { styleEl: !!st };
})()`);
console.log("state:", JSON.stringify(st));
check("serve push mounts bubble style", st.styleEl === true);
check("glass preset applies backdrop blur", st.backdrop === "blur(8px)", String(st.backdrop));
check("left align via serve push", st.align === "flex-start", String(st.align));

// 3) sanitize rejects garbage
const r2 = await post({ bubbleLook: { preset: "hacker", tint: 9999 } });
const cfg = await (await fetch("http://127.0.0.1:9223/api/config", { headers: { "X-Beautify-Token": token } })).json();
check("sanitize degrades unknown preset, clamps tint", cfg.bubbleLook.preset === "default" && cfg.bubbleLook.tint === 100, JSON.stringify(cfg.bubbleLook));

// 4) restore default
const r3 = await post({ bubbleLook: { preset: "default" } });
await new Promise(r => setTimeout(r, 600));
const st2 = await evaluate(ws, `!!document.getElementById('zcode-beautify-bubble-style')`);
check("default removes style element again", st2 === false);

ws.close();
if (failed > 0) { console.error(`T10 FAIL (${failed})`); process.exit(1); }
console.log("T10 PASS");
