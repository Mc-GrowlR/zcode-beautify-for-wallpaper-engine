/**
 * T15 LIVE chat-width E2E (消息流宽度): drives the real serve /api/config
 * route — exactly what the panel's 消息流宽度 gear sends — and measures the
 * rendered conversation column in the live ZCode via CDP.
 *
 * Not part of `npm test` (needs a running ZCode + serve):
 *   npx tsx test/t15-chat-width-live.mjs
 *
 * Expectations on a 1920px window (conversation container ~1629px):
 *   stock 0/0 → 1152 · gear 84:12 → 1344 · gear 90:8 → 1440, all three
 *   aligned holders (messages ×2 + composer) moving together.
 */
import fs from "node:fs";

let failed = 0;
function check(label, cond, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}

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
const evalp = (expression) => send("Runtime.evaluate", { expression, returnByValue: true }).then((r) => r.result.value);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const widths = () =>
  evalp(`(() => {
    const els = [...document.querySelectorAll('[class*="conversation:max-w-6xl"]')];
    const uniq = [...new Set(els.map(e => Math.round(e.getBoundingClientRect().width)))];
    return JSON.stringify(uniq);
  })()`);

const cfg0 = await api("GET");
const masks = cfg0.chatLook ?? {};
const setWidth = async (cap, inset) => {
  await api("POST", { chatLook: { ...masks, widthCapRem: cap, widthInsetRem: inset } });
  await sleep(700);
};

try {
  const stock = JSON.parse(await widths());
  check(`stock width unique across holders (${stock})`, stock.length === 1);
  await setWidth(84, 12);
  let w = JSON.parse(await widths());
  check(`gear 84:12 widens+aligns (${w})`, w.length === 1 && w[0] > stock[0]);
  await setWidth(90, 8);
  w = JSON.parse(await widths());
  check(`gear 90:8 widens further (${w})`, w.length === 1 && w[0] === 1440 || w[0] > stock[0]);
  const cfg1 = await api("GET");
  check("serve persists cap+inset", cfg1.chatLook.widthCapRem === 90 && cfg1.chatLook.widthInsetRem === 8);
  check("width rules mounted in the live style element",
    await evalp(`!!(document.getElementById('zcode-beautify-chatlook-style')?.textContent.includes('@container conversation'))`));
} finally {
  await setWidth(0, 0);
  const w = JSON.parse(await widths());
  check(`restored to stock (${w})`, w.length === 1);
  const cfgEnd = await api("GET");
  check("stored config back to stock", cfgEnd.chatLook.widthCapRem === 0 && cfgEnd.chatLook.widthInsetRem === 0);
}
ws.close();
console.log(failed ? `\nT15: ${failed} check(s) FAILED` : "\nT15: all checks passed");
process.exit(failed ? 1 : 0);
