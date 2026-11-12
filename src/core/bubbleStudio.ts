/**
 * Bubble Studio store (气泡工坊): named bubble-look recipes persisted in the
 * plugin data dir, plus the state snapshot the studio page renders and the
 * `_meta` descriptor that makes a tool result open the interactive gallery
 * (MCP Apps, hosts without UI support just show the plain card).
 *
 * Storage is a plain JSON file beside config.json — deliberately NOT part of
 * StoredConfig, so recipe edits never rewrite the injection config.
 */

import fs from "node:fs";
import path from "node:path";
import { dataDir, loadConfig } from "./launch.js";
import { normalizeBubbleLook, type BubbleLookConfig } from "./inject.js";

/** URI of the studio page served by this MCP server (resource read). */
export const BUBBLE_STUDIO_URI = "ui://zcode-beautify/bubble-studio.html";
/** Manifest surface id (.zcode-plugin/plugin.json ui.surfaces[].id). */
export const BUBBLE_STUDIO_SURFACE = "bubble-studio";

/** One selectable recipe in the gallery. */
export interface BubbleRecipe {
  id: string;
  name: string;
  look: BubbleLookConfig;
  /** Present on the five stock presets (not deletable). */
  builtin?: boolean;
  createdAt?: number;
}

const BUILTIN_NAMES: Record<Exclude<BubbleLookConfig["preset"], "custom">, string> = {
  default: "ZCode 原版",
  accent: "主题强调色",
  glass: "玻璃拟态",
  outline: "描边",
  flat: "扁平",
};

/** Stock gallery entries; `look` doubles as the preview seed for each preset. */
export function builtinBubbleRecipes(): BubbleRecipe[] {
  const seed: BubbleLookConfig = { preset: "default", tint: 28, radius: 12, width: 70, align: "right" };
  return (Object.keys(BUILTIN_NAMES) as Array<keyof typeof BUILTIN_NAMES>).map((preset) => ({
    id: preset,
    name: BUILTIN_NAMES[preset],
    builtin: true,
    look: preset === "default" ? { ...seed } : { ...seed, preset, tint: preset === "outline" ? 40 : 28, radius: preset === "glass" ? 16 : 12 },
  }));
}

/** Upper bound for saved recipes — the inline page renders them all at once. */
export const MAX_SAVED_RECIPES = 50;

function recipesFile(): string {
  return path.join(dataDir(), "bubble-recipes.json");
}

interface RecipeFile {
  version: 1;
  recipes: BubbleRecipe[];
}

function readSaved(): BubbleRecipe[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(recipesFile(), "utf8")) as RecipeFile;
    if (!Array.isArray(parsed?.recipes)) return [];
    return parsed.recipes.filter((r) => r && typeof r.id === "string" && typeof r.name === "string");
  } catch {
    return [];
  }
}

function writeSaved(recipes: BubbleRecipe[]): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  const file: RecipeFile = { version: 1, recipes };
  fs.writeFileSync(recipesFile(), JSON.stringify(file, null, 2));
}

function lookEquals(a: BubbleLookConfig, b: BubbleLookConfig): boolean {
  return a.preset === b.preset && a.tint === b.tint && a.radius === b.radius && a.width === b.width && a.align === b.align && (a.customCss ?? "") === (b.customCss ?? "");
}

function newId(): string {
  return "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

/** Full state snapshot consumed by the studio page. */
export interface BubbleStudioState {
  uri: string;
  /** Currently applied look (normalized from the stored config). */
  active: BubbleLookConfig;
  /** Id of the gallery entry matching `active`, when one does. */
  activeRecipeId: string | null;
  builtins: BubbleRecipe[];
  saved: BubbleRecipe[];
}

export function bubbleStudioState(): BubbleStudioState {
  const builtins = builtinBubbleRecipes();
  const saved = readSaved();
  const active = normalizeBubbleLook(loadConfig().bubbleLook);
  const match = [...saved, ...builtins].find((r) => lookEquals(normalizeBubbleLook(r.look), active));
  return { uri: BUBBLE_STUDIO_URI, active, activeRecipeId: match ? match.id : null, builtins, saved };
}

export interface SaveRecipeInput {
  id?: string;
  name?: string;
  /** Defaults to the currently applied look ("save what is live now"). */
  look?: Partial<BubbleLookConfig>;
}

/** Insert or update a named recipe; returns the stored copy. */
export function saveBubbleRecipe(input: SaveRecipeInput): BubbleRecipe {
  const recipes = readSaved();
  const existing = input.id ? recipes.find((r) => r.id === input.id) : undefined;
  // Partial looks merge over the fallback (the recipe being updated, else the
  // currently applied look) — same "omitted fields keep their value" contract
  // as apply_options' bubble patch.
  const base = { ...loadConfig().bubbleLook, ...(existing ? existing.look : {}), ...input.look };
  const look = normalizeBubbleLook(base);
  const name = String(input.name ?? "").trim().slice(0, 40) || existing?.name || "气泡配方";
  if (existing) {
    existing.name = name;
    existing.look = look;
    writeSaved(recipes);
    return existing;
  }
  if (recipes.length >= MAX_SAVED_RECIPES) {
    throw new Error(`已保存 ${MAX_SAVED_RECIPES} 个配方，请先删除一些再保存`);
  }
  const recipe: BubbleRecipe = { id: newId(), name, look, createdAt: Date.now() };
  recipes.push(recipe);
  writeSaved(recipes);
  return recipe;
}

/** Delete a saved recipe by id (builtin ids are refused). */
export function deleteBubbleRecipe(id: string): void {
  if (builtinBubbleRecipes().some((r) => r.id === id)) {
    throw new Error("内置样式不能删除");
  }
  const recipes = readSaved();
  const next = recipes.filter((r) => r.id !== id);
  if (next.length === recipes.length) throw new Error(`找不到配方: ${id}`);
  writeSaved(next);
}

/**
 * `_meta` for tool results that should surface the interactive gallery on
 * MCP-Apps hosts. Both the nested key and the legacy flat key are set (the
 * spec requires hosts to honor the flat one; newer hosts read the nested one).
 */
export function bubbleStudioResultMeta(): Record<string, unknown> {
  return {
    ui: { resourceUri: BUBBLE_STUDIO_URI, surface: BUBBLE_STUDIO_SURFACE },
    "ui/resourceUri": BUBBLE_STUDIO_URI,
  };
}

/**
 * Map the apply_options tool schema's snake_case bubble fields onto
 * BubbleLookConfig's camelCase keys. A raw passthrough leaves `custom_css` as
 * a dead stored key nothing reads while `customCss` keeps the previous style
 * — every "applied" bubble change silently no-ops (live incident 2026-11-11:
 * the tool kept answering success while the look never changed). Same shape
 * as the spinner mapping (image_path → image) in the tool handler.
 */
export function bubbleLookPatchFromTool(bubble: Record<string, unknown>): Partial<BubbleLookConfig> {
  const patch: Partial<BubbleLookConfig> = {};
  if (bubble.preset !== undefined) patch.preset = bubble.preset as BubbleLookConfig["preset"];
  if (bubble.tint !== undefined) patch.tint = bubble.tint as number;
  if (bubble.radius !== undefined) patch.radius = bubble.radius as number;
  if (bubble.width !== undefined) patch.width = bubble.width as number;
  if (bubble.align !== undefined) patch.align = bubble.align as BubbleLookConfig["align"];
  if (bubble.custom_css !== undefined) patch.customCss = bubble.custom_css as string;
  return patch;
}
