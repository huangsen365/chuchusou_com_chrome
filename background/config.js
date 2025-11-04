async function loadOptimizedPromptConfig() {
  if (optimizedPromptConfig) return optimizedPromptConfig;
  try {
    const url = chrome.runtime.getURL('prompts/optimizedPrompts.json');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load optimized prompt config: ${response.status}`);
    }
    const config = await response.json();
    optimizedPromptConfig = config;
    optimizedPromptTemplate = Array.isArray(config.templateLines)
      ? config.templateLines.join('\n')
      : (config.template || '');
    return optimizedPromptConfig;
  } catch (error) {
    console.error('[触触搜][BG] Failed to load optimized prompt config:', error);
    optimizedPromptConfig = null;
    optimizedPromptTemplate = '';
    return null;
  }
}

async function loadTopQuestionsConfig() {
  if (topQuestionsConfig) return topQuestionsConfig;
  try {
    const url = chrome.runtime.getURL('prompts/topQuestionsPrompts.json');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load top questions config: ${response.status}`);
    }
    const config = await response.json();
    topQuestionsConfig = config;
    topQuestionsTemplate = Array.isArray(config.templateLines)
      ? config.templateLines.join('\n')
      : (config.template || '');
    return topQuestionsConfig;
  } catch (error) {
    console.error('[触触搜][BG] Failed to load top questions config:', error);
    topQuestionsConfig = null;
    topQuestionsTemplate = '';
    return null;
  }
}

async function loadFastAnswersConfig() {
  if (fastAnswersConfig) return fastAnswersConfig;
  try {
    const url = chrome.runtime.getURL('prompts/fastAnswersPrompts.json');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load fast answers config: ${response.status}`);
    }
    const config = await response.json();
    fastAnswersConfig = config;
    fastAnswersTemplate = Array.isArray(config.templateLines)
      ? config.templateLines.join('\n')
      : (config.template || '');
    return fastAnswersConfig;
  } catch (error) {
    console.error('[触触搜][BG] Failed to load fast answers config:', error);
    fastAnswersConfig = null;
    fastAnswersTemplate = '';
    return null;
  }
}

function buildOptimizedPrompt(purpose, inputText) {
  if (!optimizedPromptTemplate) return null;
  const safePurpose = purpose || '';
  const safeInput = inputText || '';
  return optimizedPromptTemplate
    .split('${purpose}').join(safePurpose)
    .split('${input}').join(safeInput);
}

function buildTopQuestionsPrompt(inputText) {
  if (!topQuestionsTemplate) return null;
  const safeInput = inputText || '';
  return topQuestionsTemplate.split('${input}').join(safeInput);
}

function buildFastAnswersPrompt(inputText) {
  if (!fastAnswersTemplate) return null;
  const safeInput = inputText || '';
  return fastAnswersTemplate.split('${input}').join(safeInput);
}

async function loadMenuToggleConfig() {
  if (menuToggleConfig) return menuToggleConfig;
  try {
    const url = chrome.runtime.getURL('config/menuToggles.json');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load menu toggle config: ${response.status}`);
    }
    menuToggleConfig = await response.json();
    return menuToggleConfig;
  } catch (error) {
    console.warn('[触触搜][BG] Failed to load menu toggle config:', error);
    menuToggleConfig = {};
    return menuToggleConfig;
  }
}

function isMenuEnabled(menuId) {
  if (!menuToggleConfig) return true;
  const flag = menuToggleConfig[menuId];
  if (typeof flag === 'boolean') {
    return flag;
  }
  return true;
}

async function loadMenuIconConfig() {
  await loadMenuToggleConfig();
  if (menuIconConfig) return menuIconConfig;
  try {
    const url = chrome.runtime.getURL('config/menuIcons.json');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load menu icon config: ${response.status}`);
    }
    menuIconConfig = await response.json();
    return menuIconConfig;
  } catch (error) {
    console.warn('[触触搜][BG] Failed to load menu icon config:', error);
    menuIconConfig = null;
    return null;
  }
}

function populateOptimizedMenuMap(config) {
  optimizedPromptMenuMap.clear();
  if (!config || !Array.isArray(config.categories)) return;
  config.categories.forEach((category) => {
    const categoryId = category.id;
    if (!categoryId) return;
    const categoryMenuId = `ccs-optimize-${categoryId}`;
    if (!isMenuEnabled(categoryMenuId)) return;
    (category.engines || []).forEach((engine) => {
      if (!engine || !engine.id) return;
      const menuId = `ccs-optimize-${categoryId}-${engine.id}`;
      if (!isMenuEnabled(menuId)) return;
      optimizedPromptMenuMap.set(menuId, {
        purpose: category.purpose || category.label || '',
        urlPattern: engine.urlPattern || ''
      });
    });
  });
}

