/**
 * Minimal Chrome DevTools Protocol client for the ZCode desktop renderer.
 *
 * ZCode (production) starts without a debug port; the launcher must start it
 * with `--remote-debugging-port=<port>` before this module can connect.
 */

export interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

export class CdpError extends Error {}

export async function listTargets(port: number, host = "127.0.0.1"): Promise<CdpTarget[]> {
  let res: Response;
  try {
    res = await fetch(`http://${host}:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
  } catch {
    throw new CdpError(`Cannot reach CDP at ${host}:${port} — is ZCode running with --remote-debugging-port=${port}?`);
  }
  if (!res.ok) throw new CdpError(`CDP /json/list returned HTTP ${res.status}`);
  return (await res.json()) as CdpTarget[];
}

/** The main chat window renderer; excludes helper pages and overlay panels. */
export function pickRendererTargets(targets: CdpTarget[]): CdpTarget[] {
  const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  const main = pages.filter(
    (t) => t.url.includes("out/renderer/index.html") || t.title === "ZCode"
  );
  return main.length > 0 ? main : pages.filter((t) => !t.url.includes("devtools://"));
}

export class CdpConnection {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private eventHandlers = new Map<string, Set<(params: any) => void>>();
  readonly targetUrl: string;

  private constructor(wsUrl: string) {
    this.targetUrl = wsUrl;
    this.ws = new WebSocket(wsUrl);
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new CdpError(`${msg.error.message} (code ${msg.error.code})`));
          else p.resolve(msg.result);
        }
      } else if (msg.method) {
        this.eventHandlers.get(msg.method)?.forEach((h) => h(msg.params));
      }
    });
    this.ws.addEventListener("close", () => {
      for (const p of this.pending.values()) p.reject(new CdpError("CDP connection closed"));
      this.pending.clear();
    });
  }

  static connect(wsUrl: string): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const conn = new CdpConnection(wsUrl);
      const timer = setTimeout(() => reject(new CdpError("CDP websocket connect timeout")), 5000);
      conn.ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(conn);
      });
      conn.ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new CdpError(`CDP websocket error for ${wsUrl}`));
      });
    });
  }

  get isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event: string, handler: (params: any) => void): void {
    let set = this.eventHandlers.get(event);
    if (!set) this.eventHandlers.set(event, (set = new Set()));
    set.add(handler);
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

export interface InjectionPayload {
  /** CSS text covering :root/.dark variable overrides + wallpaper layer styling. */
  css: string;
  /** Optional data-URI wallpaper image; empty to skip the wallpaper layer. */
  wallpaperDataUri?: string;
  /**
   * Optional scene-wallpaper loop video URL (http://127.0.0.1 from serve).
   * Rendered as a <video> inside the wallpaper layer container: file:/// URLs
   * are unreliable in the renderer, and a 1080p data URI would blow the
   * localStorage quota, so scene videos skip persistence entirely.
   */
  videoSrc?: string;
  /** Unique-ish id so re-injection is idempotent. */
  marker?: string;
  /** "contain" additionally drives a blurred backdrop layer behind the image. */
  fit?: "cover" | "contain";
  /** Switching effect played by the transition overlay (default "fade"). */
  transition?: string;
}

/**
 * Injects CSS + a persistence script into one renderer target. The script is
 * registered via Page.addScriptToEvaluateOnNewDocument so it survives reloads
 * for as long as this CDP session lives.
 */
export async function injectIntoTarget(
  target: CdpTarget,
  payload: InjectionPayload
): Promise<void> {
  const conn = await CdpConnection.connect(target.webSocketDebuggerUrl!);
  try {
    await conn.send("Page.enable");
    await conn.send("Runtime.enable");
    const bootstrap = buildBootstrapScript(payload);
    await conn.send("Page.addScriptToEvaluateOnNewDocument", { source: bootstrap });
    await conn.send("Runtime.evaluate", {
      expression: bootstrap,
      returnByValue: true,
    });
  } finally {
    conn.close();
  }
}

export function buildBootstrapScript(payload: InjectionPayload): string {
  const marker = payload.marker ?? "zcode-beautify";
  const videoSrc = payload.videoSrc ?? "";
  return `(function(){
  var MARKER = ${JSON.stringify(marker)};
  if (!window.__zcodeBeautify) window.__zcodeBeautify = {};
  var VIDEO_SRC = ${JSON.stringify(videoSrc)};
  var WP_IMG = ${JSON.stringify(payload.wallpaperDataUri ?? "")};
  if (window.__zcodeBeautify.cssText === ${JSON.stringify(payload.css)} && window.__zcodeBeautify.videoSrc === VIDEO_SRC && window.__zcodeBeautify.wpImg === WP_IMG) return;
  window.__zcodeBeautify.cssText = ${JSON.stringify(payload.css)};
  window.__zcodeBeautify.videoSrc = VIDEO_SRC;
  window.__zcodeBeautify.wpImg = WP_IMG;

  var style = document.getElementById(MARKER + '-style');
  if (!style) {
    style = document.createElement('style');
    style.id = MARKER + '-style';
    (document.head || document.documentElement).appendChild(style);
  }
  style.textContent = ${JSON.stringify(payload.css)};

  // --- wallpaper application with transition effect --------------------------
  // The OLD content stays visible while a temporary overlay carrying the NEW
  // wallpaper animates in on top; on completion the new content is promoted
  // into the main layer and the overlay removed. TRANSITION picks the effect:
  // fade (crossfade), slide (new wallpaper sweeps in from the right), zoom
  // (scales down while fading in), blur (sharpens while fading in), or none
  // (instant swap). The first injection (nothing on screen yet) and every
  // change from a blank state apply instantly. The overlay is a plain child
  // of the wallpaper layer, so the ::after dim mask keeps painting above it.
  var wp = document.getElementById(MARKER + '-wallpaper');
  var HAS_NEW = ${JSON.stringify(Boolean(payload.wallpaperDataUri))} || VIDEO_SRC;
  var TRANSITION = ${JSON.stringify(payload.transition ?? "fade")};
  if (HAS_NEW && !wp) {
    wp = document.createElement('div');
    wp.id = MARKER + '-wallpaper';
    document.documentElement.appendChild(wp);
  }
  // A transition still in flight (rapid switches) is promoted immediately
  // first so only one overlay ever exists.
  if (window.__zcodeBeautify.finishFade) window.__zcodeBeautify.finishFade();

  if (!HAS_NEW) {
    if (wp) wp.remove();
  } else {
    var oldVid = document.getElementById(MARKER + '-video');
    var oldImg = wp.style.backgroundImage && wp.style.backgroundImage !== 'none';
    var animate = Boolean((oldVid || oldImg) && TRANSITION !== 'none');

    var holder = wp;
    if (animate) {
      holder = document.createElement('div');
      holder.id = MARKER + '-fade';
      // CSS animations (compositor-driven for opacity/transform) instead of
      // JS-started transitions: throttled/occluded renderers never fire rAF
      // and delay timers past 1s — animations keep running.
      var fxBase = 'position:absolute;inset:0;background-size:inherit;background-position:inherit;background-repeat:inherit;';
      var fxAnim;
      if (TRANSITION === 'slide') {
        fxAnim = 'animation:' + MARKER + '-fx-slide 650ms cubic-bezier(.22,.61,.36,1) forwards;';
      } else if (TRANSITION === 'zoom') {
        fxAnim = 'opacity:0;animation:' + MARKER + '-fx-zoom 650ms ease forwards;';
      } else if (TRANSITION === 'blur') {
        fxAnim = 'opacity:0;animation:' + MARKER + '-fx-blur 650ms ease forwards;';
      } else {
        fxAnim = 'opacity:0;animation:' + MARKER + '-fx-fade 650ms ease forwards;';
      }
      holder.style.cssText = fxBase + fxAnim;
      if (!document.getElementById(MARKER + '-fade-style')) {
        var fs = document.createElement('style');
        fs.id = MARKER + '-fade-style';
        fs.textContent = ''
          + '@keyframes ' + MARKER + '-fx-fade { from { opacity: 0; } to { opacity: 1; } }'
          + '@keyframes ' + MARKER + '-fx-slide { from { transform: translateX(100%); } to { transform: translateX(0); } }'
          + '@keyframes ' + MARKER + '-fx-zoom { from { opacity: 0; transform: scale(1.15); } to { opacity: 1; transform: scale(1); } }'
          + '@keyframes ' + MARKER + '-fx-blur { from { opacity: 0; filter: blur(24px); } to { opacity: 1; filter: blur(0px); } }';
        (document.head || document.documentElement).appendChild(fs);
      }
      wp.appendChild(holder);
    }

    if (VIDEO_SRC) {
      holder.style.backgroundImage = 'none';
      var nv = document.createElement('video');
      nv.setAttribute('autoplay', '');
      nv.setAttribute('loop', '');
      nv.setAttribute('muted', '');
      nv.setAttribute('playsinline', '');
      nv.muted = true;
      nv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
      nv.setAttribute('src', VIDEO_SRC);
      nv.load();
      holder.appendChild(nv);
      nv.play().catch(function() {});
    } else if (${JSON.stringify(Boolean(payload.wallpaperDataUri))}) {
      holder.style.backgroundImage = 'url(' + ${JSON.stringify(payload.wallpaperDataUri ?? "")} + ')';
    }

    if (animate) {
      var overlay = holder;
      var done = false;
      var promote = function() {
        if (done) return;
        done = true;
        window.__zcodeBeautify.finishFade = null;
        var o = overlay;
        if (!o.parentNode) return;
        var prevVid = document.getElementById(MARKER + '-video');
        if (prevVid) prevVid.remove();
        if (VIDEO_SRC) {
          var v = o.querySelector('video');
          wp.style.backgroundImage = 'none';
          if (v) {
            v.id = MARKER + '-video';
            wp.appendChild(v);
            v.play().catch(function() {});
          }
        } else {
          wp.style.backgroundImage = o.style.backgroundImage;
        }
        o.remove();
      };
      window.__zcodeBeautify.finishFade = promote;
      overlay.addEventListener('animationend', promote);
      setTimeout(promote, 780);
    } else if (VIDEO_SRC) {
      var v0 = holder.querySelector('video');
      if (v0) v0.id = MARKER + '-video';
    }
  }

  var FIT = ${JSON.stringify(payload.fit ?? "cover")};
  var bp = document.getElementById(MARKER + '-backdrop');
  if (FIT === 'contain' && ${JSON.stringify(Boolean(payload.wallpaperDataUri))}) {
    if (!bp) {
      bp = document.createElement('div');
      bp.id = MARKER + '-backdrop';
      document.documentElement.appendChild(bp);
    }
    bp.style.backgroundImage = 'url(' + ${JSON.stringify(payload.wallpaperDataUri ?? "")} + ')';
    bp.dataset.on = '1';
  } else if (bp) {
    bp.dataset.on = '0';
  }

  // Keep the loop alive. Chromium's media suspension can freeze a nominally
  // playing wallpaper video (paused:false but the clock stops — occlusion
  // misdetection is common with transparent Electron windows), so a watchdog
  // samples currentTime and kicks the element whenever the page is visible
  // but the clock is frozen, paused, or ended.
  if (!window.__zcodeBeautify.visBound) {
    window.__zcodeBeautify.visBound = true;
    document.addEventListener('visibilitychange', function() {
      var v = document.getElementById(MARKER + '-video');
      if (!v) return;
      if (document.hidden) { v.pause(); } else { v.play().catch(function() {}); }
    });
    window.addEventListener('focus', function() {
      var v = document.getElementById(MARKER + '-video');
      if (v) v.play().catch(function() {});
    });
    window.addEventListener('pageshow', function() {
      var v = document.getElementById(MARKER + '-video');
      if (v) v.play().catch(function() {});
    });
  }
  if (!window.__zcodeBeautify.watchdog) {
    window.__zcodeBeautify.stallCount = 0;
    window.__zcodeBeautify.lastClock = -1;
    window.__zcodeBeautify.watchdog = setInterval(function() {
      var v = document.getElementById(MARKER + '-video');
      if (!v) return;
      var S = window.__zcodeBeautify;
      if (document.hidden) { S.lastClock = -1; return; }
      if (v.ended || (v.paused && v.autoplay)) {
        S.stallCount = 0;
        v.play().catch(function() {});
      } else if (!v.paused && v.readyState >= 2 && S.lastClock === v.currentTime) {
        // nominally playing but the media clock is frozen
        S.stallCount++;
        if (S.stallCount >= 2) { v.load(); }
        v.play().catch(function() {});
      } else {
        S.stallCount = 0;
      }
      S.lastClock = v.currentTime;
    }, 2000);
  }

  // Persist for the panel's self-heal path (best effort; large wallpapers may
  // exceed the localStorage quota, in which case only the CSS is saved).
  // Scene videos are never persisted: the src is a serve URL and the loop
  // file itself would blow the quota.
  try {
    localStorage.setItem(MARKER + ':css', ${JSON.stringify(payload.css)});
    localStorage.setItem(MARKER + ':wallpaper', ${JSON.stringify(payload.wallpaperDataUri ?? "")});
  } catch (e) {}
})();`;
}

/** Removes everything the bootstrap script created. */
export function buildResetScript(marker = "zcode-beautify"): string {
  return `(function(){
  document.getElementById(${JSON.stringify(marker)} + '-style')?.remove();
  document.getElementById(${JSON.stringify(marker)} + '-fade-style')?.remove();
  document.getElementById(${JSON.stringify(marker)} + '-wallpaper')?.remove();
  document.getElementById(${JSON.stringify(marker)} + '-backdrop')?.remove();
  if (window.__zcodeBeautify) { window.__zcodeBeautify.cssText = null; window.__zcodeBeautify.videoSrc = null; window.__zcodeBeautify.wpImg = null; window.__zcodeBeautify.finishFade = null; }
})();`;
}
