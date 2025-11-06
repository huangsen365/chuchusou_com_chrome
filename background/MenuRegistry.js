/**
 * 菜单注册表模块
 *
 * 提供配置驱动的菜单管理和关键字同步机制
 * 核心功能：
 * 1. 自动注册需要动态标题的菜单项
 * 2. 基于模板渲染菜单标题
 * 3. 统一的同步接口，解耦菜单结构和同步逻辑
 *
 * @module MenuRegistry
 */

/**
 * 菜单配置接口
 * @typedef {Object} MenuConfig
 * @property {string} id - 菜单项 ID
 * @property {string} [parentId] - 父菜单 ID
 * @property {string} title - 基础标题
 * @property {string} [icon] - 图标
 * @property {string} [titleTemplate] - 标题模板，支持占位符：${keyword}, ${icon}, ${title}, ${raw}, ${normalized}
 * @property {string} [syncGroup] - 同步组名（如 'labels', 'main', 'dynamic'）
 * @property {boolean} [autoSync] - 是否自动同步（默认根据 titleTemplate 自动判断）
 * @property {Function} [onSyncFailed] - 同步失败回调
 * @property {Object} [createOptions] - chrome.contextMenus.create 的其他选项
 */

/**
 * 同步上下文接口
 * @typedef {Object} SyncContext
 * @property {string} keyword - 显示用的格式化关键字
 * @property {string} raw - 原始关键字
 * @property {string} normalized - 规范化后的关键字
 * @property {number} [tabId] - 标签页 ID
 */

class MenuRegistry {
  constructor() {
    /**
     * 菜单项配置映射
     * @type {Map<string, MenuConfig>}
     */
    this.items = new Map();

    /**
     * 同步组映射
     * @type {Map<string, Set<string>>}
     */
    this.syncGroups = new Map();

    /**
     * 需要动态同步的菜单项集合
     * @type {Set<string>}
     */
    this.syncableItems = new Set();

    /**
     * 约定规则：以 -label 结尾的菜单自动识别为标签
     * @type {RegExp}
     */
    this.labelPattern = /-label$/;

    /**
     * 标题模板中的占位符模式
     * @type {RegExp}
     */
    this.keywordPlaceholderPattern = /\$\{keyword\}/i;
  }

  /**
   * 注册菜单项
   *
   * @param {MenuConfig} config - 菜单配置
   * @returns {boolean} 是否成功注册
   */
  register(config) {
    if (!config || !config.id) {
      console.warn('[MenuRegistry] Invalid config: missing id', config);
      return false;
    }

    // 存储配置
    this.items.set(config.id, config);

    // 判断是否需要同步
    const needsSync = this._shouldSync(config);

    if (needsSync) {
      this.syncableItems.add(config.id);

      // 加入同步组
      if (config.syncGroup) {
        if (!this.syncGroups.has(config.syncGroup)) {
          this.syncGroups.set(config.syncGroup, new Set());
        }
        this.syncGroups.get(config.syncGroup).add(config.id);
      }
    }

    return true;
  }

  /**
   * 注销菜单项
   *
   * @param {string} menuId - 菜单 ID
   */
  unregister(menuId) {
    const config = this.items.get(menuId);
    if (!config) return;

    // 从所有结构中移除
    this.items.delete(menuId);
    this.syncableItems.delete(menuId);

    if (config.syncGroup) {
      const group = this.syncGroups.get(config.syncGroup);
      if (group) {
        group.delete(menuId);
        if (group.size === 0) {
          this.syncGroups.delete(config.syncGroup);
        }
      }
    }
  }

  /**
   * 判断菜单项是否需要同步
   *
   * 约定优于配置：
   * 1. 显式设置 autoSync = true
   * 2. 标题模板包含 ${keyword} 占位符
   * 3. 菜单 ID 以 -label 结尾
   *
   * @private
   * @param {MenuConfig} config - 菜单配置
   * @returns {boolean}
   */
  _shouldSync(config) {
    // 显式配置
    if (config.autoSync === true) return true;
    if (config.autoSync === false) return false;

    // 约定 1: 标题模板包含关键字占位符
    if (config.titleTemplate && this.keywordPlaceholderPattern.test(config.titleTemplate)) {
      return true;
    }

    // 约定 2: ID 以 -label 结尾
    if (this.labelPattern.test(config.id)) {
      return true;
    }

    // 约定 3: 属于某个同步组
    if (config.syncGroup) {
      return true;
    }

    return false;
  }

  /**
   * 渲染菜单标题
   *
   * @param {MenuConfig} config - 菜单配置
   * @param {SyncContext} context - 同步上下文
   * @returns {string} 渲染后的标题
   */
  renderTitle(config, context) {
    const { keyword = '', raw = '', normalized = '' } = context;

    // 如果有模板，使用模板渲染
    if (config.titleTemplate) {
      return config.titleTemplate
        .replace(/\$\{keyword\}/g, keyword)
        .replace(/\$\{raw\}/g, raw)
        .replace(/\$\{normalized\}/g, normalized)
        .replace(/\$\{title\}/g, config.title || '')
        .replace(/\$\{icon\}/g, config.icon || '');
    }

    // 没有模板，使用默认格式
    const base = config.icon ? `${config.icon} ${config.title}` : config.title;
    return keyword ? `${base}: "${keyword}"` : base;
  }

  /**
   * 更新单个菜单项标题
   *
   * @private
   * @param {string} menuId - 菜单 ID
   * @param {string} title - 新标题
   * @param {MenuConfig} config - 菜单配置
   * @returns {Promise<{ok: boolean, error?: any}>}
   */
  async _updateMenuItem(menuId, title, config) {
    return new Promise((resolve) => {
      chrome.contextMenus.update(menuId, { title }, () => {
        const error = chrome.runtime.lastError;

        if (error) {
          const errorMsg = error.message || '';

          // 忽略"找不到菜单项"的错误（菜单可能已被删除）
          if (!/Cannot find menu item/i.test(errorMsg)) {
            console.warn(`[MenuRegistry] Failed to update menu ${menuId}:`, errorMsg);

            if (config.onSyncFailed) {
              config.onSyncFailed(menuId, errorMsg);
            }

            if (typeof logMenuEvent === 'function') {
              logMenuEvent('menu-sync-failed', { menuId, error: errorMsg });
            }
          }

          resolve({ ok: false, error });
        } else {
          if (typeof logMenuEvent === 'function') {
            logMenuEvent('menu-synced', { menuId, title });
          }
          resolve({ ok: true });
        }
      });
    });
  }

  /**
   * 同步特定组的所有菜单标题
   *
   * @param {string} groupName - 组名
   * @param {SyncContext} context - 同步上下文
   * @returns {Promise<{success: number, failed: number}>}
   */
  async syncGroup(groupName, context) {
    const group = this.syncGroups.get(groupName);
    if (!group || group.size === 0) {
      return { success: 0, failed: 0 };
    }

    const promises = [];
    for (const menuId of group) {
      const config = this.items.get(menuId);
      if (!config) continue;

      const title = this.renderTitle(config, context);
      promises.push(this._updateMenuItem(menuId, title, config));
    }

    const results = await Promise.allSettled(promises);

    const success = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
    const failed = results.length - success;

    return { success, failed };
  }

  /**
   * 同步所有需要动态标题的菜单项
   *
   * @param {SyncContext} context - 同步上下文
   * @returns {Promise<{success: number, failed: number, total: number}>}
   */
  async syncAll(context) {
    if (this.syncableItems.size === 0) {
      return { success: 0, failed: 0, total: 0 };
    }

    const promises = [];
    for (const menuId of this.syncableItems) {
      const config = this.items.get(menuId);
      if (!config) continue;

      const title = this.renderTitle(config, context);
      promises.push(this._updateMenuItem(menuId, title, config));
    }

    const results = await Promise.allSettled(promises);

    const success = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
    const failed = results.length - success;

    if (typeof logMenuEvent === 'function') {
      logMenuEvent('menu-registry-sync-all', {
        total: results.length,
        success,
        failed,
        keyword: context.keyword || context.normalized || context.raw
      });
    }

    return { success, failed, total: results.length };
  }

  /**
   * 获取所有已注册的菜单项 ID
   *
   * @returns {string[]}
   */
  getAllMenuIds() {
    return Array.from(this.items.keys());
  }

  /**
   * 获取所有需要同步的菜单项 ID
   *
   * @returns {string[]}
   */
  getSyncableMenuIds() {
    return Array.from(this.syncableItems);
  }

  /**
   * 获取特定组的菜单项 ID
   *
   * @param {string} groupName - 组名
   * @returns {string[]}
   */
  getGroupMenuIds(groupName) {
    const group = this.syncGroups.get(groupName);
    return group ? Array.from(group) : [];
  }

  /**
   * 检查菜单项是否已注册
   *
   * @param {string} menuId - 菜单 ID
   * @returns {boolean}
   */
  has(menuId) {
    return this.items.has(menuId);
  }

  /**
   * 获取菜单项配置
   *
   * @param {string} menuId - 菜单 ID
   * @returns {MenuConfig|undefined}
   */
  get(menuId) {
    return this.items.get(menuId);
  }

  /**
   * 清空注册表
   */
  clear() {
    this.items.clear();
    this.syncGroups.clear();
    this.syncableItems.clear();
  }

  /**
   * 获取统计信息
   *
   * @returns {Object}
   */
  getStats() {
    return {
      totalItems: this.items.size,
      syncableItems: this.syncableItems.size,
      groups: this.syncGroups.size,
      groupDetails: Array.from(this.syncGroups.entries()).map(([name, ids]) => ({
        name,
        count: ids.size
      }))
    };
  }
}

// 导出单例
const menuRegistry = new MenuRegistry();
