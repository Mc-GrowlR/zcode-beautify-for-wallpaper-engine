---
name: beautify
description: Beautify the ZCode desktop client — import a background wallpaper image and adapt all UI colors with Material Design 3 (Monet) dynamic color. Use when the user asks to set a background, wallpaper, theme, or re-color the ZCode UI.
---

# ZCode Beautify

This plugin themes the ZCode **desktop client** (Electron app) by injecting a
wallpaper layer and Monet-derived CSS variable overrides over CDP. It never
modifies ZCode's installation files.

## When to use

- "把这张图设为 ZCode 背景" / "set this image as the ZCode background"
- "换个主题颜色" / "make the UI match my wallpaper"
- "恢复默认外观" / "reset the appearance"
- "把聊天气泡改成毛玻璃" / style the chat bubbles → use the `/bubble` command
  (it maps the description to presets or custom CSS via `apply_options`)

## Workflow

1. **Get an image path from the user.** Only absolute local paths are accepted.
2. **Call the `set_background` tool** with `image_path` (plus optional `blur`,
   `dim`). The tool copies the image into the plugin data dir, extracts the MD3
   source color, generates light/dark schemes, and injects everything into the
   running ZCode renderer.
3. **On CDP/port errors**: the ZCode instance is running without the debug
   port. Instruct the user to quit ZCode completely and start it via
   `node <plugin-root>/dist/cli.js launch`, or via watch mode:
   `node <plugin-root>/dist/cli.js watch` (keeps re-injecting across restarts).
4. **Fine-tune with `apply_options`** (blur / dim / monet / wallpaper_visible /
   fit) when the user wants adjustments — it does not need the image path
   again. `fit` picks the framing: `cover` fills and crops, `contain`
   letterboxes over a blurred backdrop, `smart` analyzes the picture locally
   and picks framing + focus automatically.
5. **After ZCode restarts**, the injected theme is gone until re-injected — use
   the `refresh_theme` tool or run watch mode.
6. **To undo everything**, use `reset_appearance`.
7. **Recommend `node <plugin-root>/dist/cli.js serve --detach`** for an
   interactive experience: it keeps the theme alive and shows a draggable
   settings panel inside ZCode (blur/dim sliders, Monet toggle, wallpaper swap,
   reset). `--detach` matters — a foreground `serve` is reaped with the shell or
   agent session that spawned it, and the panel then shows its ⚠ offline banner.
   Never start a second `serve`: it refuses to start and names the pid holding
   the port. If the panel reports itself offline, run `serve --detach` rather
   than assuming the stored config is empty — an offline panel deliberately
   zeroes its controls.

## Tools

| Tool | Purpose |
|---|---|
| `set_background` | Set wallpaper + Monet colors |
| `apply_options` | Tune blur/dim/monet/wallpaper visibility/framing without changing the image |
| `refresh_theme` | Re-inject stored theme after a restart |
| `reset_appearance` | Remove wallpaper and overrides |
| `beautify_status` | Show stored config |

## Constraints

- ZCode must be running (or startable) with `--remote-debugging-port=9222`.
- Themes live in CDP sessions: they are wiped when ZCode restarts. Watch mode
  makes re-injection automatic.
- Functional colors (success/warning/destructive) are intentionally preserved.
