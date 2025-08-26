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
    miniButtons: ['baidu', 'google', 'chuchusou', 'copy', 'lowercase'] // Mini模式默认按钮，包含大小写与搜索
  };
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };

  // 初始化：加载用户设置 + 调试开关
  chrome.storage.local.get(['ccs_settings', 'ccs_debug'], (result) => {
    if (result.ccs_settings) {
      settings = { ...settings, ...result.ccs_settings };
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
    try {
      if (settings.globalDock && settings.mode === 'normal' && !settings.isBlacklisted && !settings.barClosed) {
        settings.layout = 'bottom';
        // 立即持久化布局选择
        chrome.storage.local.set({ ccs_settings: settings });
        // 异步创建并显示，确保DOM已就绪
        setTimeout(() => {
          try {
            ensureBottomBarVisible(true);
          } catch (e) { console.warn('[触触搜] 全局悬停模式自动显示失败:', e); }
        }, 0);
      }
    } catch (_) {}
  });

  // 确保底部栏存在与可见（用于全局模式与SPA页面）
  function ensureBottomBarVisible(force = false) {
    try {
      if (settings.globalDock && !settings.barClosed && settings.mode === 'normal' && !settings.isBlacklisted) {
        if (force || !popover || !document.body.contains(popover)) {
          createPopover();
          const x = window.innerWidth / 2 + window.scrollX;
          const y = window.innerHeight / 3 + window.scrollY;
          forceShowPopover(x, y, null, { overrideSavedPosition: true });
          console.log('[触触搜] ensureBottomBarVisible: created/shown');
        } else {
          // 确保固定在底部
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
          } catch(_) {}
        }
      }
    } catch (e) {
      console.warn('[触触搜] ensureBottomBarVisible error:', e);
    }
  }

  // 监听DOM变化，若底部栏应显示且被移除则重建
  const ccsObserver = new MutationObserver(() => {
    ensureBottomBarVisible(false);
  });
  try {
    ccsObserver.observe(document.documentElement || document.body, { childList: true, subtree: true });
  } catch (_) {}
  window.addEventListener('pageshow', () => ensureBottomBarVisible(false));
  window.addEventListener('popstate', () => ensureBottomBarVisible(false));
  window.addEventListener('hashchange', () => ensureBottomBarVisible(false));

  // 检查当前网站是否在黑名单中
  function checkBlacklist() {
    const currentHost = window.location.hostname;
    if (settings.blacklist.includes(currentHost)) {
      // 不直接禁用，而是标记为黑名单状态
      settings.isBlacklisted = true;
      // 保持原始模式，以便恢复后使用
      settings.originalMode = settings.mode || 'normal';
      settings.mode = 'disabled';
    } else {
      settings.isBlacklisted = false;
    }
  }

  // 保存设置
  function saveSettings() {
    chrome.storage.local.set({ ccs_settings: settings });
  }

  // 智能文本类型检测
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
      window.open(`https://www.baidu.com/s?wd=${encodeURIComponent(query)}`, '_blank');
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
        window.open(`https://www.baidu.com/s?wd=${encodeURIComponent(text)}`, '_blank');
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

  // 智能定位算法
  function calculateSmartPosition(selectionRect, mouseX, mouseY) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    
    // 根据模式调整尺寸
    // Mini模式宽度根据按钮数量自适应：每个按钮约44px + 间距6px + padding 20px
    const miniButtonCount = settings.miniButtons.length;
    const popoverWidth = settings.mode === 'mini' ? 
      (miniButtonCount * 50 + 20) : 320;
    const popoverHeight = settings.mode === 'mini' ? 120 : 400;
    
    // 使用传入的鼠标位置（已经是选中文本底部中心）
    const anchorX = mouseX;
    const anchorY = mouseY;
    
    // 检查是否在输入框内选中文本
    const activeElement = document.activeElement;
    const isInInputField = activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.contentEditable === 'true'
    );
    
    // 定义偏移量，输入框内选中时增加偏移
    const offset = isInInputField ? 28 : 24;
    
    // 尝试不同的位置
    // 输入框内选中时，优先显示在上方或下方，避免遮挡
    let positions;
    if (isInInputField) {
      positions = [
        { // 下方居中（优先）
          x: anchorX - popoverWidth / 2,
          y: anchorY + offset,
          arrow: 'top'
        },
        { // 上方居中
          x: anchorX - popoverWidth / 2,
          y: selectionRect.top + scrollY - popoverHeight - offset,
          arrow: 'bottom'
        },
        { // 右下
          x: selectionRect.right + scrollX + offset,
          y: selectionRect.bottom + scrollY + offset,
          arrow: 'top-left'
        },
        { // 右上
          x: selectionRect.right + scrollX + offset,
          y: selectionRect.top + scrollY - popoverHeight - offset,
          arrow: 'bottom-left'
        },
        { // 左下
          x: selectionRect.left + scrollX - popoverWidth - offset,
          y: selectionRect.bottom + scrollY + offset,
          arrow: 'top-right'
        },
        { // 左上
          x: selectionRect.left + scrollX - popoverWidth - offset,
          y: selectionRect.top + scrollY - popoverHeight - offset,
          arrow: 'bottom-right'
        }
      ];
    } else {
      // 普通文本选中，优先在选中文本下方
      positions = [
        { // 下方居中（优先）
          x: anchorX - popoverWidth / 2,
          y: anchorY + offset,
          arrow: 'top'
        },
        { // 右下
          x: selectionRect.right + scrollX + offset,
          y: anchorY + offset,
          arrow: 'top-left'
        },
        { // 左下
          x: selectionRect.left + scrollX - popoverWidth - offset,
          y: anchorY + offset,
          arrow: 'top-right'
        },
        { // 上方居中
          x: anchorX - popoverWidth / 2,
          y: selectionRect.top + scrollY - popoverHeight - offset,
          arrow: 'bottom'
        },
        { // 右上
          x: selectionRect.right + scrollX + offset,
          y: selectionRect.top + scrollY - popoverHeight - offset,
          arrow: 'bottom-left'
        },
        { // 左上
          x: selectionRect.left + scrollX - popoverWidth - offset,
          y: selectionRect.top + scrollY - popoverHeight - offset,
          arrow: 'bottom-right'
        }
      ];
    }
    
    // 找到第一个完全在视窗内且不覆盖选区的位置
    for (const pos of positions) {
      const left = pos.x - scrollX;
      const top = pos.y - scrollY;
      const right = left + popoverWidth;
      const bottom = top + popoverHeight;
      const inViewport =
        left >= 0 &&
        top >= 0 &&
        right <= viewportWidth &&
        bottom <= viewportHeight;
      // 判断与选区是否重叠（加入6px安全边距）
      const pad = 6;
      const overlap =
        right > (selectionRect.left - pad) &&
        left < (selectionRect.right + pad) &&
        bottom > (selectionRect.top - pad) &&
        top < (selectionRect.bottom + pad);
      if (inViewport && !overlap) {
        return pos;
      }
    }
    // 次优：允许覆盖选区，但必须在视窗内
    for (const pos of positions) {
      const left = pos.x - scrollX;
      const top = pos.y - scrollY;
      const right = left + popoverWidth;
      const bottom = top + popoverHeight;
      const inViewport =
        left >= 0 &&
        top >= 0 &&
        right <= viewportWidth &&
        bottom <= viewportHeight;
      if (inViewport) return pos;
    }
    
    // 如果没有完全合适的位置，使用锚点位置附近
    let finalX = anchorX - popoverWidth / 2;
    let finalY = anchorY + offset;
    
    // 确保不超出视窗
    if (finalX + popoverWidth > scrollX + viewportWidth) {
      finalX = scrollX + viewportWidth - popoverWidth - offset;
    }
    if (finalY + popoverHeight > scrollY + viewportHeight) {
      finalY = scrollY + viewportHeight - popoverHeight - offset;
    }
    if (finalX < scrollX) finalX = scrollX + offset;
    if (finalY < scrollY) finalY = scrollY + offset;

    // 如果仍与选区重叠，尝试在选区上方或下方重新定位
    const selTop = selectionRect.top + scrollY;
    const selBottom = selectionRect.bottom + scrollY;
    const verticalOverlap = (finalY < selBottom) && (finalY + popoverHeight > selTop);
    if (verticalOverlap) {
      // 优先放在选区下方，否则放在上方
      const spaceBelow = scrollY + viewportHeight - selBottom;
      const spaceAbove = selTop - scrollY;
      if (spaceBelow >= popoverHeight + offset) {
        finalY = selBottom + offset;
      } else if (spaceAbove >= popoverHeight + offset) {
        finalY = selTop - popoverHeight - offset;
      }
    }

    return { x: finalX, y: finalY, arrow: 'none' };
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
              <button class="ccs-dock-global">悬停模式（全局）</button>
              <button class="ccs-dock-temp">悬停模式（临时）</button>
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
      }

      /* 底部停靠模式 */
      .ccs-popover.docked-bottom {
        width: 100vw;
        border-radius: 8px 8px 0 0;
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
        const full = selectedText || lastNonEmptySelection || getSmartSearchText();
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
        // 存储id，便于后续根据按钮类型更新tooltip
        button.dataset.id = btn.id;
        button.innerHTML = `
          <div class="ccs-button-icon">${btn.icon}</div>
          <div class="ccs-button-label">${btn.title}</div>
        `;
        // 初始hover提示包含完整文本
        try {
          const initText = selectedText || getSmartSearchText();
          button.title = initText ? `${btn.title}: ${initText}` : btn.title;
        } catch (_) {
          button.title = btn.title;
        }
        button.addEventListener('click', () => {
          const text = getActiveSelectionText() || lastNonEmptySelection || selectedText || getSmartSearchText();
          if (!text) {
            try { showToast('没有可用的文本'); } catch (_) {}
            return;
          }
          btn.action(text);
        });
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
        // 不需要调用showPopover，位置已经保持不变
      });
    }

    // 展开按钮（从mini到normal）
    const expandBtn = shadowRoot.querySelector('.ccs-expand');
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        settings.mode = 'normal';
        saveSettings();
        createPopover(true); // 传入true保留selectedText和位置
        // 不需要调用showPopover，位置已经保持不变
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
            settings.globalDock = true;
            settings.layout = 'bottom';
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
            // 临时：仅当前页面启用，不保存到存储
            settings.globalDock = false; // 确保不影响其它页面
            settings.layout = 'bottom';
            isTempDock = true;
            settings.barClosed = false; // 启用
            // 不调用 saveSettings() 以保持临时
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
        settings.layout = 'float';
        isTempDock = false; // 清除临时标记
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
          saveSettings();
          if (enable) {
            settings.layout = 'bottom';
            isTempDock = false;
            createPopover(true);
            forceShowPopover(window.innerWidth / 2 + window.scrollX, window.innerHeight / 3 + window.scrollY, null, { overrideSavedPosition: true });
          } else {
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
              createPopover(true);
              // 不强制显示，保持现状
            }
          }
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
    
    popover.style.left = `${x}px`;
    popover.style.top = `${y}px`;
    
    // 保存位置
    settings.position = { x, y };
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
      window.open(`https://www.baidu.com/s?wd=${encodeURIComponent(inputValue)}`, '_blank');
    }
  }

  // 显示popover
  function showPopover(x, y, selectionRect = null, options = {}) {
    if (settings.mode === 'disabled') {
      console.log('[触触搜] showPopover 被禁用 (mode=disabled)');
      return;
    }
    
      console.log('[触触搜] showPopover 开始执行:', {x, y, selectedText, hasPopover: !!popover});

    // 底部栏模式（仅普通模式）：若已存在且已是fixed定位，避免重建导致闪烁，仅更新提示与可见性
    if (settings.mode === 'normal' && settings.layout === 'bottom' && popover && shadowRoot && window.getComputedStyle(popover).position === 'fixed') {
      try {
        const current = selectedText || getSmartSearchText();
        const renderedButtons = shadowRoot.querySelectorAll('.ccs-button');
        renderedButtons.forEach(el => {
          const id = el.dataset.id;
          const cfg = (id && defaultButtons.find(b => b.id === id)) || null;
          const base = cfg ? cfg.title : '操作';
          el.title = current ? `${base}: ${current}` : base;
        });
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
    
    // 如果popup已存在，先隐藏再重新显示
    if (popover) {
      console.log('[触触搜] Popover 已存在，先移除旧的');
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
      // 贴底栏无需 left/top 位置计算
      position = { x: 0, y: window.innerHeight + window.scrollY };
    } else if (settings.position && !selectionRect && !overrideSaved) {
      // 如果有保存的位置且不是新选择，且未强制覆盖，则使用保存的位置
      position = settings.position;
      console.log('[触触搜] 使用已保存的位置', position);
    } else if (selectionRect) {
      // 使用智能定位
      position = calculateSmartPosition(selectionRect, x, y);
      console.log('[触触搜] 使用智能定位计算的位置', position);
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
    
    if (settings.layout !== 'bottom') {
      popover.style.left = `${position.x}px`;
      popover.style.top = `${position.y}px`;
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

    // 若弹窗存在，则实时更新标题与按钮tooltip（选中文本优先，否则回退到搜索URL关键词或页面标题）
    if (popover && shadowRoot) {
      const current = text || lastNonEmptySelection || getSmartSearchText();
      if (current) {
        selectedText = current;
        lastNonEmptySelection = current;
        // 更新标题显示与title（无标题的布局会跳过）
        const titleEl = shadowRoot.querySelector('.ccs-title');
        if (titleEl) {
          titleEl.textContent = `🔍 触触搜: "${current}"`;
          titleEl.title = current;
        }
        // 更新各操作按钮的hover提示
        const renderedButtons = shadowRoot.querySelectorAll('.ccs-button');
        renderedButtons.forEach(el => {
          const id = el.dataset.id;
          const cfg = (id && defaultButtons.find(b => b.id === id)) || null;
          const base = cfg ? cfg.title : '操作';
          el.title = `${base}: ${current}`;
        });
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
      const selection = window.getSelection();
      const text = selection.toString().trim();
      const currentTime = Date.now();

      // 更严格的检查：确保真的有选中文本
      if (text.length >= 1 && selection.rangeCount > 0) { // 至少1个字符
        const range = selection.getRangeAt(0);
        // range.collapsed为false表示确实有选中内容
        if (!range.collapsed && settings.mode !== 'disabled') {
          // 检查是否是重复的选择（避免双击闪现两次）
          if (text === lastSelectedText && currentTime - lastSelectionTime < 500) {
            return; // 500ms内相同文本不重复显示
          }
          
          lastSelectedText = text;
          lastSelectionTime = currentTime;
          selectedText = text;
          
          // 使用选中区域的位置而非鼠标位置
          const rect = range.getBoundingClientRect();
          // 计算选中文本的底部中心点
          const centerX = rect.left + rect.width / 2 + window.scrollX;
          const bottomY = rect.bottom + window.scrollY;
          
          showPopover(centerX, bottomY, rect);
        } else {
          hidePopover();
        }
      } else {
        // 底部栏模式下保持常驻
        if (settings.layout !== 'bottom') hidePopover();
      }
    }, 200); // 增加到200ms防抖延迟
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
    
    // 检查 Ctrl+Shift+S 或 Alt+S
    const isCtrlShiftS = e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's');
    const isAltS = e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 'S' || e.key === 's');

    // 将显示逻辑提取为函数，便于复用
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

    if (isCtrlShiftS) {
      console.log('[触触搜] ✅ 快捷键触发! Ctrl+Shift+S');
      console.log('[触触搜] 当前状态:', {
        popover: popover ? '存在' : '不存在',
        shadowRoot: shadowRoot ? '存在' : '不存在',
        selectedText: selectedText || '(空)',
        settings: settings
      });

      // 阻止所有默认行为和事件传播
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // 切换逻辑：
      // - 如果已存在但不在视口内，则重新定位到视口内靠近选择/居中位置
      // - 否则执行开/关切换
      if (popover) {
        try {
          const rect = popover.getBoundingClientRect();
          const inView = rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
          console.log('[触触搜] Ctrl+Shift+S Toggle 检查可见性:', { rect, inView, viewport: { w: window.innerWidth, h: window.innerHeight }, scroll: { x: window.scrollX, y: window.scrollY } });
          if (!inView) {
            // 重新定位到视口内
            let x, y, selectionRect = null;
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0 && selection.toString().trim()) {
              const range = selection.getRangeAt(0);
              const selRect = range.getBoundingClientRect();
              x = selRect.left + selRect.width / 2 + window.scrollX;
              y = selRect.bottom + window.scrollY;
              selectionRect = selRect;
              console.log('[触触搜] 选择区域存在，准备重定位:', { x, y, selRect });
            } else {
              x = window.innerWidth / 2 + window.scrollX;
              y = window.innerHeight / 3 + window.scrollY;
              console.log('[触触搜] 无选择区域，重定位到视口中心上方:', { x, y });
            }
            forceShowPopover(x, y, selectionRect, { overrideSavedPosition: true });
            return false;
          }
        } catch (err) {
          console.warn('[触触搜] 检查/重定位失败:', err);
        }
        // 在视口内：执行隐藏
        hidePopover();
        return false;
      } else {
        showFromShortcut();
        return false;
      }
    }

    if (isAltS) {
      console.log('[触触搜] ✅ 快捷键触发! Alt+S');
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      showFromShortcut();
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
          💡 提示：<kbd>Ctrl+Shift+S</kbd> / <kbd>Alt+S</kbd> 或 <kbd>Alt+右键</kbd> 快速唤起
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

  // 智能获取要搜索的内容（同步版本，尽量本地推断）
  function getSmartSearchText() {
    // 优先级1: 选中的文本
    const selected = getActiveSelectionText();
    if (selected) {
      return selected;
    }
    // 优先级1.5: 最近一次非空选择
    if (lastNonEmptySelection) return lastNonEmptySelection;
    
    // 优先级2: 搜索引擎关键词
    const searchKeyword = extractSearchKeyword();
    if (searchKeyword) {
      return searchKeyword;
    }
    
    // 优先级3: 页面标题（保留全文）
    const title = document.title;
    if (title) {
      // 不再按分隔符截断，保留页面完整标题
      return title.trim();
    }
    
    return '';
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
      // 若未传入文本，使用与快捷键一致的智能文本获取
      selectedText = request.text || getSmartSearchText();
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
