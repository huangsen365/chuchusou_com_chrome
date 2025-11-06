/**
 * 关键字同步管理器
 *
 * 整合原有的多个全局状态对象，提供统一的状态管理和同步接口
 * 核心功能：
 * 1. 集中管理关键字状态（合并 currentMenuState, selectedTextByTab 等）
 * 2. 发布-订阅模式，解耦状态变化和响应
 * 3. 利用 chrome.contextMenus.onShown 优化性能
 *
 * @module KeywordSyncManager
 */

/**
 * 关键字状态接口
 * @typedef {Object} KeywordState
 * @property {string} raw - 原始关键字
 * @property {string} normalized - 规范化后的关键字
 * @property {string} display - 用于显示的格式化关键字
 * @property {number} tabId - 标签页 ID
 * @property {number} timestamp - 更新时间戳
 * @property {string} [source] - 来源（'selection', 'url', 'title', 'fallback'）
 */

class KeywordSyncManager {
  constructor(menuRegistry) {
    /**
     * 菜单注册表引用
     * @type {MenuRegistry}
     */
    this.menuRegistry = menuRegistry;

    /**
     * 当前全局关键字状态（替代原有的 currentMenuState）
     * @type {KeywordState}
     */
    this.currentState = {
      raw: '',
      normalized: '',
      display: '',
      tabId: null,
      timestamp: Date.now(),
      source: null
    };

    // 兼容模式：直接使用全局对象，而不是创建新的 Map
    // 这样旧代码更新的数据可以被新系统读取
    // 注意：这些全局对象在 base.js 中定义

    /**
     * 订阅者列表（观察者模式）
     * @type {Array<Function>}
     */
    this.subscribers = [];

    /**
     * 是否正在同步
     * @type {boolean}
     */
    this.syncing = false;

    // 绑定 onShown 监听器
    this._setupOnShownListener();
  }

  /**
   * 设置 onShown 监听器，实现按需更新
   *
   * @private
   */
  _setupOnShownListener() {
    // BUGFIX: Disable onShown listener to prevent stale cache reads and cross-tab contamination
    //
    // Problems with onShown approach:
    // 1. The `tab` parameter is unreliable - may contain stale or incorrect tab info
    // 2. _refreshKeywordForTab reads from global cache without validation
    // 3. Can read data from closed tabs if cache not cleaned properly
    // 4. Multiple onShown listeners compete and overwrite each other
    //
    // Solution: Menu sync now happens immediately in setMenuState() (base.js:547-604)
    // This makes onShown sync redundant and only causes problems.
    //
    // Result: All menus (including optimize category) show correct keywords from active tab
    console.log('[KeywordSyncManager] onShown listener DISABLED - using immediate sync in setMenuState instead');
    return;

    // Old onShown listener code below (kept for reference, never executed)
    // ===================================================================

    if (!chrome.contextMenus || !chrome.contextMenus.onShown) {
      console.warn('[KeywordSyncManager] chrome.contextMenus.onShown not available');
      return;
    }

    chrome.contextMenus.onShown.addListener(async (info, tab) => {
      try {
        if (typeof logMenuEvent === 'function') {
          logMenuEvent('on-shown-triggered', {
            tabId: tab?.id,
            hasTab: !!tab
          });
        }

        // 获取当前标签页的最新关键字
        const tabId = tab?.id;
        if (!tabId) {
          console.warn('[KeywordSyncManager] onShown: no tabId');
          return;
        }

        // 确保使用最新的关键字状态
        await this._refreshKeywordForTab(tabId);

        if (typeof logMenuEvent === 'function') {
          logMenuEvent('keyword-refreshed-for-tab', {
            tabId,
            raw: this.currentState.raw,
            display: this.currentState.display,
            source: this.currentState.source
          });
        }

        // 同步所有菜单标题
        const syncResult = await this.syncMenus();

        if (typeof logMenuEvent === 'function') {
          logMenuEvent('menus-synced-on-shown', syncResult);
        }

        // 刷新菜单显示
        if (chrome.contextMenus.refresh) {
          chrome.contextMenus.refresh();
          if (typeof logMenuEvent === 'function') {
            logMenuEvent('menu-refreshed', {});
          }
        }

        if (typeof logMenuEvent === 'function') {
          logMenuEvent('keyword-sync-on-shown', {
            tabId,
            keyword: this.currentState.display,
            source: this.currentState.source
          });
        }
      } catch (error) {
        console.error('[KeywordSyncManager] Error in onShown:', error);
        if (typeof logMenuEvent === 'function') {
          logMenuEvent('on-shown-error', {
            error: error.message,
            stack: error.stack
          });
        }
      }
    });
  }

  /**
   * 刷新指定标签页的关键字状态
   *
   * @private
   * @param {number} tabId - 标签页 ID
   */
  async _refreshKeywordForTab(tabId) {
    try {
      // 兼容模式：读取全局对象（旧系统维护的数据）
      // BUGFIX: selectedTextByTab[tabId] is an object {text: '...', url: '...'}, not a string
      const selectedEntry = (typeof selectedTextByTab !== 'undefined' && selectedTextByTab[tabId]) || null;
      const selectedText = (typeof selectedEntry === 'object' && selectedEntry?.text) ||
                          (typeof selectedEntry === 'string' ? selectedEntry : '');
      const fallbackEntry = (typeof fallbackKeywordByTab !== 'undefined' && fallbackKeywordByTab[tabId]) || null;
      const fallbackKeyword = fallbackEntry?.raw || fallbackEntry?.keyword || '';
      const titleEntry = (typeof latestTitleByTab !== 'undefined' && latestTitleByTab[tabId]) || null;
      const pageTitle = titleEntry?.title || titleEntry?.pageTitle || '';

      // 优先级：选中文本 > 备用关键字 > 页面标题
      let raw = selectedText || fallbackKeyword || pageTitle || '';
      let source = selectedText ? 'selection' : (fallbackKeyword ? 'fallback' : (pageTitle ? 'title' : null));

      // 规范化关键字
      let normalized = raw;
      if (typeof normalizeKeyword === 'function') {
        normalized = normalizeKeyword(raw);
      }

      // 格式化显示文本
      let display = normalized;
      if (typeof formatMenuTitle === 'function') {
        display = formatMenuTitle(normalized);
      }

      // 更新当前状态
      this.currentState = {
        raw,
        normalized,
        display,
        tabId,
        timestamp: Date.now(),
        source
      };
    } catch (error) {
      console.error('[KeywordSyncManager] Error refreshing keyword:', error);
    }
  }

  /**
   * 更新关键字状态
   *
   * @param {string} raw - 原始关键字
   * @param {string} [normalized] - 规范化后的关键字（可选，自动计算）
   * @param {Object} [meta] - 元数据（tabId, source 等）
   * @returns {Promise<void>}
   */
  async update(raw, normalized, meta = {}) {
    const { tabId, source = 'unknown' } = meta;

    // 规范化关键字
    if (!normalized && typeof normalizeKeyword === 'function') {
      normalized = normalizeKeyword(raw);
    } else if (!normalized) {
      normalized = raw;
    }

    // 格式化显示文本
    let display = normalized;
    if (typeof formatMenuTitle === 'function') {
      display = formatMenuTitle(normalized);
    }

    // 更新当前状态
    this.currentState = {
      raw: raw || '',
      normalized: normalized || '',
      display: display || '',
      tabId: tabId || null,
      timestamp: Date.now(),
      source
    };

    // 兼容模式：直接操作全局对象，而不是内部 Map
    // 这样可以与旧代码共享状态
    // 注意：这里不需要更新缓存，因为旧代码会直接更新全局对象

    // 通知订阅者
    this._notifySubscribers(this.currentState);

    // 同步菜单（可选：在 onShown 时同步以提高性能）
    // await this.syncMenus();

    if (typeof logMenuEvent === 'function') {
      logMenuEvent('keyword-updated', {
        raw,
        normalized,
        display,
        tabId,
        source
      });
    }
  }

  /**
   * 更新选中文本
   *
   * @param {number} tabId - 标签页 ID
   * @param {string} text - 选中的文本
   * @returns {Promise<void>}
   */
  async updateSelection(tabId, text) {
    // 兼容模式：旧代码会直接更新 selectedTextByTab[tabId]
    // 这里只需要更新状态即可
    await this.update(text, null, { tabId, source: 'selection' });
  }

  /**
   * 更新备用关键字
   * 注意：兼容模式下，旧代码会直接操作 fallbackKeywordByTab[tabId]
   *
   * @param {number} tabId - 标签页 ID
   * @param {string} keyword - 备用关键字
   */
  updateFallback(tabId, keyword) {
    // 空实现，旧代码会直接更新全局对象
  }

  /**
   * 更新页面标题
   * 注意：兼容模式下，旧代码会直接操作 latestTitleByTab[tabId]
   *
   * @param {number} tabId - 标签页 ID
   * @param {string} title - 页面标题
   */
  updatePageTitle(tabId, title) {
    // 空实现，旧代码会直接更新全局对象
  }

  /**
   * 获取当前关键字状态
   *
   * @returns {KeywordState}
   */
  getState() {
    return { ...this.currentState };
  }

  /**
   * 获取指定标签页的关键字
   *
   * @param {number} tabId - 标签页 ID
   * @returns {string}
   */
  getKeywordForTab(tabId) {
    // 兼容模式：读取全局对象
    // BUGFIX: selectedTextByTab[tabId] is an object {text: '...', url: '...'}, not a string
    const selectedEntry = (typeof selectedTextByTab !== 'undefined' && selectedTextByTab[tabId]) || null;
    const selectedText = (typeof selectedEntry === 'object' && selectedEntry?.text) ||
                        (typeof selectedEntry === 'string' ? selectedEntry : '');
    const fallbackEntry = (typeof fallbackKeywordByTab !== 'undefined' && fallbackKeywordByTab[tabId]) || null;
    const fallbackKeyword = fallbackEntry?.raw || fallbackEntry?.keyword || '';
    const titleEntry = (typeof latestTitleByTab !== 'undefined' && latestTitleByTab[tabId]) || null;
    const pageTitle = titleEntry?.title || titleEntry?.pageTitle || '';

    return selectedText || fallbackKeyword || pageTitle || '';
  }

  /**
   * 清除指定标签页的缓存
   * 注意：兼容模式下，旧代码会直接操作全局对象
   *
   * @param {number} tabId - 标签页 ID
   */
  clearTabCache(tabId) {
    // 兼容模式：操作全局对象
    if (typeof selectedTextByTab !== 'undefined') {
      delete selectedTextByTab[tabId];
    }
    if (typeof fallbackKeywordByTab !== 'undefined') {
      delete fallbackKeywordByTab[tabId];
    }
    if (typeof latestTitleByTab !== 'undefined') {
      delete latestTitleByTab[tabId];
    }
  }

  /**
   * 订阅关键字变化事件
   *
   * @param {Function} callback - 回调函数，接收 KeywordState 作为参数
   * @returns {Function} 取消订阅函数
   */
  subscribe(callback) {
    if (typeof callback !== 'function') {
      console.warn('[KeywordSyncManager] Invalid callback for subscribe');
      return () => {};
    }

    this.subscribers.push(callback);

    // 返回取消订阅函数
    return () => {
      const index = this.subscribers.indexOf(callback);
      if (index > -1) {
        this.subscribers.splice(index, 1);
      }
    };
  }

  /**
   * 通知所有订阅者
   *
   * @private
   * @param {KeywordState} state - 关键字状态
   */
  _notifySubscribers(state) {
    for (const callback of this.subscribers) {
      try {
        callback(state);
      } catch (error) {
        console.error('[KeywordSyncManager] Error in subscriber callback:', error);
      }
    }
  }

  /**
   * 同步所有菜单标题
   *
   * @returns {Promise<{success: number, failed: number, total: number}>}
   */
  async syncMenus() {
    if (this.syncing) {
      // 避免并发同步
      if (typeof logMenuEvent === 'function') {
        logMenuEvent('sync-skipped-already-syncing', {});
      }
      return { success: 0, failed: 0, total: 0 };
    }

    this.syncing = true;

    try {
      const context = {
        keyword: this.currentState.display,
        raw: this.currentState.raw,
        normalized: this.currentState.normalized
      };

      if (typeof logMenuEvent === 'function') {
        logMenuEvent('sync-menus-start', {
          context,
          hasRegistry: !!this.menuRegistry
        });
      }

      const result = await this.menuRegistry.syncAll(context);

      if (typeof logMenuEvent === 'function') {
        logMenuEvent('keyword-sync-completed', result);
      }

      return result;
    } catch (error) {
      console.error('[KeywordSyncManager] Error syncing menus:', error);
      if (typeof logMenuEvent === 'function') {
        logMenuEvent('sync-menus-error', {
          error: error.message,
          stack: error.stack
        });
      }
      return { success: 0, failed: 0, total: 0 };
    } finally {
      this.syncing = false;
    }
  }

  /**
   * 同步特定组的菜单
   *
   * @param {string} groupName - 组名
   * @returns {Promise<{success: number, failed: number}>}
   */
  async syncGroup(groupName) {
    const context = {
      keyword: this.currentState.display,
      raw: this.currentState.raw,
      normalized: this.currentState.normalized
    };

    return await this.menuRegistry.syncGroup(groupName, context);
  }

  /**
   * 获取统计信息
   *
   * @returns {Object}
   */
  getStats() {
    // 兼容模式：统计全局对象
    const cachedTabs = (typeof selectedTextByTab !== 'undefined')
      ? Object.keys(selectedTextByTab).length : 0;
    const fallbackTabs = (typeof fallbackKeywordByTab !== 'undefined')
      ? Object.keys(fallbackKeywordByTab).length : 0;
    const titleTabs = (typeof latestTitleByTab !== 'undefined')
      ? Object.keys(latestTitleByTab).length : 0;

    return {
      currentState: this.currentState,
      cachedTabs,
      fallbackTabs,
      titleTabs,
      subscribers: this.subscribers.length
    };
  }

  /**
   * 清空所有状态
   * 注意：兼容模式下不清空全局对象，避免影响旧代码
   */
  clear() {
    this.currentState = {
      raw: '',
      normalized: '',
      display: '',
      tabId: null,
      timestamp: Date.now(),
      source: null
    };
    this.subscribers = [];

    // 不清空全局对象，因为旧代码可能还在使用
  }
}
