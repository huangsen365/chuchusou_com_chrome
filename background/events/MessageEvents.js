/**
 * 触触搜 - 消息事件处理
 * 处理来自 content script 和 popup 的消息
 *
 * @module events/MessageEvents
 */

/**
 * 消息事件处理器类
 */
class MessageEventHandler {
  constructor(options = {}) {
    this.debug = options.debug || false;
    this.stateManager = options.stateManager || null;

    // 防抖配置
    this.debounceDelay = options.debounceDelay || 50;
    this.contextPreviewTimeout = null;
    this.latestPreviewData = null;
  }

  /**
   * 处理 getSearchText 消息
   * @param {Object} request - 请求对象
   * @param {Function} sendResponse - 响应回调
   * @returns {Promise<void>}
   */
  async handleGetSearchText(request, sendResponse) {
    const { tabId, url, title, selectionText, forceFresh } = request;

    try {
      if (typeof computeSearchTextForTab === 'function') {
        const text = await computeSearchTextForTab({
          tabId,
          tabUrl: url,
          tabTitle: title,
          selectionText
        }, {
          forceFetchSelection: !!forceFresh,
          skipCurrentMenuFallback: !!forceFresh
        });
        sendResponse?.({ text: text.normalized, raw: text.raw });
      } else {
        sendResponse?.({ text: '', raw: '' });
      }
    } catch (error) {
      this._log('getSearchText-error', { error: error.message });
      sendResponse?.({ text: '', raw: '' });
    }
  }

  /**
   * 处理 extractKeywords 消息
   * @param {Object} request - 请求对象
   * @param {Function} sendResponse - 响应回调
   * @returns {Promise<void>}
   */
  async handleExtractKeywords(request, sendResponse) {
    try {
      if (typeof extractSearchKeywords === 'function') {
        const keywords = await extractSearchKeywords(request.url, { title: request.title });
        sendResponse?.({ keywords });
      } else {
        sendResponse?.({ keywords: null });
      }
    } catch (error) {
      this._log('extractKeywords-error', { error: error.message });
      sendResponse?.({ keywords: null });
    }
  }

  /**
   * 处理 getMenuDebugInfo 消息
   * @param {Object} request - 请求对象
   * @param {Function} sendResponse - 响应回调
   * @returns {Promise<void>}
   */
  async handleGetMenuDebugInfo(request, sendResponse) {
    try {
      if (typeof getMenuDebugInfo === 'function') {
        const data = await getMenuDebugInfo(request.tabId);
        sendResponse?.({ success: true, data });
      } else {
        sendResponse?.({ success: false, error: 'getMenuDebugInfo not available' });
      }
    } catch (error) {
      this._log('getMenuDebugInfo-error', { error: error.message });
      sendResponse?.({ success: false, error: error.message });
    }
  }

  /**
   * 处理 getMenuStructure 消息
   * @param {Function} sendResponse - 响应回调
   * @returns {Promise<void>}
   */
  async handleGetMenuStructure(sendResponse) {
    try {
      if (typeof getPopupMenuStructure === 'function') {
        const structure = await getPopupMenuStructure();
        sendResponse?.({ success: true, structure });
      } else {
        sendResponse?.({ success: false, error: 'getPopupMenuStructure not available' });
      }
    } catch (error) {
      this._log('getMenuStructure-error', { error: error.message });
      sendResponse?.({ success: false, error: error.message });
    }
  }

  /**
   * 处理 executeMenuAction 消息
   * @param {Object} request - 请求对象
   * @param {Function} sendResponse - 响应回调
   * @returns {Promise<void>}
   */
  async handleExecuteMenuAction(request, sendResponse) {
    const { menuItemId, menuType, keyword, urlPattern, actionType, engineId, purpose } = request;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tab?.id;
      this._lastTabId = tabId; // 供 _handleDefaultMenuAction 的 toast 使用

      if (!keyword && menuType !== 'action' && actionType !== 'show-popover') {
        sendResponse?.({ success: false, error: 'no-keyword' });
        return;
      }

      // 字数保护：将用户原文按目标引擎截断，同时通过 toast 提示
      let effectiveKeyword = keyword || '';
      if (effectiveKeyword && typeof applyTextLimit === 'function' && menuItemId) {
        const limited = applyTextLimit(menuItemId, effectiveKeyword, { tabId });
        effectiveKeyword = limited.text;
      }
      const encodedKeyword = effectiveKeyword ? encodeURIComponent(effectiveKeyword) : '';

      switch (menuType) {
        case 'search':
        case 'ai-chat':
        case 'ai-search':
        case 'ecommerce':
        case 'translate':
        case 'portal':
          if (urlPattern && effectiveKeyword) {
            let url = urlPattern.replace('${KEYWORD}', encodedKeyword);
            if (typeof enforceFinalUrlCap === 'function') url = enforceFinalUrlCap(url);
            chrome.tabs.create({ url });
            sendResponse?.({ success: true });
          } else {
            sendResponse?.({ success: false, error: 'invalid-params' });
          }
          break;

        case 'tool':
        case 'transform':
          // 工具类（复制/编码/大小写）传原始 keyword，不应截断
          await this._handleToolAction(tabId, tab, keyword, actionType, sendResponse);
          break;

        case 'fastqa':
        case 'fastqa-quick': {
          // SSoT：优先用 AITaskHandler；失败回落到老逻辑
          if (typeof runAITask === 'function') {
            const r = await runAITask({
              taskId: 'fastqa',
              keyword: effectiveKeyword,
              engineId,
              tabId
            });
            if (r.success) { sendResponse?.({ success: true }); break; }
          }
          await this._handleFastQaAction(effectiveKeyword, engineId, urlPattern, sendResponse);
          break;
        }

        case 'top100': {
          if (typeof runAITask === 'function') {
            const r = await runAITask({
              taskId: 'top100',
              keyword: effectiveKeyword,
              engineId,
              tabId
            });
            if (r.success) { sendResponse?.({ success: true }); break; }
          }
          await this._handleTop100Action(effectiveKeyword, engineId, urlPattern, sendResponse);
          break;
        }

        case 'optimize': {
          // menuItemId 形如 ccs-optimize-<category>-<engine>，可从中拆出
          if (typeof runAITask === 'function' && menuItemId) {
            const parsed = (typeof AITaskRegistry !== 'undefined')
              ? AITaskRegistry.resolveMenuId(menuItemId) : null;
            if (parsed && parsed.taskId === 'optimize' && parsed.categoryId && parsed.engineId) {
              const r = await runAITask({
                taskId: 'optimize',
                keyword: effectiveKeyword,
                engineId: parsed.engineId,
                categoryId: parsed.categoryId,
                tabId
              });
              if (r.success) { sendResponse?.({ success: true }); break; }
            }
          }
          await this._handleOptimizeAction(effectiveKeyword, purpose, urlPattern, sendResponse);
          break;
        }

        case 'action':
          if (actionType === 'show-popover' && tabId) {
            chrome.tabs.sendMessage(tabId, {
              action: 'showPopover',
              text: keyword || ''
            }).catch(() => {});
            sendResponse?.({ success: true });
          } else {
            sendResponse?.({ success: false, error: 'unknown-action' });
          }
          break;

        case 'submenu':
          sendResponse?.({ success: false, error: 'submenu-no-action' });
          break;

        default:
          await this._handleDefaultMenuAction(menuItemId, encodedKeyword, sendResponse);
      }
    } catch (error) {
      this._log('executeMenuAction-error', { error: error.message });
      sendResponse?.({ success: false, error: error.message });
    }
  }

  /**
   * 处理 contextMenuPreview 消息（带防抖）
   * @param {Object} request - 请求对象
   * @param {Object} sender - 发送者信息
   */
  handleContextMenuPreview(request, sender) {
    const tabId = sender?.tab?.id ?? null;
    const incoming = typeof request.selectionText === 'string' ? request.selectionText : '';

    // 保存最新预览数据
    this.latestPreviewData = {
      request,
      sender,
      timestamp: Date.now()
    };

    this._log('context-preview-in', {
      tabId,
      incomingText: incoming,
      debounceQueued: true
    });

    // 清除之前的定时器
    if (this.contextPreviewTimeout) {
      clearTimeout(this.contextPreviewTimeout);
    }

    // 设置新的防抖定时器
    this.contextPreviewTimeout = setTimeout(() => {
      this._processContextMenuPreview();
    }, this.debounceDelay);
  }

  /**
   * 处理 selectionChanged 消息
   * @param {Object} request - 请求对象
   * @param {Object} sender - 发送者信息
   */
  async handleSelectionChanged(request, sender) {
    if (!sender.tab) return;

    const tabId = sender.tab.id;
    const rawText = typeof request.text === 'string' ? request.text : '';
    const hasContent = rawText.trim().length > 0;

    // 验证消息来自当前活动标签页
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTabId = tabs?.[0]?.id ?? null;

    if (activeTabId != null && tabId !== activeTabId) {
      this._log('selection-changed-ignored-inactive-tab', {
        senderTabId: tabId,
        activeTabId,
        hasContent
      });
      return;
    }

    // 更新状态
    if (hasContent) {
      if (this.stateManager) {
        this.stateManager.setSelectedText(tabId, rawText, sender.tab.url || '');
      }
      if (typeof selectedTextByTab !== 'undefined') {
        selectedTextByTab[tabId] = {
          text: rawText,
          url: sender.tab.url || ''
        };
      }

      const normalizedSelection = typeof normalizeSearchText === 'function'
        ? normalizeSearchText(rawText)
        : rawText;

      if (typeof setMenuState === 'function') {
        setMenuState(rawText, normalizedSelection, {
          tabId,
          url: sender.tab.url || ''
        });
      }
    } else {
      if (this.stateManager) {
        this.stateManager.setSelectedText(tabId, '', '');
      }
      if (typeof selectedTextByTab !== 'undefined') {
        delete selectedTextByTab[tabId];
      }
    }

    // 刷新菜单
    const preserve = typeof shouldPreserveMenuStateForTab === 'function'
      ? shouldPreserveMenuStateForTab(sender.tab)
      : false;

    if (!hasContent || !preserve) {
      if (typeof refreshMenuTitle === 'function') {
        await refreshMenuTitle(sender.tab, rawText);
      }
    }
  }

  /**
   * 处理 updateDebug 消息
   * @param {Object} request - 请求对象
   * @param {Function} sendResponse - 响应回调
   */
  handleUpdateDebug(request, sendResponse) {
    if (typeof BG_DEBUG !== 'undefined') {
      BG_DEBUG = !!request.enabled;
    }
    chrome.storage.local.set({ ccs_debug: !!request.enabled });
    sendResponse?.({ ok: true });
  }

  /**
   * 处理工具类操作
   * @private
   */
  async _handleToolAction(tabId, tab, keyword, actionType, sendResponse) {
    if (!tabId || !keyword) {
      sendResponse?.({ success: false, error: 'invalid-params' });
      return;
    }

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
      const ok = typeof copyTextInTab === 'function'
        ? await copyTextInTab(tab, keyword)
        : false;
      if (!ok) {
        chrome.tabs.sendMessage(tabId, {
          action: 'showToast',
          message: '复制失败，请检查页面权限'
        }).catch(() => {});
      }
    } else if (command) {
      chrome.tabs.sendMessage(tabId, {
        action: 'processCommand',
        command,
        text: keyword
      }).catch(() => {});
    }

    sendResponse?.({ success: true });
  }

  /**
   * 处理速答类操作
   * @private
   */
  async _handleFastQaAction(keyword, engineId, urlPattern, sendResponse) {
    if (!keyword) {
      sendResponse?.({ success: false, error: 'no-keyword' });
      return;
    }

    if (typeof loadFastAnswersConfig !== 'function' ||
        typeof buildFastAnswersPrompt !== 'function') {
      sendResponse?.({ success: false, error: 'functions-not-available' });
      return;
    }

    const config = await loadFastAnswersConfig();
    if (!config) {
      sendResponse?.({ success: false, error: 'config-load-failed' });
      return;
    }

    const prompt = buildFastAnswersPrompt(keyword);
    if (!prompt) {
      sendResponse?.({ success: false, error: 'template-invalid' });
      return;
    }

    const encodedPrompt = encodeURIComponent(prompt);
    let targetUrl = null;

    if (engineId) {
      const engine = (config.engines || []).find((e) => e.id === engineId);
      if (engine?.urlPattern) {
        targetUrl = engine.urlPattern.replace('${PROMPT}', encodedPrompt);
      }
    }

    if (!targetUrl && urlPattern) {
      targetUrl = urlPattern.replace('${PROMPT}', encodedPrompt);
    }

    if (targetUrl) {
      if (typeof enforceFinalUrlCap === 'function') targetUrl = enforceFinalUrlCap(targetUrl);
      chrome.tabs.create({ url: targetUrl });
      sendResponse?.({ success: true });
    } else {
      sendResponse?.({ success: false, error: 'no-engine-url' });
    }
  }

  /**
   * 处理触触搜百问操作
   * @private
   */
  async _handleTop100Action(keyword, engineId, urlPattern, sendResponse) {
    if (!keyword) {
      sendResponse?.({ success: false, error: 'no-keyword' });
      return;
    }

    if (typeof loadTopQuestionsConfig !== 'function' ||
        typeof buildTopQuestionsPrompt !== 'function') {
      sendResponse?.({ success: false, error: 'functions-not-available' });
      return;
    }

    const config = await loadTopQuestionsConfig();
    if (!config) {
      sendResponse?.({ success: false, error: 'config-load-failed' });
      return;
    }

    const prompt = buildTopQuestionsPrompt(keyword);
    if (!prompt) {
      sendResponse?.({ success: false, error: 'template-invalid' });
      return;
    }

    const encodedPrompt = encodeURIComponent(prompt);
    let targetUrl = null;

    if (engineId) {
      const engine = (config.engines || []).find((e) => e.id === engineId);
      if (engine?.urlPattern) {
        targetUrl = engine.urlPattern.replace('${PROMPT}', encodedPrompt);
      }
    }

    if (!targetUrl && urlPattern) {
      targetUrl = urlPattern.replace('${PROMPT}', encodedPrompt);
    }

    if (targetUrl) {
      if (typeof enforceFinalUrlCap === 'function') targetUrl = enforceFinalUrlCap(targetUrl);
      chrome.tabs.create({ url: targetUrl });
      sendResponse?.({ success: true });
    } else {
      sendResponse?.({ success: false, error: 'no-engine-url' });
    }
  }

  /**
   * 处理优化提示词操作
   * @private
   */
  async _handleOptimizeAction(keyword, purpose, urlPattern, sendResponse) {
    if (!keyword) {
      sendResponse?.({ success: false, error: 'no-keyword' });
      return;
    }

    if (typeof loadOptimizedPromptConfig !== 'function' ||
        typeof buildOptimizedPrompt !== 'function') {
      sendResponse?.({ success: false, error: 'functions-not-available' });
      return;
    }

    const config = await loadOptimizedPromptConfig();
    if (!config) {
      sendResponse?.({ success: false, error: 'config-load-failed' });
      return;
    }

    const prompt = buildOptimizedPrompt(purpose || '', keyword);
    if (!prompt) {
      sendResponse?.({ success: false, error: 'template-invalid' });
      return;
    }

    const encodedPrompt = encodeURIComponent(prompt);
    let targetUrl = null;

    if (urlPattern) {
      targetUrl = urlPattern.replace('${PROMPT}', encodedPrompt);
    }

    if (targetUrl) {
      if (typeof enforceFinalUrlCap === 'function') targetUrl = enforceFinalUrlCap(targetUrl);
      chrome.tabs.create({ url: targetUrl });
      sendResponse?.({ success: true });
    } else {
      sendResponse?.({ success: false, error: 'no-engine-url' });
    }
  }

  /**
   * 处理默认菜单操作
   * @private
   */
  async _handleDefaultMenuAction(menuItemId, encodedKeyword, sendResponse) {
    if (!menuItemId || !encodedKeyword) {
      sendResponse?.({ success: false, error: 'unhandled-type' });
      return;
    }

    const rawKeyword = (() => {
      try { return decodeURIComponent(encodedKeyword); } catch { return encodedKeyword; }
    })();

    // 优先走 URLBuilder 统一入口（SSoT：模板集中在 config/unifiedMenuConfig.json）
    if (typeof tryOpenMenuUrl === 'function' && tryOpenMenuUrl(menuItemId, rawKeyword, { tabId: this._lastTabId })) {
      sendResponse?.({ success: true });
      return;
    }

    // Fallback：保留历史硬编码路径作为安全网
    // TODO(refactor): 待 URLBuilder 覆盖验证充分后，移除下方 fallback urlMap
    const urlMap = {
      'ccs-baidu': `https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${encodedKeyword}`,
      'ccs-google': `https://www.google.com/search?q=${encodedKeyword}`,
      'ccs-google-ai-chat': `https://www.google.com/search?udm=50&q=${encodedKeyword}`,
      'ccs-chatgpt': `https://chatgpt.com/?q=${encodedKeyword}`,
      'ccs-claude': `https://claude.ai/new?q=${encodedKeyword}`,
      'ccs-grok': `https://grok.com/?q=${encodedKeyword}`
    };

    const url = urlMap[menuItemId];
    if (url) {
      chrome.tabs.create({ url });
      sendResponse?.({ success: true });
    } else {
      sendResponse?.({ success: false, error: 'unhandled-type' });
    }
  }

  /**
   * 处理防抖后的 contextMenuPreview
   * @private
   */
  async _processContextMenuPreview() {
    const data = this.latestPreviewData;
    if (!data) return;

    const { request, sender } = data;
    const tabId = sender?.tab?.id ?? null;
    const incoming = typeof request.selectionText === 'string' ? request.selectionText : '';

    // 验证是否来自当前活动标签页
    if (tabId != null) {
      try {
        const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTabId = activeTabs?.[0]?.id ?? null;

        if (activeTabId != null && tabId !== activeTabId) {
          this._log('context-preview-ignored-inactive-tab', {
            senderTabId: tabId,
            activeTabId
          });
          return;
        }
      } catch (error) {
        this._log('context-preview-validation-error', { error: error.message });
      }
    }

    const incomingTrimmed = incoming.trim();
    let previewText = incoming;
    let normalizedPreview = previewText ?
      (typeof normalizeSearchText === 'function' ? normalizeSearchText(previewText) : previewText) : '';
    let source = previewText ? 'message' : 'none';
    const tabUrl = sender?.tab?.url || '';

    // 同步选中文本
    if (tabId != null && typeof syncSelectionFromTab === 'function') {
      await syncSelectionFromTab({ id: tabId, url: tabUrl }, 'context-preview', { updateMenu: false });
      if (!incomingTrimmed) {
        if (typeof selectedTextByTab !== 'undefined') {
          delete selectedTextByTab[tabId];
        }
      }
    }

    // 从缓存获取
    if (!previewText && tabId != null && incomingTrimmed && typeof selectedTextByTab !== 'undefined') {
      const cached = selectedTextByTab[tabId];
      const cachedText = typeof cached === 'string' ? cached : cached?.text;
      if (cachedText?.trim()) {
        previewText = cachedText;
        normalizedPreview = typeof normalizeSearchText === 'function'
          ? normalizeSearchText(previewText) : previewText;
        source = 'cached-selection';
      }
    }

    // 使用关键词解析器回退
    if (!previewText && sender?.tab && typeof computeSearchTextForTab === 'function') {
      try {
        const fallback = await computeSearchTextForTab({
          tabId,
          tabUrl: sender.tab.url || '',
          tabTitle: sender.tab.title || '',
          selectionText: ''
        }, {
          forceFetchSelection: false,
          skipCurrentMenuFallback: false
        });

        if (fallback?.raw) {
          previewText = fallback.raw;
          normalizedPreview = fallback.normalized ||
            (typeof normalizeSearchText === 'function' ? normalizeSearchText(fallback.raw) : fallback.raw);
          source = 'resolver-fallback';

          if (tabId != null && typeof fallbackKeywordByTab !== 'undefined') {
            fallbackKeywordByTab[tabId] = {
              raw: fallback.raw,
              normalized: normalizedPreview,
              timestamp: Date.now(),
              url: sender.tab.url || ''
            };
          }
        }
      } catch (error) {
        this._log('context-preview-fallback-error', { error: error.message });
      }
    }

    // 从当前菜单状态回退
    if (!previewText && typeof currentMenuState !== 'undefined' && currentMenuState.raw) {
      previewText = currentMenuState.raw;
      normalizedPreview = currentMenuState.normalized ||
        (typeof normalizeSearchText === 'function' ? normalizeSearchText(previewText) : previewText);
      source = 'menu-state';
    }

    // 更新关键词缓存
    if (tabId != null && previewText && typeof updateLatestTabKeyword === 'function') {
      updateLatestTabKeyword(tabId, previewText, normalizedPreview || previewText);
    }

    // 更新选中文本缓存和菜单状态
    if (previewText && source !== 'menu-state') {
      if (tabId != null && typeof selectedTextByTab !== 'undefined') {
        selectedTextByTab[tabId] = {
          text: previewText,
          url: tabUrl
        };
        if (typeof fallbackKeywordByTab !== 'undefined') {
          delete fallbackKeywordByTab[tabId];
        }
      }

      if (typeof setMenuState === 'function') {
        setMenuState(previewText, normalizedPreview || previewText, {
          tabId,
          url: tabUrl
        });
      }
    }

    this._log('context-preview-processed', {
      tabId,
      previewText,
      source
    });
  }

  /**
   * 注册消息监听器
   */
  register() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      const action = request?.action;

      switch (action) {
        case 'getSearchText':
          this.handleGetSearchText(request, sendResponse);
          return true;

        case 'extractKeywords':
          this.handleExtractKeywords(request, sendResponse);
          return true;

        case 'getMenuDebugInfo':
          this.handleGetMenuDebugInfo(request, sendResponse);
          return true;

        case 'getMenuStructure':
          this.handleGetMenuStructure(sendResponse);
          return true;

        case 'executeMenuAction':
          this.handleExecuteMenuAction(request, sendResponse);
          return true;

        case 'contextMenuPreview':
          this.handleContextMenuPreview(request, sender);
          return;

        case 'selectionChanged':
          this.handleSelectionChanged(request, sender);
          return;

        case 'updateDebug':
          this.handleUpdateDebug(request, sendResponse);
          return;

        case 'ccs-log-menu-icons':
          // 保留兼容性，使用全局函数
          if (typeof loadMenuIconConfig === 'function') {
            loadMenuIconConfig().then((config) => {
              sendResponse?.({ ok: true, info: { iconConfig: config } });
            }).catch((err) => {
              sendResponse?.({ ok: false, error: err?.message });
            });
            return true;
          }
          sendResponse?.({ ok: false, error: 'not-available' });
          return;
      }

      // 未处理的消息
      return false;
    });

    this._log('register', { listener: 'onMessage' });
  }

  /**
   * 调试日志
   * @private
   */
  _log(action, data) {
    if (!this.debug) return;

    if (typeof logMenuEvent === 'function') {
      logMenuEvent(`MessageEvents:${action}`, data);
    } else {
      console.log(`[MessageEvents] ${action}`, data || '');
    }
  }
}

// 导出到全局
if (typeof globalThis !== 'undefined') {
  globalThis.MessageEventHandler = MessageEventHandler;
}
