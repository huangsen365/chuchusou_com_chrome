# DockBar 模块说明

## 概述
DockBar 功能已成功从 `content.js` 中抽离到独立的 `dockbar.js` 文件中。这使得 dock bar 相关功能更加模块化，便于独立维护和迭代。

## 文件结构
- `dockbar.js` - 独立的 DockBar 模块，包含所有底部停靠栏相关功能
- `content.js` - 主内容脚本，集成并使用 DockBar 模块
- `manifest.json` - 已更新，确保先加载 dockbar.js，再加载 content.js

## DockBar 模块功能

### 核心功能
1. **底部栏 HTML 生成** - 创建底部停靠栏的 HTML 结构
2. **样式管理** - 提供所有 dock bar 相关的 CSS 样式
3. **事件处理** - 处理所有 dock bar 相关的用户交互
4. **状态管理** - 管理停靠状态（全局/临时/浮动）

### 主要方法
- `init(settings, callbacks)` - 初始化模块
- `createDockBarHTML(displayText)` - 生成底部栏 HTML
- `createDockMenuHTML()` - 生成停靠菜单 HTML
- `getStyles()` - 获取所有相关 CSS 样式
- `bindDockBarEvents(shadowRoot)` - 绑定事件处理器
- `enableGlobalDock()` - 启用全局停靠
- `enableTempDock()` - 启用临时停靠
- `undock()` - 解除停靠
- `close()` - 关闭底部栏
- `ensureBottomBarVisible(force)` - 确保底部栏可见

## 测试要点

### 基本功能测试
1. **加载扩展后**
   - 在任意网页上选中文本
   - 按 Alt+S（或配置的快捷键）应显示触触搜面板

2. **底部栏切换**
   - 点击面板上的 📌 按钮应切换到底部栏模式
   - 底部栏应固定在页面底部
   - 显示"全局"徽章表示全局停靠模式

3. **解除停靠**
   - 点击底部栏上的 ↕️ 按钮应切换回浮动模式
   - 如果有选中文本，面板应浮动在选中文本附近
   - 如果没有选中文本，面板应隐藏

4. **关闭底部栏**
   - 点击底部栏上的 ✕ 按钮应关闭底部栏
   - 关闭后应记住状态，刷新页面不会自动显示

5. **停靠菜单**
   - 悬停在 📌 按钮上应显示停靠菜单
   - 菜单包含"开启底部栏（全局）"和"开启底部栏（当前页）"选项
   - 选择任一选项应启用相应的停靠模式

### 样式测试
- 底部栏应有紫色渐变背景
- 按钮应正确显示并响应悬停效果
- 徽章应正确显示（全局/临时）

### 兼容性测试
- 测试在不同网站上的表现
- 确保不影响原有的其他功能（搜索、复制、大小写转换等）
- 测试与迷你模式的切换是否正常

## 后续开发建议

现在您可以专注于 `dockbar.js` 文件进行 dock bar 功能的迭代开发，而不必担心影响其他功能。主要优势：

1. **独立性** - 修改 dock bar 功能不会意外影响其他代码
2. **可维护性** - 所有 dock bar 相关代码集中在一处
3. **可测试性** - 可以单独测试 DockBar 模块
4. **可扩展性** - 易于添加新的 dock bar 功能

## 注意事项
- DockBar 模块通过 `window.DockBar` 全局对象暴露
- content.js 中保留了后备实现，以防 DockBar 模块未加载
- 所有设置仍然通过 Chrome storage API 持久化保存