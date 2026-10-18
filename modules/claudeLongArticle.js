(function() {
  'use strict';

  // Claude 版「注入X草稿 / 生成封面」：选A改写产出的长文，按钮放在这条回复底栏的「Copy」后面。
  // 按钮、状态机与投递共用 modules/longArticleActions.js，这里只回答 Claude 页面上的三件事：
  //   哪条回复是改写工作流的长文（它前面那条用户消息是改写提示词）、文章怎么取、按钮放哪。
  // Claude 没有 writing block，长文直接渲染成正文（2026-10 实测）：正文第一个元素就是主标题（# 显示成 h2），
  // 小标题是 h3。万一整篇被放进一个代码块（原文 # 主标题），按 Markdown 转换。
  window.CCSModules = window.CCSModules || {};
  const ClaudeDom = window.CCSModules.ClaudeDom;
  const LongArticle = window.CCSModules.LongArticleActions;
  if (!ClaudeDom || !LongArticle) return;

  function articleSource(response) {
    const body = ClaudeDom.bodyFor(response);
    if (!body) return null;
    const blocks = ClaudeDom.codeBlockTexts(response);
    if (blocks.length === 1 && /^#\s+\S/u.test(blocks[0])) {
      return { signature: blocks[0], read: () => LongArticle.articleFromMarkdown(blocks[0]) };
    }
    const title = body.firstElementChild;
    if (blocks.length === 0 && title && /^H[1-3]$/.test(title.tagName)) {
      return { signature: body.textContent || '', read: () => LongArticle.articleFromRenderedRoot(body, title) };
    }
    return null;
  }

  const claudeSite = {
    isSupportedPage: ClaudeDom.isSupportedPage,
    responses: () => ClaudeDom.responses(),
    inspect(response) {
      if (!LongArticle.isArticleRewritePromptText(ClaudeDom.userQueryText(response))) return null;
      const source = articleSource(response);
      const anchor = ClaudeDom.responseCopyAnchor(response);
      if (!source || !anchor) return null;
      return {
        streaming: ClaudeDom.isStreaming(response),
        signature: source.signature,
        article: () => LongArticle.validArticle(source.read()),
        place(actions) {
          if (actions.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', actions);
        }
      };
    }
  };

  window.CCSModules.ClaudeLongArticle = { site: claudeSite };
  LongArticle.start(claudeSite);
})();
