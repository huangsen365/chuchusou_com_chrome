# 触触搜 Chrome 扩展 - 开发指南

## 项目概述

触触搜是一个 Chrome 扩展，提供文本选择后的快速搜索和处理功能。支持悬浮面板、右键菜单和 Popup 菜单三种交互方式。

## 核心架构

### 文件结构

```
chuchusou_com_chrome/
├── manifest.json              # Manifest V3 配置
├── background/                # Service Worker 后台脚本
│   ├── base.js               # 基础定义、菜单状态管理、getPopupMenuStructure()
│   ├── events.js             # 消息处理、事件监听
│   ├── menuBuilder.js        # 右键菜单构建
│   ├── menuHandlers.js       # 菜单点击处理
│   ├── config.js             # 配置加载函数
│   ├── MenuRegistry.js       # 菜单注册表
│   ├── KeywordSyncManager.js # 关键字同步管理
│   └── keywordResolver.js    # 关键字解析
├── content/                   # 内容脚本
│   ├── content.js            # 主内容脚本
│   └── content.css           # 悬浮面板样式
├── popup/                     # Popup 菜单（点击扩展图标）
│   ├── popup.html
│   ├── popup.js              # 从 background 获取菜单结构
│   ├── popup.css
│   └── _archived/            # 旧版 popup 归档
├── config/                    # 配置文件
│   ├── unifiedMenuConfig.json # 统一菜单配置（仅参考）
│   ├── menuToggles.json      # 菜单启用/禁用配置
│   └── menuIcons.json        # 菜单图标配置
├── prompts/                   # 提示词模板
│   ├── topQuestionsPrompts.json    # 百问提示词
│   ├── fastAnswersPrompts.json     # 速答提示词
│   └── optimizedPrompts.json       # 优化提示词
└── icons/                     # 扩展图标
```

### 菜单系统

#### 三种菜单入口

1. **右键菜单** (`chrome.contextMenus`)
   - 由 `menuBuilder.js` 的 `createContextMenus()` 构建
   - 使用 `MENU_DEFINITIONS`、`MENU_GROUPS` 和动态配置

2. **Popup 菜单**（点击扩展图标）
   - `popup.js` 通过 `getMenuStructure` 消息从 background 获取菜单结构
   - `base.js` 的 `getPopupMenuStructure()` 返回与右键菜单一致的结构
   - 支持多级嵌套子菜单（如优化提示词的三级结构）

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
      id: 'general',        // 通用搜索
      items: [...]
    },
    {
      id: 'advanced',       // 高级功能（动态加载）
      items: [
        {
          id: 'ccs-top100-root',      // 百问
          type: 'submenu',
          children: [...]
        },
        {
          id: 'ccs-fastqa-root',      // 速答
          type: 'submenu',
          children: [...]
        },
        {
          id: 'ccs-optimize-root',    // 优化提示词（三级）
          type: 'submenu',
          children: [
            {
              id: 'ccs-optimize-deep-research',
              type: 'submenu',
              children: [{ id, title, type: 'optimize', purpose, urlPattern }]
            }
          ]
        }
      ]
    },
    {
      id: 'tool',           // 工具
      items: [{ id, title, icon, type, action }]
    },
    {
      id: 'transform',      // 文本转换
      items: [...]
    }
  ]
}
```

### 消息通信

#### Popup → Background 消息

| action | 描述 | 参数 |
|--------|------|------|
| `getMenuStructure` | 获取菜单结构 | - |
| `getSearchText` | 获取当前关键字 | tabId, url, title |
| `executeMenuAction` | 执行菜单操作 | menuItemId, menuType, keyword, urlPattern, actionType, engineId, purpose |
| `getMenuDebugInfo` | 获取调试信息 | tabId |

#### Content → Background 消息

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
| `ecommerce` | 电商搜索 | urlPattern |
| `translate` | 翻译 | urlPattern |
| `portal` | 门户 | urlPattern |
| `fastqa` / `fastqa-quick` | 速答 | engineId |
| `top100` | 百问 | engineId |
| `optimize` | 优化提示词 | purpose, urlPattern |
| `tool` / `transform` | 工具/转换 | action |
| `action` | 动作 | actionType |
| `submenu` | 子菜单容器 | children |

### 关键函数

#### base.js

- `MENU_DEFINITIONS` - 静态菜单定义
- `FAST_QA_QUICK_ITEMS` - 快速问答项
- `getPopupMenuStructure()` - 生成 Popup 菜单结构
- `setMenuState()` - 更新菜单状态
- `isMenuEnabled()` - 检查菜单是否启用

#### config.js

- `loadMenuToggleConfig()` - 加载菜单开关配置
- `loadTopQuestionsConfig()` - 加载百问配置
- `loadFastAnswersConfig()` - 加载速答配置
- `loadOptimizedPromptConfig()` - 加载优化提示词配置
- `buildOptimizedPrompt(purpose, input)` - 构建优化提示词

#### menuBuilder.js

- `createContextMenus()` - 创建右键菜单
- `MENU_GROUPS` - 菜单分组定义

## 开发注意事项

### 菜单一致性

Popup 菜单和右键菜单必须保持一致：
- Popup 通过 `getMenuStructure` 从 background 获取结构
- `getPopupMenuStructure()` 使用与 `createContextMenus()` 相同的数据源
- 动态配置（百问、速答、优化提示词）从 `prompts/` 目录加载

### 添加新菜单项

1. 在 `base.js` 的 `MENU_DEFINITIONS` 添加定义
2. 在 `menuBuilder.js` 的 `MENU_GROUPS` 或相应位置添加
3. 在 `getPopupMenuStructure()` 相应位置添加
4. 在 `events.js` 的 `executeMenuAction` 添加处理逻辑
5. 在 `config/menuToggles.json` 添加开关（可选）

### 调试

- 开启调试：设置 → 调试日志：开
- 日志前缀：`[触触搜][MENU]`
- 导出菜单状态：设置 → 导出菜单状态
