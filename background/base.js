/**
 * 触触搜 - 核心状态与函数
 * 注意：此文件正在逐步重构，许多功能已迁移至新模块：
 * - Constants.js: 常量定义
 * - TextUtils.js: 文本处理函数
 * - StateManager.js: 状态管理
 * - menu/MenuBuilder.js, MenuUpdater.js, MenuHandlers.js: 菜单模块
 * - events/TabEvents.js, MessageEvents.js, MenuEvents.js: 事件处理
 */

// 调试开关 - BG_DEBUG 和 BG_DBG 已在 Constants.js 中定义

// ==================== 新架构：关键字同步机制重构 ====================
function initKeywordSyncSystem() {
  console.log('[触触搜] initKeywordSyncSystem called');

  if (typeof menuRegistry === 'undefined') {
    console.warn('[触触搜] menuRegistry 未定义，可能 MenuRegistry.js 未加载');
    return;
  }

  console.log('[触触搜] menuRegistry found, stats:', menuRegistry.getStats());

  if (typeof keywordSyncManager === 'undefined' && typeof KeywordSyncManager !== 'undefined') {
    globalThis.keywordSyncManager = new KeywordSyncManager(menuRegistry);
    console.log('[触触搜] KeywordSyncManager 已初始化, stats:', keywordSyncManager.getStats());
  } else if (typeof keywordSyncManager !== 'undefined') {
    console.log('[触触搜] keywordSyncManager already initialized');
  } else {
    console.warn('[触触搜] KeywordSyncManager class not found');
  }
}
// ==================================================================

// 使用 TextUtils.js 中的函数（如果可用），否则提供本地实现
// 这样可以逐步迁移到新模块
if (typeof formatMenuTitle === 'undefined') {
  function formatMenuTitle(text) {
    if (!text) return null;
    const compact = text.replace(/\s+/g, ' ').trim();
    if (!compact) return null;
    return compact.substring(0, 20) + (compact.length > 20 ? '...' : '');
  }
  globalThis.formatMenuTitle = formatMenuTitle;
}

if (typeof shouldPreserveMenuStateForUrl === 'undefined') {
  function shouldPreserveMenuStateForUrl(url) {
    if (!url) return false;
    try {
      const hostname = new URL(url).hostname;
      const hosts = typeof QUICK_RESULT_HOSTS !== 'undefined' ? QUICK_RESULT_HOSTS : ['chatgpt.com', 'claude.ai'];
      return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    } catch (_) {
      return false;
    }
  }
  globalThis.shouldPreserveMenuStateForUrl = shouldPreserveMenuStateForUrl;
}

if (typeof shouldPreserveMenuStateForTab === 'undefined') {
  function shouldPreserveMenuStateForTab(tab) {
    if (!tab || typeof tab.url !== 'string') return false;
    return shouldPreserveMenuStateForUrl(tab.url);
  }
  globalThis.shouldPreserveMenuStateForTab = shouldPreserveMenuStateForTab;
}

if (typeof cleanupTitleKeyword === 'undefined') {
  function cleanupTitleKeyword(rawTitle) {
    if (!rawTitle) return '';
    let cleaned = rawTitle.trim();
    const suffixes = [
      ' - 搜索结果', ' - 知乎', ' - Zhihu',
      ' - ChatGPT', ' – ChatGPT', ' — ChatGPT',
      ' - Claude', ' – Claude', ' — Claude'
    ];
    suffixes.forEach((suffix) => {
      if (cleaned.endsWith(suffix)) {
        cleaned = cleaned.slice(0, -suffix.length);
      }
    });
    const prefixPattern = /^[\s]*[\(（][^\)）]*[\)）]\s*/;
    while (prefixPattern.test(cleaned)) {
      cleaned = cleaned.replace(prefixPattern, '').trim();
    }
    return cleaned.trim();
  }
  globalThis.cleanupTitleKeyword = cleanupTitleKeyword;
}

if (typeof normalizeSearchText === 'undefined') {
  function normalizeSearchText(raw) {
    if (!raw) return '';
    let text = raw;
    try {
      if (/%[0-9A-Fa-f]{2}/.test(text) && decodeURIComponent(text) !== text) {
        text = decodeURIComponent(text);
      }
    } catch (_) {}
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  }
  globalThis.normalizeSearchText = normalizeSearchText;
}

// ==================== 变量声明 ====================
// 注意：这些变量现在在 Constants.js 中定义
// 此处只定义 Constants.js 中没有的变量

// Track optimize category label IDs for dynamic updates
const optimizeCategoryLabelIds = [];

// menuIconSupportLoadPromise 在 Constants.js 中没有定义
let menuIconSupportLoadPromise = null;

// 使用 Constants.js 中的常量（如果可用）
// 所有以下变量已在 Constants.js 中定义并导出到 globalThis：
// - optimizedPromptMenuMap, optimizedPromptConfig, optimizedPromptTemplate
// - topQuestionsMenuMap, topQuestionsConfig, topQuestionsTemplate
// - fastAnswersMenuMap, fastAnswersConfig, fastAnswersTemplate
// - menuBuildInProgress, menuBuildPending
// - menuToggleConfig
// - menuIconConfig, menuIconImageCache, menuIconUpdateSupported
// - MENU_ICON_SUPPORT_STORAGE_KEY, menuIconSupportLoaded, menuIconUpdateInProgress
// - fallbackKeywordByTab, selectedTextByTab, latestTitleByTab

function getOrCreateTitleEntry(tabId) {
  if (tabId == null) return null;
  let entry = latestTitleByTab[tabId];
  if (!entry) {
    entry = {};
    latestTitleByTab[tabId] = entry;
  }
  return entry;
}

function updateLatestTabTitle(tabId, pageTitle) {
  if (tabId == null || typeof pageTitle !== 'string') return;
  const entry = getOrCreateTitleEntry(tabId);
  entry.title = pageTitle;
  entry.pageTitle = pageTitle;
  entry.timestamp = Date.now();
}

function updateLatestTabKeyword(tabId, keyword, normalized) {
  if (tabId == null || typeof keyword !== 'string') return;
  const entry = getOrCreateTitleEntry(tabId);
  entry.keyword = keyword;
  entry.keywordNormalized = typeof normalized === 'string' ? normalized : normalizeSearchText(keyword);
  entry.keywordTimestamp = Date.now();
}

function getLatestTabPageTitle(tabId, maxAge = 30000) { // BUGFIX: Extended from 5s to 30s for better cache hit rate
  if (tabId == null) return '';
  const entry = latestTitleByTab[tabId];
  if (!entry) return '';

  // BUGFIX: Check cache freshness to prevent using stale titles from other tabs
  const now = Date.now();
  const age = now - (entry.timestamp || 0);
  if (age > maxAge) {
    logMenuEvent('cached-title-expired', {
      tabId,
      age,
      maxAge,
      title: entry.pageTitle || entry.title
    });
    return ''; // Cache expired, return empty string to force fresh fetch
  }

  return entry?.pageTitle || entry?.title || '';
}

function getLatestTabKeyword(tabId, maxAge = 30000) { // BUGFIX: Extended from 5s to 30s for better cache hit rate
  if (tabId == null) return '';
  const entry = latestTitleByTab[tabId];
  if (!entry) return '';

  // BUGFIX: Check cache freshness to prevent using stale keywords from other tabs
  const now = Date.now();
  const keywordAge = now - (entry.keywordTimestamp || 0);
  if (keywordAge > maxAge) {
    logMenuEvent('cached-keyword-expired', {
      tabId,
      age: keywordAge,
      maxAge,
      keyword: entry.keyword
    });
    return ''; // Cache expired, return empty string
  }

  return entry?.keyword || '';
}

function ensureMenuIconSupportLoaded() {
  if (menuIconSupportLoaded) {
    return Promise.resolve();
  }
  if (menuIconSupportLoadPromise) {
    return menuIconSupportLoadPromise;
  }
  menuIconSupportLoadPromise = new Promise((resolve) => {
    chrome.storage.local.get(['ccs_debug', MENU_ICON_SUPPORT_STORAGE_KEY], (res) => {
      const data = res || {};
      if (typeof data.ccs_debug === 'boolean') {
        BG_DEBUG = data.ccs_debug;
      }
      const iconSupport = data[MENU_ICON_SUPPORT_STORAGE_KEY];
      if (typeof iconSupport === 'boolean') {
        menuIconUpdateSupported = iconSupport;
        if (!menuIconUpdateSupported) {
          logMenuEvent('icon-skip', { reason: 'persisted-unsupported' });
        }
      }
      menuIconSupportLoaded = true;
      resolve();
    });
  });
  return menuIconSupportLoadPromise;
}

// currentMenuState 已在 Constants.js 中定义

// 日志系统：使用 Constants.js 中的 LOG_PREFIX（如果可用）
const LOG_PREFIX_LOCAL = typeof LOG_PREFIX !== 'undefined' ? LOG_PREFIX : '[触触搜][MENU]';
let LOG_SEQUENCE = 0;

function buildLogPayload(payload) {
  const now = new Date();
  const timestamp = now.toISOString();
  const timeMs = now.getTime();
  const monotonicMs = (typeof performance !== 'undefined' && performance.now)
    ? Math.round(performance.now())
    : null;
  const seq = ++LOG_SEQUENCE;
  return Object.assign({ timestamp, timeMs, monotonicMs, seq }, payload || {});
}

function logMenuEvent(stage, payload) {
  try {
    const enrichedPayload = buildLogPayload(payload);
    const summaryParts = [];
    if (typeof enrichedPayload.match === 'boolean') {
      summaryParts.push(`match=${enrichedPayload.match ? 'true' : 'false'}`);
    }
    if (typeof enrichedPayload.source === 'string' && enrichedPayload.source) {
      summaryParts.push(`source=${enrichedPayload.source}`);
    }
    if (typeof enrichedPayload.keyword === 'string' && enrichedPayload.keyword) {
      summaryParts.push(`keyword="${enrichedPayload.keyword}"`);
    }
    if (typeof enrichedPayload.title === 'string' && enrichedPayload.title) {
      summaryParts.push(`title="${enrichedPayload.title}"`);
    }
    if (typeof enrichedPayload.menuDisplay === 'string' && enrichedPayload.menuDisplay) {
      summaryParts.push(`menuDisplay="${enrichedPayload.menuDisplay}"`);
    }
    if (typeof enrichedPayload.menuRaw === 'string' && enrichedPayload.menuRaw) {
      summaryParts.push(`menuRaw="${enrichedPayload.menuRaw}"`);
    }
    const summaryText = summaryParts.join(' | ');
    if (summaryText) {
      console.info(`${LOG_PREFIX_LOCAL} ${stage}`, summaryText, enrichedPayload);
    } else {
      console.info(`${LOG_PREFIX_LOCAL} ${stage}`, enrichedPayload);
    }
  } catch (_) {
    // ignore logging errors
  }
}

// 菜单定义和常量：完全由 Constants.js 提供（该文件在本文件之前加载）
// 注：此前在此处有一份 MENU_DEFINITIONS 副本（被 `typeof MENU_DEFINITIONS === 'undefined'` 守卫包裹），
// 因 Constants.js 已定义同名常量，该副本实际为不可达死代码，现已移除。
// FAST_QA_QUICK_ITEMS 也在 Constants.js 中完成 MENU_DEFINITIONS 的动态扩展。

function getMenuDefinition(menuId) {
  return MENU_DEFINITIONS[menuId] || null;
}

function getMenuText(menuId, fallback) {
  const definition = getMenuDefinition(menuId);
  if (definition && typeof definition.text === 'string' && definition.text) {
    return definition.text;
  }
  if (typeof fallback === 'string' && fallback) {
    return fallback;
  }
  return menuId;
}

function getMenuTitle(menuId, fallback) {
  const definition = getMenuDefinition(menuId);
  const text = getMenuText(menuId, fallback);
  if (definition && typeof definition.icon === 'string' && definition.icon.trim()) {
    return `${definition.icon.trim()} ${text}`;
  }
  return text;
}

// 以下常量已在 Constants.js 中定义，这里保留备用引用
// OPTIMIZE_CATEGORY_TITLES (ENGINE_TITLES 系列已迁移至 config/engines.json + getEngineTitle SSoT)
if (typeof OPTIMIZE_CATEGORY_TITLES === 'undefined') {
  const OPTIMIZE_CATEGORY_TITLES = {
    'deep-research': '📚 深度研究',
    'general-conversation': '💬 普通对话',
    'code-writing': '💻 代码编写',
    'content-creation': '📝 内容创作',
    'data-analysis': '📊 数据分析',
    'problem-solving': '🧩 问题解答',
    'brainstorm': '💡 头脑风暴',
    'description-polish': '✨ 优化描述'
  };
  globalThis.OPTIMIZE_CATEGORY_TITLES = OPTIMIZE_CATEGORY_TITLES;
}

// DYNAMIC_SEARCH_MENU_ITEMS 和 FAST_QA_MENU_ITEMS 已在 Constants.js 中定义

function updateSearchMenuTitles(displayText) {
  const formatted = displayText ? formatMenuTitle(displayText) : '';
  DYNAMIC_SEARCH_MENU_ITEMS.forEach((menuId) => {
    const baseTitle = getMenuTitle(menuId);
    const title = formatted ? `${baseTitle}: "${formatted}"` : baseTitle;
    chrome.contextMenus.update(menuId, { title }, () => {
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message || '';
        if (!/Cannot find menu item/i.test(msg)) {
          logMenuEvent('search-menu-title-update-failed', { id: menuId, error: msg });
        }
      }
    });
    logMenuEvent('search-menu-title', {
      id: menuId,
      title,
      baseTitle,
      formatted,
      menuDisplay: currentMenuState?.display || '',
      menuRaw: currentMenuState?.raw || '',
      menuNormalized: currentMenuState?.normalized || ''
    });
  });
}

async function updateMainMenuTitle(displayText) {
  const baseTitle = getMenuTitle('ccs-main');

  // Show keyword in top-level menu, same as secondary menus
  // Menu remains clickable to access submenus
  const menuTitle = displayText ? `${baseTitle}: "${displayText}"` : baseTitle;

  // Extension icon title can still show keyword (no timing issue there)
  const iconTitle = displayText ? `${baseTitle}: "${displayText}"` : baseTitle;

  // Wait for menu update to complete
  await new Promise((resolve) => {
    chrome.contextMenus.update('ccs-main', { title: menuTitle }, () => {
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message || '';
        if (!/Cannot find menu item/i.test(msg)) {
          logMenuEvent('main-title-update-failed', { error: msg });
        }
      }
      resolve();
    });
  });

  if (chrome.action && chrome.action.setTitle) {
    chrome.action.setTitle({ title: iconTitle });
  }
  logMenuEvent('main-title', { menuTitle, iconTitle, displayText });
}

async function updateSearchLabelTitle(displayText) {
  const formatted = displayText ? formatMenuTitle(displayText) : '';
  const title = formatted ? `🔍 触触搜: "${formatted}"` : '🔍 触触搜';

  // Wait for menu update to complete
  await new Promise((resolve) => {
    chrome.contextMenus.update('ccs-search-label', { title }, () => {
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message || '';
        if (!/Cannot find menu item/i.test(msg)) {
          logMenuEvent('search-label-update-failed', { error: msg });
        }
      }
      resolve();
    });
  });

  logMenuEvent('search-label', { title, displayText });
}

async function updateSubmenuLabels(displayText) {
  const formatted = displayText ? formatMenuTitle(displayText) : '';
  const title = formatted ? `🔍 触触搜: "${formatted}"` : '🔍 触触搜';

  // Fixed submenu labels (hardcoded to avoid race conditions)
  const fixedLabelIds = [
    'ccs-top100-label',
    'ccs-fastqa-label',
    // Optimize prompt category labels (hardcoded to match other working labels)
    'ccs-optimize-deep-research-label',
    'ccs-optimize-general-conversation-label',
    'ccs-optimize-code-writing-label',
    'ccs-optimize-content-creation-label',
    'ccs-optimize-data-analysis-label',
    'ccs-optimize-problem-solving-label',
    'ccs-optimize-brainstorm-label',
    'ccs-optimize-description-polish-label'
  ];

  // Collect all update promises
  const updatePromises = [];

  // Update all fixed labels (including optimize labels)
  fixedLabelIds.forEach(labelId => {
    const promise = new Promise((resolve) => {
      chrome.contextMenus.update(labelId, { title }, () => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || '';
          if (!/Cannot find menu item/i.test(msg)) {
            logMenuEvent('submenu-label-update-failed', { labelId, error: msg });
          }
          resolve({ labelId, success: false, error: msg });
        } else {
          logMenuEvent('submenu-label-updated', { labelId, title });
          resolve({ labelId, success: true });
        }
      });
    });
    updatePromises.push(promise);
  });

  // Wait for all updates to complete
  const results = await Promise.all(updatePromises);
  const successCount = results.filter(r => r.success).length;
  const failedCount = results.filter(r => !r.success).length;

  logMenuEvent('submenu-labels-updated', {
    title,
    displayText,
    totalLabels: fixedLabelIds.length,
    successCount,
    failedCount
  });
}

async function setMenuState(rawText, normalizedText, meta) {
  const raw = typeof rawText === 'string' ? rawText : '';
  const normalized = typeof normalizedText === 'string' ? normalizedText : '';
  const base = normalized || raw;
  const displayText = base ? formatMenuTitle(base) : '';

  // BUGFIX: Log tab ID transitions to detect cross-tab contamination
  const previousTabId = currentMenuState.tabId;
  const newTabId = (meta && typeof meta === 'object' && 'tabId' in meta)
    ? (typeof meta.tabId === 'number' ? meta.tabId : null)
    : previousTabId; // Keep previous if not specified

  if (previousTabId != null && newTabId != null && previousTabId !== newTabId) {
    logMenuEvent('state-update-tab-change', {
      previousTabId,
      newTabId,
      previousUrl: currentMenuState.url,
      newUrl: meta?.url || currentMenuState.url,
      raw,
      normalized
    });
  }

  // BUGFIX: Warn if setting state without explicit tab ID (potential bug source)
  if (raw && !newTabId) {
    logMenuEvent('state-update-missing-tabid', {
      raw,
      normalized,
      url: meta?.url || currentMenuState.url
    });
  }

  // BUGFIX: Validate that the requested tabId is the currently active tab
  // to prevent cross-tab state contamination during fast tab switching
  // FAIL-OPEN MODE: Only reject if CERTAIN the message is from inactive tab
  if (newTabId != null && raw) {
    try {
      const activeTabs = await chrome.tabs.query({active: true, currentWindow: true});
      const activeTabId = activeTabs?.[0]?.id ?? null;

      // Only reject if we have valid activeTabId AND it differs
      if (activeTabId != null && newTabId !== activeTabId) {
        logMenuEvent('state-update-rejected-inactive-tab', {
          requestedTabId: newTabId,
          activeTabId: activeTabId,
          raw: raw?.substring(0, 50),
          normalized: normalized?.substring(0, 50)
        });
        return; // Reject state updates from inactive tabs
      }

      // Log when allowing through due to null activeTabId (fail-open)
      if (activeTabId == null) {
        logMenuEvent('state-update-validation-null-active', {
          newTabId,
          raw: raw?.substring(0, 50),
          reason: 'chrome.tabs.query returned no active tab, allowing through (fail-open)'
        });
      }
    } catch (error) {
      logMenuEvent('state-update-validation-error', {
        error: error?.message,
        tabId: newTabId
      });
      // Continue processing if validation fails (fail-open)
    }
  }

  currentMenuState.raw = raw;
  currentMenuState.normalized = normalized;
  currentMenuState.display = displayText;
  if (meta && typeof meta === 'object') {
    if ('tabId' in meta) {
      currentMenuState.tabId = typeof meta.tabId === 'number' ? meta.tabId : null;
    }
    if ('url' in meta) {
      currentMenuState.url = typeof meta.url === 'string' ? meta.url : '';
    }
  }
  const targetTabId = typeof meta?.tabId === 'number' ? meta.tabId : null;
  if (targetTabId != null) {
    const keywordCandidate = raw || normalized;
    if (keywordCandidate) {
      updateLatestTabKeyword(targetTabId, keywordCandidate, normalized || keywordCandidate);
    }
  }
  logMenuEvent('state-update', { ...currentMenuState });

  // 新架构：使用 KeywordSyncManager 统一同步所有菜单（尝试更新，不强制依赖）
  if (typeof keywordSyncManager !== 'undefined' && keywordSyncManager) {
    try {
      // 更新状态
      await keywordSyncManager.update(raw, normalized, meta);

      // 立即同步菜单（不依赖 onShown）
      const syncResult = await keywordSyncManager.syncMenus();

      logMenuEvent('keyword-sync-via-new-system', {
        raw,
        normalized,
        displayText,
        tabId: newTabId,
        syncResult
      });
    } catch (error) {
      console.error('[触触搜] 新同步系统更新失败:', error);
      logMenuEvent('keyword-sync-error', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  // BUGFIX: 强制使用旧系统更新所有菜单，确保优化提示词菜单总是被正确更新
  // 不依赖新系统的成功与否，旧系统已证明对其他菜单有效
  // TIMING FIX: Wait for all menu updates to complete before returning
  // This ensures menu titles are updated before chrome.contextMenus.refresh() is called
  await Promise.all([
    updateMainMenuTitle(displayText),
    updateSearchLabelTitle(displayText),
    updateSubmenuLabels(displayText)  // ← 更新优化提示词标签
  ]);
  updateSearchMenuTitles(displayText);  // This one is rarely used, keep sync

  logMenuEvent('keyword-sync-old-system-forced', {
    display: displayText,
    raw,
    normalized
  });
  // 移除速答壹拾佰等菜单项的关键字显示，避免重复
  // FAST_QA_MENU_ITEMS.forEach((menuId) => {
  //   const baseTitle = getMenuTitle(menuId);
  //   const title = displayText ? `${baseTitle}: "${displayText}"` : baseTitle;
  //   chrome.contextMenus.update(menuId, { title }, () => {
  //     if (chrome.runtime.lastError) {
  //       const msg = chrome.runtime.lastError.message || '';
  //       if (!/Cannot find menu item/i.test(msg)) {
  //         logMenuEvent('fastqa-menu-title-update-failed', { id: menuId, error: msg });
  //       }
  //     }
  //   });
  //   logMenuEvent('fastqa-menu-title', {
  //     id: menuId,
  //     title,
  //     baseTitle,
  //     formatted: displayText ? formatMenuTitle(displayText) : '',
  //     menuDisplay: currentMenuState?.display || '',
  //     menuRaw: currentMenuState?.raw || '',
  //     menuNormalized: currentMenuState?.normalized || ''
  //   });
  // });
  // BUGFIX: Add small delay before refreshing to ensure Chrome updates its internal menu cache
  // Without this delay, Chrome may show stale menu items when right-clicking immediately after text selection
  if (chrome.contextMenus.refresh) {
    setTimeout(() => {
      chrome.contextMenus.refresh();
      logMenuEvent('context-menu-refreshed-delayed', {
        timestamp: Date.now(),
        delayMs: 50
      });
    }, 50);
  }

  // Broadcast keyword change to extension pages (sidepanel)
  chrome.runtime.sendMessage({
    action: 'keywordUpdated',
    keyword: { text: normalized || raw, raw: raw }
  }).catch(() => {});
}

function applyMenuTitle(normalizedText, rawText = '', meta) {
  setMenuState(rawText, normalizedText, meta);
}

async function refreshMenuTitle(tab, selectionText = '') {
  try {
    const result = await computeSearchTextForTab({
      tabId: tab?.id,
      tabUrl: tab?.url,
      tabTitle: tab?.title || '',
      selectionText
    });
    applyMenuTitle(result.normalized, result.raw, {
      tabId: tab?.id ?? null,
      url: tab?.url || ''
    });
  } catch (error) {
    console.warn('[触触搜][BG] refreshMenuTitle失败:', error);
  }
}

/**
 * Refresh context menu display
 * Called after menu state updates to ensure visual updates are applied
 */
async function refreshContextMenu() {
  if (chrome.contextMenus.refresh) {
    chrome.contextMenus.refresh();
    logMenuEvent('context-menu-refreshed', {
      timestamp: Date.now()
    });
  }
}

async function copyTextInTab(tab, text) {
  if (!tab || !text) return false;
  const tabId = tab.id;
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'copyText',
      text
    });
    return true;
  } catch (err) {
    BG_DBG('[触触搜][BG][COPY] sendMessage 失败，尝试注入脚本', err);
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (value) => {
        const fallbackCopy = () => {
          const textarea = document.createElement('textarea');
          textarea.value = value;
          textarea.setAttribute('readonly', '');
          textarea.style.position = 'fixed';
          textarea.style.top = '-10000px';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          textarea.remove();
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).catch(fallbackCopy);
        } else {
          fallbackCopy();
        }
      },
      args: [text]
    });
    return true;
  } catch (err) {
    console.warn('[触触搜][BG][COPY] 注入复制脚本失败', err);
  }
  return false;
}

// menuBuildCounter 和 selectedTextByTab 已在 Constants.js 中定义

/**
 * 获取菜单调试信息（供 popup 调试使用）
 *
 * @param {number} tabId - 当前活动标签页 ID
 * @returns {Promise<Object>} 包含所有菜单状态的调试信息
 */
async function getMenuDebugInfo(tabId) {
  const debugInfo = {
    timestamp: new Date().toISOString(),
    generatedAt: Date.now(),

    // 1. 当前活动 tab 信息
    activeTab: {
      tabId: tabId,
      url: null,
      title: null
    },

    // 2. currentMenuState
    currentMenuState: {
      raw: currentMenuState.raw,
      normalized: currentMenuState.normalized,
      display: currentMenuState.display,
      tabId: currentMenuState.tabId,
      url: currentMenuState.url
    },

    // 3. 全局缓存对象
    globalCaches: {
      selectedTextByTab: {},
      fallbackKeywordByTab: {},
      latestTitleByTab: {}
    },

    // 4. MenuRegistry 状态
    menuRegistry: {
      available: typeof menuRegistry !== 'undefined',
      stats: null
    },

    // 5. KeywordSyncManager 状态
    keywordSyncManager: {
      available: typeof keywordSyncManager !== 'undefined',
      currentState: null,
      stats: null
    }
  };

  // 获取 tab 详细信息
  if (tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      debugInfo.activeTab.url = tab.url;
      debugInfo.activeTab.title = tab.title;
    } catch (error) {
      debugInfo.activeTab.error = error.message;
    }
  }

  // 复制全局缓存对象（转换为普通对象以便 JSON 序列化）
  if (typeof selectedTextByTab !== 'undefined') {
    debugInfo.globalCaches.selectedTextByTab = Object.assign({}, selectedTextByTab);
  }

  if (typeof fallbackKeywordByTab !== 'undefined') {
    debugInfo.globalCaches.fallbackKeywordByTab = Object.assign({}, fallbackKeywordByTab);
  }

  if (typeof latestTitleByTab !== 'undefined') {
    debugInfo.globalCaches.latestTitleByTab = Object.assign({}, latestTitleByTab);
  }

  // 获取 MenuRegistry 状态
  if (typeof menuRegistry !== 'undefined' && menuRegistry) {
    try {
      debugInfo.menuRegistry.stats = menuRegistry.getStats();

      // 获取所有注册的菜单项详细信息
      const allMenuIds = menuRegistry.getAllMenuIds();
      debugInfo.menuRegistry.registeredMenus = {};

      for (const menuId of allMenuIds) {
        const config = menuRegistry.get(menuId);
        if (config) {
          debugInfo.menuRegistry.registeredMenus[menuId] = {
            title: config.title,
            icon: config.icon,
            titleTemplate: config.titleTemplate,
            syncGroup: config.syncGroup,
            autoSync: config.autoSync,
            parentId: config.parentId
          };
        }
      }
    } catch (error) {
      debugInfo.menuRegistry.error = error.message;
    }
  }

  // 获取 KeywordSyncManager 状态
  if (typeof keywordSyncManager !== 'undefined' && keywordSyncManager) {
    try {
      debugInfo.keywordSyncManager.currentState = keywordSyncManager.getState();
      debugInfo.keywordSyncManager.stats = keywordSyncManager.getStats();
    } catch (error) {
      debugInfo.keywordSyncManager.error = error.message;
    }
  }

  // 添加变量来源说明
  debugInfo.variableSources = {
    currentMenuState: 'background/base.js (全局变量)',
    selectedTextByTab: 'background/base.js (全局变量，由 events.js 更新)',
    fallbackKeywordByTab: 'background/base.js (全局变量，由 keywordResolver.js 更新)',
    latestTitleByTab: 'background/base.js (全局变量，由 events.js 更新)',
    menuRegistry: 'background/MenuRegistry.js (单例)',
    keywordSyncManager: 'background/KeywordSyncManager.js (单例)'
  };

  // 添加数据流说明
  debugInfo.dataFlow = {
    description: '关键字更新流程',
    steps: [
      '1. 用户操作触发 (选中文本/Tab切换) → events.js',
      '2. events.js 更新全局缓存 (selectedTextByTab/fallbackKeywordByTab/latestTitleByTab)',
      '3. events.js 调用 setMenuState(raw, normalized, meta)',
      '4. setMenuState 更新 currentMenuState',
      '5. setMenuState 调用 keywordSyncManager.update()',
      '6. setMenuState 调用 keywordSyncManager.syncMenus()',
      '7. syncMenus 调用 menuRegistry.syncAll(context)',
      '8. menuRegistry.syncAll 遍历所有注册的菜单项',
      '9. 使用 titleTemplate 渲染标题',
      '10. 调用 chrome.contextMenus.update() 更新菜单',
      '11. (同时) 旧系统调用 updateMainMenuTitle/updateSearchLabelTitle/updateSubmenuLabels'
    ]
  };

  return debugInfo;
}

/**
 * 获取 Popup 菜单结构（与右键菜单保持一致）
 *
 * @returns {Promise<Object>} 包含菜单组和项目的结构
 */
async function getPopupMenuStructure() {
  await loadMenuToggleConfig();

  const structure = {
    groups: []
  };

  // 1. 快速问答组 (fastQaQuick)
  const quickEnabledItems = FAST_QA_QUICK_ITEMS.filter(item => isMenuEnabled(item.id));
  if (quickEnabledItems.length > 0) {
    structure.groups.push({
      id: 'fastQaQuick',
      separator: 'after',
      items: quickEnabledItems.map(item => ({
        id: item.id,
        title: getMenuText(item.id),
        icon: MENU_DEFINITIONS[item.id]?.icon || item.menuIcon || '',
        type: 'fastqa-quick',
        engineId: item.engineId
      }))
    });
  }

  // 2. 搜索组 (search)
  const searchItems = [
    { id: 'ccs-baidu', type: 'search', urlPattern: 'https://www.baidu.com/s?wd=${KEYWORD}' },
    { id: 'ccs-google', type: 'search', urlPattern: 'https://www.google.com/search?q=${KEYWORD}' }
  ].filter(item => isMenuEnabled(item.id));

  if (searchItems.length > 0) {
    structure.groups.push({
      id: 'search',
      separator: 'after',
      items: searchItems.map(item => ({
        id: item.id,
        title: getMenuText(item.id),
        icon: MENU_DEFINITIONS[item.id]?.icon || '',
        type: item.type,
        urlPattern: item.urlPattern
      }))
    });
  }

  // 3. AI 对话组 (ai)
  const aiItems = [
    { id: 'ccs-chatgpt', type: 'ai-chat', urlPattern: 'https://chatgpt.com/?q=${KEYWORD}' },
    { id: 'ccs-claude', type: 'ai-chat', urlPattern: 'https://claude.ai/new?q=${KEYWORD}' },
    { id: 'ccs-grok', type: 'ai-chat', urlPattern: 'https://grok.com/?q=${KEYWORD}' },
    { id: 'ccs-yiyan', type: 'ai-search', urlPattern: 'https://yiyan.baidu.com/?q=${KEYWORD}' },
    { id: 'ccs-google-ai-chat', type: 'ai-chat', urlPattern: 'https://www.google.com/search?udm=50&ie=UTF-8&oe=UTF-8&q=${KEYWORD}' }
  ].filter(item => isMenuEnabled(item.id));

  if (aiItems.length > 0) {
    structure.groups.push({
      id: 'ai',
      separator: 'after',
      items: aiItems.map(item => ({
        id: item.id,
        title: getMenuText(item.id),
        icon: MENU_DEFINITIONS[item.id]?.icon || '',
        type: item.type,
        urlPattern: item.urlPattern
      }))
    });
  }

  // 4. 通用组 (general)
  const generalItems = [
    { id: 'ccs-zhihu', type: 'search', urlPattern: 'https://www.zhihu.com/search?q=${KEYWORD}' },
    { id: 'ccs-weixin', type: 'search', urlPattern: 'https://weixin.sogou.com/weixin?query=${KEYWORD}' },
    { id: 'ccs-taobao', type: 'ecommerce', urlPattern: 'https://s.taobao.com/search?q=${KEYWORD}' },
    { id: 'ccs-jd', type: 'ecommerce', urlPattern: 'https://search.jd.com/Search?keyword=${KEYWORD}' },
    { id: 'ccs-sov2ex', type: 'search', urlPattern: 'https://www.sov2ex.com/?q=${KEYWORD}' },
    { id: 'ccs-google-translate', type: 'translate', urlPattern: 'https://translate.google.com/?sl=auto&tl=zh-CN&text=${KEYWORD}' },
    { id: 'ccs-chuchusou', type: 'portal', urlPattern: 'https://chuchusou.com/#/?keyword=${KEYWORD}' }
  ].filter(item => isMenuEnabled(item.id));

  if (generalItems.length > 0) {
    structure.groups.push({
      id: 'general',
      separator: 'none',
      items: generalItems.map(item => ({
        id: item.id,
        title: getMenuText(item.id),
        icon: MENU_DEFINITIONS[item.id]?.icon || '',
        type: item.type,
        urlPattern: item.urlPattern
      }))
    });
  }

  // 5. 高级功能组 (advanced) - 动态加载
  const advancedItems = [];

  // 5.1 触触搜百问
  if (isMenuEnabled('ccs-top100-root')) {
    const top100Config = await loadTopQuestionsConfig();
    const top100Children = [];

    if (isMenuEnabled('ccs-top100-open-all')) {
      top100Children.push({
        id: 'ccs-top100-open-all',
        title: getMenuText('ccs-top100-open-all'),
        icon: MENU_DEFINITIONS['ccs-top100-open-all']?.icon || '🚀',
        type: 'action'
      });
    }

    if (top100Config && top100Config.engines) {
      for (const engine of top100Config.engines) {
        const menuId = `ccs-top100-${engine.id}`;
        if (isMenuEnabled(menuId)) {
          top100Children.push({
            id: menuId,
            title: getEngineTitle(engine.id, engine.label),
            icon: engine.icon || '',
            type: 'top100',
            engineId: engine.id,
            urlPattern: engine.urlPattern
          });
        }
      }
    }

    if (top100Children.length > 0) {
      advancedItems.push({
        id: 'ccs-top100-root',
        title: getMenuText('ccs-top100-root'),
        icon: MENU_DEFINITIONS['ccs-top100-root']?.icon || '💯',
        type: 'submenu',
        children: top100Children
      });
    }
  }

  // 5.2 速答壹拾佰
  if (isMenuEnabled('ccs-fastqa-root')) {
    const fastqaConfig = await loadFastAnswersConfig();
    const fastqaChildren = [];

    if (isMenuEnabled('ccs-fastqa-open-all')) {
      fastqaChildren.push({
        id: 'ccs-fastqa-open-all',
        title: getMenuText('ccs-fastqa-open-all'),
        icon: MENU_DEFINITIONS['ccs-fastqa-open-all']?.icon || '🚀',
        type: 'action'
      });
    }

    if (fastqaConfig && fastqaConfig.engines) {
      for (const engine of fastqaConfig.engines) {
        const menuId = `ccs-fastqa-${engine.id}`;
        if (isMenuEnabled(menuId)) {
          fastqaChildren.push({
            id: menuId,
            title: getEngineTitle(engine.id, engine.label),
            icon: engine.icon || '',
            type: 'fastqa',
            engineId: engine.id,
            urlPattern: engine.urlPattern
          });
        }
      }
    }

    if (fastqaChildren.length > 0) {
      advancedItems.push({
        id: 'ccs-fastqa-root',
        title: getMenuText('ccs-fastqa-root'),
        icon: MENU_DEFINITIONS['ccs-fastqa-root']?.icon || '⚡',
        type: 'submenu',
        children: fastqaChildren
      });
    }
  }

  // 5.3 优化提示词
  if (isMenuEnabled('ccs-optimize-root')) {
    const optimizeConfig = await loadOptimizedPromptConfig();
    const optimizeChildren = [];

    if (optimizeConfig && optimizeConfig.categories) {
      for (const category of optimizeConfig.categories) {
        const categoryId = `ccs-optimize-${category.id}`;
        if (!isMenuEnabled(categoryId)) continue;

        const categoryEngines = [];
        // popup/sidepanel: 每个 category 顶部插入"打开以下全部"
        const catOpenAllId = `ccs-optimize-${category.id}-open-all`;
        if (isMenuEnabled(catOpenAllId)) {
          categoryEngines.push({
            id: catOpenAllId,
            title: '🚀 打开以下全部',
            icon: '',
            type: 'optimize',
            categoryId: category.id,
            openAll: true,
            purpose: category.purpose || category.label
          });
        }
        for (const engine of category.engines || []) {
          const menuId = `ccs-optimize-${category.id}-${engine.id}`;
          if (isMenuEnabled(menuId)) {
            categoryEngines.push({
              id: menuId,
              title: getEngineTitle(engine.id, engine.label),
              icon: engine.icon || '',
              type: 'optimize',
              categoryId: category.id,
              engineId: engine.id,
              purpose: category.purpose || category.label,
              urlPattern: engine.urlPattern
            });
          }
        }

        if (categoryEngines.length > 0) {
          optimizeChildren.push({
            id: categoryId,
            title: OPTIMIZE_CATEGORY_TITLES[category.id] || category.label,
            icon: category.icon || '',
            type: 'submenu',
            children: categoryEngines
          });
        }
      }
    }

    if (optimizeChildren.length > 0) {
      advancedItems.push({
        id: 'ccs-optimize-root',
        title: getMenuText('ccs-optimize-root'),
        icon: MENU_DEFINITIONS['ccs-optimize-root']?.icon || '🧠',
        type: 'submenu',
        children: optimizeChildren
      });
    }
  }

  // 5.4 封面生成器（扁平：风格直接做叶子，跳过引擎子菜单——单引擎场景下省 1 次点击）
  if (isMenuEnabled('ccs-cover-root')) {
    const coverConfig = await loadCoverPromptConfig();
    const coverChildren = [];
    const coverPresets = [];

    if (coverConfig && coverConfig.categories) {
      for (const category of coverConfig.categories) {
        // custom 自定义风格仅在 sidepanel 置顶 picker 内可用，popup 主菜单跳过
        if (category.id === 'custom') continue;
        const engine = (category.engines || [])[0];
        if (!engine) continue;
        const leafId = `ccs-cover-${category.id}-${engine.id}`;
        if (!isMenuEnabled(leafId)) continue;
        coverPresets.push({
          id: leafId,
          title: COVER_CATEGORY_TITLES[category.id] || category.label,
          icon: '',
          type: 'cover',
          categoryId: category.id,
          engineId: engine.id,
          purpose: category.purpose || category.label,
          urlPattern: engine.urlPattern
        });
      }
    }

    // 「打开以下全部预设风格」置于子菜单顶部，与速答/百问保持一致
    if (coverPresets.length >= 2 && isMenuEnabled('ccs-cover-open-all')) {
      coverChildren.push({
        id: 'ccs-cover-open-all',
        title: '🚀 打开以下全部预设风格',
        icon: '',
        type: 'cover',
        openAll: true
      });
    }
    coverChildren.push(...coverPresets);

    if (coverChildren.length > 0) {
      advancedItems.push({
        id: 'ccs-cover-root',
        title: getMenuText('ccs-cover-root'),
        icon: MENU_DEFINITIONS['ccs-cover-root']?.icon || '🎨',
        type: 'submenu',
        children: coverChildren
      });
    }
  }

  if (advancedItems.length > 0) {
    structure.groups.push({
      id: 'advanced',
      separator: 'before',
      items: advancedItems
    });
  }

  // 6. 工具组 (tool)
  const toolItems = [
    { id: 'ccs-copy', type: 'tool', action: 'copy' },
    { id: 'ccs-base64', type: 'tool', action: 'base64-encode' },
    { id: 'ccs-md5', type: 'tool', action: 'md5-hash' },
    { id: 'ccs-url-encode', type: 'tool', action: 'url-encode' }
  ].filter(item => isMenuEnabled(item.id));

  if (toolItems.length > 0) {
    structure.groups.push({
      id: 'tool',
      separator: 'before',
      items: toolItems.map(item => ({
        id: item.id,
        title: getMenuText(item.id),
        icon: MENU_DEFINITIONS[item.id]?.icon || '',
        type: item.type,
        action: item.action
      }))
    });
  }

  // 7. 文本转换组 (transform)
  const transformItems = [
    { id: 'ccs-upper', type: 'transform', action: 'to-uppercase' },
    { id: 'ccs-lower', type: 'transform', action: 'to-lowercase' }
  ].filter(item => isMenuEnabled(item.id));

  if (transformItems.length > 0) {
    structure.groups.push({
      id: 'transform',
      separator: 'before',
      items: transformItems.map(item => ({
        id: item.id,
        title: getMenuText(item.id),
        icon: MENU_DEFINITIONS[item.id]?.icon || '',
        type: item.type,
        action: item.action
      }))
    });
  }

  // 8. 面板控制 (panel)
  if (isMenuEnabled('ccs-show-popover')) {
    structure.groups.push({
      id: 'panel',
      separator: 'before',
      items: [{
        id: 'ccs-show-popover',
        title: getMenuText('ccs-show-popover'),
        icon: MENU_DEFINITIONS['ccs-show-popover']?.icon || '🪟',
        type: 'action',
        action: 'show-popover'
      }]
    });
  }

  return structure;
}

// ==================== 导出到全局 ====================

// 从 base.js 导出的函数
globalThis.updateLatestTabTitle = updateLatestTabTitle;
globalThis.ensureMenuIconSupportLoaded = ensureMenuIconSupportLoaded;
globalThis.copyTextInTab = copyTextInTab;
globalThis.getMenuDebugInfo = getMenuDebugInfo;
globalThis.getPopupMenuStructure = getPopupMenuStructure;
globalThis.refreshMenuTitle = refreshMenuTitle;
globalThis.refreshContextMenu = typeof refreshContextMenu !== 'undefined' ? refreshContextMenu : null;
globalThis.applyMenuTitle = typeof applyMenuTitle !== 'undefined' ? applyMenuTitle : null;
globalThis.updateMainMenuTitle = typeof updateMainMenuTitle !== 'undefined' ? updateMainMenuTitle : null;
globalThis.applyMenuIcons = typeof applyMenuIcons !== 'undefined' ? applyMenuIcons : null;
globalThis.snapshotMenuTitles = typeof snapshotMenuTitles !== 'undefined' ? snapshotMenuTitles : null;
globalThis.getLatestTabPageTitle = typeof getLatestTabPageTitle !== 'undefined' ? getLatestTabPageTitle : null;
globalThis.getLatestTabKeyword = typeof getLatestTabKeyword !== 'undefined' ? getLatestTabKeyword : null;
globalThis.updateLatestTabKeyword = typeof updateLatestTabKeyword !== 'undefined' ? updateLatestTabKeyword : null;
globalThis.initKeywordSyncSystem = typeof initKeywordSyncSystem !== 'undefined' ? initKeywordSyncSystem : null;
globalThis.setMenuState = typeof setMenuState !== 'undefined' ? setMenuState : null;
globalThis.getMenuState = typeof getMenuState !== 'undefined' ? getMenuState : null;
globalThis.createContextMenus = typeof createContextMenus !== 'undefined' ? createContextMenus : null;
