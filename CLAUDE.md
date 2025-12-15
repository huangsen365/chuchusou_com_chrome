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

1. 在 `utils/Constants.js` 的 `MENU_DEFINITIONS` 添加定义
2. 在 `menuBuilder.js` 相应位置添加
3. 在 `getPopupMenuStructure()` 相应位置添加
4. 在 `events.js` 的消息处理添加逻辑
5. 在 `config/unifiedMenuConfig.json` 添加开关（可选）

### 调试

- 开启调试：设置 → 调试日志：开
- 日志前缀：`[触触搜][MENU]`
- 导出菜单状态：设置 → 导出菜单状态

### 代码风格

- 新模块使用类封装，导出到 `globalThis` 或 `window.CCSModules`
- 使用条件检查避免重复定义
- 保持向后兼容，逐步迁移到新架构
