/**
 * URL 构建器类
 *
 * 借鉴参考案例 2 的 URLBuilder 设计
 * 统一处理所有 URL 模板变量替换
 *
 * 支持的变量：
 * - ${KEYWORD} - 搜索关键词（标准化）
 * - ${PROMPT} - AI 提示词
 * - ${RAW_TEXT} - 原始文本（未标准化）
 * - ${ENCODED_TEXT} - URL 编码后的文本
 *
 * @class URLBuilder
 */
class URLBuilder {
  constructor(options = {}) {
    /**
     * URL 模板存储
     * key: menuId
     * value: urlPattern (string)
     */
    this.templates = new Map();

    /**
     * 配置选项
     */
    this.options = {
      // 是否自动编码参数
      autoEncode: options.autoEncode !== false, // 默认 true
      // 是否启用调试日志
      debug: options.debug || false
    };

    /**
     * 变量替换器映射
     * 定义如何处理不同的变量
     */
    this.variableHandlers = {
      'KEYWORD': (value) => value.normalized || value.raw || '',
      'PROMPT': (value) => value.prompt || value.raw || '',
      'RAW_TEXT': (value) => value.raw || '',
      'ENCODED_TEXT': (value) => encodeURIComponent(value.raw || ''),
      'NORMALIZED': (value) => value.normalized || ''
    };
  }

  /**
   * 注册 URL 模板
   *
   * @param {string} menuId - 菜单 ID
   * @param {string} urlPattern - URL 模板
   */
  register(menuId, urlPattern) {
    if (!menuId || typeof menuId !== 'string') {
      throw new Error('menuId must be a non-empty string');
    }
    if (!urlPattern || typeof urlPattern !== 'string') {
      throw new Error('urlPattern must be a non-empty string');
    }

    this.templates.set(menuId, urlPattern);
    this._log('register', { menuId, urlPattern });
  }

  /**
   * 批量注册 URL 模板
   *
   * @param {Object} templates - { menuId: urlPattern, ... }
   */
  registerBatch(templates) {
    if (!templates || typeof templates !== 'object') {
      throw new Error('templates must be an object');
    }

    for (const [menuId, urlPattern] of Object.entries(templates)) {
      this.register(menuId, urlPattern);
    }
  }

  /**
   * 构建 URL
   *
   * @param {string} menuId - 菜单 ID
   * @param {Object} params - 参数对象
   * @param {string} [params.raw] - 原始文本
   * @param {string} [params.normalized] - 标准化文本
   * @param {string} [params.prompt] - AI 提示词
   * @returns {string|null} 构建的 URL，如果模板不存在返回 null
   */
  build(menuId, params = {}) {
    const template = this.templates.get(menuId);
    if (!template) {
      this._log('build:template-not-found', { menuId });
      return null;
    }

    // 替换所有变量
    const url = this._replaceVariables(template, params);

    this._log('build', { menuId, template, params, url });
    return url;
  }

  /**
   * 替换模板中的变量
   *
   * @param {string} template - URL 模板
   * @param {Object} params - 参数对象
   * @returns {string}
   * @private
   */
  _replaceVariables(template, params) {
    // 使用正则表达式匹配所有 ${VAR_NAME} 格式的变量
    return template.replace(/\$\{(\w+)\}/g, (match, varName) => {
      const handler = this.variableHandlers[varName];

      if (handler) {
        // 使用定义的处理器
        const value = handler(params);
        return this.options.autoEncode ? encodeURIComponent(value) : value;
      } else {
        // 未知变量，尝试直接从 params 中获取
        const value = params[varName.toLowerCase()] || '';
        return this.options.autoEncode ? encodeURIComponent(value) : value;
      }
    });
  }

  /**
   * 检查菜单 ID 是否已注册
   *
   * @param {string} menuId - 菜单 ID
   * @returns {boolean}
   */
  has(menuId) {
    return this.templates.has(menuId);
  }

  /**
   * 获取 URL 模板
   *
   * @param {string} menuId - 菜单 ID
   * @returns {string|null}
   */
  getTemplate(menuId) {
    return this.templates.get(menuId) || null;
  }

  /**
   * 删除 URL 模板
   *
   * @param {string} menuId - 菜单 ID
   * @returns {boolean}
   */
  delete(menuId) {
    const deleted = this.templates.delete(menuId);
    if (deleted) {
      this._log('delete', { menuId });
    }
    return deleted;
  }

  /**
   * 清空所有 URL 模板
   */
  clear() {
    this.templates.clear();
    this._log('clear');
  }

  /**
   * 获取所有已注册的菜单 ID
   *
   * @returns {string[]}
   */
  getAllMenuIds() {
    return Array.from(this.templates.keys());
  }

  /**
   * 获取统计信息
   *
   * @returns {Object}
   */
  getStats() {
    return {
      total: this.templates.size,
      menuIds: this.getAllMenuIds()
    };
  }

  /**
   * 验证 URL 是否有效
   *
   * @param {string} url - URL
   * @returns {boolean}
   */
  static isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 快速构建简单的搜索 URL（无需注册模板）
   *
   * @param {string} baseUrl - 基础 URL
   * @param {string} paramKey - 参数键名
   * @param {string} paramValue - 参数值
   * @returns {string}
   */
  static buildSimple(baseUrl, paramKey, paramValue) {
    const separator = baseUrl.includes('?') ? '&' : '?';
    const encodedKey = encodeURIComponent(paramKey);
    const encodedValue = encodeURIComponent(paramValue);
    return `${baseUrl}${separator}${encodedKey}=${encodedValue}`;
  }

  /**
   * 从配置对象加载 URL 模板
   *
   * @param {Object} config - 配置对象
   * @param {Array} config.groups - 菜单分组
   */
  loadFromConfig(config) {
    if (!config || !config.groups) {
      throw new Error('Invalid config: missing groups');
    }

    let count = 0;

    // 遍历所有分组和菜单项
    for (const group of config.groups) {
      if (!group.items) continue;

      for (const item of group.items) {
        if (item.urlPattern) {
          this.register(item.id, item.urlPattern);
          count++;
        }

        // 处理子菜单
        if (item.children) {
          for (const child of item.children) {
            if (child.urlPattern) {
              this.register(child.id, child.urlPattern);
              count++;
            }
          }
        }
      }
    }

    this._log('loadFromConfig', { count });
    return count;
  }

  /**
   * 调试日志
   * @private
   */
  _log(action, data) {
    if (!this.options.debug) return;

    console.log(`[URLBuilder] ${action}`, data || '');
  }
}

/**
 * 辅助函数：构建带参数的 URL（全局使用）
 *
 * @param {string} baseUrl - 基础 URL
 * @param {string} key - 参数键
 * @param {string} value - 参数值
 * @returns {string}
 */
function buildUrlWithParam(baseUrl, key, value) {
  return URLBuilder.buildSimple(baseUrl, key, value);
}

/**
 * 辅助函数：批量打开 URL
 *
 * @param {string[]} urls - URL 列表
 * @param {Object} options - 选项
 * @param {boolean} [options.active] - 是否激活标签页
 * @param {number} [options.delay] - 延迟（毫秒）
 */
async function openMultipleUrls(urls, options = {}) {
  const { active = false, delay = 100 } = options;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const shouldActivate = active && i === 0; // 仅激活第一个标签页

    await chrome.tabs.create({
      url,
      active: shouldActivate
    });

    // 延迟，避免浏览器阻塞
    if (delay > 0 && i < urls.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
