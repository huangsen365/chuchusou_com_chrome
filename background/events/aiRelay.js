/**
 * AI 站点投递：长 prompt 走 relay、文心 Slate 输入框主世界填充、待投递 prompt 的领取与确认。
 */

async function ccsFillYiyanSlatePromptMainWorld(rawText) {
  const text = typeof rawText === 'string' ? rawText : '';
  if (!text) return { ok: false, error: 'no-text' };

  function normalize(value) {
    return String(value || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .trim();
  }

  function readEditableText(element) {
    return element?.innerText || element?.textContent || '';
  }

  function acceptsText(element, expectedText) {
    const actual = normalize(readEditableText(element));
    const expected = normalize(expectedText);
    if (actual === expected) return true;
    if (expected.length < 40) return actual.includes(expected);
    const head = expected.slice(0, Math.min(120, expected.length));
    const tail = expected.slice(Math.max(0, expected.length - 120));
    return actual.includes(head) && actual.includes(tail);
  }

  function isVisible(element) {
    try {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        style.opacity !== '0' && rect.width > 0 && rect.height > 0;
    } catch (_) {
      return true;
    }
  }

  function findEditorElement() {
    const selectors = [
      '[contenteditable="true"][data-slate-editor="true"][role="textbox"]',
      '[contenteditable="true"][data-slate-editor="true"]',
      '[contenteditable="true"][role="textbox"]'
    ];
    for (const selector of selectors) {
      const candidate = Array.from(document.querySelectorAll(selector)).find(isVisible);
      if (candidate) return candidate;
    }
    return null;
  }

  function isSlateEditor(value) {
    return !!value && typeof value === 'object' &&
      Array.isArray(value.children) &&
      typeof value.apply === 'function' &&
      typeof value.insertText === 'function' &&
      'selection' in value;
  }

  function scanForSlateEditor(root, maxDepth = 6) {
    const queue = [{ value: root, depth: 0 }];
    const seen = new WeakSet();
    while (queue.length) {
      const { value, depth } = queue.shift();
      if (!value || (typeof value !== 'object' && typeof value !== 'function')) continue;
      if (seen.has(value)) continue;
      seen.add(value);
      if (isSlateEditor(value)) return value;
      if (depth >= maxDepth) continue;
      let keys = [];
      try { keys = Object.keys(value).slice(0, 80); } catch (_) { keys = []; }
      for (const key of keys) {
        let child;
        try { child = value[key]; } catch (_) { continue; }
        if (child && (typeof child === 'object' || typeof child === 'function')) {
          queue.push({ value: child, depth: depth + 1 });
        }
      }
    }
    return null;
  }

  function findSlateEditor(element) {
    const fiberKeys = Object.keys(element).filter((key) => key.startsWith('__reactFiber'));
    for (const fiberKey of fiberKeys) {
      let fiber = element[fiberKey];
      for (let depth = 0; fiber && depth < 18; depth += 1, fiber = fiber.return) {
        const direct = [
          fiber.memoizedProps?.node,
          fiber.memoizedProps?.children?.props?.node,
          fiber.pendingProps?.node,
          fiber.pendingProps?.children?.props?.node
        ];
        const foundDirect = direct.find(isSlateEditor);
        if (foundDirect) return foundDirect;

        const foundInProps = scanForSlateEditor(fiber.memoizedProps, 4) ||
          scanForSlateEditor(fiber.pendingProps, 4);
        if (foundInProps) return foundInProps;

        let hook = fiber.memoizedState;
        for (let hookIndex = 0; hook && hookIndex < 24; hookIndex += 1, hook = hook.next) {
          const foundInHook = scanForSlateEditor(hook.memoizedState, 4) ||
            scanForSlateEditor(hook.baseState, 4);
          if (foundInHook) return foundInHook;
        }
      }
    }
    return null;
  }

  function pointFromTextNode(children, reverse) {
    const walk = (nodes, path) => {
      const list = reverse ? Array.from(nodes || []).map((node, index) => [node, index]).reverse() :
        Array.from(nodes || []).map((node, index) => [node, index]);
      for (const [node, index] of list) {
        const nextPath = path.concat(index);
        if (node && typeof node.text === 'string') {
          return { path: nextPath, offset: reverse ? node.text.length : 0 };
        }
        if (node?.children) {
          const found = walk(node.children, nextPath);
          if (found) return found;
        }
      }
      return null;
    };
    return walk(children, []);
  }

  function samePoint(a, b) {
    return !!a && !!b && a.offset === b.offset &&
      Array.isArray(a.path) && Array.isArray(b.path) &&
      a.path.length === b.path.length &&
      a.path.every((part, index) => part === b.path[index]);
  }

  function selectRange(editor, anchor, focus) {
    if (!anchor || !focus) return false;
    if (typeof editor.select === 'function') {
      editor.select({ anchor, focus });
      return true;
    }
    editor.selection = { anchor, focus };
    return true;
  }

  function clearSlateEditor(editor) {
    const start = pointFromTextNode(editor.children, false);
    const end = pointFromTextNode(editor.children, true);
    if (!start || !end) return false;

    selectRange(editor, start, end);
    if (!samePoint(start, end) && typeof editor.deleteFragment === 'function') {
      editor.deleteFragment();
    }

    const nextStart = pointFromTextNode(editor.children, false) || { path: [0, 0], offset: 0 };
    const nextEnd = pointFromTextNode(editor.children, true) || nextStart;
    selectRange(editor, nextStart, nextEnd);
    if (!samePoint(nextStart, nextEnd) && typeof editor.deleteFragment === 'function') {
      editor.deleteFragment();
    }

    const caret = pointFromTextNode(editor.children, false) || { path: [0, 0], offset: 0 };
    selectRange(editor, caret, caret);
    return true;
  }

  function dispatchBestEffortEvents(element, insertedText) {
    try {
      element.dispatchEvent(new InputEvent('input', {
        inputType: 'insertReplacementText',
        data: insertedText,
        bubbles: true,
        cancelable: true
      }));
    } catch (_) {
      try { element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true })); } catch (_) { /* noop */ }
    }
    try { element.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) { /* noop */ }
  }

  function waitForRender() {
    return new Promise((resolve) => {
      try {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      } catch (_) {
        setTimeout(resolve, 80);
      }
    });
  }

  const element = findEditorElement();
  if (!element) return { ok: false, error: 'composer-not-found' };
  const editor = findSlateEditor(element);
  if (!editor) return { ok: false, error: 'slate-editor-not-found' };

  const beforeLength = normalize(readEditableText(element)).length;
  try { element.focus({ preventScroll: true }); } catch (_) { try { element.focus(); } catch (__) { /* noop */ } }

  try {
    clearSlateEditor(editor);
    editor.insertText(text);
    dispatchBestEffortEvents(element, text);
    await waitForRender();
  } catch (error) {
    return { ok: false, error: error?.message || String(error), method: 'yiyan-slate-main-world' };
  }

  const afterLength = normalize(readEditableText(element)).length;
  return {
    ok: acceptsText(element, text),
    method: 'yiyan-slate-main-world',
    beforeLength,
    afterLength
  };
}

async function ccsFillYiyanSlatePromptFromContent(sender, text) {
  const tabId = typeof sender?.tab?.id === 'number' ? sender.tab.id : null;
  if (tabId == null) return { ok: false, error: 'missing-tab' };

  const senderUrl = sender?.url || sender?.tab?.url || '';
  let senderAllowed = false;
  try {
    const parsed = new URL(senderUrl);
    // Deliberately legacy-only: chat.baidu.com is a normal textarea and must
    // never receive the old MAIN-world Slate editor injection.
    senderAllowed = parsed.hostname.toLowerCase() === 'yiyan.baidu.com';
  } catch (_) {
    senderAllowed = false;
  }
  if (!senderAllowed) return { ok: false, error: 'sender-not-yiyan' };

  if (!chrome?.scripting?.executeScript) {
    return { ok: false, error: 'scripting-unavailable' };
  }

  const target = { tabId };
  if (typeof sender?.frameId === 'number') target.frameIds = [sender.frameId];

  const results = await chrome.scripting.executeScript({
    target,
    world: 'MAIN',
    func: ccsFillYiyanSlatePromptMainWorld,
    args: [String(text || '')]
  });
  const result = results?.find((entry) => entry?.result)?.result;
  return result || { ok: false, error: 'empty-main-world-result' };
}

async function ccsOpenMenuUrlWithAIRelay(urlPattern, text, fallbackUrl, meta = {}) {
  if (
    typeof ccsIsSupportedAIUrl === 'function' &&
    typeof ccsPrepareAIPromptUrl === 'function' &&
    typeof ccsOpenPreparedAIPromptUrl === 'function' &&
    ccsIsSupportedAIUrl(fallbackUrl)
  ) {
    try {
      const preparedUrl = await ccsPrepareAIPromptUrl(urlPattern || fallbackUrl, text, meta);
      await ccsOpenPreparedAIPromptUrl(preparedUrl, { active: meta.active });
      return;
    } catch (error) {
      if (typeof BG_DBG === 'function') {
        BG_DBG('[ccsOpenMenuUrlWithAIRelay] fallback', meta?.menuId || '', error);
      }
    }
  }
  if (
    urlPattern &&
    typeof ccsPrepareRegularUrl === 'function' &&
    typeof ccsOpenUrlWithRecovery === 'function'
  ) {
    try {
      const prepared = ccsPrepareRegularUrl(urlPattern, text, {
        source: meta.source || 'execute-menu-action',
        menuId: meta.menuId || '',
        engineId: meta.engineId || '',
        tabId: meta.tabId
      });
      await ccsOpenUrlWithRecovery(prepared.url, prepared.record, { active: meta.active });
      return;
    } catch (error) {
      if (typeof BG_DBG === 'function') {
        BG_DBG('[ccsOpenMenuUrlWithAIRelay] regular fallback', meta?.menuId || '', error);
      }
    }
  }
  const createOptions = { url: fallbackUrl };
  if (meta.active !== undefined) createOptions.active = meta.active;
  chrome.tabs.create(createOptions);
}

async function ccsOpenPromptUrlPattern(urlPattern, prompt, meta = {}) {
  if (!urlPattern || typeof urlPattern !== 'string') return false;
  const fallbackUrl = urlPattern.replace('${PROMPT}', encodeURIComponent(prompt || ''));
  await ccsOpenMenuUrlWithAIRelay(urlPattern, prompt, fallbackUrl, meta);
  return true;
}

function ccsHandleFillYiyanSlatePromptInMainWorld(request, sender, sendResponse) {
  const text = typeof request.text === 'string' ? request.text : '';
  const respond = ccsCreateSafeResponder(sendResponse, 'ccsFillYiyanSlatePromptInMainWorld', ccsCreateRequestId('ccsFillYiyanSlatePromptInMainWorld'), 4000);
  ccsFillYiyanSlatePromptFromContent(sender, text)
    .then((result) => respond(result))
    .catch((error) => respond({ ok: false, error: error?.message || String(error) }));
  return true;
}

function ccsHandleGetPendingAIPrompt(request, sender, sendResponse) {
  const pendingId = typeof request.pendingId === 'string' ? request.pendingId : '';
  const tabId = typeof sender?.tab?.id === 'number' ? sender.tab.id : null;
  const respond = ccsCreateSafeResponder(sendResponse, 'ccsGetPendingAIPrompt', pendingId || ccsCreateRequestId('ccsGetPendingAIPrompt'), 3000);
  const senderUrl = sender?.url || sender?.tab?.url || '';
  let senderAllowed = false;
  try {
    senderAllowed = typeof ccsIsSupportedAIUrl === 'function' && ccsIsSupportedAIUrl(senderUrl);
  } catch (_) {
    senderAllowed = false;
  }
  if (!senderAllowed) {
    respond({ ok: false, error: 'sender-not-chatgpt' });
    return true;
  }
  if ((!pendingId && tabId == null) || typeof ccsResolvePendingAIPrompt !== 'function') {
    respond({ ok: false, error: 'missing-pending-id' });
    return true;
  }
  ccsResolvePendingAIPrompt(pendingId, tabId)
    .then((record) => {
      if (!record) {
        respond({ ok: false, error: 'pending-prompt-not-found' });
        return;
      }
      const senderEngine = typeof ccsGetAIEngineForUrl === 'function'
        ? ccsGetAIEngineForUrl(senderUrl)
        : '';
      if (record.relayEngine && senderEngine && record.relayEngine !== senderEngine) {
        respond({ ok: false, error: 'pending-prompt-target-mismatch' });
        return;
      }
      respond({
        ok: true,
        pendingId: record.id || pendingId,
        prompt: record.prompt,
        meta: {
          source: record.source || '',
          taskId: record.taskId || '',
          menuId: record.menuId || '',
          categoryId: record.categoryId || '',
          engineId: record.engineId || '',
          relayEngine: record.relayEngine || ''
        }
      });
    })
    .catch((error) => {
      respond({ ok: false, error: error?.message || String(error) });
    });
  return true;
}

function ccsHandleAckPendingAIPrompt(request, sender, sendResponse) {
  const pendingId = typeof request.pendingId === 'string' ? request.pendingId : '';
  const tabId = typeof sender?.tab?.id === 'number' ? sender.tab.id : null;
  const respond = ccsCreateSafeResponder(sendResponse, 'ccsAckPendingAIPrompt', pendingId || ccsCreateRequestId('ccsAckPendingAIPrompt'), 3000);
  if (!pendingId || typeof ccsAckPendingAIPromptForTab !== 'function') {
    respond({ ok: false, error: 'missing-pending-id' });
    return true;
  }
  ccsAckPendingAIPromptForTab(pendingId, tabId)
    .then((ok) => respond({ ok }))
    .catch((error) => respond({ ok: false, error: error?.message || String(error) }));
  return true;
}

ccsRegisterMessageHandlers({
  ccsFillYiyanSlatePromptInMainWorld: ccsHandleFillYiyanSlatePromptInMainWorld,
  ccsGetPendingChatGptPrompt: ccsHandleGetPendingAIPrompt,
  ccsGetPendingAIPrompt: ccsHandleGetPendingAIPrompt,
  ccsAckPendingChatGptPrompt: ccsHandleAckPendingAIPrompt,
  ccsAckPendingAIPrompt: ccsHandleAckPendingAIPrompt
});
