(function() {
  'use strict';

  window.CCSModules = window.CCSModules || {};

  // Claude（claude.ai）的页面结构只写在这里（2026-10 实测）：
  //   每条回复是 [data-testid="assistant-message"]，生成中 data-is-streaming="true"；回复正文在
  //   [data-perf-reply-text]（思考过程的折叠行 [data-cds="TurnStatus"] 不算正文）；
  //   速答要求的 writing block 在 Claude 上落成代码块 [data-not-prose]（悬停才出现的复制按钮 + pre），
  //   A / B 是两个普通段落；选A改写出的长文直接渲染成正文：# 主标题显示成 h2、## 小标题显示成 h3；
  //   回复底栏 [data-testid="message-actions"]（常显）第一个按钮是整条回复的「Copy」；
  //   用户消息是 [data-testid="user-message"]，长提示词全文都在 DOM 里，与回复按文档顺序前后相邻。
  const RESPONSE_SELECTOR = '[data-testid="assistant-message"]';
  const USER_MESSAGE_SELECTOR = '[data-testid="user-message"]';
  const BODY_SELECTOR = '[data-perf-reply-text]';
  const THINKING_SELECTOR = '[data-cds="TurnStatus"]';
  const CODE_BLOCK_SELECTOR = '[data-not-prose]';
  const CODE_CONTENT_SELECTOR = 'pre code, pre';
  const ACTIONS_SELECTOR = '[data-testid="message-actions"]';
  const COPY_LABEL_PATTERN = /^(?:copy|复制)$/iu;
  // 代码块里悬停才出现的「已复制」状态文字等，不算回复正文
  const CHROME_SELECTOR = '[role="status"]';

  function isSupportedPage() {
    const host = location.hostname.toLowerCase();
    return host === 'claude.ai' || host.endsWith('.claude.ai');
  }

  function responses(root = document) {
    return Array.from(root.querySelectorAll(RESPONSE_SELECTOR));
  }

  function isStreaming(response) {
    return response.getAttribute('data-is-streaming') === 'true';
  }

  function bodyFor(response) {
    return Array.from(response.querySelectorAll(BODY_SELECTOR))
      .find((body) => !body.closest(THINKING_SELECTOR)) || null;
  }

  function codeBlocks(response) {
    const body = bodyFor(response);
    if (!body) return [];
    return Array.from(body.querySelectorAll(CODE_BLOCK_SELECTOR))
      .filter((block) => block.querySelector(CODE_CONTENT_SELECTOR));
  }

  function codeBlockTexts(response) {
    return codeBlocks(response).map((block) => String(block.querySelector(CODE_CONTENT_SELECTOR)?.textContent || '').trim());
  }

  // 整条回复的复制按钮：按名字认（英文 / 中文界面），认不出就取底栏第一个按钮
  function responseCopyAnchor(response) {
    const actions = response.querySelector(ACTIONS_SELECTOR);
    if (!actions) return null;
    const buttons = Array.from(actions.querySelectorAll(':scope > button'));
    return buttons.find((button) => COPY_LABEL_PATTERN.test((button.getAttribute('aria-label') || '').trim())) ||
      buttons[0] || null;
  }

  // 这条回复之前最近的一条用户消息
  function userQueryText(response) {
    const before = Array.from(document.querySelectorAll(USER_MESSAGE_SELECTOR))
      .filter((message) => message.compareDocumentPosition(response) & Node.DOCUMENT_POSITION_FOLLOWING);
    const query = before.at(-1);
    return query ? String(query.textContent || '') : '';
  }

  window.CCSModules.ClaudeDom = {
    RESPONSE_SELECTOR, BODY_SELECTOR, CODE_BLOCK_SELECTOR, CHROME_SELECTOR, isSupportedPage, responses,
    isStreaming, bodyFor, codeBlocks, codeBlockTexts, responseCopyAnchor, userQueryText
  };
})();
