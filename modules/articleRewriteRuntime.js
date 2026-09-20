(function() {
  'use strict';

  window.CCSModules = window.CCSModules || {};

  const PROMPT_PATH = 'prompts/articleRewritePrompts.json';
  const URL_PLACEHOLDER = '${url}';
  const SELECT_A_PREFIX = '选A并且按照提示词改写：';
  const CONVERSATION_SOURCE_NOTE = '原始素材参考本次对话上下文。';
  const WRITING_BLOCK_SELECTOR = '[data-testid="writing-block-container"], [data-writing-block="true"]';
  const ASSISTANT_MESSAGE_SELECTOR = '[data-message-author-role="assistant"][data-message-id]';
  const IGNORED_SELECTOR = 'button, [role="toolbar"], nav, menu, [role="menu"]';
  const BLOCK_TAGS = new Set([
    'ADDRESS', 'BLOCKQUOTE', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'OL', 'P', 'PRE', 'SECTION', 'UL'
  ]);
  const GOOGLE_DOC_PATH_PATTERN = /^\/document\/(?:u\/\d+\/)?d\/([^/]+)(?:\/|$)/;
  let promptTemplatePromise = null;

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function requiredSingleLinePattern(prefix, requiredPhrases) {
    return [
      escapeRegExp(prefix),
      ...requiredPhrases.map((phrase) =>
        `(?=[^\\n]*${typeof phrase === 'string' ? escapeRegExp(phrase) : phrase.source})`
      ),
      '[^\\n]+'
    ].join('');
  }

  const FULL_A_PATTERN = requiredSingleLinePattern('A：', [
    '继续生成详细内容', '直接输出正文', '长篇回答', '结尾', '追问', '引导语', /便于(?:直接)?复制使用/u
  ]);
  const FULL_B_PATTERN = requiredSingleLinePattern('B：', [
    '【短篇回答】', '【中篇回答】', '讲人话', '活人感', '他、她', 'TA'
  ]);
  const COMPACT_A_PATTERN = requiredSingleLinePattern('A：', ['继续生成详细内容']);
  const COMPACT_B_PATTERN = requiredSingleLinePattern('B：', [
    '【短篇回答】', '【中篇回答】', '更口语', '活人感'
  ]);

  function answerShapePattern(aPattern, bPattern) {
    return new RegExp([
      '^(?:[^\\n]*[^\\s\\n][^\\n]*\\n+)?【短篇回答】[ \\t]*\\n+([\\s\\S]+?)\\n+',
      '【中篇回答】[ \\t]*\\n+([\\s\\S]+?)\\n+',
      `${aPattern}[ \\t]*\\n+`,
      `${bPattern}$`
    ].join(''), 'u');
  }

  const FULL_RESPONSE_PATTERN = answerShapePattern(FULL_A_PATTERN, FULL_B_PATTERN);
  const COMPACT_RESPONSE_PATTERN = answerShapePattern(COMPACT_A_PATTERN, COMPACT_B_PATTERN);

  function normalizeMatchText(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .trim();
  }

  function matchesAnswerShape(text, pattern) {
    const match = pattern.exec(normalizeMatchText(text));
    return Boolean(match?.[1]?.trim() && match?.[2]?.trim());
  }

  function isFullSelectARewriteResponse(text) {
    return matchesAnswerShape(text, FULL_RESPONSE_PATTERN);
  }

  function isCompactSelectARewriteResponse(text) {
    return matchesAnswerShape(text, COMPACT_RESPONSE_PATTERN);
  }

  function responseTextForMatching(root) {
    const visit = (node, isRoot = false) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
      if (!(node instanceof HTMLElement)) return '';
      if (node.matches(IGNORED_SELECTOR)) return '';
      if (node.tagName === 'BR') return '\n';
      let text = Array.from(node.childNodes).map((child) => visit(child)).join('');
      if (!isRoot && BLOCK_TAGS.has(node.tagName)) {
        if (!text.trim()) return '\n';
        if (!text.endsWith('\n')) text += '\n';
      }
      return text;
    };
    return visit(root, true)
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function assistantMessageFor(root) {
    if (root.matches?.(ASSISTANT_MESSAGE_SELECTOR)) return root;
    return root.closest?.(ASSISTANT_MESSAGE_SELECTOR)
      || root.querySelector?.(ASSISTANT_MESSAGE_SELECTOR)
      || null;
  }

  function implicitTwoWritingBlockText(root) {
    const assistantMessage = assistantMessageFor(root);
    if (!assistantMessage) return '';
    const writingBlocks = Array.from(assistantMessage.querySelectorAll(WRITING_BLOCK_SELECTOR));
    if (writingBlocks.length !== 2) return '';
    const shortText = responseTextForMatching(writingBlocks[0]);
    const middleText = responseTextForMatching(writingBlocks[1]);
    if (!shortText || !middleText) return '';
    const response = assistantMessage.querySelector('.markdown') || assistantMessage;
    const outsideClone = response.cloneNode(true);
    outsideClone.querySelectorAll(WRITING_BLOCK_SELECTOR).forEach((block) => block.remove());
    const outsideText = responseTextForMatching(outsideClone);
    if (!outsideText.startsWith('A：')) return '';
    return ['【短篇回答】', shortText, '【中篇回答】', middleText, outsideText].join('\n');
  }

  function matchesSelectARewriteResponse(assistantMessage) {
    const message = assistantMessageFor(assistantMessage);
    if (!message) return false;
    const response = message.querySelector('.markdown') || message;
    const directText = responseTextForMatching(response);
    if (isFullSelectARewriteResponse(directText)) return true;
    const writingBlocks = Array.from(message.querySelectorAll(WRITING_BLOCK_SELECTOR));
    if (
      writingBlocks.length === 2 &&
      writingBlocks.every((block) => Boolean(responseTextForMatching(block))) &&
      isCompactSelectARewriteResponse(directText)
    ) return true;
    const implicitText = implicitTwoWritingBlockText(message);
    return Boolean(implicitText && isFullSelectARewriteResponse(implicitText));
  }

  function normalizeGoogleDocUrl(urlValue) {
    try {
      const url = new URL(String(urlValue || ''));
      const match = url.pathname.match(GOOGLE_DOC_PATH_PATTERN);
      if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !match?.[1]) return '';
      // Google may add or remove an account segment such as /u/0/ while the
      // same document stays open. Keep the query (notably ?tab=), but make the
      // document path stable so a harmless account-route change is not treated
      // as a different source document.
      url.pathname = `/document/d/${match[1]}/edit`;
      url.hash = '';
      return url.href;
    } catch (_) {
      return '';
    }
  }

  function loadPromptTemplate() {
    if (!promptTemplatePromise) {
      promptTemplatePromise = fetch(chrome.runtime.getURL(PROMPT_PATH))
        .then((response) => {
          if (!response.ok) throw new Error(`提示词模板加载失败（HTTP ${response.status}）`);
          return response.json();
        })
        .then((config) => {
          const template = Array.isArray(config?.templateLines)
            ? config.templateLines.join('\n').trim()
            : '';
          if (!template) throw new Error('文章改写提示词模板为空。');
          if (template.split(URL_PLACEHOLDER).length - 1 !== 1) {
            throw new Error('文章改写提示词必须包含且只包含一个 ${url} 占位符。');
          }
          if (template.split('${outputLanguage}').length - 1 !== 1) {
            throw new Error('文章改写提示词必须包含且只包含一个 ${outputLanguage} 占位符。');
          }
          if (template.split('${varietyPlan}').length - 1 !== 1) {
            throw new Error('文章改写提示词必须包含且只包含一个 ${varietyPlan} 占位符。');
          }
          if (template.split('${recentConcepts}').length - 1 !== 1) {
            throw new Error('文章改写提示词必须包含且只包含一个 ${recentConcepts} 占位符。');
          }
          return { template, variety: config?.varietyPlan && typeof config.varietyPlan === 'object' ? config.varietyPlan : null };
        })
        .catch((error) => {
          promptTemplatePromise = null;
          throw error;
        });
    }
    return promptTemplatePromise;
  }

  async function buildSelectARewritePrompt() {
    const backgroundPrompt = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'ccsGetSelectARewritePrompt' }, (response) => {
          if (chrome.runtime.lastError || !response?.success || typeof response.prompt !== 'string') {
            resolve('');
            return;
          }
          resolve(response.prompt);
        });
      } catch (_) {
        resolve('');
      }
    });
    if (backgroundPrompt) return backgroundPrompt;
    const { template, variety } = await loadPromptTemplate();
    // 后台不可用时的本地回退：同样按轮换计数器生成本篇形式安排
    const varietyApi = globalThis.CCSRewriteVariety;
    const planText = varietyApi?.buildPlanText ? await varietyApi.buildPlanText(variety) : '';
    const withPlan = varietyApi?.apply
      ? varietyApi.apply(template, planText)
      : template.split('${varietyPlan}').join(planText || '（本篇不做额外形式安排，按素材自行选择标题、开头与结尾的形式。）');
    const memoryApi = globalThis.CCSRewriteConceptMemory;
    const recentText = memoryApi?.buildRecentText ? await memoryApi.buildRecentText() : '';
    const withRecent = memoryApi?.apply
      ? memoryApi.apply(withPlan, recentText)
      : withPlan.split('${recentConcepts}').join(recentText || '（无）');
    const prompt = withRecent.replace(URL_PLACEHOLDER, CONVERSATION_SOURCE_NOTE);
    const localizedPrompt = globalThis.CCSPromptLanguage?.apply
      ? globalThis.CCSPromptLanguage.apply(prompt)
      : prompt.split('${outputLanguage}').join('简体中文');
    return `${SELECT_A_PREFIX}\n${localizedPrompt}`;
  }

  function fillCurrentComposer(prompt) {
    const fill = window.CCSModules?.AIPromptFill?.fill;
    if (typeof fill !== 'function') {
      return Promise.resolve({ ok: false, error: 'composer-fill-unavailable' });
    }
    return fill(prompt, { preserveExistingDraft: true, watchSendResidue: true });
  }

  function requestGoogleDocRewrite(sourceUrl, target) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({
          action: 'ccsCreateGoogleDocRewrite',
          sourceUrl,
          target
        }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message || 'runtime-error' });
            return;
          }
          resolve(response || { success: false, error: 'empty-response' });
        });
      } catch (error) {
        resolve({ success: false, error: error?.message || String(error) });
      }
    });
  }

  window.CCSModules.ArticleRewriteRuntime = {
    WRITING_BLOCK_SELECTOR,
    buildSelectARewritePrompt,
    fillCurrentComposer,
    isCompactSelectARewriteResponse,
    isFullSelectARewriteResponse,
    matchesSelectARewriteResponse,
    normalizeGoogleDocUrl,
    requestGoogleDocRewrite,
    responseTextForMatching
  };
})();
