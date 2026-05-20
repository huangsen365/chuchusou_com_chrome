chrome.runtime.onInstalled.addListener(createContextMenus);

// 首次安装时弹欢迎页（更新时不弹，避免老用户被打扰）
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') });
  }
});
if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(createContextMenus);
}

// 预加载调试开关与图标支持状态
ensureMenuIconSupportLoaded();

// Debounce variables for contextMenuPreview to prevent race conditions
// when user rapidly selects text (e.g., "题" → "显示" → "内容" → "英国殖民统治问题")
let contextPreviewTimeout = null;
let latestPreviewData = null;

const MENU_TITLE_DEBUG_IDS = [
  'ccs-fastqa-chatgpt-quick',
  'ccs-fastqa-claude-quick',
  'ccs-fastqa-root',
  'ccs-fastqa-open-all',
  'ccs-fastqa-grok-quick',
  'ccs-chuchusou',
  'ccs-chatgpt',
  'ccs-claude'
];

async function prefetchMenuState(tab, reason = 'unknown') {
  const tabId = tab?.id;
  const url = tab?.url || '';
  if (tabId == null || !url) return;
  try {
    // BUGFIX: Update title cache whenever we prefetch to ensure freshness
    if (tab.title && typeof tab.title === 'string') {
      updateLatestTabTitle(tabId, tab.title);
    }

    const keywords = await extractSearchKeywords(url, tab);
    const normalized = keywords ? normalizeSearchText(keywords) : '';
    if (keywords) {
      fallbackKeywordByTab[tabId] = {
        raw: keywords,
        normalized: normalized || normalizeSearchText(keywords),
        timestamp: Date.now(),
        url
      };
      if (tab.active || currentMenuState.tabId === tabId) {
        setMenuState(keywords, normalized || keywords, {
          tabId,
          url
        });
      }
      // v1.6.23 (perf)：同步写 ccs_kw_<tabId> storage，让 popup/sidepanel 下次打开能
      // 立即从 storage 读到（不再走 sendMessage 兜底链）。之前只有 popup-open intent
      // 才写缓存，新 tab 上还没人发过 popup-open，cache 永远 miss，导致每次打开 popup
      // 都要等 SW round-trip。
      //
      // URL 一起入库，readInstantCache 时强校验，URL 不一致视为 stale。
      // 失败不影响主流程；prefetch 频繁触发，写失败属正常 (storage 限流等)。
      // 写 storage cache —— 但**不能踩当前 live 选区**：如果用户此刻有选区在内存里，
      // 不写 storage cache，让 popup 首屏读到的依然是用户的选区。
      // 没有 live 选区 → 写 URL 提取结果，给 popup 首屏即时显示 title / 搜索词。
      //
      // 不再做 URL 严格匹配：memory 由 tab-loading/selectionChanged 严格维护，
      // 它非空就是真有选区，无须二次校验。URL 严格相等会被 hash drift 假阴性。
      const liveSel = selectedTextByTab[tabId];
      const hasLiveSelection =
        liveSel && typeof liveSel.text === 'string' && liveSel.text.trim().length > 0;
      if (!hasLiveSelection && globalThis.KeywordService?._writeStorageCache) {
        globalThis.KeywordService._writeStorageCache(tabId, {
          text: normalized || keywords,
          raw: keywords,
          url
        }).catch(() => { /* ignore */ });
      }
    } else if (reason === 'tab-loading' && (tab.active || currentMenuState.tabId === tabId)) {
      setMenuState('', '', { tabId, url });
    }
    logMenuEvent('prefetch-menu-state', {
      tabId,
      reason,
      url,
      title: tab?.title || '',
      keywords: keywords || '',
      normalized
    });
  } catch (error) {
    logMenuEvent('prefetch-menu-state-error', {
      tabId,
      reason,
      url,
      error: error?.message || String(error)
    });
  }
}

function snapshotMenuTitles(reason) {
  MENU_TITLE_DEBUG_IDS.forEach((menuId) => {
    try {
      chrome.contextMenus.get(menuId, (menu) => {
        if (chrome.runtime.lastError || !menu) {
          logMenuEvent('menu-title-snapshot-failed', {
            reason,
            id: menuId,
            error: chrome.runtime.lastError?.message || 'not-found'
          });
          return;
        }
        logMenuEvent('menu-title-snapshot', {
          reason,
          id: menuId,
          title: menu.title,
          contexts: menu.contexts,
          enabled: menu.enabled
        });
      });
    } catch (error) {
      logMenuEvent('menu-title-snapshot-exception', {
        reason,
        id: menuId,
        error: error?.message || String(error)
      });
    }
  });
}

async function reinjectContentForTab(tabId, reason) {
  if (tabId == null) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    logMenuEvent('selection-sync-reinject', { tabId, reason });
    return true;
  } catch (injectError) {
    logMenuEvent('selection-sync-reinject-error', {
      tabId,
      reason,
      error: injectError?.message || String(injectError)
    });
    return false;
  }
}

function syncSelectionFromTab(tab, reason = 'unknown', options = {}) {
  const updateMenu = options.updateMenu !== false;
  const retryOnMissing = options.retryOnMissing !== false; // default true
  const tabId = tab?.id;
  const tabUrl = tab?.url || '';
  if (tabId == null) {
    return Promise.resolve('');
  }
  return new Promise((resolve) => {
    let responded = false;
    try {
      chrome.tabs.sendMessage(tabId, { action: 'fetchSelectionSnapshot', preferEmpty: true }, (response) => {
        responded = true;
        if (chrome.runtime.lastError) {
          const errorMessage = chrome.runtime.lastError.message || '';
          logMenuEvent('selection-sync-error', {
            tabId,
            reason,
            error: errorMessage
          });
          if (/Receiving end does not exist/i.test(errorMessage)) {
            if (retryOnMissing) {
              reinjectContentForTab(tabId, `${reason}-missing-listener`).then((reinjected) => {
                if (!reinjected) {
                  resolve('');
                  return;
                }
                setTimeout(() => {
                  syncSelectionFromTab(tab, `${reason}-retry`, {
                    ...options,
                    retryOnMissing: false
                  }).then(resolve).catch(() => resolve(''));
                }, 100);
              }).catch(() => resolve(''));
              return;
            } else {
              reinjectContentForTab(tabId, `${reason}-missing-listener`).catch(() => {});
            }
          }
          resolve('');
          return;
        }
        const text = typeof response?.text === 'string' ? response.text : '';
        const source = response?.source || '';
        const responseTitle = typeof response?.title === 'string' ? response.title : '';
        if (responseTitle) {
          updateLatestTabTitle(tabId, responseTitle);
        }
        const trimmed = text.trim();
        if (trimmed) {
          selectedTextByTab[tabId] = {
            text,
            url: tabUrl || response?.url || '',
            timestamp: Date.now()
          };
          delete fallbackKeywordByTab[tabId];
          logMenuEvent('selection-sync', {
            tabId,
            reason,
            source,
            length: trimmed.length
          });
          if (updateMenu) {
            setMenuState(text, normalizeSearchText(text), {
              tabId,
              url: tabUrl || response?.url || ''
            });
          }
          resolve(text);
        } else {
          logMenuEvent('selection-sync-empty', {
            tabId,
            reason,
            source
          });
          delete selectedTextByTab[tabId];
          resolve('');
        }
      });
    } catch (error) {
      responded = true;
      logMenuEvent('selection-sync-exception', {
        tabId,
        reason,
        error: error?.message || String(error)
      });
      delete selectedTextByTab[tabId];
      resolve('');
    }
    setTimeout(async () => {
      if (!responded) {
        logMenuEvent('selection-sync-timeout', { tabId, reason });
        delete selectedTextByTab[tabId];
        await reinjectContentForTab(tabId, `${reason}-timeout`);
        resolve('');
      }
    }, 500);
  });
}

// ========== 侧边栏存活追踪 ==========
// 通过 port 连接判断每个 window 的侧边栏是否打开
// 用于 popup 按钮显示「打开/关闭」相反状态 + 远程触发侧边栏自关闭
const sidePanelPortsByWindow = new Map(); // Map<windowId, Set<port>>

// 欢迎页订阅侧边栏开关状态——welcome 页停留时间长，需要 push 推送状态变化
const welcomePortsByWindow = new Map(); // Map<windowId, Set<port>>

function isSidePanelOpenInWindow(windowId) {
  const set = sidePanelPortsByWindow.get(windowId);
  return !!(set && set.size > 0);
}

function notifyWelcomeWatchers(windowId) {
  const watchers = welcomePortsByWindow.get(windowId);
  if (!watchers) return;
  const isOpen = isSidePanelOpenInWindow(windowId);
  for (const port of watchers) {
    try { port.postMessage({ action: 'sidePanelStateChanged', isOpen }); } catch (_) { /* port 已断 */ }
  }
}

// v1.6.15 预热：把 sidepanel 是否打开持久化到 chrome.storage.local，
// 让 popup 打开时即时显示「打开/关闭」按钮 label，不必等 sendMessage 回 SW（~50-300ms）。
function persistSidePanelState(windowId) {
  if (typeof windowId !== 'number') return;
  const isOpen = isSidePanelOpenInWindow(windowId);
  try {
    chrome.storage.local.set({ [`ccs_sp_open_${windowId}`]: isOpen });
  } catch (_) { /* best effort */ }
}

chrome.runtime.onConnect.addListener((port) => {
  // 侧边栏存活心跳——侧边栏页面打开就连，关闭就自动断
  if (port.name === 'sidepanel-alive') {
    let windowId = null;
    port.onMessage.addListener((msg) => {
      if (msg && typeof msg.windowId === 'number') {
        windowId = msg.windowId;
        if (!sidePanelPortsByWindow.has(windowId)) {
          sidePanelPortsByWindow.set(windowId, new Set());
        }
        sidePanelPortsByWindow.get(windowId).add(port);
        notifyWelcomeWatchers(windowId);   // 侧边栏开 → 通知 welcome 订阅者
        persistSidePanelState(windowId);   // v1.6.15: 同步到 storage 给 popup 即时读
      }
    });
    port.onDisconnect.addListener(() => {
      if (windowId !== null) {
        const set = sidePanelPortsByWindow.get(windowId);
        if (set) {
          set.delete(port);
          if (set.size === 0) sidePanelPortsByWindow.delete(windowId);
        }
        notifyWelcomeWatchers(windowId);   // 侧边栏关 → 通知 welcome 订阅者
        persistSidePanelState(windowId);   // v1.6.15: 同步到 storage 给 popup 即时读
      }
    });
    return;
  }

  // 欢迎页订阅侧边栏状态——一连上立即推送当前状态，之后实时更新
  if (port.name === 'welcome-watcher') {
    let windowId = null;
    port.onMessage.addListener((msg) => {
      if (msg && typeof msg.windowId === 'number') {
        windowId = msg.windowId;
        if (!welcomePortsByWindow.has(windowId)) {
          welcomePortsByWindow.set(windowId, new Set());
        }
        welcomePortsByWindow.get(windowId).add(port);
        // 立即把当前状态推过去，避免 welcome 页等下一次状态变化才知道
        try {
          port.postMessage({
            action: 'sidePanelStateChanged',
            isOpen: isSidePanelOpenInWindow(windowId)
          });
        } catch (_) { /* port 已断 */ }
      }
    });
    port.onDisconnect.addListener(() => {
      if (windowId !== null) {
        const set = welcomePortsByWindow.get(windowId);
        if (set) {
          set.delete(port);
          if (set.size === 0) welcomePortsByWindow.delete(windowId);
        }
      }
    });
    return;
  }
});

function ccsCreateRequestId(action) {
  return `${action || 'msg'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function ccsGetRequestId(request, action) {
  return request?.requestId || ccsCreateRequestId(action);
}

function ccsLogMessage(phase, action, requestId, payload, level = 'debug') {
  const shouldLog = level === 'warn' || level === 'error' || BG_DEBUG;
  if (!shouldLog) return;
  const line = `[extension][background][${phase}][${requestId || '-'}] ${action || 'message'}`;
  if (level === 'error') console.error(line, payload || '');
  else if (level === 'warn') console.warn(line, payload || '');
  else console.log(line, payload || '');
}

function ccsAttachRequestId(payload, requestId) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  if (Object.prototype.hasOwnProperty.call(payload, 'requestId')) return payload;
  return { ...payload, requestId };
}

async function ccsOpenMenuUrlWithAIRelay(urlPattern, text, fallbackUrl, meta = {}) {
  if (
    typeof ccsIsSupportedAIUrl === 'function' &&
    typeof ccsPrepareAIPromptUrl === 'function' &&
    typeof ccsOpenPreparedAIPromptUrl === 'function' &&
    ccsIsSupportedAIUrl(fallbackUrl)
  ) {
    try {
      const preparedUrl = await ccsPrepareAIPromptUrl(urlPattern || fallbackUrl, text, meta);
      await ccsOpenPreparedAIPromptUrl(preparedUrl);
      return;
    } catch (error) {
      if (typeof BG_DBG === 'function') {
        BG_DBG('[ccsOpenMenuUrlWithAIRelay] fallback', meta?.menuId || '', error);
      }
    }
  }
  if (
    urlPattern &&
    typeof ccsPrepareRegularUrl === 'function' &&
    typeof ccsOpenUrlWithRecovery === 'function'
  ) {
    try {
      const prepared = ccsPrepareRegularUrl(urlPattern, text, {
        source: meta.source || 'execute-menu-action',
        menuId: meta.menuId || '',
        engineId: meta.engineId || '',
        tabId: meta.tabId
      });
      await ccsOpenUrlWithRecovery(prepared.url, prepared.record);
      return;
    } catch (error) {
      if (typeof BG_DBG === 'function') {
        BG_DBG('[ccsOpenMenuUrlWithAIRelay] regular fallback', meta?.menuId || '', error);
      }
    }
  }
  chrome.tabs.create({ url: fallbackUrl });
}

function ccsCreateSafeResponder(sendResponse, action, requestId, timeoutMs = 5000) {
  let responded = false;
  const startedAt = Date.now();
  const timer = setTimeout(() => {
    if (responded) return;
    responded = true;
    ccsLogMessage('timeout', action, requestId, { timeoutMs }, 'warn');
    try {
      sendResponse?.({
        success: false,
        ok: false,
        error: 'timeout',
        code: 'TIMEOUT',
        requestId,
        elapsedMs: Date.now() - startedAt
      });
    } catch (_) { /* port closed */ }
  }, timeoutMs);

  return (payload) => {
    if (responded) return;
    responded = true;
    clearTimeout(timer);
    const nextPayload = ccsAttachRequestId(payload, requestId);
    ccsLogMessage('response', action, requestId, {
      elapsedMs: Date.now() - startedAt,
      success: nextPayload?.success,
      ok: nextPayload?.ok,
      error: nextPayload?.error || nextPayload?.code
    });
    try { sendResponse?.(nextPayload); } catch (_) { /* port closed */ }
  };
}

async function ccsSendTabMessageWithFallback(tabId, message, reason) {
  if (tabId == null) {
    return { ok: false, code: 'NO_TAB', error: 'missing tabId' };
  }
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return { ok: true };
  } catch (error) {
    const firstError = error?.message || String(error);
    if (!/Receiving end does not exist|Could not establish connection|message port closed/i.test(firstError)) {
      return { ok: false, code: 'CONTENT_MESSAGE_FAILED', error: firstError };
    }
    const reinjected = await reinjectContentForTab(tabId, reason || 'message-fallback');
    if (!reinjected) {
      return { ok: false, code: 'CONTENT_UNAVAILABLE', error: firstError };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      await chrome.tabs.sendMessage(tabId, message);
      return { ok: true, reinjected: true };
    } catch (retryError) {
      return {
        ok: false,
        code: 'CONTENT_UNAVAILABLE',
        error: retryError?.message || String(retryError)
      };
    }
  }
}

// 监听来自content script和popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // v1.6.22 诊断 ping：极轻量，仅用于测 popup → SW 端到端 round-trip。
  // popup 发送时记 sentAt，收到响应时 Date.now() - sentAt = SW round-trip 含冷启。
  if (request.action === 'ccsDiagPing') {
    try {
      sendResponse?.({
        ok: true,
        swNow: Date.now(),
        swVersion: chrome.runtime.getManifest().version
      });
    } catch (_) { /* sendResponse race */ }
    return false;
  }
  if (request.action === 'ccs-log-menu-icons') {
    const requestId = ccsGetRequestId(request, 'ccs-log-menu-icons');
    const respond = ccsCreateSafeResponder(sendResponse, 'ccs-log-menu-icons', requestId, 4000);
    ccsLogMessage('request', 'ccs-log-menu-icons', requestId);
    loadMenuIconConfig().then((config) => {
      const info = {
        BG_DEBUG,
        iconConfig: config,
        iconMapKeys: Array.from(optimizedPromptMenuMap.keys()),
        cacheSize: menuIconImageCache.size,
        buildCounter: menuBuildCounter,
        timestamp: Date.now()
      };
      console.log('[触触搜][BG][ICON] 状态报告', info);
      respond({ ok: true, info });
    }).catch((err) => {
      console.warn('[触触搜][BG][ICON] 状态报告失败', err);
      respond({ ok: false, error: err?.message || String(err) });
    });
    return true;
  }
  if (request.action === 'ccsGetPendingChatGptPrompt' || request.action === 'ccsGetPendingAIPrompt') {
    const pendingId = typeof request.pendingId === 'string' ? request.pendingId : '';
    const tabId = typeof sender?.tab?.id === 'number' ? sender.tab.id : null;
    const respond = ccsCreateSafeResponder(sendResponse, 'ccsGetPendingAIPrompt', pendingId || ccsCreateRequestId('ccsGetPendingAIPrompt'), 3000);
    const senderUrl = sender?.url || sender?.tab?.url || '';
    let senderAllowed = false;
    try {
      senderAllowed = typeof ccsIsSupportedAIUrl === 'function' && ccsIsSupportedAIUrl(senderUrl);
    } catch (_) {
      senderAllowed = false;
    }
    if (!senderAllowed) {
      respond({ ok: false, error: 'sender-not-chatgpt' });
      return true;
    }
    if ((!pendingId && tabId == null) || typeof ccsResolvePendingAIPrompt !== 'function') {
      respond({ ok: false, error: 'missing-pending-id' });
      return true;
    }
    ccsResolvePendingAIPrompt(pendingId, tabId)
      .then((record) => {
        if (!record) {
          respond({ ok: false, error: 'pending-prompt-not-found' });
          return;
        }
        respond({
          ok: true,
          pendingId: record.id || pendingId,
          prompt: record.prompt,
          meta: {
            source: record.source || '',
            taskId: record.taskId || '',
            menuId: record.menuId || '',
            categoryId: record.categoryId || '',
            engineId: record.engineId || '',
            relayEngine: record.relayEngine || ''
          }
        });
      })
      .catch((error) => {
        respond({ ok: false, error: error?.message || String(error) });
      });
    return true;
  }
  if (request.action === 'ccsAckPendingChatGptPrompt' || request.action === 'ccsAckPendingAIPrompt') {
    const pendingId = typeof request.pendingId === 'string' ? request.pendingId : '';
    const tabId = typeof sender?.tab?.id === 'number' ? sender.tab.id : null;
    const respond = ccsCreateSafeResponder(sendResponse, 'ccsAckPendingAIPrompt', pendingId || ccsCreateRequestId('ccsAckPendingAIPrompt'), 3000);
    if (!pendingId || typeof ccsAckPendingAIPromptForTab !== 'function') {
      respond({ ok: false, error: 'missing-pending-id' });
      return true;
    }
    ccsAckPendingAIPromptForTab(pendingId, tabId)
      .then((ok) => respond({ ok }))
      .catch((error) => respond({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (request.action === 'ccsGetUrlRecovery') {
    const tabId = typeof sender?.tab?.id === 'number' ? sender.tab.id : null;
    const respond = ccsCreateSafeResponder(sendResponse, 'ccsGetUrlRecovery', ccsCreateRequestId('ccsGetUrlRecovery'), 3000);
    if (tabId == null || typeof ccsReadUrlRecoveryForTab !== 'function') {
      respond({ ok: false, error: 'missing-tab' });
      return true;
    }
    ccsReadUrlRecoveryForTab(tabId)
      .then((record) => {
        if (!record || !(record.statusCode || record.error)) {
          respond({ ok: false, error: 'recovery-not-found' });
          return;
        }
        const summary = typeof ccsSummarizeUrlRecovery === 'function'
          ? ccsSummarizeUrlRecovery(record)
          : record;
        respond({ ok: true, recovery: summary });
      })
      .catch((error) => respond({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (request.action === 'ccsGetUrlRecoveryText') {
    const recoveryId = typeof request.recoveryId === 'string' ? request.recoveryId : '';
    const field = request.field === 'effective' ? 'effective' : 'original';
    const respond = ccsCreateSafeResponder(sendResponse, 'ccsGetUrlRecoveryText', recoveryId || ccsCreateRequestId('ccsGetUrlRecoveryText'), 3000);
    if (!recoveryId || typeof ccsGetUrlRecoveryText !== 'function') {
      respond({ ok: false, error: 'missing-recovery-id' });
      return true;
    }
    ccsGetUrlRecoveryText(recoveryId, field)
      .then((text) => {
        if (typeof text !== 'string') {
          respond({ ok: false, error: 'recovery-not-found' });
          return;
        }
        respond({ ok: true, text });
      })
      .catch((error) => respond({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (request.action === 'ccsOpenUrlRecoverySafe') {
    const recoveryId = typeof request.recoveryId === 'string' ? request.recoveryId : '';
    const respond = ccsCreateSafeResponder(sendResponse, 'ccsOpenUrlRecoverySafe', recoveryId || ccsCreateRequestId('ccsOpenUrlRecoverySafe'), 5000);
    if (!recoveryId || typeof ccsOpenUrlRecoverySafe !== 'function') {
      respond({ ok: false, error: 'missing-recovery-id' });
      return true;
    }
    ccsOpenUrlRecoverySafe(recoveryId, { active: true })
      .then((result) => respond(result || { ok: false, error: 'open-failed' }))
      .catch((error) => respond({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (request.action === 'ccsDismissUrlRecovery') {
    const tabId = typeof sender?.tab?.id === 'number' ? sender.tab.id : null;
    if (tabId != null && typeof ccsClearUrlRecoveryForTab === 'function') {
      ccsClearUrlRecoveryForTab(tabId).catch(() => {});
    }
    sendResponse?.({ ok: true });
    return true;
  }
  if (request.action === 'getSidePanelState') {
    const windowId = request && typeof request.windowId === 'number' ? request.windowId : null;
    const set = windowId !== null ? sidePanelPortsByWindow.get(windowId) : null;
    const isOpen = !!(set && set.size > 0);
    sendResponse?.({ isOpen });
    return false;
  }
  if (request.action === 'closeSidePanel') {
    const windowId = request && typeof request.windowId === 'number' ? request.windowId : null;
    const set = windowId !== null ? sidePanelPortsByWindow.get(windowId) : null;
    if (set) {
      for (const port of set) {
        try { port.postMessage({ action: 'close' }); } catch (_) { /* port 已断 */ }
      }
    }
    sendResponse?.({ ok: !!(set && set.size > 0) });
    return false;
  }
  // C 档重构入口：popup / sidepanel 通过 shared/keywordClient.js 发 'getKeyword'，
  // intent 决定 background 的获取策略（policy 表见 background/KeywordService.js）。
  // 同时仍保留 'getSearchText' 作为旧消息名兼容入口，下面那段。
  if (request.action === 'getKeyword') {
    const requestId = ccsGetRequestId(request, 'getKeyword');
    const respond = ccsCreateSafeResponder(sendResponse, 'getKeyword', requestId, 2500);
    ccsLogMessage('request', 'getKeyword', requestId, {
      tabId: request.tabId,
      intent: request.intent,
      hasUrl: !!request.url
    });
    const { tabId, url, title, selectionText, intent } = request;
    KeywordService.getKeyword({
      tabId,
      url,
      title,
      intent: intent || KEYWORD_INTENTS.LEGACY,
      selectionText
    }).then((result) => {
      respond({ text: result.text, raw: result.raw, source: result.source, intent: result.intent });
    }).catch((error) => {
      console.error('[触触搜][BG] getKeyword 失败:', error);
      respond({ text: '', raw: '', error: error?.message || String(error), code: 'KEYWORD_FAILED' });
    });
    return true;
  }
  if (request.action === 'getSearchText') {
    const requestId = ccsGetRequestId(request, 'getSearchText');
    const respond = ccsCreateSafeResponder(sendResponse, 'getSearchText', requestId, 2500);
    // 兼容入口：通过 KeywordService 处理，intent 视 forceFresh 而定，行为与旧逻辑一致
    const { tabId, url, title, selectionText, forceFresh } = request;
    KeywordService.getKeyword({
      tabId,
      url,
      title,
      intent: forceFresh ? KEYWORD_INTENTS.LEGACY : KEYWORD_INTENTS.PAGE_CHANGED,
      selectionText
    }).then((result) => {
      respond({ text: result.text, raw: result.raw });
    }).catch((error) => {
      console.error('[触触搜][BG] 获取搜索文本失败:', error);
      respond({ text: '', raw: '', error: error?.message || String(error), code: 'KEYWORD_FAILED' });
    });
    return true;
  }
  if (request.action === 'updateDebug') {
    BG_DEBUG = !!request.enabled;
    chrome.storage.local.set({ ccs_debug: BG_DEBUG });
    sendResponse && sendResponse({ ok: true });
    return; // stop further handling
  }
  // 处理popup的关键词提取请求
  if (request.action === 'extractKeywords') {
    const requestId = ccsGetRequestId(request, 'extractKeywords');
    const respond = ccsCreateSafeResponder(sendResponse, 'extractKeywords', requestId, 2500);
    extractSearchKeywords(request.url, { title: request.title })
      .then(keywords => {
        respond({ keywords });
      })
      .catch(error => {
        console.error('Error extracting keywords:', error);
        respond({ keywords: null, error: error?.message || String(error), code: 'EXTRACT_FAILED' });
      });
    return true; // 异步响应
  }
  // 处理popup的菜单调试信息导出请求
  if (request.action === 'getMenuDebugInfo') {
    const requestId = ccsGetRequestId(request, 'getMenuDebugInfo');
    const respond = ccsCreateSafeResponder(sendResponse, 'getMenuDebugInfo', requestId, 5000);
    const tabId = request.tabId;
    getMenuDebugInfo(tabId)
      .then(data => {
        respond({ success: true, data });
      })
      .catch(error => {
        console.error('[触触搜][BG] 获取菜单调试信息失败:', error);
        respond({ success: false, error: error?.message || String(error), code: 'MENU_DEBUG_FAILED' });
      });
    return true; // 异步响应
  }

  // 处理popup获取菜单结构请求（与右键菜单保持一致）
  if (request.action === 'getMenuStructure') {
    const requestId = ccsGetRequestId(request, 'getMenuStructure');
    const respond = ccsCreateSafeResponder(sendResponse, 'getMenuStructure', requestId, 3500);
    getPopupMenuStructure()
      .then(structure => {
        respond({ success: true, structure });
      })
      .catch(error => {
        console.error('[触触搜][BG] 获取菜单结构失败:', error);
        respond({ success: false, error: error?.message || String(error), code: 'MENU_STRUCTURE_FAILED' });
      });
    return true; // 异步响应
  }

  // 处理popup菜单项点击（复用右键菜单逻辑）
  if (request.action === 'executeMenuAction') {
    const requestId = ccsGetRequestId(request, 'executeMenuAction');
    const safeSendResponse = ccsCreateSafeResponder(sendResponse, 'executeMenuAction', requestId, 6000);
    ccsLogMessage('request', 'executeMenuAction', requestId, {
      menuItemId: request.menuItemId,
      menuType: request.menuType,
      hasKeyword: !!request.keyword
    });
    const { menuItemId, menuType, keyword, urlPattern, actionType, engineId } = request;

    (async () => {
      const sendResponse = safeSendResponse;
      try {
        // 获取当前标签页
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tab?.id;

        // 没有关键词时的处理（某些操作不需要关键词）
        if (!keyword && menuType !== 'action' && actionType !== 'show-popover') {
          sendResponse({ success: false, error: 'no-keyword' });
          return;
        }

        // 字数保护：按目标引擎截断用户原文 + toast 提示
        let effectiveKeyword = keyword || '';
        if (effectiveKeyword && typeof applyTextLimit === 'function' && menuItemId) {
          const limited = applyTextLimit(menuItemId, effectiveKeyword, { tabId: sender?.tab?.id });
          effectiveKeyword = limited.text;
        }
        const encodedKeyword = effectiveKeyword ? encodeURIComponent(effectiveKeyword) : '';

        // === SSoT: AI 任务统一快速通道 ===
        // 速答/百问/优化/封面生成器都走 runAITask；命中即返回，否则回落老 case。
        if (['fastqa','fastqa-quick','top100','optimize','cover'].includes(menuType) &&
            typeof runAITask === 'function' && effectiveKeyword) {
          const taskId = (menuType === 'optimize') ? 'optimize'
            : (menuType === 'cover') ? 'cover'
            : (menuType === 'top100') ? 'top100' : 'fastqa';
          let categoryId;
          let eid = engineId;
          let openAllFlag = request.openAll === true; // 调用方显式传 openAll（popup/sidepanel 走 menuItemId 走下面 resolveMenuId 也会兜住）
          if ((taskId === 'optimize' || taskId === 'cover') && menuItemId && typeof AITaskRegistry !== 'undefined') {
            const parsed = AITaskRegistry.resolveMenuId(menuItemId);
            if (parsed) {
              categoryId = parsed.categoryId;
              eid = parsed.engineId || eid;
              if (parsed.openAll) openAllFlag = true;
            }
          }
          // cover 自定义风格：sidepanel 传过来的 request.purpose 作为 purposeOverride 注入
          // 否则会用 coverPrompts.json 里 custom category 的占位文本
          const purposeOverride = (taskId === 'cover' && categoryId === 'custom' && typeof request.purpose === 'string' && request.purpose.trim())
            ? request.purpose
            : undefined;
          try {
            const r = await runAITask({
              taskId, keyword: effectiveKeyword, engineId: eid,
              categoryId, tabId: sender?.tab?.id,
              openAll: openAllFlag,
              purposeOverride
            });
            if (r.success) { sendResponse({ success: true }); return; }
          } catch (err) { /* 继续 fallback */ }
        }

        // 根据menuType处理不同类型的菜单
        switch (menuType) {
          case 'search':
          case 'ai-chat':
          case 'ai-search':
          case 'ecommerce':
          case 'translate':
          case 'portal':
            if (urlPattern && keyword) {
              const url = urlPattern
                .replace('${KEYWORD}', encodedKeyword)
                .replace('${PROMPT}', encodedKeyword);
              await ccsOpenMenuUrlWithAIRelay(urlPattern, effectiveKeyword, url, {
                source: 'execute-menu-action',
                menuId: menuItemId || '',
                engineId: engineId || '',
                tabId
              });
              sendResponse({ success: true });
            } else {
              sendResponse({ success: false, error: 'invalid-params' });
            }
            return;

          case 'tool':
          case 'transform':
            if (tabId && keyword) {
              const commandMap = {
                'copy': 'copy',
                'base64-encode': 'base64',
                'md5-hash': 'md5',
                'url-encode': 'url-encode',
                'to-uppercase': 'upper',
                'to-lowercase': 'lower'
              };
              const command = commandMap[actionType];
              if (actionType === 'copy') {
                const ok = await copyTextInTab(tab, keyword);
                if (!ok) {
                  await ccsSendTabMessageWithFallback(tabId, {
                    action: 'showToast',
                    message: '复制失败，请检查页面权限'
                  }, 'copy-failed-toast');
                  sendResponse({ success: false, error: 'copy-failed', code: 'COPY_FAILED' });
                  return;
                }
              } else if (command) {
                const sent = await ccsSendTabMessageWithFallback(tabId, {
                  action: 'processCommand',
                  command: command,
                  text: keyword
                }, 'process-command');
                if (!sent.ok) {
                  sendResponse({
                    success: false,
                    error: sent.error || 'content-unavailable',
                    code: sent.code || 'CONTENT_UNAVAILABLE'
                  });
                  return;
                }
              }
              sendResponse({ success: true });
            } else {
              sendResponse({ success: false, error: 'invalid-params' });
            }
            return;

          case 'fastqa':
          case 'fastqa-quick':
            if (keyword) {
              const config = await loadFastAnswersConfig();
              if (!config) {
                sendResponse({ success: false, error: 'config-load-failed' });
                return;
              }
              if (!fastAnswersTemplate) {
                fastAnswersTemplate = Array.isArray(config.templateLines)
                  ? config.templateLines.join('\\n')
                  : (config.template || '');
              }
              const prompt = buildFastAnswersPrompt(keyword);
              if (!prompt) {
                sendResponse({ success: false, error: 'template-invalid' });
                return;
              }
              const encodedPrompt = encodeURIComponent(prompt);
              // 查找对应引擎的URL模式
              let targetUrl = null;
              if (engineId) {
                const engine = (config.engines || []).find((e) => e.id === engineId);
                if (engine && engine.urlPattern) {
                  targetUrl = engine.urlPattern.replace('${PROMPT}', encodedPrompt);
                }
              }
              if (!targetUrl && urlPattern) {
                targetUrl = urlPattern.replace('${PROMPT}', encodedPrompt);
              }
              if (targetUrl) {
                chrome.tabs.create({ url: targetUrl });
                sendResponse({ success: true });
              } else {
                sendResponse({ success: false, error: 'no-engine-url' });
              }
            } else {
              sendResponse({ success: false, error: 'no-keyword' });
            }
            return;

          case 'top100':
            if (keyword) {
              const config = await loadTopQuestionsConfig();
              if (!config) {
                sendResponse({ success: false, error: 'config-load-failed' });
                return;
              }
              if (!topQuestionsTemplate) {
                topQuestionsTemplate = Array.isArray(config.templateLines)
                  ? config.templateLines.join('\\n')
                  : (config.template || '');
              }
              const prompt = buildTopQuestionsPrompt(keyword);
              if (!prompt) {
                sendResponse({ success: false, error: 'template-invalid' });
                return;
              }
              const encodedPrompt = encodeURIComponent(prompt);
              let targetUrl = null;
              if (engineId) {
                const engine = (config.engines || []).find((e) => e.id === engineId);
                if (engine && engine.urlPattern) {
                  targetUrl = engine.urlPattern.replace('${PROMPT}', encodedPrompt);
                }
              }
              if (!targetUrl && urlPattern) {
                targetUrl = urlPattern.replace('${PROMPT}', encodedPrompt);
              }
              if (targetUrl) {
                chrome.tabs.create({ url: targetUrl });
                sendResponse({ success: true });
              } else {
                sendResponse({ success: false, error: 'no-engine-url' });
              }
            } else {
              sendResponse({ success: false, error: 'no-keyword' });
            }
            return;

          case 'optimize':
            if (keyword) {
              const config = await loadOptimizedPromptConfig();
              if (!config) {
                sendResponse({ success: false, error: 'config-load-failed' });
                return;
              }
              if (!optimizedPromptTemplate) {
                optimizedPromptTemplate = Array.isArray(config.templateLines)
                  ? config.templateLines.join('\n')
                  : (config.template || '');
              }
              // 从 request 获取 purpose（优化类别）
              const purpose = request.purpose || '';
              const prompt = buildOptimizedPrompt(purpose, keyword);
              if (!prompt) {
                sendResponse({ success: false, error: 'template-invalid' });
                return;
              }
              const encodedPrompt = encodeURIComponent(prompt);
              let targetUrl = null;
              if (urlPattern) {
                targetUrl = urlPattern.replace('${PROMPT}', encodedPrompt);
              }
              if (targetUrl) {
                chrome.tabs.create({ url: targetUrl });
                sendResponse({ success: true });
              } else {
                sendResponse({ success: false, error: 'no-engine-url' });
              }
            } else {
              sendResponse({ success: false, error: 'no-keyword' });
            }
            return;

          case 'cover':
            if (keyword) {
              const config = await loadCoverPromptConfig();
              if (!config) {
                sendResponse({ success: false, error: 'config-load-failed' });
                return;
              }
              if (!coverPromptTemplate) {
                coverPromptTemplate = Array.isArray(config.templateLines)
                  ? config.templateLines.join('\n')
                  : (config.template || '');
              }
              // 从 request 获取 purpose（封面风格）
              const purpose = request.purpose || '';
              const prompt = buildCoverPrompt(purpose, keyword);
              if (!prompt) {
                sendResponse({ success: false, error: 'template-invalid' });
                return;
              }
              const encodedPrompt = encodeURIComponent(prompt);
              let targetUrl = null;
              if (urlPattern) {
                targetUrl = urlPattern.replace('${PROMPT}', encodedPrompt);
              }
              if (targetUrl) {
                chrome.tabs.create({ url: targetUrl });
                sendResponse({ success: true });
              } else {
                sendResponse({ success: false, error: 'no-engine-url' });
              }
            } else {
              sendResponse({ success: false, error: 'no-keyword' });
            }
            return;

          case 'action':
            if (actionType === 'show-popover' && tabId) {
              const sent = await ccsSendTabMessageWithFallback(tabId, {
                action: 'showPopover',
                text: keyword || ''
              }, 'show-popover');
              if (!sent.ok) {
                sendResponse({
                  success: false,
                  error: sent.error || 'content-unavailable',
                  code: sent.code || 'CONTENT_UNAVAILABLE'
                });
                return;
              }
              sendResponse({ success: true });
            } else if (menuItemId === 'ccs-top100-open-all' && keyword) {
              // 打开所有触触搜百问引擎
              const config = await loadTopQuestionsConfig();
              if (!config) {
                sendResponse({ success: false, error: 'config-load-failed' });
                return;
              }
              if (!topQuestionsTemplate) {
                topQuestionsTemplate = Array.isArray(config.templateLines)
                  ? config.templateLines.join('\\n')
                  : (config.template || '');
              }
              const prompt = buildTopQuestionsPrompt(keyword);
              if (!prompt) {
                sendResponse({ success: false, error: 'template-invalid' });
                return;
              }
              const encodedPrompt = encodeURIComponent(prompt);
              const engines = Array.isArray(config.engines) ? config.engines : [];
              let openedCount = 0;
              engines.forEach((engine) => {
                if (!engine || typeof engine.urlPattern !== 'string' || !engine.urlPattern) {
                  return;
                }
                const engineMenuId = `ccs-top100-${engine.id}`;
                if (!isMenuEnabled(engineMenuId)) return;
                const targetUrl = engine.urlPattern.replace('${PROMPT}', encodedPrompt);
                if (targetUrl) {
                  chrome.tabs.create({ url: targetUrl, active: openedCount === 0 });
                  openedCount += 1;
                }
              });
              sendResponse({ success: true, openedCount });
            } else if (menuItemId === 'ccs-fastqa-open-all' && keyword) {
              // 打开所有速答壹拾佰引擎
              const config = await loadFastAnswersConfig();
              if (!config) {
                sendResponse({ success: false, error: 'config-load-failed' });
                return;
              }
              if (!fastAnswersTemplate) {
                fastAnswersTemplate = Array.isArray(config.templateLines)
                  ? config.templateLines.join('\\n')
                  : (config.template || '');
              }
              const prompt = buildFastAnswersPrompt(keyword);
              if (!prompt) {
                sendResponse({ success: false, error: 'template-invalid' });
                return;
              }
              const encodedPrompt = encodeURIComponent(prompt);
              const engines = Array.isArray(config.engines) ? config.engines : [];
              let openedCount = 0;
              engines.forEach((engine) => {
                if (!engine || typeof engine.urlPattern !== 'string' || !engine.urlPattern) {
                  return;
                }
                const engineMenuId = `ccs-fastqa-${engine.id}`;
                if (!isMenuEnabled(engineMenuId)) return;
                const targetUrl = engine.urlPattern.replace('${PROMPT}', encodedPrompt);
                if (targetUrl) {
                  chrome.tabs.create({ url: targetUrl, active: openedCount === 0 });
                  openedCount += 1;
                }
              });
              sendResponse({ success: true, openedCount });
            } else {
              sendResponse({ success: false, error: 'unknown-action' });
            }
            return;

          case 'submenu':
            // 子菜单本身不执行操作
            sendResponse({ success: false, error: 'submenu-no-action' });
            return;

          default:
            // 尝试根据menuItemId使用现有的switch case逻辑
            if (menuItemId && keyword) {
              let handled = false;

              // === SSoT 快速通道 ===
              // URLBuilder 命中则直接打开，跳过下方硬编码 switch（保留作安全网）
              if (typeof tryOpenMenuUrl === 'function' && tryOpenMenuUrl(menuItemId, keyword, { tabId: sender?.tab?.id })) {
                sendResponse({ success: true });
                return;
              }

              switch (menuItemId) {
                case 'ccs-baidu':
                  chrome.tabs.create({ url: `https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${encodedKeyword}` });
                  handled = true;
                  break;
                case 'ccs-google':
                  chrome.tabs.create({ url: `https://www.google.com/search?q=${encodedKeyword}` });
                  handled = true;
                  break;
                case 'ccs-google-ai-chat':
                  await ccsOpenMenuUrlWithAIRelay(
                    'https://www.google.com/search?udm=50&ie=UTF-8&oe=UTF-8&q=${KEYWORD}',
                    keyword,
                    `https://www.google.com/search?udm=50&ie=UTF-8&oe=UTF-8&q=${encodedKeyword}`,
                    { source: 'execute-menu-action-fallback', menuId: menuItemId, engineId: 'google-ai' }
                  );
                  handled = true;
                  break;
                case 'ccs-yiyan':
                  await ccsOpenMenuUrlWithAIRelay(
                    'https://yiyan.baidu.com/?q=${KEYWORD}',
                    keyword,
                    `https://yiyan.baidu.com/?q=${encodedKeyword}`,
                    { source: 'execute-menu-action-fallback', menuId: menuItemId, engineId: 'yiyan' }
                  );
                  handled = true;
                  break;
                case 'ccs-chatgpt':
                  await ccsOpenMenuUrlWithAIRelay(
                    'https://chatgpt.com/?q=${KEYWORD}',
                    keyword,
                    `https://chatgpt.com/?q=${encodedKeyword}`,
                    { source: 'execute-menu-action-fallback', menuId: menuItemId, engineId: 'chatgpt' }
                  );
                  handled = true;
                  break;
                case 'ccs-claude':
                  await ccsOpenMenuUrlWithAIRelay(
                    'https://claude.ai/new?q=${KEYWORD}',
                    keyword,
                    `https://claude.ai/new?q=${encodedKeyword}`,
                    { source: 'execute-menu-action-fallback', menuId: menuItemId, engineId: 'claude' }
                  );
                  handled = true;
                  break;
                case 'ccs-grok':
                  await ccsOpenMenuUrlWithAIRelay(
                    'https://grok.com/?q=${KEYWORD}',
                    keyword,
                    `https://grok.com/?q=${encodedKeyword}`,
                    { source: 'execute-menu-action-fallback', menuId: menuItemId, engineId: 'grok' }
                  );
                  handled = true;
                  break;
              }
              if (handled) {
                sendResponse({ success: true });
                return;
              }
            }
            sendResponse({ success: false, error: 'unhandled-type' });
        }
      } catch (error) {
        console.error('[触触搜][BG] executeMenuAction 失败:', error);
        sendResponse({ success: false, error: error?.message || String(error) });
      }
    })();
    return true; // 异步响应
  }

  if (request.action === 'contextMenuPreview') {
    const tabId = sender?.tab?.id ?? null;
    const incoming = typeof request.selectionText === 'string' ? request.selectionText : '';

    // DEBOUNCE: Save latest preview data to prevent race conditions
    // when user rapidly selects text (e.g., dragging across "英国殖民统治问题")
    // Content script sends intermediate states: "题" → "显示" → "内容" → "英国殖民统治问题"
    // We only want to process the final selection after user stops moving mouse
    latestPreviewData = {
      request,
      sender,
      timestamp: Date.now()
    };

    logMenuEvent('context-preview-in', {
      tabId,
      incomingText: incoming,
      debounceQueued: true
    });

    // Clear previous timeout to prevent processing stale intermediate selections
    if (contextPreviewTimeout) {
      clearTimeout(contextPreviewTimeout);
      logMenuEvent('context-preview-debounce-cancelled', {
        tabId,
        reason: 'new-selection'
      });
    }

    // Set new timeout - only process after 50ms of inactivity
    contextPreviewTimeout = setTimeout(() => {
      const data = latestPreviewData;
      if (!data) return;

      const finalRequest = data.request;
      const finalSender = data.sender;
      const finalTabId = finalSender?.tab?.id ?? null;
      const finalIncoming = typeof finalRequest.selectionText === 'string' ? finalRequest.selectionText : '';

      logMenuEvent('context-preview-debounce-triggered', {
        tabId: finalTabId,
        incomingText: finalIncoming,
        delayMs: Date.now() - data.timestamp
      });

      (async () => {
      // BUGFIX: Validate that the message is from the currently active tab
      // to prevent cross-tab state contamination during fast tab switching
      // FAIL-OPEN MODE: Only reject if we're CERTAIN the message is from an inactive tab
      // (i.e., activeTabId exists and differs from finalTabId)
      if (finalTabId != null) {
        try {
          const activeTabs = await chrome.tabs.query({active: true, currentWindow: true});
          const activeTabId = activeTabs?.[0]?.id ?? null;

          // Only reject if we have a valid activeTabId AND it differs from finalTabId
          // If activeTabId is null (macOS focus issues, Chrome API bug), allow through (fail-open)
          if (activeTabId != null && finalTabId !== activeTabId) {
            logMenuEvent('context-preview-ignored-inactive-tab', {
              senderTabId: finalTabId,
              activeTabId: activeTabId,
              incomingText: finalIncoming?.substring(0, 50)
            });
            return; // Ignore messages from inactive tabs
          }

          if (activeTabId == null) {
            logMenuEvent('context-preview-validation-null-active', {
              finalTabId,
              reason: 'chrome.tabs.query returned no active tab, allowing through (fail-open)'
            });
          }
        } catch (error) {
          logMenuEvent('context-preview-validation-error', {
            tabId: finalTabId,
            error: error?.message
          });
          // Continue processing if validation fails (fail-open)
        }
      }

      const incomingTrimmed = typeof finalIncoming === 'string' ? finalIncoming.trim() : '';
      let previewText = finalIncoming;
      let normalizedPreview = previewText ? normalizeSearchText(previewText) : '';
      let source = previewText ? 'message' : 'none';
      const tabUrl = finalSender?.tab?.url || '';
      const tabStub = finalTabId != null ? { id: finalTabId, url: tabUrl } : null;

      if (finalTabId != null) {
        await syncSelectionFromTab(tabStub, 'context-preview', { updateMenu: false });
        if (!incomingTrimmed) {
          delete selectedTextByTab[finalTabId];
        }
      }

      if (!previewText && finalTabId != null && incomingTrimmed) {
        const cached = selectedTextByTab[finalTabId];
        const cachedText = typeof cached === 'string' ? cached : cached?.text;
        const cachedUrl = typeof cached === 'object' ? cached?.url : undefined;
        if (
          typeof cachedText === 'string' &&
          cachedText.trim().length > 0 &&
          (!tabUrl || !cachedUrl || cachedUrl === tabUrl)
        ) {
          previewText = cachedText;
          normalizedPreview = normalizeSearchText(previewText);
          source = 'cached-selection';
        }
      }

      if (!previewText && finalSender?.tab) {
        try {
      const fallback = await computeSearchTextForTab({
        tabId: finalTabId,
        tabUrl: finalSender.tab.url || '',
        // BUGFIX: Prefer fresh tab.title over cached value to avoid cross-tab contamination
        tabTitle: finalSender.tab.title || getLatestTabPageTitle(finalTabId) || '',
        selectionText: ''
      }, {
            forceFetchSelection: false,
            skipCurrentMenuFallback: false,
            allowFallbackSelectionFetch: false
          });
          if (fallback?.raw) {
            previewText = fallback.raw;
            normalizedPreview = fallback.normalized || normalizeSearchText(fallback.raw);
            source = 'resolver-fallback';
          logMenuEvent('context-preview-fallback', {
            tabId: finalTabId,
            raw: fallback.raw,
            normalized: fallback.normalized
          });
          if (finalTabId != null) {
            fallbackKeywordByTab[finalTabId] = {
              raw: fallback.raw,
              normalized: fallback.normalized || normalizeSearchText(fallback.raw),
              timestamp: Date.now(),
              url: finalSender.tab.url || ''
            };
          }
        }
      } catch (error) {
        logMenuEvent('context-preview-fallback-error', {
          tabId: finalTabId,
          error: error?.message || String(error)
          });
        }
      }

      if (!previewText && currentMenuState.raw) {
        previewText = currentMenuState.raw;
        normalizedPreview = currentMenuState.normalized || normalizeSearchText(previewText);
        source = 'menu-state';
      }

      if (finalTabId != null && previewText) {
        updateLatestTabKeyword(finalTabId, previewText, normalizedPreview || previewText);
      }

      logMenuEvent('context-preview', {
        tabId: finalTabId,
        previewText,
        normalizedPreview,
        source
      });
      if (finalTabId != null) {
        const currentTitleEntry = latestTitleByTab[finalTabId];
        const titleForCompare = (currentTitleEntry?.keyword || currentTitleEntry?.title || finalSender?.tab?.title || '').trim();
        const normalizedTitle = titleForCompare ? normalizeSearchText(titleForCompare) : '';
        const keywordForCompare = previewText ? normalizeSearchText(previewText) : '';
        const matched = normalizedTitle && keywordForCompare && normalizedTitle === keywordForCompare;
        const menuDisplay = previewText
          ? formatMenuTitle(normalizedPreview || previewText) || previewText
          : currentMenuState?.display || '';
        const menuRaw = previewText || currentMenuState?.raw || '';
        logMenuEvent('context-preview-title-check', {
          tabId: finalTabId,
          title: titleForCompare,
          keyword: previewText,
          normalizedTitle,
          normalizedKeyword: keywordForCompare,
          menuDisplay,
          menuRaw,
          match: !!matched,
          source
        });
      }

      if (previewText && source !== 'menu-state') {
        if (finalTabId != null) {
          selectedTextByTab[finalTabId] = {
            text: previewText,
            url: tabUrl,
            timestamp: Date.now()
          };
          delete fallbackKeywordByTab[finalTabId];
          logMenuEvent('context-selection-cache', {
            tabId: finalTabId,
            source,
            text: previewText,
            normalized: normalizedPreview,
            tabUrl
          });
        }
        setMenuState(previewText, normalizedPreview || previewText, {
          tabId: finalTabId,
          url: tabUrl
        });
      }
    })();
    }, 50); // 50ms debounce delay

    return;
  }
  
  // 处理content script的选择变化
  if (request.action === 'selectionChanged' && sender.tab) {
    const tabId = sender.tab.id;
    const rawText = typeof request.text === 'string' ? request.text : '';
    const hasContent = rawText.trim().length > 0;
    const trigger = typeof request.trigger === 'string' ? request.trigger : 'unknown';
    const selectAllProtected =
      request.selectAllProtected === true ||
      (typeof request.selectAllProtectUntil === 'number' && Date.now() < request.selectAllProtectUntil);

    // BUGFIX: Validate that the message is from the currently active tab
    // to prevent cross-tab state contamination during fast tab switching
    // FAIL-OPEN MODE: Only reject if we're CERTAIN the message is from an inactive tab
    chrome.tabs.query({active: true, currentWindow: true}, async (tabs) => {
      const activeTabId = tabs?.[0]?.id ?? null;

      // Only reject if we have a valid activeTabId AND it differs from tabId
      // If activeTabId is null (macOS focus issues, Chrome API bug), allow through (fail-open)
      if (activeTabId != null && tabId !== activeTabId) {
        logMenuEvent('selection-changed-ignored-inactive-tab', {
          senderTabId: tabId,
          activeTabId: activeTabId,
          text: rawText?.substring(0, 50),
          hasContent
        });
        return; // Ignore messages from inactive tabs
      }

      if (activeTabId == null) {
        logMenuEvent('selection-changed-validation-null-active', {
          tabId,
          reason: 'chrome.tabs.query returned no active tab, allowing through (fail-open)',
          hasContent
        });
      }

      // Content 侧已经会拦截 Ctrl+A 后的空/短退化；这里再做一层 BG 保险。
      // 富文本编辑器慢速释放快捷键时，某些 keyup/selectionchange 路径会短暂汇报
      // 空选区或被图片截断的短文本。如果直接删除 selectedTextByTab，prefetch 会把
      // storage cache 改回 HTML title，popup/sidepanel 徽章就退化了。
      const existingSelection = selectedTextByTab[tabId];
      const existingText = typeof existingSelection === 'string'
        ? existingSelection.trim()
        : (existingSelection && typeof existingSelection.text === 'string'
          ? existingSelection.text.trim()
          : '');
      const isUserInitiatedTrigger =
        trigger === 'mouseup' ||
        trigger === 'contextmenu' ||
        trigger === 'init' ||
        trigger === 'keyup:Escape' ||
        trigger === 'keyup:Enter';
      if (selectAllProtected && existingText && !isUserInitiatedTrigger) {
        const incomingLength = rawText.trim().length;
        if (!hasContent || incomingLength < existingText.length) {
          logMenuEvent('selection-changed-selectall-degradation-ignored', {
            tabId,
            trigger,
            existingLength: existingText.length,
            incomingLength,
            hasContent
          });
          return;
        }
      }

      // Only update state for active tab
      if (hasContent) {
        selectedTextByTab[tabId] = {
          text: rawText,
          url: sender.tab.url || '',
          timestamp: Date.now()
        };
        const normalizedSelection = normalizeSearchText(rawText);
        setMenuState(rawText, normalizedSelection || rawText, {
          tabId,
          url: sender.tab.url || ''
        });
        // v1.6.23 (perf)：同步写 ccs_kw_<tabId> storage，让 popup/sidepanel 一打开
        // 就能从 storage 读到，不再走 sendMessage 兜底链。之前 selectionChanged 只
        // 更内存（selectedTextByTab），popup 下次开 read storage 还是空，被迫等
        // SW round-trip。
        if (globalThis.KeywordService?._writeStorageCache) {
          globalThis.KeywordService._writeStorageCache(tabId, {
            text: normalizedSelection || rawText,
            raw: rawText,
            url: sender.tab.url || ''
          }).catch(() => { /* ignore */ });
        }
      } else {
        // 选区被清空：先把内存里的 selection 抹掉，再立即跑一次 prefetch 让
        // storage cache 换成 URL/title 兜底。
        // 这样 popup 下一次打开（或当前正打开的 listener 收到 storage.onChanged）
        // 立刻看到的就是 title 而不是过期的选区。
        delete selectedTextByTab[tabId];
        if (sender.tab && typeof prefetchMenuState === 'function') {
          prefetchMenuState(sender.tab, 'selection-cleared').catch(() => {});
        }
      }

      const preserve = shouldPreserveMenuStateForTab(sender.tab);
      if (!hasContent || !preserve) {
        await refreshMenuTitle(sender.tab, rawText);
      }
    });
  }
});

// v1.6.22 性能实验：onUpdated 精简模式开关。
//
// 背景：低配 Windows 新开网页时复现"后台启动较慢，请重试"。溯源链路是
// chrome.tabs.onUpdated 在单次跳转里会触发 3 次（title / loading / complete），
// 每次都跑 prefetchMenuState + refreshMenuTitle，加上 complete 阶段会调
// syncSelectionFromTab，新页面 content.js 尚未注入 → reinject 兜底 → 再 sendMessage
// 重试，最后还有一个 setTimeout 300ms 延迟二次 prefetch。SW 持续忙 3-6 秒，期间
// popup/sidepanel 发出的 executeMenuAction 排队，runtimeClient 5000ms × 2 retry
// 仍可能撞上忙窗口超时，触发 popup.js:176 / sidepanel.js:734 的 TIMEOUT 文案。
//
// LITE=true（默认）：
//   - title 变化只刷 in-memory cache，不再 prefetch / refreshMenuTitle
//   - loading 只清 selection / fallback 缓存，不 prefetch
//   - complete 只跑一次 prefetch + refreshMenuTitle，跳过 syncSelectionFromTab
//     content.js 在 manifest run_at:document_start 已自动注入，它读到 selection
//     后会主动发 selectionChanged 上来，无需 SW 这边主动 fetch + reinject
//   - 删除 setTimeout 300ms 延迟二次 prefetch（SPA 站点菜单标题最坏延迟一次轮询）
// LITE=false：恢复 v1.6.21 完整行为，所有事件路径原样执行
//
// 若上架低配 Windows 后右键菜单标题/关键字同步出问题，把这里改成 false 即可回滚。
const BG_TABS_ONUPDATED_LITE = true;

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (BG_TABS_ONUPDATED_LITE) {
    if (typeof changeInfo.title === 'string') {
      updateLatestTabTitle(tabId, changeInfo.title);
    }
    if (changeInfo.status === 'loading') {
      delete selectedTextByTab[tabId];
      delete fallbackKeywordByTab[tabId];
    }
    if (changeInfo.status === 'complete' && tab.url) {
      const candidateUrl = changeInfo.url || tab.url;
      const mergedTab = Object.assign({}, tab, { id: tabId, url: candidateUrl });
      await prefetchMenuState(mergedTab, 'tab-complete');
      const stored = selectedTextByTab[tabId];
      const hasStoredSelection =
        stored && typeof stored.text === 'string' && stored.text.trim().length > 0;
      const preserve = shouldPreserveMenuStateForUrl(candidateUrl);
      if (preserve && hasStoredSelection && stored.url === (candidateUrl || stored.url)) {
        return;
      }
      await refreshMenuTitle(mergedTab);
    }
    return;
  }

  // ===== 原始完整行为（BG_TABS_ONUPDATED_LITE=false 时走这里）=====
  if (typeof changeInfo.title === 'string') {
    updateLatestTabTitle(tabId, changeInfo.title);
    const mergedForTitle = Object.assign({}, tab, {
      id: tabId,
      title: changeInfo.title
    });
    if (tab?.url || changeInfo.url) {
      mergedForTitle.url = changeInfo.url || tab?.url || '';
      await prefetchMenuState(mergedForTitle, 'title-changed');
    }
    await refreshMenuTitle(mergedForTitle);
  }
  if (changeInfo.status === 'loading') {
    delete selectedTextByTab[tabId];
    delete fallbackKeywordByTab[tabId];
    const mergedLoadingTab = Object.assign({}, tab, {
      id: tabId,
      url: changeInfo.url || tab?.url || ''
    });
    await prefetchMenuState(mergedLoadingTab, 'tab-loading');
  }
  if (changeInfo.status === 'complete' && tab.url) {
    const candidateUrl = changeInfo.url || tab.url;
    const mergedTab = Object.assign({}, tab, { id: tabId, url: candidateUrl });
    await prefetchMenuState(mergedTab, 'tab-complete');
    const syncedText = await syncSelectionFromTab(mergedTab, 'tab-updated');
    if (syncedText) {
      delete fallbackKeywordByTab[tabId];
      return;
    }
    const stored = selectedTextByTab[tabId];
    const hasStoredSelection =
      stored && typeof stored.text === 'string' && stored.text.trim().length > 0;
    const preserve = shouldPreserveMenuStateForUrl(candidateUrl);
    if (preserve && hasStoredSelection && stored.url === (candidateUrl || stored.url)) {
      return;
    }
    await refreshMenuTitle(mergedTab);

    setTimeout(async () => {
      try {
        const freshTab = await chrome.tabs.get(tabId);
        if (freshTab && freshTab.url === candidateUrl) {
          if (freshTab.title && freshTab.title !== (tab.title || '')) {
            updateLatestTabTitle(tabId, freshTab.title);
            logMenuEvent('delayed-title-update', {
              tabId,
              oldTitle: tab.title,
              newTitle: freshTab.title,
              url: candidateUrl
            });
          }
          await prefetchMenuState(freshTab, 'delayed-title-refresh');
        }
      } catch (err) {
        logMenuEvent('delayed-title-refresh-failed', {
          tabId,
          error: err?.message
        });
      }
    }, 300);
  }
});

// 监听标签页激活，动态更新菜单标题
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);

  // BUGFIX: Smart cache preservation - save and restore selection state
  if (currentMenuState.tabId != null && currentMenuState.tabId !== activeInfo.tabId) {
    const previousTabId = currentMenuState.tabId;

    logMenuEvent('tab-activated-state-transition', {
      previousTabId,
      newTabId: activeInfo.tabId,
      hasCurrentState: !!(currentMenuState.raw),
      hasStoredSelection: !!selectedTextByTab[activeInfo.tabId]
    });

    // Save current tab's state to cache before switching
    if (currentMenuState.raw && currentMenuState.raw.trim()) {
      selectedTextByTab[previousTabId] = {
        text: currentMenuState.raw,
        url: currentMenuState.url,
        timestamp: Date.now()
      };
      logMenuEvent('tab-activated-saved-to-cache', {
        tabId: previousTabId,
        text: currentMenuState.raw.substring(0, 50)
      });
    }

    // Try to restore new tab's state from cache
    const cached = selectedTextByTab[activeInfo.tabId];
    if (cached && cached.text && cached.text.trim()) {
      const age = Date.now() - (cached.timestamp || 0);
      const isFresh = age < 10000; // 10 seconds threshold
      const urlMatches = cached.url === tab.url;

      if (isFresh && urlMatches) {
        // Restore from cache
        setMenuState(cached.text, normalizeSearchText(cached.text), {
          tabId: activeInfo.tabId,
          url: tab.url
        });
        logMenuEvent('tab-activated-restored-from-cache', {
          tabId: activeInfo.tabId,
          age,
          text: cached.text.substring(0, 50)
        });
      } else {
        // Cache expired or URL changed, clear state
        // BUGFIX: Set tabId to new active tab immediately to prevent stale messages
        currentMenuState.raw = '';
        currentMenuState.normalized = '';
        currentMenuState.display = '';
        currentMenuState.tabId = activeInfo.tabId; // ✅ Set to new tab, not null
        currentMenuState.url = tab.url || '';
        logMenuEvent('tab-activated-cache-invalid', {
          tabId: activeInfo.tabId,
          age,
          isFresh,
          urlMatches
        });
      }
    } else {
      // No cache, clear state
      // BUGFIX: Set tabId to new active tab immediately to prevent stale messages
      currentMenuState.raw = '';
      currentMenuState.normalized = '';
      currentMenuState.display = '';
      currentMenuState.tabId = activeInfo.tabId; // ✅ Set to new tab, not null
      currentMenuState.url = tab.url || '';
    }
  }

  // BUGFIX: Immediately update latestTitleByTab cache with fresh tab title
  // This ensures onShown will have up-to-date data if triggered quickly after tab switch
  if (tab?.id != null && tab?.title) {
    updateLatestTabTitle(tab.id, tab.title);
    logMenuEvent('tab-activated-title-preload', {
      tabId: tab.id,
      title: tab.title,
      url: tab.url
    });
  }

  // BUGFIX: Preload keywords to prevent empty menu on first right-click
  // Extract keywords from URL/title and cache them immediately
  if (tab?.url && tab?.id != null) {
    try {
      const keywords = await extractSearchKeywords(tab.url, tab);
      if (keywords && keywords.trim()) {
        fallbackKeywordByTab[activeInfo.tabId] = {
          raw: keywords,
          normalized: normalizeSearchText(keywords),
          timestamp: Date.now(),
          url: tab.url
        };
        logMenuEvent('tab-activated-keyword-preload', {
          tabId: activeInfo.tabId,
          keywords: keywords.substring(0, 50),
          url: tab.url
        });
      }
    } catch (err) {
      // Keyword extraction failed, but don't block other operations
      logMenuEvent('tab-activated-keyword-preload-failed', {
        tabId: activeInfo.tabId,
        error: err?.message
      });
    }
  }

  if (tab?.url) {
    await prefetchMenuState(tab, 'tab-activated');
  }
  const syncedText = await syncSelectionFromTab(tab, 'tab-activated');
  if (syncedText) {
    delete fallbackKeywordByTab[activeInfo.tabId];
    return;
  }
  const stored = selectedTextByTab[activeInfo.tabId];
  const hasStoredSelection =
    stored && typeof stored.text === 'string' && stored.text.trim().length > 0;
  const preserve = shouldPreserveMenuStateForTab(tab);
  if (preserve && hasStoredSelection && stored.url === (tab.url || stored.url)) {
    return;
  }
  await refreshMenuTitle(tab);
});

// BUGFIX: Clean up stale cache entries when tabs are closed
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  logMenuEvent('tab-removed', {
    tabId,
    windowClosing: removeInfo.windowClosing
  });

  // Clean up per-tab caches to prevent memory leaks and stale data
  // C 档重构：内存缓存 + storage 缓存一起清，走 KeywordService.clearTab
  KeywordService.clearTab(tabId);
  if (typeof ccsClearUrlRecoveryForTab === 'function') {
    ccsClearUrlRecoveryForTab(tabId).catch(() => {});
  }

  // Clear currentMenuState if it belongs to the closed tab
  if (currentMenuState.tabId === tabId) {
    logMenuEvent('tab-removed-clearing-current-state', {
      tabId,
      url: currentMenuState.url
    });
    currentMenuState.raw = '';
    currentMenuState.normalized = '';
    currentMenuState.display = '';
    currentMenuState.tabId = null;
    currentMenuState.url = '';
  }
});

// 根据URL更新菜单标题
async function updateContextMenuForTab(tab) {
  // 注意：这里只是预显示，实际使用时选中文本优先级更高
  const keywords = await extractSearchKeywords(tab.url, tab);
  const normalized = keywords ? normalizeSearchText(keywords) : '';
  applyMenuTitle(normalized, keywords || '', {
    tabId: tab?.id ?? null,
    url: tab?.url || ''
  });
}

if (chrome.contextMenus.onShown) {
  chrome.contextMenus.onShown.addListener((info, tab) => {
    const tabId = tab?.id ?? null;
    const tabUrl = tab?.url || '';
    logMenuEvent('context-onShown', {
      tabId,
      menuIds: Array.isArray(info?.menuIds) ? info.menuIds : [],
      contexts: info?.contexts || []
    });
    if (tabId == null) {
      if (chrome.contextMenus.refresh) {
        chrome.contextMenus.refresh();
      }
      return;
    }
    (async () => {
      try {
        // BUGFIX: Force refresh tab info to ensure we have the latest title and URL
        let freshTab = tab;
        if (tabId != null) {
          try {
            freshTab = await chrome.tabs.get(tabId);
            logMenuEvent('onShown-tab-refreshed', {
              tabId,
              freshTitle: freshTab?.title,
              originalTitle: tab?.title,
              titleChanged: freshTab?.title !== tab?.title
            });
          } catch (err) {
            // Tab may have been closed, use original tab object
            logMenuEvent('onShown-tab-refresh-failed', {
              tabId,
              error: err?.message
            });
          }
        }

        // BUGFIX: Clear stale currentMenuState if it's from a different tab
        const isCurrentMenuStateStale = currentMenuState.tabId != null && currentMenuState.tabId !== tabId;
        if (isCurrentMenuStateStale) {
          logMenuEvent('onShown-clearing-stale-state', {
            staleTabId: currentMenuState.tabId,
            currentTabId: tabId,
            staleUrl: currentMenuState.url,
            currentUrl: freshTab?.url || tabUrl
          });
        }

        const synced = await syncSelectionFromTab(freshTab, 'menu-shown', { updateMenu: false });
        let raw = '';
        let normalized = '';
        if (typeof synced === 'string' && synced.trim()) {
          raw = synced;
          normalized = normalizeSearchText(synced);
        } else {
          const stored = selectedTextByTab[tabId];
          const storedText = typeof stored?.text === 'string' ? stored.text.trim() : '';
          const storedAge = stored?.timestamp ? (Date.now() - stored.timestamp) : Infinity;
          const isCacheFresh = storedAge < 10000; // 10 seconds threshold

          // BUGFIX: Validate cache freshness before using stored selection
          if (storedText && isCacheFresh) {
            raw = storedText;
            normalized = normalizeSearchText(storedText);
            logMenuEvent('onShown-used-cached-selection', {
              tabId,
              age: storedAge,
              text: storedText.substring(0, 50)
            });
          } else {
            if (storedText && !isCacheFresh) {
              logMenuEvent('onShown-cache-expired', {
                tabId,
                age: storedAge,
                text: storedText.substring(0, 50)
              });
            }
            const result = await computeSearchTextForTab({
              tabId,
              tabUrl: freshTab?.url || tabUrl,
              // BUGFIX: Always use freshly fetched tab.title, no fallback to cache
              // This prevents using a cached title from a different tab
              tabTitle: freshTab?.title || '',
              selectionText: ''
            }, {
              forceFetchSelection: false,
              allowFallbackSelectionFetch: false,
              // BUGFIX: Only skip fallback if currentMenuState is from a different tab
              // This allows using cached selection for the same tab after switching back
              skipCurrentMenuFallback: isCurrentMenuStateStale
            });
            raw = result?.raw || '';
            normalized = result?.normalized || '';

            // BUGFIX: Retry mechanism for late-updating titles
            // If we only got URL-based keywords but no title-based keywords, retry after a short delay
            if (raw && !freshTab?.title) {
              logMenuEvent('onShown-scheduling-retry', {
                tabId,
                reason: 'no-title-on-first-attempt',
                currentKeyword: raw.substring(0, 50)
              });

              setTimeout(async () => {
                try {
                  const retryTab = await chrome.tabs.get(tabId);
                  if (retryTab && retryTab.title && retryTab.url === (freshTab?.url || tabUrl)) {
                    updateLatestTabTitle(tabId, retryTab.title);
                    const retryResult = await computeSearchTextForTab({
                      tabId,
                      tabUrl: retryTab.url,
                      tabTitle: retryTab.title,
                      selectionText: ''
                    }, {
                      forceFetchSelection: false,
                      skipCurrentMenuFallback: false,
                      allowFallbackSelectionFetch: false
                    });

                    const retryRaw = retryResult?.raw || '';
                    const retryNormalized = retryResult?.normalized || '';

                    // Only update if we got a better result (with title)
                    if (retryRaw && retryRaw !== raw) {
                      setMenuState(retryRaw, retryNormalized || retryRaw, {
                        tabId,
                        url: retryTab.url
                      });
                      await refreshContextMenu();
                      logMenuEvent('onShown-retry-success', {
                        tabId,
                        oldKeyword: raw.substring(0, 50),
                        newKeyword: retryRaw.substring(0, 50),
                        title: retryTab.title
                      });
                    }
                  }
                } catch (err) {
                  logMenuEvent('onShown-retry-failed', {
                    tabId,
                    error: err?.message
                  });
                }
              }, 150); // 150ms delay for title to update
            }
          }
        }
        if (raw || normalized) {
          await setMenuState(raw, normalized || raw, {
            tabId,
            url: freshTab?.url || tabUrl
          });
        }
      } catch (error) {
        logMenuEvent('context-onShown-error', {
          tabId,
          error: error?.message || String(error)
        });
      } finally {
        snapshotMenuTitles('onShown-final');
        // BUGFIX: Add delay before refresh to ensure Chrome updates its menu cache
        // This prevents showing stale menu items when onShown triggers
        if (chrome.contextMenus.refresh) {
          setTimeout(() => {
            chrome.contextMenus.refresh();
            logMenuEvent('onShown-refreshed-delayed', {
              timestamp: Date.now(),
              delayMs: 50
            });
          }, 50);
        }
      }
    })();
  });
}

// ==================== 导出到全局 ====================

globalThis.prefetchMenuState = prefetchMenuState;
globalThis.syncSelectionFromTab = syncSelectionFromTab;
