(function() {
  'use strict';

  window.CCSModules = window.CCSModules || {};

  // Both attributes identify a message, unlike selection ids, which also occur
  // on nested content. Keep role checks explicit: a turn now contains both roles.
  const MESSAGE_SELECTOR = '[data-message-author-role], [data-chatgpt-search-unit-key][data-chatgpt-search-message-ids]';
  const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"], [data-chatgpt-search-unit-key$=":assistant"][data-chatgpt-search-message-ids]';
  const TURN_SELECTOR = '[data-testid^="conversation-turn-"], [data-turn-key]';
  const MARKDOWN_SELECTOR = '[data-markdown-text-style="assistant-message"], .markdown';
  const WRITING_BLOCK_SELECTOR = '[data-testid="writing-block-container"], [data-writing-block="true"], [data-testid="chatgpt-writing-block"], [data-oai-writing-block-surface]';
  const WRITING_EDITOR_SELECTOR = '.writing-block-editor .ProseMirror, .ProseMirror.markdown.prose, .ProseMirror.markdown, [contenteditable="true"].markdown';
  const WRITING_BLOCK_HEADER_SELECTOR = '[data-testid="writing-block-header-surface"], [data-testid="writing-block-header-sticky-container"], header';
  const WRITING_BLOCK_COPY_BUTTON_SELECTORS = Object.freeze([
    'button[data-testid="writing-block-copy-button"]',
    'button[data-testid*="copy"]',
    'button[aria-label*="Copy" i]',
    'button[aria-label*="复制"]',
    'button[title*="Copy" i]',
    'button[title*="复制"]'
  ]);

  // Composer (the prompt box). ChatGPT exposes it separately from editable
  // writing blocks: prefer that boundary, because the first textbox on the page
  // can be an article editor and the sidebar can hold a search input.
  const COMPOSER_SELECTORS = Object.freeze([
    'form[data-chatgpt-composer] [data-composer-markdown]',
    'form[data-chatgpt-composer] [contenteditable]:not([contenteditable="false"])',
    'form[data-chatgpt-composer] textarea',
    '[data-composer-markdown][contenteditable]:not([contenteditable="false"])',
    '#prompt-textarea',
    '[data-testid="prompt-textarea"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="plaintext-only"][role="textbox"]',
    '[contenteditable=""][role="textbox"]',
    'textarea[placeholder]',
    'textarea',
    '[contenteditable="true"]'
  ]);
  // Editables inside these belong to articles, messages or search, never the composer.
  const COMPOSER_EXCLUDE_SELECTOR = `.writing-block-editor, ${WRITING_BLOCK_SELECTOR}, [data-message-author-role], [data-chatgpt-search-unit-key], [role="search"]`;
  const SEND_BUTTON_SELECTOR = '[data-testid="send-button"], [data-testid="fruitjuice-send-button"]';
  const STOP_BUTTON_SELECTOR = '[data-testid="stop-button"]';
  const STOP_CONTROL_SELECTOR = `${STOP_BUTTON_SELECTOR}, button[aria-label="Stop generating" i], button[aria-label="停止生成"]`;

  function messageRole(root) {
    const legacy = root.getAttribute('data-message-author-role');
    if (legacy === 'assistant' || legacy === 'user') return legacy;
    if (!root.hasAttribute('data-chatgpt-search-message-ids')) return '';
    const key = root.getAttribute('data-chatgpt-search-unit-key') || '';
    return key.endsWith(':assistant') ? 'assistant' : key.endsWith(':user') ? 'user' : '';
  }

  function messages(root = document) {
    const nodes = Array.from(root.querySelectorAll(MESSAGE_SELECTOR));
    if (root.matches?.(MESSAGE_SELECTOR)) nodes.unshift(root);
    return nodes.filter((node) => {
      const role = messageRole(node);
      if (!role) return false;
      const ancestor = node.parentElement?.closest(MESSAGE_SELECTOR);
      return !ancestor || messageRole(ancestor) !== role || !root.contains(ancestor);
    });
  }

  function assistantMessages(root = document) {
    return messages(root).filter((node) => messageRole(node) === 'assistant');
  }

  function assistantMessageFor(root) {
    const message = root.closest?.(MESSAGE_SELECTOR);
    if (message) {
      if (messageRole(message) !== 'assistant') return null;
      const ancestor = message.parentElement?.closest(ASSISTANT_SELECTOR);
      return ancestor || message;
    }
    return assistantMessages(root)[0] || null;
  }

  function turnFor(root) {
    return root.closest(TURN_SELECTOR);
  }

  function markdownRoots(message) {
    return Array.from(message.querySelectorAll(MARKDOWN_SELECTOR)).filter((node) => {
      const ancestor = node.parentElement?.closest(MARKDOWN_SELECTOR);
      return !ancestor || !message.contains(ancestor);
    });
  }

  function markdownFor(message) {
    return markdownRoots(message)[0] || message;
  }

  function writingBlocks(root) {
    return Array.from(root.querySelectorAll(WRITING_BLOCK_SELECTOR)).filter((node) => {
      const ancestor = node.parentElement?.closest(WRITING_BLOCK_SELECTOR);
      return !ancestor || !root.contains(ancestor);
    });
  }

  function previousUserMessage(assistant) {
    const all = messages();
    let index = all.indexOf(assistant) - 1;
    const turn = turnFor(assistant);
    // New turns contain their own user message. Legacy assistant turns may hold
    // several chunks; only those chunks may be skipped to reach the source.
    while (index >= 0 && turn && turnFor(all[index]) === turn && messageRole(all[index]) === 'assistant') index -= 1;
    const previous = all[index];
    if (turn?.hasAttribute('data-turn-key') && previous && turnFor(previous) !== turn) return null;
    return previous && messageRole(previous) === 'user' ? previous : null;
  }

  function responseCopyButton(turn) {
    const legacy = Array.from(turn.querySelectorAll('button[data-testid="copy-turn-action-button"]'))
      .find((button) => !button.closest(WRITING_BLOCK_SELECTOR));
    if (legacy) return legacy;
    return Array.from(turn.querySelectorAll('.turn-action-controls button')).find((button) => {
      if (button.closest(WRITING_BLOCK_SELECTOR)) return false;
      const name = button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent || '';
      return /^(?:copy|copy response|复制|复制回复)$/iu.test(name.trim());
    }) || null;
  }

  function actionAnchor(copyButton) {
    let anchor = copyButton;
    while (anchor.parentElement) {
      const parent = anchor.parentElement;
      // Tooltip/contents wrappers belong to their original action. Add siblings
      // beside the wrapper so our controls do not inherit its click/tooltip scope.
      if (parent.matches(`[role="toolbar"], [role="group"], .turn-action-controls, header, ${TURN_SELECTOR}, ${MESSAGE_SELECTOR}, ${WRITING_BLOCK_SELECTOR}`)) break;
      if (!parent.matches('span, .contents') || parent.querySelectorAll('button').length !== 1) break;
      anchor = parent;
    }
    return anchor;
  }

  function insertAfterAction(copyButton, node) {
    let anchor = actionAnchor(copyButton);
    // Both integrations can match different assistant chunks in one turn. Keep
    // their shared action row ordered so their observers never move each other
    // back and forth: native Copy, select A, then the long-article actions.
    if (node.matches('[data-ccs-long-article-actions]') &&
        anchor.nextElementSibling?.matches('[data-ccs-select-a-rewrite]')) {
      anchor = anchor.nextElementSibling;
    }
    if (node.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', node);
  }

  window.CCSModules.ChatGptDom = {
    MESSAGE_SELECTOR, ASSISTANT_SELECTOR, TURN_SELECTOR, MARKDOWN_SELECTOR,
    WRITING_BLOCK_SELECTOR, WRITING_EDITOR_SELECTOR, WRITING_BLOCK_HEADER_SELECTOR,
    WRITING_BLOCK_COPY_BUTTON_SELECTORS, COMPOSER_SELECTORS, COMPOSER_EXCLUDE_SELECTOR,
    SEND_BUTTON_SELECTOR, STOP_BUTTON_SELECTOR, STOP_CONTROL_SELECTOR, messageRole, messages,
    assistantMessages, assistantMessageFor, turnFor, markdownRoots, markdownFor,
    writingBlocks, previousUserMessage, responseCopyButton, actionAnchor, insertAfterAction
  };
})();
