/**
 * 触触搜 - 菜单更新器
 * 负责动态更新菜单标题
 *
 * @module menu/MenuUpdater
 */

/**
 * 菜单更新器类
 */
class MenuUpdater {
  constructor(options = {}) {
    this.debug = options.debug || false;
    this.stateManager = options.stateManager || null;

    // 最大显示长度
    this.maxDisplayLength = options.maxDisplayLength || 20;

    // 需要动态更新标题的菜单 ID 列表
    this.dynamicMenuIds = new Set([
      'ccs-main',
      'ccs-search-label',
      'ccs-top100-label',
      'ccs-fastqa-label'
    ]);

    // 优化提示词分类标签 ID 模式
    this.optimizeLabelPattern = /^ccs-optimize-[\w-]+-label$/;
  }

  /**
   * 添加动态菜单 ID
   * @param {string} menuId - 菜单 ID
   */
  addDynamicMenuId(menuId) {
    this.dynamicMenuIds.add(menuId);
  }

  /**
   * 检查是否为动态菜单
   * @param {string} menuId - 菜单 ID
   * @returns {boolean}
   */
  isDynamicMenu(menuId) {
    return this.dynamicMenuIds.has(menuId) ||
           this.optimizeLabelPattern.test(menuId);
  }

  /**
   * 格式化菜单标题
   * @param {string} text - 原始文本
   * @param {number} maxLength - 最大长度
   * @returns {string|null}
   */
  formatTitle(text, maxLength = null) {
    const effectiveMaxLength = maxLength || this.maxDisplayLength;
    if (!text) return null;
    const compact = text.replace(/\s+/g, ' ').trim();
    if (!compact) return null;
    return compact.substring(0, effectiveMaxLength) +
           (compact.length > effectiveMaxLength ? '...' : '');
  }

  /**
   * 构建带关键词的菜单标题
   * @param {Object} options - 配置选项
   * @returns {string}
   */
  buildMenuTitle({ icon = '🔍', title = '触触搜', keyword = '' }) {
    const formattedKeyword = keyword ? this.formatTitle(keyword) : '';
    if (formattedKeyword) {
      return `${icon} ${title}: "${formattedKeyword}"`;
    }
    return `${icon} ${title}`;
  }

  /**
   * 更新主菜单标题
   * @param {string} keyword - 关键词
   * @returns {Promise<void>}
   */
  async updateMainMenuTitle(keyword) {
    const title = this.buildMenuTitle({
      icon: '🔍',
      title: '触触搜',
      keyword
    });

    return this.updateMenuTitle('ccs-main', title);
  }

  /**
   * 更新指定菜单的标题
   * @param {string} menuId - 菜单 ID
   * @param {string} title - 新标题
   * @returns {Promise<void>}
   */
  updateMenuTitle(menuId, title) {
    return new Promise((resolve) => {
      try {
        chrome.contextMenus.update(menuId, { title }, () => {
          if (chrome.runtime.lastError) {
            this._log('updateMenuTitle-error', {
              menuId,
              error: chrome.runtime.lastError.message
            });
          }
          resolve();
        });
      } catch (error) {
        this._log('updateMenuTitle-exception', {
          menuId,
          error: error.message
        });
        resolve();
      }
    });
  }

  /**
   * 批量更新标签菜单的标题
   * @param {string} keyword - 关键词
   * @param {Array<string>} labelIds - 标签菜单 ID 列表
   * @returns {Promise<void>}
   */
  async updateLabelMenuTitles(keyword, labelIds = []) {
    const formattedKeyword = keyword ? this.formatTitle(keyword) : '';
    const title = formattedKeyword
      ? `🔍 触触搜: "${formattedKeyword}"`
      : '🔍 触触搜';

    const updatePromises = labelIds.map((labelId) =>
      this.updateMenuTitle(labelId, title)
    );

    await Promise.allSettled(updatePromises);
  }

  /**
   * 从标签页获取关键词
   * @param {Object} tab - 标签页对象
   * @param {Object} info - contextMenus 信息
   * @returns {string}
   */
  getKeywordFromContext(tab, info = {}) {
    // 优先使用选中文本
    if (info.selectionText && info.selectionText.trim()) {
      return info.selectionText.trim();
    }

    // 尝试从 StateManager 获取
    if (this.stateManager) {
      const tabId = tab?.id;
      if (tabId != null) {
        const selection = this.stateManager.getSelectedText(tabId);
        if (selection && selection.text) {
          return selection.text;
        }

        const keyword = this.stateManager.getLatestTabKeyword(tabId);
        if (keyword) {
          return keyword;
        }
      }
    }

    // 回退到标签页标题
    if (tab && tab.title) {
      return this.extractKeywordFromTitle(tab.title);
    }

    return '';
  }

  /**
   * 从标题中提取关键词
   * @param {string} title - 页面标题
   * @returns {string}
   */
  extractKeywordFromTitle(title) {
    if (!title) return '';

    // 使用 TextUtils 中的函数（如果可用）
    if (typeof extractKeywordFromTitle === 'function') {
      return extractKeywordFromTitle(title);
    }

    // 简单处理：移除常见网站后缀
    let cleaned = title;
    const suffixes = [
      ' - 百度搜索',
      ' - Google 搜索',
      ' - 知乎',
      ' - ChatGPT',
      ' - Claude',
      ' | ',
      ' - ',
      ' – ',
      ' — '
    ];

    for (const suffix of suffixes) {
      const index = cleaned.lastIndexOf(suffix);
      if (index > 0) {
        cleaned = cleaned.substring(0, index);
        break;
      }
    }

    return cleaned.trim();
  }

  /**
   * 处理菜单显示事件
   * @param {Object} info - contextMenus.onShown 信息
   * @param {Object} tab - 标签页对象
   * @returns {Promise<void>}
   */
  async handleMenuShown(info, tab) {
    const keyword = this.getKeywordFromContext(tab, info);

    // 更新主菜单
    await this.updateMainMenuTitle(keyword);

    // 更新所有标签菜单
    const labelIds = [
      'ccs-search-label',
      'ccs-top100-label',
      'ccs-fastqa-label'
    ];

    // 添加优化提示词分类标签
    // 这些在 menuBuilder.js 中动态创建
    const optimizeLabelIds = this._getOptimizeLabelIds();
    labelIds.push(...optimizeLabelIds);

    await this.updateLabelMenuTitles(keyword, labelIds);

    // 刷新菜单
    if (chrome.contextMenus.refresh) {
      chrome.contextMenus.refresh();
    }

    this._log('handleMenuShown', {
      keyword,
      tabId: tab?.id,
      updatedLabels: labelIds.length
    });
  }

  /**
   * 获取优化提示词分类标签 ID 列表
   * @returns {Array<string>}
   * @private
   */
  _getOptimizeLabelIds() {
    // 从 Constants.js 中获取分类
    const categories = typeof OPTIMIZE_CATEGORY_TITLES !== 'undefined'
      ? Object.keys(OPTIMIZE_CATEGORY_TITLES)
      : [
          'deep-research',
          'general-conversation',
          'code-writing',
          'content-creation',
          'data-analysis',
          'problem-solving',
          'brainstorm',
          'description-polish'
        ];

    return categories.map((cat) => `ccs-optimize-${cat}-label`);
  }

  /**
   * 调试日志
   * @private
   */
  _log(action, data) {
    if (!this.debug) return;
    console.log(`[MenuUpdater] ${action}`, data || '');
  }
}

// 导出到全局
if (typeof globalThis !== 'undefined') {
  globalThis.MenuUpdater = MenuUpdater;
}
