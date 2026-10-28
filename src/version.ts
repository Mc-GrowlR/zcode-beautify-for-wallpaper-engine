/**
 * Plugin identity — the single source for the About page and the serve
 * /api/health payload. The esbuild bundle bakes these strings into
 * dist/cli.js, so the cache install needs no package.json beside it.
 * test/t11-panel-ui.ts keeps VERSION in sync with package.json.
 */
export const VERSION = "0.4.7";
export const REPO_URL = "https://github.com/Logocceai/zcode-beautify";
export const FORK_URL = "https://github.com/Mc-GrowlR/zcode-beautify-for-wallpaper-engine";
export const AUTHOR = "Logocceai";
export const LICENSE = "MIT";
