// 提取URL中的搜索关键词
function extractSearchKeywords(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const searchParams = urlObj.searchParams;
    
    // 百度搜索
    if (hostname.includes('baidu.com')) {
      const wd = searchParams.get('wd') || searchParams.get('word');
      if (wd) {
        return decodeURIComponent(wd);
      }
    }
    
    // Google搜索
    if (hostname.includes('google.')) {
      const q = searchParams.get('q');
      if (q) {
        return decodeURIComponent(q);
      }
    }
    
    // 其他搜索引擎可以后续添加
    // Bing: searchParams.get('q')
    // DuckDuckGo: searchParams.get('q')
    // 搜狗: searchParams.get('query')
    
  } catch (error) {
    console.error('Error extracting keywords:', error);
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
      title: '触触搜',
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
      title: '打开触触搜面板',
      contexts: ['selection', 'page']
    });
  });
}

// 初始化菜单
chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
});

// 监听标签页更新，动态更新菜单标题
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    updateContextMenuForTab(tab.url);
  }
});

// 监听标签页激活，动态更新菜单标题
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (tab.url) {
    updateContextMenuForTab(tab.url);
  }
});

// 根据URL更新菜单标题
function updateContextMenuForTab(url) {
  const keywords = extractSearchKeywords(url);
  
  if (keywords) {
    // 如果提取到关键词，更新主菜单标题
    chrome.contextMenus.update('ccs-main', {
      title: `触触搜: "${keywords.substring(0, 20)}${keywords.length > 20 ? '...' : ''}"`
    });
  } else {
    // 恢复默认标题
    chrome.contextMenus.update('ccs-main', {
      title: '触触搜'
    });
  }
}

// 处理右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // 优先使用选中的文本，否则尝试从URL提取
  let text = info.selectionText;
  
  if (!text && tab.url) {
    text = extractSearchKeywords(tab.url);
    
    // 如果没有提取到关键词，某些功能可能不可用
    if (!text) {
      // 对于某些操作，没有文本就提示用户
      if (info.menuItemId !== 'ccs-show-popover') {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showToast',
          message: '没有选中文本或无法从URL提取关键词'
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
          url: `https://www.baidu.com/s?wd=${encodeURIComponent(text)}`
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