# 语音选引擎功能 · 麦克风权限流程问题

> **状态**：已修复（改为 MV3 offscreen document 负责麦克风授权和识别），功能仍默认关闭
> **登记日期**：2026-05-02
> **优先级**：中（实验性功能，不影响主流程）
> **影响范围**：sidepanel 内的语音选引擎入口；其它功能完全不受影响

---

## 0. TL;DR

新加的"语音选搜索引擎"功能在用户开启 popup 设置开关后，能看到 🎤 按钮和知情同意页，但**点击"明白了，开始录音"后浏览器没有弹原生麦克风授权对话框**。`navigator.mediaDevices.getUserMedia({ audio: true })` 静默 reject 抛 `NotAllowedError`。预查 `navigator.permissions.query({ name: 'microphone' })` 大概率会返回 `denied`（早先尝试时被记下了），但即使重置后也不一定能弹起 prompt——疑似 Chrome 扩展 sidepanel 上下文对麦克风权限有特殊处理。

2026-05-02 修复：sidepanel 不再直接调用 `getUserMedia` / `SpeechRecognition`。现在通过 background 创建 `offscreen/voice.html`，使用 `chrome.offscreen.createDocument({ reasons: ['USER_MEDIA'] })` 在 offscreen document 中完成麦克风授权探针和 Web Speech 识别，再把候选结果回传 sidepanel 做原有排序与点击确认。

**原核心假设（已采用 workaround）**：扩展 sidepanel 页面（`chrome-extension://[id]/sidepanel/sidepanel.html`）不能稳定通过 `getUserMedia` 触发原生麦克风授权 prompt。因此实际修复改走 offscreen document。

---

## 1. 设计背景与已实现范围

### 1.1 产品意图

在 sidepanel 里，用户已经选好关键字（来自页面选区或剪贴板）。**语音仅用于挑搜索引擎**——闭集识别（约 14 个引擎），不识别任意句子。

交互流程（设计）：

```
用户选好 keyword → 点 🎤 按钮 → 知情同意页 → 点"明白了，开始录音"
   → 浏览器弹麦克风授权（首次）→ 用户允许 → SpeechRecognition 开始录音
   → 用户说"百度" / "GPT" / "知乎" → 端侧 / Web Speech 识别
   → 联合排序（声学 + 别名 + 用户历史）→ Top-10 候选列表
   → 用户从列表点选一个 → 复用现有 handleClick 跳转
```

设计要点：
- **永远不自动跳**——必须用户从 top-10 里把关
- 不准就**重新录音 / 取消**
- **每次用户的选择 = 标注数据**喂给 reranker，越用越准

### 1.2 已实现状态

✅ UI 全套（🎤 按钮 / 知情同意页 / 候选列表 / 重录 / 取消）
✅ 设置面板开关（`ccs_voice_enabled`，默认 false）
✅ 语音模块门禁（开关关时 VoicePanel 不实例化、按钮永久 hidden）
✅ chrome.storage.onChanged 实时响应（toggle 后 sidepanel 立即响应不用重开）
✅ 14 引擎别名表（含 "鸡屁屁" / "度娘" 等口语变体）
✅ Levenshtein fuzzy match
✅ Joint Scoring 排序：α·声学 + β·别名匹配 + γ·用户历史
✅ chrome.storage.local 历史 reranker（每次用户点选累计频次）
✅ VoiceRecognizer 抽象接口（V1=Web Speech，V2 留好替换为 Vosk-WASM 的口子）
✅ offscreen document 麦克风授权探针（`getUserMedia`）+ Web Speech 识别
✅ 权限状态预检（offscreen 中 `navigator.permissions.query`）+ 错误码分流提示
✅ 权限被拒后引导卡片 + 一键跳 chrome:// 设置页

✅ **sidepanel 麦克风 prompt 不弹已绕过**——sidepanel 只负责 UI，麦克风流程迁到 offscreen document

---

## 2. 文件地图

| 文件 | 改动 |
|---|---|
| `sidepanel/sidepanel.html` | 加 🎤 按钮 + voice 面板（intro / status / list / help / actions 5 个子状态） |
| `sidepanel/sidepanel.css` | voice 面板和子状态样式（约 200 行新增） |
| `sidepanel/sidepanel.js` | 语音 UI / alias 表 / Levenshtein / VoicePanel / OffscreenSpeechRecognizer；sidepanel 只发消息，不再直接碰麦克风 |
| `background/voiceOffscreenBridge.js` | 创建 / 复用 offscreen document，并桥接 sidepanel ↔ offscreen 识别消息 |
| `offscreen/voice.html` | MV3 offscreen document 静态页面 |
| `offscreen/voice.js` | 在 offscreen context 中执行 `getUserMedia` 授权探针和 Web Speech 识别 |
| `manifest.json` | 加 `"offscreen"` 权限 |
| `popup/popup.html` | 加「🎤 语音功能：关」设置按钮 |
| `popup/popup.js` | 加 `initVoiceToggle / setVoiceButtonState / toggleVoice` + `case 'voice'` dispatch |
| `popup/modules/SettingsManager.js` | 加了等价方法但**没接线**（孤儿代码，popup.js 自己有一套 handleSettingAction，不用 SettingsManager） |

> ⚠️ 给修复者的提醒：popup 设置 dispatch 有**两套并行实现**——`popup/popup.js` 自带的 switch 是真实生效的；`popup/modules/SettingsManager.js` 是孤儿代码（从未实例化）。要改设置相关逻辑请改 `popup.js`。

---

## 3. 原阻塞代码段（历史记录）

### 3.1 麦克风权限请求路径（`sidepanel/sidepanel.js`）

```js
async startRecognition() {
  // Step 0: 预查权限状态
  let permState = 'prompt';
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    permState = status.state;     // 'granted' / 'denied' / 'prompt'
  } catch (e) { /* 部分 Chrome 版本不支持 */ }

  if (permState === 'denied') {
    // 已被拒过，直接走帮助引导
    this.setStatus('error', '🚫', '麦克风权限已被记成"拒绝"——需手动重置');
    this.showHelp();
    return;
  }

  // Step 1: 显式索权（理论上扩展 sidepanel 里 getUserMedia 应该会弹 prompt）
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());    // 立刻释放，仅作探针
  } catch (err) {
    // 大概率走到 NotAllowedError，但用户从未看到 prompt
    if (err.name === 'NotAllowedError') {
      this.showHelp();
      return;
    }
    // ...
  }

  // Step 2: SpeechRecognition.start()——如果走到这里说明权限拿到了
  const candidates = await this.recognizer.recognize();
  // ...
}
```

### 3.2 复现路径

1. Reload 扩展
2. popup → 设置 → 点「🎤 语音功能：关」→ 变开
3. sidepanel 选中文字 → 点 🎤 → intro 同意页 → 点"明白了，开始录音"
4. **预期**：Chrome 弹"chrome-extension://... 想使用您的麦克风" → 用户允许 → 开始录音
5. **实际**：UI 闪过"正在请求麦克风权限...请留意 Chrome 顶部弹出的授权对话框" → 立即变成"麦克风权限被拒绝" → 引导卡片
6. 用户**全程没看到任何原生授权 prompt**

### 3.3 sidepanel devtools console 诊断命令

```js
// 看权限状态
navigator.permissions.query({ name: 'microphone' }).then(s => console.log(s.state))

// 重置 intro 标志（让同意页再弹一次）
chrome.storage.local.remove('ccs_voice_intro_seen')

// 看当前开关
chrome.storage.local.get('ccs_voice_enabled', console.log)

// 强制开关
chrome.storage.local.set({ ccs_voice_enabled: true })
```

---

## 4. 已尝试但未解决

| 尝试 | 结果 |
|---|---|
| `SpeechRecognition.start()` 直接启动期望它自己弹 prompt | 直接抛 `not-allowed`，无 prompt |
| 加 `getUserMedia({audio:true})` 作显式权限探针 | 同样静默 reject `NotAllowedError`，无 prompt |
| 加 `navigator.permissions.query` 预检 | 状态返回 `denied`（疑似首次失败时被 Chrome 记下了） |
| 引导用户去 `chrome://settings/content/siteDetails?site=chrome-extension://[id]` 重置 | 重置后再次尝试**仍然**不弹 prompt（待修复者验证） |

---

## 5. 推测的根因（未验证）

### 假设 A：Chrome 扩展 sidepanel 里 `getUserMedia` 不能触发原生 prompt

Chrome MV3 的 sidepanel 是扩展页面（`chrome-extension://` 协议），不是普通 web 页面。已知 Chrome 在某些扩展上下文里对 mic / camera 有特殊处理。

**修复者请验证**：在 sidepanel.html 的 devtools console 直接跑：

```js
navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
  console.log('成功', s);
  s.getTracks().forEach(t => t.stop());
}).catch(e => console.error('失败', e.name, e.message));
```

观察：是否弹原生授权 prompt？

- 如果**弹了** → 我们的代码逻辑某处出 bug，重点查 `startRecognition` 调用栈
- 如果**没弹** → 假设 A 成立，需 workaround（见 §6）

### 假设 B：用户系统层面拒绝了 Chrome 的麦克风访问

macOS 系统设置 → 隐私与安全 → 麦克风 → Chrome 是否打勾？
Windows 设置 → 隐私 → 麦克风 → Chrome 是否允许？

如果系统层禁了，浏览器层无论怎么搞都没用。这种情况要给用户更清晰的"去系统设置"引导。

### 假设 C：扩展 manifest 缺少声明

MV3 没有 "audio" / "microphone" 这种 manifest 权限项（不像通知、storage 那样）。但有些路径可能需要：
- `permissions: ["audioCapture"]`（实际是 chrome.tabCapture 用的，不是麦克风）
- 或者 `optional_permissions` 走 chrome.permissions.request

**修复者请检查**：MV3 sidepanel 用麦克风是否有官方文档明确的 manifest 要求。

---

## 6. 可能的 Workaround（按从轻到重排）

### 6.1 用 offscreen document 处理麦克风（已采用）

```js
// background/index.js
chrome.offscreen.createDocument({
  url: 'offscreen-mic.html',
  reasons: ['USER_MEDIA'],
  justification: '语音识别需要麦克风访问'
});
```

offscreen document 是 MV3 专为 DOM/媒体 API 准备的隐藏页面，**官方推荐用于 mic / camera**。在 offscreen 页面里调 `getUserMedia` 应该能正常弹 prompt。

sidepanel 通过 message passing 让 offscreen 录音，offscreen 把识别结果回传。架构变化但不大——VoiceRecognizer 接口不动。

### 6.2 在新 tab 里录音，识别完关掉

打开一个 hosted page（如 chrome.runtime.getURL('voice-recorder.html')），在那个页面里跑 SpeechRecognition，识别完通过 chrome.runtime sendMessage 把结果传回 sidepanel，关掉新 tab。

UX 一般（多一个 tab 闪过），但能保证 prompt 正常弹。

### 6.3 引导用户开启 Chrome 内置 Live Caption

Chrome 113+ `SpeechRecognition.processLocally = true` 走系统语音识别，绕开扩展上下文限制。但需要用户在 chrome://settings/accessibility 启用 Live Caption + 下载语音模型。引导成本高。

### 6.4 跳过 Web Speech API，直接上 Vosk-WASM（终极方案）

V2 计划本来就是切到 Vosk-WASM 真离线识别。Vosk 用 `MediaRecorder` 录音，audioContext 处理 PCM，**不依赖 Web Speech API**——但**仍然需要 `getUserMedia` 拿到麦克风**。所以如果根因是 sidepanel 拿不到 mic，Vosk 也会卡同一步。这条路要先解决 §6.1。

---

## 7. 用户体验上的一些 nice-to-have（修复 mic 权限后再考虑）

- [ ] 录音过程加一个**音量波形可视化**（显示用户的输入是否被听到）——降低用户怀疑"是不是麦克风没接通"的焦虑
- [ ] 自动检测静默（VAD），用户说完自动结束（现在依赖 SpeechRecognition 内部断句，可能慢）
- [ ] 候选列表里**显示用户上次录音听到的原文**，让用户感知"我说了什么 vs 它怎么排序"
- [ ] 历史 reranker 加**衰减**（最近 100 次权重高，老数据淡化），避免一次误点污染长期排序
- [ ] V2 切 Vosk-WASM 后，包内集成所有引擎名的发音模板，做声学相似度第三路

---

## 8. 引擎别名表参考（`sidepanel/sidepanel.js` 顶部 `VOICE_ALIAS_MAP`）

```js
'ccs-baidu':            ['百度', 'baidu', '度娘', '白度', '摆度'],
'ccs-google':           ['谷歌', 'google', '咕咕', '搜歌'],
'ccs-chatgpt':          ['ChatGPT', 'chat gpt', 'gpt', '鸡屁屁', '吉皮提', '聊天 gpt', '吉批批', '机批批'],
'ccs-claude':           ['Claude', '克劳德', '克劳特', '克老德', '克老特'],
'ccs-grok':             ['Grok', '格罗克', '高科', '格洛克'],
'ccs-yiyan':            ['文心一言', '文心', '一言', 'yiyan'],
'ccs-google-ai-chat':   ['Google AI', 'google ai', '谷歌 AI', '谷歌 ai', 'AI 模式', '谷歌 AI 模式'],
'ccs-zhihu':            ['知乎', 'zhihu', '智乎', '只乎'],
'ccs-weixin':           ['微信', '微信搜一搜', 'weixin', '搜一搜'],
'ccs-taobao':           ['淘宝', 'taobao', '掏宝'],
'ccs-jd':               ['京东', 'jd', 'jingdong'],
'ccs-sov2ex':           ['v2ex', '搜 v2ex', 'sov2ex', 'V 站'],
'ccs-google-translate': ['翻译', '谷歌翻译', 'google 翻译', 'translate'],
'ccs-chuchusou':        ['更多', '更多搜索引擎', '触触搜', 'chuchusou', '搜索导航']
```

> 修复者可继续扩展。稳定后挪到 `config/engines.json` 的 `voiceAliases` 字段。

---

## 9. 测试 checklist（修复完成后逐项验证）

- [ ] 默认安装 → popup 设置里看到「🎤 语音功能：关」灰底按钮
- [ ] sidepanel 默认**不显示** 🎤 按钮，无任何语音相关 UI
- [ ] popup 设置点开「🎤」→ 变橙底「开（实验性）」+ toast
- [ ] sidepanel **立即响应**（不需要重开）→ 选中文字时 🎤 出现在 keyword 徽章左侧
- [ ] 第一次点 🎤 → 显示同意页 → 点"明白了" → **Chrome 弹原生麦克风授权 prompt**
- [ ] 用户允许 → 开始录音 → 说"百度" → top-10 候选列表第一项是百度
- [ ] 候选项点击 → 触发对应引擎搜索（复用 handleClick）
- [ ] "重新录音"按钮 → 不再显示 intro，直接进录音
- [ ] "取消"按钮 → 收起 panel
- [ ] 第二次点 🎤 → 不再显示 intro，直接进录音（intro 标志已存）
- [ ] 设置关闭 → sidepanel 立即移除 🎤 + 收起任何展开的 panel
- [ ] 浏览器不支持 Web Speech API → 🎤 按钮永久 hidden（不闪）
- [ ] 用户拒绝麦克风权限 → 显示"🔓 去 Chrome 设置开启"按钮 → 点击直跳 site details

---

## 10. 相关 commits

修复者可参考的现有提交（git log）：

```
最近相关 commits（按时间倒序）
├─ feat(sidepanel): keyword 徽章右侧加 📋 一键复制按钮  (ec05e26)
├─ release(v1.5.4): header 锁高度修复                  (5edcf6e)
├─ fix(sidepanel): header 锁高度消除 keyword 跳跃       (cd8065a)
├─ ...                                                   (语音功能在工作树未提交)
```

> 当前工作树有未提交的语音功能代码。修复者可在该工作树继续推进，或先 commit 当前状态作为基线再调试。

---

## 11. 给修复者的建议路径

1. 先在 sidepanel.html devtools 跑 §5 假设 A 的诊断命令——确认 sidepanel 上下文 `getUserMedia` 行为
2. 如果 prompt 不弹：实施 §6.1 offscreen document 方案，sidepanel ↔ offscreen 用 message passing
3. 修好麦克风权限后，验证 SpeechRecognition 是否在 offscreen 里能跑（Web Speech API 在 offscreen 是否被支持？需查文档）
4. 如果 Web Speech API 在 offscreen 不通，提前切到 V2 Vosk-WASM——offscreen 录音 → MediaRecorder 转 audio buffer → Vosk-WASM 解码（grammar 限制为引擎名表）→ 返回 N-best
5. 记得保持 `VoiceRecognizer` 抽象接口不变——`recognize()` 返回 `[{ text, score }]`，VoicePanel 不感知底层差异

---

## 附录：用户原始需求（口述）

> 想用语音来做交互。用户已经选好了关键字，**仅用语音挑引擎**。
> 必须**真离线**——用户量大走云端服务器扛不住。
> 识别精度可以放低，**给 top-10 候选列表让用户把关**就行。
> 永远不自动跳转，用户从列表里选；不对就重录或取消。
> 每次用户的选择都喂回去做**自训练 / 个性化**——越用越准。
> 默认关闭，主动开启才生效——刚装上的用户不该看到这个功能。
