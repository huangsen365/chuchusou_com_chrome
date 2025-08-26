// 创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  // 创建主菜单
  chrome.contextMenus.create({
    id: 'ccs-main',
    title: '触触搜',
    contexts: ['selection']
  });

  // 创建子菜单项
  chrome.contextMenus.create({
    id: 'ccs-baidu',
    parentId: 'ccs-main',
    title: '百度搜索',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'ccs-google',
    parentId: 'ccs-main',
    title: 'Google搜索',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'ccs-separator-1',
    parentId: 'ccs-main',
    type: 'separator',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'ccs-copy',
    parentId: 'ccs-main',
    title: '复制文本',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'ccs-base64',
    parentId: 'ccs-main',
    title: 'Base64编码',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'ccs-md5',
    parentId: 'ccs-main',
    title: 'MD5哈希',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'ccs-url-encode',
    parentId: 'ccs-main',
    title: 'URL编码',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'ccs-separator-2',
    parentId: 'ccs-main',
    type: 'separator',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'ccs-upper',
    parentId: 'ccs-main',
    title: '转换为大写',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'ccs-lower',
    parentId: 'ccs-main',
    title: '转换为小写',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'ccs-separator-3',
    parentId: 'ccs-main',
    type: 'separator',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'ccs-show-popover',
    parentId: 'ccs-main',
    title: '打开触触搜面板',
    contexts: ['selection']
  });
});

// 处理右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const selectedText = info.selectionText;
  
  switch (info.menuItemId) {
    case 'ccs-baidu':
      chrome.tabs.create({
        url: `https://www.baidu.com/s?wd=${encodeURIComponent(selectedText)}`
      });
      break;
      
    case 'ccs-google':
      chrome.tabs.create({
        url: `https://www.google.com/search?q=${encodeURIComponent(selectedText)}`
      });
      break;
      
    case 'ccs-copy':
      // 发送消息给content script处理复制
      chrome.tabs.sendMessage(tab.id, {
        action: 'copyText',
        text: selectedText
      });
      break;
      
    case 'ccs-base64':
      // 发送消息给content script处理并显示结果
      chrome.tabs.sendMessage(tab.id, {
        action: 'processCommand',
        command: 'base64',
        text: selectedText
      });
      break;
      
    case 'ccs-md5':
      chrome.tabs.sendMessage(tab.id, {
        action: 'processCommand',
        command: 'md5',
        text: selectedText
      });
      break;
      
    case 'ccs-url-encode':
      chrome.tabs.sendMessage(tab.id, {
        action: 'processCommand',
        command: 'url-encode',
        text: selectedText
      });
      break;
      
    case 'ccs-upper':
      chrome.tabs.sendMessage(tab.id, {
        action: 'processCommand',
        command: 'upper',
        text: selectedText
      });
      break;
      
    case 'ccs-lower':
      chrome.tabs.sendMessage(tab.id, {
        action: 'processCommand',
        command: 'lower',
        text: selectedText
      });
      break;
      
    case 'ccs-show-popover':
      // 发送消息给content script显示popover
      chrome.tabs.sendMessage(tab.id, {
        action: 'showPopover',
        text: selectedText
      });
      break;
  }
});