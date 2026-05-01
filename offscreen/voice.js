// Offscreen voice recognizer for the sidepanel voice engine picker.

(function () {
  let activeRecognition = null;
  let activeStream = null;

  function getSpeechRecognitionCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition;
  }

  function serializeError(error, fallbackCode = 'recognition-error') {
    return {
      code: error?.code || error?.message || error?.name || fallbackCode,
      name: error?.name || 'Error',
      message: error?.message || String(error || fallbackCode),
      permissionState: error?.permissionState || null
    };
  }

  function stopActiveStream() {
    if (!activeStream) return;
    activeStream.getTracks().forEach((track) => track.stop());
    activeStream = null;
  }

  function abortActiveRecognition() {
    if (!activeRecognition) return;
    try { activeRecognition.abort(); } catch (_) { /* ignore */ }
    activeRecognition = null;
  }

  async function queryMicPermission() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) return 'unknown';
      const status = await navigator.permissions.query({ name: 'microphone' });
      return status?.state || 'unknown';
    } catch (_) {
      return 'unknown';
    }
  }

  async function requestMicAccess() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const err = new Error('media-devices-unavailable');
      err.code = 'media-devices-unavailable';
      throw err;
    }

    const permissionState = await queryMicPermission();
    if (permissionState === 'denied') {
      const err = new Error('permission-denied');
      err.name = 'NotAllowedError';
      err.code = 'permission-denied';
      err.permissionState = permissionState;
      throw err;
    }

    try {
      activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      return permissionState;
    } catch (error) {
      error.permissionState = permissionState;
      throw error;
    } finally {
      stopActiveStream();
    }
  }

  function recognizeWithWebSpeech(options) {
    const SR = getSpeechRecognitionCtor();
    if (!SR) {
      const err = new Error('speech-recognition-unavailable');
      err.code = 'speech-recognition-unavailable';
      throw err;
    }

    return new Promise((resolve, reject) => {
      const recognition = new SR();
      activeRecognition = recognition;
      recognition.lang = options.lang || 'zh-CN';
      recognition.interimResults = false;
      recognition.maxAlternatives = options.maxAlternatives || 10;
      recognition.continuous = false;

      let settled = false;
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        activeRecognition = null;
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

  async function recognize(options) {
    abortActiveRecognition();
    stopActiveStream();
    const permissionState = await requestMicAccess();
    const candidates = await recognizeWithWebSpeech(options);
    return { success: true, candidates, permissionState };
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || request.target !== 'ccs-voice-offscreen') return false;

    if (request.action === 'ccsVoiceRecognizeOffscreen') {
      recognize(request)
        .then((response) => sendResponse(response))
        .catch((error) => {
          console.warn('[CCS Voice Offscreen] Recognition failed:', error);
          sendResponse({ success: false, error: serializeError(error) });
        });
      return true;
    }

    if (request.action === 'ccsVoiceCancelOffscreen') {
      abortActiveRecognition();
      stopActiveStream();
      sendResponse({ success: true });
      return false;
    }

    return false;
  });
}());
