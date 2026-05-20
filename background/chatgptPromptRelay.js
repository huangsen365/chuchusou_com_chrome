/**
 * ChatGPT prompt relay
 *
 * When a generated prompt makes the ChatGPT URL too long, keep the full prompt
 * inside extension storage and open ChatGPT with only a compact relay marker.
 * content.js then reads the relay id from the URL and fills the complete prompt
 * into the composer after the page is ready.
 */
(() => {
  const RELAY_QUERY_KEY = 'ccs_pp';
  const STORAGE_PREFIX = 'ccs_chatgpt_pending_prompt_';
  const TAB_STORAGE_PREFIX = 'ccs_chatgpt_pending_tab_';
  const DIRECT_URL_LIMIT = 5500;
  const RELAY_TTL_MS = 30 * 60 * 1000;
  const memoryStore = new Map();

  function ccsChatGptPromptStorageKey(id) {
    return `${STORAGE_PREFIX}${id}`;
  }

  function ccsChatGptPromptTabStorageKey(tabId) {
    return `${TAB_STORAGE_PREFIX}${tabId}`;
  }

  function ccsCreatePromptRelayId() {
    return `p${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function ccsGetStorageArea() {
    const storage = globalThis.chrome?.storage;
    return storage?.session || storage?.local || null;
  }

  function ccsStorageGet(key) {
    return new Promise((resolve) => {
      const area = ccsGetStorageArea();
      if (!area?.get) {
        resolve(undefined);
        return;
      }
      try {
        area.get([key], (data) => {
          if (globalThis.chrome?.runtime?.lastError) {
            resolve(undefined);
            return;
          }
          resolve(data?.[key]);
        });
      } catch (_) {
        resolve(undefined);
      }
    });
  }

  function ccsStorageSet(key, value) {
    return new Promise((resolve) => {
      const area = ccsGetStorageArea();
      if (!area?.set) {
        resolve(false);
        return;
      }
      try {
        area.set({ [key]: value }, () => {
          resolve(!globalThis.chrome?.runtime?.lastError);
        });
      } catch (_) {
        resolve(false);
      }
    });
  }

  function ccsStorageRemove(key) {
    return new Promise((resolve) => {
      const area = ccsGetStorageArea();
      if (!area?.remove) {
        resolve(false);
        return;
      }
      try {
        area.remove([key], () => {
          resolve(!globalThis.chrome?.runtime?.lastError);
        });
      } catch (_) {
        resolve(false);
      }
    });
  }

  function ccsBuildPromptUrl(urlPattern, prompt) {
    const encoded = encodeURIComponent(typeof prompt === 'string' ? prompt : '');
    return String(urlPattern || '').split('${PROMPT}').join(encoded);
  }

  function ccsIsChatGptUrl(url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === 'chatgpt.com' || host.endsWith('.chatgpt.com');
    } catch (_) {
      return /(^|\/\/)([^/]+\.)?chatgpt\.com([/?#:]|$)/i.test(String(url || ''));
    }
  }

  function ccsAppendRelayId(url, id) {
    try {
      const parsed = new URL(url);
      parsed.searchParams.set(RELAY_QUERY_KEY, id);
      const hashText = (parsed.hash || '').replace(/^#/, '');
      const hashParams = new URLSearchParams(hashText);
      hashParams.set(RELAY_QUERY_KEY, id);
      parsed.hash = hashParams.toString();
      return parsed.toString();
    } catch (_) {
      const separator = String(url || '').includes('?') ? '&' : '?';
      return `${url}${separator}${RELAY_QUERY_KEY}=${encodeURIComponent(id)}#${RELAY_QUERY_KEY}=${encodeURIComponent(id)}`;
    }
  }

  function ccsBuildRelayOnlyUrl(urlPattern, id) {
    try {
      const parsed = new URL(ccsBuildPromptUrl(urlPattern, ''));
      parsed.searchParams.delete('prompt');
      parsed.searchParams.delete('q');
      parsed.searchParams.delete(RELAY_QUERY_KEY);

      const hashText = (parsed.hash || '').replace(/^#/, '');
      const hashParams = new URLSearchParams(hashText);
      hashParams.set(RELAY_QUERY_KEY, id);
      parsed.hash = hashParams.toString();
      return parsed.toString();
    } catch (_) {
      const fallback = 'https://chatgpt.com/';
      return ccsAppendRelayId(fallback, id);
    }
  }

  function ccsExtractRelayIdFromUrl(url) {
    try {
      const parsed = new URL(url);
      const fromQuery = parsed.searchParams.get(RELAY_QUERY_KEY);
      if (ccsIsValidRelayId(fromQuery)) return fromQuery;

      const hashText = (parsed.hash || '').replace(/^#/, '');
      const fromHashParams = new URLSearchParams(hashText).get(RELAY_QUERY_KEY);
      if (ccsIsValidRelayId(fromHashParams)) return fromHashParams;

      const fromHash = hashText.match(/(?:^|[?&#])ccs_pp=([A-Za-z0-9_-]+)/);
      return ccsIsValidRelayId(fromHash?.[1]) ? fromHash[1] : '';
    } catch (_) {
      return '';
    }
  }

  function ccsIsValidRelayId(id) {
    return typeof id === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(id);
  }

  async function ccsStorePendingChatGptPrompt(record) {
    const key = ccsChatGptPromptStorageKey(record.id);
    memoryStore.set(record.id, record);
    await ccsStorageSet(key, record);
    return record;
  }

  async function ccsReadPendingChatGptPrompt(id) {
    if (!id || typeof id !== 'string') return null;
    const key = ccsChatGptPromptStorageKey(id);
    const stored = await ccsStorageGet(key);
    const record = stored || memoryStore.get(id) || null;
    if (!record || typeof record.prompt !== 'string') return null;

    if (record.expiresAt && Date.now() > record.expiresAt) {
      memoryStore.delete(id);
      await ccsStorageRemove(key);
      return null;
    }

    return record;
  }

  async function ccsAckPendingChatGptPrompt(id) {
    if (!id || typeof id !== 'string') return false;
    memoryStore.delete(id);
    await ccsStorageRemove(ccsChatGptPromptStorageKey(id));
    return true;
  }

  async function ccsBindPendingChatGptPromptToTab(id, tabId) {
    if (!ccsIsValidRelayId(id) || typeof tabId !== 'number') return false;
    await ccsStorageSet(ccsChatGptPromptTabStorageKey(tabId), {
      id,
      tabId,
      createdAt: Date.now(),
      expiresAt: Date.now() + RELAY_TTL_MS
    });
    return true;
  }

  async function ccsReadPendingChatGptPromptForTab(tabId) {
    if (typeof tabId !== 'number') return null;
    const key = ccsChatGptPromptTabStorageKey(tabId);
    const mapping = await ccsStorageGet(key);
    if (!mapping?.id || !ccsIsValidRelayId(mapping.id)) return null;
    if (mapping.expiresAt && Date.now() > mapping.expiresAt) {
      await ccsStorageRemove(key);
      return null;
    }
    const record = await ccsReadPendingChatGptPrompt(mapping.id);
    return record ? { ...record, tabId } : null;
  }

  async function ccsResolvePendingChatGptPrompt(pendingId, tabId) {
    if (ccsIsValidRelayId(pendingId)) {
      return ccsReadPendingChatGptPrompt(pendingId);
    }
    return ccsReadPendingChatGptPromptForTab(tabId);
  }

  async function ccsAckPendingChatGptPromptForTab(id, tabId) {
    await ccsAckPendingChatGptPrompt(id);
    if (typeof tabId === 'number') {
      await ccsStorageRemove(ccsChatGptPromptTabStorageKey(tabId));
    }
    return true;
  }

  function ccsSendPendingPromptToTab(tabId, pendingId) {
    if (typeof tabId !== 'number' || !ccsIsValidRelayId(pendingId)) return;
    ccsReadPendingChatGptPrompt(pendingId).then((record) => {
      if (!record?.prompt || !globalThis.chrome?.tabs?.sendMessage) return;
      try {
        globalThis.chrome.tabs.sendMessage(tabId, {
          action: 'ccsFillChatGptPrompt',
          text: record.prompt,
          pendingId,
          source: 'chatgpt-prompt-relay'
        }, (response) => {
          if (globalThis.chrome?.runtime?.lastError) return;
          if (response?.ok) {
            ccsAckPendingChatGptPromptForTab(pendingId, tabId).catch(() => {});
          }
        });
      } catch (_) {
        // content script may not be available yet; scheduled retries handle this.
      }
    }).catch(() => {});
  }

  function ccsSchedulePendingPromptPush(tabId, pendingId) {
    for (const delayMs of [400, 1200, 2500, 5000, 9000, 15000]) {
      setTimeout(() => ccsSendPendingPromptToTab(tabId, pendingId), delayMs);
    }
  }

  async function ccsOpenPreparedChatGptPromptUrl(url, options = {}) {
    const pendingId = ccsExtractRelayIdFromUrl(url);
    const createOptions = { url, active: options.active };
    if (createOptions.active === undefined) delete createOptions.active;

    if (!globalThis.chrome?.tabs?.create) return null;

    return new Promise((resolve, reject) => {
      try {
        globalThis.chrome.tabs.create(createOptions, (tab) => {
          const error = globalThis.chrome?.runtime?.lastError;
          if (error) {
            reject(new Error(error.message || 'tabs.create failed'));
            return;
          }
          if (pendingId && typeof tab?.id === 'number') {
            ccsBindPendingChatGptPromptToTab(pendingId, tab.id)
              .then(() => ccsSchedulePendingPromptPush(tab.id, pendingId))
              .catch(() => {});
          }
          resolve(tab || null);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function ccsPrepareChatGptPromptUrl(urlPattern, prompt, meta = {}) {
    const directUrl = ccsBuildPromptUrl(urlPattern, prompt);
    if (!ccsIsChatGptUrl(directUrl) || directUrl.length <= DIRECT_URL_LIMIT) {
      return directUrl;
    }

    const id = ccsCreatePromptRelayId();
    const now = Date.now();
    const record = {
      id,
      prompt: String(prompt || ''),
      createdAt: now,
      expiresAt: now + RELAY_TTL_MS,
      source: meta.source || 'ai-task',
      taskId: meta.taskId || '',
      menuId: meta.menuId || '',
      categoryId: meta.categoryId || '',
      engineId: meta.engineId || ''
    };
    await ccsStorePendingChatGptPrompt(record);

    return ccsBuildRelayOnlyUrl(urlPattern, id);
  }

  globalThis.CCS_CHATGPT_PROMPT_RELAY = {
    RELAY_QUERY_KEY,
    DIRECT_URL_LIMIT,
    RELAY_TTL_MS
  };
  globalThis.ccsPrepareChatGptPromptUrl = ccsPrepareChatGptPromptUrl;
  globalThis.ccsReadPendingChatGptPrompt = ccsReadPendingChatGptPrompt;
  globalThis.ccsResolvePendingChatGptPrompt = ccsResolvePendingChatGptPrompt;
  globalThis.ccsAckPendingChatGptPrompt = ccsAckPendingChatGptPrompt;
  globalThis.ccsAckPendingChatGptPromptForTab = ccsAckPendingChatGptPromptForTab;
  globalThis.ccsOpenPreparedChatGptPromptUrl = ccsOpenPreparedChatGptPromptUrl;
})();
