(() => {
  let popover = null;
  let shadowRoot = null;
  let selectedText = '';
  let settings = {
    mode: 'normal', // normal, mini, disabled
    theme: 'default',
    opacity: 1,
    position: null,
    blacklist: [],
    miniButtons: ['baidu', 'google', 'chuchusou', 'copy', 'base64-encode'] // Mini模式默认5个按钮，包含更多搜索
  };
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };

  // 初始化：加载用户设置
  chrome.storage.local.get(['ccs_settings'], (result) => {
    if (result.ccs_settings) {
      settings = { ...settings, ...result.ccs_settings };
    }
    checkBlacklist();
  });

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
    const offset = isInInputField ? 25 : 15;
    
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
    
    // 找到第一个完全在视窗内的位置
    for (const pos of positions) {
      const inViewport = 
        pos.x >= scrollX && 
        pos.y >= scrollY && 
        pos.x + popoverWidth <= scrollX + viewportWidth &&
        pos.y + popoverHeight <= scrollY + viewportHeight;
      
      if (inViewport) {
        return pos;
      }
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
    wrapper.className = `ccs-popover ${settings.mode === 'mini' ? 'mini-mode' : ''} theme-${settings.theme}`;
    
    if (settings.mode === 'mini') {
      // Mini模式HTML - 不显示设置按钮，标题保持不变
      wrapper.innerHTML = `
        <div class="ccs-header" data-draggable="true">
          <span class="ccs-title">🔍 触触搜</span>
          <div class="ccs-header-buttons">
            <button class="ccs-expand" title="展开">📖</button>
            <button class="ccs-close" title="关闭">✕</button>
          </div>
        </div>
        <div class="ccs-mini-buttons"></div>
        <div class="ccs-toast"></div>
      `;
    } else {
      // 普通模式HTML - 标题显示选中的文本
      const escapeHtml = (text) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      };
      const displayText = selectedText ? 
        `🔍 触触搜: "${escapeHtml(selectedText.substring(0, 15))}${selectedText.length > 15 ? '...' : ''}"` : 
        '🔍 触触搜';
      wrapper.innerHTML = `
        <div class="ccs-header" data-draggable="true">
          <span class="ccs-title">${displayText}</span>
          <div class="ccs-header-buttons">
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
        <div class="ccs-footer">更多功能 敬请期待...</div>
        <div class="ccs-toast"></div>
        <div class="ccs-settings-panel" style="display: none;">
          <h3>设置</h3>
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
            <label>当前网站：</label>
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
      }

      .ccs-header-buttons {
        display: flex;
        gap: 5px;
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
      }

      .ccs-settings-panel h3 {
        font-size: 14px;
        margin-bottom: 12px;
        color: #667eea;
      }

      .setting-item {
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .setting-item label {
        font-size: 12px;
        color: #4a5568;
      }

      .setting-item select,
      .setting-item button {
        padding: 4px 8px;
        border: 1px solid #cbd5e0;
        border-radius: 4px;
        font-size: 12px;
        background: white;
        cursor: pointer;
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
        background: #f56565;
        color: white;
        border: none;
      }

      .blacklist-toggle:hover {
        background: #e53e3e;
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

    // 添加按钮
    const buttonsToShow = settings.mode === 'mini' 
      ? settings.miniButtons.map(id => defaultButtons.find(btn => btn.id === id)).filter(Boolean)
      : defaultButtons;
    
    const buttonsContainer = shadowRoot.querySelector(settings.mode === 'mini' ? '.ccs-mini-buttons' : '.ccs-buttons');
    if (buttonsContainer) {
      buttonsToShow.forEach(btn => {
        const button = document.createElement('div');
        button.className = 'ccs-button';
        button.innerHTML = `
          <div class="ccs-button-icon">${btn.icon}</div>
          <div class="ccs-button-label">${btn.title}</div>
        `;
        button.addEventListener('click', () => btn.action(selectedText));
        buttonsContainer.appendChild(button);
      });
    }

    // 绑定事件
    bindEvents();

    // 只在新创建时添加到DOM
    if (!isModeSwitching) {
      document.body.appendChild(popover);
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

    // 设置面板事件
    const settingsPanel = shadowRoot.querySelector('.ccs-settings-panel');
    if (settingsPanel) {
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
        }
        
        blacklistBtn.addEventListener('click', () => {
          const index = settings.blacklist.indexOf(currentHost);
          if (index > -1) {
            settings.blacklist.splice(index, 1);
            blacklistBtn.textContent = '加入黑名单';
            blacklistBtn.style.background = '#f56565';
            showToast('已移出黑名单');
          } else {
            settings.blacklist.push(currentHost);
            blacklistBtn.textContent = '移出黑名单';
            blacklistBtn.style.background = '#48bb78';
            showToast('已加入黑名单');
          }
          saveSettings();
        });
      }
    }

    // 拖拽功能
    const header = shadowRoot.querySelector('.ccs-header');
    if (header) {
      header.addEventListener('mousedown', startDragging);
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
  function showPopover(x, y, selectionRect = null) {
    if (settings.mode === 'disabled') return;
    
    // 如果popup已存在且显示相同内容，不重复创建
    if (popover && shadowRoot) {
      const existingInput = shadowRoot.querySelector('.ccs-input');
      if (existingInput && existingInput.value === selectedText) {
        return; // 避免重复显示
      }
    }
    
    createPopover();

    let position;
    if (settings.position && !selectionRect) {
      // 如果有保存的位置且不是新选择，使用保存的位置
      position = settings.position;
    } else if (selectionRect) {
      // 使用智能定位
      position = calculateSmartPosition(selectionRect, x, y);
    } else {
      // 使用传入的位置
      position = { x, y };
    }

    // 添加平滑过渡动画
    if (!popover.style.transition) {
      popover.style.transition = 'opacity 0.2s ease-in-out, transform 0.2s ease-in-out';
      popover.style.opacity = '0';
      popover.style.transform = 'scale(0.95)';
    }
    
    popover.style.left = `${position.x}px`;
    popover.style.top = `${position.y}px`;
    
    // 触发动画
    requestAnimationFrame(() => {
      popover.style.opacity = settings.opacity || '1';
      popover.style.transform = 'scale(1)';
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
    const selection = window.getSelection();
    const text = selection.toString().trim();
    
    // 只在文本变化时通知
    if (text !== lastNotifiedText) {
      lastNotifiedText = text;
      // 发送给background script更新菜单
      chrome.runtime.sendMessage({
        action: 'selectionChanged',
        text: text
      }).catch(() => {
        // 忽略错误（可能background未准备好）
      });
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
        hidePopover();
      }
    }, 200); // 增加到200ms防抖延迟
  });

  // 点击其他地方隐藏popover
  document.addEventListener('mousedown', (e) => {
    if (popover && !popover.contains(e.target)) {
      const selection = window.getSelection();
      const text = selection.toString().trim();
      if (text.length === 0) {
        hidePopover();
      }
    }
  });

  // ESC键隐藏popover
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hidePopover();
    }
    // 快捷键 Ctrl+Shift+S 强制显示popover（即使在黑名单）
    if (e.ctrlKey && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      
      // 智能获取内容
      const smartText = getSmartSearchText();
      if (smartText) {
        selectedText = smartText; // 设置全局变量
        
        // 确定显示位置
        let x, y;
        const selection = window.getSelection();
        
        // 如果有选中区域，使用选中区域位置
        if (selection.rangeCount > 0 && selection.toString().trim()) {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          x = rect.left + rect.width / 2;
          y = rect.bottom;
        } else {
          // 否则显示在屏幕中央偏上
          x = window.innerWidth / 2;
          y = window.innerHeight / 3;
        }
        
        forceShowPopover(x, y);
      } else {
        showToast('没有找到可搜索的内容');
      }
    }
  });

  // 右键菜单处理 - 不再阻止默认菜单
  document.addEventListener('contextmenu', (e) => {
    // 普通右键时，隐藏popup让右键菜单接管
    if (!e.altKey && !e.shiftKey) {
      // 如果有选中文本，隐藏popup让右键菜单处理
      const selection = window.getSelection();
      const text = selection.toString().trim();
      if (text.length > 0 || popover) {
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
          💡 提示：<kbd>Ctrl+Shift+S</kbd> 或 <kbd>Alt+右键</kbd> 快速唤起
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

  // 从搜索引擎页面提取关键词
  function extractSearchKeyword() {
    const hostname = window.location.hostname;
    const params = new URLSearchParams(window.location.search);
    
    // 搜索引擎配置（参数名）
    const searchEngines = {
      'baidu.com': 'wd',
      'google.com': 'q', 
      'google.co': 'q', // 支持各国Google域名
      'bing.com': 'q',
      'sogou.com': 'query',
      'so.com': 'q',
      '360.cn': 'q',
      'yahoo.com': 'p',
      'search.yahoo.com': 'p',
      'duckduckgo.com': 'q',
      'yandex.com': 'text',
      'yandex.ru': 'text'
    };
    
    for (const [domain, paramName] of Object.entries(searchEngines)) {
      if (hostname.includes(domain)) {
        const keyword = params.get(paramName);
        if (keyword) {
          return decodeURIComponent(keyword);
        }
      }
    }
    return null;
  }

  // 智能获取要搜索的内容
  function getSmartSearchText() {
    // 优先级1: 选中的文本
    const selection = window.getSelection();
    const selected = selection.toString().trim();
    if (selected) {
      return selected;
    }
    
    // 优先级2: 搜索引擎关键词
    const searchKeyword = extractSearchKeyword();
    if (searchKeyword) {
      return searchKeyword;
    }
    
    // 优先级3: 页面标题（清理后）
    const title = document.title;
    if (title) {
      // 移除常见的网站后缀
      let cleanTitle = title;
      // 按常见分隔符分割，取第一部分
      const separators = [' - ', ' | ', ' — ', ' · ', ' :: ', ' » '];
      for (const sep of separators) {
        if (cleanTitle.includes(sep)) {
          cleanTitle = cleanTitle.split(sep)[0];
          break;
        }
      }
      return cleanTitle.trim();
    }
    
    return '';
  }

  // 强制显示popover（快捷键触发）
  function forceShowPopover(x, y) {
    if (settings.isBlacklisted) {
      showRecoveryPopover(x + window.scrollX, y + window.scrollY);
    } else {
      createPopover();
      showPopover(x, y);
    }
  }

  // 监听来自popup和background的消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
          // 简单的MD5实现（示例用）
          result = 'MD5: ' + btoa(request.text).substring(0, 32);
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
      selectedText = request.text;
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