/**
 * MCP server exposing zcode-beautify to the ZCode agent:
 * the model can set a wallpaper / re-theme / reset on the user's behalf.
 */

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { applyColorsOnly, applyWallpaper, applySceneWallpaper, reapplyStored, resetAppearance } from "../core/session.js";
import { detectWallpaperType } from "../core/wallpaperType.js";
import { loadConfig } from "../core/launch.js";
import { DEFAULT_CONFIG, type BubbleLookConfig, type ChatLookConfig } from "../core/inject.js";
import { VERSION } from "../version.js";

// ZCode launches MCP servers with ZCODE_BEAUTIFY_DATA_DIR pointed at a
// plugin-scoped directory; keeping it would make every read/write in this
// process (status, tools) use a different store than the serve daemon does.
// Strip it FIRST, before anything resolves dataDir().
delete process.env.ZCODE_BEAUTIFY_DATA_DIR;

const absoluteExisting = (p: string): string => {
  if (!path.isAbsolute(p)) throw new Error(`需要绝对路径: ${p}`);
  if (!existsSync(p)) throw new Error(`路径不存在: ${p}`);
  return p;
};

/**
 * ZCode launches this MCP server on every app start — the ideal hook to make
 * the settings panel "just exist": piggyback a detached `serve` process so it
 * injects the panel as soon as the renderer is up. Idempotent (a healthy
 * serve on the API port is left alone) and strictly fire-and-forget: a slow
 * or failed bootstrap must never delay or break MCP startup.
 */
function bootstrapServe(): void {
  try {
    const serverFile = path.resolve(process.argv[1] ?? "");
    // Only from the bundled layout (dist/mcp/server.js → dist/cli.js); under
    // tsx from src/ there is nothing to point at, so skip quietly.
    const cliJs = path.join(path.dirname(serverFile), "..", "cli.js");
    if (path.basename(serverFile) !== "server.js" || !existsSync(cliJs)) return;
    // The API port is a setting; a hardcoded 9223 here spawns duplicate serves
    // whenever the configured port differs.
    const apiPort = loadConfig().apiPort ?? 9223;
    fetch(`http://127.0.0.1:${apiPort}/api/health`, { signal: AbortSignal.timeout(1500) })
      .then((r) => {
        if (!r.ok) throw new Error("unhealthy");
        return r.json();
      })
      .then((body) => {
        if ((body as { service?: string })?.service !== "zcode-beautify") throw new Error("foreign service");
      })
      .catch(() => {
        try {
          const childEnv = { ...process.env };
          spawn(process.execPath, [cliJs, "serve", "--detach", "--api-port", String(apiPort)], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
            env: childEnv,
          }).unref();
        } catch {
          /* best effort */
        }
      });
    // Self-heal launch entries: without the CDP flag a start-menu launch gets
    // no injection for the whole session — and ZCode's updater rebuilds the
    // Start Menu shortcut WITHOUT the flag, so this must run at every
    // bootstrap, not only when CDP is unreachable. Fire-and-forget, fail-soft
    // (stderr carries the plugin log; stdout is the MCP protocol).
    import("../core/launchers.js")
      .then((m) =>
        m.repairLaunchers({ port: loadConfig().port ?? 9222 }).then((report) => {
          if (report.error) {
            console.error(`launcher check failed: ${report.error}`);
            return;
          }
          const updated = report.fixes.filter((f) => f.status === "updated");
          if (updated.length > 0) {
            console.error(`launcher self-heal: added the CDP flag to ${updated.length} launch entr(ies):`);
            for (const f of updated) console.error(`  ${f.path}`);
          }
        })
      )
      .catch(() => undefined);
  } catch {
    /* best effort */
  }
}
bootstrapServe();

const server = new McpServer({
  name: "zcode-beautify",
  version: VERSION,
});

/** Registry of the tools this server exposes (used by tests / docs). */
export const TOOL_NAMES = [
  "set_background",
  "import_scene_wallpaper",
  "apply_options",
  "refresh_theme",
  "reset_appearance",
  "beautify_status",
  "repair_launchers",
] as const;

server.registerTool(
  "set_background",
  {
    title: "Set ZCode wallpaper",
    description:
      "Set the ZCode desktop client's background wallpaper image and adapt the UI colors with Material Design 3 (Monet) dynamic color. Accepts a static image OR a Wallpaper Engine scene wallpaper (.pkg / workshop directory) — scene inputs are rendered, recorded and looped automatically. ZCode must be running with the CDP debug port (see zcode-beautify launch).",
    inputSchema: {
      image_path: z.string().describe("Absolute path of the image, .pkg file, or scene directory to use as wallpaper"),
      blur: z.number().min(0).max(100).optional().describe("Wallpaper blur radius in px (default 0)"),
      dim: z.number().min(0).max(100).optional().describe("Wallpaper darkening 0-100 (default 25)"),
    },
  },
  async ({ image_path, blur, dim }) => {
    try {
      const abs = absoluteExisting(image_path);
      const kind = detectWallpaperType(abs);
      const { windows } =
        kind === "scene" || kind === "video"
          ? await applySceneWallpaper(abs, { blur, dim })
          : await applyWallpaper(abs, { blur, dim });
      return {
        content: [{
          type: "text",
          text:
            kind === "scene"
              ? `Scene wallpaper imported and applied to ${windows} window(s). First import renders in real time; later imports are served from cache.`
              : kind === "video"
                ? `Video wallpaper imported (trimmed and looped) and applied to ${windows} window(s).`
                : `Wallpaper applied to ${windows} window(s) with Monet-adapted colors.`,
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "import_scene_wallpaper",
  {
    title: "Import scene wallpaper",
    description:
      "Import a Wallpaper Engine scene wallpaper (.pkg file or extracted workshop directory) as an animated ZCode wallpaper: opens it in a Wallpaper Engine window, records ~15s with ffmpeg, processes it into a perfectly seamless loop, caches it, and applies it with Monet colors from a poster frame. Requires Wallpaper Engine and ffmpeg 5+ locally.",
    inputSchema: {
      path: z.string().describe("Absolute path of the .pkg file or the scene directory (project.json folder)"),
      blur: z.number().min(0).max(100).optional().describe("Wallpaper blur radius in px"),
      dim: z.number().min(0).max(100).optional().describe("Wallpaper darkening 0-100"),
    },
  },
  async ({ path: scenePath, blur, dim }) => {
    try {
      const abs = absoluteExisting(scenePath);
      const stages: string[] = [];
      const { windows, served, scene } = await applySceneWallpaper(abs, {
        blur,
        dim,
        onProgress: (stage) => {
          if (stages[stages.length - 1] !== stage) stages.push(stage);
        },
      });
      const notes = served
        ? "Loop is streaming from the serve media endpoint."
        : "serve is not running: the poster frame is applied as a static wallpaper. Run `zcode-beautify serve --detach`, then `refresh_theme`, to get motion.";
      return {
        content: [{
          type: "text",
          text: `Scene imported (${scene.fromCache ? "cache hit" : "freshly rendered"}, ${Math.round(statSizeMb(scene.loopPath))} MB) and applied to ${windows} window(s). Stages: ${stages.join(" → ")}. ${notes}`,
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
    }
  }
);

function statSizeMb(file: string): number {
  try {
    return statSync(file).size / 1024 / 1024;
  } catch {
    return 0;
  }
}

server.registerTool(
  "apply_options",
  {
    title: "Tune ZCode appearance",
    description:
      "Adjust the live ZCode appearance without changing the wallpaper: blur radius, dim level, Monet dynamic colors on/off, wallpaper visibility (translucent vs opaque surfaces), and the user chat bubble look. Only the provided values change; the rest keep their current setting.",
    inputSchema: {
      blur: z.number().min(0).max(100).optional().describe("Wallpaper blur radius in px"),
      dim: z.number().min(0).max(100).optional().describe("Wallpaper darkening 0-100"),
      monet: z.boolean().optional().describe("Regenerate UI colors from the wallpaper (true) or keep ZCode's original colors (false)"),
      wallpaper_visible: z.boolean().optional().describe("Translucent surfaces showing the wallpaper (true) or opaque surfaces (false)"),
      fit: z.enum(["cover", "contain", "smart"]).optional().describe("Framing: cover fills and crops, contain letterboxes with a blurred backdrop, smart analyzes the picture locally and picks the best framing + focus point"),
      bubble: z.object({
        preset: z.enum(["default", "accent", "glass", "outline", "flat", "custom"]).optional().describe("Bubble style: default = stock ZCode bubble, accent = tinted with the theme primary, glass = translucent with backdrop blur, outline = transparent with a primary border, flat = plain surface no border, custom = your own CSS via custom_css"),
        tint: z.number().min(0).max(100).optional().describe("Accent strength 0-100 (how much primary mixes into the bubble)"),
        radius: z.number().min(4).max(24).optional().describe("Corner radius in px on the three round corners (the 2px tail stays)"),
        width: z.number().min(40).max(90).optional().describe("Max bubble width as % of the conversation column"),
        align: z.enum(["right", "left"]).optional().describe("Bubble alignment (right is ZCode stock)"),
        custom_css: z.string().max(8000).optional().describe('CSS applied when preset = "custom", written against the friendly selectors .zb-bubble (the user message bubble) and .zb-bubble-row (its conversation row). CSS only — @import, javascript: and </style are stripped. Prefer live theme tokens like var(--color-primary)/var(--color-surface) so a Monet re-theme restyles the bubble too; suffix declarations with !important'),
      }).optional().describe("User message bubble look; omitted fields keep their current value"),
      chat_width_cap_rem: z.number().min(0).max(120).optional().describe("Conversation column width ceiling in rem (消息流宽度上限). 0 = stock responsive width; 40-120 widens the column (78 ≈ wide, 100+ ≈ near full width on large windows). The column still tracks window resizes — only the ceiling changes"),
      chat_width_inset_rem: z.number().min(0).max(24).optional().describe("Side inset in rem for the column width formula at the wide tier (stock 24; smaller = wider; default 12 when a cap is set). Only meaningful with chat_width_cap_rem > 0"),
    },
  },
  async ({ blur, dim, monet, wallpaper_visible, fit, bubble, chat_width_cap_rem, chat_width_inset_rem }) => {
    try {
      // Send only the fields the caller provided: the session layer merges
      // this partial over the stored look, so one-field tweaks don't reset
      // the rest.
      const bubbleLook =
        bubble === undefined
          ? undefined
          : (Object.fromEntries(Object.entries(bubble).filter(([, v]) => v !== undefined)) as Partial<BubbleLookConfig>);
      const chatLook: Partial<ChatLookConfig> | undefined =
        chat_width_cap_rem === undefined && chat_width_inset_rem === undefined
          ? undefined
          : {
              ...(chat_width_cap_rem !== undefined ? { widthCapRem: chat_width_cap_rem } : {}),
              ...(chat_width_inset_rem !== undefined ? { widthInsetRem: chat_width_inset_rem } : {}),
            };
      const windows = await applyColorsOnly({ blur, dim, monet, wallpaperVisible: wallpaper_visible, fit, bubbleLook, chatLook });
      return { content: [{ type: "text", text: `Appearance updated in ${windows} window(s).` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "refresh_theme",
  {
    title: "Refresh ZCode theme",
    description: "Re-inject the stored wallpaper and Monet theme into the running ZCode client (e.g. after the app was restarted).",
    inputSchema: {},
  },
  async () => {
    try {
      const windows = await reapplyStored();
      return { content: [{ type: "text", text: `Theme re-injected into ${windows} window(s).` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "reset_appearance",
  {
    title: "Reset ZCode appearance",
    description: "Remove the wallpaper and color overrides, restoring ZCode's default appearance.",
    inputSchema: {},
  },
  async () => {
    try {
      await resetAppearance();
      return { content: [{ type: "text", text: "Appearance restored to default." }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "beautify_status",
  {
    title: "Beautify status",
    description: "Report the stored zcode-beautify configuration.",
    inputSchema: {},
  },
  async () => {
    const cfg = loadConfig();
    return { content: [{ type: "text", text: JSON.stringify(cfg, null, 2) }] };
  }
);

server.registerTool(
  "repair_launchers",
  {
    title: "Fix ZCode launch entries",
    description:
      "ZCode only opens its CDP port when it is started with --remote-debugging-port, and that flag has to come from the " +
      "shortcut or handler that launches it. A machine usually has several launch entries and only some carry the flag. " +
      "This scans the desktop, Start Menu and pinned-taskbar shortcuts plus the zcode:// protocol and Explorer context-menu " +
      "verbs, and adds the flag where it is missing. Machine-wide entries that need administrator rights are reported, not " +
      "modified. Shortcuts are the durable entries: ZCode's updater rebuilds the Start Menu shortcut without the flag, and " +
      "the app re-registers its protocol and context-menu handlers on every start, so registry entries may need repairing again.",
    inputSchema: {
      dry_run: z.boolean().optional().describe("Only report what would change; write nothing"),
    },
  },
  async ({ dry_run }) => {
    try {
      const port = loadConfig().port ?? DEFAULT_CONFIG.port;
      const { repairLaunchers } = await import("../core/launchers.js");
      const report = await repairLaunchers({ port, dryRun: dry_run });

      if (report.error) {
        return { content: [{ type: "text", text: `Could not scan launch entries: ${report.error}` }], isError: true };
      }

      const updated = report.fixes.filter((f) => f.status === "updated");
      const failed = report.fixes.filter((f) => f.status === "failed");
      const lines = [
        report.dryRun
          ? `Dry run on port ${port}: ${updated.length} of ${report.fixes.length} entry(ies) would be updated.`
          : `Updated ${updated.length} of ${report.fixes.length} launch entry(ies) to include --remote-debugging-port=${port}.`,
        ...report.fixes.map((f) => `  [${f.status}] ${f.path}${f.reason ? ` — ${f.reason}` : ""}`),
      ];
      if (failed.length > 0) {
        lines.push(
          "Entries marked failed are machine-wide and need administrator rights; launch ZCode from one of the updated shortcuts instead."
        );
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
    }
  }
);

await server.connect(new StdioServerTransport());
