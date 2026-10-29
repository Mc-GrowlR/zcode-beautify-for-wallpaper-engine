/**
 * T20 SPINNER ISOLATION verification (运行中图标与壁纸库隔离): 0.4.8 bugfix —
 * setting the sidebar running-indicator icon used to drop spinner.<ext> into
 * the data dir ROOT, which is the wallpaper library's scan namespace, so the
 * icon showed up as a fake library wallpaper (and a wallpaper upload named
 * spinner.jpg would overwrite the icon). Contracts, against a real sandboxed
 * serve (t13 boot pattern):
 *   A  start-up migration: a legacy root-level spinner.jpg + config pointing
 *      at it gets moved into spinner/ and the config repointed;
 *   B  the library listing contains no spinner.* afterwards, while a real
 *      root image still lists (no regression);
 *   C  POST /api/spinner writes only into spinner/, cleans other variants
 *      there AND any root-level strays;
 *   D  GET /media/spinner/<name> serves the icon; the config's resolved
 *      spinnerImageUrl points at /media/spinner/;
 *   E  resolveSpinnerImageRef unit: spinner/ subdir → /media/spinner/,
 *      other data-dir files keep /media/lib/ (offline part).
 *
 * Run: npx tsx test/t20-spinner-isolation.ts
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSpinnerImageRef } from "../src/core/inject.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}

const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zb-t20-"));

// --- part E first (offline): ref resolution knows the spinner subdir -------
{
  process.env.ZCODE_BEAUTIFY_DATA_DIR = tmp; // dataDir() hook, same as t13/t16
  const { dataDir } = await import("../src/core/launch.js");
  // The resolver stats the file first — both fixtures must exist.
  fs.mkdirSync(path.join(dataDir(), "spinner"), { recursive: true });
  fs.writeFileSync(path.join(dataDir(), "spinner", "spinner.gif"), PNG_1PX);
  fs.writeFileSync(path.join(dataDir(), "some-photo.jpg"), PNG_1PX);
  const inSpinner = resolveSpinnerImageRef(path.join(dataDir(), "spinner", "spinner.gif"), 9223, "tok");
  check("ref in spinner/ resolves to /media/spinner/", inSpinner === "http://127.0.0.1:9223/media/spinner/spinner.gif?t=tok", inSpinner);
  const inRoot = resolveSpinnerImageRef(path.join(dataDir(), "some-photo.jpg"), 9223, "tok");
  check("ref in data-dir root keeps /media/lib/", inRoot === "http://127.0.0.1:9223/media/lib/some-photo.jpg?t=tok", inRoot);
  fs.rmSync(path.join(dataDir(), "some-photo.jpg"), { force: true }); // not a library item in the serve parts
}

// --- sandbox fixtures: the exact state a 0.4.8 install ended up in ---------
const LEGACY_SPINNER = path.join(tmp, "spinner.jpg");
fs.writeFileSync(LEGACY_SPINNER, PNG_1PX); // "the icon that polluted the library"
fs.writeFileSync(path.join(tmp, "a-real-wallpaper.png"), PNG_1PX); // must keep listing
fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify({
  taskSpinnerLook: { mode: "image", image: LEGACY_SPINNER, spin: false, size: 24 },
}));

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

async function waitForHealth(ms = 30_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
const killServe = () => { try { process.platform === "win32" ? spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"]) : child.kill("SIGKILL"); } catch { /* already gone */ } };

if (await waitForHealth()) {
  const token = fs.readFileSync(path.join(tmp, "serve.token"), "utf8").trim();
  const auth = { "X-Beautify-Token": token };

  // --- part A: migration ran at boot -----------------------------------------
  check("legacy root spinner.jpg moved into spinner/", fs.existsSync(path.join(tmp, "spinner", "spinner.jpg")), fs.readdirSync(tmp).join(","));
  check("nothing named spinner.* remains at the root",
    !fs.readdirSync(tmp).some((f) => /^spinner\./i.test(f)));
  const cfg = (await (await fetch(`${base}/api/config`, { headers: auth })).json()) as { taskSpinnerLook: { image: string } };
  check("config.taskSpinnerLook.image repointed at spinner/", cfg.taskSpinnerLook.image === path.join(tmp, "spinner", "spinner.jpg"), cfg.taskSpinnerLook.image);

  // --- part B: library clean, real wallpapers unaffected ---------------------
  const lib = (await (await fetch(`${base}/api/library`, { headers: auth })).json()) as { images: Array<{ name: string }> };
  check("library contains no spinner.* entry", !lib.images.some((i) => /^spinner\./i.test(i.name)), lib.images.map((i) => i.name).join(","));
  check("library still lists the real root image", lib.images.some((i) => i.name === "a-real-wallpaper.png"));

  // --- part C: re-upload writes only into spinner/ ----------------------------
  const up = await fetch(`${base}/api/spinner`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ dataUri: `data:image/png;base64,${PNG_1PX.toString("base64")}` }),
  });
  check("/api/spinner upload accepted", up.ok);
  check("new icon lives at spinner/spinner.png", fs.existsSync(path.join(tmp, "spinner", "spinner.png")));
  check("upload cleaned the previous .jpg variant", !fs.existsSync(path.join(tmp, "spinner", "spinner.jpg")));
  check("root still free of spinner.* after upload", !fs.readdirSync(tmp).some((f) => /^spinner\./i.test(f)));
  const lib2 = (await (await fetch(`${base}/api/library`, { headers: auth })).json()) as { images: Array<{ name: string }> };
  check("library still clean after re-upload", !lib2.images.some((i) => /^spinner\./i.test(i.name)));

  // --- part D: media path + resolved preview URL ------------------------------
  const media = await fetch(`${base}/media/spinner/spinner.png?t=${token}`);
  check("/media/spinner/<name> serves the icon", media.ok, String(media.status));
  const cfg2 = (await (await fetch(`${base}/api/config`, { headers: auth })).json()) as { spinnerImageUrl: string };
  check("spinnerImageUrl points at /media/spinner/", cfg2.spinnerImageUrl.includes("/media/spinner/"), cfg2.spinnerImageUrl);
  const guard = await fetch(`${base}/media/spinner/..%2Fconfig.json?t=${token}`);
  check("media path traversal still blocked", guard.status === 400, String(guard.status));
} else {
  check("serve boots with the polluted 0.4.8 fixtures", false, bootLog.slice(-200));
}
killServe();
await new Promise((r) => setTimeout(r, 1500));
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* windows locks */ }

console.log(failed === 0 ? "\nT20 all green" : `\nT20 FAILED (${failed})`);
process.exit(failed === 0 ? 0 : 1);
