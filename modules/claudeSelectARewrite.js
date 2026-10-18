(function() {
  'use strict';

  // Claude 版「选A并优化改写」：速答回复（【短篇回答】/【中篇回答】+ A/B，两篇回答常是代码块）底栏的
  // 「Copy」后面加一个入口，点了把同一份改写提示词填进 Claude 输入框。页面结构在 modules/claudeDom.js，
  // 按钮、匹配与点击逻辑与 Gemini 共用 modules/articleRewriteRuntime.js 的 startSiteSelectAButton。
  window.CCSModules = window.CCSModules || {};
  const ClaudeDom = window.CCSModules.ClaudeDom;
  const Runtime = window.CCSModules.ArticleRewriteRuntime;
  if (!Runtime || !ClaudeDom) return;

  window.CCSModules.ClaudeSelectARewrite = Runtime.startSiteSelectAButton({
    siteName: 'Claude',
    isSupportedPage: ClaudeDom.isSupportedPage,
    responses: () => ClaudeDom.responses(),
    isStreaming: ClaudeDom.isStreaming,
    bodyFor: ClaudeDom.bodyFor,
    ignoreSelector: ClaudeDom.CHROME_SELECTOR,
    blockTexts: ClaudeDom.codeBlockTexts,
    copyAnchor: ClaudeDom.responseCopyAnchor
  });
})();
