---
description: 卸载 ZCode 启动自启 overlay（恢复默认外观；完全退出并重开 ZCode 后生效）
argument-hint: "[无需参数；可附加说明]"
---

# 卸载启动 overlay（uninstall-overlay）

用户希望移除由 `/install-overlay` 写入 ZCode `resources/app.asar` 的自启 loader，并让
zcode-beautify 回到默认外观。$ARGUMENTS

## 执行

用 Bash 运行（插件根目录 = 本命令文件所在目录的上一级）：

    node "<插件根目录>/dist/cli.js" overlay remove

## 卸载器做什么

1. 先写 `.plugin-overlay-optout` 豁免标记：loader 从下一次启动起不再做任何事，自动补丁
   也不会再把 overlay 装回来（直到用户再次显式执行 `/install-overlay`）。
2. 从 app.asar 主入口剥离 beautify 的 loader 行（只剥离本插件自己的行，不恢复备份、不
   影响其它插件）。
3. 停止 serve、清除已注入的壁纸/面板（含渲染器缓存），关闭实验性 CDP gate，并从启动项
   剥离 `--remote-debugging-port`。只想卸 overlay、保留 gate 时加 `--keep-experimental`。
4. 壁纸/气泡等个人设置保留；以后再次 `/install-overlay` 会恢复同一套外观。

## ZCode 运行中

与安装相同：Windows 锁定 app.asar 时，剥离后的副本先暂存为 `app.asar.beautify.tmp`，
后台 monitor 在 ZCode **完全退出**后自动替换。输出 `staged` 是预期，不是失败。

## 结果处理

- **staged**：告知用户完全退出 ZCode（托盘退出），替换会自动完成；重新打开后浮层/壁纸
  不再出现。opt-out 已立即生效，即使还没替换，下次启动 loader 也不会动作。
- **stripped / already clean**：告知用户完全退出并重开 ZCode 完成收尾。
- **失败 / 权限不足**：原样转述输出；受保护安装目录需要管理员身份重跑。
- 核对状态：

      node "<插件根目录>/dist/cli.js" overlay status

  期望：`not installed`（或 pending 消失后 `injected: false`）、`opt-out: yes`。
- 这是卸载 overlay 的路径；若用户只是想让插件管理器停用插件，不要执行本命令。
