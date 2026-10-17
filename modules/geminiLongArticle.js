(function() {
  'use strict';

  // Gemini 版「注入X草稿 / 生成封面」：选A改写产出的长文放这两个动作——文章在代码块里时放在代码块头部右上角
  // （下载 / 复制代码后面，头部吸顶、生成中就在），渲染成页面时放在整条回复底栏的复制按钮后面。
  // 按钮、状态机与投递共用 modules/longArticleActions.js，这里只回答 Gemini 页面上的三件事：
  //   哪条回复是改写工作流的长文（同一轮用户消息是改写提示词）、文章怎么取、按钮放哪。
  // Gemini 常把整篇放进「Markdown」代码块（原文 # 主标题 / ## 小标题 / **加粗**），也可能直接渲染成页面。
  window.CCSModules = window.CCSModules || {};
  const GeminiDom = window.CCSModules.GeminiDom;
  const LongArticle = window.CCSModules.LongArticleActions;
  if (!GeminiDom || !LongArticle) return;

  function articleSource(response) {
    const markdown = GeminiDom.markdownFor(response);
    if (!markdown) return null;
    const blocks = GeminiDom.codeBlockTexts(response);
    if (blocks.length === 1 && /^#\s+\S/u.test(blocks[0])) {
      const header = GeminiDom.codeBlockActions(response);
      if (!header) return null;
      return {
        signature: blocks[0],
        read: () => LongArticle.articleFromMarkdown(blocks[0]),
        place(actions) {
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
