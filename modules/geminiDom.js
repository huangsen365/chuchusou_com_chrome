(function() {
  'use strict';

  window.CCSModules = window.CCSModules || {};

  // Gemini（gemini.google.com）的页面结构只写在这里（2026-10 实测）：
  //   每条回复是 <model-response>，正文在 message-content 里的 .markdown（生成中 aria-busy="true"）；
  //   速答要求的 writing block 在 Gemini 上落成 <code-block>：头部 .code-block-decoration 放「Plaintext」
  //   标签和下载 / 复制按钮（右侧 .buttons 一组，头部吸顶），正文在 pre > code；没标语言的代码块
  //   （例如 ``` 不带 markdown）没有这个头部，内容直接是 pre。有底色和大圆角的那层是
  //   .formatted-code-block-internal-container（头部也在它里面）；
  //   回复底栏是 <message-actions>，其中 <copy-button> 是整条回复的复制（不随界面语言变）；
  //   一轮问答是 .conversation-container，用户那条是其中的 <user-query>（折叠显示时全文仍在 DOM 里）。
  const RESPONSE_SELECTOR = 'model-response';
  const MARKDOWN_SELECTOR = 'message-content .markdown, .markdown.markdown-main-panel';
  const CODE_BLOCK_SELECTOR = 'code-block';
  const CODE_BLOCK_CHROME_SELECTOR = '.code-block-decoration';
  const CODE_BLOCK_ACTIONS_SELECTOR = '.code-block-decoration .buttons';
  // 按顺序取：看得见的框优先（它在 .code-block 里面，合成一个选择器会先命中外层）
  const CODE_BLOCK_FRAME_SELECTORS = Object.freeze(['.formatted-code-block-internal-container', '.code-block']);
  const CODE_CONTENT_SELECTOR = 'pre code, pre';
  const RESPONSE_COPY_SELECTOR = 'message-actions copy-button';
  const TURN_SELECTOR = '.conversation-container';
  const USER_QUERY_SELECTOR = 'user-query';

  function isSupportedPage() {
    return location.hostname.toLowerCase() === 'gemini.google.com';
  }

  function responses(root = document) {
    return Array.from(root.querySelectorAll(RESPONSE_SELECTOR));
  }

  function markdownFor(response) {
    return response.querySelector(MARKDOWN_SELECTOR);
  }

  function isStreaming(response) {
    return markdownFor(response)?.getAttribute('aria-busy') === 'true';
  }

  function codeBlockTexts(response) {
    const markdown = markdownFor(response);
    if (!markdown) return [];
    return Array.from(markdown.querySelectorAll(CODE_BLOCK_SELECTOR)).map((block) => {
      const content = block.querySelector(CODE_CONTENT_SELECTOR);
      return String(content?.textContent || '').trim();
    });
  }

  // 回复里唯一代码块头部右侧的按钮组（下载 / 复制代码）；不是恰好一个代码块时返回 null
  function codeBlockActions(response) {
    const blocks = markdownFor(response)?.querySelectorAll(CODE_BLOCK_SELECTOR) || [];
    return blocks.length === 1 ? blocks[0].querySelector(CODE_BLOCK_ACTIONS_SELECTOR) : null;
  }

  // 回复里唯一代码块看得见的那个框（有底色的那层），没有头部时动作行放在它里面最上面
  function codeBlockFrame(response) {
    const blocks = markdownFor(response)?.querySelectorAll(CODE_BLOCK_SELECTOR) || [];
    if (blocks.length !== 1) return null;
    for (const selector of CODE_BLOCK_FRAME_SELECTORS) {
      const frame = blocks[0].querySelector(selector);
      if (frame) return frame;
    }
    return blocks[0];
  }

  function responseCopyAnchor(response) {
    return response.querySelector(RESPONSE_COPY_SELECTOR);
  }

  function userQueryText(response) {
    const query = response.closest(TURN_SELECTOR)?.querySelector(USER_QUERY_SELECTOR);
    return query ? String(query.textContent || '') : '';
  }

  window.CCSModules.GeminiDom = {
    RESPONSE_SELECTOR, MARKDOWN_SELECTOR, CODE_BLOCK_SELECTOR, CODE_BLOCK_CHROME_SELECTOR,
    RESPONSE_COPY_SELECTOR, isSupportedPage, responses, markdownFor, isStreaming,
    codeBlockTexts, codeBlockActions, codeBlockFrame, responseCopyAnchor, userQueryText
  };
})();
