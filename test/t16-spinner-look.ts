/**
 * T16 SPINNER LOOK verification (运行中图标): the 0.4.8 session-list
 * running-indicator contracts —
 *   A  normalizeTaskSpinnerLook clamps/gates every field;
 *   B  resolveSpinnerImageRef maps refs to paintable URLs (data/http through,
 *      data-dir file → serve media URL, outside file → data URI, junk → "");
 *   C  buildPayload bakes the normalized look with the image resolved;
 *   D  baseConfig partial-patch merge keeps the stored look (MCP path);
 *   E  the bootstrap carries applySpinnerLook + the two-renderer selectors +
 *      the spin toggle, and the reset script cleans the style up;
 *   F  serve wiring exists (/api/spinner route, publicConfig preview URL,
 *      /media/lib gif passthrough).
 *
 * No mocks and no running ZCode needed: same chain as t14, plus file-fixture
 * resolution against a throwaway data dir.
 *
 * Run: npx tsx test/t16-spinner-look.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTaskSpinnerLook, resolveSpinnerImageRef, buildPayload, DEFAULT_CONFIG, SPINNER_REF_MAX_CHARS, type BeautifyConfig } from "../src/core/inject.js";
import { buildBootstrapScript, buildResetScript } from "../src/core/cdp.js";
import { baseConfig } from "../src/core/session.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}
const root = fileURLToPath(new URL("../", import.meta.url));
function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

// Redirect the data dir FIRST: parts B/C write fixtures into it and must never
// touch the real plugin store.
process.env.ZCODE_BEAUTIFY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zb-t16-"));
const dataDirPath = process.env.ZCODE_BEAUTIFY_DATA_DIR;

// 1x1 transparent GIF / PNG (standard base64).
const GIF_1PX = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

// --- part A: normalize ------------------------------------------------------
{
  const n = normalizeTaskSpinnerLook({ mode: "image", image: "  C:/x/cat.gif  ", spin: false, size: 99 });
  check("normalize keeps image mode, trims the ref, drops spin, clamps size",
    n.mode === "image" && n.image === "C:/x/cat.gif" && n.spin === false && n.size === 24,
    JSON.stringify(n));
  const tiny = normalizeTaskSpinnerLook({ size: 3 });
  check("size below 10 clamps to 10", tiny.size === 10);
  const junk = normalizeTaskSpinnerLook({ mode: "banana" as never });
  check("unknown mode falls back to default, spin defaults on", junk.mode === "default" && junk.spin === true);
  const empty = normalizeTaskSpinnerLook();
  check("absent input → full default look",
    empty.mode === "default" && empty.image === "" && empty.spin === true && empty.size === 16);
  const huge = normalizeTaskSpinnerLook({ image: "x".repeat(SPINNER_REF_MAX_CHARS + 10) });
  check("oversized ref is cut to the cap", huge.image.length === SPINNER_REF_MAX_CHARS);
}

// --- part B: resolve --------------------------------------------------------
{
  fs.writeFileSync(path.join(dataDirPath, "spinner.gif"), GIF_1PX);
  const outside = path.join(dataDirPath, "..", "t16-outside.png");
  fs.writeFileSync(outside, PNG_1PX);

  check("data URL passes through untouched",
    resolveSpinnerImageRef("data:image/gif;base64,R0lGODlhAQAB==", 9223, "tok") === "data:image/gif;base64,R0lGODlhAQAB==");
  check("http URL passes through untouched",
    resolveSpinnerImageRef("http://127.0.0.1:1/x.gif", 9223, "") === "http://127.0.0.1:1/x.gif");
  const inDir = resolveSpinnerImageRef(path.join(dataDirPath, "spinner.gif"), 9223, "tok");
  check("data-dir file → serve media URL with token",
    inDir === "http://127.0.0.1:9223/media/lib/spinner.gif?t=tok", inDir);
  const noTok = resolveSpinnerImageRef(path.join(dataDirPath, "spinner.gif"), 9300, "");
  check("tokenless serve → bare media URL on the right port",
    noTok === "http://127.0.0.1:9300/media/lib/spinner.gif", noTok);
  const outUri = resolveSpinnerImageRef(outside, 9223, "");
  check("outside file → png data URI", outUri.startsWith("data:image/png;base64,"), outUri.slice(0, 40));
  check("missing file → empty (stock fallback)", resolveSpinnerImageRef("Z:/nope/cat.gif", 9223, "") === "");
  check("unsupported extension → empty", (() => {
    const p = path.join(dataDirPath, "spinner.txt");
    fs.writeFileSync(p, "x");
    return resolveSpinnerImageRef(p, 9223, "");
  })() === "");
  check("oversized outside file → empty", (() => {
    const p = path.join(dataDirPath, "..", "t16-big.png");
    fs.writeFileSync(p, Buffer.alloc(2 * 1024 * 1024 + 1));
    return resolveSpinnerImageRef(p, 9223, "");
  })() === "");
}

// --- part C: buildPayload ---------------------------------------------------
{
  const base: BeautifyConfig = { ...DEFAULT_CONFIG, apiPort: 9223 };
  const stock = buildPayload({ ...base, taskSpinnerLook: { mode: "default", image: "" } }, undefined, "tok");
  check("stock payload carries the default look",
    stock.taskSpinnerLook!.mode === "default" && stock.taskSpinnerLook!.image === "");

  const img = buildPayload({ ...base, taskSpinnerLook: { mode: "image", image: path.join(dataDirPath, "spinner.gif") } }, undefined, "tok");
  check("image payload resolves the data-dir ref to the media URL",
    img.taskSpinnerLook!.mode === "image"
      && img.taskSpinnerLook!.image === "http://127.0.0.1:9223/media/lib/spinner.gif?t=tok",
    img.taskSpinnerLook!.image);

  const broken = buildPayload({ ...base, taskSpinnerLook: { mode: "image", image: "Z:/gone/ghost.gif" } }, undefined, "");
  check("unresolvable ref degrades to empty image, mode stays",
    broken.taskSpinnerLook!.mode === "image" && broken.taskSpinnerLook!.image === "");
}

// --- part D: baseConfig partial merge (MCP path) ----------------------------
{
  const stored: Partial<BeautifyConfig> = {
    ...DEFAULT_CONFIG,
    taskSpinnerLook: { mode: "image", image: "D:/icons/cat.gif", spin: false, size: 18 },
  };
  const untouched = baseConfig({}, stored);
  const u = untouched.taskSpinnerLook!;
  check("opts without spinner keep the stored look untouched",
    u.mode === "image" && u.image === "D:/icons/cat.gif" && u.spin === false && u.size === 18
    && u.unreadImage === "" && u.errorImage === "");
  const patched = baseConfig({ taskSpinnerLook: { size: 22 } }, stored);
  check("size-only patch keeps mode/image/spin",
    patched.taskSpinnerLook!.mode === "image"
      && patched.taskSpinnerLook!.image === "D:/icons/cat.gif"
      && patched.taskSpinnerLook!.spin === false
      && patched.taskSpinnerLook!.size === 22);
  const flipped = baseConfig({ taskSpinnerLook: { mode: "default" } }, stored);
  check("mode-only patch back to default keeps the stored ref for later",
    flipped.taskSpinnerLook!.mode === "default" && flipped.taskSpinnerLook!.image === "D:/icons/cat.gif");
}

// --- part E: bootstrap + reset ---------------------------------------------
{
  const look = { mode: "image" as const, image: "http://127.0.0.1:9223/media/lib/spinner.gif?t=tok", spin: false, size: 20 };
  const boot = buildBootstrapScript({ css: "", spinnerLook: look });
  check("bootstrap mounts a -spinner-style element", boot.includes("'-spinner-style'"));
  check("bootstrap defines applySpinnerLook", boot.includes("function applySpinnerLook()"));
  check("bootstrap anchors BOTH renderers via task-item testid",
    boot.includes("var ITEM = '[data-testid^=\"task-item-\"]'")
      && boot.includes("' span.animate-spin > svg,'")
      && boot.includes("' svg.animate-spin'"));
  check("bootstrap bakes the resolved image URL", boot.includes(look.image));
  check("spin=false baked and kills the rotation",
    boot.includes('\\"spin\\":false') && boot.includes("animation:none!important"));
  check("bootstrap fast path tracks spinnerKey", boot.includes("spinnerKey"));

  const spinning = buildBootstrapScript({ css: "", spinnerLook: { ...look, spin: true } });
  check("spin=true baked (the rotation rule stays inert)",
    spinning.includes('\\"spin\\":true') && !spinning.includes('\\"spin\\":false'));

  const stockBoot = buildBootstrapScript({ css: "", spinnerLook: { mode: "default", image: "", spin: true, size: 16 } });
  check("mode default still compiles (runtime removes the style)", stockBoot.includes("applySpinnerLook"));

  const reset = buildResetScript();
  check("reset removes -spinner-style and clears spinnerKey",
    reset.includes("'-spinner-style'") && reset.includes("spinnerKey = null"));
}

// --- part F: serve wiring (string-level, same style as t14) -----------------
{
  const server = read(path.join(root, "src/core/server.ts"));
  check("serve exposes POST /api/spinner", server.includes('"/api/spinner"'));
  check("publicConfig previews the resolved spinner URL", server.includes("spinnerImageUrl"));
  check("/media/lib passes gif through for the spinner",
    /media\/lib[\s\S]{0,400}jpe\?g\|png\|webp\|bmp\|gif/.test(server));
  const mcp = read(path.join(root, "src/mcp/server.ts"));
  check("MCP apply_options forwards a spinner patch", mcp.includes("taskSpinnerLook"));
  const session = read(path.join(root, "src/core/session.ts"));
  check("session layer merges spinner partials", session.includes("taskSpinnerLook"));
}

console.log(failed === 0 ? "\nT16 all green" : `\nT16 ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
