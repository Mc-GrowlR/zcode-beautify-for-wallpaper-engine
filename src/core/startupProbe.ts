/**
 * Shared "is the client still showing its startup screen?" probe, embedded in
 * both the theme bootstrap and the settings panel.
 *
 * ZCode 3.18 marks <body> with a `zcode-startup*` class until
 * `zcode-startup-ready` appears. ZCode 4.0 dropped that class entirely: the
 * body is class-less while a full-screen `#loading` overlay covers the window,
 * and only `zcode-startup-ready` is added when React is interactive. Probing
 * only the 3.18 class made 4.0 look "ready" at document start, so the wallpaper
 * and panel painted on top of the loading art for ~0.5s.
 *
 * WorkBuddy keeps its skeleton overlay probe (`#sk-overlay`/`#skeleton-root`
 * with an empty `#root`). Unknown clients fall back to "ready" immediately —
 * a missing anchor must never hold the enhancement back forever.
 */

export type StartupProbe = "zcode-body-class" | "workbuddy-skeleton";

/** JS source defining `inStartupScreen()`; paste it into an IIFE template. */
export function startupProbeJs(probe: StartupProbe): string {
  return `var inStartupScreen = function() {
    if (!document.body) return true;
    if (${JSON.stringify(probe)} === 'workbuddy-skeleton') {
      var sk = document.querySelector('#sk-overlay, #skeleton-root');
      if (sk && sk.offsetParent !== null && (sk.textContent || '').length > 0) return true;
      var wbRoot = document.querySelector('#root');
      return !wbRoot || wbRoot.childElementCount === 0;
    }
    var cls = document.body.className || '';
    if (/zcode-startup/.test(cls)) return !/ready/.test(cls);
    // ZCode 4.0: no startup class while loading — the full-screen overlay is
    // the only signal. Check that it is actually visible: a stale hidden node
    // must not block the mount after the app marked itself ready.
    var load = document.getElementById('loading');
    if (load) {
      try {
        var lcs = getComputedStyle(load);
        if (lcs.display !== 'none' && lcs.visibility !== 'hidden' && Number(lcs.opacity || '1') > 0.05) return true;
      } catch (e) {}
    }
    return false;
  };`;
}
