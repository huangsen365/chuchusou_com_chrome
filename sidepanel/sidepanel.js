/**
 * 触触搜 Side Panel - 简化快捷菜单
 * 只显示置顶操作 + 一级菜单项（无子菜单）
 */

const PIN_STORAGE_KEY = 'ccs_sidepanel_pinned_action';
const CUSTOM_PURPOSE_KEY = 'ccs_cover_custom_purpose';        // textarea 全文（用户预设库）
const CUSTOM_LINE_KEY = 'ccs_cover_custom_selected_line';      // 当前应用的那一行
const CUSTOM_PURPOSE_MAX = 600;
const CUSTOM_LINE_PREVIEW_MAX = 15;                            // dropdown 选项 / 卡片副标题截断长度（中文 15 字内，避免挤爆容器）
const DEFAULT_PIN = { taskId: 'cover', categoryId: 'xiaohongshu' };

// 比例（适用所有封面调用 · 全局生效）
const RATIO_KEY = 'ccs_cover_aspect_ratio';                    // 当前选中比例（如 "5:2"）
const RATIO_CUSTOM_LIST_KEY = 'ccs_cover_custom_ratios';        // 用户保存的自定义比例数组
const RATIO_CUSTOM_MAX = 5;                                     // 最多保留 5 个，溢出剔除最旧
const DEFAULT_RATIO = '5:2';
const RATIO_RE = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/;
// 10 个预设按"宽到窄"排序，覆盖国内外主流自媒体平台
const RATIO_PRESETS = [
  { value: '5:2',    label: '5:2 · 横幅封面（默认）' },
  { value: '2.35:1', label: '2.35:1 · 微信公众号头图 / 电影宽屏' },
  { value: '2:1',    label: '2:1 · 横幅卡片（Twitter / 知乎）' },
  { value: '16:9',   label: '16:9 · 通用横屏（YouTube / B 站 / 视频号）' },
  { value: '3:2',    label: '3:2 · 头条号 / 摄影标准' },
  { value: '4:3',    label: '4:3 · 传统媒体 / PPT' },
  { value: '1:1',    label: '1:1 · 方形（Instagram / 微博 / 朋友圈）' },
  { value: '4:5',    label: '4:5 · 竖版图文（Instagram 推荐）' },
  { value: '3:4',    label: '3:4 · 竖版封面（小红书原生 / Pinterest）' },
  { value: '9:16',   label: '9:16 · 手机竖屏（抖音 / TikTok / Reels / 视频号）' }
];
const RATIO_CUSTOM_TRIGGER = '__custom__';

// 自定义风格"不知道填什么？"参考链接——让 ChatGPT 列 30 个封面风格名供用户挑选
const COVER_STYLE_REFERENCE_URL = 'https://chatgpt.com/?prompt=%E6%88%91%E9%9C%80%E8%A6%81%E4%BD%A0%E4%B8%BA%E2%80%9C%E5%B0%81%E9%9D%A2%E5%9B%BE%E8%AE%BE%E8%AE%A1%E9%A3%8E%E6%A0%BC%E5%8F%82%E8%80%83%E2%80%9D%E7%94%9F%E6%88%90%E4%B8%80%E4%B8%AA%E5%88%97%E8%A1%A8%E3%80%82%0A%0A%E8%A6%81%E6%B1%82%EF%BC%9A%0A-+%E8%BE%93%E5%87%BA%E7%BA%A630%E4%B8%AA%E9%A3%8E%E6%A0%BC%E5%90%8D%E7%A7%B0%0A-+%E6%AF%8F%E8%A1%8C%E4%B8%80%E4%B8%AA%E9%A3%8E%E6%A0%BC%0A-+%E4%BB%85%E4%BD%BF%E7%94%A8%E7%BA%AF%E6%96%87%E6%9C%AC%EF%BC%88plain+text%EF%BC%89%EF%BC%8C%E4%B8%8D%E8%A6%81%E4%BD%BF%E7%94%A8%E7%BC%96%E5%8F%B7%E3%80%81%E7%AC%A6%E5%8F%B7%E6%88%96%E8%A7%A3%E9%87%8A%0A-+%E4%B8%8D%E8%A6%81%E6%B7%BB%E5%8A%A0%E4%BB%BB%E4%BD%95%E9%A2%9D%E5%A4%96%E8%AF%B4%E6%98%8E%E6%88%96%E5%89%8D%E5%90%8E%E7%BC%80%E6%96%87%E5%AD%97%0A-+%E9%A3%8E%E6%A0%BC%E5%8F%AF%E4%BB%A5%E6%9D%A5%E8%87%AA%E5%85%A8%E7%90%83%EF%BC%8C%E4%BD%86%E8%AF%B7%E4%BC%98%E5%85%88%E5%8C%85%E5%90%AB%E7%AC%A6%E5%90%88%E5%8D%8E%E4%BA%BA%2F%E4%B8%AD%E5%9B%BD%E5%AE%A1%E7%BE%8E%E7%9A%84%E8%AE%BE%E8%AE%A1%E9%A3%8E%E6%A0%BC%0A-+%E9%A3%8E%E6%A0%BC%E5%90%8D%E7%A7%B0%E5%B0%BD%E9%87%8F%E7%AE%80%E6%B4%81%EF%BC%88%E5%A6%82%E2%80%9CXX%E9%A3%8E%E6%A0%BC%E2%80%9D%E6%88%96%E5%B8%B8%E8%A7%81%E8%A1%A8%E8%BE%BE%EF%BC%89%0A%0A%E7%A4%BA%E4%BE%8B%E6%A0%BC%E5%BC%8F%EF%BC%88%E4%BB%85%E4%BE%9B%E5%8F%82%E8%80%83%EF%BC%8C%E4%B8%8D%E8%A6%81%E5%A4%8D%E7%94%A8%E7%A4%BA%E4%BE%8B%E5%86%85%E5%AE%B9%EF%BC%89%EF%BC%9A%0A%E5%B0%8F%E7%BA%A2%E4%B9%A6%E5%B0%81%E9%9D%A2%E9%A3%8E%E6%A0%BC%0A%E6%A4%B0%E6%A0%91%E7%89%8C%E6%B5%B7%E6%8A%A5%E9%A3%8E%E6%A0%BC%0A%0A%E8%AF%B7%E7%9B%B4%E6%8E%A5%E8%BE%93%E5%87%BA%E5%88%97%E8%A1%A8%E5%86%85%E5%AE%B9%E3%80%82';

function parseCustomLines(text) {
  if (typeof text !== 'string') return [];
  return text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
}

function truncateLine(s, max = CUSTOM_LINE_PREVIEW_MAX) {
  if (typeof s !== 'string') return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// ============================================================================
// 语音选引擎模块（Voice Engine Picker）
// ============================================================================
// 设计要点：
// - 用户已选好 keyword（独立于语音流程），语音"仅"用于挑引擎
// - 闭集识别：候选词汇是固定的引擎名表 → 准确率天然高
// - 永远不自动跳转，给 top-10 候选让用户把关，错了可重录
// - 每次用户选择都喂给 reranker（chrome.storage.local 历史频次）→ 越用越准
// - VoiceRecognizer 是抽象层：V1 用 Web Speech API，V2 计划替换为 Vosk-WASM
//   底层换不影响 VoicePanel 的逻辑

// V1 alias 表硬编码——稳定后挪到 engines.json 的 voiceAliases 字段
// key 是 unifiedMenuConfig 里的 menu item id，确保和现有 handleClick 链路对齐
const VOICE_ALIAS_MAP = {
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
};

// Levenshtein 编辑距离——fuzzy 匹配 ASR 文本和别名
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

// 归一化 ASR 文本：小写 + 去标点空白，让"chat gpt"和"chatgpt"能匹配上
function normalizeAsrText(s) {
  return (s || '').toLowerCase().replace(/[\s\.,!?。，！？、；;]/g, '');
}

// 给定一段 ASR 文本，对所有引擎计算最佳别名相似度 ∈ [0,1]
function aliasMatchScores(asrText) {
  const norm = normalizeAsrText(asrText);
  const out = {};
  for (const [engineId, aliases] of Object.entries(VOICE_ALIAS_MAP)) {
    let best = 0;
    for (const a of aliases) {
      const aNorm = normalizeAsrText(a);
      if (!aNorm) continue;
      const dist = levenshtein(norm, aNorm);
      const maxLen = Math.max(norm.length, aNorm.length, 1);
      const sim = 1 - dist / maxLen;
      if (sim > best) best = sim;
    }
    out[engineId] = best;
  }
  return out;
}

// VoiceRecognizer 抽象层——V1 = Web Speech API（浏览器内置，部分实现走云）
// V2 计划：VoskRecognizer 用 Vosk-WASM + grammar 真离线
// 接口契约：recognize() 返回 [{ text, score }]，按 score 降序，最多 N-best
class VoiceRecognizer {
  async recognize() { throw new Error('not implemented'); }
}

class VoiceRecognitionError extends Error {
  constructor(error) {
    const code = error?.code || error?.message || error?.name || 'recognition-error';
    super(code);
    this.name = error?.name || 'VoiceRecognitionError';
    this.code = code;
    this.details = error || null;
  }
}

class OffscreenSpeechRecognizer extends VoiceRecognizer {
  isSupported() {
    const hasRuntimeBridge = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage;
    const hasWebSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    return !!(hasRuntimeBridge && hasWebSpeech);
  }

  async recognize() {
    if (!this.isSupported()) throw new Error('当前浏览器不支持 Web Speech API');
    const response = await chrome.runtime.sendMessage({
      action: 'ccsVoiceRecognize',
      lang: 'zh-CN',
      maxAlternatives: 10
    });
    if (!response) throw new VoiceRecognitionError({ code: 'offscreen-no-response' });
    if (!response.success) throw new VoiceRecognitionError(response.error);
    return Array.isArray(response.candidates) ? response.candidates : [];
  }

  async cancel() {
    try {
      await chrome.runtime.sendMessage({ action: 'ccsVoiceCancel' });
    } catch (_) {
      // Best effort only: the UI state is guarded by recognitionRunId.
    }
  }
}

// 历史频次存储 key（chrome.storage.local 简化版 reranker 数据源）
const VOICE_HISTORY_KEY = 'ccs_voice_history';
// 首次知情同意标志——用户看完说明亲手点"开始"才触发麦克风请求
const VOICE_INTRO_SEEN_KEY = 'ccs_voice_intro_seen';
// 全局开关 key——默认关，用户在 popup 设置里主动开启才会激活整个语音模块
const VOICE_ENABLED_KEY = 'ccs_voice_enabled';

function getVoicePermissionUrl() {
  return chrome.runtime.getURL('voice-permission/permission.html');
}

// 麦克风设置页 —— 优先深链到本扩展自身的 site details，让用户不用在列表里翻找
function getMicSettingsUrl() {
  try {
    const extId = chrome.runtime.id;
    if (extId) {
      // 直接打开"本扩展的所有站点权限"页面，里面有麦克风一栏
      return `chrome://settings/content/siteDetails?site=chrome-extension%3A%2F%2F${extId}`;
    }
  } catch (_) { /* fallback below */ }
  return 'chrome://settings/content/microphone';
}

// VoicePanel——录音 → 识别 → 融合排序 → top-10 候选 → 用户选择 → 调度
class VoicePanel {
  constructor(renderer) {
    this.renderer = renderer;
    this.recognizer = new OffscreenSpeechRecognizer();
    this.history = {};       // engineId → count
    this.introSeen = false;  // 知情同意标志
    this.busy = false;
    this.recognitionRunId = 0;
    this.helpTargetUrl = getVoicePermissionUrl();
    this.loadHistory();
    this.loadIntroFlag();
    this.bind();
    if (!this.recognizer.isSupported()) {
      // 浏览器不支持 Web Speech API → 永久隐藏入口按钮
      const btn = document.getElementById('spKeywordVoice');
      if (btn) {
        btn.hidden = true;
        btn.dataset.disabled = 'true';
      }
    }
  }

  loadHistory() {
    try {
      chrome.storage.local.get([VOICE_HISTORY_KEY], (result) => {
        this.history = result?.[VOICE_HISTORY_KEY] || {};
      });
    } catch (_) { /* ignore */ }
  }

  loadIntroFlag() {
    try {
      chrome.storage.local.get([VOICE_INTRO_SEEN_KEY], (result) => {
        this.introSeen = !!result?.[VOICE_INTRO_SEEN_KEY];
      });
    } catch (_) { /* ignore */ }
  }

  saveIntroSeen() {
    this.introSeen = true;
    try { chrome.storage.local.set({ [VOICE_INTRO_SEEN_KEY]: true }); } catch (_) { /* ignore */ }
  }

  saveHistory() {
    try {
      chrome.storage.local.set({ [VOICE_HISTORY_KEY]: this.history });
    } catch (_) { /* ignore */ }
  }

  bumpHistory(engineId) {
    this.history[engineId] = (this.history[engineId] || 0) + 1;
    this.saveHistory();
  }

  bind() {
    const btn = document.getElementById('spKeywordVoice');
    if (btn) btn.addEventListener('click', () => this.start());
    document.getElementById('spVoiceCancel')?.addEventListener('click', () => this.cancel());
    document.getElementById('spVoiceRetry')?.addEventListener('click', () => this.startRecognition());
    document.getElementById('spVoiceIntroOk')?.addEventListener('click', () => this.confirmIntro());
    document.getElementById('spVoiceIntroCancel')?.addEventListener('click', () => this.cancel());
    document.getElementById('spVoiceHelpBtn')?.addEventListener('click', () => {
      try { chrome.tabs.create({ url: this.helpTargetUrl || getVoicePermissionUrl() }); } catch (_) { /* ignore */ }
    });
  }

  isEnabled() {
    return this.renderer?.voiceEnabled === true;
  }

  // 从 renderer.config 抓"叶子级搜索引擎"项——直接搜索类，不含子菜单
  // 暂不支持需要二级选择的（速答/百问/优化/封面），那些靠 picker 流程
  collectEngineItems() {
    const out = [];
    const validTypes = new Set(['search', 'ai-chat', 'ai-search', 'ecommerce', 'translate', 'portal']);
    for (const group of (this.renderer.config?.groups || [])) {
      if (!group.items) continue;
      for (const item of group.items) {
        if (item.children && item.children.length > 0) continue;
        if (!validTypes.has(item.type)) continue;
        if (item.enabled === false) continue;
        out.push(item);
      }
    }
    return out;
  }

  // 入口：点 🎤 调这里。决定先弹"知情同意"还是直接录音
  start() {
    if (!this.isEnabled()) {
      this.deactivate();
      return;
    }
    if (this.busy) return;
    if (!this.renderer.keyword.text) {
      this.renderer.showToast('请先选中文字或读剪贴板');
      return;
    }
    if (!this.introSeen) {
      this.showIntro();          // 首次：先看说明
      return;
    }
    this.startRecognition();      // 看过：直接录音
  }

  // 用户在 intro 页点"明白了，开始录音"——这是真正触发麦克风请求的那一下
  confirmIntro() {
    if (!this.isEnabled()) {
      this.deactivate();
      return;
    }
    this.saveIntroSeen();
    this.startRecognition();
  }

  // 通过 background/offscreen 启动 SpeechRecognition——麦克风 prompt 由 offscreen document 触发
  async startRecognition() {
    if (!this.isEnabled()) {
      this.deactivate();
      return;
    }
    if (this.busy) return;
    const runId = ++this.recognitionRunId;
    this.busy = true;
    this.showRecordingUi();
    const voiceBtn = document.getElementById('spKeywordVoice');
    if (voiceBtn) voiceBtn.classList.add('recording');
    this.setStatus('recording', '🎤', '正在请求麦克风权限——请留意 Chrome 顶部弹出的授权对话框');

    let candidates;
    try {
      candidates = await this.recognizer.recognize();
    } catch (err) {
      if (runId !== this.recognitionRunId || !this.isEnabled()) return;
      console.warn('[触触搜][Voice] 识别失败:', err);
      const code = err.code || err.message || err.name || '';
      if (voiceBtn) voiceBtn.classList.remove('recording');
      this.busy = false;
      if (code === 'permission-denied' || code === 'not-allowed' || code === 'service-not-allowed' ||
          code === 'NotAllowedError' || err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        const permissionState = err.details?.permissionState || '';
        this.setStatus('error', '🚫', permissionState === 'denied' ? '麦克风权限被拒绝' : '需要先完成麦克风授权');
        this.showPermissionHelp(permissionState === 'denied' ? 'settings' : 'grant');
        return;
      }
      const msg = code === 'no-speech' ? '没听到声音，请再试一次或点取消'
                : code === 'audio-capture' || code === 'NotFoundError' || code === 'DevicesNotFoundError' ? '没找到麦克风设备'
                : code === 'network' ? '识别引擎需要联网（V1 用 Web Speech，V2 将切换到本地）'
                : code === 'media-devices-unavailable' ? '当前浏览器环境不支持麦克风访问'
                : code === 'speech-recognition-unavailable' ? '当前浏览器不支持 Web Speech API'
                : code === 'offscreen-unavailable' ? '当前 Chrome 版本不支持扩展离屏录音'
                : `识别失败：${code}`;
      this.setStatus('error', '⚠️', msg);
      return;
    }
    if (runId !== this.recognitionRunId || !this.isEnabled()) return;
    this.finishRecognition(candidates);
  }

  finishRecognition(candidates) {
    if (!this.isEnabled()) return;
    const voiceBtn = document.getElementById('spKeywordVoice');
    if (voiceBtn) voiceBtn.classList.remove('recording');
    this.busy = false;
    document.getElementById('spVoice').hidden = false;
    document.getElementById('spVoiceIntro').hidden = true;
    document.getElementById('spVoiceStatus').hidden = false;
    document.getElementById('spVoiceHelp').hidden = true;
    document.getElementById('spVoiceActions').hidden = false;
    const ranked = this.rankEngines(candidates);
    if (!ranked.length) {
      this.setStatus('error', '🤔', '没匹配到引擎，请重录或取消');
      return;
    }
    const heard = candidates[0]?.text || '';
    this.setStatus('done', '✓', `听到：「${heard}」—— 请从下方选择`);
    this.renderCandidates(ranked);
  }

  showVisibleRecognitionError(errorText) {
    if (!this.isEnabled()) return;
    this.busy = false;
    const voiceBtn = document.getElementById('spKeywordVoice');
    if (voiceBtn) voiceBtn.classList.remove('recording');
    document.getElementById('spVoice').hidden = false;
    document.getElementById('spVoiceIntro').hidden = true;
    document.getElementById('spVoiceStatus').hidden = false;
    document.getElementById('spVoiceList').hidden = true;
    document.getElementById('spVoiceList').innerHTML = '';
    document.getElementById('spVoiceHelp').hidden = true;
    document.getElementById('spVoiceActions').hidden = false;
    this.setStatus('error', '⚠️', errorText || '可见录音页识别失败，请重试');
  }

  // Joint Scoring：声学分（recogScore）× 别名匹配 + 用户历史 boost
  // 现在 V1 已经"声学+别名"两路融合；V2 加 audio embedding 第三路时只改这里
  rankEngines(asrCandidates) {
    const items = this.collectEngineItems();
    const histValues = Object.values(this.history);
    const maxCount = Math.max(1, ...histValues);

    const engineScores = items.map((item) => {
      let bestPair = 0;
      for (const cand of asrCandidates) {
        const aliasScores = aliasMatchScores(cand.text);
        const aSim = aliasScores[item.id] || 0;
        // 万一 alias 表没覆盖到，用 title 直接比对兜底
        const titleNorm = normalizeAsrText(item.title || '');
        const candNorm = normalizeAsrText(cand.text);
        const titleSim = titleNorm && candNorm
          ? 1 - levenshtein(candNorm, titleNorm) / Math.max(candNorm.length, titleNorm.length, 1)
          : 0;
        const matchSim = Math.max(aSim, titleSim);
        const acousticConf = cand.score || 0.5;
        // 声学置信度低时，更依赖文本匹配；高时，加权融合
        const pairScore = acousticConf * 0.4 + matchSim * 0.6;
        if (pairScore > bestPair) bestPair = pairScore;
      }
      const histBoost = (this.history[item.id] || 0) / maxCount;     // [0,1]
      const finalScore = bestPair * 0.85 + histBoost * 0.15;
      return { item, score: finalScore, matchOnly: bestPair };
    });

    return engineScores
      .filter((x) => x.matchOnly > 0.15)        // 滤掉完全不像的（连 15% 相似都没有）
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }

  renderCandidates(ranked) {
    if (!this.isEnabled()) {
      this.hide();
      return;
    }
    const ul = document.getElementById('spVoiceList');
    ul.innerHTML = '';
    ul.hidden = false;
    const max = ranked[0]?.score || 1;
    ranked.forEach((entry, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sp-voice-item' + (i === 0 ? ' top' : '');
      const pct = Math.max(5, Math.round((entry.score / max) * 100));
      const titleSafe = String(entry.item.title || entry.item.id || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
      const iconSafe = String(entry.item.icon || '🔍');
      btn.innerHTML = `
        <span class="sp-voice-item-icon">${iconSafe}</span>
        <span class="sp-voice-item-title">${titleSafe}</span>
        <span class="sp-voice-item-bar"><span class="sp-voice-item-bar-fill" style="width:${pct}%"></span></span>
        <span class="sp-voice-item-pct">${pct}%</span>
      `;
      btn.addEventListener('click', () => this.pick(entry.item));
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }

  pick(item) {
    this.bumpHistory(item.id);
    this.hide();
    // 复用现有 handleClick 调度链路——type 路由 / executeMenuAction 全免重写
    this.renderer.handleClick(item);
  }

  cancel() {
    this.deactivate();
  }

  deactivate() {
    this.recognitionRunId++;
    this.busy = false;
    const voiceBtn = document.getElementById('spKeywordVoice');
    if (voiceBtn) voiceBtn.classList.remove('recording');
    if (this.recognizer && typeof this.recognizer.cancel === 'function') {
      this.recognizer.cancel();
    }
    this.hide();
  }

  // 面板的 4 种"子状态"切换 ——
  //   intro: 仅 .sp-voice-intro 显示
  //   recording / result / generic-error: 仅 status + actions 显示
  //   permission-denied: status + .sp-voice-help + actions 显示
  showIntro() {
    if (!this.isEnabled()) {
      this.hide();
      return;
    }
    document.getElementById('spVoice').hidden = false;
    document.getElementById('spVoiceIntro').hidden = false;
    document.getElementById('spVoiceStatus').hidden = true;
    document.getElementById('spVoiceList').hidden = true;
    document.getElementById('spVoiceList').innerHTML = '';
    document.getElementById('spVoiceHelp').hidden = true;
    document.getElementById('spVoiceActions').hidden = true;
  }

  showRecordingUi() {
    if (!this.isEnabled()) {
      this.hide();
      return;
    }
    document.getElementById('spVoice').hidden = false;
    document.getElementById('spVoiceIntro').hidden = true;
    document.getElementById('spVoiceStatus').hidden = false;
    document.getElementById('spVoiceList').hidden = true;
    document.getElementById('spVoiceList').innerHTML = '';
    document.getElementById('spVoiceHelp').hidden = true;
    document.getElementById('spVoiceActions').hidden = false;
  }

  showPermissionHelp(kind = 'grant') {
    const helpEl = document.getElementById('spVoiceHelp');
    const textEl = helpEl?.querySelector('.sp-voice-help-text');
    const btnEl = document.getElementById('spVoiceHelpBtn');
    if (kind === 'settings') {
      this.helpTargetUrl = getMicSettingsUrl();
      if (textEl) textEl.textContent = 'Chrome 已记录为拒绝麦克风。点击下面按钮打开本扩展的麦克风设置，把状态改成「允许」，回来点重新录音。';
      if (btnEl) btnEl.textContent = '🔓 去 Chrome 设置开启';
    } else {
      this.helpTargetUrl = getVoicePermissionUrl();
      if (textEl) textEl.textContent = 'Chrome 隐藏录音页仍拿不到麦克风。点击下面按钮打开可见录音页，在新页完成录音后，候选列表会回到这里。';
      if (btnEl) btnEl.textContent = '🎤 打开可见录音页';
    }
    if (helpEl) helpEl.hidden = false;
  }

  showPermissionReady() {
    if (!this.isEnabled()) return;
    document.getElementById('spVoice').hidden = false;
    document.getElementById('spVoiceIntro').hidden = true;
    document.getElementById('spVoiceStatus').hidden = false;
    document.getElementById('spVoiceList').hidden = true;
    document.getElementById('spVoiceList').innerHTML = '';
    document.getElementById('spVoiceHelp').hidden = true;
    document.getElementById('spVoiceActions').hidden = false;
    this.setStatus('done', '✓', '麦克风授权成功，请点重新录音');
  }

  hide() {
    document.getElementById('spVoice').hidden = true;
    document.getElementById('spVoiceIntro').hidden = true;
    document.getElementById('spVoiceStatus').hidden = true;
    document.getElementById('spVoiceList').hidden = true;
    document.getElementById('spVoiceList').innerHTML = '';
    document.getElementById('spVoiceHelp').hidden = true;
    document.getElementById('spVoiceActions').hidden = true;
  }

  setStatus(state, icon, text) {
    const statusEl = document.getElementById('spVoiceStatus');
    if (!statusEl) return;
    statusEl.classList.remove('recording', 'error', 'done');
    statusEl.classList.add(state);
    document.getElementById('spVoiceStatusIcon').textContent = icon;
    document.getElementById('spVoiceStatusText').textContent = text;
  }
}

// Use JS transforms instead of CSS marquee; Windows can disable/freeze CSS animation here.
function setupMarquee(viewportSelector, textSelector, options = {}) {
  const viewport = document.querySelector(viewportSelector);
  const text = document.querySelector(textSelector);
  if (!viewport || !text) return;

  const speed = options.speed || 42;
  let viewportWidth = 0;
  let textWidth = 0;
  let distance = 1;
  let offset = 0;
  let lastTime = performance.now();

  text.style.animation = 'none';
  text.style.paddingLeft = '0';

  const measure = () => {
    viewportWidth = Math.ceil(viewport.getBoundingClientRect().width);
    textWidth = Math.ceil(text.scrollWidth || text.getBoundingClientRect().width);
    distance = Math.max(1, viewportWidth + textWidth);
    offset %= distance;
  };

  const tick = (now) => {
    if (viewportWidth <= 0 || textWidth <= 0) {
      measure();
    }

    const delta = Math.min(now - lastTime, 100);
    offset = (offset + delta * speed / 1000) % distance;

    lastTime = now;
    text.style.transform = `translateX(${Math.round(viewportWidth - offset)}px)`;
    requestAnimationFrame(tick);
  };

  measure();
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    viewport._ccsMarqueeState = { observer };
  } else {
    window.addEventListener('resize', measure);
  }
  window.addEventListener('load', measure, { once: true });
  requestAnimationFrame(tick);
}

class PinnedAction {
  constructor(renderer) {
    this.renderer = renderer;
    this.coverConfig = null;
    this.current = { ...DEFAULT_PIN };
    this.customPurpose = '';        // textarea 全文（多行预设库）
    this.customSelectedLine = '';   // 当前应用的那一行
    this.ratio = DEFAULT_RATIO;     // 当前选中比例
    this.customRatios = [];         // 用户保存的自定义比例
    this.draft = null;
    this.draftCustomPurpose = '';
    this.draftCustomSelectedLine = '';
    this.draftRatio = DEFAULT_RATIO;
    this.draftCustomRatios = [];
  }

  async init() {
    const [stored, customPurpose, customLine, ratioInfo, coverCfg] = await Promise.all([
      this.loadStored(),
      this.loadCustomPurpose(),
      this.loadCustomLine(),
      this.loadRatioInfo(),
      this.loadCoverConfig()
    ]);
    this.coverConfig = coverCfg;
    this.customPurpose = customPurpose || '';
    this.ratio = ratioInfo.ratio;
    this.customRatios = ratioInfo.customRatios;
    // 兼容旧版本：CUSTOM_LINE_KEY 没存过时，把全文作为单行 fallback
    this.customSelectedLine = customLine || (parseCustomLines(this.customPurpose)[0] || '');
    if (stored && this.findCategory(stored.categoryId, coverCfg)) {
      // custom 风格但没保存过有效行 → 退回默认
      if (stored.categoryId === 'custom' && !this.customSelectedLine) {
        this.current = { ...DEFAULT_PIN };
      } else {
        this.current = stored;
      }
    } else {
      this.current = { ...DEFAULT_PIN };
    }
    if (!coverCfg || !Array.isArray(coverCfg.categories) || coverCfg.categories.length === 0) {
      // 没有 cover 配置就不显示置顶区
      return;
    }
    document.getElementById('spPin').hidden = false;
    this.render();
    this.attachListeners();
  }

  loadStored() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([PIN_STORAGE_KEY], (result) => {
          resolve(result?.[PIN_STORAGE_KEY] || null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  loadCustomPurpose() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([CUSTOM_PURPOSE_KEY], (result) => {
          const v = result?.[CUSTOM_PURPOSE_KEY];
          resolve(typeof v === 'string' ? v : '');
        });
      } catch (_) {
        resolve('');
      }
    });
  }

  loadCustomLine() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([CUSTOM_LINE_KEY], (result) => {
          const v = result?.[CUSTOM_LINE_KEY];
          resolve(typeof v === 'string' ? v : '');
        });
      } catch (_) {
        resolve('');
      }
    });
  }

  loadRatioInfo() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([RATIO_KEY, RATIO_CUSTOM_LIST_KEY], (result) => {
          const r = result?.[RATIO_KEY];
          const list = result?.[RATIO_CUSTOM_LIST_KEY];
          resolve({
            ratio: (typeof r === 'string' && RATIO_RE.test(r.trim())) ? r.trim() : DEFAULT_RATIO,
            customRatios: Array.isArray(list) ? list.filter((x) => typeof x === 'string' && RATIO_RE.test(x)) : []
          });
        });
      } catch (_) {
        resolve({ ratio: DEFAULT_RATIO, customRatios: [] });
      }
    });
  }

  async loadCoverConfig() {
    try {
      const url = chrome.runtime.getURL('prompts/coverPrompts.json');
      const response = await fetch(url);
      if (!response.ok) return null;
      return await response.json();
    } catch (_) {
      return null;
    }
  }

  findCategory(id, cfg = this.coverConfig) {
    if (!cfg || !Array.isArray(cfg.categories)) return null;
    return cfg.categories.find((c) => c.id === id) || null;
  }

  render() {
    const cat = this.findCategory(this.current.categoryId);
    if (!cat) return;
    const styleEl = document.getElementById('spPinStyle');
    const taskEl = document.getElementById('spPinTask');
    if (taskEl) {
      taskEl.textContent = '封面生成器（建议字数适中）';
      taskEl.title = '建议选择字数适中，否则图片效果不佳';
    }
    if (!styleEl) return;
    if (cat.id === 'custom') {
      // 自定义：副标题用当前选中行的截断预览（应用层 truncateLine 默认 15 字 + CSS ellipsis 兜底）
      const line = (this.customSelectedLine || '').trim();
      const preview = truncateLine(line);
      styleEl.textContent = preview ? `🖌️ ${preview}` : '🖌️ 自定义风格';
      styleEl.title = line || '';
    } else {
      styleEl.textContent = cat.label || cat.id;
      styleEl.title = '';
    }
  }

  attachListeners() {
    document.getElementById('spPinAction').addEventListener('click', () => this.execute());
    document.getElementById('spPinEdit').addEventListener('click', () => this.openPicker());
    document.getElementById('spPinCancel').addEventListener('click', () => this.closePicker());
    document.getElementById('spPinSave').addEventListener('click', () => this.savePicker());
    this.bindTaskInfoPopover();
  }

  // ⓘ 详情弹层：click 切换（不是 hover）；点外部 / ESC / × 关闭
  // 点 ⓘ 时 stopPropagation 防止冒泡触发 .sp-pin-action 的 execute()
  bindTaskInfoPopover() {
    const infoEl = document.getElementById('spPinTaskInfo');
    const popover = document.getElementById('spPinTaskPopover');
    if (!infoEl || !popover) return;

    const setOpen = (open) => {
      popover.hidden = !open;
      infoEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    const isOpen = () => !popover.hidden;
    const toggle = () => setOpen(!isOpen());
    const close = () => setOpen(false);

    infoEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();              // 阻止冒泡到 .sp-pin-action button → 不触发封面生成
      toggle();
    });
    // 键盘可达：tab focus 后 Enter/Space 切换
    infoEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }
    });

    const closeBtn = popover.querySelector('.sp-pin-task-popover-close');
    if (closeBtn) closeBtn.addEventListener('click', close);

    // 点击 popover/info 之外的任意位置关闭
    document.addEventListener('click', (e) => {
      if (!isOpen()) return;
      if (popover.contains(e.target) || infoEl.contains(e.target)) return;
      close();
    });
    // ESC 关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) close();
    });
  }

  async execute() {
    const cat = this.findCategory(this.current.categoryId);
    if (!cat) return;
    const engine = (cat.engines || [])[0];
    if (!engine) {
      this.renderer.showToast('该风格暂无可用引擎');
      return;
    }
    // 自定义风格：用 storage 里用户填写的文本作为 purpose；无文本则提示先去设置
    let purpose = cat.purpose || cat.label;
    if (cat.id === 'custom') {
      const userText = (this.customSelectedLine || '').trim();
      if (!userText) {
        this.renderer.showToast('请先点 ✏️ 填写自定义风格');
        return;
      }
      purpose = userText;
    }
    await this.renderer.refresh();
    const keyword = this.renderer.keyword.raw || this.renderer.keyword.text;
    const menuItemId = `ccs-cover-${cat.id}-${engine.id}`;
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'executeMenuAction',
        menuItemId,
        menuType: 'cover',
        keyword,
        urlPattern: engine.urlPattern,
        engineId: engine.id,
        purpose,
        categoryId: cat.id
      });
      if (response && response.error === 'no-keyword') {
        this.renderer.showToast('没有选中文本或无法提取关键词');
      }
    } catch (_) {
      this.renderer.showToast('操作失败');
    }
  }

  openPicker() {
    this.draft = { ...this.current };
    this.draftCustomPurpose = this.customPurpose || '';
    this.draftCustomSelectedLine = this.customSelectedLine || '';
    // 打开 picker 时把当前 textarea 解析的行作为基线，避免首次 rebuild 把现有行误判成"新增"
    this.lastDropdownLines = parseCustomLines(this.draftCustomPurpose);
    this.draftRatio = this.ratio || DEFAULT_RATIO;
    this.draftCustomRatios = [...this.customRatios];
    const list = document.getElementById('spPinOptions');
    list.innerHTML = '';
    (this.coverConfig?.categories || []).forEach((cat) => {
      const optId = `pin-opt-${cat.id}`;
      const checked = cat.id === this.draft.categoryId ? 'checked' : '';
      const label = document.createElement('label');
      label.className = 'sp-pin-option';
      label.htmlFor = optId;
      label.innerHTML = `
        <input type="radio" name="pinStyle" id="${optId}" value="${cat.id}" ${checked}>
        <span class="sp-pin-option-label">${cat.id === 'custom' ? '🖌️ ' + (cat.label || cat.id) : (cat.label || cat.id)}</span>
      `;
      list.appendChild(label);
    });
    list.onchange = (e) => {
      const target = e.target;
      if (target && target.name === 'pinStyle') {
        this.draft.categoryId = target.value;
        this.refreshPickerCustomVisibility();
        this.refreshSaveBtn();
      }
    };
    // 初始化 textarea
    const ta = document.getElementById('spPinCustomInput');
    if (ta) {
      ta.value = this.draftCustomPurpose;
      ta.oninput = () => {
        this.draftCustomPurpose = ta.value || '';
        this.activateCustomCategory();   // 用户在编辑自定义文本 → 意图就是用自定义
        this.refreshPickerCounter();
        this.rebuildCustomDropdown();
        this.refreshSaveBtn();
      };
    }
    // 初始化 dropdown
    const sel = document.getElementById('spPinCustomSelect');
    if (sel) {
      sel.onchange = () => {
        this.draftCustomSelectedLine = sel.value || '';
        this.activateCustomCategory();   // 用户在选 dropdown 行 → 自动激活自定义模式
        this.refreshSaveBtn();
      };
    }
    // 「💡 不知道填什么？」帮助链接：跳 ChatGPT 让它列 30 个封面风格供用户挑
    const helpBtn = document.getElementById('spPinCustomHelp');
    if (helpBtn) {
      helpBtn.onclick = () => {
        try { chrome.tabs.create({ url: COVER_STYLE_REFERENCE_URL }); } catch (_) { /* ignore */ }
      };
    }
    this.refreshPickerCustomVisibility();
    this.refreshPickerCounter();
    this.rebuildCustomDropdown();
    this.bindRatioControls();
    this.rebuildRatioDropdown();
    this.refreshSaveBtn();
    const picker = document.getElementById('spPinPicker');
    picker.hidden = false;
    // .sp-pin 已经 sticky 在顶部，picker 在主滚动区，用户当前滚到中段时点 ✏️ 会看不到 picker；
    // 自动滚回顶部确保 picker 可见
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
  }

  bindRatioControls() {
    const sel = document.getElementById('spPinRatioSelect');
    const customBox = document.getElementById('spPinRatioCustom');
    const input = document.getElementById('spPinRatioInput');
    const addBtn = document.getElementById('spPinRatioAdd');
    const hint = document.getElementById('spPinRatioHint');
    if (!sel || !customBox || !input || !addBtn || !hint) return;

    sel.onchange = () => {
      const v = sel.value;
      if (v === RATIO_CUSTOM_TRIGGER) {
        customBox.hidden = false;
        hint.hidden = false;
        hint.textContent = '格式：宽:高（数字，可带小数）';
        hint.classList.remove('error');
        input.focus();
      } else {
        customBox.hidden = true;
        hint.hidden = true;
        this.draftRatio = v;
      }
    };
    input.oninput = () => {
      input.classList.remove('invalid');
      hint.classList.remove('error');
      hint.textContent = '格式：宽:高（数字，可带小数）';
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); }
    };
    addBtn.onclick = () => {
      const raw = (input.value || '').trim();
      if (!RATIO_RE.test(raw)) {
        input.classList.add('invalid');
        hint.classList.add('error');
        hint.textContent = '格式不对，应为 宽:高（如 2.35:1）';
        return;
      }
      // 已存在 → 直接选中，不重复加
      if (RATIO_PRESETS.some((p) => p.value === raw) || this.draftCustomRatios.includes(raw)) {
        this.draftRatio = raw;
      } else {
        this.draftCustomRatios.unshift(raw);
        if (this.draftCustomRatios.length > RATIO_CUSTOM_MAX) {
          this.draftCustomRatios = this.draftCustomRatios.slice(0, RATIO_CUSTOM_MAX);
        }
        this.draftRatio = raw;
      }
      input.value = '';
      customBox.hidden = true;
      hint.hidden = true;
      this.rebuildRatioDropdown();
    };
  }

  rebuildRatioDropdown() {
    const sel = document.getElementById('spPinRatioSelect');
    if (!sel) return;
    sel.innerHTML = '';
    const groups = [];
    if (this.draftCustomRatios.length > 0) {
      groups.push({ label: '自定义', items: this.draftCustomRatios.map((v) => ({ value: v, label: `${v} · 自定义` })) });
    }
    groups.push({ label: '预设', items: RATIO_PRESETS });
    for (const g of groups) {
      const og = document.createElement('optgroup');
      og.label = g.label;
      for (const it of g.items) {
        const opt = document.createElement('option');
        opt.value = it.value;
        opt.textContent = it.label;
        if (it.value === this.draftRatio) opt.selected = true;
        og.appendChild(opt);
      }
      sel.appendChild(og);
    }
    // 末尾加"+ 自定义"触发项
    const trigger = document.createElement('option');
    trigger.value = RATIO_CUSTOM_TRIGGER;
    trigger.textContent = '➕ 自定义比例…';
    sel.appendChild(trigger);
    // 当前 draftRatio 不在任何 option 里 → 退回默认
    if (![...sel.options].some((o) => o.value === this.draftRatio && o.value !== RATIO_CUSTOM_TRIGGER)) {
      this.draftRatio = DEFAULT_RATIO;
      [...sel.options].forEach((o) => { o.selected = o.value === DEFAULT_RATIO; });
    }
  }

  refreshPickerCustomVisibility() {
    const box = document.getElementById('spPinCustom');
    if (!box) return;
    box.hidden = this.draft?.categoryId !== 'custom';
  }

  /**
   * 用户在自定义编辑区做了任意操作（改 textarea / 选 dropdown）→
   * 自动把 radio 切到「自定义」并同步 UI，不需要再手动点上面的 radio。
   * 已是 custom 时是 no-op。
   */
  activateCustomCategory() {
    if (!this.draft || this.draft.categoryId === 'custom') return;
    this.draft.categoryId = 'custom';
    const radio = document.querySelector('input[name="pinStyle"][value="custom"]');
    if (radio) radio.checked = true;
    this.refreshPickerCustomVisibility();
  }

  refreshPickerCounter() {
    const counter = document.getElementById('spPinCustomCounter');
    if (counter) counter.textContent = String((this.draftCustomPurpose || '').length);
  }

  rebuildCustomDropdown() {
    const sel = document.getElementById('spPinCustomSelect');
    if (!sel) return;
    const lines = parseCustomLines(this.draftCustomPurpose);
    sel.innerHTML = '';
    if (lines.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '（请先在上方填写至少 1 行预设）';
      opt.disabled = true;
      sel.appendChild(opt);
      sel.disabled = true;
      this.draftCustomSelectedLine = '';
      this.lastDropdownLines = [];
      return;
    }
    sel.disabled = false;
    // 优先级：(1) 用户刚加的新行（最末一个新增）→ 自动选中  (2) 原选中行还在 → 保持
    //         (3) 退回第一行
    // 从后往前找：用户多行粘贴时，最末新增行通常是用户最关注的
    const added = [...lines].reverse().find((l) => !this.lastDropdownLines.includes(l));
    let chosen;
    if (added) {
      chosen = added;
    } else if (lines.includes(this.draftCustomSelectedLine)) {
      chosen = this.draftCustomSelectedLine;
    } else {
      chosen = lines[0];
    }
    lines.forEach((line) => {
      const opt = document.createElement('option');
      opt.value = line;
      opt.textContent = truncateLine(line);
      opt.title = line;
      if (line === chosen) opt.selected = true;
      sel.appendChild(opt);
    });
    // 显式同步 select.value，防止某些浏览器在 innerHTML 重建后 selectedIndex 残留默认 0
    sel.value = chosen;
    this.draftCustomSelectedLine = chosen;
    this.lastDropdownLines = [...lines];
  }

  refreshSaveBtn() {
    const btn = document.getElementById('spPinSave');
    if (!btn) return;
    // custom 必须有选中行才能保存；其它风格随时可保存
    const blocked = this.draft?.categoryId === 'custom' && !(this.draftCustomSelectedLine || '').trim();
    btn.disabled = !!blocked;
  }

  closePicker() {
    document.getElementById('spPinPicker').hidden = true;
    this.draft = null;
    this.draftCustomPurpose = '';
    this.draftCustomSelectedLine = '';
    this.lastDropdownLines = [];
    this.draftRatio = DEFAULT_RATIO;
    this.draftCustomRatios = [];
  }

  async savePicker() {
    if (!this.draft) {
      this.closePicker();
      return;
    }
    if (this.draft.categoryId === 'custom' && !(this.draftCustomSelectedLine || '').trim()) {
      this.renderer.showToast('请先填写至少 1 行自定义风格');
      return;
    }
    this.current = { ...this.draft };
    const writes = { [PIN_STORAGE_KEY]: this.current };
    if (this.draft.categoryId === 'custom') {
      // 保存时统一 trim：parseCustomLines 已经做了 per-line trim + 丢空行，
      // 再 join('\n') 得到干净版本——避免用户输入残留前后空格 / 多余空行
      const cleanLines = parseCustomLines(this.draftCustomPurpose);
      const fullText = cleanLines.join('\n').slice(0, CUSTOM_PURPOSE_MAX);
      const selectedLine = (this.draftCustomSelectedLine || '').trim();
      this.customPurpose = fullText;
      this.customSelectedLine = selectedLine;
      writes[CUSTOM_PURPOSE_KEY] = fullText;
      writes[CUSTOM_LINE_KEY] = selectedLine;
    }
    // 比例：始终保存（与置顶风格独立但同存）
    const ratio = (typeof this.draftRatio === 'string' && RATIO_RE.test(this.draftRatio)) ? this.draftRatio : DEFAULT_RATIO;
    this.ratio = ratio;
    this.customRatios = [...this.draftCustomRatios];
    writes[RATIO_KEY] = ratio;
    writes[RATIO_CUSTOM_LIST_KEY] = this.customRatios;
    await new Promise((resolve) => {
      try {
        chrome.storage.local.set(writes, () => resolve());
      } catch (_) {
        resolve();
      }
    });
    this.render();
    this.closePicker();
    this.renderer.showToast('已保存置顶风格');
  }
}

class SidePanelRenderer {
  constructor() {
    this.config = null;
    this.keyword = { text: '', raw: '' };
    this.currentTabUrl = '';
    this.pinned = new PinnedAction(this);
    // 用户手动从剪贴板写入 keyword 时设 true；URL 变化时回 false
    // 用于防止后续 refresh() 在 chrome:// 等不支持选区的页面拉不到、把手动设的 keyword 清空
    this.keywordSetManually = false;
  }

  async init() {
    this.setupAlivePort();
    try {
      const [config, tabInfo] = await Promise.all([
        this.loadMenuConfig(),
        this.getActiveTab()
      ]);

      this.config = config;
      this.currentTabUrl = tabInfo.url || '';

      // Get keyword
      this.keyword = await this.getCurrentKeyword(tabInfo);

      this.voiceEnabled = false;
      this.voicePanel = null;
      this.renderKeyword();
      this.renderMenu();
      this.bindClipboardButton();
      this.bindCopyKeywordButton();
      this.initVoiceModule();                      // 按 ccs_voice_enabled 开关决定是否激活语音模块
      // 置顶区独立于主菜单加载，失败不影响整体
      this.pinned.init().catch((err) => {
        console.warn('[触触搜] Pinned action init failed:', err);
      });

      // Listen for tab changes to update pinned actions
      chrome.tabs.onActivated.addListener(() => this.refresh());
      chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (changeInfo.url || changeInfo.status === 'complete') {
          this.refresh();
        }
      });

      // Listen for real-time keyword updates from background
      chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'keywordUpdated' && message.keyword) {
          this.keyword = {
            text: message.keyword.text || '',
            raw: message.keyword.raw || message.keyword.text || ''
          };
          this.renderKeyword();
          return;
        }
        if (message.action === 'ccsVoicePermissionGranted' && this.voicePanel) {
          this.voicePanel.showPermissionReady();
          return;
        }
        if (message.action === 'ccsVoiceVisibleRecognized' && this.voicePanel) {
          this.voicePanel.finishRecognition(Array.isArray(message.candidates) ? message.candidates : []);
          return;
        }
        if (message.action === 'ccsVoiceVisibleError' && this.voicePanel) {
          this.voicePanel.showVisibleRecognitionError(message.error || '');
        }
      });
    } catch (error) {
      console.error('[触触搜] Side panel init failed:', error);
      document.getElementById('spMenu').innerHTML =
        '<div class="sp-empty">加载失败，请重试</div>';
    }
  }

  // 通过 port 连接告诉 background 本侧边栏在哪个 window 活着，
  // 同时监听 background 发来的关闭信号（popup 点「关闭」时触发）
  // SW 重启 / 扩展重载会让 port 断开，自动重连保证状态不假报
  async setupAlivePort() {
    try {
      const win = await chrome.windows.getCurrent();
      const port = chrome.runtime.connect({ name: 'sidepanel-alive' });
      port.postMessage({ windowId: win.id });
      port.onMessage.addListener((msg) => {
        if (msg && msg.action === 'close') {
          try { window.close(); } catch (_) { /* 兜底 */ }
        }
      });
      port.onDisconnect.addListener(() => {
        // SW 重启或扩展重载导致断连，500ms 后重新建链
        setTimeout(() => this.setupAlivePort(), 500);
      });
    } catch (e) {
      console.warn('[触触搜] sidepanel alive port setup failed:', e);
    }
  }

  async refresh() {
    try {
      const tabInfo = await this.getActiveTab();
      const newUrl = tabInfo.url || '';
      const urlChanged = newUrl !== this.currentTabUrl;
      this.currentTabUrl = newUrl;

      const newKeyword = await this.getCurrentKeyword(tabInfo);

      // URL 变化 → 跟随新页面，清掉手动标记
      if (urlChanged) {
        this.keyword = newKeyword;
        this.keywordSetManually = false;
        this.renderKeyword();
        return;
      }

      // URL 没变 + 用户手动设过 keyword → 一律保留，不论自动提取是否有内容
      // 用户点 📋 是强烈意图信号：在这个页面用剪贴板内容做关键字
      // 之前的弱保护（仅 newKeyword 为空时不覆盖）会让标题提取 / 缓存选区悄悄替掉手动值，
      // 表现为"最后一次动作不是 📋 时，系统回到默认机制"——剪贴板数据其实在第一次 handleClick→refresh 时就被冲掉了
      // 退出条件：URL 变化（上面 urlChanged 分支已处理，此时 manual 标志被清掉）或用户再点 📋 写新值
      if (this.keywordSetManually) {
        return;
      }

      // 其它情况照常覆盖
      this.keyword = newKeyword;
      this.renderKeyword();
    } catch (e) {
      // Ignore refresh errors
    }
  }

  async getActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs[0] || { url: '', title: '', id: null });
      });
    });
  }

  async loadMenuConfig() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'getMenuStructure' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error('Config load failed'));
          return;
        }
        if (response && response.success) {
          resolve(response.structure);
        } else {
          reject(new Error(response?.error || 'Config load failed'));
        }
      });
    });
  }

  async getCurrentKeyword(tabInfo) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'getSearchText',
        tabId: tabInfo.id,
        url: tabInfo.url,
        title: tabInfo.title,
        forceFresh: true
      }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ text: '', raw: '' });
          return;
        }
        resolve({
          text: response?.text || '',
          raw: response?.raw || response?.text || ''
        });
      });
    });
  }

  renderKeyword() {
    const el = document.getElementById('spKeyword');
    const clipBtn = document.getElementById('spClipboardBtn');
    const copyBtn = document.getElementById('spKeywordCopy');
    const voiceBtn = document.getElementById('spKeywordVoice');
    // 语音按钮显示需 3 个条件同时满足：浏览器支持 + 用户在设置里开启 + keyword 非空
    const voiceSupported = voiceBtn && voiceBtn.dataset.disabled !== 'true';
    const voiceEnabled = this.voiceEnabled === true;
    if (this.keyword.text) {
      const display = this.keyword.text.replace(/\s+/g, ' ').trim();
      el.textContent = `"${display.length > 20 ? display.substring(0, 20) + '...' : display}"`;
      el.title = this.keyword.raw;
      if (clipBtn) {
        clipBtn.hidden = false;
        clipBtn.textContent = '📋 从剪贴板更新关键字';
      }
      if (copyBtn) copyBtn.hidden = false;       // 有 keyword → 露出复制按钮
      if (voiceBtn) voiceBtn.hidden = !(voiceSupported && voiceEnabled);
    } else {
      el.textContent = '';
      if (clipBtn) {
        clipBtn.hidden = false;
        clipBtn.textContent = '📋 从剪贴板读取关键字';
      }
      if (copyBtn) copyBtn.hidden = true;         // 无 keyword → 隐藏复制按钮
      if (voiceBtn) voiceBtn.hidden = true;
    }
  }

  // 语音模块门禁——读取 ccs_voice_enabled 开关，开则实例化 VoicePanel，关则不做任何事。
  // 同时挂 storage onChanged 监听，让用户在 popup 切开关后 sidepanel 实时响应（不用重开）。
  initVoiceModule() {
    chrome.storage.local.get([VOICE_ENABLED_KEY], (result) => {
      this.voiceEnabled = !!result?.[VOICE_ENABLED_KEY];
      if (this.voiceEnabled && !this.voicePanel) {
        this.voicePanel = new VoicePanel(this);
      }
      this.renderKeyword();
    });

    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (!changes[VOICE_ENABLED_KEY]) return;
        const next = !!changes[VOICE_ENABLED_KEY].newValue;
        this.voiceEnabled = next;
      if (next && !this.voicePanel) {
        this.voicePanel = new VoicePanel(this);
      }
      if (!next && this.voicePanel) {
        this.voicePanel.deactivate();  // 关闭时取消录音/识别，并隐藏任何语音 UI
      }
      this.renderKeyword();
    });
    } catch (_) { /* ignore */ }
  }

  // 复制关键字按钮——keyword 徽章左侧的 📋 小图标
  // 点击把当前关键字（优先 raw 保段落）写到剪贴板，方便用户复用到其它地方
  bindCopyKeywordButton() {
    const btn = document.getElementById('spKeywordCopy');
    if (!btn) return;
    const original = btn.textContent;
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const text = (this.keyword.raw || this.keyword.text || '').trim();
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = '✓';
        btn.classList.add('copied');
        btn.disabled = true;
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove('copied');
          btn.disabled = false;
        }, 1200);
      } catch (err) {
        console.warn('[触触搜] 复制关键字失败:', err);
        this.showToast('复制失败，请检查浏览器权限');
      }
    });
  }

  // 剪贴板读取按钮——给 chrome:// 等不支持选区的页面做兜底
  // 用户复制文字后点这个按钮，把剪贴板内容写入关键字
  bindClipboardButton() {
    const btn = document.getElementById('spClipboardBtn');
    if (!btn) return;
    const original = btn.textContent;
    const reset = () => {
      btn.disabled = false;
      btn.textContent = original;
    };
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '⏳ 正在读取剪贴板...';
      try {
        const text = await navigator.clipboard.readText();
        const cleaned = (text || '').trim();
        if (!cleaned) {
          btn.textContent = '⚠️ 剪贴板为空，请先复制文字再点';
          setTimeout(reset, 2000);
          return;
        }
        // 上限对齐 backend AI Chat 引擎硬上限（utils/TextLimits.js LIMITS.aiChat = 6000）
        // 之前 500 太小，多段换行内容会被吃掉；下游 applyTextLimit 仍按 menuId 做引擎级保护
        const limited = cleaned.slice(0, 6000);
        this.keyword = {
          // text 用于徽章显示，把换行/连续空白合成单空格（视觉紧凑，不影响真实数据）
          text: limited.replace(/\s+/g, ' '),
          // raw 保留原始换行——执行菜单时走 keyword.raw，确保多段文字完整透传
          raw: limited
        };
        // 标记为手动设——后续 refresh() 在同 URL 下不会用空 keyword 覆盖它
        this.keywordSetManually = true;
        this.renderKeyword();   // keyword 非空 → 按钮保留，允许继续从剪贴板更新
        this.renderMenu();       // 用新关键字重渲染菜单 URL
        // 即使按钮已 hidden，也立即重置文字 / disabled——
        // 否则后续 tab 事件触发 refresh() 让按钮重新露出时会"卡在正在读取"
        reset();
      } catch (err) {
        console.warn('[触触搜] 读剪贴板失败:', err);
        btn.textContent = '⚠️ 读取失败，请重试';
        setTimeout(reset, 2000);
      }
    });
  }

  renderMenu() {
    const container = document.getElementById('spMenu');
    container.innerHTML = '';

    if (!this.config || !this.config.groups) {
      container.innerHTML = '<div class="sp-empty">无菜单配置</div>';
      return;
    }

    let hasItems = false;

    this.config.groups.forEach((group, index) => {
      // Skip panel group
      if (group.id === 'panel') return;
      if (!group.items) return;

      // Filter to only leaf items (no children or empty children)
      const leafItems = group.items.filter(item => {
        if (item.enabled === false) return false;
        if (item.children && item.children.length > 0) return false;
        return true;
      });

      if (leafItems.length === 0) return;

      // Add separator between groups
      if (hasItems) {
        container.appendChild(this.createSeparator());
      }

      leafItems.forEach(item => {
        container.appendChild(this.createMenuItem(item));
      });

      hasItems = true;
    });

    if (!hasItems) {
      container.innerHTML = '<div class="sp-empty">无可用菜单项</div>';
    }
  }

  createSeparator() {
    const sep = document.createElement('div');
    sep.className = 'sp-separator';
    return sep;
  }

  createMenuItem(item) {
    const el = document.createElement('div');
    el.className = 'sp-menu-item';

    // Simplify title for fastqa-quick type
    let displayTitle = item.title || '';
    if (item.type === 'fastqa-quick') {
      const match = displayTitle.match(/- (.+)$/);
      if (match) {
        displayTitle = `速答 · ${match[1]}`;
      }
    }

    el.innerHTML = `
      <span class="sp-item-icon">${item.icon || ''}</span>
      <span class="sp-item-title">${displayTitle}</span>
    `;

    el.addEventListener('click', () => this.handleClick(item));
    return el;
  }

  async handleClick(item) {
    await this.refresh();
    // 关键字按目标类型分流：
    // - 搜索类 (search/ai-search/ecommerce/translate/portal)：取 keyword.text（已合并换行/连续空白成单空格）
    //   → 多段剪贴板内容里的 \n 不会编码成 %0A 灌进搜索查询、破坏语义
    // - AI 对话 / 速答 / 百问 / 优化 / 封面 / 工具：取 keyword.raw 保留原始段落结构
    const SEARCH_LIKE_TYPES = ['search', 'ai-search', 'ecommerce', 'translate', 'portal'];
    const keyword = SEARCH_LIKE_TYPES.includes(item.type)
      ? (this.keyword.text || this.keyword.raw)
      : (this.keyword.raw || this.keyword.text);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'executeMenuAction',
        menuItemId: item.id,
        menuType: item.type,
        keyword: keyword,
        urlPattern: item.urlPattern,
        actionType: item.action,
        engineId: item.engineId,
        purpose: item.purpose
      });

      if (response && response.error === 'no-keyword') {
        this.showToast('没有选中文本或无法提取关键词');
      }
    } catch (error) {
      console.error('[触触搜] Menu action failed:', error);
      this.showToast('操作失败');
    }
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'sp-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }
}

// 置顶区高度随剪贴板按钮 hidden/show 而变（多 ~44px），用 ResizeObserver
// 实时把真实高度同步到 body padding-top，避免菜单被压住或留出空白
function syncStickyTopPadding() {
  const stickyTop = document.getElementById('spStickyTop');
  if (!stickyTop) return;
  const apply = () => {
    const h = stickyTop.getBoundingClientRect().height;
    if (h > 0) document.body.style.paddingTop = `${Math.ceil(h)}px`;
  };
  apply();
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(apply).observe(stickyTop);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  syncStickyTopPadding();
  setupMarquee('.sp-pin-tip-marquee', '.sp-pin-tip-text', { speed: 42 });
  const renderer = new SidePanelRenderer();
  renderer.init();
});
