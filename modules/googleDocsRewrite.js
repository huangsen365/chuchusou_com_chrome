(function() {
  'use strict';

  window.CCSModules = window.CCSModules || {};
  const Runtime = window.CCSModules.ArticleRewriteRuntime;
  if (!Runtime) return;

  const BUTTON_MARKER = 'data-ccs-google-doc-rewrite';
  const TARGET_MARKER = 'data-ccs-rewrite-target';
  const BUTTON_CLASS = 'ccs-google-doc-rewrite';
  const FLOATING_CLASS = `${BUTTON_CLASS}--floating`;
  const CLAUDE_CLASS = `${BUTTON_CLASS}--claude`;
  const STYLE_ID = 'ccs-google-doc-rewrite-styles';
  const TARGETS = [
    {
      id: 'chatgpt',
      label: 'ChatGPT 改写',
      done: '✓ 已打开 ChatGPT',
      title: '将当前 Google Docs 链接与长文优化改写提示词填入 ChatGPT；不会自动发送'
    },
    {
      id: 'claude',
      label: 'Claude 改写',
      done: '✓ 已打开 Claude',
      title: '将当前 Google Docs 链接与长文优化改写提示词填入 Claude；不会自动发送'
    }
  ];

  function isSupportedPage() {
    return Boolean(Runtime.normalizeGoogleDocUrl(location.href));
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${BUTTON_CLASS} {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        min-width: 116px;
        height: 36px;
        margin: 0 6px;
        padding: 0 16px;
        border: 0;
        border-radius: 18px;
        background: #0b57d0;
        color: #fff;
        cursor: pointer;
        font: 500 14px/20px "Google Sans", Roboto, Arial, sans-serif;
        white-space: nowrap;
        transition: background-color 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
      }
      .${BUTTON_CLASS}:hover:not(:disabled) {
        background: #0842a0;
        box-shadow: 0 1px 3px rgb(60 64 67 / 30%);
      }
      .${BUTTON_CLASS}:focus-visible { outline: 2px solid #0b57d0; outline-offset: 2px; }
      .${BUTTON_CLASS}:disabled { cursor: wait; opacity: 0.62; }
      .${CLAUDE_CLASS} { background: #d97757; }
      .${CLAUDE_CLASS}:hover:not(:disabled) { background: #bf5f41; }
      .${CLAUDE_CLASS}:focus-visible { outline-color: #d97757; }
      .${FLOATING_CLASS} {
        position: fixed;
        z-index: 2147483646;
        top: 68px;
        right: 18px;
        margin: 0;
        box-shadow: 0 3px 12px rgb(60 64 67 / 28%);
      }
      .${CLAUDE_CLASS}.${FLOATING_CLASS} { top: 112px; }
      @media (prefers-reduced-motion: reduce) { .${BUTTON_CLASS} { transition: none; } }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function toast(type, message) {
    const api = window.CCSModules.Toast;
    if (typeof api?.[type] === 'function') api[type](message);
  }

  async function runRewrite(button, target) {
    const sourceUrl = Runtime.normalizeGoogleDocUrl(button.dataset.sourceUrl || location.href);
    if (!sourceUrl) {
      toast('warning', '当前页面不是可支持的 Google Docs 文档');
      return;
    }
    const original = button.textContent || target.label;
    button.disabled = true;
    button.textContent = '⏳ 正在准备…';
    try {
      const response = await Runtime.requestGoogleDocRewrite(sourceUrl, target.id);
      if (!response?.success) throw new Error(response?.error || '创建文章改写任务失败');
      button.textContent = target.done;
      toast('success', `已将文章改写提示词发送到 ${target.label.replace(' 改写', '')}，请检查后手动发送`);
    } catch (error) {
      button.textContent = '⚠ 打开失败';
      toast('error', error?.message || String(error));
    } finally {
      window.setTimeout(() => {
        button.disabled = false;
        button.textContent = original;
      }, 2600);
    }
  }

  function createButton(target, sourceUrl, floating) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = [
      BUTTON_CLASS,
      target.id === 'claude' ? CLAUDE_CLASS : '',
      floating ? FLOATING_CLASS : ''
    ].filter(Boolean).join(' ');
    button.setAttribute(BUTTON_MARKER, floating ? 'floating' : 'inline');
    button.setAttribute(TARGET_MARKER, target.id);
    button.setAttribute('aria-label', target.label);
    button.title = target.title;
    button.dataset.sourceUrl = sourceUrl;
    button.textContent = target.label;
    button.addEventListener('click', () => void runRewrite(button, target));
    return button;
  }

  function inject() {
    ensureStyles();
    const sourceUrl = Runtime.normalizeGoogleDocUrl(location.href);
    const existing = Array.from(document.querySelectorAll(`[${BUTTON_MARKER}]`));
    if (!sourceUrl) {
      existing.forEach((button) => button.remove());
      return;
    }
    const container = document.querySelector('.docs-titlebar-buttons');
    const mode = container ? 'inline' : 'floating';
    const kept = new Set();
    for (const target of TARGETS) {
      const current = existing.find((button) =>
        button.getAttribute(BUTTON_MARKER) === mode &&
        button.getAttribute(TARGET_MARKER) === target.id
      );
      if (current) kept.add(current);
    }
    existing.filter((button) => !kept.has(button)).forEach((button) => button.remove());
    const shareButton = container?.querySelector('#docs-titlebar-share-client-button') || null;
    for (const target of TARGETS) {
      const current = Array.from(kept).find((button) =>
        button.getAttribute(TARGET_MARKER) === target.id
      );
      if (current) {
        current.dataset.sourceUrl = sourceUrl;
        continue;
      }
      const button = createButton(target, sourceUrl, !container);
      if (container) container.insertBefore(button, shareButton);
      else document.documentElement.appendChild(button);
    }
  }

  function start() {
    try {
      if (window.top !== window || !isSupportedPage()) return () => {};
    } catch (_) {
      return () => {};
    }
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      // 后台标签页里 requestAnimationFrame 不触发：页面隐藏时改用定时器，保证切回前按钮已重建
      (document.hidden ? (fn) => setTimeout(fn, 32) : requestAnimationFrame)(() => {
        scheduled = false;
        inject();
      });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('popstate', schedule);
    schedule();
    return () => {
      observer.disconnect();
      window.removeEventListener('popstate', schedule);
    };
  }

  window.CCSModules.GoogleDocsRewrite = { inject, isSupportedPage, start };
  start();
})();
