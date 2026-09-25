/**
 * 长文改写：改写提示词装载（含每篇变化安排 / 近期概念）、Google Docs 改写入口。
 */

const CCS_ARTICLE_REWRITE_TARGETS = Object.freeze({
  chatgpt: 'https://chatgpt.com/?q=${PROMPT}',
  claude: 'https://claude.ai/new?q=${PROMPT}'
});
const CCS_GOOGLE_DOC_PATH_PATTERN = /^\/document\/(?:u\/\d+\/)?d\/([^/]+)(?:\/|$)/;
let ccsArticleRewriteTemplatePromise = null;
let ccsArticleRewriteVarietyConfig = null;

function ccsApplyPromptOutputLanguage(template, outputLanguage) {
  // 当前默认简体中文；未来设置层读取用户偏好后把值作为第二个参数传入。
  return globalThis.CCSPromptLanguage?.apply
    ? globalThis.CCSPromptLanguage.apply(template, outputLanguage)
    : String(template || '').split('${outputLanguage}').join(outputLanguage || '简体中文');
}

function ccsGoogleDocId(urlValue) {
  try {
    const url = new URL(String(urlValue || ''));
    const match = url.pathname.match(CCS_GOOGLE_DOC_PATH_PATTERN);
    return url.protocol === 'https:' && url.hostname === 'docs.google.com'
      ? (match?.[1] || '')
      : '';
  } catch (_) {
    return '';
  }
}

function ccsNormalizeGoogleDocUrl(urlValue) {
  try {
    const url = new URL(String(urlValue || ''));
    const documentId = ccsGoogleDocId(url.href);
    if (!documentId) return '';
    url.pathname = `/document/d/${documentId}/edit`;
    url.hash = '';
    return url.href;
  } catch (_) {
    return '';
  }
}

async function ccsLoadArticleRewriteTemplate() {
  if (!ccsArticleRewriteTemplatePromise) {
    ccsArticleRewriteTemplatePromise = fetch(chrome.runtime.getURL('prompts/articleRewritePrompts.json'))
      .then((response) => {
        if (!response.ok) throw new Error(`article-rewrite-template-http-${response.status}`);
        return response.json();
      })
      .then((config) => {
        const template = Array.isArray(config?.templateLines)
          ? config.templateLines.join('\n').trim()
          : '';
        if (!template) throw new Error('article-rewrite-template-empty');
        if (template.split('${url}').length - 1 !== 1) {
          throw new Error('article-rewrite-template-url-placeholder-invalid');
        }
        if (template.split('${outputLanguage}').length - 1 !== 1) {
          throw new Error('article-rewrite-template-language-placeholder-invalid');
        }
        if (template.split('${varietyPlan}').length - 1 !== 1) {
          throw new Error('article-rewrite-template-variety-placeholder-invalid');
        }
        if (template.split('${recentConcepts}').length - 1 !== 1) {
          throw new Error('article-rewrite-template-recent-concepts-placeholder-invalid');
        }
        ccsArticleRewriteVarietyConfig = config?.varietyPlan && typeof config.varietyPlan === 'object'
          ? config.varietyPlan
          : null;
        return template;
      })
      .catch((error) => {
        ccsArticleRewriteTemplatePromise = null;
        throw error;
      });
  }
  return ccsArticleRewriteTemplatePromise;
}

// 统一构造改写提示词：${url} → 来源；${varietyPlan} → 本篇形式安排（轮换计数器，每篇不同）；
// ${outputLanguage} → 目标语言。对话内「选 A」与 Google Docs 两条路径共用。
async function ccsBuildArticleRewritePrompt(sourceText) {
  const template = await ccsLoadArticleRewriteTemplate();
  const variety = globalThis.CCSRewriteVariety;
  const planText = variety?.buildPlanText ? await variety.buildPlanText(ccsArticleRewriteVarietyConfig) : '';
  const withPlan = variety?.apply
    ? variety.apply(template, planText)
    : template.split('${varietyPlan}').join(planText || '（本篇不做额外形式安排，按素材自行选择标题、开头与结尾的形式。）');
  // 近期概念记忆：最近几篇成品里加粗过的概念，本文不要再用
  const memory = globalThis.CCSRewriteConceptMemory;
  const recentText = memory?.buildRecentText ? await memory.buildRecentText() : '';
  const withRecent = memory?.apply
    ? memory.apply(withPlan, recentText)
    : withPlan.split('${recentConcepts}').join(recentText || '（无）');
  return ccsApplyPromptOutputLanguage(withRecent.replace('${url}', sourceText));
}

async function ccsOpenGoogleDocRewrite(sourceUrlValue, target) {
  const sourceUrl = ccsNormalizeGoogleDocUrl(sourceUrlValue);
  const urlPattern = CCS_ARTICLE_REWRITE_TARGETS[target];
  if (!sourceUrl) throw new Error('unsupported-google-doc-url');
  if (!urlPattern) throw new Error('unsupported-rewrite-target');
  const prompt = await ccsBuildArticleRewritePrompt(sourceUrl);
  await ccsOpenPromptUrlPattern(urlPattern, prompt, {
    source: 'google-doc-rewrite',
    taskId: 'article-rewrite',
    engineId: target,
    menuId: `ccs-google-doc-rewrite-${target}`,
    forceRelay: true,
    active: true
  });
  return true;
}

function ccsHandleGetSelectARewritePrompt(request, sender, sendResponse) {
  const requestId = ccsGetRequestId(request, 'ccsGetSelectARewritePrompt');
  const respond = ccsCreateSafeResponder(sendResponse, 'ccsGetSelectARewritePrompt', requestId, 6000);
  const senderUrl = sender?.url || sender?.tab?.url || '';
  let senderHost = '';
  try {
    senderHost = new URL(senderUrl).hostname.toLowerCase();
  } catch (_) {
    senderHost = '';
  }
  if (!(
    senderHost === 'chatgpt.com' || senderHost.endsWith('.chatgpt.com') ||
    senderHost === 'chat.openai.com' || senderHost.endsWith('.chat.openai.com')
  )) {
    respond({ success: false, error: 'sender-not-chatgpt' });
    return true;
  }
  ccsBuildArticleRewritePrompt('原始素材参考本次对话上下文。')
    .then((prompt) => respond({
      success: true,
      prompt: `选A并且按照提示词改写：\n${prompt}`
    }))
    .catch((error) => respond({ success: false, error: error?.message || String(error) }));
  return true;
}

function ccsHandleCreateGoogleDocRewrite(request, sender, sendResponse) {
  const requestId = ccsGetRequestId(request, 'ccsCreateGoogleDocRewrite');
  const respond = ccsCreateSafeResponder(sendResponse, 'ccsCreateGoogleDocRewrite', requestId, 6000);
  const senderUrl = sender?.url || sender?.tab?.url || '';
  const senderDocumentUrl = ccsNormalizeGoogleDocUrl(senderUrl);
  const sourceUrl = ccsNormalizeGoogleDocUrl(request.sourceUrl);
  const senderDocumentId = ccsGoogleDocId(senderUrl);
  const sourceDocumentId = ccsGoogleDocId(request.sourceUrl);
  if (
    !senderDocumentUrl ||
    !sourceUrl ||
    !senderDocumentId ||
    senderDocumentId !== sourceDocumentId
  ) {
    respond({ success: false, error: 'unsupported-google-doc-url' });
    return true;
  }
  ccsOpenGoogleDocRewrite(sourceUrl, request.target)
    .then(() => respond({ success: true }))
    .catch((error) => respond({ success: false, error: error?.message || String(error) }));
  return true;
}

ccsRegisterMessageHandlers({
  ccsGetSelectARewritePrompt: ccsHandleGetSelectARewritePrompt,
  ccsCreateGoogleDocRewrite: ccsHandleCreateGoogleDocRewrite
});
