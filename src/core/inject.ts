/**
 * Assembles the full injected payload: wallpaper layer CSS + variable
 * overrides, plus helpers to apply a theme to a running ZCode instance.
 */

import { CdpConnection, injectIntoTarget, isUpdaterTarget, listTargets, pickRendererTargets, buildBootstrapScript, buildResetScript } from "./cdp.js";
import { sanitizeCustomBubbleCss } from "./bubbleRecipes.js";
import { normalizeComponentLook, workbuddyComponentCss, type ComponentLookConfig } from "./componentLook.js";
import { loadWallpaper, type WallpaperAssets } from "./monet.js";
import { buildVariableOverrides, buildTransparencyOverrides } from "./tokens.js";
import { target } from "./target.js";
import { dataDir } from "./launch.js";
import fs from "node:fs";
import path from "node:path";

export type WallpaperFit = "cover" | "contain" | "smart";

/** Wallpaper switching effects; compositor-friendly where possible. */
export type WallpaperTransition = "fade" | "none" | "slide" | "zoom" | "blur";

/**
 * Rotation modes: "sequence" plays every entry for its duration in order and
 * loops; "random" does the same but never repeats the current entry back to
 * back; "schedule" switches at the entry's daily clock time.
 */
export type RotationMode = "sequence" | "random" | "schedule";

/** One playlist item: a wallpaper reference plus how long it stays on. */
export interface RotationEntry {
  /** sequence/random: play duration in seconds (>= 10). */
  seconds?: number;
  /** schedule: daily local clock time, "HH:MM" (24h). */
  time?: string;
  /** Scene loop reference: cache hash (scenes/<hash>/loop.mp4). */
  hash?: string;
  /** Static image reference: absolute path inside the data dir. */
  path?: string;
}

/** A named, self-contained playback plan: mode, transition effect, playlist. */
export interface RotationPlan {
  id: string;
  name: string;
  mode: RotationMode;
  /** Switching effect used while this plan is active (default "fade"). */
  transition?: WallpaperTransition;
  /** Optional daily activation window "HH:MM"-"HH:MM" (overnight spans ok):
   *  while "now" is inside, this plan plays regardless of activePlanId. */
  window?: { start: string; end: string };
  entries: RotationEntry[];
}

/**
 * Wallpaper rotation (定时播放): several saved plans, one of them active.
 * Configs written before plans existed carry a flat mode+entries pair and
 * are normalized into a single "默认方案" on read.
 */
export interface RotationConfig {
  enabled: boolean;
  /** Which plan plays; falls back to plans[0] when unset or unknown. */
  activePlanId?: string;
  plans: RotationPlan[];
}

/**
 * Zone-refined chat-area look (聊天界面): four independent masks layered
 * between the wallpaper and the UI, each a 0-100 density — plus the
 * conversation column width (消息流宽度).
 */
export interface ChatLookConfig {
  /** Extra darkening behind the conversation column (聊天区暗度). */
  chatDim: number;
  /** Top-edge fading mask (遮罩上端浓度). */
  maskTop: number;
  /** Bottom-edge fading mask (遮罩下端浓度). */
  maskBottom: number;
  /** Whole-window white frost sheet (大容器偏白). */
  frost: number;
  /**
   * Conversation column width ceiling in rem (消息流宽度上限); 0 = stock
   * responsive width (nothing injected). The ceiling alone never breaks
   * resizing — the column still tracks the window, just wider.
   */
  widthCapRem: number;
  /**
   * Side inset in rem for the column width formula calc(100% - inset) at the
   * wide tier (≥1280px container). Stock uses 24; smaller = wider. Only
   * meaningful with widthCapRem > 0; defaults to 12 when omitted.
   */
  widthInsetRem: number;
  /**
   * Large-session smooth mode (大会话流畅模式): 0 = off, 1 = inject
   * content-visibility:auto on conversation rows. Off-screen rows skip
   * paint/layout (ZCode only does this for the share view, not the main
   * chat), which cuts first-layout and scrolling cost on long conversations.
   * contain-intrinsic-size uses `auto <estimate>` so the row keeps its LAST
   * MEASURED size off-screen — keeps the dynamic-height virtualizer's
   * measurements stable instead of collapsing to the estimate.
   */
  perfSmooth: number;
  /**
   * Hide the decimal in the running elapsed time (耗时秒数去小数): 0 = off,
   * 1 = rewrite the live "working" row's seconds. ZCode renders the elapsed
   * time under the conversation ("1 时 17 分 53.4 秒") via a hardcoded
   * toFixed(1) into ONE aria-hidden text span inside
   * [data-zcode-chat-loading-animate] — CSS cannot reach mid-string text, so
   * the bootstrap installs a MutationObserver that strips the fractional
   * part ("53.4 秒" → "53 秒") after each 100ms React tick. The finished/
   * history durations use a different, integer-only formatter and never
   * carry decimals.
   */
  hideElapsedDecimal: number;
  /**
   * Drag handles on both edges of the conversation column (两侧拖拽调宽):
   * 0 = off, 1 = mount two hidden 9px vertical strips hugging the column's
   * left/right edges. Hover reveals a 3px accent line; dragging resizes the
   * column symmetrically by writing the --zb-chat-w (px) var, which the
   * drag-mode width formula min(calc(100% - inset), var(--zb-chat-w))
   * consumes — the native window-tracking shape, so shrinking never
   * overflows. The dragged width persists in localStorage (rem) and outranks
   * the 消息流宽度 tier; double-clicking a strip clears it back. Before the
   * first drag the rules' var fallbacks reproduce the stock/config tiers
   * exactly, so enabling the toggle changes nothing visually.
   */
  dragResize: number;
  /**
   * 输入框透明度 (composer transparency), 0-100: the composer background's
   * transparency — 0 = solid, 100 = invisible, 50 ≈ the stock look (ZCode
   * 3.18 ships --color-input at .5 alpha; the rule REPLACES the token's own
   * alpha with the slider's). Absent/invalid fields default to 50, so
   * pre-6.1.1 configs keep the stock appearance.
   */
  composerFade: number;
  /**
   * 会话概览悬停卡 (session hover preview): 0 = off, 1 = hovering a sidebar
   * session row opens a preview card listing that conversation's real user
   * prompts (served from ZCode's local session db via the serve daemon's
   * /api/session-preview; a DOM-title fallback shows when serve is down).
   * While on, ZCode's own workspace hover card (task-row-details) is hidden
   * so the two never stack.
   */
  sessionHover: number;
  /**
   * 会话概览悬停卡 — 侧栏行锚点开关: 1 (default) = hovering a LEFT task-list
   * session row also opens the card; 0 = only the conversation's turn ticks
   * (对话概要标示) trigger it — the sidebar keeps ZCode's own workspace
   * hover card, which the 1 state hides.
   */
  sessionHoverSide: number;
  /**
   * 会话概览悬停卡 — 最多可见行数 (1-60, default 10): the list grows up to
   * this many prompt rows; beyond that it stays this tall and the excess
   * rows live in the scrollable area (the list auto-lands on the newest).
   */
  sessionHoverMax: number;
}

/**
 * Sidebar session-list paging (会话列表分页): ZCode hardcodes the project
 * card's session rows to "first 5, +5 per 显示更多 click" (packages/ui
 * ProjectTaskRows.tsx: `pageSize = chronological ? 20 : 5`, no collapse once
 * expanded). This knob re-implements that paging at the DOM level with two
 * user-set numbers plus a 收起 control.
 */
export interface ListPagingConfig {
  /**
   * Rows shown when a project card expands (初始展开条数), 1-100.
   * 0 = feature off: nothing injected, the stock 5/+5 behaviour stays.
   */
  initial: number;
  /** Rows added per 显示更多 click (每次加载条数), 1-100; only used when initial > 0. */
  step: number;
  /**
   * 收起 button next to 显示更多 (1 = show, 0 = hide): snaps the visible rows
   * back to `initial` without unmounting anything.
   */
  collapse: number;
}

const LIST_PAGING_MAX = 100;

/** Clamp a partial paging config: 0 = off; counts to 1-100 ints. */
export function normalizeListPaging(raw?: Partial<ListPagingConfig>): ListPagingConfig {
  const num = (v: unknown, dflt: number): number =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.max(1, Math.min(LIST_PAGING_MAX, Math.round(v)))
      : dflt;
  const initial = typeof raw?.initial === "number" && Number.isFinite(raw.initial) && raw.initial >= 1
    ? Math.min(LIST_PAGING_MAX, Math.round(raw.initial))
    : 0;
  const collapse = raw?.collapse as unknown;
  return {
    initial,
    step: initial > 0 ? num(raw?.step, 5) : 0,
    collapse: initial > 0 && collapse !== 0 && collapse !== false ? 1 : 0,
  };
}

/** Stock wide-tier constants, for reference/tests: 72rem cap, 24rem inset. */
export const STOCK_CHAT_WIDTH = { capRem: 72, insetRem: 24 } as const;

const CHAT_WIDTH_INSET_DEFAULT = 12;

/** Clamp a partial chat look: masks to 0-100 ints, width cap to 0 or 40-120,
 * inset to 0-24 (12 when a cap is set but no inset arrives), flags to 0/1. */
export function normalizeChatLook(raw?: Partial<ChatLookConfig>): ChatLookConfig {
  const pct = (v: unknown): number =>
    typeof v === "number" && v >= 0 && v <= 100 ? Math.round(v) : 0;
  const cap = typeof raw?.widthCapRem === "number" && Number.isFinite(raw.widthCapRem)
    ? Math.max(0, Math.min(120, Math.round(raw.widthCapRem)))
    : 0;
  const capOn = cap >= 40 ? cap : 0; // 1-39 makes no sense as a column cap
  const inset = capOn > 0
    ? (typeof raw?.widthInsetRem === "number" && Number.isFinite(raw.widthInsetRem)
        ? Math.max(0, Math.min(24, Math.round(raw.widthInsetRem)))
        : CHAT_WIDTH_INSET_DEFAULT)
    : 0;
  const dec = raw?.hideElapsedDecimal as unknown;
  const drag = raw?.dragResize as unknown;
  const hover = raw?.sessionHover as unknown;
  const hoverSide = raw?.sessionHoverSide as unknown;
  const hoverMax = raw?.sessionHoverMax as unknown;
  return {
    chatDim: pct(raw?.chatDim),
    maskTop: pct(raw?.maskTop),
    maskBottom: pct(raw?.maskBottom),
    frost: pct(raw?.frost),
    widthCapRem: capOn,
    widthInsetRem: inset,
    perfSmooth: raw?.perfSmooth === 1 ? 1 : 0,
    hideElapsedDecimal: dec === 1 || dec === true ? 1 : 0,
    dragResize: drag === 1 || drag === true ? 1 : 0,
    sessionHover: hover === 1 || hover === true ? 1 : 0,
    // absent = 1: existing configs predate the side toggle and expect rows on
    sessionHoverSide: hoverSide === 0 || hoverSide === false ? 0 : 1,
    sessionHoverMax:
      typeof hoverMax === "number" && Number.isFinite(hoverMax) && hoverMax >= 1
        ? Math.min(60, Math.round(hoverMax))
        : 10,
    composerFade: typeof raw?.composerFade === "number" && Number.isFinite(raw.composerFade)
      ? pct(raw.composerFade)
      : 50,
  };
}

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

/**
 * Session-list running indicator (运行中图标): ZCode's sidebar task rows show
 * a spinning lucide LoaderIcon in their leading 16px slot while a session
 * streams. "default" injects nothing — the stock spinner stays; "image"
 * paints the user's picture (static or animated GIF) over the spinner glyph
 * in both row renderers (plain list + grouped rows share the
 * `data-testid^="task-item-"` anchor).
 */
export type TaskSpinnerMode = "default" | "image";

export interface TaskSpinnerLookConfig {
  mode: TaskSpinnerMode;
  /**
   * Image reference: absolute file path (resolved to a serve media URL or a
   * data URI at payload build time), or an http(s)/data URL passed through.
   */
  image: string;
  /**
   * 运行完成标志 (完成未读点): replaces the unread dot sessions show in
   * their leading slot once a finished conversation has unread replies.
   * Empty = stock dot. Independent of `mode`/`image` (the loading slot).
   */
  unreadImage?: string;
  /**
   * 出错标志: replaces the error dot. Empty = stock red dot. Also
   * independent of the loading slot.
   */
  errorImage?: string;
  /**
   * Keep the stock rotation on the replaced icon. Static images usually want
   * this on; animated GIFs bring their own motion and want it off.
   */
  spin: boolean;
  /** Icon size in px (stock slot is 16). Applies to every replaced slot. */
  size: number;
}

export const DEFAULT_TASK_SPINNER_LOOK: TaskSpinnerLookConfig = {
  mode: "default",
  image: "",
  spin: true,
  size: 16,
};

/** Clamp a partial spinner look over the defaults (unparsable fields fall back). */
export function normalizeTaskSpinnerLook(raw?: Partial<TaskSpinnerLookConfig>): TaskSpinnerLookConfig {
  const mode = raw?.mode === "image" ? "image" : "default";
  const size = typeof raw?.size === "number" && Number.isFinite(raw.size)
    ? Math.max(10, Math.min(24, Math.round(raw.size)))
    : DEFAULT_TASK_SPINNER_LOOK.size;
  const ref = (v: unknown): string =>
    typeof v === "string" ? v.trim().slice(0, SPINNER_REF_MAX_CHARS) : "";
  return {
    mode,
    image: ref(raw?.image),
    unreadImage: ref(raw?.unreadImage),
    errorImage: ref(raw?.errorImage),
    spin: raw?.spin !== false,
    size,
  };
}

/** A pasted data URI larger than this is almost certainly a mistake at 16px. */
export const SPINNER_REF_MAX_CHARS = 500_000;

/**
 * 会话底部加载图标 (chat-loading icon): ZCode 3.18 replaced the conversation
 * footer's 3×3 pixel-wave dots with a brand-colored orbit SVG
 * ([data-testid="chat-loading"] > [data-chat-loading-icon] > svg). "default"
 * injects nothing; "classic" repaints the pre-3.18 wave (nine dots in a 13px
 * grid, clockwise pulse, foreground color) over the new glyph; "image" paints
 * a user picture (same slot contract as taskSpinnerLook).
 */
export type ChatLoadMode = "default" | "classic" | "image";

export interface ChatLoadLookConfig {
  mode: ChatLoadMode;
  /** Image reference — same resolution rules as taskSpinnerLook.image. */
  image: string;
  /** Keep a CSS rotation on the replaced icon (static images want it on). */
  spin: boolean;
  /** Icon size in px (stock slot is 16; the classic grid is fixed 13). */
  size: number;
}

export const DEFAULT_CHAT_LOAD_LOOK: ChatLoadLookConfig = {
  mode: "default",
  image: "",
  spin: true,
  size: 16,
};

/** Clamp a partial chat-load look over the defaults (mirrors the spinner). */
export function normalizeChatLoadLook(raw?: Partial<ChatLoadLookConfig>): ChatLoadLookConfig {
  const mode: ChatLoadMode = raw?.mode === "classic" || raw?.mode === "image" ? raw.mode : "default";
  const size = typeof raw?.size === "number" && Number.isFinite(raw.size)
    ? Math.max(10, Math.min(28, Math.round(raw.size)))
    : DEFAULT_CHAT_LOAD_LOOK.size;
  const ref = (v: unknown): string =>
    typeof v === "string" ? v.trim().slice(0, SPINNER_REF_MAX_CHARS) : "";
  return {
    mode: mode === "image" && !ref(raw?.image) ? "default" : mode,
    image: ref(raw?.image),
    spin: raw?.spin !== false,
    size,
  };
}

/**
 * FAB look (设置按钮): the floating panel-opener button (默认 🎨 圆球) can
 * carry a custom image and size. Purely panel-side — the bootstrap never
 * touches the FAB, so nothing here flows into BuiltPayload.
 */
export type FabMode = "default" | "image";
export interface FabLookConfig {
  mode: FabMode;
  /** Image reference — same resolution rules as taskSpinnerLook.image. */
  image: string;
  /** Ball diameter in px (stock 34). */
  size: number;
}

export const DEFAULT_FAB_LOOK: FabLookConfig = {
  mode: "default",
  image: "",
  size: 34,
};

/** Clamp a partial fab look over the defaults (mirrors the chat-load icon). */
export function normalizeFabLook(raw?: Partial<FabLookConfig>): FabLookConfig {
  const mode: FabMode = raw?.mode === "image" ? "image" : "default";
  const size = typeof raw?.size === "number" && Number.isFinite(raw.size)
    ? Math.max(20, Math.min(64, Math.round(raw.size)))
    : DEFAULT_FAB_LOOK.size;
  const ref = (v: unknown): string =>
    typeof v === "string" ? v.trim().slice(0, SPINNER_REF_MAX_CHARS) : "";
  return {
    mode: mode === "image" && !ref(raw?.image) ? "default" : mode,
    image: ref(raw?.image),
    size,
  };
}

/** Inline fallback cap for local files outside the data dir. */
export const SPINNER_FILE_MAX_BYTES = 2 * 1024 * 1024;
const SPINNER_MIME: Record<string, string> = {
  ".gif": "image/gif",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};

/**
 * Resolve the stored image reference into something the renderer CSS can
 * paint: http(s)/data URLs pass through, files inside the data dir become a
 * serve media URL (browser caches it; same trick as library wallpapers),
 * other local files are inlined as a data URI. Returns "" when nothing
 * usable remains — the injection treats that as the stock spinner.
 */
export function resolveSpinnerImageRef(ref: string, apiPort: number, mediaToken: string): string {
  if (!ref) return "";
  if (/^(https?:|data:)/i.test(ref)) return ref;
  let abs: string;
  try {
    abs = path.resolve(ref);
  } catch {
    return "";
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return "";
  }
  if (!stat.isFile()) return "";
  const ext = path.extname(abs).toLowerCase();
  if (!SPINNER_MIME[ext]) return "";
  // Normalize separators/case so forward-slash paths match too.
  const dir = path.resolve(dataDir()).toLowerCase();
  // Spinner files live in the dedicated <dataDir>/spinner/ subdir (served by
  // /media/spinner/). The root-level /media/lib/ branch stays for a user
  // hand-placed reference inside the data dir.
  const spinnerDir = path.join(dir, "spinner").toLowerCase();
  if (abs.toLowerCase().startsWith(spinnerDir + path.sep)) {
    const url = `http://127.0.0.1:${apiPort}/media/spinner/${encodeURIComponent(path.basename(abs))}`;
    return mediaToken ? `${url}?t=${mediaToken}` : url;
  }
  if (abs.toLowerCase().startsWith(dir + path.sep)) {
    const url = `http://127.0.0.1:${apiPort}/media/lib/${encodeURIComponent(path.basename(abs))}`;
    return mediaToken ? `${url}?t=${mediaToken}` : url;
  }
  if (stat.size > SPINNER_FILE_MAX_BYTES) {
    console.warn(`spinner image too large to inline (${Math.round(stat.size / 1024)} KB): ${abs}`);
    return "";
  }
  try {
    return `data:${SPINNER_MIME[ext]};base64,${fs.readFileSync(abs).toString("base64")}`;
  } catch {
    return "";
  }
}
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

/**
 * Opt-in state for the experimental CDP-injection capability. Off by default:
 * until enabled, the plugin spawns no serve daemon, never touches launch
 * entries, and the injection tools answer with guidance instead of acting.
 */
export interface ExperimentalConfig {
  /** Injection active: serve auto-starts, launchers self-heal, tools act. */
  enabled: boolean;
  /** Auto-migrated from a pre-gate config (prior use, not explicit consent). */
  migrated?: boolean;
  /** ISO timestamp of the explicit enable (enable_experimental / cli enable). */
  consentedAt?: string;
  /** Plugin version that recorded the consent. */
  consentVersion?: string;
}

export interface BeautifyConfig {
  port: number;
  /** Master opt-in for the experimental CDP injection (default: off). */
  experimental?: ExperimentalConfig;
  wallpaperPath?: string;
  blur: number;
  dim: number;
  /**
   * Extra darkening for the left sidebar only (侧边栏压暗), 0-100, additive
   * on top of `dim`. The desktop sidebar paints no background of its own
   * (the wallpaper shows straight through #sidebar), so a scrim on #sidebar
   * itself sits between the wallpaper and the sidebar content — it follows
   * panel width drags and folds away with the sidebar's own collapse.
   */
  sidebarDim?: number;
  monet: boolean;
  wallpaperVisible: boolean;
  fit: WallpaperFit;
  /**
   * Scene wallpapers: URL of the cached loop video (serve media endpoint).
   * When set, the wallpaper layer renders a <video> instead of an image.
   */
  sceneVideoUrl?: string;
  /** "video" when the current wallpaper is an imported scene wallpaper. */
  mediaType?: "image" | "video";
  /** Cache hash of the imported scene (loop at scenes/<hash>/loop.mp4). */
  sceneHash?: string;
  /** Serve API port used to derive sceneVideoUrl (target default: 9223/9334). */
  apiPort?: number;
  /** Wallpaper rotation playlist (定时播放). */
  rotation?: RotationConfig;
  /** Slow pan/zoom breathing on static image wallpapers (Ken Burns). */
  kenBurns?: boolean;
  /** Video wallpaper audio 0-100 (0 = muted; wallpapers default silent). */
  videoVolume?: number;
  /** Pinned Monet source color "#rrggbb" overriding extraction. */
  themeColor?: string;
  /** Zone-refined chat-area masks (聊天界面); absent = all zero. */
  chatLook?: Partial<ChatLookConfig>;
  /** User message bubble look (聊天气泡); absent = stock ZCode bubble. */
  bubbleLook?: Partial<BubbleLookConfig>;
  /** WorkBuddy-only component look (组件精修); absent = stock WorkBuddy. */
  componentLook?: Partial<ComponentLookConfig>;
  /** Session-list running indicator look (运行中图标); absent = stock spinner. */
  taskSpinnerLook?: Partial<TaskSpinnerLookConfig>;
  /** Conversation-footer loading icon (会话底部加载图标); absent = stock. */
  chatLoadLook?: Partial<ChatLoadLookConfig>;
  /** Panel-opener FAB look (设置按钮); absent = stock 🎨 ball. */
  fabLook?: Partial<FabLookConfig>;
  /** Sidebar session-list paging (会话列表分页); absent = stock 5/+5, no collapse. */
  listPaging?: Partial<ListPagingConfig>;
  /** Hide wallpaper+panel during ZCode's startup screen (default true). */
  startupClean?: boolean;
  /** Beautify ZCode's update-status window too (default false — stays stock). */
  showOnUpdater?: boolean;
  /** Import resolution: "auto" follows the wallpaper project size, else WxH. */
  importRes?: { mode: string; width?: number; height?: number };
  /** Day/night look schedule (护眼): two dim/blur presets switching by time. */
  dayNight?: {
    enabled: boolean;
    start: string;
    end: string;
    dayDim: number;
    nightDim: number;
    dayBlur: number;
    nightBlur: number;
  };
}

export const DEFAULT_CONFIG: BeautifyConfig = {
  port: 9222,
  experimental: { enabled: false },
  blur: 0,
  dim: 25,
  sidebarDim: 0,
  monet: true,
  wallpaperVisible: true,
  fit: "cover",
};

export interface BuiltPayload {
  css: string;
  wallpaperDataUri?: string;
  /** Set for scene wallpapers: the loop video URL for the <video> layer. */
  videoSrc?: string;
  /** How the wallpaper layer is framed; "contain" adds a blurred backdrop. */
  fit: "cover" | "contain";
  /** Switching effect the bootstrap overlay should play. */
  transition: WallpaperTransition;
  /** Normalized focus point for background-position. */
  focusX: number;
  focusY: number;
  /** True when Ken Burns motion applies to the current image wallpaper. */
  kenBurns: boolean;
  /** Video wallpaper audio volume 0-100 (0 = muted). */
  videoVolume: number;
  /** Zone-refined chat-area masks (聊天界面), normalized 0-100. */
  chatLook?: ChatLookConfig;
  /** User message bubble look (聊天气泡), normalized; preset default = stock. */
  bubbleLook?: BubbleLookConfig;
  /**
   * WorkBuddy component look (组件精修), normalized; `enabled: false` means
   * nothing was injected. Always populated (ZCode gets the disabled default).
   */
  componentLook: ComponentLookConfig;
  /**
   * Session-list running indicator look (运行中图标); `image` here is the
   * RESOLVED paint URL (media endpoint / data URI), "" = stock spinner.
   */
  taskSpinnerLook?: TaskSpinnerLookConfig;
  /**
   * Conversation-footer loading icon (会话底部加载图标); `image` is the
   * RESOLVED paint URL (media endpoint / data URI), "" = stock glyph.
   */
  chatLoadLook?: ChatLoadLookConfig;
  /** Sidebar session-list paging (会话列表分页); `initial: 0` = stock behaviour. */
  listPaging?: ListPagingConfig;
  /** Defer mounting until the ZCode startup screen is gone (default true). */
  startupClean?: boolean;
  /** False when the target client has no chat-area extras wired yet. */
  chatUi?: boolean;
  /** How the bootstrap recognises the client's startup screen. */
  startupProbe?: "zcode-body-class" | "workbuddy-skeleton";
  /**
   * 会话概览悬停卡 data source: full URL of the serve endpoint INCLUDING the
   * per-start token (`http://127.0.0.1:<port>/api/session-preview?t=…`).
   * Empty when the feature is off / the target has no chat UI — the bootstrap
   * then never mounts the hover card.
   */
  previewApi?: string;
}

/** The switching effect comes from the active rotation plan (fallback fade). */
function activePlanTransition(rotation: RotationConfig | undefined): WallpaperTransition {
  const plans = rotation?.plans;
  if (!plans?.length) return "fade";
  const plan = plans.find((p) => p.id === rotation?.activePlanId) ?? plans[0];
  return plan?.transition ?? "fade";
}

export function buildPayload(config: BeautifyConfig, assets?: WallpaperAssets, mediaToken = ""): BuiltPayload {
  const parts: string[] = [];
  const tok = mediaToken ? (u: string) => `${u}?t=${mediaToken}` : (u: string) => u;
  // Which client we are painting into decides the sidebar selector, whether the
  // ZCode-only prompt-queue mask applies, and which chat extras exist at all.
  const app = target();
  const chatUi = app.supportsChatUi;

  // "smart" resolves to the analyzed suggestion at build time, so the injected
  // CSS only ever deals with cover or contain.
  const resolved: "cover" | "contain" =
    config.fit === "smart" ? (assets?.focus.fit ?? "cover") : config.fit === "contain" ? "contain" : "cover";
  const focusX = config.fit === "smart" ? (assets?.focus.x ?? 0.5) : 0.5;
  const focusY = config.fit === "smart" ? (assets?.focus.y ?? 0.5) : 0.5;
  const position = `${Math.round(focusX * 100)}% ${Math.round(focusY * 100)}%`;

  // WorkBuddy paints its window on #root; clearing html/body alone leaves an
  // opaque sheet in front of the wallpaper layer.
  const rootSelector = app.tokens === "wb" ? "html, body, #root" : "html, body";
  parts.push(`
${rootSelector} { background: transparent !important; }
#zcode-beautify-wallpaper {
  position: fixed;
  inset: 0;
  z-index: -2147483646;
  background-size: ${resolved};
  background-position: ${resolved === "contain" ? "center" : position};
  background-repeat: no-repeat;
  pointer-events: none;
  filter: blur(${config.blur}px);
  transform: scale(${config.blur > 0 ? 1.04 : 1});
}
#zcode-beautify-backdrop {
  position: fixed;
  inset: 0;
  z-index: -2147483647;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  pointer-events: none;
  filter: blur(28px) saturate(1.15) brightness(0.85);
  transform: scale(1.12);
  display: none;
}
#zcode-beautify-backdrop[data-on="1"] { display: block; }`);
  if (config.dim > 0) {
    parts.push(`#zcode-beautify-wallpaper::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / var(--zcode-beautify-dim, ${config.dim / 100}));
}`);
  }

  // 侧边栏压暗: additive on top of the global dim (the two scrims compose);
  // the var indirection lets the panel live-preview like the global dim does.
  const sidebarDim = config.sidebarDim ?? 0;
  const sidebarSelector = app.sidebarSelector;
  if (sidebarDim > 0 && sidebarSelector) {
    parts.push(`${sidebarSelector} {
  background: rgb(0 0 0 / var(--zb-sidebar-dim, ${sidebarDim / 100})) !important;
}`);
  }

  // The prompt-queue card (data-testid="v4-queue") reserves a 28px empty strip
  // at its bottom (pb-7) and pulls the next row up by the same 28px (-mb-7),
  // so the queue sits behind the input card's top edge. Stock ZCode depends on
  // the input being opaque: only the two notches outside its rounded corners
  // show queue surface, which makes queue + input read as one card. With our
  // translucent input that strip shows through as a dark band; masking the
  // whole strip away instead leaves a hard cut between the two cards.
  //
  // Keep queue paint only where the stock wrap actually shows: the corner
  // notches around the input's two top rounded corners.
  //   1. a vertical mask clears the 28px overlap strip;
  //   2. two 16x16 radial patches paint it back outside each corner arc
  //      (transparent inside the radius, opaque outside).
  // Layers composite additively. `calc(100% - (overlap - radius))` is the
  // patch's top offset: a mask-position percentage aligns the patch's FAR edge,
  // so 100% already sits `radius` above the bottom; subtracting the remaining
  // 12px lands the patch exactly on the input's top edge. Both numbers are
  // structural — rounded-2xl input (16px) and pb-7/-mb-7 queue (28px) — and
  // are exposed as variables for future ZCode versions.
  // Structural to ZCode's composer; other clients do not have this card, and
  // the mask would clip an unrelated element that happens to reuse the attr.
  if (app.id === "zcode") parts.push(`[data-testid="v4-queue"] {
  --zb-queue-overlap: 28px;
  --zb-queue-radius: 16px;
  --zb-queue-wrap-y: calc(100% - (var(--zb-queue-overlap) - var(--zb-queue-radius)));
  -webkit-mask-image:
    linear-gradient(to bottom, #000 calc(100% - var(--zb-queue-overlap)), transparent calc(100% - var(--zb-queue-overlap))),
    radial-gradient(circle at 100% 100%, transparent calc(var(--zb-queue-radius) - 1px), #000 var(--zb-queue-radius)),
    radial-gradient(circle at 0% 100%, transparent calc(var(--zb-queue-radius) - 1px), #000 var(--zb-queue-radius));
  -webkit-mask-size: 100% 100%, var(--zb-queue-radius) var(--zb-queue-radius), var(--zb-queue-radius) var(--zb-queue-radius);
  -webkit-mask-position: 0 0, 0 var(--zb-queue-wrap-y), 100% var(--zb-queue-wrap-y);
  -webkit-mask-repeat: no-repeat;
  mask-image:
    linear-gradient(to bottom, #000 calc(100% - var(--zb-queue-overlap)), transparent calc(100% - var(--zb-queue-overlap))),
    radial-gradient(circle at 100% 100%, transparent calc(var(--zb-queue-radius) - 1px), #000 var(--zb-queue-radius)),
    radial-gradient(circle at 0% 100%, transparent calc(var(--zb-queue-radius) - 1px), #000 var(--zb-queue-radius));
  mask-size: 100% 100%, var(--zb-queue-radius) var(--zb-queue-radius), var(--zb-queue-radius) var(--zb-queue-radius);
  mask-position: 0 0, 0 var(--zb-queue-wrap-y), 100% var(--zb-queue-wrap-y);
  mask-repeat: no-repeat;
}`);

  if (assets) {
    // Monet recolors the UI from the wallpaper; the wallpaper toggle only
    // decides whether the picture is visible at all. With Monet off we still
    // need transparency, otherwise the opaque UI hides the wallpaper.
    if (config.monet) {
      parts.push(buildVariableOverrides(assets.theme, {
        dim: config.dim,
        wallpaperVisible: config.wallpaperVisible,
      }));
    } else if (config.wallpaperVisible) {
      parts.push(buildTransparencyOverrides({ dim: config.dim }));
    }
  }
  // 组件精修 (WorkBuddy only): explicit overrides for the shell containers the
  // design system cannot reach — the sidebar, menubar labels and composer are
  // painted with literal colors — plus an optional bridge that makes the
  // conversation renderer's --cr-* family follow --wb-*. Appended AFTER the
  // token block so the component rules win the cascade.
  const componentLook = app.tokens === "wb"
    ? normalizeComponentLook(config.componentLook)
    : normalizeComponentLook(undefined);
  if (app.tokens === "wb" && componentLook.enabled) {
    parts.push(workbuddyComponentCss(componentLook));
  }
  // Library images stream over the serve media endpoint instead of a base64
  // data URI: a multi-MB payload means a huge CDP evaluate + a second decode
  // in the renderer, while the browser caches by URL — switching is far
  // faster. Wallpapers outside the data dir keep the inline fallback.
  let wallpaperDataUri: string | undefined;
  if (!config.sceneVideoUrl && config.wallpaperVisible) {
    // Normalize separators/case so forward-slash paths match too.
    const p = path.resolve(config.wallpaperPath ?? "").toLowerCase();
    const dir = path.resolve(dataDir()).toLowerCase();
    if (p.startsWith(dir + path.sep) && /\.(jpe?g|png|webp|bmp)$/i.test(p)) {
      wallpaperDataUri = tok(`http://127.0.0.1:${config.apiPort ?? target().apiPort}/media/lib/${encodeURIComponent(path.basename(config.wallpaperPath!))}`);
    } else {
      wallpaperDataUri = assets?.dataUri;
    }
  }
  const videoSrc = config.wallpaperVisible && config.sceneVideoUrl ? tok(config.sceneVideoUrl) : undefined;
  // Ken Burns animates the wallpaper layer's transform — only meaningful for
  // a static image (a video plays its own motion) and with blur off (blur
  // already occupies the transform).
  const kenBurns = Boolean(config.kenBurns) && !videoSrc && config.blur === 0 && Boolean(wallpaperDataUri);
  // 运行中图标: resolve the stored reference to a paintable URL here so the
  // injected CSS never sees a bare file path. A failed resolution degrades
  // to "" and the bootstrap falls back to the stock spinner. The 完成未读 /
  // 出错 slots resolve through the same helper and stay independent of the
  // loading slot's mode.
  const spinnerLook = normalizeTaskSpinnerLook(config.taskSpinnerLook);
  if (spinnerLook.image) {
    spinnerLook.image = resolveSpinnerImageRef(spinnerLook.image, config.apiPort ?? target().apiPort, mediaToken);
  }
  if (spinnerLook.unreadImage) {
    spinnerLook.unreadImage = resolveSpinnerImageRef(spinnerLook.unreadImage, config.apiPort ?? target().apiPort, mediaToken);
  }
  if (spinnerLook.errorImage) {
    spinnerLook.errorImage = resolveSpinnerImageRef(spinnerLook.errorImage, config.apiPort ?? target().apiPort, mediaToken);
  }
  // 会话底部加载图标: same resolution path as the spinner slots.
  const chatLoadLook = normalizeChatLoadLook(config.chatLoadLook);
  if (chatLoadLook.image) {
    chatLoadLook.image = resolveSpinnerImageRef(chatLoadLook.image, config.apiPort ?? target().apiPort, mediaToken);
    if (!chatLoadLook.image) chatLoadLook.mode = "default";
  }

  return {
    css: parts.join("\n"),
    wallpaperDataUri,
    videoSrc,
    fit: config.wallpaperVisible ? resolved : "cover",
    transition: activePlanTransition(config.rotation),
    focusX,
    focusY,
    kenBurns,
    videoVolume: Math.max(0, Math.min(100, Math.round(config.videoVolume ?? 0))),
    // Chat extras (bubbles, column width, spinner icons) are bound to ZCode's
    // DOM. On other clients they are forced back to stock so a stored config
    // copied from ZCode can never inject rules for elements that do not exist.
    chatLook: chatUi ? normalizeChatLook(config.chatLook) : normalizeChatLook(undefined),
    bubbleLook: chatUi ? normalizeBubbleLook(config.bubbleLook) : normalizeBubbleLook(undefined),
    componentLook,
    taskSpinnerLook: chatUi ? spinnerLook : normalizeTaskSpinnerLook(undefined),
    chatLoadLook: chatUi ? chatLoadLook : normalizeChatLoadLook(undefined),
    // 会话列表分页: ZCode-only (the virtual-project-tasks list does not exist
    // elsewhere); the disabled default keeps WorkBuddy untouched.
    listPaging: chatUi ? normalizeListPaging(config.listPaging) : normalizeListPaging(undefined),
    startupClean: config.startupClean !== false,
    chatUi,
    startupProbe: app.startupProbe,
    // 会话概览悬停卡: only ZCode rows carry session ids, and only when the
    // toggle is on does the bootstrap need the (token-bearing) endpoint.
    previewApi: chatUi && normalizeChatLook(config.chatLook).sessionHover === 1
      ? tok(`http://127.0.0.1:${config.apiPort ?? target().apiPort}/api/session-preview`)
      : "",
  };
}

export interface InjectScriptInput {
  mediaType: "image" | "video";
  /** Image file path / data URI, or the loop video URL for video type. */
  path: string;
  blur: number;
  dim: number;
  fit?: "cover" | "contain";
}

/**
 * Thin convenience wrapper that builds a standalone injection script from a
 * minimal input — used by tests and quick one-off injections. Full theming
 * flows through buildPayload().
 */
export function buildInjectScript(input: InjectScriptInput): string {
  let css = `
html, body { background: transparent !important; }
#zcode-beautify-wallpaper {
  position: fixed;
  inset: 0;
  z-index: -2147483646;
  pointer-events: none;
  filter: blur(${input.blur}px);
  transform: scale(${input.blur > 0 ? 1.04 : 1});
}
#zcode-beautify-wallpaper > video,
#zcode-beautify-wallpaper {
  width: 100%;
  height: 100%;
  object-fit: cover;
}`;
  if (input.dim > 0) {
    css += `
#zcode-beautify-wallpaper::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / ${input.dim / 100});
}`;
  }

  if (input.mediaType === "video") {
    return buildBootstrapScript({ css, videoSrc: input.path, fit: input.fit ?? "cover", transition: "fade" });
  }
  const src = /^(data:|https?:|file:)/i.test(input.path)
    ? input.path
    : `file:///${input.path.replace(/\\/g, "/").replace(/^\/+/, "")}`;
  return buildBootstrapScript({ css, wallpaperDataUri: src, fit: input.fit ?? "cover", transition: "fade" });
}

/** Apply config to a running client instance. Returns how many windows got it. */
export async function applyToZCode(config: BeautifyConfig, payload: BuiltPayload): Promise<number> {
  const targets = pickRendererTargets(await listTargets(config.port));
  if (targets.length === 0) {
    throw new Error(`No ${target().appName} renderer target found on the CDP endpoint.`);
  }
  let count = 0;
  for (const target of targets) {
    // The update-status window is opt-in; skip it unless configured otherwise.
    if (isUpdaterTarget(target) && config.showOnUpdater !== true) continue;
    try {
      await injectIntoTarget(target, payload);
      count++;
    } catch (err) {
      console.warn(`Injection into "${target.title}" failed: ${(err as Error).message}`);
    }
  }
  return count;
}

export async function resetZCode(port: number): Promise<number> {
  const targets = pickRendererTargets(await listTargets(port));
  let count = 0;
  for (const target of targets) {
    try {
      const conn = await CdpConnection.connect(target.webSocketDebuggerUrl!);
      await conn.send("Runtime.evaluate", { expression: buildResetScript() });
      conn.close();
      count++;
    } catch (err) {
      console.warn(`Reset of "${target.title}" failed: ${(err as Error).message}`);
    }
  }
  return count;
}

/** Re-export so CLI/MCP can load wallpapers without touching monet internals. */
export { loadWallpaper };
