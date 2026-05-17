/* sidepanel-v2/voice.js —— 语音选引擎模块（lazy load）
 *
 * 与 sidepanel.js 解耦：仅在 ccs_voice_enabled=true 且用户点🎤 时通过 dynamic script
 * 加载。装载完成后挂 window.CCSVoice，主 sidepanel 通过 init({...deps}) 注入依赖。
 *
 * 业务行为与旧 sidepanel/sidepanel.js 行 131-555 完全一致：
 * - 闭集识别（候选词汇 = 13 个引擎别名表）
 * - 永远 top-10 候选让用户把关，不自动跳转
 * - 用户每次选择喂给 reranker（chrome.storage.local 历史频次）
 * - V1 走浏览器 Web Speech API（chrome.runtime.sendMessage 给 offscreen 处理）
 */
(() => {
  'use strict';

  // ===== 常量 =====
  const VOICE_HISTORY_KEY = 'ccs_voice_history';
  const VOICE_INTRO_SEEN_KEY = 'ccs_voice_intro_seen';

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

  // ===== 文本匹配工具 =====
  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a) return b.length;
    if (!b) return a.length;
    const m = [];
    for (let i = 0; i <= b.length; i++) m[i] = [i];
    for (let j = 0; j <= a.length; j++) m[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        m[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
          ? m[i - 1][j - 1]
          : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
      }
    }
    return m[b.length][a.length];
  }
  function normalizeAsrText(s) {
    return (s || '').toLowerCase().replace(/[\s.,!?。，！？、；;]/g, '');
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

  // ===== Voice 识别器封装（V1 走 background offscreen sendMessage） =====
  function isWebSpeechSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }
  function isRecognizerSupported() {
    const hasBridge = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage;
    return !!(hasBridge && isWebSpeechSupported());
  }
  async function recognizeOnce() {
    const resp = await chrome.runtime.sendMessage({ action: 'ccsVoiceRecognize', lang: 'zh-CN', maxAlternatives: 10 });
    if (!resp) throw { code: 'offscreen-no-response' };
    if (!resp.success) throw resp.error || { code: 'recognition-error' };
    return Array.isArray(resp.candidates) ? resp.candidates : [];
  }
  async function cancelRecognize() {
    try { await chrome.runtime.sendMessage({ action: 'ccsVoiceCancel' }); } catch (_) {}
  }

  function getVoicePermissionUrl() {
    return chrome.runtime.getURL('voice-permission/permission.html');
  }
  function getMicSettingsUrl() {
    try {
      const id = chrome.runtime.id;
      if (id) return `chrome://settings/content/siteDetails?site=chrome-extension%3A%2F%2F${id}`;
    } catch (_) {}
    return 'chrome://settings/content/microphone';
  }

  // ===== DOM 注入：voice.js 自己往 .sp-voice 容器里填 UI（懒构建） =====
  function injectDom(container) {
    container.innerHTML = ''
      + '<div class="sp-voice-intro" hidden>'
      +   '<h4 class="sp-voice-intro-title">🎤 语音选择搜索引擎</h4>'
      +   '<ul class="sp-voice-intro-list">'
      +     '<li>仅在你点击 🎤 按钮时启用麦克风，识别完立即关闭</li>'
      +     '<li>仅识别引擎名（如"百度"、"GPT"、"知乎"），<b>不会上传你选中的文字</b></li>'
      +     '<li>当前版本走浏览器内置语音识别（首次需联网）</li>'
      +     '<li>可随时在 chrome://settings/content/microphone 撤回授权</li>'
      +   '</ul>'
      +   '<div class="sp-voice-intro-actions">'
      +     '<button class="sp-voice-intro-ok" type="button">明白了，开始录音</button>'
      +     '<button class="sp-voice-intro-cancel" type="button">取消</button>'
      +   '</div>'
      + '</div>'
      + '<div class="sp-voice-status" hidden>'
      +   '<span class="sp-voice-status-icon">🎤</span>'
      +   '<span class="sp-voice-status-text">准备就绪</span>'
      + '</div>'
      + '<div class="sp-voice-help" hidden>'
      +   '<p class="sp-voice-help-text">点击下面按钮跳到 Chrome 麦克风设置，找到本扩展把状态改成「允许」，回来点重新录音。</p>'
      +   '<button class="sp-voice-help-btn" type="button">🔓 去 Chrome 设置开启</button>'
      + '</div>'
      + '<ul class="sp-voice-list" hidden></ul>'
      + '<div class="sp-voice-actions" hidden>'
      +   '<button class="sp-voice-retry" type="button">🎤 重新录音</button>'
      +   '<button class="sp-voice-cancel" type="button">✕ 取消</button>'
      + '</div>';
  }

  // ===== VoicePanel —— 主入口 =====
  function createVoicePanel(deps) {
    const showToast = deps.showToast || ((m) => console.log(m));
    const getKeyword = deps.getKeyword || (() => '');
    const onPick = deps.onPick || (() => {});

    const $voice = document.getElementById('spVoice');
    if (!$voice) return null;
    injectDom($voice);

    const $intro = $voice.querySelector('.sp-voice-intro');
    const $status = $voice.querySelector('.sp-voice-status');
    const $statusIcon = $voice.querySelector('.sp-voice-status-icon');
    const $statusText = $voice.querySelector('.sp-voice-status-text');
    const $help = $voice.querySelector('.sp-voice-help');
    const $helpText = $voice.querySelector('.sp-voice-help-text');
    const $helpBtn = $voice.querySelector('.sp-voice-help-btn');
    const $list = $voice.querySelector('.sp-voice-list');
    const $actions = $voice.querySelector('.sp-voice-actions');
    const $voiceBtn = document.getElementById('spKeywordVoice');

    let history = {};
    let introSeen = false;
    let busy = false;
    let runId = 0;
    let helpTargetUrl = getVoicePermissionUrl();

    function loadState() {
      chrome.storage.local.get([VOICE_HISTORY_KEY, VOICE_INTRO_SEEN_KEY], (r) => {
        history = r[VOICE_HISTORY_KEY] || {};
        introSeen = !!r[VOICE_INTRO_SEEN_KEY];
      });
    }
    loadState();

    if (!isRecognizerSupported() && $voiceBtn) {
      $voiceBtn.hidden = true;
      $voiceBtn.dataset.disabled = 'true';
    }

    function setStatus(state, icon, text) {
      $status.classList.remove('recording', 'error', 'done');
      $status.classList.add(state);
      $statusIcon.textContent = icon;
      $statusText.textContent = text;
    }

    function showIntro() {
      $voice.hidden = false;
      $intro.hidden = false;
      $status.hidden = true;
      $list.hidden = true; $list.innerHTML = '';
      $help.hidden = true;
      $actions.hidden = true;
    }
    function showRecording() {
      $voice.hidden = false;
      $intro.hidden = true;
      $status.hidden = false;
      $list.hidden = true; $list.innerHTML = '';
      $help.hidden = true;
      $actions.hidden = false;
    }
    function hide() {
      $voice.hidden = true;
      $intro.hidden = true;
      $status.hidden = true;
      $list.hidden = true; $list.innerHTML = '';
      $help.hidden = true;
      $actions.hidden = true;
    }
    function showPermissionHelp(kind) {
      if (kind === 'settings') {
        helpTargetUrl = getMicSettingsUrl();
        $helpText.textContent = 'Chrome 已记录为拒绝麦克风。点击下面按钮打开本扩展的麦克风设置，把状态改成「允许」，回来点重新录音。';
        $helpBtn.textContent = '🔓 去 Chrome 设置开启';
      } else {
        helpTargetUrl = getVoicePermissionUrl();
        $helpText.textContent = 'Chrome 隐藏录音页仍拿不到麦克风。点击下面按钮打开可见录音页，在新页完成录音后，候选列表会回到这里。';
        $helpBtn.textContent = '🎤 打开可见录音页';
      }
      $help.hidden = false;
    }

    async function startRecognition() {
      if (busy) return;
      const myRunId = ++runId;
      busy = true;
      showRecording();
      if ($voiceBtn) $voiceBtn.classList.add('recording');
      setStatus('recording', '🎤', '正在请求麦克风权限——请留意 Chrome 顶部弹出的授权对话框');
      let candidates;
      try {
        candidates = await recognizeOnce();
      } catch (err) {
        if (myRunId !== runId) return;
        console.warn('[sp-v2][Voice] 识别失败:', err);
        if ($voiceBtn) $voiceBtn.classList.remove('recording');
        busy = false;
        const code = err.code || err.message || err.name || '';
        if (code === 'permission-denied' || code === 'not-allowed' || code === 'service-not-allowed'
            || code === 'NotAllowedError' || err.name === 'NotAllowedError') {
          const state = err.details?.permissionState || '';
          setStatus('error', '🚫', state === 'denied' ? '麦克风权限被拒绝' : '需要先完成麦克风授权');
          showPermissionHelp(state === 'denied' ? 'settings' : 'grant');
          return;
        }
        const msg = code === 'no-speech' ? '没听到声音，请再试一次或点取消'
                  : code === 'audio-capture' || code === 'NotFoundError' ? '没找到麦克风设备'
                  : code === 'network' ? '识别引擎需要联网（V1 用 Web Speech）'
                  : code === 'offscreen-unavailable' ? '当前 Chrome 版本不支持扩展离屏录音'
                  : `识别失败：${code}`;
        setStatus('error', '⚠️', msg);
        return;
      }
      if (myRunId !== runId) return;
      finishRecognition(candidates);
    }

    function rankEngines(asrCandidates) {
      const engineItems = deps.collectEngineItems ? deps.collectEngineItems() : Object.keys(VOICE_ALIAS_MAP).map((id) => ({ id }));
      const histValues = Object.values(history);
      const maxCount = Math.max(1, ...histValues);
      const scored = engineItems.map((item) => {
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
          const acoustic = cand.score || 0.5;
          const pair = acoustic * 0.4 + matchSim * 0.6;
          if (pair > bestPair) bestPair = pair;
        }
        const histBoost = (history[item.id] || 0) / maxCount;
        const finalScore = bestPair * 0.85 + histBoost * 0.15;
        return { item, score: finalScore, matchOnly: bestPair };
      });
      return scored.filter((x) => x.matchOnly > 0.15).sort((a, b) => b.score - a.score).slice(0, 10);
    }

    function finishRecognition(candidates) {
      if ($voiceBtn) $voiceBtn.classList.remove('recording');
      busy = false;
      $voice.hidden = false;
      $intro.hidden = true;
      $status.hidden = false;
      $help.hidden = true;
      $actions.hidden = false;
      const ranked = rankEngines(candidates);
      if (!ranked.length) {
        setStatus('error', '🤔', '没匹配到引擎，请重录或取消');
        return;
      }
      const heard = candidates[0]?.text || '';
      setStatus('done', '✓', `听到：「${heard}」—— 请从下方选择`);
      renderCandidates(ranked);
    }

    function renderCandidates(ranked) {
      $list.innerHTML = '';
      $list.hidden = false;
      const max = ranked[0]?.score || 1;
      ranked.forEach((entry, i) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sp-voice-item' + (i === 0 ? ' top' : '');
        const pct = Math.max(5, Math.round((entry.score / max) * 100));
        const safe = (s) => String(s || '').replace(/[<>&]/g, (c) => ({ '<':'&lt;','>':'&gt;','&':'&amp;' }[c]));
        btn.innerHTML = `<span class="sp-voice-item-icon">${safe(entry.item.icon || '🔍')}</span>`
          + `<span class="sp-voice-item-title">${safe(entry.item.title || entry.item.id)}</span>`
          + `<span class="sp-voice-item-bar"><span class="sp-voice-item-bar-fill" style="width:${pct}%"></span></span>`
          + `<span class="sp-voice-item-pct">${pct}%</span>`;
        btn.addEventListener('click', () => pick(entry.item));
        li.appendChild(btn);
        $list.appendChild(li);
      });
    }

    function pick(item) {
      history[item.id] = (history[item.id] || 0) + 1;
      try { chrome.storage.local.set({ [VOICE_HISTORY_KEY]: history }); } catch (_) {}
      hide();
      onPick(item);
    }

    function cancel() {
      runId++;
      busy = false;
      if ($voiceBtn) $voiceBtn.classList.remove('recording');
      cancelRecognize();
      hide();
    }

    // 入口：点🎤
    function start() {
      if (busy) return;
      if (!getKeyword()) { showToast('请先选中文字或读剪贴板'); return; }
      if (!introSeen) { showIntro(); return; }
      startRecognition();
    }

    function confirmIntro() {
      introSeen = true;
      try { chrome.storage.local.set({ [VOICE_INTRO_SEEN_KEY]: true }); } catch (_) {}
      startRecognition();
    }

    // 接 background push 的 ccsVoice* 消息
    function handleMessage(action, message) {
      if (action === 'ccsVoicePermissionGranted') {
        $voice.hidden = false;
        $intro.hidden = true;
        $status.hidden = false;
        $list.hidden = true; $list.innerHTML = '';
        $help.hidden = true;
        $actions.hidden = false;
        setStatus('done', '✓', '麦克风授权成功，请点重新录音');
      } else if (action === 'ccsVoiceVisibleRecognized') {
        const cands = Array.isArray(message.candidates) ? message.candidates : [];
        finishRecognition(cands);
      } else if (action === 'ccsVoiceVisibleError') {
        if ($voiceBtn) $voiceBtn.classList.remove('recording');
        busy = false;
        $voice.hidden = false;
        $intro.hidden = true;
        $status.hidden = false;
        $list.hidden = true; $list.innerHTML = '';
        $help.hidden = true;
        $actions.hidden = false;
        setStatus('error', '⚠️', message.error || '可见录音页识别失败，请重试');
      }
    }

    // 绑定内部按钮
    $voice.querySelector('.sp-voice-intro-ok')?.addEventListener('click', confirmIntro);
    $voice.querySelector('.sp-voice-intro-cancel')?.addEventListener('click', cancel);
    $voice.querySelector('.sp-voice-cancel')?.addEventListener('click', cancel);
    $voice.querySelector('.sp-voice-retry')?.addEventListener('click', startRecognition);
    $helpBtn.addEventListener('click', () => {
      try { chrome.tabs.create({ url: helpTargetUrl }); } catch (_) {}
    });

    return { start, cancel, handleMessage, isSupported: isRecognizerSupported };
  }

  globalThis.CCSVoice = { create: createVoicePanel, isSupported: isRecognizerSupported };
})();
