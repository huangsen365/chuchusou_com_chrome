// 提取URL中的搜索关键词或页面标题
let BG_DEBUG = false;
const BG_DBG = (...args) => { if (BG_DEBUG) console.log(...args); };

function formatMenuTitle(text) {
  if (!text) return null;
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return null;
  return compact.substring(0, 20) + (compact.length > 20 ? '...' : '');
}

function cleanupTitleKeyword(rawTitle) {
  if (!rawTitle) return '';
  let cleaned = rawTitle.trim();
  const suffixes = [
    ' - 搜索结果',
    ' - 知乎',
    ' - Zhihu'
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

let menuToggleConfig = null;

let menuIconConfig = null;
const menuIconImageCache = new Map();

const MENU_ITEM_TITLES = {
  'ccs-label': '🔍 触触搜',
  'ccs-baidu': '🐼 百度搜索',
  'ccs-google': '🔎 Google 搜索',
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
  'ccs-top100-root': '🧠 触触搜百问',
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
  'ccs-baidu': '百度搜索',
  'ccs-google': 'Google搜索',
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
  'yiyan': '🧠 文心一言'
};

const FAST_ANSWER_ENGINE_TITLES = {
  'chatgpt': '🤖 ChatGPT',
  'claude': '🧠 Claude',
  'yiyan': '🧠 文心一言'
};

function applyMenuTitle(normalizedText) {
  if (normalizedText) {
    const displayText = formatMenuTitle(normalizedText);
    if (displayText) {
      chrome.contextMenus.update('ccs-main', {
        title: `🔍 触触搜: "${displayText}"`
      });
      chrome.contextMenus.update('ccs-label', {
        title: `🔍 触触搜: "${displayText}"`
      });
      if (chrome.contextMenus.refresh) {
        chrome.contextMenus.refresh();
      }
      return;
    }
  }

  chrome.contextMenus.update('ccs-main', { title: '🔍 触触搜' });
  chrome.contextMenus.update('ccs-label', { title: '🔍 触触搜' });
  if (chrome.contextMenus.refresh) {
    chrome.contextMenus.refresh();
  }
}

async function refreshMenuTitle(tab, selectionText = '') {
  try {
    const result = await computeSearchTextForTab({
      tabId: tab?.id,
      tabUrl: tab?.url,
      tabTitle: tab?.title || '',
      selectionText
    });
    applyMenuTitle(result.normalized);
  } catch (error) {
    console.warn('[触触搜][BG] refreshMenuTitle失败:', error);
  }
}

async function computeSearchTextForTab({ tabId, tabUrl, tabTitle = '', selectionText = '' }) {
  let text = '';
  if (typeof selectionText === 'string' && selectionText.trim().length > 0) {
    text = selectionText;
  }
  const stored = tabId != null ? selectedTextByTab[tabId] : null;
  if (!text && stored && typeof stored.text === 'string' && stored.text.trim().length > 0) {
    if (!stored.url || stored.url === tabUrl) {
      text = stored.text;
    }
  }
  if (!text && tabUrl) {
    const extracted = await extractSearchKeywords(tabUrl, { url: tabUrl, title: tabTitle });
    if (extracted && extracted.trim().length > 0) {
      text = extracted;
    }
  }
  return {
    raw: text || '',
    normalized: normalizeSearchText(text)
  };
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

async function loadOptimizedPromptConfig() {
  if (optimizedPromptConfig) return optimizedPromptConfig;
  try {
    const url = chrome.runtime.getURL('prompts/optimizedPrompts.json');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load optimized prompt config: ${response.status}`);
    }
    const config = await response.json();
    optimizedPromptConfig = config;
    optimizedPromptTemplate = Array.isArray(config.templateLines)
      ? config.templateLines.join('\n')
      : (config.template || '');
    return optimizedPromptConfig;
  } catch (error) {
    console.error('[触触搜][BG] Failed to load optimized prompt config:', error);
    optimizedPromptConfig = null;
    optimizedPromptTemplate = '';
    return null;
  }
}

async function loadTopQuestionsConfig() {
  if (topQuestionsConfig) return topQuestionsConfig;
  try {
    const url = chrome.runtime.getURL('prompts/topQuestionsPrompts.json');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load top questions config: ${response.status}`);
    }
    const config = await response.json();
    topQuestionsConfig = config;
    topQuestionsTemplate = Array.isArray(config.templateLines)
      ? config.templateLines.join('\n')
      : (config.template || '');
    return topQuestionsConfig;
  } catch (error) {
    console.error('[触触搜][BG] Failed to load top questions config:', error);
    topQuestionsConfig = null;
    topQuestionsTemplate = '';
    return null;
  }
}

async function loadFastAnswersConfig() {
  if (fastAnswersConfig) return fastAnswersConfig;
  try {
    const url = chrome.runtime.getURL('prompts/fastAnswersPrompts.json');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load fast answers config: ${response.status}`);
    }
    const config = await response.json();
    fastAnswersConfig = config;
    fastAnswersTemplate = Array.isArray(config.templateLines)
      ? config.templateLines.join('\n')
      : (config.template || '');
    return fastAnswersConfig;
  } catch (error) {
    console.error('[触触搜][BG] Failed to load fast answers config:', error);
    fastAnswersConfig = null;
    fastAnswersTemplate = '';
    return null;
  }
}

function buildOptimizedPrompt(purpose, inputText) {
  if (!optimizedPromptTemplate) return null;
  const safePurpose = purpose || '';
  const safeInput = inputText || '';
  return optimizedPromptTemplate
    .split('${purpose}').join(safePurpose)
    .split('${input}').join(safeInput);
}

function buildTopQuestionsPrompt(inputText) {
  if (!topQuestionsTemplate) return null;
  const safeInput = inputText || '';
  return topQuestionsTemplate.split('${input}').join(safeInput);
}

function buildFastAnswersPrompt(inputText) {
  if (!fastAnswersTemplate) return null;
  const safeInput = inputText || '';
  return fastAnswersTemplate.split('${input}').join(safeInput);
}

async function loadMenuToggleConfig() {
  if (menuToggleConfig) return menuToggleConfig;
  try {
    const url = chrome.runtime.getURL('config/menuToggles.json');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load menu toggle config: ${response.status}`);
    }
    menuToggleConfig = await response.json();
    return menuToggleConfig;
  } catch (error) {
    console.warn('[触触搜][BG] Failed to load menu toggle config:', error);
    menuToggleConfig = {};
    return menuToggleConfig;
  }
}

function isMenuEnabled(menuId) {
  if (!menuToggleConfig) return true;
  const flag = menuToggleConfig[menuId];
  if (typeof flag === 'boolean') {
    return flag;
  }
  return true;
}

async function loadMenuIconConfig() {
  await loadMenuToggleConfig();
  if (menuIconConfig) return menuIconConfig;
  try {
    const url = chrome.runtime.getURL('config/menuIcons.json');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load menu icon config: ${response.status}`);
    }
    menuIconConfig = await response.json();
    return menuIconConfig;
  } catch (error) {
    console.warn('[触触搜][BG] Failed to load menu icon config:', error);
    menuIconConfig = null;
    return null;
  }
}

function populateOptimizedMenuMap(config) {
  optimizedPromptMenuMap.clear();
  if (!config || !Array.isArray(config.categories)) return;
  config.categories.forEach((category) => {
    const categoryId = category.id;
    if (!categoryId) return;
    const categoryMenuId = `ccs-optimize-${categoryId}`;
    if (!isMenuEnabled(categoryMenuId)) return;
    (category.engines || []).forEach((engine) => {
      if (!engine || !engine.id) return;
      const menuId = `ccs-optimize-${categoryId}-${engine.id}`;
      if (!isMenuEnabled(menuId)) return;
      optimizedPromptMenuMap.set(menuId, {
        purpose: category.purpose || category.label || '',
        urlPattern: engine.urlPattern || ''
      });
    });
  });
}

async function createImageDataFromUrl(url, size) {
  try {
    const cacheKey = `${url}@${size}`;
    if (menuIconImageCache.has(cacheKey)) {
      BG_DBG('[触触搜][BG][ICON] cache hit', cacheKey);
      return menuIconImageCache.get(cacheKey);
    }
    const isExtensionResource = url.startsWith('chrome-extension://');
    const fetchOptions = isExtensionResource ? {} : { mode: 'cors' };
    BG_DBG('[触触搜][BG][ICON] fetching image', { url, size, fetchOptions });
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    const scale = Math.min(size / imageBitmap.width, size / imageBitmap.height, 1);
    const targetWidth = imageBitmap.width * scale;
    const targetHeight = imageBitmap.height * scale;
    const dx = (size - targetWidth) / 2;
    const dy = (size - targetHeight) / 2;
    ctx.drawImage(imageBitmap, dx, dy, targetWidth, targetHeight);
    const imageData = ctx.getImageData(0, 0, size, size);
    BG_DBG('[触触搜][BG][ICON] image processed', { url, size, scale });
    menuIconImageCache.set(cacheKey, imageData);
    return imageData;
  } catch (error) {
    console.warn('[触触搜][BG] 无法加载远程图标:', url, error);
    return null;
  }
}

async function resolveMenuIconTargets(iconConfig) {
  if (!iconConfig) return null;
  const size = Number.isFinite(iconConfig.size) ? iconConfig.size : (menuIconConfig?.defaultSize || 16);
  BG_DBG('[触触搜][BG][ICON] resolveMenuIconTargets', { iconConfig, size });
  if (iconConfig.localPath) {
    const localUrl = chrome.runtime.getURL(iconConfig.localPath);
    const localImageData = await createImageDataFromUrl(localUrl, size);
    if (localImageData) {
      BG_DBG('[触触搜][BG][ICON] using local image data', { localUrl, size });
      return { [size]: localImageData };
    }
    console.warn('[触触搜][BG] 本地图标加载失败，尝试远程图标:', iconConfig.localPath);
  }
  if (iconConfig.remoteUrl) {
    const imageData = await createImageDataFromUrl(iconConfig.remoteUrl, size);
    if (imageData) {
      BG_DBG('[触触搜][BG][ICON] using remote image data', { url: iconConfig.remoteUrl, size });
      return { [size]: imageData };
    }
  }
  return null;
}

async function applyMenuIcons(buildId) {
  const config = await loadMenuIconConfig();
  if (buildId !== menuBuildCounter) return;
  if (!config?.items) return;
  BG_DBG('[触触搜][BG][ICON] applying menu icons', { buildId, items: Object.keys(config.items || {}) });
  const entries = Object.entries(config.items);
  await Promise.all(entries.map(async ([menuId, iconCfg]) => {
    try {
      if (!isMenuEnabled(menuId)) return;
      const icons = await resolveMenuIconTargets(iconCfg);
      if (!icons || buildId !== menuBuildCounter) return;
      BG_DBG('[触触搜][BG][ICON] updating menu icon', { menuId, icons: Object.keys(icons) });
      chrome.contextMenus.update(menuId, { icons }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[触触搜][BG] 更新菜单图标失败:', menuId, chrome.runtime.lastError.message);
        } else {
          BG_DBG('[触触搜][BG][ICON] menu icon applied', menuId);
        }
      });
    } catch (error) {
      console.warn('[触触搜][BG] 处理菜单图标失败:', menuId, error);
    }
  }));
}

async function extractSearchKeywords(url, tab) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const searchParams = urlObj.searchParams;
    BG_DBG('[触触搜][BG][DEBUG] extractSearchKeywords called', { url, hostname, title: tab && tab.title });
    
    // 百度搜索
    if (hostname.includes('baidu.com')) {
      const wd = searchParams.get('wd') || searchParams.get('word') || searchParams.get('kw');
      if (wd) {
        const kw = decodeURIComponent(wd);
        BG_DBG('[触触搜][BG][DEBUG] matched baidu wd:', kw);
        return kw;
      }
    }
    
    // Google搜索（包括各国域名）
    if (hostname.includes('google.')) {
      const q = searchParams.get('q');
      if (q) {
        const kw = decodeURIComponent(q);
        BG_DBG('[触触搜][BG][DEBUG] matched google q:', kw);
        return kw;
      }
    }
    
    // 必应搜索（包括国际版和中国版）
    if (hostname.includes('bing.com') || hostname.includes('cn.bing.com')) {
      const q = searchParams.get('q');
      if (q) {
        const kw = decodeURIComponent(q);
        BG_DBG('[触触搜][BG][DEBUG] matched bing q:', kw);
        return kw;
      }
    }
    
    // 搜狗搜索
    if (hostname.includes('sogou.com')) {
      const query = searchParams.get('query') || searchParams.get('keyword');
      if (query) {
        const kw = decodeURIComponent(query);
        BG_DBG('[触触搜][BG][DEBUG] matched sogou query:', kw);
        return kw;
      }
    }
    
    // 360搜索
    if (hostname.includes('so.com') || hostname.includes('360.cn')) {
      const q = searchParams.get('q');
      if (q) {
        const kw = decodeURIComponent(q);
        BG_DBG('[触触搜][BG][DEBUG] matched 360 q:', kw);
        return kw;
      }
    }
    
    // 神马搜索
    if (hostname.includes('m.sm.cn') || hostname.includes('sm.cn')) {
      const q = searchParams.get('q');
      if (q) {
        const kw = decodeURIComponent(q);
        BG_DBG('[触触搜][BG][DEBUG] matched sm q:', kw);
        return kw;
      }
    }
    
    // 头条搜索
    if (hostname.includes('toutiao.com')) {
      const keyword = searchParams.get('keyword');
      if (keyword) {
        const kw = decodeURIComponent(keyword);
        BG_DBG('[触触搜][BG][DEBUG] matched toutiao keyword:', kw);
        return kw;
      }
    }
    
    // DuckDuckGo
    if (hostname.includes('duckduckgo.com')) {
      const q = searchParams.get('q');
      if (q) {
        const kw = decodeURIComponent(q);
        BG_DBG('[触触搜][BG][DEBUG] matched ddg q:', kw);
        return kw;
      }
    }
    
    // Yahoo搜索
    if (hostname.includes('yahoo.com') || hostname.includes('yahoo.co.jp')) {
      const p = searchParams.get('p');
      if (p) {
        const kw = decodeURIComponent(p);
        BG_DBG('[触触搜][BG][DEBUG] matched yahoo p:', kw);
        return kw;
      }
    }
    
    // Yandex搜索
    if (hostname.includes('yandex.')) {
      const text = searchParams.get('text');
      if (text) {
        const kw = decodeURIComponent(text);
        BG_DBG('[触触搜][BG][DEBUG] matched yandex text:', kw);
        return kw;
      }
    }
    
    // Startpage
    if (hostname.includes('startpage.com')) {
      const query = searchParams.get('query');
      if (query) {
        const kw = decodeURIComponent(query);
        BG_DBG('[触触搜][BG][DEBUG] matched startpage query:', kw);
        return kw;
      }
    }
    
    // 知乎搜索
    if (hostname.includes('zhihu.com')) {
      const q = searchParams.get('q');
      if (q) {
        const kw = decodeURIComponent(q);
        BG_DBG('[触触搜][BG][DEBUG] matched zhihu q:', kw);
        return kw;
      }
    }
    
    // 微博搜索
    if (hostname.includes('weibo.com') || hostname.includes('weibo.cn')) {
      const q = searchParams.get('q');
      if (q) {
        const kw = decodeURIComponent(q);
        BG_DBG('[触触搜][BG][DEBUG] matched weibo q:', kw);
        return kw;
      }
    }
    
    // GitHub搜索
    if (hostname.includes('github.com')) {
      const q = searchParams.get('q');
      if (q) {
        const kw = decodeURIComponent(q);
        BG_DBG('[触触搜][BG][DEBUG] matched github q:', kw);
        return kw;
      }
    }
    
    // B站搜索
    if (hostname.includes('bilibili.com')) {
      const keyword = searchParams.get('keyword');
      if (keyword) {
        const kw = decodeURIComponent(keyword);
        BG_DBG('[触触搜][BG][DEBUG] matched bilibili keyword:', kw);
        return kw;
      }
    }
    
    // 淘宝搜索
    if (hostname.includes('taobao.com') || hostname.includes('tmall.com')) {
      const q = searchParams.get('q') || searchParams.get('keyword');
      if (q) {
        const kw = decodeURIComponent(q);
        BG_DBG('[触触搜][BG][DEBUG] matched taobao/tmall q:', kw);
        return kw;
      }
    }
    
    // 京东搜索
    if (hostname.includes('jd.com')) {
      const keyword = searchParams.get('keyword');
      if (keyword) {
        const kw = decodeURIComponent(keyword);
        BG_DBG('[触触搜][BG][DEBUG] matched jd keyword:', kw);
        return kw;
      }
    }
    
    // 如果都没有匹配，尝试获取页面标题作为关键词
    if (tab && tab.title) {
      let title = tab.title;
      BG_DBG('[触触搜][BG][DEBUG] fallback to title:', title);
      
      // 清理常见的网站后缀
      const suffixes = [
        ' - 百度搜索',
        ' - Google 搜索',
        ' - 搜狗搜索',
        ' - 360搜索',
        ' - Bing',
        ' - 知乎',
        ' - 微博',
        ' - GitHub',
        ' - Stack Overflow',
        ' - CSDN博客',
        ' - 简书',
        ' - 掘金',
        ' - 博客园',
        ' | ',
        ' - ',
        ' – ',
        ' — '
      ];
      
      for (const suffix of suffixes) {
        const index = title.lastIndexOf(suffix);
        if (index > 0) {
          title = title.substring(0, index);
          break;
        }
      }

      title = cleanupTitleKeyword(title);

      // 限制长度
      if (title.length > 50) {
        title = title.substring(0, 50) + '...';
      }

      const cleaned = title.trim();
      BG_DBG('[触触搜][BG][DEBUG] final title keyword:', cleaned);
      return cleaned;
    }
    
  } catch (error) {
    console.error('[触触搜][BG][DEBUG] Error extracting keywords:', error);
  }
  
  return null;
}

// 创建右键菜单
function createContextMenus() {
  const buildId = ++menuBuildCounter;
  // 清除所有现有菜单
  chrome.contextMenus.removeAll(async () => {
    if (buildId !== menuBuildCounter) {
      return;
    }
    await loadMenuToggleConfig();
    BG_DBG('[触触搜][BG][MENU] rebuilding context menus', { buildId });
    optimizedPromptMenuMap.clear();
    
    // 创建主菜单 - 对选中文本和页面都生效
    chrome.contextMenus.create({
      id: 'ccs-main',
      title: '🔍 触触搜',
      contexts: ['selection', 'page']
    });

    // 创建标签项（不可点击，仅显示）
    chrome.contextMenus.create({
      id: 'ccs-label',
      parentId: 'ccs-main',
      title: getMenuTitle('ccs-label', '触触搜'),
      enabled: false,  // 禁用使其不可点击
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-separator-0',
      parentId: 'ccs-main',
      type: 'separator',
      contexts: ['selection', 'page']
    });

    topQuestionsMenuMap.clear();
    fastAnswersMenuMap.clear();

    // 创建子菜单项
    const aiMenuItems = [
      'ccs-chatgpt',
      'ccs-claude'
    ];

    aiMenuItems.forEach((menuId) => {
      if (!isMenuEnabled(menuId)) return;
      chrome.contextMenus.create({
        id: menuId,
        parentId: 'ccs-main',
        title: getMenuTitle(menuId, MENU_FALLBACK_TITLES[menuId]),
        contexts: ['selection', 'page']
      });
    });

    chrome.contextMenus.create({
      id: 'ccs-separator-ai',
      parentId: 'ccs-main',
      type: 'separator',
      contexts: ['selection', 'page']
    });

    const baseMenuItems = [
      'ccs-baidu',
      'ccs-google',
      // 'ccs-baidu-translate',
      'ccs-yiyan',
      'ccs-zhihu',
      'ccs-weixin',
      'ccs-taobao',
      'ccs-jd',
      'ccs-sov2ex',
      'ccs-google-translate',
      'ccs-chuchusou'
    ];

    baseMenuItems.forEach((menuId) => {
      if (!isMenuEnabled(menuId)) return;
      chrome.contextMenus.create({
        id: menuId,
        parentId: 'ccs-main',
        title: getMenuTitle(menuId, MENU_FALLBACK_TITLES[menuId]),
        contexts: ['selection', 'page']
      });
    });
    BG_DBG('[触触搜][BG][MENU] base search items created');

    const asyncTasks = [];

    const hasAdvancedSections = isMenuEnabled('ccs-top100-root') || isMenuEnabled('ccs-fastqa-root') || isMenuEnabled('ccs-optimize-root');

    if (hasAdvancedSections) {
      chrome.contextMenus.create({
        id: 'ccs-separator-optimized',
        parentId: 'ccs-main',
        type: 'separator',
        contexts: ['selection', 'page']
      });
    }

    if (isMenuEnabled('ccs-top100-root')) {
      chrome.contextMenus.create({
        id: 'ccs-top100-root',
        parentId: 'ccs-main',
        title: getMenuTitle('ccs-top100-root', '触触搜百问'),
        contexts: ['selection', 'page']
      });

      if (isMenuEnabled('ccs-top100-open-all')) {
        chrome.contextMenus.create({
          id: 'ccs-top100-open-all',
          parentId: 'ccs-top100-root',
          title: getMenuTitle('ccs-top100-open-all', '打开以下全部'),
          contexts: ['selection', 'page']
        });
      }

      chrome.contextMenus.create({
        id: 'ccs-top100-separator',
        parentId: 'ccs-top100-root',
        type: 'separator',
        contexts: ['selection', 'page']
      });

      const topQuestionsTask = loadTopQuestionsConfig()
        .then((config) => {
          if (buildId !== menuBuildCounter) {
            return;
          }
          if (!config) return;
          (config.engines || []).forEach((engine) => {
            const menuId = `ccs-top100-${engine.id}`;
            if (!isMenuEnabled(menuId)) return;
            const engineTitle = TOP_QUESTION_ENGINE_TITLES[engine.id] || engine.label;
            chrome.contextMenus.create({
              id: menuId,
              parentId: 'ccs-top100-root',
              title: engineTitle,
              contexts: ['selection', 'page']
            });
            topQuestionsMenuMap.set(menuId, {
              urlPattern: engine.urlPattern || ''
            });
          });
        })
        .catch((error) => {
          console.warn('[触触搜][BG] 无法构建触触搜百问菜单:', error);
        });
      asyncTasks.push(topQuestionsTask);
    }

    if (isMenuEnabled('ccs-fastqa-root')) {
      chrome.contextMenus.create({
        id: 'ccs-fastqa-root',
        parentId: 'ccs-main',
        title: getMenuTitle('ccs-fastqa-root', '速答壹拾佰'),
        contexts: ['selection', 'page']
      });

      if (isMenuEnabled('ccs-fastqa-open-all')) {
        chrome.contextMenus.create({
          id: 'ccs-fastqa-open-all',
          parentId: 'ccs-fastqa-root',
          title: getMenuTitle('ccs-fastqa-open-all', '打开以下全部'),
          contexts: ['selection', 'page']
        });
      }

      chrome.contextMenus.create({
        id: 'ccs-fastqa-separator',
        parentId: 'ccs-fastqa-root',
        type: 'separator',
        contexts: ['selection', 'page']
      });

      const fastAnswersTask = loadFastAnswersConfig()
        .then((config) => {
          if (buildId !== menuBuildCounter) {
            return;
          }
          if (!config) return;
          (config.engines || []).forEach((engine) => {
            const menuId = `ccs-fastqa-${engine.id}`;
            if (!isMenuEnabled(menuId)) return;
            const engineTitle = FAST_ANSWER_ENGINE_TITLES[engine.id] || engine.label;
            chrome.contextMenus.create({
              id: menuId,
              parentId: 'ccs-fastqa-root',
              title: engineTitle,
              contexts: ['selection', 'page']
            });
            fastAnswersMenuMap.set(menuId, {
              urlPattern: engine.urlPattern || ''
            });
          });
        })
        .catch((error) => {
          console.warn('[触触搜][BG] 无法构建速答壹拾佰菜单:', error);
        });
      asyncTasks.push(fastAnswersTask);
    }

    if (isMenuEnabled('ccs-optimize-root')) {
      chrome.contextMenus.create({
        id: 'ccs-optimize-root',
        parentId: 'ccs-main',
        title: '🧠 优化提示词',
        contexts: ['selection', 'page']
      });

      // 动态加载优化提示词菜单
      const optimizeTask = loadOptimizedPromptConfig()
        .then((config) => {
          if (buildId !== menuBuildCounter) {
            return;
          }
          if (!config) return;
          populateOptimizedMenuMap(config);
          (config.categories || []).forEach((category) => {
            const categoryId = `ccs-optimize-${category.id}`;
            if (!isMenuEnabled(categoryId)) return;
            const categoryTitle = OPTIMIZE_CATEGORY_TITLES[category.id] || category.label;
            chrome.contextMenus.create({
              id: categoryId,
              parentId: 'ccs-optimize-root',
              title: categoryTitle,
              contexts: ['selection', 'page']
            });

            (category.engines || []).forEach((engine) => {
              const menuId = `ccs-optimize-${category.id}-${engine.id}`;
              if (!isMenuEnabled(menuId)) return;
              const engineTitle = OPTIMIZE_ENGINE_TITLES[engine.id] || engine.label;
              chrome.contextMenus.create({
                id: menuId,
                parentId: categoryId,
                title: engineTitle,
                contexts: ['selection', 'page']
              });
              BG_DBG('[触触搜][BG][MENU] optimize submenu created', { menuId });
            });
          });
        })
        .catch((error) => {
          console.warn('[触触搜][BG] 无法构建优化提示词菜单:', error);
        });
      asyncTasks.push(optimizeTask);
    }

    Promise.all(asyncTasks)
      .finally(() => {
        BG_DBG('[触触搜][BG][MENU] applying icons', { buildId });
        applyMenuIcons(buildId).catch((err) => {
          console.warn('[触触搜][BG] 无法应用菜单图标:', err);
        });
      });

    chrome.contextMenus.create({
      id: 'ccs-separator-1',
      parentId: 'ccs-main',
      type: 'separator',
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-copy',
      parentId: 'ccs-main',
      title: getMenuTitle('ccs-copy', '复制文本'),
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-base64',
      parentId: 'ccs-main',
      title: getMenuTitle('ccs-base64', 'Base64编码'),
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-md5',
      parentId: 'ccs-main',
      title: getMenuTitle('ccs-md5', 'MD5哈希'),
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-url-encode',
      parentId: 'ccs-main',
      title: getMenuTitle('ccs-url-encode', 'URL编码'),
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-separator-2',
      parentId: 'ccs-main',
      type: 'separator',
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-upper',
      parentId: 'ccs-main',
      title: getMenuTitle('ccs-upper', '转换为大写'),
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-lower',
      parentId: 'ccs-main',
      title: getMenuTitle('ccs-lower', '转换为小写'),
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-separator-3',
      parentId: 'ccs-main',
      type: 'separator',
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-show-popover',
      parentId: 'ccs-main',
      title: getMenuTitle('ccs-show-popover', '打开触触搜面板 (Alt+S)'),
      contexts: ['selection', 'page']
    });
  });
}

// 初始化菜单
chrome.runtime.onInstalled.addListener(createContextMenus);
if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(createContextMenus);
}

// 读取调试开关
chrome.storage.local.get(['ccs_debug'], (res) => {
  if (typeof res.ccs_debug === 'boolean') {
    BG_DEBUG = res.ccs_debug;
  }
});

// 存储当前选中的文本（每个标签页独立）
const selectedTextByTab = {};

// 监听来自content script和popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ccs-log-menu-icons') {
    loadMenuIconConfig().then((config) => {
      const info = {
        BG_DEBUG,
        iconConfig: config,
        iconMapKeys: Array.from(optimizedPromptMenuMap.keys()),
        cacheSize: menuIconImageCache.size,
        buildCounter: menuBuildCounter,
        timestamp: Date.now()
      };
      console.log('[触触搜][BG][ICON] 状态报告', info);
      sendResponse?.({ ok: true, info });
    }).catch((err) => {
      console.warn('[触触搜][BG][ICON] 状态报告失败', err);
      sendResponse?.({ ok: false, error: err?.message || String(err) });
    });
    return true;
  }
  if (request.action === 'getSearchText') {
    const { tabId, url, title, selectionText } = request;
    computeSearchTextForTab({
      tabId,
      tabUrl: url,
      tabTitle: title,
      selectionText
    }).then((text) => {
      sendResponse?.({ text: text.normalized, raw: text.raw });
    }).catch((error) => {
      console.error('[触触搜][BG] 获取搜索文本失败:', error);
      sendResponse?.({ text: '', raw: '' });
    });
    return true;
  }
  if (request.action === 'updateDebug') {
    BG_DEBUG = !!request.enabled;
    chrome.storage.local.set({ ccs_debug: BG_DEBUG });
    sendResponse && sendResponse({ ok: true });
    return; // stop further handling
  }
  // 处理popup的关键词提取请求
  if (request.action === 'extractKeywords') {
    extractSearchKeywords(request.url, { title: request.title })
      .then(keywords => {
        sendResponse({ keywords });
      })
      .catch(error => {
        console.error('Error extracting keywords:', error);
        sendResponse({ keywords: null });
      });
    return true; // 异步响应
  }
  
  // 处理content script的选择变化
  if (request.action === 'selectionChanged' && sender.tab) {
    const tabId = sender.tab.id;
    const rawText = typeof request.text === 'string' ? request.text : '';
    const hasContent = rawText.trim().length > 0;
    if (hasContent) {
      selectedTextByTab[tabId] = {
        text: rawText,
        url: sender.tab.url || ''
      };
    } else {
      delete selectedTextByTab[tabId];
    }
    chrome.tabs.query({active: true, currentWindow: true}, async (tabs) => {
      if (tabs[0] && tabs[0].id === tabId) {
        await refreshMenuTitle(sender.tab, rawText);
      }
    });
  }
});

// 监听标签页更新，动态更新菜单标题
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    delete selectedTextByTab[tabId];
  }
  if ((changeInfo.status === 'complete' || changeInfo.status === 'loading') && tab.url) {
    updateContextMenuForTab(tab);
  }
});

// 监听标签页激活，动态更新菜单标题
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  await refreshMenuTitle(tab);
});

// 根据URL更新菜单标题
async function updateContextMenuForTab(tab) {
  // 注意：这里只是预显示，实际使用时选中文本优先级更高
  const keywords = await extractSearchKeywords(tab.url, tab);
  applyMenuTitle(keywords ? normalizeSearchText(keywords) : '');
}

// 处理右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await loadMenuToggleConfig();
  const { raw: rawText, normalized: normalizedText } = await computeSearchTextForTab({
    tabId: tab?.id,
    tabUrl: tab?.url,
    tabTitle: tab?.title || '',
    selectionText: info.selectionText || ''
  });

  const isTopQuestionsOpenAll = info.menuItemId === 'ccs-top100-open-all';
  const isTopQuestionsMenu = info.menuItemId && info.menuItemId.startsWith('ccs-top100-');
  const isTopQuestionsEngine = isTopQuestionsMenu && !isTopQuestionsOpenAll;
  const isFastAnswersMenu = info.menuItemId && info.menuItemId.startsWith('ccs-fastqa-');
  const isFastAnswersOpenAll = info.menuItemId === 'ccs-fastqa-open-all';

  if (
    !normalizedText &&
    info.menuItemId !== 'ccs-show-popover' &&
    !topQuestionsMenuMap.has(info.menuItemId) &&
    !isTopQuestionsOpenAll &&
    !fastAnswersMenuMap.has(info.menuItemId) &&
    !isFastAnswersOpenAll &&
    !optimizedPromptMenuMap.has(info.menuItemId) &&
    !(info.menuItemId && info.menuItemId.startsWith('ccs-optimize-'))
  ) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'showToast',
      message: '没有选中文本或无法提取关键词'
    }).catch(() => {});
    return;
  }

  if (isTopQuestionsOpenAll || isTopQuestionsEngine) {
    const effectiveInput = rawText || normalizedText;
    if (!effectiveInput) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showToast',
        message: '没有选中文本，无法生成问题列表'
      }).catch(() => {});
      return;
    }
    loadTopQuestionsConfig().then((config) => {
      if (!config) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showToast',
          message: '触触搜百问模板加载失败'
        }).catch(() => {});
        return;
      }
      if (!topQuestionsTemplate) {
        topQuestionsTemplate = Array.isArray(config.templateLines)
          ? config.templateLines.join('\\n')
          : (config.template || '');
      }
      const prompt = buildTopQuestionsPrompt(effectiveInput);
      if (!prompt) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showToast',
          message: '触触搜百问模板无效'
        }).catch(() => {});
        return;
      }
      const encodedPrompt = encodeURIComponent(prompt);
      if (isTopQuestionsOpenAll) {
        const engines = Array.isArray(config.engines) ? config.engines : [];
        let openedCount = 0;
        engines.forEach((engine) => {
          if (!engine || typeof engine.urlPattern !== 'string' || !engine.urlPattern) {
            return;
          }
          const menuId = `ccs-top100-${engine.id}`;
          if (!isMenuEnabled(menuId)) return;
          const targetUrl = engine.urlPattern.split('${PROMPT}').join(encodedPrompt);
          if (targetUrl) {
            chrome.tabs.create({ url: targetUrl, active: openedCount === 0 });
            openedCount += 1;
          }
        });
      } else {
        const engineId = info.menuItemId.replace('ccs-top100-', '');
        let menuTarget = topQuestionsMenuMap.get(info.menuItemId);
        if (!menuTarget) {
          const engine = (config.engines || []).find((item) => item.id === engineId);
          if (engine) {
            menuTarget = { urlPattern: engine.urlPattern || '' };
            topQuestionsMenuMap.set(info.menuItemId, menuTarget);
          }
        }
        if (!menuTarget || !menuTarget.urlPattern) {
          chrome.tabs.sendMessage(tab.id, {
            action: 'showToast',
            message: '未找到对应的引擎配置'
          }).catch(() => {});
          return;
        }
        const url = menuTarget.urlPattern.split('${PROMPT}').join(encodedPrompt);
        chrome.tabs.create({ url });
      }
    }).catch(() => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showToast',
        message: '触触搜百问模板加载失败'
      }).catch(() => {});
    });
    return;
  }

  if (isFastAnswersOpenAll || isFastAnswersMenu) {
    const effectiveInput = rawText || normalizedText;
    if (!effectiveInput) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showToast',
        message: '没有选中文本，无法生成速答内容'
      }).catch(() => {});
      return;
    }
    loadFastAnswersConfig().then((config) => {
      if (!config) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showToast',
          message: '速答壹拾佰模板加载失败'
        }).catch(() => {});
        return;
      }
      if (!fastAnswersTemplate) {
        fastAnswersTemplate = Array.isArray(config.templateLines)
          ? config.templateLines.join('\\n')
          : (config.template || '');
      }
      const prompt = buildFastAnswersPrompt(effectiveInput);
      if (!prompt) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showToast',
          message: '速答壹拾佰模板无效'
        }).catch(() => {});
        return;
      }
      const encodedPrompt = encodeURIComponent(prompt);
      if (isFastAnswersOpenAll) {
        const engines = Array.isArray(config.engines) ? config.engines : [];
        let openedCount = 0;
        engines.forEach((engine) => {
          if (!engine || typeof engine.urlPattern !== 'string' || !engine.urlPattern) {
            return;
          }
          const menuId = `ccs-fastqa-${engine.id}`;
          if (!isMenuEnabled(menuId)) return;
          const targetUrl = engine.urlPattern.split('${PROMPT}').join(encodedPrompt);
          if (targetUrl) {
            chrome.tabs.create({ url: targetUrl, active: openedCount === 0 });
            openedCount += 1;
          }
        });
      } else {
        const engineId = info.menuItemId.replace('ccs-fastqa-', '');
        let menuTarget = fastAnswersMenuMap.get(info.menuItemId);
        if (!menuTarget) {
          const engine = (config.engines || []).find((item) => item.id === engineId);
          if (engine) {
            menuTarget = { urlPattern: engine.urlPattern || '' };
            fastAnswersMenuMap.set(info.menuItemId, menuTarget);
          }
        }
        if (!menuTarget || !menuTarget.urlPattern) {
          chrome.tabs.sendMessage(tab.id, {
            action: 'showToast',
            message: '未找到对应的速答配置'
          }).catch(() => {});
          return;
        }
        const url = menuTarget.urlPattern.split('${PROMPT}').join(encodedPrompt);
        chrome.tabs.create({ url });
      }
    }).catch(() => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showToast',
        message: '速答壹拾佰模板加载失败'
      }).catch(() => {});
    });
    return;
  }

  if (optimizedPromptMenuMap.has(info.menuItemId) || (info.menuItemId && info.menuItemId.startsWith('ccs-optimize-'))) {
    if (!normalizedText) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showToast',
        message: '没有选中文本，无法生成优化后的提示词'
      }).catch(() => {});
      return;
    }

    loadOptimizedPromptConfig().then((fullConfig) => {
      if (!fullConfig) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showToast',
          message: '提示词模板加载失败'
        }).catch(() => {});
        return;
      }
      if (!optimizedPromptMenuMap.has(info.menuItemId)) {
        populateOptimizedMenuMap(fullConfig);
      }
      const menuTarget = optimizedPromptMenuMap.get(info.menuItemId);
      if (!menuTarget || !menuTarget.urlPattern) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showToast',
          message: '未找到对应的提示词配置'
        }).catch(() => {});
        return;
      }
      const prompt = buildOptimizedPrompt(menuTarget.purpose, rawText);
      if (!prompt) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showToast',
          message: '提示词模板加载失败'
        }).catch(() => {});
        return;
      }
      const encodedPrompt = encodeURIComponent(prompt);
      const url = menuTarget.urlPattern.split('${PROMPT}').join(encodedPrompt);
      chrome.tabs.create({ url });
    }).catch(() => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showToast',
        message: '提示词模板加载失败'
      }).catch(() => {});
    });
    return;
  }
  
  switch (info.menuItemId) {
    case 'ccs-baidu':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${encodeURIComponent(normalizedText)}`
        });
      }
      break;
      
    case 'ccs-google':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://www.google.com/search?q=${encodeURIComponent(normalizedText)}`
        });
      }
      break;

    case 'ccs-yiyan':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://yiyan.baidu.com/?q=${encodeURIComponent(normalizedText)}`
        });
      }
      break;

    case 'ccs-chatgpt':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://chatgpt.com/?model=gpt-5&q=${encodeURIComponent(normalizedText)}`
        });
      }
      break;

    case 'ccs-claude':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://claude.ai/new?q=${encodeURIComponent(normalizedText)}`
        });
      }
      break;
      
    case 'ccs-zhihu':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://www.zhihu.com/search?q=${encodeURIComponent(normalizedText)}`
        });
      }
      break;
      
    case 'ccs-weixin':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://search.weixin.qq.com/cgi-bin/newsearchweb/userclientjump?path=page/search/christmas_jump&query=${encodeURIComponent(normalizedText)}`
        });
      }
      break;
      
    case 'ccs-taobao':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://s.taobao.com/search?q=${encodeURIComponent(normalizedText)}`
        });
      }
      break;
      
    case 'ccs-jd':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://search.jd.com/Search?keyword=${encodeURIComponent(normalizedText)}`
        });
      }
      break;
      
    case 'ccs-sov2ex':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://www.sov2ex.com/?q=${encodeURIComponent(normalizedText)}`
        });
      }
      break;

    case 'ccs-google-translate':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://translate.google.com/?text=${encodeURIComponent(normalizedText)}`
        });
      }
      break;
      
    case 'ccs-chuchusou':
      if (normalizedText) {
        chrome.tabs.create({
          url: `https://chuchusou.com/?q=${encodeURIComponent(normalizedText)}`
        });
      }
      break;
      
    case 'ccs-copy':
      if (rawText) {
        const ok = await copyTextInTab(tab, rawText);
        if (!ok) {
          chrome.tabs.sendMessage(tab.id, {
            action: 'showToast',
            message: '复制失败，请检查页面权限'
          }).catch(() => {});
        }
      }
      break;
      
    case 'ccs-base64':
      if (rawText) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'processCommand',
          command: 'base64',
          text: rawText
        }).catch(() => {});
      }
      break;
      
    case 'ccs-md5':
      if (rawText) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'processCommand',
          command: 'md5',
          text: rawText
        }).catch(() => {});
      }
      break;
      
    case 'ccs-url-encode':
      if (rawText) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'processCommand',
          command: 'url-encode',
          text: rawText
        }).catch(() => {});
      }
      break;
      
    case 'ccs-upper':
      if (rawText) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'processCommand',
          command: 'upper',
          text: rawText
        }).catch(() => {});
      }
      break;
      
    case 'ccs-lower':
      if (rawText) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'processCommand',
          command: 'lower',
          text: rawText
        }).catch(() => {});
      }
      break;
      
    case 'ccs-show-popover':
      // 发送消息给content script显示popover
      chrome.tabs.sendMessage(tab.id, {
        action: 'showPopover',
        text: rawText || ''
      }).catch(() => {});
      break;
  }
});

if (chrome.contextMenus.onShown && typeof chrome.contextMenus.onShown.addListener === 'function') {
  chrome.contextMenus.onShown.addListener(async (info, tab) => {
    try {
      const result = await computeSearchTextForTab({
        tabId: tab?.id,
        tabUrl: tab?.url,
        tabTitle: tab?.title || '',
        selectionText: info.selectionText || ''
      });
      applyMenuTitle(result.normalized);
    } catch (error) {
      console.warn('[触触搜][BG] onShown更新菜单失败:', error);
    }
  });
} else {
  console.warn('[触触搜][BG] chrome.contextMenus.onShown 不可用，跳过菜单 onShown 更新');
}
