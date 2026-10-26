// Minimal CDP (Chrome DevTools Protocol) client for beautifying Electron apps.
// Zero dependencies, Node.js >= 20 (global fetch + WebSocket).
//
//   import { launchAndWait, listTargets, pickRenderer, connect, send, evaluate } from './cdp-minimal.mjs';
//   await launchAndWait('C:/Program Files/<App>/<App>.exe', 9222);
//   const target = pickRenderer(await listTargets(9222));
//   const ws = await connect(target.webSocketDebuggerUrl);
//   await send(ws, 'Page.enable');
//   await evaluate(ws, 'document.title');
//
// On Node < 22 install `ws` and replace the global WebSocket constructor.

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let nextId = 0;

// --- launch -----------------------------------------------------------------

/**
 * Spawns the Electron app with the CDP debug port and waits until the endpoint
 * answers. Guards against the single-instance lock:
 *   - refuses when a process of the same executable is already running;
 *   - re-checks the port 2s after first contact, because a second instance
 *     binds the port briefly, forwards its args to the first instance and
 *     exits — a naive poll would mistake that for success.
 */
export async function launchAndWait(exePath, port, { timeoutMs = 20000 } = {}) {
  try {
    await listTargets(port);
    throw new Error(`CDP already reachable on port ${port} — nothing to launch.`);
  } catch (err) {
    if (err instanceof CdpUnreachable) { /* expected: not running yet */ }
    else throw err;
  }

  if (await isProcessRunning(exePath)) {
    throw new Error(
      `${exePath} is already running without the debug port. Quit it completely, then launch again.`
    );
  }

  const child = spawn(exePath, [`--remote-debugging-port=${port}`], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await sleep(500);
    try {
      await listTargets(port);
      break;
    } catch {
      if (Date.now() > deadline) {
        throw new Error(`CDP endpoint did not come up on port ${port} within ${timeoutMs}ms.`);
      }
    }
  }

  // Single-instance race window: the second instance binds the port, forwards
  // its args to the first instance and exits, closing the port again.
  await sleep(2000);
  try {
    await listTargets(port);
  } catch {
    throw new Error(
      "CDP came up but closed again — another instance took over via the single-instance lock. " +
        "Quit the app completely and launch again."
    );
  }
}

async function isProcessRunning(exePath) {
  const name = exePath.split(/[\\/]/).pop();
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("tasklist", ["/NH", "/FI", `IMAGENAME eq ${name}`]);
      return stdout.toLowerCase().includes(name.toLowerCase());
    }
    const { stdout } = await execFileAsync("pgrep", ["-x", name.replace(/\.exe$/i, "")]);
    return stdout.trim().length > 0;
  } catch {
    return false; // pgrep exits non-zero when nothing matches
  }
}

// --- discovery --------------------------------------------------------------

export class CdpUnreachable extends Error {}

export async function listTargets(port, host = "127.0.0.1") {
  let res;
  try {
    res = await fetch(`http://${host}:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
  } catch {
    throw new CdpUnreachable(`CDP not reachable at ${host}:${port}`);
  }
  if (!res.ok) throw new Error(`CDP /json/list returned HTTP ${res.status}`);
  return res.json();
}

/** The main window renderer: a page target with a debugger URL, not devtools. */
export function pickRenderer(targets) {
  const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  return pages.find((t) => !t.url.includes("devtools://")) ?? pages[0];
}

// --- connection -------------------------------------------------------------

export function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", () => reject(new Error(`WebSocket connect failed: ${wsUrl}`)), { once: true });
  });
}

export function send(ws, method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const onMessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== id) return;
      ws.removeEventListener("message", onMessage);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

export async function evaluate(ws, expression) {
  const result = await send(ws, "Runtime.evaluate", { expression, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "evaluate failed");
  }
  return result.result?.value;
}

/**
 * Registers a bootstrap script that survives renderer reloads AND runs it now.
 * KEEP THE RETURNED SOCKET OPEN: the registration lives in the CDP session.
 */
export async function injectPersistent(wsUrl, bootstrapScript) {
  const ws = await connect(wsUrl);
  await send(ws, "Page.enable");
  await send(ws, "Page.addScriptToEvaluateOnNewDocument", { source: bootstrapScript });
  await evaluate(ws, bootstrapScript);
  return ws;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
