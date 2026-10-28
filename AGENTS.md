# AGENTS.md — start here

This repository is two things at once. Pick your path by what the user asked for:

| The user asked to… | Read | What you'll do |
|---|---|---|
| **install the beautify plugin into their ZCode** (e.g. "帮我安装美化插件", "install this into my ZCode", "make my ZCode pretty") | [INSTALL-FOR-AI.md](INSTALL-FOR-AI.md) | Guide them through the marketplace UI (30 s), or install it end-to-end yourself if you have shell access, then launch ZCode with the debug port and apply a wallpaper |
| **beautify some other Electron desktop app** (e.g. "给这个 Electron 应用加壁纸和动态配色", "build a theme tool for app X") | [skill-pack/SKILL.md](skill-pack/SKILL.md) | Build a small local tool from the skill: CDP launch + inject, MD3 color extraction, wallpaper layer, optional live-tuning API |

## One-line facts

- Repo: `https://github.com/Logocceai/zcode-beautify` — plugin manifest at the root (`marketplace.json` + `.zcode-plugin/plugin.json`), so the repo itself is a single-plugin marketplace.
- The plugin beautifies the **ZCode desktop client** via CDP injection (`dist/cli.js`, prebuilt, zero install steps). It never modifies app files.
- `skill-pack/` is platform-agnostic (any Electron app, any AI agent) and versioned together with the plugin.

## Rules of thumb

- The end user is non-technical by default: prefer the marketplace-UI path from `INSTALL-FOR-AI.md` unless they explicitly asked you to do it for them and you have shell access.
- Never modify ZCode's installation files; everything is user-level (`~/.zcode/...`) or runtime injection.
- CDP injection requires the app to run with `--remote-debugging-port`. The bundled `launch` command handles that safely (it refuses to race the single-instance lock).
- Route B's last step writes ZCode's plugin registry (`~/.zcode/cli/plugins/installed_plugins.json`). Run `node scripts/record-install.mjs` — it validates `installPath`, backs the old file up and writes atomically. Never splice a Windows path into JSON by hand: a single NUL byte in one record makes ZCode show **zero plugins** and fail every new chat session with **初始化失败，暂时无法发送**.
