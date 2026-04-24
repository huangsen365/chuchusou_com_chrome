/**
 * 触触搜 - 菜单构建器
 * 负责创建和管理右键菜单的结构
 *
 * @module menu/MenuBuilder
 */

/**
 * 菜单上下文配置
 */
const MenuContexts = {
  DEFAULT: ['selection', 'page'],
  WITH_EDITABLE: ['selection', 'page', 'editable'],
  ALL: ['all']
};

/**
 * 菜单分组定义
 * 使用 FAST_QA_QUICK_ITEMS 和 MENU_DEFINITIONS 从 Constants.js
 */
const MenuGroups = Object.freeze({
  fastQaQuick: typeof FAST_QA_QUICK_ITEMS !== 'undefined'
    ? FAST_QA_QUICK_ITEMS.map((item) => item.id)
    : [],
  search: [
    { id: 'ccs-baidu' },
    { id: 'ccs-google' }
  ],
  ai: [
    { id: 'ccs-chatgpt' },
    { id: 'ccs-claude' },
    { id: 'ccs-grok' }
  ],
  general: [
    { id: 'ccs-yiyan' },
    { id: 'ccs-zhihu' },
    { id: 'ccs-weixin' },
    { id: 'ccs-taobao' },
    { id: 'ccs-jd' },
    { id: 'ccs-sov2ex' },
    { id: 'ccs-google-translate' },
    { id: 'ccs-chuchusou' }
  ],
  tool: [
    { id: 'ccs-copy' },
    { id: 'ccs-base64' },
    { id: 'ccs-md5' },
    { id: 'ccs-url-encode' }
  ],
  transform: [
    { id: 'ccs-upper' },
    { id: 'ccs-lower' }
  ]
});

/**
 * 菜单构建器类
 */
class MenuBuilder {
  constructor(options = {}) {
    this.debug = options.debug || false;
    this.buildCounter = 0;
    this.buildInProgress = false;
    this.buildPending = false;
  }

  /**
   * 提取错误信息
   * @param {*} error - 错误对象
   * @returns {string}
   */
  static extractErrorMessage(error) {
    if (!error) return '';
    if (typeof error === 'string') return error;
    if (typeof error.message === 'string') return error.message;
    try {
      return JSON.stringify(error);
    } catch (_) {
      return String(error);
    }
  }

  /**
   * 创建单个菜单项
   * @param {Object} options - chrome.contextMenus.create 选项
   * @param {Object} meta - 元数据
   * @returns {Promise<{ok: boolean, error?: Object}>}
   */
  createMenuItem(options, meta = {}) {
    const { onSuccess, onError, failureLogStage } = meta;
    return new Promise((resolve) => {
      try {
        chrome.contextMenus.create(options, () => {
          const error = chrome.runtime.lastError;
          if (error) {
            if (failureLogStage && options?.id) {
              this._log(failureLogStage, {
                id: options.id,
                error: MenuBuilder.extractErrorMessage(error)
              });
            }
            if (onError) {
              onError(error, options);
            }
            resolve({ ok: false, error });
            return;
          }
          if (onSuccess) {
            onSuccess(options);
          }
          resolve({ ok: true });
        });
      } catch (error) {
        if (failureLogStage && options?.id) {
          this._log(failureLogStage, {
            id: options.id,
            error: MenuBuilder.extractErrorMessage(error)
          });
        }
        if (onError) {
          onError(error, options);
        }
        resolve({ ok: false, error });
      }
    });
  }

  /**
   * 移除所有菜单
   * @returns {Promise<void>}
   */
  async removeAllMenus() {
    if (typeof chrome?.contextMenus?.removeAll !== 'function') {
      return;
    }
    if (chrome.contextMenus.removeAll.length === 0) {
      await chrome.contextMenus.removeAll();
      return;
    }
    await new Promise((resolve, reject) => {
      chrome.contextMenus.removeAll(() => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(MenuBuilder.extractErrorMessage(error)));
          return;
        }
        resolve();
      });
    });
  }

  /**
   * 创建一组菜单项
   * @param {Object} options - 配置选项
   * @returns {Promise<void>}
   */
  async createMenuItemsGroup({ parentId, menuItems, contexts = MenuContexts.DEFAULT, failureStage }) {
    const normalizedItems = Array.isArray(menuItems) ? menuItems : [];
    for (const item of normalizedItems) {
      const menuId = typeof item === 'string' ? item : item?.id;
      if (!menuId) continue;

      // 使用全局 isMenuEnabled 函数检查是否启用
      if (typeof isMenuEnabled === 'function' && !isMenuEnabled(menuId)) continue;

      // 使用 Constants.js 中的 getMenuTitle
      const title = typeof getMenuTitle === 'function'
        ? getMenuTitle(menuId)
        : menuId;

      await this.createMenuItem({
        id: menuId,
        parentId,
        title,
        contexts
      }, {
        onError: (error) => {
          if (failureStage) {
            this._log(failureStage, {
              id: menuId,
              error: MenuBuilder.extractErrorMessage(error)
            });
          }
        }
      });
    }
  }

  /**
   * 创建快捷菜单项
   * @param {Map} quickEnabledMap - 启用状态映射
   * @returns {Promise<void>}
   */
  async createQuickMenuItems(quickEnabledMap) {
    const quickItems = typeof FAST_QA_QUICK_ITEMS !== 'undefined' ? FAST_QA_QUICK_ITEMS : [];
    for (const item of quickItems) {
      if (!quickEnabledMap.get(item.id)) continue;

      const title = typeof getMenuTitle === 'function'
        ? getMenuTitle(item.id)
        : item.menuTitle || item.id;

      await this.createMenuItem({
        id: item.id,
        parentId: 'ccs-main',
        title,
        contexts: MenuContexts.WITH_EDITABLE
      }, {
        onError: (error) => {
          this._log('fastqa-quick-child-create-failed', {
            id: item.id,
            error: MenuBuilder.extractErrorMessage(error)
          });
        }
      });
    }
  }

  /**
   * 创建分隔符
   * @param {string} parentId - 父菜单 ID
   * @param {string} id - 分隔符 ID
   * @param {Array} contexts - 上下文
   * @returns {Promise<void>}
   */
  async createSeparator(parentId, id, contexts = MenuContexts.DEFAULT) {
    await this.createMenuItem({
      id,
      parentId,
      type: 'separator',
      contexts
    });
  }

  /**
   * 创建标签菜单项（禁用，仅作为标签显示）
   * @param {Object} options - 配置选项
   * @returns {Promise<{ok: boolean, error?: Object}>}
   */
  async createLabelMenuItem({ id, parentId, title = '触触搜', icon = '🔍', contexts = MenuContexts.DEFAULT }) {
    const result = await this.createMenuItem({
      id,
      parentId,
      title: `${icon} ${title}`,
      enabled: false,
      contexts
    }, {
      failureLogStage: `${id}-create-failed`
    });

    // 注册到 MenuRegistry
    if (result.ok && typeof menuRegistry !== 'undefined' && menuRegistry) {
      menuRegistry.register({
        id,
        parentId,
        title,
        icon,
        titleTemplate: '${icon} ${title}: "${keyword}"',
        syncGroup: 'labels',
        autoSync: true
      });
    }

    return result;
  }

  /**
   * 检查构建 ID 是否过期
   * @param {number} buildId - 构建 ID
   * @returns {boolean}
   */
  isStaleBuild(buildId) {
    return buildId !== this.buildCounter;
  }

  /**
   * 调试日志
   * @private
   */
  _log(action, data) {
    if (!this.debug && typeof logMenuEvent !== 'function') return;

    if (typeof logMenuEvent === 'function') {
      logMenuEvent(action, data);
    } else {
      console.log(`[MenuBuilder] ${action}`, data || '');
    }
  }
}

// 导出到全局
if (typeof globalThis !== 'undefined') {
  globalThis.MenuBuilder = MenuBuilder;
  globalThis.MenuContexts = MenuContexts;
  globalThis.MenuGroups = MenuGroups;
}
