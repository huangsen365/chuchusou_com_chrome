(() => {
  const EXTENSION_NAME = '触触搜';
  const SELECTION_SYNC_DELAY = 35;

  const state = {
    debug: false,
    selection: '',
    debounceTimer: null
  };

  // expose basic globals expected by other modules
  window.selectedText = '';
  window.lastNonEmptySelection = '';
  window.shadowRoot = null;

  const noop = () => {};
  window.createPopover = noop;
  window.forceShowPopover = noop;
  window.hidePopover = noop;
  window.ensureBottomBarVisible = noop;
  window.scheduleRealtimeUpdate = noop;
  window.__initDockBar = () => {
    showInfoToast('触触搜面板功能已暂时关闭，可查看 legacy/content.panel-legacy.js 以恢复旧版本逻辑。');
  };

  chrome.storage?.local?.get(['ccs_debug'], (res) => {
    updateDebug(!!res?.ccs_debug);
  });

  function updateDebug(enabled) {
    state.debug = !!enabled;
    window.CCS_DEBUG = state.debug;
  }

  function log(...args) {
    if (state.debug) {
      console.log(`[${EXTENSION_NAME}]`, ...args);
    }
  }

  function readCurrentSelection() {
    try {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return '';
      const raw = selection.toString();
      if (!raw) return '';
      return raw.trim().length > 0 ? raw : '';
    } catch (err) {
      log('读取选中文本失败:', err);
      return '';
    }
  }

  function applySelection(text, trigger = 'unknown') {
    const raw = typeof text === 'string' ? text : '';
    const hasContent = raw.trim().length > 0;
    const value = hasContent ? raw : '';
    window.selectedText = value;
    if (hasContent) {
      window.lastNonEmptySelection = raw;
    }

    if (state.selection === value) {
      return;
    }

    state.selection = value;
    log('同步选中文本', { trigger, text: value });
    safeChromeSendMessage({ action: 'selectionChanged', text: value });
  }

  function updateSelection(trigger, { immediate = false } = {}) {
    if (immediate) {
      applySelection(readCurrentSelection(), trigger);
      return;
    }

    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
    }
    state.debounceTimer = setTimeout(() => {
      applySelection(readCurrentSelection(), trigger);
    }, SELECTION_SYNC_DELAY);
  }

  function handleContextMenu() {
    // Right before the menu opens, capture the freshest selection.
    updateSelection('contextmenu', { immediate: true });
  }

  document.addEventListener('selectionchange', () => updateSelection('selectionchange'));
  document.addEventListener('mouseup', () => updateSelection('mouseup'));
  document.addEventListener('keyup', (event) => {
    if (event.key === 'Escape' || event.key === 'Enter') {
      updateSelection('keyup');
    }
  });
  document.addEventListener('contextmenu', handleContextMenu, true);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      updateSelection('visibility');
    }
  });

  updateSelection('init', { immediate: true });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'updateDebug':
        updateDebug(!!request.enabled);
        chrome.storage?.local?.set({ ccs_debug: state.debug });
        sendResponse?.({ ok: true });
        return true;
      case 'copyText': {
        const candidate = pickPreferredText(request.text);
        if (!candidate) {
          showErrorToast('没有可复制的内容');
          return;
        }
        copyToClipboard(candidate)
          .then(() => showInfoToast('已复制到剪贴板'))
          .catch(() => showErrorToast('复制失败，请稍后重试'));
        return;
      }
      case 'processCommand': {
        const text = pickPreferredText(request.text);
        if (!text) {
          showErrorToast('没有可处理的内容');
          return;
        }
        const result = runCommand(request.command, text);
        if (result == null) {
          showErrorToast('暂不支持此操作');
          return;
        }
        copyToClipboard(result)
          .then(() => showInfoToast(`处理完成并已复制: ${truncateForToast(result)}`))
          .catch(() => showErrorToast('结果复制失败'));
        return;
      }
      case 'showPopover':
        showInfoToast('底部面板功能已暂停，若需恢复请查看 legacy 目录。');
        return;
      case 'showToast':
        showInfoToast(request.message || '');
        return;
      default:
        return;
    }
  });

  function copyToClipboard(text) {
    if (!text) {
      return Promise.resolve();
    }

    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text);
    }

    return new Promise((resolve, reject) => {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        const succeeded = document.execCommand('copy');
        document.body.removeChild(textarea);
        succeeded ? resolve() : reject(new Error('execCommand failed'));
      } catch (err) {
        reject(err);
      }
    });
  }

  function runCommand(command, text) {
    switch (command) {
      case 'base64':
        return encodeBase64(text);
      case 'md5':
        return pseudoMd5(text);
      case 'url-encode':
        return encodeURIComponent(text);
      case 'upper':
        return text.toUpperCase();
      case 'lower':
        return text.toLowerCase();
      default:
        return null;
    }
  }

  function encodeBase64(text) {
    try {
      return btoa(unescape(encodeURIComponent(text)));
    } catch (err) {
      showErrorToast('Base64 编码失败');
      return null;
    }
  }

  function pseudoMd5(text) {
    if (!text) {
      return '00000000000000000000000000000000';
    }
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + charCode;
      hash |= 0;
    }
    const normalized = Math.abs(hash).toString(16);
    return normalized.padStart(32, '0').slice(0, 32);
  }

  function truncateForToast(text, max = 50) {
    if (text.length <= max) return text;
    return `${text.slice(0, max)}...`;
  }

  function showInfoToast(message) {
    if (!message) return;
    if (window.CCSModules?.Toast) {
      window.CCSModules.Toast.showContextMenuToast(message);
      return;
    }
    fallbackToast(message);
  }

  function showErrorToast(message) {
    if (!message) return;
    if (window.CCSModules?.Toast) {
      window.CCSModules.Toast.error(message);
      return;
    }
    fallbackToast(message);
  }

  function fallbackToast(message) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.8);
      color: #fff;
      padding: 12px 16px;
      border-radius: 6px;
      font-size: 14px;
      z-index: 2147483647;
      opacity: 0;
      transition: opacity 0.2s ease;
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
    });
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 200);
    }, 2000);
  }

  function safeChromeSendMessage(message) {
    try {
      if (chrome?.runtime?.id) {
        chrome.runtime.sendMessage(message);
      }
    } catch (err) {
      log('发送消息失败:', err);
    }
  }

  window.safeChromeSendMessage = safeChromeSendMessage;

  function pickPreferredText(value) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    if (state.selection && state.selection.length > 0) {
      return state.selection;
    }
    const live = readCurrentSelection();
    return live && live.length > 0 ? live : '';
  }
})();
