# 更新日志

## v1.6.18 (2026-05-17)

**首个真正基于 Plasmo 框架发布的版本**。`./build.sh` 从 v1.6.0 时代的"直接 rsync 源目录"模式切到走 `npm run plasmo:build` 出 build/chrome-mv3-prod/ 再打 zip。同时修一个 YouTube 关键字识别 bug。详细见 [releases/v1.6.18.md](./releases/v1.6.18.md)。

### 🐛 修复

- **YouTube 关键字识别**：在 `youtube.com/watch?v=ID` 页面唤起菜单时，关键字不再被错误取为 11 字符 video ID（如 `IurBXe0jpVg`），改为正确取页面标题（剥掉 ` - YouTube` 后缀）。原因是启发式 fallback 把 video ID 的字符长度当成了"合理关键字"。HOSTS_SKIP_HEURISTIC 名单可扩展，未来遇到 spotify track id / twitter status id 等同类站直接加一行。

### 🛠 技术改动

- **build.sh 切到 Plasmo**：从「直接 rsync 源目录」改成「`npm run plasmo:build` → zip build/chrome-mv3-prod/」。同样的 zip 现在多出 ~40 个 Plasmo bundle 文件（root `popup.html` / `sidepanel.html` / `content.{hash}.js` / `static/background/index.js`），但 manifest 入口仍指向 legacy 文件（与 v1.6.16/v1.6.17 一致），所以**用户感知零差异**。下个 minor 版本计划把 manifest 切到 Plasmo bundle。
- **5 个 background SW 模块 port 到 TS**：voiceOffscreenBridge / KeywordService / config / init / KeywordSyncManager（共 1581 legacy 行 → ~1120 TS 行，**减 29%**）。这些是纯 TS 增量，**不替换 legacy 生产路径**。
- **新增 verify:sw-bridge 测试关**：锁住 src/background.ts 的 importScripts 列表与 legacy background/index.js 顺序敏感等价。
- **dual-run verifier 扩展**：覆盖 StateManager + keywords + promptBuilders + voiceOffscreenBridge + KeywordService + config + init + KeywordSyncManager 8 个模块。
- **YouTube fix dual-run 锁住**：scripts/verify-background-extras-dual.mjs 加 2 个 YouTube 用例（`www.youtube.com/watch?v=...` + `youtu.be/...`），未来 legacy 或 TS port 任一边漏改都会被 npm test 拦下来。

## v1.6.17 (2026-05-17)

**纯技术建设版本，用户感知行为与 v1.6.16 完全一致**——生产代码（manifest / background / popup / sidepanel / content）一行未改。本次主要把 Plasmo 迁移 Phase 2 + Phase 3 的可纯函数化模块全部 port 到 TypeScript，并加上 dual-run 验证脚本守护 SSoT 不漂移。详细见 [releases/v1.6.17.md](./releases/v1.6.17.md)。

### 🛠 技术改动

- **9 个共享/纯工具模块 port 到 TypeScript**（约 2700 行 TS，**不替换 legacy 生产路径**）：
  - `shared/menuStructureBuilder.js` → `src/shared/menuStructureBuilder.ts`（popup 菜单结构构建器）
  - `shared/keywordClient.js` → `src/shared/keywordClient.ts`
  - `background/utils/Constants.js` → `src/background/utils/Constants.ts`（15 张纯数据常量表）
  - `background/utils/TextUtils.js` → `src/background/utils/TextUtils.ts`（11 个纯函数）
  - `background/utils/TextLimits.js` → `src/background/utils/TextLimits.ts`（保留 `TEXT_LIMITS_ENABLED=false` 总闸）
  - `background/Logger.js` → `src/background/Logger.ts`
  - `background/menuIds.js` → `src/background/menuIds.ts`
  - `background/URLBuilder.js` → `src/background/URLBuilder.ts`
  - `background/MenuRegistry.js` → `src/background/MenuRegistry.ts`
  - `background/tasks/AITaskRegistry.js` → `src/background/tasks/AITaskRegistry.ts`
- **新增 SSoT 守护脚本**：`verify-menu-structure-builder-dual` / `verify-background-utils-dual` / `verify-background-pure-modules-dual` 全部接入 `npm test`，legacy 与 TS 双跑 deep-equal 不一致即 CI 失败。`npm test` 现跑 7 道关。
- **新增冷启动性能诊断工具**：`scripts/perf-cold-popup.mjs` 静态扫描 popup 启动链 + `scripts/test-perf.sh` 一键启动干净 Chrome Canary 测真实 wall-clock 时间，Service Worker 真冷启动场景下 popup 首帧实测 34ms（接近 Plasmo demo 物理极限），sidepanel 首帧 104ms。
- **Plasmo build pipeline 进一步守护**：`scripts/verify-plasmo-package.mjs` 校验 plasmo package zip 包含必需 manifest 入口 + 不含 `src/` / `docs/` / 源码目录。

## v1.6.16 (2026-05-17)

Popup / Sidepanel 首帧"零 JS"——核心菜单直接预渲染在 HTML 里，HTML 一解析完就能点。详细见 [releases/v1.6.16.md](./releases/v1.6.16.md)。

### 🔧 改进

- **Popup 首帧核心菜单"开包即用"**：v1.6.15 在 storage 预热完整菜单（~5ms），v1.6.16 更进一步——把 8 个最常用菜单项（速答 × 2 / 百度 / Google / ChatGPT / Claude / Google AI / Google 翻译）**直接写在 popup.html 里作为静态 DOM**，浏览器解析完 HTML 就立刻可见可点，完全不需要 fetch / storage.get / SW 应答。
- **Sidepanel 首帧同步**：同样把核心菜单写进 sidepanel.html，去掉 "加载中..." 占位，首装首次打开侧边栏即刻看到完整入口。
- **菜单交互无缝过渡**：dynamic 菜单（含百问 / 速答全套 / 优化提示词 / 封面生成器）异步加载完后自动 `innerHTML` 替换为完整菜单结构，用户感知不到切换。

### 🛠 技术改动

- `popup/popup.html`：8 个静态核心菜单项 + data-* 属性（id / type / engineId / urlPattern），删除 shimmer 骨架
- `popup/popup.js`：`init()` 把 `bindEvents` / `startKeywordLoad` / `initPinnedCover` / `_preloadEnableState` 提前到菜单加载之前；新增 `itemFromElement(el)` 静态项解析 + 容器事件委托；`handleClick` 加 600ms keyword race 等待（用户在 keyword 还没到时秒点也能用上 fresh keyword）
- `sidepanel/sidepanel.html`：同样 8 个静态核心菜单项 + 删 "加载中..." 占位
- `sidepanel/sidepanel.js`：拆 `init()` 为 5 段独立异步链（port / static menu binding / pin / menu config / keyword），任一失败不再覆盖整页错误状态；新增 `bindTabRefreshListeners` / `bindRuntimeMessages` / `bindStaticMenuItems` / `itemFromElement`；dynamic createMenuItem 加 stopPropagation 防止与委托双触发
- 与 v1.6.15 prewarm 共存：storage 命中时菜单整体替换为完整结构，未命中时也至少有静态核心菜单可用

## v1.6.15 (2026-05-17)

Popup 预热到 chrome.storage.local —— 装/更新完后所有数据 ready，离线/慢盘/老设备打开 popup 也即时显示。详细见 [releases/v1.6.15.md](./releases/v1.6.15.md)。

### 🔧 改进

- **Popup 首屏从"6 次本地 fetch + builder"砍到"1 次 storage.get + 直接 render"**：v1.6.14 已让 popup 不走 background message，但还有 6 个 `chrome-extension://` 本地 fetch（虽然不走网络但在系统繁忙、磁盘竞争时累计 50-100ms）。v1.6.15 让 background 在 `onInstalled`（装/更新时）和 SW 冷启动时**预先构建好完整菜单结构并写入 `chrome.storage.local`**，popup 一打开只需 1 次 storage.get（~5ms）即可 render。
- **侧边栏按钮 label 即时显示**：之前"📑 打开侧边栏"/"📕 关闭侧边栏"切换要等 SW 应答 `getSidePanelState`（50-300ms 等 SW 唤醒）。现在 SW 在 sidepanel 连接/断开时主动写 `ccs_sp_open_<windowId>` 到 storage，popup 读了即时 label。SW 异步校正不一致的情况（罕见）。

### 🛠 技术改动

- `background/init.js`：新增 `prewarmPopupMenuStructure()` 和 `clearStaleSidepanelStates()`；onInstalled / SW 顶层 init 串接调用
- `background/events.js`：sidepanel port `onMessage` / `onDisconnect` 内追加 `persistSidePanelState(windowId)` 调用，写 `ccs_sp_open_<windowId>` 到 storage
- `popup/popup.js`：`init()` 拆出 `_tryReadPrewarm()`（优先路径）和 `_buildMenuFromFetch()`（v1.6.14 fallback）；`setupSidePanelButton()` 先读 storage 显示 label，后异步校正
- 新增 chrome.storage.local key：`ccs_popup_menu_prewarm` / `ccs_sp_open_<windowId>`
- 性能埋点 `[触触搜][PERF] popup TTFB: XXXms (storage-prewarm)` 标注 render source，方便诊断
- 打 tag `pre-popup-prewarm` 作回滚锚点

## v1.6.14 (2026-05-17)

Popup 启动路径**彻底重构** —— 首屏完全脱离 Service Worker，把"点扩展图标到看到菜单"的延迟从 250-700ms 砍到 < 150ms。详细见 [releases/v1.6.14.md](./releases/v1.6.14.md)。

### 🔧 改进

- **Popup 首屏完全脱离 Service Worker**：之前 popup 要等 background 应答 `getMenuStructure`，而 SW 冷启动要解析 24 个 .js / 339KB 代码才能响应；现在 popup 自己 fetch `config/*.json` + `prompts/*.json`（同源资源，10-30ms），自己用共享 `menuStructureBuilder` 纯函数拼菜单，**首屏 0 次 sendMessage**。
- **shimmer 骨架屏 + 极致 TTFB**：HTML 内直接渲染 3 条 shimmer 骨架条，约 20ms 视觉反馈；菜单数据到位（再 50-100ms）后一次性切换。首屏总目标 < 150ms。
- **彻底消除 700ms fallback 视觉抖动**：v1.6.13 加的 storage 缓存 + 700ms fallback timer + fresh 覆盖逻辑全部删除——本地 fetch 比这个机制还快，缓存反而拖累。

### 🛠 技术改动

- **新增 `shared/menuStructureBuilder.js`**：popup 和 background 共用同一份菜单结构纯函数（`CCSMenuStructureBuilder.build()`），SSoT 一致性保障，不会再出现"popup 菜单 vs 右键菜单不一致"。
- **`background/base.js` 的 `getPopupMenuStructure()` 改为薄包装**：内部 await 6 个 loader 后直接调 builder，372 行旧实现已删除。
- **Popup HTML 删除 3 个无用 `<script>`**：`MenuRenderer.js` / `SettingsManager.js` / `ToastHelper.js` 在 popup.js 里从未被引用（popup.js 内联了所有需要的功能），首屏脚本数 5 → 2。
- **Settings 5 次串行 storage.get 合并为 1 次**：用户点 ⚙️ 时 5 个 key 一次拉齐（enabled / ccs_debug / ccs_voice_enabled 等）。
- **提示词库 lazy load**：`PromptLibraryManager.js` 改为用户点"📚 提示词库"时再动态注入 `<script>`。首屏不下载这个模块。
- **回滚锚点**：本次重构前已打 `pre-popup-rebuild` tag；如出问题可一键 `git revert` 或 `git reset --hard pre-popup-rebuild`。
- **性能埋点**：popup.js 加 `performance.mark` —— 开发者在 popup devtools 控制台能看到 `[触触搜][PERF] popup TTFB: XXXms`，方便实测。

## v1.6.13 (2026-05-16)

Popup 启动路径性能优化 —— 消灭"点扩展图标后短暂白屏"的体感卡顿。详细见 [releases/v1.6.13.md](./releases/v1.6.13.md)。

### 🔧 改进

- **Popup 首次打开更快**：之前 popup 启动要等关键字 + 菜单结构两条网络/IPC 路径 `Promise.all` 一起回来才渲染；现在两条路径解耦，菜单到就先渲染、关键字回来再补徽章，再叠加 storage 缓存的菜单结构「秒显」，体感像本地页一样快。
- **后台菜单组装并行化**：高级功能子菜单的 4 个配置 loader（百问/速答/优化/封面）原本逐个 `await` 串行；改为同时启动并行等待，给一次性首次启动 SW 的场景剃掉一截延迟。

### 🛠 技术改动

- 新增 popup `chrome.storage.local` 菜单结构缓存（key 按 manifest version 失效），重新打开 popup 秒显上次菜单。
- 新增 700ms 兜底：若 background 异常未返回菜单结构，先用硬编码基础搜索/AI 项渲染，避免完全白屏。
- `popup/popup.js`：`init()` 拆为 `startMenuLoad()` / `startKeywordLoad()` / `applyKeyword()` / `readCachedMenuStructure()` / `writeCachedMenuStructure()` / `getFallbackMenuStructure()` 6 个独立方法，加载逻辑可测可读。

## v1.6.12 (2026-05-16)

Windows 下 popup 标题"触触搜"换行问题修复。详细见 [releases/v1.6.12.md](./releases/v1.6.12.md)。

### 🐛 修复

- **Windows 下 popup 顶部"触触搜"三个字会换行**：根因是 popup 总宽 280px，去掉左右 padding 后内容区 252px；右侧关键字徽章 wrap 固定 180px，左侧只剩 72px。macOS 用苹方字体刚好塞下，Windows 用微软雅黑同字号要宽 2-3px 直接溢出换行。修复：左侧 `.header-left` / `.menu-title` 加 `white-space: nowrap` + `flex-shrink: 0`，右侧 keyword wrap 从 180px 缩到 170px（徽章 max-width 同步 140 → 130），给 Windows 字体留 ~10px buffer。

## v1.6.11 (2026-05-16)

侧边栏关键字徽章稳定性大改 —— 解决"在 chrome:// 内置页拿不到 keyword""徽章切换时跳跃感"两个老问题，关键字获取链路统一过 `KeywordService` 门面。详细见 [releases/v1.6.11.md](./releases/v1.6.11.md)。

### 🐛 修复

- **侧边栏在 chrome:// 等内置页面拿不到关键字徽章**：根因是 manifest 只声明 `activeTab` 权限不够覆盖侧边栏长期挂着的查询场景，Chrome 会把返回 tab 对象里的 url/title 抹掉。新增 `tabs` 权限 + 在 background 主动用 `chrome.tabs.get(tabId)` 重读最新 tab 元数据。**对老用户升级无感**（已有 `<all_urls>` host_permission 涵盖了警告）。
- **徽章切换有/无关键字时的"跳跃感"**：之前 wrap 用 `min-width / max-width drawer 动画`仍有 1-2px 的高度抖动（不同 Chrome 版本对 flex 子项高度计算有差异）。改为彻底固定 `width + height`、内部 badge/buttons 通过 opacity 淡入淡出，header 完全静态。
- **popup 在 chrome:// 上"假成功"显示上一页旧关键字**：之前 storage 5 分钟瞬时缓存只比 tabId + TTL 不查 URL，加 URL 强校验避免跨页面误读。

### 🔧 改进

- **侧边栏关键字字体加大**（11px → 12px）；popup 关键字字体加大（12px → 13px）。max-width 同步上调避免过早截断。
- **关键字获取链路统一过 `KeywordService` 门面**（popup / sidepanel / 右键菜单 三个入口共用），意图驱动（`'popup-open'` / `'sidepanel-init'` / `'contextmenu-click'` ...），各自的 policy 表声明式管理。

### 🛠 技术改动

- 新增 `background/KeywordService.js`：意图 → policy 表 + storage 缓存 + `_hydrateContext` 兜底拿新鲜 tab 元数据。
- 新增 `shared/keywordClient.js`：popup + sidepanel 共用客户端，消除 `getCurrentKeyword` 双份代码重复。
- `manifest.json`：新增 `tabs` 权限（在已有 `<all_urls>` host_permission 下被警告合并覆盖，升级静默）。
- `sidepanel/sidepanel.js`：refresh 加 debounce + 空结果退避重试 + 多事件触发（防御性，根因修复在 background 侧）。
- `background/keywordResolver.js`：所有在线 candidate 失败后兜底读 `fallbackKeywordByTab[tabId]`（URL 强校验避免跨页污染）。
- `eslint.config.mjs`：注册 `KeywordService` / `CCSKeywordClient` / `KEYWORD_INTENTS` 三个新全局。
- `build.sh`：`COPY_DIRS` 加 `shared/`。

## v1.6.10 (2026-05-16)

Service Worker 启动时预热 prompt / 配置缓存 —— 首次冷启动 popup / 侧边栏的"反应慢"得到改善。详细见 [releases/v1.6.10.md](./releases/v1.6.10.md)。

### 🔧 改进

- **SW 启动时预热 6 个 JSON 配置缓存**：之前用户首次安装 / 浏览器重启后第一次点扩展图标或打开侧边栏，要串/并行 6 个 `fetch`（4 个 prompts/*.json + unifiedMenuConfig + engines.json）才能渲染菜单，体感"反应慢"。现在 SW 一启动就 fire-and-forget 并行触发这些 fetch，等用户实际点开时全是 cache hit。`onInstalled` / `onStartup` / 模块顶层兜底三处都接入。

### 🛠 技术改动

- `background/init.js`：新增 `prewarmPromptConfigs()` 辅助函数，幂等 + `Promise.allSettled` 容错。
- `sidepanel/sidepanel.html`：暂时隐藏 Stanley / HerName 两个入口（资料未备齐），核心代码（`members/` 目录 + JSON + JS 监听）全部保留，未来去掉 `hidden` 属性即可恢复。

## v1.6.9 (2026-05-15)

popup 置顶封面生成器卡片新增「📑 改风格 / 比例 → 侧边栏」副链接 —— 解决"popup 没有侧边栏 ✏️ + ⓘ 容易让人迷茫怎么换风格"的问题。详细见 [releases/v1.6.9.md](./releases/v1.6.9.md)。

### 🔧 改进

- **Popup 置顶卡片右下角新增「📑 改风格 / 比例 → 侧边栏」副链接**：极轻量（10px 琥珀色、opacity 0.6、hover 加下划线），点击复用已有 `openSidePanel()` 直接打开侧边栏。之前 popup pin 卡片只有主执行按钮，没给用户"切风格 / 改比例"的入口（sidepanel 有 ✏️ 编辑按钮 + ⓘ 说明）。直接搬 picker UI 进 popup 不现实（5 种风格 × 11 种比例塞不下 360px），改用副链接把用户引到侧边栏更对症。

### 🛠 技术改动

- `popup/popup.html`：`#popupPin` 内主按钮后新增 `#popupPinOpenSidepanel` 按钮。
- `popup/popup.css`：`.popup-pin` 改 `flex-direction: column`、gap 4px、底 padding 减 2px；新增 `.popup-pin-hint` 样式（`align-self: flex-end` 靠右、`font-size: 10px`、琥珀色 `#92400e`）。
- `popup/popup.js`：`bindPinnedCover()` 绑点击复用已有 `openSidePanel()`，零新逻辑。
- 改动文件：`popup/popup.html` / `popup/popup.css` / `popup/popup.js`。

## v1.6.8 (2026-05-14)

封面生成器子菜单顶部新增「🚀 打开以下全部预设风格」一键批量启动 —— 与速答/百问/优化的「打开以下全部」对称，一次开 4 个 tab 同步对比 4 种内置风格（二次元可爱 / 小红书 / 椰树牌 / 极简留白），同一 ChatGPT Images 2.0 引擎、各自独立的 prompt。详细见 [releases/v1.6.8.md](./releases/v1.6.8.md)。

### ✨ 新功能

- **封面生成器子菜单新增「🚀 打开以下全部预设风格」**：右键菜单 / popup 的「高级功能 > 封面生成器」展开后，顶部第一项就是它（与速答/百问的「打开以下全部」位置一致）。点击后**一次性开 4 个 tab**，每个 tab 用同一份选中文本 + 同一个比例（5:2 等用户在 sidepanel 设的）、但套不同风格的 prompt。让"挑哪个风格最戳"从「分别点 4 次」变成「点 1 次同屏比对」。

### 🛠 技术改动

- `AITaskRegistry` 引入 `openAllAxis` 语义：speed/top100/optimize 沿 **engine 轴**批量（一种 prompt × N 个引擎），cover 沿 **category 轴**批量（N 种 prompt × 同一个引擎）。声明式注册，未来加新任务直接选轴。
- `AITaskHandler.runAITask` 的 openAll 分支按 axis 分流；category 轴时为每个 category 单独构造 prompt（注入自己的 `${purpose}`），共享一份字数保护、URL 上限、ratio 注入。
- 跳过「自定义风格」批量打开（依赖 sidepanel 输入框，无 purpose 时打开是空提示），通过 `openAllSkipCategoryIds: ['custom']` 声明。
- `events.js` SSoT fast-path 从 `resolveMenuId` 解出 `parsed.openAll` 透传给 `runAITask`，popup 点击 `ccs-cover-open-all` 自动走批量路径。
- 改动文件：`background/tasks/AITaskRegistry.js` / `background/tasks/AITaskHandler.js` / `background/menuBuilder.js` / `background/base.js` / `background/events.js` / `background/utils/Constants.js`。

## v1.6.7 (2026-05-13)

三端封面生成器 pin 状态一致化 —— 右键菜单顶层、popup 顶部都加了与 sidepanel 同源的置顶快捷启动；popup 顺手修了展开 submenu 被 footer 盖住、橙色按钮窄屏换行两个小问题。详细见 [releases/v1.6.7.md](./releases/v1.6.7.md)。

### ✨ 新功能

- **右键菜单顶层新增置顶封面生成器项**：与 popup / sidepanel pin 同源 `chrome.storage.local`，用户在 sidepanel 切换风格后右键菜单标题（`🎨 封面生成器 · <当前风格>`）通过 `storage.onChanged` 实时同步，不用重启浏览器、不用 reload 扩展。位置在菜单最顶部第一项，与既有「高级功能 > 封面生成器」5 风格 submenu **并存**。
- **Popup 顶部新增置顶封面生成器卡片**：与 sidepanel `.sp-pin` 同款暖色琥珀渐变（padding 紧凑些适配窄屏），点击整张卡片一键启动当前置顶风格 + 关键字。不带编辑按钮（要换风格去 sidepanel ✏️）。
- **自定义风格新增第二个「💡 不知道填什么？」按钮**：(1) 跳 ChatGPT 让它列 30 个封面风格名；(2) 跳 Google 搜「ChatGPT Images 2.0 提示词」看社区博客 / Reddit 灵感。两种渠道互补。

### 🔧 改进

- **Popup 展开 submenu 后自动滚动到可视区**：之前在底部展开「高级功能」等 submenu 时最后一行会被 fixed `.menu-footer`（56px）盖住，必须手动再滚。改用 `transitionend` + `getBoundingClientRect()` 显式计算后 `scrollBy({behavior:'smooth'})`，submenu 底部稳定停在 footer 上方 12px。仅展开动作触发，收起不滚。
- **「打开/关闭侧边栏」橙色按钮加 nowrap**：之前 popup 窄屏被压窄时 "📑 打开侧边栏" / "📕 关闭侧边栏" 会被折成两行。给 `.panel-toggle` 加 `white-space: nowrap` 一行解决。

### 🛠 技术改动

- 三端 pin 状态走同一套 storage key（`PIN_STORAGE_KEY` / `CUSTOM_LINE_KEY` / `RATIO_KEY` / `CUSTOM_PURPOSE_KEY`），sidepanel 是 SSoT，popup / background 只读 + 监听。
- 右键菜单 ccs-cover-pinned 在 `menuHandlers.js` 层做 menuId 翻译为真实 leaf（`ccs-cover-{cat}-chatgpt-images`），复用既有 `runAITaskByMenuId` 快速通道，字数保护 / ratio 注入 / 日志全部复用，不动 `AITaskRegistry` / `AITaskHandler`。
- `installCoverPinSync()` 在 SW boot 顶层注册一次 `chrome.storage.onChanged` 监听，变化时 `chrome.contextMenus.update()` 单项标题而非 rebuild（菜单可能正在用户使用中）。
- 改动文件：`background/menuBuilder.js` / `background/menuHandlers.js` / `popup/popup.html` / `popup/popup.css` / `popup/popup.js` / `sidepanel/sidepanel.html` / `sidepanel/sidepanel.js`。

## v1.6.6 (2026-05-13)

封面生成器与三端 UI 一系列微调：新增 X (Twitter / 推特) Banner 比例预设、置顶卡片右上角显示当前比例、复制按钮加大到 26px、关键字 tooltip 加 400ms hover 延迟避免误触；顺手修了一个隐性 CSS class 冲突 bug。详细见 [releases/v1.6.6.md](./releases/v1.6.6.md)。

### ✨ 新功能

- **封面生成器新增 6:2 比例预设**：用于 X (Twitter / 推特) 个人主页 Banner 背景图（标准 1500×500，正好 3:1 = 6:2），排在 5:2 之后作为第二项。Label 兼顾 X / Twitter / 推特 三种叫法，搜索习惯都能命中。
- **侧边栏置顶卡片显示当前画面比例**：卡片右上角内侧低调显示 5:2 / 6:2 / 9:16 等当前选中的比例（10px 琥珀色 0.6 opacity），让用户不点 ✏️ 也能一眼看到当前比例。

### 🔧 改进

- **侧边栏置顶卡片重构为单行**：原 2 行（任务名 + 风格名）合并为单行（封面生成器 + 风格名 + ⓘ），卡片高度减约半行；删掉「（建议字数适中）」冗余文案（ⓘ popover 内有详细说明）。
- **Popup / Sidepanel 复制按钮加大到 26×26**：原 20-22px 在桌面端偏小，跨面板统一为 26px / 14px icon（sidepanel 语音按钮同步加大避免相邻按钮大小不齐）。
- **关键字 tooltip hover 加 400ms 延迟**：鼠标在 header 区域偶然经过不再立即弹出，键盘 Tab 主动聚焦仍立即显示（400ms 是 hover-intent 阈值，与 macOS Finder / VSCode 同档）。

### 🐛 修复

- **隐性 CSS class 冲突 bug**：原 `.sp-pin-ratio` 这个 class 同时被 sidepanel 置顶卡片的小字显示（`<span>`）和 picker 容器（`<div>` 白底/边框/padding/flex-column）使用，picker 规则把卡片 span 渲染成了大白方块。改名 `.sp-pin-corner-ratio` 彻底解耦。

### 🛠 技术改动

- 改动文件：`prompts/coverPrompts.json` / `sidepanel/sidepanel.js` / `sidepanel/sidepanel.html` / `sidepanel/sidepanel.css` / `popup/popup.css` / `manifest.json` / `package.json` / `README.md` / `welcome/welcome.html` / `releases/store-listing.txt`。
- CSS 净减约 16 行（清理 `.sp-pin-task-row` / `.sp-pin-style-row` 不再需要的中间容器）。

## v1.6.5 (2026-05-13)

UI 一致性微调 + 封面生成器默认风格调整。**无破坏改动**，老用户升级后体验差异：popup 复制按钮变得更精致、关键字 tooltip 颜色更和谐、风格列表里二次元可爱排到第一位。详细见 [releases/v1.6.5.md](./releases/v1.6.5.md)。

### 🔧 改进

- **Popup 复制按钮反馈对齐 sidepanel**：点击复制后由原来的底部 toast 改为按钮原地变绿底 + 显示 `✓` + 1.2s 后复原。两个面板同款按钮长得几乎一样，现在行为也完全一致，切换面板无割裂感。错误路径（"没有可复制的关键字" / "复制失败"）仍走 toast。
- **关键字 hover tooltip 改用天蓝主题色**：popup / sidepanel 两端的关键字预览悬浮框背景从原来的 gray-900（接近纯黑）改为 sky-700 `#0369a1`，与 header 渐变末端同系深蓝，整体主题协调度更高。
- **封面生成器「二次元可爱」调到风格列表第一位**：`coverPrompts.json` categories 数组顺序调整，三入口（右键 / popup / sidepanel）菜单渲染顺序自动跟随。市场判断「二次元可爱」最具传播性，前置主推。
- **新装用户的默认置顶切换到「二次元可爱」**：`sidepanel.js` 的 `DEFAULT_PIN` 从 `xiaohongshu` 改为 `anime-cute`。**老用户已 pin 过的不动**——仅首次打开 sidepanel 还没设置过置顶的新装用户受影响。

### 🛠 技术改动

- 改动文件：`popup/popup.js` / `popup/popup.css` / `sidepanel/sidepanel.css` / `sidepanel/sidepanel.html` / `sidepanel/sidepanel.js` / `prompts/coverPrompts.json` / `background/utils/Constants.js` / `manifest.json` / `package.json` / `README.md` / `welcome/welcome.html` / `releases/store-listing.txt`。
- 历史档案 `releases/v1.x.x.md` 与 `CHANGELOG.md` 旧版块保留原状，未追改风格顺序，以反映各版本发布当时的设计意图。

## v1.6.4 (2026-05-12)

SEO 文案修正：`ChatGPT Image 2.0`（单数）→ `ChatGPT Images 2.0`（复数，OpenAI 官方写法）；同时移除冗余的「（ChatGPT Images）」并列括注。**ZIP 与 v1.6.3 行为完全一致**，仅商店元信息文案差异。详细见 [releases/v1.6.4.md](./releases/v1.6.4.md)。

### 🔧 改进

- **manifest `name` / `description` 统一改为「ChatGPT Images 2.0」**：原 v1.6.2 引入的「ChatGPT Image 2.0」是用户搜索习惯写法，但 OpenAI 官方品牌名是 `ChatGPT Images`（复数）。统一为官方写法避免被识别为错别字，同时仍可命中带「Image」前缀的搜索。
- **删除冗余括注**：原 description / README / store-listing 里的 `ChatGPT Images 2.0（ChatGPT Images）` 现在前后已是同名，括号纯属重复 → 删除，释放商店 132 字符 description 配额。

### 🛠 技术改动

- 改动仅限文案，零代码逻辑变更；service worker / content script / 提示词模板 / engines.json 全部不动。
- 改动文件：`manifest.json` / `package.json` / `package-lock.json` / `README.md` / `welcome/welcome.html` / `releases/store-listing.txt` / `CHANGELOG.md`。
- `releases/v1.6.2.md` 保留原状作历史档案，未追改单复数。

## v1.6.3 (2026-05-12)

仅同步 `releases/store-listing.txt` 上架资料模板的 docs commit 留 tag。**ZIP 内容与 v1.6.2 功能完全一致**，扩展行为无任何差异。详细见 [releases/v1.6.3.md](./releases/v1.6.3.md)。

### 🛠 技术改动

- `releases/store-listing.txt` 同步 v1.6.2 SEO 文案 + v1.6.1 新增的两个内置风格（🌸 二次元可爱 / ⬜ 极简的留白）已经在 commit `1f304ad` 落地，本次发版仅打 tag 留作时间锚点。
- 该模板文件不进 zip（`build.sh` 只复制扩展本体，不复制 `releases/` 目录），因此对装机用户无任何影响。

## v1.6.2 (2026-05-12)

商店与文档 SEO 文案更新：manifest 名称 / 描述、README、welcome、package.json 同步加入「ChatGPT Images 2.0」关键字，方便用户在 Chrome Web Store / Google 搜索时命中。详细见 [releases/v1.6.2.md](./releases/v1.6.2.md)。

### 🔧 改进

- **manifest `name` 加入「ChatGPT Images 2.0 封面生成器」**：商店搜索结果与扩展列表中能直接看到核心卖点，方便目标用户识别。
- **manifest `description` 加入「基于 ChatGPT Images 2.0」**：同时保留「ChatGPT Images」（OpenAI 官方写法）兼容两种搜索拼写，覆盖 132 字符内的关键词组合。
- **README.md / welcome 页 SEO 文案同步**：H1 标题、tagline、封面生成器段落均提及 ChatGPT Images 2.0，GitHub 搜索 & 欢迎页阅读体验一致。
- **package.json `description` 替换为功能描述**：从原 tagline「轻触即搜，一触即达」改为含功能关键字的描述，便于 GitHub Topics / 第三方扫描器索引。

### 🛠 技术改动

- 改动仅限文案，无代码逻辑变更；service worker / content script / 提示词模板全部不动。
- 改动文件：`manifest.json` / `package.json` / `package-lock.json` / `README.md` / `welcome/welcome.html`。

## v1.6.1 (2026-05-12)

封面生成器扩容：新增「二次元可爱」「极简的留白」两个内置风格 + 自定义风格 textarea 上限大幅放宽。详细见 [releases/v1.6.1.md](./releases/v1.6.1.md)。

### ✨ 新功能

- **新增内置封面风格「二次元可爱」**：日系二次元可爱风格（随机各种），覆盖粉嫩马卡龙色调 / 圆润线条 / 大眼睛 Q 版 / 赛璐璐 / 水彩等卡哇伊调性。在右键菜单 / Popup / Sidepanel 三个入口同步出现。
- **新增内置封面风格「极简的留白」**：大面积留白 / 黑白灰为主 / 低饱和 / 细线条的高级感调性，但会在标题里随机挑 1～2 个关键字眼用一种鲜明饱和的非黑白灰颜色（朱红 / 橙黄 / 钴蓝 / 草绿 / 紫罗兰 / 桃粉 / 柠檬黄 任选其一）做视觉锚点，形成"通篇克制 + 一点鲜活"的杂志封面效果。

### 🔧 改进

- **自定义风格 textarea 上限 600 → 5000 字**：之前 600 字撑不下「二次元可爱」这类需要逐行加详细解释的预设库。HTML maxlength / counter 显示 / JS 保存兜底 三处同步放宽。
- **「💡 不知道填什么？」引导词全面更新**：跳 ChatGPT 时的提示词从原通用版换成《幸运星》系参考标尺，聚焦日系二次元日常 / 校园 / 轻喜剧 / 吐槽 / 宅文化方向，要求男女角色对半、避免黑暗 / 热血 / 赛博 / 欧美写实风。两种描述方式交替输出（完整句式 / 风格名+关键词）。
- **引导词二次精简**：初版引导词 800 字 → 365 字（URL 编码 6595 → 3069 字节），避免部分用户遇到 ChatGPT 端 URL 过长打不开的情况。

### 🛠 技术改动

- `prompts/coverPrompts.json` 新增 `anime-cute` / `minimal` 两条 category，沿用现有 `runAITaskByMenuId` 快速通道，无需碰 KNOWN_ENGINE_IDS。
- `background/utils/Constants.js` 同步登记两条 MENU_DEFINITIONS + COVER_CATEGORY_TITLES。
- 三处用户可见文案（manifest 描述 / welcome / README / sidepanel 提示）同步增列两个新风格名。

## v1.6.0 (2026-05-11)

侧边栏与 Popup 体验升级：关键字复制更顺手、完整关键字悬停即显，新增实验性语音选引擎入口，并继续打磨封面生成器与剪贴板兜底。详细见 [releases/v1.6.0.md](./releases/v1.6.0.md)。

### ✨ 新功能

- **Popup 关键字一键复制**：Popup 顶部关键字徽章右侧新增 📋 按钮，可直接把当前完整关键字复制到剪贴板，方便在其它页面或工具里复用。
- **侧边栏关键字一键复制**：侧边栏顶部关键字徽章右侧新增 📋 按钮，复制时优先保留 raw 原文，长段落和换行内容不会被压扁。
- **实验性语音选引擎**：新增默认关闭的语音选引擎能力，用户开启后可在有关键字时通过 🎤 说出引擎名，再从候选结果中确认，不会自动跳转。

### 🐛 修复

- **完整关键字悬停显示慢**：之前依赖浏览器原生 `title`，悬停后需要等浏览器延迟才显示完整内容。现在 Popup / 侧边栏改为自定义即时 tooltip，鼠标移上去几乎立刻显示完整关键字。
- **封面生成器 ⓘ 弹层残留**：侧边栏失焦、隐藏或切换窗口时，封面生成器说明弹层会自动收起，避免用户回来后看到过期浮层。
- **剪贴板关键字按钮可见性**：侧边栏剪贴板按钮在有关键字时保留为“更新关键字”，用户不需要先清空当前关键字，也能随时用剪贴板内容替换。

### 🔧 改进

- **封面风格参考提示优化**：继续调整封面生成器相关提示与风格参考入口，让用户更容易获得可用的封面风格关键词。
- **关键字 tooltip 视觉优化**：完整关键字浮层支持换行、长文本滚动和深色背景，不再受原短徽章省略号区域限制。

### 🛠 技术改动

- 语音功能通过 MV3 offscreen workaround 接入，默认关闭；仅在用户主动启用并点击 🎤 时进入识别流程。
- Popup / Side panel 的完整关键字显示从 `title` 属性迁移到 `data-full-keyword` + CSS hover/focus-within，避免原生 tooltip 延迟和样式不可控。

## v1.5.4 (2026-05-02)

侧边栏顶部蓝色 header 锁高度修复——切换页面时不再上下跳。详细见 [releases/v1.5.4.md](./releases/v1.5.4.md)。

### 🐛 修复

- **header 高度跳跃**：之前频繁切换页面时（有些页面提取到关键字、有些没有），顶部蓝色 header 会在 28px ↔ 32px 之间小幅抖动 4px，整个 sticky 区跟着跳，体验割裂。根因：keyword 徽章高度（19.4px）大于左侧 logo+标题（15.6px），`align-items:center` 让 header 跟随最高子元素变化。修复：`.sp-header` 加 `min-height: 32px` 锁高，徽章出现/消失都维持同高。

## v1.5.3 (2026-05-01)

侧边栏 UX 持续打磨：封面卡片置顶 + header 收窄省空间、剪贴板 / 自定义风格多项体验修复、新增 ⓘ 详情弹层。详细见 [releases/v1.5.3.md](./releases/v1.5.3.md)。

### ✨ 新功能

- **封面卡片置顶**：`.sp-pin` 从主滚动区搬进 sticky 区，菜单滚动时常驻视野。最终 sticky 顺序：(收窄)header → AI 检测温馨提示 → 剪贴板按钮 → 封面生成器卡片。
- **顶部蓝色 header 收窄**：padding 14/16 → 6/14、icon 20→15、标题 16→13、keyword 徽章紧凑化，整体省 ~22px 高度，刚好给新加入 sticky 的封面卡片腾位。
- **封面卡片 ⓘ 详情弹层**：标题旁加 ⓘ 图标，点击（非 hover，触屏 / 桌面行为统一）展开详情卡片，4 种关闭路径：再点 ⓘ / 点 × / 点弹层外部 / ESC。弹层内含字数篇幅建议（10–30 字）、风格 / 比例切换说明、💡 自定义风格参考入口、文字来源说明。
- **自定义风格 picker 加「💡 不知道填什么？」帮助按钮**：跳 ChatGPT 让它列 30 个封面风格名供参考，缓解部分用户"想不出风格关键词"的痛点。
- **置顶卡片标题加字数提示**：`封面生成器` → `封面生成器（建议字数适中）`，配合 title 兜全文「建议选择字数适中，否则图片效果不佳」。

### 🐛 修复

- **剪贴板读取被 500 字符 cap 截断**：之前 sidepanel 剪贴板按钮硬截 500 字，多段换行长文超出部分丢失。上限 500 → 6000 对齐 backend `LIMITS.aiChat`，下游 `applyTextLimit` 仍按 menuId 做引擎级保护。
- **剪贴板内容灌给搜索引擎查询失败**：之前所有菜单类型都用 `keyword.raw`（带换行），Google / Baidu 等搜索引擎收到 `%0A` 当噪声，查询语义被破坏。修复：`handleClick` 按 `item.type` 分流——搜索类（search/ai-search/ecommerce/translate/portal）用 `keyword.text`（合并空白成单空格），AI 对话 / 任务类继续用 `keyword.raw` 保段落结构。
- **手动剪贴板 keyword 优先级被悄悄替换**：之前 `refresh()` 仅在自动提取为空时保留手动值；只要后台返回任意内容（标题提取 / 缓存选区），剪贴板内容就被覆盖。表现为"最后一次动作不是 📋 时系统回到默认机制"。修复：手动设过 keyword 后 URL 不变就一律保留，唯一退出条件 = URL 切换或用户再点 📋 写新值。
- **自定义预设 textarea 保存时残留脏数据**：之前直接存 textarea 原文，行首尾空格 / 多余空行写入存储。修复：保存路径走 `parseCustomLines + join('\n')` 规范化清洗。

### 🔧 改进

- **picker 自动滚顶**：因为 `.sp-pin` 现在常驻顶部，picker 仍在主滚动区——用户滚到中段时点 ✏️，picker 出现在视野外。`openPicker()` 末尾加 `window.scrollTo({ top: 0, behavior: 'smooth' })` 确保可见。
- **自定义预设 label 不再被强制换行**：之前我加的 `flex: 1` + `min-width: 0` 让 label 在容器空间不够时被强制中途断词。改用 `white-space: nowrap` + 容器 `flex-wrap: wrap`，label 整段保持完整，按钮空间不够时优雅落到下一行。

### 🛠 技术改动

- 新增 `.sp-pin-task-info` ⓘ 图标交互模式：`<span>` 嵌套在 `<button>` 内（避免 nested button 非法 HTML），点击靠 `e.stopPropagation()` 阻止冒泡到外层封面生成 action；键盘可达性靠 `role="button" tabindex="0"` + Enter/Space keydown handler；`aria-expanded` 同步切换状态。
- `.sp-pin` 加 `position: relative`、`.sp-pin-task-popover` 用 `position: absolute; top: calc(100% - 1px)` 紧贴 `.sp-pin` 下边缘，`max-height: 70vh` 内滚兜底超长内容。
- `bindTaskInfoPopover()` 4 种关闭路径：`infoEl click toggle` / `closeBtn click` / `document click contains 检查` / `document keydown Escape`。

## v1.5.2 (2026-05-01)

封面生成器持续打磨：自定义风格升级为预设库、新增比例选择、若干 UX 细节修复。详细见 [releases/v1.5.2.md](./releases/v1.5.2.md)。

### ✨ 新功能

- **封面生成器 · 自定义风格预设库**：自定义风格升级为多行编辑——textarea 维护"风格预设库"，每行=一个独立预设；下方 dropdown 列出全部预设（前 15 字截断 + …），选哪行就用哪行；dropdown 自动跟随 textarea 实时变化（删了当前选中行回退第一行，没删则保持选择）。**新增行后自动跳转选中**——多行粘贴或末尾追加时立即指到最末新增项。
- **封面生成器 · 比例选择**：sidepanel 置顶 picker 内新增比例 dropdown，全局生效（适用所有封面调用——sidepanel / 右键 / popup）。10 个预设按"宽到窄"排序覆盖国内外主流自媒体平台：5:2 横幅 / 2.35:1 微信公众号 / 2:1 Twitter / 16:9 YouTube/B站 / 3:2 头条号 / 4:3 PPT / 1:1 Instagram/微博 / 4:5 / 3:4 小红书 / 9:16 抖音。支持自定义比例（W:H，最多 5 个滚动剔除）。
- **模板末尾「调整自定义风格」闭环提示**：ChatGPT 跳转后用户可读区追加一句"💡 如果生成图片效果不满意，请回到侧边栏调整「自定义风格」字眼后再试（风格关键词越具体，渲染越准）"。

### 🐛 修复

- **自定义风格的 purpose 没注入到 prompt**：之前选自定义风格时，模板里 `${purpose}` 会被 JSON 占位文本替代，用户实际填写的关键词丢失。根因是 events.js SSoT 通道没把 sidepanel 传过来的 `request.purpose` 透传给 `runAITask`。修复：加 `purposeOverride` 参数 + `buildTaskPrompt` 优先用 override。
- **置顶卡片副标题/dropdown 长文本挤爆容器**：超过 18 字的自定义风格行会把"✏️ 修改"按钮挤出可视区。根因是 `.sp-pin-action` 缺 `min-width: 0`，flex item 默认 `min-width: auto = content size`。修复：双层防御——应用层 truncate 统一 15 字 + CSS 给 `.sp-pin-action` 补 `min-width: 0`。
- **操作自定义编辑区不自动激活 custom 模式**：textarea oninput / dropdown onchange 都调 `activateCustomCategory()` 自动切 radio + 同步 UI；rebuild dropdown 末尾加 `sel.value = chosen` 防浏览器 selectedIndex 残留 quirk。

### 🔧 改进

- **置顶卡片图标** 📌 → 🎨：与 Constants.js MENU_DEFINITIONS / README / store-listing 全项目封面生成器统一标识对齐。

### 🛠 技术改动

- `coverPrompts.json` 模板硬编码 `5:2` → `${ratio}` 占位；新增 `custom` category。
- `AITaskRegistry.buildTaskPrompt` 加通用 `options.vars` 机制——未来加任意模板变量直接通过 `vars` 传入，无需改 schema。
- `AITaskHandler.runAITask` 抽 `collectTaskVars(taskId)`——cover task 自动从 storage 读 ratio，三端调用方零改动，**单一数据源**。
- 新 storage keys：`ccs_cover_aspect_ratio` / `ccs_cover_custom_ratios` / `ccs_cover_custom_selected_line`。
- README.md 功能特性段重写——完整反映 v1.2.0+ 至今所有新功能。
- `releases/store-listing.txt` 新建——长期单一文件，每次发版前覆盖式更新。

## v1.5.1 (2026-05-01)

### ✨ 新功能

- **侧边栏剪贴板读取按钮**：当关键字徽章为空时（说明当前页面无法识别选中文字，比如 `chrome://contextual-tasks/`、扩展商店等不允许 content script 注入的页面），侧边栏顶部会自动露出「📋 从剪贴板读取关键字」按钮。复制文字后点一下，立即把剪贴板内容写入关键字，菜单按钮可以正常跳转引擎。解决了 v1.4.0 之前 chrome:// 等"陌生协议页面"完全没法用的痛点。
- **欢迎页「立即打开侧边栏」按钮实时同步状态**：用户在欢迎页点开侧边栏后，如果不小心关掉，按钮会立即变回"打开"状态——不会让用户找不到入口。从 popup、浏览器右上侧边栏按钮等任意来源开关都同步。多窗口独立追踪。
- **popup 设置面板加「📖 查看欢迎页」入口**：用户首次安装的欢迎页关掉后想再看，可在 ⚙️ 设置 → 「📖 查看欢迎页」找回。

### 🐛 修复

- **Windows 上滚动文字失效**：侧边栏 ⚠️ 提醒条 + 欢迎页顶部横条的文字滚动在 Windows Chrome 上不工作，Mac 正常。原因是 CSS marquee 写法（`padding-left: 100%` 在 flex item + `min-width: 0` 子元素上）的百分比解析在 Windows 上有时序问题。修复：完全绕开 CSS animation，改用 `requestAnimationFrame` + 实测像素 + `transform: translateX(${px}px)` 手动驱动，跨平台像素一致。详见 `docs/archive/MARQUEE_SCROLL_WINDOWS.md`。
- **手动设的关键字会被 refresh 清空**：之前点剪贴板按钮设好关键字后，再点侧边栏菜单项时 `refresh()` 会重新自动提取关键字，chrome:// 页面拿不到就把手动设的关键字覆盖成空的，搜索引擎收到空字符串。修复：refresh 现在判断三种情况——URL 变了跟随新页 / URL 没变 + 用户手动设过 + 自动提取空 → 保留手动关键字 / 其它情况照常更新。
- **滚动时顶部提醒条 / 侧边栏置顶区微小 jitter**：从 `position: sticky` 改为 `position: fixed`，浏览器只用一次坐标计算，rock-solid 无浮动重绘。

### 🔧 改进

- **⚠️ 悬停浮层视觉强化**：原本浮层是纯白底 + 40% 透明 amber 边框，跟侧边栏白底反差太弱，用户感觉"里面没东西"。改成浅 amber 渐变底（`#fef3c7 → #fde68a`）+ 1.5px 实心 amber 边框 + amber 光晕阴影，跟侧边栏拉开明显对比，"这是一个独立的、有重要内容的卡片"。
- **AI 检测提醒文案加范围限定**：「图片生成后，建议截图另存新图...」→「**关于封面生成器**，图片生成后，建议截图另存新图...」。前缀让用户清楚这条提醒专属封面生成器，不会误以为是普通搜索的通用规则。同步改 4 处（侧边栏 banner / 欢迎页顶部横条 / 欢迎页警告卡片 / ChatGPT prompt 头条）。

### 🛠 技术改动

- 新增 `welcome-watcher` port 推送系统（`background/events.js`）：欢迎页连 port 上报 windowId，侧边栏 alive port 增减时自动广播给对应 window 的欢迎页订阅者。push-based 实时同步，0 延迟。SW 重启时欢迎页端 500ms 自动重连。
- 新增 `docs/TO-BE-IMPLEMENTED/` 目录归类待开发功能提案，与 `docs/archive/`（已解决）、`KNOWN_ISSUES.md`（已知 bug）形成语义对仗。
- 归档「智能截图功能」完整提案到 `docs/TO-BE-IMPLEMENTED/screenshot-feature.md`（含 3 路径评估、Chrome API 选型、6 大边界限制、6 个决策点、实施 checklist）。
- 剪贴板按钮的点击失败 / 状态卡死等边界场景已加 reset 兜底，按钮 DOM 状态总是保持干净。

## v1.4.0 (2026-04-30)

### ✨ 新功能

- **首次安装欢迎页**：装好扩展自动弹欢迎页（仅首次装弹，更新不打扰），介绍四种入口（侧边栏 / 悬浮面板 / 右键菜单 / Popup）+ 主打功能 + 视频教程 + 作者关注。其中"立即打开侧边栏"按钮一键体验侧边栏，解决新用户找不到侧边栏的痛点。
- **AI 检测规避提示双层引导**：欢迎页新增 ⚠️ 封面生成器使用提示 section（amber 卡片含闪耀光晕 + 斜向掠光动画），讲透"为什么生成图后要截图另存"——元数据指纹机制 / 平台后果（限流·降权·水印）/ 截图为何有效 + 截图快捷键。同时欢迎页顶部加 amber 滚动横条「图片生成后，建议截图另存新图再使用，避免被识别为AI产出 · 点击查看详情 →」，整条可点击平滑滚动跳到详细 section。
- **侧边栏 banner 文字横向滚动**：原静态文案改为 18 秒/loop 从右往左滚动（≈27px/秒，可读速度），鼠标悬停整行暂停方便读完。被动捕获用户视线。
- **未硬编码搜索引擎也能拿关键字**：`background/keywords.js` 加启发式参数提取兜底——20+ 个硬编码 hostname 全 fall-through 后，按"哪个 param 最像关键字"打分挑（命中常见 key 名 / 长度合理 / 含中文加分；像 URL / UUID / 纯数字大概率不是关键字 → 直接毙）。新搜索站点不用改代码也有不错的命中率。

### 🐛 修复

- **popup 底部 footer 短屏被滚走**：之前在分辨率低 / 浏览器窗口短的设备上，菜单内容超出 popup 高度时整个 popup 出现外层滚动条，「📑 打开侧边栏」按钮要滚到底部才能看到。改为 `position: fixed` 直接钉在 popup 视口底部，body 自身做 scroll container，跨设备稳定贴底。

### 🔧 改进

- **AI 检测提醒文案精简**：「图片生成后，建议截图成新文件上传自媒体，避免被识别为AI生成」→ 「图片生成后，建议截图另存新图再使用，避免被识别为AI产出」。「另存新图」比「成新文件」更直观（图片场景），「再使用」语义比「上传自媒体」更广（覆盖所有使用场景）。
- **popup「打开侧边栏」按钮升级实心 amber 填充**：白字 + amber 实底 + 字重 600 + 阴影，hover/active 加深，让按钮成 footer 视觉焦点；footer 上方加轻阴影强化 sticky 边界。

### 🛠 技术改动

- 新增 `welcome/welcome.{html,css,js}` 三个文件 + `background/events.js` 加 onInstalled 监听器（仅 reason==='install' 时触发）+ `build.sh` 把 `welcome/` 加入 REQUIRED_FILES + COPY_DIRS。
- popup CSS 抽出 `--ccs-popup-width / --ccs-popup-max-height / --ccs-popup-footer-height` 三个变量，避免散落魔法数。
- 所有动画都加 `prefers-reduced-motion` 媒体查询兜底，尊重系统级关动效偏好（无障碍）。
- 归档 `docs/archive/POPUP_FOOTER_STICKY_SHORT_DISPLAY.md` 记录 popup footer 短屏问题的失败路线（vh / dvh / JS innerHeight 同步 / setTimeout 轮询 / ResizeObserver）+ 最终方案，避免后续重蹈覆辙。

## v1.3.1 (2026-04-30)

### 🔧 改进

- **Chrome Web Store 列表标题强化关键词**：「触触搜」→「触触搜 - 多 AI 速答、封面生成器、提示词优化」，让用户在商店搜索 AI 速答 / 封面生成器 / 提示词优化任一关键词时直接命中。
- **Chrome Web Store 列表简介补充封面生成器风格**：「选中文本快速搜索和处理工具」→「选中文本快速搜索和处理工具，含封面生成器（内置小红书 / 椰树牌风格）」。避开「新功能 / 目前两款」等会过期的措辞。

## v1.3.0 (2026-04-30)

### ✨ 新功能

- **AI 检测规避提示**：封面生成器入口新增 ⚠️ 顶部 banner，悬停 ⚠️ 弹出全宽说明卡——讲清楚直接下载的图片自带 C2PA 元数据指纹（小红书 / 抖音 / 视频号等可一键识别为 AI 内容）、被识别后的代价（限流、降权、强制水印）、以及为什么截图能绕过。同口径文案也注入到 ChatGPT prompt 末尾，让用户在对话流里也能看到——双保障。
- **popup 按钮按状态切换显示「打开/关闭侧边栏」**：以前不管侧边栏开没开都显示「打开」，点了没反应。现在按实际状态切换文案与行为（`📑 打开侧边栏` ↔ `📕 关闭侧边栏`），多窗口独立追踪。

### 🛠 技术改动

- 绕过 Chrome MV3 没有 `sidePanel.isOpen()` / `close()` API 的限制：background 加 `sidePanelPortsByWindow` Map 按 windowId 追踪 port，sidepanel 启动时连 port 上报，关闭走 port 反向消息让 sidepanel 自调 `window.close()`。SW 重启 / 扩展重载时 sidepanel 端 500ms 自动重连，避免状态假报。
- 新增 `docs/KNOWN_ISSUES.md`，归档 `chrome://contextual-tasks/`（Chrome 内嵌 AI Mode 的内部协议）关键字提取失败问题——hostname 是 `contextual-tasks` 不是 `google.`，需要补分支；content script 因 chrome:// 协议禁注入，鼠标选区无解（Chrome 平台层硬限制）。文档含修复草稿代码 + 验证清单。

## v1.2.1 (2026-04-30)

### 🐛 修复

- **边栏关键字总是滞后/为空**：sidepanel 不能注入 content script，原本只能吃缓存和 URL/title 兜底，现在改为通过 `chrome.scripting.executeScript` 主动到 active tab 拉 `window.getSelection()`，和右键菜单走同一条路径。Popup 同样开启 `forceFresh`。
- **点击边栏菜单项时 keyword 仍可能是旧值**：`handleClick` 和 `pinned.execute()` 在分发前 `await refresh()` 重新拉一次选区，避免开着边栏改选区后用旧 keyword。

### 🔧 改进

- **封面生成器提示词**：模板改为「内容 / 风格 / 注意」三段式（之前是 `--要使用XX` 命令式），ChatGPT Images 解析更稳。
- **速答中篇回答补上排版要求**：与长篇对齐 ——「合理分段，段间空行，提升阅读体验」。

### 🛠 技术改动

- 修长期红的 CI lint：`eslint.config.mjs` 补登 v1.2.0 加进来但漏注册的 11 个 SW 全局（`getEngineTitle` / `runAITaskByMenuId` / `applyTextLimit` / `tryOpenMenuUrl` 等）。

## v1.2.0 (2026-04-29)

### ✨ 新功能

- **封面生成器**：右键菜单 / Popup / 侧边栏三端同步出现"🎨 封面生成器"，首批两种风格（小红书封面、椰树牌风格）×ChatGPT Images 2.0；提示词集中在 `prompts/coverPrompts.json`，扩展新风格只需改一个文件。
- **侧边栏置顶快捷动作**：侧边栏顶部固定可点击的快捷动作卡片，默认"封面生成器·小红书封面"；"✏️" 修改按钮展开 radio 切换风格，保存到 `chrome.storage.local` 跨会话持久化。

### 🔧 改进

- **速答模板两步流程**：第一步只出短篇（80 字以内带标题感）+ 中篇；末尾追加 A/B 两选项 —— A 续写长篇正文（无"长篇回答"字样、无追问），B 把短/中篇润色为更自然真实的表达（去掉"说真的""其实"等口头禅，"他"统一替换为"TA"）。
- **Popup 入口文案对齐**：底部 "📌 面板" → "📑 打开侧边栏"，图标和文案更直白。

### 🛠 技术改动

- 新引擎 `chatgpt-images` 登记到 `config/engines.json` SSoT。
- `AITaskRegistry` 注册 `cover` 任务，`KNOWN_ENGINE_IDS` 同步加 `chatgpt-images`，避免菜单点击解析静默失败。
- 修复 `build.sh` 严重缺文件 bug —— 之前打出来的 zip 缺 `background/` / `sidepanel/` / `config/` / `prompts/` / `content/` / `modules/` / `dockbar.js`，装上 service worker 直接挂；新版按 manifest 实际引用的文件清单复制，输出到上一层目录。

## Unreleased

### 改进
- 标题不换行：普通模式的弹窗标题与 Mini 模式一致，单行展示并省略溢出文本（悬停可见全文）。
- 设置面板可读性：提高文字对比度，展示“当前网站”域名；“加入黑名单/移出黑名单”按钮颜色对比更清晰。
- 实时文本更新：当继续用键盘扩展选择（如 Shift+→）时，面板标题与按钮提示会实时反映最新选中文本。
- 悬浮提示优化：功能按钮悬停时显示“功能名: 全文”（如“百度搜索: XXX”）。
- 快捷键：Ctrl+Shift+S 现在用于打开/关闭面板（切换）；Alt+S 打开面板；ESC 关闭。
- 右键菜单同步：首次右键即可刷新为最新选区/页面关键词，适配 ChatGPT / Claude 等快捷结果页。
- 自动恢复脚本：遇到 `Receiving end does not exist` 时，后台会自动注入内容脚本并重试同步。
- 调试日志强化：`[触触搜][MENU] context-preview-title-check` / `context-click-title-check` 现包含 `menuDisplay` / `menuRaw`，排查标题不同步更直观。
- 日志摘要：所有菜单事件在控制台输出中都会追加 `match/keyword/title` 等摘要字段，快速定位问题。
- 动态标题监听：侦听 `tab.title` 变化并即时刷新菜单标题，适配单页应用动态切换（如 ChatGPT 会话页）。
- 关键词预抓取：在标签页加载/激活时预计算 `prefetch-menu-state`，保证首次右键即可显示最新关键词。
- URL 关键词不再写入选区缓存：防止旧的备选词覆盖真正的用户选区，确保二级菜单首次同步成功。
- 二级菜单日志：`search-menu-title` 输出 `ccs-chuchusou` / `ccs-chatgpt` / `ccs-claude` 的实时标题与菜单快照，便于排查速答入口。
- 速答菜单日志：`fastqa-menu-title` 记录 `ccs-fastqa-root` / `ccs-fastqa-open-all` 的最新标题与快照。
- 菜单快照：`menu-title-snapshot` 在右键弹出后抓取核心菜单项的实际标题，用于比对更新是否落地。

## v2.0.0 (2025-08-26) 🚀 重大更新

### ✨ 新功能

#### 智能定位系统
- **智能位置计算**：自动选择最佳显示位置
  - 优先级：右下 → 右上 → 左下 → 左上 → 下方居中 → 上方居中
  - 确保 popover 始终在视窗内完整显示
  - 根据选中文本位置智能调整
- **位置记忆**：记住用户手动调整后的位置偏好

#### 拖拽支持
- **自由拖动**：按住标题栏即可拖动 popover 到任意位置
- **视觉反馈**：拖拽时显示半透明效果
- **位置保存**：拖拽后的位置自动保存，下次打开时记住位置

#### Mini 模式
- **紧凑布局**：只显示 5 个最常用的功能按钮
- **空间节省**：相比普通模式节省 70% 屏幕空间
- **快速切换**：一键在普通/Mini 模式之间切换
- **自定义按钮**：可配置 Mini 模式显示哪些按钮

#### 设置面板
- **显示模式**：
  - 普通模式：完整功能界面
  - Mini 模式：紧凑型界面
  - 禁用模式：临时关闭插件
- **透明度调节**：30% - 100% 可调，避免遮挡内容
- **黑名单管理**：
  - 一键将当前网站加入/移出黑名单
  - 黑名单网站自动禁用插件
- **数据持久化**：所有设置使用 chrome.storage 保存

### 💫 体验优化

- **动画效果**：
  - 淡入淡出动画让显示/隐藏更流畅
  - hover 效果优化
- **键盘支持**：
  - ESC 键快速关闭
  - 自动聚焦输入框（普通模式）
  - Tab 键导航（计划中）
- **Toast 提示**：优化提示消息显示效果
- **响应式设计**：根据模式自动调整尺寸

### 🔧 技术改进

- **状态管理**：完整的设置状态管理系统
- **数据持久化**：使用 chrome.storage.local API
- **代码重构**：模块化设计，提高可维护性
- **性能优化**：减少不必要的重渲染

---

## v1.0.0 (2025-08-26)

### 初始版本功能

- 文本选中自动弹出悬浮框
- 10 个快捷功能按钮（搜索、编码、复制等）
- 本地命令系统（/base64、/md5、/url 等）
- Shadow DOM 样式隔离
- Manifest V3 兼容

---

## 开发计划

### v2.1.0（计划中）
- [ ] 主题系统（深色模式、自定义配色）
- [ ] 快捷键自定义
- [ ] 命令历史记录
- [ ] 更多编码格式支持（JWT、Hex、Unicode）

### v2.2.0（计划中）
- [ ] 云同步设置
- [ ] 导入/导出配置
- [ ] 自定义功能按钮
- [ ] API 集成支持

### 长期计划
- [ ] AI 功能集成
- [ ] 多语言支持
- [ ] 团队协作功能
- [ ] 插件市场
