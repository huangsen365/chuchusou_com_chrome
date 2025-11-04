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
const FAST_QA_QUICK_ITEMS = [
  {
    id: 'ccs-fastqa-chatgpt-quick',
    engineId: 'chatgpt',
    titleKey: 'chatgpt'
  },
  {
    id: 'ccs-fastqa-claude-quick',
    engineId: 'claude',
    titleKey: 'claude'
  }
];

const quickMenuState = new Map(FAST_QA_QUICK_ITEMS.map((item) => [item.id, { registered: false }]));

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

function getLatestTabPageTitle(tabId) {
  if (tabId == null) return '';
  const entry = latestTitleByTab[tabId];
  return entry?.pageTitle || entry?.title || '';
}

function getLatestTabKeyword(tabId) {
  if (tabId == null) return '';
  const entry = latestTitleByTab[tabId];
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

const QUICK_MENU_TITLES = {
  'ccs-fastqa-chatgpt-quick': '🤖 触触搜 · 速答壹拾佰 - ChatGPT',
  'ccs-fastqa-claude-quick': '🧠 触触搜 · 速答壹拾佰 - Claude'
};

const MENU_ITEM_TITLES = {
  'ccs-label': '🔍 触触搜',
  ...QUICK_MENU_TITLES,
  'ccs-baidu': '🐼 百度搜索',
  'ccs-google': '🔎 Google 搜索',
  'ccs-tongyi': '🪄 通义千问',
  'ccs-yiyan': '🧠 文心一言',
  'ccs-chatgpt': '🤖 ChatGPT',
  'ccs-claude': '🧠 Claude',
  'ccs-zhihu': '💡 知乎搜索',
  'ccs-weixin': '💬 微信搜一搜',
  'ccs-taobao': '🛒 淘宝搜索',
  'ccs-jd': '🛍️ 京东搜索',
  'ccs-sov2ex': '💻 V2EX (sov2ex)',
  'ccs-baidu-translate': '✍️ 百度翻译',
  'ccs-google-translate': '🔁 Google 翻译',
  'ccs-chuchusou': '🌐 更多搜索引擎...',
  'ccs-top100-root': '💯 触触搜百问',
  'ccs-top100-open-all': '🚀 打开以下全部',
  'ccs-fastqa-root': '⚡ 速答壹拾佰',
  'ccs-fastqa-open-all': '🚀 打开以下全部',
  'ccs-copy': '📋 复制文本',
  'ccs-base64': '🔤 Base64 编码',
  'ccs-md5': '🔐 MD5 哈希',
  'ccs-url-encode': '🔗 URL 编码',
  'ccs-upper': '🔠 转换为大写',
  'ccs-lower': '🔡 转换为小写',
  'ccs-show-popover': '🪟 打开触触搜面板 (Alt+S)'
};

const MENU_FALLBACK_TITLES = {
  'ccs-label': '🔍 触触搜',
  'ccs-fastqa-chatgpt-quick': '触触搜 · 速答壹拾佰 - ChatGPT',
  'ccs-fastqa-claude-quick': '触触搜 · 速答壹拾佰 - Claude',
  'ccs-baidu': '百度搜索',
  'ccs-google': 'Google搜索',
  'ccs-tongyi': '通义千问',
  'ccs-yiyan': '文心一言',
  'ccs-chatgpt': 'ChatGPT',
  'ccs-claude': 'Claude',
  'ccs-zhihu': '知乎搜索',
  'ccs-weixin': '微信搜一搜',
  'ccs-taobao': '淘宝搜索',
  'ccs-jd': '京东搜索',
  'ccs-sov2ex': 'V2EX (sov2ex)',
  'ccs-baidu-translate': '百度翻译',
  'ccs-google-translate': 'Google 翻译',
  'ccs-chuchusou': '更多搜索引擎...',
  'ccs-top100-root': '触触搜百问',
  'ccs-top100-open-all': '打开以下全部',
  'ccs-fastqa-root': '速答壹拾佰',
  'ccs-fastqa-open-all': '打开以下全部',
  'ccs-copy': '复制文本',
  'ccs-base64': 'Base64编码',
  'ccs-md5': 'MD5哈希',
  'ccs-url-encode': 'URL编码',
  'ccs-upper': '转换为大写',
  'ccs-lower': '转换为小写',
  'ccs-show-popover': '打开触触搜面板 (Alt+S)'
};

function getMenuTitle(menuId, fallback) {
  return MENU_ITEM_TITLES[menuId] || fallback || MENU_FALLBACK_TITLES[menuId] || menuId;
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

const DYNAMIC_SEARCH_MENU_ITEMS = [
  'ccs-chuchusou',
  'ccs-chatgpt',
  'ccs-claude'
];

function updateFastQaQuickTitle(displayText) {
  const formatted = displayText ? formatMenuTitle(displayText) : '';
  const snapshot = {
    display: currentMenuState?.display || '',
    raw: currentMenuState?.raw || '',
    normalized: currentMenuState?.normalized || ''
  };
  FAST_QA_QUICK_ITEMS.forEach((item) => {
    const state = quickMenuState.get(item.id);
    if (!state?.registered) return;
    if (!isMenuEnabled(item.id)) return;
    const baseTitle = getMenuTitle(item.id, MENU_FALLBACK_TITLES[item.id]);
    const title = formatted ? `${baseTitle}: "${formatted}"` : baseTitle;
    chrome.contextMenus.update(item.id, { title }, () => {
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message || '';
        if (!/Cannot find menu item/i.test(msg)) {
          logMenuEvent('fastqa-quick-title-update-failed', { id: item.id, error: msg });
        }
      }
    });
    logMenuEvent('fastqa-quick-title', {
      id: item.id,
      title,
      formatted,
      baseTitle,
      menuDisplay: snapshot.display,
      menuRaw: snapshot.raw,
      menuNormalized: snapshot.normalized
    });
  });
}

function updateSearchMenuTitles(displayText) {
  const formatted = displayText ? formatMenuTitle(displayText) : '';
  DYNAMIC_SEARCH_MENU_ITEMS.forEach((menuId) => {
    const baseTitle = getMenuTitle(menuId, MENU_FALLBACK_TITLES[menuId]);
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
  const baseTitle = getMenuTitle('ccs-label', MENU_FALLBACK_TITLES['ccs-label']);
  const title = displayText ? `${baseTitle}: "${displayText}"` : baseTitle;
  chrome.contextMenus.update('ccs-main', { title }, () => {
    if (chrome.runtime.lastError) {
      const msg = chrome.runtime.lastError.message || '';
      if (!/Cannot find menu item/i.test(msg)) {
        logMenuEvent('main-title-update-failed', { error: msg });
      }
    }
  });
  chrome.contextMenus.update('ccs-label', { title }, () => {
    if (chrome.runtime.lastError) {
      const msg = chrome.runtime.lastError.message || '';
      if (!/Cannot find menu item/i.test(msg)) {
        logMenuEvent('label-title-update-failed', { error: msg });
      }
    }
  });
  if (chrome.action && chrome.action.setTitle) {
    chrome.action.setTitle({ title });
  }
  logMenuEvent('main-title', { title, displayText });
}

function setMenuState(rawText, normalizedText, meta) {
  const raw = typeof rawText === 'string' ? rawText : '';
  const normalized = typeof normalizedText === 'string' ? normalizedText : '';
  const base = normalized || raw;
  const displayText = base ? formatMenuTitle(base) : '';
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
  updateFastQaQuickTitle(displayText);
  updateSearchMenuTitles(displayText);
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
