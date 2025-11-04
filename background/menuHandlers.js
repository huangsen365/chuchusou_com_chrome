// Context menu interaction handlers are extracted into this module to keep
// background/events.js focused on runtime messages and tab updates.
// The functions referenced here (e.g., setMenuState, computeSearchTextForTab)
// are defined globally via other background scripts loaded through importScripts.

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await loadMenuToggleConfig();
  await syncSelectionFromTab(tab, 'context-click', { updateMenu: false });
  const selectionText = typeof info.selectionText === 'string' ? info.selectionText.trim() : '';
  if (selectionText) {
    setMenuState(selectionText, normalizeSearchText(selectionText), {
      tabId: tab?.id ?? null,
      url: tab?.url || ''
    });
  }
  logMenuEvent('context-click', {
    menuItemId: info.menuItemId,
    selectionText: info.selectionText,
    normalizedSelection: selectionText ? normalizeSearchText(selectionText) : '',
    tabId: tab?.id ?? null,
    tabUrl: tab?.url || '',
    tabTitle: tab?.title || ''
  });
  const { raw: rawText, normalized: normalizedText } = await computeSearchTextForTab({
    tabId: tab?.id,
    tabUrl: tab?.url,
    tabTitle: tab?.title || '',
    selectionText: info.selectionText || ''
  }, {
    forceFetchSelection: true,
    skipCurrentMenuFallback: true
  });
  logMenuEvent('context-click-resolved', {
    tabId: tab?.id ?? null,
    menuItemId: info.menuItemId,
    rawText,
    normalizedText,
    tabUrl: tab?.url || '',
    tabTitle: tab?.title || ''
  });
  if (rawText || normalizedText) {
    setMenuState(rawText, normalizedText, {
      tabId: tab?.id ?? null,
      url: tab?.url || ''
    });
  } else {
    const stored = tab?.id != null ? selectedTextByTab[tab.id] : null;
    if (stored && typeof stored.text === 'string' && stored.text.trim().length > 0) {
      setMenuState(stored.text, normalizeSearchText(stored.text), {
        tabId: tab?.id ?? null,
        url: tab?.url || stored?.url || ''
      });
    }
  }

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

    case 'ccs-tongyi':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://www.tongyi.com/?q=${encodeURIComponent(normalizedText)}`
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
        setMenuState(selectionText, normalizeSearchText(selectionText), {
          tabId: tab?.id ?? null,
          url: tab?.url || ''
        });
      }
      const result = await computeSearchTextForTab({
        tabId: tab?.id,
        tabUrl: tab?.url,
        tabTitle: tab?.title || '',
        selectionText: info.selectionText || ''
      }, {
        forceFetchSelection: true,
        skipCurrentMenuFallback: true
      });
      applyMenuTitle(result.normalized, result.raw, {
        tabId: tab?.id ?? null,
        url: tab?.url || ''
      });
    } catch (error) {
      console.warn('[触触搜][BG] onShown更新菜单失败:', error);
    }
  });
} else if (!onShownWarningEmitted) {
  onShownWarningEmitted = true;
  logMenuEvent('context-onshown-unavailable', {
    message: 'chrome.contextMenus.onShown unavailable; relying on manual refresh'
  });
}
