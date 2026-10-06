/**
 * Local Wallpaper Engine library discovery: enumerates Steam workshop
 * content (`steamapps/workshop/content/431960/<publishedfileid>`) and editor
 * projects (`wallpaper_engine/projects/myprojects/<name>`) across every
 * Steam library on the machine. Each wallpaper directory feeds straight
 * into the existing scene/video import pipeline — no new import path.
 */

import fs from "node:fs";
import path from "node:path";
import { detectWallpaperType } from "./wallpaperType.js";
import { steamLibraryCandidates } from "./dependencyCheck.js";

export interface WeWallpaper {
  /** Workshop publishedfileid or myprojects folder name. */
  id: string;
  title: string;
  type: "scene" | "video" | "web";
  /** Absolute wallpaper directory — the value /api/import-scene accepts. */
  dir: string;
  /** Preview image filename inside dir (tokenless media URL is built by serve). */
  previewName?: string;
  /** scene/video can be imported; web wallpapers are listed but disabled. */
  importable: boolean;
  source: "workshop" | "myprojects";
}

export interface WeLibraryRoot {
  kind: "workshop" | "myprojects";
  dir: string;
}

const PREVIEW_FALLBACKS = ["preview.jpg", "preview.gif", "preview.png"];
const PREVIEW_NAME_RE = /^[^\\/:*?"<>|]+\.(jpe?g|gif|png|webp)$/i;

function isDirWithEntries(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory() && fs.readdirSync(p).length > 0;
  } catch {
    return false;
  }
}

function readJsonSafe(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Wallpaper sources across all Steam libraries (deduped, case-insensitive). */
export function findWeRoots(): WeLibraryRoot[] {
  const roots: WeLibraryRoot[] = [];
  const seen = new Set<string>();
  for (const lib of steamLibraryCandidates()) {
    const candidates: Array<[WeLibraryRoot["kind"], string]> = [
      ["workshop", path.join(lib, "steamapps", "workshop", "content", "431960")],
      ["myprojects", path.join(lib, "steamapps", "common", "wallpaper_engine", "projects", "myprojects")],
    ];
    for (const [kind, dir] of candidates) {
      const key = dir.toLowerCase();
      if (seen.has(key) || !isDirWithEntries(dir)) continue;
      seen.add(key);
      roots.push({ kind, dir });
    }
  }
  return roots;
}

/**
 * One wallpaper per directory. Junk folders (partial workshop downloads,
 * shader caches without project.json of their own) drop out via the type
 * probe; titles fall back to the folder name. CJK-aware sort, importable
 * types first.
 */
export function listWeWallpapers(): WeWallpaper[] {
  const items: WeWallpaper[] = [];
  for (const root of findWeRoots()) {
    let entries: string[];
    try {
      entries = fs.readdirSync(root.dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const dir = path.join(root.dir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(dir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      const type = detectWallpaperType(dir);
      if (type !== "scene" && type !== "video" && type !== "web") continue;
      const project = readJsonSafe(path.join(dir, "project.json"));
      const title =
        typeof project?.title === "string" && project.title.trim() ? project.title.trim() : name;
      const declared = typeof project?.preview === "string" ? project.preview : undefined;
      const previewName =
        declared && PREVIEW_NAME_RE.test(declared)
          ? declared
          : PREVIEW_FALLBACKS.find((f) => fs.existsSync(path.join(dir, f)));
      const usable = previewName ? fs.existsSync(path.join(dir, previewName)) : false;
      items.push({
        id: name,
        title,
        type,
        dir,
        previewName: usable ? previewName : undefined,
        importable: type !== "web",
        source: root.kind,
      });
    }
  }
  const order: Record<WeWallpaper["type"], number> = { scene: 0, video: 1, web: 2 };
  items.sort((a, b) => order[a.type] - order[b.type] || a.title.localeCompare(b.title, "zh"));
  return items;
}

/** Resolve a preview request against the live roots; undefined = rejected. */
export function resolveWePreview(
  source: string,
  id: string,
  file: string
): string | undefined {
  if (!PREVIEW_NAME_RE.test(file)) return undefined;
  // Same charset as the filename half of PREVIEW_NAME_RE: one path component.
  if (!/^[^\\/:*?"<>|]+$/.test(id)) return undefined;
  const kind = source === "workshop" || source === "myprojects" ? source : undefined;
  if (!kind) return undefined;
  const root = findWeRoots().find((r) => r.kind === kind);
  if (!root) return undefined;
  const dir = path.resolve(root.dir, id);
  const rootResolved = path.resolve(root.dir);
  if (!dir.toLowerCase().startsWith(rootResolved.toLowerCase() + path.sep)) return undefined;
  const fileAbs = path.resolve(dir, file);
  if (path.dirname(fileAbs).toLowerCase() !== dir.toLowerCase()) return undefined;
  return fs.existsSync(fileAbs) ? fileAbs : undefined;
}
