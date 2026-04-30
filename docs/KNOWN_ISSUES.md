# 已知待修复问题（To Be Fixed）

记录已识别但尚未实施的问题与改进项。每条含症状、根因、候选方案、待决策项，方便日后回来直接动手。

---

## 1. `chrome://contextual-tasks/` 页面关键字提取失败

- **首次记录**：2026-04-30
- **状态**：未修复（已评估，用户决定暂缓）
- **优先级**：中（影响 Chrome 内嵌 Google AI Mode 用户）

### 1.1 症状

用户访问 Chrome 浏览器内嵌的 **Google AI Mode** 页面时：

- 边栏右上角关键字徽章空白
- 鼠标选中页面任意文字，扩展也拿不到选区
- 从 popup / 边栏跳转其他引擎时，关键字传不过去（变成空查询）

### 1.2 现象有误导性

Chrome 对 `chrome://contextual-tasks/` 做了 **omnibox rewrite** —— 用户在地址栏点复制时，URL 被翻译成公网形式 `https://www.google.com/search?udm=50&q=...`。所以用户以为是普通 https 页面，怀疑"协议没问题"。

但扩展通过 `tab.url` / `chrome.tabs.onUpdated` 拿到的是**原始的 `chrome://contextual-tasks/?udm=50&q=...&chrome_task_id=...`**。这是排查时第一个要钉死的事实。

### 1.3 根因（两层）

#### 层 A：URL 关键字提取——代码缺分支（可修）

`background/keywords.js:76` 的 google 分支判断是：

```js
if (hostname.includes('google.')) { ... }
```

`chrome://contextual-tasks/` 的 hostname 是 `contextual-tasks`，**不命中任何分支**，`extractSearchKeywords` 返回 undefined。

#### 层 B：鼠标选区捕获——Chrome 平台硬限制（无法修）

选区捕获依赖 content script 注入：`content/SelectionManager.js` 监听 `selectionchange`，再 `chrome.runtime.sendMessage` 发回 service worker。

但 Chrome MV3 安全策略**明确禁止** content script 注入到 `chrome://` 页面：

- `host_permissions: "<all_urls>"` 文档上写明**不包含 `chrome://` scheme**
- `chrome.scripting.executeScript` 同样有此限制
- 唯一绕过路径是用户手动开 `chrome://flags#extensions-on-chrome-urls`（开发者 flag）—— 商店分发的扩展碰不到

→ 在 chrome:// 页面：能读 `tab.url`，**读不到 DOM、选区、任何页面内事件**。

### 1.4 候选方案

| # | 方案 | 改动量 | 解决程度 | 风险 |
|---|---|---|---|---|
| 1 | `keywords.js` 加 `chrome://contextual-tasks/` 分支，与 google 分支同逻辑读 `q` | ~5 行 | 解决层 A | 极低 |
| 2 | 检测当前 tab 是 `chrome://` 协议时，边栏顶部加条件性提示"此页选区无法捕获，已用 URL 关键字兜底" | ~15 行 | UX 闭环（不解决根因） | 低 |
| 3 | 试 `chrome.contextMenus.onClicked` 配合 `info.selectionText` 在 chrome:// 页能否拿到右键选区 | ~10 行 + 实测 | 可能部分解决层 B（仅右键路径，鼠标"一选就拿"做不到） | 待测 |

**层 B 永远做不到"一选就拿"。** 鼠标被动捕获选区在 chrome:// 页是 Chrome 平台层关死的，不是我们能修的。

### 1.5 推荐修复路径（未来回来动手时）

按优先级：

1. **先做层 A**（方案 1，5 行改动）—— URL 关键字至少能拿到完整 prompt
2. **再做 UX 提示**（方案 2）—— 让用户知道"此页选区不可用"，避免误判为 bug
3. **可选试方案 3** —— 看 chrome:// 右键能否触发我们的 contextMenus；能则补一道半残路径

**草稿代码**（方案 1，留给未来直接抄）：

```js
// background/keywords.js，加在 google 分支前面
// Chrome 内部 AI Mode（Gemini in Chrome），URL 形如 chrome://contextual-tasks/?udm=50&q=...
if (urlObj.protocol === 'chrome:' && hostname === 'contextual-tasks') {
  const q = searchParams.get('q');
  if (q) {
    const kw = safeDecodeParam(q);
    BG_DBG('[触触搜][BG][DEBUG] matched chrome contextual-tasks q:', kw);
    return kw;
  }
}
```

### 1.6 相关文件

- `background/keywords.js:76` — google 分支（待加 chrome:// 分支）
- `background/keywordResolver.js:173` — 上层 `extractSearchKeywords` 调用点
- `content/SelectionManager.js` — 选区捕获 content script（受 chrome:// 限制无法注入）
- `manifest.json` — `host_permissions: ["<all_urls>"]`（不含 chrome:// scheme）

### 1.7 验证方法（未来实施后回归用）

1. 重载扩展，访问 `chrome://contextual-tasks/?udm=50&q=测试关键字` 类似页面
2. 打开边栏，右上角徽章应显示 `"测试关键字"`（或截到 20 字 + `...`）
3. 设置 → 调试日志：开，console 应有 `[触触搜][BG][DEBUG] matched chrome contextual-tasks q:` 这一行
4. 鼠标选中页面任意文字 → 不期待拿到选区（Chrome 平台限制，预期行为是徽章保持 URL 关键字不变）
