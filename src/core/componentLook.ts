/**
 * WorkBuddy component-level look (组件精修).
 *
 * The 5.9.x analysis showed WorkBuddy paints several shell containers with
 * hard-coded colors instead of design tokens:
 *
 *   .conversation-list        background: rgb(31,31,31)
 *   .cr-input-container       background: #1f1f1f; border-color: #333
 *   .menubar-menu-title       color: rgba(228,228,228,.37)
 *
 * plus a conversation-renderer token family (`--cr-*`) that does not follow
 * the design-system family (`--wb-*`). This module turns those gaps into a
 * small, explicit set of knobs — the CSS below is only injected on the
 * WorkBuddy target and only when `enabled` is true, so a stock install keeps
 * the exact original appearance.
 *
 * Rules use `!important` because WorkBuddy's dark-theme rules are often
 * `[data-theme=dark] .conversation-list` (specificity 0,2,0) while our
 * injected sheet is appended last; matching that specificity is not enough
 * across future builds, so the override is explicit.
 */

export interface ComponentLookConfig {
  /** Master switch; false = inject nothing (stock WorkBuddy). */
  enabled: boolean;
  /** Conversation sidebar surface 0-100 (% of --wb-bg-secondary). */
  sidebarTone: number;
  /** Menu-bar label opacity 20-100 (% of --wb-color-text-primary). */
  menubarText: number;
  /** Composer surface 0-100 (% of --wb-bg-card). */
  composerTone: number;
  /** Composer outline 0-100 (% of --wb-border-strong). */
  composerBorder: number;
  /** Composer corner radius in px (stock 24). */
  composerRadius: number;
  /** Tool-card / collapse radius in px (stock 8). */
  toolRadius: number;
  /** Shared control radius in px (--wb-radius-md/lg, stock 6/8). */
  controlRadius: number;
  /** Modal & popover radius in px (stock 24). */
  modalRadius: number;
  /** Re-point the conversation renderer's --cr-* text colors at --wb-*. */
  syncCrTokens: boolean;
}

export const DEFAULT_COMPONENT_LOOK: ComponentLookConfig = {
  enabled: false,
  sidebarTone: 72,
  menubarText: 72,
  composerTone: 72,
  composerBorder: 55,
  composerRadius: 24,
  toolRadius: 8,
  controlRadius: 8,
  modalRadius: 24,
  syncCrTokens: true,
};

const clamp = (v: unknown, min: number, max: number, dflt: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : dflt;

/** Clamp a partial look over the defaults (unparsable fields fall back). */
export function normalizeComponentLook(raw?: Partial<ComponentLookConfig>): ComponentLookConfig {
  return {
    enabled: raw?.enabled === true,
    sidebarTone: clamp(raw?.sidebarTone, 0, 100, DEFAULT_COMPONENT_LOOK.sidebarTone),
    menubarText: clamp(raw?.menubarText, 20, 100, DEFAULT_COMPONENT_LOOK.menubarText),
    composerTone: clamp(raw?.composerTone, 0, 100, DEFAULT_COMPONENT_LOOK.composerTone),
    composerBorder: clamp(raw?.composerBorder, 0, 100, DEFAULT_COMPONENT_LOOK.composerBorder),
    composerRadius: clamp(raw?.composerRadius, 8, 40, DEFAULT_COMPONENT_LOOK.composerRadius),
    toolRadius: clamp(raw?.toolRadius, 0, 20, DEFAULT_COMPONENT_LOOK.toolRadius),
    controlRadius: clamp(raw?.controlRadius, 0, 20, DEFAULT_COMPONENT_LOOK.controlRadius),
    modalRadius: clamp(raw?.modalRadius, 8, 40, DEFAULT_COMPONENT_LOOK.modalRadius),
    syncCrTokens: raw?.syncCrTokens !== false,
  };
}

/**
 * Build the override sheet. Selector notes (verified against WorkBuddy 5.9.3):
 * - `.conversation-list` is the sidebar surface inside `.conversation-sidebar`.
 * - `.menubar-menu-title` / `.menubar-mnemonic` are the two text nodes of the
 *   30px `.codebuddy-menubar`.
 * - `.cr-input-container` is the 936x165 composer shell (radius 24).
 * - `.assistant-message-tool` is the tool-result card (radius 8); the collapse
 *   wrappers borrow the same radius so expanded rows stay consistent.
 * - `--wb-radius-md/lg` feed inputs, cards and most secondary buttons;
 *   `--wb-modal-radius` feeds modal/dialog surfaces (stock 24).
 */
export function workbuddyComponentCss(look: ComponentLookConfig): string {
  if (!look.enabled) return "";
  const parts: string[] = [];

  parts.push(`/* 组件精修 · 壳层 */
.conversation-list {
  background-color: color-mix(in srgb, var(--wb-bg-secondary) ${look.sidebarTone}%, transparent) !important;
}
.menubar-menu-title,
.menubar-mnemonic {
  color: color-mix(in srgb, var(--wb-color-text-primary) ${look.menubarText}%, transparent) !important;
}`);

  parts.push(`/* 组件精修 · 输入框 */
.cr-input-container {
  background-color: color-mix(in srgb, var(--wb-bg-card) ${look.composerTone}%, transparent) !important;
  border-color: color-mix(in srgb, var(--wb-border-strong) ${look.composerBorder}%, transparent) !important;
  border-radius: ${look.composerRadius}px !important;
}`);

  parts.push(`/* 组件精修 · 工具卡 */
.assistant-message-tool,
.assistant-message-tool-container .assistant-message-tool,
.cr-collapse,
.cr-tool-call {
  border-radius: ${look.toolRadius}px !important;
}`);

  // Equal-or-higher specificity than the app's own themed blocks: it defines
  // these on `:root, body[data-vscode-theme-name=…]` and on the dark variant.
  parts.push(`/* 组件精修 · 通用组件 */
html[data-theme="light"], html[data-theme="dark"], html.cb-light, html.cb-dark, :root {
  --wb-radius-md: ${look.controlRadius}px;
  --wb-radius-lg: ${look.controlRadius}px;
  --wb-modal-radius: ${look.modalRadius}px;
  --wb-modal-radius-confirm: ${look.modalRadius}px;
}`);

  if (look.syncCrTokens) {
    parts.push(`/* 组件精修 · 会话令牌跟随主题 */
html[data-theme="light"], html[data-theme="dark"], html.cb-light, html.cb-dark, :root {
  --cr-text-primary: var(--wb-color-text-primary);
  --cr-text-secondary: var(--wb-color-text-secondary);
  --cr-text-tertiary: var(--wb-color-text-tertiary);
  --cr-text-link: var(--wb-color-text-link-default);
  --cr-internal-text-primary: var(--wb-color-text-primary);
  --cr-internal-text-secondary: var(--wb-color-text-secondary);
  --cr-internal-text-tertiary: var(--wb-color-text-tertiary);
  --cr-tag-bg: color-mix(in srgb, var(--wb-color-text-primary) 6%, transparent);
  --cr-user-bubble-bg: color-mix(in srgb, var(--wb-bg-card) 88%, transparent);
  --cr-scrollbar-thumb: color-mix(in srgb, var(--wb-color-text-primary) 16%, transparent);
}`);
  }

  return parts.join("\n");
}
