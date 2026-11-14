/**
 * T33 设置按钮 (FAB look) verification:
 *   A  normalizeFabLook: defaults, image-mode degradation without a ref,
 *      size clamped to 20-64;
 *   B  serve wiring: publicConfig exposes fabLook + resolved fabImageUrl,
 *      sanitize accepts fabLook, /api/spinner accepts slot "fab" writing
 *      spinner/fab.<ext> into config.fabLook;
 *   C  panel (jsdom, real panel script): the 通用 block exists, the FAB is
 *      restyled from config (image paints over the ball, emoji restored on
 *      default, size scales ball + emoji), live size slider previews without
 *      a push, offline reset restores the stock ball;
 *   D  MCP apply_options carries the fab object; baseConfig merges partials.
 *
 * Run: npx tsx test/t33-fab-look.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeFabLook, DEFAULT_FAB_LOOK } from "../src/core/inject.js";
import { buildPanelScript } from "../src/panel/panelScript.js";
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

process.env.ZCODE_BEAUTIFY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zb-t33-"));

// --- part A: normalization ----------------------------------------------------
{
  const d = normalizeFabLook(undefined);
  check("default is the stock 🎨 ball", JSON.stringify(d) === JSON.stringify(DEFAULT_FAB_LOOK) && d.size === 34);
  const img = normalizeFabLook({ mode: "image", image: " C:/x/me.png ", size: 48 });
  check("image mode trims the ref", img.mode === "image" && img.image === "C:/x/me.png" && img.size === 48);
  check("image mode without a ref degrades to default", normalizeFabLook({ mode: "image", image: "  " }).mode === "default");
  check("size clamps to 20-64", normalizeFabLook({ size: 5 }).size === 20 && normalizeFabLook({ size: 200 }).size === 64);
  check("garbage size falls back to 34", normalizeFabLook({ size: NaN }).size === 34);
  check("ref honours the shared ref cap", normalizeFabLook({ image: "x".repeat(600000) }).image.length === 500000);
}

// --- part B: serve wiring -------------------------------------------------------
{
  const serveSrc = read(path.join(root, "src/core/server.ts"));
  check("publicConfig exposes fabLook + fabImageUrl", serveSrc.includes("fabLook: normalizeFabLook(config.fabLook)") && serveSrc.includes("fabImageUrl"));
  check("fabImageUrl resolves whenever a ref exists (instant local-mode preview)", /fabImageUrl: normalizeFabLook\(config\.fabLook\)\.image\s*\? resolveSpinnerImageRef\(config\.fabLook\?\.image/.test(serveSrc));
  check("sanitize accepts fabLook", serveSrc.includes("out.fabLook = normalizeFabLook(body.fabLook)"));
  check("upload endpoint accepts slot=fab and stores spinner/fab.<ext>", serveSrc.includes('body?.slot === "fab"') && serveSrc.includes('slot === "fab" ? "fab" : "spinner-" + slot'));
  check("slot=fab routes into config.fabLook (mode image)", /slot === "fab"\) \{[\s\S]*?fabLook: \{ \.\.\.look, mode: "image" as const, image: dest \}/.test(serveSrc));
  const injectSrc = read(path.join(root, "src/core/inject.ts"));
  const payloadSection = injectSrc.slice(injectSrc.indexOf("export interface BuiltPayload"), injectSrc.indexOf("export interface InjectScriptInput"));
  check("config carries fabLook; BuiltPayload has no fabLook field (panel-side only)",
    injectSrc.includes("fabLook?: Partial<FabLookConfig>") && injectSrc.includes("Purely panel-side") && !payloadSection.includes("fabLook"));
}

// --- part C: panel behavior -----------------------------------------------------
{
  const { JSDOM } = await import("jsdom");
  const panel = buildPanelScript(9223, "tok", true, { appName: "ZCode", chatUi: true, hasUpdater: false });

  const w = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://127.0.0.1/",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  }).window;
  // Mock the serve API before mounting: /api/config returns a fab image look.
  const configPayload = {
    blur: 0, dim: 25, sidebarDim: 0, monet: false, wallpaperVisible: true,
    kenBurns: false, videoVolume: 0, themeColor: null, dayNight: null,
    chatLook: {}, bubbleLook: {}, componentLook: {}, taskSpinnerLook: {},
    chatLoadLook: {}, chatLoadImageUrl: "", listPaging: { initial: 0, step: 0, collapse: 0 },
    fabLook: { mode: "image", image: "C:/fake/fab.png", size: 48 },
    fabImageUrl: "http://127.0.0.1:9223/media/spinner/fab.png?t=tok",
    startupClean: true, showOnUpdater: false, importRes: { mode: "auto" }, fit: "cover",
    wallpaperSet: false, hasBackup: false, cdpPort: 9222, mediaType: "image",
    experimental: { enabled: true },
  };
  (w as any).fetch = (url: string) => {
    if (String(url).includes("/api/config")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(configPayload) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
  w.eval(panel);
  // Panel waits for body readiness — body exists; poll until the FAB mounts
  // (the boot does canvas work in jsdom, slower than a plain query).
  const fab = await (async () => {
    for (let i = 0; i < 40; i++) {
      const f = w.document.getElementById("zb-fab");
      if (f) return f as any;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  })();
  check("panel ships the 通用 设置按钮 block", panel.includes("设置按钮") && panel.includes('id="zb-fab-mode"') && panel.includes('id="zb-fab-pick"') && panel.includes('id="zb-fab-size"'));
  check("FAB exists and mounts stock", !!fab && fab.textContent === "🎨");

  // After refresh() lands, the config look must restyle the ball.
  await new Promise((r) => setTimeout(r, 250));
  check("image mode clears the emoji", fab.textContent === "");
  check("image mode paints the resolved URL", fab.style.backgroundImage.includes("/media/spinner/fab.png"), fab.style.backgroundImage);
  check("size 48 scales the ball", fab.style.width === "48px" && fab.style.height === "48px");
  check("emoji font scales to half the ball", fab.style.fontSize === "24px");
  check("panel anchor var tracks the ball (48px ball → 74px bottom)",
    w.document.documentElement.style.getPropertyValue("--zb-fab-panel-bottom") === "74px" && panel.includes("bottom: var(--zb-fab-panel-bottom, 60px)"));
  check("image + size rows visible in the panel", w.document.getElementById("zb-fab-img-row").hidden === false && w.document.getElementById("zb-fab-size-row").hidden === false);
  check("preview img carries the resolved URL", (w.document.getElementById("zb-fab-preview") as any).src.includes("fab.png"));

  // Mode back to default restores the stock ball.
  const modeSel = w.document.getElementById("zb-fab-mode") as any;
  modeSel.value = "default";
  modeSel.dispatchEvent(new w.Event("change"));
  await new Promise((r) => setTimeout(r, 50));
  check("default mode restores the emoji + clears the paint", fab.textContent === "🎨" && (fab.style.backgroundImage === "none" || fab.style.backgroundImage === ""));
  check("default mode hides the image row (size row stays adjustable)", w.document.getElementById("zb-fab-img-row").hidden === true && w.document.getElementById("zb-fab-size-row").hidden === false);

  // Live size slider previews without waiting for the push debounce.
  const sizeInput = w.document.getElementById("zb-fab-size") as any;
  modeSel.value = "image";
  modeSel.dispatchEvent(new w.Event("change"));
  sizeInput.value = "64";
  sizeInput.dispatchEvent(new w.Event("input"));
  await new Promise((r) => setTimeout(r, 30));
  check("size slider previews live (64px ball before push)", fab.style.width === "64px" && fab.style.height === "64px");
  check("slider label mirrors the value", w.document.getElementById("zb-fab-size-val").textContent === "64");
  check("panel anchor var follows the live slider (64px ball → 90px bottom)",
    w.document.documentElement.style.getPropertyValue("--zb-fab-panel-bottom") === "90px");

  // Offline reset restores the stock ball.
  (w as any).fetch = () => Promise.reject(new Error("down"));
  w.dispatchEvent(new w.Event("test"));
  // drive setOffline via the retry path: call the offline reset through a failed refresh
  (w as any).__zbRetry = w.document.getElementById("zb-retry");
  (w as any).__zbRetry.click();
  await new Promise((r) => setTimeout(r, 120));
  check("offline reset restores stock ball (emoji, 34px, no paint)",
    fab.textContent === "🎨" && fab.style.width === "34px" && (fab.style.backgroundImage === "none" || fab.style.backgroundImage === ""));
  check("offline reset restores the stock panel anchor (60px)",
    w.document.documentElement.style.getPropertyValue("--zb-fab-panel-bottom") === "60px");
}

// --- part D: MCP + merge ---------------------------------------------------------
{
  const mcpSrc = read(path.join(root, "src/mcp/server.ts"));
  check("apply_options exposes the fab object", mcpSrc.includes("fab: z.object({") && mcpSrc.includes('k === "image_path" ? "image" : k, v') && mcpSrc.includes("listPaging, fabLook }"));
  const sessionSrc = read(path.join(root, "src/core/session.ts"));
  check("baseConfig merges fabLook partials", sessionSrc.includes("opts.fabLook ? { ...stored.fabLook, ...opts.fabLook } : stored.fabLook"));
  const stored: any = { port: 9222, blur: 0, dim: 25, monet: true, wallpaperVisible: true, fit: "cover", fabLook: { mode: "image", image: "C:/a.png", size: 40 } };
  const merged = baseConfig({ fabLook: { size: 52 } }, stored);
  check("one-field tweak keeps mode/image", merged.fabLook?.mode === "image" && merged.fabLook?.image === "C:/a.png" && merged.fabLook?.size === 52);
  const fresh = baseConfig({ fabLook: { mode: "image", image: "C:/b.png" } }, { port: 9222, blur: 0, dim: 25, monet: true, wallpaperVisible: true, fit: "cover" });
  check("no stored look: normalize fills size 34", fresh.fabLook?.mode === "image" && fresh.fabLook?.size === 34);
}

console.log(failed === 0 ? "\nT33: all checks passed" : `\nT33: ${failed} check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
