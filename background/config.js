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

// 统一菜单配置缓存
let unifiedMenuConfig = null;

async function loadUnifiedMenuConfig() {
  if (unifiedMenuConfig) return unifiedMenuConfig;
  try {
    const url = chrome.runtime.getURL('config/unifiedMenuConfig.json');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load unified menu config: ${response.status}`);
    }
    unifiedMenuConfig = await response.json();
    return unifiedMenuConfig;
  } catch (error) {
    console.warn('[触触搜][BG] Failed to load unified menu config:', error);
    unifiedMenuConfig = null;
    return null;
  }
}

async function loadMenuToggleConfig() {
  // 现在使用统一配置，menuToggleConfig 作为兼容层
  if (menuToggleConfig) return menuToggleConfig;

  // 加载统一配置
  const config = await loadUnifiedMenuConfig();
  if (!config) {
    menuToggleConfig = {};
    return menuToggleConfig;
  }

  // 从统一配置中提取 enabled 状态，构建 menuToggleConfig
  menuToggleConfig = {};

  // 处理所有菜单组中的项目
  if (Array.isArray(config.groups)) {
    for (const group of config.groups) {
      if (Array.isArray(group.items)) {
        for (const item of group.items) {
          if (item.id && typeof item.enabled === 'boolean') {
            menuToggleConfig[item.id] = item.enabled;
          }
          // 处理子菜单
          if (Array.isArray(item.children)) {
            for (const child of item.children) {
              if (child.id && typeof child.enabled === 'boolean') {
                menuToggleConfig[child.id] = child.enabled;
              }
            }
          }
        }
      }
    }
  }

  return menuToggleConfig;
}

function isMenuEnabled(menuId) {
  if (!menuToggleConfig) return true;
  const flag = menuToggleConfig[menuId];
  if (typeof flag === 'boolean') {
    return flag;
  }
  return true;
}

// 引擎配置缓存
let enginesConfig = null;

async function loadEnginesConfig() {
  if (enginesConfig) return enginesConfig;
  try {
    const url = chrome.runtime.getURL('config/engines.json');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load engines config: ${response.status}`);
    }
    enginesConfig = await response.json();
    return enginesConfig;
  } catch (error) {
    console.warn('[触触搜][BG] Failed to load engines config:', error);
    enginesConfig = null;
    return null;
  }
}

function getEngine(engineId) {
  if (!enginesConfig || !enginesConfig.engines) return null;
  return enginesConfig.engines[engineId] || null;
}

function getEngineUrlPattern(engineId, type = 'prompt') {
  const engine = getEngine(engineId);
  if (!engine) return null;
  return type === 'search' ? engine.searchUrlPattern : engine.urlPattern;
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

