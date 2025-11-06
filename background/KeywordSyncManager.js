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

    /**
     * 按标签页缓存的选中文本（替代原有的 selectedTextByTab）
     * @type {Map<number, string>}
     */
    this.selectedTextByTab = new Map();

    /**
     * 按标签页缓存的备用关键字（替代原有的 fallbackKeywordByTab）
     * @type {Map<number, string>}
     */
    this.fallbackKeywordByTab = new Map();

    /**
     * 按标签页缓存的页面标题（替代原有的 latestTitleByTab）
     * @type {Map<number, string>}
     */
    this.latestTitleByTab = new Map();

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
    if (!chrome.contextMenus || !chrome.contextMenus.onShown) {
      console.warn('[KeywordSyncManager] chrome.contextMenus.onShown not available');
      return;
    }

    chrome.contextMenus.onShown.addListener(async (info, tab) => {
      try {
        // 获取当前标签页的最新关键字
        const tabId = tab?.id;
        if (!tabId) return;

        // 确保使用最新的关键字状态
        await this._refreshKeywordForTab(tabId);

        // 同步所有菜单标题
        await this.syncMenus();

        // 刷新菜单显示
        if (chrome.contextMenus.refresh) {
          chrome.contextMenus.refresh();
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
      // 尝试获取最新的选中文本
      const selectedText = this.selectedTextByTab.get(tabId) || '';
      const fallbackKeyword = this.fallbackKeywordByTab.get(tabId) || '';
      const pageTitle = this.latestTitleByTab.get(tabId) || '';

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

    // 如果有 tabId，更新对应的缓存
    if (tabId) {
      if (source === 'selection') {
        this.selectedTextByTab.set(tabId, raw);
      } else if (source === 'fallback') {
        this.fallbackKeywordByTab.set(tabId, raw);
      } else if (source === 'title') {
        this.latestTitleByTab.set(tabId, raw);
      }
    }

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
    this.selectedTextByTab.set(tabId, text || '');
    await this.update(text, null, { tabId, source: 'selection' });
  }

  /**
   * 更新备用关键字
   *
   * @param {number} tabId - 标签页 ID
   * @param {string} keyword - 备用关键字
   */
  updateFallback(tabId, keyword) {
    this.fallbackKeywordByTab.set(tabId, keyword || '');
  }

  /**
   * 更新页面标题
   *
   * @param {number} tabId - 标签页 ID
   * @param {string} title - 页面标题
   */
  updatePageTitle(tabId, title) {
    this.latestTitleByTab.set(tabId, title || '');
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
    return this.selectedTextByTab.get(tabId) ||
           this.fallbackKeywordByTab.get(tabId) ||
           this.latestTitleByTab.get(tabId) ||
           '';
  }

  /**
   * 清除指定标签页的缓存
   *
   * @param {number} tabId - 标签页 ID
   */
  clearTabCache(tabId) {
    this.selectedTextByTab.delete(tabId);
    this.fallbackKeywordByTab.delete(tabId);
    this.latestTitleByTab.delete(tabId);
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
      return { success: 0, failed: 0, total: 0 };
    }

    this.syncing = true;

    try {
      const context = {
        keyword: this.currentState.display,
        raw: this.currentState.raw,
        normalized: this.currentState.normalized
      };

      const result = await this.menuRegistry.syncAll(context);

      if (typeof logMenuEvent === 'function') {
        logMenuEvent('keyword-sync-completed', result);
      }

      return result;
    } catch (error) {
      console.error('[KeywordSyncManager] Error syncing menus:', error);
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
    return {
      currentState: this.currentState,
      cachedTabs: this.selectedTextByTab.size,
      fallbackTabs: this.fallbackKeywordByTab.size,
      titleTabs: this.latestTitleByTab.size,
      subscribers: this.subscribers.length
    };
  }

  /**
   * 清空所有状态
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
    this.selectedTextByTab.clear();
    this.fallbackKeywordByTab.clear();
    this.latestTitleByTab.clear();
    this.subscribers = [];
  }
}
