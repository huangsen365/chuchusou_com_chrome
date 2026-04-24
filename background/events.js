chrome.runtime.onInstalled.addListener(createContextMenus);
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
  // 处理popup的菜单调试信息导出请求
  if (request.action === 'getMenuDebugInfo') {
    const tabId = request.tabId;
    getMenuDebugInfo(tabId)
      .then(data => {
        sendResponse({ success: true, data });
      })
      .catch(error => {
        console.error('[触触搜][BG] 获取菜单调试信息失败:', error);
        sendResponse({ success: false, error: error?.message || String(error) });
      });
    return true; // 异步响应
  }

  // 处理popup获取菜单结构请求（与右键菜单保持一致）
  if (request.action === 'getMenuStructure') {
    getPopupMenuStructure()
      .then(structure => {
        sendResponse({ success: true, structure });
      })
      .catch(error => {
        console.error('[触触搜][BG] 获取菜单结构失败:', error);
        sendResponse({ success: false, error: error?.message || String(error) });
      });
    return true; // 异步响应
  }

  // 处理popup菜单项点击（复用右键菜单逻辑）
  if (request.action === 'executeMenuAction') {
    const { menuItemId, menuType, keyword, urlPattern, actionType, engineId } = request;

    (async () => {
      try {
        // 获取当前标签页
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tab?.id;

        // 没有关键词时的处理（某些操作不需要关键词）
        if (!keyword && menuType !== 'action' && actionType !== 'show-popover') {
          sendResponse({ success: false, error: 'no-keyword' });
          return;
        }

        const encodedKeyword = keyword ? encodeURIComponent(keyword) : '';

        // 根据menuType处理不同类型的菜单
        switch (menuType) {
          case 'search':
          case 'ai-chat':
          case 'ai-search':
          case 'ecommerce':
          case 'translate':
          case 'portal':
            if (urlPattern && keyword) {
              const url = urlPattern.replace('${KEYWORD}', encodedKeyword);
              chrome.tabs.create({ url });
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
                  chrome.tabs.sendMessage(tabId, {
                    action: 'showToast',
                    message: '复制失败，请检查页面权限'
                  }).catch(() => {});
                }
              } else if (command) {
                chrome.tabs.sendMessage(tabId, {
                  action: 'processCommand',
                  command: command,
                  text: keyword
                }).catch(() => {});
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

          case 'action':
            if (actionType === 'show-popover' && tabId) {
              chrome.tabs.sendMessage(tabId, {
                action: 'showPopover',
                text: keyword || ''
              }).catch(() => {});
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
              if (typeof tryOpenMenuUrl === 'function' && tryOpenMenuUrl(menuItemId, keyword)) {
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
                case 'ccs-google-ai':
                  chrome.tabs.create({ url: `https://www.google.com/search?udm=50&q=${encodedKeyword}` });
                  handled = true;
                  break;
                case 'ccs-chatgpt':
                  chrome.tabs.create({ url: `https://chatgpt.com/?q=${encodedKeyword}` });
                  handled = true;
                  break;
                case 'ccs-claude':
                  chrome.tabs.create({ url: `https://claude.ai/new?q=${encodedKeyword}` });
                  handled = true;
                  break;
                case 'ccs-grok':
                  chrome.tabs.create({ url: `https://grok.com/?q=${encodedKeyword}` });
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
            skipCurrentMenuFallback: false
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
            url: tabUrl
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

      // Only update state for active tab
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

      const preserve = shouldPreserveMenuStateForTab(sender.tab);
      if (!hasContent || !preserve) {
        await refreshMenuTitle(sender.tab, rawText);
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

    // BUGFIX: Delayed title refresh to catch late-updating titles
    // Some pages (especially SPAs) update their title after 'complete' status
    setTimeout(async () => {
      try {
        const freshTab = await chrome.tabs.get(tabId);
        if (freshTab && freshTab.url === candidateUrl) {
          // Update title cache if title has changed
          if (freshTab.title && freshTab.title !== (tab.title || '')) {
            updateLatestTabTitle(tabId, freshTab.title);
            logMenuEvent('delayed-title-update', {
              tabId,
              oldTitle: tab.title,
              newTitle: freshTab.title,
              url: candidateUrl
            });
          }
          // Refresh keywords with the latest title
          await prefetchMenuState(freshTab, 'delayed-title-refresh');
        }
      } catch (err) {
        // Tab may have been closed, ignore
        logMenuEvent('delayed-title-refresh-failed', {
          tabId,
          error: err?.message
        });
      }
    }, 300); // 300ms delay to catch late title updates
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
  if (selectedTextByTab[tabId]) {
    delete selectedTextByTab[tabId];
  }
  if (fallbackKeywordByTab[tabId]) {
    delete fallbackKeywordByTab[tabId];
  }
  if (latestTitleByTab[tabId]) {
    delete latestTitleByTab[tabId];
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
                      skipCurrentMenuFallback: false
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
