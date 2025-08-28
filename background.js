// 提取URL中的搜索关键词或页面标题
let BG_DEBUG = false;
const BG_DBG = (...args) => { if (BG_DEBUG) console.log(...args); };

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
  // 清除所有现有菜单
  chrome.contextMenus.removeAll(() => {
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
      title: '🔍 触触搜',
      enabled: false,  // 禁用使其不可点击
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-separator-0',
      parentId: 'ccs-main',
      type: 'separator',
      contexts: ['selection', 'page']
    });

    // 创建子菜单项
    chrome.contextMenus.create({
      id: 'ccs-baidu',
      parentId: 'ccs-main',
      title: '百度搜索',
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-google',
      parentId: 'ccs-main',
      title: 'Google搜索',
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-chuchusou',
      parentId: 'ccs-main',
      title: '🌐 更多搜索引擎...',
      contexts: ['selection', 'page']
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
      title: '复制文本',
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-base64',
      parentId: 'ccs-main',
      title: 'Base64编码',
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-md5',
      parentId: 'ccs-main',
      title: 'MD5哈希',
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-url-encode',
      parentId: 'ccs-main',
      title: 'URL编码',
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
      title: '转换为大写',
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-lower',
      parentId: 'ccs-main',
      title: '转换为小写',
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
      title: '打开触触搜面板 (Alt+S)',
      contexts: ['selection', 'page']
    });
  });
}

// 初始化菜单
chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
});

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
    const text = request.text;
    
    // 存储选中文本
    if (text) {
      selectedTextByTab[tabId] = text;
    } else {
      delete selectedTextByTab[tabId];
    }
    
    // 获取当前活动标签
    chrome.tabs.query({active: true, currentWindow: true}, async (tabs) => {
      if (tabs[0] && tabs[0].id === tabId) {
        // 只更新当前活动标签的菜单
        if (text) {
          // 有选中文本，显示选中文本
          const displayText = text.substring(0, 20) + (text.length > 20 ? '...' : '');
          chrome.contextMenus.update('ccs-main', {
            title: `🔍 触触搜: "${displayText}"`
          });
          chrome.contextMenus.update('ccs-label', {
            title: `🔍 触触搜: "${displayText}"`
          });
        } else {
          // 没有选中文本，回退到URL关键词或默认
          updateContextMenuForTab(sender.tab);
        }
      }
    });
  }
});

// 监听标签页更新，动态更新菜单标题
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    updateContextMenuForTab(tab);
  }
});

// 监听标签页激活，动态更新菜单标题
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  
  // 先检查是否有存储的选中文本
  if (selectedTextByTab[activeInfo.tabId]) {
    const text = selectedTextByTab[activeInfo.tabId];
    const displayText = text.substring(0, 20) + (text.length > 20 ? '...' : '');
    chrome.contextMenus.update('ccs-main', {
      title: `🔍 触触搜: "${displayText}"`
    });
    chrome.contextMenus.update('ccs-label', {
      title: `🔍 触触搜: "${displayText}"`
    });
  } else if (tab.url) {
    // 没有选中文本时，使用URL关键词
    updateContextMenuForTab(tab);
  }
});

// 根据URL更新菜单标题
async function updateContextMenuForTab(tab) {
  // 注意：这里只是预显示，实际使用时选中文本优先级更高
  const keywords = await extractSearchKeywords(tab.url, tab);
  
  if (keywords) {
    // 如果提取到关键词，更新主菜单和标签
    const displayText = keywords.substring(0, 20) + (keywords.length > 20 ? '...' : '');
    
    chrome.contextMenus.update('ccs-main', {
      title: `🔍 触触搜: "${displayText}"`
    });
    
    // 更新顶部标签
    chrome.contextMenus.update('ccs-label', {
      title: `🔍 触触搜: "${displayText}"`
    });
  } else {
    // 恢复默认标题
    chrome.contextMenus.update('ccs-main', {
      title: '🔍 触触搜'
    });
    
    chrome.contextMenus.update('ccs-label', {
      title: '🔍 触触搜'
    });
  }
}

// 处理右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // 文本优先级：
  // 1. 优先使用选中的文本
  // 2. 没有选中文本时，才尝试从URL提取搜索关键词
  // 3. 最后使用页面标题作为后备
  let text = info.selectionText;
  
  // 只有在没有选中文本时，才尝试其他来源
  if (!text && tab.url) {
    text = await extractSearchKeywords(tab.url, tab);
    
    // 如果没有提取到关键词，某些功能可能不可用
    if (!text) {
      // 对于某些操作，没有文本就提示用户
      if (info.menuItemId !== 'ccs-show-popover') {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showToast',
          message: '没有选中文本或无法提取关键词'
        }).catch(() => {
          // 忽略错误
        });
        return;
      }
    }
  }
  
  switch (info.menuItemId) {
    case 'ccs-baidu':
      if (text) {
        chrome.tabs.create({
          url: `https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${encodeURIComponent(text)}`
        });
      }
      break;
      
    case 'ccs-google':
      if (text) {
        chrome.tabs.create({
          url: `https://www.google.com/search?q=${encodeURIComponent(text)}`
        });
      }
      break;
      
    case 'ccs-chuchusou':
      if (text) {
        chrome.tabs.create({
          url: `https://chuchusou.com/?q=${encodeURIComponent(text)}`
        });
      }
      break;
      
    case 'ccs-copy':
      if (text) {
        // 发送消息给content script处理复制
        chrome.tabs.sendMessage(tab.id, {
          action: 'copyText',
          text: text
        }).catch(() => {
          // 如果content script未加载，使用chrome.clipboard API
          // 注意：这需要在manifest中添加clipboardWrite权限
        });
      }
      break;
      
    case 'ccs-base64':
      if (text) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'processCommand',
          command: 'base64',
          text: text
        }).catch(() => {});
      }
      break;
      
    case 'ccs-md5':
      if (text) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'processCommand',
          command: 'md5',
          text: text
        }).catch(() => {});
      }
      break;
      
    case 'ccs-url-encode':
      if (text) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'processCommand',
          command: 'url-encode',
          text: text
        }).catch(() => {});
      }
      break;
      
    case 'ccs-upper':
      if (text) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'processCommand',
          command: 'upper',
          text: text
        }).catch(() => {});
      }
      break;
      
    case 'ccs-lower':
      if (text) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'processCommand',
          command: 'lower',
          text: text
        }).catch(() => {});
      }
      break;
      
    case 'ccs-show-popover':
      // 发送消息给content script显示popover
      chrome.tabs.sendMessage(tab.id, {
        action: 'showPopover',
        text: text || ''
      }).catch(() => {});
      break;
  }
});
