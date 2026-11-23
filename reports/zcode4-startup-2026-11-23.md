# ZCode 4.0 适配与启动性能报告（2026-11-23）

## 结论

- **4.0 启动屏探针修复**：ZCode 4.0 的 `<body>` 在启动阶段没有 `zcode-startup*` 类，旧的 3.18 探针把启动屏当作"已就绪"，壁纸/面板在启动画面之上提前约 **0.44–0.50 s** 出现。修复后 10/10 次都在 `zcode-startup-ready` 之后挂载（`early=false`），并且不再拖慢 React 启动：主窗口可交互中位数从 **2820 ms → 2488 ms**（同机、同壁纸、同隔离配置、同 4.0.0.10870 构建）。
- **serve 健康接口不再等 CDP**：CDP 端口接受连接但不响应时，`/api/health` 从 **3243 ms → 236 ms**（10 次中位数，13.7×）。
- **目标窗口出现到壁纸可见**：serve 轮询从固定 1.5 s 改为 150 ms 起步的自适应节奏；"应用已就绪后才启动 serve"的注入延迟从 **414 ms（p90 1794 ms）→ 54 ms（p90 57 ms，缓存命中）**。
- **壁纸主题缓存**：每个 serve 进程原本都要 jimp 解码壁纸再提色；新增磁盘 Monet 缓存后，缓存命中时 `assetsMs` **378 ms → 14–16 ms**，隔离场景下首次注入 **374 ms → 54 ms**。
- **设置面板首开**：`activateSavedTab + beat + getBoundingClientRect` 原本同步阻塞约 **90 ms**；现在先 `hidden=false`、下一帧再刷新。首开从 **311 ms（基线 warm）→ 96 ms（fixed warm）**，同步 handler 实测 0 ms，首帧绘制 89 ms。
- **MCP 握手**：host/配置/启动项/overlay 自愈从 module load 移到 `initialized` 之后；gate-on 握手 **255 ms → 222 ms**（p90 360 → 238 ms），gate-off **228 → 216 ms**。
- 回归：`npm test` 全部通过（含新增 T38、扩展 T37）；`npm run bundle`、`npm run package`、解压包 MCP 握手/overlay 安装均通过。**真实 3.18 客户端未安装，3.18 仅做了 jsdom 行为回归；真实 app.asar 未被修改（overlay 只在 ASAR 夹具/隔离副本上验证）。**

## 1. 环境与隔离方法

| 项 | 值 |
|---|---|
| 客户端 | ZCode **4.0.0**（build `3bc8a247`，构建时间 2026-11-22，安装包 4.0.0.10870） |
| Electron | 44.7.0 / Chrome 152 |
| OS | Windows 10 19045 x64 |
| 壁纸 | `icon.png`（89 KB），同一文件、同一 fit/dim/monet 配置 |
| 隔离 | `ZCODE_DESKTOP_HOME_DIR` + `ZCODE_DESKTOP_USER_DATA_DIR` + 独立 CDP/API 端口；HOME 指向 `.analysis/iso/home`，内为复制后的登录凭据与真实 session DB/任务索引副本（395 个任务，侧栏实际渲染 266 行） |
| 基线 | 工作区原 v6.4.0 overlay WIP（`dist/` 为修改前构建）；历史参考 **v6.3.6 @ 1ce1ad7**（git worktree） |
| 对照 | 插件停用（不启动 serve/不注入）；v6.4.0 基线；修复后 fixed；v6.3.6 参考 |
| 采样 | 每个核心场景 N=10（v6.3.6 参考 N=5；late 注入 N=5）；报告中位数 + P90；启动轮询 25 ms。`interactive` = `zcode-startup-ready` + `#root` 有子节点 + `#loading` 透明/移除 |
| 工具 | `.analysis/bench.mjs`（gitignored；app/MCP/serve 三个入口） |

核心场景各 10 次：**0 失败 / 0 注入超时**。超时保护为 `Page.enable` 4 s、CDP evaluate/registration 8 s；基线 late 场景出现 1 次 1794 ms 的注入（1.5 s 固定轮询踩点），fixed 的 p90 为 57 ms（缓存命中）/441 ms（缓存未命中）。

## 2. 已确认的瓶颈（按影响排序）

1. **启动屏探针失效（4.0 兼容性）**
   - ZCode 4.0 启动时 `body.className === ""`，React 就绪后才加 `zcode-startup-ready`，加载层是 `#loading`；3.18 才是 `zcode-startup*` body 类。
   - 旧探针 `/zcode-startup/.test(cls) && !/ready/` 对 4.0 恒为 false → bootstrap 立即挂壁纸/面板，盖在启动画面上。
   - 基线 warm 10/10 `wallpaper < ready`（壁纸中位 2225 ms，ready 2664 ms，提前 439 ms）；fixed 10/10 `wallpaper ≥ ready`。
   - 附带影响：基线在启动期注入/构建面板，和 React 启动抢主线程，导致 **app 自身 ready 反而更慢**（2664 vs 2317 ms）。

2. **serve 健康接口阻塞在 CDP 探测**
   - `startServe()` 先 `await resolveCdpPort()` 再 `listen`；`listTargets` 的 fetch 超时 3 s。
   - CDP 端口"接受连接但不响应"时 `/api/health` 中位 **3243 ms**；修复为先 bind、后台解析端口，中位 **236 ms**。

3. **固定 1.5 s 轮询**
   - `POLL_MS=1500`，窗口出现后最多等 1.5 s 才注入；基线 late 场景 p90 1794 ms。
   - 修复为 150 ms 快轮询，所有 renderer 都持有 session 后回落 1500 ms；无目标 30 s 后回落，避免空转。

4. **每次 serve 启动都重新解码壁纸**
   - `getAssets` → `themeThumbFor`（无 ffmpeg 时直接返回原图）→ jimp 解码 + Monet 提色；缓存只在进程内。
   - 基线 late 注入 414 ms，fixed 缓存未命中 374 ms，缓存命中 **54 ms**；serve 日志 `assetsMs` 378 → **14–16 ms**。

5. **面板首开同步阻塞**
   - FAB 点击 handler 同步执行 `activateSavedTab()` + `beat(true)` + `getBoundingClientRect()`（强制整面板布局），实测 90 ms；面板本身在启动时已构建（mount 33–45 ms）。
   - 修复为 hidden 先行、双 rAF 后刷新/救回越界面板；handler 0 ms，首开 96–105 ms。

6. **MCP 握手前的门控/自愈工作**
   - `bootstrapServe()` 在 module load 执行：宿主配置读取、gate、launcher stamp、overlay 自愈调度。gate-on 比 gate-off 多约 24–33 ms。
   - 修复为 `initialized` 后 `setImmediate` 执行；gate-off 仍在 module load 快速记日志拒绝。gate-on 255 → **222 ms**。

## 3. 计时表（中位数 / P90，毫秒）

### 3.1 App 启动（serve 已在运行，warm）

| 指标 | v6.4.0 基线 N=10 | fixed N=10 | v6.3.6 参考 N=5 |
|---|---:|---:|---:|
| 主窗口 target 出现 | 1663 / 1826 | 1524 / 1610 | 1579 / 1760 |
| `zcode-startup-ready` | 2664 / 2904 | **2317 / 2415** | 2406 / 2589 |
| 壁纸可见 | 2225 / 2394（早于 ready） | 2349 / 2415（ready 后） | 2406 / 2589 |
| 主窗口可交互 | 2820 / 3064 | **2488 / 2589** | 2616 / 2819 |
| 首次打开设置面板 | 311 / 376 | **96 / 120** | 147 / 161 |

fixed 使用磁盘 Monet 缓存；基线每次 serve 启动解码。fixed 壁纸比 ready 晚约 32 ms 是启动探针 32 ms 节流（合并 React 启动期大量 mutation），不再有启动画面覆盖。

### 3.2 App 启动（serve 需要新启动，cold）

| 指标 | v6.4.0 基线 N=10 | fixed N=10 |
|---|---:|---:|
| serve `/api/health` | 268 / 298 | 238 / 272 |
| 主窗口 target | 1340 / 1510 | 1279 / 1347 |
| ready | 2079 / 2482 | 2044 / 2154 |
| 壁纸可见 | 2340 / 2482 | **2080 / 2168** |
| 可交互 | 2364 / 2702 | **2232 / 2321** |
| 首次打开面板 | 145 / 161 | **105 / 118** |

### 3.3 应用就绪后再启动 serve（隔离注入/缓存成本）

| 指标 | v6.4.0 基线 N=5 | fixed 缓存命中 N=5 | fixed 缓存未命中 N=5 |
|---|---:|---:|---:|
| serve 就绪 → 壁纸可见（injectMs） | 414 / **1794** | **54 / 57** | 374 / 441 |
| 首次打开面板 | 145 / 206 | **76 / 97** | 98 / 99 |

### 3.4 serve 健康接口

| 场景 | v6.4.0 基线 N=10 | fixed N=10 |
|---|---:|---:|
| CDP 端口关闭 | 234 / 237 | 236 / 238 |
| CDP 接受连接但不响应（blackhole） | **3243 / 3247** | **236 / 281** |
| 重复 serve（同 API 端口） | 第 2 个进程 297 ms 退出（exit 1），首个 PID 不变 | 同左 |
| `serve --detach`（已有健康服务） | 健康探测命中，无新进程；PID 不变 | 同左 |

### 3.5 MCP 启动到握手

MCP 为独立进程 `spawn → initialize` 计时（含 Node 启动与单文件 bundle 载入，不含宿主额外 spawn 开销）；宿主侧清单/协议/工具/resource 另行验证。

| 场景 | v6.4.0 基线 N=10 | fixed N=10 |
|---|---:|---:|
| gate off：initialize / tools/list | 228 / 234（P90 244/250） | **216 / 222**（P90 235/244） |
| gate on：initialize / tools/list | 255 / 272（P90 360/378） | **222 / 253**（P90 238/315） |

### 3.6 壁纸缓存（serve 日志）

| 场景 | assetsMs 中位 |
|---|---:|
| 缓存未命中（jimp 解码 + 提色） | 378 ms（另一次基线 475 ms） |
| 缓存命中（读 `assets/*.json`，重建 Theme） | **14–16 ms** |

## 4. ZCode 4.0 实测覆盖

- **启动屏/就绪信号**：`#loading` + 无 body 类 → 等待；`zcode-startup-ready` → 挂载；启动屏 15 s 未清则兜底挂载；body 未创建时等待 parser；32 ms 合并探针。
- **startupMO 异常**：
  - body 尚未创建：不抛错，先 arm waiter，body 出现后继续等待；
  - 启动屏转 ready：壁纸/面板在 ready 后挂载（10/10 `early=false`）；
  - 页面重载重放：真实 `Page.reload` 后壁纸/style/panel-root 各恰好 1 份；
  - 等待就绪期间停用：reset 断开 startupMO/panelMO、清 pending 与检查定时器，ready 后不再挂载；
  - 重复注入幂等：多次 eval 仍 1 份；面板同样。
- **DOM 锚点（真实 4.0 UI，填充 266 行）**：
  - `#sidebar`、`[data-testid^="task-item-"]`（`sess_*`）、`[data-task-title-copy="original"]`、`[data-composer-layout]`、`div[class*="scrollbar-gutter:stable"][class*="overflow-y-auto"]` 均存在；
  - 标题引用 chip 实际生成 18 个；会话列表分页在 4.0 容器上找到 266 行并正确隐藏/显示（`data-zb-paging` + 工具条）；
  - 会话概览悬停卡真实打开并读取到该会话 prompt；
  - 向隔离 DB 插入 `session_target` 后 `/api/goal-sessions` 返回该条，侧栏标题出现 goal chip（`rowText` 以 `goal ` 开头）。
- **CDP 主窗口识别**：4.0 URL 带 `restoreSession=true&zcodeLaunchMarks=…`，仍匹配 `out/renderer/index.html`；`windowKind=update-status` 归为更新窗口（默认不注入，opt-in 才注入且不注入面板）；`plugin-sandbox.html`、`resource-manager.html`、worker 不会被选为注入目标（T38 F）。
- **主题变量**：4.0 仍有 `--color-background/surface/foreground/…`；实时注入后 `--color-background: transparent`、`--color-surface: rgba(19,19,22,.72)`、`--color-foreground` 生效；`--color-input` + `[data-composer-layout]` 透明输入框规则存在。4.0 不再使用的 `--color-border-color-interactive`/`--divider-color` 只是无害的额外覆盖。
- **聊天列宽**：4.0 把 4xl/6xl 两档合并为 `@min-[624px]/conversation:max-w-xl`；新增 624px 容器档，并让拖拽/查询使用版本无关的 `[class*="conversation:max-w-"]`。
- **插件清单 / MCP / ui.surfaces**：
  - 4.0 schema：surface `id` `[A-Za-z0-9][A-Za-z0-9_.-]`、`title` 非空字符串或 locale map、`server` 必须在 `mcpServers`、`resourceUri` 以 `ui://` 开头且 ≤2048、`availability === "session"`；本清单全部满足（T38 D）。
  - `${CLAUDE_PLUGIN_ROOT}`、`${ZCODE_PLUGIN_DATA}` 模板在 4.0 中仍受支持。
  - 用 4.0 host 的最新协议版本 **2025-11-25** 实测握手：协商成功，12 个工具，`ui://zcode-beautify/bubble-studio.html` 以 `text/html;profile=mcp-app` 返回 19,313 字节。
- **只读数据结构**：4.0 `session` / `message` / `part`（含 `sequence`）/ `session_target`（含 `summary_title`）schema 与读取 SQL 兼容；真实 DB 读取和 synthetic 4.0 schema 测试均通过（T38 E）。

## 5. 代码改动

- `src/core/startupProbe.ts`（新增）：3.18 body 类 / 4.0 `#loading` / WorkBuddy skeleton 三合一探针。
- `src/core/cdp.ts`：接入共享探针；body 未创建等待；32 ms 合并检查；pendingBootstrap 新代覆盖旧代；disable 清理 startupMO/panelMO/定时器；15 s 兜底；聊天列宽 4.0 `max-w-xl` + 624px 档 + 通用 holder 选择器；renderer timing。
- `src/panel/panelScript.ts`：同一探针；disable 时取消 parked mount；FAB 点击先显示、下一帧刷新/救援；panelTiming（mount/openHandler/openPaint）。
- `src/core/server.ts`：health 先 listen、CDP 端口后台解析；150 ms/1.5 s 自适应轮询；`Page.enable`/panel registration 超时；磁盘 Monet 缓存（`assets/*.json`，按壁纸路径+mtime+size，Theme 用 ARGB 重建）；注入 timing；上传壁纸同步写缓存。
- `src/mcp/server.ts`：bootstrap 移到 `initialized` 之后；gate-off module-load 快速拒绝；bootstrap timing。
- `src/cli.ts` / `src/core/overlay.ts`：`overlay status --asar` 真正使用指定 asar（修复前 status 忽略该参数）。
- 测试：新增 `test/t38-zcode4.ts`；扩展 `t37`（update→auto-heal→rollback、status --asar）；更新 `t11`（loading 为宿主元素）、`t35`（新的 poll 返回结构）。
- `package.json`：`npm test` 串入 t38。

## 6. 验收结果

- `npm run bundle`：通过（dist/cli.js、dist/mcp/server.js）。
- `npm test`：全部通过（T11–T38；含 T37 overlay 与 T38 4.0）。
- `npm run package`：`zcode-beautify-plugin-v6.4.0.zip` 1,867,636 B；`skill-pack-v6.4.0.zip` 19,245 B。
- **全新解压目录冒烟**：`dist/cli.js --help`、`overlay status --json --asar`、MCP initialize（2025-11-25）、tools/list、Bubble Studio resource 全部通过；用解压包的 CLI/runtime 对 ASAR 夹具做 install → status(injected/current) → remove（opt-out）通过。
- **overlay 夹具**：install/idempotent/dry-run/remove/reinstall、模拟 4.0 更新覆盖 asar 后 auto-heal 重新补丁、remove 后 opt-out 阻止再次自动补丁，全部通过。
- **真实 4.0 隔离实机**：启动、注入、`Page.reload` 重放、disable 清理、disable 后 reload 不复活、面板/悬停卡/分页/标题引用/goal 标记、主题 token 均验证。

## 7. 未验证 / 边界

- **真实 ZCode 3.18 客户端实机**：本机只有 4.0.0；3.18 仅用 jsdom + 现有测试链回归（body class 等待/就绪、旧宽度选择器保留）。
- **ZCode 4.0 插件市场 UI / Bubble Studio 实际页面**：使用隔离实例 + 清单/schema/协议/MCP 握手与 resource 读取验证；未在真实市场界面手动点安装、未在 4.0 对话内实际展开 Bubble Studio 页面（避免污染用户插件目录）。
- **WorkBuddy 实机**：本机未安装 WorkBuddy；仅 T23 单元测试 + T38 A7/A8 jsdom 探针回归。
- **真实长对话的 4.0 列宽容器**：隔离实例展示了 266 行侧栏任务，但未打开带消息的会话；`@min-[624px]/conversation:max-w-xl` 依据 4.0 bundle 源码与 T38 生成断言，建议在有会话的 4.0 实例上再点一次拖拽/宽度档。
- **真实 `D:\soft\zcode\resources\app.asar` 的 overlay install**：按要求未修改；安装/更新/回滚全部在 ASAR 夹具与解压包隔离副本上验证。
- macOS / Linux 未测。
- 面板首帧 89 ms 主要来自 `backdrop-filter: blur(22px)` 的大面积绘制；为保持现有视觉未改。首次打开已从基线 311 ms 降到 96 ms。

## 8. 复现

```bash
# 基线/修复后的隔离启动（需要本机 4.0 与 .analysis/iso 快照）
node .analysis/bench.mjs app --variant v640  --mode warm --runs 10
node .analysis/bench.mjs app --variant fixed --mode warm --runs 10
node .analysis/bench.mjs app --variant fixed --mode late --runs 5 --assetmiss
node .analysis/bench.mjs serve --variant fixed --cdp blackhole --runs 10
node .analysis/bench.mjs mcp --variant fixed --gate on --runs 10
npm test
npm run bundle && npm run package
```
