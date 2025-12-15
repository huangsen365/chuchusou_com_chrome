/**
 * 触触搜 - 菜单处理器
 * 负责处理菜单点击事件
 *
 * @module menu/MenuHandlers
 */

/**
 * 菜单处理器类
 */
class MenuHandlers {
  constructor(options = {}) {
    this.debug = options.debug || false;
    this.stateManager = options.stateManager || null;

    // URL 模式映射
    this.urlPatterns = new Map();

    // 初始化 URL 模式
    this._initUrlPatterns();
  }

  /**
   * 初始化 URL 模式
   * @private
   */
  _initUrlPatterns() {
    // 搜索引擎
    this.urlPatterns.set('ccs-baidu', 'https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${KEYWORD}');
    this.urlPatterns.set('ccs-google', 'https://www.google.com/search?q=${KEYWORD}');
    this.urlPatterns.set('ccs-tongyi', 'https://www.tongyi.com/?q=${KEYWORD}');
    this.urlPatterns.set('ccs-zhihu', 'https://www.zhihu.com/search?q=${KEYWORD}');
    this.urlPatterns.set('ccs-weixin', 'https://search.weixin.qq.com/cgi-bin/newsearchweb/userclientjump?path=page/search/christmas_jump&query=${KEYWORD}');
    this.urlPatterns.set('ccs-taobao', 'https://s.taobao.com/search?q=${KEYWORD}');
    this.urlPatterns.set('ccs-jd', 'https://search.jd.com/Search?keyword=${KEYWORD}');
    this.urlPatterns.set('ccs-sov2ex', 'https://www.sov2ex.com/?q=${KEYWORD}');
    this.urlPatterns.set('ccs-google-translate', 'https://translate.google.com/?sl=auto&tl=zh-CN&text=${KEYWORD}');
    this.urlPatterns.set('ccs-chuchusou', 'https://chuchusou.com/?q=${KEYWORD}');

    // AI 对话
    this.urlPatterns.set('ccs-chatgpt', 'https://chatgpt.com/?q=${KEYWORD}');
    this.urlPatterns.set('ccs-claude', 'https://claude.ai/new?q=${KEYWORD}');
    this.urlPatterns.set('ccs-grok', 'https://grok.com/?q=${KEYWORD}');
    this.urlPatterns.set('ccs-yiyan', 'https://yiyan.baidu.com/?q=${KEYWORD}');
  }

  /**
   * 构建 URL
   * @param {string} menuId - 菜单 ID
   * @param {string} keyword - 关键词
   * @returns {string|null}
   */
  buildUrl(menuId, keyword) {
    const pattern = this.urlPatterns.get(menuId);
    if (!pattern || !keyword) return null;

    return pattern.replace('${KEYWORD}', encodeURIComponent(keyword));
  }

  /**
   * 处理搜索类菜单点击
   * @param {string} menuId - 菜单 ID
   * @param {string} keyword - 关键词
   * @param {Object} tab - 标签页对象
   * @returns {Promise<void>}
   */
  async handleSearchMenu(menuId, keyword, tab) {
    const url = this.buildUrl(menuId, keyword);
    if (url) {
      await chrome.tabs.create({ url });
      this._log('handleSearchMenu', { menuId, url });
    }
  }

  /**
   * 处理工具类菜单点击
   * @param {string} menuId - 菜单 ID
   * @param {string} text - 原始文本
   * @param {Object} tab - 标签页对象
   * @returns {Promise<void>}
   */
  async handleToolMenu(menuId, text, tab) {
    if (!text || !tab?.id) return;

    const commandMap = {
      'ccs-copy': 'copy',
      'ccs-base64': 'base64',
      'ccs-md5': 'md5',
      'ccs-url-encode': 'url-encode',
      'ccs-upper': 'upper',
      'ccs-lower': 'lower'
    };

    const command = commandMap[menuId];
    if (!command) return;

    if (command === 'copy') {
      // 复制需要特殊处理
      const ok = await this._copyTextInTab(tab, text);
      if (!ok) {
        await this._showToast(tab, '复制失败，请检查页面权限');
      }
    } else {
      // 发送到 content script 处理
      await chrome.tabs.sendMessage(tab.id, {
        action: 'processCommand',
        command,
        text
      }).catch(() => {});
    }

    this._log('handleToolMenu', { menuId, command });
  }

  /**
   * 处理显示面板菜单
   * @param {string} text - 文本
   * @param {Object} tab - 标签页对象
   * @returns {Promise<void>}
   */
  async handleShowPopover(text, tab) {
    if (!tab?.id) return;

    await chrome.tabs.sendMessage(tab.id, {
      action: 'showPopover',
      text: text || ''
    }).catch(() => {});

    this._log('handleShowPopover', { tabId: tab.id });
  }

  /**
   * 处理触触搜百问菜单
   * @param {string} menuId - 菜单 ID
   * @param {string} input - 输入文本
   * @param {Object} tab - 标签页对象
   * @returns {Promise<void>}
   */
  async handleTopQuestionsMenu(menuId, input, tab) {
    if (!input) {
      await this._showToast(tab, '没有选中文本，无法生成问题列表');
      return;
    }

    // 使用全局函数加载配置和构建提示词
    if (typeof loadTopQuestionsConfig !== 'function' ||
        typeof buildTopQuestionsPrompt !== 'function') {
      await this._showToast(tab, '触触搜百问模板加载失败');
      return;
    }

    const config = await loadTopQuestionsConfig();
    if (!config) {
      await this._showToast(tab, '触触搜百问模板加载失败');
      return;
    }

    const prompt = buildTopQuestionsPrompt(input);
    if (!prompt) {
      await this._showToast(tab, '触触搜百问模板无效');
      return;
    }

    const encodedPrompt = encodeURIComponent(prompt);
    const isOpenAll = menuId === 'ccs-top100-open-all';

    if (isOpenAll) {
      // 打开所有引擎
      let openedCount = 0;
      for (const engine of config.engines || []) {
        if (!engine?.urlPattern) continue;
        const engineMenuId = `ccs-top100-${engine.id}`;
        if (typeof isMenuEnabled === 'function' && !isMenuEnabled(engineMenuId)) continue;

        const url = engine.urlPattern.replace('${PROMPT}', encodedPrompt);
        await chrome.tabs.create({ url, active: openedCount === 0 });
        openedCount++;
      }
    } else {
      // 打开单个引擎
      const engineId = menuId.replace('ccs-top100-', '');
      const engine = (config.engines || []).find((e) => e.id === engineId);

      if (!engine?.urlPattern) {
        await this._showToast(tab, '未找到对应的引擎配置');
        return;
      }

      const url = engine.urlPattern.replace('${PROMPT}', encodedPrompt);
      await chrome.tabs.create({ url });
    }

    this._log('handleTopQuestionsMenu', { menuId, isOpenAll });
  }

  /**
   * 处理速答壹拾佰菜单
   * @param {string} menuId - 菜单 ID
   * @param {string} input - 输入文本
   * @param {Object} tab - 标签页对象
   * @returns {Promise<void>}
   */
  async handleFastAnswersMenu(menuId, input, tab) {
    if (!input) {
      await this._showToast(tab, '没有选中文本，无法生成速答内容');
      return;
    }

    if (typeof loadFastAnswersConfig !== 'function' ||
        typeof buildFastAnswersPrompt !== 'function') {
      await this._showToast(tab, '速答壹拾佰模板加载失败');
      return;
    }

    const config = await loadFastAnswersConfig();
    if (!config) {
      await this._showToast(tab, '速答壹拾佰模板加载失败');
      return;
    }

    const prompt = buildFastAnswersPrompt(input);
    if (!prompt) {
      await this._showToast(tab, '速答壹拾佰模板无效');
      return;
    }

    const encodedPrompt = encodeURIComponent(prompt);
    const isOpenAll = menuId === 'ccs-fastqa-open-all';

    if (isOpenAll) {
      let openedCount = 0;
      for (const engine of config.engines || []) {
        if (!engine?.urlPattern) continue;
        const engineMenuId = `ccs-fastqa-${engine.id}`;
        if (typeof isMenuEnabled === 'function' && !isMenuEnabled(engineMenuId)) continue;

        const url = engine.urlPattern.replace('${PROMPT}', encodedPrompt);
        await chrome.tabs.create({ url, active: openedCount === 0 });
        openedCount++;
      }
    } else {
      // 检查是否为快捷菜单
      let engineId = menuId.replace('ccs-fastqa-', '').replace(/-quick$/, '');
      const quickItems = typeof FAST_QA_QUICK_ITEMS !== 'undefined' ? FAST_QA_QUICK_ITEMS : [];
      const quickItem = quickItems.find((item) => item.id === menuId);
      if (quickItem) {
        engineId = quickItem.engineId;
      }

      const engine = (config.engines || []).find((e) => e.id === engineId);
      if (!engine?.urlPattern) {
        await this._showToast(tab, '未找到对应的速答配置');
        return;
      }

      const url = engine.urlPattern.replace('${PROMPT}', encodedPrompt);
      await chrome.tabs.create({ url });
    }

    this._log('handleFastAnswersMenu', { menuId, isOpenAll });
  }

  /**
   * 处理优化提示词菜单
   * @param {string} menuId - 菜单 ID
   * @param {string} input - 输入文本
   * @param {Object} tab - 标签页对象
   * @returns {Promise<void>}
   */
  async handleOptimizeMenu(menuId, input, tab) {
    if (!input) {
      await this._showToast(tab, '没有选中文本，无法生成优化后的提示词');
      return;
    }

    if (typeof loadOptimizedPromptConfig !== 'function' ||
        typeof buildOptimizedPrompt !== 'function') {
      await this._showToast(tab, '提示词模板加载失败');
      return;
    }

    const config = await loadOptimizedPromptConfig();
    if (!config) {
      await this._showToast(tab, '提示词模板加载失败');
      return;
    }

    // 从菜单 ID 解析 purpose 和 engine
    // 格式: ccs-optimize-{categoryId}-{engineId}
    const parts = menuId.replace('ccs-optimize-', '').split('-');
    if (parts.length < 2) {
      await this._showToast(tab, '未找到对应的提示词配置');
      return;
    }

    const categoryId = parts[0];
    const engineId = parts[1];

    const category = (config.categories || []).find((c) => c.id === categoryId);
    if (!category) {
      await this._showToast(tab, '未找到对应的提示词配置');
      return;
    }

    const engine = (category.engines || []).find((e) => e.id === engineId);
    if (!engine?.urlPattern) {
      await this._showToast(tab, '未找到对应的提示词配置');
      return;
    }

    const prompt = buildOptimizedPrompt(category.purpose, input);
    if (!prompt) {
      await this._showToast(tab, '提示词模板加载失败');
      return;
    }

    const encodedPrompt = encodeURIComponent(prompt);
    const url = engine.urlPattern.replace('${PROMPT}', encodedPrompt);
    await chrome.tabs.create({ url });

    this._log('handleOptimizeMenu', { menuId, categoryId, engineId });
  }

  /**
   * 在标签页中复制文本
   * @param {Object} tab - 标签页对象
   * @param {string} text - 要复制的文本
   * @returns {Promise<boolean>}
   * @private
   */
  async _copyTextInTab(tab, text) {
    if (!tab?.id || !text) return false;

    // 使用全局函数（如果可用）
    if (typeof copyTextInTab === 'function') {
      return await copyTextInTab(tab, text);
    }

    // 回退实现
    try {
      const result = await chrome.tabs.sendMessage(tab.id, {
        action: 'copyText',
        text
      });
      return result?.success || false;
    } catch (_) {
      return false;
    }
  }

  /**
   * 显示 Toast 提示
   * @param {Object} tab - 标签页对象
   * @param {string} message - 提示消息
   * @returns {Promise<void>}
   * @private
   */
  async _showToast(tab, message) {
    if (!tab?.id) return;

    await chrome.tabs.sendMessage(tab.id, {
      action: 'showToast',
      message
    }).catch(() => {});
  }

  /**
   * 调试日志
   * @private
   */
  _log(action, data) {
    if (!this.debug) return;
    console.log(`[MenuHandlers] ${action}`, data || '');
  }
}

// 导出到全局
if (typeof globalThis !== 'undefined') {
  globalThis.MenuHandlers = MenuHandlers;
}
