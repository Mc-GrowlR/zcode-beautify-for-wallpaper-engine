/**
 * Plugin identity — the single source for the About page and the serve
 * /api/health payload. The esbuild bundle bakes these strings into
 * dist/cli.js, so the cache install needs no package.json beside it.
 * test/t11-panel-ui.ts keeps VERSION in sync with package.json.
 */
export const VERSION = "0.4.9";
export const REPO_URL = "https://github.com/Logocceai/zcode-beautify";
export const FORK_URL = "https://github.com/Mc-GrowlR/zcode-beautify-for-wallpaper-engine";
export const AUTHOR = "Mc-GrowlR";
export const LICENSE = "MIT";

/**
 * Compare two dotted numeric versions ("v0.4.8" / "0.4.9"): >0 when a is
 * newer, <0 older, 0 equal. Non-numeric segments read as 0 — this project
 * ships plain three-part tags, no prerelease syntax to model.
 */
export function cmpVersion(a: string, b: string): number {
  const seg = (v: string | undefined) => String(v ?? "").replace(/^v/, "").split(".").map((n) => Number(n) || 0);
  const pa = seg(a);
  const pb = seg(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
