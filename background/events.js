chrome.runtime.onInstalled.addListener(createContextMenus);
if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(createContextMenus);
}

// 预加载调试开关与图标支持状态
ensureMenuIconSupportLoaded();

function syncSelectionFromTab(tab, reason = 'unknown', options = {}) {
  const updateMenu = options.updateMenu !== false;
  const tabId = tab?.id;
  const tabUrl = tab?.url || '';
  if (tabId == null) {
    return Promise.resolve('');
  }
  return new Promise((resolve) => {
    let responded = false;
    try {
      chrome.tabs.sendMessage(tabId, { action: 'fetchSelectionSnapshot' }, (response) => {
        responded = true;
        if (chrome.runtime.lastError) {
          logMenuEvent('selection-sync-error', {
            tabId,
            reason,
            error: chrome.runtime.lastError.message
          });
          resolve('');
          return;
        }
        const text = typeof response?.text === 'string' ? response.text : '';
        const source = response?.source || '';
        const trimmed = text.trim();
        if (trimmed) {
          selectedTextByTab[tabId] = {
            text,
            url: tabUrl || response?.url || ''
          };
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
    setTimeout(() => {
      if (!responded) {
        logMenuEvent('selection-sync-timeout', { tabId, reason });
        delete selectedTextByTab[tabId];
        resolve('');
      }
    }, 500);
  });
}

// 监听来自content script和popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ccs-log-menu-icons') {
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
      sendResponse?.({ ok: true, info });
    }).catch((err) => {
      console.warn('[触触搜][BG][ICON] 状态报告失败', err);
      sendResponse?.({ ok: false, error: err?.message || String(err) });
    });
    return true;
  }
  if (request.action === 'getSearchText') {
    const { tabId, url, title, selectionText, forceFresh } = request;
    computeSearchTextForTab({
      tabId,
      tabUrl: url,
      tabTitle: title,
      selectionText
    }, {
      forceFetchSelection: !!forceFresh,
      skipCurrentMenuFallback: !!forceFresh
    }).then((text) => {
      sendResponse?.({ text: text.normalized, raw: text.raw });
    }).catch((error) => {
      console.error('[触触搜][BG] 获取搜索文本失败:', error);
      sendResponse?.({ text: '', raw: '' });
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
    extractSearchKeywords(request.url, { title: request.title })
      .then(keywords => {
        sendResponse({ keywords });
      })
      .catch(error => {
        console.error('Error extracting keywords:', error);
        sendResponse({ keywords: null });
      });
    return true; // 异步响应
  }
  if (request.action === 'contextMenuPreview') {
    const tabId = sender?.tab?.id ?? null;
    const incoming = typeof request.selectionText === 'string' ? request.selectionText : '';
    logMenuEvent('context-preview-in', {
      tabId,
      incomingText: incoming
    });

    (async () => {
      let previewText = incoming;
      let normalizedPreview = previewText ? normalizeSearchText(previewText) : '';
      let source = previewText ? 'message' : 'none';
      const tabUrl = sender?.tab?.url || '';
      const tabStub = tabId != null ? { id: tabId, url: tabUrl } : null;

      if (tabId != null) {
        await syncSelectionFromTab(tabStub, 'context-preview', { updateMenu: false });
      }

      if (!previewText && tabId != null) {
        const cached = selectedTextByTab[tabId];
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

      if (!previewText && sender?.tab) {
        try {
          const fallback = await computeSearchTextForTab({
            tabId,
            tabUrl: sender.tab.url || '',
            tabTitle: sender.tab.title || '',
            selectionText: ''
          }, {
            forceFetchSelection: true,
            skipCurrentMenuFallback: true
          });
          if (fallback.raw) {
            previewText = fallback.raw;
            normalizedPreview = fallback.normalized || normalizeSearchText(fallback.raw);
            source = 'tab-fallback';
            logMenuEvent('context-preview-tab-fallback', {
              tabId,
              raw: fallback.raw,
              normalized: fallback.normalized
            });
            if (tabId != null) {
              selectedTextByTab[tabId] = {
                text: fallback.raw,
                url: sender.tab.url || ''
              };
            }
          }
        } catch (error) {
          logMenuEvent('context-preview-fallback-error', {
            tabId,
            error: error?.message || String(error)
          });
        }
      }

      if (!previewText && currentMenuState.raw) {
        previewText = currentMenuState.raw;
        normalizedPreview = currentMenuState.normalized || normalizeSearchText(previewText);
        source = 'menu-state';
      }

      logMenuEvent('context-preview', {
        tabId,
        previewText,
        normalizedPreview,
        source
      });

      if (previewText && source !== 'menu-state') {
        if (tabId != null) {
          selectedTextByTab[tabId] = {
            text: previewText,
            url: tabUrl
          };
          logMenuEvent('context-selection-cache', {
            tabId,
            source,
            text: previewText,
            normalized: normalizedPreview,
            tabUrl
          });
        }
        setMenuState(previewText, normalizedPreview || previewText, {
          tabId,
          url: tabUrl
        });
      }
    })();

    return;
  }
  
  // 处理content script的选择变化
  if (request.action === 'selectionChanged' && sender.tab) {
    const tabId = sender.tab.id;
    const rawText = typeof request.text === 'string' ? request.text : '';
    const hasContent = rawText.trim().length > 0;
    if (hasContent) {
      selectedTextByTab[tabId] = {
        text: rawText,
        url: sender.tab.url || ''
      };
      const normalizedSelection = normalizeSearchText(rawText);
      setMenuState(rawText, normalizedSelection || rawText, {
        tabId,
        url: sender.tab.url || ''
      });
    } else {
      delete selectedTextByTab[tabId];
    }
    chrome.tabs.query({active: true, currentWindow: true}, async (tabs) => {
      if (tabs[0] && tabs[0].id === tabId) {
        if (!hasContent && shouldPreserveMenuStateForTab(sender.tab)) {
          return;
        }
        await refreshMenuTitle(sender.tab, rawText);
      }
    });
  }
});

// 监听标签页更新，动态更新菜单标题
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    delete selectedTextByTab[tabId];
  }
  if (changeInfo.status === 'complete' && tab.url) {
    const candidateUrl = changeInfo.url || tab.url;
    const mergedTab = Object.assign({}, tab, { id: tabId, url: candidateUrl });
    const syncedText = await syncSelectionFromTab(mergedTab, 'tab-updated');
    if (syncedText) {
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
  }
});

// 监听标签页激活，动态更新菜单标题
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  const syncedText = await syncSelectionFromTab(tab, 'tab-activated');
  if (syncedText) {
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
