/**
 * 菜单系统集成模块
 *
 * 连接新的菜单系统与现有代码
 * 提供向后兼容的 API
 *
 * @module menuSystem
 */

// ============================================
// 全局实例
// ============================================

/**
 * 状态管理器实例
 * @type {StateManager}
 */
let stateManager = null;

/**
 * URL 构建器实例
 * @type {URLBuilder}
 */
let urlBuilder = null;

/**
 * 系统配置
 * @type {Object}
 */
let systemConfig = null;

// ============================================
// 初始化
// ============================================

/**
 * 初始化菜单系统
 *
 * @param {Object} options - 配置选项
 * @param {boolean} [options.debug] - 是否启用调试模式
 * @param {boolean} [options.useNewSystem] - 已废弃：MenuManager 已删除（v1.6.18），传 true 只会得到一条 warn
 * @returns {Promise<void>}
 */
async function initMenuSystem(options = {}) {
  const { debug = false, useNewSystem = false } = options;

  console.log('[MenuSystem] Initializing...', { debug, useNewSystem });

  try {
    // 1. 创建状态管理器
    stateManager = new StateManager({
      debug,
      stateExpiry: 5 * 60 * 1000,      // 5 分钟
      autoCleanupInterval: 60 * 1000,   // 1 分钟清理一次
      // 使用 Constants.js 中的缓存过期时间（如果可用）
      titleCacheExpiry: typeof CACHE_EXPIRY !== 'undefined' ? CACHE_EXPIRY.TITLE : 30000,
      keywordCacheExpiry: typeof CACHE_EXPIRY !== 'undefined' ? CACHE_EXPIRY.KEYWORD : 30000,
      selectionCacheExpiry: typeof CACHE_EXPIRY !== 'undefined' ? CACHE_EXPIRY.SELECTION : 10000
    });

    // 创建并暴露向后兼容的代理对象
    const legacyProxy = stateManager.createLegacyProxy();
    const globalObj = typeof globalThis !== 'undefined' ? globalThis :
                      typeof self !== 'undefined' ? self : {};
    globalObj._stateManagerLegacy = legacyProxy;

    // 2. 创建 URL 构建器
    urlBuilder = new URLBuilder({
      debug,
      autoEncode: true
    });

    // 3. 加载系统配置
    systemConfig = await loadUnifiedConfig();

    // 4. 将 config 中的 URL 模板装载到 URLBuilder
    //    新老两种模式都装载，让兼容模式的业务代码也能通过
    //    urlBuilder.build() 统一构建 URL（SSoT：只需改 unifiedMenuConfig.json）
    try {
      const count = urlBuilder.loadFromConfig(systemConfig);
      console.log('[MenuSystem] URLBuilder loaded', count, 'templates from config');
    } catch (err) {
      // 装载失败不影响启动——业务代码会自动回退到硬编码路径
      console.warn('[MenuSystem] URLBuilder.loadFromConfig failed (非致命):', err?.message);
    }

    if (useNewSystem) {
      // useNewSystem 分支：MenuManager 已删除（v1.6.18），不再实例化。
      console.warn('[MenuSystem] useNewSystem=true 但 MenuManager 已下线，仅 stateManager+urlBuilder 可用');
    } else {
      // 保持使用旧系统，但提供状态管理和 URL 构建能力
      console.log('[MenuSystem] Running in compatibility mode (old system + new utilities)');

      // 将新的工具暴露给旧系统使用（兼容 Service Worker）
      globalObj._menuSystemCompat = {
        stateManager,
        urlBuilder,
        systemConfig
      };
    }

  } catch (error) {
    console.error('[MenuSystem] Initialization failed:', error);
    throw error;
  }
}

/**
 * 加载统一配置
 *
 * @returns {Promise<Object>}
 */
async function loadUnifiedConfig() {
  try {
    const response = await fetch(chrome.runtime.getURL('config/unifiedMenuConfig.json'));
    const config = await response.json();

    console.log('[MenuSystem] Config loaded:', {
      version: config.version,
      groups: config.groups?.length
    });

    return config;
  } catch (error) {
    console.error('[MenuSystem] Failed to load unified config:', error);
    throw error;
  }
}

// ============================================
// 向后兼容 API
// ============================================

/**
 * 获取状态管理器实例
 *
 * @returns {StateManager|null}
 */
function getStateManager() {
  return stateManager;
}

/**
 * 获取 URL 构建器实例
 *
 * @returns {URLBuilder|null}
 */
function getURLBuilder() {
  return urlBuilder;
}

/**
 * 获取系统配置
 *
 * @returns {Object|null}
 */
function getSystemConfig() {
  return systemConfig;
}

/**
 * 兼容旧 API：设置菜单状态
 *
 * @param {string} rawText - 原始文本
 * @param {string} normalizedText - 标准化文本
 * @param {Object} meta - 元数据
 * @param {number} [meta.tabId] - 标签页 ID
 * @param {string} [meta.url] - 标签页 URL
 */
function setMenuState(rawText, normalizedText, meta = {}) {
  if (!stateManager) {
    console.warn('[MenuSystem] StateManager not initialized');
    return;
  }

  const display = formatMenuTitle(rawText);

  stateManager.setCurrentState({
    raw: rawText,
    normalized: normalizedText,
    display,
    tabId: meta.tabId,
    url: meta.url
  });
}

/**
 * 兼容旧 API：格式化菜单标题
 *
 * @param {string} text - 文本
 * @returns {string}
 */
function formatMenuTitle(text) {
  if (!text) return '';

  const maxLength = systemConfig?.constants?.maxDisplayLength || 20;

  if (text.length > maxLength) {
    return text.slice(0, maxLength) + '...';
  }

  return text;
}

/**
 * 兼容旧 API：构建 URL
 *
 * @param {string} menuId - 菜单 ID
 * @param {Object} params - 参数
 * @returns {string|null}
 */
function buildMenuUrl(menuId, params) {
  if (!urlBuilder) {
    console.warn('[MenuSystem] URLBuilder not initialized');
    return null;
  }

  return urlBuilder.build(menuId, params);
}

/**
 * 兼容旧 API：重建菜单（MenuManager 已下线，直接走 createContextMenus）
 *
 * @returns {Promise<void>}
 */
async function rebuildMenus() {
  if (typeof createContextMenus === 'function') {
    await createContextMenus();
  }
}

// ============================================
// 导出（如果使用模块系统）
// ============================================

// 兼容性：将 API 挂载到全局对象
// 在 Service Worker 中使用 globalThis 或 self
const globalObj = typeof globalThis !== 'undefined' ? globalThis :
                  typeof self !== 'undefined' ? self :
                  typeof window !== 'undefined' ? window : {};

globalObj.MenuSystem = {
  // 初始化
  init: initMenuSystem,

  // 获取实例
  getStateManager,
  getURLBuilder,
  getSystemConfig,

  // 兼容 API
  setMenuState,
  formatMenuTitle,
  buildMenuUrl,
  rebuildMenus
};

// ============================================
// 使用示例
// ============================================

/**
 * 示例 1：兼容模式初始化（生产唯一模式，由 src/background/init.ts 调用）
 *
 * chrome.runtime.onInstalled.addListener(async () => {
 *   // 初始化新工具
 *   await MenuSystem.init({ useNewSystem: false, debug: false });
 *
 *   // 继续使用旧的菜单创建逻辑
 *   await createContextMenus();
 *
 *   // 但可以使用新的状态管理
 *   const stateManager = MenuSystem.getStateManager();
 *   stateManager.setSelection(tabId, selectedText, url);
 * });
 */

/**
 * 示例 2：在旧代码中使用新工具
 *
 * function handleMenuClick(info, tab) {
 *   const rawText = info.selectionText || '';
 *
 *   // 使用新的 URL 构建器
 *   const url = MenuSystem.buildMenuUrl('ccs-baidu', {
 *     raw: rawText,
 *     normalized: rawText.trim()
 *   });
 *
 *   if (url) {
 *     chrome.tabs.create({ url });
 *   }
 * }
 */
