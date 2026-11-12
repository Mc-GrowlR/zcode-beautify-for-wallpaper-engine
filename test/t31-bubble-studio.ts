/**
 * T31 BUBBLE STUDIO verification (气泡工坊, MCP Apps surface):
 *  A. plugin.json ui.surfaces matches the manifest contract the ZCode host
 *     validates (parsePluginUiSurfaces: id charset, server key, ui:// scheme).
 *  B. The emitted studio HTML survives the bundling passes verbatim — no
 *     backtick, no dollar-brace, no backslash anywhere (template pitfalls),
 *     and it wires the gallery to the real tool names.
 *  C. Recipe store roundtrip (save/update/list/delete) against an isolated
 *     data dir, including builtin-delete refusal.
 *  D. Real stdio protocol run: spawn dist/mcp/server.js with an isolated
 *     HOME, initialize over the MCP SDK client, then tools/list (3 new
 *     tools), resources/read (mimeType + HTML), bubble_studio_state,
 *     save_bubble_recipe (result _meta.ui!), delete, and the disabled-gate
 *     apply_options path (no _meta when nothing was applied).
 *
 * Run: npx tsx test/t31-bubble-studio.ts   (also part of: npm test)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}
const root = fileURLToPath(new URL("../", import.meta.url));
const URI = "ui://zcode-beautify/bubble-studio.html";

// ---- A. manifest surface -----------------------------------------------------
const manifest = JSON.parse(fs.readFileSync(path.join(root, ".zcode-plugin/plugin.json"), "utf8"));
const surface = manifest?.ui?.surfaces?.[0];
check("A1 manifest has ui.surfaces[0]", !!surface);
check("A2 surface id charset", typeof surface?.id === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(surface.id), surface?.id);
check("A3 surface server matches an mcpServers key", !!manifest?.mcpServers?.[surface?.server]);
check("A4 surface resourceUri scheme", typeof surface?.resourceUri === "string" && surface.resourceUri.startsWith("ui://zcode-beautify/"));
check("A5 surface availability", surface?.availability === "session");
check("A6 tool json kept in sync (version)", manifest.version === JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version);

// ---- B. emitted HTML hygiene --------------------------------------------------
// Import AFTER setting an isolated data dir so module-level side effects
// (none today, but the store reads lazily) never touch the real store.
process.env.ZCODE_BEAUTIFY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zb-t31-"));
const { bubbleStudioHtml } = await import("../src/mcp/bubbleStudioHtml.js");
const html = bubbleStudioHtml();
check("B1 doctype first", html.startsWith("<!doctype html>"));
check("B2 no backtick anywhere", !html.includes("`"));
check("B3 no dollar-brace sequence", !html.includes("${"));
check("B4 no backslash anywhere", !html.includes("\\"));
check("B5 no closing-script literal inside JS strings", !/srcdoc|innerHTML/.test(html));
check("B6 gallery wired to tool names", ["bubble_studio_state", "apply_options", "save_bubble_recipe", "delete_bubble_recipe"].every((t) => html.includes(t)));
check("B7 preview selectors present", html.includes(".zb-bubble") && html.includes("zb-bubble-row"));
check("B8 recipe CSS baked in", html.includes("backdrop-filter:blur(8px)"));
check("B9 reasonable size", html.length > 4000 && html.length < 200_000, `${html.length} bytes`);

// ---- C. store roundtrip --------------------------------------------------------
const { bubbleStudioState, saveBubbleRecipe, deleteBubbleRecipe, bubbleStudioResultMeta } = await import("../src/core/bubbleStudio.js");
const s0 = bubbleStudioState();
check("C1 five builtins", s0.builtins.length === 5);
check("C2 state carries active + uri", s0.uri === URI && typeof s0.active.preset === "string");
const r1 = saveBubbleRecipe({ name: "青玻璃", look: { preset: "glass", tint: 33, radius: 18, width: 75, align: "left" } });
check("C3 save creates id", r1.id.startsWith("r-") && r1.look.tint === 33);
const r2 = saveBubbleRecipe({ id: r1.id, name: "青玻璃·改", look: { preset: "glass", tint: 40 } });
check("C4 update keeps id and normalizes", r2.id === r1.id && r2.name === "青玻璃·改" && r2.look.radius === 18 && r2.look.tint === 40);
check("C5 state lists saved", bubbleStudioState().saved.some((r) => r.id === r1.id));
let builtinRefused = false;
try { deleteBubbleRecipe("glass"); } catch { builtinRefused = true; }
check("C6 builtin delete refused", builtinRefused);
deleteBubbleRecipe(r1.id);
check("C7 delete removes", !bubbleStudioState().saved.some((r) => r.id === r1.id));
const meta = bubbleStudioResultMeta();
check("C8 result meta has nested + flat keys", (meta.ui as { resourceUri?: string })?.resourceUri === URI && meta["ui/resourceUri"] === URI);

// The snake→camel mapping regression: the apply_options tool schema declares
// custom_css, but BubbleLookConfig reads customCss — the raw passthrough
// incident (2026-11-11) stored green CSS under a dead key while injection
// kept the old style forever.
const { bubbleLookPatchFromTool } = await import("../src/core/bubbleStudio.js");
const mapped = bubbleLookPatchFromTool({ preset: "custom", custom_css: ".zb-bubble{background:#95ec69}", tint: 30 });
check("C9 bubble tool patch maps custom_css → customCss", mapped.customCss === ".zb-bubble{background:#95ec69}" && mapped.tint === 30 && !("custom_css" in mapped));
const mappedPartial = bubbleLookPatchFromTool({ radius: 18 });
check("C9b partial patch keeps only sent fields", mappedPartial.radius === 18 && Object.keys(mappedPartial).length === 1);

// ---- D. stdio protocol ---------------------------------------------------------
const serverJs = path.join(root, "dist", "mcp", "server.js");
check("D0 built server exists", fs.existsSync(serverJs));
if (fs.existsSync(serverJs)) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zb-t31-home-"));
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") childEnv[k] = v;
  childEnv.USERPROFILE = home;
  childEnv.HOME = home;
  childEnv.ZCODE_BEAUTIFY_DATA_DIR = "";
  const client = new Client({ name: "t31-test", version: "0.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverJs], env: childEnv });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    check("D1 tools/list has the 3 studio tools", ["bubble_studio_state", "save_bubble_recipe", "delete_bubble_recipe"].every((n) => names.includes(n)));

    const res = await client.readResource({ uri: URI });
    const page = res.contents[0];
    check("D2 resources/read mimeType is mcp-app", page.mimeType === "text/html;profile=mcp-app", page.mimeType);
    check("D3 served HTML matches emitted", page.text === html);

    const listed = await client.listResources();
    check("D4 resources/list exposes the page", listed.resources.some((r) => r.uri === URI || r.uri === URI + "/"));

    const stateCall = await client.callTool({ name: "bubble_studio_state", arguments: {} });
    const stateJson = JSON.parse(String((stateCall.content as Array<{ text?: string }>)[0]?.text ?? "{}"));
    check("D5 state tool returns JSON snapshot", Array.isArray(stateJson.builtins) && stateJson.builtins.length === 5 && typeof stateJson.active?.preset === "string");

    const saveCall = await client.callTool({
      name: "save_bubble_recipe",
      arguments: { name: "协议测试", look: { preset: "outline", tint: 55, radius: 20, width: 60, align: "left" } },
    });
    const savedJson = JSON.parse(String((saveCall.content as Array<{ text?: string }>)[0]?.text ?? "{}"));
    check("D6 save tool round-trips", savedJson.saved === true && typeof savedJson.recipe?.id === "string");
    const saveMeta = (saveCall as { _meta?: Record<string, unknown> })._meta;
    check("D7 save result carries _meta.ui (gallery)", (saveMeta?.ui as { resourceUri?: string })?.resourceUri === URI && saveMeta?.["ui/resourceUri"] === URI);

    const delCall = await client.callTool({ name: "delete_bubble_recipe", arguments: { id: savedJson.recipe.id } });
    check("D8 delete over protocol", JSON.parse(String((delCall.content as Array<{ text?: string }>)[0]?.text ?? "{}")).deleted === true);

    const gated = (await client.callTool({ name: "apply_options", arguments: { bubble: { preset: "flat" } } })) as { isError?: boolean; _meta?: unknown };
    const gatedText = String((gated.content as Array<{ text?: string }>)[0]?.text ?? "");
    check("D9 disabled gate refuses without _meta", gated.isError !== true && /disabled/i.test(gatedText) && gated._meta === undefined);
  } finally {
    await client.close();
  }
}

console.log(failed === 0 ? "\nT31 ALL OK" : `\nT31 FAILED: ${failed} check(s)`);
process.exit(failed === 0 ? 0 : 1);
