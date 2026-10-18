(function() {
  'use strict';

  // Gemini 版「选A并优化改写」：速答回复（【短篇回答】/【中篇回答】+ A/B）底栏的复制按钮后面加一个入口，
  // 点了把同一份改写提示词填进 Gemini 输入框。页面结构在 modules/geminiDom.js，按钮、匹配与点击逻辑
  // 与 Claude 共用 modules/articleRewriteRuntime.js 的 startSiteSelectAButton。
  window.CCSModules = window.CCSModules || {};
  const GeminiDom = window.CCSModules.GeminiDom;
  const Runtime = window.CCSModules.ArticleRewriteRuntime;
  if (!Runtime || !GeminiDom) return;

  window.CCSModules.GeminiSelectARewrite = Runtime.startSiteSelectAButton({
    siteName: 'Gemini',
    isSupportedPage: GeminiDom.isSupportedPage,
    responses: () => GeminiDom.responses(),
    isStreaming: GeminiDom.isStreaming,
    bodyFor: GeminiDom.markdownFor,
    // 代码块头部的「Plaintext」标签不算回复正文
    ignoreSelector: GeminiDom.CODE_BLOCK_CHROME_SELECTOR,
    blockTexts: GeminiDom.codeBlockTexts,
    copyAnchor: GeminiDom.responseCopyAnchor
  });
})();
