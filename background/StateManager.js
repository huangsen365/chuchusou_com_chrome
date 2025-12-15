/**
 * 状态管理器类
 *
 * 统一管理菜单系统的所有状态
 * 替代原有的 4 个全局状态对象：
 * - currentMenuState
 * - selectedTextByTab
 * - fallbackKeywordByTab
 * - latestTitleByTab
 *
 * 提供向后兼容的代理属性，支持渐进式迁移。
 *
 * @class StateManager
 */
class StateManager {
  constructor(options = {}) {
    /**
     * 配置选项
     */
    this.options = {
      // 状态过期时间（毫秒）
      stateExpiry: options.stateExpiry || 5 * 60 * 1000, // 默认 5 分钟
      // 自动清理间隔（毫秒）
      autoCleanupInterval: options.autoCleanupInterval || 60 * 1000, // 默认 1 分钟
      // 是否启用调试日志
      debug: options.debug || false,
      // 缓存过期时间配置
      cacheExpiry: {
        title: options.titleCacheExpiry || 30000,      // 标题缓存 30 秒
        keyword: options.keywordCacheExpiry || 30000,  // 关键词缓存 30 秒
        selection: options.selectionCacheExpiry || 10000 // 选区缓存 10 秒
      }
    };

    /**
     * 当前全局菜单状态
     * 对应原来的 currentMenuState
     */
    this.currentState = {
      raw: '',           // 原始文本
      normalized: '',    // 标准化后的文本
      display: '',       // 显示文本（截断）
      tabId: null,       // 标签页 ID
      url: '',           // 标签页 URL
      timestamp: null    // 更新时间戳
    };

    /**
     * 标签页状态存储
     * 使用 Map 代替普通对象，性能更好
     * key: tabId (number)
     * value: TabState 对象
     */
    this.tabStates = new Map();

    /**
     * 自动清理定时器
     */
    this.cleanupTimer = null;

    // 启动自动清理
    this._startAutoCleanup();
  }

  /**
   * 获取或创建标签页状态
   *
   * @param {number} tabId - 标签页 ID
   * @returns {TabState}
   */
  _getOrCreateTabState(tabId) {
    if (!this.tabStates.has(tabId)) {
      this.tabStates.set(tabId, {
        // 选中文本（对应 selectedTextByTab）
        selection: {
          text: '',
          url: '',
          timestamp: null
        },
        // 备用关键词（对应 fallbackKeywordByTab）
        fallback: {
          raw: '',
          normalized: '',
          url: '',
          timestamp: null
        },
        // 最新标题（对应 latestTitleByTab）
        title: {
          text: '',
          keyword: '',
          url: '',
          timestamp: null
        },
        // 元数据
        meta: {
          url: '',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      });
    }
    return this.tabStates.get(tabId);
  }

  /**
   * 更新当前全局菜单状态
   *
   * @param {Object} state - 状态对象
   * @param {string} state.raw - 原始文本
   * @param {string} state.normalized - 标准化文本
   * @param {string} state.display - 显示文本
   * @param {number} [state.tabId] - 标签页 ID
   * @param {string} [state.url] - 标签页 URL
   */
  setCurrentState({ raw, normalized, display, tabId, url }) {
    this.currentState = {
      raw: raw || '',
      normalized: normalized || '',
      display: display || '',
      tabId: tabId || null,
      url: url || '',
      timestamp: Date.now()
    };

    this._log('setCurrentState', this.currentState);
  }

  /**
   * 获取当前全局菜单状态
   *
   * @returns {Object}
   */
  getCurrentState() {
    return { ...this.currentState };
  }

  /**
   * 更新标签页选中文本
   *
   * @param {number} tabId - 标签页 ID
   * @param {string} text - 选中的文本
   * @param {string} [url] - 标签页 URL
   */
  setSelection(tabId, text, url = '') {
    const state = this._getOrCreateTabState(tabId);
    state.selection = {
      text: text || '',
      url: url || '',
      timestamp: Date.now()
    };
    state.meta.updatedAt = Date.now();

    this._log('setSelection', { tabId, text, url });
  }

  /**
   * 获取标签页选中文本
   *
   * @param {number} tabId - 标签页 ID
   * @returns {Object|null}
   */
  getSelection(tabId) {
    const state = this.tabStates.get(tabId);
    return state ? { ...state.selection } : null;
  }

  /**
   * 更新标签页备用关键词
   *
   * @param {number} tabId - 标签页 ID
   * @param {string} raw - 原始关键词
   * @param {string} normalized - 标准化关键词
   * @param {string} [url] - 标签页 URL
   */
  setFallback(tabId, raw, normalized, url = '') {
    const state = this._getOrCreateTabState(tabId);
    state.fallback = {
      raw: raw || '',
      normalized: normalized || '',
      url: url || '',
      timestamp: Date.now()
    };
    state.meta.updatedAt = Date.now();

    this._log('setFallback', { tabId, raw, normalized, url });
  }

  /**
   * 获取标签页备用关键词
   *
   * @param {number} tabId - 标签页 ID
   * @returns {Object|null}
   */
  getFallback(tabId) {
    const state = this.tabStates.get(tabId);
    return state ? { ...state.fallback } : null;
  }

  /**
   * 更新标签页标题
   *
   * @param {number} tabId - 标签页 ID
   * @param {string} title - 标题
   * @param {string} [keyword] - 提取的关键词
   * @param {string} [url] - 标签页 URL
   */
  setTitle(tabId, title, keyword = '', url = '') {
    const state = this._getOrCreateTabState(tabId);
    state.title = {
      text: title || '',
      keyword: keyword || '',
      url: url || '',
      timestamp: Date.now()
    };
    state.meta.updatedAt = Date.now();

    this._log('setTitle', { tabId, title, keyword, url });
  }

  /**
   * 获取标签页标题
   *
   * @param {number} tabId - 标签页 ID
   * @returns {Object|null}
   */
  getTitle(tabId) {
    const state = this.tabStates.get(tabId);
    return state ? { ...state.title } : null;
  }

  /**
   * 获取标签页的完整状态
   *
   * @param {number} tabId - 标签页 ID
   * @returns {Object|null}
   */
  getTabState(tabId) {
    const state = this.tabStates.get(tabId);
    if (!state) return null;

    return {
      selection: { ...state.selection },
      fallback: { ...state.fallback },
      title: { ...state.title },
      meta: { ...state.meta }
    };
  }

  /**
   * 删除标签页状态
   *
   * @param {number} tabId - 标签页 ID
   */
  deleteTabState(tabId) {
    const deleted = this.tabStates.delete(tabId);
    if (deleted) {
      this._log('deleteTabState', { tabId });
    }
    return deleted;
  }

  /**
   * 清理过期的标签页状态
   *
   * @returns {number} 清理的标签页数量
   */
  cleanupExpiredStates() {
    const now = Date.now();
    const expiry = this.options.stateExpiry;
    let count = 0;

    for (const [tabId, state] of this.tabStates.entries()) {
      if (now - state.meta.updatedAt > expiry) {
        this.tabStates.delete(tabId);
        count++;
      }
    }

    if (count > 0) {
      this._log('cleanupExpiredStates', { count, total: this.tabStates.size });
    }

    return count;
  }

  /**
   * 清理所有状态
   */
  clearAll() {
    this.currentState = {
      raw: '',
      normalized: '',
      display: '',
      tabId: null,
      url: '',
      timestamp: null
    };
    this.tabStates.clear();

    this._log('clearAll');
  }

  /**
   * 获取状态统计信息
   *
   * @returns {Object}
   */
  getStats() {
    return {
      currentState: {
        hasContent: !!this.currentState.raw,
        tabId: this.currentState.tabId,
        timestamp: this.currentState.timestamp
      },
      tabStates: {
        total: this.tabStates.size,
        tabIds: Array.from(this.tabStates.keys())
      }
    };
  }

  /**
   * 检查当前状态是否可以保留
   * （基于 URL 和 Tab ID 判断）
   *
   * @param {number} currentTabId - 当前标签页 ID
   * @param {string} currentUrl - 当前 URL
   * @returns {boolean}
   */
  canPreserveCurrentState(currentTabId, currentUrl) {
    if (!this.currentState.raw) {
      return false;
    }

    // 如果标签页 ID 匹配
    if (this.currentState.tabId === currentTabId) {
      return true;
    }

    // 如果 URL 匹配（允许部分 URL 变化）
    if (this.currentState.url && currentUrl) {
      const currentDomain = this._extractDomain(currentUrl);
      const stateDomain = this._extractDomain(this.currentState.url);
      if (currentDomain === stateDomain) {
        return true;
      }
    }

    return false;
  }

  /**
   * 提取 URL 的域名
   *
   * @param {string} url
   * @returns {string}
   * @private
   */
  _extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return '';
    }
  }

  /**
   * 启动自动清理定时器
   * @private
   */
  _startAutoCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredStates();
    }, this.options.autoCleanupInterval);

    this._log('_startAutoCleanup', {
      interval: this.options.autoCleanupInterval
    });
  }

  /**
   * 停止自动清理
   */
  stopAutoCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      this._log('stopAutoCleanup');
    }
  }

  /**
   * 调试日志
   * @private
   */
  _log(action, data) {
    if (!this.options.debug) return;

    console.log(`[StateManager] ${action}`, data || '');
  }

  /**
   * 销毁状态管理器
   */
  destroy() {
    this.stopAutoCleanup();
    this.clearAll();
    this._log('destroy');
  }

  // ==================== 向后兼容的代理方法 ====================
  // 这些方法提供与旧全局变量相同的接口，便于渐进式迁移

  /**
   * 获取标签页的页面标题（兼容 getLatestTabPageTitle）
   * @param {number} tabId - 标签页 ID
   * @param {number} maxAge - 最大缓存年龄（毫秒）
   * @returns {string}
   */
  getLatestTabPageTitle(tabId, maxAge = null) {
    if (tabId == null) return '';
    const state = this.tabStates.get(tabId);
    if (!state || !state.title) return '';

    const effectiveMaxAge = maxAge || this.options.cacheExpiry.title;
    const now = Date.now();
    const age = now - (state.title.timestamp || 0);

    if (age > effectiveMaxAge) {
      this._log('getLatestTabPageTitle-expired', { tabId, age, maxAge: effectiveMaxAge });
      return '';
    }

    return state.title.text || '';
  }

  /**
   * 获取标签页的关键词（兼容 getLatestTabKeyword）
   * @param {number} tabId - 标签页 ID
   * @param {number} maxAge - 最大缓存年龄（毫秒）
   * @returns {string}
   */
  getLatestTabKeyword(tabId, maxAge = null) {
    if (tabId == null) return '';
    const state = this.tabStates.get(tabId);
    if (!state || !state.title) return '';

    const effectiveMaxAge = maxAge || this.options.cacheExpiry.keyword;
    const now = Date.now();
    const age = now - (state.title.timestamp || 0);

    if (age > effectiveMaxAge) {
      this._log('getLatestTabKeyword-expired', { tabId, age, maxAge: effectiveMaxAge });
      return '';
    }

    return state.title.keyword || '';
  }

  /**
   * 更新标签页的标题（兼容 updateLatestTabTitle）
   * @param {number} tabId - 标签页 ID
   * @param {string} pageTitle - 页面标题
   */
  updateLatestTabTitle(tabId, pageTitle) {
    if (tabId == null || typeof pageTitle !== 'string') return;
    const state = this._getOrCreateTabState(tabId);
    state.title.text = pageTitle;
    state.title.timestamp = Date.now();
    state.meta.updatedAt = Date.now();
    this._log('updateLatestTabTitle', { tabId, pageTitle });
  }

  /**
   * 更新标签页的关键词（兼容 updateLatestTabKeyword）
   * @param {number} tabId - 标签页 ID
   * @param {string} keyword - 关键词
   * @param {string} normalized - 标准化后的关键词
   */
  updateLatestTabKeyword(tabId, keyword, normalized) {
    if (tabId == null || typeof keyword !== 'string') return;
    const state = this._getOrCreateTabState(tabId);
    state.title.keyword = keyword;
    if (typeof normalized === 'string') {
      state.fallback.normalized = normalized;
    }
    state.title.timestamp = Date.now();
    state.meta.updatedAt = Date.now();
    this._log('updateLatestTabKeyword', { tabId, keyword, normalized });
  }

  /**
   * 获取或创建标题条目（兼容 getOrCreateTitleEntry）
   * @param {number} tabId - 标签页 ID
   * @returns {Object|null}
   */
  getOrCreateTitleEntry(tabId) {
    if (tabId == null) return null;
    const state = this._getOrCreateTabState(tabId);
    // 返回一个兼容旧格式的对象
    return {
      title: state.title.text,
      pageTitle: state.title.text,
      keyword: state.title.keyword,
      keywordNormalized: state.fallback.normalized,
      timestamp: state.title.timestamp,
      keywordTimestamp: state.title.timestamp
    };
  }

  /**
   * 获取选中文本（兼容 selectedTextByTab[tabId]）
   * @param {number} tabId - 标签页 ID
   * @returns {Object|null} - { text, url, timestamp }
   */
  getSelectedText(tabId) {
    if (tabId == null) return null;
    const state = this.tabStates.get(tabId);
    if (!state) return null;
    return {
      text: state.selection.text,
      url: state.selection.url,
      timestamp: state.selection.timestamp
    };
  }

  /**
   * 设置选中文本（兼容 selectedTextByTab[tabId] = ...）
   * @param {number} tabId - 标签页 ID
   * @param {string} text - 选中的文本
   * @param {string} url - 页面 URL
   */
  setSelectedText(tabId, text, url = '') {
    if (tabId == null) return;
    this.setSelection(tabId, text, url);
  }

  /**
   * 获取备用关键词（兼容 fallbackKeywordByTab[tabId]）
   * @param {number} tabId - 标签页 ID
   * @returns {Object|null} - { raw, normalized, url, timestamp }
   */
  getFallbackKeyword(tabId) {
    if (tabId == null) return null;
    const state = this.tabStates.get(tabId);
    if (!state) return null;
    return {
      raw: state.fallback.raw,
      normalized: state.fallback.normalized,
      url: state.fallback.url,
      timestamp: state.fallback.timestamp
    };
  }

  /**
   * 设置备用关键词（兼容 fallbackKeywordByTab[tabId] = ...）
   * @param {number} tabId - 标签页 ID
   * @param {Object} data - { raw, normalized, url }
   */
  setFallbackKeyword(tabId, data) {
    if (tabId == null || !data) return;
    this.setFallback(tabId, data.raw, data.normalized, data.url);
  }

  /**
   * 判断 URL 是否为需要保留菜单状态的快速结果页面
   * @param {string} url - URL 字符串
   * @returns {boolean}
   */
  shouldPreserveMenuStateForUrl(url) {
    if (!url) return false;
    try {
      const hostname = new URL(url).hostname;
      // 使用 Constants.js 中的 QUICK_RESULT_HOSTS（如果可用）
      const quickResultHosts = typeof QUICK_RESULT_HOSTS !== 'undefined'
        ? QUICK_RESULT_HOSTS
        : ['chatgpt.com', 'claude.ai'];
      return quickResultHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    } catch (_) {
      return false;
    }
  }

  /**
   * 判断标签页是否为需要保留菜单状态的快速结果页面
   * @param {Object} tab - 标签页对象
   * @returns {boolean}
   */
  shouldPreserveMenuStateForTab(tab) {
    if (!tab || typeof tab.url !== 'string') return false;
    return this.shouldPreserveMenuStateForUrl(tab.url);
  }

  /**
   * 创建向后兼容的代理对象
   * 用于逐步替换全局变量
   * @returns {Object}
   */
  createLegacyProxy() {
    const self = this;

    return {
      // currentMenuState 代理
      get currentMenuState() {
        return self.getCurrentState();
      },

      // selectedTextByTab 代理
      selectedTextByTab: new Proxy({}, {
        get(target, tabId) {
          const numTabId = parseInt(tabId, 10);
          if (isNaN(numTabId)) return undefined;
          return self.getSelectedText(numTabId);
        },
        set(target, tabId, value) {
          const numTabId = parseInt(tabId, 10);
          if (isNaN(numTabId)) return false;
          if (value && typeof value === 'object') {
            self.setSelectedText(numTabId, value.text, value.url);
          }
          return true;
        }
      }),

      // fallbackKeywordByTab 代理
      fallbackKeywordByTab: new Proxy({}, {
        get(target, tabId) {
          const numTabId = parseInt(tabId, 10);
          if (isNaN(numTabId)) return undefined;
          return self.getFallbackKeyword(numTabId);
        },
        set(target, tabId, value) {
          const numTabId = parseInt(tabId, 10);
          if (isNaN(numTabId)) return false;
          if (value && typeof value === 'object') {
            self.setFallbackKeyword(numTabId, value);
          }
          return true;
        }
      }),

      // latestTitleByTab 代理
      latestTitleByTab: new Proxy({}, {
        get(target, tabId) {
          const numTabId = parseInt(tabId, 10);
          if (isNaN(numTabId)) return undefined;
          return self.getOrCreateTitleEntry(numTabId);
        },
        set(target, tabId, value) {
          const numTabId = parseInt(tabId, 10);
          if (isNaN(numTabId)) return false;
          if (value && typeof value === 'object') {
            if (value.title || value.pageTitle) {
              self.updateLatestTabTitle(numTabId, value.title || value.pageTitle);
            }
            if (value.keyword) {
              self.updateLatestTabKeyword(numTabId, value.keyword, value.keywordNormalized);
            }
          }
          return true;
        }
      })
    };
  }
}

/**
 * TabState 类型定义（仅用于文档）
 * @typedef {Object} TabState
 * @property {Object} selection - 选中文本
 * @property {string} selection.text
 * @property {string} selection.url
 * @property {number} selection.timestamp
 * @property {Object} fallback - 备用关键词
 * @property {string} fallback.raw
 * @property {string} fallback.normalized
 * @property {string} fallback.url
 * @property {number} fallback.timestamp
 * @property {Object} title - 标题
 * @property {string} title.text
 * @property {string} title.keyword
 * @property {string} title.url
 * @property {number} title.timestamp
 * @property {Object} meta - 元数据
 * @property {string} meta.url
 * @property {number} meta.createdAt
 * @property {number} meta.updatedAt
 */
