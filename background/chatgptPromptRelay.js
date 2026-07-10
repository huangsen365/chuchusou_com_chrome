/**
 * AI prompt relay
 *
 * When a generated prompt makes an AI engine URL too long, keep the full prompt
 * inside extension storage and open the AI engine with only a compact relay
 * marker. content.js then reads the relay id from the URL and fills the
 * complete prompt into the composer after the page is ready.
 */
(() => {
  const RELAY_QUERY_KEY = 'ccs_pp';
  const STORAGE_PREFIX = 'ccs_ai_pending_prompt_';
  const TAB_STORAGE_PREFIX = 'ccs_ai_pending_tab_';
  const DIRECT_URL_LIMIT = 1800;
  const RELAY_TTL_MS = 30 * 60 * 1000;
  const AI_QUERY_PARAM_KEYS = ['prompt', 'q', 'query', 'text'];
  const YIYAN_CHAT_HOST = 'chat.baidu.com';
  const YIYAN_LEGACY_HOST = 'yiyan.baidu.com';
  const memoryStore = new Map();

  function ccsAIPromptStorageKey(id) {
    return `${STORAGE_PREFIX}${id}`;
  }

  function ccsAIPromptTabStorageKey(tabId) {
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
    return String(urlPattern || '')
      .split('${PROMPT}').join(encoded)
      .split('${KEYWORD}').join(encoded);
  }

  function ccsGetAIEngineForUrl(url) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      const hashText = (parsed.hash || '').replace(/^#/, '');
      const hasRelayId = parsed.searchParams.has(RELAY_QUERY_KEY) ||
        new URLSearchParams(hashText).has(RELAY_QUERY_KEY) ||
        /(?:^|[?&#])ccs_pp=([A-Za-z0-9_-]+)/.test(hashText);
      if (host === 'chatgpt.com' || host.endsWith('.chatgpt.com')) return 'chatgpt';
      if (host === 'claude.ai' || host.endsWith('.claude.ai')) return 'claude';
      if (host === 'grok.com' || host.endsWith('.grok.com')) return 'grok';
      if (host === YIYAN_CHAT_HOST || host === YIYAN_LEGACY_HOST) return 'yiyan';
      if ((host === 'google.com' || host.endsWith('.google.com')) && (parsed.searchParams.get('udm') === '50' || hasRelayId)) {
        return 'google-ai';
      }
      return '';
    } catch (_) {
      const raw = String(url || '');
      if (/(^|\/\/)([^/]+\.)?chatgpt\.com([/?#:]|$)/i.test(raw)) return 'chatgpt';
      if (/(^|\/\/)([^/]+\.)?claude\.ai([/?#:]|$)/i.test(raw)) return 'claude';
      if (/(^|\/\/)([^/]+\.)?grok\.com([/?#:]|$)/i.test(raw)) return 'grok';
      if (/(^|\/\/)chat\.baidu\.com([/?#:]|$)/i.test(raw)) return 'yiyan';
      if (/(^|\/\/)yiyan\.baidu\.com([/?#:]|$)/i.test(raw)) return 'yiyan';
      if (/(^|\/\/)([^/]+\.)?google\.com\/search\?/i.test(raw) && (/[?&]udm=50(&|$)/i.test(raw) || /[?&#]ccs_pp=[A-Za-z0-9_-]+/i.test(raw))) return 'google-ai';
      return '';
    }
  }

  function ccsIsSupportedAIUrl(url) {
    return !!ccsGetAIEngineForUrl(url);
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
      const engine = ccsGetAIEngineForUrl(ccsBuildPromptUrl(urlPattern, '.')) ||
        ccsGetAIEngineForUrl(ccsBuildPromptUrl(urlPattern, ''));
      const parsed = new URL(ccsBuildPromptUrl(urlPattern, ''));
      for (const key of AI_QUERY_PARAM_KEYS) {
        parsed.searchParams.delete(key);
      }
      parsed.searchParams.delete(RELAY_QUERY_KEY);
      if (engine === 'yiyan' && parsed.hostname.toLowerCase() === YIYAN_LEGACY_HOST) {
        // The legacy host is now only an upgrade notice. Keep accepting stale
        // saved URL patterns, but land their relay on the current chat entry.
        parsed.protocol = 'https:';
        parsed.hostname = YIYAN_CHAT_HOST;
        parsed.port = '';
        parsed.pathname = '/';
        parsed.searchParams.set('enter_type', 'yiyan_site');
      }
      if (engine === 'google-ai') {
        // Keep the relay id in query as well as hash, but do not add q.
        // A q value makes Google AI mode execute immediately instead of waiting
        // for content.js to fill the prompt into the visible input.
        parsed.searchParams.set(RELAY_QUERY_KEY, id);
      }

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

  async function ccsStorePendingAIPrompt(record) {
    const key = ccsAIPromptStorageKey(record.id);
    memoryStore.set(record.id, record);
    await ccsStorageSet(key, record);
    return record;
  }

  async function ccsReadPendingAIPrompt(id) {
    if (!id || typeof id !== 'string') return null;
    const key = ccsAIPromptStorageKey(id);
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

  async function ccsAckPendingAIPrompt(id) {
    if (!id || typeof id !== 'string') return false;
    memoryStore.delete(id);
    await ccsStorageRemove(ccsAIPromptStorageKey(id));
    return true;
  }

  async function ccsBindPendingAIPromptToTab(id, tabId) {
    if (!ccsIsValidRelayId(id) || typeof tabId !== 'number') return false;
    await ccsStorageSet(ccsAIPromptTabStorageKey(tabId), {
      id,
      tabId,
      createdAt: Date.now(),
      expiresAt: Date.now() + RELAY_TTL_MS
    });
    return true;
  }

  async function ccsReadPendingAIPromptForTab(tabId) {
    if (typeof tabId !== 'number') return null;
    const key = ccsAIPromptTabStorageKey(tabId);
    const mapping = await ccsStorageGet(key);
    if (!mapping?.id || !ccsIsValidRelayId(mapping.id)) return null;
    if (mapping.expiresAt && Date.now() > mapping.expiresAt) {
      await ccsStorageRemove(key);
      return null;
    }
    const record = await ccsReadPendingAIPrompt(mapping.id);
    return record ? { ...record, tabId } : null;
  }

  async function ccsResolvePendingAIPrompt(pendingId, tabId) {
    if (ccsIsValidRelayId(pendingId)) {
      return ccsReadPendingAIPrompt(pendingId);
    }
    return ccsReadPendingAIPromptForTab(tabId);
  }

  async function ccsAckPendingAIPromptForTab(id, tabId) {
    await ccsAckPendingAIPrompt(id);
    if (typeof tabId === 'number') {
      await ccsStorageRemove(ccsAIPromptTabStorageKey(tabId));
    }
    return true;
  }

  async function ccsBindPendingPromptForTabOnly(pendingId, tabId) {
    if (!pendingId || typeof tabId !== 'number') return;
    await ccsBindPendingAIPromptToTab(pendingId, tabId);
    // content.js now owns the auto-fill flow and polls this tab binding.
    // Avoid background push retries here: push + pull can race and append the
    // same prompt twice on editors such as yiyan.baidu.com.
  }

  async function ccsOpenPreparedAIPromptUrl(url, options = {}) {
    const pendingId = ccsExtractRelayIdFromUrl(url);
    if (!globalThis.chrome?.tabs?.create) return null;

    let recoveryRecord = null;
    if (pendingId && typeof globalThis.ccsCreateUrlRecoveryRecord === 'function') {
      try {
        const pending = await ccsReadPendingAIPrompt(pendingId);
        if (pending?.prompt) {
          recoveryRecord = globalThis.ccsCreateUrlRecoveryRecord({
            kind: 'ai',
            source: pending.source || 'ai-prompt-relay',
            menuId: pending.menuId || '',
            engineId: pending.engineId || pending.relayEngine || '',
            urlPattern: pending.urlPattern || '',
            originalText: pending.prompt,
            effectiveText: pending.prompt,
            targetUrl: url,
            originalUrlLength: pending.directUrlLength || 0,
            finalUrlLength: url.length,
            truncated: false,
            pendingId
          });
        }
      } catch (_) {
        recoveryRecord = null;
      }
    }

    if (typeof globalThis.ccsOpenUrlWithRecovery === 'function') {
      const tab = await globalThis.ccsOpenUrlWithRecovery(url, recoveryRecord, options);
      if (pendingId && typeof tab?.id === 'number') {
        ccsBindPendingPromptForTabOnly(pendingId, tab.id).catch(() => {});
      }
      return tab || null;
    }

    const createOptions = { url, active: options.active };
    if (createOptions.active === undefined) delete createOptions.active;

    return new Promise((resolve, reject) => {
      try {
        globalThis.chrome.tabs.create(createOptions, (tab) => {
          const error = globalThis.chrome?.runtime?.lastError;
          if (error) {
            reject(new Error(error.message || 'tabs.create failed'));
            return;
          }
          if (pendingId && typeof tab?.id === 'number') {
            ccsBindPendingPromptForTabOnly(pendingId, tab.id).catch(() => {});
          }
          resolve(tab || null);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function ccsPrepareAIPromptUrl(urlPattern, prompt, meta = {}) {
    const directUrl = ccsBuildPromptUrl(urlPattern, prompt);
    const engine = ccsGetAIEngineForUrl(directUrl);
    const hasPromptLineBreaks = /[\r\n]/.test(String(prompt || ''));
    // chat.baidu.com ignores the historical q URL parameter. Yiyan therefore
    // always uses storage relay, including short one-line prompts.
    const shouldRelay = !!meta.forceRelay || engine === 'google-ai' || engine === 'yiyan' ||
      hasPromptLineBreaks || directUrl.length > DIRECT_URL_LIMIT;
    if (!engine || !shouldRelay) {
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
      engineId: meta.engineId || engine,
      relayEngine: engine,
      urlPattern: String(urlPattern || ''),
      directUrlLength: directUrl.length
    };
    await ccsStorePendingAIPrompt(record);

    return ccsBuildRelayOnlyUrl(urlPattern, id);
  }

  globalThis.CCS_AI_PROMPT_RELAY = {
    RELAY_QUERY_KEY,
    DIRECT_URL_LIMIT,
    RELAY_TTL_MS
  };
  globalThis.CCS_CHATGPT_PROMPT_RELAY = globalThis.CCS_AI_PROMPT_RELAY;
  globalThis.ccsGetAIEngineForUrl = ccsGetAIEngineForUrl;
  globalThis.ccsIsSupportedAIUrl = ccsIsSupportedAIUrl;
  globalThis.ccsPrepareAIPromptUrl = ccsPrepareAIPromptUrl;
  globalThis.ccsReadPendingAIPrompt = ccsReadPendingAIPrompt;
  globalThis.ccsResolvePendingAIPrompt = ccsResolvePendingAIPrompt;
  globalThis.ccsAckPendingAIPrompt = ccsAckPendingAIPrompt;
  globalThis.ccsAckPendingAIPromptForTab = ccsAckPendingAIPromptForTab;
  globalThis.ccsOpenPreparedAIPromptUrl = ccsOpenPreparedAIPromptUrl;

  // Backward-compatible aliases used by the first ChatGPT-only implementation.
  globalThis.ccsPrepareChatGptPromptUrl = ccsPrepareAIPromptUrl;
  globalThis.ccsReadPendingChatGptPrompt = ccsReadPendingAIPrompt;
  globalThis.ccsResolvePendingChatGptPrompt = ccsResolvePendingAIPrompt;
  globalThis.ccsAckPendingChatGptPrompt = ccsAckPendingAIPrompt;
  globalThis.ccsAckPendingChatGptPromptForTab = ccsAckPendingAIPromptForTab;
  globalThis.ccsOpenPreparedChatGptPromptUrl = ccsOpenPreparedAIPromptUrl;
})();
