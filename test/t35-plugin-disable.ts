/**
 * T35 PLUGIN-DISABLE LIFECYCLE verification: switching the plugin off in the
 * host plugin manager must stop the already-running (detached) serve daemon,
 * and the panel's "停用并清理启动项" must persist the opt-in gate — otherwise
 * the next app start's MCP bootstrap respawns the daemon and repairs the CDP
 * flag again.
 *
 * Three tiers, no live ZCode and no real launch entries touched:
 *   A  host-gate helper against sandboxed ZCode/WorkBuddy config trees
 *   B  real serve subprocess with a host config explicitly disabling the
 *      plugin — it must tear itself down and exit
 *   C  real serve subprocess + POST /api/experimental/disable — it must write
 *      experimental.enabled=false and exit (launcher scan skipped in tests)
 *
 * Run: npx tsx test/t35-plugin-disable.ts   (also part of: npm test)
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { hostPluginState } from "../src/core/pluginGate.js";
import { fallbackCdpPorts, TARGETS } from "../src/core/target.js";
import { VERSION } from "../src/version.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const sandbox = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "zb-t35-")));

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function zcodeHome(entry: Record<string, unknown> | undefined, label: string): string {
  const home = path.join(sandbox, "home-" + label);
  if (entry) writeJson(path.join(home, ".zcode", "cli", "config.json"), { plugins: { enabledPlugins: entry } });
  return home;
}

// --- part A: host plugin-manager gate -----------------------------------------
{
  const unknown = hostPluginState({ targetId: "zcode", home: zcodeHome(undefined, "none"), workingDirectory: sandbox, env: {} });
  check("A1: missing config is unknown (fail open)", unknown.known === false && unknown.enabled === true);

  const other = hostPluginState({
    targetId: "zcode",
    home: zcodeHome({ "another-plugin@market": false }, "other"),
    workingDirectory: sandbox,
    env: {},
  });
  check("A2: unrelated entries do not count", other.known === false && other.enabled === true);

  const off = hostPluginState({
    targetId: "zcode",
    home: zcodeHome({ "zcode-beautify@zcode-beautify": false }, "off"),
    workingDirectory: sandbox,
    env: {},
  });
  check("A3: explicit user false disables", off.known === true && off.enabled === false);

  const on = hostPluginState({
    targetId: "zcode",
    home: zcodeHome({ "zcode-beautify@zcode-beautify": true }, "on"),
    workingDirectory: sandbox,
    env: {},
  });
  check("A4: explicit user true enables", on.known === true && on.enabled === true);

  const mixed = hostPluginState({
    targetId: "zcode",
    home: zcodeHome(
      { "zcode-beautify@market-a": false, "zcode-beautify@market-b": true },
      "mixed"
    ),
    workingDirectory: sandbox,
    env: {},
  });
  check("A5: any enabled install wins inside one scope", mixed.known === true && mixed.enabled === true);

  const brokenHome = path.join(sandbox, "home-broken");
  fs.mkdirSync(path.join(brokenHome, ".zcode", "cli"), { recursive: true });
  fs.writeFileSync(path.join(brokenHome, ".zcode", "cli", "config.json"), "{not json");
  const broken = hostPluginState({ targetId: "zcode", home: brokenHome, workingDirectory: sandbox, env: {} });
  check("A6: corrupt config is unknown (fail open)", broken.known === false && broken.enabled === true);

  const wbHome = path.join(sandbox, "home-workbuddy");
  writeJson(path.join(wbHome, ".workbuddy", "settings.json"), {
    enabledPlugins: { "zcode-beautify-workbuddy@zcode-beautify": false },
  });
  const wb = hostPluginState({ targetId: "workbuddy", home: wbHome, workingDirectory: sandbox, env: {} });
  check("A7: WorkBuddy top-level enabledPlugins is read", wb.known === true && wb.enabled === false);

  const wsHome = zcodeHome({ "zcode-beautify@zcode-beautify": true }, "ws-off");
  const wsDir = path.join(sandbox, "ws-off");
  writeJson(path.join(wsDir, ".zcode", "config.json"), {
    plugins: { enabledPlugins: { "zcode-beautify@zcode-beautify": false } },
  });
  const wsOff = hostPluginState({ targetId: "zcode", home: wsHome, workingDirectory: wsDir, env: {} });
  check("A8: workspace override false disables", wsOff.known === true && wsOff.enabled === false);

  const globalOffHome = zcodeHome({ "zcode-beautify@zcode-beautify": false }, "global-off");
  const wsOnDir = path.join(sandbox, "ws-on");
  writeJson(path.join(wsOnDir, ".zcode", "config.json"), {
    plugins: { enabledPlugins: { "zcode-beautify@zcode-beautify": true } },
  });
  const globalOff = hostPluginState({ targetId: "zcode", home: globalOffHome, workingDirectory: wsOnDir, env: {} });
  check("A9: global user false beats a workspace true (one global daemon)", globalOff.known === true && globalOff.enabled === false);

  const wsInheritHome = zcodeHome({ "zcode-beautify@zcode-beautify": true }, "ws-inherit");
  const wsInheritDir = path.join(sandbox, "ws-inherit");
  fs.mkdirSync(wsInheritDir, { recursive: true });
  const inherited = hostPluginState({ targetId: "zcode", home: wsInheritHome, workingDirectory: wsInheritDir, env: {} });
  check("A10: workspace with no entry inherits the user true", inherited.known === true && inherited.enabled === true);

  const overrideFile = path.join(sandbox, "override.json");
  writeJson(overrideFile, { plugins: { enabledPlugins: { "zcode-beautify@override": false } } });
  const overridden = hostPluginState({
    targetId: "zcode",
    home: zcodeHome(undefined, "override-home"),
    workingDirectory: sandbox,
    env: { ZCODE_BEAUTIFY_HOST_CONFIG: overrideFile },
  });
  check("A11: ZCODE_BEAUTIFY_HOST_CONFIG replaces the default path", overridden.known === true && overridden.enabled === false);

  check("A12: ZCode probes its built-in dev CDP port when 9222 is closed", JSON.stringify(fallbackCdpPorts(TARGETS.zcode)) === "[9229]");
  check("A13: WorkBuddy has no built-in fallback port", fallbackCdpPorts(TARGETS.workbuddy).length === 0);
}

// --- shared subprocess helpers -------------------------------------------------
function freePort(): Promise<number> {
  return new Promise((res) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => res(p));
    });
  });
}

interface ServeProc {
  child: ReturnType<typeof spawn>;
  log: () => string;
}

function spawnServe(env: Record<string, string>, cwd: string): ServeProc {
  const child = spawn(
    process.execPath,
    [
      path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
      path.join(root, "src", "cli.ts"),
      "serve",
      "--port",
      env.ZB_TEST_CDP_PORT,
      "--api-port",
      env.ZB_TEST_API_PORT,
    ],
    {
      cwd,
      env: { ...process.env, BEAUTIFY_TARGET: "zcode", ZCODE_BEAUTIFY_SKIP_LAUNCHERS: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let log = "";
  child.stdout!.on("data", (d: Buffer) => { log += d.toString(); });
  child.stderr!.on("data", (d: Buffer) => { log += d.toString(); });
  return { child, log: () => log };
}

function waitExit(child: ReturnType<typeof spawn>, ms: number): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function waitHealth(proc: ServeProc, base: string, ms = 30_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (proc.child.exitCode !== null) return false;
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function killTree(child: ReturnType<typeof spawn>): void {
  try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* already gone */ }
}

// --- part B: host disable stops the detached daemon ---------------------------
{
  const dataDir = path.join(sandbox, "data-host-off");
  const workspace = path.join(sandbox, "ws-host-off");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  writeJson(path.join(dataDir, "config.json"), { experimental: { enabled: true } });
  const hostConfig = path.join(workspace, "host.json");
  writeJson(hostConfig, { plugins: { enabledPlugins: { "zcode-beautify@test": false } } });

  const cdpPort = await freePort();
  const apiPort = await freePort();
  const proc = spawnServe(
    {
      ZCODE_BEAUTIFY_DATA_DIR: dataDir,
      ZCODE_BEAUTIFY_HOST_CONFIG: hostConfig,
      ZB_TEST_CDP_PORT: String(cdpPort),
      ZB_TEST_API_PORT: String(apiPort),
    },
    workspace
  );
  const code = await waitExit(proc.child, 20_000);
  check("B1: serve exits when the host plugin manager says disabled", code === 0, `exit=${code} log=${proc.log().slice(-180)}`);
  check("B2: exit is deliberate and logged", /plugin disabled in .*plugin manager/i.test(proc.log()), proc.log().slice(-180));
  if (code === null) killTree(proc.child);
}

// --- part C: panel disable persists the gate and exits ------------------------
{
  const dataDir = path.join(sandbox, "data-panel-disable");
  const workspace = path.join(sandbox, "ws-panel-disable");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  writeJson(path.join(dataDir, "config.json"), { experimental: { enabled: true, consentedAt: "2026-01-01T00:00:00.000Z" } });
  const hostConfig = path.join(workspace, "host.json");
  writeJson(hostConfig, { plugins: { enabledPlugins: { "zcode-beautify@test": true } } });

  const cdpPort = await freePort();
  const apiPort = await freePort();
  const base = `http://127.0.0.1:${apiPort}`;
  const proc = spawnServe(
    {
      ZCODE_BEAUTIFY_DATA_DIR: dataDir,
      ZCODE_BEAUTIFY_HOST_CONFIG: hostConfig,
      ZB_TEST_CDP_PORT: String(cdpPort),
      ZB_TEST_API_PORT: String(apiPort),
    },
    workspace
  );

  const booted = await waitHealth(proc, base);
  check("C1: serve boots against the sandboxed enabled host config", booted, booted ? "" : proc.log().slice(-180));
  if (booted) {
    const health = (await (await fetch(`${base}/api/health`)).json()) as { experimental?: { enabled?: boolean } };
    check("C2: health reports the gate on before the click", health.experimental?.enabled === true);

    const token = fs.readFileSync(path.join(dataDir, "serve.token"), "utf8").trim();
    const res = await fetch(`${base}/api/experimental/disable`, {
      method: "POST",
      headers: { "X-Beautify-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as { ok?: boolean; cleared?: number; launchers?: unknown };
    check("C3: disable route answers ok", res.ok && body.ok === true);
    check("C3b: test hook skipped the real launcher scan", body.launchers === undefined);

    const code = await waitExit(proc.child, 10_000);
    check("C4: daemon exits after the route", code === 0, `exit=${code}`);
    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, "config.json"), "utf8")) as {
      experimental?: { enabled?: boolean };
    };
    check("C5: experimental.enabled=false was persisted by the route", persisted.experimental?.enabled === false, JSON.stringify(persisted.experimental));
  }
  if (proc.child.exitCode === null) killTree(proc.child);
}

// --- part D: wiring stays in place --------------------------------------------
{
  const mcpSrc = fs.readFileSync(path.join(root, "src", "mcp", "server.ts"), "utf8");
  check("D1: MCP bootstrap checks the host gate", mcpSrc.includes("hostPluginState()"));
  check(
    "D2: host gate runs before any gate migration / daemon spawn",
    mcpSrc.indexOf("hostPluginState()") > -1 &&
      mcpSrc.indexOf("hostPluginState()") < mcpSrc.indexOf("ensureExperimentalGate()")
  );
  check(
    "D2b: acting tools are host-gated, status/disable stay callable",
    mcpSrc.includes("hostDisabledNotice()") &&
      mcpSrc.includes('name === "beautify_status" || name === "disable_experimental"')
  );

  const serveSrc = fs.readFileSync(path.join(root, "src", "core", "server.ts"), "utf8");
  check("D3: serve watchdog checks hostPluginDisabled()", serveSrc.includes("hostPluginDisabled()"));
  check("D4: serve route persists the gate itself", serveSrc.includes("markExperimentalDisabled()"));
  check("D5: serve route strips launcher flags", serveSrc.includes("cleanupLaunchEntries(gate.port)"));
  check("D5b: disable route purges every live renderer with a fresh connection",
    serveSrc.includes("purgeLiveRenderers()") && serveSrc.includes("purged"));
  check("D5c: shutdown flag blocks the poll loop from re-injecting", serveSrc.includes("if (shuttingDown) return false"));

  const expSrc = fs.readFileSync(path.join(root, "src", "core", "experimental.ts"), "utf8");
  check("D6: disableExperimental marks the gate before teardown", /function disableExperimental[\s\S]{0,500}markExperimentalDisabled\(\)[\s\S]{0,500}teardownLive\(\)/.test(expSrc));
}

// --- part E: built MCP server refuses acting tools while disabled -------------
{
  const serverJs = path.join(root, "dist", "mcp", "server.js");
  if (!fs.existsSync(serverJs)) {
    console.log("E: SKIP (dist/mcp/server.js missing — run npm run bundle)");
  } else {
    const home = path.join(sandbox, "home-mcp-off");
    writeJson(path.join(home, ".zcode", "cli", "config.json"), {
      plugins: { enabledPlugins: { "zcode-beautify@test": false } },
    });
    const workspace = path.join(sandbox, "ws-mcp-off");
    // Deliberately the user's real-world trap: a workspace override true on
    // top of a global false must NOT resurrect a disabled plugin.
    writeJson(path.join(workspace, ".zcode", "config.json"), {
      plugins: { enabledPlugins: { "zcode-beautify@test": true } },
    });

    const childEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") childEnv[k] = v;
    childEnv.USERPROFILE = home;
    childEnv.HOME = home;
    childEnv.BEAUTIFY_TARGET = "zcode";
    delete childEnv.ZCODE_BEAUTIFY_DATA_DIR;
    delete childEnv.WORKBUDDY_BEAUTIFY_DATA_DIR;

    const client = new Client({ name: "t35-test", version: "0.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverJs],
      env: childEnv,
      cwd: workspace,
    });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      check("E1: MCP still lists tools for a stale process", tools.tools.some((t) => t.name === "apply_options"));

      const status = (await client.callTool({ name: "beautify_status", arguments: {} })) as {
        content: Array<{ text?: string }>;
        isError?: boolean;
      };
      const statusText = String(status.content[0]?.text ?? "");
      check("E2: beautify_status stays callable (read-only)", status.isError !== true && statusText.trim().startsWith("{"));

      const blocked = (await client.callTool({ name: "apply_options", arguments: { dim: 33 } })) as {
        content: Array<{ text?: string }>;
      };
      const text = String(blocked.content[0]?.text ?? "");
      check("E3: acting tool refuses while host-disabled", /disabled in ZCode's plugin manager/i.test(text), text.slice(0, 120));
      check("E4: refused call wrote no config", !fs.existsSync(path.join(home, ".zcode", "cli", "plugins", "data", "zcode-beautify", "config.json")));
    } finally {
      await client.close();
    }
  }
}

// --- part F: panel disable (gate off) also stops the next bootstrap ----------
{
  const serverJs = path.join(root, "dist", "mcp", "server.js");
  if (!fs.existsSync(serverJs)) {
    console.log("F: SKIP (dist/mcp/server.js missing — run npm run bundle)");
  } else {
    const home = path.join(sandbox, "home-mcp-gate-off");
    writeJson(path.join(home, ".zcode", "cli", "config.json"), {
      // Plugin itself is enabled in the manager...
      plugins: { enabledPlugins: { "zcode-beautify@test": true } },
    });
    writeJson(path.join(home, ".zcode", "cli", "plugins", "data", "zcode-beautify", "config.json"), {
      // ...but the panel's "停用并清理启动项" closed the opt-in gate.
      experimental: { enabled: false },
    });
    const workspace = path.join(sandbox, "ws-mcp-gate-off");
    fs.mkdirSync(workspace, { recursive: true });

    const childEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") childEnv[k] = v;
    childEnv.USERPROFILE = home;
    childEnv.HOME = home;
    childEnv.BEAUTIFY_TARGET = "zcode";
    delete childEnv.ZCODE_BEAUTIFY_DATA_DIR;
    delete childEnv.WORKBUDDY_BEAUTIFY_DATA_DIR;
    delete childEnv.ZCODE_BEAUTIFY_HOST_CONFIG;

    const proc = spawn(process.execPath, [serverJs], { cwd: workspace, env: childEnv, stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    proc.stderr!.on("data", (d: Buffer) => { err += d.toString(); });
    proc.stdin!.end();
    const code = await waitExit(proc, 8000);
    check("F1: gate-off bootstrap exits after stdin closes", code !== null, `exit=${code} log=${err.slice(-160)}`);
    check("F2: gate-off bootstrap refuses to start the daemon", /experimental CDP injection is disabled/i.test(err), err.slice(-160));
    check("F3: host gate and opt-in gate are distinct reasons", !/plugin disabled in/i.test(err), err.slice(-160));
    if (code === null) killTree(proc);
  }
}

// --- part G: flipping the switch while serve is already running --------------
{
  const dataDir = path.join(sandbox, "data-host-toggle");
  const workspace = path.join(sandbox, "ws-host-toggle");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  writeJson(path.join(dataDir, "config.json"), { experimental: { enabled: true } });
  const hostConfig = path.join(workspace, "host.json");
  writeJson(hostConfig, { plugins: { enabledPlugins: { "zcode-beautify@test": true } } });

  const cdpPort = await freePort();
  const apiPort = await freePort();
  const base = `http://127.0.0.1:${apiPort}`;
  const proc = spawnServe(
    {
      ZCODE_BEAUTIFY_DATA_DIR: dataDir,
      ZCODE_BEAUTIFY_HOST_CONFIG: hostConfig,
      ZCODE_BEAUTIFY_HOST_DISABLE_GRACE_MS: "4000",
      ZB_TEST_CDP_PORT: String(cdpPort),
      ZB_TEST_API_PORT: String(apiPort),
    },
    workspace
  );
  const booted = await waitHealth(proc, base);
  check("G1: serve boots while the plugin is enabled", booted, booted ? "" : proc.log().slice(-180));
  if (booted) {
    // Exactly what the plugin manager writes when the user flips the switch.
    writeJson(hostConfig, { plugins: { enabledPlugins: { "zcode-beautify@test": false } } });
    await new Promise((r) => setTimeout(r, 2500));
    check(
      "G2: disabled daemon stays dormant briefly for a quick re-enable",
      proc.child.exitCode === null && /waiting up to .*re-enable/i.test(proc.log()),
      `exit=${proc.child.exitCode} log=${proc.log().slice(-180)}`
    );

    writeJson(hostConfig, { plugins: { enabledPlugins: { "zcode-beautify@test": true } } });
    await new Promise((r) => setTimeout(r, 1600));
    check(
      "G3: re-enable resumes the same daemon in place",
      proc.child.exitCode === null && /plugin re-enabled .*resuming injection/i.test(proc.log()),
      `exit=${proc.child.exitCode} log=${proc.log().slice(-180)}`
    );

    writeJson(hostConfig, { plugins: { enabledPlugins: { "zcode-beautify@test": false } } });
    const code = await waitExit(proc.child, 12_000);
    check("G4: exits once the plugin stays off past the grace", code === 0, `exit=${code} log=${proc.log().slice(-180)}`);
    check("G5: exit is logged after the grace", /plugin still disabled .*stopping/i.test(proc.log()), proc.log().slice(-180));
  }
  if (proc.child.exitCode === null) killTree(proc.child);
}

// --- part H: MCP watchdog recovers a host off→on toggle ----------------------
{
  const serverJs = path.join(root, "dist", "mcp", "server.js");
  if (!fs.existsSync(serverJs)) {
    console.log("H: SKIP (dist/mcp/server.js missing — run npm run bundle)");
  } else {
    const home = path.join(sandbox, "home-mcp-reenable");
    const data = path.join(home, ".zcode", "cli", "plugins", "data", "zcode-beautify");
    const workspace = path.join(sandbox, "ws-mcp-reenable");
    fs.mkdirSync(data, { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });
    const apiPort = await freePort();
    const deadCdpPort = await freePort();
    writeJson(path.join(data, "config.json"), {
      experimental: { enabled: true },
      port: deadCdpPort,
      apiPort,
    });
    // Keep bootstrapServe's launcher repair out of this behavioral test: a
    // fresh stamp makes claimLauncherCheck return false before the scan.
    fs.writeFileSync(path.join(data, "launcher-check.stamp"), `${VERSION} ${Date.now()}`);
    const hostFile = path.join(workspace, "host.json");
    writeJson(hostFile, { plugins: { enabledPlugins: { "zcode-beautify@test": false } } });

    const childEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") childEnv[k] = v;
    childEnv.USERPROFILE = home;
    childEnv.HOME = home;
    childEnv.BEAUTIFY_TARGET = "zcode";
    childEnv.ZCODE_BEAUTIFY_HOST_CONFIG = hostFile;
    delete childEnv.ZCODE_BEAUTIFY_DATA_DIR;
    delete childEnv.WORKBUDDY_BEAUTIFY_DATA_DIR;

    const child = spawn(process.execPath, [serverJs], {
      cwd: workspace,
      env: childEnv,
      stdio: ["pipe", "ignore", "pipe"],
    });
    let err = "";
    child.stderr!.on("data", (d: Buffer) => { err += d.toString(); });
    const base = `http://127.0.0.1:${apiPort}`;
    const health = async (): Promise<Record<string, unknown> | null> => {
      try {
        const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(800) });
        return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    };
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    await sleep(1200);
    check("H1: bootstrap stays inert while the host plugin is off", (await health()) === null, err.slice(-120));

    // Exactly what the plugin manager writes when the user re-enables it.
    writeJson(hostFile, { plugins: { enabledPlugins: { "zcode-beautify@test": true } } });
    let recovered: Record<string, unknown> | null = null;
    for (let i = 0; i < 30 && !recovered; i++) {
      await sleep(400);
      recovered = await health();
    }
    check(
      "H2: MCP re-enable watchdog starts serve without a restart",
      recovered?.service === "zcode-beautify",
      `health=${JSON.stringify(recovered)} stderr=${err.slice(-120)}`
    );
    check(
      "H3: recovered serve uses the sandboxed ports",
      recovered?.apiPort === apiPort && recovered?.cdpPort === deadCdpPort,
      JSON.stringify(recovered)
    );

    if (typeof recovered?.pid === "number") {
      try { execFileSync("taskkill", ["/PID", String(recovered.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ }
    }
    killTree(child);
    await sleep(300);
  }
}

try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* best effort */ }
console.log(failed ? `\nT35: ${failed} check(s) FAILED` : "\nT35: all checks passed");
process.exit(failed ? 1 : 0);
