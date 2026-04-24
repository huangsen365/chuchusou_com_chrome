# 触触搜 Chrome 扩展 - 开发指南

## 项目概述

触触搜是一个 Chrome 扩展，提供文本选择后的快速搜索和处理功能。支持悬浮面板、右键菜单、Popup 菜单、Side Panel 四种交互方式。

## 当前状态快照（2026-04）

⚠️ **改代码前先读这段**，避免走冤枉路：

- **生产跑老流水线**：`background/{base.js, events.js, menuBuilder.js, menuHandlers.js}` 是主心脏。`INIT_CONFIG.useNewSystem = false`（写在 `background/init.js`），永远走兼容模式。
- **新架构已下线但未删除**：`MenuManager / menu/* / events/*` 共 7 个文件已搬到 `legacy/_unactivated/`，**不要**在 `background/` 里找它们。详见 `docs/TECH_DEBT_AUDIT.md`。
- **三个 SSoT 强制遵守**：
  - URL 模板 → `config/unifiedMenuConfig.json`（通过 `URLBuilder.loadFromConfig()` 装载，启动时即使兼容模式也装）
  - 引擎标题 → `config/engines.json`（通过 `globalThis.getEngineTitle(engineId, fallback)` 读取）
  - AI 任务定义 → `background/tasks/AITaskRegistry.js` 的 `TASK_DEFINITIONS`（速答/百问/优化统一走 `runAITaskByMenuId`）
- **添加新菜单**：改 `unifiedMenuConfig.json`；**添加新 AI 任务**：改 `TASK_DEFINITIONS` + 对应 prompts json。
- **字数保护总闸关闭**：`background/utils/TextLimits.js` 的 `TEXT_LIMITS_ENABLED = false`，两个主函数都 early return。所有截断/smartTruncate/toast/URL 硬上限代码保留作兜底，改一行即可恢复。
- **Smart Post / Smart Reply 已彻底删除**：popup 和 sidepanel 里都不存在。
- **老 switch-case fallback 要保留**：两处入口（`menuHandlers.js` / `events.js`）都在 SSoT 快速通道后加了 switch-case 作安全网，**不要擅自删**。

## 核心架构

### 文件结构

```
chuchusou_com_chrome/
├── manifest.json              # Manifest V3 配置
├── background/                # Service Worker 后台脚本
│   ├── index.js              # 入口点（importScripts）
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
│   ├── menuSystem.js         # 菜单系统外壳（new MenuManager 分支在 useNewSystem=true 时启用，当前未启用）
│   ├── KeywordSyncManager.js # 关键字同步管理
│   ├── base.js               # 核心业务函数 + 老菜单流（生产主流）
│   ├── events.js             # 事件监听（生产主流）
│   ├── menuBuilder.js        # 右键菜单构建（生产主流）
│   ├── menuHandlers.js       # 菜单处理（生产主流）
│   ├── config.js             # 配置加载 + getEngineTitle() SSoT
│   └── keywordResolver.js    # 关键字解析
├── content/                   # 内容脚本模块
│   ├── SelectionManager.js   # 选区管理器
│   ├── TextEncoder.js        # 文本编码工具
│   ├── ToastUI.js            # Toast 通知组件
│   └── ClipboardHelper.js    # 剪贴板助手
├── content.js                 # 主内容脚本
├── content.css                # 悬浮面板样式
├── popup/                     # Popup 菜单
│   ├── popup.html
│   ├── popup.js
│   ├── popup.css
│   └── modules/              # Popup 模块（MenuRenderer / SettingsManager / ToastHelper）
├── sidepanel/                 # Side Panel（侧边栏）
│   ├── sidepanel.html
│   ├── sidepanel.js
│   └── sidepanel.css
├── config/                    # 配置文件
│   ├── unifiedMenuConfig.json # 统一菜单 URL 模板 SSoT
│   └── engines.json          # 引擎标题 SSoT（icon + label）
├── prompts/                   # 提示词模板
│   ├── topQuestionsPrompts.json
│   ├── fastAnswersPrompts.json
│   └── optimizedPrompts.json
├── legacy/_unactivated/       # 🧟 未激活新架构存档（MenuManager / menu/* / events/*，零真实调用）
├── docs/
│   ├── TECH_DEBT_AUDIT.md    # 技术债审计（2026-04）
│   └── archive/              # 历史设计文档
└── icons/                     # 扩展图标
```

### 模块加载顺序

#### Background (Service Worker)
```javascript
// background/index.js（当前实际顺序，详见文件）
importScripts(
  // 第1层：工具
  './utils/Constants.js',
  './utils/TextUtils.js',
  './utils/TextLimits.js',
  './Logger.js',
  // 第2层：核心管理器
  './MenuRegistry.js',
  './KeywordSyncManager.js',
  './menuIds.js',
  './StateManager.js',
  './URLBuilder.js',
  // './MenuManager.js',   // 僵尸，已搬 legacy/_unactivated/
  './menuSystem.js',
  // 第3层：老业务（生产主流）
  './config.js', './icons.js', './keywords.js', './keywordResolver.js',
  './base.js',
  // 第3.5层：AI 任务统一抽象
  './tasks/AITaskRegistry.js', './tasks/AITaskHandler.js',
  './menuBuilder.js', './menuHandlers.js', './events.js',
  // 第4层：新架构 —— 全部已搬 legacy/_unactivated/，注释保留作恢复指引
  // './menu/MenuBuilder.js', './menu/MenuUpdater.js', './menu/MenuHandlers.js',
  // './events/TabEvents.js', './events/MessageEvents.js', './events/MenuEvents.js',
  // 第5层：初始化
  './init.js'
);
```

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
   - 由 `menuBuilder.js` 的 `createContextMenus()` 构建
   - 使用 `MENU_DEFINITIONS`、`MENU_GROUPS` 和动态配置

2. **Popup 菜单**（点击扩展图标）
   - `popup.js` 通过 `getMenuStructure` 消息从 background 获取菜单结构
   - `base.js` 的 `getPopupMenuStructure()` 返回与右键菜单一致的结构

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

#### Menu 模块

- **MenuBuilder.js**: 菜单构建工具
  - `createMenuItem()`: 创建菜单项
  - `createMenuItemsGroup()`: 批量创建
  - `createSeparator()`: 创建分隔符

- **MenuUpdater.js**: 动态标题更新
  - `updateMainMenuTitle()`: 更新主菜单
  - `updateLabelMenuTitles()`: 批量更新标签
  - `handleMenuShown()`: 处理菜单显示事件

- **MenuHandlers.js**: 点击处理
  - `handleSearchMenu()`: 处理搜索菜单
  - `handleToolMenu()`: 处理工具菜单
  - `handleTopQuestionsMenu()`: 处理百问菜单

#### Events 模块

- **TabEvents.js**: 标签页事件
  - `handleTabUpdated()`: 标签更新
  - `handleTabActivated()`: 标签激活
  - `handleTabRemoved()`: 标签关闭

- **MessageEvents.js**: 消息处理
  - `handleGetSearchText()`: 获取搜索文本
  - `handleExecuteMenuAction()`: 执行菜单操作
  - `handleContextMenuPreview()`: 上下文预览

- **MenuEvents.js**: 菜单事件
  - `handleMenuShown()`: 菜单显示
  - `prefetchMenuState()`: 预取菜单状态

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
   - 运行时各老路径（`menuHandlers.js` / `events.js` / `MessageEvents.js`）已接入 `tryOpenMenuUrl()` 快速通道，命中后跳过硬编码

老路径（渐进移除中）：在 `utils/Constants.js` 的 `MENU_DEFINITIONS` 加 `{ text, icon }`、在 `background/menuBuilder.js` 的分组数组里登记 id、在 `background/base.js` 的 `getPopupMenuStructure()` 相应 `searchItems` / `toolItems` 里加。工具/复制/编码类（非 URL）菜单仍走老 switch-case。

**工具/命令类菜单项（`ccs-copy`、`ccs-base64` 等）**

这类没有 URL 模板，仍需走老路径：
1. `utils/Constants.js` `MENU_DEFINITIONS` 登记 title/icon
2. `background/menuBuilder.js` 加入分组
3. `background/menuHandlers.js` / `background/events.js` switch-case 里加处理分支
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
- `menuHandlers.js` 的 top100 / fastqa / optimize 分支
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
node --check background/base.js

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

// base.js
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

# 语法检查所有 background 脚本
for f in background/*.js background/**/*.js; do node --check "$f"; done
```
