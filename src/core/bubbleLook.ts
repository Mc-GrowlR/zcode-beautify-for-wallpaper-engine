/**
 * Bubble-look contract shared by the injector, the panel and the Bubble Studio
 * store. Kept in its own module on purpose: the MCP server and the studio only
 * need these types + the clamp function, and importing them from inject.ts
 * would drag the whole injection pipeline (and jimp, via monet) into every MCP
 * process just to normalize a five-field object.
 */

import { sanitizeCustomBubbleCss } from "./bubbleRecipes.js";

/**
 * User message bubble look (聊天气泡): preset + tint/radius/width/align.
 * "default" injects nothing — the bubble stays exactly stock. Colors never
 * live here: the injected rules color-mix the live --color-* tokens, so a
 * Monet re-theme restyles the bubble with zero extra work.
 */
export type BubblePreset = "default" | "accent" | "glass" | "outline" | "flat" | "custom";

export interface BubbleLookConfig {
  preset: BubblePreset;
  /** Accent strength 0-100 (mix ratio into the surface background). */
  tint: number;
  /** Corner radius 4-24px on the three round corners; the tail stays 2px. */
  radius: number;
  /** Max bubble width as % of the conversation column (40-90). */
  width: number;
  /** Right is ZCode's stock alignment; left mirrors the tail corner too. */
  align: "right" | "left";
  /**
   * User-authored CSS for preset "custom" — written against the friendly
   * selectors .zb-bubble / .zb-bubble-row, sanitized here and rewritten to
   * ZCode's real selectors at injection time (see core/bubbleRecipes.ts).
   */
  customCss?: string;
}

export const DEFAULT_BUBBLE_LOOK: BubbleLookConfig = {
  preset: "default",
  tint: 28,
  radius: 12,
  width: 70,
  align: "right",
};

const BUBBLE_PRESETS: BubblePreset[] = ["default", "accent", "glass", "outline", "flat", "custom"];

/** Clamp a partial bubble look over the defaults (unparsable fields fall back). */
export function normalizeBubbleLook(raw?: Partial<BubbleLookConfig>): BubbleLookConfig {
  const num = (v: unknown, min: number, max: number, dflt: number): number =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : dflt;
  const preset = BUBBLE_PRESETS.includes(raw?.preset as BubblePreset) ? raw!.preset! : "default";
  return {
    preset,
    tint: num(raw?.tint, 0, 100, DEFAULT_BUBBLE_LOOK.tint),
    radius: num(raw?.radius, 4, 24, DEFAULT_BUBBLE_LOOK.radius),
    width: num(raw?.width, 40, 90, DEFAULT_BUBBLE_LOOK.width),
    align: raw?.align === "left" ? "left" : "right",
    customCss: sanitizeCustomBubbleCss(raw?.customCss),
  };
}
