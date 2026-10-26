/**
 * Shared bubble-style engine: the four built-in preset recipes plus the
 * custom-CSS pipeline (sanitize → rewrite). Used by BOTH sides so they can
 * never drift:
 *   - cdp.ts bakes the recipes + rewritten custom CSS into the injected
 *     bootstrap (real ZCode selectors);
 *   - panelScript.ts bakes the recipes with the PREVIEW class names into the
 *     panel, where the user's CSS runs as-written inside a sandboxed iframe.
 *
 * The friendly contract for custom styles: `.zb-bubble` = the user message
 * bubble, `.zb-bubble-row` = its conversation row. The rewrite maps them onto
 * ZCode's real selectors serve-side; in the preview iframe the class names are
 * literal, so zero rewriting is needed there.
 */

/** ZCode's real selector for a user message bubble. */
export const BUBBLE_SELECTOR_REAL = '[data-v4-user-input-bubble]';
/** ZCode's real selector for the row holding a user message bubble. */
export const BUBBLE_ROW_SELECTOR_REAL = '[class~="group/user-row"]';

/** Preview (panel iframe) class names — identical to the friendly contract. */
export const BUBBLE_SELECTOR_PREVIEW = ".zb-bubble";
export const BUBBLE_ROW_SELECTOR_PREVIEW = ".zb-bubble-row";

/** Cap for user CSS — enough for elaborate styles, small enough to be safe. */
export const CUSTOM_CSS_MAX = 8000;

/**
 * The built-in preset recipes, parameterized by bubble selector so the panel
 * preview and the real injection share one source. Mirrors the look the
 * panel has shipped since 0.4.2.
 */
export function bubbleRecipes(sel: string): Record<string, string> {
  return {
    accent:
      sel + "{background:color-mix(in srgb,var(--color-primary) calc(var(--zb-bubble-tint)*100%),var(--color-surface))!important;" +
      "border:1px solid color-mix(in srgb,var(--color-primary) 55%,transparent)!important;" +
      "box-shadow:0 4px 18px rgb(0 0 0/0.28)!important}",
    glass:
      sel + "{background:color-mix(in srgb,var(--color-surface) 55%,transparent)!important;" +
      "border:1px solid color-mix(in srgb,var(--color-primary) calc(var(--zb-bubble-tint)*60% + 15%),transparent)!important;" +
      "backdrop-filter:blur(8px)!important;box-shadow:0 4px 18px rgb(0 0 0/0.28)!important}",
    outline:
      sel + "{background:transparent!important;" +
      "border:1.5px solid color-mix(in srgb,var(--color-primary) calc(var(--zb-bubble-tint)*100% + 20%),transparent)!important}",
    flat:
      sel + "{background:var(--color-surface)!important;border-color:transparent!important}",
  };
}

/**
 * Make arbitrary user CSS safe to embed in a <style> element and in a srcdoc
 * iframe: no breaking out of the style tag, no network fetches, no legacy
 * javascript: URLs, hard length cap.
 */
export function sanitizeCustomBubbleCss(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let css = raw.slice(0, CUSTOM_CSS_MAX);
  css = css.replace(/<\/style/gi, "");
  css = css.replace(/@import[^;{]*[;{]?/gi, "");
  css = css.replace(/javascript:/gi, "");
  return css.trim();
}

/**
 * Map the friendly selectors onto real ones. `.zb-bubble-row` must be
 * replaced BEFORE `.zb-bubble` (it contains it); the lookahead keeps
 * `.zb-bubble-row` from being half-matched.
 */
export function rewriteCustomBubbleCss(css: string, sel: string, rowSel: string): string {
  return css
    .replace(/\.zb-bubble-row(?![\w-])/g, rowSel)
    .replace(/\.zb-bubble(?![\w-])/g, sel);
}
