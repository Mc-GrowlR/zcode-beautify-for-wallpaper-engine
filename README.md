# zcode-beautify

[English](README.md) | [中文](README.zh-CN.md)

Beautify the **ZCode desktop client**: use any image — or any **video / Wallpaper Engine scene wallpaper** — as a background wallpaper and adapt the whole UI with Material Design 3 (Monet) dynamic color; restyle the chat area (message bubbles, conversation-column width, a large-session smooth mode) — plus a live settings panel for real-time tuning.

> 📷 Screenshot welcome — PRs adding one to `docs/screenshot.png` are appreciated.

## Features

### Wallpapers & theming

- **Dynamic wallpapers** — import a Wallpaper Engine **scene** (`.pkg` or workshop directory) or a plain **video** (`.mp4`/`.webm`): scenes are rendered in a dedicated Wallpaper Engine window, captured through Desktop Duplication and processed into a perfectly seamless loop (first frame == last frame); long videos are trimmed to a middle segment. Loops are cached content-addressed (LRU) and streamed to the renderer over HTTP — motion with no interaction and no sound.
- **Wallpaper Engine library browser** — browse your local WE wallpapers (Steam workshop subscriptions + your own projects, across multiple Steam libraries) right inside the panel: type or folder views, search, multi-select batch import with progress, hover previews (video wallpapers play their own clip; scenes get a real rendered preview), imported badges, and real WE titles.
- **Scheduled rotation** — multiple named playlists, each with its own order mode (**sequential / shuffle without repeating the same item twice / daily at a fixed time**), a transition effect (fade / slide / zoom / blur / none), and an optional time window (overnight windows supported). Rotation survives serve restarts and resumes from where it stopped; switching wallpapers manually auto-pauses it.
- **Static wallpapers** — any local image becomes a fixed background layer behind the UI, with three framing modes: `cover` (fill and crop), `contain` (letterboxed over a blurred backdrop of the same picture), and `smart` — a local AI-style analysis that finds the salient subject and picks the best framing and focus point automatically. Optional Ken Burns easing for image changes.
- **Monet theming** — a source color is extracted from the wallpaper with Google's official MD3 algorithm; light/dark palettes are mapped onto ZCode's semantic CSS variables (35+ tokens). Functional colors (success/warning/destructive) are intentionally left untouched.

### Chat-area restyling

- **Chat bubbles** — five presets for your own message bubbles (`accent` tint, `glass` blur, `outline`, `flat`, or stock `default`), plus tint strength, corner radius, width and alignment controls, a bubble style editor with a saved personal style library, and custom CSS support. Colors reference live theme tokens, so a Monet re-theme restyles the bubbles too.
- **Conversation width** — widen or narrow the message column: stock / wide tiers / three narrow tiers / fully custom (cap + inset in rem). Injected as a **formula** (rem cap + `calc()` inset) rather than a fixed width, so it keeps following window resizes exactly like the native layout and never overflows into the input bar.
- **Large-session smooth mode** (off by default) — message rows far outside the viewport are measured first, then skipped for layout and painting (`content-visibility:auto` with accurate `contain-intrinsic-size`). On a 51 MB session clone this cut first-open time by **~41%** with zero scrollbar distortion; long chats scroll smoother.
- **Elapsed-time decimal trim** (off by default) — the working-row elapsed time under the conversation drops its fractional seconds ("53.4 秒" → "53 秒"), rewritten live; toggling off restores stock.

### Panel & service

- **Live settings panel** — a draggable panel inside ZCode with three tabs: **Wallpaper** (grouped library, import with progress and dependency guidance, current look), **Rotation** (playlists), and **Settings** — blur/dim sliders, framing modes, Monet and wallpaper-visibility toggles, chat-area masks (dim / gradient / veil), day-night eye care, recording resolution, config export/import, recent history, and reset. Changes preview instantly and persist.
- **Zero-touch serve** — the MCP server starts the background service automatically when ZCode launches, so the panel is simply always there.
- **Self-healing launch entries** — while `serve` runs, every ZCode launch entry (desktop / start-menu / taskbar shortcuts — OneDrive-redirected folders included — plus the `zcode://` protocol handler and Explorer context-menu verbs) is kept carrying `--remote-debugging-port` automatically, so the theme survives ZCode restarts *and* updater-rebuilt shortcuts. `repair-launchers` scans and fixes them on demand with a structured report (machine-wide entries are reported, not modified). The theme itself also survives renderer reloads, and the last look is cached in `localStorage` as a fallback.
- **Conversation control** — bundled slash commands `/beautify` and `/bubble`, plus MCP tools (`set_background`, `import_scene_wallpaper`, `apply_options`, `repair_launchers`, …), let the ZCode agent set the wallpaper, tune the theme, or restyle your chat bubbles from a plain-language description.

## How it works

ZCode is an Electron app whose UI theming is driven by Tailwind v4 `--color-*` CSS custom properties, and production builds start **without** a debug port. This plugin:

1. starts ZCode with `--remote-debugging-port=9222` (one-time `launch`; launch entries are then kept fixed automatically);
2. connects over the Chrome DevTools Protocol and injects CSS/JS into the renderer:
   - a fixed-position wallpaper layer (images embedded as data URI, video loops streamed over localhost HTTP),
   - translucent background variables so the wallpaper shows through,
   - MD3 light/dark palettes overriding ZCode's semantic tokens,
   - optional chat-look layers: bubble styles, conversation-width formula, off-screen row skipping;
3. keeps the injection sessions open (`serve`) so the theme, the settings panel, and rotation survive renderer reloads.

It never modifies ZCode's installation files, so ZCode upgrades are unaffected.

## Requirements

- Node.js ≥ 20 available on your PATH.
- ZCode desktop client (Windows / macOS / Linux).
- For dynamic wallpapers (optional): **Wallpaper Engine** (Steam) and **ffmpeg ≥ 5.0** on PATH — both are auto-detected, and the panel shows install guidance when missing. Capture uses the Desktop Duplication API, so dynamic import is **Windows-only**; static image wallpapers work everywhere.

## Two packages, both installable by handing an AI the link

Give your AI agent just <https://github.com/Logocceai/zcode-beautify> — it
clones the repo and follows the instructions inside. Pick the right one:

| | **Plugin package** (`INSTALL-FOR-AI.md`) | **Skill pack** (`skill-pack/SKILL.md`) |
|---|---|---|
| Target | The **ZCode desktop client** | **Any** Electron app |
| AI's role | Installer — sets up the ready-made plugin | Developer — builds the tool from scratch |
| You say | "Install this beautify plugin in my ZCode" | "Build wallpaper/color beautification for my XX app" |
| Result | Working `/beautify` + `/bubble` commands and MCP tools | A new local beautify tool |

Copy-paste prompt for the plugin:

```text
https://github.com/Logocceai/zcode-beautify
Install this beautify plugin into my ZCode desktop client. Follow
INSTALL-FOR-AI.md in the repository.
```

Offline? Both packages are attached to the
[releases page](https://github.com/Logocceai/zcode-beautify/releases) as zips.

## Install (manual paths)

### Option A — ZCode plugin marketplace (recommended)

1. Open ZCode → **Settings → Plugin Management → Discover**.
2. Click **+** and add this repository (GitHub URL or a local clone path).
3. Click **Get** on the *zcode-beautify* card. The `/beautify` and `/bubble` commands and MCP tools are available immediately.

The published repo ships prebuilt single-file bundles in `dist/`, so no build step is needed on your machine.

### Option B — clone and run

```bash
git clone https://github.com/Logocceai/zcode-beautify.git
cd zcode-beautify
node dist/cli.js --help        # prebuilt bundle, zero install
```

## Quick start

```bash
# 1) Quit ZCode completely, then start it with the CDP debug port (one-time).
node dist/cli.js launch

# 2) Set a wallpaper with Monet adaptation
node dist/cli.js apply "D:\pictures\wallpaper.jpg" --blur 6 --dim 30

# 3) (Recommended) Keep the theme alive + get the live settings panel.
#    --detach backgrounds it, so the panel keeps working after this shell
#    (or the agent session that started it) is gone.
node dist/cli.js serve --detach
```

With `serve` running, a 🎨 button appears in the bottom-right corner of ZCode. The panel has three tabs — **Wallpaper** (library, imports, current look), **Rotation** (playlists), and **Settings** — plus a chat-area section for bubble presets and sliders, conversation-width tiers, and the large-session smooth mode. Everything previews instantly and is saved automatically. If the service is not running, the panel shows an explicit ⚠ offline banner instead of a zeroed configuration.

You can also just type `/beautify <image path>` in ZCode and let the agent do it, then say things like "make it blurrier" — or type `/bubble glass with a bigger radius` to restyle your chat bubbles conversationally.

## CLI reference

| Command | Purpose |
|---|---|
| `launch [--port N]` | Start ZCode with `--remote-debugging-port` (quit ZCode first) |
| `apply <image> [--blur] [--dim] [--fit] [--no-monet]` | Set wallpaper + adapt colors (`--fit cover\|contain\|smart`) |
| `apply-scene <pkg-or-dir>` | Import a Wallpaper Engine scene / video wallpaper end-to-end |
| `colors` | Re-apply the stored theme without changing the image |
| `serve [--detach] [--api-port M]` | Watch mode + settings panel + local control API (default API port 9223); `--detach` survives the shell that started it |
| `watch` | Headless watch mode: re-inject whenever ZCode restarts |
| `repair-launchers [--dry-run]` | Scan/fix every launch entry so ZCode always starts with the CDP port |
| `reset` | Remove wallpaper and color overrides |
| `status` | Show CDP reachability and renderer targets |

## MCP tools

| Tool | Purpose |
|---|---|
| `set_background` | Set wallpaper (image or scene) + Monet colors |
| `import_scene_wallpaper` | Import a WE scene / video wallpaper end-to-end |
| `apply_options` | Tune blur/dim/monet/visibility/framing, chat width, bubble look — without re-sending the image |
| `refresh_theme` | Re-inject the stored theme after a restart |
| `reset_appearance` | Remove wallpaper and overrides |
| `beautify_status` | Show the stored config |
| `repair_launchers` | Scan/fix launch entries (structured report) |

## Project structure

```
├─ src/
│  ├─ cli.ts                 # CLI entry: launch / apply / apply-scene / colors / reset / status / watch / serve / repair-launchers
│  ├─ core/
│  │  ├─ cdp.ts              # Minimal Chrome DevTools Protocol client + injection scripts
│  │  ├─ inject.ts           # Assembles the injected payload (wallpaper layer + token overrides + chat look)
│  │  ├─ launch.ts           # Config persistence + ZCode launcher (single-instance aware)
│  │  ├─ launchers.ts        # Launch-entry repair: shortcuts + registry handlers keep the CDP port
│  │  ├─ monet.ts            # Image decode, MD3 source-color extraction, smart-fit analysis
│  │  ├─ tokens.ts           # MD3 schemes → ZCode's Tailwind v4 --color-* variables
│  │  ├─ session.ts          # Shared apply/reset operations used by CLI and MCP
│  │  ├─ wallpaperType.ts    # Input type detection (image / scene / video / web)
│  │  ├─ dependencyCheck.ts  # Wallpaper Engine + ffmpeg detection with install guidance
│  │  ├─ weLauncher.ts       # WE window control (open/close wallpaper in a dedicated window)
│  │  ├─ weLibrary.ts        # Local WE wallpaper library browsing (workshop + my projects)
│  │  ├─ recorder.ts         # Desktop Duplication capture of the WE window
│  │  ├─ loopProcessor.ts    # Seamless-loop construction (first frame == last frame)
│  │  ├─ scenePipeline.ts    # End-to-end import pipeline (detect → deps → record → loop → cache)
│  │  ├─ cacheManager.ts     # Content-addressed scene cache (LRU)
│  │  ├─ media.ts            # HTTP media endpoints (Range requests) for scene loops
│  │  ├─ bubbleRecipes.ts    # Chat-bubble preset styles
│  │  └─ server.ts           # `serve` mode: control API + rotation scheduler + persistent injection sessions
│  ├─ panel/panelScript.ts   # The injected settings panel (3 tabs: wallpaper / rotation / settings)
│  └─ mcp/server.ts          # MCP server exposing tools to the ZCode agent
├─ commands/beautify.md      # /beautify slash command
├─ commands/bubble.md        # /bubble slash command (restyle bubbles from a description)
├─ skills/beautify/SKILL.md  # Agent-facing workflow documentation
├─ .zcode-plugin/plugin.json # ZCode plugin manifest (commands, skills, MCP server)
├─ marketplace.json          # Marketplace index so the repo is discoverable in ZCode
├─ scripts/                  # bundle (dist/), package (release zips), record-install
└─ dist/                     # Prebuilt cli.js + mcp/server.js — no build step needed
```

User data lives in `~/.zcode/cli/plugins/data/zcode-beautify/`: `config.json`
(live configuration), `config.backup.json` (what 还原/Reset remembers for
restore), `wallpaper.*` (a copy of your image so the theme survives the
original file moving or being deleted), and `scenes/` (the content-addressed
dynamic-wallpaper cache, LRU-capped).

## Development

```bash
npm install
npm run build    # type-check + compile to dist/
npm run bundle   # prebuilt single-file bundles (what the repo ships)
```

`dist/` is committed so users never need to build. If you change `src/`, run `npm run bundle` and commit the updated bundles.

## Skill pack (`skill-pack/`)

`skill-pack/` is a self-contained, platform-agnostic skill for AI coding agents
(Claude, DeepSeek, Codex, Doubao, …): hand the folder to any agent and it can
rebuild this beautify capability for **any** Electron app — the CDP plumbing,
MD3 color extraction, injection templates, live-tuning API, and the pitfall
list gathered from production. Versioned together with this repo. Grab it from
the [releases page](https://github.com/Logocceai/zcode-beautify/releases) as a
zip, or read [`skill-pack/SKILL.md`](skill-pack/SKILL.md) directly.

## Risks & limitations

- Injection happens over CDP — an **unofficial** mechanism. Updates to ZCode may break it; `reset` always restores the default look.
- `launch` restarts ZCode once. Without `serve`/`watch` running, the theme is lost on every ZCode restart (CDP sessions are scoped to the connection). No manual edits needed: the MCP server keeps every ZCode launch entry (shortcuts, protocol handler, context-menu verbs) carrying ` --remote-debugging-port=9222` automatically, so the theme survives every restart as long as `serve` runs. Start it with `serve --detach`: a foreground `serve` dies with the terminal (or agent session) that spawned it, and the panel then reports itself offline.
- Chat restyling hooks (`[data-v4-user-input-bubble]`, `conversation:max-w-*` container queries) are tied to ZCode's current DOM; a ZCode redesign may need selector updates.
- The control API binds to `127.0.0.1` only and authenticates with a per-launch random token; media URLs carry the token as a query parameter.
- Dynamic import (scene capture) is Windows-only (Desktop Duplication API); everything else is cross-platform.

## License

MIT
