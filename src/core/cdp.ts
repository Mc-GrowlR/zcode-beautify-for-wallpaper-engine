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
  var runBootstrap = function() {
  if (!window.__zcodeBeautify) window.__zcodeBeautify = {};
  var VIDEO_SRC = ${JSON.stringify(videoSrc)};
  var WP_IMG = ${JSON.stringify(payload.wallpaperDataUri ?? "")};
  // State alone is not proof the DOM work succeeded: an earlier run may have
  // died halfway (e.g. aborted mid-transition) leaving state set but no style
  // element — without the element check every later injection would silently
  // no-op and the page would never heal.
  if (window.__zcodeBeautify.cssText === ${JSON.stringify(payload.css)} && window.__zcodeBeautify.videoSrc === VIDEO_SRC && window.__zcodeBeautify.wpImg === WP_IMG && document.getElementById(MARKER + '-style')) return;
  window.__zcodeBeautify.cssText = ${JSON.stringify(payload.css)};
  window.__zcodeBeautify.videoSrc = VIDEO_SRC;
  window.__zcodeBeautify.wpImg = WP_IMG;

  var style = document.getElementById(MARKER + '-style');
  if (!style) {
    style = document.createElement('style');
    style.id = MARKER + '-style';
    (document.head || document.documentElement).appendChild(style);
  }
  // Theme CSS (Monet palette) invalidates the WHOLE document's styles; applying
  // it mid-animation costs a 50-80ms main-thread task that stutters the effect.
  // When a transition plays, the swap is deferred to the promote step; instant
  // switches apply it right away. Base wallpaper rules are identical between
  // injections, so holding the old content for one transition is safe.
  var CSS_TEXT = ${JSON.stringify(payload.css)};
  var cssDeferred = false;

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

  // Retiring a video pauses and hides it but leaves the element in the DOM:
  // detaching a video's compositor surface mid-transition makes Windows flash
  // a black rectangle on screen (invisible to CDP captures, very visible to
  // the user). The retired element is swept at the START of the next switch,
  // when the fresh transition masks any surface churn.
  var retireVideo = function(v) {
    if (!v) return;
    v.removeAttribute('id');
    try { v.pause(); } catch (e) {}
    v.style.opacity = '0';
    v.style.pointerEvents = 'none';
    v.dataset.zbRetired = '1';
  };
  if (wp) {
    var strays = wp.querySelectorAll('video');
    for (var si = 0; si < strays.length; si++) {
      var sv = strays[si];
      if (sv.id !== MARKER + '-video' || sv.dataset.zbRetired) sv.remove();
    }
  }

  if (!HAS_NEW) {
    if (wp) wp.remove();
  } else {
    var oldVid = document.getElementById(MARKER + '-video');
    var oldImg = wp.style.backgroundImage && wp.style.backgroundImage !== 'none';
    var animate = Boolean((oldVid || oldImg) && TRANSITION !== 'none');

    // The image transition runs on a temporary overlay div. Videos NEVER live
    // in that overlay: promote would have to reparent the <video> into the
    // wallpaper layer, and reparenting (or removing) a playing video rebuilds
    // its compositor surface — the black flash this whole block exists to
    // avoid. A transition video is born inside the wallpaper layer, parked at
    // opacity 0, and the effect animation runs on the element itself.
    var holder = null;
    var vidBase = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
    var vidFx = '';
    if (animate) {
      cssDeferred = true; // theme swap moves to promote(); see CSS_TEXT above
      if (TRANSITION === 'slide') {
        vidFx = 'animation:' + MARKER + '-fx-slide 650ms cubic-bezier(.22,.61,.36,1) forwards;';
      } else if (TRANSITION === 'zoom') {
        vidFx = 'opacity:0;animation:' + MARKER + '-fx-zoom 650ms ease forwards;';
      } else if (TRANSITION === 'blur') {
        vidFx = 'opacity:0;animation:' + MARKER + '-fx-blur 650ms ease forwards;';
      } else {
        vidFx = 'opacity:0;animation:' + MARKER + '-fx-fade 650ms ease forwards;';
      }
      if (!VIDEO_SRC) {
        holder = document.createElement('div');
        holder.id = MARKER + '-fade';
        // Parked invisible at first; the animation css (below) is applied only
        // once the new content has decoded, so decoder spin-up long tasks land
        // while the screen is still static instead of stuttering the motion.
        // CSS animations (compositor-driven for opacity/transform) instead of
        // JS-started transitions: throttled/occluded renderers never fire rAF
        // and delay timers past 1s — animations keep running.
        var fxBase = 'position:absolute;inset:0;background-size:inherit;background-position:inherit;background-repeat:inherit;';
        var fxAnim = vidFx;
        holder.style.cssText = fxBase + 'opacity:0;';
      }
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
      if (holder) wp.appendChild(holder);
    }

    var newVid = null;
    if (VIDEO_SRC) {
      var nv = document.createElement('video');
      nv.setAttribute('autoplay', '');
      nv.setAttribute('loop', '');
      nv.setAttribute('muted', '');
      nv.setAttribute('playsinline', '');
      nv.muted = true;
      // Born in the wallpaper layer — its final home. An instant switch takes
      // the official id right away; an animated one stays anonymous and
      // parked at opacity 0 until promote hands the id over.
      nv.style.cssText = vidBase + (animate ? 'opacity:0;' : '');
      nv.setAttribute('src', VIDEO_SRC);
      nv.load();
      wp.appendChild(nv);
      nv.play().catch(function() {});
      newVid = nv;
      if (!animate) {
        retireVideo(document.getElementById(MARKER + '-video'));
        nv.id = MARKER + '-video';
      }
    } else if (${JSON.stringify(Boolean(payload.wallpaperDataUri))}) {
      if (!holder) holder = wp; // instant image switch paints the main layer directly
      holder.style.backgroundImage = 'url(' + ${JSON.stringify(payload.wallpaperDataUri ?? "")} + ')';
    }

    if (animate) {
      var overlay = holder; // null for video switches: the video animates itself
      var done = false;
      var started = false;
      var promote = function() {
        if (done) return;
        done = true;
        window.__zcodeBeautify.finishFade = null;
        style.textContent = CSS_TEXT; // deferred theme swap — motion is over
        // The outgoing video is retired, not removed — see retireVideo.
        retireVideo(document.getElementById(MARKER + '-video'));
        if (VIDEO_SRC) {
          wp.style.backgroundImage = 'none';
          if (newVid) {
            newVid.id = MARKER + '-video';
            // Settle in place (opacity 1, animation styles dropped). No DOM
            // move: reparenting would rebuild the video surface.
            newVid.style.cssText = vidBase;
            newVid.play().catch(function() {});
          }
        } else if (overlay && overlay.parentNode) {
          wp.style.backgroundImage = overlay.style.backgroundImage;
          overlay.remove();
        }
      };
      window.__zcodeBeautify.finishFade = promote;
      var startAnim = function() {
        if (started || done) return;
        started = true;
        if (overlay) {
          // cssText is replaced wholesale to arm the animation — the parked
          // background image (set before parking) must survive that swap, or
          // the effect animates an empty layer and promote clears the wallpaper
          // (every other image click failed exactly this way).
          var parkedBg = overlay.style.backgroundImage;
          overlay.style.cssText = fxBase + fxAnim;
          overlay.style.backgroundImage = parkedBg;
          overlay.addEventListener('animationend', promote);
        } else if (newVid) {
          newVid.style.cssText = vidBase + vidFx;
          newVid.addEventListener('animationend', promote);
        }
        setTimeout(promote, 780);
      };
      // Warm the new content first: video waits for its first decoded frame
      // (loadeddata) AND one presented frame (requestVideoFrameCallback) —
      // the compositor must already hold the first frame before the animation
      // exposes the layer, or the effect fades in a black video surface.
      // Images wait for decode(). A timeout keeps the switch landing even if
      // an event never fires (throttled renderers stall rvfc too).
      if (newVid) {
        var budget = setTimeout(startAnim, 900);
        var onFrame = function() { clearTimeout(budget); startAnim(); };
        var onReady = function() {
          if (typeof newVid.requestVideoFrameCallback === 'function') {
            newVid.requestVideoFrameCallback(function() { onFrame(); });
          } else onFrame();
        };
        if (newVid.readyState >= 2) onReady();
        else newVid.addEventListener('loadeddata', onReady);
      } else {
        var im = new Image();
        var imSrc = overlay.style.backgroundImage.replace(/^url\\(["']?/, '').replace(/["']?\\)$/, '');
        var warm = function() { if (im.decode) im.decode().then(startAnim, startAnim); else startAnim(); };
        im.onload = warm;
        im.onerror = startAnim;
        im.src = imSrc;
        setTimeout(startAnim, 600);
      }
    }
  }

  if (!cssDeferred) style.textContent = CSS_TEXT;

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
  };
  // The addScriptToEvaluateOnNewDocument registration replays at document
  // creation, where documentElement is still null — appending the style or
  // wallpaper there throws and kills the run before anything mounts. Wait
  // for the parser to produce a root element (a few ms at most).
  if (document.documentElement) runBootstrap();
  else {
    var zbWaitMount = function() {
      if (document.documentElement) runBootstrap();
      else setTimeout(zbWaitMount, 10);
    };
    zbWaitMount();
  }
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
