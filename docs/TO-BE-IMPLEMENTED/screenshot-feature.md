# 智能截图功能（HTML 元素层级捕获）

> **状态**：待实施，已评估完整方案
> **提议日期**：2026-04-30
> **优先级**：中（v1.4.0 之后的候选 feature，非阻塞）
> **预估工作量**：80 LOC（MVP）/ 450 LOC（智能版）

---

## 1. 背景与动机

v1.4.0 已经在边栏 + welcome 页双层引导用户"图片生成后用截图另存"——但这个建议**仍然把动作交给用户**：他们要切到系统截图工具（macOS ⇧⌘4 / Windows ⊞+Shift+S），选区域，保存，再回来发布。

如果扩展能内置一键智能截图，体验更连贯：
- 不需要切应用
- 用户用 ChatGPT 生成图片后，在 ChatGPT 页面直接点扩展按钮
- 鼠标悬停在生成图上，点击 → 自动保存为新 PNG
- 新 PNG 由扩展现场编码生成，**没有 C2PA 等元数据指纹**，可直接发自媒体平台

---

## 2. 用户原始诉求（口述实录）

1. 在边栏顶部滚动条最右侧加一个截图小图标（icon）
2. 点击后抓取当前网页，**自动识别 HTML 对应的图层**（智能，不需要手动选区域）
3. 鼠标移动到某个图层上，点击一下，就可以另存为图片
4. 另存为时，**直接保存，不需要询问名称**（浏览器机制，应该直接下载）

关键词：智能选层 / 一键 / 不询问 / 自动下载

---

## 3. 三种实现路径

### 路径 A：MVP 极简版（~80 LOC）

- 点击 📸 → `chrome.tabs.captureVisibleTab()` 拍整个 viewport → 直接下载
- 不做悬停 / 选区 UI
- 用户拿到 PNG 后自己用预览工具裁剪

**优点**：1-2 小时搞定 / 几乎零 bug / 立即可用
**缺点**：用户多一步手动裁剪

### 路径 B：完整智能版（~450 LOC，对应原始诉求）

- 点击 📸 → cursor 变十字 → 鼠标悬停元素显示蓝色高亮框 → 点击该元素 → 自动裁剪 + 下载
- ESC 退出截图模式
- Toast 反馈"已保存到下载"

**优点**：体验丝滑，符合用户原意
**缺点**：开发量大 / 各类网站调 overlay 行为麻烦 / chrome:// 仍不可用

### 路径 C（推荐）：先 A 后 B 分阶段

- **Phase 1**：上 A，发版收集真实使用数据（截 ChatGPT 图占比、iframe 失败率等）
- **Phase 2**：基于 A 加 overlay/click 逻辑，平滑升级到 B（不会推翻 A）

---

## 4. 技术方案

### 4.1 涉及 Chrome API

| API | 用途 | 注意 |
|---|---|---|
| `chrome.tabs.captureVisibleTab(windowId, { format: 'png' })` | 拍当前 viewport，返回 dataURL | 仅限可见区域 |
| `chrome.scripting.executeScript()` | 注入 content script 实现悬停 overlay（B 阶段） | 不能注入 chrome:// |
| `chrome.downloads.download({ url, filename, saveAs: false })` | 下载文件，不弹询问框 | **需新加 `downloads` 权限** |
| `OffscreenCanvas` / `chrome.offscreen` | service worker 里裁剪图（不能直接 new Canvas） | MV3 service worker 没有 DOM |

### 4.2 manifest 权限变更

- ✅ 已有：`activeTab` / `scripting` / `<all_urls>`
- ❌ 待加：`downloads` —— **商店列表会新增"读取 / 修改下载历史"权限说明**，可能影响 1% 用户安装意愿。重新审核约 1-3 天

### 4.3 数据流（B 阶段）

```
sidepanel 用户点 📸
  ↓ chrome.runtime.sendMessage({action: 'enterScreenshotMode'})
background 收到，活动 tab 注入 screenshotMode.js
  ↓
content script 开始监听：
  - mouseover → 给元素加蓝色 outline overlay
  - click → 拿元素 getBoundingClientRect，发消息回 background
  - ESC → 退出，移除 overlay
  ↓ chrome.runtime.sendMessage({action: 'captureElement', rect})
background：
  - chrome.tabs.captureVisibleTab → viewport PNG
  - chrome.offscreen 创建离屏 canvas
  - drawImage 裁剪到 rect 区域（注意乘 devicePixelRatio）
  - canvas.toBlob → blob URL
  ↓ chrome.downloads.download({ url: blobUrl, filename: 'ccs-shot-{时间戳}.png' })
浏览器：保存到 ~/Downloads/，无询问
content script：toast "已保存"，自动退出截图模式
```

---

## 5. 边界与限制（用户必须心里有数）

| 限制 | 影响 |
|---|---|
| **chrome:// 页面** | 不能注入 content script —— B 完全不可用；A 用 captureVisibleTab 也会被 Chrome 屏蔽（chrome:// 通常被禁抓屏） |
| **cross-origin iframe** | content script 不能访问 iframe 内 DOM；ChatGPT 若把图片放独立子域 iframe，B 选不到那个图层 |
| **元素超出 viewport** | captureVisibleTab 只拍可见部分，元素一半在屏外只能拍到一半。需要先 `scrollIntoView` |
| **Retina / DPR** | captureVisibleTab 返回图分辨率 = viewport × DPR，裁剪坐标要乘 DPR 才对得上 |
| **Chrome "保存前询问位置" 系统设置** | 即使 `saveAs: false`，开了该设置仍弹询问框，**绕不过** |
| **CSP 严格的页面** | content script 跑在 isolated world，一般不受影响；但极个别站点的 frame-ancestors 可能阻断 |

---

## 6. 关键决策点（实施时再确认）

1. **走 A / B / C 哪条路**？（推荐 C：先 A 后 B）
2. **下载文件名格式**：`ccs-screenshot-{YYYYMMDDHHMMSS}.png`？要不要插站点 host（如 `ccs-shot-chatgpt-{ts}.png`）？
3. **B 的退出快捷键**：`ESC` / 再点一次 📸 / 右键？
4. **是否同步给 popup 加按钮**？还是仅 sidepanel？
5. **接受 `downloads` 权限引发的商店重审 + 用户安装提示变化** 吗？
6. **iframe 内图片**：B 是否要尝试穿透（`<iframe>` cross-origin 多半失败，可能给"在 iframe 中无法选层"的错误提示）？

---

## 7. 相关代码位置（实施时改这里）

| 文件 | 改动 |
|---|---|
| `manifest.json` | `permissions` 数组加 `"downloads"`；B 阶段在 `content_scripts` 加 `screenshotMode.js`（或用 dynamic injection） |
| `sidepanel/sidepanel.html` | 在 `.sp-pin-tip` 行内（marquee 容器最右侧）加 `<button>` 📸 |
| `sidepanel/sidepanel.css` | 按钮样式（小图标 + hover 反馈） |
| `sidepanel/sidepanel.js` | 按钮 click handler，发 `enterScreenshotMode` 消息到 background |
| `background/events.js` | 加消息 handler：`enterScreenshotMode` / `captureElement` / `captureViewport`；调 captureVisibleTab + 裁剪 + downloads |
| 新建 `content/screenshotMode.js`（B 阶段） | overlay DOM 注入 + mouseover/click/ESC 监听 + 元素 rect 上报 |
| 新建 `background/screenshot.js`（可选拆分） | captureVisibleTab + offscreen canvas 裁剪 + chrome.downloads 调用 |

---

## 8. 替代方案（如果决定永远不做）

降级到 **纯文字提示**：边栏 banner 的 hover popover 已经有截图快捷键脚注。要让用户更容易看到，可以把脚注从 popover 提到 banner 主体——但这会让 banner 文案变长，与"精简措辞避免换行"的近期决策冲突。

**结论**：如果不做截图功能，保持现状即可（popover 里有快捷键提示）。**有截图功能的话，体验提升是显著的**——值得做。

---

## 9. 实施前检查清单

回来动手之前确认：
- [ ] 用户拍板路径（A / B / C）
- [ ] 用户接受加 `downloads` 权限的商店重审延迟
- [ ] 文件名规则定下来
- [ ] B 的退出键定下来
- [ ] 用真机（Mac / Win，含 Retina + 普通屏）测过 captureVisibleTab 的 DPR 行为
- [ ] 在 ChatGPT / Claude 等真实图像生成站测过 iframe 行为
