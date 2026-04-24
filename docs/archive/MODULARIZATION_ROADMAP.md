# Content.js 模块化路线图

## 已完成的模块

### ✅ 1. modules/utils.js
- 通用工具函数
- HTML转义、防抖、节流
- Chrome API 包装
- DOM 操作辅助

### ✅ 2. modules/toast.js  
- Toast 通知显示
- 多种类型提示（成功、错误、警告、信息）
- 动画效果
- 自动隐藏

### ✅ 3. modules/settings.js
- 设置加载和保存
- Chrome storage 交互
- 黑名单管理
- 设置监听器

## 待完成的模块

### 📝 4. modules/selection.js
需要从 content.js 中提取以下功能：
- `getActiveSelectionText()` - 获取选中文本
- `detectTextType()` - 检测文本类型
- `notifySelectionChange()` - 通知选择变化
- 选择相关的事件监听
- 智能文本提取逻辑

### 📝 5. modules/buttons.js
需要提取：
- `defaultButtons` 数组定义
- 按钮渲染逻辑
- 按钮点击处理
- Mini 模式按钮配置
- `updateAllButtonsWithSameText()` 函数

### 📝 6. modules/popover.js
需要提取：
- `createPopover()` - 创建弹出框
- `showPopover()` - 显示弹出框
- `hidePopover()` - 隐藏弹出框
- `forceShowPopover()` - 强制显示
- 位置计算逻辑
- Shadow DOM 管理

### 📝 7. modules/dragging.js
需要提取：
- `startDragging()` - 开始拖拽
- `handleDragging()` - 处理拖拽
- `stopDragging()` - 停止拖拽
- `cleanupDragState()` - 清理状态
- 位置保存和恢复

### 📝 8. modules/search.js
需要提取：
- `extractSearchKeyword()` - 提取搜索关键词
- `requestKeywordsFromBackground()` - 后台请求
- `getSmartSearchText()` - 智能搜索文本
- `getSmartSearchTextAsync()` - 异步获取
- URL 解析逻辑

### 📝 9. modules/shortcuts.js
需要提取：
- `matchesShortcut()` - 匹配快捷键
- `handleSearchShortcut()` - 处理搜索快捷键
- 键盘事件监听
- 快捷键配置管理

### 📝 10. modules/commands.js
需要提取：
- `executeCommand()` - 执行命令
- `getSmartSuggestions()` - 智能建议
- Base64/URL 编解码
- 命令解析逻辑

### 📝 11. modules/events.js
需要提取：
- `bindEvents()` - 事件绑定
- DOM 变化监听
- Chrome runtime 消息监听
- 窗口事件处理

### 📝 12. modules/ui-manager.js
需要提取：
- `toggleSettings()` - 设置面板切换
- `showRecoveryPopover()` - 恢复界面
- `scheduleRealtimeUpdate()` - 实时更新
- UI 组件协调

## 实施步骤

### 第一阶段（已完成）✅
1. ✅ 创建 modules 文件夹
2. ✅ 创建 utils.js
3. ✅ 创建 toast.js
4. ✅ 创建 settings.js

### 第二阶段（进行中）
5. ⏳ 创建 selection.js
6. ⏳ 创建 buttons.js
7. ⏳ 更新 manifest.json

### 第三阶段
8. 创建 popover.js
9. 创建 dragging.js
10. 创建 search.js

### 第四阶段
11. 创建 shortcuts.js
12. 创建 commands.js
13. 创建 events.js

### 第五阶段
14. 创建 ui-manager.js
15. 重构 content.js
16. 完整测试

## manifest.json 更新示例

```json
"content_scripts": [{
  "matches": ["<all_urls>"],
  "js": [
    "modules/utils.js",
    "modules/settings.js",
    "modules/toast.js",
    "modules/selection.js",
    "modules/buttons.js",
    "modules/commands.js",
    "modules/dragging.js",
    "modules/popover.js",
    "modules/search.js",
    "modules/shortcuts.js",
    "modules/events.js",
    "modules/ui-manager.js",
    "dockbar.js",
    "content.js"
  ],
  "css": ["content.css"],
  "run_at": "document_idle",
  "all_frames": true
}]
```

## 模块间依赖关系

```
utils.js (无依赖)
    ↓
settings.js (依赖 utils)
    ↓
toast.js (依赖 utils)
    ↓
selection.js (依赖 utils, settings)
    ↓
buttons.js (依赖 utils, settings, toast)
    ↓
commands.js (依赖 utils, toast)
    ↓
search.js (依赖 utils, settings, selection)
    ↓
dragging.js (依赖 utils, settings)
    ↓
popover.js (依赖 所有上述模块)
    ↓
shortcuts.js (依赖 utils, settings)
    ↓
events.js (依赖 所有模块)
    ↓
ui-manager.js (协调所有模块)
    ↓
content.js (主入口，初始化所有模块)
```

## 注意事项

1. **保持向后兼容**：确保旧功能正常工作
2. **避免循环依赖**：严格按照依赖关系加载
3. **全局命名空间**：所有模块通过 `window.CCSModules` 访问
4. **渐进式迁移**：逐个模块迁移，每次测试
5. **文档更新**：每个模块都需要详细注释

## 测试清单

- [ ] 文本选择功能
- [ ] 所有搜索引擎按钮
- [ ] 复制功能
- [ ] 编解码功能
- [ ] 拖拽功能
- [ ] 快捷键功能
- [ ] 设置面板
- [ ] 黑名单功能
- [ ] Mini 模式
- [ ] Dock bar 功能
- [ ] Toast 通知
- [ ] 右键菜单集成

## 性能优化建议

1. 考虑使用 webpack 或 rollup 打包
2. 实现按需加载机制
3. 优化大模块（如 popover.js）
4. 添加模块缓存机制
5. 减少 DOM 操作

## 后续工作

1. 添加单元测试
2. 创建开发文档
3. 实现模块热重载
4. 添加 TypeScript 支持
5. 创建模块模板生成器