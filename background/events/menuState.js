/**
 * 右键菜单状态：按标签页预取关键字、同步选区、调试快照、content script 补注入。
 */

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
