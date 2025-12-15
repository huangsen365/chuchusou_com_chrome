/**
 * 菜单管理器类
 *
 * 借鉴参考案例 2 的 ContextMenuManager 设计
 * 核心功能：
 * - 从统一配置加载菜单
 * - 递归创建菜单树
 * - 处理菜单点击事件
 * - 动态更新菜单标题（使用 onShown）
 * - 整合 StateManager 和 URLBuilder
 *
 * @class MenuManager
 */
class MenuManager {
  constructor(options = {}) {
    /**
     * 依赖注入
     */
    this.stateManager = options.stateManager || null;
    this.urlBuilder = options.urlBuilder || null;

    /**
     * 菜单配置
     */
    this.config = null;

    /**
     * 菜单项映射
     * key: menuId
     * value: menuItem config
     */
    this.menuMap = new Map();

    /**
     * 动态菜单项映射（用于高级功能）
     * 存储从 JSON 配置动态生成的菜单
     */
    this.dynamicMenus = {
      top100: new Map(),      // 触触搜百问
      fastqa: new Map(),      // 速答壹拾佰
      optimize: new Map()     // 优化提示词
    };

    /**
     * 菜单开关配置
     */
    this.menuToggles = {};

    /**
     * 配置选项
     */
    this.options = {
      // 最大参数长度
      maxParamLength: options.maxParamLength || 80,
      // 最大显示长度
      maxDisplayLength: options.maxDisplayLength || 20,
      // 是否启用调试日志
      debug: options.debug || false
    };

    /**
     * 构建状态
     */
    this.buildState = {
      inProgress: false,
      pending: false,
      counter: 0
    };

    // 绑定事件处理器
    this._bindEventHandlers();
  }

  /**
   * 初始化菜单管理器
   *
   * @param {Object} config - 统一菜单配置
   * @returns {Promise<void>}
   */
  async init(config) {
    this._log('init:start');

    // 保存配置
    this.config = config;

    // 加载菜单开关配置
    await this.loadMenuToggles();

    // 加载 URL 模板到 URLBuilder
    if (this.urlBuilder && config) {
      this.urlBuilder.loadFromConfig(config);
    }

    // 创建所有菜单
    await this.buildMenus();

    this._log('init:complete');
  }

  /**
   * 加载菜单开关配置
   * 从统一配置中提取 enabled 状态
   *
   * @returns {Promise<void>}
   */
  async loadMenuToggles() {
    try {
      // 从统一配置加载（而不是已删除的 menuToggles.json）
      const response = await fetch(chrome.runtime.getURL('config/unifiedMenuConfig.json'));
      const config = await response.json();

      // 从配置中提取 enabled 状态
      this.menuToggles = {};

      if (Array.isArray(config.groups)) {
        for (const group of config.groups) {
          if (Array.isArray(group.items)) {
            for (const item of group.items) {
              if (item.id && typeof item.enabled === 'boolean') {
                this.menuToggles[item.id] = item.enabled;
              }
              // 处理子菜单
              if (Array.isArray(item.children)) {
                for (const child of item.children) {
                  if (child.id && typeof child.enabled === 'boolean') {
                    this.menuToggles[child.id] = child.enabled;
                  }
                }
              }
            }
          }
        }
      }

      this._log('loadMenuToggles', { count: Object.keys(this.menuToggles).length });
    } catch (error) {
      console.warn('[MenuManager] Failed to load menu toggles from unified config:', error);
      this.menuToggles = {};
    }
  }

  /**
   * 检查菜单项是否启用
   *
   * @param {string} menuId - 菜单 ID
   * @returns {boolean}
   */
  isMenuEnabled(menuId) {
    // 如果配置中明确指定，使用配置值
    if (menuId in this.menuToggles) {
      return this.menuToggles[menuId] !== false;
    }

    // 默认启用
    return true;
  }

  /**
   * 构建所有菜单
   *
   * @returns {Promise<void>}
   */
  async buildMenus() {
    // 防止重复构建
    if (this.buildState.inProgress) {
      this.buildState.pending = true;
      this._log('buildMenus:already-in-progress');
      return;
    }

    this.buildState.inProgress = true;
    this.buildState.counter++;
    const buildId = this.buildState.counter;

    this._log('buildMenus:start', { buildId });

    try {
      // 1. 清空所有现有菜单
      await this.removeAllMenus();

      // 2. 清空映射
      this.menuMap.clear();
      this.dynamicMenus.top100.clear();
      this.dynamicMenus.fastqa.clear();
      this.dynamicMenus.optimize.clear();

      // 3. 创建根菜单
      await this.createRootMenu();

      // 4. 创建菜单分组
      await this.createMenuGroups();

      // 5. 应用图标（如果需要）
      // await this.applyIcons(buildId);

      this._log('buildMenus:complete', { buildId });

    } catch (error) {
      console.error('[MenuManager] buildMenus failed:', error);
    } finally {
      this.buildState.inProgress = false;

      // 检查是否有待处理的重建请求
      if (this.buildState.pending) {
        this.buildState.pending = false;
        this._log('buildMenus:rebuild-pending');
        setTimeout(() => this.buildMenus(), 0);
      }
    }
  }

  /**
   * 创建根菜单
   *
   * @returns {Promise<void>}
   */
  async createRootMenu() {
    if (!this.config || !this.config.root) {
      throw new Error('Invalid config: missing root');
    }

    const root = this.config.root;
    const title = this._formatTitle(root);

    await this.createMenu({
      id: root.id,
      title,
      contexts: root.contexts || ['all']
    });

    this.menuMap.set(root.id, root);
    this._log('createRootMenu', { id: root.id, title });
  }

  /**
   * 创建菜单分组
   *
   * @returns {Promise<void>}
   */
  async createMenuGroups() {
    if (!this.config || !this.config.groups) {
      throw new Error('Invalid config: missing groups');
    }

    const rootId = this.config.root.id;

    for (const group of this.config.groups) {
      // 检查是否需要添加分隔符（before）
      if (group.separator === 'before') {
        await this.createSeparator(rootId, `sep-before-${group.id}`);
      }

      // 创建分组中的菜单项
      await this.createGroupItems(group, rootId);

      // 检查是否需要添加分隔符（after）
      if (group.separator === 'after') {
        await this.createSeparator(rootId, `sep-after-${group.id}`);
      }
    }
  }

  /**
   * 创建分组中的菜单项
   *
   * @param {Object} group - 分组配置
   * @param {string} parentId - 父菜单 ID
   * @returns {Promise<void>}
   */
  async createGroupItems(group, parentId) {
    if (!group.items || !Array.isArray(group.items)) {
      return;
    }

    for (const item of group.items) {
      // 检查是否启用
      if (item.enabled === false || !this.isMenuEnabled(item.id)) {
        this._log('createGroupItems:skip-disabled', { id: item.id });
        continue;
      }

      // 创建菜单项（递归处理子菜单）
      await this.createMenuItem(item, parentId);
    }
  }

  /**
   * 创建单个菜单项（递归）
   *
   * @param {Object} item - 菜单项配置
   * @param {string} parentId - 父菜单 ID
   * @returns {Promise<void>}
   */
  async createMenuItem(item, parentId) {
    const title = this._formatTitle(item);

    // 创建菜单
    await this.createMenu({
      id: item.id,
      parentId,
      title,
      contexts: item.contexts || ['selection', 'page'],
      type: item.type === 'separator' ? 'separator' : 'normal'
    });

    // 保存到映射
    this.menuMap.set(item.id, item);

    // 递归创建子菜单
    if (item.children && Array.isArray(item.children)) {
      for (const child of item.children) {
        if (child.enabled !== false && this.isMenuEnabled(child.id)) {
          await this.createMenuItem(child, item.id);
        }
      }
    }

    this._log('createMenuItem', { id: item.id, parentId, title });
  }

  /**
   * 创建分隔符
   *
   * @param {string} parentId - 父菜单 ID
   * @param {string} id - 分隔符 ID
   * @returns {Promise<void>}
   */
  async createSeparator(parentId, id) {
    await this.createMenu({
      id,
      parentId,
      type: 'separator',
      contexts: ['all']
    });
  }

  /**
   * 创建菜单（底层 API）
   *
   * @param {Object} options - chrome.contextMenus.create 选项
   * @returns {Promise<void>}
   */
  createMenu(options) {
    return new Promise((resolve) => {
      chrome.contextMenus.create(options, () => {
        if (chrome.runtime.lastError) {
          console.warn('[MenuManager] createMenu error:', chrome.runtime.lastError.message);
        }
        resolve();
      });
    });
  }

  /**
   * 移除所有菜单
   *
   * @returns {Promise<void>}
   */
  removeAllMenus() {
    return new Promise((resolve) => {
      chrome.contextMenus.removeAll(() => {
        if (chrome.runtime.lastError) {
          console.warn('[MenuManager] removeAll error:', chrome.runtime.lastError.message);
        }
        resolve();
      });
    });
  }

  /**
   * 格式化菜单标题
   *
   * @param {Object} item - 菜单项配置
   * @returns {string}
   */
  _formatTitle(item) {
    if (!item) return '';

    let title = item.title || '';
    const icon = item.icon || '';

    // 如果有图标，添加图标
    if (icon) {
      title = `${icon} ${title}`;
    }

    return title.trim();
  }

  /**
   * 获取核心参数（用于动态标题）
   * 优先选中文本，其次标签页标题
   *
   * @param {Object} info - contextMenus.onShown 的 info
   * @param {Object} tab - 当前标签页
   * @returns {string}
   */
  getCoreParam(info, tab) {
    let raw = (info && info.selectionText && info.selectionText.trim())
      ? info.selectionText.trim()
      : (tab && tab.title ? tab.title.trim() : '');

    // 压缩多行为一行
    raw = raw.replace(/\s+/g, ' ');

    // 截断过长的文本
    if (raw.length > this.options.maxParamLength) {
      raw = raw.slice(0, this.options.maxParamLength) + '…';
    }

    return raw || '(空)';
  }

  /**
   * 格式化显示文本（截断）
   *
   * @param {string} text - 文本
   * @returns {string}
   */
  formatDisplayText(text) {
    if (!text) return '';

    if (text.length > this.options.maxDisplayLength) {
      return text.slice(0, this.options.maxDisplayLength) + '...';
    }

    return text;
  }

  /**
   * 处理菜单点击事件
   *
   * @param {Object} info - 点击信息
   * @param {Object} tab - 标签页信息
   * @returns {Promise<void>}
   */
  async handleClick(info, tab) {
    this._log('handleClick', { menuItemId: info.menuItemId });

    // 获取菜单项配置
    const menuItem = this.menuMap.get(info.menuItemId);
    if (!menuItem) {
      // 可能是动态菜单，尝试从动态映射中查找
      return this._handleDynamicMenuClick(info, tab);
    }

    // 根据菜单类型分发处理
    switch (menuItem.type) {
      case 'search':
      case 'ai-search':
      case 'ai-chat':
      case 'ecommerce':
      case 'translate':
      case 'portal':
        await this._handleSearchMenu(info, tab, menuItem);
        break;

      case 'fastqa-quick':
        await this._handleFastQAQuickMenu(info, tab, menuItem);
        break;

      case 'tool':
        await this._handleToolMenu(info, tab, menuItem);
        break;

      case 'transform':
        await this._handleTransformMenu(info, tab, menuItem);
        break;

      case 'action':
        await this._handleActionMenu(info, tab, menuItem);
        break;

      default:
        this._log('handleClick:unknown-type', { type: menuItem.type });
    }
  }

  /**
   * 处理搜索类菜单点击
   *
   * @param {Object} info
   * @param {Object} tab
   * @param {Object} menuItem
   * @returns {Promise<void>}
   * @private
   */
  async _handleSearchMenu(info, tab, menuItem) {
    // 获取搜索文本
    const rawText = info.selectionText || tab.title || '';
    const normalizedText = this._normalizeSearchText(rawText);

    // 构建 URL
    const url = this.urlBuilder.build(menuItem.id, {
      raw: rawText,
      normalized: normalizedText
    });

    if (url) {
      await chrome.tabs.create({ url });
      this._log('_handleSearchMenu', { menuId: menuItem.id, url });
    }
  }

  /**
   * 处理快速问答菜单点击
   *
   * @param {Object} info
   * @param {Object} tab
   * @param {Object} menuItem
   * @returns {Promise<void>}
   * @private
   */
  async _handleFastQAQuickMenu(info, tab, menuItem) {
    // 获取原始文本
    const rawText = info.selectionText || tab.title || '';

    // 构建提示词（需要从 fastAnswersPrompts.json 加载）
    const prompt = await this._buildFastAnswersPrompt(rawText);

    // 构建 URL
    const url = this.urlBuilder.build(menuItem.id, {
      raw: rawText,
      prompt
    });

    if (url) {
      await chrome.tabs.create({ url });
      this._log('_handleFastQAQuickMenu', { menuId: menuItem.id, url });
    }
  }

  /**
   * 处理工具类菜单点击
   *
   * @param {Object} info
   * @param {Object} tab
   * @param {Object} menuItem
   * @returns {Promise<void>}
   * @private
   */
  async _handleToolMenu(info, tab, menuItem) {
    const text = info.selectionText || '';

    switch (menuItem.action) {
      case 'copy':
        await navigator.clipboard.writeText(text);
        break;

      case 'base64-encode':
        const base64 = btoa(unescape(encodeURIComponent(text)));
        await navigator.clipboard.writeText(base64);
        break;

      case 'md5-hash':
        // MD5 需要外部库，这里简化处理
        console.log('[MenuManager] MD5 not implemented yet');
        break;

      case 'url-encode':
        const encoded = encodeURIComponent(text);
        await navigator.clipboard.writeText(encoded);
        break;
    }

    this._log('_handleToolMenu', { action: menuItem.action });
  }

  /**
   * 处理文本转换菜单点击
   *
   * @param {Object} info
   * @param {Object} tab
   * @param {Object} menuItem
   * @returns {Promise<void>}
   * @private
   */
  async _handleTransformMenu(info, tab, menuItem) {
    const text = info.selectionText || '';

    switch (menuItem.action) {
      case 'to-uppercase':
        await navigator.clipboard.writeText(text.toUpperCase());
        break;

      case 'to-lowercase':
        await navigator.clipboard.writeText(text.toLowerCase());
        break;
    }

    this._log('_handleTransformMenu', { action: menuItem.action });
  }

  /**
   * 处理动作类菜单点击
   *
   * @param {Object} info
   * @param {Object} tab
   * @param {Object} menuItem
   * @returns {Promise<void>}
   * @private
   */
  async _handleActionMenu(info, tab, menuItem) {
    switch (menuItem.action) {
      case 'show-popover':
        // 发送消息到 content script
        chrome.tabs.sendMessage(tab.id, {
          action: 'showPopover'
        });
        break;
    }

    this._log('_handleActionMenu', { action: menuItem.action });
  }

  /**
   * 处理动态菜单点击（触触搜百问、速答壹拾佰、优化提示词）
   *
   * @param {Object} info
   * @param {Object} tab
   * @returns {Promise<void>}
   * @private
   */
  async _handleDynamicMenuClick(info, tab) {
    const menuId = info.menuItemId;

    // 检查是哪种动态菜单
    if (menuId.startsWith('ccs-top100-')) {
      // 触触搜百问
      const config = this.dynamicMenus.top100.get(menuId);
      if (config) {
        // 构建提示词并打开
        // TODO: 实现具体逻辑
      }
    } else if (menuId.startsWith('ccs-fastqa-') && !menuId.includes('-quick')) {
      // 速答壹拾佰
      const config = this.dynamicMenus.fastqa.get(menuId);
      if (config) {
        // 构建提示词并打开
        // TODO: 实现具体逻辑
      }
    } else if (menuId.startsWith('ccs-optimize-')) {
      // 优化提示词
      const config = this.dynamicMenus.optimize.get(menuId);
      if (config) {
        // 构建提示词并打开
        // TODO: 实现具体逻辑
      }
    }
  }

  /**
   * 构建速答壹拾佰提示词
   *
   * @param {string} input - 输入文本
   * @returns {Promise<string>}
   * @private
   */
  async _buildFastAnswersPrompt(input) {
    // TODO: 从 fastAnswersPrompts.json 加载模板
    // 这里简化处理
    return `请针对以下主题生成回答：\n\n${input}`;
  }

  /**
   * 标准化搜索文本
   *
   * @param {string} text
   * @returns {string}
   * @private
   */
  _normalizeSearchText(text) {
    if (!text) return '';

    // 去除多余空白
    return text.trim().replace(/\s+/g, ' ');
  }

  /**
   * 绑定事件处理器
   * @private
   */
  _bindEventHandlers() {
    // 绑定菜单点击事件
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      this.handleClick(info, tab);
    });

    // 绑定菜单显示前事件（用于动态更新标题）
    if (chrome.contextMenus.onShown) {
      chrome.contextMenus.onShown.addListener((info, tab) => {
        this._handleMenuShown(info, tab);
      });
    }
  }

  /**
   * 处理菜单显示前事件
   * 动态更新菜单标题
   *
   * @param {Object} info
   * @param {Object} tab
   * @private
   */
  _handleMenuShown(info, tab) {
    // 获取核心参数
    const param = this.getCoreParam(info, tab);
    const display = this.formatDisplayText(param);

    // 更新需要动态标题的菜单项
    // TODO: 实现动态标题更新逻辑

    // 刷新菜单显示
    if (chrome.contextMenus.refresh) {
      chrome.contextMenus.refresh();
    }
  }

  /**
   * 调试日志
   * @private
   */
  _log(action, data) {
    if (!this.options.debug) return;

    console.log(`[MenuManager] ${action}`, data || '');
  }

  /**
   * 销毁菜单管理器
   */
  async destroy() {
    this.buildState.inProgress = false;
    this.buildState.pending = false;

    await this.removeAllMenus();

    this.menuMap.clear();
    this.dynamicMenus.top100.clear();
    this.dynamicMenus.fastqa.clear();
    this.dynamicMenus.optimize.clear();

    this._log('destroy');
  }
}
