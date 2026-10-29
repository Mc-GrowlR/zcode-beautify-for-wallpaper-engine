/**
 * T17 LIVE spinner-look E2E (运行中图标): drives the real serve routes the
 * panel uses — POST /api/spinner (upload), POST /api/config (mode/spin/size)
 * — and asserts the injected style element inside the live ZCode renderer
 * via CDP, then restores the original look.
 *
 * Not part of `npm test` (needs a running ZCode + serve 0.4.8+):
 *   node test/t17-spinner-live.mjs
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
const api = (path, body) =>
  fetch("http://127.0.0.1:9223" + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "X-Beautify-Token": TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

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

const styleInfo = () => evalp(`(() => {
  const st = document.getElementById('zcode-beautify-spinner-style');
  return JSON.stringify({ alive: Boolean(st), css: st ? st.textContent.slice(0, 900) : null });
})()`).then((s) => JSON.parse(s));

// --- baseline ----------------------------------------------------------------
const health = await (await fetch("http://127.0.0.1:9223/api/health")).json();
check("serve is 0.4.8+", Number(health.version.split(".")[2]) >= 8, health.version);

const cfg0 = await api("/api/config");
const original = cfg0.body.taskSpinnerLook ?? { mode: "default", image: "", spin: true, size: 16 };
console.log(`baseline: mode=${original.mode} image=${original.image || "(none)"} spin=${original.spin} size=${original.size}`);

// --- upload via /api/spinner (1x1 gif) ---------------------------------------
const GIF_1PX = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const up = await api("/api/spinner", { dataUri: "data:image/gif;base64," + GIF_1PX, name: "t17.gif" });
check("/api/spinner accepts the upload", up.status === 200 && up.body.ok === true, JSON.stringify(up.body).slice(0, 120));
check("upload flips mode to image with the stored path",
  up.body.taskSpinnerLook?.mode === "image" && /spinner\.gif$/i.test(up.body.taskSpinnerLook?.image ?? ""),
  up.body.taskSpinnerLook?.image);
check("publicConfig previews a media URL", /\/media\/lib\/spinner\.gif/.test(up.body.spinnerImageUrl ?? ""), up.body.spinnerImageUrl);

const media = await fetch(up.body.spinnerImageUrl);
check("preview URL serves image/gif", media.status === 200 && (media.headers.get("content-type") || "").includes("image/gif"),
  `${media.status} ${media.headers.get("content-type")}`);
await media.arrayBuffer();

// --- renderer: style element applied -----------------------------------------
await sleep(700);
const on = await styleInfo();
check("renderer mounts the spinner style with the user image",
  on.alive && on.css.includes(up.body.spinnerImageUrl) && on.css.includes("color:transparent"), on.css?.slice(0, 120));
const spinKey = await evalp("window.__zcodeBeautify.spinnerKey");
check("renderer state tracks the spinner key",
  typeof spinKey === "string" && spinKey.includes('"image"'), String(spinKey).slice(0, 80));

// --- toggle off (mode default) removes the style ------------------------------
await api("/api/config", { taskSpinnerLook: { mode: "default", image: "", spin: true, size: 16 } });
await sleep(500);
const off = await styleInfo();
check("mode default removes the style element", !off.alive);

// --- toggle back on keeps working (fast path) ---------------------------------
await api("/api/config", { taskSpinnerLook: { mode: "image", image: up.body.taskSpinnerLook.image, spin: false, size: 20 } });
await sleep(500);
const re = await styleInfo();
check("re-enable applies again (fast path) with spin off + 20px",
  re.alive && re.css.includes("animation:none!important") && re.css.includes("width:20px!important"), re.css?.slice(0, 120));

// --- restore original look -----------------------------------------------------
await api("/api/config", { taskSpinnerLook: { ...original, mode: original.mode === "image" ? "image" : "default" } });
await sleep(400);
const fin = await styleInfo();
check("original look restored", original.mode === "image" ? fin.alive : !fin.alive);

console.log(failed === 0 ? "\nT17 all green" : `\nT17 ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
