// Voice engine picker bridge.
// The visible sidepanel cannot reliably trigger the native microphone prompt.
// Route microphone and Web Speech work through an MV3 offscreen document.

const CCS_VOICE_OFFSCREEN_PATH = 'offscreen/voice.html';

let ccsVoiceCreatingOffscreen = null;

async function ccsVoiceGetOffscreenContexts() {
  const offscreenUrl = chrome.runtime.getURL(CCS_VOICE_OFFSCREEN_PATH);
  if (chrome.runtime.getContexts) {
    return chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });
  }

  const matchedClients = await clients.matchAll();
  return matchedClients.filter((client) => client.url === offscreenUrl);
}

async function ccsVoiceHasOffscreenDocument() {
  const contexts = await ccsVoiceGetOffscreenContexts();
  return contexts.length > 0;
}

async function ccsVoiceEnsureOffscreenDocument() {
  if (!chrome.offscreen || !chrome.offscreen.createDocument) {
    throw new Error('offscreen-unavailable');
  }

  if (await ccsVoiceHasOffscreenDocument()) return;

  if (!ccsVoiceCreatingOffscreen) {
    ccsVoiceCreatingOffscreen = chrome.offscreen.createDocument({
      url: CCS_VOICE_OFFSCREEN_PATH,
      reasons: ['USER_MEDIA'],
      justification: 'Voice engine picker needs microphone access for one recognition request.'
    }).finally(() => {
      ccsVoiceCreatingOffscreen = null;
    });
  }

  await ccsVoiceCreatingOffscreen;
}

function ccsVoiceErrorPayload(error) {
  return {
    code: error?.code || error?.message || 'unknown-error',
    name: error?.name || 'Error',
    message: error?.message || String(error || 'unknown-error')
  };
}

async function ccsVoiceRecognize(request) {
  await ccsVoiceEnsureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    action: 'ccsVoiceRecognizeOffscreen',
    target: 'ccs-voice-offscreen',
    lang: request.lang || 'zh-CN',
    maxAlternatives: request.maxAlternatives || 10
  });

  if (!response) throw new Error('offscreen-no-response');
  return response;
}

async function ccsVoiceCancel() {
  if (!(await ccsVoiceHasOffscreenDocument())) return { success: true };
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'ccsVoiceCancelOffscreen',
      target: 'ccs-voice-offscreen'
    });
    return response || { success: true };
  } catch (_) {
    return { success: true };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || request.action !== 'ccsVoiceRecognize') return false;

  ccsVoiceRecognize(request)
    .then((response) => sendResponse(response))
    .catch((error) => {
      console.warn('[CCS Voice] Recognition bridge failed:', error);
      sendResponse({ success: false, error: ccsVoiceErrorPayload(error) });
    });
  return true;
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || request.action !== 'ccsVoiceCancel') return false;

  ccsVoiceCancel()
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ success: false, error: ccsVoiceErrorPayload(error) }));
  return true;
});
