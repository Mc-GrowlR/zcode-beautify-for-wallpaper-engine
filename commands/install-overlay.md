---
description: 安装或修复 ZCode 启动自启 overlay（修改 app.asar；完全退出并重开 ZCode 后生效）
argument-hint: "[无需参数；可附加说明]"
---

# 安装启动 overlay（install-overlay）

用户希望让 zcode-beautify 在 **ZCode 每次启动时自动加载**：打开 CDP 调试端口并拉起
beautify serve，不依赖插件管理器的 enabledPlugins、也不依赖快捷方式里的
`--remote-debugging-port` 参数。典型场景是 **ZCode 更新之后插件设置被清除 / 快捷方式被
重建，壁纸和面板不再出现**。$ARGUMENTS

## 执行

用 Bash 运行（插件根目录 = 本命令文件所在目录的上一级，即 `commands/` 的父目录）：

    node "<插件根目录>/dist/cli.js" overlay install

Windows 路径含空格时必须保留双引号。安装器会修改 ZCode 的 `resources/app.asar`
主入口（尾部追加一行动态 import），这是有意的修改，不是只读操作。

## 安装器做什么

- 把 `overlay-loader.cjs` 复制到稳定运行目录（`~/.zcode/cli/plugins/data/zcode-beautify/overlay/`），
  并在 app.asar 主入口尾部写入指向它的动态 import 行。
- loader 在 Electron 主进程 `app.ready` 之前运行：强制打开 CDP 端口（默认 9222，已存在
  其它端口时不抢占），并探测/拉起 `serve`，之后由 serve 负责壁纸、主题和设置面板。
- 同时记录实验性 CDP 注入的同意、修复启动项（`--no-enable` 可跳过）。
- 插件管理器里显式停用插件时 loader 不会启动 serve；配置被清除（没有 enabledPlugins
  条目）时按"未禁用"处理，这正是本功能要覆盖的情况。
- 用户之前安装过 overlay 时，ZCode 更新覆盖 app.asar 后，MCP 启动会**自动补丁**
  （后台完成）；本命令用于首次安装或需要立即修复时。
- `/uninstall-overlay` 会写 `.plugin-overlay-optout`，阻止 loader 和自动补丁，直到下次
  显式执行本命令。

## ZCode 运行中（正常情况）

安装命令本身通常就在 ZCode 会话里运行，Windows 会锁定 app.asar。此时安装器把补丁暂存为
`app.asar.beautify.tmp`，并启动一个后台 monitor；**完全退出 ZCode（含托盘图标）后自动
替换**。输出里出现 `staged` / “已暂存”是预期行为，不是失败。

## 结果处理

- **staged / pending**：告知用户「必须完全退出 ZCode（托盘退出），补丁会在退出后自动
  应用；重新打开即生效」。不要重复运行，也不要声称已经生效。
- **installed / already installed**：告知用户完全退出并重开 ZCode 以加载新入口。
- 只关窗口、刷新页面、重开会话都**不会**加载新的 app.asar。
- **失败、权限不足（Program Files 等受保护位置，Errno 13 / EPERM）**：原样转述输出；
  需要以管理员身份重跑同一条命令。不要仅凭退出码 0 宣称成功——以 `overlay status`
  的 `injected: true` / `current: true` 为准。
- 安装后可用以下命令核对：

      node "<插件根目录>/dist/cli.js" overlay status

  期望：`startup overlay: installed (loader line points at this install)`、`opt-out: no`。
  若显示 `pending`，说明还在等 ZCode 完全退出。

## 卸载

`/uninstall-overlay`（剥离 loader 行、写 opt-out、停止 serve 并恢复默认外观）。
