/**
 * MCP server exposing zcode-beautify to the ZCode agent:
 * the model can set a wallpaper / re-theme / reset on the user's behalf.
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { applyColorsOnly, applyWallpaper, applySceneWallpaper, reapplyStored, resetAppearance } from "../core/session.js";
import { detectWallpaperType } from "../core/wallpaperType.js";
import { ensureExperimentalGate, experimentalEnabled, loadConfig } from "../core/launch.js";
import { target } from "../core/target.js";
import { DEFAULT_CONFIG, type ChatLoadLookConfig, type ChatLookConfig, type FabLookConfig, type ListPagingConfig, type TaskSpinnerLookConfig } from "../core/inject.js";
import { spawnServeDetached } from "../core/experimental.js";
import { BUBBLE_STUDIO_URI, bubbleLookPatchFromTool, bubbleStudioResultMeta, bubbleStudioState, deleteBubbleRecipe, saveBubbleRecipe } from "../core/bubbleStudio.js";
import { bubbleStudioHtml } from "./bubbleStudioHtml.js";
import { VERSION } from "../version.js";

// The plugin host launches MCP servers with the beautify data dir pointed at a
// plugin-scoped directory; keeping it would make every read/write in this
// process (status, tools) use a different store than the serve daemon does.
// Strip it FIRST, before anything resolves dataDir().
delete process.env.ZCODE_BEAUTIFY_DATA_DIR;
delete process.env.WORKBUDDY_BEAUTIFY_DATA_DIR;

const absoluteExisting = (p: string): string => {
  if (!path.isAbsolute(p)) throw new Error(`需要绝对路径: ${p}`);
  if (!existsSync(p)) throw new Error(`路径不存在: ${p}`);
  return p;
};

/** Path of the bundled dist/cli.js next to this server, or null under tsx. */
function cliJsPath(): string | null {
  const serverFile = path.resolve(process.argv[1] ?? "");
  // Only from the bundled layout (dist/mcp/server.js → dist/cli.js); under
  // tsx from src/ there is nothing to point at, so skip quietly.
  const cliJs = path.join(path.dirname(serverFile), "..", "cli.js");
  return path.basename(serverFile) === "server.js" && existsSync(cliJs) ? cliJs : null;
}

/**
 * ZCode launches this MCP server on every app start — the ideal hook to make
 * the settings panel "just exist": piggyback a detached `serve` process so it
 * injects the panel as soon as the renderer is up. Idempotent (a healthy
 * serve on the API port is left alone) and strictly fire-and-forget: a slow
 * or failed bootstrap must never delay or break MCP startup.
 *
 * Everything here is behind the experimental opt-in gate: until the user
 * enables it, this process stays inert — no daemon, no launch-entry writes.
 */
function bootstrapServe(): void {
  try {
    const cliJs = cliJsPath();
    if (!cliJs) return;
    const cfg = ensureExperimentalGate();
    if (!cfg.experimental?.enabled) {
      console.error(
        "beautify: experimental CDP injection is disabled — nothing started " +
          "(enable_experimental, or `cli.js enable`, opts in)"
      );
      return;
    }
    // The API port is a setting; a hardcoded 9223 here spawns duplicate serves
    // whenever the configured port differs.
    const apiPort = cfg.apiPort ?? target().apiPort;
    spawnServeDetached(apiPort, cliJs);
    // Self-heal launch entries: without the CDP flag a start-menu launch gets
    // no injection for the whole session — and ZCode's updater rebuilds the
    // Start Menu shortcut WITHOUT the flag, so this must run at every
    // bootstrap, not only when CDP is unreachable. Fire-and-forget, fail-soft
    // (stderr carries the plugin log; stdout is the MCP protocol).
    import("../core/launchers.js")
      .then((m) =>
        m.repairLaunchers({ port: loadConfig().port ?? target().cdpPort }).then((report) => {
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

/** Shared refusal for the injection tools while the opt-in gate is closed. */
function disabledNotice(): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{
      type: "text",
      text:
        "Experimental CDP injection is disabled (default since 0.6.0) — nothing was changed.\n" +
        "To opt in, call `enable_experimental` once: it records consent, adds --remote-debugging-port to the client's " +
        "launch entries and starts the local service (see the README security notes for what that exposes).\n" +
        "`disable_experimental` undoes all of it, including stripping the flag from the launch entries again.",
    }],
  };
}

const server = new McpServer({
  name: "zcode-beautify",
  version: VERSION,
});

/** Product name of the client this MCP instance beautifies. */
const APP = target().appName;

/**
 * Tool metadata is written once against the primary client. Re-brand it for
 * the active target so a WorkBuddy agent is never told it is editing ZCode.
 * Registered as a thin wrapper so every future tool gets the same treatment.
 */
const rawRegister = server.registerTool.bind(server);
server.registerTool = ((name: string, meta: Record<string, unknown>, handler: unknown) => {
  const branded =
    APP === "ZCode"
      ? meta
      : {
          ...meta,
          title: typeof meta.title === "string" ? meta.title.replace(/ZCode/g, APP) : meta.title,
          description:
            typeof meta.description === "string" ? meta.description.replace(/ZCode/g, APP) : meta.description,
        };
  return rawRegister(name, branded as never, handler as never);
}) as typeof server.registerTool;

/** Registry of the tools this server exposes (used by tests / docs). */
export const TOOL_NAMES = [
  "set_background",
  "import_scene_wallpaper",
  "apply_options",
  "bubble_studio_state",
  "save_bubble_recipe",
  "delete_bubble_recipe",
  "refresh_theme",
  "reset_appearance",
  "beautify_status",
  "enable_experimental",
  "disable_experimental",
  "repair_launchers",
] as const;

/**
 * The Bubble Studio page (气泡工坊) as an MCP Apps resource: hosts with UI
 * support (ZCode 3.16+) render it in a sandboxed page after a bubble tool
 * result references it via `_meta.ui`; plain hosts never read it. Built from
 * a function so the recipe CSS is baked fresh on every read.
 */
server.registerResource(
  "bubble-studio",
  BUBBLE_STUDIO_URI,
  {
    title: "气泡工坊 (Bubble Studio)",
    description: "Interactive gallery of chat-bubble recipes: preview, try on, fine-tune and save bubble looks.",
    mimeType: "text/html;profile=mcp-app",
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/html;profile=mcp-app", text: bubbleStudioHtml() }],
  }),
);

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
      if (!experimentalEnabled(loadConfig())) return disabledNotice();
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
      if (!experimentalEnabled(loadConfig())) return disabledNotice();
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
      "Adjust the live ZCode appearance without changing the wallpaper: blur radius, dim level, sidebar-only extra darkening (侧边栏压暗), Monet dynamic colors on/off, wallpaper visibility (translucent vs opaque surfaces), the user chat bubble look, and the sidebar session running-indicator icon (运行中图标). Only the provided values change; the rest keep their current setting. When `bubble` is set, ZCode 3.16+ additionally opens the interactive Bubble Studio gallery (气泡工坊) where the user can preview every recipe, fine-tune tint/radius/width/alignment/custom CSS and save their own.",
    inputSchema: {
      blur: z.number().min(0).max(100).optional().describe("Wallpaper blur radius in px"),
      dim: z.number().min(0).max(100).optional().describe("Wallpaper darkening 0-100"),
      sidebar_dim: z.number().min(0).max(100).optional().describe("Extra darkening 0-100 for the left sidebar only (侧边栏压暗), additive on top of dim; 0 = off"),
      monet: z.boolean().optional().describe("Regenerate UI colors from the wallpaper (true) or keep ZCode's original colors (false)"),
      wallpaper_visible: z.boolean().optional().describe("Translucent surfaces showing the wallpaper (true) or opaque surfaces (false)"),
      fit: z.enum(["cover", "contain", "smart"]).optional().describe("Framing: cover fills and crops, contain letterboxes with a blurred backdrop, smart analyzes the picture locally and picks the best framing + focus point"),
      spinner: z.object({
        mode: z.enum(["default", "image"]).optional().describe("default = stock ZCode spinner, image = replace the session-list running icon with a picture (static or animated GIF)"),
        image_path: z.string().optional().describe("Absolute path of the image/GIF to paint over the spinner (resolved serve-side; required when mode = image)"),
        unread_image_path: z.string().optional().describe("运行完成标志: image for the unread dot sessions show after finishing with unread replies (empty/omitted = stock blue dot)"),
        error_image_path: z.string().optional().describe("出错标志: image for the error dot (empty/omitted = stock red dot)"),
        spin: z.boolean().optional().describe("Keep the stock rotation (true, default — good for static images) or disable it (false — for animated GIFs that bring their own motion)"),
        size: z.number().min(10).max(24).optional().describe("Icon size in px (stock 16); applies to every replaced slot"),
      }).optional().describe("Session-list running indicator look (运行中图标); omitted fields keep their current value"),
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
      chat_hide_elapsed_decimal: z.boolean().optional().describe("Hide the decimal in the running elapsed time under the conversation (耗时秒数去小数): true rewrites the live working-row seconds from \"53.4 秒\" to \"53 秒\"; false restores stock"),
      chat_drag_resize: z.boolean().optional().describe("Drag handles on both edges of the conversation column (两侧拖拽调宽): true mounts two hidden vertical strips — hover shows an accent line, dragging resizes the column width symmetrically, double-clicking a strip resets to the tier setting. The dragged width persists locally and outranks chat_width_cap_rem; false removes the strips"),
      chat_session_hover: z.boolean().optional().describe("会话概览悬停卡: true shows a preview card when the mouse rests on a sidebar session row, listing that conversation's real user prompts (oldest → newest, newest bold, served from ZCode's local session db by the beautify daemon; ZCode's own workspace hover card is hidden while on); false restores stock"),
      chat_session_hover_side: z.boolean().optional().describe("侧栏标题悬停: whether the LEFT task-list session rows trigger the 会话概览 hover card (true, default); false = only the conversation's turn ticks (对话概要标示) open it and the sidebar keeps ZCode's own workspace hover card. Only meaningful with chat_session_hover on"),
      chat_session_hover_max: z.number().min(1).max(60).optional().describe("会话概览卡最多显示几条提问 (1-60, default 10): the card grows up to this many visible rows; excess prompts live in the card's scrollable list (auto-landed on the newest). Only meaningful with chat_session_hover on"),
      chat_composer_fade: z.number().min(0).max(100).optional().describe("输入框透明度: 0 = stock composer background, 1-100 fades the chat input box's paint toward transparent so the wallpaper shows through (text and border untouched)"),
      chat_loading_icon: z.object({
        mode: z.enum(["default", "classic", "image"]).optional().describe("会话底部加载图标: default = ZCode 3.18's stock brand-colored orbit glyph, classic = the pre-3.18 3×3 pixel-wave dots, image = a user picture/GIF"),
        image_path: z.string().optional().describe("Absolute path of the image/GIF to paint over the loading icon (resolved serve-side; required when mode = image)"),
        spin: z.boolean().optional().describe("Keep a CSS rotation on the replaced icon (true, default — good for static images; false for animated GIFs)"),
        size: z.number().min(10).max(28).optional().describe("Icon size in px (stock slot 16); only meaningful for image mode — classic is a fixed 13px grid"),
      }).optional().describe("Conversation-footer loading icon look; omitted fields keep their current value"),
      list_initial: z.number().min(0).max(100).optional().describe("会话列表分页: how many session rows a project card shows when expanded (初始展开条数, 1-100). 0 = stock behaviour (ZCode's hardcoded 5, +5 per click, no collapse)"),
      list_step: z.number().min(1).max(100).optional().describe("会话列表分页: how many rows each 显示更多 click adds (每次加载条数, 1-100). Only meaningful with list_initial > 0"),
      list_collapse: z.boolean().optional().describe("会话列表分页: whether a 收起 button sits next to 显示更多 (true, default) snapping the list back to list_initial rows; false hides it. Only meaningful with list_initial > 0"),
      fab: z.object({
        mode: z.enum(["default", "image"]).optional().describe("设置按钮 (panel-opener FAB): default = the stock 🎨 ball, image = a user picture/GIF"),
        image_path: z.string().optional().describe("Absolute path or file name of the image for the FAB (resolved serve-side; required when mode = image; ≤2MB when uploaded via the panel)"),
        size: z.number().min(20).max(64).optional().describe("Ball diameter in px (stock 34)"),
      }).optional().describe("Panel-opener button look; omitted fields keep their current value"),
    },
  },
  async ({ blur, dim, sidebar_dim, monet, wallpaper_visible, fit, bubble, spinner, chat_width_cap_rem, chat_width_inset_rem, chat_hide_elapsed_decimal, chat_drag_resize, chat_session_hover, chat_session_hover_side, chat_session_hover_max, chat_composer_fade, chat_loading_icon, list_initial, list_step, list_collapse, fab }) => {
    try {
      if (!experimentalEnabled(loadConfig())) return disabledNotice();
      // Send only the fields the caller provided: the session layer merges
      // this partial over the stored look, so one-field tweaks don't reset
      // the rest. bubbleLookPatchFromTool also maps custom_css → customCss
      // (a raw passthrough stored a dead snake_case key nothing read).
      const bubbleLook = bubble === undefined ? undefined : bubbleLookPatchFromTool(bubble as Record<string, unknown>);
      const taskSpinnerLook =
        spinner === undefined
          ? undefined
          : (Object.fromEntries(
              Object.entries(spinner)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => [k === "image_path" ? "image" : k === "unread_image_path" ? "unreadImage" : k === "error_image_path" ? "errorImage" : k, v]),
            ) as Partial<TaskSpinnerLookConfig>);
      const chatLook: Partial<ChatLookConfig> | undefined =
        chat_width_cap_rem === undefined && chat_width_inset_rem === undefined && chat_hide_elapsed_decimal === undefined && chat_drag_resize === undefined && chat_composer_fade === undefined && chat_session_hover === undefined && chat_session_hover_side === undefined && chat_session_hover_max === undefined
          ? undefined
          : {
              ...(chat_width_cap_rem !== undefined ? { widthCapRem: chat_width_cap_rem } : {}),
              ...(chat_width_inset_rem !== undefined ? { widthInsetRem: chat_width_inset_rem } : {}),
              ...(chat_hide_elapsed_decimal !== undefined ? { hideElapsedDecimal: chat_hide_elapsed_decimal ? 1 : 0 } : {}),
              ...(chat_drag_resize !== undefined ? { dragResize: chat_drag_resize ? 1 : 0 } : {}),
              ...(chat_session_hover !== undefined ? { sessionHover: chat_session_hover ? 1 : 0 } : {}),
              ...(chat_session_hover_side !== undefined ? { sessionHoverSide: chat_session_hover_side ? 1 : 0 } : {}),
              ...(chat_session_hover_max !== undefined ? { sessionHoverMax: chat_session_hover_max } : {}),
              ...(chat_composer_fade !== undefined ? { composerFade: chat_composer_fade } : {}),
            };
      const chatLoadLook =
        chat_loading_icon === undefined
          ? undefined
          : (Object.fromEntries(
              Object.entries(chat_loading_icon)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => [k === "image_path" ? "image" : k, v]),
            ) as Partial<ChatLoadLookConfig>);
      const listPaging: Partial<ListPagingConfig> | undefined =
        list_initial === undefined && list_step === undefined && list_collapse === undefined
          ? undefined
          : {
              ...(list_initial !== undefined ? { initial: list_initial } : {}),
              ...(list_step !== undefined ? { step: list_step } : {}),
              ...(list_collapse !== undefined ? { collapse: list_collapse ? 1 : 0 } : {}),
            };
      const fabLook =
        fab === undefined
          ? undefined
          : (Object.fromEntries(
              Object.entries(fab)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => [k === "image_path" ? "image" : k, v]),
            ) as Partial<FabLookConfig>);
      const windows = await applyColorsOnly({ blur, dim, sidebarDim: sidebar_dim, monet, wallpaperVisible: wallpaper_visible, fit, bubbleLook, taskSpinnerLook, chatLook, chatLoadLook, listPaging, fabLook });
      // Bubble changes surface the interactive Bubble Studio gallery (MCP
      // Apps hosts render it; plain hosts just show the text card below).
      return {
        content: [{ type: "text", text: `Appearance updated in ${windows} window(s).` }],
        ...(bubble !== undefined ? { _meta: bubbleStudioResultMeta() } : {}),
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "bubble_studio_state",
  {
    title: "Bubble Studio state",
    description:
      "Snapshot for the Bubble Studio gallery (气泡工坊): the currently applied bubble look, its matching recipe id, the built-in presets and the user's saved recipes. Primarily consumed by the studio page; harmless to call directly.",
    inputSchema: {},
  },
  async () => {
    const state = bubbleStudioState();
    return { content: [{ type: "text", text: JSON.stringify(state) }] };
  }
);

server.registerTool(
  "save_bubble_recipe",
  {
    title: "Save bubble recipe",
    description:
      'Save a chat-bubble look as a named recipe for the Bubble Studio gallery (气泡工坊). With `look` omitted it saves the currently applied look ("save what is live now"). Sending an existing saved recipe `id` updates it in place. Opens the studio gallery on UI-capable hosts (ZCode 3.16+).',
    inputSchema: {
      name: z.string().min(1).max(40).optional().describe("Recipe display name (defaults to 气泡配方)"),
      id: z.string().optional().describe("Id of an existing saved recipe to update; omit to create a new one"),
      look: z.object({
        preset: z.enum(["default", "accent", "glass", "outline", "flat", "custom"]).optional(),
        tint: z.number().min(0).max(100).optional(),
        radius: z.number().min(4).max(24).optional(),
        width: z.number().min(40).max(90).optional(),
        align: z.enum(["right", "left"]).optional(),
        custom_css: z.string().max(8000).optional(),
      }).optional().describe("The look to store; defaults to the currently applied bubble look"),
    },
  },
  async ({ name, id, look }) => {
    try {
      const recipe = saveBubbleRecipe({ name, id, look });
      return {
        content: [{ type: "text", text: JSON.stringify({ saved: true, recipe }) }],
        _meta: bubbleStudioResultMeta(),
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "delete_bubble_recipe",
  {
    title: "Delete bubble recipe",
    description: "Delete a saved Bubble Studio recipe by id. Built-in presets cannot be deleted.",
    inputSchema: {
      id: z.string().describe("Id of the saved recipe (from bubble_studio_state)"),
    },
  },
  async ({ id }) => {
    try {
      deleteBubbleRecipe(id);
      return { content: [{ type: "text", text: JSON.stringify({ deleted: true, id }) }] };
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
      if (!experimentalEnabled(loadConfig())) return disabledNotice();
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
  "enable_experimental",
  {
    title: "Enable experimental CDP injection",
    description:
      "OPT-IN gate for the experimental injection mode (off by default since 0.6.0). Enabling: records consent (timestamp + " +
      "plugin version) in the plugin config; adds --remote-debugging-port to the client's launch entries (desktop/Start " +
      "Menu/taskbar shortcuts, deep-link handler, Explorer verbs) so the client opens a local CDP port; starts the local " +
      "beautify service; and re-enables the self-heal that keeps launch entries carrying the flag across client updates. " +
      "SECURITY: the CDP port binds 127.0.0.1 but is unauthenticated — any local process can attach to the renderer while " +
      "it is open, and the flag stays in the launch entries until disable_experimental strips it. After enabling, fully " +
      "quit and restart the client once (unless it already runs with the flag).",
    inputSchema: {},
  },
  async () => {
    try {
      const { enableExperimental, spawnServeDetached } = await import("../core/experimental.js");
      const r = await enableExperimental();
      // Bring the daemon up right away; only the client process itself needs
      // the one full restart — unless it already runs with the flag.
      const cliJs = cliJsPath();
      if (cliJs) spawnServeDetached(r.apiPort, cliJs);
      const lines = ["Experimental CDP injection ENABLED (consent recorded in the plugin config)."];
      const report = r.launchers;
      if (!report || report.error) {
        lines.push(`Launch entries could not be updated: ${report?.error ?? "unknown error"}`);
      } else {
        const updated = report.fixes.filter((f) => f.status === "updated");
        lines.push(`Launch entries: ${updated.length} of ${report.fixes.length} now carry --remote-debugging-port=${r.port}.`);
        for (const f of updated) lines.push(`  ${f.path}`);
      }
      lines.push(
        "If the client is running without the debug port, fully quit it (including any tray icon) and start it again from a shortcut — the service starts on its own. Then `refresh_theme` applies the stored look.",
        "Security: the CDP port binds 127.0.0.1 but is unauthenticated — any local process can attach to the renderer. `disable_experimental` rolls everything back."
      );
      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "disable_experimental",
  {
    title: "Disable experimental CDP injection",
    description:
      "Roll the experimental injection mode back to off and undo what enabling changed: stops the local service's injection " +
      "and clears the injected theme (including the renderer's cached copy used for self-heal), marks the config disabled, " +
      "and by default strips --remote-debugging-port from the launch entries again (the rollback for uninstall). The stored " +
      "wallpaper settings are kept, so re-enabling later restores the look. Fully quit and restart the client afterwards.",
    inputSchema: {
      clean_launchers: z
        .boolean()
        .optional()
        .describe("Strip the CDP flag from launch entries too (default true; false keeps the flag where it is)"),
    },
  },
  async ({ clean_launchers }) => {
    try {
      const cleanLaunchers = clean_launchers ?? true;
      const { disableExperimental } = await import("../core/experimental.js");
      const r = await disableExperimental({ cleanLaunchers });
      const lines: string[] = [];
      if (r.teardown.via === "service") {
        lines.push("Service stopped; injected theme cleared (including the renderer's cached copy).");
      } else if (r.teardown.via === "cdp" && r.teardown.windows > 0) {
        lines.push(`Injected theme cleared directly over CDP in ${r.teardown.windows} window(s).`);
      } else {
        lines.push("No running client found — nothing injected to clear.");
      }
      lines.push("Experimental mode disabled — no service start, no launch-entry self-heal.");
      const report = r.launchers;
      if (report) {
        if (report.error) {
          lines.push(`Launch entries could not be cleaned: ${report.error}`);
        } else {
          const stripped = report.fixes.filter((f) => f.status === "updated");
          lines.push(`Launch entries: flag removed from ${stripped.length} of ${report.fixes.length}.`);
          for (const f of stripped) lines.push(`  ${f.path}`);
        }
      }
      lines.push("Fully quit and restart the client to finish on the stock look.");
      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
    }
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
      "verbs. action=\"add\" (default) adds the flag where it is missing — opt-in only, see enable_experimental; " +
      "action=\"remove\" strips it again from the same entries (the rollback for disable/uninstall, and the way to undo " +
      "what pre-0.6.0 versions wrote automatically). Machine-wide entries that need administrator rights are reported, not " +
      "modified. Shortcuts are the durable entries: ZCode's updater rebuilds the Start Menu shortcut without the flag, and " +
      "the app re-registers its protocol and context-menu handlers on every start, so registry entries may need repairing again.",
    inputSchema: {
      action: z
        .enum(["add", "remove"])
        .optional()
        .describe('"add" (default) adds the missing flag; "remove" strips it from every entry that carries it'),
      dry_run: z.boolean().optional().describe("Only report what would change; write nothing"),
    },
  },
  async ({ action, dry_run }) => {
    try {
      const mode = action ?? "add";
      const port = loadConfig().port ?? DEFAULT_CONFIG.port;
      const { repairLaunchers } = await import("../core/launchers.js");
      const report = await repairLaunchers({ port, action: mode, dryRun: dry_run });

      if (report.error) {
        return { content: [{ type: "text", text: `Could not scan launch entries: ${report.error}` }], isError: true };
      }

      const updated = report.fixes.filter((f) => f.status === "updated");
      const failed = report.fixes.filter((f) => f.status === "failed");
      const verb = mode === "remove" ? "cleaned" : "updated";
      const lines = [
        report.dryRun
          ? `Dry run on port ${port}: ${updated.length} of ${report.fixes.length} entry(ies) would be ${verb}.`
          : mode === "remove"
            ? `Removed --remote-debugging-port from ${updated.length} of ${report.fixes.length} launch entry(ies).`
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
