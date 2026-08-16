(function() {
  'use strict';

  window.CCSModules = window.CCSModules || {};

  const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
  const TWEET_TEXT_SELECTOR = '[data-testid="tweetText"]';
  const BUTTON_MARKER = 'data-ccs-x-tweet-fastqa';
  const HOST_MARKER = 'data-ccs-x-tweet-fastqa-host';
  const STYLE_ID = 'ccs-x-tweet-fastqa-styles';

  function isSupportedXPage(hostname = location.hostname) {
    return /(^|\.)(x\.com|twitter\.com)$/i.test(hostname);
  }

  function belongsToTweetRoot(element, root) {
    return element.closest(ARTICLE_SELECTOR) === root;
  }

  function isInsideEmbeddedTweet(element, root) {
    let current = element.parentElement;
    while (current && current !== root) {
      if (current.matches(ARTICLE_SELECTOR) || current.getAttribute('role') === 'link') return true;
      current = current.parentElement;
    }
    return false;
  }

  function normalizeTweetBody(value) {
    return String(value || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[\t ]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function elementText(element) {
    if (!element) return '';
    return normalizeTweetBody(element.innerText || element.textContent || '');
  }

  function extractPrimaryTweetBody(root) {
    const textElement = Array.from(root.querySelectorAll(TWEET_TEXT_SELECTOR))
      .find((element) => belongsToTweetRoot(element, root) && !isInsideEmbeddedTweet(element, root));
    return elementText(textElement);
  }

  function buildTweetFastQaInput(body) {
    const normalized = normalizeTweetBody(body);
    return normalized ? `【推文正文】\n${normalized}\n【正文结束】` : '';
  }

  function findTweetActionGroup(root) {
    return Array.from(root.querySelectorAll('[role="group"]')).find((group) =>
      Array.from(group.querySelectorAll('[data-testid="reply"]'))
        .some((reply) => belongsToTweetRoot(reply, root))
    ) || null;
  }

  function directGroupChild(element, group) {
    let current = element;
    while (current && current.parentElement !== group) current = current.parentElement;
    return current?.parentElement === group ? current : null;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [${HOST_MARKER}] {
        display: flex;
        flex: 1 1 0;
        min-width: 0;
        align-items: center;
        justify-content: center;
      }
      [${BUTTON_MARKER}] {
        position: relative;
        display: inline-flex;
        width: 34.75px;
        height: 34.75px;
        margin: -8px;
        padding: 0;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 9999px;
        background: transparent;
        color: rgb(113 118 123);
        cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease, opacity 120ms ease;
      }
      [${BUTTON_MARKER}]:hover:not(:disabled) {
        background: rgb(29 155 240 / 10%);
        color: rgb(29 155 240);
      }
      [${BUTTON_MARKER}]:focus-visible {
        outline: 2px solid rgb(29 155 240 / 55%);
        outline-offset: 2px;
      }
      [${BUTTON_MARKER}]:disabled { cursor: wait; opacity: 0.58; }
      [${BUTTON_MARKER}][data-ccs-state="unavailable"] { cursor: not-allowed; opacity: 0.38; }
      [${BUTTON_MARKER}][data-ccs-state="success"] { color: rgb(0 186 124); }
      [${BUTTON_MARKER}][data-ccs-state="error"] { color: rgb(244 33 46); }
      [${BUTTON_MARKER}] svg { width: 19px; height: 19px; fill: currentColor; }
      [${BUTTON_MARKER}] .ccs-x-tweet-fastqa-spinner {
        display: none;
        width: 15px;
        height: 15px;
        box-sizing: border-box;
        border: 2px solid currentColor;
        border-right-color: transparent;
        border-radius: 50%;
        animation: ccs-x-tweet-fastqa-spin 720ms linear infinite;
      }
      [${BUTTON_MARKER}][data-ccs-state="busy"] svg { display: none; }
      [${BUTTON_MARKER}][data-ccs-state="busy"] .ccs-x-tweet-fastqa-spinner { display: block; }
      @keyframes ccs-x-tweet-fastqa-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        [${BUTTON_MARKER}] { transition: none; }
        [${BUTTON_MARKER}] .ccs-x-tweet-fastqa-spinner { animation: none; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function createFastQaIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M13.2 2.5 5.4 13h5.7l-.5 8.5L18.7 10H13l.2-7.5Z');
    svg.appendChild(path);
    return svg;
  }

  function setActionState(button, state) {
    const copy = {
      idle: { label: '用 ChatGPT 速答这条推文', title: '速答 · ChatGPT：仅发送这条推文正文' },
      busy: { label: '正在发送到 ChatGPT', title: '正在准备速答并打开 ChatGPT' },
      success: { label: '已发送到 ChatGPT', title: '推文正文已发送到速答 · ChatGPT' },
      error: { label: '发送失败，可以重试', title: '发送失败，点击重试' },
      unavailable: { label: '未提取到推文正文', title: '这条推文没有可提取的正文' }
    };
    const next = copy[state];
    button.dataset.ccsState = state;
    button.disabled = state === 'busy' || state === 'success' || state === 'unavailable';
    button.setAttribute('aria-disabled', String(button.disabled));
    button.setAttribute('aria-label', next.label);
    button.title = next.title;
    const host = button.closest(`[${HOST_MARKER}]`);
    if (host) host.title = next.title;
  }

  function sendFastQaToChatGpt(keyword) {
    return new Promise((resolve) => {
      try {
        if (!chrome?.runtime?.id) {
          resolve({ success: false, error: 'runtime-unavailable' });
          return;
        }
        chrome.runtime.sendMessage({
          action: 'executeMenuAction',
          menuItemId: 'ccs-fastqa-chatgpt-quick',
          menuType: 'fastqa-quick',
          engineId: 'chatgpt',
          keyword
        }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message || 'runtime-error' });
            return;
          }
          resolve(response || { success: false, error: 'empty-response' });
        });
      } catch (error) {
        resolve({ success: false, error: error?.message || String(error) });
      }
    });
  }

  function syncAvailability(button, root, force = false) {
    const state = button.dataset.ccsState;
    if (!force && state && !['idle', 'unavailable'].includes(state)) return;
    setActionState(button, extractPrimaryTweetBody(root) ? 'idle' : 'unavailable');
  }

  async function runTweetFastQa(root, button, resetTimers) {
    const keyword = buildTweetFastQaInput(extractPrimaryTweetBody(root));
    if (!keyword) {
      setActionState(button, 'unavailable');
      window.CCSModules.Toast?.warning?.('未提取到这条推文的正文');
      return;
    }

    setActionState(button, 'busy');
    try {
      const response = await sendFastQaToChatGpt(keyword);
      if (!response.success) throw new Error(response.error || '速答启动失败');
      setActionState(button, 'success');
      window.CCSModules.Toast?.success?.('推文正文已发送到速答 · ChatGPT');
    } catch (error) {
      setActionState(button, 'error');
      window.CCSModules.Toast?.error?.(error?.message || String(error));
    } finally {
      const timer = window.setTimeout(() => {
        resetTimers.delete(timer);
        if (button.isConnected) syncAvailability(button, root, true);
      }, 3000);
      resetTimers.add(timer);
    }
  }

  function injectTweetAction(root, resetTimers) {
    const group = findTweetActionGroup(root);
    if (!group) return;
    const existing = Array.from(root.querySelectorAll(`[${BUTTON_MARKER}]`))
      .find((element) => belongsToTweetRoot(element, root));
    if (existing) {
      syncAvailability(existing, root);
      return;
    }
    if (!extractPrimaryTweetBody(root)) return;

    const host = document.createElement('div');
    host.setAttribute(HOST_MARKER, 'true');
    host.addEventListener('click', (event) => event.stopPropagation());
    host.addEventListener('pointerdown', (event) => event.stopPropagation());

    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute(BUTTON_MARKER, 'true');
    const spinner = document.createElement('span');
    spinner.className = 'ccs-x-tweet-fastqa-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    button.append(createFastQaIcon(), spinner);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void runTweetFastQa(root, button, resetTimers);
    });
    host.appendChild(button);
    setActionState(button, 'idle');

    const shareButton = Array.from(group.querySelectorAll('button'))
      .find((candidate) => /^(分享帖子|分享|Share post)$/i.test(candidate.getAttribute('aria-label') || ''));
    const shareCell = shareButton ? directGroupChild(shareButton, group) : null;
    group.insertBefore(host, shareCell);
  }

  function startXTweetFastQaIntegration() {
    try {
      if (window.top !== window || !isSupportedXPage()) return () => {};
    } catch (_) {
      return () => {};
    }

    let stopped = false;
    let observer = null;
    let scheduled = false;
    const resetTimers = new Set();

    const scan = () => {
      scheduled = false;
      if (stopped) return;
      document.querySelectorAll(ARTICLE_SELECTOR).forEach((root) => injectTweetAction(root, resetTimers));
    };
    const schedule = () => {
      if (stopped || scheduled) return;
      scheduled = true;
      requestAnimationFrame(scan);
    };
    const boot = () => {
      if (stopped || observer || !document.documentElement) return;
      ensureStyles();
      observer = new MutationObserver(schedule);
      observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
      schedule();
    };

    boot();
    if (!observer) document.addEventListener('DOMContentLoaded', boot, { once: true });

    return () => {
      stopped = true;
      document.removeEventListener('DOMContentLoaded', boot);
      observer?.disconnect();
      resetTimers.forEach((timer) => window.clearTimeout(timer));
      resetTimers.clear();
      document.querySelectorAll(`[${HOST_MARKER}]`).forEach((host) => host.remove());
    };
  }

  const XTweetFastQa = {
    normalizeTweetBody,
    extractPrimaryTweetBody,
    buildTweetFastQaInput,
    start: startXTweetFastQaIntegration
  };

  window.CCSModules.XTweetFastQa = XTweetFastQa;
  startXTweetFastQaIntegration();
})();
