# CHANGES.md — 动态壁纸（Wallpaper Engine 场景 / 视频壁纸）支持

> 基于 fork 上游 0.2.1（27d8699）。所有改动均为增量，静态壁纸原有链路保持不变。
> 0.3.0：场景壁纸 + 视频壁纸（.mp4/.webm 直接导入）+ 循环冻结看门狗 + ZCode 启动自动拉起 serve。
> 0.4.0：定时播放（多方案轮播）、WE 壁纸库浏览器、导入管线稳定性大修、面板三标签与界面遮罩（见下）。
> 0.4.1：移植上游 0.3.3 启动项修复器（launchers.ts）——注册表处理器、递归扫描、dry-run（见下）。
> 0.4.2：聊天气泡样式（聊天气泡预设/染色/圆角/宽度/对齐）。
> 0.4.3：气泡样式编辑器 + 我的样式库 + 预览修复（sandbox=allow-same-origin）。
> 0.4.4：`/bubble` 指令——自然语言增改气泡样式；MCP 开放自定义 CSS。
> 0.4.5：消息流宽度——聊天区可调对话列宽（档位/自定义），公式化注入保持随窗口缩放。
> 0.4.6：自定义宽度改按钮模式（修复编辑器被 4s 心跳自动收起）+ 新增三档窄宽度 + 安装记录写入器（防 Windows 路径转义事故）。
> 0.4.7：大会话流畅模式——消息行屏外跳过渲染（content-visibility），大上下文会话打开与滚动更省。
> 0.4.8：运行中图标——会话列表左侧"正在对话"转圈标志可换为图片 / GIF 动图；侧边栏压暗——左侧会话栏可单独加深；关于页检查更新——对照 GitHub Releases 一键查询新版本。
> 0.4.9：耗时秒数去小数——对话下方"工作中"耗时的秒数不再显示小数位（53.4 秒 → 53 秒）；作者信息改为 fork 维护者 Mc-GrowlR（关于页/插件元数据，上游溯源保留）。
> 0.5.1：两侧拖拽调宽——对话列左右边缘的隐形竖条，悬停现形、拖动调宽（参考 DeepSeek 聊天页的拖拽边条交互）。

## 0.5.1 — 两侧拖拽调宽

> 参考 DeepSeek 聊天页的拖拽边条：对话列左右边缘各有一条隐形竖条，平时完全不可见，鼠标靠近时浮现一条 3px 主题色竖线（`col-resize` 光标），拖动即对称加宽/收窄中间对话列。

- **新配置 `chatLook.dragResize`（两侧拖拽调宽，默认 0=关）**：开启后 bootstrap 挂载两条 9px 定宽命中条（`position:fixed`，`z-index:40`，位于 Tailwind z-50 弹层之下），贴住对话列实时矩形左右边缘——列的位置由「输入框第一个高滚动祖先」+ 对话列类名定位（与 markChatCol 同规则），rAF 合流的 MutationObserver + 滚动容器 ResizeObserver + window resize 三路跟踪，路由切换/侧边栏开合/流式输出期间都保持贴合；非聊天路由（设置页等）自动隐藏。
- **拖拽即公式，不定值**：拖动写两个 px 变量——`--zb-chat-w`（拖拽上限）与 `--zb-chat-inset`（引擎按 `max(16px, 容器内容宽 − W)` 实时派生的两侧留白），注入的两档规则读它们：`max-width:var(--zb-chat-w,档位上限)` + `width:calc(100% - var(--zb-chat-inset,档位留白))`。留白必须随拖拽收窄：固定 24rem 留白会把 1920 窗口的列宽死顶在 `100% − 384px`，拖过去就是死区（实测发现后改为派生）。`calc(100% − inset)` 保留 ZCode 原生的窗口跟随机制（定值宽度缩小窗口必溢出，见 0.4.5 结论），派生留白 ≥16px 保证宽度永不为负；竖条位置每帧从真实 `getBoundingClientRect` 重取，与公式解耦。
- **未拖拽 = 零视觉变化**：两档 fallback 复刻原生（56rem/6rem、72rem/24rem）或当前档位（cap>0 时），开启开关后不拖拽就与原生/档位完全一致；中档规则在前、宽档在后（同特异性后者胜），元素同时携带两个类名时宽档正确接管。
- **持久化与复位（占比机制，参考 DeepSeek 的宽度记忆）**：拖拽宽度按**容器占比**（percent，0-100）存 `localStorage['zcode-beautify:chat-drag-pct']`，每次 sync 从实时容器内容宽重新派生 px——**窗口最大化/还原（以及侧边栏开合、任何容器尺寸变化）时列宽等比缩放跟随**，而不是钉死一个绝对宽度（旧 rem 方案的问题：还原后被顶满、最大化后又显得窄）。**双击竖条**清除占比回档位设置；拖动中 **Esc** 取消本次拖动；拖动对称增宽（1px 指针位移 = 2px 列宽，8px 量化步进），下限 460px，上限 = 容器内容宽 − 16px（两侧各留 16px 呼吸位）；旧 rem key（chat-drag-w）挂载时自动清除。
- **面板**：「聊天」页「聊天区」新增"两侧拖拽调宽"开关（zb-chat-drag），与流畅模式同款 pushChatLook 链路；MCP `apply_options` 新增 `chat_drag_resize` 布尔参数（部分补丁语义）。
- **拖拽性能（用户实测卡顿后修复）**：① 对话列自带 `transition-[width,max-width] duration-150`——每个宽度步都触发 150ms 动画重排、布局永不收敛，拖拽期间（html.zb-grip-active）强制 `transition:none`；② 宽度更新按 8px 指针量化（列宽 16px/步）——动态高度虚拟列表对每次宽度变化全量重测，连续 1px 更新等于每秒 60 次全量重排；③ 拖拽中竖条改**解析式贴边**（拖拽起点列矩形 + 已应用宽度直接推算边缘，零 getBoundingClientRect 强制布局），文档级 MO/RO 在拖拽期间静默（拖拽路径自持定位，回灌风暴全部跳过）；④ 移除拖拽期 `*{cursor:col-resize!important}` 全元素选择器。
- **注入引擎健壮性（实机调试发现）**：① `Page.addScriptToEvaluateOnNewDocument` 每次注入**累积注册且无法反注册**，页面一重载所有历史版本 bootstrap 依次重跑——最老版本先挂载竖条并绑定旧事件代码，后续版本见 id 已存在就跳过。竖条带 `data-zb-ver` 版本标记（GRIP_VER），最新引擎发现旧版竖条即强制重挂重绑；② Chromium 对被遮挡窗口把 rAF 节流到 0——挂载后的首次定位必须同步执行，不能只靠 rAF 合流；③ 竖条位置缓存（gripPos）必须随竖条销毁一起清空，否则重挂载后"已写过"的缓存会永久压制样式写入。
- **输入框塌缩修复（用户实测：拖动时输入框缩成 ~40px 竖条）**：根因是宽度变量被写入 `NaNpx`（多代引擎共享 `window.__zcodeBeautify` 状态、旧代观察器存活所致）——`width:calc(100% - var(--zb-chat-inset))` 遇非法 var 整条声明在计算值阶段失效退回 auto：消息列父容器是块级（auto=撑满，无症状），而**输入框 holder 的父容器是 `flex justify-center` 行（auto=按 min-content 收缩）**，于是只有输入框塌缩。四层防御：`zbGripApply` 硬门禁（非有限 px/NaN contentW 一律拒写）；每次 sync 自愈（存量非有限 var 直接移除）；GRIP_VER 重挂时**全量清场**（zbGripClean 断开旧代观察器/resize 监听/卡死的 drag 状态——卡死的 drag 会永久静默观察器并卡住变量）；pointerdown 先取消残留 drag；外加拖拽期 `min-width:460px` 字面量地板（任何垃圾值都无法再塌缩输入框）。
- 测试：t24（normalize 钳制、payload 透传、jsdom 跑真实 bootstrap：挂载/卸载与变量清理、拖拽档位 fallback 复刻档位公式、双击复位、全部关掉时整体退场）；t25 实机 E2E（走真实 /api/config：挂载贴合、合成指针拖拽、近全宽死区验证、Esc 取消、双击复位、面板开关回显、开关卸载）。

## 0.5.0 — 双客户端：WorkBuddy 支持

> 同一套注入引擎现在可以美化 **ZCode** 与 **WorkBuddy** 两个桌面客户端。目标由 `--target` 或 `BEAUTIFY_TARGET` 选择，默认仍是 ZCode（老安装零改动）。

- **目标抽象层 `src/core/target.ts`**：把"哪个客户端"收敛成一份 profile——可执行文件探测（环境变量 → 常规安装路径 → 注册表 App Paths / Uninstall `DisplayIcon` → `reg.exe` 被策略拦截时改用 PowerShell 兜底）、进程名、数据目录、渲染器 URL/标题匹配、更新窗口标记、启动附加参数、侧边栏锚点、启动屏探针、启动项修复范围。`launch.ts` / `inject.ts` / `tokens.ts` / `cdp.ts` / `launchers.ts` / `server.ts` / `mcp` / `cli` 全部改为读 profile。
- **端口隔离**：ZCode 沿用 `9222`（CDP）/ `9223`（控制 API），WorkBuddy 使用 `9333` / `9334`。`/api/health` 新增 `target` 字段，serve 自检与 MCP 自动拉起都校验目标——两个客户端同时开着时，不会把 WorkBuddy 的壁纸注进 ZCode 窗口，也不会共用同一个 serve。
- **WorkBuddy 配色映射（`--wb-*` 设计变量）**：不再套 ZCode 的 `--color-*`，改为覆盖 `--wb-bg-*`（`bg-primary` 透明、`bg-content/secondary/card/elevated/popover/modal` 按壁纸透显分级）、`--wb-color-text-*` / `--wb-text-*`、`--wb-border-*`、`--wb-color-bg-*` 控件底色，并用 MD3 primary 色阶整条重建 `--wb-palette-brand-1..10`——按钮、链接、选中态、焦点环一次性跟随壁纸。选择器用 `html[data-theme=light|dark]` / `html.cb-*`（0,1,1），稳压应用自身 `[data-theme=dark]`（0,1,0），水合重渲染也不会被盖回。
- **WorkBuddy 启动屏**：以 `#sk-overlay` / `#skeleton-root` 可见 + `#root` 空为判据，启动骨架期间不挂壁纸与面板（`startupClean` 语义不变）。
- **聊天区增强仅 ZCode**：气泡、消息流宽度、运行中图标、耗时去小数、队列遮罩绑定 ZCode 的 DOM；WorkBuddy 目标下这些配置被强制归零（避免旧配置注入无效规则），面板隐藏「聊天」页签与"更新界面显示壁纸"开关，文案统一替换为 WorkBuddy。
- **WorkBuddy 插件包**：新增 `.codebuddy-plugin/plugin.json`（`mcpServers` + `skills` + `commands`，`BEAUTIFY_TARGET=workbuddy`）与 `.codebuddy-plugin/marketplace.json`，仓库可直接作为 WorkBuddy 插件市场添加；ZCode 的 `.zcode-plugin/plugin.json` 原样保留，两个清单共存。
- **启动项修复**：`psScript` 的 exe 通配与注册表键改为按目标注入。WorkBuddy 只修快捷方式 + `workbuddy://` 深链，**不碰**其文件类型处理器（`WorkBuddy.image` / `.pdfX` 等），避免破坏"打开方式"。
- **CLI**：新增全局 `--target zcode|workbuddy|auto`，端口默认值、错误提示、`launch`/`status` 文案随目标变化。
- 测试：t23（WorkBuddy payload 变量族、无 ZCode token / 队列规则泄漏、聊天增强归零、bootstrap/面板探针与文案改写、ZCode 侧不回归）。

## 0.4.9

> 定位（官方渲染层逆向）：对话下方运行耗时行 `z5t`（`data-zcode-chat-loading-animate`，3×3 像素加载图标 + "工作中" + 等宽耗时）由格式化函数 `I5t` 生成，秒数硬编码 `toFixed(1)` 一位小数，写入一个 aria-hidden 纯文本 span，每 100ms 由 React 重写。历史/完成态耗时走另一个整秒格式化函数，本就不带小数。

- **新配置 `chatLook.hideElapsedDecimal`（耗时秒数去小数，默认 0=关）**：CSS 摸不到文本中段，bootstrap 的 `applyChatLook` 内安装 MutationObserver 实时改写——安装时全量扫一遍存量行，之后每 100ms 的 React 重写（firstChild.nodeValue 快路径）都会被再改写一次；改写保持单文本子节点形状，与 React 更新路径互相兼容，无小数时不写回（无循环）。关闭即断开观察器，下一个 tick 自动恢复原生显示。中英文格式（"1 时 17 分 53.4 秒" / "1h 17m 53.4s"）都处理；非目标文本的小数（如版本号）不受影响。
- **面板**：「聊天」页「聊天区」新增"耗时秒数去小数"开关（zb-chat-elapsed），与大会话流畅模式同款 pushChatLook 链路；MCP `apply_options` 新增 `chat_hide_elapsed_decimal` 布尔参数（部分补丁语义）。
- 测试：t22（normalize 钳制、payload 透传、jsdom 跑真实 bootstrap：安装扫除/React 式 nodeValue 改写/新挂载行/英文格式/无关文本不动/关闭断开观察器）。
- **作者信息改为 Mc-GrowlR**：关于页「作者」行、`plugin.json`/`marketplace.json`（owner+author）/`package.json` 的作者署名统一改为 fork 维护者 Mc-GrowlR（单一来源 `src/version.ts AUTHOR`）；上游仓库行、LICENSE 版权行等溯源信息保留不动。

## 0.4.8

> 定位（官方源码）：侧栏会话行左侧 16px 前置槽在 `phase=prewarming/running` 时渲染 lucide LoaderIcon（`packages/ui/src/TaskListItem.tsx` 普通列表行 + `project-sidebar/grouped/task-row.tsx` 分组行，两种渲染都锚定 `data-testid^="task-item-"`）。

- **新配置 `taskSpinnerLook`（运行中图标，默认原生）**：`mode`（default=完全不改 / image=换图）+ `image`（绝对路径，构建 payload 时解析为 serve 媒体 URL 或 data URI）+ `spin`（保留原生旋转，GIF 建议关）+ `size`（10-24px，原生 16）。
- **注入端（独立 style 元素 + fast path）**：lucide 图标用 currentColor 描边——`color:transparent` 抹掉原生字形，`background:url(...)` 在同一 svg 上画用户图，普通列表行与分组行一套选择器全覆盖；`spin=false` 时对 wrapper/svg 补 `animation:none`。换图不重放壁纸过渡（spinnerKey fast path，与 chat/bubble 同构）。
- **面板**：「聊天」页新增"运行中图标"区块——原生/自定义图片切换、📁 选图（≤2MB，gif/png/webp/jpeg/svg，经 `/api/spinner` 存入数据目录）、当前图标预览、保留旋转开关、大小滑条、✕ 恢复原生。
- **MCP**：`apply_options` 新增 `spinner`（mode/image_path/spin/size），与 bubble 同款部分补丁合并语义。
- **配套**：`/media/lib` 放行 gif/svg（svg 仅作 background-image 绘制，无脚本执行面）；上传固定名 `spinner.<ext>` 并清理旧变体防陈旧文件残留。
- **侧边栏压暗（新配置 `sidebarDim`，默认 0=关）**：桌面端侧边栏（`#sidebar`，`data-workspace-sidebar-panel`）本身无背景绘制层、壁纸直接透过——注入 `#sidebar { background: rgb(0 0 0 / a) !important }` 即在壁纸与侧栏内容之间叠一层黑纱，自动跟随侧栏宽度拖动、折叠时随 `opacity-0` 淡出。与全局 `dim` 叠加复合（只能更暗）。入口：面板「显示调节 → 画面」滑条（0-80）、MCP `apply_options.sidebar_dim`、CLI `--sidebar-dim`。
- **关于页检查更新**：serve 新增 `GET /api/update-check`——查 fork 的 GitHub Releases 最新 tag 与 `VERSION` 对比（`cmpVersion` 纯函数入 `version.ts`，GitHub API 地址从 `FORK_URL` 派生单一来源；60s 内存缓存对齐未鉴权限流；网络失败降级 `ok:false` 面板显示"检查失败"，404=尚无发布按最新处理）。面板「插件信息」卡顶部新增"版本更新"行：⟳ 检查 → 已是最新 / 发现新版本（同按钮变"打开发布页"，`window.open` 被拦截时降级为复制发布页链接，另有 ⧉ 链接按钮）。
- **修复：运行中图标污染壁纸库**——0.4.8 初版把 spinner.<ext> 写进 dataDir 根目录，而壁纸库（/api/library）扫描的正是根目录全部图片：设置图标后库里多出一张假壁纸，且上传恰好名为 spinner.jpg 的壁纸会反向覆盖图标文件。修复=文件挪入独立 `spinner/` 子目录（上传/清理/引用解析全链跟随，新增 `/media/spinner/` 媒体路径，同款防穿越白名单），serve 启动时自动迁移旧版残留（根目录 spinner.* 挪入 spinner/ 并改写 config 引用，图标无需重传）。
- **完成标志 / 错误标志可换图（taskSpinnerLook 新增 `unreadImage`/`errorImage`）**：ZCode 会话行前置槽四态（error>unread>loading>none）中，完成且有未读回复显示蓝点、出错显示红点——两者现在与"运行中"一样可换图片/GIF，三个槽位互相独立（换完成标志不需要开运行中换图）。注入：普通行锚 `data-unread-indicator`/`data-error-indicator` 属性，分组行锚 Tailwind 圆点类组合（bg-sky-500/bg-destructive+size-1.5，升级 ZCode 改类名时最坏退化回原生圆点）；圆点用"清背景色+拉伸到图标尺寸+画图"替换。上传端点 `/api/spinner` 加 `slot`（running/unread/error，固定名 spinner[-unread|-error].<ext>）；面板"运行中图标"区块新增"完成标志/错误标志"两行（各自预览/选图/✕ 恢复原生）；MCP `apply_options.spinner` 加 `unread_image_path`/`error_image_path`。
- 测试：t16（normalize 钳制、解析四分支、payload 集成、partial 合并、bootstrap 选择器/spin 开关/reset 清理、serve+MCP 接线）、t18（sidebarDim 注入断言）、t19（cmpVersion 矩阵 + serve/面板接线静态断言；t13 冒烟补端点 401/形状断言，真网络两态皆合法）、t20（spinner 隔离：迁移/库无污染/上传仅写 spinner//media 路径/防穿越）、t21（终态槽位：normalize/payload 独立解析/bootstrap 三槽规则与移除门/serve slot 分支/MCP 映射/面板行）。

## 0.4.7

> 依据卡顿分析报告（官方源码逆向 + CPU profile 实证）把官方只用于分享视图的 content-visibility 优化带给主聊天区——但用"逐行量高后再跳过"的安全形式。

- **新配置 `chatLook.perfSmooth`（大会话流畅模式，默认关）**：面板"聊天区"新增开关。开启后注入轻量引擎：滚动/DOM 空闲时对远屏外的消息行（`.history-message` / `group/assistant-turn`）**先量真实高度写入 inline `contain-intrinsic-size`，再开 `content-visibility:auto`**——视口外的行跳过绘制与布局，总高与滚动条保持精确。
- **方案迭代（实测否决了朴素做法）**：先试了全局 CSS（`contain-intrinsic-size:auto 420px`，官方分享视图同款），51MB 会话实测**虚拟化总高从 39493px 失真到 6646px（6 倍）**——动态高度虚拟化器在测量落位前读到占位值，滚动条严重失真，已否决；t12 加了防退化断言。measure-then-skip 引擎实测总高零失真（10341px 与真实一致）。
- **实测（51MB 克隆会话）**：打开→稳定 **3889ms → 2312ms（首轮 -41%）**，含缓存效应的交错复测约 -25%；受控滚动（底部 1/4 固定范围）长帧 1-3/240 帧与关闭时相当，全程滚动可在等长帧率下承载约 3 倍内容高度。
- 测试：t12（归一化/引擎结构断言/全局 CSS 防退化）、t11（开关 POST）。
- 勘误：开发中两次踩模板字符串注释反引号坑（bootstrap 内注释禁止反引号——老教训重犯）。

## 0.4.6

> 修复"自定义…"编辑器过几秒自动关闭；档位补齐窄方向。

- **修复 自定义编辑器自动关闭**：旧版"自定义…"是下拉里的一个 option，点开只是本地 UI——下一个 4s 心跳回显服务端旧值时把它顶掉。改为下拉旁「➕ 自定义…」按钮打开独立编辑行（上限/留白 + ✓ 应用 / ✕ 取消，Enter/Esc 快捷键），编辑期间心跳完全跳过回显；「✓ 应用」才推送，「✕ 取消」不推送。下拉里保留一个 disabled 的"自定义"仅作回显标记（当前值不匹配任何档位时选中）。
- **防半成品泄漏**：推送统一走"服务端宽度真值"变量（档位/应用/心跳更新），编辑器输入框里的半成品数值不再可能随遮罩滑块的推送被带出去。
- **新增三档窄宽度**：很窄 48rem / 窄 56rem / 偏窄 64rem（留白保持原生 24rem，只降上限；1920 窗口对应约 768/896/1024px）。
- 测试：t11 扩展（按钮开编辑器、编辑中心跳不重置不推送、编辑中拖遮罩滑块带服务端宽度而非编辑值、取消不推送、窄档 POST）；并补修一处既有测试脆弱性——"重开面板"测试重启了 4s beat 计时器但只在套件开头冻结过一次，宽度测试拉长时间线后一个心跳落进了气泡预览断言的窗口。
- **新增 `scripts/record-install.mjs`（安装记录写入器，防事故）**：Route B 最后一步往 `installed_plugins.json` 写记录时，手写 Windows 路径会被 JS 字符串转义吃掉反斜杠（`C:\Users\...\0.4.6` → `C:Users...<NUL>.4.6`，`\0` 变 NUL）。ZCode 会据此拼 `<installPath>.transaction.json`，Node 抛 `ERR_INVALID_ARG_VALUE: The argument 'path' ... without null bytes`，实机表现为插件列表现「已安装 0」、每个新会话顶部「初始化失败，暂时无法发送」。脚本改为：读清单 → 合并（保留其它记录与 `installedAt`）→ 校验（绝对路径 / 无 NUL / 目录存在 / `plugin.json` 版本一致）→ 备份 + 临时文件 rename 原子写 → 回读复检；`--dry-run` 只看不写、`--verify` 单独体检（含对其它插件记录的 NUL/相对路径检查，因为一条坏记录会连坐整张表）、未知参数一律拒绝（打错字绝不落进写模式）。`INSTALL-FOR-AI.md` 第 5 步与 `AGENTS.md` 同步改为「必须用脚本 / `installPath` 必须经 JSON 序列化」。

## 0.4.5

> 中间**对话列的宽度**可调；注入的是公式（rem 上限 + `calc(100% − Nrem)` 两侧留白），窗口缩放时与原生同机制跟随，永不溢出、不破坏输入栏。

- **新配置 `chatLook.widthCapRem / widthInsetRem`**（消息流宽度）：上限 0=原生（零注入）；40–120 生效，留白默认 12rem（原生 24rem）。注入按 ZCode 自身的 `@container conversation` 分档：≥1280 档改上限+留白，≥864 档只抬 4xl 上限，<864 完全原生。选择器沿用实测的 `conversation:max-w-6xl/4xl`（消息列×2+输入栏三处同步对齐）。
- **面板"聊天区"新增"消息流宽度"**：原生/宽(84:12)/更宽(90:8)/极限(100:4) 四档 + 自定义（上限/留白两个数字输入），状态回显自动落档或落自定义。
- **MCP `apply_options` 新增 `chat_width_cap_rem` / `chat_width_inset_rem`**；`session.baseConfig` 对 `chatLook` 采用与气泡一致的合并语义（只传想改的字段）。
- **测试**：t11 面板（档位点击 POST、自定义回显、服务端状态落档）、t12 管线（归一化钳制、bootstrap 结构断言——宽度保持公式而非定值）。实机验证：90:8→1440px、84:12→1344px、还原 0→1152px（1920 窗口，三处同步）。

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
