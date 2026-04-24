// Context menu interaction handlers are extracted into this module to keep
// background/events.js focused on runtime messages and tab updates.
// The functions referenced here (e.g., setMenuState, computeSearchTextForTab)
// are defined globally via other background scripts loaded through importScripts.

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await loadMenuToggleConfig();
  await syncSelectionFromTab(tab, 'context-click', { updateMenu: false });
  const selectionText = typeof info.selectionText === 'string' ? info.selectionText.trim() : '';
  if (!selectionText && tab?.id != null) {
    delete selectedTextByTab[tab.id];
  }
  const fallbackEntry = tab?.id != null ? fallbackKeywordByTab[tab.id] : null;
  const fallbackFresh = !!fallbackEntry && (Date.now() - fallbackEntry.timestamp < 5000);
  const shouldForceFallback = fallbackFresh && (!selectionText || selectionText.length <= Math.max(2, Math.min(6, fallbackEntry.normalized?.length || fallbackEntry.raw?.length || 0) / 4));
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
    // BUGFIX: Prefer fresh tab.title over cached value to avoid cross-tab contamination
    tabTitle: tab?.title || (tab?.id != null ? getLatestTabPageTitle(tab.id) : '') || '',
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
  snapshotMenuTitles('context-click-resolved');
  let effectiveRaw = rawText;
  let effectiveNormalized = normalizedText;

  if (shouldForceFallback && fallbackEntry) {
    effectiveRaw = fallbackEntry.raw;
    effectiveNormalized = fallbackEntry.normalized;
    logMenuEvent('context-click-forced-fallback', {
      tabId: tab?.id ?? null,
      menuItemId: info.menuItemId,
      fallbackRaw: fallbackEntry.raw,
      fallbackNormalized: fallbackEntry.normalized
    });
  }

  if (!effectiveRaw && !effectiveNormalized) {
    try {
      const fallbackResult = await computeSearchTextForTab({
        tabId: tab?.id,
        tabUrl: tab?.url,
        // BUGFIX: Prefer fresh tab.title over cached value to avoid cross-tab contamination
        tabTitle: tab?.title || (tab?.id != null ? getLatestTabPageTitle(tab.id) : '') || '',
        selectionText: ''
      }, {
        forceFetchSelection: false,
        skipCurrentMenuFallback: false
      });
      if (fallbackResult?.raw || fallbackResult?.normalized) {
        effectiveRaw = fallbackResult.raw;
        effectiveNormalized = fallbackResult.normalized;
        if (tab?.id != null && fallbackResult?.raw) {
          selectedTextByTab[tab.id] = {
            text: fallbackResult.raw,
            url: tab?.url || ''
          };
        }
        logMenuEvent('context-click-fallback', {
          tabId: tab?.id ?? null,
          menuItemId: info.menuItemId,
          raw: fallbackResult.raw,
          normalized: fallbackResult.normalized
        });
      }
    } catch (error) {
      logMenuEvent('context-click-fallback-error', {
        tabId: tab?.id ?? null,
        error: error?.message || String(error)
      });
    }
  }

  if (effectiveRaw || effectiveNormalized) {
    setMenuState(effectiveRaw, effectiveNormalized, {
      tabId: tab?.id ?? null,
      url: tab?.url || ''
    });
    if (tab?.id != null) {
      delete fallbackKeywordByTab[tab.id];
    }
  } else {
    const stored = tab?.id != null ? selectedTextByTab[tab.id] : null;
    if (stored && typeof stored.text === 'string' && stored.text.trim().length > 0) {
      setMenuState(stored.text, normalizeSearchText(stored.text), {
        tabId: tab?.id ?? null,
        url: tab?.url || stored?.url || ''
      });
    }
  }

  const finalRaw = effectiveRaw;
  const finalNormalized = effectiveNormalized;

  if (tab?.id != null) {
    const entry = latestTitleByTab[tab.id];
    const titleForCompare = (entry?.keyword || entry?.title || tab?.title || '').trim();
    const normalizedTitle = titleForCompare
      ? (entry?.keywordNormalized || normalizeSearchText(titleForCompare))
      : '';
    const keywordRawForCompare = (finalRaw || finalNormalized || '').trim();
    const normalizedKeyword = keywordRawForCompare ? normalizeSearchText(keywordRawForCompare) : '';
    const matched = normalizedTitle && normalizedKeyword && normalizedTitle === normalizedKeyword;
    const menuBase = finalRaw || finalNormalized || '';
    const menuDisplay = menuBase
      ? formatMenuTitle(finalNormalized || finalRaw) || menuBase
      : currentMenuState?.display || '';
    const menuRaw = menuBase || currentMenuState?.raw || '';
    logMenuEvent('context-click-title-check', {
      tabId: tab.id,
      title: titleForCompare,
      keyword: keywordRawForCompare,
      normalizedTitle,
      normalizedKeyword,
      menuDisplay,
      menuRaw,
      match: !!matched,
      forcedFallback: shouldForceFallback
    });
  }

  snapshotMenuTitles('context-click-final');
  const isTopQuestionsOpenAll = info.menuItemId === 'ccs-top100-open-all';
  const isTopQuestionsMenu = info.menuItemId && info.menuItemId.startsWith('ccs-top100-');
  const isTopQuestionsEngine = isTopQuestionsMenu && !isTopQuestionsOpenAll;
  const isFastAnswersMenu = info.menuItemId && info.menuItemId.startsWith('ccs-fastqa-');
  const isFastAnswersOpenAll = info.menuItemId === 'ccs-fastqa-open-all';

  if (
    !finalNormalized && !finalRaw &&
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

  // === SSoT: AI 任务统一快速通道 ===
  // 速答 / 百问 / 优化 三类任务全部走 runAITaskByMenuId。
  // 未命中（或执行失败）回落到下方的 top100/fastqa/optimize 逻辑块作为安全网。
  if (typeof runAITaskByMenuId === 'function' && info.menuItemId) {
    const rawKeyword = finalRaw || finalNormalized;
    if (rawKeyword) {
      try {
        const r = await runAITaskByMenuId(info.menuItemId, rawKeyword, { tabId: tab?.id });
        if (r.matched && r.success) {
          return; // 已由 AITaskHandler 打开
        }
      } catch (err) {
        BG_DBG('[menuHandlers] runAITaskByMenuId error', err?.message);
        // 继续走 fallback
      }
    }
  }

  if (isTopQuestionsOpenAll || isTopQuestionsEngine) {
    let effectiveInput = finalRaw || finalNormalized;
    if (!effectiveInput) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showToast',
        message: '没有选中文本，无法生成问题列表'
      }).catch(() => {});
      return;
    }
    // 字数保护：按目标引擎截断 + toast 提示
    if (typeof applyTextLimit === 'function') {
      const limited = applyTextLimit(info.menuItemId, effectiveInput, { tabId: tab?.id });
      effectiveInput = limited.text;
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
    let effectiveInput = finalRaw || finalNormalized;
    if (!effectiveInput) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showToast',
        message: '没有选中文本，无法生成速答内容'
      }).catch(() => {});
      return;
    }
    // 字数保护：按目标引擎截断 + toast 提示
    if (typeof applyTextLimit === 'function') {
      const limited = applyTextLimit(info.menuItemId, effectiveInput, { tabId: tab?.id });
      effectiveInput = limited.text;
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
    if (!finalRaw && !finalNormalized) {
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
      const baseInput = finalRaw || finalNormalized || '';
      // 字数保护：按目标引擎截断 + toast 提示
      const effectiveInput = (typeof applyTextLimit === 'function')
        ? applyTextLimit(info.menuItemId, baseInput, { tabId: tab?.id }).text
        : baseInput;
      const prompt = buildOptimizedPrompt(menuTarget.purpose, effectiveInput);
      if (!prompt) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showToast',
          message: '提示词模板加载失败'
        }).catch(() => {});
        return;
      }
      const encodedPrompt = encodeURIComponent(prompt);
      let url = menuTarget.urlPattern.split('${PROMPT}').join(encodedPrompt);
      if (typeof enforceFinalUrlCap === 'function') url = enforceFinalUrlCap(url);
      chrome.tabs.create({ url });
    }).catch(() => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showToast',
        message: '提示词模板加载失败'
      }).catch(() => {});
    });
    return;
  }
  
  // === SSoT 快速通道 ===
  // URL 类型菜单优先走 URLBuilder（从 config 自动装载），命中则直接返回。
  // 未命中时继续走下方 switch-case 作为安全网（保留历史行为）。
  if (finalNormalized && typeof tryOpenMenuUrl === 'function') {
    if (tryOpenMenuUrl(info.menuItemId, finalNormalized, { tabId: tab?.id })) {
      return;
    }
  }

  switch (info.menuItemId) {
    case 'ccs-baidu':
      if (finalNormalized) {
        chrome.tabs.create({
          url: `https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${encodeURIComponent(finalNormalized)}`
        });
      }
      break;
      
    case 'ccs-google':
      if (finalNormalized) {
        chrome.tabs.create({
          url: `https://www.google.com/search?q=${encodeURIComponent(finalNormalized)}`
        });
      }
      break;

    case 'ccs-google-ai-chat':
      if (finalNormalized) {
        chrome.tabs.create({
          url: `https://www.google.com/search?udm=50&ie=UTF-8&oe=UTF-8&q=${encodeURIComponent(finalNormalized)}`
        });
      }
      break;

    case 'ccs-yiyan':
      if (finalNormalized) {
        chrome.tabs.create({
          url: `https://yiyan.baidu.com/?q=${encodeURIComponent(finalNormalized)}`
        });
      }
      break;

    case 'ccs-chatgpt':
      if (finalNormalized) {
        chrome.tabs.create({
          url: `https://chatgpt.com/?q=${encodeURIComponent(finalNormalized)}`
        });
      }
      break;

    case 'ccs-claude':
      if (finalNormalized) {
        chrome.tabs.create({
          url: `https://claude.ai/new?q=${encodeURIComponent(finalNormalized)}`
        });
      }
      break;
      
    case 'ccs-zhihu':
      if (finalNormalized) {
        chrome.tabs.create({
          url: `https://www.zhihu.com/search?q=${encodeURIComponent(finalNormalized)}`
        });
      }
      break;
      
    case 'ccs-weixin':
      if (finalNormalized) {
        chrome.tabs.create({
          url: `https://search.weixin.qq.com/cgi-bin/newsearchweb/userclientjump?path=page/search/christmas_jump&query=${encodeURIComponent(finalNormalized)}`
        });
      }
      break;
      
    case 'ccs-taobao':
      if (finalNormalized) {
        chrome.tabs.create({
          url: `https://s.taobao.com/search?q=${encodeURIComponent(finalNormalized)}`
        });
      }
      break;
      
    case 'ccs-jd':
      if (finalNormalized) {
        chrome.tabs.create({
          url: `https://search.jd.com/Search?keyword=${encodeURIComponent(finalNormalized)}`
        });
      }
      break;
      
    case 'ccs-sov2ex':
      if (finalNormalized) {
        chrome.tabs.create({
          url: `https://www.sov2ex.com/?q=${encodeURIComponent(finalNormalized)}`
        });
      }
      break;

    case 'ccs-google-translate':
      if (finalNormalized) {
        chrome.tabs.create({
          url: `https://translate.google.com/?sl=auto&tl=zh-CN&text=${encodeURIComponent(finalNormalized)}`
        });
      }
      break;
      
    case 'ccs-chuchusou':
      if (finalNormalized) {
        chrome.tabs.create({
          url: `https://chuchusou.com/?q=${encodeURIComponent(finalNormalized)}`
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

// BUGFIX: Removed duplicate onShown listener to prevent race conditions
// The onShown listener is now registered only in background/events.js
// This fixes the issue where menu titles showed wrong tab content after switching tabs
