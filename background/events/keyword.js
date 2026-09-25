/**
 * 关键字消息：popup / sidepanel 取词、content script 选区变化与右键预览。
 */

// Debounce variables for contextMenuPreview to prevent race conditions
// when user rapidly selects text (e.g., "题" → "显示" → "内容" → "英国殖民统治问题")
let contextPreviewTimeout = null;
let latestPreviewData = null;

// C 档重构入口：popup / sidepanel 通过 shared/keywordClient.js 发 'getKeyword'，
// intent 决定 background 的获取策略（policy 表见 background/KeywordService.js）。
// 同时仍保留 'getSearchText' 作为旧消息名兼容入口，下面那段。
function ccsHandleGetKeyword(request, sender, sendResponse) {
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

function ccsHandleGetSearchText(request, sender, sendResponse) {
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

// 处理popup的关键词提取请求
function ccsHandleExtractKeywords(request, sender, sendResponse) {
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

function ccsHandleContextMenuPreview(request, sender, sendResponse) {
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
    let previewTab = finalSender?.tab || null;
    if (finalTabId != null) {
      try {
        const freshTab = await chrome.tabs.get(finalTabId);
        if (freshTab) {
          previewTab = {
            ...(previewTab || {}),
            ...freshTab,
            url: freshTab.url || freshTab.pendingUrl || previewTab?.url || '',
            title: freshTab.title || previewTab?.title || ''
          };
          if (previewTab.title) {
            updateLatestTabTitle(finalTabId, previewTab.title);
          }
          logMenuEvent('context-preview-tab-hydrated', {
            tabId: finalTabId,
            hadSenderUrl: !!finalSender?.tab?.url,
            hadSenderTitle: !!finalSender?.tab?.title,
            freshUrl: previewTab.url || '',
            freshTitle: previewTab.title || ''
          });
        }
      } catch (error) {
        logMenuEvent('context-preview-tab-hydrate-failed', {
          tabId: finalTabId,
          error: error?.message || String(error)
        });
      }
    }
    const tabUrl = previewTab?.url || '';
    const tabTitle = previewTab?.title || getLatestTabPageTitle(finalTabId) || '';
    const tabStub = finalTabId != null ? { id: finalTabId, url: tabUrl, title: tabTitle } : null;

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

    if (!previewText && previewTab) {
      try {
        const fallback = await computeSearchTextForTab({
          tabId: finalTabId,
          tabUrl,
          // BUGFIX: Prefer freshly hydrated tab.title over sender.tab; MessageSender.tab
          // often has URL but no title before the tab has been activated again.
          tabTitle,
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
              url: tabUrl
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
function ccsHandleSelectionChanged(request, sender, sendResponse) {
  // 只处理 content script 发来的选区（带 sender.tab）
  if (!sender.tab) return;

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

ccsRegisterMessageHandlers({
  getKeyword: ccsHandleGetKeyword,
  getSearchText: ccsHandleGetSearchText,
  extractKeywords: ccsHandleExtractKeywords,
  contextMenuPreview: ccsHandleContextMenuPreview,
  selectionChanged: ccsHandleSelectionChanged
});
