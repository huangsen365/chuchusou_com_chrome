/**
 * URL safety and recovery.
 *
 * This module keeps plugin-opened URLs below conservative request-line limits
 * for regular search engines, records enough context to recover from 4xx
 * failures, and surfaces 431 recovery UI through content.js when possible.
 */
(() => {
  const REGULAR_URL_HARD_CAP = 1800;
  const REGULAR_URL_WARN_CAP = 1500;
  const RECOVERY_TTL_MS = 30 * 60 * 1000;
  const RECOVERY_STORAGE_PREFIX = 'ccs_url_recovery_';
  const RECOVERY_TAB_STORAGE_PREFIX = 'ccs_url_recovery_tab_';
  const COMMON_TEXT_PARAM_KEYS = ['q', 'wd', 'query', 'keyword', 'text', 'prompt'];

  const recoveryStore = new Map();
  const tabRecoveryStore = new Map();
  let monitorInstalled = false;
  let googleRelayNormalizerInstalled = false;

  function getStorageArea() {
    const storage = globalThis.chrome?.storage;
    return storage?.session || storage?.local || null;
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      const area = getStorageArea();
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

  function storageSet(key, value) {
    return new Promise((resolve) => {
      const area = getStorageArea();
      if (!area?.set) {
        resolve(false);
        return;
      }
      try {
        area.set({ [key]: value }, () => resolve(!globalThis.chrome?.runtime?.lastError));
      } catch (_) {
        resolve(false);
      }
    });
  }

  function storageRemove(key) {
    return new Promise((resolve) => {
      const area = getStorageArea();
      if (!area?.remove) {
        resolve(false);
        return;
      }
      try {
        area.remove([key], () => resolve(!globalThis.chrome?.runtime?.lastError));
      } catch (_) {
        resolve(false);
      }
    });
  }

  function recoveryStorageKey(id) {
    return `${RECOVERY_STORAGE_PREFIX}${id}`;
  }

  function tabRecoveryStorageKey(tabId) {
    return `${RECOVERY_TAB_STORAGE_PREFIX}${tabId}`;
  }

  function createRecoveryId() {
    return `u${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function asText(value) {
    return typeof value === 'string' ? value : '';
  }

  function buildUrlFromPattern(urlPattern, text) {
    const encoded = encodeURIComponent(asText(text));
    return String(urlPattern || '')
      .split('${KEYWORD}').join(encoded)
      .split('${keyword}').join(encoded)
      .split('${PROMPT}').join(encoded)
      .split('${prompt}').join(encoded)
      .split('${RAW_TEXT}').join(encoded)
      .split('${NORMALIZED}').join(encoded)
      .split('${ENCODED_TEXT}').join(encoded);
  }

  function tryGetTextParam(url) {
    try {
      const parsed = new URL(url);
      for (const key of COMMON_TEXT_PARAM_KEYS) {
        const value = parsed.searchParams.get(key);
        if (value) return { key, value };
      }
    } catch (_) {
      // ignore
    }
    return null;
  }

  function truncateTextForPattern(urlPattern, text, hardCap = REGULAR_URL_HARD_CAP) {
    const src = asText(text);
    const build = (candidate) => buildUrlFromPattern(urlPattern, candidate);
    const originalUrl = build(src);
    if (originalUrl.length <= hardCap) {
      return {
        text: src,
        url: originalUrl,
        truncated: false,
        originalUrlLength: originalUrl.length,
        finalUrlLength: originalUrl.length
      };
    }

    let lo = 0;
    let hi = src.length;
    let best = '';
    let bestUrl = build('');
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const candidate = src.slice(0, mid);
      const candidateUrl = build(candidate);
      if (candidateUrl.length <= hardCap) {
        best = candidate;
        bestUrl = candidateUrl;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (best && best.length < src.length) {
      const withEllipsis = `${best.replace(/\s+$/, '')}...`;
      const ellipsisUrl = build(withEllipsis);
      if (ellipsisUrl.length <= hardCap) {
        best = withEllipsis;
        bestUrl = ellipsisUrl;
      }
    }

    return {
      text: best,
      url: bestUrl,
      truncated: best.length < src.length,
      originalUrlLength: originalUrl.length,
      finalUrlLength: bestUrl.length
    };
  }

  function createUrlRecoveryRecord(partial = {}) {
    const now = Date.now();
    const id = partial.id || createRecoveryId();
    return {
      id,
      kind: partial.kind || 'regular',
      source: partial.source || 'url-safety',
      menuId: partial.menuId || '',
      engineId: partial.engineId || '',
      urlPattern: partial.urlPattern || '',
      originalText: asText(partial.originalText),
      effectiveText: asText(partial.effectiveText),
      targetUrl: partial.targetUrl || '',
      originalUrlLength: Number(partial.originalUrlLength || 0),
      finalUrlLength: Number(partial.finalUrlLength || 0),
      truncated: !!partial.truncated,
      pendingId: partial.pendingId || '',
      statusCode: partial.statusCode || null,
      error: partial.error || '',
      failedUrl: partial.failedUrl || '',
      createdAt: partial.createdAt || now,
      updatedAt: now,
      expiresAt: partial.expiresAt || now + RECOVERY_TTL_MS
    };
  }

  async function persistUrlRecoveryRecord(record) {
    if (!record?.id) return null;
    recoveryStore.set(record.id, record);
    await storageSet(recoveryStorageKey(record.id), record);
    return record;
  }

  async function readUrlRecoveryRecord(id) {
    if (!id || typeof id !== 'string') return null;
    const stored = await storageGet(recoveryStorageKey(id));
    const record = stored || recoveryStore.get(id) || null;
    if (!record) return null;
    if (record.expiresAt && Date.now() > record.expiresAt) {
      recoveryStore.delete(id);
      await storageRemove(recoveryStorageKey(id));
      return null;
    }
    return record;
  }

  async function bindUrlRecoveryToTab(record, tabId) {
    if (!record?.id || typeof tabId !== 'number') return false;
    const next = { ...record, tabId, updatedAt: Date.now() };
    await persistUrlRecoveryRecord(next);
    tabRecoveryStore.set(tabId, next.id);
    await storageSet(tabRecoveryStorageKey(tabId), {
      id: next.id,
      tabId,
      createdAt: Date.now(),
      expiresAt: Date.now() + RECOVERY_TTL_MS
    });
    return true;
  }

  async function readUrlRecoveryForTab(tabId) {
    if (typeof tabId !== 'number') return null;
    const memoryId = tabRecoveryStore.get(tabId);
    if (memoryId) {
      const memoryRecord = await readUrlRecoveryRecord(memoryId);
      if (memoryRecord) return memoryRecord;
    }

    const mapping = await storageGet(tabRecoveryStorageKey(tabId));
    if (!mapping?.id) return null;
    if (mapping.expiresAt && Date.now() > mapping.expiresAt) {
      await storageRemove(tabRecoveryStorageKey(tabId));
      return null;
    }
    return readUrlRecoveryRecord(mapping.id);
  }

  function summarizeRecovery(record) {
    if (!record) return null;
    const original = asText(record.originalText);
    return {
      id: record.id,
      kind: record.kind || 'regular',
      source: record.source || '',
      menuId: record.menuId || '',
      engineId: record.engineId || '',
      originalLength: original.length,
      originalPreview: original.slice(0, 120),
      effectiveLength: asText(record.effectiveText).length,
      targetUrl: record.targetUrl || '',
      originalUrlLength: record.originalUrlLength || 0,
      finalUrlLength: record.finalUrlLength || 0,
      truncated: !!record.truncated,
      statusCode: record.statusCode || null,
      error: record.error || '',
      failedUrl: record.failedUrl || '',
      failed: !!(record.statusCode || record.error)
    };
  }

  async function updateUrlRecoveryForTab(tabId, patch = {}) {
    const record = await readUrlRecoveryForTab(tabId);
    if (!record) return null;
    const next = {
      ...record,
      ...patch,
      updatedAt: Date.now()
    };
    await persistUrlRecoveryRecord(next);
    return next;
  }

  function notifySourceTab(tabId, message) {
    if (typeof tabId !== 'number' || !message) return;
    try {
      globalThis.chrome?.tabs?.sendMessage?.(tabId, {
        action: 'showToast',
        message
      }).catch?.(() => {});
    } catch (_) {
      // ignore
    }
  }

  function prepareRegularUrl(urlPattern, rawText, meta = {}) {
    const hardCap = Number(meta.hardCap || REGULAR_URL_HARD_CAP);
    const prepared = truncateTextForPattern(urlPattern, rawText, hardCap);
    const originalText = asText(rawText);
    const record = createUrlRecoveryRecord({
      kind: 'regular',
      source: meta.source || 'regular-url',
      menuId: meta.menuId || '',
      engineId: meta.engineId || '',
      urlPattern,
      originalText,
      effectiveText: prepared.text,
      targetUrl: prepared.url,
      originalUrlLength: prepared.originalUrlLength,
      finalUrlLength: prepared.finalUrlLength,
      truncated: prepared.truncated
    });

    if (prepared.truncated) {
      notifySourceTab(
        meta.tabId,
        `URL 参数过长，已压缩到安全长度（${prepared.originalUrlLength} -> ${prepared.finalUrlLength}）以避免 431`
      );
    } else if (prepared.finalUrlLength > REGULAR_URL_WARN_CAP) {
      notifySourceTab(meta.tabId, `URL 参数较长（${prepared.finalUrlLength}），如目标站点异常可用触触搜恢复`);
    }

    return {
      url: prepared.url,
      record,
      truncated: prepared.truncated,
      originalUrlLength: prepared.originalUrlLength,
      finalUrlLength: prepared.finalUrlLength,
      effectiveText: prepared.text
    };
  }

  function openUrlWithRecovery(url, record, options = {}) {
    const tabs = globalThis.chrome?.tabs;
    if (!tabs?.create) return Promise.resolve(null);
    const createOptions = { url };
    if (options.active !== undefined) createOptions.active = options.active;

    return new Promise((resolve, reject) => {
      try {
        tabs.create(createOptions, (tab) => {
          const error = globalThis.chrome?.runtime?.lastError;
          if (error) {
            reject(new Error(error.message || 'tabs.create failed'));
            return;
          }
          if (record && typeof tab?.id === 'number') {
            bindUrlRecoveryToTab(record, tab.id).catch(() => {});
          }
          resolve(tab || null);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function sendRecoveryOverlay(tabId, record) {
    if (typeof tabId !== 'number' || !record) return;
    try {
      globalThis.chrome?.tabs?.sendMessage?.(tabId, {
        action: 'ccsShowUrlRecovery',
        recovery: summarizeRecovery(record)
      }, () => {
        // Content scripts may not be ready yet. They also pull recovery on init.
        void globalThis.chrome?.runtime?.lastError;
      });
    } catch (_) {
      // ignore
    }
  }

  async function handleMainFrameFailure(details, patch) {
    if (!details || typeof details.tabId !== 'number' || details.tabId < 0) return;
    const record = await updateUrlRecoveryForTab(details.tabId, {
      ...patch,
      failedUrl: details.url || patch.failedUrl || '',
      failedAt: Date.now()
    });
    if (record) sendRecoveryOverlay(details.tabId, record);
  }

  function normalizeMisroutedGoogleRelayUrl(rawUrl) {
    const src = asText(rawUrl);
    if (!/^chrome:\/\/google\.com\/search/i.test(src) || !/[?&#]ccs_pp=/i.test(src)) {
      return '';
    }
    try {
      const parsed = new URL(src);
      const fixed = new URL('https://www.google.com/search');
      fixed.search = parsed.search || '';
      fixed.hash = parsed.hash || '';
      if (!fixed.searchParams.get('q')) {
        fixed.searchParams.set('q', '.');
      }
      if (!fixed.searchParams.get('udm')) {
        fixed.searchParams.set('udm', '50');
      }
      return fixed.toString();
    } catch (_) {
      const rest = src.replace(/^chrome:\/\/google\.com\/search/i, '');
      const fixed = `https://www.google.com/search${rest}`;
      return fixed.includes('?') ? fixed : `${fixed}?q=.&udm=50`;
    }
  }

  function installGoogleRelayUrlNormalizer() {
    const tabs = globalThis.chrome?.tabs;
    if (googleRelayNormalizerInstalled || !tabs?.onUpdated?.addListener || !tabs?.update) return false;
    googleRelayNormalizerInstalled = true;
    tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      const candidateUrl = changeInfo?.url || tab?.url || '';
      const fixedUrl = normalizeMisroutedGoogleRelayUrl(candidateUrl);
      if (!fixedUrl) return;
      try {
        tabs.update(tabId, { url: fixedUrl });
      } catch (_) {
        // ignore
      }
    });
    return true;
  }

  function installUrlFailureMonitor() {
    const wr = globalThis.chrome?.webRequest;
    if (monitorInstalled || !wr?.onCompleted?.addListener) return false;
    monitorInstalled = true;

    wr.onCompleted.addListener((details) => {
      if (!details || details.type !== 'main_frame') return;
      const statusCode = Number(details.statusCode || 0);
      if (statusCode >= 400 && statusCode < 500) {
        handleMainFrameFailure(details, { statusCode }).catch(() => {});
      }
    }, { urls: ['<all_urls>'], types: ['main_frame'] });

    if (wr.onErrorOccurred?.addListener) {
      wr.onErrorOccurred.addListener((details) => {
        if (!details || details.type !== 'main_frame') return;
        handleMainFrameFailure(details, { error: details.error || 'navigation-error' }).catch(() => {});
      }, { urls: ['<all_urls>'], types: ['main_frame'] });
    }
    return true;
  }

  async function getRecoveryText(id, field = 'original') {
    const record = await readUrlRecoveryRecord(id);
    if (!record) return null;
    return field === 'effective' ? asText(record.effectiveText) : asText(record.originalText);
  }

  async function openRecoverySafe(id, options = {}) {
    const record = await readUrlRecoveryRecord(id);
    if (!record) return { ok: false, error: 'recovery-not-found' };

    if (record.kind === 'ai' && record.urlPattern && typeof globalThis.ccsPrepareAIPromptUrl === 'function') {
      const url = await globalThis.ccsPrepareAIPromptUrl(record.urlPattern, record.originalText, {
        source: 'url-recovery',
        menuId: record.menuId || '',
        engineId: record.engineId || '',
        forceRelay: true
      });
      const next = createUrlRecoveryRecord({
        ...record,
        source: 'url-recovery',
        targetUrl: url,
        finalUrlLength: url.length,
        statusCode: null,
        error: ''
      });
      const tab = typeof globalThis.ccsOpenPreparedAIPromptUrl === 'function'
        ? await globalThis.ccsOpenPreparedAIPromptUrl(url, { active: options.active !== false })
        : await openUrlWithRecovery(url, next, { active: options.active !== false });
      return { ok: true, tabId: tab?.id || null };
    }

    if (record.urlPattern && record.originalText) {
      const prepared = prepareRegularUrl(record.urlPattern, record.originalText, {
        source: 'url-recovery',
        menuId: record.menuId || '',
        engineId: record.engineId || ''
      });
      const tab = await openUrlWithRecovery(prepared.url, prepared.record, { active: options.active !== false });
      return { ok: true, tabId: tab?.id || null, truncated: prepared.truncated };
    }

    const tab = await openUrlWithRecovery(record.targetUrl, record, { active: options.active !== false });
    return { ok: true, tabId: tab?.id || null };
  }

  async function clearRecoveryForTab(tabId) {
    if (typeof tabId !== 'number') return false;
    const record = await readUrlRecoveryForTab(tabId);
    tabRecoveryStore.delete(tabId);
    await storageRemove(tabRecoveryStorageKey(tabId));
    if (record?.id) {
      recoveryStore.delete(record.id);
      await storageRemove(recoveryStorageKey(record.id));
    }
    return true;
  }

  globalThis.CCS_URL_SAFETY = {
    REGULAR_URL_HARD_CAP,
    REGULAR_URL_WARN_CAP,
    RECOVERY_TTL_MS
  };
  globalThis.ccsBuildUrlFromPattern = buildUrlFromPattern;
  globalThis.ccsTruncateTextForUrlPattern = truncateTextForPattern;
  globalThis.ccsPrepareRegularUrl = prepareRegularUrl;
  globalThis.ccsCreateUrlRecoveryRecord = createUrlRecoveryRecord;
  globalThis.ccsPersistUrlRecoveryRecord = persistUrlRecoveryRecord;
  globalThis.ccsBindUrlRecoveryToTab = bindUrlRecoveryToTab;
  globalThis.ccsReadUrlRecoveryRecord = readUrlRecoveryRecord;
  globalThis.ccsReadUrlRecoveryForTab = readUrlRecoveryForTab;
  globalThis.ccsSummarizeUrlRecovery = summarizeRecovery;
  globalThis.ccsOpenUrlWithRecovery = openUrlWithRecovery;
  globalThis.ccsOpenUrlRecoverySafe = openRecoverySafe;
  globalThis.ccsGetUrlRecoveryText = getRecoveryText;
  globalThis.ccsClearUrlRecoveryForTab = clearRecoveryForTab;
  globalThis.ccsInstallUrlFailureMonitor = installUrlFailureMonitor;
  globalThis.ccsInstallGoogleRelayUrlNormalizer = installGoogleRelayUrlNormalizer;
  globalThis.ccsNormalizeMisroutedGoogleRelayUrl = normalizeMisroutedGoogleRelayUrl;
  globalThis.ccsTryGetTextParam = tryGetTextParam;

  installUrlFailureMonitor();
  installGoogleRelayUrlNormalizer();
})();
