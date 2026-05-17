(() => {
  // 幂等守卫：扩展 reload / iframe 重复注入时直接 return，避免 44 个监听器叠加
  // （manifest 是 document_start + all_frames: true，每次注入都会跑 IIFE 顶层）
  const __g = typeof globalThis !== 'undefined' ? globalThis : window;
  if (__g.__ccs_content_initialized) return;
  __g.__ccs_content_initialized = true;

  const EXTENSION_NAME = '触触搜';
  const SELECTION_SYNC_DELAY = 35;

  // BUGFIX: Wait for DOM to be ready before initializing
  // This is necessary because manifest.json now uses document_start
  function waitForDOMReady() {
    return new Promise((resolve) => {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', resolve, { once: true });
      } else {
        resolve();
      }
    });
  }

  const state = {
    debug: false,
    selection: '',
    debounceTimer: null,
    isUserSelecting: false
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
      if (selection && selection.rangeCount > 0) {
        const raw = selection.toString();
        if (raw && raw.trim().length > 0) {
          return raw;
        }
      }
      const fallback = readSelectionFromActiveElement();
      if (fallback) {
        return fallback;
      }
      return '';
    } catch (err) {
      log('读取选中文本失败:', err);
      return '';
    }
  }

  function readSelectionFromActiveElement() {
    const activeElement = document.activeElement;
    return extractSelectionFromElement(activeElement);
  }

  function extractSelectionFromElement(element) {
    if (!element) return '';

    try {
      if (typeof element.value === 'string') {
        const { selectionStart, selectionEnd } = element;
        if (
          typeof selectionStart === 'number' &&
          typeof selectionEnd === 'number' &&
          selectionStart !== selectionEnd
        ) {
          const value = element.value;
          if (value) {
            const start = Math.min(selectionStart, selectionEnd);
            const end = Math.max(selectionStart, selectionEnd);
            const result = value.slice(start, end);
            if (result && result.trim().length > 0) {
              return result;
            }
          }
        }
      }

      if (element.shadowRoot) {
        const shadowActive = element.shadowRoot.activeElement;
        if (shadowActive && shadowActive !== element) {
          const shadowText = extractSelectionFromElement(shadowActive);
          if (shadowText) {
            return shadowText;
          }
        }
        const shadowSelection = element.shadowRoot.getSelection
          ? element.shadowRoot.getSelection()
          : null;
        if (shadowSelection && shadowSelection.rangeCount > 0) {
          const raw = shadowSelection.toString();
          if (raw && raw.trim().length > 0) {
            return raw;
          }
        }
      }

      if (element.isContentEditable) {
        const editableSelection = window.getSelection();
        if (editableSelection && editableSelection.rangeCount > 0) {
          const raw = editableSelection.toString();
          if (raw && raw.trim().length > 0) {
            return raw;
          }
        }
      }
    } catch (err) {
      log('从元素提取选区失败:', err);
    }

    return '';
  }

  function applySelection(text, trigger = 'unknown') {
    const raw = typeof text === 'string' ? text : '';
    const trimmed = raw.trim();
    const hasContent = trimmed.length > 0;
    const value = hasContent ? trimmed : '';
    window.selectedText = value;
    if (hasContent) {
      window.lastNonEmptySelection = value;
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
      const immediateSelection = readCurrentSelection();
      applySelection(immediateSelection, trigger);
      if (!immediateSelection || !immediateSelection.trim()) {
        setTimeout(() => {
          const retrySelection = readCurrentSelection();
          if (retrySelection && retrySelection.trim()) {
            applySelection(retrySelection, `${trigger}-retry`);
          }
        }, SELECTION_SYNC_DELAY);
      }
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
    state.isUserSelecting = false;
  }

  document.addEventListener('selectionchange', () => {
    if (!state.isUserSelecting) return;
    updateSelection('selectionchange');
  });
  document.addEventListener('mousedown', () => {
    state.isUserSelecting = true;
  }, true);
  document.addEventListener('mouseup', () => {
    updateSelection('mouseup');
    state.isUserSelecting = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Shift' || event.shiftKey) {
      state.isUserSelecting = true;
    }
    // Ctrl+A / Cmd+A (select all)
    if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
      state.isUserSelecting = true;
    }
  });
  document.addEventListener('keyup', (event) => {
    // Always sync if there's a non-empty selection after keyup
    const currentSel = readCurrentSelection();
    const shouldUpdate = currentSel || event.key === 'Escape' || event.key === 'Enter' || event.key === 'Shift' || state.isUserSelecting;
    if (shouldUpdate) {
      updateSelection('keyup');
    }
    if (!event.shiftKey || event.key === 'Shift') {
      state.isUserSelecting = false;
    }
  });
  document.addEventListener('contextmenu', handleContextMenu, true);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      // BUGFIX: Immediately sync selection when tab becomes visible
      // Skip debounce to ensure selection is available before user right-clicks
      updateSelection('visibility', { immediate: true });
    }
  });

  // BUGFIX: Wait for DOM ready before initializing selection
  // This prevents errors when content script injects at document_start
  (async () => {
    await waitForDOMReady();
    updateSelection('init', { immediate: true });
  })();

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
          sendResponse?.({ ok: false, error: 'no-text' });
          return true;
        }
        copyToClipboard(candidate)
          .then(() => {
            showInfoToast('已复制到剪贴板');
            sendResponse?.({ ok: true });
          })
          .catch((error) => {
            showErrorToast('复制失败，请稍后重试');
            sendResponse?.({ ok: false, error: error?.message || 'copy-failed' });
          });
        return true;
      }
      case 'processCommand': {
        const text = pickPreferredText(request.text);
        if (!text) {
          showErrorToast('没有可处理的内容');
          sendResponse?.({ ok: false, error: 'no-text' });
          return true;
        }
        const result = runCommand(request.command, text);
        if (result == null) {
          showErrorToast('暂不支持此操作');
          sendResponse?.({ ok: false, error: 'unsupported-command' });
          return true;
        }
        copyToClipboard(result)
          .then(() => {
            showInfoToast(`处理完成并已复制: ${truncateForToast(result)}`);
            sendResponse?.({ ok: true });
          })
          .catch((error) => {
            showErrorToast('结果复制失败');
            sendResponse?.({ ok: false, error: error?.message || 'copy-result-failed' });
          });
        return true;
      }
      case 'showPopover':
        showInfoToast('底部面板功能已暂停，若需恢复请查看 legacy 目录。');
        sendResponse?.({ ok: true });
        return true;
      case 'showToast':
        showInfoToast(request.message || '');
        sendResponse?.({ ok: true });
        return true;
      case 'fetchSelectionSnapshot': {
        const preferEmpty = !!request.preferEmpty;
        const live = readCurrentSelection();
        let chosen = typeof live === 'string' ? live : '';
        let source = 'live';

        if (!chosen || !chosen.trim()) {
          if (preferEmpty) {
            chosen = '';
            source = 'empty';
          } else if (state.selection && state.selection.trim().length > 0) {
            chosen = state.selection;
            source = 'state';
          } else if (window.lastNonEmptySelection && window.lastNonEmptySelection.trim().length > 0) {
            chosen = window.lastNonEmptySelection;
            source = 'memory';
          } else {
            chosen = '';
            source = 'empty';
          }
        } else if (state.selection !== chosen) {
          state.selection = chosen;
        }

        if (chosen && chosen.trim()) {
          window.selectedText = chosen;
          window.lastNonEmptySelection = chosen;
        }

        try {
          sendResponse?.({
            text: chosen,
            source,
            url: window.location.href,
            title: document.title || ''
          });
        } catch (err) {
          log('返回选区快照失败', err);
        }
        return true;
      }
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
