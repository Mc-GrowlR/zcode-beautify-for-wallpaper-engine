# CHANGES.md — 动态壁纸（Wallpaper Engine 场景 / 视频壁纸）支持

> 基于 fork 上游 0.2.1（27d8699）。所有改动均为增量，静态壁纸原有链路保持不变。
> 0.3.0：场景壁纸 + 视频壁纸（.mp4/.webm 直接导入）+ 循环冻结看门狗 + ZCode 启动自动拉起 serve。
> 0.4.0：定时播放（多方案轮播）、WE 壁纸库浏览器、导入管线稳定性大修、面板三标签与界面遮罩（见下）。
> 0.4.1：移植上游 0.3.3 启动项修复器（launchers.ts）——注册表处理器、递归扫描、dry-run（见下）。
> 0.4.2：聊天气泡样式（聊天气泡预设/染色/圆角/宽度/对齐）。
> 0.4.3：气泡样式编辑器 + 我的样式库 + 预览修复（sandbox=allow-same-origin）。
> 0.4.4：`/bubble` 指令——自然语言增改气泡样式；MCP 开放自定义 CSS。

## 0.4.4

> 气泡样式对话化：一句描述即可增改，不再需要打开面板编辑器。

- **新指令 `commands/bubble.md`（`/bubble [描述]`）**：agent 读取当前 `bubbleLook`，把描述映射为预设/圆角/宽度/对齐/染色强度；超出预设能表达的部分（指定颜色、渐变、阴影、边框等）写成 `.zb-bubble`/`.zb-bubble-row` 契约的自定义 CSS 再应用。
- **MCP `apply_options.bubble` 开放 `custom` 预设与 `custom_css` 字段**（≤8000 字符，沿用核心层既有 sanitize → 选择器重写管线）。
- **气泡字段改为合并语义**：`session.baseConfig` 把部分气泡补丁并入已存 look，只传想改的字段（此前省略字段会重置回默认值）。
- McpServer 的 version 改由 `src/version.ts` 单一来源（此前硬编码 0.4.1）。
- **测试**：`t14-bubble-merge.ts`——baseConfig 合并语义（单字段补丁不重置其余）、MCP `apply_options` 接线（只转发已传字段/custom 预设/8000 上限/version 单一来源）、`/bubble` 指令与打包清单契约、marketplace.json 版本同步（本次即抓到它停在 0.4.1 的偏差）；并入 `npm test`。

## 0.4.2

> 会话中**用户发出的消息气泡**可自定义外观；默认预设零注入，与原生完全一致。

- **新配置 `bubbleLook`**（`preset/tint/radius/width/align`）：五个预设——`accent` 主题色染色、`glass` 毛玻璃+背景模糊、`outline` 透明底描边、`flat` 扁平无边框、`default` 原生（移除全部规则）。颜色全部 `color-mix` 引用实时 `--color-*` token，Monet 换主题自动跟随，零硬编码。
- **选择器**：`[data-v4-user-input-bubble]`（v4 专属属性，不依赖 Tailwind 类名哈希）+ `[class~="group/user-row"]`（对齐镜像 2px 尾角）。长消息 120px 折叠等交互行为不动。
- **快路径**：气泡规则独立 style 元素 + `--zb-bubble-*` 变量，预设/滑杆调整不重播壁纸切换动画（与 chatLook 同构的 bubbleKey 比对）。
- **入口**：面板设置新增「聊天气泡」分区（预设下拉 + 染色/圆角/宽度滑杆 + 左右对齐，内联变量实时预览）；MCP `apply_options` 新增 `bubble` 对象字段；serve `/api/config` 接受 `bubbleLook`（sanitize 归一化）。
- **健壮性**：`injectIntoTarget` 现在检查 bootstrap 的 `exceptionDetails`（此前渲染进程抛错会被静默吞掉、applyToZCode 仍报成功）——本次开发中快路径读到未初始化变量的 bug 正是被它掩盖。`buildResetScript` 清理气泡样式元素与 bubbleKey。
- **测试**：`t8-verify-bubble.ts`（静态断言：归一化/payload/bootstrap 规则与快路径/面板/重置）+ `t9-live-bubble.ts`（对运行中 ZCode 实测：挂载/computed/染色生效断言/仅改染色不重建壁纸层/左对齐镜像/还原无残留）。
- **待发送队列**：队列卡片（`[data-testid="v4-queue"]`）底部 28px 空条与输入框顶部圆角重叠；半透明输入框会把整条透成黑带，直接裁掉又会断开两卡片。改为三层 mask——底部整条裁切 + 左右两个 16px 径向补片，只保留输入框两个上圆角外侧的角缺口：队列像卡套一样包住圆角，既无黑带也无断口。圆角/重叠量以 `--zb-queue-radius`、`--zb-queue-overlap` 暴露，便于 ZCode 改版后调整。

## 0.4.1

> 移植上游 Logocceai/zcode-beautify 0.3.3（4099c2d）的 launcher repair，替换并删除 fork 自有的 `src/core/shortcuts.ts`。合并两者之长：

- **新增 `src/core/launchers.ts`**：单个 PowerShell 脚本完成全部扫描与修复（原来每个快捷方式起一个进程）。
  - 覆盖面扩大：任意深度递归扫描；按 `.lnk` **目标**匹配 ZCode.exe（改名/中文命名不再漏）；新增 **HKCU 注册表启动项**修复——`zcode://` 协议处理器与资源管理器右键菜单（Directory/Drive 的 `ZCode.OpenInZCode`），插入位置在 exe 之后、保留 `%1` 与引号。
  - 保留 fork 优势：**OneDrive 桌面重定向**目录照扫；MCP bootstrap **每次启动自愈**（上游仅 CDP 不可达时修；而 ZCode 更新器会重建开始菜单快捷方式且不带参数——每次自愈正好对冲）。
  - 新增 `repair-launchers [--dry-run]` CLI 子命令与 `repair_launchers` MCP 工具（结构化报告：updated / already-ok / failed+原因；机器级条目只报告不修改）。
  - PowerShell 输出强制 UTF-8，中文 Windows 报错不再乱码。
- **测试**：`test/t-launchers-verify.ts` —— 28 项检查全部沙箱化（临时目录伪装 USERPROFILE/APPDATA/PUBLIC/ProgramData/OneDrive + 一次性 HKCU 测试键），不触碰真实快捷方式与 ZCode 注册表处理器；覆盖递归/中文名/OneDrive/任务栏/公共桌面/幂等/dry-run/`%1` 保留。

## 0.4.0

> 相对 0.3.1 共 82 个提交；静态壁纸与 0.3.x 既有链路保持兼容。配套 Release 附预构建 zip。

### 定时播放（多方案轮播）

- 面板「定时播放」标签：多个命名播放方案（新建/改名/两段式删除即存）；每方案独立的模式（**顺序 / 随机不连播同张 / 每日定点**）、条目与**切换特效**（fade/slide/zoom/blur/none，方案级生效）。
- 条目引用壁纸库场景（hash）或图片（路径）；壁纸下拉带缩略图并预选当前壁纸；「启用」开关即时生效；「▶ 播放」一键保存并从第一张开始；「⏭」立即切下一张。
- 支持**恢复播放位置**（resumeIndex）与**按时段生效**（每方案时间窗口，支持跨夜）；**手动切换壁纸自动暂停轮播**，重新启用时从上次位置继续。
- API：`GET/POST /api/rotation`（坏条目静默剔除、上限 20 条、时长 ≥10s）、`POST /api/rotation-next`；serve 重启后启用中的轮播自动续播。

### Wallpaper Engine 壁纸库浏览器

- 面板内浏览本机 WE 壁纸：创意工坊（`steamapps/workshop/content/431960`）与自建项目（`myprojects`），多 Steam 库扫描（含注册表 SteamPath）；**类型 / 文件夹两种视图**（文件夹视图与 WE 内部分组一致：root 只显示文件夹卡、进入后平铺、← 返回）、3 列网格、搜索、**多选批量导入**（串行队列 + 进度）、已导入角标、显示 WE 真实标题。
- 悬停预览按"各自素材优先"取最佳活媒介：视频壁纸播自己的源片；场景按需**真渲染预览**（640×360 小样，永久缓存）；其余显示 WE 自带预览图/封面；预览按自然比例定位、不越出视口。

### 导入管线（稳定性大修）

- **根因修复**：传给 WE 的必须是 `.pkg` **文件**而非壁纸目录（本机 WE 对目录输入永久黑窗）——管线自动解析并传文件。
- **黑帧门禁**：发布前检测成片亮度，黑帧永不入库（删临时件 + 明确报错）；黑帧自动重试/重开窗，最多三轮；开窗前还有窗口预检。
- **后台录制**：PrintWindow 客户区捕获（`PW_CLIENTONLY|PW_RENDERFULLCONTENT`）——渲染窗口沉底、被 ZCode 完全遮挡也能录到正确画面；帧序列 BMP→PNG（体积 ~1/10）；无任何置顶/z-order 技巧；不重启 WE 核心；settle 8s。
- 批量导入显示"第 i/N 个"；新增**录制分辨率**设置（跟随壁纸 / 1080p / 720p / 自定义）。
- 导入不再触碰用户的 WE 界面：检测到 UI 开启时明确报错并指引先关闭。
- **修复中文路径导入失败**（面板文件对话框强制 UTF-8 输出，ACP-936 系统）；`POST /api/import-scene` 支持 `maxSeconds`(5..60) 规避低内存机器 60s 循环 OOM；`/api/config` 暴露 `wallpaperPath`（仅 image 模式）供面板预选当前壁纸。

### 面板与外观

- 三标签页（**壁纸 / 定时播放 / 设置**）+ 卡片化布局；每卡独立折叠并记忆；悬停大图预览；缩略图壁纸选择器（每组独立 5 行滚动窗）；定时播放列表滚动窗。
- 设置页：显示调节（模糊 / 压暗 / 取景 cover·contain·smart / 图片缓动 Ken Burns）、**聊天界面分区遮罩**（整体压暗 / 上下端渐变蒙版 / 白纱）、昼夜护眼、显示壁纸开关、每库显示行数（3-20）、录制分辨率、配置导出/导入、最近使用 + 历史记录（20 条）。
- 启动画面选项（等 ZCode 启动完成再显示壁纸）；**ZCode 更新窗口默认保持原样**，可在设置中改为"更新界面显示壁纸"（无面板）。

### 稳定性与安全

- 控制 API 与媒体端点 **token 鉴权**（每次启动随机 token，媒体走 `?t=`）；配置**原子写入**（磁盘满不损坏旧配置）；所有子进程 `windowsHide`；导入可取消（AbortController）；并发导入唯一临时名；场景缓存 LRU 10GB。
- **切换黑闪修复**（视频合成器黑块 / 缩略图闪烁）；**8K 图片切换 5s → 13ms**（ffmpeg 预生成取色缩略图 + `/media/lib` URL 缓存 + 素材 LRU）。
- 特效偶发"像直接切换"修复：`launch` 自动禁用 Chromium 遮挡判定；媒体流错误不再崩 serve。

## 0.3.1

- **快捷方式 CDP 标志自动持久化**：新增 `src/core/shortcuts.ts`，扫描桌面（含一层子文件夹、OneDrive 重定向）、用户/全局开始菜单、任务栏固定区的 `ZCode*.lnk`，自动补 `--remote-debugging-port`；接入 `launch` 命令与 MCP bootstrap（每次 ZCode 启动自愈）。上游同名提交只有文档，此为实现。
- **serve 数据目录统一**：MCP 启动的 serve 不再继承插件级 `ZCODE_BEAUTIFY_DATA_DIR`（`<plugin>@<marketplace>` 目录），手动/自动启动共用默认数据目录——修复"重启后面板壁纸库为空"。
- **壁纸库重命名/删除**：场景条目改名存 `name.json` 附属文件（不影响缓存身份），两段式删除，正在使用的条目拒绝删除；库列表不再按 `wallpaper*` 前缀过滤（修复"重命名后图片消失"）。
- **子进程不再弹终端窗**：统一 `windowsHide`（`src/core/exec.ts` 共享 helper，替换 5 处重复包装器）。

## 功能概述

- 支持导入 Wallpaper Engine **场景壁纸**（`.pkg` 或含 `project.json` 的工坊目录）：
  WE 专属窗口渲染 → ffmpeg ddagrab 录制 → 交叉淡化无缝循环 → 本地缓存 → 注入 `<video>` 动态背景。
- 静态图片壁纸流程、面板、CLI、MCP 行为不变；场景壁纸复用同一注入层（增量字段）。

## 新增模块（src/core/）

| 文件 | 职责 |
|---|---|
| `wallpaperType.ts` | 输入类型检测（image/scene/video/web/unknown），覆盖真实工坊目录的多种 project.json 布局（含无 type/file 字段、资产在 files/ 子目录的情况） |
| `dependencyCheck.ts` | WE 检测（运行进程 → 注册表 → libraryfolders.vdf → 多盘扫描 → PATH）；ffmpeg 检测（PATH 或 `ZCODE_BEAUTIFY_FFMPEG` 环境变量覆盖，版本 ≥5.0 校验，ddagrab 需要）；安装引导文案 |
| `weLauncher.ts` | WE 专属窗口开关：`-control openWallpaper -playInWindow`；窗口等待/定位（EnumWindows 精确匹配 + SetWindowPos，实测客户区）；关闭走 `-control closeWallpaper`（spawn 句柄不可靠，仅诊断用） |
| `recorder.ts` | ddagrab 捕获（置顶窗口 → `hwdownload,format=bgra → crop → scale` → libx264）；blackdetect/signalstats 黑屏自检 |
| `loopProcessor.ts` | 无缝循环：`crossfade(尾部淡出, 开头淡入) ++ 主体` 构造，首尾帧严格相等（SSIM 实测 0.999996）；`-movflags +faststart -an` |
| `cacheManager.ts` | 内容寻址缓存（MD5 of 内容/清单 + opts），`~/.zcode/cli/plugins/data/zcode-beautify/scenes/<hash>/loop.mp4`；LRU（mtime 记账，NTFS atime 默认禁用不可依赖）10GB 上限 |
| `media.ts` | serve 模式媒体端点实现（HTTP Range 206，全区间/后缀/开区间） |
| `scenePipeline.ts` | 端到端流水线 importScene()：detect → deps → cache → open → record → loop → poster → save → LRU；每步 onProgress |

## 修改文件

- `src/core/cdp.ts`：`InjectionPayload` 新增 `videoSrc`；bootstrap 脚本支持 `<video>` 层（autoplay/loop/muted/playsinline，`document.hidden` 暂停/恢复，视频跳过 localStorage 持久化）；reset 清理 video 状态。**图片路径行为不变。**
- `src/core/inject.ts`：`BeautifyConfig` 新增 `sceneVideoUrl / mediaType / sceneHash / apiPort`；`buildPayload` 支持 video 源；新增 `buildInjectScript` 便捷封装。
- `src/core/session.ts`：`applyWallpaper` 自动识别场景输入并路由到新 `applySceneWallpaper`；`buildPayloadFromConfig` 视频分支（Monet 取色来自 poster.jpg，视频走 http 流）。图片应用逻辑等价重构（baseConfig 提取）。
- `src/core/scenePipeline.ts`：`resolveSceneInput` 接受 `.pkg`、壁纸目录、或目录内任意文件（文件对话框场景下向上查找 project.json）。
- `src/core/server.ts`：新增 `POST /api/pick-scene`（原生文件对话框，供面板「选择并导入」使用）、`POST /api/import-scene`（后台任务）、`GET /api/import-status`、`GET /api/library`（image/scene 分组）、`POST /api/apply-wallpaper`（按 hash 或 path）、`GET /media/scene/<hash>.mp4`（Range）；注入会话透传 videoSrc。
- `src/panel/panelScript.ts`：新增场景导入（「选择并导入…」按钮调起原生文件选择器 + 路径输入 + 进度条 + 失败依赖引导「已安装，重试」）、壁纸库分组列表。原有滑杆/开关不变。
- `src/cli.ts`：新增 `apply-scene` 子命令。
- `src/mcp/server.ts`：新增 `import_scene_wallpaper` 工具；`set_background` 自动识别场景输入；导出 `TOOL_NAMES` 注册表。
- `commands/beautify.md`：支持「导入场景壁纸」意图与依赖引导说明。
- `package.json`：devDependencies 增加 `tsx`（验证脚本运行器；构建产物不含）。

## 关键技术事实（详见 docs/spike-notes.md）

- crop 必须在 `hwdownload` 之后（d3d11 帧上 crop 被静默忽略）。
- ddagrab 抓合成屏幕：录制期间必须把 WE 窗口置顶。
- WE `-playInWindow` 窗口标题=参数值，但窗口归属已运行实例，关闭必须走控制命令。
- 原任务包的淡化滤镜链会丢弃 overlay 帧（overlay 随主输入结束），已替换为数学上首尾相等的构造。
- 渲染器 video 走 http://127.0.0.1 流（file:/// 不可靠、data URI 超配额）。

## 回滚方式

- 单文件独立，`git revert` 或按上表删除新增文件、还原修改文件即可。
- 缓存数据在 `~/.zcode/cli/plugins/data/zcode-beautify/scenes/`，删除该目录即完全清除动态壁纸缓存。
- 新增配置字段（mediaType/sceneHash/apiPort/sceneVideoUrl）均为可选，旧配置文件无需迁移。

## 验证

各任务验证脚本位于 `test/t*-verify.ts`（`npx tsx test/tX-verify.ts` 运行）。
T3/T4/T8 需要本机装有 Wallpaper Engine 与 ffmpeg（或设置 `ZCODE_BEAUTIFY_FFMPEG`）。
