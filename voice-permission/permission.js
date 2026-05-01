(function () {
  const grantBtn = document.getElementById('vpGrant');
  const settingsBtn = document.getElementById('vpSettings');
  const statusEl = document.getElementById('vpStatus');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  function setStatus(text, tone) {
    statusEl.textContent = text;
    statusEl.style.color = tone === 'error' ? '#b91c1c' : tone === 'success' ? '#166534' : '#0c4a6e';
  }

  function getMicSettingsUrl() {
    try {
      const extId = chrome.runtime.id;
      if (extId) return `chrome://settings/content/siteDetails?site=chrome-extension%3A%2F%2F${extId}`;
    } catch (_) { /* fallback below */ }
    return 'chrome://settings/content/microphone';
  }

  function stopStream(stream) {
    if (!stream) return;
    stream.getTracks().forEach((track) => track.stop());
  }

  async function notifyGranted() {
    try {
      await chrome.storage.local.set({ ccs_voice_mic_granted_at: Date.now() });
      await chrome.runtime.sendMessage({ action: 'ccsVoicePermissionGranted' });
    } catch (_) {
      // Sidepanel may not be open; permission itself is already granted.
    }
  }

  async function sendRecognized(candidates) {
    try {
      await chrome.runtime.sendMessage({
        action: 'ccsVoiceVisibleRecognized',
        candidates
      });
    } catch (_) {
      // Sidepanel may have been closed; keep the result visible here.
    }
  }

  async function sendVisibleError(error) {
    try {
      await chrome.runtime.sendMessage({
        action: 'ccsVoiceVisibleError',
        error
      });
    } catch (_) {
      // Sidepanel may have been closed.
    }
  }

  function recognizeWithWebSpeech() {
    if (!SR) {
      const err = new Error('当前浏览器不支持 Web Speech API');
      err.code = 'speech-recognition-unavailable';
      throw err;
    }

    return new Promise((resolve, reject) => {
      const recognition = new SR();
      recognition.lang = 'zh-CN';
      recognition.interimResults = false;
      recognition.maxAlternatives = 10;
      recognition.continuous = false;

      let settled = false;
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };

      recognition.onresult = (event) => {
        const out = [];
        const alternatives = event.results && event.results[0];
        if (alternatives) {
          for (let i = 0; i < alternatives.length; i++) {
            out.push({
              text: alternatives[i].transcript,
              score: alternatives[i].confidence ?? 0.5
            });
          }
        }
        settle(resolve, out);
      };

      recognition.onerror = (event) => {
        const err = new Error(event.error || 'recognition-error');
        err.code = event.error || 'recognition-error';
        settle(reject, err);
      };

      recognition.onend = () => {
        const err = new Error('no-speech');
        err.code = 'no-speech';
        settle(reject, err);
      };

      try {
        recognition.start();
      } catch (error) {
        settle(reject, error);
      }
    });
  }

  async function requestMicAndRecognize() {
    grantBtn.disabled = true;
    setStatus('正在请求麦克风。如果 Chrome 弹出授权框，请选择允许。');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stopStream(stream);
      await notifyGranted();
      setStatus('麦克风已就绪，正在听...请说出引擎名，例如“百度”“GPT”“知乎”。');
      const candidates = await recognizeWithWebSpeech();
      await sendRecognized(candidates);
      const heard = candidates[0]?.text || '';
      setStatus(heard ? `已听到：「${heard}」。请回到侧边栏选择候选引擎。` : '识别完成。请回到侧边栏选择候选引擎。', 'success');
      grantBtn.textContent = '重新录音';
      grantBtn.disabled = false;
    } catch (error) {
      console.warn('[CCS Voice Permission] visible recognition failed:', error);
      const name = error?.name || '';
      const message = error?.message || '';
      const code = error?.code || message || name;
      const denied = name === 'NotAllowedError' || name === 'PermissionDeniedError';
      const text = denied
        ? `仍未获得麦克风权限：${message || name}。请点下方按钮到 Chrome 设置里改为允许。`
        : code === 'no-speech'
          ? '没听到声音，请点“重新录音”再试一次。'
          : code === 'network'
            ? '浏览器语音识别需要联网，请检查网络后重试。'
            : `录音或识别失败：${message || name || code || '未知错误'}`;
      setStatus(text, 'error');
      await sendVisibleError(text);
      grantBtn.textContent = '重新录音';
      grantBtn.disabled = false;
    }
  }

  grantBtn.addEventListener('click', requestMicAndRecognize);
  settingsBtn.addEventListener('click', () => {
    try { chrome.tabs.create({ url: getMicSettingsUrl() }); } catch (_) { /* ignore */ }
  });
}());
