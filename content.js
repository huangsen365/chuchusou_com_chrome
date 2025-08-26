(() => {
  let popover = null;
  let shadowRoot = null;
  let selectedText = '';

  // 命令处理函数
  const commands = {
    base64: (args) => {
      if (args[0] === '-d') {
        // 解码
        try {
          return atob(args.slice(1).join(' '));
        } catch (e) {
          return '解码失败: 无效的 base64 字符串';
        }
      } else {
        // 编码
        return btoa(unescape(encodeURIComponent(args.join(' '))));
      }
    },
    md5: (args) => {
      const text = args.join(' ');
      // 简单的MD5实现（仅作示例，实际使用需要更完整的实现）
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
      id: 'cut',
      icon: '✂️',
      title: '剪切',
      action: async (text) => {
        try {
          await navigator.clipboard.writeText(text);
          // 清空选中的文本
          const selection = window.getSelection();
          if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
          }
          showToast('已剪切到剪贴板');
        } catch (err) {
          showToast('剪切失败');
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
      toast.style.display = 'block';
      setTimeout(() => {
        toast.style.display = 'none';
      }, 2000);
    }
  }

  // 创建popover
  function createPopover() {
    // 移除旧的popover
    if (popover) {
      popover.remove();
    }

    // 创建容器
    popover = document.createElement('div');
    popover.id = 'ccs-popover-container';
    popover.style.position = 'absolute';
    popover.style.zIndex = '2147483647';

    // 创建shadow DOM
    shadowRoot = popover.attachShadow({ mode: 'open' });

    // 创建HTML结构
    const wrapper = document.createElement('div');
    wrapper.className = 'ccs-popover';
    wrapper.innerHTML = `
      <div class="ccs-header">
        <span class="ccs-title">触触搜</span>
        <button class="ccs-close">✕</button>
      </div>
      <div class="ccs-input-wrapper">
        <input type="text" class="ccs-input" placeholder="输入命令 (如: /base64 hello)">
        <button class="ccs-execute">执行</button>
      </div>
      <div class="ccs-buttons"></div>
      <div class="ccs-result" style="display: none;"></div>
      <div class="ccs-footer">更多功能 敬请期待...</div>
      <div class="ccs-toast"></div>
    `;

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
      }

      .ccs-header {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 10px 15px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .ccs-title {
        font-weight: bold;
        font-size: 16px;
      }

      .ccs-close {
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        font-size: 18px;
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

      .ccs-input-wrapper {
        padding: 15px;
        display: flex;
        gap: 8px;
        border-bottom: 1px solid #eee;
      }

      .ccs-input {
        flex: 1;
        padding: 8px 12px;
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
        padding: 8px 16px;
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

      .ccs-buttons {
        padding: 15px;
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 10px;
      }

      .ccs-button {
        background: #f7fafc;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        padding: 12px 8px;
        cursor: pointer;
        text-align: center;
        transition: all 0.2s;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
      }

      .ccs-button:hover {
        background: #edf2f7;
        border-color: #cbd5e0;
        transform: translateY(-1px);
      }

      .ccs-button-icon {
        font-size: 20px;
      }

      .ccs-button-label {
        font-size: 11px;
        color: #718096;
      }

      .ccs-result {
        padding: 10px 15px;
        background: #f7fafc;
        border-top: 1px solid #e2e8f0;
        font-family: monospace;
        font-size: 12px;
        max-height: 100px;
        overflow-y: auto;
        word-break: break-all;
      }

      .ccs-footer {
        padding: 10px 15px;
        background: #f7fafc;
        color: #718096;
        font-size: 12px;
        text-align: center;
        border-top: 1px solid #e2e8f0;
      }

      .ccs-toast {
        position: absolute;
        bottom: 60px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 8px 16px;
        border-radius: 4px;
        font-size: 12px;
        display: none;
        white-space: nowrap;
        z-index: 1000;
      }
    `;

    shadowRoot.appendChild(style);
    shadowRoot.appendChild(wrapper);

    // 添加按钮
    const buttonsContainer = shadowRoot.querySelector('.ccs-buttons');
    defaultButtons.forEach(btn => {
      const button = document.createElement('div');
      button.className = 'ccs-button';
      button.innerHTML = `
        <div class="ccs-button-icon">${btn.icon}</div>
        <div class="ccs-button-label">${btn.title}</div>
      `;
      button.addEventListener('click', () => btn.action(selectedText));
      buttonsContainer.appendChild(button);
    });

    // 绑定事件
    shadowRoot.querySelector('.ccs-close').addEventListener('click', hidePopover);
    shadowRoot.querySelector('.ccs-execute').addEventListener('click', executeCommand);
    shadowRoot.querySelector('.ccs-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        executeCommand();
      }
    });

    document.body.appendChild(popover);
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
  function showPopover(x, y) {
    createPopover();

    // 计算位置
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const popoverWidth = 320;
    const popoverHeight = 400; // 估计高度

    let left = x;
    let top = y + 10;

    // 确保不超出视窗
    if (left + popoverWidth > viewportWidth) {
      left = viewportWidth - popoverWidth - 10;
    }
    if (top + popoverHeight > viewportHeight) {
      top = y - popoverHeight - 10;
    }

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  // 隐藏popover
  function hidePopover() {
    if (popover) {
      popover.remove();
      popover = null;
      shadowRoot = null;
    }
  }

  // 监听文本选择
  document.addEventListener('mouseup', (e) => {
    // 如果点击在popover内部，不处理
    if (popover && popover.contains(e.target)) {
      return;
    }

    const selection = window.getSelection();
    const text = selection.toString().trim();

    if (text.length > 0) {
      selectedText = text;
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      showPopover(rect.left + window.scrollX, rect.bottom + window.scrollY);
    } else {
      hidePopover();
    }
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
  });
})();