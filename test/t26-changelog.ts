/**
 * T26 CHANGELOG verification (关于页「更新日志」): the 0.5.1 about-page
 * changelog contracts —
 *   A  static: serve route + readChangelog resolution, panel wiring (button,
 *      modal ids, apiFetch, Esc), CHANGES.md shipped (package.mjs list),
 *      CHANGES.md exists at the repo root;
 *   B  behavioral (jsdom, t11-style harness + mocked serve): the button opens
 *      the modal, the fixture markdown renders (sections/quote/list/inline),
 *      the running build's section carries the 当前版本 badge, injected HTML
 *      in the markdown stays escaped, a failed load shows an error and the
 *      next open retries, the loaded markdown is cached (no refetch), Esc
 *      and ✕/mask close;
 *   C  live serve (t13-style sandboxed boot): /api/changelog is token-gated
 *      and returns the real CHANGES.md with the running VERSION.
 *
 * Run: npx tsx test/t26-changelog.ts
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { buildPanelScript } from "../src/panel/panelScript.js";
import { VERSION } from "../src/version.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const read = (p: string) => fs.readFileSync(p, "utf8");
const server = read("src/core/server.ts");
const panel = read("src/panel/panelScript.ts");
const pack = read("scripts/package.mjs");
const changes = read("CHANGES.md");
const SCRIPT = buildPanelScript(9223, "t26-token", false);

// --- part A: static contract ---------------------------------------------------
{
  check("route registered for GET /api/changelog",
    server.includes('req.method === "GET"') && server.includes('"/api/changelog"'));
  check("readChangelog resolves dist bundle layout (one level up)",
    /path\.dirname\(fileURLToPath\(import\.meta\.url\)\)[\s\S]{0,120}path\.resolve\(here, "\.\."\)/.test(server));
  check("readChangelog also covers tsx dev layout (two levels up)",
    server.includes('path.resolve(here, "..", "..")'));
  check("result cached for the process lifetime", server.includes("changelogCache"));
  check("missing file degrades to ok:false, not a throw",
    /ok: false,\s*error: "missing"/.test(server));
  check("payload echoes the running version", /ok: true,\s*version: VERSION,\s*markdown/.test(server));
  check("CHANGES.md ships in the plugin zip", pack.includes('"CHANGES.md",'));
  check("CHANGES.md exists at the repo root", changes.includes(`## ${VERSION}`), `needs a ## ${VERSION} section`);
  for (const id of ["zb-ab-chlog", "zb-chlog-win", "zb-chlog-win-close", "zb-chlog-win-mask", "zb-chlog-body"]) {
    check(`panel HTML carries id ${id}`, panel.includes(`id="${id}"`));
    check(`panel JS references ${id}`, panel.includes(`'${id}'`));
  }
  check("button polls the serve endpoint", panel.includes("apiFetch('/api/changelog')"));
  check("markdown is escaped before tags are synthesized",
    /zbChlogInline[\s\S]{0,80}replace\(\/&\/g, '&amp;'\)/.test(panel) &&
    panel.indexOf("replace(/&/g, '&amp;')") < panel.indexOf("'<code>$1</code>'"));
  check("running version gets a badge", panel.includes("当前版本"));
  check("fetch failure cannot reopen a closed window",
    /then\(function \(d\) \{[\s\S]{0,200}if \(\$\('zb-chlog-win'\)\.hidden\) return;/.test(panel));
  check("Esc closes the changelog window",
    /'Escape' && !\$\('zb-chlog-win'\)\.hidden\) zbChlogClose\(\)/.test(panel));
  check("modal styled like the bubble editor (fixed overlay + card)",
    panel.includes("#zb-chlog-win { position: fixed;") && panel.includes("#zb-chlog-win-card {"));
}

// --- part B: behavioral (jsdom + mocked serve API) ------------------------------
// Fixture shaped like the real CHANGES.md: h1, lead blockquote, version h2s,
// bold lists, a nested sub-item, inline code, and an HTML-injection attempt.
const CHLOG = [
  "# CHANGES.md — 测试 changelog",
  "",
  "> 引导行一。",
  "> 引导行二，含 `code片段`。",
  "",
  `## ${VERSION} — 当前测试版本`,
  "",
  "> 节内引言,归属本节。",
  "",
  "- **要点一**：描述文本，含 `var(--x)` 行内码与 <img src=x onerror=alert(1)> 注入尝试。",
  "  - 子要点（缩进二级）。",
  "- 要点二：普通条目。",
  "",
  "## 9.9.9 — 未来版本",
  "",
  "- 未来要点。",
  "",
  "## 附注",
  "",
  "收尾说明段落。",
  "",
].join("\n");

type Call = { method: string; path: string };
const calls: Call[] = [];
let apiMode: "ok" | "down" = "down"; // start DOWN: the first open must hit the error path

function routeGet(pathname: string): unknown {
  if (pathname.startsWith("/api/config")) {
    return {
      blur: 7, dim: 25, monet: true, wallpaperVisible: true, kenBurns: false, videoVolume: 35, themeColor: null,
      dayNight: { enabled: false, start: "06:30", end: "18:30", dayDim: 20, nightDim: 55, dayBlur: 0, nightBlur: 6 },
      chatLook: { chatDim: 12, maskTop: 20, maskBottom: 10, frost: 5, widthCapRem: 0, widthInsetRem: 0, perfSmooth: 0 },
      bubbleLook: { preset: "glass", tint: 28, radius: 12, width: 70, align: "left", customCss: "" },
      startupClean: true, showOnUpdater: false, importRes: { mode: "auto" },
      fit: "cover", wallpaperSet: false, hasBackup: false, mediaType: "image", sceneHash: null, wallpaperPath: "",
    };
  }
  if (pathname.startsWith("/api/changelog")) return { ok: true, version: VERSION, markdown: CHLOG };
  if (pathname.startsWith("/api/health")) return { ok: true, service: "zcode-beautify", pid: 4242, version: VERSION, uptimeMs: 65_000, cdpPort: 9222 };
  if (pathname.startsWith("/api/history")) return { items: [] };
  if (pathname.startsWith("/api/library")) return { scenes: [], images: [] };
  if (pathname.startsWith("/api/rotation")) return { rotation: { plans: [], activePlanId: null, enabled: false } };
  if (pathname.startsWith("/api/rotation-state")) return { on: false };
  if (pathname.startsWith("/api/storage")) return { scenesBytes: 0, thumbsBytes: 0 };
  if (pathname.startsWith("/api/palette")) return { colors: [], pinned: false };
  return {};
}

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://zb.test/",
  pretendToBeVisual: true,
  runScripts: "outside-only",
  virtualConsole: new VirtualConsole(),
});
const w = dom.window as unknown as {
  fetch: unknown; eval: (s: string) => unknown; localStorage: Storage;
  clearInterval: (id: number) => void; Event: typeof Event; KeyboardEvent: typeof KeyboardEvent;
  __zbTimers?: number[]; document: Document;
};
w.fetch = (input: unknown, init?: { method?: string }) => {
  const pathname = String(input).replace(/^https?:\/\/[^/]+/, "");
  calls.push({ method: init?.method || "GET", path: pathname });
  if (apiMode === "down") return Promise.reject(new Error("service down"));
  return Promise.resolve({ ok: true, json: async () => routeGet(pathname) });
};
w.eval(SCRIPT);
await sleep(150);

const doc = w.document;
const $id = (id: string) => doc.getElementById(id)!;
const tabButton = (label: string) =>
  Array.from(doc.querySelectorAll<HTMLElement>(".zb-tab")).find((b) => (b.textContent || "").includes(label))!;

$id("zb-fab").click();
await sleep(80);
for (const t of w.__zbTimers ?? []) w.clearInterval(t);
w.__zbTimers = [];
tabButton("关于").click();
await sleep(60);
check("about pane shows the changelog row", $id("zb-tab-about").textContent!.includes("更新日志"));

// 1st open with serve DOWN → error note, modal stays open
$id("zb-ab-chlog").click();
await sleep(60);
check("button opens the modal", !$id("zb-chlog-win").hidden);
check("failed load shows the error note",
  $id("zb-chlog-body").textContent!.includes("无法读取更新日志"), $id("zb-chlog-body").textContent!.slice(0, 40));
check("markdown endpoint was fetched exactly once so far",
  calls.filter((c) => c.path.startsWith("/api/changelog")).length === 1);

// serve comes back → closing and reopening retries and renders
apiMode = "ok";
$id("zb-chlog-win-close").click();
await sleep(20);
check("✕ closes the modal", $id("zb-chlog-win").hidden);
$id("zb-ab-chlog").click();
await sleep(60);
check("reopen retries the fetch", calls.filter((c) => c.path.startsWith("/api/changelog")).length === 2);
const body = $id("zb-chlog-body");
check("markdown rendered into the body", body.querySelectorAll(".zb-chlog-md, h2").length > 0 && body.querySelector("blockquote") !== null,
  `h2=${body.querySelectorAll("h2").length}`);
check("version sections rendered as h2", body.querySelectorAll("h2").length === 3,
  String(body.querySelectorAll("h2").length));
check("non-version h2 renders as plain sub-heading (no literal ##)",
  body.querySelector("h2.zb-chlog-h2p") !== null &&
  (body.querySelector("h2.zb-chlog-h2p")!.textContent || "") === "附注");
// The file's h1 becomes the tail line — it must come AFTER all sections.
const tail = body.querySelector(".zb-chlog-tail");
check("h1 rendered as the muted tail line", tail !== null && (tail.textContent || "").includes("CHANGES.md"));
check("tail sits at the very end of the content", tail !== null && body.lastElementChild === tail);
check("running build's section carries the badge", !!body.querySelector(".zb-chlog-cur"));
const badged = body.querySelector(".zb-chlog-cur")!.closest("h2")!.textContent!;
check("badge sits on the running version", badged.includes(VERSION) && badged.includes("当前版本"), badged.slice(0, 30));
check("other sections are NOT badged", body.querySelectorAll(".zb-chlog-cur").length === 1);
const leadQuote = Array.from(body.querySelectorAll("blockquote")).find((b) => (b.textContent || "").includes("引导行二"));
check("lead summary blockquote rendered", leadQuote !== undefined);
check("content STARTS with the newest version section",
  body.firstElementChild !== null && body.firstElementChild.tagName === "H2" &&
  (body.firstElementChild.textContent || "").includes(VERSION));
{
  // Lead summary + tail are stashed to the end; section-internal quotes
  // (节内引言) must stay inside their section.
  const kids = Array.from(body.children);
  const tail = body.querySelector(".zb-chlog-tail");
  check("lead summary moved to the very end", leadQuote !== undefined && tail !== null &&
    kids.indexOf(leadQuote!) === kids.length - 2 && kids.indexOf(tail!) === kids.length - 1,
    `lead@${leadQuote ? kids.indexOf(leadQuote) : -1}/${kids.length}`);
  const secQuote = Array.from(body.querySelectorAll("blockquote")).find((b) => (b.textContent || "").includes("节内引言"));
  const h999 = Array.from(body.querySelectorAll("h2")).find((h) => (h.textContent || "").includes("9.9.9"));
  check("section-internal quote stays inside its section", secQuote !== undefined && h999 !== undefined &&
    // Node.DOCUMENT_POSITION_FOLLOWING === 4 (no DOM globals in plain node)
    !!(secQuote!.compareDocumentPosition(h999!) & 4));
  const lastH2 = Array.from(body.querySelectorAll("h2")).at(-1)!;
  check("no section content after the appended summary",
    leadQuote !== undefined && kids.indexOf(lastH2) < kids.indexOf(leadQuote!));
}
check("list items rendered incl. the nested sub-item",
  body.querySelectorAll("li").length === 4 && body.querySelectorAll("li.zb-chlog-li2").length === 1);
check("inline code rendered", Array.from(body.querySelectorAll("code")).some((c) => (c.textContent || "").includes("code片段")),
  String(body.querySelectorAll("code").length) + " code els");
check("injected HTML stays escaped (no element created)", body.querySelector("img, script") === null &&
  body.textContent!.includes("<img src=x onerror=alert(1)>"));
check("scroll-to-current ran without crashing", typeof body.scrollTop === "number" && body.scrollTop >= 0);

// cached: close/reopen must not refetch
$id("zb-chlog-win-close").click();
$id("zb-ab-chlog").click();
await sleep(40);
check("reopening uses the cache (no refetch)", calls.filter((c) => c.path.startsWith("/api/changelog")).length === 2);
check("content still there after cache reopen", body.querySelector("h2") !== null);

// Esc + mask close
doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
await sleep(20);
check("Esc closes the modal", $id("zb-chlog-win").hidden);
$id("zb-ab-chlog").click();
await sleep(20);
$id("zb-chlog-win-mask").click();
await sleep(20);
check("mask click closes the modal", $id("zb-chlog-win").hidden);

// --- part C: live serve endpoint (sandboxed boot, t13 pattern) ------------------
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zb-t26-"));
  function freePort(): Promise<number> {
    return new Promise((res) => {
      const s = net.createServer();
      s.listen(0, "127.0.0.1", () => {
        const p = (s.address() as net.AddressInfo).port;
        s.close(() => res(p));
      });
    });
  }
  const cdpPort = await freePort();
  const apiPort = await freePort();
  const base = `http://127.0.0.1:${apiPort}`;
  const child = spawn(
    process.execPath,
    [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), "src/cli.ts", "serve", "--port", String(cdpPort), "--api-port", String(apiPort)],
    { cwd: root, env: { ...process.env, ZCODE_BEAUTIFY_DATA_DIR: tmp }, stdio: ["ignore", "pipe", "pipe"] },
  );
  let bootLog = "";
  child.stdout!.on("data", (d: Buffer) => { bootLog += d.toString(); });
  child.stderr!.on("data", (d: Buffer) => { bootLog += d.toString(); });
  let booted = false;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) { booted = true; break; }
    } catch { /* not up yet */ }
    await sleep(300);
  }
  check("sandboxed serve boots", booted, booted ? "" : `exit=${child.exitCode} log=${bootLog.slice(-200)}`);
  if (booted) {
    const unauth = await fetch(`${base}/api/changelog`);
    check("changelog without token is rejected", unauth.status === 401, String(unauth.status));
    const res = await fetch(`${base}/api/changelog`, { headers: { "X-Beautify-Token": fs.readFileSync(path.join(tmp, "serve.token"), "utf8").trim() } });
    const d = (await res.json()) as { ok: boolean; version?: string; markdown?: string; error?: string };
    check("changelog: ok with the running version", d.ok === true && d.version === VERSION, JSON.stringify(d).slice(0, 100));
    check("changelog: markdown is the real CHANGES.md",
      typeof d.markdown === "string" && d.markdown.includes(`## ${VERSION}`) && d.markdown.includes("两侧拖拽调宽"));
    check("changelog: markdown escapes nothing server-side (raw markdown, panel escapes)",
      typeof d.markdown === "string" && !d.markdown.includes("&lt;"));
  }
  child.kill();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* windows linger */ }
}

console.log(failed === 0 ? "\nT26 all green" : `\nT26 FAILED (${failed})`);
process.exit(failed === 0 ? 0 : 1);
