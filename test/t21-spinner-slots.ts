/**
 * T21 SPINNER TERMINAL SLOTS verification (完成标志/错误标志): the 0.4.8
 * follow-up letting the FINISHED-session indicators be replaced too —
 * ZCode's leading slot has four states (error > unread > loading > none);
 * the loader was already replaceable, the unread dot (完成有未读回复) and
 * the error dot now are as well.
 *   A  normalizeTaskSpinnerLook carries/clamps the two new refs;
 *   B  buildPayload resolves all three slots independently (terminal refs
 *      resolve even with mode "default");
 *   C  bootstrap: applySpinnerLook emits per-slot rules — data-unread-
 *      indicator / data-error-indicator (plain rows) plus the grouped-row
 *      dot-class fallbacks; all-empty removes the style element; mode
 *      default + terminal image keeps the style without loading rules;
 *   D  serve wiring: /api/spinner slot branch + per-slot fixed names +
 *      publicConfig preview URLs; MCP schema carries the two new paths.
 *
 * Run: npx tsx test/t21-spinner-slots.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTaskSpinnerLook, buildPayload, DEFAULT_CONFIG, type BeautifyConfig } from "../src/core/inject.js";
import { buildBootstrapScript } from "../src/core/cdp.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}
const root = fileURLToPath(new URL("../", import.meta.url));
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
process.env.ZCODE_BEAUTIFY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zb-t21-"));
const { dataDir } = await import("../src/core/launch.js");

const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

// --- part A: normalize -------------------------------------------------------
{
  const n = normalizeTaskSpinnerLook({ mode: "default", unreadImage: "  D:/icons/done.png  ", errorImage: "D:/icons/err.gif" });
  check("terminal refs trimmed and carried", n.unreadImage === "D:/icons/done.png" && n.errorImage === "D:/icons/err.gif", JSON.stringify(n));
  const d = normalizeTaskSpinnerLook({ mode: "image", image: "x" });
  check("absent terminal refs default to empty", d.unreadImage === "" && d.errorImage === "");
}

// --- part B: payload resolution ---------------------------------------------
{
  fs.mkdirSync(path.join(dataDir(), "spinner"), { recursive: true });
  fs.writeFileSync(path.join(dataDir(), "spinner", "spinner-unread.png"), PNG_1PX);
  fs.writeFileSync(path.join(dataDir(), "spinner", "spinner-error.gif"), PNG_1PX);
  const cfg: BeautifyConfig = {
    ...DEFAULT_CONFIG,
    monet: false,
    wallpaperVisible: false,
    taskSpinnerLook: { mode: "default", image: "", unreadImage: path.join(dataDir(), "spinner", "spinner-unread.png"), errorImage: path.join(dataDir(), "spinner", "spinner-error.gif"), spin: true, size: 16 },
  };
  const payload = buildPayload(cfg, undefined, "tok");
  const s = payload.taskSpinnerLook!;
  check("unread ref resolves to /media/spinner/", s.unreadImage === `http://127.0.0.1:9223/media/spinner/spinner-unread.png?t=tok`, String(s.unreadImage));
  check("error ref resolves to /media/spinner/", s.errorImage === `http://127.0.0.1:9223/media/spinner/spinner-error.gif?t=tok`, String(s.errorImage));
  check("terminal slots independent of mode default", s.mode === "default" && s.image === "");
}

// --- part C: bootstrap rules -------------------------------------------------
{
  const boot = buildBootstrapScript({
    css: "",
    wallpaperDataUri: undefined,
    fit: "cover",
    transition: "fade",
    taskSpinnerLook: { mode: "default", image: "", unreadImage: "http://x/u.png", errorImage: "http://x/e.png", spin: true, size: 14 },
  } as never);
  check("unread plain-row selector present", boot.includes('[data-unread-indicator="true"]'));
  check("error plain-row selector present", boot.includes('[data-error-indicator="true"]'));
  // RUNTIME-level selector check: the bootstrap source must carry a DOUBLE
  // backslash so the JS string literal decodes to a CSS escape (".5" alone is
  // an invalid class selector and the browser drops the whole rule — a
  // source-level contains() on a single backslash passed while the injected
  // rule silently died, caught live on 2026-10-29).
  check("grouped-row dot-class fallback escapes the digit (bootstrap source)", boot.includes("span.bg-sky-500.size-1\\\\.5") && boot.includes("span.bg-destructive.size-1\\\\.5"));
  check("dot rule clears background-color and paints image",
    boot.includes("background-color:transparent!important") && boot.includes("background-image:url("));
  check("removal gate covers all three slots", /!loadingOn && !unreadOn && !errorOn/.test(boot));

  // Execute the generated applySpinnerLook against a DOM stub and assert the
  // DECODED css text — the level the browser actually parses.
  const fnSrc = boot.match(/function applySpinnerLook[\s\S]*?\n  \}/);
  check("applySpinnerLook function found in bootstrap", Boolean(fnSrc));
  if (fnSrc) {
    const store = { textContent: "" };
    const fake = () => {
      const o = {};
      Object.defineProperty(o, "textContent", { get: () => store.textContent, set: (v: string) => { store.textContent = v; } });
      return o;
    };
    const existing = fake();
    const doc = { getElementById: () => existing, createElement: () => fake(), head: {} };
    const spinJson = JSON.stringify({ mode: "image", image: "http://x/s.png", unreadImage: "http://x/u.png", errorImage: "http://x/e.png", spin: true, size: 16 });
    const fn = new Function("SPIN", "MARKER", "document", fnSrc[0] + "\napplySpinnerLook();");
    fn(spinJson, "zcode-beautify", doc);
    check("decoded css escapes the digit class (browser-legal selector)", store.textContent.includes("span.bg-sky-500.size-1\\.5"), store.textContent.slice(-160));
    check("decoded css carries both terminal images",
      store.textContent.includes('url("http://x/u.png")') && store.textContent.includes('url("http://x/e.png")'));
    check("decoded css carries the loading image too", store.textContent.includes('url("http://x/s.png")'));
  }

  const onlyLoading = buildBootstrapScript({
    css: "", wallpaperDataUri: undefined, fit: "cover", transition: "fade",
    taskSpinnerLook: { mode: "image", image: "http://x/s.png", unreadImage: "", errorImage: "", spin: true, size: 16 },
  } as never);
  check("loading-only payload keeps the loader rules", onlyLoading.includes("span.animate-spin > svg"));
}

// --- part D: serve + MCP wiring (static) --------------------------------------
{
  const server = read("src/core/server.ts");
  check("/api/spinner accepts a slot field", /body\?\.slot === "unread" || body\?\.slot === "error"/.test(server));
  check("per-slot fixed file names", server.includes('"spinner-" + slot'), "");
  check("running slot keeps mode flip", /mode: "image" as const, image: dest/.test(server));
  check("terminal slots never force mode", !/unreadImage: dest,\s*mode/.test(server));
  check("publicConfig exposes both preview URLs", /spinnerUnreadUrl/.test(server) && /spinnerErrorUrl/.test(server));
  const mcp = read("src/mcp/server.ts");
  check("MCP schema carries unread_image_path", mcp.includes("unread_image_path"));
  check("MCP schema carries error_image_path", mcp.includes("error_image_path"));
  check("MCP maps paths to camelCase refs", mcp.includes('"unread_image_path" ? "unreadImage"') && mcp.includes('"error_image_path" ? "errorImage"'));
  const panel = read("src/panel/panelScript.ts");
  check("panel posts slot with the upload", panel.includes("slot: slot"));
  check("panel clear buttons per terminal slot", panel.includes("zb-spinner-unread-clear") && panel.includes("zb-spinner-error-clear"));
}

console.log(failed === 0 ? "\nT21 all green" : `\nT21 FAILED (${failed})`);
process.exit(failed === 0 ? 0 : 1);
