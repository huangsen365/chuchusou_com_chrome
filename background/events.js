chrome.runtime.onInstalled.addListener(createContextMenus);
if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(createContextMenus);
}

// 预加载调试开关与图标支持状态
ensureMenuIconSupportLoaded();

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
            url: tabUrl || response?.url || ''
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
      const incomingTrimmed = typeof incoming === 'string' ? incoming.trim() : '';
      let previewText = incoming;
      let normalizedPreview = previewText ? normalizeSearchText(previewText) : '';
      let source = previewText ? 'message' : 'none';
      const tabUrl = sender?.tab?.url || '';
      const tabStub = tabId != null ? { id: tabId, url: tabUrl } : null;

      if (tabId != null) {
        await syncSelectionFromTab(tabStub, 'context-preview', { updateMenu: false });
        if (!incomingTrimmed) {
          delete selectedTextByTab[tabId];
        }
      }

      if (!previewText && tabId != null && incomingTrimmed) {
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
        tabTitle: getLatestTabPageTitle(tabId) || sender.tab.title || '',
        selectionText: ''
      }, {
            forceFetchSelection: false,
            skipCurrentMenuFallback: false
          });
          if (fallback?.raw) {
            previewText = fallback.raw;
            normalizedPreview = fallback.normalized || normalizeSearchText(fallback.raw);
            source = 'resolver-fallback';
          logMenuEvent('context-preview-fallback', {
            tabId,
            raw: fallback.raw,
            normalized: fallback.normalized
          });
          if (tabId != null) {
            fallbackKeywordByTab[tabId] = {
              raw: fallback.raw,
              normalized: fallback.normalized || normalizeSearchText(fallback.raw),
              timestamp: Date.now(),
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

      if (tabId != null && previewText) {
        updateLatestTabKeyword(tabId, previewText, normalizedPreview || previewText);
      }

      logMenuEvent('context-preview', {
        tabId,
        previewText,
        normalizedPreview,
        source
      });
      if (tabId != null) {
        const currentTitleEntry = latestTitleByTab[tabId];
        const titleForCompare = (currentTitleEntry?.keyword || currentTitleEntry?.title || sender?.tab?.title || '').trim();
        const normalizedTitle = titleForCompare ? normalizeSearchText(titleForCompare) : '';
        const keywordForCompare = previewText ? normalizeSearchText(previewText) : '';
        const matched = normalizedTitle && keywordForCompare && normalizedTitle === keywordForCompare;
        const menuDisplay = previewText
          ? formatMenuTitle(normalizedPreview || previewText) || previewText
          : currentMenuState?.display || '';
        const menuRaw = previewText || currentMenuState?.raw || '';
        logMenuEvent('context-preview-title-check', {
          tabId,
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
        if (tabId != null) {
          selectedTextByTab[tabId] = {
            text: previewText,
            url: tabUrl
          };
          delete fallbackKeywordByTab[tabId];
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
        const preserve = shouldPreserveMenuStateForTab(sender.tab);
        if (!hasContent || !preserve) {
          await refreshMenuTitle(sender.tab, rawText);
        }
      }
    });
  }
});

// 监听标签页更新，动态更新菜单标题
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
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
  }
});

// 监听标签页激活，动态更新菜单标题
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
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
        const synced = await syncSelectionFromTab(tab, 'menu-shown', { updateMenu: false });
        let raw = '';
        let normalized = '';
        if (typeof synced === 'string' && synced.trim()) {
          raw = synced;
          normalized = normalizeSearchText(synced);
        } else {
          const stored = selectedTextByTab[tabId];
          const storedText = typeof stored?.text === 'string' ? stored.text.trim() : '';
          if (storedText) {
            raw = storedText;
            normalized = normalizeSearchText(storedText);
          } else {
            const result = await computeSearchTextForTab({
              tabId,
              tabUrl,
              tabTitle: getLatestTabPageTitle(tabId) || tab?.title || '',
              selectionText: ''
            }, {
              forceFetchSelection: false,
              skipCurrentMenuFallback: false
            });
            raw = result?.raw || '';
            normalized = result?.normalized || '';
          }
        }
        if (raw || normalized) {
          setMenuState(raw, normalized || raw, {
            tabId,
            url: tabUrl
          });
        }
      } catch (error) {
        logMenuEvent('context-onShown-error', {
          tabId,
          error: error?.message || String(error)
        });
      } finally {
        snapshotMenuTitles('onShown-final');
        if (chrome.contextMenus.refresh) {
          chrome.contextMenus.refresh();
        }
      }
    })();
  });
}
