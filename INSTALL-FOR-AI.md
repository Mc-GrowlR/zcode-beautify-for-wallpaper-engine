# INSTALL-FOR-AI — install the ZCode beautify plugin (AI instructions)

> **You are an AI agent.** A user handed you this file (or the repository link
> <https://github.com/Logocceai/zcode-beautify>) and wants the finished plugin
> installed into **their ZCode desktop client**. Follow this document top to
> bottom. If you can run shell commands, use **Route B**; otherwise use
> **Route A** to guide the user, or **Route C** to output instructions.

## First: is this even the right package?

This repository ships **two different things**. Do not confuse them:

| | **Plugin package** (you are here) | **Skill pack** (`skill-pack/`) |
|---|---|---|
| Target | The user's **ZCode desktop client** | **Any** Electron app (other AI platforms, custom apps) |
| Your role | **Installer** — set up the ready-made plugin | **Developer** — build a similar beautify tool from scratch |
| User says | "Install this beautify plugin in my ZCode" | "Build wallpaper/color beautification for my XX app" |
| You read | `INSTALL-FOR-AI.md` (this file) | `skill-pack/SKILL.md` |
| Result | A working `/beautify` command + MCP tools in ZCode | A new local tool the user runs themselves |

If the user's goal is "just make my ZCode pretty" → continue below.
If they want to beautify a non-ZCode app or develop their own → read
`skill-pack/SKILL.md` instead and stop following this file.

## Which client are we beautifying?

Since 0.5.0 the same plugin supports **ZCode** and **WorkBuddy**. Pick the
target before running any command:

| User's client | How to target it | CDP / API port |
|---|---|---|
| ZCode | default (nothing to add) | 9222 / 9223 |
| WorkBuddy | `--target workbuddy`, or env `BEAUTIFY_TARGET=workbuddy` | 9333 / 9334 |

WorkBuddy is installed through `.codebuddy-plugin/` (its marketplace manifest
already sets `BEAUTIFY_TARGET=workbuddy`), ZCode through `.zcode-plugin/`. The
two clients can run side by side: ports, data dirs and launcher entries are
isolated. Chat-area extras (bubbles, column width, spinner icons) are
ZCode-only and are skipped automatically under WorkBuddy.

## What you are installing

`zcode-beautify` v0.5.1 — a plugin that adds a wallpaper layer +
Material Design 3 (Monet) dynamic color to the ZCode desktop client over CDP,
with a `/beautify` slash command, MCP tools (`set_background`, `apply_options`,
`refresh_theme`, `reset_appearance`, `beautify_status`), and a live settings
panel. Everything is prebuilt in `dist/` — nothing to compile.

## Route A — guide the user through the UI (no shell needed, official path)

Tell the user, step by step:

1. Open ZCode → **Settings → Plugin Management → Discover**.
2. Click **+** and add the marketplace:
   - online: paste `https://github.com/Logocceai/zcode-beautify`
   - offline: first unzip the package you were given, then add the unzipped
     folder (it contains `marketplace.json` at its root).
3. Click **Get** on the *zcode-beautify* card.
4. Continue with **"After installation"** below.

## Route B — install it yourself (you have shell access)

ZCode's plugin system stores everything under `~/.zcode/cli/plugins/`
(Windows: `C:\Users\<user>\.zcode\cli\plugins\`). You will reproduce what the
UI does: stage a marketplace copy, register it, cache the plugin, record the
installation.

Work with **JSON-aware tooling** (Node, Python, jq) — never regex-edit or
rewrite these files blindly; always read → merge → write back preserving
everything else.

1. **Get the files.**
   ```bash
   git clone https://github.com/Logocceai/zcode-beautify.git
   ```
   No git? Download `https://github.com/Logocceai/zcode-beautify/archive/refs/heads/main.zip`
   and unzip. Keep the resulting folder in a stable location (e.g. the user's
   home directory) — ZCode re-reads it on marketplace refresh.

2. **Stage the marketplace copy** (what the UI does on "+"):
   ```text
   from: <clone>/                      (marketplace.json at its root)
   to:   ~/.zcode/cli/plugins/marketplaces/zcode-beautify/
   ```

3. **Register the marketplace** in `~/.zcode/cli/plugins/known_marketplaces.json`
   (create the file if missing — shape: `{ "version": 1, "marketplaces": [] }`).
   Append one entry, mirroring the real structure:
   ```json
   {
     "id": "zcode-beautify",
     "source": { "source": "directory", "path": "<the stable clone folder from step 1>" },
     "name": "zcode-beautify",
     "description": "Wallpaper + Material Design 3 (Monet) dynamic color for the ZCode desktop client.",
     "addedAt": "<now, ISO-8601>",
     "pluginCount": 1,
     "lastUpdated": "<now, ISO-8601>"
   }
   ```
   `pluginCount` must match the number of entries in `marketplace.json`.

4. **Cache the plugin** (what the UI does on "Get"):
   ```text
   from: <clone>/                      (or the staged marketplace copy)
   to:   ~/.zcode/cli/plugins/cache/zcode-beautify/zcode-beautify/<version>/
   ```
   Read the exact version from `.zcode-plugin/plugin.json` — the folder name
   must equal it.

5. **Record the installation** in `~/.zcode/cli/plugins/installed_plugins.json`.

   **Use the bundled writer — do not hand-edit this file:**
   ```bash
   node scripts/record-install.mjs --dry-run   # show + validate the record, write nothing
   node scripts/record-install.mjs             # back up, merge, validate, write atomically
   ```
   It reads `marketplace.json` and `.zcode-plugin/plugin.json` for the
   marketplace/name/version, points `installPath` at
   `<plugins>/cache/<marketplace>/<name>/<version>`, keeps the other records and
   any existing `installedAt`, and refuses to save a record whose `installPath`
   is relative, missing, or contains a NUL byte. The file only exists after a
   first marketplace install; the script creates `{ "version": 1, "plugins": [] }`
   when it does not.

   If you must write it yourself, the record is:
   ```json
   {
     "id": "zcode-beautify@zcode-beautify",
     "name": "zcode-beautify",
     "marketplace": "zcode-beautify",
     "version": "0.4.6",
     "installPath": "<the cache folder from step 4>",
     "installedAt": "<now, ISO-8601>",
     "updatedAt": "<now, ISO-8601>",
     "scope": "user",
     "source": { "source": "directory", "path": "<the stable clone folder from step 1>" }
   }
   ```
   **`installPath` must come out of a JSON serializer** (`JSON.stringify`,
   `json.dump`, `jq --arg`, `ConvertTo-Json`) — never splice a Windows path into
   a string or template literal. `C:\Users\...\0.4.6` typed inside a JS string
   literal becomes `C:Users...<NUL>.4.6`; see the caveat below for the damage
   that does.

   Then validate (this is the step that catches a mangled path before the user
   restarts ZCode):
   ```bash
   node scripts/record-install.mjs --verify   # exit 1 + the offending record on any fatal problem
   ```

6. **Tell the user to fully restart ZCode** so the plugin loads, then continue
   with **"After installation"**.

**Known caveats for Route B** (undocumented internal format — verify as you go):

- If the clone folder from step 1 is later deleted, marketplace *refresh* may
  log a `lastRefreshFailure` (an `EPERM`/rename error). Already-installed
  plugins keep working; re-clone to the same path to clear it.
- **One corrupted record breaks the whole plugin system.** A hand-written
  `installPath` that lost its separators (and picked up a NUL from `\0.4.6`) is
  still valid JSON, so nothing complains at write time — but ZCode derives
  `<installPath>.transaction.json` and every plugin RPC then throws
  `The argument 'path' must be a string, Uint8Array, or URL without null bytes`.
  Symptoms: the plugin list shows **已安装 0 / no plugins installed** (even for
  plugins whose own records are fine), and every new chat shows
  **初始化失败，暂时无法发送** with a retry button. Diagnose and repair with
  `node scripts/record-install.mjs --verify` (non-zero exit + the offending
  record) and `node scripts/record-install.mjs` (rewrites `installPath` through a
  JSON round-trip, backing up the old file), then fully restart ZCode. A record
  whose directory is simply missing only costs that one plugin, and `--verify`
  reports it as a warning.
- If ZCode's plugin files look different from this document (newer versions may
  change the schema), stop and fall back to **Route A** — never guess.

## After installation (both routes)

1. The plugin contributes the `/beautify` command and MCP tools
   (`set_background`, `apply_options`, `refresh_theme`, `reset_appearance`,
   `beautify_status`).
2. The wallpaper needs CDP: the ZCode desktop client must be started with
   `--remote-debugging-port=9222`. Instruct the user to fully quit ZCode, then
   run `node <plugin-dir>/dist/cli.js launch` (the plugin dir is the cache
   folder above; requires Node.js ≥ 20). Alternatively suggest editing the
   ZCode shortcut to append the flag.
3. **Make CDP survive restarts — do not skip this.** The injected theme lives
   in CDP sessions: the moment the user restarts ZCode without the debug port,
   beautification is gone and they will report "the plugin stopped working".
   Fix it at the source by persisting the flag into the app's shortcuts:
   - Locate the app's shortcuts (Desktop, `Start Menu\Programs` for the user
     and, if present, the all-users one under `C:\ProgramData\...`) and append
     ` --remote-debugging-port=9222` to the target's arguments
     (WScript.Shell on Windows: read the `.lnk`, set `Arguments`, `Save()`).
     The all-users Start Menu needs elevation — a user-level shortcut on the
     Desktop covers the common case without admin rights.
   - Warn the user: one full restart of ZCode with the flag is still required
     once (quit completely, start via the updated shortcut).
4. Then: `/beautify <path-to-an-image>` or `node <plugin-dir>/dist/cli.js apply
   "image.jpg" --blur 6 --dim 30 --fit smart`, and
   `node <plugin-dir>/dist/cli.js serve --detach` for the live settings panel.
   Always pass `--detach`: it backgrounds the service so the panel keeps working
   after the shell (or the agent session) that started it goes away. A
   foreground `serve` is reaped with its parent, and the panel then reports
   itself offline. Start it once — a second `serve` refuses to start and prints
   the pid that already owns the port.
5. Verify: CDP reachable (`node <plugin-dir>/dist/cli.js status`), wallpaper
   visible, `/beautify` available in a new conversation.

## Uninstall (if the user asks)

- Remove the `zcode-beautify` entry from `installed_plugins.json`, delete
  `cache/zcode-beautify/`, and (only if the user wants the marketplace gone)
  the `known_marketplaces.json` entry plus `marketplaces/zcode-beautify/`.
- Theme remnants in a running ZCode disappear on restart; the plugin never
  modified ZCode's own files.
