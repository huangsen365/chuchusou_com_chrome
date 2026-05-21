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
    isUserSelecting: false,
    // Ctrl+A 防退化闸：记录最近一次 Ctrl+A 时间戳。在 SELECT_ALL_PROTECT_MS 窗口内，
    // applySelection 拒绝「短文本覆盖当前长文本 + 非 mouseup 触发」的更新。详见
    // applySelection 里的注释。
    lastSelectAllTime: 0,
    selectAllProtectUntil: 0,
    selectAllKeyActive: false
  };
  const SELECT_ALL_PROTECT_MS = 3000;
  const aiPromptFillInFlight = new Set();
  const aiPromptFillDone = new Set();

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

  function isWithinSelectAllProtect(now = Date.now()) {
    return !!state.selectAllProtectUntil && now < state.selectAllProtectUntil;
  }

  function extendSelectAllProtect(now = Date.now()) {
    state.lastSelectAllTime = now;
    state.selectAllProtectUntil = Math.max(
      state.selectAllProtectUntil || 0,
      now + SELECT_ALL_PROTECT_MS
    );
  }

  function isSelectAllUserInitiatedTrigger(trigger) {
    return (
      trigger === 'mouseup' ||
      trigger === 'contextmenu' ||
      trigger === 'init' ||
      trigger === 'keyup:Escape' ||
      trigger === 'keyup:Enter'
    );
  }

  function isSelectAllDegradation(value, hasContent, trigger) {
    if (!isWithinSelectAllProtect()) return false;
    if (isSelectAllUserInitiatedTrigger(trigger)) return false;

    const current = state.selection || '';
    if (!current.trim()) return false;

    const isEmptyDegradation = !hasContent;
    const isShorterDegradation = hasContent && value.length < current.length;
    return isEmptyDegradation || isShorterDegradation;
  }

  function getSupportedAIEngineFromLocation() {
    try {
      const host = window.location.hostname.toLowerCase();
      const url = new URL(window.location.href);
      const hashText = (url.hash || '').replace(/^#/, '');
      const hasRelayId = url.searchParams.has('ccs_pp') ||
        new URLSearchParams(hashText).has('ccs_pp') ||
        /(?:^|[?&#])ccs_pp=([A-Za-z0-9_-]+)/.test(hashText);
      if (host === 'chatgpt.com' || host.endsWith('.chatgpt.com')) return 'chatgpt';
      if (host === 'claude.ai' || host.endsWith('.claude.ai')) return 'claude';
      if (host === 'grok.com' || host.endsWith('.grok.com')) return 'grok';
      if (host === 'yiyan.baidu.com') return 'yiyan';
      if ((host === 'google.com' || host.endsWith('.google.com')) && (url.searchParams.get('udm') === '50' || hasRelayId)) {
        return 'google-ai';
      }
      return '';
    } catch (err) {
      log('判断 AI 引擎域名失败:', err);
      return '';
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

  // 从一个节点向上 walk，启发式找到「编辑器容器」——
  // 富文本+图片场景里图片往往是 contenteditable=false 的 node view，会"打断"DOM 选区，
  // 让 selection.toString() / commonAncestor.textContent 都只能拿到第一段文本。
  // 多块编辑器（Notion / 飞书）每段是独立 contenteditable 又会让 findContentEditableRoot
  // 只命中当前段落。
  //
  // 这个函数找的是「拥有 ≥3 个 contenteditable=true 后代的最近祖先」（多块编辑器签名），
  // 或者退一步「最外层的 contenteditable 祖先」（单块大容器）。textContent 包含所有
  // block 的文本，跨过图片打断。
  function findEditorContainerByHeuristic(node) {
    let el = node;
    if (el && el.nodeType === 3 /* TEXT_NODE */) el = el.parentNode;
    if (!el || el.nodeType !== 1) return null;

    // 用 `[contenteditable]:not([contenteditable="false"])` 匹配：
    // contenteditable="true" / contenteditable="" / contenteditable="plaintext-only" 都算
    // 同时排除 false。比 `[contenteditable="true"]` 严格相等更宽。
    const EDITABLE_SELECTOR = '[contenteditable]:not([contenteditable="false"])';

    let bestContentEditable = null;
    let depth = 0;
    const MAX_DEPTH = 20;
    while (el && el !== document.body && depth < MAX_DEPTH) {
      if (el.isContentEditable) bestContentEditable = el;
      if (typeof el.querySelectorAll === 'function') {
        try {
          const editableChildren = el.querySelectorAll(EDITABLE_SELECTOR);
          if (editableChildren.length >= 3) return el; // 多块编辑器命中
        } catch (_) { /* ignore */ }
      }
      el = el.parentNode;
      depth++;
    }
    return bestContentEditable;
  }

  // Ctrl+A 专用强力兜底：4 个 tier 收集结果，**取最长的**——Ctrl+A 的意图就是"全部"。
  //
  // - Tier 1: selection.toString()                  —— 标准路径
  // - Tier 2: activeElement.value                    —— textarea/input
  // - Tier 3: range.commonAncestor.textContent       —— 选区跨多 block 时的"实际范围"
  // - Tier 4: 启发式编辑器容器 textContent          —— 跨过图片打断/多块编辑器的大杀器
  //
  // Tier 4 只在 allowAggressiveFallback=true 时启用（即 0ms 第一次 flush），150ms retry
  // 不启用——避免「用户 Ctrl+A → 50ms 内点别处 → 150ms retry 误抓整个编辑器」的 race。
  function readSelectAllText({ allowAggressiveFallback = false } = {}) {
    try {
      const sel = window.getSelection();
      const results = [];

      // Tier 1
      if (sel && sel.rangeCount > 0) {
        const t = sel.toString();
        if (t && t.trim().length > 0) results.push(t);
      }

      // Tier 2
      const fromActive = readSelectionFromActiveElement();
      if (fromActive) results.push(fromActive);

      // Tier 3：仅在有非折叠选区时启用（避免把"用户清掉选区"误当成"全选了"）
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed && sel.anchorNode) {
        try {
          const range = sel.getRangeAt(0);
          let container = range.commonAncestorContainer;
          if (container && container.nodeType === 3) container = container.parentNode;
          if (container && typeof container.textContent === 'string') {
            const t = container.textContent;
            if (t && t.trim().length > 0) results.push(t);
          }
        } catch (_) { /* ignore */ }
      }

      // Tier 4：启发式编辑器容器（仅 Ctrl+A 时启用）
      // 双源 fallback：先从 activeElement 找，找不到再从 sel.anchorNode 找
      // —— 应对编辑器把 focus 偷到隐藏元素的情况（Monaco/CodeMirror 风格）
      if (allowAggressiveFallback) {
        let container = findEditorContainerByHeuristic(document.activeElement);
        if (!container && sel && sel.anchorNode) {
          container = findEditorContainerByHeuristic(sel.anchorNode);
        }
        if (container && typeof container.textContent === 'string') {
          const t = container.textContent;
          if (t && t.trim().length > 0) results.push(t);
        }
      }

      if (results.length === 0) return '';
      // 取最长（Ctrl+A 意图 = 全部内容）
      let longest = results[0];
      for (const r of results) {
        if (r.length > longest.length) longest = r;
      }
      return longest;
    } catch (err) {
      log('读取全选文本失败:', err);
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

    if (state.selection === value) {
      return;
    }

    // ===== Ctrl+A 防退化闸 =====
    //
    // 问题：用户 Ctrl+A 时，0ms/150ms 的 flushSelectAll 用 Tier 4 已经拿到完整正文写入
    // state.selection 了。但 keyup / selectionchange 事件也会触发 updateSelection
    // → 200ms 防抖 → applySelection(readCurrentSelection())，而 readCurrentSelection
    // 只有 Tier 1/2 没有 Tier 4，在富文本+图片场景里只能拿到被图片打断的短文本。
    // 没有这个闸的话，长文本会被短文本覆盖。
    // 用户慢慢释放按键时 keyup 触发多次，bug 更明显。
    //
    // 拒绝条件（三个全部满足才拒绝）：
    //   1. 当前在 Ctrl+A 后的保护窗口内（3 秒）
    //   2. 新值为空，或非空但比当前更短（典型「临时空选区 / Tier 1 短文本踩 Tier 4 长文本」）
    //   3. 触发源不是用户主动行为 —— mouseup 始终通过（用户主动选了别的就是新意图），
    //      contextmenu 也通过（右键选项依赖最新选区）
    //
    // 注意：富文本编辑器慢速释放 Ctrl+A 时会短暂汇报空选区；这不是用户取消选择。
    // 真正的鼠标点击/拖选清空会走 mouseup，仍然允许通过。
    if (isSelectAllDegradation(value, hasContent, trigger)) {
      log('防退化闸拒绝', { trigger, oldLen: state.selection.length, newLen: value.length });
      return;
    }

    window.selectedText = value;
    if (hasContent) {
      window.lastNonEmptySelection = value;
    }

    state.selection = value;
    log('同步选中文本', { trigger, text: value });
    safeChromeSendMessage({
      action: 'selectionChanged',
      text: value,
      trigger,
      selectAllProtected: isWithinSelectAllProtect(),
      selectAllProtectUntil: state.selectAllProtectUntil || 0
    });
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
    // Ctrl+A / Cmd+A (select all) —— 多 tier 兜底，应对富文本编辑器（含图片）异步处理选区的场景。
    //
    // - setTimeout(0)：等浏览器完成默认全选动作后第一次尝试读取
    // - 用 readSelectAllText() 而非 readCurrentSelection()：多 Tier 1→2→3，
    //   Tier 3 直接取 contenteditable 根的 textContent，图片+文字混排里
    //   Selection API 读不全时也能拿到完整正文
    // - 150ms 重试：编辑器异步设置 selection（Ctrl+A 触发其内部 normalize 后才 commit）
    //   的兜底，例如 ProseMirror/Slate 等托管型富文本
    if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
      state.isUserSelecting = true;
      state.selectAllKeyActive = true;
      // 打开 SELECT_ALL_PROTECT_MS 防退化窗口。auto-repeat 和后续 keyup 都会延长窗口，
      // 覆盖「先松 A、Ctrl/⌘ 慢一点再松」这类富文本编辑器最容易退化的释放节奏。
      extendSelectAllProtect();
      const flushSelectAll = (label) => {
        const text = readSelectAllText({ allowAggressiveFallback: true });
        if (text && text.trim().length > 0) {
          applySelection(text, label); // 防退化逻辑已经在 applySelection 内
        }
      };
      setTimeout(() => flushSelectAll('select-all'), 0);
      setTimeout(() => flushSelectAll('select-all-retry'), 150);
    }
  });
  document.addEventListener('keyup', (event) => {
    if (state.selectAllKeyActive) {
      extendSelectAllProtect();
      if (event.key === 'Control' || event.key === 'Meta' || (!event.ctrlKey && !event.metaKey)) {
        state.selectAllKeyActive = false;
      }
    }
    // Always sync if there's a non-empty selection after keyup
    const currentSel = readCurrentSelection();
    const shouldUpdate = currentSel || event.key === 'Escape' || event.key === 'Enter' || event.key === 'Shift' || state.isUserSelecting;
    if (shouldUpdate) {
      updateSelection(event.key ? `keyup:${event.key}` : 'keyup');
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

  initAIPromptRelay();
  initUrlRecoveryOverlay();

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
      case 'ccsShowUrlRecovery':
        showUrlRecoveryOverlay(request.recovery || {});
        sendResponse?.({ ok: true });
        return true;
      case 'ccsFillChatGptPrompt':
      case 'ccsFillAIPrompt': {
        const text = typeof request.text === 'string' ? request.text : '';
        if (!text) {
          sendResponse?.({ ok: false, error: 'no-text' });
          return true;
        }
        const ackAction = request.action === 'ccsFillAIPrompt'
          ? 'ccsAckPendingAIPrompt'
          : 'ccsAckPendingChatGptPrompt';
        fillPendingAIPromptOnce({
          prompt: text,
          pendingId: request.pendingId,
          ackAction
        })
          .then((result) => {
            sendResponse?.(result);
          })
          .catch((error) => sendResponse?.({ ok: false, error: error?.message || 'fill-failed' }));
        return true;
      }
      case 'fetchSelectionSnapshot': {
        const preferEmpty = !!request.preferEmpty;
        const live = readCurrentSelection();
        let chosen = typeof live === 'string' ? live : '';
        let source = 'live';
        const protectedState = state.selection && state.selection.trim().length > 0 ? state.selection : '';

        if (
          protectedState &&
          isWithinSelectAllProtect() &&
          (!chosen.trim() || chosen.trim().length < protectedState.trim().length)
        ) {
          chosen = protectedState;
          source = 'protected-state';
        } else if (!chosen || !chosen.trim()) {
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
        } else if (state.selection !== chosen && !isSelectAllDegradation(chosen.trim(), true, 'snapshot')) {
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

  function initUrlRecoveryOverlay() {
    try {
      if (window.top !== window) return;
    } catch (_) {
      return;
    }
    waitForDOMReady()
      .then(() => sendRuntimeMessage({ action: 'ccsGetUrlRecovery' }))
      .then((response) => {
        if (response?.ok && response.recovery) {
          showUrlRecoveryOverlay(response.recovery);
        }
      })
      .catch(() => {});
  }

  function showUrlRecoveryOverlay(recovery) {
    if (!recovery || !recovery.id || !document.body) return;
    const existing = document.getElementById('ccs-url-recovery');
    if (existing) existing.remove();

    const statusText = recovery.statusCode
      ? `HTTP ${recovery.statusCode}`
      : (recovery.error || '页面打开失败');
    const originalLength = Number(recovery.originalLength || 0);
    const finalLength = Number(recovery.finalUrlLength || 0);

    const wrapper = document.createElement('div');
    wrapper.id = 'ccs-url-recovery';
    wrapper.style.cssText = `
      position: fixed;
      right: 20px;
      bottom: 20px;
      width: min(360px, calc(100vw - 40px));
      z-index: 2147483647;
      background: #111827;
      color: #fff;
      border: 1px solid rgba(255,255,255,0.16);
      border-radius: 8px;
      box-shadow: 0 18px 45px rgba(0,0,0,0.28);
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow: hidden;
    `;

    const body = document.createElement('div');
    body.style.cssText = 'padding: 14px 14px 12px;';

    const title = document.createElement('div');
    title.textContent = `触触搜检测到 ${statusText}`;
    title.style.cssText = 'font-weight: 700; font-size: 14px; margin-bottom: 6px;';

    const detail = document.createElement('div');
    detail.textContent = recovery.truncated
      ? `原内容 ${originalLength} 字，已生成安全版 URL（${finalLength} 字）。`
      : `这次跳转由触触搜发起，可复制原内容或用安全方式重试。`;
    detail.style.cssText = 'color: rgba(255,255,255,0.78); margin-bottom: 10px;';

    const preview = document.createElement('div');
    preview.textContent = recovery.originalPreview || '';
    preview.style.cssText = `
      display: ${recovery.originalPreview ? 'block' : 'none'};
      max-height: 54px;
      overflow: hidden;
      color: rgba(255,255,255,0.62);
      background: rgba(255,255,255,0.08);
      border-radius: 6px;
      padding: 8px;
      margin-bottom: 10px;
      word-break: break-word;
    `;

    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap;';

    const copyBtn = createRecoveryButton('复制原文');
    copyBtn.addEventListener('click', () => {
      sendRuntimeMessage({ action: 'ccsGetUrlRecoveryText', recoveryId: recovery.id, field: 'original' })
        .then((response) => {
          if (!response?.ok || typeof response.text !== 'string') throw new Error(response?.error || 'missing-text');
          return copyToClipboard(response.text);
        })
        .then(() => showInfoToast('已复制原文'))
        .catch(() => showErrorToast('复制失败'));
    });

    const retryBtn = createRecoveryButton('安全版重试');
    retryBtn.addEventListener('click', () => {
      sendRuntimeMessage({ action: 'ccsOpenUrlRecoverySafe', recoveryId: recovery.id })
        .then((response) => {
          if (!response?.ok) throw new Error(response?.error || 'open-failed');
          showInfoToast('已打开安全版');
        })
        .catch(() => showErrorToast('重试失败'));
    });

    const closeBtn = createRecoveryButton('关闭');
    closeBtn.addEventListener('click', () => {
      wrapper.remove();
      sendRuntimeMessage({ action: 'ccsDismissUrlRecovery' }).catch(() => {});
    });

    actions.append(copyBtn, retryBtn, closeBtn);
    body.append(title, detail, preview, actions);
    wrapper.append(body);
    document.body.appendChild(wrapper);
  }

  function createRecoveryButton(label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = `
      appearance: none;
      border: 1px solid rgba(255,255,255,0.22);
      background: rgba(255,255,255,0.1);
      color: #fff;
      border-radius: 6px;
      padding: 6px 9px;
      cursor: pointer;
      font: inherit;
      white-space: nowrap;
    `;
    button.addEventListener('mouseenter', () => { button.style.background = 'rgba(255,255,255,0.18)'; });
    button.addEventListener('mouseleave', () => { button.style.background = 'rgba(255,255,255,0.1)'; });
    return button;
  }

  function initAIPromptRelay() {
    if (!getSupportedAIEngineFromLocation()) return;

    let activeRequestKey = '';
    let relayResolved = false;
    let intervalId = null;
    const trigger = () => {
      if (relayResolved) return;
      const pendingId = getAIPendingIdFromLocation();
      if (!pendingId && hasAITextParamInLocation()) return;
      const requestKey = pendingId || 'tab-bound';
      if (requestKey === activeRequestKey) return;
      activeRequestKey = requestKey;
      requestAndFillPendingAIPrompt(pendingId)
        .then(() => {
          relayResolved = true;
          if (intervalId) clearInterval(intervalId);
        })
        .catch((error) => {
          log('AI prompt relay failed:', error);
          activeRequestKey = '';
        });
    };

    waitForDOMReady().then(trigger).catch(() => {});
    window.addEventListener('hashchange', trigger);
    window.addEventListener('popstate', trigger);

    let ticks = 0;
    intervalId = setInterval(() => {
      ticks += 1;
      trigger();
      if (ticks >= 40 || relayResolved) {
        clearInterval(intervalId);
      }
    }, 1000);
  }

  function getAIPendingIdFromLocation() {
    try {
      const url = new URL(window.location.href);
      const fromQuery = sanitizeChatGptPendingId(url.searchParams.get('ccs_pp'));
      if (fromQuery) return fromQuery;

      const hashText = (url.hash || '').replace(/^#/, '');
      const fromHashParams = sanitizeChatGptPendingId(new URLSearchParams(hashText).get('ccs_pp'));
      if (fromHashParams) return fromHashParams;

      const fromHash = hashText.match(/(?:^|[?&#])ccs_pp=([A-Za-z0-9_-]+)/);
      return sanitizeChatGptPendingId(fromHash?.[1] || '');
    } catch (err) {
      log('读取 AI prompt relay id 失败:', err);
      return '';
    }
  }

  function hasAITextParamInLocation() {
    try {
      const url = new URL(window.location.href);
      for (const key of ['prompt', 'q', 'query', 'text']) {
        const value = url.searchParams.get(key);
        if (value && value.trim()) return true;
      }
    } catch (_) {
      // ignore
    }
    return false;
  }

  function sanitizeChatGptPendingId(value) {
    const id = typeof value === 'string' ? value.trim() : '';
    return /^[A-Za-z0-9_-]{6,80}$/.test(id) ? id : '';
  }

  async function requestAndFillPendingAIPrompt(pendingId) {
    const response = await sendRuntimeMessage({
      action: 'ccsGetPendingAIPrompt',
      pendingId
    });
    if (!response?.ok || typeof response.prompt !== 'string') {
      throw new Error(response?.error || 'pending-prompt-not-found');
    }

    const result = await fillPendingAIPromptOnce({
      prompt: response.prompt,
      pendingId: response.pendingId || pendingId,
      ackAction: 'ccsAckPendingAIPrompt'
    });
    if (!result.ok) {
      throw new Error(result.error || 'fill-failed');
    }
    return result;
  }

  async function fillPendingAIPromptOnce({ prompt, pendingId, ackAction }) {
    const text = typeof prompt === 'string' ? prompt : '';
    if (!text) return { ok: false, error: 'no-text' };

    const key = makeAIPromptFillKey(pendingId, text);
    if (aiPromptFillDone.has(key)) {
      // push/pull 竞态时第二次进来——本次已经填过了。
      // **不要无脑 refill**：如果用户已经点了发送（编辑器被清空），refill 会把 prompt 又塞回去。
      // 只在编辑器仍有非空内容时做一次"巩固"（覆盖 Lexical revert 场景）。
      const target = findChatGptComposerTarget();
      if (target && normalizeFilledText(readEditableText(target))) {
        const result = fillChatGptPromptOnce(text);
        return result.ok ? { ...result, skipped: true, reason: 'already-filled' } : result;
      }
      return { ok: true, skipped: true, reason: 'already-filled-user-cleared' };
    }
    if (aiPromptFillInFlight.has(key)) {
      return { ok: false, error: 'fill-in-progress' };
    }

    aiPromptFillInFlight.add(key);
    try {
      const result = await fillChatGptPrompt(text, { attempts: 80, intervalMs: 500 });
      if (!result.ok) return result;
      const stableResult = await stabilizeAIPromptFill(text);
      if (!stableResult.ok) return stableResult;

      aiPromptFillDone.add(key);
      cleanupChatGptRelayUrl();
      showInfoToast('已自动补充完整提示词，请确认后发送');
      if (pendingId && ackAction) {
        await sendRuntimeMessage({ action: ackAction, pendingId });
      }
      return result;
    } finally {
      aiPromptFillInFlight.delete(key);
    }
  }

  async function stabilizeAIPromptFill(text) {
    // 检查窗口覆盖 Lexical 之类 reconcile 撤回（典型 50-500ms 内），但不能太长——
    // 否则会和用户提交动作抢编辑器（提交后 Yiyan 清空，stabilize 重填，prompt 又出现）。
    for (const delayMs of [120, 350, 700]) {
      await sleep(delayMs);
      const target = findChatGptComposerTarget();
      if (!target) return { ok: true };

      // 已是正确状态，跳过本轮重填
      if (editableAcceptsFilledText(target, text)) continue;

      // 编辑器跟预期不符。两种可能：
      //   A. 完全空 —— 用户主动操作（提交、Backspace、清空），**不能争抢**
      //   B. 有内容但不对 —— Lexical 之类 reconcile 撤回了格式，重填一次
      const currentText = normalizeFilledText(readEditableText(target));
      if (!currentText) return { ok: true };

      const result = fillChatGptPromptOnce(text);
      if (!result.ok) return result;
    }
    return { ok: true };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function makeAIPromptFillKey(pendingId, text) {
    const id = sanitizeChatGptPendingId(pendingId);
    if (id) return `id:${id}`;
    const normalized = normalizeFilledText(text);
    return `text:${normalized.length}:${normalized.slice(0, 80)}:${normalized.slice(-80)}`;
  }

  function fillChatGptPrompt(text, options = {}) {
    const prompt = typeof text === 'string' ? text : '';
    const attempts = Number.isFinite(options.attempts) ? options.attempts : 30;
    const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 400;

    return new Promise((resolve) => {
      let count = 0;
      const tryFill = () => {
        count += 1;
        const result = fillChatGptPromptOnce(prompt);
        if (result.ok || count >= attempts) {
          resolve(result.ok ? result : { ok: false, error: result.error || 'composer-not-found' });
          return;
        }
        setTimeout(tryFill, intervalMs);
      };
      waitForDOMReady().then(tryFill).catch(() => tryFill());
    });
  }

  function fillChatGptPromptOnce(text) {
    if (!text) return { ok: false, error: 'no-text' };
    const target = findChatGptComposerTarget();
    if (!target) return { ok: false, error: 'composer-not-found' };

    try {
      const tag = (target.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'input') {
        setInputLikeValue(target, text);
      } else {
        setContentEditableValue(target, text);
      }
      const verified = editableAcceptsFilledText(target, text);
      return verified ? { ok: true } : { ok: false, error: 'fill-not-verified' };
    } catch (error) {
      return { ok: false, error: error?.message || 'fill-failed' };
    }
  }

  function findChatGptComposerTarget() {
    const selectors = [
      '#prompt-textarea',
      '[data-testid="prompt-textarea"]',
      'textarea[name="q"]',
      'input[name="q"]',
      'input[type="search"]',
      'input[aria-label*="Search"]',
      'input[aria-label*="搜索"]',
      'textarea[aria-label*="Search"]',
      'textarea[aria-label*="搜索"]',
      'textarea[placeholder]',
      'textarea',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][role="combobox"]',
      '[contenteditable="true"]'
    ];

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      const target = nodes.find(isEditableComposerCandidate);
      if (target) return target;
    }
    return null;
  }

  function isEditableComposerCandidate(element) {
    if (!(element instanceof HTMLElement)) return false;
    const tag = (element.tagName || '').toLowerCase();
    const editable = tag === 'textarea' || tag === 'input' || element.isContentEditable || element.getAttribute('contenteditable') === 'true';
    if (!editable) return false;
    if (element.disabled || element.readOnly) return false;
    if (element.getAttribute('aria-disabled') === 'true') return false;
    if (element.id === 'prompt-textarea' || element.getAttribute('data-testid') === 'prompt-textarea') return true;
    return isElementVisibleEnough(element);
  }

  function isElementVisibleEnough(element) {
    try {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (_) {
      return true;
    }
  }

  function setInputLikeValue(element, text) {
    element.focus();
    const proto = Object.getPrototypeOf(element);
    const ownDescriptor = Object.getOwnPropertyDescriptor(element, 'value');
    const protoDescriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
    const setter = protoDescriptor?.set || ownDescriptor?.set;
    if (setter) setter.call(element, text);
    else element.value = text;
    dispatchEditableEvents(element);
  }

  function setContentEditableValue(element, text) {
    element.focus();
    if (editableAcceptsFilledText(element, text)) return;

    // 关键设计：native trusted execCommand 路径优先；合成 paste 因 isTrusted=false 不可靠，降到 tier 5。
    // 每条 tier 成功后都 dispatchEditableEvents 保证 React controlled state 同步。

    // Tier 1: execCommand('insertHTML') —— Chrome 内核发 beforeinput(isTrusted=true)，
    // ProseMirror / Lexical RichText / 接受段落 schema 的 React 编辑器都正经处理。
    clearContentEditable(element);
    if (insertHtmlIntoContentEditable(element, text)) {
      if (editableAcceptsFilledText(element, text) && contentEditableHasStructuralLineBreaks(element, text)) {
        dispatchEditableEvents(element);
        return;
      }
    }

    // Tier 2: execCommand('insertText') 整段多行 —— Chrome 内核 trusted insertText。
    // Lexical PlainText / 简单 contenteditable / yiyan 这类"不接受 <p> 但处理 \n"的编辑器走这条。
    clearContentEditable(element);
    if (insertBulkTextIntoContentEditable(element, text)) {
      if (editableAcceptsFilledText(element, text) && contentEditableHasStructuralLineBreaks(element, text)) {
        dispatchEditableEvents(element);
        return;
      }
    }

    // Tier 3: 逐行 insertText + insertLineBreak
    clearContentEditable(element);
    insertContentEditableText(element, text, 'line-break');
    if (editableAcceptsFilledText(element, text) && contentEditableHasStructuralLineBreaks(element, text)) {
      dispatchEditableEvents(element);
      return;
    }

    // Tier 4: 逐行 insertText + insertParagraph
    clearContentEditable(element);
    insertContentEditableText(element, text, 'paragraph');
    if (editableAcceptsFilledText(element, text) && contentEditableHasStructuralLineBreaks(element, text)) {
      dispatchEditableEvents(element);
      return;
    }

    // Tier 5: 合成 ClipboardEvent('paste') —— fallback for editors that ONLY accept paste（非 React 系老编辑器）
    clearContentEditable(element);
    if (pasteIntoContentEditable(element, text)) {
      if (editableAcceptsFilledText(element, text) && contentEditableHasStructuralLineBreaks(element, text)) {
        dispatchEditableEvents(element);
        return;
      }
    }

    // Tier 6: 直接 DOM replaceChildren —— 最后兜底
    clearContentEditable(element);
    setContentEditablePlainText(element, text);
    dispatchEditableEvents(element);
  }

  function insertBulkTextIntoContentEditable(element, text) {
    try {
      selectAllInContentEditable(element);
      const normalized = String(text || '').replace(/\r\n?/g, '\n');
      return !!document.execCommand?.('insertText', false, normalized);
    } catch (_) {
      return false;
    }
  }

  function insertHtmlIntoContentEditable(element, text) {
    try {
      selectAllInContentEditable(element);
      const html = buildPasteHtml(String(text || '').replace(/\r\n?/g, '\n'));
      return !!document.execCommand?.('insertHTML', false, html);
    } catch (_) {
      return false;
    }
  }

  function pasteIntoContentEditable(element, text) {
    const normalized = String(text || '').replace(/\r\n?/g, '\n');
    if (typeof DataTransfer !== 'function' || typeof ClipboardEvent !== 'function') return false;

    let data;
    try {
      data = new DataTransfer();
      data.setData('text/plain', normalized);
      data.setData('text/html', buildPasteHtml(normalized));
    } catch (_) {
      return false;
    }

    let event;
    try {
      event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data });
    } catch (_) {
      return false;
    }

    if (event.clipboardData !== data) {
      try {
        Object.defineProperty(event, 'clipboardData', { value: data, configurable: true });
      } catch (_) {
        // ignore — some editors read DataTransfer via getData on event.clipboardData,
        // others probe Window.event; if both fail we'll just fall through to execCommand.
      }
    }

    try {
      selectAllInContentEditable(element);
      const notCanceled = element.dispatchEvent(event);
      // dispatchEvent === false 表示有 listener 调了 preventDefault，
      // 也就是编辑器自己的 paste handler 消费了这次粘贴，对我们来说是成功。
      return notCanceled === false;
    } catch (_) {
      return false;
    }
  }

  function buildPasteHtml(text) {
    const escape = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // 每个非空行一个 <p>。**跳过空行** —— ProseMirror/Lexical 不允许 <p><br></p> 这种
    // "段内 hard-break in paragraph" 非法节点，遇到会把整段 HTML 退化为 plain-text 抽取，
    // 结构全丢。段落间隙由编辑器的 CSS margin 自然处理。
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter((line) => line.length > 0);
    return lines.map((line) => `<p>${escape(line)}</p>`).join('');
  }

  function selectAllInContentEditable(element) {
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(range);
    } catch (_) {
      // ignore
    }
  }

  function insertContentEditableText(element, text, lineMode = 'line-break') {
    const normalized = String(text || '').replace(/\r\n?/g, '\n');
    if (normalized.includes('\n')) {
      return insertMultilineTextIntoContentEditable(element, normalized, lineMode);
    }
    return insertPlainTextIntoContentEditable(element, normalized);
  }

  function contentEditableHasStructuralLineBreaks(element, text) {
    const expectedBreaks = countOccurrences(String(text || '').replace(/\r\n?/g, '\n'), '\n');
    if (expectedBreaks === 0) return true;
    try {
      return element.querySelectorAll?.('br, p, div, li, [data-block], [data-node-type]').length > 0;
    } catch (_) {
      return false;
    }
  }

  function insertPlainTextIntoContentEditable(element, text) {
    try {
      placeCaretAtEnd(element);
      return !!document.execCommand?.('insertText', false, text);
    } catch (_) {
      return false;
    }
  }

  function insertMultilineTextIntoContentEditable(element, text, lineMode) {
    try {
      placeCaretAtEnd(element);
      const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
      let inserted = true;
      lines.forEach((line, index) => {
        if (index > 0) {
          const command = lineMode === 'paragraph' ? 'insertParagraph' : 'insertLineBreak';
          const brokeLine = document.execCommand?.(command, false);
          if (!brokeLine) inserted = false;
        }
        if (line) {
          const wroteLine = document.execCommand?.('insertText', false, line);
          if (!wroteLine) inserted = false;
        }
      });
      return inserted;
    } catch (_) {
      return false;
    }
  }

  function placeCaretAtEnd(element) {
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse?.(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    } catch (_) {
      // ignore
    }
  }

  function clearContentEditable(element) {
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand?.('delete', false);
      selection?.removeAllRanges();
    } catch (_) {
      // ignore
    }

    if (normalizeFilledText(readEditableText(element))) {
      element.replaceChildren?.();
      element.textContent = '';
    }
  }

  function setContentEditablePlainText(element, text) {
    const normalized = String(text || '').replace(/\r\n?/g, '\n');
    const fragment = document.createDocumentFragment();
    const lines = normalized.split('\n');
    lines.forEach((line, index) => {
      if (index > 0) fragment.appendChild(document.createElement('br'));
      fragment.appendChild(document.createTextNode(line));
    });
    if (typeof element.replaceChildren === 'function') {
      element.replaceChildren(fragment);
    } else {
      element.textContent = '';
      element.appendChild(fragment);
    }
  }

  function dispatchEditableEvents(element) {
    // 用 InputEvent (带 inputType) 派发——React 的 onInput / Lexical 的 update listener
    // 才会把它当成真实输入触发 controlled state 同步。普通 Event 在某些编辑器（如 yiyan）
    // 上不被识别，会出现"DOM 有内容但 state 空"的提交报错。
    let inputEvent;
    try {
      inputEvent = new InputEvent('input', {
        inputType: 'insertReplacementText',
        bubbles: true,
        cancelable: true
      });
    } catch (_) {
      inputEvent = new Event('input', { bubbles: true, cancelable: true });
    }
    element.dispatchEvent(inputEvent);

    // Yiyan / 百度系中文 IME 优化编辑器：state 在 compositionend 上 commit，
    // 不在 input 上 commit。补一发 compositionend 让 state 同步。
    try {
      if (typeof CompositionEvent === 'function') {
        const compEvent = new CompositionEvent('compositionend', {
          data: readEditableText(element),
          bubbles: true,
          cancelable: true
        });
        element.dispatchEvent(compEvent);
      }
    } catch (_) {
      // ignore
    }

    element.dispatchEvent(new Event('change', { bubbles: true }));

    // 一些 React 编辑器只在 blur 时把 controlled value 写到表单 state。
    // 不真的失焦——只触发 blur 事件让 listener 跑一遍；然后立刻 focus 回来。
    try {
      element.dispatchEvent(new Event('blur', { bubbles: true }));
      element.dispatchEvent(new Event('focus', { bubbles: true }));
    } catch (_) {
      // ignore
    }
  }

  function editableAcceptsFilledText(element, text) {
    const value = normalizeFilledText(readEditableText(element));
    const expected = normalizeFilledText(text);
    if (!expected) return !value;
    if (value === expected) return true;
    if (!hasRequiredLineBreakStructure(value, expected)) return false;

    // ProseMirror/Lexical 经常吃掉空行（只保留结构性段落分隔），
    // 比较前先把 \n{2,} 折叠为 \n，让"段落分隔有 / 段间空行没"也算成功。
    const expectedCollapsed = collapseBlankLines(expected);
    const valueCollapsed = collapseBlankLines(value);

    const head = expectedCollapsed.slice(0, Math.min(100, expectedCollapsed.length));
    const tail = expectedCollapsed.slice(Math.max(0, expectedCollapsed.length - 100));
    if (head.length < 20 || tail.length < 20) return false;
    const headCount = countOccurrences(valueCollapsed, head);
    const tailCount = countOccurrences(valueCollapsed, tail);
    if (headCount !== 1 || tailCount !== 1) return false;

    const start = valueCollapsed.indexOf(head);
    const end = valueCollapsed.lastIndexOf(tail) + tail.length;
    if (start < 0 || end <= start) return false;
    return collapseBlankLines(normalizeFilledText(valueCollapsed.slice(start, end))) === expectedCollapsed;
  }

  function hasRequiredLineBreakStructure(value, expected) {
    // 同样：用折叠后的 \n 计数 —— 否则编辑器一吃空行就破 80% 阈值导致后续 fallback 错误清空。
    const expectedCollapsed = collapseBlankLines(expected);
    const valueCollapsed = collapseBlankLines(value);
    const expectedBreaks = countOccurrences(expectedCollapsed, '\n');
    if (expectedBreaks === 0) return true;
    const valueBreaks = countOccurrences(valueCollapsed, '\n');
    if (valueBreaks < Math.max(1, Math.floor(expectedBreaks * 0.8))) return false;

    const expectedLines = expectedCollapsed.split('\n').filter((line) => line.trim().length >= 6);
    if (expectedLines.length < 2) return true;
    const sampleLines = [
      expectedLines[0],
      expectedLines[Math.floor(expectedLines.length / 2)],
      expectedLines[expectedLines.length - 1]
    ];
    return sampleLines.every((line) => value.includes(line));
  }

  function collapseBlankLines(s) {
    return String(s || '').replace(/\n{2,}/g, '\n');
  }

  function readEditableText(element) {
    if (typeof element.value === 'string') return element.value;
    return element.innerText || element.textContent || '';
  }

  function normalizeFilledText(value) {
    return String(value || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .trim();
  }

  function countOccurrences(value, needle) {
    if (!needle) return 0;
    let count = 0;
    let index = 0;
    while (index <= value.length) {
      const found = value.indexOf(needle, index);
      if (found === -1) break;
      count++;
      index = found + needle.length;
    }
    return count;
  }

  function cleanupChatGptRelayUrl() {
    try {
      const url = new URL(window.location.href);
      let changed = false;
      if (url.searchParams.has('ccs_pp')) {
        url.searchParams.delete('ccs_pp');
        changed = true;
      }
      const hashText = (url.hash || '').replace(/^#/, '');
      if (hashText) {
        const hashParams = new URLSearchParams(hashText);
        if (hashParams.has('ccs_pp')) {
          hashParams.delete('ccs_pp');
          url.hash = hashParams.toString();
          changed = true;
        }
      }
      if (changed) {
        window.history.replaceState(window.history.state, document.title, url.toString());
      }
    } catch (err) {
      log('清理 ChatGPT relay URL 失败:', err);
    }
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      try {
        if (!chrome?.runtime?.id) {
          resolve({ ok: false, error: 'runtime-unavailable' });
          return;
        }
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message || 'runtime-error' });
            return;
          }
          resolve(response);
        });
      } catch (error) {
        resolve({ ok: false, error: error?.message || 'runtime-error' });
      }
    });
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
