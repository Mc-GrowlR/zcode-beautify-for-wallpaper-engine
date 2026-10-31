/**
 * Maps Material Design 3 scheme roles onto the target app's design tokens.
 *
 * ZCode: Tailwind v4 `--color-*` semantic tokens (light in `:root`, dark in
 * `.dark`); we override both blocks so the app's own dark-mode switch works.
 *
 * WorkBuddy: the `--wb-*` design-token family (`html[data-theme=light|dark]`,
 * plus `.dark` / `html.cb-dark`), including the `--wb-palette-brand-*` ramp so
 * every brand-tinted control follows the wallpaper instead of staying teal.
 *
 * material-color-utilities 0.3.0 schemes lack the newer surfaceContainer*
 * roles, so those are derived from the neutral tonal palette at the official
 * MD3 tones (light: 100/96/94/92/90, dark: 4/10/12/17/22).
 */

import { argbToCss } from "./monet.js";
import { target } from "./target.js";
import type { Theme } from "@material/material-color-utilities";

export interface ThemeOptions {
  /** Wallpaper dimming overlay strength, 0-100 (higher = darker). */
  dim: number;
  /** Whether surface tokens should be translucent (wallpaper visible). */
  wallpaperVisible: boolean;
}

const LIGHT_SURFACE_TONES = { lowest: 100, low: 96, container: 94, high: 92, highest: 90 };
const DARK_SURFACE_TONES = { lowest: 4, low: 10, container: 12, high: 17, highest: 22 };

export function buildVariableOverrides(theme: Theme, opts: ThemeOptions): string {
  if (target().tokens === "wb") return buildWorkbuddyOverrides(theme, opts);
  return `${rootBlock(theme, opts)}\n.dark{${tokenRows(theme, "dark", opts).join("")}}`;
}

/**
 * Transparency-only overrides for `monet: false`: make the wallpaper show
 * through with neutral scrims while keeping the app's own colors untouched.
 * Only background/surface/input tokens are set; foregrounds, accents and
 * borders stay native.
 */
export function buildTransparencyOverrides(opts: { dim: number }): string {
  if (target().tokens === "wb") return buildWorkbuddyTransparency(opts);
  return `:root,:host{${transparencyRows("light", opts).join("")}}\n.dark{${transparencyRows("dark", opts).join("")}}`;
}

const LIGHT_SCRIM = "255,255,255";
const DARK_SCRIM = "18,18,22";

function transparencyRows(mode: "light" | "dark", opts: { dim: number }): string[] {
  const rgb = mode === "light" ? LIGHT_SCRIM : DARK_SCRIM;
  const baseAlpha = 0.72;
  const panelAlpha = 0.62;
  const inputAlpha = 0.5;
  const popoverAlpha = 0.92;
  return [
    `--color-background:transparent;`,
    `--color-background-alt:rgba(${rgb},${panelAlpha});`,
    `--color-background-win-alt:rgba(${rgb},${panelAlpha});`,
    `--color-panel:rgba(${rgb},${panelAlpha});`,
    `--color-sidebar:rgba(${rgb},${panelAlpha});`,
    `--color-surface:rgba(${rgb},${baseAlpha});`,
    `--color-surface-hover:rgba(${rgb},${baseAlpha});`,
    `--color-card:rgba(${rgb},${baseAlpha});`,
    `--color-card-selected:rgba(${rgb},${Math.min(1, baseAlpha + 0.15)});`,
    `--color-popover:rgba(${rgb},${popoverAlpha});`,
    `--color-input:rgba(${rgb},${inputAlpha});`,
    `--color-input-focused:rgba(${rgb},${Math.min(1, inputAlpha + 0.2)});`,
    opts.dim > 0 ? `--zcode-beautify-dim:${opts.dim / 100};` : "",
  ].filter(Boolean);
}

function rootBlock(theme: Theme, opts: ThemeOptions): string {
  return `:root,:host{${tokenRows(theme, "light", opts).join("")}}`;
}

function tokenRows(theme: Theme, mode: "light" | "dark", opts: ThemeOptions): string[] {
  const s = mode === "light" ? theme.schemes.light : theme.schemes.dark;
  const t = mode === "light" ? LIGHT_SURFACE_TONES : DARK_SURFACE_TONES;
  const n = theme.palettes.neutral;
  const A = (argb: number, alpha = 1) => argbToCss(argb, alpha);

  // Surface alpha: with a wallpaper we let it through; without one, opaque.
  const baseAlpha = opts.wallpaperVisible ? 0.72 : 1;
  const panelAlpha = opts.wallpaperVisible ? 0.62 : 1;
  const inputAlpha = opts.wallpaperVisible ? 0.5 : 1;
  const popoverAlpha = opts.wallpaperVisible ? 0.92 : 1;

  return [
    // Window & page backgrounds become transparent so the wallpaper layer shows.
    `--color-background:transparent;`,
    `--color-background-alt:${A(n.tone(t.high), panelAlpha)};`,
    `--color-background-win-alt:${A(n.tone(t.low), panelAlpha)};`,
    `--color-panel:${A(n.tone(t.low), panelAlpha)};`,
    `--color-sidebar:${A(n.tone(t.low), panelAlpha)};`,
    `--color-surface:${A(n.tone(t.lowest === 100 ? 98 : 6), baseAlpha)};`,
    `--color-surface-hover:${A(n.tone(t.high), baseAlpha)};`,
    `--color-card:${A(n.tone(t.container), baseAlpha)};`,
    `--color-card-selected:${A(n.tone(t.highest), Math.min(1, baseAlpha + 0.15))};`,
    `--color-card-border:${A(s.outlineVariant, 0.5)};`,
    `--color-popover:${A(n.tone(t.container), popoverAlpha)};`,
    `--color-input:${A(n.tone(t.highest), inputAlpha)};`,
    `--color-input-focused:${A(n.tone(t.highest), Math.min(1, inputAlpha + 0.2))};`,
    `--color-input-border:${A(s.outlineVariant, 0.6)};`,
    `--color-input-border-hover:${A(s.outline, 0.7)};`,
    `--color-input-border-focused:${A(s.primary, 0.9)};`,

    `--color-foreground:${A(s.onSurface)};`,
    `--color-foreground-subtle:${A(s.onSurfaceVariant)};`,
    `--color-foreground-subtlest:${A(s.onSurfaceVariant, 0.72)};`,
    `--color-foreground-inverse:${A(s.inverseOnSurface)};`,

    `--color-primary:${A(s.primary)};`,
    `--color-primary-foreground:${A(s.onPrimary)};`,
    `--color-secondary:${A(s.secondaryContainer)};`,
    `--color-accent:${A(s.tertiary)};`,
    `--color-brand:${A(s.primary)};`,

    `--color-border:${A(s.outlineVariant, 0.55)};`,
    `--color-border-hover:${A(s.outlineVariant, 0.9)};`,
    `--color-border-color-interactive:${A(s.outlineVariant, 0.7)};`,
    `--color-border-color-interactive-hover:${A(s.outlineVariant, 1)};`,
    `--color-border-color-interactive-active:${A(s.primary, 0.9)};`,
    `--color-find-highlight:${A(s.tertiaryContainer)};`,
    `--color-find-highlight-active:${A(s.secondaryContainer)};`,
    `--divider-color:${A(s.outlineVariant, 0.4)};`,
    opts.dim > 0 ? `--zcode-beautify-dim:${opts.dim / 100};` : "",
  ].filter(Boolean);
}

/* ------------------------------------------------------------------------- *
 * WorkBuddy (`--wb-*` design tokens)
 *
 * WorkBuddy defines its palette + semantic tokens under
 * `html[data-theme=light|dark]` / `.dark` and consumes them almost everywhere
 * (`var(--wb-…)` appears ~28k times in the renderer bundle). Overriding the
 * surface / text / border / brand families therefore re-themes the whole
 * client without touching a single component selector.
 *
 * Selector specificity matters: the app's dark block is `[data-theme=dark]`
 * (0,1,0), so every override here uses `html[...]` (0,1,1) — equal-or-higher
 * specificity plus later cascade order wins even during hydrated re-renders.
 * ------------------------------------------------------------------------- */

const WB_LIGHT = 'html[data-theme="light"],html.cb-light,:root';
const WB_DARK = 'html[data-theme="dark"],html.cb-dark,html.dark,body.dark,.dark';

function buildWorkbuddyOverrides(theme: Theme, opts: ThemeOptions): string {
  return `${WB_LIGHT}{${wbRows(theme, "light", opts).join("")}}\n${WB_DARK}{${wbRows(theme, "dark", opts).join("")}}`;
}

function buildWorkbuddyTransparency(opts: { dim: number }): string {
  const rows = (mode: "light" | "dark"): string => {
    const panel = mode === "light" ? "255,255,255" : "26,26,26";
    return [
      `--wb-bg-primary:transparent;`,
      `--wb-bg-content:rgba(${panel},.55);`,
      `--wb-bg-secondary:rgba(${panel},.62);`,
      `--wb-bg-tertiary:rgba(${panel},.55);`,
      `--wb-bg-card:rgba(${panel},.72);`,
      `--wb-bg-card-strong:rgba(${panel},.8);`,
      `--wb-bg-elevated:rgba(${panel},.94);`,
      `--wb-bg-popover:rgba(${panel},.94);`,
      `--wb-bg-modal:rgba(${panel},.96);`,
      `--wb-bg-hover-light:rgba(${panel},.6);`,
      `--wb-bg-hover-subtle:rgba(${panel},.5);`,
      opts.dim > 0 ? `--zcode-beautify-dim:${opts.dim / 100};` : "",
    ].join("");
  };
  return `${WB_LIGHT}{${rows("light")}}\n${WB_DARK}{${rows("dark")}}`;
}

function wbRows(theme: Theme, mode: "light" | "dark", opts: ThemeOptions): string[] {
  const s = mode === "light" ? theme.schemes.light : theme.schemes.dark;
  const n = theme.palettes.neutral;
  const p = theme.palettes.primary;
  const t = mode === "light" ? LIGHT_SURFACE_TONES : DARK_SURFACE_TONES;
  const A = (argb: number, alpha = 1) => argbToCss(argb, alpha);
  const tone = (v: number, alpha = 1) => A(n.tone(v), alpha);

  // Wallpaper on → surfaces go translucent so the fixed layer behind the app
  // shows through; wallpaper off → fully opaque surfaces for a clean UI.
  const wall = opts.wallpaperVisible;
  const base = wall ? 0.72 : 1;
  const panel = wall ? 0.62 : 1;
  const card = wall ? 0.74 : 1;
  const popover = wall ? 0.94 : 1;

  // Brand ramp: WorkBuddy's teal ramp runs 1 (lightest) → 10 (darkest) in the
  // light theme and is inverted in dark. Rebuilding it from the MD3 primary
  // tonal palette re-colors every brand control (buttons, links, focus rings,
  // selected pills) in one shot.
  const ramp =
    mode === "light"
      ? { 1: 95, 2: 90, 3: 85, 4: 78, 5: 70, 7: 55, 9: 30, 10: 20 }
      : { 1: 15, 2: 20, 3: 30, 4: 40, 5: 55, 7: 70, 9: 88, 10: 92 };
  const brand = [
    `--wb-palette-brand-1:${A(p.tone(ramp[1 as keyof typeof ramp]))};`,
    `--wb-palette-brand-2:${A(p.tone(ramp[2 as keyof typeof ramp]))};`,
    `--wb-palette-brand-3:${A(p.tone(ramp[3 as keyof typeof ramp]))};`,
    `--wb-palette-brand-4:${A(p.tone(ramp[4 as keyof typeof ramp]))};`,
    `--wb-palette-brand-5:${A(p.tone(ramp[5 as keyof typeof ramp]))};`,
    `--wb-palette-brand-7:${A(p.tone(ramp[7 as keyof typeof ramp]))};`,
    `--wb-palette-brand-8:${A(s.primary)};`,
    `--wb-palette-brand-9:${A(p.tone(ramp[9 as keyof typeof ramp]))};`,
    `--wb-palette-brand-10:${A(p.tone(ramp[10 as keyof typeof ramp]))};`,
  ];

  return [
    // --- surfaces -----------------------------------------------------------
    // The window background itself must be transparent: the wallpaper layer is
    // painted behind <html>, not inside a component.
    `--wb-bg-primary:transparent;`,
    `--wb-bg-content:${tone(mode === "light" ? 98 : 8, wall ? 0.58 : 1)};`,
    `--wb-bg-secondary:${tone(t.low, panel)};`,
    `--wb-bg-tertiary:${tone(t.highest, panel)};`,
    `--wb-bg-card:${tone(t.container, card)};`,
    `--wb-bg-card-strong:${tone(t.high, wall ? 0.8 : 1)};`,
    `--wb-bg-card-hover:${tone(t.high, wall ? 0.84 : 1)};`,
    `--wb-bg-elevated:${tone(t.highest, popover)};`,
    `--wb-bg-popover:${tone(t.container, popover)};`,
    `--wb-bg-modal:${tone(t.lowest, wall ? 0.96 : 1)};`,
    `--wb-bg-overlay:${A(s.scrim, 0.4)};`,
    `--wb-bg-item-selected:${A(s.primary, 0.14)};`,
    `--wb-bg-row-selected:${A(s.primary, 0.1)};`,
    `--wb-bg-hover:${A(s.onSurface, 0.06)};`,
    `--wb-bg-active:${A(s.onSurface, 0.1)};`,
    `--wb-bg-hover-light:${tone(t.container, wall ? 0.6 : 1)};`,
    `--wb-bg-hover-subtle:${tone(t.low, wall ? 0.5 : 1)};`,
    `--wb-bg-inset-strong:${tone(t.highest, wall ? 0.62 : 1)};`,
    `--wb-bg-skeleton:${A(s.onSurface, 0.06)};`,
    `--wb-bg-input-inset:transparent;`,
    `--wb-bg-input-slot-gradient:transparent;`,

    // --- controls (buttons / segmented controls / pills) --------------------
    `--wb-color-bg-primary-default:${tone(t.highest, wall ? 0.55 : 1)};`,
    `--wb-color-bg-primary-hover:${tone(t.high, wall ? 0.7 : 1)};`,
    `--wb-color-bg-primary-active:${A(s.primary, 0.22)};`,
    `--wb-color-bg-primary-hover-strong:${tone(t.high, wall ? 0.8 : 1)};`,
    `--wb-color-bg-secondary-default:${tone(t.low, wall ? 0.7 : 1)};`,
    `--wb-color-bg-secondary-hover-active:${tone(t.high, wall ? 0.7 : 1)};`,

    // --- text ---------------------------------------------------------------
    `--wb-color-text-primary:${A(s.onSurface)};`,
    `--wb-color-text-secondary:${A(s.onSurface, 0.72)};`,
    `--wb-color-text-secondary-solid:${A(s.onSurfaceVariant, 0.82)};`,
    `--wb-color-text-tertiary:${A(s.onSurface, 0.55)};`,
    `--wb-color-text-placeholder:${A(s.onSurface, 0.45)};`,
    `--wb-color-text-disabled:${A(s.onSurface, 0.35)};`,
    `--wb-color-text-hint:${A(s.onSurface, 0.35)};`,
    `--wb-color-text-solid:${A(s.onSurface)};`,
    `--wb-color-text-subtle:${A(s.onSurfaceVariant, 0.6)};`,
    `--wb-text-strong:${A(s.onSurface)};`,
    `--wb-text-medium:${A(s.onSurface, 0.72)};`,
    `--wb-text-weak:${A(s.onSurface, 0.55)};`,
    `--wb-text-disable:${A(s.onSurface, 0.35)};`,
    `--wb-text-muted:${A(s.onSurface, 0.35)};`,
    `--wb-text-on-primary:${A(s.onPrimary)};`,
    `--wb-text-link:${A(s.primary)};`,
    `--wb-text-link-brand:${A(s.primary)};`,
    `--wb-color-text-link-default:${A(s.primary)};`,
    `--wb-color-text-link-hover:${A(s.primary, 0.85)};`,
    `--wb-text-action:${A(s.primary)};`,
    `--wb-text-placeholder-soft:${A(s.onSurface, 0.35)};`,
    `--wb-icon-primary:${A(s.onSurface, 0.86)};`,
    `--wb-icon-default:${A(s.onSurface, 0.86)};`,

    // --- borders ------------------------------------------------------------
    `--wb-border-default:${A(s.outlineVariant, 0.55)};`,
    `--wb-border-weak:${A(s.outlineVariant, 0.35)};`,
    `--wb-border-subtle:${tone(t.highest, 0.66)};`,
    `--wb-border-subtle-soft:${A(s.outlineVariant, 0.3)};`,
    `--wb-border-strong:${A(s.outline, 0.9)};`,
    `--wb-border-hover:${A(s.outlineVariant, 0.9)};`,
    `--wb-border-card:${A(s.outlineVariant, 0.35)};`,
    `--wb-border-card-static:${A(s.outlineVariant, 0.28)};`,
    `--wb-border-input:${A(s.outlineVariant, 0.7)};`,
    `--wb-border-control:${A(s.outlineVariant, 0.6)};`,
    `--wb-border-faint:${A(s.onSurface, 0.08)};`,
    `--wb-border-selected:${A(s.primary, 0.6)};`,
    `--wb-color-border-primary:${A(s.outline, 0.75)};`,
    `--wb-color-border-secondary:${A(s.outlineVariant, 0.6)};`,
    `--wb-color-border-tertiary:${A(s.outlineVariant, 0.4)};`,
    `--wb-color-border-focus:${A(s.primary)};`,
    `--wb-border-action:${A(s.primary)};`,

    // --- accent action color (blue in stock WorkBuddy) ----------------------
    `--wb-accent-blue:${A(s.primary)};`,
    `--wb-accent-blue-soft:${A(s.primary, 0.16)};`,
    `--wb-text-link-default:${A(s.primary)};`,
    `--wb-bg-action:${A(s.primary)};`,
    `--wb-text-on-inverse:${A(s.onPrimary)};`,

    ...brand,
    opts.dim > 0 ? `--zcode-beautify-dim:${opts.dim / 100};` : "",
  ].filter(Boolean);
}
