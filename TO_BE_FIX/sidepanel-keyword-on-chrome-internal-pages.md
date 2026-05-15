# BUG: Sidepanel 在 chrome:// 等内置页面首次进入时拿不到关键字

> 创建时间：2026-05-16
> 状态：**已修复** — 2026-05-16：补齐 `tabs` 权限，并由 background 在 `KeywordService` 内基于 `tabId` 重新读取新鲜 tab 元数据
> 影响：触触搜 Chrome 扩展（Manifest V3），代码在仓库根目录

---

## 一、用户实际可复现的现象（精确描述）

### 步骤
1. **直接打开** `chrome://settings/help`（或类似 chrome:// 内置页，第一次访问该 URL）
2. 点击扩展图标打开 **Popup** → **正常显示 keyword**（页面 title，例如"设置 - 关于"）
3. 打开 **Sidepanel**（侧边栏）→ **徽章是空的，啥都没有**

### 现象的"规律性"
- 在**这个状态下**反复打开关闭 sidepanel 都拿不到
- 切到 `https://www.google.com` 或 `https://www.baidu.com` 等 **HTTPS 页面** → sidepanel **能拿到**
- **再切回** `chrome://settings/help` → 这时 popup 和 sidepanel **都能拿到了**
- 但只要换一个**没访问过的** chrome:// URL，又会重现

### 用户原话
> 我打开 Chrome 的 Settings Help 页面时，第一次进入，Pop-up 肯定是可以拿到的。但在第一次打开时，侧边栏（sidepanel）获取不到。所以我需要切换到其他的页面（比如百度、谷歌等网站），这些都能成功获得。然后当我再切回到 Chrome Settings Help 这个页面时，Pop-up 依然可以拿到，而这时候侧边栏也拿到了。

> 我试了，还是有问题。但是那些 HTTPS 那种页面是没有这种问题的，所以我不知道你怎么去处理这种问题啊。

---

## 二、项目背景速读（5 分钟够你上手）

### 这是什么扩展
**触触搜**：选中网页文字 → 通过菜单一键搜索 / AI 对话 / 生成封面。四种入口：
- 悬浮面板（content script 触发）
- 右键菜单（contextMenus）
- Popup（点扩展图标）
- **Sidepanel（侧边栏）— 本 bug 关注的入口**

### 架构概览（已经做完的重构 = C 档）
所有"获取关键字"的逻辑统一过一个**意图驱动的门面**：

```
popup.js / sidepanel.js
  ↓ 用 shared/keywordClient.js 的 CCSKeywordClient.requestKeyword(intent, options)
  ↓ chrome.runtime.sendMessage({ action:'getKeyword', tabId, url, title, intent })
  ↓
background/events.js  ← onMessage handler
  ↓ KeywordService.getKeyword({tabId, url, title, intent, selectionText})
  ↓
background/KeywordService.js  ← intent → policy 映射（forceFetchSelection 等旗标）
  ↓ computeSearchTextForTab(ctx, opts)
  ↓
background/keywordResolver.js  ← 真正的引擎：拼装多个 candidate 源，取第一个非空
```

`KeywordService` 的 INTENT_POLICIES（关键的 policy 表）：

```js
'popup-open':        { forceFetchSelection: true,  skipCurrentMenuFallback: true,  cacheToStorage: true }
'sidepanel-init':    { forceFetchSelection: true,  skipCurrentMenuFallback: true,  cacheToStorage: false }
'sidepanel-refresh': { forceFetchSelection: true,  skipCurrentMenuFallback: true,  cacheToStorage: false }
'contextmenu-click': { forceFetchSelection: true,  skipCurrentMenuFallback: true,  cacheToStorage: false }
```

⚠️ **重要：popup 和 sidepanel 用的 policy 旗标完全相同**（forceFetchSelection / skipCurrentMenuFallback 都为 true）。理论上同一个 `computeSearchTextForTab` 调用，输入相同应该输出相同。**但实际表现不同**——这是 bug 的核心矛盾。

### `computeSearchTextForTab` 的 candidate 优先级（背诵）
1. `selectionText`（仅 context menu click 时由 `info.selectionText` 提供）
2. `forceFetchSelection: true` → `chrome.scripting.executeScript` 读 `window.getSelection().toString()`
3. `selectedTextByTab[tabId]`（content script push 的缓存）
4. **URL extraction**（`extractSearchKeywords(url, {url, title})` — chrome:// URL 走到 title 兜底分支）
5. （重试 executeScript）
6. `skipCurrentMenuFallback: false` 时读 `currentMenuState`（popup/sidepanel 跳过此项）
7. **`fallbackKeywordByTab[tabId]`**（最近这轮修复加的，URL 匹配才用）
8. 全空 → 返回 `{ raw: '', normalized: '' }`

### chrome:// 页面的特殊性
- `chrome.scripting.executeScript` **被 Chrome 拒绝**（出于安全考虑，扩展不能注入 chrome:// 页面）
- content script **不会运行** → `selectedTextByTab[tabId]` 永远空
- **所以唯一能拿到东西的路径**就是 **URL extraction → title 兜底**（路径 4 或 7）

`extractSearchKeywords(url, tab)` 的逻辑摘要（`background/keywords.js`）：
- 解析 URL
- 匹配硬编码的搜索引擎（baidu/google/chatgpt/...） → 取相应 query param
- 启发式从 URL params 打分挑选
- **以上都失败 → 落到 `tab.title` 兜底分支** → 清掉常见后缀（" - 百度搜索" / " | " 等）后返回

**所以对 chrome://settings/help**：
- 没有 query params
- 不匹配任何硬编码站
- **关键依赖：`tab.title` 必须非空**才能走到 title 兜底分支

---

## 三、已经尝试过的修复（都没解决根本问题）

按 commit 倒序：

### 1. `70ee3a1` sidepanel 多事件触发 + debounce + 空结果退避重试
**做了**：
- `chrome.tabs.onUpdated` 监听从 `url || status:complete` 扩展为 `url || title || status:complete`
- `scheduleRefresh` 加 50ms debounce 合并连发事件
- `_doRefresh(attempt)` 拿空时 400ms / 800ms 退避重试（最多 3 次）
- `init()` 一次性 fetch 拿空时也触发 `scheduleRefresh`

**理论上**应该治：sidepanel 在 url 事件早期被叫醒、tab.title 还没填好的竞态。

**实际结果**：用户说"还是有问题"。所以这个理论可能错了，或者修复实现有遗漏。

### 2. `6b34ad8` compute 兜底读 `fallbackKeywordByTab[tabId]`
**做了**：在 `computeSearchTextForTab` 所有在线 candidate 失败后，读 `fallbackKeywordByTab[tabId]`（URL 强匹配）作为补充候选源。该缓存是 background `prefetchMenuState` 监听 tab onUpdated 时写入的。

**理论**：即使 sidepanel 早期查询拿空，等 bg 的 title-changed 事件触发 `prefetchMenuState` 写完 cache 后，后续重试就能命中。

**实际**：和上面联合后仍未解决用户报告的问题。

### 3. `9466c95` 三段兜底 `getActiveTab`
**做了**：`CCSKeywordClient.getActiveTab` 三段兜底：
1. `chrome.tabs.query({active:true, currentWindow:true})`
2. 失败 → `chrome.windows.getCurrent()` 拿 windowId → `query({windowId})`
3. 还失败 → `query({active:true, lastFocusedWindow:true})`

**实际**：lint 过 syntax 过，但不是这个 bug 的核心因。

### 4. `5b56bb3` storage 瞬时缓存强校验 URL
**做了**：popup 的 storage 5 分钟瞬时缓存读取时强校验 URL，缓存 URL ≠ 当前 URL 就丢弃。**避免 popup 假装拿到 = 显示上一页的旧值**。

**实际**：让 popup 在 chrome:// 上也"诚实"了。但用户的反馈是"popup 还是拿到 title"——这是因为 URL extraction 路径独立于 storage cache，title 提取确实能成功。**这条修复是正交的，跟 sidepanel bug 无关**。

### 5. `be84d60` C 档重构（架构性，不是 fix）
引入 KeywordService 统一门面、shared/keywordClient.js 客户端、popup 加 storage 瞬时缓存。**这次重构 *没有* 改 `computeSearchTextForTab` 引擎内部**，所以理论上不应该引入 chrome:// 上的退化。但是......**用户反馈这个 bug 是在 C 档重构之后出现的吗？还是重构之前就有？** —— **没确认**，需要新一轮排查。

---

## 四、矛盾点 / 还没解开的谜

### 谜 1：popup 和 sidepanel 走完全同一个 compute call，为什么行为不同？

**输入相同，输出必同**——除非 message payload 里某个字段不一样。

可能的差异点（按优先级排查）：
- `tabId`：sidepanel 用 `chrome.tabs.query` 拿到的 tab.id；popup 也是同样的 query。**两边 tabId 应该一致**。
- `url`：同上，两边都从 `chrome.tabs.query` 取 `tab.url`。
- `title`：**关键嫌疑** — popup 是用户**手动点图标**才打开的，时机上 page 早已 settle，`chrome.tabs.query` 返回的 tab.title **几乎一定非空**。sidepanel 是**长期挂着的**，refresh 由 `chrome.tabs.onUpdated` 事件驱动，**时机可能是 page 刚开始加载**，tab.title 可能为空。

**所以核心假设是：sidepanel 查询时 `tab.title` 经常为空。**

但是用户描述显示：**就算等了很久、什么都不操作，sidepanel 也拿不到**。这意味着**就算时序问题、`title` 事件应该已经触发了**——可能是事件根本没触发，或者 sidepanel 的监听器没正确 wire。

### 谜 2：为什么"切走再回来"就能修好？

切到 google 后 → 切回 chrome://settings/help：
- 切回时 chrome.tabs.onActivated 触发 sidepanel 的 `scheduleRefresh` → `_doRefresh`
- 此时 `chrome.tabs.query` 返回的 tab.title **应该已经填好**（页面早就渲染过、Chrome 缓存住了）
- 所以 compute 成功

如果**直接打开 chrome://settings/help** 也最终（onUpdated title 或 status:complete 事件）能让 tab.title 填好，sidepanel 的多事件触发 + 重试**应该也能命中**。

**但用户实测说没有**。所以可能：
- **假设 A**：chrome:// 上 `chrome.tabs.onUpdated` 根本不 fire 后续 title/complete 事件（只有 url 一次），sidepanel 拿空就没下文了
- **假设 B**：事件 fire 了但 `chrome.tabs.query` 始终返回 tab.title=''（直到用户去到别的页面再回来）
- **假设 C**：sidepanel 的 listener 注册有问题，连 url 事件都没触发
- **假设 D**：sidepanel 是被 `chrome.tabs.onActivated` 触发的（不是 onUpdated），而 onActivated 直接打开 chrome:// 时不触发 keyword 拿取流程的某个分支

---

## 五、推荐的排查路径（建议新 AI 从这里开始）

### Step 1：先实测 `chrome.tabs.onUpdated` 在 chrome:// 上到底 fire 什么
**关键诊断步骤**。在 `sidepanel/sidepanel.js` 里临时加日志：

```js
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  console.log('[SIDEPANEL] onUpdated', { tabId, changeInfo, tabUrl: tab?.url, tabTitle: tab?.title });
  if (changeInfo.url || changeInfo.title || changeInfo.status === 'complete') {
    this.scheduleRefresh();
  }
});
```

让用户：
1. 打开 sidepanel
2. 在 sidepanel 的开发者工具（右键 sidepanel 内部 → 检查）查看 console
3. **直接进入** chrome://settings/help（地址栏输入 / 书签 / 新 tab 进）
4. 看 console 输出什么 changeInfo 事件序列、tab.title 是什么

**这一步能区分上述 假设 A / B / C**：
- 如果完全没日志 → 假设 C（listener 没触发）
- 如果只有 `{url:'chrome://settings/help'}` 没有后续 → 假设 A
- 如果有 title 事件但 tab.title 仍空 → 假设 B

### Step 2：观察 SW 端的 RESOLVER 日志
`keywordResolver.js` 里 `logResolver('start', {...})` / `logResolver('candidate', {...})` 等 hook 已经存在。在 SW DevTools（`chrome://extensions/` → 触触搜 → "service worker" 链接打开）的 console 看：

- 用户操作前 console.clear()
- 直接进 chrome://settings/help
- 看 `[触触搜][RESOLVER]` 行：
  - `start` 事件的 `tabUrl` 和 `tabTitle`
  - 走了哪些 candidate
  - 哪些被 skip / 为什么

**这一步直接告诉你**：sidepanel 发到 bg 的 title 是不是空、走 URL extraction 时是不是失败。

### Step 3：和 popup 对比
同一个 chrome:// 页面：
1. 先开 popup 看一遍 RESOLVER 日志（应该成功）
2. 再开 sidepanel 看一遍 RESOLVER 日志（应该失败）
3. 对比两次 `start` 事件的 `tabTitle` 字段差异

**这个对比是最直接的诊断**。如果两次的 `tabTitle` 不同 → 确认 popup 拿到了非空 title 而 sidepanel 拿到空 title → 问题在于 sidepanel 的 `chrome.tabs.query` 时机或 `chrome.tabs.onUpdated` 事件流。

### Step 4：考虑根本性替代方案
如果证实 sidepanel 的事件流就是不可靠（chrome:// 上 title 事件不 fire / fire 但 query 仍空），可能需要换思路：

**思路 A：让 bg 主动 push keyword 到 sidepanel**
- bg 有完整的 tab lifecycle 监听（`prefetchMenuState` 已经能拿到 tab.title）
- 当 bg 检测到 tab 切换 / URL 变 → 主动算好 keyword → push 给打开的 sidepanel（chrome.runtime.sendMessage 或 port）
- sidepanel 只是接收 + 渲染，不主动 pull
- 现在已有 'keywordUpdated' 消息 listener 在 sidepanel.js:1195，但没人 send → **可以激活这条路径**

**思路 B：定时 polling 兜底**
- 简单粗暴，每 2s 主动 query 一次。覆盖事件不可靠的场景。
- 缺点：耗电、不优雅。

**思路 C：依赖 SidePanel API 自带的 tab change 事件**
- `chrome.sidePanel.setOptions` 可以指定 tab-specific 行为
- 但触触搜目前是 global 模式，可能不适用

---

## 六、文件清单（修改 / 阅读优先级）

### 必读（核心逻辑）
- `background/keywordResolver.js` — `computeSearchTextForTab` 引擎，candidate 优先级在这里
- `background/KeywordService.js` — C 档新增的统一门面，INTENT_POLICIES 表
- `background/events.js` —— **特别看**：
  - `getKeyword` action handler（line ~345）
  - `chrome.tabs.onUpdated` listener（line ~1089）
  - `prefetchMenuState`（line ~32）
- `background/keywords.js` — `extractSearchKeywords`，chrome:// 走 title 兜底分支
- `sidepanel/sidepanel.js` — **特别看**：
  - `init()`（line ~1160）
  - `getCurrentKeyword` / `getActiveTab`（line ~1303 / ~1279）
  - `scheduleRefresh` / `refresh` / `_doRefresh`（line ~1245-）
  - 两个 `chrome.tabs.on*` listener（line ~1187）
- `shared/keywordClient.js` — popup/sidepanel 共用客户端
- `popup/popup.js` — `init`（对比参考，看 popup 怎么走通这条路）

### 全局状态对象（在 `background/utils/Constants.js` 声明）
- `selectedTextByTab[tabId]` —— content script push 写
- `fallbackKeywordByTab[tabId]` —— `prefetchMenuState` 写
- `latestTitleByTab[tabId]` —— `updateLatestTabTitle` 写
- `currentMenuState` —— 单例，跨 tab 污染过历史

### CLAUDE.md 必读注意
- 老 switch-case fallback 不要擅自删
- `INIT_CONFIG.useNewSystem = false`，新菜单系统已搬到 legacy 目录
- 发版有专门的 `/release` skill，**不要凭记忆手动发版**

---

## 七、给新 AI 的具体建议

1. **不要重新做"评估"** —— 已经做过一轮深入梳理，结论是架构 OK、引擎层 `computeSearchTextForTab` 也 OK，问题在事件流。
2. **先按 Step 1-3 加日志、让用户实测**。不要先动代码、先确认假设 A/B/C/D 哪个是真的。
3. **如果证实事件流不可靠 → 考虑思路 A（bg 主动 push）**。这是最干净的方案，sidepanel 不再依赖自己的 tab event 监听。
4. **不要轻易引入 polling**（思路 B）。耗电体验差，仅作为兜底。
5. **修复后请加注释**说明根因，让以后维护者不会再走老路。

---

## 八、git 状态快照

```
当前分支：main
最近相关 commits（按时间倒序）：
70ee3a1  sidepanel 多事件+debounce+退避重试 ← 这次没修好
6b34ad8  compute 兜底读 fallbackKeywordByTab[tabId]
9466c95  三段兜底 getActiveTab
5b56bb3  storage 缓存强校验 URL
3ea097c  锁死徽章 wrap 的 width+height
be84d60  refactor(keyword): C 档重构 —— 引入 KeywordService
279d64c  fix(ui): 关键字徽章切换时彻底消除跳跃感 + 字号微调
d77f599  release(v1.6.10): SW 启动时预热 prompt / 配置缓存
```

工作树状态：clean。可以直接动手。

---

**祝好运。这个 bug 我花了很多轮迭代没治本，可能需要换个思路了。**

---

## 九、修复记录（2026-05-16）

根因判断：`chrome://` 内置页不受 `<all_urls>` host permission 覆盖，sidepanel 依赖 `chrome.tabs.query()` 从扩展页上下文读取 `url/title` 时容易拿到空快照；popup 因用户点击扩展图标触发 `activeTab` 授权，所以更容易拿到标题，造成两边表现不一致。

修复：
- `manifest.json` 增加 `"tabs"` 权限，用于稳定读取 tab 的 `url/title` 元数据。
- `background/KeywordService.js` 在处理 `getKeyword` 时不再完全信任前端传入的早期快照，而是用 `chrome.tabs.get(tabId)` 重新读取当前 tab；如果拿到非空 `title`，再进入 `computeSearchTextForTab()` 的 title 兜底路径。
- popup 的 storage 缓存写入 URL 也改用 background 重新读取后的 URL，避免 sidepanel/popup 传空 URL 时写入不准。
