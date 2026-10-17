(function() {
  'use strict';

  // Gemini 版「选A并优化改写」：速答回复（【短篇回答】/【中篇回答】+ A/B）底栏的复制按钮后面加一个入口，
  // 点了把同一份改写提示词填进 Gemini 输入框。页面结构在 modules/geminiDom.js，匹配与点击逻辑与
  // ChatGPT 共用 modules/articleRewriteRuntime.js。
  window.CCSModules = window.CCSModules || {};
  const GeminiDom = window.CCSModules.GeminiDom;
  const Runtime = window.CCSModules.ArticleRewriteRuntime;
  if (!Runtime || !GeminiDom) return;

  const BUTTON_MARKER = 'data-ccs-select-a-rewrite';
  const BUTTON_CLASS = 'ccs-select-a-rewrite';
  const STYLE_ID = 'ccs-gemini-select-a-rewrite-styles';

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${BUTTON_CLASS} {
        display: inline-flex;
        align-items: center;
        align-self: center;
        box-sizing: border-box;
        flex: 0 0 auto;
        width: max-content;
        max-width: 100%;
        min-height: 32px;
        margin: 0 2px;
        padding: 4px 10px;
        border: 0;
        border-radius: 16px;
        background: transparent;
        color: inherit;
        cursor: pointer;
        font: 500 13px/1.2 "Google Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        opacity: 0.85;
        white-space: nowrap;
        transition: background-color 140ms ease, opacity 140ms ease;
      }
      .${BUTTON_CLASS}:hover:not(:disabled) {
        background-color: color-mix(in srgb, currentColor 8%, transparent);
        opacity: 1;
      }
      .${BUTTON_CLASS}:focus-visible {
        outline: 2px solid color-mix(in srgb, currentColor 42%, transparent);
        outline-offset: 2px;
      }
      .${BUTTON_CLASS}:disabled { cursor: wait; opacity: 0.55; }
      @media (prefers-reduced-motion: reduce) { .${BUTTON_CLASS} { transition: none; } }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function matchesResponse(response) {
    const markdown = GeminiDom.markdownFor(response);
    if (!markdown || GeminiDom.isStreaming(response)) return false;
    const text = Runtime.responseTextForMatching(markdown, { ignoreSelector: GeminiDom.CODE_BLOCK_CHROME_SELECTOR });
    return Runtime.matchesSelectARewriteText(text, GeminiDom.codeBlockTexts(response), { allowNoBlocks: true });
  }

  function inject(response) {
    const anchor = GeminiDom.responseCopyAnchor(response);
    const current = response.querySelector(`[${BUTTON_MARKER}]`);
    if (!anchor || !matchesResponse(response)) {
      current?.remove();
      return;
    }
    if (current) {
      if (current.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', current);
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    button.setAttribute(BUTTON_MARKER, 'true');
    button.setAttribute('aria-label', '选A并优化改写');
    button.title = '将“选A”和文章优化改写提示词填入 Gemini 输入框；不会覆盖草稿，也不会自动发送';
    button.textContent = '↗ 选A并优化改写';
    button.addEventListener('click', () => void Runtime.fillSelectARewriteFromButton(button, { siteName: 'Gemini' }));
    anchor.insertAdjacentElement('afterend', button);
  }

  function start() {
    try {
      if (window.top !== window || !GeminiDom.isSupportedPage()) return () => {};
    } catch (_) {
      return () => {};
    }
    ensureStyles();
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      // 后台标签页里 requestAnimationFrame 不触发：页面隐藏时改用定时器，保证切回前按钮已重建
      (document.hidden ? (fn) => setTimeout(fn, 32) : requestAnimationFrame)(() => {
        scheduled = false;
        GeminiDom.responses().forEach(inject);
      });
    };
    const observer = new MutationObserver(schedule);
    // aria-busy 翻成 false 时（生成结束）也要重判，正文可能不再变化
    observer.observe(document.documentElement, {
      childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['aria-busy']
    });
    window.addEventListener('popstate', schedule);
    schedule();
    return () => {
      observer.disconnect();
      window.removeEventListener('popstate', schedule);
    };
  }

  window.CCSModules.GeminiSelectARewrite = { inject, matchesResponse, start };
  start();
})();
