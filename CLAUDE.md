# 触触搜 Chrome 扩展 - 开发指南

## 项目概述

触触搜是一个 Chrome 扩展，提供文本选择后的快速搜索和处理功能。支持悬浮面板、右键菜单和 Popup 菜单三种交互方式。

## 核心架构

### 文件结构

```
chuchusou_com_chrome/
├── manifest.json              # Manifest V3 配置
├── background/                # Service Worker 后台脚本
│   ├── index.js              # 入口点（importScripts）
│   ├── utils/                # 工具模块
│   │   ├── Constants.js      # 常量定义（MENU_DEFINITIONS等）
│   │   └── TextUtils.js      # 文本处理函数
│   ├── menu/                 # 菜单模块（新架构）
│   │   ├── MenuBuilder.js    # 菜单构建工具类
│   │   ├── MenuUpdater.js    # 动态标题更新
│   │   └── MenuHandlers.js   # 点击处理逻辑
│   ├── events/               # 事件模块（新架构）
│   │   ├── TabEvents.js      # 标签页事件处理
│   │   ├── MessageEvents.js  # 消息事件处理
│   │   └── MenuEvents.js     # 菜单事件处理
│   ├── StateManager.js       # 状态管理器
│   ├── MenuRegistry.js       # 菜单注册表
│   ├── KeywordSyncManager.js # 关键字同步管理
│   ├── base.js               # 核心状态与函数（逐步迁移中）
│   ├── events.js             # 事件监听（兼容模式）
│   ├── menuBuilder.js        # 右键菜单构建（兼容模式）
│   ├── menuHandlers.js       # 菜单处理（兼容模式）
│   ├── config.js             # 配置加载
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
│   ├── popup.js              # 主脚本
│   ├── popup.css
│   └── modules/              # Popup 模块
│       ├── MenuRenderer.js   # 菜单渲染器
│       ├── SettingsManager.js# 设置管理器
│       └── ToastHelper.js    # Toast 助手
├── config/                    # 配置文件
│   ├── unifiedMenuConfig.json # 统一菜单配置
│   └── engines.json          # 引擎配置
├── prompts/                   # 提示词模板
│   ├── topQuestionsPrompts.json
│   ├── fastAnswersPrompts.json
│   └── optimizedPrompts.json
└── icons/                     # 扩展图标
```

### 模块加载顺序

#### Background (Service Worker)
```javascript
// background/index.js
importScripts(
  // 工具模块（最先）
  './utils/Constants.js',
  './utils/TextUtils.js',
  './Logger.js',
  // 新架构核心
  './MenuRegistry.js',
  './KeywordSyncManager.js',
  './menuIds.js',
  './StateManager.js',
  './URLBuilder.js',
  './MenuManager.js',
  './menuSystem.js',
  // 新菜单模块
  './menu/MenuBuilder.js',
  './menu/MenuUpdater.js',
  './menu/MenuHandlers.js',
  // 新事件模块
  './events/TabEvents.js',
  './events/MessageEvents.js',
  './events/MenuEvents.js',
  // 兼容模式模块
  './base.js',
  './config.js',
  ...
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
