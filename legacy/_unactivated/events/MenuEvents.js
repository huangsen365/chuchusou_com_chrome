/**
 * 触触搜 - 菜单事件处理
 * 处理右键菜单显示事件
 *
 * @module events/MenuEvents
 */

/**
 * 菜单事件处理器类
 */
class MenuEventHandler {
  constructor(options = {}) {
    this.debug = options.debug || false;
    this.stateManager = options.stateManager || null;

    // 缓存过期时间（毫秒）
    this.cacheExpiry = options.cacheExpiry || 10000;

    // 菜单刷新延迟（毫秒）
    this.refreshDelay = options.refreshDelay || 50;

    // 标题重试延迟（毫秒）
    this.titleRetryDelay = options.titleRetryDelay || 150;

    // 用于调试的菜单 ID 列表
    this.debugMenuIds = [
      'ccs-fastqa-chatgpt-quick',
      'ccs-fastqa-claude-quick',
      'ccs-fastqa-root',
      'ccs-fastqa-open-all',
      'ccs-fastqa-grok-quick',
      'ccs-chuchusou',
      'ccs-chatgpt',
      'ccs-claude'
    ];
  }

  /**
   * 处理 contextMenus.onShown 事件
   * @param {Object} info - 菜单信息
   * @param {Object} tab - 标签页对象
   */
  async handleMenuShown(info, tab) {
    const tabId = tab?.id ?? null;
    const tabUrl = tab?.url || '';

    this._log('context-onShown', {
      tabId,
      menuIds: Array.isArray(info?.menuIds) ? info.menuIds : [],
      contexts: info?.contexts || []
    });

    if (tabId == null) {
      this._refreshMenu();
      return;
    }

    try {
      // 获取最新的标签页信息
      let freshTab = tab;
      if (tabId != null) {
        try {
          freshTab = await chrome.tabs.get(tabId);
          this._log('onShown-tab-refreshed', {
            tabId,
            freshTitle: freshTab?.title,
            originalTitle: tab?.title,
            titleChanged: freshTab?.title !== tab?.title
          });
        } catch (err) {
          this._log('onShown-tab-refresh-failed', {
            tabId,
            error: err?.message
          });
        }
      }

      // 检查是否需要清除过期状态
      const isCurrentMenuStateStale = this._isMenuStateStale(tabId);
      if (isCurrentMenuStateStale) {
        this._log('onShown-clearing-stale-state', {
          staleTabId: typeof currentMenuState !== 'undefined' ? currentMenuState.tabId : null,
          currentTabId: tabId
        });
      }

      // 同步选中文本
      let raw = '';
      let normalized = '';

      if (typeof syncSelectionFromTab === 'function') {
        const synced = await syncSelectionFromTab(freshTab, 'menu-shown', { updateMenu: false });
        if (typeof synced === 'string' && synced.trim()) {
          raw = synced;
          normalized = typeof normalizeSearchText === 'function'
            ? normalizeSearchText(synced)
            : synced;
        }
      }

      // 尝试从缓存获取
      if (!raw) {
        const cached = this._getCachedSelection(tabId);
        if (cached) {
          raw = cached.text;
          normalized = typeof normalizeSearchText === 'function'
            ? normalizeSearchText(cached.text)
            : cached.text;
          this._log('onShown-used-cached-selection', {
            tabId,
            text: raw.substring(0, 50)
          });
        }
      }

      // 使用关键词解析器
      if (!raw && typeof computeSearchTextForTab === 'function') {
        const result = await computeSearchTextForTab({
          tabId,
          tabUrl: freshTab?.url || tabUrl,
          tabTitle: freshTab?.title || '',
          selectionText: ''
        }, {
          forceFetchSelection: false,
          skipCurrentMenuFallback: isCurrentMenuStateStale
        });

        raw = result?.raw || '';
        normalized = result?.normalized || '';

        // 如果没有标题，安排重试
        if (raw && !freshTab?.title) {
          this._scheduleMenuTitleRetry(tabId, freshTab?.url || tabUrl, raw);
        }
      }

      // 更新菜单状态
      if ((raw || normalized) && typeof setMenuState === 'function') {
        await setMenuState(raw, normalized || raw, {
          tabId,
          url: freshTab?.url || tabUrl
        });
      }
    } catch (error) {
      this._log('context-onShown-error', {
        tabId,
        error: error?.message || String(error)
      });
    } finally {
      this._snapshotMenuTitles('onShown-final');
      this._refreshMenuDelayed();
    }
  }

  /**
   * 根据 URL 更新菜单
   * @param {Object} tab - 标签页对象
   */
  async updateContextMenuForTab(tab) {
    if (typeof extractSearchKeywords !== 'function') return;

    const keywords = await extractSearchKeywords(tab.url, tab);
    const normalized = keywords
      ? (typeof normalizeSearchText === 'function' ? normalizeSearchText(keywords) : keywords)
      : '';

    if (typeof applyMenuTitle === 'function') {
      applyMenuTitle(normalized, keywords || '', {
        tabId: tab?.id ?? null,
        url: tab?.url || ''
      });
    }
  }

  /**
   * 预取菜单状态
   * @param {Object} tab - 标签页对象
   * @param {string} reason - 预取原因
   */
  async prefetchMenuState(tab, reason = 'unknown') {
    const tabId = tab?.id;
    const url = tab?.url || '';
    if (tabId == null || !url) return;

    try {
      // 更新标题缓存
      if (tab.title && typeof tab.title === 'string') {
        if (typeof updateLatestTabTitle === 'function') {
          updateLatestTabTitle(tabId, tab.title);
        }
        if (this.stateManager) {
          this.stateManager.updateLatestTabTitle(tabId, tab.title);
        }
      }

      // 提取关键词
      if (typeof extractSearchKeywords !== 'function') return;

      const keywords = await extractSearchKeywords(url, tab);
      const normalized = keywords
        ? (typeof normalizeSearchText === 'function' ? normalizeSearchText(keywords) : keywords)
        : '';

      if (keywords) {
        // 更新缓存
        if (typeof fallbackKeywordByTab !== 'undefined') {
          fallbackKeywordByTab[tabId] = {
            raw: keywords,
            normalized: normalized || keywords,
            timestamp: Date.now(),
            url
          };
        }
        if (this.stateManager) {
          this.stateManager.setFallbackKeyword(tabId, {
            raw: keywords,
            normalized: normalized || keywords,
            url
          });
        }

        // 更新菜单状态
        const isActive = tab.active ||
          (typeof currentMenuState !== 'undefined' && currentMenuState.tabId === tabId);
        if (isActive && typeof setMenuState === 'function') {
          setMenuState(keywords, normalized || keywords, { tabId, url });
        }
      } else if (reason === 'tab-loading') {
        const isActive = tab.active ||
          (typeof currentMenuState !== 'undefined' && currentMenuState.tabId === tabId);
        if (isActive && typeof setMenuState === 'function') {
          setMenuState('', '', { tabId, url });
        }
      }

      this._log('prefetch-menu-state', {
        tabId,
        reason,
        url,
        keywords: keywords || ''
      });
    } catch (error) {
      this._log('prefetch-menu-state-error', {
        tabId,
        reason,
        error: error?.message || String(error)
      });
    }
  }

  /**
   * 检查菜单状态是否过期
   * @private
   */
  _isMenuStateStale(currentTabId) {
    if (typeof currentMenuState === 'undefined') return false;
    return currentMenuState.tabId != null && currentMenuState.tabId !== currentTabId;
  }

  /**
   * 获取缓存的选中文本
   * @private
   */
  _getCachedSelection(tabId) {
    if (typeof selectedTextByTab === 'undefined') return null;

    const stored = selectedTextByTab[tabId];
    if (!stored) return null;

    const storedText = typeof stored?.text === 'string' ? stored.text.trim() : '';
    const storedAge = stored?.timestamp ? (Date.now() - stored.timestamp) : Infinity;
    const isCacheFresh = storedAge < this.cacheExpiry;

    if (storedText && isCacheFresh) {
      return { text: storedText, age: storedAge };
    }

    if (storedText && !isCacheFresh) {
      this._log('onShown-cache-expired', {
        tabId,
        age: storedAge
      });
    }

    return null;
  }

  /**
   * 安排菜单标题重试
   * @private
   */
  _scheduleMenuTitleRetry(tabId, originalUrl, currentKeyword) {
    this._log('onShown-scheduling-retry', {
      tabId,
      reason: 'no-title-on-first-attempt',
      currentKeyword: currentKeyword.substring(0, 50)
    });

    setTimeout(async () => {
      try {
        const retryTab = await chrome.tabs.get(tabId);
        if (!retryTab || !retryTab.title || retryTab.url !== originalUrl) return;

        if (typeof updateLatestTabTitle === 'function') {
          updateLatestTabTitle(tabId, retryTab.title);
        }

        if (typeof computeSearchTextForTab !== 'function') return;

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

        if (retryRaw && retryRaw !== currentKeyword) {
          if (typeof setMenuState === 'function') {
            setMenuState(retryRaw, retryNormalized || retryRaw, {
              tabId,
              url: retryTab.url
            });
          }
          if (typeof refreshContextMenu === 'function') {
            await refreshContextMenu();
          }
          this._log('onShown-retry-success', {
            tabId,
            oldKeyword: currentKeyword.substring(0, 50),
            newKeyword: retryRaw.substring(0, 50)
          });
        }
      } catch (err) {
        this._log('onShown-retry-failed', {
          tabId,
          error: err?.message
        });
      }
    }, this.titleRetryDelay);
  }

  /**
   * 刷新菜单
   * @private
   */
  _refreshMenu() {
    if (chrome.contextMenus.refresh) {
      chrome.contextMenus.refresh();
    }
  }

  /**
   * 延迟刷新菜单
   * @private
   */
  _refreshMenuDelayed() {
    if (!chrome.contextMenus.refresh) return;

    setTimeout(() => {
      chrome.contextMenus.refresh();
      this._log('onShown-refreshed-delayed', {
        delayMs: this.refreshDelay
      });
    }, this.refreshDelay);
  }

  /**
   * 快照菜单标题（用于调试）
   * @private
   */
  _snapshotMenuTitles(reason) {
    if (!this.debug) return;

    this.debugMenuIds.forEach((menuId) => {
      try {
        chrome.contextMenus.get(menuId, (menu) => {
          if (chrome.runtime.lastError || !menu) {
            return;
          }
          this._log('menu-title-snapshot', {
            reason,
            id: menuId,
            title: menu.title
          });
        });
      } catch (_) {
        // 忽略错误
      }
    });
  }

  /**
   * 注册事件监听器
   */
  register() {
    if (chrome.contextMenus.onShown) {
      chrome.contextMenus.onShown.addListener((info, tab) => {
        this.handleMenuShown(info, tab);
      });

      this._log('register', { listener: 'contextMenus.onShown' });
    }
  }

  /**
   * 调试日志
   * @private
   */
  _log(action, data) {
    if (!this.debug) return;

    if (typeof logMenuEvent === 'function') {
      logMenuEvent(`MenuEvents:${action}`, data);
    } else {
      console.log(`[MenuEvents] ${action}`, data || '');
    }
  }
}

// 导出到全局
if (typeof globalThis !== 'undefined') {
  globalThis.MenuEventHandler = MenuEventHandler;
}
