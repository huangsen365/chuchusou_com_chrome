# 技术债体检报告 · 2026-04

> **2026-06 增补**：TS 移植完成后又退役了 6 个 legacy SW 文件（base.js / Logger.js /
> menuHandlers.js / menuBuilder.js / voiceOffscreenBridge.js / init.js，~3200 行），
> 移入 `legacy/background-retired/`（不再随商店 zip 发布），详见该目录 README。
> 第四节里的 `base.js` 拆分项就此了结；`events.js` 成为最后一个未 port 的 legacy 主体。
> dual 校验脚本（verify-background-utils-dual / extras-dual）改从新路径加载 Logger.js 对照源；
> verify-url-safety 的 menuHandlers 源码检查改指向运行时主体 `src/background/menuHandlersAttach.ts`。
>
> **events.js 移植就绪状态（2026-06-13）**：`npm run verify-extension-smoke` 已把
> 20 条回归路径自动化 18 条（真 Chrome 装 build 产物端到端：onMessage 11 个 action、
> onConnect port 生命周期、tabs.onUpdated 取词、真实选区捕获、菜单动态标题、双 UI
> 启动+点按）。移植步骤：写 `src/background/eventsAttach.ts`（1:1 转写 + attach 模式）
> → 两个入口的 importScripts 列表去掉 events.js → npm test（18 条自动断言把关）
> → 人工补 3 项（原生菜单渲染、voice 录音、UX 手感）→ 按 /release 发版。
> executeMenuAction 的 tool/copy/base64 分支与 AI relay ack 消息自动覆盖较薄，转写时重点自查。

## 一、僵尸代码普查结果

通过 grep 对新架构所有全局符号做真实调用溯源（排除 importScripts/注释/文档/Logger 字符串/README 目录树），发现以下文件**零真实调用**，属于纯僵尸：

| 文件 | LOC | 全局符号 | 真实调用者 | 结论 |
|---|---|---|---|---|
| `background/menu/MenuBuilder.js` | 296 | `MenuBuilder` / `MenuContexts` / `MenuGroups` | 无 | 🧟 僵尸 |
| `background/menu/MenuUpdater.js` | 287 | `MenuUpdater` | 无 | 🧟 僵尸 |
| `background/menu/MenuHandlers.js` | 379 | `MenuHandlers` | 无 | 🧟 僵尸 |
| `background/events/TabEvents.js` | 416 | `TabEventHandler` | 无 | 🧟 僵尸 |
| `background/events/MessageEvents.js` | 791 | `MessageEventHandler` | 无 | 🧟 僵尸（含 1 处 TODO fallback urlMap） |
| `background/events/MenuEvents.js` | 429 | `MenuEventHandler` | 无 | 🧟 僵尸 |
| `background/MenuManager.js` | 745 | `MenuManager` | `menuSystem.js:95` 但在 `if (useNewSystem)` 保护下永不执行 | 🧟 条件僵尸 |
| **合计** | **~3343** | | | |

## 二、真正活着的"新架构"组件

| 文件 | LOC | 为什么活 |
|---|---|---|
| `background/StateManager.js` | 693 | `menuSystem.js` 无条件 `new StateManager`，且 `getStateManager()` 被 init.js 多处调用 |
| `background/URLBuilder.js` | 309 | `menuSystem.js` 无条件 `new URLBuilder`，`getURLBuilder()` 被多处调用 |
| `background/MenuRegistry.js` | 401 | 被 `base.js` 通过 `menuRegistry` 全局变量使用 |
| `background/menuSystem.js` | 338 | init.js 直接 `MenuSystem.init(...)` 启动入口 |
| `background/tasks/AITaskRegistry.js` | 299 | AI 任务 SSoT 入口 `runAITaskByMenuId` |
| `background/tasks/AITaskHandler.js` | ~ | AI 任务执行器 |

## 三、结论与处置策略

1. **7 个僵尸文件共 ~3343 行可以安全搬走**到 `legacy/_unactivated/`，从 `background/index.js` 的 `importScripts(...)` 列表注释掉。
2. `menuSystem.js` 里 `new MenuManager(...)` 位于 `if (useNewSystem)` 分支内，`useNewSystem=false` 是生产配置，搬走 MenuManager.js 不会触发该分支，**运行时零影响**。
3. `menuSystem.js` 里顶部的 `@type {MenuManager}` JSDoc 注释失效，但不影响运行，本次不清理。
4. `_menuSystemCompat` 对象（menuSystem.js:113）定义后无人消费，也是僵尸，**本次不清理**（超出范围，留待下轮）。
5. **回滚方式**：把 `legacy/_unactivated/` 里的文件搬回原位 + 恢复 index.js 的 importScripts 注释即可。

## 四、其它已知技术债（本轮不处理，记录在案）

| 项目 | 说明 |
|---|---|
| `base.js` 1170L | 老业务心脏，switch-case 海 + 全局函数。待僵尸清理完再考虑拆分 |
| `events.js` 1335L | 同上 |
| `popup.js` 829L / `sidepanel.js` | Popup 和 SidePanel 两套 UI 代码冗余，抽共享层 |
| Content script 加载 26 个文件 | 性能与维护问题，需引入 esbuild/rollup 打包 |
| `content/SelectionManager.js` vs `modules/selection.js` | 命名相近，职责边界模糊 |
| `modules/stateManager.js` vs `background/StateManager.js` | 同名但不同进程，调试时易混淆 |
| MenuManager 搬走后 `menuSystem.js` 里 5 行残留引用 | `@type {MenuManager}` / `if (useNewSystem) new MenuManager` 死分支等 |
| `useNewSystem=false` 永远为假 | 新系统从未启用，可考虑彻底砍掉 `if (useNewSystem)` 分支 |

## 五、本轮执行范围（锁定）

对应用户授权的 A+B+C+D+E+F：
- A（本报告）✓
- B：Smart Post / Smart Reply 两套 UI 残骸彻底清理（popup + sidepanel）
- C：`Constants.js` 三张 DEPRECATED 空壳 ENGINE_TITLES 清除
- D：7 个僵尸文件搬到 `legacy/_unactivated/`，从 `index.js` 注释掉
- E：`docs/archive/` 10 篇历史文档合并成 `docs/HISTORY.md` 索引
- F：`CLAUDE.md` + `README.md` 更新反映最新架构
