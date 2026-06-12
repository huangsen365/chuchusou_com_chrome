# 触触搜 Chrome 扩展 - 开发指南

## 项目概述

触触搜是一个 Chrome 扩展，提供文本选择后的快速搜索和处理功能。当前生产交互入口为右键菜单、Popup 菜单、Side Panel 三种；悬浮面板/底部 dock 暂时关闭（content.js 把 createPopover/__initDockBar 设为 noop，旧逻辑保留在 `legacy/content.panel-legacy.js`）。

## 当前状态快照（2026-06）

⚠️ **改代码前先读这段**，避免走冤枉路：

- **SW 双层架构**：Plasmo SW bundle (TS, `src/background.ts` → `static/background/index.js`) + legacy `background/*.js` importScripts 桥接。
- **已退役的 6 个 legacy 文件**（~3200 行）已移到 `legacy/background-retired/`（不进 build / 不进商店 zip，详见该目录 README）：
  - `base.js` (889) → src/background/{baseBridge,tabState,menuTitles,menuTitleUpdater,
    menuStateOrchestrator,menuActions,menuDebugInfo,popupMenuStructure,bootstrap}.ts
  - `Logger.js` (458) → src/background/Logger.ts (via baseBridge)；仍被 dual 校验脚本当 legacy 对照源加载
  - `menuHandlers.js` (611) → src/background/menuHandlersAttach.ts (TS chrome.contextMenus.onClicked listener)
  - `menuBuilder.js` (718) → src/background/menuBuilderAttach.ts (+ menuBuilderHelpers.ts，createContextMenus orchestrator)
  - `voiceOffscreenBridge.js` (100) → src/background/voiceOffscreenBridge.ts (autoRegisterVoiceBridge)
  - `init.js` (448) → src/background/{init,initAttach,initPrewarming}.ts
- **剩余 1 个 listener 主体仍在 legacy**：`background/events.js`
  包含 chrome.tabs.onUpdated / chrome.runtime.onConnect / chrome.runtime.onMessage /
  chrome.contextMenus.onShown。port 这部分需要回归 ≥ 20 路径——其中 **15 条已被
  `npm run verify:extension-smoke` 自动化**（SW 启动 / 桥接符号 / getMenuStructure /
  getKeyword / ccsDiagPing / getMenuDebugInfo / sidepanel-alive port / selectionChanged
  选区回路 / executeMenuAction search 开标签 / URL 关键字提取 / ccs_kw_ 缓存写入契约 /
  真实选区捕获（本地 HTTP 页 + trusted 鼠标事件 → content.js → SW）/
  右键菜单动态标题（contextMenus.update 间谍）/ popup 与 sidepanel UI 启动渲染）；
  剩余路径（原生菜单 UI 渲染、popup/sidepanel 点按实操、voice 录音）仍需真机。
- **SW bundle 加载时序**（关键，见 `src/background.ts` 注释，顺序不要随意交换）：
  1. Plasmo ESM 评估 → attachBaseBridge() / attachMenuBuilder() / attachMenuHandlers() /
     autoRegisterVoiceBridge() **先于 importScripts 调用**（events.js 顶层会立刻引用
     `createContextMenus` / `globalThis.setMenuState` 等，提供方必须先就位）
  2. importScripts 20 个 legacy 模块（Constants / TextUtils / TextLimits / chatgptPromptRelay /
     urlSafety / shared/menuStructureBuilder / MenuRegistry / KeywordSyncManager / menuIds /
     StateManager / URLBuilder / menuSystem / config / icons / keywords / keywordResolver /
     KeywordService / AITaskRegistry / AITaskHandler / events）
  3. attachInit() **最后调用**（依赖 importScripts 提供的 g.MenuSystem / g.initKeywordSyncSystem）
- **新架构已彻底删除**（v1.6.18+）：`MenuManager / menu/* / events/*` 共 7 个文件 3384 行已删（曾经放在 `legacy/_unactivated/`）。审计见 `docs/TECH_DEBT_AUDIT.md`。
- **三个 SSoT 强制遵守**：
  - URL 模板 → `config/unifiedMenuConfig.json`（通过 `URLBuilder.loadFromConfig()` 装载，启动时即使兼容模式也装）
  - 引擎标题 → `config/engines.json`（通过 `globalThis.getEngineTitle(engineId, fallback)` 读取）
  - AI 任务定义 → `background/tasks/AITaskRegistry.js` 的 `TASK_DEFINITIONS`（速答/百问/优化统一走 `runAITaskByMenuId`）
- **添加新菜单**：改 `unifiedMenuConfig.json`；**添加新 AI 任务**：改 `TASK_DEFINITIONS` + 对应 prompts json。
- **字数保护总闸关闭**：`background/utils/TextLimits.js` 的 `TEXT_LIMITS_ENABLED = false`，两个主函数都 early return。所有截断/smartTruncate/toast/URL 硬上限代码保留作兜底，改一行即可恢复。
- **Smart Post / Smart Reply 已彻底删除**：popup 和 sidepanel 里都不存在。
- **老 switch-case fallback 要保留**：两处入口（`src/background/menuHandlersAttach.ts` / `background/events.js`）都在 SSoT 快速通道后加了 switch-case 作安全网，**不要擅自删**。
- **发版必走 `/release` skill**：版本号 bump（manifest / package / package-lock 三处必须同步）、CHANGELOG / releases/vX.Y.Z.md、`./build.sh`、commit / tag / push 都已编排在 `.claude/skills/release/SKILL.md`。**不要凭记忆手动发版**——历史上 `package.json` 长期停留 1.0.0、CI 红 5 个 commit 才发现都是手动流程漏步骤导致。

## 核心架构

### 文件结构

```
chuchusou_com_chrome/
├── manifest.json              # Manifest V3 配置（源模板；build 时 postbuild 会 patch SW 入口）
├── src/                       # TS 源码（Plasmo 编译）
│   ├── background.ts         # 生产 SW 唯一入口（attach* + importScripts 桥接）
│   ├── background/           # legacy 的 TS 移植（baseBridge / menuBuilderAttach /
│   │                         #   menuHandlersAttach / initAttach / Logger / ...）
│   └── shared/               # TS 共享常量（coverPinConstants 等）
├── background/                # legacy Service Worker 脚本（仍在运行时的部分）
│   ├── index.js              # legacy 入口（importScripts；与 src/background.ts 保持同序，
│   │                         #   由 verify-sw-bridge 强制校验）
│   ├── utils/                # 工具模块
│   │   ├── Constants.js      # 常量定义（MENU_DEFINITIONS / OPTIMIZE_CATEGORY_TITLES 等）
│   │   ├── TextUtils.js      # 文本处理函数
│   │   └── TextLimits.js     # 字数保护（总闸 TEXT_LIMITS_ENABLED，当前关闭）
│   ├── tasks/                # AI 任务统一抽象（速答/百问/优化）
│   │   ├── AITaskRegistry.js # TASK_DEFINITIONS 声明式注册表
│   │   └── AITaskHandler.js  # runAITaskByMenuId 统一入口
│   ├── StateManager.js       # 状态管理器
│   ├── MenuRegistry.js       # 菜单注册表
│   ├── URLBuilder.js         # URL 模板构建器（SSoT: unifiedMenuConfig.json）
│   ├── menuSystem.js         # 菜单系统外壳
│   ├── KeywordSyncManager.js # 关键字同步管理
│   ├── KeywordService.js     # 关键字服务
│   ├── chatgptPromptRelay.js # AI prompt relay（长 prompt 不走 URL 直开）
│   ├── urlSafety.js          # URL 安全（截断 / 431/404 恢复）
│   ├── events.js             # 事件监听（生产主流，最后一个未 port 的 listener 主体）
│   ├── config.js             # 配置加载 + getEngineTitle() SSoT
│   └── keywordResolver.js    # 关键字解析
├── shared/                    # 前后台共用 JS（keywordClient / runtimeClient / logger /
│                              #   menuStructureBuilder —— SW 也 importScripts 它）
├── content/                   # 内容脚本模块（SelectionManager / TextEncoder / ToastUI / ClipboardHelper）
├── modules/                   # 内容脚本主体模块（manifest 按序加载 20 个）
├── content.js                 # 主内容脚本
├── content.css                # 悬浮面板样式
├── dockbar.js                 # 底部 dock 栏内容脚本
├── popup/                     # Popup 菜单（生产，action.default_popup）
│   └── modules/              # MenuRenderer / SettingsManager / ToastHelper / PromptLibraryManager
├── popup-v2/                  # Popup 重写版（备用，未在 manifest 启用，随包发布可一键切换）
├── sidepanel/                 # Side Panel（生产，side_panel.default_path）
├── sidepanel-v2/              # Side Panel 重写版（备用，未在 manifest 启用）
├── offscreen/                 # 语音识别 offscreen 文档
├── voice-permission/          # 麦克风授权引导页
├── config/                    # 配置文件
│   ├── unifiedMenuConfig.json # 统一菜单 URL 模板 SSoT
│   └── engines.json          # 引擎标题 SSoT（icon + label）
├── prompts/                   # 提示词模板（topQuestions / fastAnswers / optimized / cover）
├── scripts/                   # 构建 + 校验脚本（npm test 全链的所有关卡都在这，
│                              #   含链尾 headless Chrome 扩展冒烟回归）
├── legacy/                    # 🗑 退役代码（不进 build / zip，eslint ignore）
│   ├── background-retired/   # 6 个已退役 legacy SW 文件（见该目录 README）
│   └── content.panel-legacy.js
├── docs/
│   ├── TECH_DEBT_AUDIT.md    # 技术债审计
│   └── archive/              # 历史设计文档
└── icons/                     # 扩展图标
```

### 模块加载顺序

#### Background (Service Worker)

生产 SW 入口是 `src/background.ts`（Plasmo 编译到 `static/background/index.js`），顺序：

```javascript
// src/background.ts（当前实际顺序，详见文件注释）
attachBaseBridge()        // ← 必须先于 importScripts：events.js 顶层会引用 setMenuState 等
attachMenuBuilder()       // ← createContextMenus / COVER_PIN_MENU_ID
attachMenuHandlers()      // ← chrome.contextMenus.onClicked
autoRegisterVoiceBridge() // ← voice onMessage bridge

importScripts(
  // 第1层：工具
  'background/utils/Constants.js', 'background/utils/TextUtils.js',
  'background/utils/TextLimits.js', 'background/chatgptPromptRelay.js',
  'background/urlSafety.js', 'shared/menuStructureBuilder.js',
  // 第2层：核心管理器
  'background/MenuRegistry.js', 'background/KeywordSyncManager.js', 'background/menuIds.js',
  'background/StateManager.js', 'background/URLBuilder.js', 'background/menuSystem.js',
  // 第3层：业务
  'background/config.js', 'background/icons.js', 'background/keywords.js',
  'background/keywordResolver.js', 'background/KeywordService.js',
  // 第3.5层：AI 任务统一抽象
  'background/tasks/AITaskRegistry.js', 'background/tasks/AITaskHandler.js',
  // 第4层：事件（最后一个 legacy listener 主体）
  'background/events.js'
)

attachInit()              // ← 必须在 importScripts 之后：依赖 g.MenuSystem / g.initKeywordSyncSystem
```

`background/index.js`（legacy 入口）保持同一份 importScripts 列表，`npm run verify:sw-bridge`
强制两边 20 个 import 顺序一致（且 events.js 必须在末位）—— 改加载顺序时两处要同改。

#### Content Scripts
按 manifest.json 中定义的顺序加载，新模块优先：
1. `content/SelectionManager.js`
2. `content/TextEncoder.js`
3. `content/ToastUI.js`
4. `content/ClipboardHelper.js`
5. `modules/*.js`
6. `content.js`

### 菜单系统

#### 三种菜单入口

1. **右键菜单** (`chrome.contextMenus`)
   - 由 `src/background/menuBuilderAttach.ts` 的 `createContextMenus()` 构建
   - 使用 `MENU_DEFINITIONS`、`MENU_GROUPS` 和动态配置

2. **Popup 菜单**（点击扩展图标）
   - `popup.js` 通过 `getMenuStructure` 消息从 background 获取菜单结构
   - `src/background/popupMenuStructure.ts` 的 `getPopupMenuStructure()` 返回与右键菜单一致的结构

3. **悬浮面板**（鼠标选中文本后显示）
   - 由 `content.js` 管理
   - 显示常用快捷按钮

#### 菜单结构

```javascript
// getPopupMenuStructure() 返回格式
{
  groups: [
    {
      id: 'fastQaQuick',    // 快速问答
      separator: 'after',
      items: [{ id, title, icon, type, engineId }]
    },
    {
      id: 'search',         // 搜索引擎
      items: [{ id, title, icon, type, urlPattern }]
    },
    {
      id: 'ai',             // AI 对话
      items: [...]
    },
    {
      id: 'advanced',       // 高级功能
      items: [
        {
          id: 'ccs-top100-root',
          type: 'submenu',
          children: [...]
        },
        {
          id: 'ccs-optimize-root',
          type: 'submenu',
          children: [{ type: 'submenu', children: [...] }]
        }
      ]
    },
    {
      id: 'tool',           // 工具
      items: [{ id, title, icon, type, action }]
    }
  ]
}
```

### 新模块说明

#### Utils 模块

- **Constants.js**: 集中定义所有常量
  - `LOG_PREFIX`, `STORAGE_KEYS`
  - `MENU_DEFINITIONS`: 菜单项定义
  - `FAST_QA_QUICK_ITEMS`: 快速问答项
  - `OPTIMIZE_CATEGORY_TITLES`: 优化分类标题

- **TextUtils.js**: 文本处理函数
  - `formatMenuTitle()`: 格式化菜单标题
  - `normalizeSearchText()`: 规范化搜索文本
  - `cleanupTitleKeyword()`: 清理标题关键词

#### 后台菜单/事件逻辑（TS port）

菜单构建、标题更新、点击处理已全部 port 到 `src/background/`：

- **menuBuilderAttach.ts**：`createContextMenus()` orchestrator（右键菜单全量构建）
- **menuTitleUpdater.ts / menuTitles.ts**：动态菜单标题（含 onShown 时的关键字注入）
- **menuHandlersAttach.ts**：`chrome.contextMenus.onClicked` 监听 + search/tool/top100/fastqa/optimize 分支
- **menuStateOrchestrator.ts / menuActions.ts / popupMenuStructure.ts**：菜单状态、动作执行、popup 菜单结构

标签页事件 / runtime 消息（onUpdated / onConnect / onMessage / onShown）仍在
`background/events.js`（最后一个未 port 的 legacy 主体，改它要 Chrome 真机回归）。

#### Content 模块

- **SelectionManager.js**: 选区管理
  - `readCurrentSelection()`: 读取选区
  - `applySelection()`: 应用选区
  - `getSnapshot()`: 获取快照

- **TextEncoder.js**: 编码工具
  - `encodeBase64()`, `decodeBase64()`
  - `encodeURL()`, `decodeURL()`
  - `pseudoMD5()`: 伪 MD5
  - `runCommand()`: 执行命令

#### Popup 模块

- **MenuRenderer.js**: 菜单渲染
  - `render()`: 渲染菜单
  - `_createMenuItem()`: 创建菜单项
  - `_toggleSubmenu()`: 切换子菜单

- **SettingsManager.js**: 设置管理
  - `toggleExtension()`: 切换扩展状态
  - `toggleDebug()`: 切换调试模式
  - `loadBlacklist()`: 加载黑名单

### 消息通信

#### Popup → Background

| action | 描述 | 参数 |
|--------|------|------|
| `getMenuStructure` | 获取菜单结构 | - |
| `getSearchText` | 获取当前关键字 | tabId, url, title |
| `executeMenuAction` | 执行菜单操作 | menuItemId, menuType, keyword, urlPattern, actionType, engineId, purpose |
| `getMenuDebugInfo` | 获取调试信息 | tabId |

#### Content → Background

| action | 描述 |
|--------|------|
| `selectionChanged` | 选中文本变化 |
| `contextMenuPreview` | 右键菜单预览 |

### 菜单类型 (menuType)

| 类型 | 描述 | 必需参数 |
|------|------|----------|
| `search` | 普通搜索 | urlPattern |
| `ai-chat` | AI 对话 | urlPattern |
| `ai-search` | AI 搜索 | urlPattern |
| `fastqa` | 速答 | engineId |
| `top100` | 百问 | engineId |
| `optimize` | 优化提示词 | purpose, urlPattern |
| `tool` | 工具 | action |
| `submenu` | 子菜单容器 | children |

## 开发注意事项

### 菜单一致性

Popup 菜单和右键菜单必须保持一致：
- Popup 通过 `getMenuStructure` 从 background 获取结构
- `getPopupMenuStructure()` 使用与 `createContextMenus()` 相同的数据源
- 动态配置从 `prompts/` 目录加载

### 添加新菜单项

**普通搜索/AI 类菜单项（有 URL 的）**

推荐路径（SSoT）：只需改 1 处——
1. 在 `config/unifiedMenuConfig.json` 对应分组 `items` 里新增一项（含 `id` / `type` / `title` / `icon` / `urlPattern` / `enabled`）。
   - 启动时 `URLBuilder.loadFromConfig()` 会自动注册 URL 模板
   - 运行时各入口（`src/background/menuHandlersAttach.ts` / `background/events.js`）已接入 `tryOpenMenuUrl()` 快速通道，命中后跳过硬编码

老路径（渐进移除中）：在 `utils/Constants.js` 的 `MENU_DEFINITIONS` 加 `{ text, icon }`、在 `src/background/menuBuilderAttach.ts` 的分组数组里登记 id、在 `src/background/popupMenuStructure.ts` 的 `getPopupMenuStructure()` 相应 `searchItems` / `toolItems` 里加。工具/复制/编码类（非 URL）菜单仍走老 switch-case。

**工具/命令类菜单项（`ccs-copy`、`ccs-base64` 等）**

这类没有 URL 模板，仍需走老路径：
1. `utils/Constants.js` `MENU_DEFINITIONS` 登记 title/icon
2. `src/background/menuBuilderAttach.ts` 加入分组
3. `src/background/menuHandlersAttach.ts` / `background/events.js` switch-case 里加处理分支
4. `config/unifiedMenuConfig.json` 登记（用于 popup/sidepanel 展示）

### 字数保护（TextLimits）

为防止用户选中过长文字导致 URL 超限（Google/Google AI 模式 ~2048 字符上限），
`background/utils/TextLimits.js` 统一处理：

- **软提示阈值**：选中原文 > 1500 字符触发 toast 温馨提示
- **硬截断上限**（按 menuId 自动分档）
  - Google AI 模式 (udm=50): 1200 字符
  - AI 对话（ChatGPT/Claude/Grok/文心）: 6000 字符
  - 普通搜索/电商/翻译: 1500 字符
- **最终 URL 兜底**：构造后的 URL 若仍 > 1900 字符，强制截断

挂钩点（均已接入，修改上限请改 `TextLimits.js` LIMITS 常量）：
- `tryOpenMenuUrl()` - SSoT 快速通道
- `handleExecuteMenuAction()` - popup/sidepanel 主路径
- `src/background/menuHandlersAttach.ts` 的 top100 / fastqa / optimize 分支
- `events.js` 的 executeMenuAction 老消息路径

### 调试

- 开启调试：设置 → 调试日志：开
- 日志前缀：`[触触搜][MENU]`
- 导出菜单状态：设置 → 导出菜单状态

### 代码风格

- 新模块使用类封装，导出到 `globalThis` 或 `window.CCSModules`
- 使用条件检查避免重复定义
- 保持向后兼容，逐步迁移到新架构

## 开发工具

### ESLint 配置

项目使用 ESLint 进行代码检查，配置文件为 `eslint.config.mjs`。

```bash
# 运行 ESLint 检查
npx eslint background/ content/ popup/ modules/

# 检查所有 JS 文件
npx eslint .
```

ESLint 配置了所有 Chrome Extension API 和项目全局变量，包括：
- Browser globals (window, document, console 等)
- Chrome Extension APIs (chrome.*)
- Service Worker globals (importScripts, globalThis, self)
- 项目特定的全局变量 (Constants.js 导出的变量等)

### 错误分析工具

`scripts/analyze-errors.js` 是一个自定义的 ESLint 错误分析工具，用于快速定位问题。

```bash
# 运行错误分析
node scripts/analyze-errors.js
```

输出内容：
- **ERRORS BY RULE**: 按规则分组显示错误数量，对于 `no-undef` 错误会列出所有未定义的变量名
- **ERRORS BY FILE**: 按文件分组显示错误，每个文件显示前 5 个错误
- **TOTAL**: 总错误数

这个工具特别适合在重构后快速发现：
- 未定义的变量（可能需要添加 globalThis 导出）
- 重复声明的变量（Service Worker 共享作用域问题）
- 未使用的变量

### 语法检查

对于 Service Worker 脚本，可以使用 Node.js 进行快速语法检查：

```bash
# 检查单个文件
node --check background/events.js

# 批量检查所有 background 脚本
for file in background/*.js background/**/*.js; do
  echo "=== Checking: $file ==="
  node --check "$file" 2>&1 || echo "SYNTAX ERROR in $file"
done
```

### 重复声明检测

Service Worker 使用 `importScripts()` 加载脚本，所有脚本共享同一个全局作用域。因此不能在多个文件中使用 `let` 或 `const` 声明同名变量。

常见问题模式：
```javascript
// Constants.js
const MY_VAR = 'value';  // 第一次声明

// events.js
const MY_VAR = 'value';  // ❌ 错误：Identifier 'MY_VAR' has already been declared
```

解决方案：
1. 将变量集中到 `Constants.js` 中定义
2. 在其他文件中通过 `globalThis.MY_VAR` 访问
3. 或使用 `if (typeof MY_VAR === 'undefined')` 条件检查

### 常用开发命令

```bash
# 安装依赖
npm install

# ESLint 检查
npx eslint .

# 分析错误（推荐）
node scripts/analyze-errors.js

# 扩展冒烟回归（headless Chrome 真装 build 产物：SW 启动 + 桥接符号 + 消息协议）
# npm test 链尾自动跑；无 Chrome / 无全局 WebSocket（Node<21）/ 无 build 时优雅跳过
npm run verify:extension-smoke

# 语法检查所有 background 脚本
for f in background/*.js background/**/*.js; do node --check "$f"; done
```

## 发布流程

**用 `/release` skill 走标准流程**（定义在 `.claude/skills/release/SKILL.md`）：

1. 读 manifest.json + `git log <last_tag>..HEAD` 决策 semver 等级（patch/minor/major）
2. 同步 bump 三处版本字段：`manifest.json` / `package.json` / `package-lock.json`（顶层 + `packages.""` 两处）
3. CHANGELOG.md 顶部插新版块（修复 / 改进 / 技术改动）
4. `releases/vX.Y.Z.md` 按 `releases/v1.2.0.md` 格式写发布说明
5. `npm test` + JSON 合法性检查
6. `./build.sh` 出 zip → 自动落到 `../chuchusou_chrome_extension_vX.Y.Z.zip`
7. 验收 zip：文件数 / 大小 / 顶层目录齐全（曾出过漏复制 `background/` 等关键目录的事故）
8. 本地装一下试 → commit → 打 tag → push（push 前必须问用户）

**关键原则**：
- 用户口头说"minor 版本/小版本" **多半是指 PATCH**，不要直接套 semver MINOR；先报你的判断给用户拍板
- 三处 version 字段必须**同步** —— 历史上 `package.json` 长期停留在 `1.0.0`，与 `manifest.json` 严重脱节
- v1.2.0 没打 tag → `git log v1.2.0..HEAD` 取不到差量；从今往后每个 release 都打 annotated tag
- ZIP 上架后**只能发新版覆盖**，不能回滚 → 没本地装过的版本不要 push tag、不要上传商店

skill 内部已经把每一步的命令、决策点、历史教训都列清楚了，**不要凭记忆手动发版**。
