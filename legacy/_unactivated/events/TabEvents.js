/**
 * 触触搜 - 标签页事件处理
 * 处理标签页更新、激活、关闭等事件
 *
 * @module events/TabEvents
 */

/**
 * 标签页事件处理器类
 */
class TabEventHandler {
  constructor(options = {}) {
    this.debug = options.debug || false;
    this.stateManager = options.stateManager || null;

    // 缓存过期时间
    this.cacheExpiry = {
      selection: options.selectionCacheExpiry || 10000,  // 10 秒
      keyword: options.keywordCacheExpiry || 30000       // 30 秒
    };
  }

  /**
   * 处理标签页更新事件
   * @param {number} tabId - 标签页 ID
   * @param {Object} changeInfo - 变化信息
   * @param {Object} tab - 标签页对象
   */
  async handleTabUpdated(tabId, changeInfo, tab) {
    // 标题变化
    if (typeof changeInfo.title === 'string') {
      this._handleTitleChange(tabId, changeInfo.title, tab);
    }

    // 页面加载中
    if (changeInfo.status === 'loading') {
      this._handleTabLoading(tabId, changeInfo, tab);
    }

    // 页面加载完成
    if (changeInfo.status === 'complete' && tab.url) {
      await this._handleTabComplete(tabId, changeInfo, tab);
    }
  }

  /**
   * 处理标题变化
   * @private
   */
  async _handleTitleChange(tabId, title, tab) {
    // 更新状态管理器
    if (this.stateManager) {
      this.stateManager.updateLatestTabTitle(tabId, title);
    }

    // 使用全局函数（兼容旧系统）
    if (typeof updateLatestTabTitle === 'function') {
      updateLatestTabTitle(tabId, title);
    }

    // 预取菜单状态
    if (typeof prefetchMenuState === 'function' && (tab?.url || '')) {
      const mergedTab = { ...tab, id: tabId, title };
      await prefetchMenuState(mergedTab, 'title-changed');
    }

    // 刷新菜单标题
    if (typeof refreshMenuTitle === 'function') {
      const mergedTab = { ...tab, id: tabId, title };
      await refreshMenuTitle(mergedTab);
    }

    this._log('handleTitleChange', { tabId, title });
  }

  /**
   * 处理页面加载中
   * @private
   */
  _handleTabLoading(tabId, changeInfo, tab) {
    // 清理旧的选中文本缓存
    if (this.stateManager) {
      this.stateManager.setSelectedText(tabId, '', '');
      this.stateManager.setFallbackKeyword(tabId, { raw: '', normalized: '', url: '' });
    }

    // 兼容旧系统
    if (typeof selectedTextByTab !== 'undefined') {
      delete selectedTextByTab[tabId];
    }
    if (typeof fallbackKeywordByTab !== 'undefined') {
      delete fallbackKeywordByTab[tabId];
    }

    this._log('handleTabLoading', { tabId, url: changeInfo.url || tab?.url });
  }

  /**
   * 处理页面加载完成
   * @private
   */
  async _handleTabComplete(tabId, changeInfo, tab) {
    const url = changeInfo.url || tab.url;
    const mergedTab = { ...tab, id: tabId, url };

    // 预取菜单状态
    if (typeof prefetchMenuState === 'function') {
      await prefetchMenuState(mergedTab, 'tab-complete');
    }

    // 同步选中文本
    if (typeof syncSelectionFromTab === 'function') {
      const syncedText = await syncSelectionFromTab(mergedTab, 'tab-updated');
      if (syncedText) {
        // 清理备用关键词
        if (this.stateManager) {
          this.stateManager.setFallbackKeyword(tabId, { raw: '', normalized: '', url: '' });
        }
        if (typeof fallbackKeywordByTab !== 'undefined') {
          delete fallbackKeywordByTab[tabId];
        }
        return;
      }
    }

    // 检查是否需要保留菜单状态
    const shouldPreserve = this._shouldPreserveState(tabId, url);
    if (!shouldPreserve) {
      if (typeof refreshMenuTitle === 'function') {
        await refreshMenuTitle(mergedTab);
      }
    }

    // 延迟刷新标题（处理后更新的标题）
    this._scheduleDelayedTitleRefresh(tabId, url, tab.title);

    this._log('handleTabComplete', { tabId, url });
  }

  /**
   * 处理标签页激活事件
   * @param {Object} activeInfo - 激活信息
   */
  async handleTabActivated(activeInfo) {
    const tabId = activeInfo.tabId;

    try {
      const tab = await chrome.tabs.get(tabId);

      // 保存之前标签页的状态
      this._saveCurrentTabState();

      // 恢复新标签页的状态
      await this._restoreTabState(tabId, tab);

      // 更新标题缓存
      if (tab?.title && this.stateManager) {
        this.stateManager.updateLatestTabTitle(tabId, tab.title);
      }

      // 预取关键词
      if (tab?.url) {
        await this._preloadKeywords(tabId, tab);
      }

      // 同步选中文本
      if (typeof syncSelectionFromTab === 'function') {
        const syncedText = await syncSelectionFromTab(tab, 'tab-activated');
        if (syncedText) {
          return;
        }
      }

      // 刷新菜单标题
      if (typeof refreshMenuTitle === 'function') {
        await refreshMenuTitle(tab);
      }

      this._log('handleTabActivated', { tabId, url: tab?.url });
    } catch (error) {
      this._log('handleTabActivated-error', { tabId, error: error.message });
    }
  }

  /**
   * 处理标签页关闭事件
   * @param {number} tabId - 标签页 ID
   * @param {Object} removeInfo - 关闭信息
   */
  handleTabRemoved(tabId, removeInfo) {
    // 清理状态管理器
    if (this.stateManager) {
      this.stateManager.deleteTabState(tabId);
    }

    // 清理旧系统的缓存
    if (typeof selectedTextByTab !== 'undefined') {
      delete selectedTextByTab[tabId];
    }
    if (typeof fallbackKeywordByTab !== 'undefined') {
      delete fallbackKeywordByTab[tabId];
    }
    if (typeof latestTitleByTab !== 'undefined') {
      delete latestTitleByTab[tabId];
    }

    // 清理当前菜单状态
    if (typeof currentMenuState !== 'undefined' && currentMenuState.tabId === tabId) {
      currentMenuState.raw = '';
      currentMenuState.normalized = '';
      currentMenuState.display = '';
      currentMenuState.tabId = null;
      currentMenuState.url = '';
    }

    this._log('handleTabRemoved', { tabId, windowClosing: removeInfo.windowClosing });
  }

  /**
   * 保存当前标签页状态
   * @private
   */
  _saveCurrentTabState() {
    if (typeof currentMenuState === 'undefined') return;

    const previousTabId = currentMenuState.tabId;
    if (previousTabId == null || !currentMenuState.raw) return;

    // 保存到缓存
    if (this.stateManager) {
      this.stateManager.setSelectedText(previousTabId, currentMenuState.raw, currentMenuState.url);
    }

    if (typeof selectedTextByTab !== 'undefined') {
      selectedTextByTab[previousTabId] = {
        text: currentMenuState.raw,
        url: currentMenuState.url,
        timestamp: Date.now()
      };
    }
  }

  /**
   * 恢复标签页状态
   * @private
   */
  async _restoreTabState(tabId, tab) {
    // 尝试从缓存恢复
    let cached = null;

    if (this.stateManager) {
      cached = this.stateManager.getSelectedText(tabId);
    } else if (typeof selectedTextByTab !== 'undefined') {
      cached = selectedTextByTab[tabId];
    }

    if (!cached?.text) {
      this._clearCurrentMenuState(tabId, tab?.url);
      return;
    }

    const age = Date.now() - (cached.timestamp || 0);
    const isFresh = age < this.cacheExpiry.selection;
    const urlMatches = cached.url === tab?.url;

    if (isFresh && urlMatches) {
      // 恢复状态
      if (typeof setMenuState === 'function') {
        const normalized = typeof normalizeSearchText === 'function'
          ? normalizeSearchText(cached.text)
          : cached.text;
        setMenuState(cached.text, normalized, { tabId, url: tab?.url });
      }
    } else {
      this._clearCurrentMenuState(tabId, tab?.url);
    }
  }

  /**
   * 清除当前菜单状态
   * @private
   */
  _clearCurrentMenuState(tabId, url) {
    if (typeof currentMenuState !== 'undefined') {
      currentMenuState.raw = '';
      currentMenuState.normalized = '';
      currentMenuState.display = '';
      currentMenuState.tabId = tabId;
      currentMenuState.url = url || '';
    }
  }

  /**
   * 预加载关键词
   * @private
   */
  async _preloadKeywords(tabId, tab) {
    if (typeof extractSearchKeywords !== 'function') return;

    try {
      const keywords = await extractSearchKeywords(tab.url, tab);
      if (!keywords?.trim()) return;

      const normalized = typeof normalizeSearchText === 'function'
        ? normalizeSearchText(keywords)
        : keywords;

      // 保存到状态管理器
      if (this.stateManager) {
        this.stateManager.setFallbackKeyword(tabId, {
          raw: keywords,
          normalized,
          url: tab.url
        });
      }

      // 兼容旧系统
      if (typeof fallbackKeywordByTab !== 'undefined') {
        fallbackKeywordByTab[tabId] = {
          raw: keywords,
          normalized,
          timestamp: Date.now(),
          url: tab.url
        };
      }
    } catch (error) {
      this._log('preloadKeywords-error', { tabId, error: error.message });
    }
  }

  /**
   * 检查是否应该保留状态
   * @private
   */
  _shouldPreserveState(tabId, url) {
    // 检查缓存
    const stored = typeof selectedTextByTab !== 'undefined'
      ? selectedTextByTab[tabId]
      : null;

    const hasStoredSelection = stored?.text?.trim();

    // 使用全局函数检查
    if (typeof shouldPreserveMenuStateForUrl === 'function') {
      return shouldPreserveMenuStateForUrl(url) && hasStoredSelection && stored.url === url;
    }

    return false;
  }

  /**
   * 安排延迟标题刷新
   * @private
   */
  _scheduleDelayedTitleRefresh(tabId, url, originalTitle) {
    setTimeout(async () => {
      try {
        const freshTab = await chrome.tabs.get(tabId);
        if (freshTab && freshTab.url === url && freshTab.title !== originalTitle) {
          // 更新标题缓存
          if (this.stateManager) {
            this.stateManager.updateLatestTabTitle(tabId, freshTab.title);
          }
          if (typeof updateLatestTabTitle === 'function') {
            updateLatestTabTitle(tabId, freshTab.title);
          }

          // 预取菜单状态
          if (typeof prefetchMenuState === 'function') {
            await prefetchMenuState(freshTab, 'delayed-title-refresh');
          }
        }
      } catch (_) {
        // 标签页可能已关闭
      }
    }, 300);
  }

  /**
   * 调试日志
   * @private
   */
  _log(action, data) {
    if (!this.debug) return;

    if (typeof logMenuEvent === 'function') {
      logMenuEvent(`TabEvents:${action}`, data);
    } else {
      console.log(`[TabEvents] ${action}`, data || '');
    }
  }

  /**
   * 注册事件监听器
   */
  register() {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      this.handleTabUpdated(tabId, changeInfo, tab);
    });

    chrome.tabs.onActivated.addListener((activeInfo) => {
      this.handleTabActivated(activeInfo);
    });

    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
      this.handleTabRemoved(tabId, removeInfo);
    });

    this._log('register', { listeners: ['onUpdated', 'onActivated', 'onRemoved'] });
  }
}

// 导出到全局
if (typeof globalThis !== 'undefined') {
  globalThis.TabEventHandler = TabEventHandler;
}
