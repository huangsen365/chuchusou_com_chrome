(function() {
  'use strict';

  window.CCSModules = window.CCSModules || {};

  const REQUEST_CHANNEL = 'ccs:x-article-state-request';
  const RESULT_CHANNEL = 'ccs:x-article-state-result';
  const TITLE_ATTRIBUTE = 'data-ccs-main-title';
  const BODY_ATTRIBUTE = 'data-ccs-main-body';
  const TITLE_SELECTORS = [
    '[data-testid="twitterArticleTitle"] input',
    '[data-testid="twitterArticleTitle"] textarea',
    '[data-testid="twitterArticleTitle"] [contenteditable="true"]',
    'main input[placeholder*="title" i]',
    'main textarea[placeholder*="title" i]',
    'main input[placeholder*="标题" i]',
    'main textarea[placeholder*="标题" i]',
    'main [contenteditable="true"][data-placeholder*="title" i]',
    'main [contenteditable="true"][data-placeholder*="标题" i]',
    'main [role="textbox"][aria-label*="title" i]',
    'main [role="textbox"][aria-label*="标题" i]',
    'main input[name="title"]'
  ];
  const BODY_SELECTORS = [
    'main .public-DraftEditor-content[contenteditable="true"]',
    '[data-testid="twitterArticleEditor"] .ProseMirror',
    '[data-testid="twitterArticleEditor"] [contenteditable="true"]',
    'main .ProseMirror[contenteditable="true"]',
    'main [contenteditable="true"][data-placeholder*="story" i]',
    'main [contenteditable="true"][data-placeholder*="article" i]',
    'main [role="textbox"][aria-multiline="true"]'
  ];
  const SAVING = /正在保存\.{3}|saving\.{3}/iu;
  const SAVED = /刚刚最后保存|last saved just now/iu;
  const SAVE_FAILED = /你最近的更新尚未保存|your recent updates have not been saved/iu;
  const EDITOR_REGION = [
    '[contenteditable="true"]',
    'input',
    'textarea',
    '[data-testid="twitterArticleEditor"]',
    '[data-testid="twitterArticleTitle"]'
  ].join(', ');
  const SAVE_TEXT_IGNORED_REGION = `${EDITOR_REGION}, script, style, template, noscript`;
  const WRITE_LABEL = /^(?:create|write|write article|new article|create article|创建|撰写|写文章|新建文章|创建文章)$/iu;
  const WRITE_CONTROL_SELECTOR = 'main button, main a[href], main [role="button"]';
  const EDITABLE_SELECTOR = 'main input:not([type]), main input[type="text"], main textarea, main [contenteditable="true"], main [role="textbox"], main .ProseMirror';
  const TITLE_WORDS = /(?:^|\b)(title|headline|subject)(?:\b|$)|标题|题目|標題/iu;
  const BODY_WORDS = /(?:^|\b)(body|content|article|story|write)(?:\b|$)|正文|内容|文章|撰写/iu;
  const deliveries = new Map();

  function isSupportedPage() {
    const host = location.hostname.toLowerCase();
    return (host === 'x.com' || host === 'www.x.com') && location.pathname.startsWith('/compose/articles');
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
      .split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).join('\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  function isVisible(element) {
    if (!element?.isConnected) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isEditable(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      return !element.disabled && !element.readOnly;
    }
    return element.isContentEditable ||
      element.getAttribute('contenteditable') === 'true' ||
      element.getAttribute('role') === 'textbox';
  }

  function semanticText(element) {
    const labels = element.tagName === 'INPUT' || element.tagName === 'TEXTAREA'
      ? element.labels
      : null;
    const label = labels ? Array.from(labels).map((item) => item.textContent || '').join(' ') : '';
    return [
      element.getAttribute('placeholder'),
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.getAttribute('name'),
      element.id,
      element.getAttribute('data-placeholder'),
      label
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function elementArea(element) {
    const rect = element.getBoundingClientRect();
    return rect.width * rect.height;
  }

  function editableCandidates() {
    return Array.from(document.querySelectorAll(EDITABLE_SELECTOR))
      .filter((element) => isEditable(element) && isVisible(element));
  }

  function scoreTitleCandidate(element) {
    let score = 0;
    const semantics = semanticText(element);
    if (TITLE_WORDS.test(semantics)) score += 100;
    if (element.tagName === 'INPUT') score += 30;
    if (element.tagName === 'TEXTAREA' && element.rows <= 2) score += 18;
    if (element.getAttribute('aria-multiline') === 'false') score += 20;
    const area = elementArea(element);
    if (area > 0 && area < 80000) score += 5;
    if (BODY_WORDS.test(semantics)) score -= 70;
    return score;
  }

  function scoreBodyCandidate(element) {
    let score = 0;
    const semantics = semanticText(element);
    const rect = element.getBoundingClientRect();
    if (BODY_WORDS.test(semantics)) score += 70;
    if (element.classList.contains('ProseMirror') || element.classList.contains('public-DraftEditor-content')) score += 70;
    if (element.getAttribute('aria-multiline') === 'true') score += 35;
    if (element.tagName === 'TEXTAREA') score += 25;
    if (element.isContentEditable) score += 30;
    if (rect.height >= 120) score += 25;
    if (rect.width >= 400) score += 10;
    if (TITLE_WORDS.test(semantics)) score -= 100;
    if (element.tagName === 'INPUT') score -= 80;
    return score;
  }

  function readEditableText(element) {
    if (element?.tagName === 'INPUT' || element?.tagName === 'TEXTAREA') return element.value;
    return element.innerText || element.textContent || '';
  }

  function findFirst(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (isEditable(element) && isVisible(element)) return element;
    }
    return null;
  }

  function findEditors() {
    const candidates = editableCandidates();
    const body = findFirst(BODY_SELECTORS) ||
      candidates.slice().sort((left, right) => scoreBodyCandidate(right) - scoreBodyCandidate(left))[0] || null;
    const title = findFirst(TITLE_SELECTORS) ||
      candidates.filter((element) => element !== body)
        .sort((left, right) => scoreTitleCandidate(right) - scoreTitleCandidate(left))[0] || null;
    return title && body && title !== body ? { title, body } : null;
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function waitForEditors(timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    let openedEntry = false;
    while (Date.now() < deadline) {
      const editors = findEditors();
      if (editors) return editors;
      if (!openedEntry && Date.now() + 1000 < deadline) {
        const entry = Array.from(document.querySelectorAll(WRITE_CONTROL_SELECTOR)).find((element) => {
          const enabled = element.getAttribute('aria-disabled') !== 'true' && !element.disabled;
          const labels = [element.textContent, element.getAttribute('aria-label'), element.getAttribute('title')]
            .map(normalizeText)
            .filter(Boolean);
          return enabled && isVisible(element) && labels.some((label) => WRITE_LABEL.test(label));
        });
        if (entry) {
          openedEntry = true;
          entry.click();
        }
      }
      await sleep(120);
    }
    return null;
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
          else resolve(response || { success: false, error: 'empty-response' });
        });
      } catch (error) {
        resolve({ success: false, error: error?.message || String(error) });
      }
    });
  }

  function toast(type, message) {
    const api = window.CCSModules.Toast;
    if (typeof api?.[type] === 'function') api[type](message);
  }

  function uniqueRequestId() {
    return globalThis.crypto?.randomUUID?.() ||
      `ccs-state-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  async function applyThroughState(editors, task, timeoutMs = 8000) {
    const requestId = uniqueRequestId();
    editors.title.setAttribute(TITLE_ATTRIBUTE, requestId);
    editors.body.setAttribute(BODY_ATTRIBUTE, requestId);
    try {
      return await new Promise((resolve) => {
        let done = false;
        const finish = (result) => {
          if (done) return;
          done = true;
          window.clearTimeout(timer);
          window.removeEventListener('message', listener);
          resolve(result);
        };
        const listener = (event) => {
          const result = event.data;
          if (event.source !== window || !result || result.channel !== RESULT_CHANNEL || result.requestId !== requestId) return;
          finish(result);
        };
        const timer = window.setTimeout(() => finish({ ok: false, error: '等待 X Draft.js 状态响应超时。' }), timeoutMs);
        window.addEventListener('message', listener);
        window.postMessage({
          channel: REQUEST_CHANNEL,
          requestId,
          title: task.title,
          bodyHtml: task.bodyHtml
        }, location.origin);
      });
    } finally {
      editors.title.removeAttribute(TITLE_ATTRIBUTE);
      editors.body.removeAttribute(BODY_ATTRIBUTE);
    }
  }

  async function waitForExactContent(expectedTitle, expectedBody, timeoutMs = 6000, stableMs = 250) {
    const deadline = Date.now() + timeoutMs;
    let matchingSince = 0;
    let latest = null;
    while (Date.now() < deadline) {
      const editors = findEditors();
      if (editors) {
        const title = normalizeText(readEditableText(editors.title));
        const body = normalizeText(readEditableText(editors.body));
        const accepted = title === normalizeText(expectedTitle) && body === normalizeText(expectedBody);
        latest = { ...editors, title, body, accepted };
        if (accepted) {
          if (!matchingSince) matchingSince = Date.now();
          if (Date.now() - matchingSince >= stableMs) return latest;
        } else {
          matchingSince = 0;
        }
      }
      await sleep(80);
    }
    return latest;
  }

  function saveStatusText() {
    if (!document.body) return '';
    function outsideEditor(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.parentElement?.closest(SAVE_TEXT_IGNORED_REGION) ? '' : (node.textContent || '');
      }
      if (!(node instanceof Element) || node.matches(SAVE_TEXT_IGNORED_REGION)) return '';
      return Array.from(node.childNodes).map(outsideEditor).join(' ');
    }
    const values = [outsideEditor(document.body)];
    document.querySelectorAll('[role="status"], [aria-live], [aria-label], [title]').forEach((element) => {
      if (element.closest(EDITOR_REGION)) return;
      values.push(element.textContent || '', element.getAttribute('aria-label') || '', element.getAttribute('title') || '');
    });
    return normalizeText(values.join(' '));
  }

  async function waitForSave(timeoutMs = 12000, acceptInitiallySaved = false, signal) {
    if (signal?.aborted) return { status: 'unconfirmed' };
    const deadline = Date.now() + timeoutMs;
    const initialText = saveStatusText();
    let savingSeen = SAVING.test(initialText);
    const initiallySaved = SAVED.test(initialText);
    if (acceptInitiallySaved && initiallySaved && !savingSeen) return { status: 'saved' };
    while (Date.now() < deadline) {
      if (signal?.aborted) return { status: 'unconfirmed' };
      const text = saveStatusText();
      if (SAVE_FAILED.test(text)) return { status: 'failed', error: 'X 提示本次更新尚未保存。' };
      if (SAVING.test(text)) savingSeen = true;
      if (!SAVING.test(text) && SAVED.test(text) && (savingSeen || !initiallySaved)) {
        return { status: 'saved' };
      }
      await sleep(100);
    }
    return { status: 'unconfirmed' };
  }

  async function reportCompletion(taskId, result) {
    await sendMessage({ action: 'ccsCompleteXArticleDraft', taskId, result });
    return result;
  }

  async function deliver(taskId) {
    const taskResponse = await sendMessage({ action: 'ccsGetXArticleDraftTask', taskId });
    if (!taskResponse?.success || !taskResponse.task) {
      return { success: false, retryable: false, error: taskResponse?.error || '本地 X 文章任务不存在。' };
    }
    const task = taskResponse.task;
    const editors = await waitForEditors();
    if (!editors) {
      return reportCompletion(taskId, {
        success: false,
        retryable: true,
        error: '未找到 X Articles 的标题和正文编辑器。'
      });
    }
    const originalTitle = normalizeText(readEditableText(editors.title));
    const originalBody = normalizeText(readEditableText(editors.body));
    const existingTask = originalTitle === normalizeText(task.title) && originalBody === normalizeText(task.bodyText);
    if ((originalTitle || originalBody) && !existingTask) {
      const result = { success: false, retryable: false, error: '当前 X Articles 编辑器已有内容，为避免覆盖已停止注入。' };
      toast('warning', result.error);
      return reportCompletion(taskId, result);
    }

    const saveAbort = new globalThis.AbortController();
    const savePromise = existingTask ? null : waitForSave(12000, false, saveAbort.signal);
    let stateResult = { ok: true };
    if (!existingTask) stateResult = await applyThroughState(editors, task);
    if (!stateResult?.ok) {
      saveAbort.abort();
      const result = { success: false, retryable: true, error: stateResult?.error || 'X 编辑器状态写入失败。' };
      toast('error', result.error);
      return reportCompletion(taskId, result);
    }

    const verification = await waitForExactContent(task.title, task.bodyText);
    if (!verification?.accepted) {
      saveAbort.abort();
      const result = {
        success: false,
        retryable: true,
        error: `X 未接受完整文章（标题 ${verification?.title?.length || 0}/${task.title.length}，正文 ${verification?.body?.length || 0}/${task.bodyText.length}）。`
      };
      toast('error', result.error);
      return reportCompletion(taskId, result);
    }

    const save = savePromise ? await savePromise : await waitForSave(12000, true);
    saveAbort.abort();
    if (save.status === 'failed') {
      const result = { success: false, retryable: false, error: save.error };
      toast('error', result.error);
      return reportCompletion(taskId, result);
    }
    const warning = save.status === 'saved'
      ? ''
      : '内容已完整写入，但未读到 X 的自动保存确认；关闭页面前请确认顶部保存状态。';
    const result = { success: true, warning };
    toast(warning ? 'warning' : 'success', warning || 'X 文章草稿已写入并确认自动保存；不会自动发布');
    return reportCompletion(taskId, result);
  }

  function deliverOnce(taskId) {
    if (!taskId) return Promise.resolve({ success: false, retryable: true, error: 'missing-task-id' });
    if (!deliveries.has(taskId)) {
      deliveries.set(taskId, deliver(taskId).finally(() => window.setTimeout(() => deliveries.delete(taskId), 2000)));
    }
    return deliveries.get(taskId);
  }

  function recoverPendingTask() {
    sendMessage({ action: 'ccsXArticleContentReady' }).then((response) => {
      if (response?.success && response.taskId) void deliverOnce(response.taskId);
    });
  }

  function start() {
    try {
      if (window.top !== window || !isSupportedPage()) return () => {};
    } catch (_) {
      return () => {};
    }
    const listener = (request, _sender, sendResponse) => {
      if (request?.action !== 'ccsDeliverXArticleDraft') return false;
      deliverOnce(request.taskId)
        .then(sendResponse)
        .catch((error) => sendResponse({ success: false, retryable: true, error: error?.message || String(error) }));
      return true;
    };
    chrome.runtime.onMessage.addListener(listener);
    [0, 600, 1600, 3200].forEach((delay) => window.setTimeout(recoverPendingTask, delay));
    return () => chrome.runtime.onMessage.removeListener(listener);
  }

  window.CCSModules.XArticleDraftDelivery = {
    deliver: deliverOnce,
    findEditors,
    isSupportedPage,
    normalizeText,
    start
  };
  start();
})();
