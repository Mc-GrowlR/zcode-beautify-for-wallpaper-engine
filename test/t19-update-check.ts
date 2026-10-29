/**
 * T19 UPDATE CHECK verification (关于页「检查更新」): the 0.4.8 about-page
 * update contracts —
 *   A  cmpVersion ordering matrix (the hasUpdate decision hinges on it);
 *   B  serve wiring: /api/update-check route, GitHub API derived from FORK_URL
 *      (no second hardcoded repo string), 60s cache, degraded-error shape;
 *   C  panel wiring: the three new ids exist in the About card, the button
 *      drives apiFetch('/api/update-check'), and a found update turns the
 *      same button into "打开发布页" with a copy-link fallback.
 *
 * Live endpoint behavior (token gate + payload shape) lives in t13's smoke
 * run; this file stays offline.
 *
 * Run: npx tsx test/t19-update-check.ts
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { cmpVersion, VERSION, FORK_URL } from "../src/version.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}
const root = fileURLToPath(new URL("../", import.meta.url));
const read = (p: string) => fs.readFileSync(p, "utf8");
const server = read("src/core/server.ts");
const panel = read("src/panel/panelScript.ts");

// --- part A: version ordering ------------------------------------------------
{
  const newer = (a: string, b: string, expect: number, label: string) => {
    const got = Math.sign(cmpVersion(a, b));
    check(label, got === expect, `${a} vs ${b} → ${got}, want ${expect}`);
  };
  newer("0.4.9", "0.4.8", 1, "patch bump is newer");
  newer("0.5.0", "0.4.9", 1, "minor bump beats patch");
  newer("1.0.0", "0.9.9", 1, "major bump beats minor");
  newer("0.4.10", "0.4.9", 1, "double-digit patch segments compare numerically, not lexically");
  newer("0.4.7", "0.4.8", -1, "older release compares negative");
  newer("v0.4.8", "0.4.8", 0, "leading v is ignored on both sides");
  newer("0.4", "0.4.0", 0, "missing segments read as 0");
  check("current version compares equal to itself", cmpVersion(VERSION, VERSION) === 0);
}

// --- part B: serve wiring ----------------------------------------------------
{
  check("route registered for GET /api/update-check",
    server.includes('req.method === "GET"') && server.includes('"/api/update-check"'));
  check("GitHub API derived from FORK_URL (single source of truth)",
    server.includes('FORK_URL.replace("https://github.com", "https://api.github.com/repos")'),
    "must not hardcode a second repo string");
  check("FORK_URL still points at the fork", FORK_URL.includes("Mc-GrowlR/zcode-beautify-for-wallpaper-engine"));
  check("result cached for 60s (GitHub unauth rate limit)", server.includes("60_000"));
  check("network failure degrades to ok:false rather than throwing",
    server.includes('{ ok: false, error: "network"'));
  check("hasUpdate uses cmpVersion against VERSION",
    /cmpVersion\(latest,\s*VERSION\)\s*>\s*0/.test(server));
  check("no-release 404 reads as up-to-date, not an error",
    /404[\s\S]{0,200}ok: true,\s*current: VERSION,\s*latest: null/.test(server));
}

// --- part C: panel wiring ----------------------------------------------------
{
  for (const id of ["zb-ab-check", "zb-ab-upd-sub", "zb-ab-copy-rel"]) {
    check(`panel HTML carries id ${id}`, panel.includes(`id="${id}"`));
    check(`panel JS references ${id}`, panel.includes(`'${id}'`) || panel.includes(`"${id}"`));
  }
  check("button polls the serve endpoint", panel.includes("apiFetch('/api/update-check')"));
  check("pending state disables the button", panel.includes("btn.disabled = true"));
  check("found update turns the button into 打开发布页", panel.includes("'打开发布页'"));
  check("open failure falls back to copying the link", /window\.open[\s\S]{0,160}zbCopyRepo/.test(panel));
  check("up-to-date copy names the current version", panel.includes("已是最新版本"));
}

console.log(failed === 0 ? "\nT19 all green" : `\nT19 FAILED (${failed})`);
process.exit(failed === 0 ? 0 : 1);
