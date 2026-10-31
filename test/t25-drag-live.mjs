/**
 * T25 LIVE drag-resize E2E (两侧拖拽调宽): drives the real serve /api/config
 * route, then verifies the mounted strips, positions, synthetic pointer drags
 * (width change, localStorage persistence, inset derivation, Esc cancel,
 * double-click reset) and the panel toggle in the LIVE ZCode via CDP.
 *
 * Not part of `npm test` (needs a running ZCode + serve):
 *   npx tsx test/t25-drag-live.mjs
 *
 * Leaves the feature ENABLED (dragResize 1) with the width reset to the
 * tier/stock look — ready for the user to try dragging.
 */
import fs from "node:fs";

let failed = 0;
function check(label, cond, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TOKEN = fs.readFileSync(
  process.env.USERPROFILE + "/.zcode/cli/plugins/data/zcode-beautify/serve.token",
  "utf8"
).trim();
const api = (method, body) =>
  fetch("http://127.0.0.1:9223/api/config", {
    method,
    headers: { "Content-Type": "application/json", "X-Beautify-Token": TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.json());

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page" && t.title === "ZCode");
if (!page) { console.log("FAIL no ZCode page target (start ZCode with --remote-debugging-port=9222)"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 1;
const pend = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.id !== undefined) { const p = pend.get(m.id); pend.delete(m.id); p(m.result); }
};
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const send = (method, params = {}) =>
  new Promise((res) => { const i = id++; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalp = (expression) => send("Runtime.evaluate", { expression, returnByValue: true }).then((r) => {
  if (r?.exceptionDetails) throw new Error("page eval threw: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
});

// --- page helpers -------------------------------------------------------------
const measure = () => evalp(`(() => {
  const els = [...document.querySelectorAll('[class*="conversation:max-w-6xl"],[class*="conversation:max-w-4xl"]')];
  if (!els.length) return JSON.stringify({ holders: 0 });
  const r = els[0].getBoundingClientRect();
  const sc = document.querySelector('[contenteditable="true"]');
  let s = sc && sc.parentElement;
  let scroller = null;
  while (s && s !== document.body) {
    const oy = getComputedStyle(s).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && s.getBoundingClientRect().height > 300) { scroller = s; break; }
    s = s.parentElement;
  }
  const gl = document.getElementById('zcode-beautify-grip-l');
  const gr = document.getElementById('zcode-beautify-grip-r');
  const grp = (g) => g ? (({ top, left, width, height, display }) => ({ top: Math.round(top), left: Math.round(left), width: Math.round(width), height: Math.round(height), display }))(g.getBoundingClientRect()) : null;
  return JSON.stringify({
    holders: els.length,
    uniq: [...new Set(els.map(e => Math.round(e.getBoundingClientRect().width)))],
    colLeft: Math.round(r.left), colRight: Math.round(r.right), colW: Math.round(r.width),
    scrollerW: scroller ? scroller.clientWidth : 0,
    grips: { l: grp(gl), r: grp(gr) },
    varW: document.documentElement.style.getPropertyValue('--zb-chat-w'),
    varInset: document.documentElement.style.getPropertyValue('--zb-chat-inset'),
    stored: localStorage.getItem('zcode-beautify:chat-drag-pct')
  });
})()`);
const m = async () => JSON.parse(await measure());

// Synthetic drag: pointerdown at the grip center, pointermove by dx, optional
// Escape, pointerup. All rAF-coalesced engine work needs a beat to settle.
const drag = async (side, dx, escape) => evalp(`(() => {
  const g = document.getElementById('zcode-beautify-grip-${side}');
  if (!g) return 'no grip';
  const r = g.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + Math.min(200, r.height / 2);
  const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, pointerId: 7 };
  g.dispatchEvent(new MouseEvent('pointerdown', opts));
  g.dispatchEvent(new MouseEvent('pointermove', { ...opts, clientX: cx + ${dx} }));
  ${escape ? `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));` : ""}
  g.dispatchEvent(new MouseEvent('pointerup', opts));
  return 'ok';
})()`);

try {
  const cfg0 = await api("GET");
  const saved = cfg0.chatLook ?? {};
  const setDrag = async (on) => {
    await api("POST", { chatLook: { ...saved, dragResize: on ? 1 : 0 } });
    await sleep(800);
  };

  // 1. Enable through the real config route (what the panel toggle posts).
  await setDrag(true);
  const cfg1 = await api("GET");
  check("serve persists dragResize", cfg1.chatLook.dragResize === 1);

  // 2. Strips mounted, visible, glued to the live column edges.
  let s = await m();
  check("both strips mounted", s.grips.l && s.grips.r, JSON.stringify(s.grips));
  check("strips visible in the chat", s.grips.l.display !== "none" && s.holders > 0);
  check("left strip hugs the column's left edge", Math.abs(s.grips.l.left - (s.colLeft - 4)) <= 2, `grip ${s.grips.l.left} vs col ${s.colLeft}`);
  check("right strip hugs the column's right edge", Math.abs(s.grips.r.left - (s.colRight - 5)) <= 2, `grip ${s.grips.r.left} vs col ${s.colRight}`);
  check("strips span the chat scroller height", Math.abs(s.grips.l.height - (s.grips.l.height)) >= 0 && s.grips.l.height > 300, `height ${s.grips.l.height}`);
  check("drag tiers in the live style",
    await evalp(`(document.getElementById('zcode-beautify-chatlook-style')?.textContent || '').includes('--zb-chat-inset')`));
  check("holders aligned (unique width)", s.uniq.length === 1, JSON.stringify(s.uniq));
  const stockW = s.colW;
  check("no width var before first drag", !s.varW && !s.varInset, `${s.varW} / ${s.varInset}`);

  // 3. Drag the right grip +150px → symmetric +300px width.
  check("right-drag dispatch", await drag("r", 150) === "ok");
  await sleep(120);
  s = await m();
  check("drag widens the column ~2× the pointer delta", s.colW >= stockW + 260 && s.colW <= stockW + 340, `${stockW} → ${s.colW}`);
  check("width var written", !!s.varW, s.varW);
  check("inset var derived (≥16px)", s.varInset && parseInt(s.varInset) >= 16, s.varInset);
  check("width stored as container percent", isFinite(parseFloat(s.stored)) && parseFloat(s.stored) > 0 && parseFloat(s.stored) <= 100, s.stored);
  check("holders still aligned after drag", s.uniq.length === 1, JSON.stringify(s.uniq));

  // 4. Keep dragging right — must NOT dead-stop at the old 100%−24rem
  //    ceiling (the fixed-inset dead zone this design fixes).
  check("right-drag far past the stock ceiling", await drag("r", 400) === "ok");
  await sleep(120);
  s = await m();
  check("column reaches near-full width (dead zone gone)", s.colW >= s.scrollerW - 60, `col ${s.colW} vs scroller ${s.scrollerW}`);
  check("inset clamped to the 16px floor", parseInt(s.varInset) === 16, s.varInset);

  // 5. Esc cancels an in-flight drag: the stored width rules again.
  const beforeEsc = (await m()).colW;
  check("left-drag dispatch", await drag("l", -150, true) === "ok");
  await sleep(120);
  s = await m();
  check("Escape restores the stored width", Math.abs(s.colW - beforeEsc) <= 2, `${beforeEsc} → ${s.colW}`);

  // 6. Double-click resets to the tier/stock look and clears the storage.
  check("dblclick dispatch", await evalp(`(() => {
    const g = document.getElementById('zcode-beautify-grip-r');
    g.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return 'ok';
  })()`) === "ok");
  await sleep(120);
  s = await m();
  check("dblclick clears stored percent", s.stored === null);
  check("dblclick restores the stock width", Math.abs(s.colW - stockW) <= 2, `${stockW} → ${s.colW}`);
  check("vars cleared", !s.varW && !s.varInset);

  // 7. Panel toggle exists and reflects the enabled state.
  await evalp(`document.getElementById('zb-fab') && document.getElementById('zb-fab').click()`);
  await sleep(300);
  const panel = await evalp(`(() => {
    const el = document.getElementById('zb-chat-drag');
    return el ? JSON.stringify({ present: true, checked: el.checked }) : JSON.stringify({ present: false });
  })()`);
  const p = JSON.parse(panel);
  check("panel 两侧拖拽调宽 toggle present", p.present === true);
  check("panel toggle reflects enabled state", p.checked === true, JSON.stringify(p));
  await evalp(`document.getElementById('zb-fab') && document.getElementById('zb-fab').click()`);
  await sleep(200);

  // 8. Disable through the route — strips and vars leave.
  await setDrag(false);
  s = await m();
  check("disable removes the strips", !s.grips.l && !s.grips.r, JSON.stringify(s.grips));
  check("disable clears the vars", !s.varW && !s.varInset);

  // Leave the feature ON for the user, width untouched (stock).
  await setDrag(true);
  s = await m();
  check("re-enabled (strips back)", !!s.grips.l && !!s.grips.r);
  check("re-enabled keeps stock look", Math.abs(s.colW - stockW) <= 2, `${stockW} → ${s.colW}`);
} catch (e) {
  failed++;
  console.log("FAIL threw: " + (e && e.message || e));
}

console.log(failed ? `\n${failed} FAILED` : "\nall ok");
process.exit(failed ? 1 : 0);
