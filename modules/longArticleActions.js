(function() {
  'use strict';

  window.CCSModules = window.CCSModules || {};

  const ROLE_SELECTOR = '[data-message-author-role]';
  const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"]';
  const WRITING_BLOCK_SELECTOR = '[data-testid="writing-block-container"], [data-writing-block="true"]';
  const EDITOR_SELECTOR = '.ProseMirror.markdown.prose, .ProseMirror.markdown, [contenteditable="true"].markdown';
  const HEADER_SELECTOR = '[data-testid="writing-block-header-surface"], [data-testid="writing-block-header-sticky-container"]';
  const COPY_BUTTON_SELECTORS = [
    'button[data-testid="writing-block-copy-button"]',
    'button[data-testid*="copy"]',
    'button[aria-label*="Copy" i]',
    'button[aria-label*="复制"]',
    'button[title*="Copy" i]',
    'button[title*="复制"]'
  ];
  const ACTION_CLASS = 'ccs-long-article-action';
  const ACTIONS_MARKER = 'data-ccs-long-article-actions';
  const X_MARKER = 'data-ccs-long-article-x-draft';
  const COVER_MARKER = 'data-ccs-long-article-cover';
  const STYLE_ID = 'ccs-long-article-action-styles';
  const LABEL_CLASS = 'ccs-long-article-action-label';
  const SPINNER_CLASS = 'ccs-long-article-action-spinner';
  const STABLE_MS = 800;
  const MIN_BODY_LENGTH = 600;
  const MAX_TITLE_LENGTH = 500;
  const GENERATION_SIGNAL_SELECTOR = [
    '[aria-busy="true"]',
    '[data-streaming="true"]',
    '[data-is-streaming="true"]',
    '[data-generating="true"]',
    '[data-loading="true"]',
    '[data-state="streaming"]',
    '[data-state="generating"]',
    '[data-status="streaming"]',
    '[data-status="generating"]',
    '.result-streaming'
  ].join(', ');
  const STOP_PATTERN = /^(?:stop|stop generating|stop streaming|stop response|停止|停止生成|停止回答|停止流式传输)$/iu;
  const ACTION_STATE_TITLES = {
    generating: '内容正在生成中，请耐心等待；完成后即可使用此操作。',
    settling: '内容刚生成完成，正在确认完整性，请稍候。',
    unavailable: '暂未读取到完整文章，当前操作不可用。'
  };
  const stability = new WeakMap();

  function isSupportedPage() {
    const host = location.hostname.toLowerCase();
    return host === 'chatgpt.com' || host.endsWith('.chatgpt.com') ||
      host === 'chat.openai.com' || host.endsWith('.chat.openai.com');
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function isArticleRewritePromptText(value) {
    const text = normalizeText(value);
    if (!text) return false;
    const hasSource = text.includes('原始素材参考本次对话上下文。') ||
      /https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/[^\s/]+/u.test(text);
    const hasWorkflowSource = text.includes('选A并且按照提示词改写：') ||
      /https:\/\/docs\.google\.com\/document\//u.test(text);
    return hasSource && hasWorkflowSource &&
      text.includes('# 通用「GPT-4.5 感」原始素材深度改写提示词') &&
      text.includes('# 二十八、输出与排版要求') &&
      text.includes('主标题 + 小标题 + 正文') &&
      text.includes('# 原始素材');
  }

  function messageText(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('button, [role="toolbar"], nav, menu, [role="menu"], style, script')
      .forEach((node) => node.remove());
    return normalizeText(clone.innerText || clone.textContent || '');
  }

  function previousUserMessage(assistant) {
    const messages = Array.from(document.querySelectorAll(ROLE_SELECTOR));
    const index = messages.indexOf(assistant);
    if (index <= 0) return null;
    const previous = messages[index - 1];
    return previous?.getAttribute('data-message-author-role') === 'user' ? previous : null;
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function controlName(element) {
    return normalizeText(
      element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent
    );
  }

  function hasExternalGenerationSignal(root) {
    if (root.matches(GENERATION_SIGNAL_SELECTOR) && !root.closest(`[${ACTIONS_MARKER}]`)) return true;
    return Array.from(root.querySelectorAll(GENERATION_SIGNAL_SELECTOR)).some(
      (element) => !element.closest(`[${ACTIONS_MARKER}]`)
    );
  }

  function isStreaming(assistant, block, copyButton) {
    if (copyButton?.disabled || copyButton?.getAttribute('aria-disabled') === 'true') return true;
    if (hasExternalGenerationSignal(assistant) || hasExternalGenerationSignal(block)) return true;
    if (assistant.querySelector('[data-testid="stop-button"]')) return true;
    return Array.from(document.querySelectorAll('button, [role="button"]')).some((control) =>
      !control.closest(`[${ACTIONS_MARKER}]`) && isVisible(control) && STOP_PATTERN.test(controlName(control))
    );
  }

  function findCopyButton(block) {
    for (const selector of COPY_BUTTON_SELECTORS) {
      const button = block.querySelector(selector);
      if (button) return button;
    }
    return Array.from(block.querySelectorAll('button')).find((button) =>
      /^(?:copy|复制)$/iu.test(normalizeText(
        button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent
      ))
    ) || null;
  }

  function plainTextFrom(root) {
    const blockTags = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'BLOCKQUOTE']);
    function visit(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
      if (!(node instanceof Element)) return '';
      if (node.tagName === 'BR') return '\n';
      let text = Array.from(node.childNodes).map(visit).join('');
      if (blockTags.has(node.tagName) && text.trim() && !text.endsWith('\n')) text += '\n';
      return text;
    }
    return normalizeText(visit(root));
  }

  function sanitizeBody(editor, titleElement) {
    const allowed = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'B', 'EM', 'I', 'UL', 'OL', 'LI', 'A', 'BR', 'BLOCKQUOTE']);
    const mediaSelector = 'img, picture, video, audio, iframe, canvas, svg';
    const omittedMedia = Boolean(editor.querySelector(mediaSelector));
    const output = document.createElement('div');

    function appendSanitized(source, target, isRoot = false) {
      for (const child of Array.from(source.childNodes)) {
        if (child === titleElement) continue;
        if (child.nodeType === Node.TEXT_NODE) {
          if (isRoot && !(child.textContent || '').trim()) continue;
          target.appendChild(document.createTextNode(child.textContent || ''));
          continue;
        }
        if (!(child instanceof Element)) continue;
        if (child.matches('button, [role="toolbar"], style, script, img, picture, video, audio, iframe, canvas, svg')) continue;
        if (!allowed.has(child.tagName)) {
          appendSanitized(child, target);
          continue;
        }
        let tag = child.tagName.toLowerCase();
        if (/^h[1-6]$/u.test(tag)) tag = 'h2';
        if (tag === 'b') tag = 'strong';
        if (tag === 'i') tag = 'em';
        const next = document.createElement(tag);
        if (tag === 'a') {
          try {
            const href = new URL(child.getAttribute('href') || '', location.href);
            if (href.protocol === 'http:' || href.protocol === 'https:') {
              next.setAttribute('href', href.href);
            }
          } catch (_) { /* keep a safe unlinked anchor */ }
        }
        appendSanitized(child, next);
        if (next.textContent?.trim() || tag === 'br') target.appendChild(next);
      }
    }

    appendSanitized(editor, output, true);
    return { bodyHtml: output.innerHTML.trim(), bodyText: plainTextFrom(output), omittedMedia };
  }

  function headerTitleFrom(block) {
    // 真实 ChatGPT writing block 会把标题提到 header surface，编辑器正文直接从 H2 开始
    // （分享页已实测），只有旧结构才把 <h1> 放在编辑器里。剔除按钮与我们自己的动作条后取首行。
    const header = block.querySelector(HEADER_SELECTOR);
    if (!header) return '';
    const clone = header.cloneNode(true);
    clone.querySelectorAll(`button, [role="toolbar"], [${ACTIONS_MARKER}], svg, style, script`)
      .forEach((node) => node.remove());
    const firstLine = normalizeText(clone.textContent || '')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) || '';
    return firstLine.length > MAX_TITLE_LENGTH ? '' : firstLine;
  }

  function extractArticleSnapshot(block) {
    const editor = block.querySelector(EDITOR_SELECTOR);
    if (!editor) return null;
    const titleElement = editor.querySelector('h1');
    const title = titleElement ? normalizeText(titleElement.textContent || '') : headerTitleFrom(block);
    const body = sanitizeBody(editor, titleElement);
    return {
      title,
      ...body,
      signature: `${title}\u0000${body.bodyText}\u0000${body.bodyHtml}`
    };
  }

  function extractArticle(block) {
    const snapshot = extractArticleSnapshot(block);
    if (!snapshot) return null;
    if (snapshot.title.length < 2 || snapshot.title.length > MAX_TITLE_LENGTH) return null;
    if (snapshot.bodyText.length < MIN_BODY_LENGTH || !snapshot.bodyHtml) return null;
    return {
      title: snapshot.title,
      bodyHtml: snapshot.bodyHtml,
      bodyText: snapshot.bodyText,
      omittedMedia: snapshot.omittedMedia
    };
  }

  function replaceAllTa(value) {
    return String(value || '').replace(/他/g, 'TA');
  }

  function replaceHtmlTextNodes(root) {
    for (const child of Array.from(root.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        child.textContent = replaceAllTa(child.textContent || '');
      } else {
        replaceHtmlTextNodes(child);
      }
    }
  }

  function replaceArticlePayloadTa(article) {
    const template = document.createElement('template');
    template.innerHTML = article.bodyHtml;
    // 只处理可见文本节点，href 等 HTML 属性保持原值，避免破坏链接。
    replaceHtmlTextNodes(template.content);
    return {
      ...article,
      title: replaceAllTa(article.title),
      bodyText: replaceAllTa(article.bodyText),
      bodyHtml: template.innerHTML
    };
  }

  function workflowCandidateFor(assistant) {
    if (!(assistant instanceof HTMLElement) || !assistant.matches(ASSISTANT_SELECTOR)) return null;
    const blocks = Array.from(assistant.querySelectorAll(WRITING_BLOCK_SELECTOR));
    if (blocks.length !== 1) return null;
    const previous = previousUserMessage(assistant);
    if (!previous || !isArticleRewritePromptText(messageText(previous))) return null;
    const block = blocks[0];
    const copyButton = findCopyButton(block);
    const toolbar = copyButton?.closest('[role="toolbar"]') || block.querySelector('[role="toolbar"]');
    if (!copyButton && !toolbar) return null;
    return {
      block,
      copyButton,
      toolbar,
      streaming: isStreaming(assistant, block, copyButton),
      snapshot: extractArticleSnapshot(block)
    };
  }

  function candidateFor(assistant) {
    const candidate = workflowCandidateFor(assistant);
    if (!candidate || candidate.streaming || !candidate.copyButton) return null;
    const article = extractArticle(candidate.block);
    return article ? { ...candidate, article } : null;
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message || 'runtime-error' });
          } else {
            resolve(response || { success: false, error: 'empty-response' });
          }
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

  function setButtonLabel(button, label) {
    const target = button.querySelector(`.${LABEL_CLASS}`);
    if (target) target.textContent = label;
    else button.textContent = label;
  }

  function setActionsState(actions, state) {
    if (!actions) return;
    if (actions.dataset.ccsLongArticleState !== state) {
      actions.dataset.ccsLongArticleState = state;
    }
    actions.querySelectorAll(`.${ACTION_CLASS}`).forEach((button) => {
      const busy = button.dataset.ccsLongArticleBusy === 'true';
      const disabled = busy || state !== 'ready';
      if (button.disabled !== disabled) button.disabled = disabled;
      if (button.getAttribute('aria-disabled') !== String(disabled)) {
        button.setAttribute('aria-disabled', String(disabled));
      }
      const waiting = busy || state === 'generating' || state === 'settling';
      if (waiting) button.setAttribute('aria-busy', 'true');
      else button.removeAttribute('aria-busy');
      const enabledTitle = button.dataset.ccsLongArticleEnabledTitle || '';
      const nextTitle = busy
        ? (button.dataset.ccsLongArticleBusyTitle || '操作正在处理中，请勿重复点击。')
        : (ACTION_STATE_TITLES[state] || enabledTitle);
      if (button.title !== nextTitle) button.title = nextTitle;
      const defaultLabel = button.dataset.ccsLongArticleDefaultLabel || '';
      const ariaLabel = state === 'generating'
        ? `${defaultLabel}（内容生成中）`
        : state === 'settling'
          ? `${defaultLabel}（正在确认内容完整性）`
          : state === 'unavailable'
            ? `${defaultLabel}（内容尚未就绪）`
            : defaultLabel;
      if (!busy && defaultLabel && button.getAttribute('aria-label') !== ariaLabel) {
        button.setAttribute('aria-label', ariaLabel);
      }
    });
  }

  async function runAction(button, action, assistant, schedule) {
    const isX = action === 'ccsCreateXArticleDraft';
    const original = button.dataset.ccsLongArticleDefaultLabel || (isX ? '注入X草稿' : '生成封面');
    const current = workflowCandidateFor(assistant);
    const article = current && !current.streaming ? extractArticle(current.block) : null;
    if (!article) {
      toast('warning', current?.streaming
        ? ACTION_STATE_TITLES.generating
        : ACTION_STATE_TITLES.unavailable);
      schedule();
      return;
    }
    button.dataset.ccsLongArticleBusy = 'true';
    button.dataset.ccsLongArticleBusyTitle = isX ? '正在注入 X 草稿…' : '正在准备封面…';
    setButtonLabel(button, isX ? '正在注入…' : '正在生成…');
    setActionsState(button.closest(`[${ACTIONS_MARKER}]`), 'ready');
    try {
      // 与 DraftBridge 的 X 草稿规则一致：只在实际注入 X 时把所有“他”替换为“TA”。
      // 页面原文以及“生成封面”使用的文章保持不变。
      const outboundArticle = isX ? replaceArticlePayloadTa(article) : article;
      const response = await sendMessage({ action, sourceUrl: location.href, input: outboundArticle });
      if (!response?.success) throw new Error(response?.error || '操作失败');
      const styleLabel = !isX && typeof response.styleLabel === 'string' ? response.styleLabel.trim() : '';
      setButtonLabel(button, styleLabel ? `✓ 已完成 · ${styleLabel}` : '✓ 已完成');
      if (isX) {
        toast(response.warning ? 'warning' : 'success', response.warning || '文章已注入 X 草稿并确认自动保存；不会自动发布');
      } else {
        toast('success', styleLabel
          ? `已打开封面生成页（${styleLabel}）并填入完整文章；请检查后手动发送`
          : '已打开封面生成页并填入完整文章；请检查后手动发送');
      }
    } catch (error) {
      setButtonLabel(button, '⚠ 失败');
      toast('error', error?.message || String(error));
    } finally {
      window.setTimeout(() => {
        delete button.dataset.ccsLongArticleBusy;
        delete button.dataset.ccsLongArticleBusyTitle;
        setButtonLabel(button, original);
        schedule();
      }, 3000);
    }
  }

  function createActionButton(marker, label, title, action, assistant, schedule) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = ACTION_CLASS;
    button.setAttribute(marker, 'true');
    button.setAttribute('aria-label', label);
    button.title = title;
    button.dataset.ccsLongArticleDefaultLabel = label;
    button.dataset.ccsLongArticleEnabledTitle = title;
    const spinner = document.createElement('span');
    spinner.className = SPINNER_CLASS;
    spinner.setAttribute('aria-hidden', 'true');
    const labelNode = document.createElement('span');
    labelNode.className = LABEL_CLASS;
    labelNode.textContent = label;
    button.append(spinner, labelNode);
    button.addEventListener('click', () => void runAction(button, action, assistant, schedule));
    return button;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${ACTION_CLASS} {
        display: inline-flex; align-items: center; gap: 5px; min-height: 28px; padding: 3px 8px;
        border: 0; border-radius: 7px; background: transparent; color: inherit;
        cursor: pointer; font: 500 12px/1.2 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        opacity: .82; white-space: nowrap;
      }
      .${ACTION_CLASS}:hover:not(:disabled) { background: color-mix(in srgb, currentColor 8%, transparent); opacity: 1; }
      .${ACTION_CLASS}:focus-visible { outline: 2px solid color-mix(in srgb, currentColor 42%, transparent); outline-offset: 2px; }
      .${ACTION_CLASS}:disabled { cursor: wait; opacity: .55; }
      .${SPINNER_CLASS} {
        display: none; width: 11px; height: 11px; box-sizing: border-box; flex: 0 0 auto;
        border: 2px solid color-mix(in srgb, currentColor 28%, transparent);
        border-top-color: currentColor; border-radius: 50%;
        animation: ccs-long-article-spin 720ms linear infinite;
      }
      [${ACTIONS_MARKER}][data-ccs-long-article-state="generating"] .${SPINNER_CLASS},
      [${ACTIONS_MARKER}][data-ccs-long-article-state="settling"] .${SPINNER_CLASS},
      .${ACTION_CLASS}[data-ccs-long-article-busy="true"] .${SPINNER_CLASS} { display: inline-block; }
      @keyframes ccs-long-article-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .${SPINNER_CLASS} { animation-duration: 1.8s; } }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function removeActions(assistant) {
    assistant.querySelectorAll(`[${ACTIONS_MARKER}]`).forEach((node) => node.remove());
  }

  function ensureActions(assistant, candidate, schedule) {
    const { block, copyButton, toolbar } = candidate;
    let actions = block.querySelector(`[${ACTIONS_MARKER}]`);
    if (!actions) {
      actions = document.createElement('span');
      actions.setAttribute(ACTIONS_MARKER, 'true');
      actions.style.display = 'inline-flex';
      actions.style.alignItems = 'center';
      actions.append(
        createActionButton(
          X_MARKER,
          '注入X草稿',
          '打开专用 X Articles 标签页并写入草稿；遇到已有内容会停止，不会自动发布',
          'ccsCreateXArticleDraft',
          assistant,
          schedule
        ),
        createActionButton(
          COVER_MARKER,
          '生成封面',
          '用完整文章生成封面，风格跟随侧边栏置顶的封面风格（未置顶时用默认的墨清风格）；打开 ChatGPT 并填入提示词，不会自动发送',
          'ccsCreateLongArticleCover',
          assistant,
          schedule
        )
      );
    }
    if (copyButton && actions.previousElementSibling !== copyButton) {
      copyButton.insertAdjacentElement('afterend', actions);
    } else if (!actions.isConnected && toolbar) {
      toolbar.appendChild(actions);
    }
    return actions;
  }

  function consider(assistant, schedule) {
    const candidate = workflowCandidateFor(assistant);
    if (!candidate) {
      const prior = stability.get(assistant);
      if (prior?.timer) window.clearTimeout(prior.timer);
      stability.delete(assistant);
      removeActions(assistant);
      return;
    }
    const actions = ensureActions(assistant, candidate, schedule);
    const signature = candidate.snapshot?.signature || '';
    let record = stability.get(assistant);
    if (!record) {
      record = { signature, since: 0, timer: 0, wasStreaming: false };
      stability.set(assistant, record);
    }
    if (candidate.streaming) {
      if (record.timer) window.clearTimeout(record.timer);
      record.signature = signature;
      record.since = 0;
      record.timer = 0;
      record.wasStreaming = true;
      setActionsState(actions, 'generating');
      return;
    }
    if (record.wasStreaming || record.signature !== signature || !record.since) {
      if (record.timer) window.clearTimeout(record.timer);
      record.signature = signature;
      record.since = Date.now();
      record.wasStreaming = false;
      record.timer = window.setTimeout(schedule, STABLE_MS + 30);
      setActionsState(actions, 'settling');
      return;
    }
    if (Date.now() - record.since < STABLE_MS) {
      setActionsState(actions, 'settling');
      return;
    }
    record.timer = 0;
    const article = extractArticle(candidate.block);
    if (article && record.conceptsSignature !== signature) {
      // 成品就绪即记录加粗概念（近期概念记忆），与按钮状态无关；同一篇只记一次
      record.conceptsSignature = signature;
      rememberConcepts(article.bodyHtml);
    }
    setActionsState(actions, article ? 'ready' : 'unavailable');
  }

  function rememberConcepts(bodyHtml) {
    try {
      const memory = globalThis.CCSRewriteConceptMemory;
      if (!memory?.extractConceptsFromHtml || !memory.recordConcepts) return;
      const concepts = memory.extractConceptsFromHtml(bodyHtml);
      if (concepts.length) void memory.recordConcepts(concepts);
    } catch (_) { /* 记忆失败不影响主流程 */ }
  }

  function start() {
    try {
      if (window.top !== window || !isSupportedPage()) return () => {};
    } catch (_) {
      return () => {};
    }
    ensureStyles();
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        document.querySelectorAll(ASSISTANT_SELECTOR).forEach((assistant) => consider(assistant, schedule));
      });
    };
    const observer = new MutationObserver((mutations) => {
      const onlyOwnStateChanges = mutations.every((mutation) =>
        mutation.target instanceof Element && Boolean(mutation.target.closest(`[${ACTIONS_MARKER}]`))
      );
      if (!onlyOwnStateChanges) schedule();
    });
    observer.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'disabled',
        'aria-disabled',
        'aria-busy',
        'data-streaming',
        'data-is-streaming',
        'data-generating',
        'data-loading',
        'data-state',
        'data-status'
      ]
    });
    window.addEventListener('popstate', schedule);
    schedule();
    return () => {
      observer.disconnect();
      window.removeEventListener('popstate', schedule);
    };
  }

  window.CCSModules.LongArticleActions = {
    candidateFor,
    extractArticle,
    isArticleRewritePromptText,
    isSupportedPage,
    replaceArticlePayloadTa,
    start
  };
  start();
})();
