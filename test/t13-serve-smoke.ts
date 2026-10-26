/**
 * T13 SERVE SMOKE verification: boots the REAL serve (src/cli.ts via tsx, no
 * mocks) in a sandbox — random CDP/API ports and ZCODE_BEAUTIFY_DATA_DIR
 * pointed at a throwaway temp dir — then exercises the local API exactly the
 * way the panel and the MCP bootstrap do: token auth, health payload, config
 * round-trip with normalization, sibling endpoints, and config persistence.
 *
 * Nothing touches the real ~/.zcode data dir, the live serve on 9223, or
 * ZCode itself (the CDP port points nowhere; injection failures are
 * fire-and-forget by design).
 *
 * Run: npx tsx test/t13-serve-smoke.ts   (also part of: npm test)
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../src/version.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zb-t13-"));

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

// --- boot the real CLI (foreground child; killed with its tree at the end) ---
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

const booted = await waitForHealth();
check("serve boots with a sandboxed data dir (no ZCode needed)", booted,
  booted ? `pid ${child.pid}` : `exit=${child.exitCode} log=${bootLog.slice(-200)}`);

if (booted) {
  // --- health payload (tokenless by design — the MCP bootstrap probes it) ----
  const h = (await (await fetch(`${base}/api/health`)).json()) as Record<string, unknown>;
  check("health: service identity", h.service === "zcode-beautify");
  // NOTE: the child here is the tsx wrapper — tsx re-spawns the real node
  // process, so health's pid is a DESCENDANT, not child.pid itself.
  check("health: reports the serve process pid (not the test's)",
    typeof h.pid === "number" && h.pid !== process.pid, String(h.pid));
  check("health: version matches version.ts", h.version === VERSION, String(h.version));
  check("health: ports echoed back", h.cdpPort === cdpPort && h.apiPort === apiPort);
  check("health: uptime is a sane number", typeof h.uptimeMs === "number" && (h.uptimeMs as number) >= 0);

  // --- token auth --------------------------------------------------------------
  const token = fs.readFileSync(path.join(tmp, "serve.token"), "utf8").trim();
  check("serve.token materialized in the sandbox dir", token.length >= 16, token.length + " chars");
  const unauth = await fetch(`${base}/api/config`);
  check("config without token is rejected", unauth.status === 401, String(unauth.status));
  const authed = await fetch(`${base}/api/config`, { headers: { "X-Beautify-Token": token } });
  check("config with token is accepted", authed.ok);

  // --- config GET defaults -------------------------------------------------------
  const cfg = (await authed.json()) as Record<string, unknown>;
  check("fresh config carries defaults", cfg.monet === true && cfg.fit === "cover" && cfg.wallpaperVisible === true);
  check("fresh config exposes normalized bubbleLook", typeof (cfg.bubbleLook as { preset?: string }).preset === "string");

  // --- config POST round-trip + normalization ------------------------------------
  const post = await fetch(`${base}/api/config`, {
    method: "POST",
    headers: { "X-Beautify-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({
      dim: 33,
      bubbleLook: { preset: "custom", tint: 200, customCss: ".zb-bubble{x}</style>" },
      chatLook: { chatDim: 12, maskTop: 0, maskBottom: 0, frost: 0 },
    }),
  });
  check("config POST accepted", post.ok);
  const back = (await (await fetch(`${base}/api/config`, { headers: { "X-Beautify-Token": token } })).json()) as {
    dim: number;
    bubbleLook: { preset: string; tint: number; customCss?: string; radius: number; align: string };
    chatLook: { chatDim: number };
  };
  check("POST value persisted (dim)", back.dim === 33);
  check("bubble preset + chatLook persisted", back.bubbleLook.preset === "custom" && back.chatLook.chatDim === 12);
  check("serve clamps out-of-range knobs", back.bubbleLook.tint === 100, String(back.bubbleLook.tint));
  check("serve sanitizes customCss", !back.bubbleLook.customCss?.includes("</style"));
  check("serve fills omitted bubble fields", back.bubbleLook.radius === 12 && back.bubbleLook.align === "right");
  const persisted = JSON.parse(fs.readFileSync(path.join(tmp, "config.json"), "utf8"));
  check("config.json written to the sandbox dir", persisted.dim === 33);

  // --- sibling endpoints the panel polls ------------------------------------------
  const lib = (await (await fetch(`${base}/api/library`, { headers: { "X-Beautify-Token": token } })).json()) as { scenes?: unknown[]; images?: unknown[] };
  check("/api/library shape", Array.isArray(lib.scenes) && Array.isArray(lib.images));
  const hist = (await (await fetch(`${base}/api/history`, { headers: { "X-Beautify-Token": token } })).json()) as { items?: unknown[] };
  check("/api/history shape", Array.isArray(hist.items));
  const rot = (await (await fetch(`${base}/api/rotation`, { headers: { "X-Beautify-Token": token } })).json()) as { rotation?: { plans?: unknown[] } };
  check("/api/rotation shape", Array.isArray(rot.rotation?.plans));
  const stor = (await (await fetch(`${base}/api/storage`, { headers: { "X-Beautify-Token": token } })).json()) as { scenesBytes?: number };
  check("/api/storage shape", typeof stor.scenesBytes === "number");
}

// --- teardown: kill the whole child tree, drop the sandbox ----------------------
try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* already gone */ }
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }

console.log(failed ? `\nT13: ${failed} check(s) FAILED` : "\nT13: all checks passed");
process.exit(failed ? 1 : 0);
