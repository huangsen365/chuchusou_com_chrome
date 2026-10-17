(function() {
  'use strict';

  // Gemini 版「注入X草稿 / 生成封面」：选A改写产出的长文放这两个动作——文章在代码块里时放在代码块右上角：
  // 有头部（标了语言，如「Markdown」）就跟在下载 / 复制代码后面，没有头部就在代码块最上面补一行靠右放；
  // 渲染成页面时放在整条回复底栏的复制按钮后面。
  // 按钮、状态机与投递共用 modules/longArticleActions.js，这里只回答 Gemini 页面上的三件事：
  //   哪条回复是改写工作流的长文（同一轮用户消息是改写提示词）、文章怎么取、按钮放哪。
  // Gemini 常把整篇放进「Markdown」代码块（原文 # 主标题 / ## 小标题 / **加粗**），也可能直接渲染成页面。
  window.CCSModules = window.CCSModules || {};
  const GeminiDom = window.CCSModules.GeminiDom;
  const LongArticle = window.CCSModules.LongArticleActions;
  if (!GeminiDom || !LongArticle) return;

  const OWN_ROW_MARKER = 'data-ccs-gemini-block-actions';

  function placeInHeader(header, actions) {
    if (header.lastElementChild !== actions) header.appendChild(actions);
    // 这组是普通块里的行内图标（36px 高）：vertical-align: middle 会低 8px，还把头部撑高 4px、
    // 顶着「Markdown」标签往下走。改成顶部对齐、取同组图标的高度，文字按钮与图标就在同一条中线上。
    const iconHeight = header.firstElementChild === actions ? 0 : header.firstElementChild?.offsetHeight || 0;
    if (iconHeight) {
      const height = `${iconHeight}px`;
      if (actions.style.height !== height) actions.style.height = height;
      if (actions.style.verticalAlign !== 'top') actions.style.verticalAlign = 'top';
    }
  }

  function ensureRowStyles() {
    if (document.getElementById(`${OWN_ROW_MARKER}-styles`)) return;
    const style = document.createElement('style');
    style.id = `${OWN_ROW_MARKER}-styles`;
    // 按钮被挪走（头部出现 / 不再是长文）后这一行不留任何空白
    style.textContent = `[${OWN_ROW_MARKER}] { display: flex; justify-content: flex-end; align-items: center; padding-right: 24px; }
      [${OWN_ROW_MARKER}]:empty { display: none; }`;
    (document.head || document.documentElement).appendChild(style);
  }

  // 没有头部的代码块：在看得见的框里最上面补一行（只装我们的按钮，靠右，避开大圆角）。框顶有内边距
  // （实测 26px），这一行往上收进内边距，按钮离框顶约 8px，正文只往下让一点。
  function placeInOwnRow(frame, actions) {
    ensureRowStyles();
    let row = frame.querySelector(`:scope > [${OWN_ROW_MARKER}]`);
    if (!row) {
      row = document.createElement('div');
      row.setAttribute(OWN_ROW_MARKER, 'true');
    }
    if (frame.firstElementChild !== row) frame.prepend(row);
    if (row.lastElementChild !== actions) row.appendChild(actions);
    if (actions.style.height) actions.style.height = '';
    if (actions.style.verticalAlign !== 'middle') actions.style.verticalAlign = 'middle';
    const paddingTop = parseFloat(getComputedStyle(frame).paddingTop) || 0;
    const marginTop = `${-Math.max(0, paddingTop - 8)}px`;
    if (row.style.marginTop !== marginTop) row.style.marginTop = marginTop;
    if (row.style.marginBottom !== '4px') row.style.marginBottom = '4px';
  }

  function articleSource(response) {
    const markdown = GeminiDom.markdownFor(response);
    if (!markdown) return null;
    const blocks = GeminiDom.codeBlockTexts(response);
    if (blocks.length === 1 && /^#\s+\S/u.test(blocks[0])) {
      const frame = GeminiDom.codeBlockFrame(response);
      if (!frame) return null;
      return {
        signature: blocks[0],
        read: () => LongArticle.articleFromMarkdown(blocks[0]),
        place(actions) {
          const header = GeminiDom.codeBlockActions(response);
          if (header) {
            placeInHeader(header, actions);
            frame.querySelector(`:scope > [${OWN_ROW_MARKER}]`)?.remove();
          } else {
            placeInOwnRow(frame, actions);
          }
        }
      };
    }
    const anchor = GeminiDom.responseCopyAnchor(response);
    if (blocks.length === 0 && anchor && markdown.querySelectorAll('h1').length === 1) {
      return {
        signature: markdown.textContent || '',
        read: () => LongArticle.articleFromRenderedRoot(markdown),
        place(actions) {
          if (actions.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', actions);
        }
      };
    }
    return null;
  }

  const geminiSite = {
    isSupportedPage: GeminiDom.isSupportedPage,
    responses: () => GeminiDom.responses(),
    inspect(response) {
      if (!LongArticle.isArticleRewritePromptText(GeminiDom.userQueryText(response))) return null;
      const source = articleSource(response);
      if (!source) return null;
      return {
        streaming: GeminiDom.isStreaming(response),
        signature: source.signature,
        article: () => LongArticle.validArticle(source.read()),
        place: source.place
      };
    }
  };

  window.CCSModules.GeminiLongArticle = { site: geminiSite };
  LongArticle.start(geminiSite);
})();
