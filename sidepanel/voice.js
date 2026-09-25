/**
 * 触触搜 Sidepanel — Voice 模块（lazy-loaded）
 *
 * 拆分原因：原 sidepanel.js 1745 行里 voice 相关代码占 ~500 行（VoiceRecognizer /
 * OffscreenSpeechRecognizer / VoicePanel + helpers），低配置设备解析+编译这一坨即使
 * 用户从不开语音也得付钱。
 *
 * 加载策略：仅当 `ccs_voice_enabled=true` 且用户点 🎤 时由 sidepanel.js dynamic
 * `<script>` 注入；首屏不加载。
 *
 * 导出：globalThis.CCSSidepanelVoice = { VoicePanel } 让 sidepanel.js 实例化。
 */

(function () {
  // 已加载过则不重复定义（dev 热重载或多次注入兜底）
  if (globalThis.CCSSidepanelVoice && globalThis.CCSSidepanelVoice.VoicePanel) return;

  // ==========================================================================
  // 别名表与文本相似度
  // ==========================================================================
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

  function normalizeAsrText(s) {
    return (s || '').toLowerCase().replace(/[\s\.,!?。，！？、；;]/g, '');
  }

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

  // ==========================================================================
  // Recognizer 抽象
  // ==========================================================================
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
        // Best effort only: UI state is guarded by recognitionRunId.
      }
    }
  }

  // ==========================================================================
  // 常量与小工具
  // ==========================================================================
  const VOICE_HISTORY_KEY = globalThis.CCSStorageKeys.VOICE_HISTORY;
  const VOICE_INTRO_SEEN_KEY = globalThis.CCSStorageKeys.VOICE_INTRO_SEEN;

  function getVoicePermissionUrl() {
    return chrome.runtime.getURL('voice-permission/permission.html');
  }

  function getMicSettingsUrl() {
    try {
      const extId = chrome.runtime.id;
      if (extId) {
        return `chrome://settings/content/siteDetails?site=chrome-extension%3A%2F%2F${extId}`;
      }
    } catch (_) { /* fallback below */ }
    return 'chrome://settings/content/microphone';
  }

  // ==========================================================================
  // VoicePanel
  // ==========================================================================
  class VoicePanel {
    constructor(renderer) {
      this.renderer = renderer;
      this.recognizer = new OffscreenSpeechRecognizer();
      this.history = {};
      this.introSeen = false;
      this.busy = false;
      this.recognitionRunId = 0;
      this.helpTargetUrl = getVoicePermissionUrl();
      this.loadHistory();
      this.loadIntroFlag();
      this.bind();
      if (!this.recognizer.isSupported()) {
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
      // 注意：sidepanel.js 的 🎤 click 监听已经负责 lazy-load 这个模块。
      // VoicePanel.bind() 触发时主 click 监听已存在，所以不在这里再加一次
      // （否则会被绑两遍 → 一次点击触发两次 start）。
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
        this.showIntro();
        return;
      }
      this.startRecognition();
    }

    confirmIntro() {
      if (!this.isEnabled()) {
        this.deactivate();
        return;
      }
      this.saveIntroSeen();
      this.startRecognition();
    }

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

    rankEngines(asrCandidates) {
      const items = this.collectEngineItems();
      const histValues = Object.values(this.history);
      const maxCount = Math.max(1, ...histValues);

      const engineScores = items.map((item) => {
        let bestPair = 0;
        for (const cand of asrCandidates) {
          const aliasScores = aliasMatchScores(cand.text);
          const aSim = aliasScores[item.id] || 0;
          const titleNorm = normalizeAsrText(item.title || '');
          const candNorm = normalizeAsrText(cand.text);
          const titleSim = titleNorm && candNorm
            ? 1 - levenshtein(candNorm, titleNorm) / Math.max(candNorm.length, titleNorm.length, 1)
            : 0;
          const matchSim = Math.max(aSim, titleSim);
          const acousticConf = cand.score || 0.5;
          const pairScore = acousticConf * 0.4 + matchSim * 0.6;
          if (pairScore > bestPair) bestPair = pairScore;
        }
        const histBoost = (this.history[item.id] || 0) / maxCount;
        const finalScore = bestPair * 0.85 + histBoost * 0.15;
        return { item, score: finalScore, matchOnly: bestPair };
      });

      return engineScores
        .filter((x) => x.matchOnly > 0.15)
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

  globalThis.CCSSidepanelVoice = {
    VoicePanel,
    OffscreenSpeechRecognizer,
    VoiceRecognitionError
  };
})();
