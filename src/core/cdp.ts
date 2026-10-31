/**
 * Minimal Chrome DevTools Protocol client for the target desktop renderer.
 *
 * Production builds start without a debug port; the launcher must start the
 * app with `--remote-debugging-port=<port>` before this module can connect.
 */

import { bubbleRecipes, rewriteCustomBubbleCss, BUBBLE_SELECTOR_REAL, BUBBLE_ROW_SELECTOR_REAL } from "./bubbleRecipes.js";
import { TARGETS, target, type AppTarget } from "./target.js";
// Type-only: erased at compile time, so no runtime cycle with inject.js.
import type { BubbleLookConfig } from "./inject.js";

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
    const app = target();
    throw new CdpError(
      `Cannot reach CDP at ${host}:${port} — is ${app.appName} running with --remote-debugging-port=${port}?`
    );
  }
  if (!res.ok) throw new CdpError(`CDP /json/list returned HTTP ${res.status}`);
  return (await res.json()) as CdpTarget[];
}

/** The main chat window renderer; excludes helper pages and overlay panels. */
export function pickRendererTargets(targets: CdpTarget[], app: AppTarget = target()): CdpTarget[] {
  const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  const main = pages.filter(
    (t) =>
      app.rendererUrlIncludes.some((frag) => t.url.includes(frag)) ||
      app.rendererTitles.includes(t.title)
  );
  if (main.length > 0) return main;
  // Fallback for dev builds / renamed bundles: any page that is not another
  // known client's renderer. Without this, a WorkBuddy target could grab the
  // ZCode window (both URLs contain "renderer/index.html") and repaint it
  // with the wrong token family.
  const others = Object.values(TARGETS).filter((t) => t.id !== app.id);
  const isForeign = (url: string) =>
    others.some((o) => o.rendererUrlIncludes.some((frag) => url.includes(frag)));
  return pages.filter((t) => !t.url.includes("devtools://") && !isForeign(t.url));
}

/**
 * The app's update-status window (download/install progress dialog): the same
 * renderer page with `windowKind=update-status` in the query. Beautifying it
 * is opt-in (config.showOnUpdater) — by default the plugin leaves it stock.
 */
export function isUpdaterTarget(t: { url?: string }): boolean {
  const markers = ((): string[] => {
    try {
      return target().updaterUrlIncludes;
    } catch {
      return ["windowKind=update-status"];
    }
  })();
  return typeof t.url === "string" && markers.some((m) => m && t.url!.includes(m));
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
  /** Slow pan/zoom breathing on a static image wallpaper (Ken Burns). */
  kenBurns?: boolean;
  /** Video wallpaper audio 0-100 (0/absent = muted). */
  videoVolume?: number;
  /** Zone-refined chat-area masks + column width (聊天界面); absent = stock. */
  chatLook?: { chatDim: number; maskTop: number; maskBottom: number; frost: number; widthCapRem: number; widthInsetRem: number; perfSmooth: number; hideElapsedDecimal: number; dragResize: number };
  /** User message bubble look (聊天气泡); absent/preset default = stock. */
  bubbleLook?: BubbleLookConfig;
  /**
   * Session-list running indicator look (运行中图标); `image` is the already
   * resolved paint URL. absent/mode "default" = stock spinner.
   */
  spinnerLook?: { mode: "default" | "image"; image: string; spin: boolean; size: number };
  /** Defer mounting until the app's startup screen finished (default true). */
  startupClean?: boolean;
  /** False when the client has no chat-area extras wired (non-ZCode targets). */
  chatUi?: boolean;
  /** Startup-screen probe flavour; defaults to zcode's body-class check. */
  startupProbe?: "zcode-body-class" | "workbuddy-skeleton";
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
    // Runtime.evaluate does NOT reject when the script throws — surface it or
    // a broken bootstrap (e.g. a fast path hitting a late-initialized var)
    // fails silently while applyToZCode reports success.
    const evalResult = await conn.send("Runtime.evaluate", {
      expression: bootstrap,
      returnByValue: true,
    });
    if (evalResult?.exceptionDetails) {
      throw new Error(
        `bootstrap threw in "${target.title}": ${JSON.stringify(evalResult.exceptionDetails).slice(0, 400)}`
      );
    }
  } finally {
    conn.close();
  }
}

export function buildBootstrapScript(payload: InjectionPayload): string {
  const marker = payload.marker ?? "zcode-beautify";
  const videoSrc = payload.videoSrc ?? "";
  return `(function(){
  var MARKER = ${JSON.stringify(marker)};
  var STARTUP_CLEAN = ${JSON.stringify(payload.startupClean !== false)};
  var CHAT_UI = ${JSON.stringify(payload.chatUi !== false)};
  var PROBE = ${JSON.stringify(payload.startupProbe ?? "zcode-body-class")};
  // The startup screen phase (body carries zcode-startup-* but not yet
  // -ready, or WorkBuddy still shows its skeleton overlay) covers the window
  // with loading art — a wallpaper layer and the panel FAB on top of it look
  // broken. With startupClean the whole bootstrap (and the panel) waits for
  // the app shell; without it everything mounts at once.
  var inStartupScreen = function() {
    if (!document.body) return true;
    if (PROBE === 'workbuddy-skeleton') {
      var sk = document.querySelector('#sk-overlay, #skeleton-root');
      if (sk && sk.offsetParent !== null && (sk.textContent || '').length > 0) return true;
      var root = document.querySelector('#root');
      return !root || root.childElementCount === 0;
    }
    var cls = document.body.className || '';
    return /zcode-startup/.test(cls) && !/ready/.test(cls);
  };
  var runBootstrapBody = function() {
  if (!window.__zcodeBeautify) window.__zcodeBeautify = {};
  var VIDEO_SRC = ${JSON.stringify(videoSrc)};
  var WP_IMG = ${JSON.stringify(payload.wallpaperDataUri ?? "")};
  var VOL = Math.max(0, Math.min(100, Math.round(${JSON.stringify(payload.videoVolume ?? 0)})));
  var CHAT = ${JSON.stringify(JSON.stringify(payload.chatLook ?? { chatDim: 0, maskTop: 0, maskBottom: 0, frost: 0, widthCapRem: 0, widthInsetRem: 0, perfSmooth: 0, hideElapsedDecimal: 0, dragResize: 0 }))};
  var BUBBLE = ${JSON.stringify(JSON.stringify(payload.bubbleLook ?? { preset: "default", tint: 28, radius: 12, width: 70, align: "right" }))};
  var SPIN = ${JSON.stringify(JSON.stringify(payload.spinnerLook ?? { mode: "default", image: "", spin: true, size: 16 }))};
  // Bubble recipe tables must be initialized HERE, before the fast paths run:
  // applyBubbleLook() is reachable from the volume fast path at the top of
  // this function body, and var initializers down below would still be
  // undefined at that point (undefined[preset] throws and kills the whole
  // bootstrap silently).
  var BUB = '[data-v4-user-input-bubble]';
  var BUB_ROW = '[class~="group/user-row"]';
  // --zb-bubble-tint holds 0-1; the mixes scale it back to a percentage.
  // Recipes + custom CSS are baked serve-side from core/bubbleRecipes.ts so
  // this table and the panel preview share one source of truth. The custom
  // CSS arrives already sanitized and rewritten to the real selectors.
  var RECIPES = ${JSON.stringify(bubbleRecipes(BUBBLE_SELECTOR_REAL))};
  var CUSTOM_CSS = ${JSON.stringify(rewriteCustomBubbleCss(payload.bubbleLook?.customCss ?? "", BUBBLE_SELECTOR_REAL, BUBBLE_ROW_SELECTOR_REAL))};
  // Volume-only fast path: changing just the audio must not rebuild the
  // video (instant switch would retire + re-create the decoder). VOL must be
  // declared ABOVE this block — it used to sit below the fast path, which
  // therefore read undefined, unmuted the video and wrote NaN volume (the
  // serve-side volume re-evaluate fallback was masking exactly this).
  if (VIDEO_SRC && VOL !== (window.__zcodeBeautify.vol ?? 0)
      && window.__zcodeBeautify.cssText === ${JSON.stringify(payload.css)}
      && window.__zcodeBeautify.videoSrc === VIDEO_SRC
      && window.__zcodeBeautify.kb === ${JSON.stringify(Boolean(payload.kenBurns))}) {
    var liveVid = document.getElementById(MARKER + '-video');
    if (liveVid) {
      liveVid.muted = VOL === 0;
      liveVid.volume = VOL / 100;
      liveVid.play().catch(function() {});
    }
    window.__zcodeBeautify.vol = VOL;
    if (window.__zcodeBeautify.chatKey !== CHAT) {
      window.__zcodeBeautify.chatKey = CHAT;
      applyChatLook();
    }
    if (window.__zcodeBeautify.bubbleKey !== BUBBLE) {
      window.__zcodeBeautify.bubbleKey = BUBBLE;
      applyBubbleLook();
    }
    if (window.__zcodeBeautify.spinnerKey !== SPIN) {
      window.__zcodeBeautify.spinnerKey = SPIN;
      applySpinnerLook();
    }
    return;
  }

  // Chat-look fast path: the zone masks are standalone CSS-var layers, so a
  // slider drag must not replay the wallpaper transition. When ONLY the chat
  // look changed (wallpaper state identical + style element alive), apply it
  // and bail before any wallpaper work.
  if (window.__zcodeBeautify.chatKey !== CHAT) {
    var chatOnly = window.__zcodeBeautify.cssText === ${JSON.stringify(payload.css)}
      && window.__zcodeBeautify.videoSrc === VIDEO_SRC
      && window.__zcodeBeautify.wpImg === WP_IMG
      && window.__zcodeBeautify.kb === ${JSON.stringify(Boolean(payload.kenBurns))}
      && window.__zcodeBeautify.vol === VOL
      && window.__zcodeBeautify.bubbleKey === BUBBLE
      && window.__zcodeBeautify.spinnerKey === SPIN
      && document.getElementById(MARKER + '-style');
    window.__zcodeBeautify.chatKey = CHAT;
    applyChatLook();
    if (chatOnly) return;
  }

  // Bubble-look fast path (same shape as chat): the bubble rules live in
  // their own style element driven by --zb-bubble-* vars, so preset/slider
  // tweaks never touch the wallpaper layer.
  if (window.__zcodeBeautify.bubbleKey !== BUBBLE) {
    var bubbleOnly = window.__zcodeBeautify.cssText === ${JSON.stringify(payload.css)}
      && window.__zcodeBeautify.videoSrc === VIDEO_SRC
      && window.__zcodeBeautify.wpImg === WP_IMG
      && window.__zcodeBeautify.kb === ${JSON.stringify(Boolean(payload.kenBurns))}
      && window.__zcodeBeautify.vol === VOL
      && window.__zcodeBeautify.chatKey === CHAT
      && window.__zcodeBeautify.spinnerKey === SPIN
      && document.getElementById(MARKER + '-style');
    window.__zcodeBeautify.bubbleKey = BUBBLE;
    applyBubbleLook();
    if (bubbleOnly) return;
  }

  // Spinner-look fast path: the running-indicator rules live in their own
  // style element, so swapping the sidebar spinner image never replays the
  // wallpaper transition either. bubbleOnly above already refuses to bail
  // while the spinner changed, so a combined push lands both.
  if (window.__zcodeBeautify.spinnerKey !== SPIN) {
    var spinnerOnly = window.__zcodeBeautify.cssText === ${JSON.stringify(payload.css)}
      && window.__zcodeBeautify.videoSrc === VIDEO_SRC
      && window.__zcodeBeautify.wpImg === WP_IMG
      && window.__zcodeBeautify.kb === ${JSON.stringify(Boolean(payload.kenBurns))}
      && window.__zcodeBeautify.vol === VOL
      && window.__zcodeBeautify.chatKey === CHAT
      && window.__zcodeBeautify.bubbleKey === BUBBLE
      && document.getElementById(MARKER + '-style');
    window.__zcodeBeautify.spinnerKey = SPIN;
    applySpinnerLook();
    if (spinnerOnly) return;
  }

  // State alone is not proof the DOM work succeeded: an earlier run may have
  // died halfway (e.g. aborted mid-transition) leaving state set but no style
  // element — without the element check every later injection would silently
  // no-op and the page would never heal. kb participates too: toggling Ken
  // Burns alone changes no CSS, and without it the toggle would early-return
  // before applyKb ever runs.
  if (window.__zcodeBeautify.cssText === ${JSON.stringify(payload.css)} && window.__zcodeBeautify.videoSrc === VIDEO_SRC && window.__zcodeBeautify.wpImg === WP_IMG && window.__zcodeBeautify.kb === ${JSON.stringify(Boolean(payload.kenBurns))} && window.__zcodeBeautify.vol === VOL && window.__zcodeBeautify.chatKey === CHAT && window.__zcodeBeautify.bubbleKey === BUBBLE && window.__zcodeBeautify.spinnerKey === SPIN && document.getElementById(MARKER + '-style')) return;
  window.__zcodeBeautify.cssText = ${JSON.stringify(payload.css)};
  window.__zcodeBeautify.videoSrc = VIDEO_SRC;
  window.__zcodeBeautify.wpImg = WP_IMG;
  window.__zcodeBeautify.kb = ${JSON.stringify(Boolean(payload.kenBurns))};
  window.__zcodeBeautify.vol = VOL;

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
  var KB_ON = ${JSON.stringify(Boolean(payload.kenBurns))} && !VIDEO_SRC;
  /** Ken Burns breathing on the settled wallpaper layer (image only): the
   *  running animation's transform outranks the stylesheet's static scale,
   *  and the payload only arms it when blur is off, so the two never fight.
   *  Re-assigning the same animation is a no-op — clear + reflow restarts it
   *  so every switch begins the pan from its first keyframe. */
  var applyKb = function(on) {
    if (!wp) return;
    if (!on) {
      wp.style.animation = '';
      return;
    }
    wp.style.animation = 'none';
    void wp.offsetWidth;
    wp.style.animation = MARKER + '-kb 26s ease-in-out infinite alternate';
  };
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
  // when the fresh transition masks any surface churn. Clearing src + load()
  // also RELEASES the hardware decoder session right away — a paused <video>
  // keeps its decoder (and its GPU budget) alive until unloaded.
  var retireVideo = function(v) {
    if (!v) return;
    v.removeAttribute('id');
    try { v.pause(); } catch (e) {}
    try { v.removeAttribute('src'); v.load(); } catch (e) {}
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
    // Keyframes live OUTSIDE the animate branch: applyKb at the tail needs
    // -kb on instant switches too (first apply, transition "none").
    if (!document.getElementById(MARKER + '-fade-style')) {
      var fs = document.createElement('style');
      fs.id = MARKER + '-fade-style';
      fs.textContent = ''
        + '@keyframes ' + MARKER + '-fx-fade { from { opacity: 0; } to { opacity: 1; } }'
        + '@keyframes ' + MARKER + '-fx-slide { from { transform: translateX(100%); } to { transform: translateX(0); } }'
        + '@keyframes ' + MARKER + '-fx-zoom { from { opacity: 0; transform: scale(1.15); } to { opacity: 1; transform: scale(1); } }'
        + '@keyframes ' + MARKER + '-fx-blur { from { opacity: 0; filter: blur(24px); } to { opacity: 1; filter: blur(0px); } }'
        + '@keyframes ' + MARKER + '-kb { from { transform: scale(1) translate(0%, 0%); } to { transform: scale(1.08) translate(-1.6%, -1.1%); } }';
      (document.head || document.documentElement).appendChild(fs);
    }
    var holder = null;
    var vidBase = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
    var vidFx = '';
    // blur(24px) is a per-frame GPU filter over the FULL screen — on a video
    // target it costs far more than the crossfade look justifies. Filter-type
    // effects downgrade to the compositor-cheap fade; transform/opacity ones
    // (slide/zoom) stay.
    var EFFECT = VIDEO_SRC && TRANSITION === 'blur' ? 'fade' : TRANSITION;
    if (animate) {
      cssDeferred = true; // theme swap moves to promote(); see CSS_TEXT above
      if (EFFECT === 'slide') {
        vidFx = 'animation:' + MARKER + '-fx-slide 650ms cubic-bezier(.22,.61,.36,1) forwards;';
      } else if (EFFECT === 'zoom') {
        vidFx = 'opacity:0;animation:' + MARKER + '-fx-zoom 650ms ease forwards;';
      } else if (EFFECT === 'blur') {
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
        wp.appendChild(holder);
      }
    }

    var newVid = null;
    if (VIDEO_SRC) {
      var nv = document.createElement('video');
      // NO autoplay attribute: the element must stay parked until the
      // transition arms (autoplay would start playback on attach and defeat
      // the single-decoder warm-up).
      nv.setAttribute('loop', '');
      nv.setAttribute('playsinline', '');
      // Born in the wallpaper layer — its final home. NOT playing yet: the
      // warm-up only needs the FIRST frame (preload decodes it), so the old
      // wallpaper keeps the only active decoder until the animation starts.
      // Two parallel 1080p decodes during warm-up was a real GPU spike.
      nv.setAttribute('preload', 'auto');
      nv.muted = VOL === 0;
      nv.volume = VOL / 100;
      nv.style.cssText = vidBase + (animate ? 'opacity:0;' : '');
      nv.setAttribute('src', VIDEO_SRC);
      nv.load();
      wp.appendChild(nv);
      newVid = nv;
      if (!animate) {
        retireVideo(document.getElementById(MARKER + '-video'));
        nv.id = MARKER + '-video';
        nv.play().catch(function() {});
        applyKb(false);
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
          applyKb(false);
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
          applyKb(KB_ON);
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
          // Playback starts WITH the animation — the parked element held no
          // decoder session until this exact moment.
          newVid.play().catch(function() {});
          newVid.addEventListener('animationend', promote);
        }
        setTimeout(promote, 780);
      };
      // Warm the new content first: a parked (paused) video needs
      // readyState >= 2 — the first frame decoded and renderable — before the
      // animation exposes it (requestVideoFrameCallback is playback-driven
      // and never fires while parked). Images wait for decode(). A timeout
      // keeps the switch landing even if the event never fires.
      if (newVid) {
        if (newVid.readyState >= 2) startAnim();
        else {
          newVid.addEventListener('loadeddata', startAnim);
          setTimeout(startAnim, 900);
        }
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
  // Instant switches (and option-only pushes) settle Ken Burns right away.
  if (HAS_NEW) applyKb(KB_ON);

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

  // --- chat-area zone look (聊天界面) ----------------------------------------
  // Four independent masks layered OVER the wallpaper but UNDER the UI (same
  // stacking model as the dim ::after): a white frost sheet, a top/bottom
  // edge gradient, and an extra darkening behind the conversation column —
  // set as the scroller's own background so messages stay readable above it.
  // All are static composited layers; no per-frame cost.
  window.__zcodeBeautify.chatKey = CHAT;
  applyChatLook();
  window.__zcodeBeautify.bubbleKey = BUBBLE;
  applyBubbleLook();
  window.__zcodeBeautify.spinnerKey = SPIN;
  applySpinnerLook();

  function applyChatLook() {
    if (typeof CHAT_UI !== 'undefined' && !CHAT_UI) return;
    var C;
    try { C = JSON.parse(CHAT); } catch (e) { return; }
    var masksOn = C.chatDim > 0 || C.maskTop > 0 || C.maskBottom > 0 || C.frost > 0;
    // Column width (消息流宽度): 0 = stock. Formulas only — a rem ceiling plus
    // a calc(100% - inset) width keeps the column tracking the window exactly
    // like ZCode's own container-query tiers (verified: fixed px widths would
    // overflow on shrink and width:auto collapses the composer to ~32px).
    var cap = Number(C.widthCapRem) > 0 ? Number(C.widthCapRem) : 0;
    var widthOn = cap >= 40;
    var inset = Math.max(0, Math.min(24, Number(C.widthInsetRem) || 0));
    // 大会话流畅模式: content-visibility on conversation rows. ZCode only
    // ships this for the SHARE view — the main chat's dynamic-height
    // virtualizer measures rows live, and a plain contain-intrinsic-size
    // would fight it (off-screen rows would report the estimate forever).
    // The 'auto' keyword fixes that: a row keeps its LAST MEASURED size while
    // skipped, so the virtualizer's cached heights stay valid; only the very
    // first pass uses the 420px estimate (same value ZCode's share view uses).
    var perfOn = Number(C.perfSmooth) === 1;
    var decOn = Number(C.hideElapsedDecimal) === 1;
    var dragOn = Number(C.dragResize) === 1;
    var st = document.getElementById(MARKER + '-chatlook-style');
    var fr = document.getElementById(MARKER + '-frost');
    var zm = document.getElementById(MARKER + '-zonemask');
    if (!masksOn && !widthOn && !perfOn && !decOn && !dragOn) {
      if (st) st.remove();
      if (fr) fr.remove();
      if (zm) zm.remove();
      if (window.__zcodeBeautify.chatObs) {
        try { window.__zcodeBeautify.chatObs.disconnect(); } catch (e) {}
        window.__zcodeBeautify.chatObs = null;
      }
      if (window.__zcodeBeautify.elapsedObs) {
        try { window.__zcodeBeautify.elapsedObs.disconnect(); } catch (e) {}
        window.__zcodeBeautify.elapsedObs = null;
      }
      zbGripClean();
      return;
    }
    if (!st) {
      st = document.createElement('style');
      st.id = MARKER + '-chatlook-style';
      (document.head || document.documentElement).appendChild(st);
    }
    st.textContent = ':root{--zb-chat-dim:' + (C.chatDim / 100) + ';--zb-mask-top:' + (C.maskTop / 100)
      + ';--zb-mask-bot:' + (C.maskBottom / 100) + ';--zb-frost:' + (C.frost / 100) + '}'
      + (masksOn
        ? '#' + MARKER + '-frost{position:fixed;inset:0;z-index:-2147483645;pointer-events:none;background:rgb(255 255 255 / var(--zb-frost))}'
          + '#' + MARKER + '-zonemask{position:fixed;inset:0;z-index:-2147483644;pointer-events:none;'
          + 'background:linear-gradient(to bottom,rgb(0 0 0 / var(--zb-mask-top)),rgb(0 0 0 / 0) 30%,rgb(0 0 0 / 0) 70%,rgb(0 0 0 / var(--zb-mask-bot)))}'
          // The conversation scroller carries distinctive Tailwind arbitrary
          // classes; .zb-chat-col is the version-proof fallback (markChatCol).
          + 'div[class*="scrollbar-gutter:stable"][class*="overflow-y-auto"],.zb-chat-col'
          + '{background-color:rgb(0 0 0 / var(--zb-chat-dim)) !important}'
        : '')
      + (widthOn && !dragOn
        // Mirrors ZCode's own tiers against the "conversation" container so
        // nothing changes below 864px: wide tier gets both the raised ceiling
        // and the slimmer side inset; the mid tier only its ceiling raised
        // (stock calc(100% - 6rem) width keeps governing it). The three
        // aligned holders (messages ×2 + composer) share these class names.
        // Skipped while dragResize is on — the drag tiers below carry the
        // same formula as their var fallbacks.
        ? '@container conversation (min-width:1280px){'
          + '[class*="conversation:max-w-6xl"]{max-width:' + cap + 'rem!important;width:calc(100% - ' + inset + 'rem)!important}'
          + '}'
          + '@container conversation (min-width:864px){'
          + '[class*="conversation:max-w-4xl"]{max-width:' + cap + 'rem!important}'
          + '}'
        : '')
      + (dragOn
        // 两侧拖拽调宽 width tiers: two px vars read by BOTH classes so the
        // three aligned holders move together — --zb-chat-w is the dragged
        // ceiling, --zb-chat-inset is derived per layout (max(16px,
        // container − W)) so dragging can push the column nearly full width
        // (a fixed 24rem inset would dead-stop the drag at 100% − 384px).
        // The fallbacks reproduce the stock tiers — or the config tier when
        // a cap is set — exactly, so nothing changes until the first drag
        // writes the vars. calc(100% − inset) keeps ZCode's native window-
        // tracking shape (fixed px widths overflow on shrink), and the
        // derived inset is never < 16px, so the width can never go negative.
        // Mid rule FIRST: where an element carries both classes the wide
        // tier must win (same specificity → the later rule decides).
        ? '@container conversation (min-width:864px){'
          + '[class*="conversation:max-w-4xl"]{max-width:var(--zb-chat-w,' + (widthOn ? cap : 56) + 'rem)!important;'
          + 'width:calc(100% - var(--zb-chat-inset,6rem))!important}'
          + '}'
          + '@container conversation (min-width:1280px){'
          + '[class*="conversation:max-w-6xl"]{max-width:var(--zb-chat-w,' + (widthOn ? cap : 72) + 'rem)!important;'
          + 'width:calc(100% - var(--zb-chat-inset,' + (widthOn ? inset : 24) + 'rem))!important}'
          + '}'
          // The strips: fixed 9px hit zones hugging the column edges,
          // invisible until hover (a 3px accent line), col-resize cursor.
          // z-index 40 stays under Tailwind's z-50 dropdown/modals.
          + '#' + MARKER + '-grip-l,#' + MARKER + '-grip-r{position:fixed;top:-200px;left:0;width:9px;height:120px;cursor:col-resize;z-index:40;touch-action:none;user-select:none;-webkit-user-select:none}'
          + '#' + MARKER + '-grip-l::after,#' + MARKER + '-grip-r::after{content:"";position:absolute;top:0;bottom:0;left:3px;width:3px;border-radius:3px;background:var(--color-primary,#7aa2f7);opacity:0;transition:opacity .12s}'
          + '#' + MARKER + '-grip-l:hover::after,#' + MARKER + '-grip-r:hover::after,'
          + '#' + MARKER + '-grip-l.zb-grip-drag::after,#' + MARKER + '-grip-r.zb-grip-drag::after{opacity:.55}'
          + 'html.zb-grip-active{user-select:none!important;-webkit-user-select:none!important}'
          // Drag perf (实测: the holders carry transition-[width,max-width]
          // duration-150 — every width-var write animated for 150ms, so the
          // layout never settled and each drag step stacked ~9 animated
          // relayouts on top of the virtualizer's re-measure). While a drag
          // is active the transition is cut and the width updates in
          // quantized 16px steps (see GRIP_STEP) instead of every pointermove.
          + 'html.zb-grip-active [class*="conversation:max-w-6xl"],html.zb-grip-active [class*="conversation:max-w-4xl"]{transition:none!important}'
          // Composer floor (实测: if a width var ever goes invalid the calc
          // becomes unset → the composer holder, a flex-row child, collapses
          // to min-content (~40px strip) while block-parented message holders
          // just fill. A literal floor can never go invalid).
          + 'html.zb-grip-active [class*="conversation:max-w-6xl"],html.zb-grip-active [class*="conversation:max-w-4xl"]{min-width:460px!important}'
        : '');
    if (masksOn) {
      if (!fr) { fr = document.createElement('div'); fr.id = MARKER + '-frost'; }
      if (!zm) { zm = document.createElement('div'); zm.id = MARKER + '-zonemask'; }
      document.documentElement.appendChild(fr);
      document.documentElement.appendChild(zm);
    } else {
      // A width-only look must not inherit stale mask sheets from before.
      if (fr) fr.remove();
      if (zm) zm.remove();
    }
    // Route changes (chat <-> settings) recreate the column, so keep tagging
    // it while the darkening is on. rAF-coalesced: streaming mutates a lot.
    if (C.chatDim > 0 && !window.__zcodeBeautify.chatObs) {
      markChatCol();
      var chatPend = false;
      var obs = new MutationObserver(function() {
        if (chatPend) return;
        chatPend = true;
        requestAnimationFrame(function() { chatPend = false; markChatCol(); });
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      window.__zcodeBeautify.chatObs = obs;
    }
    // 大会话流畅模式 engine: measure-then-skip per row. A global
    // content-visibility rule with a 420px estimate was measured to shrink
    // the virtualizer's total size 6x (scrollbar distortion) because the
    // dynamic-height virtualizer reads the PLACEHOLDER before any real
    // measurement sticks. Instead: on scroll/DOM idle, rows far off-screen
    // get their REAL height baked into an inline contain-intrinsic-size
    // BEFORE content-visibility turns on — total size stays exact, the
    // virtualizer never sees a lie, and off-screen rows still skip layout.
    window.__zcodeBeautify.perfOn = perfOn;
    if (perfOn && !window.__zcodeBeautify.perfBound) {
      window.__zcodeBeautify.perfBound = true;
      window.addEventListener('scroll', perfSched, true);
      window.addEventListener('resize', perfSched);
      var perfMo = new MutationObserver(perfSched);
      perfMo.observe(document.documentElement, { childList: true, subtree: true });
      window.__zcodeBeautify.perfMo = perfMo;
      perfSched();
    } else if (!perfOn) {
      if (window.__zcodeBeautify.perfMo) {
        try { window.__zcodeBeautify.perfMo.disconnect(); } catch (e) {}
        window.__zcodeBeautify.perfMo = null;
      }
      var perfRows = document.querySelectorAll('[data-zb-cv="1"]');
      for (var pri = 0; pri < perfRows.length; pri++) {
        perfRows[pri].style.contentVisibility = '';
        perfRows[pri].style.containIntrinsicSize = '';
        perfRows[pri].removeAttribute('data-zb-cv');
      }
    }
    // 耗时秒数去小数: ZCode's live "working" row renders the elapsed time
    // ("1 时 17 分 53.4 秒") through a hardcoded toFixed(1) into ONE
    // aria-hidden text span under [data-zcode-chat-loading-animate]; CSS
    // cannot reach mid-string text, so watch the DOM and strip the fraction
    // ("53.4 秒" → "53 秒") after each 100ms React tick. Turning the option
    // off just drops the observer — the next tick re-writes the stock text.
    if (decOn && !window.__zcodeBeautify.elapsedObs) {
      var eObs = new MutationObserver(function(muts) {
        for (var mi = 0; mi < muts.length; mi++) {
          var mu = muts[mi];
          if (mu.type === 'characterData') {
            zbStripElapsed(mu.target.parentElement);
          } else {
            zbStripElapsed(mu.target);
            for (var mj = 0; mj < mu.addedNodes.length; mj++) {
              var mn = mu.addedNodes[mj];
              if (mn.nodeType === 1) zbElapsedSweep(mn);
            }
          }
        }
      });
      eObs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      window.__zcodeBeautify.elapsedObs = eObs;
      zbElapsedSweep(document);
    } else if (!decOn && window.__zcodeBeautify.elapsedObs) {
      try { window.__zcodeBeautify.elapsedObs.disconnect(); } catch (e) {}
      window.__zcodeBeautify.elapsedObs = null;
    }
    // 两侧拖拽调宽 engine: mount the strips and keep them glued to the live
    // column edges. Tracking = rAF-coalesced MutationObserver (route changes
    // recreate the column), a ResizeObserver on the scroller (sidebar/window
    // resizes without DOM mutations) and a window resize listener.
    window.__zcodeBeautify.dragOn = dragOn;
    if (dragOn) {
      // GRIP_VER guards against a renderer reload re-running EVERY bootstrap
      // ever registered via addScriptToEvaluateOnNewDocument (they
      // accumulate; nothing can deregister them): the OLDEST script mounts
      // first and wires its own — possibly outdated — pointer handlers, and
      // every later script would skip mounting because the ids already
      // exist. Only the newest engine knows the current marker, sees the
      // legacy strips, and force-remounts them with live wiring. The remount
      // also disconnects whatever observers an older generation installed
      // (they share the window.__zcodeBeautify slots and would otherwise
      // keep feeding their outdated sync forever). Bump the marker whenever
      // the grip engine changes behavior.
      var GRIP_VER = '4';
      // One-line migration: the pre-pct build stored an absolute rem width.
      // LITERAL key on purpose — applyChatLook runs BEFORE the engine
      // constants below get their assignments (var hoisting moves the
      // declarations, not the values; BUB/RECIPES sit at the top of this
      // body for exactly this reason).
      try { localStorage.removeItem('zcode-beautify:chat-drag-w'); } catch (e5) {}
      var gl = document.getElementById(MARKER + '-grip-l');
      var gr = document.getElementById(MARKER + '-grip-r');
      if (gl && gl.getAttribute('data-zb-ver') !== GRIP_VER) gl = null;
      if (gr && gr.getAttribute('data-zb-ver') !== GRIP_VER) gr = null;
      if (!gl || !gr) {
        // Full clean slate: grips, observers, resize listener, drag state,
        // position/content caches — an older generation may have left any of
        // them behind, and the fresh wiring below must own the page alone.
        zbGripClean();
        gl = document.createElement('div');
        gl.id = MARKER + '-grip-l';
        gl.setAttribute('data-zb-ver', GRIP_VER);
        gr = document.createElement('div');
        gr.id = MARKER + '-grip-r';
        gr.setAttribute('data-zb-ver', GRIP_VER);
        document.documentElement.appendChild(gl);
        document.documentElement.appendChild(gr);
        zbGripWire(gl, false);
        zbGripWire(gr, true);
        document.addEventListener('keydown', zbGripEsc);
      }
      if (!window.__zcodeBeautify.gripObs) {
        var gObs = new MutationObserver(zbGripSched);
        gObs.observe(document.documentElement, { childList: true, subtree: true });
        window.__zcodeBeautify.gripObs = gObs;
      }
      if (!window.__zcodeBeautify.gripWinResize) {
        var grf = function() { zbGripSched(); };
        window.addEventListener('resize', grf);
        window.__zcodeBeautify.gripWinResize = grf;
      }
      // First positioning runs SYNCHRONOUSLY: Chromium throttles rAF to zero
      // in occluded/hidden windows, so a purely rAF-coalesced mount would
      // leave the strips at their off-screen CSS defaults until the window
      // is visible again (measured live). Later ticks stay rAF-coalesced.
      try { zbGripSync(); } catch (e4) {}
      zbGripSched();
    } else {
      zbGripClean();
    }
  }
  // The duration span is a direct child of the loading row (verified in
  // ZCode's bundle: aria-hidden + font-mono next to the zcode-loading-label).
  function zbIsElapsedSpan(el) {
    return !!(el && el.tagName === 'SPAN' && el.getAttribute('aria-hidden') === 'true'
      && el.parentElement && el.parentElement.getAttribute('data-zcode-chat-loading-animate') === 'true');
  }
  // React keeps exactly ONE text child in that span and updates it via
  // firstChild.nodeValue — our textContent rewrite preserves that shape, so
  // React's fast path then edits OUR text node and the observer strips it
  // again. A rewrite without a decimal matches nothing and writes nothing,
  // so the loop always settles.
  function zbStripElapsed(el) {
    if (!zbIsElapsedSpan(el)) return;
    var t = el.textContent;
    if (t && t.indexOf('.') !== -1) {
      var s = t.replace(/(\\d+)\\.\\d+/g, '$1');
      if (s !== t) el.textContent = s;
    }
  }
  function zbElapsedSweep(root) {
    // document (nodeType 9) and elements both carry querySelectorAll — the
    // install-time call passes document itself.
    if (!root || !root.querySelectorAll) return;
    var spans = root.querySelectorAll('[data-zcode-chat-loading-animate="true"] > span[aria-hidden="true"]');
    for (var si = 0; si < spans.length; si++) zbStripElapsed(spans[si]);
  }
  function perfSched() {
    if (window.__zcodeBeautify.perfTimer) return;
    window.__zcodeBeautify.perfTimer = setTimeout(function() {
      window.__zcodeBeautify.perfTimer = null;
      if (!window.__zcodeBeautify.perfOn) return;
      try { perfApply(); } catch (e) {}
    }, 250);
  }
  function perfApply() {
    var rows = document.querySelectorAll('.history-message, [class~="group/assistant-turn"]');
    if (!rows.length) return;
    var vh = window.innerHeight || 800;
    // First read flushes any pending layout once; the rest read cached values.
    for (var i = 0; i < rows.length; i++) {
      var el = rows[i];
      var r = el.getBoundingClientRect();
      // Well outside the viewport (a full viewport of slack both ways).
      if (r.bottom < -vh || r.top > 2 * vh) {
        if (el.getAttribute('data-zb-cv') !== '1') {
          el.setAttribute('data-zb-cv', '1');
          el.style.containIntrinsicSize = Math.round(r.width) + 'px ' + Math.round(r.height) + 'px';
          el.style.contentVisibility = 'auto';
        }
      }
    }
  }
  // The composer's first TALL scroll ancestor is the conversation column.
  // (Not the composer itself — it is a small overflow-y-auto editor.)
  function markChatCol() {
    var el = document.querySelector('[contenteditable="true"]');
    el = el && el.parentElement;
    while (el && el !== document.body) {
      var oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.getBoundingClientRect().height > 300) {
        if (!el.classList.contains('zb-chat-col')) el.classList.add('zb-chat-col');
        return;
      }
      el = el.parentElement;
    }
  }
  // --- 两侧拖拽调宽 engine ---------------------------------------------------
  // Two invisible fixed strips hugging the conversation column's edges.
  // Dragging writes --zb-chat-w (px), which the drag tiers read with stock
  // fallbacks. The width persists in localStorage as a PERCENT of the
  // conversation container (DeepSeek's mechanism): maximize/restore rescale
  // the column proportionally on every sync — an absolute px/rem width would
  // pin full-width after a restore and dwarf on maximize. Double-clicking a
  // strip clears it back to the tier fallbacks. Outside the chat (no
  // scroller/holder — settings, route changes) the strips hide.
  var GRIP_KEY = 'zcode-beautify:chat-drag-pct';
  var GRIP_KEY_OLD = 'zcode-beautify:chat-drag-w'; // pre-pct absolute rem — dropped
  var GRIP_MIN = 460;   // px — narrower than the narrowest panel tier (48rem)
  var GRIP_MARGIN = 16; // px — minimum side breathing room at full width
  var GRIP_STEP = 8;    // pointer px per update — the width moves 2× this.
                        // Quantization: one relayout per step instead of one
                        // per pointermove (the dynamic-height virtualizer
                        // re-measures the whole conversation on every width
                        // change; continuous 1px updates made the drag
                        // unusably janky).
  // pct (0-100) → applied px for the CURRENT container, clamped to the drag
  // range. Zero-width layouts (jsdom, hidden) yield no usable clamp — caller
  // checks contentW first.
  function zbGripPctToPx(pct, contentW) {
    return Math.max(GRIP_MIN, Math.min(contentW - GRIP_MARGIN, pct / 100 * contentW));
  }
  function zbGripFont() {
    return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  }
  // Width vars: --zb-chat-w is the dragged ceiling; --zb-chat-inset shrinks
  // with it (max(16px, container − W)) so the column can go nearly full
  // width. Only applied on a sane layout (jsdom measures 0 everywhere).
  function zbGripApply(px, contentW) {
    // Hard gate: a non-finite px would write 'NaNpx' into the vars, and an
    // invalid var turns the tiers' width calc into unset → the composer
    // (flex-row child) collapses to min-content while the message holders
    // just fill their block parent. Measured live — never write garbage.
    px = Number(px);
    if (!isFinite(px) || px <= 0) return;
    var rs = document.documentElement.style;
    var v = Math.round(px) + 'px';
    if (rs.getPropertyValue('--zb-chat-w') !== v) rs.setProperty('--zb-chat-w', v);
    if (isFinite(contentW) && contentW > 100) {
      var iv = Math.max(GRIP_MARGIN, Math.round(contentW - px)) + 'px';
      if (rs.getPropertyValue('--zb-chat-inset') !== iv) rs.setProperty('--zb-chat-inset', iv);
    }
  }
  function zbGripClear() {
    var rs = document.documentElement.style;
    rs.removeProperty('--zb-chat-w');
    rs.removeProperty('--zb-chat-inset');
  }
  function zbGripRestore() {
    var pct = parseFloat(localStorage.getItem(GRIP_KEY));
    var cw = window.__zcodeBeautify.gripContentW || 0;
    if (isFinite(pct) && pct > 0 && pct <= 100 && cw > 100) {
      zbGripApply(zbGripPctToPx(pct, cw), cw);
    } else {
      zbGripClear();
    }
  }
  function zbGripClean() {
    var gl = document.getElementById(MARKER + '-grip-l');
    var gr = document.getElementById(MARKER + '-grip-r');
    if (gl) gl.remove();
    if (gr) gr.remove();
    if (window.__zcodeBeautify.gripObs) {
      try { window.__zcodeBeautify.gripObs.disconnect(); } catch (e) {}
      window.__zcodeBeautify.gripObs = null;
    }
    if (window.__zcodeBeautify.gripRO) {
      try { window.__zcodeBeautify.gripRO.disconnect(); } catch (e) {}
      window.__zcodeBeautify.gripRO = null;
    }
    if (window.__zcodeBeautify.gripWinResize) {
      window.removeEventListener('resize', window.__zcodeBeautify.gripWinResize);
      window.__zcodeBeautify.gripWinResize = null;
    }
    if (window.__zcodeBeautify.gripRaf && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(window.__zcodeBeautify.gripRaf);
    }
    window.__zcodeBeautify.gripRaf = 0;
    document.documentElement.classList.remove('zb-grip-active');
    // A drag whose pointerup was lost (capture dropped, route torn down
    // mid-drag) must not survive the cleanup: it would keep zbGripSched
    // silenced and block the fallback-var restore forever.
    window.__zcodeBeautify.gripDrag = null;
    zbGripClear();
    window.__zcodeBeautify.gripScroller = null;
    window.__zcodeBeautify.gripHolder = null;
    // The position cache MUST die with the strips: a fresh mount creates new
    // elements with empty inline styles, and a stale "already written" cache
    // would suppress the repositioning forever (measured live: remounted
    // grips stuck at their off-screen CSS defaults).
    window.__zcodeBeautify.gripPos = null;
  }
  // Analytic strip positioning DURING a drag: the column grows symmetrically
  // around its pointerdown-time center, so each edge is cl0/cr0 ± half the
  // applied width delta — zero layout reads (getBoundingClientRect would
  // force a synchronous layout of the just-invalidated conversation on every
  // step). The full zbGripSync re-baselines everything on pointerup.
  function zbGripFollow(d) {
    var gl = document.getElementById(MARKER + '-grip-l');
    var gr = document.getElementById(MARKER + '-grip-r');
    if (!gl || !gr || !d) return;
    var px = parseFloat(document.documentElement.style.getPropertyValue('--zb-chat-w'));
    if (!isFinite(px) || px <= 0) return;
    var dw = px - d.w0;
    var glk = String(Math.round(d.cl0 - dw / 2) - 4);
    if (gl.style.left !== glk + 'px') gl.style.left = glk + 'px';
    var grk = String(Math.round(d.cr0 + dw / 2) - 5);
    if (gr.style.left !== grk + 'px') gr.style.left = grk + 'px';
  }
  function zbGripSched() {
    // While a drag is active the drag path owns positioning (zbGripFollow);
    // MO/RO storms from the re-rendering conversation must not queue syncs.
    if (window.__zcodeBeautify.gripDrag) return;
    if (window.__zcodeBeautify.gripRaf) return;
    window.__zcodeBeautify.gripRaf = requestAnimationFrame(function() {
      window.__zcodeBeautify.gripRaf = 0;
      if (window.__zcodeBeautify.dragOn) {
        try { zbGripSync(); } catch (e) {}
      }
    });
  }
  function zbGripSync() {
    var gl = document.getElementById(MARKER + '-grip-l');
    var gr = document.getElementById(MARKER + '-grip-r');
    if (!gl || !gr) return;
    // Self-heal: garbage vars left by ANY older engine generation (they all
    // shared window.__zcodeBeautify and their observers could outlive them)
    // make the tiers' width calc invalid → composer min-content collapse.
    var rs0 = document.documentElement.style;
    for (var vi = 0; vi < 2; vi++) {
      var vn = vi === 0 ? '--zb-chat-w' : '--zb-chat-inset';
      var vv = rs0.getPropertyValue(vn);
      if (vv && !isFinite(parseFloat(vv))) rs0.removeProperty(vn);
    }
    var scroller = window.__zcodeBeautify.gripScroller;
    if (!scroller || !scroller.isConnected) {
      // Same rule as markChatCol: the composer's first TALL scroll ancestor.
      scroller = null;
      var ed = document.querySelector('[contenteditable="true"]');
      var p = ed && ed.parentElement;
      while (p && p !== document.body) {
        var oy = getComputedStyle(p).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && p.getBoundingClientRect().height > 300) { scroller = p; break; }
        p = p.parentElement;
      }
      window.__zcodeBeautify.gripScroller = scroller;
      if (window.__zcodeBeautify.gripRO) {
        try { window.__zcodeBeautify.gripRO.disconnect(); } catch (e) {}
        window.__zcodeBeautify.gripRO = null;
      }
      if (scroller && typeof ResizeObserver !== 'undefined') {
        try {
          var ro = new ResizeObserver(function() { zbGripSched(); });
          ro.observe(scroller);
          window.__zcodeBeautify.gripRO = ro;
        } catch (e2) {}
      }
    }
    var holder = scroller ? scroller.querySelector('[class*="conversation:max-w-6xl"],[class*="conversation:max-w-4xl"]') : null;
    if (!holder) holder = document.querySelector('[class*="conversation:max-w-6xl"],[class*="conversation:max-w-4xl"]');
    window.__zcodeBeautify.gripHolder = holder;
    // Content width the holder's percentage width resolves against (parent
    // content box) — the inset var derives from it. Cached for pointermove's
    // upper clamp.
    var contentW = 0;
    if (holder && holder.parentElement) {
      var par = holder.parentElement;
      var pcs = getComputedStyle(par);
      contentW = par.clientWidth - (parseFloat(pcs.paddingLeft) || 0) - (parseFloat(pcs.paddingRight) || 0);
      if (!isFinite(contentW) || contentW < 0) contentW = 0;
    }
    window.__zcodeBeautify.gripContentW = contentW;
    // The stored drag width is a percent of THIS container — re-derived on
    // every sync so maximize/restore (and any container resize) rescale the
    // column proportionally instead of pinning an absolute px width.
    var storedPct = parseFloat(localStorage.getItem(GRIP_KEY));
    if (isFinite(storedPct) && storedPct > 0 && storedPct <= 100 && contentW > 100) {
      zbGripApply(zbGripPctToPx(storedPct, contentW), contentW);
    } else if (!window.__zcodeBeautify.gripDrag && document.documentElement.style.getPropertyValue('--zb-chat-inset')) {
      // No stored width and not mid-drag: back to the tier fallbacks. (During
      // a drag pointermove owns the vars — a concurrent sync must not strip
      // the inset it just derived.)
      document.documentElement.style.removeProperty('--zb-chat-inset');
    }
    var sr = scroller ? scroller.getBoundingClientRect() : null;
    var hr = holder ? holder.getBoundingClientRect() : null;
    if (!scroller || !holder || !sr || !hr || hr.width < 40 || sr.height < 80) {
      if (gl.style.display !== 'none') { gl.style.display = 'none'; gr.style.display = 'none'; }
      return;
    }
    if (gl.style.display === 'none') { gl.style.display = ''; gr.style.display = ''; }
    // Write styles only on change — this sync runs on every rAF-coalesced
    // mutation tick while streaming.
    var gs = window.__zcodeBeautify.gripPos || (window.__zcodeBeautify.gripPos = {});
    var lt = Math.round(sr.top) + '|' + Math.round(sr.height) + '|' + Math.round(hr.left);
    if (gs.l !== lt) {
      gs.l = lt;
      gl.style.top = sr.top + 'px';
      gl.style.height = sr.height + 'px';
      gl.style.left = (Math.round(hr.left) - 4) + 'px';
    }
    var rt = Math.round(sr.top) + '|' + Math.round(sr.height) + '|' + Math.round(hr.right);
    if (gs.r !== rt) {
      gs.r = rt;
      gr.style.top = sr.top + 'px';
      gr.style.height = sr.height + 'px';
      gr.style.left = (Math.round(hr.right) - 5) + 'px';
    }
  }
  function zbGripEsc(e) {
    var d = window.__zcodeBeautify.gripDrag;
    if (e.key === 'Escape' && d && d.cancel) d.cancel();
  }
  function zbGripWire(g, isRight) {
    if (g.__zbGrip) return;
    g.__zbGrip = true;
    g.addEventListener('pointerdown', function(e) {
      if (e.button !== 0 || !window.__zcodeBeautify.dragOn) return;
      var holder = window.__zcodeBeautify.gripHolder;
      if (!holder || !holder.isConnected) return;
      e.preventDefault();
      // Hygiene: a previous drag whose pointerup was lost must not linger —
      // it would keep the observers silenced and the vars pinned mid-drag.
      // cancel() itself nulls gripDrag and restores the tier fallbacks.
      var stale = window.__zcodeBeautify.gripDrag;
      if (stale && stale.cancel) {
        try { stale.cancel(); } catch (e0) {}
      }
      // ONE layout read for the whole drag: the holder rect anchors both the
      // start width and the analytic edge positions zbGripFollow derives.
      var hr = holder.getBoundingClientRect();
      var d = { x0: e.clientX, w0: hr.width, cl0: hr.left, cr0: hr.right, q: 0 };
      d.cancel = function() {
        if (window.__zcodeBeautify.gripDrag !== d) return;
        window.__zcodeBeautify.gripDrag = null;
        zbGripRestore();
        g.classList.remove('zb-grip-drag');
        document.documentElement.classList.remove('zb-grip-active');
        zbGripSync();
      };
      window.__zcodeBeautify.gripDrag = d;
      try { g.setPointerCapture(e.pointerId); } catch (err) {}
      g.classList.add('zb-grip-drag');
      document.documentElement.classList.add('zb-grip-active');
    });
    g.addEventListener('pointermove', function(e) {
      var d = window.__zcodeBeautify.gripDrag;
      if (!d) return;
      // Symmetric growth: the column stays centered, so a 1px pointer move
      // widens it by 2px from either edge. The var write is cheap and runs
      // synchronously — rAF is throttled to zero in occluded windows, and a
      // drag must never depend on it. Updates are QUANTIZED to GRIP_STEP
      // (8 pointer px = 16 width px): each step costs the virtualizer a full
      // re-measure of the conversation, so per-pointermove updates reflow the
      // whole list 60×/s and the drag stutters (user-measured jank).
      var q = Math.round((e.clientX - d.x0) / GRIP_STEP);
      if (q === d.q) return;
      d.q = q;
      var w = d.w0 + q * GRIP_STEP * 2 * (isRight ? 1 : -1);
      if (!isFinite(w)) return;
      var cw = window.__zcodeBeautify.gripContentW;
      if (!isFinite(cw) || cw <= 100) {
        cw = window.__zcodeBeautify.gripScroller ? window.__zcodeBeautify.gripScroller.clientWidth : 0;
        if (!isFinite(cw) || cw <= 100) cw = (window.innerWidth || 1920) - 2 * GRIP_MARGIN;
      }
      var maxW = cw - GRIP_MARGIN;
      if (maxW < GRIP_MIN) maxW = GRIP_MIN;
      zbGripApply(Math.max(GRIP_MIN, Math.min(maxW, Math.round(w))), cw);
      zbGripFollow(d);
    });
    var up = function() {
      var d = window.__zcodeBeautify.gripDrag;
      if (!d) return;
      window.__zcodeBeautify.gripDrag = null;
      // Persist as a percent of the container (DeepSeek mechanism): the next
      // sync re-derives px from the live container, so maximize/restore
      // rescale proportionally. pxApplied is already drag-clamped, so the
      // pct lands inside the valid range by construction.
      var pxApplied = parseFloat(document.documentElement.style.getPropertyValue('--zb-chat-w'));
      if (!isFinite(pxApplied) || pxApplied <= 0) pxApplied = d.w0;
      var cwUp = window.__zcodeBeautify.gripContentW;
      if (isFinite(cwUp) && cwUp > 100) {
        var pctUp = Math.max(5, Math.min(100, Math.round(pxApplied / cwUp * 10000) / 100));
        try { localStorage.setItem(GRIP_KEY, String(pctUp)); } catch (e2) {}
      }
      g.classList.remove('zb-grip-drag');
      document.documentElement.classList.remove('zb-grip-active');
      zbGripSync();
    };
    g.addEventListener('pointerup', up);
    g.addEventListener('pointercancel', function() {
      var d = window.__zcodeBeautify.gripDrag;
      if (d && d.cancel) d.cancel();
    });
    // Double-click resets: the dragged width is gone, the tier fallbacks
    // (原生 or 消息流宽度档位) rule again on the next sync.
    g.addEventListener('dblclick', function() {
      try { localStorage.removeItem(GRIP_KEY); } catch (e3) {}
      zbGripClear();
      zbGripSync();
    });
  }

  // --- user message bubble look (聊天气泡) -----------------------------------
  // Targets the stable v4 data attribute (not Tailwind class hashes) and
  // color-mixes the live --color-* tokens, so a Monet re-theme restyles the
  // bubble with no re-injection. preset "default" removes the rules entirely
  // (stock bubble); unknown presets degrade the same way. BUB/BUB_ROW/RECIPES
  // are declared at the TOP of this body (fast-path ordering — see there).
  function applyBubbleLook() {
    if (typeof CHAT_UI !== 'undefined' && !CHAT_UI) return;
    var B;
    try { B = JSON.parse(BUBBLE); } catch (e) { return; }
    var st = document.getElementById(MARKER + '-bubble-style');
    // "custom" keeps the style even with empty CSS: the base rules below
    // (radius/max-width/alignment) still apply, driven by the sliders.
    if (!B || B.preset === 'default' || (B.preset !== 'custom' && !RECIPES[B.preset])) {
      if (st) st.remove();
      return;
    }
    if (!st) {
      st = document.createElement('style');
      st.id = MARKER + '-bubble-style';
      (document.head || document.documentElement).appendChild(st);
    }
    var r = Math.max(2, Math.round(B.radius || 12));
    // Tail keeps its stock 2px corner on the aligned edge; left mirrors it.
    var corners = B.align === 'left' ? '2px ' + r + 'px ' + r + 'px ' + r + 'px' : r + 'px 2px ' + r + 'px ' + r + 'px';
    st.textContent = ':root{--zb-bubble-tint:' + (Math.max(0, Math.min(100, B.tint || 0)) / 100)
      + ';--zb-bubble-radius:' + corners
      + ';--zb-bubble-maxw:' + Math.max(40, Math.min(90, B.width || 70)) + '%'
      + ';--zb-bubble-align:' + (B.align === 'left' ? 'flex-start' : 'flex-end') + '}'
      + BUB + '{border-radius:var(--zb-bubble-radius)!important;max-width:var(--zb-bubble-maxw)!important}'
      + BUB_ROW + '{align-items:var(--zb-bubble-align)!important}'
      + (B.preset === 'custom' ? CUSTOM_CSS : RECIPES[B.preset]);
  }

  // --- session-list running indicator (运行中图标) -----------------------------
  // Sidebar task rows show a spinning lucide LoaderIcon in their leading slot
  // while a session streams. The loading state exists in TWO renderers, both
  // anchored by data-testid^="task-item-": the plain/timeline list wraps the
  // svg in a span that carries animate-spin, grouped rows put animate-spin on
  // the svg itself. Lucide draws with currentColor strokes, so color:transparent
  // erases the stock glyph and a background paints the user image in its
  // place; spin=false drops the rotation (animated GIFs bring their own).
  // 运行完成标志 (完成未读点) and 出错标志 are separate slots: the plain
  // renderer marks them with data-unread-indicator / data-error-indicator;
  // grouped rows carry no attribute, so we anchor their Tailwind dot classes
  // (bg-sky-500 / bg-destructive + size-1.5) — brittle across ZCode updates,
  // but the worst case is the stock dot staying visible.
  // mode "default" or a missing image removes the loading rules; the terminal
  // slots live independently of mode.
  function applySpinnerLook() {
    if (typeof CHAT_UI !== 'undefined' && !CHAT_UI) return;
    var S;
    try { S = JSON.parse(SPIN); } catch (e) { return; }
    var loadingOn = S && S.mode === 'image' && S.image;
    var unreadOn = S && S.unreadImage;
    var errorOn = S && S.errorImage;
    var st = document.getElementById(MARKER + '-spinner-style');
    if (!loadingOn && !unreadOn && !errorOn) {
      if (st) st.remove();
      return;
    }
    if (!st) {
      st = document.createElement('style');
      st.id = MARKER + '-spinner-style';
      (document.head || document.documentElement).appendChild(st);
    }
    var size = Math.max(10, Math.min(24, Math.round(S.size || 16)));
    var ITEM = '[data-testid^="task-item-"]';
    var css = '';
    if (loadingOn) {
      var svg = ITEM + ' span.animate-spin > svg,' + ITEM + ' svg.animate-spin';
      css += svg + '{width:' + size + 'px!important;height:' + size + 'px!important;'
        + 'color:transparent!important;'
        + 'background:url("' + S.image + '") center/contain no-repeat!important;}';
      if (!S.spin) {
        css += ITEM + ' span.animate-spin,' + ITEM + ' svg.animate-spin{animation:none!important}';
      }
    }
    // A dot is an empty span painted by background-color: clear the color,
    // stretch it to the icon size and paint the image instead. The outer
    // 16px slot is a centered flex box, so an enlarged dot stays centered.
    function slotCss(sel, url) {
      return sel + '{width:' + size + 'px!important;height:' + size + 'px!important;'
        + 'background-color:transparent!important;'
        + 'background-image:url("' + url + '")!important;'
        + 'background-size:contain!important;background-position:center!important;'
        + 'background-repeat:no-repeat!important}';
    }
    if (unreadOn) {
      css += slotCss(ITEM + ' [data-unread-indicator="true"],' + ITEM + ' span.bg-sky-500.size-1\\\\.5', S.unreadImage);
    }
    if (errorOn) {
      css += slotCss(ITEM + ' [data-error-indicator="true"],' + ITEM + ' span.bg-destructive.size-1\\\\.5', S.errorImage);
    }
    st.textContent = css;
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
      if (v.ended || v.paused) {
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
  var runBootstrap = function() {
    if (!STARTUP_CLEAN || !inStartupScreen()) { runBootstrapBody(); return; }
    if (window.__zcodeBeautify.startupMO) return; // a waiter is already armed
    var mo = new MutationObserver(function() {
      if (!inStartupScreen()) {
        mo.disconnect();
        window.__zcodeBeautify.startupMO = null;
        runBootstrapBody();
      }
    });
    window.__zcodeBeautify.startupMO = mo;
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
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
  document.getElementById(${JSON.stringify(marker)} + '-chatlook-style')?.remove();
  document.getElementById(${JSON.stringify(marker)} + '-bubble-style')?.remove();
  document.getElementById(${JSON.stringify(marker)} + '-spinner-style')?.remove();
  document.getElementById(${JSON.stringify(marker)} + '-frost')?.remove();
  document.getElementById(${JSON.stringify(marker)} + '-zonemask')?.remove();
  if (window.__zcodeBeautify) {
    window.__zcodeBeautify.cssText = null; window.__zcodeBeautify.videoSrc = null;
    window.__zcodeBeautify.wpImg = null; window.__zcodeBeautify.finishFade = null;
    window.__zcodeBeautify.chatKey = null;
    window.__zcodeBeautify.bubbleKey = null;
    window.__zcodeBeautify.spinnerKey = null;
    if (window.__zcodeBeautify.chatObs) {
      try { window.__zcodeBeautify.chatObs.disconnect(); } catch (e) {}
      window.__zcodeBeautify.chatObs = null;
    }
    if (window.__zcodeBeautify.elapsedObs) {
      try { window.__zcodeBeautify.elapsedObs.disconnect(); } catch (e) {}
      window.__zcodeBeautify.elapsedObs = null;
    }
  }
})();`;
}
