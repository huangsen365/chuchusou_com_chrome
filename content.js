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
    lastSelectAllTime: 0
  };
  const SELECT_ALL_PROTECT_MS = 3000;

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

  function getSupportedAIEngineFromLocation() {
    try {
      const host = window.location.hostname.toLowerCase();
      if (host === 'chatgpt.com' || host.endsWith('.chatgpt.com')) return 'chatgpt';
      if (host === 'claude.ai' || host.endsWith('.claude.ai')) return 'claude';
      if (host === 'grok.com' || host.endsWith('.grok.com')) return 'grok';
      if (host === 'yiyan.baidu.com') return 'yiyan';
      if ((host === 'google.com' || host.endsWith('.google.com')) && new URL(window.location.href).searchParams.get('udm') === '50') {
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
    window.selectedText = value;
    if (hasContent) {
      window.lastNonEmptySelection = value;
    }

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
    //   2. 新值是非空且比当前更短（典型「Tier 1 短文本踩 Tier 4 长文本」）
    //   3. 触发源不是用户主动行为 —— mouseup 始终通过（用户主动选了别的就是新意图），
    //      contextmenu 也通过（右键选项依赖最新选区）
    //
    // 用户清空选区（value === ''）始终通过 —— 明确的取消意图，要让 BG 知道。
    const isWithinSelectAllProtect =
      state.lastSelectAllTime && Date.now() - state.lastSelectAllTime < SELECT_ALL_PROTECT_MS;
    const isShorterDegradation = hasContent && value.length < (state.selection || '').length;
    const isUserInitiatedTrigger = trigger === 'mouseup' || trigger === 'contextmenu' || trigger === 'init';
    if (isWithinSelectAllProtect && isShorterDegradation && !isUserInitiatedTrigger) {
      log('防退化闸拒绝', { trigger, oldLen: state.selection.length, newLen: value.length });
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
      // 打开 SELECT_ALL_PROTECT_MS 防退化窗口。auto-repeat 时每次都会刷新这个时间戳
      // → 用户按住按键多久，窗口就延长多久。释放按键后再过 3 秒才完全失效。
      state.lastSelectAllTime = Date.now();
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

  initAIPromptRelay();

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
      case 'ccsFillChatGptPrompt':
      case 'ccsFillAIPrompt': {
        const text = typeof request.text === 'string' ? request.text : '';
        if (!text) {
          sendResponse?.({ ok: false, error: 'no-text' });
          return true;
        }
        fillChatGptPrompt(text, { attempts: 80, intervalMs: 500 })
          .then(async (result) => {
            if (result.ok && request.pendingId) {
              cleanupChatGptRelayUrl();
              showInfoToast('已自动补充完整提示词，请确认后发送');
              const ackAction = request.action === 'ccsFillAIPrompt'
                ? 'ccsAckPendingAIPrompt'
                : 'ccsAckPendingChatGptPrompt';
              await sendRuntimeMessage({ action: ackAction, pendingId: request.pendingId });
            }
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

  function initAIPromptRelay() {
    if (!getSupportedAIEngineFromLocation()) return;

    let activeRequestKey = '';
    let relayResolved = false;
    let intervalId = null;
    const trigger = () => {
      if (relayResolved) return;
      const pendingId = getAIPendingIdFromLocation();
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

    const result = await fillChatGptPrompt(response.prompt, { attempts: 80, intervalMs: 500 });
    if (!result.ok) {
      throw new Error(result.error || 'fill-failed');
    }

    await sendRuntimeMessage({ action: 'ccsAckPendingAIPrompt', pendingId: response.pendingId || pendingId });
    cleanupChatGptRelayUrl();
    showInfoToast('已自动补充完整提示词，请确认后发送');
    return result;
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
      const verified = editableContainsText(target, text);
      return verified ? { ok: true } : { ok: false, error: 'fill-not-verified' };
    } catch (error) {
      return { ok: false, error: error?.message || 'fill-failed' };
    }
  }

  function findChatGptComposerTarget() {
    const selectors = [
      '#prompt-textarea',
      '[data-testid="prompt-textarea"]',
      'textarea[placeholder]',
      'textarea',
      '[contenteditable="true"][role="textbox"]',
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
    pasteTextIntoContentEditable(element, text);
    if (editableContainsText(element, text)) {
      dispatchEditableEvents(element);
      return;
    }

    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const inserted = document.execCommand?.('insertText', false, text);
      if (!inserted || !editableContainsText(element, text)) {
        element.textContent = text;
      }
    } catch (_) {
      element.textContent = text;
    }
    dispatchEditableEvents(element);
  }

  function pasteTextIntoContentEditable(element, text) {
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(range);

      if (typeof window.DataTransfer !== 'function' || typeof window.ClipboardEvent !== 'function') return false;
      const data = new window.DataTransfer();
      data.setData('text/plain', text);
      const event = new window.ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: data
      });
      element.dispatchEvent(event);
      return true;
    } catch (err) {
      log('模拟粘贴完整提示词失败:', err);
      return false;
    }
  }

  function dispatchEditableEvents(element) {
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function editableContainsText(element, text) {
    const value = typeof element.value === 'string'
      ? element.value
      : (element.innerText || element.textContent || '');
    if (value === text) return true;
    const head = text.slice(0, Math.min(80, text.length));
    const tail = text.slice(Math.max(0, text.length - 80));
    return !!head && value.includes(head) && (!tail || value.includes(tail));
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
