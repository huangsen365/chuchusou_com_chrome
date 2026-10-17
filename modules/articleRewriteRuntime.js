(function() {
  'use strict';

  window.CCSModules = window.CCSModules || {};

  const ChatGptDom = window.CCSModules.ChatGptDom;

  const PROMPT_PATH = 'prompts/articleRewritePrompts.json';
  const URL_PLACEHOLDER = '${url}';
  const SELECT_A_PREFIX = '选A并且按照提示词改写：';
  const CONVERSATION_SOURCE_NOTE = '原始素材参考本次对话上下文。';
  const WRITING_BLOCK_SELECTOR = ChatGptDom.WRITING_BLOCK_SELECTOR;
  const IGNORED_SELECTOR = 'button, [role="toolbar"], nav, menu, [role="menu"]';
  // 新模型会把 A/B 做成单选控件 +「确认选择」，见过两种形态：A/B 两行纯文本后面再跟一组改述过的
  // 单选项（得跳过控件才以 B 行结尾），或 A/B 只出现在单选项里（得把选项当文字读）。两种读法各判一次。
  const CHOICE_WIDGET_SELECTOR = '[role="radiogroup"]';
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

  // ignoreSelector：站点自己的控件区（如 Gemini 代码块头部的「Plaintext」标签），不算回复正文
  function responseTextForMatching(root, { skipChoiceWidgets = false, ignoreSelector = '' } = {}) {
    const ignored = [IGNORED_SELECTOR, skipChoiceWidgets ? CHOICE_WIDGET_SELECTOR : '', ignoreSelector]
      .filter(Boolean)
      .join(', ');
    const visit = (node, isRoot = false) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
      if (!(node instanceof HTMLElement)) return '';
      if (node.matches(ignored)) return '';
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

  function implicitTwoWritingBlockText(root, options) {
    const assistantMessage = ChatGptDom.assistantMessageFor(root);
    if (!assistantMessage) return '';
    const writingBlocks = ChatGptDom.writingBlocks(assistantMessage);
    if (writingBlocks.length !== 2) return '';
    const shortText = responseTextForMatching(writingBlocks[0], options);
    const middleText = responseTextForMatching(writingBlocks[1], options);
    if (!shortText || !middleText) return '';
    const response = ChatGptDom.markdownFor(assistantMessage);
    const outsideClone = response.cloneNode(true);
    outsideClone.querySelectorAll(WRITING_BLOCK_SELECTOR).forEach((block) => block.remove());
    const outsideText = responseTextForMatching(outsideClone, options);
    if (!outsideText.startsWith('A：')) return '';
    return ['【短篇回答】', shortText, '【中篇回答】', middleText, outsideText].join('\n');
  }

  // 站点无关的判定：directText 是整条回复的文字，blockTexts 是回复里独立文本块（ChatGPT 的 writing block、
  // Gemini 的代码块）的正文。完整版 A/B 直接认；紧凑版只在恰好两块且都有内容时认——allowNoBlocks
  // 时（站点可能把两篇回答直接写成段落）没有块也认。
  function matchesSelectARewriteText(directText, blockTexts = [], { allowNoBlocks = false } = {}) {
    if (isFullSelectARewriteResponse(directText)) return true;
    const blocksOk = (blockTexts.length === 2 && blockTexts.every(Boolean)) ||
      (allowNoBlocks && blockTexts.length === 0);
    return blocksOk && isCompactSelectARewriteResponse(directText);
  }

  function matchesResponseText(message, options) {
    const response = ChatGptDom.markdownFor(message);
    const directText = responseTextForMatching(response, options);
    const blockTexts = ChatGptDom.writingBlocks(message).map((block) => responseTextForMatching(block, options));
    if (matchesSelectARewriteText(directText, blockTexts)) return true;
    const implicitText = implicitTwoWritingBlockText(message, options);
    return Boolean(implicitText && isFullSelectARewriteResponse(implicitText));
  }

  function matchesSelectARewriteResponse(assistantMessage) {
    const message = ChatGptDom.assistantMessageFor(assistantMessage);
    if (!message) return false;
    if (matchesResponseText(message)) return true;
    // 第二种读法只在真有单选控件时才算，普通回复不多花一遍
    return Boolean(message.querySelector(CHOICE_WIDGET_SELECTOR)) &&
      matchesResponseText(message, { skipChoiceWidgets: true });
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
        .then((config) => globalThis.CCSPromptTemplate.resolveTemplateFile(config, PROMPT_PATH))
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

  function toast(type, message) {
    const api = window.CCSModules.Toast;
    if (typeof api?.[type] === 'function') api[type](message);
  }

  // 「选A并优化改写」按钮的点击：取改写提示词 → 填进当前站点的输入框（不覆盖草稿、不自动发送）。
  // siteName 只用于提示文案。ChatGPT 与 Gemini 的按钮共用这一份。
  async function fillSelectARewriteFromButton(button, { siteName = 'AI' } = {}) {
    const original = button.textContent || '↗ 选A并优化改写';
    button.disabled = true;
    button.textContent = '⏳ 填入中…';
    try {
      const prompt = await buildSelectARewritePrompt();
      const result = await fillCurrentComposer(prompt);
      if (!result?.ok && result?.stage === 'existing_draft') {
        throw new Error(`${siteName} 输入框已有草稿，为避免覆盖，未填入改写提示词`);
      }
      if (!result?.ok) {
        throw new Error(result?.error === 'composer-not-found'
          ? `未找到 ${siteName} 输入框`
          : `${siteName} 输入框未完整接受改写提示词`);
      }
      button.textContent = '✓ 已填入';
      toast('success', `“选A”与优化改写提示词已填入 ${siteName}，请检查后手动发送`);
    } catch (error) {
      button.textContent = '⚠ 填入失败';
      toast('error', error?.message || String(error));
    } finally {
      window.setTimeout(() => {
        button.disabled = false;
        button.textContent = original;
      }, 2500);
    }
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
    fillSelectARewriteFromButton,
    isCompactSelectARewriteResponse,
    isFullSelectARewriteResponse,
    matchesSelectARewriteResponse,
    matchesSelectARewriteText,
    normalizeGoogleDocUrl,
    requestGoogleDocRewrite,
    responseTextForMatching
  };
})();
