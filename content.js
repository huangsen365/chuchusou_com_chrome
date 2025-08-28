(() => {
  let popover = null;
  let shadowRoot = null;
  let selectedText = '';
  let lastNonEmptySelection = '';
  // 页面会话级的临时停靠标记（不持久化）
  let isTempDock = false;
  let settings = {
    mode: 'normal', // normal, mini, disabled
    theme: 'default',
    opacity: 1,
    position: null,
    layout: 'float', // float, bottom
    globalDock: false, // 悬停模式（全局）
    barClosed: false, // 全局关闭底部栏（优先级最高）
    blacklist: [],
    isBlacklisted: false, // 当前页面是否在黑名单中
    miniButtons: ['baidu', 'google', 'chuchusou', 'copy', 'lowercase'], // Mini模式默认按钮，包含大小写与搜索
    shortcutKey: 'Alt+S' // 可自定义快捷键，默认为Alt+S
  };
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };
  let isProcessingSelection = false; // 防止选择处理重入

  // 初始化：加载用户设置 + 调试开关
  chrome.storage.local.get(['ccs_settings', 'ccs_debug'], (result) => {
    console.log('[触触搜] 加载设置:', result.ccs_settings);
    if (result.ccs_settings) {
      settings = { ...settings, ...result.ccs_settings };
      // 确保blacklist数组存在
      if (!Array.isArray(settings.blacklist)) {
        settings.blacklist = [];
      }
      console.log('[触触搜] 合并后设置:', { globalDock: settings.globalDock, layout: settings.layout, barClosed: settings.barClosed, mode: settings.mode, blacklist: settings.blacklist });
      // 迁移：为旧用户的 miniButtons 添加 lowercase
      if (Array.isArray(settings.miniButtons) && !settings.miniButtons.includes('lowercase')) {
        settings.miniButtons.push('lowercase');
        chrome.storage.local.set({ ccs_settings: settings });
      }
      // 若开启全局悬停模式，默认使用底部栏布局（仅普通模式，且非禁用/非黑名单），但若全局关闭则不显示
      try {
        if (settings.globalDock && settings.mode === 'normal' && !settings.barClosed) {
          settings.layout = 'bottom';
        }
      } catch (_) {}
    }
    if (typeof result.ccs_debug === 'boolean') {
      window.CCS_DEBUG = result.ccs_debug;
    } else {
      // 首次默认关闭调试
      chrome.storage.local.set({ ccs_debug: false });
      window.CCS_DEBUG = false;
    }
    checkBlacklist();

    // 如果开启了全局悬停模式，在普通模式且非禁用且非黑名单页面上自动显示底部栏（未全局关闭）
    console.log('[触触搜] 检查是否需要显示底部栏:', {
      globalDock: settings.globalDock,
      mode: settings.mode,
      isBlacklisted: settings.isBlacklisted,
      barClosed: settings.barClosed,
      shouldShow: settings.globalDock && settings.mode === 'normal' && !settings.isBlacklisted && !settings.barClosed
    });
    
    // 定义显示dock bar的函数（现在不自动调用，由Alt+S触发）
    const initDockBar = () => {
      if (settings.mode === 'normal' && !settings.isBlacklisted) {
        settings.layout = 'bottom';
        settings.globalDock = true;
        settings.barClosed = false;
        // 保存布局设置
        chrome.storage.local.set({ ccs_settings: settings });
        
        console.log('[触触搜] 初始化底部栏...');
        // 创建并显示dock bar
        createPopover(true);
        const x = window.innerWidth / 2 + window.scrollX;
        const y = window.innerHeight / 3 + window.scrollY;
        forceShowPopover(x, y, null, { overrideSavedPosition: true });
        
        // 启动实时更新
        scheduleRealtimeUpdate();
        
        // 设置定期检查，确保dock bar保持可见
        setInterval(() => {
          if (settings.globalDock && !settings.barClosed && settings.mode === 'normal' && !settings.isBlacklisted) {
            ensureBottomBarVisible();
          }
        }, 1000);
      }
    };
    
    // 不再自动初始化，改为由快捷键触发
    // 保存initDockBar函数到全局，供快捷键调用
    window.__initDockBar = initDockBar;
  });

  // 确保底部栏存在与可见（用于全局模式与SPA页面）
  function ensureBottomBarVisible(force = false) {
    try {
      if (settings.globalDock && !settings.barClosed && settings.mode === 'normal' && !settings.isBlacklisted) {
        settings.layout = 'bottom'; // 始终确保布局正确
        
        if (force || !popover || !document.body.contains(popover)) {
          createPopover(true); // 保留文本
          const x = window.innerWidth / 2 + window.scrollX;
          const y = window.innerHeight / 3 + window.scrollY;
          forceShowPopover(x, y, null, { overrideSavedPosition: true });
          console.log('[触触搜] ensureBottomBarVisible: 重新创建并显示底部栏');
          
          // 重新启动实时更新
          scheduleRealtimeUpdate();
        } else {
          // 确保固定在底部并且可见
          try {
            popover.style.position = 'fixed';
            popover.style.left = '0';
            popover.style.right = '0';
            popover.style.bottom = '0';
            popover.style.top = 'auto';
            popover.style.width = '100%';
            popover.style.display = 'block';
            popover.style.visibility = 'visible';
            popover.style.opacity = settings.opacity || '1';
            // 允许点击穿透到底层页面
            popover.style.pointerEvents = 'none';
            
            // 确保shadow DOM内容也可见
            if (shadowRoot) {
              const wrapper = shadowRoot.querySelector('.ccs-wrapper');
              if (wrapper) {
                wrapper.style.display = 'block';
                wrapper.style.visibility = 'visible';
              }
            }
          } catch(_) {}
        }
      }
    } catch (e) {
      console.warn('[触触搜] ensureBottomBarVisible error:', e);
    }
  }

  // 监听DOM变化，若底部栏应显示且被移除则重建，同时尝试刷新UI
  const ccsObserver = new MutationObserver(() => {
    ensureBottomBarVisible(false);
    scheduleRealtimeUpdate();
  });
  try {
    ccsObserver.observe(document.documentElement || document.body, { childList: true, subtree: true });
  } catch (_) {}
  
  // 监听SPA路由变化和页面事件，确保底部栏在导航后仍然显示
  const handlePageChange = (eventType) => {
    console.log(`[触触搜] 检测到${eventType}事件`);
    setTimeout(() => {
      ensureBottomBarVisible(true);
      scheduleRealtimeUpdate();
    }, 100);
  };
  
  // 监听各种页面变化事件
  window.addEventListener('pageshow', () => handlePageChange('pageshow'));
  window.addEventListener('popstate', () => handlePageChange('popstate'));
  window.addEventListener('hashchange', () => handlePageChange('hashchange'));
  
  // 监听History API的pushState和replaceState (用于SPA)
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  
  if (originalPushState) {
    history.pushState = function() {
      originalPushState.apply(history, arguments);
      handlePageChange('pushState');
    };
  }
  
  if (originalReplaceState) {
    history.replaceState = function() {
      originalReplaceState.apply(history, arguments);
      handlePageChange('replaceState');
    };
  }

  // 监听 <title> 变化（SPA 常改标题）
  try {
    const titleNode = document.querySelector('title');
    if (titleNode) {
      const titleObserver = new MutationObserver(() => {
        const cur = document.title || '';
        if (cur !== lastObservedTitle) {
          lastObservedTitle = cur;
          scheduleRealtimeUpdate();
        }
      });
      titleObserver.observe(titleNode, { childList: true, characterData: true, subtree: true });
    }
  } catch (_) {}

  // 拦截 pushState/replaceState 触发自定义事件
  try {
    const _pushState = history.pushState;
    history.pushState = function() {
      const ret = _pushState.apply(this, arguments);
      window.dispatchEvent(new Event('ccs-locationchange'));
      return ret;
    }
    const _replaceState = history.replaceState;
    history.replaceState = function() {
      const ret = _replaceState.apply(this, arguments);
      window.dispatchEvent(new Event('ccs-locationchange'));
      return ret;
    }
    window.addEventListener('ccs-locationchange', () => { ensureBottomBarVisible(false); scheduleRealtimeUpdate(); });
  } catch (_) {}

  // 兜底轮询 URL 变化（少数站点不触发事件）
  setInterval(() => {
    if (window.location.href !== lastObservedHref) {
      lastObservedHref = window.location.href;
      ensureBottomBarVisible(false);
      scheduleRealtimeUpdate();
    }
  }, 1500);

  // 检查当前网站是否在黑名单中
  function checkBlacklist() {
    const currentHost = window.location.hostname;
    if (settings.blacklist && settings.blacklist.includes(currentHost)) {
      // 不直接禁用，而是标记为黑名单状态
      settings.isBlacklisted = true;
      // 保持原始模式，以便恢复后使用
      settings.originalMode = settings.mode || 'normal';
      settings.mode = 'disabled';
      console.log('[触触搜] 网站在黑名单中，禁用功能:', currentHost);
    } else {
      settings.isBlacklisted = false;
      console.log('[触触搜] 网站不在黑名单中:', currentHost);
    }
  }

  // 保存设置
  function saveSettings() {
    console.log('[触触搜] 保存设置:', { globalDock: settings.globalDock, layout: settings.layout, barClosed: settings.barClosed });
    chrome.storage.local.set({ ccs_settings: settings });
  }

  // 智能文本类型检测
  // 监测URL/标题变化，实时更新UI（当无选中文本时）
  let lastObservedHref = window.location.href;
  let lastObservedTitle = document.title || '';
  let realtimeUpdateTimer = null;
  function scheduleRealtimeUpdate() {
    clearTimeout(realtimeUpdateTimer);
    realtimeUpdateTimer = setTimeout(updateRealtimeFallbackUI, 120);
  }
  function updateRealtimeFallbackUI(forceRefresh = false) {
    try {
      if (!shadowRoot || !popover) return;
      // 使用统一的函数获取当前文本，支持强制刷新
      const t = getCurrentSearchText(forceRefresh);
      if (!t) return;
      
      // 更新标题（若存在）
      const titleEl = shadowRoot.querySelector('.ccs-title');
      if (titleEl) {
        titleEl.title = t;
        // 文本显示由CSS省略控制，这里直接设全文
        titleEl.textContent = `🔍 触触搜: "${t}"`;
      }
      // 使用统一的函数更新所有按钮，确保data属性和tooltip一致
      updateAllButtonsWithSameText(t);
    } catch (_) {}
  }
  function getActiveSelectionText() {
    try {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
        const start = ae.selectionStart;
        const end = ae.selectionEnd;
        if (typeof start === 'number' && typeof end === 'number' && end > start) {
          return String(ae.value).substring(start, end).trim();
        }
      }
    } catch (_) {}
    try {
      return window.getSelection().toString().trim();
    } catch (_) {
      return '';
    }
  }

  function detectTextType(text) {
    if (!text) return 'empty';
    
    // Base64编码检测（更严格的检查）
    if (/^[A-Za-z0-9+/]+=*$/.test(text) && text.length > 3 && text.length % 4 === 0) {
      try {
        // 尝试解码验证
        atob(text);
        return 'base64_encoded';
      } catch {
        // 解码失败，不是有效的base64
      }
    }
    
    // URL编码检测
    if (/%[0-9A-Fa-f]{2}/.test(text) && text.includes('%')) {
      return 'url_encoded';
    }
    
    // MD5格式检测（32位十六进制）
    if (/^[a-f0-9]{32}$/i.test(text)) {
      return 'md5_hash';
    }
    
    // 纯大写文本
    if (text === text.toUpperCase() && /[A-Z]/.test(text)) {
      return 'uppercase';
    }
    
    // 纯小写文本
    if (text === text.toLowerCase() && /[a-z]/.test(text)) {
      return 'lowercase';
    }
    
    return 'plain_text';
  }

  // 获取智能命令建议
  function getSmartSuggestions(input, selectedText) {
    const textType = detectTextType(selectedText);
    const inputLower = input.toLowerCase().trim();
    
    // 命令建议配置
    const suggestions = [];
    
    // 智能建议优先级
    const priority = {
      exact: [],     // 精确匹配
      smart: [],     // 智能推荐
      fuzzy: []      // 模糊匹配
    };
    
    // 所有可用命令
    const allCommands = [
      {
        command: '/base64',
        keywords: ['base64', 'b64', 'encode', '编码'],
        icon: '🔤',
        title: 'Base64编码',
        description: '将文本编码为Base64格式',
        condition: () => textType !== 'base64_encoded'
      },
      {
        command: '/base64 -d',
        keywords: ['decode', 'base64', 'b64', '解码'],
        icon: '🔓',
        title: 'Base64解码',
        description: '解码Base64文本',
        condition: () => textType === 'base64_encoded',
        priority: textType === 'base64_encoded' ? 'smart' : 'fuzzy'
      },
      {
        command: '/md5',
        keywords: ['md5', 'hash', '哈希', '散列'],
        icon: '#️⃣',
        title: 'MD5哈希',
        description: '生成MD5哈希值',
        condition: () => textType !== 'md5_hash'
      },
      {
        command: '/url',
        keywords: ['url', 'uri', 'encode', 'urlencode'],
        icon: '🔗',
        title: 'URL编码',
        description: '将文本进行URL编码',
        condition: () => textType !== 'url_encoded'
      },
      {
        command: '/url decode',
        keywords: ['urldecode', 'decode', 'url'],
        icon: '🔗',
        title: 'URL解码',
        description: '解码URL编码文本',
        condition: () => textType === 'url_encoded',
        priority: textType === 'url_encoded' ? 'smart' : 'fuzzy'
      },
      {
        command: '/upper',
        keywords: ['upper', 'uppercase', '大写', 'up'],
        icon: '⬆️',
        title: '转大写',
        description: '转换为大写字母',
        condition: () => textType !== 'uppercase' && /[a-z]/i.test(selectedText)
      },
      {
        command: '/lower',
        keywords: ['lower', 'lowercase', '小写', 'low'],
        icon: '⬇️',
        title: '转小写',
        description: '转换为小写字母',
        condition: () => textType !== 'lowercase' && /[A-Z]/i.test(selectedText)
      },
      {
        command: '/search',
        keywords: ['search', 'google', 'baidu', '搜索', '查找'],
        icon: '🔍',
        title: '搜索',
        description: '在搜索引擎中查找',
        condition: () => true
      },
      {
        command: '/copy',
        keywords: ['copy', 'clipboard', '复制', 'cp'],
        icon: '📋',
        title: '复制',
        description: '复制到剪贴板',
        condition: () => true
      }
    ];
    
    // 根据文本类型智能推荐
    if (!inputLower) {
      // 无输入时，基于文本类型智能推荐
      if (textType === 'base64_encoded') {
        priority.smart.push(allCommands.find(c => c.command === '/base64 -d'));
      } else if (textType === 'url_encoded') {
        priority.smart.push(allCommands.find(c => c.command === '/url decode'));
      } else if (textType === 'plain_text') {
        priority.smart.push(
          allCommands.find(c => c.command === '/base64'),
          allCommands.find(c => c.command === '/md5'),
          allCommands.find(c => c.command === '/search')
        );
      }
      
      // 添加其他相关命令
      allCommands.forEach(cmd => {
        if (cmd.condition() && !priority.smart.includes(cmd)) {
          priority.fuzzy.push(cmd);
        }
      });
    } else {
      // 有输入时，进行匹配
      allCommands.forEach(cmd => {
        if (!cmd.condition()) return;
        
        // 检查命令是否匹配
        const commandMatch = cmd.command.toLowerCase().includes(inputLower) || 
                           cmd.command.replace('/', '').startsWith(inputLower);
        
        // 检查关键词匹配
        const keywordMatch = cmd.keywords.some(k => 
          k.toLowerCase().startsWith(inputLower) || 
          k.toLowerCase().includes(inputLower)
        );
        
        if (commandMatch) {
          // 命令精确匹配优先级最高
          if (cmd.command.replace('/', '').toLowerCase().startsWith(inputLower)) {
            priority.exact.push(cmd);
          } else {
            priority.smart.push(cmd);
          }
        } else if (keywordMatch) {
          // 关键词匹配次之
          if (cmd.keywords.some(k => k.toLowerCase().startsWith(inputLower))) {
            priority.smart.push(cmd);
          } else {
            priority.fuzzy.push(cmd);
          }
        }
      });
    }
    
    // 合并建议并去重
    const merged = [...priority.exact, ...priority.smart, ...priority.fuzzy];
    const uniqueSuggestions = [];
    const seen = new Set();
    
    for (const cmd of merged) {
      if (cmd && !seen.has(cmd.command)) {
        seen.add(cmd.command);
        uniqueSuggestions.push(cmd);
      }
    }
    
    return uniqueSuggestions.slice(0, 6); // 最多显示6个建议
  }

  // 命令处理函数
  const commands = {
    base64: (args) => {
      if (args[0] === '-d') {
        try {
          return atob(args.slice(1).join(' '));
        } catch (e) {
          return '解码失败: 无效的 base64 字符串';
        }
      } else {
        return btoa(unescape(encodeURIComponent(args.join(' '))));
      }
    },
    md5: (args) => {
      const text = args.join(' ');
      let hash = 0;
      for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return Math.abs(hash).toString(16).padStart(32, '0').slice(0, 32);
    },
    url: (args) => {
      if (args[0] === 'decode') {
        return decodeURIComponent(args.slice(1).join(' '));
      } else {
        return encodeURIComponent(args.join(' '));
      }
    },
    upper: (args) => args.join(' ').toUpperCase(),
    lower: (args) => args.join(' ').toLowerCase(),
    search: (args) => {
      const query = args.join(' ');
      window.open(`https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${encodeURIComponent(query)}`, '_blank');
      return `正在搜索: ${query}`;
    },
    copy: (args) => {
      const text = args.join(' ');
      navigator.clipboard.writeText(text).then(() => {
        showToast('已复制到剪贴板');
      }).catch(() => {
        showToast('复制失败');
      });
      return '已复制到剪贴板';
    }
  };

  // 功能按钮配置
  const defaultButtons = [
    {
      id: 'baidu',
      icon: '🔍',
      title: '百度搜索',
      action: (text) => {
        window.open(`https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${encodeURIComponent(text)}`, '_blank');
      }
    },
    {
      id: 'google',
      icon: '🔍',
      title: 'Google搜索',
      action: (text) => {
        window.open(`https://www.google.com/search?q=${encodeURIComponent(text)}`, '_blank');
      }
    },
	{
      id: 'chatgpt',
      icon: '🌐',
      title: 'ChatGPT',
      action: (text) => {
        window.open(`https://chatgpt.com/?prompt=${encodeURIComponent(text)}`, '_blank');
      }
    },
    {
      id: 'chuchusou',
      icon: '🌐',
      title: '更多搜索',
      action: (text) => {
        window.open(`https://chuchusou.com/?q=${encodeURIComponent(text)}`, '_blank');
      }
    },
    {
      id: 'copy',
      icon: '📝',
      title: '复制',
      action: async (text) => {
        try {
          await navigator.clipboard.writeText(text);
          showToast('已复制到剪贴板');
        } catch (err) {
          showToast('复制失败');
        }
      }
    },
    {
      id: 'base64-encode',
      icon: '🔤',
      title: 'Base64编码',
      action: (text) => {
        const encoded = btoa(unescape(encodeURIComponent(text)));
        navigator.clipboard.writeText(encoded);
        showToast(`已编码并复制: ${encoded.slice(0, 20)}...`);
      }
    },
    {
      id: 'base64-decode',
      icon: '🔓',
      title: 'Base64解码',
      action: (text) => {
        try {
          const decoded = atob(text);
          navigator.clipboard.writeText(decoded);
          showToast(`已解码并复制: ${decoded.slice(0, 20)}...`);
        } catch (e) {
          showToast('解码失败: 无效的 base64');
        }
      }
    },
    {
      id: 'url-encode',
      icon: '🔗',
      title: 'URL编码',
      action: (text) => {
        const encoded = encodeURIComponent(text);
        navigator.clipboard.writeText(encoded);
        showToast(`已URL编码: ${encoded.slice(0, 20)}...`);
      }
    },
    {
      id: 'url-decode',
      icon: '🔓',
      title: 'URL解码',
      action: (text) => {
        try {
          const decoded = decodeURIComponent(text);
          navigator.clipboard.writeText(decoded);
          showToast(`已URL解码: ${decoded.slice(0, 20)}...`);
        } catch (e) {
          showToast('URL解码失败');
        }
      }
    },
    {
      id: 'uppercase',
      icon: '🔠',
      title: '转大写',
      action: (text) => {
        const upper = text.toUpperCase();
        navigator.clipboard.writeText(upper);
        showToast('已转换为大写并复制');
      }
    },
    {
      id: 'lowercase',
      icon: '🔡',
      title: '转小写',
      action: (text) => {
        const lower = text.toLowerCase();
        navigator.clipboard.writeText(lower);
        showToast('已转换为小写并复制');
      }
    },
    {
      id: 'md5',
      icon: '#️⃣',
      title: 'MD5哈希',
      action: (text) => {
        const hash = commands.md5([text]);
        navigator.clipboard.writeText(hash);
        showToast(`MD5: ${hash}`);
      }
    }
  ];

  // 显示提示信息
  function showToast(message) {
    if (!shadowRoot) return;
    
    const toast = shadowRoot.querySelector('.ccs-toast');
    if (toast) {
      toast.textContent = message;
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
      }, 2000);
    }
  }

  // 检测光标在视口的哪个象限
  function getViewportQuadrant(x, y) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    
    // 转换为视口相对坐标
    const relX = x - scrollX;
    const relY = y - scrollY;
    
    const isLeft = relX < viewportWidth / 2;
    const isTop = relY < viewportHeight / 2;
    
    if (isTop && isLeft) return 'top-left';
    if (isTop && !isLeft) return 'top-right';
    if (!isTop && isLeft) return 'bottom-left';
    return 'bottom-right';
  }
  
  // 计算位置得分（越高越好）
  function scorePosition(pos, cursorX, cursorY, selectionRect, popoverWidth, popoverHeight) {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    let score = 0;
    
    // 1. 距离光标的距离（越远越好，最重要）
    const cursorDist = Math.sqrt(
      Math.pow(pos.x + popoverWidth/2 - cursorX, 2) + 
      Math.pow(pos.y + popoverHeight/2 - cursorY, 2)
    );
    const minCursorDist = 60; // 最小安全距离
    if (cursorDist >= minCursorDist) {
      score += Math.min(cursorDist / 100, 5) * 100; // 最高500分
    } else {
      score -= (minCursorDist - cursorDist) * 10; // 太近扣分
    }
    
    // 2. 是否完全在视口内（重要）
    const left = pos.x - scrollX;
    const top = pos.y - scrollY;
    const right = left + popoverWidth;
    const bottom = top + popoverHeight;
    
    if (left >= 10 && top >= 10 && right <= viewportWidth - 10 && bottom <= viewportHeight - 10) {
      score += 200; // 完全在视口内加200分
    } else {
      // 部分超出视口扣分
      const overflowLeft = Math.max(0, 10 - left);
      const overflowTop = Math.max(0, 10 - top);
      const overflowRight = Math.max(0, right - (viewportWidth - 10));
      const overflowBottom = Math.max(0, bottom - (viewportHeight - 10));
      const totalOverflow = overflowLeft + overflowTop + overflowRight + overflowBottom;
      score -= totalOverflow * 2;
    }
    
    // 3. 是否与选区重叠（如果有选区）
    if (selectionRect) {
      const overlap = !(
        pos.x + popoverWidth < selectionRect.left + scrollX - 10 ||
        pos.x > selectionRect.right + scrollX + 10 ||
        pos.y + popoverHeight < selectionRect.top + scrollY - 10 ||
        pos.y > selectionRect.bottom + scrollY + 10
      );
      if (!overlap) {
        score += 100; // 不重叠加100分
      }
    }
    
    return score;
  }
  
  // 智能定位算法（增强版）
  function calculateSmartPosition(selectionRect, mouseX, mouseY) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    
    console.log('[触触搜] calculateSmartPosition 输入:', {
      selectionRect: selectionRect ? {
        top: selectionRect.top,
        bottom: selectionRect.bottom,
        left: selectionRect.left,
        right: selectionRect.right
      } : null,
      mouseX, mouseY,
      viewport: { width: viewportWidth, height: viewportHeight },
      scroll: { x: scrollX, y: scrollY }
    });
    
    // 根据模式调整尺寸
    // Mini模式宽度根据按钮数量自适应：每个按钮约44px + 间距6px + padding 20px
    const miniButtonCount = settings.miniButtons.length;
    const popoverWidth = settings.mode === 'mini' ? 
      (miniButtonCount * 50 + 20) : 320;
    const popoverHeight = settings.mode === 'mini' ? 120 : 400;
    
    // 获取光标所在象限
    const quadrant = getViewportQuadrant(mouseX, mouseY);
    console.log('[触触搜] 光标象限:', quadrant);
    
    // 使用传入的鼠标位置
    const anchorX = mouseX;
    const anchorY = mouseY;
    
    // 检查是否在输入框内选中文本
    const activeElement = document.activeElement;
    const isInInputField = activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.contentEditable === 'true'
    );
    
    // 定义偏移量
    const cursorOffset = 50; // 距离光标的最小偏移
    const selectionOffset = isInInputField ? 28 : 24; // 距离选区的偏移
    
    // 生成候选位置（基于光标象限和选区位置）
    let positions = [];
    
    // 根据光标象限，优先选择对角位置
    if (quadrant === 'top-left') {
      // 光标在左上，优先右下
      positions.push(
        { x: mouseX + cursorOffset, y: mouseY + cursorOffset }, // 右下
        { x: mouseX + cursorOffset, y: mouseY - popoverHeight - cursorOffset }, // 右上
        { x: mouseX - popoverWidth - cursorOffset, y: mouseY + cursorOffset } // 左下
      );
    } else if (quadrant === 'top-right') {
      // 光标在右上，优先左下
      positions.push(
        { x: mouseX - popoverWidth - cursorOffset, y: mouseY + cursorOffset }, // 左下
        { x: mouseX - popoverWidth - cursorOffset, y: mouseY - popoverHeight - cursorOffset }, // 左上
        { x: mouseX + cursorOffset, y: mouseY + cursorOffset } // 右下
      );
    } else if (quadrant === 'bottom-left') {
      // 光标在左下，优先右上
      positions.push(
        { x: mouseX + cursorOffset, y: mouseY - popoverHeight - cursorOffset }, // 右上
        { x: mouseX + cursorOffset, y: mouseY + cursorOffset }, // 右下
        { x: mouseX - popoverWidth - cursorOffset, y: mouseY - popoverHeight - cursorOffset } // 左上
      );
    } else {
      // 光标在右下，优先左上
      positions.push(
        { x: mouseX - popoverWidth - cursorOffset, y: mouseY - popoverHeight - cursorOffset }, // 左上
        { x: mouseX - popoverWidth - cursorOffset, y: mouseY + cursorOffset }, // 左下
        { x: mouseX + cursorOffset, y: mouseY - popoverHeight - cursorOffset } // 右上
      );
    }
    
    // 如果有选区，添加基于选区的候选位置
    if (selectionRect) {
      const selCenterX = (selectionRect.left + selectionRect.right) / 2 + scrollX;
      positions.push(
        { x: selCenterX - popoverWidth / 2, y: selectionRect.bottom + scrollY + selectionOffset }, // 选区下方
        { x: selCenterX - popoverWidth / 2, y: selectionRect.top + scrollY - popoverHeight - selectionOffset }, // 选区上方
        { x: selectionRect.right + scrollX + selectionOffset, y: selectionRect.bottom + scrollY }, // 选区右侧
        { x: selectionRect.left + scrollX - popoverWidth - selectionOffset, y: selectionRect.bottom + scrollY } // 选区左侧
      );
    }
    
    // 使用评分系统找到最佳位置
    let bestPosition = null;
    let bestScore = -Infinity;
    
    for (const pos of positions) {
      const score = scorePosition(pos, mouseX, mouseY, selectionRect, popoverWidth, popoverHeight);
      if (score > bestScore) {
        bestScore = score;
        bestPosition = pos;
      }
    }
    
    console.log('[触触搜] 最佳位置得分:', bestScore);
    
    // 如果找到了合适的位置，返回
    if (bestPosition && bestScore > 0) {
      // 确保位置在视口内
      bestPosition.x = Math.max(scrollX + 10, Math.min(bestPosition.x, scrollX + viewportWidth - popoverWidth - 10));
      bestPosition.y = Math.max(scrollY + 10, Math.min(bestPosition.y, scrollY + viewportHeight - popoverHeight - 10));
      
      console.log('[触触搜] calculateSmartPosition 输出:', { 
        x: bestPosition.x, 
        y: bestPosition.y, 
        score: bestScore,
        quadrant: quadrant
      });
      
      return bestPosition;
    }
    
    // 如果所有候选位置得分都很低，使用备用策略
    // 尽量远离光标，放在视口的安全区域
    let fallbackX, fallbackY;
    
    if (quadrant === 'top-left') {
      // 光标在左上，放在右下区域
      fallbackX = scrollX + viewportWidth - popoverWidth - 20;
      fallbackY = scrollY + viewportHeight - popoverHeight - 20;
    } else if (quadrant === 'top-right') {
      // 光标在右上，放在左下区域
      fallbackX = scrollX + 20;
      fallbackY = scrollY + viewportHeight - popoverHeight - 20;
    } else if (quadrant === 'bottom-left') {
      // 光标在左下，放在右上区域
      fallbackX = scrollX + viewportWidth - popoverWidth - 20;
      fallbackY = scrollY + 20;
    } else {
      // 光标在右下，放在左上区域
      fallbackX = scrollX + 20;
      fallbackY = scrollY + 20;
    }
    
    // 确保备用位置在视口内
    fallbackX = Math.max(scrollX + 10, Math.min(fallbackX, scrollX + viewportWidth - popoverWidth - 10));
    fallbackY = Math.max(scrollY + 10, Math.min(fallbackY, scrollY + viewportHeight - popoverHeight - 10));

    console.log('[触触搜] calculateSmartPosition 输出（备用）:', { 
      x: fallbackX, 
      y: fallbackY, 
      popoverSize: { width: popoverWidth, height: popoverHeight },
      quadrant: quadrant,
      reason: '使用备用位置'
    });

    return { x: fallbackX, y: fallbackY };
  }

  // 创建popover
  function createPopover(preserveText = false) {
    if (settings.mode === 'disabled') {
      return;
    }

    // 保存当前选中的文本（如果需要保留）
    const tempSelectedText = preserveText ? selectedText : '';

    // 如果是切换模式且popover已存在，只更新内容而不移除
    const isModeSwitching = preserveText && popover;
    
    if (!isModeSwitching) {
      // 移除旧的popover（非模式切换时）
      if (popover) {
        // 清理拖拽状态
        cleanupDragState();
        popover.remove();
      }
      
      // 创建容器
      popover = document.createElement('div');
      popover.id = 'ccs-popover-container';
      popover.style.position = 'absolute';
      popover.style.zIndex = '2147483647';
      popover.style.opacity = settings.opacity;

      // 创建shadow DOM
      shadowRoot = popover.attachShadow({ mode: 'open' });
    } else {
      // 模式切换时，清空shadow DOM内容但保留容器
      // 同时清理拖拽状态
      cleanupDragState();
      shadowRoot.innerHTML = '';
    }
    
    // 恢复选中的文本（如果需要保留）
    if (preserveText && tempSelectedText) {
      selectedText = tempSelectedText;
    }

    // 创建HTML结构
    const wrapper = document.createElement('div');
    const isDockedBottom = (settings.mode === 'normal' && settings.layout === 'bottom');
    wrapper.className = `ccs-popover ${settings.mode === 'mini' ? 'mini-mode' : ''} ${isDockedBottom ? 'docked-bottom' : ''} theme-${settings.theme}`;
    
    // 统一标题：mini/normal 都显示关键词
    const escapeHtml = (text) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      };
    const displayText = selectedText ? 
      `🔍 触触搜: "${escapeHtml(selectedText.substring(0, 15))}${selectedText.length > 15 ? '...' : ''}"` : 
      '🔍 触触搜';

    if (settings.mode === 'mini') {
      // Mini模式HTML - 同样显示关键词
      wrapper.innerHTML = `
        <div class="ccs-header" data-draggable="true">
          <span class="ccs-title">${displayText}</span>
          <div class="ccs-header-buttons">
            <button class="ccs-expand" title="展开">📖</button>
            <button class="ccs-close" title="关闭">✕</button>
          </div>
        </div>
        <div class="ccs-mini-buttons"></div>
        <div class="ccs-toast"></div>
      `;
    } else if (settings.mode === 'normal' && settings.layout === 'bottom') {
      // 底部停靠布局：不显示标题/页脚，仅显示按钮和控制
      const badgeHtml = settings.globalDock ? '<span class="ccs-global-badge" title="悬停模式（全局）">全局</span>' : (isTempDock ? '<span class="ccs-temp-badge" title="悬停模式（临时）">临时</span>' : '');
      wrapper.innerHTML = `
        <div class="ccs-bottom" data-draggable="false">
          <div class="ccs-bottom-buttons"></div>
          <div class="ccs-bottom-controls">
            ${badgeHtml}
            <button class="ccs-close-bottom" title="关闭底部栏">✕</button>
            <button class="ccs-undock" title="悬浮模式">↕️</button>
          </div>
        </div>
        <div class="ccs-toast"></div>
      `;
    } else {
      // 普通模式HTML - 标题显示选中的文本
      const isDocked = false;
      wrapper.innerHTML = `
        <div class="ccs-header" data-draggable="true">
          <span class="ccs-title">${displayText}</span>
          <div class="ccs-header-buttons">
            <button class="ccs-dock-toggle" title="底部栏">📌</button>
            <div class="ccs-dock-menu" style="display:none;">
              <button class="ccs-dock-global">开启底部栏（全局）</button>
              <button class="ccs-dock-temp">开启底部栏（当前页）</button>
              <div class="ccs-dock-shortcut">打开触触搜面板 (Alt+S)</div>
            </div>
            <button class="ccs-mini" title="迷你模式">📐</button>
            <button class="ccs-settings" title="设置">⚙️</button>
            <button class="ccs-close" title="关闭">✕</button>
          </div>
        </div>
        <!-- === 输入框功能暂时禁用 - 2024/08 === -->
        <!--
        <div class="ccs-input-wrapper">
          <input type="text" class="ccs-input" placeholder="输入命令 (如: /base64 hello)">
          <button class="ccs-execute">执行</button>
          <div class="ccs-suggestions" style="display: none;"></div>
        </div>
        -->
        <div class="ccs-buttons"></div>
        <div class="ccs-result" style="display: none;"></div>
        <div class="ccs-toast"></div>
        <div class="ccs-settings-panel" style="display: none;">
          <h3>设置</h3>
          <div class="setting-item">
            <label>调试日志：</label>
            <input type="checkbox" class="debug-toggle" ${window.CCS_DEBUG ? 'checked' : ''}>
          </div>
          <div class="setting-item">
            <label>显示模式：</label>
            <select class="mode-select">
              <option value="normal">普通</option>
              <option value="mini">迷你</option>
              <option value="disabled">禁用</option>
            </select>
          </div>
          <div class="setting-item">
            <label>透明度：</label>
            <input type="range" class="opacity-slider" min="0.3" max="1" step="0.1" value="${settings.opacity}">
            <span class="opacity-value">${Math.round(settings.opacity * 100)}%</span>
          </div>
          <div class="setting-item">
            <label>启用底部栏：</label>
            <input type="checkbox" class="bar-enable-toggle" ${!settings.barClosed ? 'checked' : ''}>
          </div>
          <div class="setting-item">
            <label>底部栏（全局）：</label>
            <input type="checkbox" class="global-dock-toggle" ${settings.globalDock ? 'checked' : ''}>
          </div>
          <div class="setting-item">
            <label>快捷键：</label>
            <select class="shortcut-select">
              <option value="Alt+S" ${settings.shortcutKey === 'Alt+S' ? 'selected' : ''}>Alt+S（默认）</option>
              <option value="Ctrl+Shift+S" ${settings.shortcutKey === 'Ctrl+Shift+S' ? 'selected' : ''}>Ctrl+Shift+S</option>
              <option value="Alt+Shift+S" ${settings.shortcutKey === 'Alt+Shift+S' ? 'selected' : ''}>Alt+Shift+S</option>
              <option value="Ctrl+Alt+S" ${settings.shortcutKey === 'Ctrl+Alt+S' ? 'selected' : ''}>Ctrl+Alt+S</option>
              <option value="Alt+Q" ${settings.shortcutKey === 'Alt+Q' ? 'selected' : ''}>Alt+Q</option>
              <option value="Alt+E" ${settings.shortcutKey === 'Alt+E' ? 'selected' : ''}>Alt+E</option>
            </select>
          </div>
          <div class="setting-item">
            <label>当前网站：</label>
            <span class="current-host" title="${window.location.hostname}">${window.location.hostname}</span>
            <button class="blacklist-toggle">加入黑名单</button>
          </div>
          <div class="setting-note">
            💡 禁用后可在Chrome扩展管理页重新启用
          </div>
        </div>
      `;
    }

    // 添加样式
    const style = document.createElement('style');
    style.textContent = `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      
      .ccs-popover {
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        width: 320px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        font-size: 14px;
        color: #333;
        overflow: hidden;
        animation: fadeIn 0.2s ease-out;
        transition: opacity 0.2s;
      }

      .ccs-popover.mini-mode {
        width: auto;
        min-width: 240px;
        pointer-events: auto;
      }

      /* 底部停靠模式 */
      .ccs-popover.docked-bottom {
        width: 100vw;
        border-radius: 8px 8px 0 0;
        pointer-events: auto;
      }

      .ccs-bottom {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 8px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
      }
      .ccs-bottom-buttons {
        flex: 1;
        display: flex;
        gap: 8px;
        overflow-x: auto;
        scrollbar-width: thin;
      }
      .ccs-bottom-controls {
        margin-left: 8px;
        flex-shrink: 0;
      }
      .ccs-undock {
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        cursor: pointer;
        font-size: 14px;
        padding: 4px 8px;
        border-radius: 4px;
      }
      .ccs-undock:hover {
        background: rgba(255,255,255,0.3);
      }
      .ccs-close-bottom {
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        cursor: pointer;
        font-size: 14px;
        padding: 4px 8px;
        border-radius: 4px;
        margin-right: 4px;
      }
      .ccs-close-bottom:hover { background: rgba(255,255,255,0.3); }

      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(-10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .ccs-header {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 8px 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: move;
        user-select: none;
        -webkit-user-select: none;
        -moz-user-select: none;
        -ms-user-select: none;
      }

      .ccs-header-buttons { position: relative; }
      .ccs-dock-menu {
        position: absolute;
        right: 0;
        top: 30px;
        background: white;
        color: #2d3748;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        box-shadow: 0 6px 16px rgba(0,0,0,0.15);
        padding: 6px;
        display: none;
        z-index: 9999;
      }
      .ccs-header-buttons:hover .ccs-dock-menu { display: block; }
      .ccs-dock-menu button {
        display: block;
        width: 160px;
        text-align: left;
        background: white;
        border: 1px solid #e2e8f0;
        color: #2d3748;
        border-radius: 4px;
        font-size: 12px;
        padding: 6px 8px;
        margin: 4px 0;
        cursor: pointer;
      }
      .ccs-dock-menu button:hover { background: #f7fafc; }
      
      .ccs-dock-shortcut {
        display: block;
        width: 160px;
        padding: 8px;
        margin-top: 4px;
        border-top: 1px solid #e2e8f0;
        color: #718096;
        font-size: 11px;
        text-align: center;
        font-style: italic;
        cursor: default;
      }

      .ccs-global-badge {
        display: inline-block;
        background: rgba(255,255,255,0.85);
        color: #4c51bf;
        border: 1px solid rgba(226,232,240,0.9);
        border-radius: 10px;
        font-size: 10px;
        padding: 2px 6px;
        margin-right: 6px;
      }
      .ccs-temp-badge {
        display: inline-block;
        background: rgba(255,255,255,0.85);
        color: #2b6cb0;
        border: 1px solid rgba(226,232,240,0.9);
        border-radius: 10px;
        font-size: 10px;
        padding: 2px 6px;
        margin-right: 6px;
      }

      .docked-bottom .ccs-header {
        cursor: default; /* 底部栏不拖拽 */
      }

      .ccs-header.dragging {
        opacity: 0.8;
        cursor: grabbing;
      }
      
      /* 拖拽时防止选中页面文本 */
      body.ccs-dragging {
        user-select: none !important;
        -webkit-user-select: none !important;
        -moz-user-select: none !important;
        -ms-user-select: none !important;
      }

      .ccs-title {
        font-weight: bold;
        font-size: 14px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 1;
        min-width: 0;
      }

      .ccs-header-buttons {
        display: flex;
        gap: 5px;
        flex-shrink: 0;
      }

      .ccs-header button {
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        font-size: 14px;
        padding: 2px 6px;
        border-radius: 4px;
        transition: background-color 0.2s;
      }

      /* Dock menu buttons must stay dark on white background */
      .ccs-header .ccs-dock-menu button {
        color: #2d3748 !important;
        background: #ffffff !important;
        border: 1px solid #e2e8f0 !important;
      }

      .ccs-header button:hover {
        background-color: rgba(255,255,255,0.2);
      }

      .ccs-input-wrapper {
        padding: 12px;
        display: flex;
        gap: 8px;
        border-bottom: 1px solid #eee;
      }

      .ccs-input {
        flex: 1;
        padding: 6px 10px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 13px;
        outline: none;
        transition: border-color 0.2s;
      }

      .ccs-input:focus {
        border-color: #667eea;
      }

      .ccs-execute {
        padding: 6px 14px;
        background: #667eea;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        transition: background-color 0.2s;
      }

      .ccs-execute:hover {
        background: #5a67d8;
      }

      .ccs-input-wrapper {
        position: relative;
      }

      .ccs-suggestions {
        position: absolute;
        top: 100%;
        left: 0;
        right: 60px;
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 4px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        margin-top: 4px;
        max-height: 200px;
        overflow-y: auto;
        z-index: 100;
        animation: slideDown 0.2s ease-out;
      }
      
      @keyframes slideDown {
        from {
          opacity: 0;
          transform: translateY(-5px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .ccs-suggestion-item {
        padding: 8px 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: background-color 0.2s;
        border-bottom: 1px solid #f7fafc;
      }

      .ccs-suggestion-item:last-child {
        border-bottom: none;
      }

      .ccs-suggestion-item:hover,
      .ccs-suggestion-item.selected {
        background: #f7fafc;
      }

      .ccs-suggestion-item.selected {
        background: #edf2f7;
      }

      .ccs-suggestion-icon {
        font-size: 16px;
        flex-shrink: 0;
      }

      .ccs-suggestion-content {
        flex: 1;
        min-width: 0;
      }

      .ccs-suggestion-command {
        font-family: monospace;
        font-size: 13px;
        color: #2d3748;
        font-weight: 500;
      }

      .ccs-suggestion-description {
        font-size: 11px;
        color: #718096;
        margin-top: 2px;
      }

      .ccs-suggestion-shortcut {
        font-size: 10px;
        color: #a0aec0;
        padding: 2px 6px;
        background: #f7fafc;
        border-radius: 3px;
        flex-shrink: 0;
      }

      .ccs-buttons {
        padding: 12px;
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 8px;
      }

      .docked-bottom .ccs-buttons { display: none; }
      .docked-bottom .ccs-mini-buttons { display: none; }

      /* 压缩按钮风格（底部栏） */
      .docked-bottom .ccs-button {
        flex: 0 0 auto;
        min-width: 64px;
        padding: 6px 6px;
        border: 1px solid rgba(226, 232, 240, 0.8);
        background: rgba(247, 250, 252, 0.9);
      }
      .docked-bottom .ccs-button-icon { font-size: 16px; }
      .docked-bottom .ccs-button-label { font-size: 9px; color: #2d3748; }

      .ccs-mini-buttons {
        padding: 10px;
        display: flex;
        gap: 6px;
        flex-wrap: nowrap;
      }

      .ccs-button {
        background: #f7fafc;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        padding: 10px 6px;
        cursor: pointer;
        text-align: center;
        transition: all 0.2s;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
      }

      .mini-mode .ccs-button {
        padding: 8px 6px;
        flex: 0 0 auto;
        min-width: 44px;
      }

      .ccs-button:hover {
        background: #edf2f7;
        border-color: #cbd5e0;
        transform: translateY(-1px);
      }

      .ccs-button-icon {
        font-size: 18px;
      }

      .mini-mode .ccs-button-icon {
        font-size: 16px;
      }

      .ccs-button-label {
        font-size: 10px;
        color: #718096;
      }

      .mini-mode .ccs-button-label {
        font-size: 9px;
      }

      .ccs-result {
        padding: 10px 12px;
        background: #f7fafc;
        border-top: 1px solid #e2e8f0;
        font-family: monospace;
        font-size: 12px;
        max-height: 80px;
        overflow-y: auto;
        word-break: break-all;
      }

      .ccs-footer {
        padding: 8px 12px;
        background: #f7fafc;
        color: #718096;
        font-size: 11px;
        text-align: center;
        border-top: 1px solid #e2e8f0;
      }

      .ccs-toast {
        position: absolute;
        bottom: 50px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 6px 12px;
        border-radius: 4px;
        font-size: 12px;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s;
        white-space: nowrap;
        z-index: 1000;
      }

      .ccs-toast.show {
        opacity: 1;
      }

      .ccs-settings-panel {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: white;
        border-radius: 0 0 8px 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        padding: 15px;
        z-index: 10;
        color: #2d3748;
      }

      .ccs-settings-panel h3 {
        font-size: 14px;
        margin-bottom: 12px;
        color: #4c51bf;
      }

      .setting-item {
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .setting-item label {
        font-size: 13px;
        color: #2d3748;
        font-weight: 600;
      }

      .setting-item select,
      .setting-item button {
        padding: 6px 10px;
        border: 1px solid #cbd5e0;
        border-radius: 4px;
        font-size: 12px;
        background: white;
        cursor: pointer;
        flex-shrink: 0;
      }
      .setting-item input[type="checkbox"] {
        width: 16px;
        height: 16px;
        cursor: pointer;
      }

      .current-host {
        flex: 1;
        min-width: 0;
        max-width: 150px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 12px;
        color: #1a202c;
        background: #edf2f7;
        border: 1px solid #cbd5e0;
        border-radius: 6px;
        padding: 4px 8px;
      }

      .setting-item input[type="range"] {
        width: 80px;
      }

      .opacity-value {
        font-size: 12px;
        color: #718096;
        margin-left: 8px;
      }

      .blacklist-toggle {
        background: #ffffff;
        color: #c53030; /* dark red text for readability */
        border: 1px solid #c53030;
        font-weight: 600;
      }

      .blacklist-toggle:hover {
        background: #fff5f5;
        border-color: #9b2c2c;
        color: #9b2c2c;
      }

      .setting-note {
        font-size: 11px;
        color: #a0aec0;
        text-align: center;
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid #e2e8f0;
      }
    `;

    shadowRoot.appendChild(style);
    shadowRoot.appendChild(wrapper);

    // 设置标题的完整tooltip，便于悬浮查看全文
    try {
      const titleEl = shadowRoot.querySelector('.ccs-title');
      if (titleEl) {
        const full = getCurrentSearchText();
        if (full) titleEl.title = full;
      }
    } catch (_) {}

    // 添加按钮
    const buttonsToShow = settings.mode === 'mini' 
      ? settings.miniButtons.map(id => defaultButtons.find(btn => btn.id === id)).filter(Boolean)
      : defaultButtons;

    const buttonsContainer = shadowRoot.querySelector(
      settings.mode === 'mini' ? '.ccs-mini-buttons' : (settings.layout === 'bottom' ? '.ccs-bottom-buttons' : '.ccs-buttons')
    );
    if (buttonsContainer) {
      buttonsToShow.forEach(btn => {
        const button = document.createElement('div');
        button.className = 'ccs-button';
        // 存储id和button配置，便于后续根据按钮类型更新tooltip
        button.dataset.id = btn.id;
        button.dataset.btnTitle = btn.title;
        button.innerHTML = `
          <div class="ccs-button-icon">${btn.icon}</div>
          <div class="ccs-button-label">${btn.title}</div>
        `;
        // 初始hover提示包含完整文本（使用统一函数）
        // 同时存储文本到data属性，确保alt text和action使用相同值
        try {
          const initText = getCurrentSearchText();
          button.dataset.searchText = initText || '';
          button.title = initText ? `${btn.title}: ${initText}` : btn.title;
        } catch (_) {
          button.dataset.searchText = '';
          button.title = btn.title;
        }
        button.addEventListener('click', () => {
          // 点击时重新同步文本，确保使用最新值
          const text = syncAllTextVariables();
          if (!text) {
            try { showToast('没有可用的文本'); } catch (_) {}
            return;
          }
          btn.action(text);
        });
        // 悬停/指针进入/获得焦点时，强制实时刷新（优先标题/URL），并同步刷新整块UI标题
        const refreshHover = () => {
          try {
            // 减少节流时间，使响应更快
            const now = Date.now();
            const lastTs = parseInt(button.dataset.hovTs || '0', 10);
            if (now - lastTs < 50) return; // 从150ms减少到50ms
            button.dataset.hovTs = String(now);
            
            // 使用统一的同步函数，确保所有变量一致
            const t = syncAllTextVariables();
            
            // 同步更新标题，确保一致
            updateRealtimeFallbackUI(true);
            
            if (window.CCS_DEBUG) console.log('[触触搜][DEBUG] hover实时刷新', { 
              id: btn.id, 
              text: t || '(空)', 
              title: document.title,
              url: window.location.href 
            });
          } catch (_) {}
        };
        // 多通道触发：mouseenter（一次）、mouseover（可重复）、mousemove（移动时）、pointerenter、focusin
        button.addEventListener('mouseenter', refreshHover);
        button.addEventListener('mouseover', refreshHover);
        button.addEventListener('mousemove', refreshHover); // 添加mousemove以获得更实时的更新
        button.addEventListener('pointerenter', refreshHover);
        button.addEventListener('focusin', refreshHover);
        buttonsContainer.appendChild(button);
      });
    }

    // 绑定事件
    bindEvents();

    // 只在新创建时添加到DOM
    if (!isModeSwitching) {
      document.body.appendChild(popover);
      console.log('[触触搜] Popover 已添加到 DOM');
    } else {
      console.log('[触触搜] 模式切换，Popover 保持在 DOM 中');
    }
  }

  // 绑定事件
  function bindEvents() {
    if (!shadowRoot) return;

    // 关闭按钮
    const closeBtn = shadowRoot.querySelector('.ccs-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', hidePopover);
    }

    // === 输入框功能暂时禁用 - 2024/08 ===
    /*
    // 执行按钮
    const executeBtn = shadowRoot.querySelector('.ccs-execute');
    if (executeBtn) {
      executeBtn.addEventListener('click', executeCommand);
    }
    */

    // === 输入框功能暂时禁用 - 2024/08 ===
    // 保留代码结构以便将来恢复
    /*
    // 输入框事件和建议系统
    const input = shadowRoot.querySelector('.ccs-input');
    const suggestionsContainer = shadowRoot.querySelector('.ccs-suggestions');
    let selectedSuggestionIndex = -1;
    let currentSuggestions = [];
    let debounceTimer = null;
    
    if (input) {
      // === 智能建议功能暂时禁用 - 2024/08 ===
      // 保留代码以便将来恢复和优化
      
      // 输入监听 - 实时更新建议
      input.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          updateSuggestions(e.target.value);
        }, 150);
      });
      
      // 键盘导航
      input.addEventListener('keydown', (e) => {
        if (!suggestionsContainer || suggestionsContainer.style.display === 'none') {
          if (e.key === 'Enter') {
            e.preventDefault();
            executeCommand();
          }
          return;
        }
        
        switch(e.key) {
          case 'ArrowDown':
            e.preventDefault();
            navigateSuggestions(1);
            break;
          case 'ArrowUp':
            e.preventDefault();
            navigateSuggestions(-1);
            break;
          case 'Tab':
            e.preventDefault();
            if (selectedSuggestionIndex >= 0 && currentSuggestions[selectedSuggestionIndex]) {
              applySuggestion(currentSuggestions[selectedSuggestionIndex], false);
            }
            break;
          case 'Enter':
            e.preventDefault();
            if (selectedSuggestionIndex >= 0 && currentSuggestions[selectedSuggestionIndex]) {
              applySuggestion(currentSuggestions[selectedSuggestionIndex], true);
            } else {
              executeCommand();
            }
            break;
          case 'Escape':
            hideSuggestions();
            break;
        }
      });
      
      // 保留基础的回车执行功能
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          executeCommand();
        }
      });
      
      // hover时聚焦，避免破坏选中状态
      input.addEventListener('mouseenter', () => {
        input.focus();
      });
      
      // 点击时也聚焦
      input.addEventListener('click', () => {
        input.focus();
        // 如果输入框为空或只有空格，显示默认建议
        if (!input.value.trim()) {
          updateSuggestions('');
        }
      });
      
      // 聚焦时显示建议
      input.addEventListener('focus', () => {
        if (!input.value.trim() && selectedText) {
          updateSuggestions('');
        }
      });
      
      // 失焦时隐藏建议（延迟以允许点击建议）
      input.addEventListener('blur', () => {
        setTimeout(() => {
          if (document.activeElement !== input) {
            hideSuggestions();
          }
        }, 200);
      });
    }
    */
    
    // === 建议系统功能暂时禁用 - 2024/08 ===
    /*
    // 更新建议列表
    function updateSuggestions(inputValue) {
      if (!suggestionsContainer) return;
      
      const suggestions = getSmartSuggestions(inputValue, selectedText);
      currentSuggestions = suggestions;
      selectedSuggestionIndex = -1;
      
      if (suggestions.length === 0) {
        hideSuggestions();
        return;
      }
      
      // 构建建议HTML
      suggestionsContainer.innerHTML = suggestions.map((s, index) => `
        <div class="ccs-suggestion-item" data-index="${index}">
          <span class="ccs-suggestion-icon">${s.icon}</span>
          <div class="ccs-suggestion-content">
            <div class="ccs-suggestion-command">${s.command}</div>
            <div class="ccs-suggestion-description">${s.description}</div>
          </div>
          ${index === 0 ? '<span class="ccs-suggestion-shortcut">Enter</span>' : ''}
        </div>
      `).join('');
      
      suggestionsContainer.style.display = 'block';
      
      // 绑定鼠标事件
      suggestionsContainer.querySelectorAll('.ccs-suggestion-item').forEach((item, index) => {
        item.addEventListener('click', () => {
          applySuggestion(suggestions[index], true);
        });
        item.addEventListener('mouseenter', () => {
          selectSuggestion(index);
        });
      });
    }
    
    // 导航建议
    function navigateSuggestions(direction) {
      const newIndex = selectedSuggestionIndex + direction;
      if (newIndex >= -1 && newIndex < currentSuggestions.length) {
        selectSuggestion(newIndex);
      }
    }
    
    // 选择建议
    function selectSuggestion(index) {
      const items = suggestionsContainer.querySelectorAll('.ccs-suggestion-item');
      items.forEach((item, i) => {
        if (i === index) {
          item.classList.add('selected');
        } else {
          item.classList.remove('selected');
        }
      });
      selectedSuggestionIndex = index;
    }
    
    // 应用建议
    function applySuggestion(suggestion, execute) {
      if (!input) return;
      input.value = suggestion.command + ' ' + selectedText;
      hideSuggestions();
      if (execute) {
        executeCommand();
      } else {
        input.focus();
      }
    }
    
    // 隐藏建议
    function hideSuggestions() {
      if (suggestionsContainer) {
        suggestionsContainer.style.display = 'none';
        selectedSuggestionIndex = -1;
        currentSuggestions = [];
      }
    }
    */

    // 迷你模式切换
    const miniBtn = shadowRoot.querySelector('.ccs-mini');
    if (miniBtn) {
      miniBtn.addEventListener('click', () => {
        settings.mode = 'mini';
        saveSettings();
        createPopover(true); // 传入true保留selectedText和位置
        // 确保popover定位和pointer-events正确
        if (popover && settings.position) {
          popover.style.position = 'absolute';
          popover.style.left = `${settings.position.x}px`;
          popover.style.top = `${settings.position.y}px`;
          popover.style.pointerEvents = 'auto';
          popover.style.width = '';
          popover.style.right = '';
          popover.style.bottom = '';
        }
      });
    }

    // 展开按钮（从mini到normal）
    const expandBtn = shadowRoot.querySelector('.ccs-expand');
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        settings.mode = 'normal';
        saveSettings();
        createPopover(true); // 传入true保留selectedText和位置
        // 确保popover定位和pointer-events正确
        if (popover && settings.position && settings.layout !== 'bottom') {
          popover.style.position = 'absolute';
          popover.style.left = `${settings.position.x}px`;
          popover.style.top = `${settings.position.y}px`;
          popover.style.pointerEvents = 'auto';
          popover.style.width = '';
          popover.style.right = '';
          popover.style.bottom = '';
        }
      });
    }

    // 设置按钮
    const settingsBtn = shadowRoot.querySelector('.ccs-settings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', toggleSettings);
    }

    // 底部栏切换
    const dockToggle = shadowRoot.querySelector('.ccs-dock-toggle');
    const dockMenu = shadowRoot.querySelector('.ccs-dock-menu');
    if (dockToggle) {
      // 默认点击：开启悬停模式（全局）
      dockToggle.addEventListener('click', () => {
        settings.globalDock = true;
        settings.layout = 'bottom';
        settings.mode = 'normal'; // 确保使用普通模式以显示底部栏
        isTempDock = false;
        settings.barClosed = false; // 确保启用
        saveSettings();
        createPopover(true);
        const selection = window.getSelection();
        let x = window.innerWidth / 2 + window.scrollX;
        let y = window.innerHeight / 3 + window.scrollY;
        let rect = null;
        if (selection && selection.rangeCount > 0 && selection.toString().trim()) {
          const range = selection.getRangeAt(0);
          rect = range.getBoundingClientRect();
          x = rect.left + rect.width / 2 + window.scrollX;
          y = rect.bottom + window.scrollY;
        }
        forceShowPopover(x, y, rect, { overrideSavedPosition: true });
      });
      // 悬停显示菜单
      let dockMenuTimer = null;
      const showDockMenu = () => {
        clearTimeout(dockMenuTimer);
        if (dockMenu) dockMenu.style.display = 'block';
      };
      const hideDockMenu = () => {
        clearTimeout(dockMenuTimer);
        dockMenuTimer = setTimeout(() => { if (dockMenu) dockMenu.style.display = 'none'; }, 150);
      };
      dockToggle.addEventListener('mouseenter', showDockMenu);
      dockToggle.addEventListener('mouseleave', hideDockMenu);
      if (dockMenu) {
        dockMenu.addEventListener('mouseenter', showDockMenu);
        dockMenu.addEventListener('mouseleave', hideDockMenu);
        const globalBtn = dockMenu.querySelector('.ccs-dock-global');
        const tempBtn = dockMenu.querySelector('.ccs-dock-temp');
        if (globalBtn) {
          globalBtn.addEventListener('click', () => {
            console.log('[触触搜] 点击全局底部栏按钮');
            settings.globalDock = true;
            settings.layout = 'bottom';
            settings.mode = 'normal'; // 确保普通模式
            isTempDock = false;
            settings.barClosed = false;
            saveSettings();
            createPopover(true);
            forceShowPopover(window.innerWidth / 2 + window.scrollX, window.innerHeight / 3 + window.scrollY, null, { overrideSavedPosition: true });
            if (dockMenu) dockMenu.style.display = 'none';
          });
        }
        if (tempBtn) {
          tempBtn.addEventListener('click', () => {
            console.log('[触触搜] 点击当前页底部栏按钮');
            // 开启底部栏（当前页）- 但也保存全局设置以便记住状态
            settings.globalDock = true; // 保存为全局开启
            settings.layout = 'bottom';
            settings.mode = 'normal'; // 确保普通模式
            isTempDock = false; // 不使用临时标记
            settings.barClosed = false;
            saveSettings(); // 保存设置以记住状态
            createPopover(true);
            forceShowPopover(window.innerWidth / 2 + window.scrollX, window.innerHeight / 3 + window.scrollY, null, { overrideSavedPosition: true });
            if (dockMenu) dockMenu.style.display = 'none';
          });
        }
      }
    }

    // 底部栏：解除停靠按钮
    const undockBtn = shadowRoot.querySelector('.ccs-undock');
    if (undockBtn) {
      undockBtn.addEventListener('click', () => {
        // 从底部悬停模式切换到弹出（浮动）模式
        // 要求：切换后若无选区，保持隐藏；并将全局悬停关掉（持久化），以便其它页面保持一致模式
        settings.layout = 'float';
        settings.globalDock = false; // 关闭全局悬停（持久化）
        isTempDock = false; // 清除临时标记
        settings.position = null; // 清除保存的位置，确保重新定位
        saveSettings();

        const selection = window.getSelection();
        const hasSelection = !!(selection && selection.rangeCount > 0 && selection.toString().trim());
        if (hasSelection) {
          // 仅在有选中时显示 Popover
          createPopover(true);
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          const x = rect.left + rect.width / 2 + window.scrollX;
          const y = rect.bottom + window.scrollY;
          forceShowPopover(x, y, rect, { overrideSavedPosition: true });
        } else {
          // 无选中：隐藏并等待用户双击或键盘扩展选择后再显示
          hidePopover();
        }
      });
    }
    const closeBottomBtn = shadowRoot.querySelector('.ccs-close-bottom');
    if (closeBottomBtn) {
      closeBottomBtn.addEventListener('click', () => {
        settings.barClosed = true; // 全局关闭优先
        // 关闭底部栏也应清空临时标记
        isTempDock = false;
        saveSettings();
        hidePopover();
      });
    }

      // 设置面板事件
      const settingsPanel = shadowRoot.querySelector('.ccs-settings-panel');
      if (settingsPanel) {
      // 启用底部栏（全局关闭开关）
      const barEnableCheckbox = settingsPanel.querySelector('.bar-enable-toggle');
      if (barEnableCheckbox) {
        barEnableCheckbox.addEventListener('change', (e) => {
          const enable = e.target.checked;
          settings.barClosed = !enable;
          if (enable) {
            // 同步设置为全局悬停：其它页面也默认打开底部栏
            settings.globalDock = true;
            settings.layout = 'bottom';
            settings.mode = 'normal'; // 确保普通模式
            isTempDock = false;
            saveSettings();
            createPopover(true);
            forceShowPopover(window.innerWidth / 2 + window.scrollX, window.innerHeight / 3 + window.scrollY, null, { overrideSavedPosition: true });
          } else {
            saveSettings();
            hidePopover();
          }
        });
      }

      // 调试日志开关
      const debugToggle = settingsPanel.querySelector('.debug-toggle');
      if (debugToggle) {
        debugToggle.addEventListener('change', (e) => {
          const enabled = !!e.target.checked;
          window.CCS_DEBUG = enabled;
          chrome.storage.local.set({ ccs_debug: enabled });
          try { showToast(enabled ? '调试已开启' : '调试已关闭'); } catch (_) {}
          console.log(`[触触搜] 调试日志已${enabled ? '开启' : '关闭'}。可在设置中随时切换。`);
          // 同步到后台
          try { chrome.runtime.sendMessage({ action: 'updateDebug', enabled }); } catch (_) {}
        });
      }

      // 全局底部栏开关
      const globalDockCheckbox = settingsPanel.querySelector('.global-dock-toggle');
      if (globalDockCheckbox) {
        globalDockCheckbox.addEventListener('change', (e) => {
          settings.globalDock = e.target.checked;
          saveSettings();
          if (settings.globalDock) {
            // 立即启用底部栏
            settings.layout = 'bottom';
            isTempDock = false;
            settings.barClosed = false;
            createPopover(true);
            forceShowPopover(window.innerWidth / 2 + window.scrollX, window.innerHeight / 3 + window.scrollY, null, { overrideSavedPosition: true });
          } else {
            // 关闭全局：如果当前是底部栏但非临时，切回悬浮
            if (settings.layout === 'bottom' && !isTempDock) {
              settings.layout = 'float';
              // 清除保存的位置，确保重新定位
              settings.position = null;
              saveSettings();
              // 若无选中，则保持隐藏；有选中才显示
              const selection = window.getSelection();
              const hasSelection = !!(selection && selection.rangeCount > 0 && selection.toString().trim());
              if (hasSelection) {
                createPopover(true);
                const range = selection.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                const x = rect.left + rect.width / 2 + window.scrollX;
                const y = rect.bottom + window.scrollY;
                forceShowPopover(x, y, rect, { overrideSavedPosition: true });
              } else {
                hidePopover();
              }
            }
          }
        });
      }
      
      // 快捷键选择
      const shortcutSelect = settingsPanel.querySelector('.shortcut-select');
      if (shortcutSelect) {
        shortcutSelect.addEventListener('change', (e) => {
          settings.shortcutKey = e.target.value;
          saveSettings();
          showToast('快捷键已更改为: ' + settings.shortcutKey);
        });
      }
      
      // 模式选择
      const modeSelect = settingsPanel.querySelector('.mode-select');
      if (modeSelect) {
        modeSelect.value = settings.mode;
        modeSelect.addEventListener('change', (e) => {
          settings.mode = e.target.value;
          if (settings.mode === 'disabled') {
            if (confirm('禁用后需要在Chrome扩展管理页重新启用，确定要禁用吗？')) {
              saveSettings();
              hidePopover();
            } else {
              modeSelect.value = 'normal';
            }
          } else {
            saveSettings();
            createPopover(true); // 传入true保留selectedText和位置
            // 不需要调用showPopover，位置已经保持不变
          }
        });
      }

      // 透明度滑块
      const opacitySlider = settingsPanel.querySelector('.opacity-slider');
      const opacityValue = settingsPanel.querySelector('.opacity-value');
      if (opacitySlider) {
        opacitySlider.addEventListener('input', (e) => {
          settings.opacity = parseFloat(e.target.value);
          opacityValue.textContent = Math.round(settings.opacity * 100) + '%';
          popover.style.opacity = settings.opacity;
          saveSettings();
        });
      }

      // 黑名单按钮
      const blacklistBtn = settingsPanel.querySelector('.blacklist-toggle');
      if (blacklistBtn) {
        const currentHost = window.location.hostname;
        if (settings.blacklist.includes(currentHost)) {
          blacklistBtn.textContent = '移出黑名单';
          blacklistBtn.style.background = '#48bb78';
          blacklistBtn.style.borderColor = '#2f855a';
          blacklistBtn.style.color = '#ffffff';
        }
        
        blacklistBtn.addEventListener('click', () => {
          const index = settings.blacklist.indexOf(currentHost);
          if (index > -1) {
            settings.blacklist.splice(index, 1);
            blacklistBtn.textContent = '加入黑名单';
            // default style: light background with red text for clarity
            blacklistBtn.style.background = '#ffffff';
            blacklistBtn.style.borderColor = '#c53030';
            blacklistBtn.style.color = '#c53030';
            showToast('已移出黑名单');
          } else {
            settings.blacklist.push(currentHost);
            blacklistBtn.textContent = '移出黑名单';
            blacklistBtn.style.background = '#48bb78';
            blacklistBtn.style.borderColor = '#2f855a';
            blacklistBtn.style.color = '#ffffff';
            showToast('已加入黑名单');
          }
          saveSettings();
        });
      }
    }

    // 拖拽功能
    const header = shadowRoot.querySelector('.ccs-header');
    if (header) {
      if (settings.layout !== 'bottom') {
        header.addEventListener('mousedown', startDragging);
      }
    }
  }

  // 开始拖拽
  function startDragging(e) {
    if (e.target.tagName === 'BUTTON') return; // 点击按钮时不拖拽
    
    isDragging = true;
    const rect = popover.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    
    // 添加拖拽样式
    const header = shadowRoot.querySelector('.ccs-header');
    header.classList.add('dragging');
    
    // 防止拖拽时选中页面文本
    document.body.classList.add('ccs-dragging');
    document.body.style.userSelect = 'none';
    
    // 添加全局事件监听
    document.addEventListener('mousemove', handleDragging);
    document.addEventListener('mouseup', stopDragging);
    
    e.preventDefault();
    e.stopPropagation();
  }

  // 处理拖拽
  function handleDragging(e) {
    if (!isDragging) return;
    
    const x = e.clientX - dragOffset.x + window.scrollX;
    const y = e.clientY - dragOffset.y + window.scrollY;
    
    // 验证位置是否合理（避免拖到屏幕外）
    const validX = Math.max(0, Math.min(x, window.innerWidth - 100));
    const validY = Math.max(0, Math.min(y, window.innerHeight - 50));
    
    popover.style.left = `${validX}px`;
    popover.style.top = `${validY}px`;
    
    // 保存位置
    settings.position = { x: validX, y: validY };
  }

  // 停止拖拽
  function stopDragging() {
    if (!isDragging) return;
    
    isDragging = false;
    const header = shadowRoot.querySelector('.ccs-header');
    if (header) {
      header.classList.remove('dragging');
    }
    
    // 恢复页面文本选择
    document.body.classList.remove('ccs-dragging');
    document.body.style.userSelect = '';
    
    // 移除全局事件监听
    document.removeEventListener('mousemove', handleDragging);
    document.removeEventListener('mouseup', stopDragging);
    
    // 保存设置
    saveSettings();
  }

  // 清理拖拽状态（用于模式切换时）
  function cleanupDragState() {
    isDragging = false;
    dragOffset = { x: 0, y: 0 };
    // 移除可能残留的全局事件监听
    document.removeEventListener('mousemove', handleDragging);
    document.removeEventListener('mouseup', stopDragging);
    // 恢复页面文本选择
    document.body.classList.remove('ccs-dragging');
    document.body.style.userSelect = '';
  }

  // 切换设置面板
  function toggleSettings() {
    const panel = shadowRoot.querySelector('.ccs-settings-panel');
    if (panel) {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
  }

  // 执行命令
  function executeCommand() {
    const input = shadowRoot.querySelector('.ccs-input');
    const resultDiv = shadowRoot.querySelector('.ccs-result');
    const inputValue = input.value.trim();

    if (!inputValue) return;

    // 解析命令
    if (inputValue.startsWith('/')) {
      const parts = inputValue.slice(1).split(' ');
      const cmd = parts[0];
      const args = parts.slice(1);

      if (commands[cmd]) {
        const result = commands[cmd](args.length ? args : [selectedText]);
        resultDiv.textContent = result;
        resultDiv.style.display = 'block';
        
        // 自动复制结果
        navigator.clipboard.writeText(result);
        showToast('结果已复制到剪贴板');
      } else {
        resultDiv.textContent = `未知命令: ${cmd}`;
        resultDiv.style.display = 'block';
      }
    } else {
      // 如果不是命令，默认进行百度搜索
      window.open(`https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${encodeURIComponent(inputValue)}`, '_blank');
    }
  }

  // 更新所有按钮使用相同的文本值，确保alt text和action一致
  // 统一同步所有文本相关变量
  function syncAllTextVariables() {
    // 使用统一函数获取最新的文本（强制刷新，跳过缓存）
    const latestText = getUnifiedSearchText({ forceRefresh: true, skipCache: true });
    
    // 更新全局变量，确保后续使用时优先级一致
    selectedText = latestText || '';
    
    // 更新最近的非空选择（如果有新的选中文本）
    const currentSelection = getActiveSelectionText();
    if (currentSelection) {
      lastNonEmptySelection = currentSelection;
    }
    
    // 更新输入框（如果存在）
    if (shadowRoot) {
      const input = shadowRoot.querySelector('.ccs-input');
      if (input) {
        input.value = selectedText;
      }
    }
    
    // 更新所有按钮的文本和tooltip
    updateAllButtonsWithSameText(selectedText);
    
    // 返回同步后的文本
    return selectedText;
  }

  function updateAllButtonsWithSameText(text) {
    if (!shadowRoot) return;
    const buttons = shadowRoot.querySelectorAll('.ccs-button');
    buttons.forEach(button => {
      const btnTitle = button.dataset.btnTitle;
      if (btnTitle) {
        // 更新存储的文本值和tooltip
        button.dataset.searchText = text || '';
        button.title = text ? `${btnTitle}: ${text}` : btnTitle;
      }
    });
  }

  // 显示popover
  function showPopover(x, y, selectionRect = null, options = {}) {
    if (settings.mode === 'disabled') {
      console.log('[触触搜] showPopover 被禁用 (mode=disabled)');
      return;
    }
    
    console.log('[触触搜] showPopover 开始执行:', {x, y, selectedText, hasPopover: !!popover, hasSelectionRect: !!selectionRect});

    // 底部栏模式（仅普通模式）：若已存在且已是fixed定位，避免重建导致闪烁，仅更新提示与可见性
    if (settings.mode === 'normal' && settings.layout === 'bottom' && popover && shadowRoot && window.getComputedStyle(popover).position === 'fixed') {
      try {
        const current = getCurrentSearchText();
        // 使用统一的函数更新所有按钮，确保一致性
        updateAllButtonsWithSameText(current);
        // 确保可见
        popover.style.display = 'block';
        popover.style.visibility = 'visible';
        popover.style.opacity = settings.opacity || '1';
        console.log('[触触搜] 底部栏已存在，执行无闪烁更新');
      } catch (err) {
        console.warn('[触触搜] 底部栏更新失败，回退到重建:', err);
      }
      return;
    }
    
    // 如果popover已存在且不是底部栏模式，尝试只更新位置和内容而不重建
    if (popover && shadowRoot && settings.layout !== 'bottom') {
      console.log('[触触搜] Popover 已存在，尝试更新位置和内容');
      
      // 如果有选中文本，更新位置
      if (selectionRect) {
        const position = calculateSmartPosition(selectionRect, x, y);
        popover.style.position = 'absolute'; // 确保是absolute定位
        popover.style.left = `${position.x}px`;
        popover.style.top = `${position.y}px`;
        // 清除可能的fixed定位残留样式
        popover.style.right = '';
        popover.style.bottom = '';
        popover.style.width = '';
        // 确保pointer-events正确
        popover.style.pointerEvents = 'auto';
        // 保存新位置
        settings.position = position;
        console.log('[触触搜] 更新popover位置:', position);
      }
      
      // 更新标题和按钮提示
      try {
        const current = getCurrentSearchText();
        const titleEl = shadowRoot.querySelector('.ccs-title');
        if (titleEl) {
          titleEl.textContent = `🔍 触触搜: "${current}"`;
          titleEl.title = current;
        }
        // 使用统一的函数更新所有按钮
        updateAllButtonsWithSameText(current);
        // 确保可见
        popover.style.display = 'block';
        popover.style.visibility = 'visible';
        popover.style.opacity = settings.opacity || '1';
        console.log('[触触搜] 成功更新现有popover');
        return;
      } catch (err) {
        console.warn('[触触搜] 更新失败，将重建:', err);
      }
    }
    
    // 只有在真正需要时才移除并重建
    if (popover) {
      console.log('[触触搜] 需要重建 Popover');
      popover.remove();
      popover = null;
      shadowRoot = null;
    }
    
    createPopover();

    let position;
    const overrideSaved = options && options.overrideSavedPosition;
    console.log('[触触搜] showPopover 定位参数:', {
      incoming: { x, y },
      hasSelectionRect: !!selectionRect,
      overrideSaved,
      savedPosition: settings.position || null,
      scroll: { x: window.scrollX, y: window.scrollY }
    });
    // 底部栏布局（仅普通模式）：忽略保存的位置，强制使用fixed并贴底
    if (settings.mode === 'normal' && settings.layout === 'bottom') {
      console.log('[触触搜] 底部栏布局：忽略保存位置，使用 fixed 贴底');
      // 覆盖容器定位为fixed全宽
      popover.style.position = 'fixed';
      popover.style.left = '0';
      popover.style.right = '0';
      popover.style.bottom = '0';
      popover.style.top = 'auto';
      // 宽度全屏
      popover.style.width = '100%';
      // 允许点击穿透到底层页面
      popover.style.pointerEvents = 'none';
      // 贴底栏无需 left/top 位置计算
      position = { x: 0, y: window.innerHeight + window.scrollY };
    } else if (selectionRect) {
      // 如果有选中文本，始终使用智能定位（优先级最高）
      position = calculateSmartPosition(selectionRect, x, y);
      console.log('[触触搜] 使用智能定位计算的位置（基于选中文本）', position);
    } else if (settings.position && !overrideSaved) {
      // 没有选中文本时，如果有保存的位置且未强制覆盖，则使用保存的位置
      // 但需要验证位置是否合理
      const savedPos = settings.position;
      // 验证保存的位置是否合理（不要太靠边）
      const margin = 50;
      const maxX = window.innerWidth + window.scrollX - 100;
      const maxY = window.innerHeight + window.scrollY - 100;
      
      if (savedPos && typeof savedPos.x === 'number' && typeof savedPos.y === 'number' &&
          savedPos.x >= margin && savedPos.x <= maxX &&
          savedPos.y >= margin && savedPos.y <= maxY) {
        position = savedPos;
        console.log('[触触搜] 使用已保存的位置', position);
      } else {
        // 保存的位置无效，使用传入的位置或默认位置
        position = { x: x || window.innerWidth / 2, y: y || window.innerHeight / 3 };
        settings.position = null; // 清除无效位置
        console.log('[触触搜] 保存的位置无效，使用默认位置', position, '原保存位置:', savedPos);
      }
    } else {
      // 使用传入的位置
      position = { x, y };
      console.log('[触触搜] 使用传入的位置', position);
    }

    // 添加平滑过渡动画
    if (!popover.style.transition) {
      popover.style.transition = 'opacity 0.2s ease-in-out, transform 0.2s ease-in-out';
      popover.style.opacity = '0';
      popover.style.transform = 'scale(0.95)';
    }
    
    if (!(settings.mode === 'normal' && settings.layout === 'bottom')) {
      // 非底部栏（包括mini模式）：清理遗留fixed样式并按计算位置放置
      popover.style.position = 'absolute';
      popover.style.right = '';
      popover.style.bottom = '';
      popover.style.width = '';
      popover.style.left = `${position.x}px`;
      popover.style.top = `${position.y}px`;
      // 恢复正常点击 - mini模式和normal float模式都需要正常交互
      popover.style.pointerEvents = 'auto';
    }
    
    console.log('[触触搜] Popover 位置已设置:', {
      left: popover.style.left,
      top: popover.style.top,
      display: window.getComputedStyle(popover).display,
      visibility: window.getComputedStyle(popover).visibility,
      zIndex: window.getComputedStyle(popover).zIndex,
      opacity: window.getComputedStyle(popover).opacity
    });
    
    // 强制确保popover可见
    popover.style.display = 'block';
    popover.style.visibility = 'visible';
    
    // 触发动画
    requestAnimationFrame(() => {
      popover.style.opacity = settings.opacity || '1';
      popover.style.transform = 'scale(1)';
      
      // 再次检查状态
      setTimeout(() => {
        if (popover) {
          const rect = popover.getBoundingClientRect();
          const isVisible = rect.width > 0 && rect.height > 0;
          const computedStyle = window.getComputedStyle(popover);
          
          console.log('[触触搜] Popover 最终状态检查:', {
            isInDOM: document.body.contains(popover),
            boundingRect: {width: rect.width, height: rect.height, top: rect.top, left: rect.left},
            isVisible: isVisible,
            display: computedStyle.display,
            visibility: computedStyle.visibility,
            opacity: computedStyle.opacity,
            zIndex: computedStyle.zIndex,
            position: computedStyle.position
          });
          
          // 如果不可见，尝试修复
          if (!isVisible) {
            console.warn('[触触搜] Popover 不可见！尝试修复...');
            popover.style.zIndex = '2147483647';
            popover.style.position = 'fixed';
            popover.style.display = 'block';
            popover.style.visibility = 'visible';
            popover.style.opacity = '1';
          }
        }
      }, 100);
    });

    // === 智能建议功能暂时禁用 ===
    /*
    // 自动显示初始建议
    setTimeout(() => {
      const input = shadowRoot?.querySelector('.ccs-input');
      if (input && selectedText) {
        // 如果输入框为空，显示智能建议
        if (!input.value.trim()) {
          const event = new Event('input');
          input.dispatchEvent(event);
        }
      }
    }, 100);
    */

    // 移除自动聚焦，改为hover时聚焦
    // 保持用户选中的文本状态
  }

  // 隐藏popover
  function hidePopover() {
    if (popover) {
      // 添加淡出动画
      popover.style.opacity = '0';
      popover.style.transform = 'scale(0.95)';
      setTimeout(() => {
        if (popover) {
          popover.remove();
          popover = null;
          shadowRoot = null;
        }
      }, 200);
    }
    // 清空选中的文本和记录
    selectedText = '';
    lastSelectedText = '';
  }

  // 防抖定时器和上次选中的文本
  let selectionTimeout;
  let lastSelectedText = '';
  let lastSelectionTime = 0;
  
  // 监听选择变化，通知background更新菜单
  let lastNotifiedText = '';
  function notifySelectionChange() {
    const text = getActiveSelectionText();
    
    // 只在文本变化时通知
    if (text !== lastNotifiedText) {
      lastNotifiedText = text;
      // 安全地发送给background script更新菜单
      safeChromeSendMessage({
        action: 'selectionChanged',
        text: text
      });
    }

    // 若切换到弹出（浮动）模式后处于隐藏状态，且出现了有效选区，则自动显示 Popover
    try {
      if (!popover && settings.layout !== 'bottom' && text && text.trim().length > 0) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          let rect = range.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) {
            const rects = range.getClientRects();
            if (rects && rects.length > 0) rect = rects[0];
          }
          const centerX = rect.left + rect.width / 2 + window.scrollX;
          const bottomY = rect.bottom + window.scrollY;
          selectedText = text.trim();
          lastNonEmptySelection = selectedText;
          showPopover(centerX, bottomY, rect);
        }
      }
    } catch (_) {}

    // 若弹窗存在，则实时更新标题与按钮tooltip（使用统一函数）
    if (popover && shadowRoot) {
      // 如果有新的选中文本，则使用它，否则使用统一函数获取
      const current = text || getCurrentSearchText();
      if (current) {
        if (text) {
          // 如果是新选中的文本，更新记录
          selectedText = current;
          lastNonEmptySelection = current;
        }
        // 更新标题显示与title（无标题的布局会跳过）
        const titleEl = shadowRoot.querySelector('.ccs-title');
        if (titleEl) {
          titleEl.textContent = `🔍 触触搜: "${current}"`;
          titleEl.title = current;
        }
        // 使用统一的函数更新所有按钮，确保data属性和tooltip一致
        updateAllButtonsWithSameText(current);
      }
    }
  }
  
  // 监听选择变化事件
    document.addEventListener('selectionchange', () => {
      // 使用防抖避免频繁更新
      clearTimeout(window.selectionChangeTimeout);
      window.selectionChangeTimeout = setTimeout(notifySelectionChange, 100);
    });
  
  // 监听文本选择
  document.addEventListener('mouseup', (e) => {
    // 如果在拖拽中，不处理
    if (isDragging) return;
    
    // 如果点击在popover内部，不处理
    if (popover && popover.contains(e.target)) {
      return;
    }

    // 清除之前的定时器
    clearTimeout(selectionTimeout);
    
    // 使用防抖，避免频繁触发
    selectionTimeout = setTimeout(() => {
      // 如果是底部栏模式，不处理选择（底部栏常驻，只更新内容）
      if (settings.layout === 'bottom') {
        return;
      }
      
      const selection = window.getSelection();
      const text = selection.toString().trim();
      
      console.log('[触触搜] mouseup检测:', { 
        text: text || '无',
        hasSelection: text.length > 0
      });

      // 简单判断：有选中文本就显示，没有就隐藏
      if (text.length >= 1) {
        // 有选中文本
        const currentTime = Date.now();
        
        // 避免重复显示相同文本
        if (text === lastSelectedText && currentTime - lastSelectionTime < 500) {
          console.log('[触触搜] 重复选择，跳过');
          return;
        }
        
        console.log('[触触搜] 显示popover:', text);
        lastSelectedText = text;
        lastSelectionTime = currentTime;
        selectedText = text;
        lastNonEmptySelection = text;
        
        // 清除保存的位置
        settings.position = null;
          
        // 获取选中文本的位置
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          let rect = range.getBoundingClientRect();
          
          // 如果rect无效，尝试使用getClientRects()[0]
          if (rect.width === 0 || rect.height === 0) {
            const rects = range.getClientRects();
            if (rects && rects.length > 0) {
              rect = rects[0];
            }
          }
          
          // 计算位置
          const centerX = rect.left + rect.width / 2 + window.scrollX;
          const bottomY = rect.bottom + window.scrollY;
          
          // 显示popover
          showPopover(centerX, bottomY, rect);
        }
      } else {
        // 没有选中文本 - 简单地隐藏popover
        console.log('[触触搜] 无选中，隐藏popover');
        selectedText = '';
        if (popover) {
          hidePopover();
        }
      }
    }, 250); // 增加到250ms防抖延迟，确保单击时选区稳定
  });

  // 点击其他地方隐藏popover
  document.addEventListener('mousedown', (e) => {
    if (popover && !popover.contains(e.target)) {
      const selection = window.getSelection();
      const text = selection.toString().trim();
      if (text.length === 0 && settings.layout !== 'bottom') {
        hidePopover();
      }
    }
  });

  // 调试模式开关（默认开启，便于排查问题；可在设置或控制台调整）
  window.CCS_DEBUG = true;
  
  // 解析快捷键字符串并检查是否匹配当前按键
  function matchesShortcut(e, shortcutStr) {
    const parts = shortcutStr.toLowerCase().split('+');
    const key = parts[parts.length - 1];
    const modifiers = parts.slice(0, -1);
    
    // 检查按键是否匹配
    if (e.key.toLowerCase() !== key.toLowerCase()) {
      return false;
    }
    
    // 检查修饰键
    const hasCtrl = modifiers.includes('ctrl') || modifiers.includes('control');
    const hasAlt = modifiers.includes('alt');
    const hasShift = modifiers.includes('shift');
    const hasMeta = modifiers.includes('meta') || modifiers.includes('cmd') || modifiers.includes('command');
    
    return e.ctrlKey === hasCtrl && 
           e.altKey === hasAlt && 
           e.shiftKey === hasShift && 
           e.metaKey === hasMeta;
  }

  // 处理快捷键的统一函数
  function handleSearchShortcut(e) {
    // 调试：记录所有按键事件
    if (window.CCS_DEBUG && (e.ctrlKey || e.altKey || e.shiftKey)) {
      console.log('[触触搜] 键盘事件:', {
        key: e.key,
        keyCode: e.keyCode,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        target: e.target.tagName,
        targetId: e.target.id,
        targetClass: e.target.className,
        eventPhase: e.eventPhase === 1 ? '捕获' : e.eventPhase === 2 ? '目标' : '冒泡',
        currentTarget: e.currentTarget === document ? 'document' : e.currentTarget === window ? 'window' : 'body'
      });
    }
    
    // 检查自定义快捷键（默认Alt+S）
    const isCustomShortcut = matchesShortcut(e, settings.shortcutKey || 'Alt+S');
    // 检查备用快捷键（兼容旧版本）
    const isLegacyShortcut = matchesShortcut(e, 'Ctrl+Shift+S');

    // 自定义快捷键: 切换面板
    if (isCustomShortcut) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      console.log('[触触搜] 快捷键触发: ' + (settings.shortcutKey || 'Alt+S'));
      
      // 新的切换逻辑：
      if (popover) {
        // 面板存在，检查是否可见
        const computedStyle = window.getComputedStyle(popover);
        const isVisible = popover.style.display !== 'none' && computedStyle.display !== 'none';
        
        if (isVisible) {
          // 如果可见，隐藏它（但不删除）
          console.log('[触触搜] 隐藏面板');
          popover.style.display = 'none';
          // 同时更新设置，记住面板被关闭了
          settings.barClosed = true;
          saveSettings();
        } else {
          // 如果不可见，显示它
          console.log('[触触搜] 显示已存在的面板');
          popover.style.display = 'block';
          popover.style.opacity = '1';
          popover.style.transform = 'scale(1)';
          // 更新设置，记住面板被打开了
          settings.barClosed = false;
          saveSettings();
          
          // 同步所有文本变量，确保一致性
          const syncedText = syncAllTextVariables();
          console.log('[触触搜] 文本同步完成:', syncedText || '(空)');
        }
      } else {
        // 面板不存在，创建并显示底部栏
        console.log('[触触搜] 创建新的底部栏面板');
        
        // 获取选中的文本（如果有）
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0 && selection.toString().trim()) {
          selectedText = selection.toString().trim();
        } else {
          // 没有选中文本时，使用空字符串或默认文本
          selectedText = '';
        }
        
        // 设置为底部栏模式
        settings.layout = 'bottom';
        settings.globalDock = true;
        settings.barClosed = false;
        settings.mode = 'normal';
        saveSettings();
        
        // 创建并显示面板
        createPopover(true);
        const x = window.innerWidth / 2 + window.scrollX;
        const y = window.innerHeight / 3 + window.scrollY;
        forceShowPopover(x, y, null, { overrideSavedPosition: true });
        
        // 启动实时更新
        scheduleRealtimeUpdate();
      }
      
      return false;
    }

    // 将显示浮动搜索框的逻辑提取为函数，便于复用
    const showFromShortcut = () => {
      console.log('[触触搜] 准备显示 Popover');
      const t0 = performance.now();
      getSmartSearchTextAsync().then((smartText) => {
        console.log('[触触搜] 获取到的文本:', smartText || '(无内容)');
        if (window.CCS_DEBUG) console.log('[触触搜][DEBUG] keyword resolve latency(ms):', Math.round(performance.now() - t0));
        if (smartText) {
          selectedText = smartText; // 设置全局变量

          // 确定显示位置
          let x, y, selectionRect = null;
          const selection = window.getSelection();
          
          // 如果有选中区域，使用选中区域位置
          if (selection.rangeCount > 0 && selection.toString().trim()) {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            x = rect.left + rect.width / 2 + window.scrollX;
            y = rect.bottom + window.scrollY;
            selectionRect = rect;
            console.log('[触触搜] 使用选中区域位置:', {x, y, rect});
          } else {
            // 否则显示在屏幕中央偏上（加入滚动补偿，使用文档坐标）
            x = window.innerWidth / 2 + window.scrollX;
            y = window.innerHeight / 3 + window.scrollY;
            console.log('[触触搜] 使用屏幕中央位置:', {x, y});
          }

          console.log('[触触搜] 准备调用 forceShowPopover...');
          try {
            forceShowPopover(x, y, selectionRect);
            console.log('[触触搜] forceShowPopover 调用成功');
          } catch (err) {
            console.error('[触触搜] forceShowPopover 调用失败:', err);
          }
        } else {
          console.log('[触触搜] 没有找到可搜索的内容');
          showToast('没有找到可搜索的内容');
        }
      });
    };

    // 备用快捷键（向后兼容）
    if (isLegacyShortcut && !isCustomShortcut) {
      console.log('[触触搜] ✅ 快捷键触发! Ctrl+Shift+S (备用)');
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      // 执行与主快捷键相同的切换逻辑
      if (popover) {
        // 面板存在，检查是否可见
        const computedStyle = window.getComputedStyle(popover);
        const isVisible = popover.style.display !== 'none' && computedStyle.display !== 'none';
        
        if (isVisible) {
          // 如果可见，隐藏它（但不删除）
          console.log('[触触搜] 隐藏面板');
          popover.style.display = 'none';
          // 同时更新设置，记住面板被关闭了
          settings.barClosed = true;
          saveSettings();
        } else {
          // 如果不可见，显示它
          console.log('[触触搜] 显示已存在的面板');
          popover.style.display = 'block';
          popover.style.opacity = '1';
          popover.style.transform = 'scale(1)';
          // 更新设置，记住面板被打开了
          settings.barClosed = false;
          saveSettings();
          
          // 同步所有文本变量，确保一致性
          const syncedText = syncAllTextVariables();
          console.log('[触触搜] 文本同步完成:', syncedText || '(空)');
        }
      } else {
        // 面板不存在，创建并显示底部栏
        console.log('[触触搜] 创建新的底部栏面板');
        
        // 获取选中的文本（如果有）
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0 && selection.toString().trim()) {
          selectedText = selection.toString().trim();
        } else {
          // 没有选中文本时，使用空字符串或默认文本
          selectedText = '';
        }
        
        // 设置为底部栏模式
        settings.layout = 'bottom';
        settings.globalDock = true;
        settings.barClosed = false;
        settings.mode = 'normal';
        saveSettings();
        
        // 创建并显示面板
        createPopover(true);
        const x = window.innerWidth / 2 + window.scrollX;
        const y = window.innerHeight / 3 + window.scrollY;
        forceShowPopover(x, y, null, { overrideSavedPosition: true });
        
        // 启动实时更新
        scheduleRealtimeUpdate();
      }
      
      return false;
    }
    
    // ESC键隐藏popover
    if (e.key === 'Escape') {
      hidePopover();
    }
  }

  // 在捕获阶段监听键盘事件（优先级更高）
  document.addEventListener('keydown', handleSearchShortcut, true);
  console.log('[触触搜] 已注册 document 键盘监听器（捕获阶段）');
  
  // 同时在window上监听作为备份
  window.addEventListener('keydown', handleSearchShortcut, true);
  console.log('[触触搜] 已注册 window 键盘监听器（捕获阶段）');
  
  // 延迟添加body监听器，确保body已加载
  if (document.body) {
    document.body.addEventListener('keydown', handleSearchShortcut, true);
    console.log('[触触搜] 已注册 body 键盘监听器（捕获阶段）');
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.body) {
        document.body.addEventListener('keydown', handleSearchShortcut, true);
        console.log('[触触搜] DOMContentLoaded后：已注册 body 键盘监听器（捕获阶段）');
      }
    });
  }
  
  // 定期检查popover状态（调试用，顶层窗口 + 节流）
  let lastInvisibleWarnTs = 0;
  let invisibleWarnCount = 0;
  if (window.top === window.self && window.CCS_DEBUG) {
    setInterval(() => {
      try {
        if (popover && document.body.contains(popover)) {
          const rect = popover.getBoundingClientRect();
          const style = window.getComputedStyle(popover);
          const invisible = rect.width === 0 || rect.height === 0 || style.display === 'none' || style.visibility === 'hidden';
          if (invisible) {
            invisibleWarnCount++;
            const now = Date.now();
            // 仅每30秒输出一次汇总，避免刷屏
            if (now - lastInvisibleWarnTs > 30000) {
              lastInvisibleWarnTs = now;
              console.debug('[触触搜][DEBUG] Popover 存在但不可见', {
                countSinceLast: invisibleWarnCount,
                width: rect.width,
                height: rect.height,
                display: style.display,
                visibility: style.visibility,
                opacity: style.opacity
              });
              invisibleWarnCount = 0;
            }
            // 自愈：若为底部栏应当可见，尝试恢复
            if (settings.mode === 'normal' && settings.layout === 'bottom') {
              ensureBottomBarVisible(false);
            }
          }
        }
      } catch (_) {}
    }, 3000);
  }

  // 右键菜单处理 - 不再阻止默认菜单
  document.addEventListener('contextmenu', (e) => {
    // 普通右键时，隐藏popup让右键菜单接管
    if (!e.altKey && !e.shiftKey) {
      // 如果有选中文本，隐藏popup让右键菜单处理
      const selection = window.getSelection();
      const text = selection.toString().trim();
      if ((text.length > 0 || popover) && settings.layout !== 'bottom') {
        hidePopover();
      }
      return; // 保留默认右键菜单
    }
    
    // Alt+右键或Shift+右键时才触发插件功能
    
    // 如果当前网站在黑名单中，显示恢复选项
    if (settings.isBlacklisted) {
      e.preventDefault();
      showRecoveryPopover(e.clientX + window.scrollX, e.clientY + window.scrollY);
      return false;
    }
    
    // 如果有选中文本，触发popover
    const selection = window.getSelection();
    const text = selection.toString().trim();
    if (text.length > 0 && settings.mode !== 'disabled') {
      e.preventDefault();
      selectedText = text;
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      showPopover(e.clientX + window.scrollX, e.clientY + window.scrollY, rect);
      return false;
    }
  });

  // 显示恢复popover（黑名单网站专用）
  function showRecoveryPopover(x, y) {
    // 移除旧的popover
    if (popover) {
      popover.remove();
    }

    // 创建容器
    popover = document.createElement('div');
    popover.id = 'ccs-popover-container';
    popover.style.position = 'absolute';
    popover.style.zIndex = '2147483647';
    popover.style.left = `${x}px`;
    popover.style.top = `${y}px`;

    // 创建shadow DOM
    shadowRoot = popover.attachShadow({ mode: 'open' });

    // 创建恢复界面HTML
    const wrapper = document.createElement('div');
    wrapper.className = 'ccs-recovery-popover';
    wrapper.innerHTML = `
      <div class="ccs-header recovery">
        <span class="ccs-title">🔍 触触搜 - 已禁用</span>
        <button class="ccs-close">✕</button>
      </div>
      <div class="ccs-recovery-content">
        <div class="ccs-message">
          <span class="icon">🚫</span>
          <p>当前网站 <strong>${window.location.hostname}</strong> 在黑名单中</p>
        </div>
        <div class="ccs-recovery-actions">
          <button class="ccs-remove-blacklist">移出黑名单并启用</button>
          <button class="ccs-temp-enable">临时启用（本次）</button>
        </div>
        <div class="ccs-recovery-tips">
          💡 提示：<kbd>Alt+S</kbd> 或 <kbd>Alt+右键</kbd> 快速唤起
        </div>
      </div>
    `;

    // 添加恢复popover的样式
    const style = document.createElement('style');
    style.textContent = `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      
      .ccs-recovery-popover {
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        width: 280px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        font-size: 14px;
        color: #333;
        overflow: hidden;
        animation: fadeIn 0.2s ease-out;
      }

      @keyframes fadeIn {
        from { opacity: 0; transform: scale(0.95); }
        to { opacity: 1; transform: scale(1); }
      }

      .ccs-header.recovery {
        background: linear-gradient(135deg, #f56565 0%, #c53030 100%);
        color: white;
        padding: 10px 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .ccs-title {
        font-weight: bold;
        font-size: 14px;
      }

      .ccs-close {
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        font-size: 16px;
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: background-color 0.2s;
      }

      .ccs-close:hover {
        background-color: rgba(255,255,255,0.2);
      }

      .ccs-recovery-content {
        padding: 15px;
      }

      .ccs-message {
        text-align: center;
        margin-bottom: 15px;
      }

      .ccs-message .icon {
        font-size: 32px;
        display: block;
        margin-bottom: 8px;
      }

      .ccs-message p {
        font-size: 13px;
        color: #4a5568;
      }

      .ccs-message strong {
        color: #2d3748;
      }

      .ccs-recovery-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 12px;
      }

      .ccs-recovery-actions button {
        padding: 8px 12px;
        border: none;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .ccs-remove-blacklist {
        background: #48bb78;
        color: white;
      }

      .ccs-remove-blacklist:hover {
        background: #38a169;
      }

      .ccs-temp-enable {
        background: #f7fafc;
        color: #4a5568;
        border: 1px solid #e2e8f0;
      }

      .ccs-temp-enable:hover {
        background: #edf2f7;
        border-color: #cbd5e0;
      }

      .ccs-recovery-tips {
        font-size: 11px;
        color: #718096;
        text-align: center;
        padding-top: 10px;
        border-top: 1px solid #e2e8f0;
      }

      kbd {
        background: #f7fafc;
        border: 1px solid #e2e8f0;
        border-radius: 3px;
        padding: 2px 4px;
        font-family: monospace;
        font-size: 10px;
      }
    `;

    shadowRoot.appendChild(style);
    shadowRoot.appendChild(wrapper);

    // 绑定事件
    shadowRoot.querySelector('.ccs-close').addEventListener('click', hidePopover);
    
    shadowRoot.querySelector('.ccs-remove-blacklist').addEventListener('click', () => {
      const currentHost = window.location.hostname;
      const index = settings.blacklist.indexOf(currentHost);
      if (index > -1) {
        settings.blacklist.splice(index, 1);
        settings.isBlacklisted = false;
        settings.mode = settings.originalMode || 'normal';
        saveSettings();
        showToast('已移出黑名单，插件已启用');
        // 关闭恢复界面，显示正常popover
        hidePopover();
        setTimeout(() => {
          createPopover();
          showPopover(x, y);
        }, 300);
      }
    });

    shadowRoot.querySelector('.ccs-temp-enable').addEventListener('click', () => {
      settings.mode = 'normal';
      // 不保存，只是临时启用
      hidePopover();
      setTimeout(() => {
        createPopover();
        showPopover(x, y);
      }, 300);
    });

    document.body.appendChild(popover);
  }

  // 从搜索引擎页面提取关键词（与 background.js 规则对齐）
  function extractSearchKeyword() {
    try {
      const hostname = window.location.hostname;
      const params = new URLSearchParams(window.location.search);

      // 百度
      if (hostname.includes('baidu.com')) {
        const wd = params.get('wd') || params.get('word') || params.get('kw');
        if (wd) return decodeURIComponent(wd);
      }

      // Google（各国域名）
      if (hostname.includes('google.')) {
        const q = params.get('q');
        if (q) return decodeURIComponent(q);
      }

      // Bing
      if (hostname.includes('bing.com') || hostname.includes('cn.bing.com')) {
        const q = params.get('q');
        if (q) return decodeURIComponent(q);
      }

      // 搜狗
      if (hostname.includes('sogou.com')) {
        const query = params.get('query') || params.get('keyword');
        if (query) return decodeURIComponent(query);
      }

      // 360搜索
      if (hostname.includes('so.com') || hostname.includes('360.cn')) {
        const q = params.get('q');
        if (q) return decodeURIComponent(q);
      }

      // 神马
      if (hostname.includes('m.sm.cn') || hostname.includes('sm.cn')) {
        const q = params.get('q');
        if (q) return decodeURIComponent(q);
      }

      // 头条
      if (hostname.includes('toutiao.com')) {
        const keyword = params.get('keyword');
        if (keyword) return decodeURIComponent(keyword);
      }

      // DuckDuckGo
      if (hostname.includes('duckduckgo.com')) {
        const q = params.get('q');
        if (q) return decodeURIComponent(q);
      }

      // Yahoo
      if (hostname.includes('yahoo.com') || hostname.includes('yahoo.co.jp')) {
        const p = params.get('p');
        if (p) return decodeURIComponent(p);
      }

      // Yandex
      if (hostname.includes('yandex.')) {
        const text = params.get('text');
        if (text) return decodeURIComponent(text);
      }

      // Startpage
      if (hostname.includes('startpage.com')) {
        const query = params.get('query');
        if (query) return decodeURIComponent(query);
      }

      // 知乎
      if (hostname.includes('zhihu.com')) {
        const q = params.get('q');
        if (q) return decodeURIComponent(q);
      }

      // 微博
      if (hostname.includes('weibo.com') || hostname.includes('weibo.cn')) {
        const q = params.get('q');
        if (q) return decodeURIComponent(q);
      }

      // GitHub
      if (hostname.includes('github.com')) {
        const q = params.get('q');
        if (q) return decodeURIComponent(q);
      }

      // B站
      if (hostname.includes('bilibili.com')) {
        const keyword = params.get('keyword');
        if (keyword) return decodeURIComponent(keyword);
      }

      // 淘宝/天猫
      if (hostname.includes('taobao.com') || hostname.includes('tmall.com')) {
        const q = params.get('q') || params.get('keyword');
        if (q) return decodeURIComponent(q);
      }

      // 京东
      if (hostname.includes('jd.com')) {
        const keyword = params.get('keyword');
        if (keyword) return decodeURIComponent(keyword);
      }
    } catch (e) {
      // 忽略错误，返回空
    }
    return null;
  }

  // 【统一的文本获取函数】- 所有地方都应该使用这个函数
  // 统一优先级：1.选中文本 > 2.URL关键词 > 3.页面标题
  function getUnifiedSearchText(options = {}) {
    const { skipCache = false, forceRefresh = false } = options;
    
    // 优先级1: 实时选中的文本（最高优先）
    const selected = getActiveSelectionText();
    if (selected) {
      return selected;
    }
    
    // 优先级2: 缓存的选中文本（如果不跳过缓存）
    if (!skipCache && !forceRefresh) {
      if (lastNonEmptySelection) return lastNonEmptySelection;
      if (selectedText) return selectedText;
    }
    
    // 优先级3: URL中的搜索关键词（比如百度、Google的搜索词）
    const searchKeyword = extractSearchKeyword();
    if (searchKeyword) {
      return searchKeyword;
    }
    
    // 优先级4: 页面标题（最低优先级）
    const title = document.title;
    if (title) {
      return title.trim();
    }
    
    return '';
  }

  // 智能获取要搜索的内容（同步版本，尽量本地推断）
  function getSmartSearchText(skipCache = false) {
    // 直接调用统一函数
    return getUnifiedSearchText({ skipCache });
  }

  // 统一的获取当前搜索文本函数，确保按钮提示和实际搜索内容一致
  function getCurrentSearchText(forceRefresh = false) {
    // 直接调用统一函数，传递forceRefresh参数
    return getUnifiedSearchText({ forceRefresh, skipCache: forceRefresh });
  }

  // 向background请求关键词（与右键提取一致）
  function requestKeywordsFromBackground() {
    return new Promise((resolve) => {
      try {
        if (!(chrome.runtime && chrome.runtime.id)) {
          resolve(null);
          return;
        }
        const reqId = ++DEBUG_REQUEST_ID;
        if (window.CCS_DEBUG) {
          console.log('[触触搜][DEBUG] requestKeywordsFromBackground start', { reqId, url: window.location.href, title: document.title });
        }
        let settled = false;
        const payload = {
          action: 'extractKeywords',
          url: window.location.href,
          title: document.title || ''
        };
        chrome.runtime.sendMessage(payload, (response) => {
          settled = true;
          if (window.CCS_DEBUG) console.log('[触触搜][DEBUG] background response', { reqId, response });
          if (response && response.keywords) {
            resolve(response.keywords);
          } else {
            resolve(null);
          }
        });
        setTimeout(() => {
          if (!settled) {
            if (window.CCS_DEBUG) console.warn('[触触搜][DEBUG] background response timeout', { reqId });
            resolve(null);
          }
        }, 1200);
      } catch (_) {
        resolve(null);
      }
    });
  }

  // 智能获取要搜索的内容（优先使用右键同源的background提取）
  async function getSmartSearchTextAsync() {
    // 1) 优先选中文本
    const selected = getActiveSelectionText();
    if (selected) return selected;
    if (lastNonEmptySelection) return lastNonEmptySelection;

    // 2) 尝试与右键一致的 background 提取
    const fromBg = await requestKeywordsFromBackground();
    if (fromBg) return fromBg;

    // 3) 回退到本地URL解析
    const local = extractSearchKeyword();
    if (local) return local;

    // 4) 最后回退到页面标题（保留全文）
    const title = document.title || '';
    if (title) {
      return title.trim();
    }
    return '';
  }
  // 实时页面文本（Hover/无选中时用）- 使用统一函数确保优先级一致
  function getRealtimePageTextPreferTitle() {
    // 使用统一函数，强制刷新以获取最新值
    return getUnifiedSearchText({ forceRefresh: true, skipCache: true });
  }

  // 强制显示popover（快捷键/统一入口）
  // 可选传入 selectionRect 以便与右键触发保持一致的智能定位
  function forceShowPopover(x, y, selectionRect = null, options = {}) {
    console.log('[触触搜] forceShowPopover 被调用:', {x, y, hasSelectionRect: !!selectionRect, isBlacklisted: settings.isBlacklisted});
    
    if (settings.isBlacklisted) {
      console.log('[触触搜] 网站在黑名单中，显示恢复界面');
      showRecoveryPopover(x + window.scrollX, y + window.scrollY);
    } else {
      console.log('[触触搜] 准备显示popover');
      try {
        // 传递 selectionRect 以复用与右键一致的智能定位
        showPopover(x, y, selectionRect, options);
        console.log('[触触搜] showPopover 完成');
      } catch (err) {
        console.error('[触触搜] 显示popover时出错:', err);
      }
    }
  }

  // 修复Extension context invalidated错误
  function safeChromeSendMessage(message) {
    try {
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage(message);
      }
    } catch (err) {
      console.warn('[触触搜] Chrome runtime 不可用:', err.message);
    }
  }

  // 监听来自popup和background的消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateDebug') {
      window.CCS_DEBUG = !!request.enabled;
      try { showToast(window.CCS_DEBUG ? '调试已开启' : '调试已关闭'); } catch (_) {}
      chrome.storage.local.set({ ccs_debug: window.CCS_DEBUG });
    }
    if (request.action === 'toggleExtension') {
      settings.mode = request.enabled ? 'normal' : 'disabled';
      saveSettings();
      if (!request.enabled) {
        hidePopover();
      }
    }
    // 处理黑名单更新
    if (request.action === 'updateBlacklist') {
      settings.blacklist = request.blacklist;
      checkBlacklist();
      saveSettings();
      if (settings.isBlacklisted) {
        hidePopover();
      }
    }
    // 处理快捷键更新
    if (request.action === 'updateShortcut') {
      settings.shortcutKey = request.shortcutKey;
      saveSettings();
      try { showToast('快捷键已更新为: ' + settings.shortcutKey); } catch (_) {}
    }
    // 处理右键菜单复制文本
    if (request.action === 'copyText') {
      navigator.clipboard.writeText(request.text).then(() => {
        showContextMenuToast('已复制到剪贴板');
      });
    }
    // 处理右键菜单命令
    if (request.action === 'processCommand') {
      let result;
      switch (request.command) {
        case 'base64':
          result = btoa(unescape(encodeURIComponent(request.text)));
          break;
        case 'md5':
          // 与弹窗按钮一致，使用相同的md5逻辑
          result = commands.md5([request.text]);
          break;
        case 'url-encode':
          result = encodeURIComponent(request.text);
          break;
        case 'upper':
          result = request.text.toUpperCase();
          break;
        case 'lower':
          result = request.text.toLowerCase();
          break;
      }
      if (result) {
        navigator.clipboard.writeText(result).then(() => {
          showContextMenuToast(`处理完成并已复制: ${result.substring(0, 50)}${result.length > 50 ? '...' : ''}`);
        });
      }
    }
    // 处理显示popover请求
    if (request.action === 'showPopover') {
      // 若未传入文本，使用统一函数获取
      selectedText = request.text || getCurrentSearchText();
      // 获取当前选中区域位置
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        showPopover(rect.left + window.scrollX, rect.bottom + window.scrollY, rect);
      } else {
        // 如果没有选中区域，显示在屏幕中央
        const x = window.innerWidth / 2 + window.scrollX;
        const y = window.innerHeight / 2 + window.scrollY;
        showPopover(x, y);
      }
    }
    // 处理显示Toast提示
    if (request.action === 'showToast') {
      showContextMenuToast(request.message);
    }
  });

  // 显示右键菜单操作的Toast提示
  function showContextMenuToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 20px;
      border-radius: 6px;
      font-size: 14px;
      z-index: 2147483647;
      animation: slideIn 0.3s ease-out;
    `;
    toast.textContent = message;
    
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateX(20px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'slideIn 0.3s ease-out reverse';
      setTimeout(() => {
        toast.remove();
        style.remove();
      }, 300);
    }, 3000);
  }
})();
