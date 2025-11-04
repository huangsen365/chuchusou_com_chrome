# 热修复：Service Worker 兼容性

## 🐛 问题

在 Chrome 扩展重新加载时出现错误：

```
ReferenceError: MenuSystem is not defined
```

## 🔍 原因

`menuSystem.js` 中使用了 `window` 对象来导出 `MenuSystem`，但在 Service Worker 环境中没有 `window` 对象。

**问题代码**：
```javascript
if (typeof window !== 'undefined') {
  window.MenuSystem = { ... };
}
```

## ✅ 修复

已修改为使用 `globalThis`（Service Worker 兼容）：

### 修复点 1：导出 MenuSystem

```javascript
// ❌ 错误
if (typeof window !== 'undefined') {
  window.MenuSystem = { ... };
}

// ✅ 修复
const globalObj = typeof globalThis !== 'undefined' ? globalThis :
                  typeof self !== 'undefined' ? self :
                  typeof window !== 'undefined' ? window : {};

globalObj.MenuSystem = { ... };
```

### 修复点 2：兼容模式暴露

```javascript
// ❌ 错误 (第 90 行)
window._menuSystemCompat = {
  stateManager,
  urlBuilder,
  systemConfig
};

// ✅ 修复
const globalObj = typeof globalThis !== 'undefined' ? globalThis :
                  typeof self !== 'undefined' ? self : {};
globalObj._menuSystemCompat = {
  stateManager,
  urlBuilder,
  systemConfig
};
```

## 📝 修复的文件

- ✅ `background/menuSystem.js` - 已修复（2 处）

## 🧪 验证修复

重新加载扩展后，应该看到：

```
[Init] 🚀 触触搜扩展初始化开始...
[Init] 初始化新菜单系统工具...
[Init] ✅ 新菜单系统工具已就绪
[Init] ✅ 新菜单系统工具初始化完成
[Init] 📝 等待旧系统创建菜单（由 events.js 触发）...
```

### 测试命令

在 Chrome DevTools Console 中运行：

```javascript
// 应该返回 MenuSystem 对象
MenuSystem

// 应该输出菜单系统组件
_debugMenuSystem
```

## 📌 注意事项

### Service Worker vs Window 环境

| 对象 | Window | Service Worker | 通用 |
|------|--------|----------------|------|
| `window` | ✅ | ❌ | ❌ |
| `self` | ✅ | ✅ | ✅ |
| `globalThis` | ✅ | ✅ | ✅ |

**推荐**：在 Chrome 扩展中，始终使用 `globalThis` 或 `self` 而非 `window`。

## ✅ 已检查的文件

- ✅ `Logger.js` - 已正确使用 `globalThis`
- ✅ `menuSystem.js` - 已修复
- ✅ `init.js` - 使用 `globalThis`（无问题）

## 🚀 下一步

重新加载扩展：

```
Chrome 扩展管理 → 触触搜 → 重新加载按钮
```

查看 Console 确认初始化成功。

---

**修复时间**：2025-11-05
**状态**：✅ 已修复
