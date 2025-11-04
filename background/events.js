chrome.runtime.onInstalled.addListener(createContextMenus);
if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(createContextMenus);
}

// 预加载调试开关与图标支持状态
ensureMenuIconSupportLoaded();

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
    const { tabId, url, title, selectionText } = request;
    computeSearchTextForTab({
      tabId,
      tabUrl: url,
      tabTitle: title,
      selectionText
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

      if (!previewText && tabId != null) {
        const cached = selectedTextByTab[tabId];
        const cachedText = typeof cached === 'string' ? cached : cached?.text;
        if (typeof cachedText === 'string' && cachedText.trim().length > 0) {
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

      if (previewText) {
        setMenuState(previewText, normalizedPreview || previewText);
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
      setMenuState(rawText, normalizedSelection || rawText);
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
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    delete selectedTextByTab[tabId];
  }
  if ((changeInfo.status === 'complete' || changeInfo.status === 'loading') && tab.url) {
    const stored = selectedTextByTab[tabId];
    const hasStoredSelection =
      stored && typeof stored.text === 'string' && stored.text.trim().length > 0;
    if (!hasStoredSelection && shouldPreserveMenuStateForTab(tab)) {
      return;
    }
    updateContextMenuForTab(tab);
  }
});

// 监听标签页激活，动态更新菜单标题
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  const stored = selectedTextByTab[activeInfo.tabId];
  const hasStoredSelection =
    stored && typeof stored.text === 'string' && stored.text.trim().length > 0;
  if (!hasStoredSelection && shouldPreserveMenuStateForTab(tab)) {
    return;
  }
  await refreshMenuTitle(tab);
});

// 根据URL更新菜单标题
async function updateContextMenuForTab(tab) {
  // 注意：这里只是预显示，实际使用时选中文本优先级更高
  const keywords = await extractSearchKeywords(tab.url, tab);
  const normalized = keywords ? normalizeSearchText(keywords) : '';
  applyMenuTitle(normalized, keywords || '');
}

// 处理右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await loadMenuToggleConfig();
  const selectionText = typeof info.selectionText === 'string' ? info.selectionText.trim() : '';
  if (selectionText) {
    setMenuState(selectionText, normalizeSearchText(selectionText));
  }
  logMenuEvent('context-click', {
    menuItemId: info.menuItemId,
    selectionText: info.selectionText,
    normalizedSelection: selectionText ? normalizeSearchText(selectionText) : ''
  });
  const { raw: rawText, normalized: normalizedText } = await computeSearchTextForTab({
    tabId: tab?.id,
    tabUrl: tab?.url,
    tabTitle: tab?.title || '',
    selectionText: info.selectionText || ''
  });
  setMenuState(rawText, normalizedText);

  const isTopQuestionsOpenAll = info.menuItemId === 'ccs-top100-open-all';
  const isTopQuestionsMenu = info.menuItemId && info.menuItemId.startsWith('ccs-top100-');
  const isTopQuestionsEngine = isTopQuestionsMenu && !isTopQuestionsOpenAll;
  const isFastAnswersMenu = info.menuItemId && info.menuItemId.startsWith('ccs-fastqa-');
  const isFastAnswersOpenAll = info.menuItemId === 'ccs-fastqa-open-all';

  if (
    !normalizedText &&
    info.menuItemId !== 'ccs-show-popover' &&
    !topQuestionsMenuMap.has(info.menuItemId) &&
    !isTopQuestionsOpenAll &&
    !fastAnswersMenuMap.has(info.menuItemId) &&
    !isFastAnswersOpenAll &&
    !optimizedPromptMenuMap.has(info.menuItemId) &&
    !(info.menuItemId && info.menuItemId.startsWith('ccs-optimize-'))
  ) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'showToast',
      message: '没有选中文本或无法提取关键词'
    }).catch(() => {});
    return;
  }

  if (isTopQuestionsOpenAll || isTopQuestionsEngine) {
    const effectiveInput = rawText || normalizedText;
    if (!effectiveInput) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showToast',
        message: '没有选中文本，无法生成问题列表'
      }).catch(() => {});
      return;
    }
    loadTopQuestionsConfig().then((config) => {
      if (!config) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showToast',
          message: '触触搜百问模板加载失败'
        }).catch(() => {});
        return;
      }
      if (!topQuestionsTemplate) {
        topQuestionsTemplate = Array.isArray(config.templateLines)
          ? config.templateLines.join('\\n')
          : (config.template || '');
      }
      const prompt = buildTopQuestionsPrompt(effectiveInput);
      if (!prompt) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showToast',
          message: '触触搜百问模板无效'
        }).catch(() => {});
        return;
      }
      const encodedPrompt = encodeURIComponent(prompt);
      if (isTopQuestionsOpenAll) {
        const engines = Array.isArray(config.engines) ? config.engines : [];
        let openedCount = 0;
        engines.forEach((engine) => {
          if (!engine || typeof engine.urlPattern !== 'string' || !engine.urlPattern) {
            return;
          }
          const menuId = `ccs-top100-${engine.id}`;
          if (!isMenuEnabled(menuId)) return;
          const targetUrl = engine.urlPattern.split('${PROMPT}').join(encodedPrompt);
          if (targetUrl) {
            chrome.tabs.create({ url: targetUrl, active: openedCount === 0 });
            openedCount += 1;
          }
        });
      } else {
        const engineId = info.menuItemId.replace('ccs-top100-', '');
        let menuTarget = topQuestionsMenuMap.get(info.menuItemId);
        if (!menuTarget) {
          const engine = (config.engines || []).find((item) => item.id === engineId);
          if (engine) {
            menuTarget = { urlPattern: engine.urlPattern || '' };
            topQuestionsMenuMap.set(info.menuItemId, menuTarget);
          }
        }
        if (!menuTarget || !menuTarget.urlPattern) {
          chrome.tabs.sendMessage(tab.id, {
            action: 'showToast',
            message: '未找到对应的引擎配置'
          }).catch(() => {});
          return;
        }
        const url = menuTarget.urlPattern.split('${PROMPT}').join(encodedPrompt);
        chrome.tabs.create({ url });
      }
    }).catch(() => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showToast',
        message: '触触搜百问模板加载失败'
      }).catch(() => {});
    });
    return;
  }

  if (isFastAnswersOpenAll || isFastAnswersMenu) {
    logMenuEvent('fastqa-click', { menuItemId: info.menuItemId, isOpenAll: isFastAnswersOpenAll });
    const effectiveInput = rawText || normalizedText;
    if (!effectiveInput) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showToast',
        message: '没有选中文本，无法生成速答内容'
      }).catch(() => {});
      return;
    }
    loadFastAnswersConfig().then((config) => {
      if (!config) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showToast',
          message: '速答壹拾佰模板加载失败'
        }).catch(() => {});
        return;
      }
      if (!fastAnswersTemplate) {
        fastAnswersTemplate = Array.isArray(config.templateLines)
          ? config.templateLines.join('\\n')
          : (config.template || '');
      }
      const prompt = buildFastAnswersPrompt(effectiveInput);
      if (!prompt) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showToast',
          message: '速答壹拾佰模板无效'
        }).catch(() => {});
        return;
      }
      const encodedPrompt = encodeURIComponent(prompt);
      if (isFastAnswersOpenAll) {
        const engines = Array.isArray(config.engines) ? config.engines : [];
        let openedCount = 0;
        engines.forEach((engine) => {
          if (!engine || typeof engine.urlPattern !== 'string' || !engine.urlPattern) {
            return;
          }
          const menuId = `ccs-fastqa-${engine.id}`;
          if (!isMenuEnabled(menuId)) return;
          const targetUrl = engine.urlPattern.split('${PROMPT}').join(encodedPrompt);
          if (targetUrl) {
            chrome.tabs.create({ url: targetUrl, active: openedCount === 0 });
            openedCount += 1;
            logMenuEvent('fastqa-open-url', { targetUrl, menuId, index: openedCount });
          }
        });
      } else {
        const quickItem = FAST_QA_QUICK_ITEMS.find((item) => item.id === info.menuItemId);
        let engineId = quickItem ? quickItem.engineId : info.menuItemId.replace('ccs-fastqa-', '').replace(/-(shortcut|quick)$/, '');
        let menuTarget = fastAnswersMenuMap.get(info.menuItemId);
        if (!menuTarget) {
          const engine = (config.engines || []).find((item) => item.id === engineId);
          if (engine) {
            menuTarget = { urlPattern: engine.urlPattern || '' };
            fastAnswersMenuMap.set(info.menuItemId, menuTarget);
          }
        }
        if (!menuTarget || !menuTarget.urlPattern) {
          chrome.tabs.sendMessage(tab.id, {
            action: 'showToast',
            message: '未找到对应的速答配置'
          }).catch(() => {});
          return;
        }
        const url = menuTarget.urlPattern.split('${PROMPT}').join(encodedPrompt);
        logMenuEvent('fastqa-open-url', { targetUrl: url, menuItemId: info.menuItemId, engineId });
        chrome.tabs.create({ url });
      }
    }).catch(() => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showToast',
        message: '速答壹拾佰模板加载失败'
      }).catch(() => {});
    });
    return;
  }

  if (optimizedPromptMenuMap.has(info.menuItemId) || (info.menuItemId && info.menuItemId.startsWith('ccs-optimize-'))) {
    if (!normalizedText) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showToast',
        message: '没有选中文本，无法生成优化后的提示词'
      }).catch(() => {});
      return;
    }

    loadOptimizedPromptConfig().then((fullConfig) => {
      if (!fullConfig) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showToast',
          message: '提示词模板加载失败'
        }).catch(() => {});
        return;
      }
      if (!optimizedPromptMenuMap.has(info.menuItemId)) {
        populateOptimizedMenuMap(fullConfig);
      }
      const menuTarget = optimizedPromptMenuMap.get(info.menuItemId);
      if (!menuTarget || !menuTarget.urlPattern) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showToast',
          message: '未找到对应的提示词配置'
        }).catch(() => {});
        return;
      }
      const prompt = buildOptimizedPrompt(menuTarget.purpose, rawText);
      if (!prompt) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showToast',
          message: '提示词模板加载失败'
        }).catch(() => {});
        return;
      }
      const encodedPrompt = encodeURIComponent(prompt);
      const url = menuTarget.urlPattern.split('${PROMPT}').join(encodedPrompt);
      chrome.tabs.create({ url });
    }).catch(() => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showToast',
        message: '提示词模板加载失败'
      }).catch(() => {});
    });
    return;
  }
  
  switch (info.menuItemId) {
    case 'ccs-baidu':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${encodeURIComponent(normalizedText)}`
        });
      }
      break;
      
    case 'ccs-google':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://www.google.com/search?q=${encodeURIComponent(normalizedText)}`
        });
      }
      break;

    case 'ccs-yiyan':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://yiyan.baidu.com/?q=${encodeURIComponent(normalizedText)}`
        });
      }
      break;

    case 'ccs-chatgpt':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://chatgpt.com/?model=gpt-5&q=${encodeURIComponent(normalizedText)}`
        });
      }
      break;

    case 'ccs-claude':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://claude.ai/new?q=${encodeURIComponent(normalizedText)}`
        });
      }
      break;
      
    case 'ccs-zhihu':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://www.zhihu.com/search?q=${encodeURIComponent(normalizedText)}`
        });
      }
      break;
      
    case 'ccs-weixin':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://search.weixin.qq.com/cgi-bin/newsearchweb/userclientjump?path=page/search/christmas_jump&query=${encodeURIComponent(normalizedText)}`
        });
      }
      break;
      
    case 'ccs-taobao':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://s.taobao.com/search?q=${encodeURIComponent(normalizedText)}`
        });
      }
      break;
      
    case 'ccs-jd':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://search.jd.com/Search?keyword=${encodeURIComponent(normalizedText)}`
        });
      }
      break;
      
    case 'ccs-sov2ex':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://www.sov2ex.com/?q=${encodeURIComponent(normalizedText)}`
        });
      }
      break;

    case 'ccs-google-translate':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://translate.google.com/?text=${encodeURIComponent(normalizedText)}`
        });
      }
      break;
      
    case 'ccs-chuchusou':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://chuchusou.com/?q=${encodeURIComponent(normalizedText)}`
        });
      }
      break;
      
    case 'ccs-copy':
      if (rawText) {
        const ok = await copyTextInTab(tab, rawText);
        if (!ok) {
          chrome.tabs.sendMessage(tab.id, {
            action: 'showToast',
            message: '复制失败，请检查页面权限'
          }).catch(() => {});
        }
      }
      break;
      
    case 'ccs-base64':
      if (rawText) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'processCommand',
          command: 'base64',
          text: rawText
        }).catch(() => {});
      }
      break;
      
    case 'ccs-md5':
      if (rawText) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'processCommand',
          command: 'md5',
          text: rawText
        }).catch(() => {});
      }
      break;
      
    case 'ccs-url-encode':
      if (rawText) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'processCommand',
          command: 'url-encode',
          text: rawText
        }).catch(() => {});
      }
      break;
      
    case 'ccs-upper':
      if (rawText) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'processCommand',
          command: 'upper',
          text: rawText
        }).catch(() => {});
      }
      break;
      
    case 'ccs-lower':
      if (rawText) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'processCommand',
          command: 'lower',
          text: rawText
        }).catch(() => {});
      }
      break;
      
    case 'ccs-show-popover':
      // 发送消息给content script显示popover
      chrome.tabs.sendMessage(tab.id, {
        action: 'showPopover',
        text: rawText || ''
      }).catch(() => {});
      break;
  }
});

let onShownWarningEmitted = false;

if (chrome.contextMenus.onShown && typeof chrome.contextMenus.onShown.addListener === 'function') {
  chrome.contextMenus.onShown.addListener(async (info, tab) => {
    try {
      const selectionText = typeof info.selectionText === 'string' ? info.selectionText.trim() : '';
      if (selectionText) {
        setMenuState(selectionText, normalizeSearchText(selectionText));
      }
      const result = await computeSearchTextForTab({
        tabId: tab?.id,
        tabUrl: tab?.url,
        tabTitle: tab?.title || '',
        selectionText: info.selectionText || ''
      });
      applyMenuTitle(result.normalized, result.raw);
    } catch (error) {
      console.warn('[触触搜][BG] onShown更新菜单失败:', error);
    }
  });
} else if (!onShownWarningEmitted) {
  onShownWarningEmitted = true;
  console.warn('[触触搜][BG] chrome.contextMenus.onShown 不可用，跳过菜单 onShown 更新');
}
