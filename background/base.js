// 提取URL中的搜索关键词或页面标题
let BG_DEBUG = false;
const BG_DBG = (...args) => { if (BG_DEBUG) console.log(...args); };

// ==================== 新架构：关键字同步机制重构 ====================
// MenuRegistry.js 会自动导出 menuRegistry 单例
// KeywordSyncManager 需要手动初始化

// 初始化新的同步系统（延迟初始化，在 MenuRegistry.js 加载后）
function initKeywordSyncSystem() {
  console.log('[触触搜] initKeywordSyncSystem called');

  // MenuRegistry 已经作为全局单例导出，检查是否可用
  if (typeof menuRegistry === 'undefined') {
    console.warn('[触触搜] menuRegistry 未定义，可能 MenuRegistry.js 未加载');
    return;
  }

  console.log('[触触搜] menuRegistry found, stats:', menuRegistry.getStats());

  // 创建 KeywordSyncManager 实例（只有在未创建时）
  if (typeof keywordSyncManager === 'undefined' && typeof KeywordSyncManager !== 'undefined') {
    // 直接在全局作用域创建实例
    globalThis.keywordSyncManager = new KeywordSyncManager(menuRegistry);
    console.log('[触触搜] KeywordSyncManager 已初始化, stats:', keywordSyncManager.getStats());

    // 确认 onShown 监听器已注册
    console.log('[触触搜] KeywordSyncManager onShown listener should be registered');
  } else if (typeof keywordSyncManager !== 'undefined') {
    console.log('[触触搜] keywordSyncManager already initialized');
  } else {
    console.warn('[触触搜] KeywordSyncManager class not found');
  }
}
// ==================================================================

function formatMenuTitle(text) {
  if (!text) return null;
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return null;
  return compact.substring(0, 20) + (compact.length > 20 ? '...' : '');
}

function shouldPreserveMenuStateForUrl(url) {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname;
    return QUICK_RESULT_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch (_) {
    return false;
  }
}

function shouldPreserveMenuStateForTab(tab) {
  if (!tab || typeof tab.url !== 'string') return false;
  return shouldPreserveMenuStateForUrl(tab.url);
}

function cleanupTitleKeyword(rawTitle) {
  if (!rawTitle) return '';
  let cleaned = rawTitle.trim();
  const suffixes = [
    ' - 搜索结果',
    ' - 知乎',
    ' - Zhihu',
    ' - ChatGPT',
    ' – ChatGPT',
    ' — ChatGPT',
    ' - Claude',
    ' – Claude',
    ' — Claude'
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

function normalizeSearchText(raw) {
  if (!raw) return '';
  let text = raw;
  // Decode once more if it still contains percent-encoding sequences
  try {
    if (/%[0-9A-Fa-f]{2}/.test(text) && decodeURIComponent(text) !== text) {
      text = decodeURIComponent(text);
    }
  } catch (_) {}
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

const optimizedPromptMenuMap = new Map();
let optimizedPromptConfig = null;
let optimizedPromptTemplate = '';
// Track optimize category label IDs for dynamic updates
const optimizeCategoryLabelIds = [];

const topQuestionsMenuMap = new Map();
let topQuestionsConfig = null;
let topQuestionsTemplate = '';

const fastAnswersMenuMap = new Map();
let fastAnswersConfig = null;
let fastAnswersTemplate = '';
let menuBuildInProgress = false;
let menuBuildPending = false;

let menuToggleConfig = null;

let menuIconConfig = null;
const menuIconImageCache = new Map();
let menuIconUpdateSupported = true;
const MENU_ICON_SUPPORT_STORAGE_KEY = 'ccs_menu_icon_supported';
let menuIconSupportLoaded = false;
let menuIconSupportLoadPromise = null;
let menuIconUpdateInProgress = false;
const QUICK_RESULT_HOSTS = ['chatgpt.com', 'claude.ai'];

const fallbackKeywordByTab = {};
const latestTitleByTab = {};

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

const currentMenuState = {
  raw: '',
  normalized: '',
  display: '',
  tabId: null,
  url: ''
};

const LOG_PREFIX = '[触触搜][MENU]';
let LOG_SEQUENCE = 0;

function buildLogPayload(payload) {
  const now = new Date();
  const timestamp = now.toISOString();
  const timeMs = now.getTime();
  const monotonicMs = (typeof performance !== 'undefined' && performance.now)
    ? Math.round(performance.now())
    : null;
  const seq = ++LOG_SEQUENCE;
  return Object.assign(
    {
      timestamp,
      timeMs,
      monotonicMs,
      seq
    },
    payload || {}
  );
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
      console.info(`${LOG_PREFIX} ${stage}`, summaryText, enrichedPayload);
    } else {
      console.info(`${LOG_PREFIX} ${stage}`, enrichedPayload);
    }
  } catch (_) {
    // ignore logging errors
  }
}

const MENU_DEFINITIONS = {
  'ccs-main': { text: '触触搜', icon: '🔍' },
  'ccs-baidu': { text: '百度搜索', icon: '🐼' },
  'ccs-google': { text: 'Google 搜索', icon: '🔎' },
  'ccs-tongyi': { text: '通义千问', icon: '🪄' },
  'ccs-yiyan': { text: '文心一言', icon: '🧠' },
  'ccs-chatgpt': { text: 'ChatGPT', icon: '🤖' },
  'ccs-claude': { text: 'Claude', icon: '🧠' },
  'ccs-grok': { text: 'Grok', icon: '🦊' },
  'ccs-zhihu': { text: '知乎搜索', icon: '💡' },
  'ccs-weixin': { text: '微信搜一搜', icon: '💬' },
  'ccs-taobao': { text: '淘宝搜索', icon: '🛒' },
  'ccs-jd': { text: '京东搜索', icon: '🛍️' },
  'ccs-sov2ex': { text: 'V2EX (sov2ex)', icon: '💻' },
  'ccs-baidu-translate': { text: '百度翻译', icon: '✍️' },
  'ccs-google-translate': { text: 'Google 翻译', icon: '🔁' },
  'ccs-chuchusou': { text: '更多搜索引擎...', icon: '🌐' },
  'ccs-top100-root': { text: '触触搜百问', icon: '💯' },
  'ccs-top100-open-all': { text: '打开以下全部', icon: '🚀' },
  'ccs-fastqa-root': { text: '速答壹拾佰', icon: '⚡' },
  'ccs-fastqa-open-all': { text: '打开以下全部', icon: '🚀' },
  'ccs-optimize-root': { text: '优化提示词', icon: '🧠' },
  'ccs-copy': { text: '复制文本', icon: '📋' },
  'ccs-base64': { text: 'Base64 编码', icon: '🔤' },
  'ccs-md5': { text: 'MD5 哈希', icon: '🔐' },
  'ccs-url-encode': { text: 'URL 编码', icon: '🔗' },
  'ccs-upper': { text: '转换为大写', icon: '🔠' },
  'ccs-lower': { text: '转换为小写', icon: '🔡' },
  'ccs-show-popover': { text: '打开触触搜面板 (Alt+S)', icon: '🪟' }
};

const FAST_QA_QUICK_ITEMS = [
  {
    id: 'ccs-fastqa-chatgpt-quick',
    engineId: 'chatgpt',
    titleKey: 'chatgpt',
    menuTitle: '触触搜 · 速答壹拾佰 - ChatGPT',
    menuIcon: '🤖'
  },
  {
    id: 'ccs-fastqa-claude-quick',
    engineId: 'claude',
    titleKey: 'claude',
    menuTitle: '触触搜 · 速答壹拾佰 - Claude',
    menuIcon: '🧠'
  },
  {
    id: 'ccs-fastqa-grok-quick',
    engineId: 'grok',
    titleKey: 'grok',
    menuTitle: '触触搜 · 速答壹拾佰 - Grok',
    menuIcon: '🦊'
  },
  {
    id: 'ccs-fastqa-yiyan-quick',
    engineId: 'yiyan',
    titleKey: 'yiyan',
    menuTitle: '触触搜 · 速答壹拾佰 - 文心一言',
    menuIcon: '🧠'
  }
];

FAST_QA_QUICK_ITEMS.forEach((item) => {
  MENU_DEFINITIONS[item.id] = {
    text: item.menuTitle,
    icon: item.menuIcon || ''
  };
});

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

const OPTIMIZE_ENGINE_TITLES = {
  'chatgpt': '🤖 ChatGPT (默认 GPT-5)',
  'claude': '🧠 Claude (推荐 Opus)'
};

const TOP_QUESTION_ENGINE_TITLES = {
  'chatgpt': '🤖 ChatGPT',
  'claude': '🧠 Claude',
  'grok': '🦊 Grok',
  'yiyan': '🧠 文心一言'
};

const FAST_ANSWER_ENGINE_TITLES = {
  'chatgpt': '🤖 ChatGPT',
  'claude': '🧠 Claude',
  'grok': '🦊 Grok',
  'yiyan': '🧠 文心一言'
};

// 动态搜索菜单项 - 清空以移除各菜单项后的关键字显示
// 关键字将统一显示在二级菜单顶部的标签中
const DYNAMIC_SEARCH_MENU_ITEMS = [];

const FAST_QA_MENU_ITEMS = [
  'ccs-fastqa-root',
  'ccs-fastqa-open-all'
];
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

function updateMainMenuTitle(displayText) {
  const baseTitle = getMenuTitle('ccs-main');
  const title = displayText ? `${baseTitle}: "${displayText}"` : baseTitle;
  chrome.contextMenus.update('ccs-main', { title }, () => {
    if (chrome.runtime.lastError) {
      const msg = chrome.runtime.lastError.message || '';
      if (!/Cannot find menu item/i.test(msg)) {
        logMenuEvent('main-title-update-failed', { error: msg });
      }
    }
  });
  if (chrome.action && chrome.action.setTitle) {
    chrome.action.setTitle({ title });
  }
  logMenuEvent('main-title', { title, displayText });
}

function updateSearchLabelTitle(displayText) {
  const formatted = displayText ? formatMenuTitle(displayText) : '';
  const title = formatted ? `🔍 触触搜: "${formatted}"` : '🔍 触触搜';
  chrome.contextMenus.update('ccs-search-label', { title }, () => {
    if (chrome.runtime.lastError) {
      const msg = chrome.runtime.lastError.message || '';
      if (!/Cannot find menu item/i.test(msg)) {
        logMenuEvent('search-label-update-failed', { error: msg });
      }
    }
  });
  logMenuEvent('search-label', { title, displayText });
}

function updateSubmenuLabels(displayText) {
  const formatted = displayText ? formatMenuTitle(displayText) : '';
  const title = formatted ? `🔍 触触搜: "${formatted}"` : '🔍 触触搜';

  // Fixed submenu labels
  const fixedLabelIds = [
    'ccs-top100-label',
    'ccs-fastqa-label'
  ];

  // Update fixed labels
  fixedLabelIds.forEach(labelId => {
    chrome.contextMenus.update(labelId, { title }, () => {
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message || '';
        if (!/Cannot find menu item/i.test(msg)) {
          logMenuEvent('submenu-label-update-failed', { labelId, error: msg });
        }
      }
    });
  });

  // Update optimize category labels
  optimizeCategoryLabelIds.forEach(labelId => {
    chrome.contextMenus.update(labelId, { title }, () => {
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message || '';
        if (!/Cannot find menu item/i.test(msg)) {
          logMenuEvent('optimize-label-update-failed', { labelId, error: msg });
        }
      }
    });
  });

  logMenuEvent('submenu-labels-updated', {
    title,
    displayText,
    fixedCount: fixedLabelIds.length,
    optimizeCount: optimizeCategoryLabelIds.length
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
  if (newTabId != null && raw) {
    try {
      const activeTabs = await chrome.tabs.query({active: true, currentWindow: true});
      const activeTabId = activeTabs?.[0]?.id ?? null;

      if (newTabId !== activeTabId) {
        logMenuEvent('state-update-rejected-inactive-tab', {
          requestedTabId: newTabId,
          activeTabId: activeTabId,
          raw: raw?.substring(0, 50),
          normalized: normalized?.substring(0, 50)
        });
        return; // Reject state updates from inactive tabs
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
  updateMainMenuTitle(displayText);
  updateSearchLabelTitle(displayText);
  updateSubmenuLabels(displayText);  // ← 更新优化提示词标签
  updateSearchMenuTitles(displayText);

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
  if (chrome.contextMenus.refresh) {
    chrome.contextMenus.refresh();
  }
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

let menuBuildCounter = 0;
const selectedTextByTab = {};

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
