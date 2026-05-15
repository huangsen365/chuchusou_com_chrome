function logResolver(stage, payload) {
  if (typeof logMenuEvent === 'function') {
    try {
      logMenuEvent(`resolver-${stage}`, payload);
    } catch (_) {
      // ignore logging failure
    }
  } else if (typeof console !== 'undefined' && console.debug) {
    console.debug('[触触搜][RESOLVER]', stage, payload);
  }
}

function fetchSelectionFromTab(tabId) {
  if (tabId == null || !chrome?.scripting?.executeScript) {
    return Promise.resolve('');
  }
  return chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      try {
        const selection = window.getSelection ? window.getSelection() : null;
        if (selection && selection.rangeCount > 0) {
          const text = selection.toString();
          if (text && text.trim().length > 0) {
            return text;
          }
        }
        const active = document.activeElement;
        if (active && typeof active.value === 'string') {
          const { selectionStart, selectionEnd, value } = active;
          if (typeof selectionStart === 'number' && typeof selectionEnd === 'number' && selectionStart !== selectionEnd && value) {
            const start = Math.min(selectionStart, selectionEnd);
            const end = Math.max(selectionStart, selectionEnd);
            const slice = value.slice(start, end);
            if (slice && slice.trim().length > 0) {
              return slice;
            }
          }
        }
        return '';
      } catch (err) {
        return '';
      }
    }
  }).then((results) => {
    if (Array.isArray(results) && results.length > 0) {
      const value = results[0]?.result;
      return typeof value === 'string' ? value : '';
    }
    return '';
  }).catch((error) => {
    logResolver('fetch-selection-error', { tabId, error: error?.message || String(error) });
    return '';
  });
}

function isGenericQuickHostKeyword(hostname, keyword) {
  if (!hostname || !keyword) return false;
  const value = keyword.trim().toLowerCase();
  if (!value) return true;
  if (hostname.includes('chatgpt.com')) {
    if (value === 'chatgpt' || value === 'chatgpt.com' || value.startsWith('chatgpt.com/')) {
      return true;
    }
    if (value === 'www.chatgpt.com') {
      return true;
    }
  }
  if (hostname.includes('claude.ai')) {
    if (value === 'claude' || value === 'claude.ai' || value.startsWith('claude.ai/')) {
      return true;
    }
    if (value === 'www.claude.ai') {
      return true;
    }
  }
  return false;
}

function pickFirstMeaningfulText(candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      return { raw: candidate, trimmed };
    }
  }
  return { raw: '', trimmed: '' };
}

async function computeSearchTextForTab({
  tabId,
  tabUrl,
  tabTitle = '',
  selectionText = ''
}, options = {}) {
  const {
    forceFetchSelection = false,
    skipCurrentMenuFallback = false
  } = options || {};
  const candidates = [];
  logResolver('start', {
    tabId,
    tabUrl,
    tabTitle,
    selectionProvided: typeof selectionText === 'string' && selectionText.trim().length > 0
  });

  if (typeof selectionText === 'string') {
    const trimmedSelection = selectionText.trim();
    if (trimmedSelection.length > 0) {
      candidates.push(selectionText);
      logResolver('candidate', { source: 'selectionText', value: selectionText });
      if (tabId != null) {
        selectedTextByTab[tabId] = {
          text: selectionText,
          url: tabUrl || ''
        };
      }
    }
  }

  if (forceFetchSelection && tabId != null) {
    const fetchedDirect = await fetchSelectionFromTab(tabId);
    if (typeof fetchedDirect === 'string' && fetchedDirect.trim().length > 0) {
      candidates.push(fetchedDirect);
      logResolver('candidate', { source: 'scripting-precheck', value: fetchedDirect, tabId });
      selectedTextByTab[tabId] = {
        text: fetchedDirect,
        url: tabUrl || ''
      };
    }
  }

  if (tabId != null && typeof selectedTextByTab === 'object' && selectedTextByTab) {
    const stored = selectedTextByTab[tabId];
    if (
      stored &&
      typeof stored.text === 'string' &&
      stored.text.trim().length > 0
    ) {
      // BUGFIX: Relax URL matching - allow stored selection if it's recent (within 10 seconds)
      // This prevents user's actual selection from being overwritten by URL fallback
      // due to minor URL changes (hash, query params, etc.)
      const storedAge = stored.timestamp ? (Date.now() - stored.timestamp) : Infinity;
      const isFresh = storedAge < 10000; // 10 seconds
      const urlMatches = typeof stored.url === 'string' && stored.url === tabUrl;

      if (urlMatches || isFresh) {
        candidates.push(stored.text);
        logResolver('candidate', {
          source: 'stored-selection',
          value: stored.text,
          storedUrl: stored.url,
          tabUrl,
          urlMatches,
          isFresh,
          ageMs: storedAge
        });
      } else {
        logResolver('stored-selection-skipped', {
          reason: 'stale-or-url-mismatch',
          storedUrl: stored.url,
          tabUrl,
          ageMs: storedAge
        });
      }
    }
  }

  if (tabUrl) {
    try {
      const extracted = await extractSearchKeywords(tabUrl, { url: tabUrl, title: tabTitle });
      if (typeof extracted === 'string' && extracted.trim().length > 0) {
        candidates.push(extracted);
      logResolver('candidate', {
        source: 'url-extracted',
        value: extracted,
        tabUrl,
        tabTitle
      });
      if (tabId != null) {
        fallbackKeywordByTab[tabId] = {
          raw: extracted,
          normalized: normalizeSearchText(extracted),
          timestamp: Date.now(),
          url: tabUrl || ''
        };
      }
    }
  } catch (error) {
    console.warn('[触触搜][BG] extractSearchKeywords失败:', error);
  }
}


  if (!candidates.length && tabId != null) {
    const fetched = await fetchSelectionFromTab(tabId);
    if (typeof fetched === 'string' && fetched.trim().length > 0) {
      candidates.push(fetched);
      logResolver('candidate', { source: 'scripting-selection', value: fetched, tabId });
      selectedTextByTab[tabId] = {
        text: fetched,
        url: tabUrl || ''
      };
    }
  }

  // BUGFIX: 读 fallbackKeywordByTab[tabId] 作为补充候选源（C 档重构后追加）
  //
  // 之前的问题：sidepanel 在 chrome.tabs.onUpdated `url` 事件触发时就 refresh，
  // 但此时 chrome.tabs.query 拿到的 tab.title 还是空的（页面没加载完）。
  // 在线 extractSearchKeywords({title:''}) 失败 → 返回空。
  //
  // 与此同时，bg 的 prefetchMenuState 监听 `title` 变化时会把 extract 结果写到
  // fallbackKeywordByTab[tabId]，但 compute 之前不读它，下一次 refresh 仍然空跑。
  //
  // 修复：在所有在线 candidate 失败后，读 fallbackKeywordByTab[tabId]。URL 强匹配避免跨页污染。
  // 这是"per-tab、URL 一致"的缓存，跟 currentMenuState 那种"跨 tab 单例"完全不同，
  // 即使 skipCurrentMenuFallback:true 也应当读（前者是 tab 自己的历史，后者是污染源）。
  if (!candidates.length && tabId != null && typeof fallbackKeywordByTab === 'object' && fallbackKeywordByTab) {
    const stored = fallbackKeywordByTab[tabId];
    if (stored && typeof stored.raw === 'string' && stored.raw.trim().length > 0) {
      const urlMatches = typeof stored.url === 'string' && stored.url === tabUrl;
      if (urlMatches) {
        candidates.push(stored.raw);
        logResolver('candidate', {
          source: 'tab-fallback-cache',
          value: stored.raw,
          storedUrl: stored.url,
          tabUrl,
          ageMs: stored.timestamp ? (Date.now() - stored.timestamp) : null
        });
      } else {
        logResolver('tab-fallback-cache-skipped', {
          reason: 'url-mismatch',
          storedUrl: stored.url,
          tabUrl
        });
      }
    }
  }

  if (!skipCurrentMenuFallback && !candidates.length && typeof currentMenuState === 'object' && currentMenuState) {
    const preservedRaw = currentMenuState.raw;
    const preservedUrl = currentMenuState.url;
    const preservedTabId = currentMenuState.tabId;
    if (preservedRaw && preservedRaw.trim().length > 0) {
      const preserveByUrl = tabUrl ? shouldPreserveMenuStateForUrl(tabUrl) : false; // Changed from true to false
      const sameUrl = typeof preservedUrl === 'string' && preservedUrl && tabUrl === preservedUrl;
      const sameTab = typeof preservedTabId === 'number' && tabId != null && preservedTabId === tabId;
      let targetHostname = '';
      try {
        targetHostname = tabUrl ? new URL(tabUrl).hostname : '';
      } catch (_) {}
      // BUGFIX: Use AND logic instead of OR to prevent cross-tab contamination
      // Only preserve if BOTH URL and tabId match AND the URL allows preservation
      const allowPreserve = sameUrl && sameTab && preserveByUrl;
      if (allowPreserve && !isGenericQuickHostKeyword(targetHostname, preservedRaw)) {
        candidates.push(preservedRaw);
        logResolver('candidate', {
          source: 'current-menu-state',
          value: preservedRaw,
          tabUrl,
          preservedUrl,
          preservedTabId,
          reason: 'url-and-tab-match'
        });
      }
    }
  }

  const { raw, trimmed } = pickFirstMeaningfulText(candidates);
  const normalizedSource = trimmed || raw;
  const result = {
    raw,
    normalized: normalizeSearchText(normalizedSource)
  };
  logResolver('result', {
    candidatesCount: candidates.length,
    raw: result.raw,
    normalized: result.normalized,
    tabId,
    tabUrl,
    tabTitle
  });
  return result;
}

// ==================== 导出到全局 ====================

globalThis.computeSearchTextForTab = computeSearchTextForTab;
