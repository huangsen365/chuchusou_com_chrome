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
  // allFrames:true：扫所有 frame 包括 iframe 编辑器（TinyMCE / CKEditor / 公众号
  // 后台等都把编辑区放进 iframe）。返回第一个有非空选区的 frame。
  return chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
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
        // contenteditable 兜底（富文本+图片场景）
        if (active && active.isContentEditable && typeof active.textContent === 'string') {
          const sel = window.getSelection && window.getSelection();
          // 仅当有选区但 toString 空时才用 textContent（避免没选区也返回整段）
          if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
            const fullText = active.textContent;
            if (fullText && fullText.trim().length > 0) {
              return fullText;
            }
          }
        }
        return '';
      } catch (err) {
        return '';
      }
    }
  }).then((results) => {
    if (Array.isArray(results)) {
      for (const entry of results) {
        const value = entry?.result;
        if (typeof value === 'string' && value.trim().length > 0) {
          return value;
        }
      }
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
    skipCurrentMenuFallback = false,
    allowFallbackSelectionFetch = true
  } = options || {};
  const candidates = [];
  logResolver('start', {
    tabId, tabUrl, tabTitle,
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
          url: tabUrl || '',
          timestamp: Date.now()
        };
      }
    }
  }

  // 选区候选源优先级：memory (selectedTextByTab) > scripting probe
  //
  // memory 是 tabId-keyed 的「当前 tab 的选区状态」，由以下事件维护：
  // - content.js selectionChanged（用户选/清）→ 加/删
  // - tabs.onUpdated('loading')→ 删（真实页面跳转）
  // - KeywordService.clearTab（tab 关闭）→ 删
  // 所以 memory 非空 = 用户真的有选区，无需再做 URL/freshness 二次校验
  // （之前 URL 严格匹配挡住了 hash drift / 锚链接 / SPA 子状态变更等正常场景，
  //  10s 新鲜窗口又对"用户慢悠悠开 popup"的真实使用太严格）
  let selectionFromMemory = false;
  if (tabId != null && typeof selectedTextByTab === 'object' && selectedTextByTab) {
    const stored = selectedTextByTab[tabId];
    if (stored && typeof stored.text === 'string' && stored.text.trim().length > 0) {
      candidates.push(stored.text);
      selectionFromMemory = true;
      const storedAge = stored.timestamp ? (Date.now() - stored.timestamp) : null;
      logResolver('candidate', {
        source: 'stored-selection', value: stored.text,
        storedUrl: stored.url, tabUrl, ageMs: storedAge
      });
    }
  }

  if (!selectionFromMemory && forceFetchSelection && tabId != null) {
    const fetchedDirect = await fetchSelectionFromTab(tabId);
    if (typeof fetchedDirect === 'string' && fetchedDirect.trim().length > 0) {
      candidates.push(fetchedDirect);
      logResolver('candidate', { source: 'scripting-precheck', value: fetchedDirect, tabId });
      selectedTextByTab[tabId] = {
        text: fetchedDirect,
        url: tabUrl || '',
        timestamp: Date.now()
      };
    }
  }

  if (tabUrl) {
    try {
      const extracted = await extractSearchKeywords(tabUrl, { url: tabUrl, title: tabTitle });
      if (typeof extracted === 'string' && extracted.trim().length > 0) {
        candidates.push(extracted);
        logResolver('candidate', {
          source: 'url-extracted', value: extracted, tabUrl, tabTitle
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

  if (!forceFetchSelection && allowFallbackSelectionFetch && !candidates.length && tabId != null) {
    const fetched = await fetchSelectionFromTab(tabId);
    if (typeof fetched === 'string' && fetched.trim().length > 0) {
      candidates.push(fetched);
      logResolver('candidate', { source: 'scripting-selection', value: fetched, tabId });
      selectedTextByTab[tabId] = {
        text: fetched,
        url: tabUrl || '',
        timestamp: Date.now()
      };
    }
  }

  if (!candidates.length && tabId != null && typeof fallbackKeywordByTab === 'object' && fallbackKeywordByTab) {
    const stored = fallbackKeywordByTab[tabId];
    if (stored && typeof stored.raw === 'string' && stored.raw.trim().length > 0) {
      const urlMatches = typeof stored.url === 'string' && stored.url === tabUrl;
      if (urlMatches) {
        candidates.push(stored.raw);
        logResolver('candidate', {
          source: 'tab-fallback-cache', value: stored.raw,
          storedUrl: stored.url, tabUrl,
          ageMs: stored.timestamp ? (Date.now() - stored.timestamp) : null
        });
      } else {
        logResolver('tab-fallback-cache-skipped', {
          reason: 'url-mismatch', storedUrl: stored.url, tabUrl
        });
      }
    }
  }

  if (!skipCurrentMenuFallback && !candidates.length && typeof currentMenuState === 'object' && currentMenuState) {
    const preservedRaw = currentMenuState.raw;
    const preservedUrl = currentMenuState.url;
    const preservedTabId = currentMenuState.tabId;
    if (preservedRaw && preservedRaw.trim().length > 0) {
      const preserveByUrl = tabUrl ? shouldPreserveMenuStateForUrl(tabUrl) : false;
      const sameUrl = typeof preservedUrl === 'string' && preservedUrl && tabUrl === preservedUrl;
      const sameTab = typeof preservedTabId === 'number' && tabId != null && preservedTabId === tabId;
      let targetHostname = '';
      try { targetHostname = tabUrl ? new URL(tabUrl).hostname : ''; } catch (_) {}
      const allowPreserve = sameUrl && sameTab && preserveByUrl;
      if (allowPreserve && !isGenericQuickHostKeyword(targetHostname, preservedRaw)) {
        candidates.push(preservedRaw);
        logResolver('candidate', {
          source: 'current-menu-state', value: preservedRaw,
          tabUrl, preservedUrl, preservedTabId, reason: 'url-and-tab-match'
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
    tabId, tabUrl, tabTitle
  });
  return result;
}

// ==================== 导出到全局 ====================

globalThis.computeSearchTextForTab = computeSearchTextForTab;
