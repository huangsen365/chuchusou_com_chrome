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
      debug: options.debug || false
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
