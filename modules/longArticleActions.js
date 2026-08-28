(function() {
  'use strict';

  window.CCSModules = window.CCSModules || {};

  const ROLE_SELECTOR = '[data-message-author-role]';
  const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"]';
  const WRITING_BLOCK_SELECTOR = '[data-testid="writing-block-container"], [data-writing-block="true"]';
  const EDITOR_SELECTOR = '.ProseMirror.markdown.prose, .ProseMirror.markdown, [contenteditable="true"].markdown';
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
  const STABLE_MS = 800;
  const MIN_BODY_LENGTH = 600;
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

  function isStreaming(assistant, copyButton) {
    if (copyButton?.disabled || copyButton?.getAttribute('aria-disabled') === 'true') return true;
    return Boolean(assistant.querySelector(
      '[data-is-streaming="true"], .result-streaming, [data-testid="stop-button"]'
    ));
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

  function extractArticle(block) {
    const editor = block.querySelector(EDITOR_SELECTOR);
    if (!editor) return null;
    const titleElement = editor.querySelector('h1');
    const title = normalizeText(titleElement?.textContent || '');
    if (title.length < 2 || title.length > 500) return null;
    const body = sanitizeBody(editor, titleElement);
    if (body.bodyText.length < MIN_BODY_LENGTH || !body.bodyHtml) return null;
    return { title, ...body };
  }

  function candidateFor(assistant) {
    if (!(assistant instanceof HTMLElement) || !assistant.matches(ASSISTANT_SELECTOR)) return null;
    const blocks = Array.from(assistant.querySelectorAll(WRITING_BLOCK_SELECTOR));
    if (blocks.length !== 1) return null;
    const previous = previousUserMessage(assistant);
    if (!previous || !isArticleRewritePromptText(messageText(previous))) return null;
    const block = blocks[0];
    const copyButton = findCopyButton(block);
    if (!copyButton || isStreaming(assistant, copyButton)) return null;
    const article = extractArticle(block);
    return article ? { article, block, copyButton } : null;
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

  async function runAction(button, action, article) {
    const isX = action === 'ccsCreateXArticleDraft';
    const original = button.textContent || (isX ? '注入X草稿' : '生成封面');
    button.disabled = true;
    button.textContent = isX ? '正在注入…' : '正在生成…';
    try {
      const response = await sendMessage({ action, sourceUrl: location.href, input: article });
      if (!response?.success) throw new Error(response?.error || '操作失败');
      button.textContent = '✓ 已完成';
      if (isX) {
        toast(response.warning ? 'warning' : 'success', response.warning || '文章已注入 X 草稿并确认自动保存；不会自动发布');
      } else {
        toast('success', '已打开封面生成页并填入完整文章；请检查后手动发送');
      }
    } catch (error) {
      button.textContent = '⚠ 失败';
      toast('error', error?.message || String(error));
    } finally {
      window.setTimeout(() => {
        button.disabled = false;
        button.textContent = original;
      }, 3000);
    }
  }

  function createActionButton(marker, label, title, action, article) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = ACTION_CLASS;
    button.setAttribute(marker, 'true');
    button.setAttribute('aria-label', label);
    button.title = title;
    button.textContent = label;
    button.addEventListener('click', () => void runAction(button, action, article));
    return button;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${ACTION_CLASS} {
        display: inline-flex; align-items: center; min-height: 28px; padding: 3px 8px;
        border: 0; border-radius: 7px; background: transparent; color: inherit;
        cursor: pointer; font: 500 12px/1.2 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        opacity: .82; white-space: nowrap;
      }
      .${ACTION_CLASS}:hover:not(:disabled) { background: color-mix(in srgb, currentColor 8%, transparent); opacity: 1; }
      .${ACTION_CLASS}:focus-visible { outline: 2px solid color-mix(in srgb, currentColor 42%, transparent); outline-offset: 2px; }
      .${ACTION_CLASS}:disabled { cursor: wait; opacity: .55; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function removeActions(assistant) {
    assistant.querySelectorAll(`[${ACTIONS_MARKER}]`).forEach((node) => node.remove());
  }

  function injectCandidate(assistant, candidate) {
    const { block, copyButton, article } = candidate;
    let actions = block.querySelector(`[${ACTIONS_MARKER}]`);
    if (actions) return;
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
        article
      ),
      createActionButton(
        COVER_MARKER,
        '生成封面',
        '用完整文章生成极简留白封面；打开 ChatGPT 并填入提示词，不会自动发送',
        'ccsCreateLongArticleCover',
        article
      )
    );
    copyButton.insertAdjacentElement('afterend', actions);
  }

  function consider(assistant, schedule) {
    const candidate = candidateFor(assistant);
    if (!candidate) {
      const prior = stability.get(assistant);
      if (prior?.timer) window.clearTimeout(prior.timer);
      stability.delete(assistant);
      removeActions(assistant);
      return;
    }
    const signature = `${candidate.article.title}\u0000${candidate.article.bodyText}\u0000${candidate.article.bodyHtml}`;
    const prior = stability.get(assistant);
    if (!prior || prior.signature !== signature) {
      if (prior?.timer) window.clearTimeout(prior.timer);
      const record = { signature, since: Date.now(), timer: 0 };
      record.timer = window.setTimeout(schedule, STABLE_MS + 30);
      stability.set(assistant, record);
      removeActions(assistant);
      return;
    }
    if (Date.now() - prior.since < STABLE_MS) return;
    injectCandidate(assistant, candidate);
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
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
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
    start
  };
  start();
})();
