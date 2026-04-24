# 触触搜新菜单系统 - 使用示例

本文档展示如何在兼容模式下，在现有代码中使用新的菜单系统工具。

---

## 📋 目录

1. [在 menuHandlers.js 中使用 URLBuilder](#在-menuhandlersjs-中使用-urlbuilder)
2. [在 base.js 中使用 StateManager](#在-basejs-中使用-statemanager)
3. [使用日志系统](#使用日志系统)
4. [调试命令](#调试命令)
5. [性能优化技巧](#性能优化技巧)

---

## 在 menuHandlers.js 中使用 URLBuilder

### 问题：大量的 switch-case 语句

**旧代码**（`menuHandlers.js`）：

```javascript
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const normalizedText = normalizeSearchText(rawText);

  switch (info.menuItemId) {
    case 'ccs-baidu':
      chrome.tabs.create({
        url: `https://www.baidu.com/s?wd=${encodeURIComponent(normalizedText)}`
      });
      break;

    case 'ccs-google':
      chrome.tabs.create({
        url: `https://www.google.com/search?q=${encodeURIComponent(normalizedText)}`
      });
      break;

    case 'ccs-chatgpt':
      chrome.tabs.create({
        url: `https://chatgpt.com/?q=${encodeURIComponent(normalizedText)}`
      });
      break;

    // ... 20+ 个类似的 case
  }
});
```

**问题**：
- ❌ 200+ 行 switch-case
- ❌ URL 硬编码，难以修改
- ❌ 重复的 `encodeURIComponent` 调用
- ❌ 新增菜单需要修改代码

---

### 解决方案：使用 URLBuilder

**新代码**（兼容模式）：

```javascript
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const rawText = info.selectionText || tab.title || '';
  const normalizedText = normalizeSearchText(rawText);

  // ✅ 使用 URLBuilder 构建 URL
  const urlBuilder = MenuSystem.getURLBuilder();
  const url = urlBuilder.build(info.menuItemId, {
    raw: rawText,
    normalized: normalizedText
  });

  if (url) {
    chrome.tabs.create({ url });
  } else {
    // 如果 URLBuilder 没有注册此菜单，回退到旧逻辑
    handleLegacyMenuItem(info, tab);
  }
});

// 处理旧菜单项（逐步迁移）
function handleLegacyMenuItem(info, tab) {
  switch (info.menuItemId) {
    case 'ccs-copy':
      // 工具类菜单，保留旧逻辑
      navigator.clipboard.writeText(info.selectionText || '');
      break;

    // 其他特殊菜单...
  }
}
```

**优势**：
- ✅ 代码量减少 80%
- ✅ URL 统一在配置文件中管理
- ✅ 自动处理 URL 编码
- ✅ 新增菜单只需修改 JSON

---

## 在 base.js 中使用 StateManager

### 问题：多个全局状态对象

**旧代码**（`base.js`）：

```javascript
// 4 个全局状态对象
const currentMenuState = {
  raw: '',
  normalized: '',
  display: '',
  tabId: null,
  url: ''
};

const selectedTextByTab = {}; // { [tabId]: { text, url } }
const fallbackKeywordByTab = {}; // { [tabId]: { raw, normalized, timestamp, url } }
const latestTitleByTab = {}; // { [tabId]: { title, keyword, ... } }

// 分散的更新逻辑
function setMenuState(rawText, normalizedText, meta) {
  currentMenuState.raw = rawText;
  currentMenuState.normalized = normalizedText;
  currentMenuState.display = formatMenuTitle(rawText);
  currentMenuState.tabId = meta?.tabId;
  currentMenuState.url = meta?.url;
}

function updateSelectedText(tabId, text, url) {
  selectedTextByTab[tabId] = { text, url };
}

// ... 更多状态管理函数
```

**问题**：
- ❌ 4 个全局对象难以管理
- ❌ 状态同步复杂
- ❌ 没有自动清理机制
- ❌ 缺乏类型安全

---

### 解决方案：使用 StateManager

**新代码**（兼容模式）：

```javascript
// ✅ 使用 StateManager（兼容旧 API）
function setMenuState(rawText, normalizedText, meta) {
  MenuSystem.setMenuState(rawText, normalizedText, meta);
}

function updateSelectedText(tabId, text, url) {
  const stateManager = MenuSystem.getStateManager();
  stateManager.setSelection(tabId, text, url);
}

function getFallbackKeyword(tabId) {
  const stateManager = MenuSystem.getStateManager();
  const fallback = stateManager.getFallback(tabId);
  return fallback ? fallback.raw : '';
}

// 自动清理过期状态（由 StateManager 自动执行）
// 无需手动清理！
```

**或者，直接使用 StateManager**：

```javascript
const stateManager = MenuSystem.getStateManager();

// 设置当前状态
stateManager.setCurrentState({
  raw: '搜索词',
  normalized: '搜索词',
  display: '搜索词',
  tabId: 123,
  url: 'https://example.com'
});

// 设置标签页选中文本
stateManager.setSelection(tabId, selectedText, url);

// 获取标签页状态
const tabState = stateManager.getTabState(tabId);
console.log(tabState);
// {
//   selection: { text: '...', url: '...', timestamp: ... },
//   fallback: { raw: '...', normalized: '...', ... },
//   title: { text: '...', keyword: '...', ... },
//   meta: { url: '...', createdAt: ..., updatedAt: ... }
// }
```

**优势**：
- ✅ 统一的状态管理
- ✅ 自动清理过期状态（每 5 分钟）
- ✅ 使用 Map 存储，性能更好
- ✅ 向后兼容旧 API

---

## 使用日志系统

### 替代 console.log

**旧代码**：

```javascript
console.log('[MenuBuilder] Creating menu:', menuId);
console.warn('[MenuBuilder] Menu creation failed:', error);
console.error('[MenuHandlers] Click handler error:', error);
```

**新代码**：

```javascript
const logger = getLogger('MenuBuilder');

logger.debug('Creating menu', { menuId });
logger.warn('Menu creation failed', { error });
logger.error('Click handler error', { error });
```

### 日志级别控制

```javascript
// 生产环境：只显示警告和错误
Logger.setGlobalLevel(Logger.LEVELS.WARN);

// 开发环境：显示所有日志
Logger.setGlobalLevel(Logger.LEVELS.DEBUG);

// 完全禁用日志（提升性能）
Logger.setGlobalEnabled(false);
```

### 结构化日志

```javascript
const logger = getLogger('MenuHandlers');

logger.group('处理菜单点击');
logger.debug('菜单ID', { menuItemId: info.menuItemId });
logger.debug('选中文本', { text: info.selectionText });
logger.debug('标签页', { tabId: tab.id, url: tab.url });
logger.groupEnd();
```

### 性能监控

```javascript
const logger = getLogger('MenuBuilder');

logger.time('Build全部菜单');

await createAllMenus();

logger.timeEnd('Build全部菜单');
// 输出: [触触搜] [MenuBuilder] Build全部菜单: 234ms
```

---

## 调试命令

在 Chrome DevTools Console 中使用这些调试命令：

### 查看菜单系统状态

```javascript
// 查看当前状态
_debugMenuSystem.stateManager.getStats();

// 查看所有 URL 模板
_debugMenuSystem.urlBuilder.getStats();

// 测试 URL 构建
_debugTestUrl('ccs-baidu', { raw: '测试', normalized: '测试' });
// 输出: ccs-baidu => https://www.baidu.com/s?wd=%E6%B5%8B%E8%AF%95
```

### 日志调试

```javascript
// 设置日志级别
_loggerDebug.setLevel('DEBUG');  // 或 'INFO', 'WARN', 'ERROR'

// 查看日志历史
_loggerDebug.history({ module: 'MenuManager', limit: 10 });

// 导出日志
_loggerDebug.export();

// 清空日志
_loggerDebug.clear();
```

### 重建菜单

```javascript
// 重建所有菜单
_debugRebuildMenus();
```

---

## 性能优化技巧

### 1. 批量操作使用 Promise.all

**旧代码**（串行）：

```javascript
for (const item of menuItems) {
  await createMenuItem(item);
}
```

**新代码**（并行）：

```javascript
await Promise.all(
  menuItems.map(item => createMenuItem(item))
);
```

### 2. 使用防抖减少菜单更新频率

```javascript
// 防抖函数
function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// 防抖更新菜单标题
const debouncedRefreshMenuTitle = debounce(refreshMenuTitle, 300);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.title) {
    debouncedRefreshMenuTitle(tab);
  }
});
```

### 3. 生产环境关闭调试日志

```javascript
// 在 init.js 中
if (chrome.runtime.getManifest().version) {
  // 生产版本，关闭调试日志
  Logger.setGlobalLevel(Logger.LEVELS.WARN);
} else {
  // 开发版本，启用所有日志
  Logger.setGlobalLevel(Logger.LEVELS.DEBUG);
}
```

### 4. 使用 Map 代替对象

**旧代码**：

```javascript
const menuMap = {};
menuMap[menuId] = menuConfig;
```

**新代码**：

```javascript
const menuMap = new Map();
menuMap.set(menuId, menuConfig);
```

**优势**：
- ✅ Map 的键可以是任意类型
- ✅ 性能更好（大量数据时）
- ✅ 有 `size` 属性
- ✅ 可遍历

---

## 完整示例：优化 menuHandlers.js

```javascript
// 获取工具
const urlBuilder = MenuSystem.getURLBuilder();
const stateManager = MenuSystem.getStateManager();
const logger = getLogger('MenuHandlers');

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  logger.debug('菜单点击', { menuItemId: info.menuItemId });

  // 1. 获取文本
  const rawText = info.selectionText || tab.title || '';
  const normalizedText = normalizeSearchText(rawText);

  // 2. 更新状态
  stateManager.setCurrentState({
    raw: rawText,
    normalized: normalizedText,
    display: MenuSystem.formatMenuTitle(rawText),
    tabId: tab.id,
    url: tab.url
  });

  // 3. 构建 URL
  const url = urlBuilder.build(info.menuItemId, {
    raw: rawText,
    normalized: normalizedText
  });

  // 4. 打开标签页
  if (url) {
    logger.info('打开URL', { url });
    await chrome.tabs.create({ url });
  } else {
    logger.warn('未找到URL模板', { menuItemId: info.menuItemId });
    // 回退到旧逻辑
    handleLegacyMenuItem(info, tab);
  }
});
```

---

## 总结

### 迁移策略

1. **第一步**：加载新模块（已完成）
2. **第二步**：在旧代码中使用新工具（逐步替换）
   - 用 `URLBuilder` 替代硬编码的 URL
   - 用 `StateManager` 替代全局状态对象
   - 用 `Logger` 替代 `console.log`
3. **第三步**：测试验证（确保功能正常）
4. **第四步**：清理旧代码（移除不再需要的部分）

### 兼容性保证

- ✅ 新旧系统可以共存
- ✅ 旧 API 仍然可用
- ✅ 逐步迁移，无需一次性改完
- ✅ 出问题可以随时回退

---

**更多信息**：请参考 `MENU_SYSTEM_REFACTOR.md`
