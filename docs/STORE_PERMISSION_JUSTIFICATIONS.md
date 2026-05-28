# Chrome Web Store 权限 Justification 备忘

> 用途：devconsole「Privacy practices」标签页要求为每个敏感权限填写 justification（审核员逐项审）。
> 这份文件存所有权限的标准说明文本（**中文**），发版时直接复制粘贴，避免每次重写、口径不一。
>
> 当前 manifest 权限（v1.6.30）：
> `activeTab, tabs, clipboardWrite, clipboardRead, storage, contextMenus, scripting, sidePanel, offscreen, webRequest`
> host_permissions: `<all_urls>`

---

## webRequest ← 当前 v1.6.30 上架被要求补充的这一项

**复制粘贴到 devconsole：**

```
本扩展会根据用户选中的文本，代用户在新标签页打开搜索引擎和 AI 对话页面（如 ChatGPT、Claude、Grok、Google AI 等）。其中部分 URL 可能被目标网站拒绝（返回 HTTP 4xx）或导航失败——最常见的情况是用户选中的文本过长、拼出的 URL 超出长度上限。我们以"只读/观察"模式使用 webRequest API 来检测这类失败，从而向用户提供一个"恢复"操作（通过中转页重新打开请求，以安全方式提交文本）。

具体而言，我们只注册 chrome.webRequest.onCompleted 和 chrome.webRequest.onErrorOccurred 两个监听器，并过滤为 type "main_frame"。我们仅读取由本扩展自身发起的顶层导航的状态码和错误字符串。我们不使用 webRequestBlocking，不读取请求/响应的正文或头部，也不修改、重定向或取消任何请求。不收集、不存储、不向任何地方传输任何网络请求数据。
```

**代码依据（团队自查）：**
- 代码位置：`background/urlSafety.js` `installUrlFailureMonitor()`（约 377-397 行）
- 只挂 `onCompleted` + `onErrorOccurred`，`{ urls: ['<all_urls>'], types: ['main_frame'] }`
- 命中条件：`statusCode 400-499` 或导航 error → 调 `handleMainFrameFailure` → 弹「恢复」浮层
- **关键卖点（审核友好）**：用的是 `webRequest` 不是 `webRequestBlocking`；纯观察，不读 body/header、不拦截、不改写、不上报。
- 未来若能改用 `chrome.tabs.onUpdated` 的 status / 或 `declarativeNetRequest` 替代，可考虑彻底去掉 webRequest 权限，减少审核摩擦。

---

## 其余权限 justification（备查，商店可能逐项要求）

### activeTab
```
用于在用户调用扩展的那一刻（点击工具栏图标、右键菜单或侧边栏）读取用户选中的文本以及当前标签页的 URL/标题，以便拼出正确的搜索/AI 查询。访问范围仅限于用户正在交互的那个标签页。
```

### tabs
```
用于在新标签页打开搜索/AI 结果页面、读取当前标签页的 URL 和标题以提取关键词，以及让侧边栏和弹窗与当前活动标签页保持同步。我们不追踪浏览历史。
```

### scripting
```
用于注入内容脚本：检测用户的文本选区、渲染页面内的悬浮操作面板；以及在用户明确选择打开的 AI 对话页面（ChatGPT/Claude 等）的编辑器里填入已准备好的提示词。
```

### contextMenus
```
用于添加本扩展的右键菜单（搜索引擎、AI 对话、提示词优化、封面生成器），让用户能直接从右键菜单对选中文本执行操作。
```

### storage
```
用于本地保存用户设置（启用状态、黑名单、调试开关）、置顶的封面风格/比例、自定义风格预设，以及一份短时效的按标签页关键词缓存。所有数据均通过 chrome.storage.local 本地存储，不发送到任何服务器。
```

### clipboardWrite
```
用于「复制」类菜单操作和复制关键词按钮，按用户请求将选中文本或生成的内容写入剪贴板。
```

### clipboardRead
```
用于在无法获取文本选区的页面（如 chrome:// 页面）上的剪贴板兜底功能，让用户可以粘贴内容供扩展处理。仅在用户明确操作时才读取。
```

### sidePanel
```
用于提供扩展的侧边栏界面（关键词显示、菜单、封面生成器、语音输入），作为弹窗之外的另一种入口。
```

### offscreen
```
用于承载语音识别（语音输入功能）的 offscreen 文档。麦克风访问为可选开启，且仅在用户通过知情同意页后的明确操作才触发。
```

### host_permissions: `<all_urls>`
```
本扩展需要在用户选中文本的任意页面上工作，并跨多个搜索引擎和 AI 服务商打开结果 URL。因为用户可能在任意网站上调用它、并指向任意一个受支持的引擎，所以需要广泛的主机访问权限。内容脚本只在用户的文本选区附近激活，不会在后台读取或传输页面内容。
```

---

## 维护约定

- 改了 manifest 的 `permissions` / `host_permissions` → **同步更新本文件**，并在对应 `releases/vX.Y.Z.md` 里点一句。
- devconsole 填写后记得 **Save Draft**。
- 历史教训：webRequest 在 v1.6.30 上架时被要求补 justification（之前版本没被卡，可能是商店逐步收紧审核）。
