// 提取URL中的搜索关键词或页面标题
let BG_DEBUG = false;
const BG_DBG = (...args) => { if (BG_DEBUG) console.log(...args); };

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

function setMenuState(rawText, normalizedText, meta) {
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
  updateMainMenuTitle(displayText);
  updateSearchLabelTitle(displayText);
  updateSearchMenuTitles(displayText);
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
