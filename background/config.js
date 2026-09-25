async function loadOptimizedPromptConfig() {
  if (globalThis.optimizedPromptConfig) return globalThis.optimizedPromptConfig;
  try {
    const url = chrome.runtime.getURL('prompts/optimizedPrompts.json');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load optimized prompt config: ${response.status}`);
    }
    const config = await response.json();
    await globalThis.CCSPromptTemplate.resolveTemplateFile(config, 'prompts/optimizedPrompts.json');
    globalThis.optimizedPromptConfig = config;
    globalThis.optimizedPromptTemplate = Array.isArray(config.templateLines)
      ? config.templateLines.join('\n')
      : (config.template || '');
    return globalThis.optimizedPromptConfig;
  } catch (error) {
    console.error('[触触搜][BG] Failed to load optimized prompt config:', error);
    globalThis.optimizedPromptConfig = null;
    globalThis.optimizedPromptTemplate = '';
    return null;
  }
}

async function loadCoverPromptConfig() {
  if (globalThis.coverPromptConfig) return globalThis.coverPromptConfig;
  try {
    const url = chrome.runtime.getURL('prompts/coverPrompts.json');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load cover prompt config: ${response.status}`);
    }
    const config = await response.json();
    await globalThis.CCSPromptTemplate.resolveTemplateFile(config, 'prompts/coverPrompts.json');
    globalThis.coverPromptConfig = config;
    globalThis.coverPromptTemplate = Array.isArray(config.templateLines)
      ? config.templateLines.join('\n')
      : (config.template || '');
    return globalThis.coverPromptConfig;
  } catch (error) {
    console.error('[触触搜][BG] Failed to load cover prompt config:', error);
    globalThis.coverPromptConfig = null;
    globalThis.coverPromptTemplate = '';
    return null;
  }
}

async function loadTopQuestionsConfig() {
  if (globalThis.topQuestionsConfig) return globalThis.topQuestionsConfig;
  try {
    const url = chrome.runtime.getURL('prompts/topQuestionsPrompts.json');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load top questions config: ${response.status}`);
    }
    const config = await response.json();
    await globalThis.CCSPromptTemplate.resolveTemplateFile(config, 'prompts/topQuestionsPrompts.json');
    globalThis.topQuestionsConfig = config;
    globalThis.topQuestionsTemplate = Array.isArray(config.templateLines)
      ? config.templateLines.join('\n')
      : (config.template || '');
    return globalThis.topQuestionsConfig;
  } catch (error) {
    console.error('[触触搜][BG] Failed to load top questions config:', error);
    globalThis.topQuestionsConfig = null;
    globalThis.topQuestionsTemplate = '';
    return null;
  }
}

async function loadFastAnswersConfig() {
  if (globalThis.fastAnswersConfig) return globalThis.fastAnswersConfig;
  try {
    const url = chrome.runtime.getURL('prompts/fastAnswersPrompts.json');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load fast answers config: ${response.status}`);
    }
    const config = await response.json();
    await globalThis.CCSPromptTemplate.resolveTemplateFile(config, 'prompts/fastAnswersPrompts.json');
    globalThis.fastAnswersConfig = config;
    globalThis.fastAnswersTemplate = Array.isArray(config.templateLines)
      ? config.templateLines.join('\n')
      : (config.template || '');
    return globalThis.fastAnswersConfig;
  } catch (error) {
    console.error('[触触搜][BG] Failed to load fast answers config:', error);
    globalThis.fastAnswersConfig = null;
    globalThis.fastAnswersTemplate = '';
    return null;
  }
}

function buildOptimizedPrompt(purpose, inputText) {
  if (!globalThis.optimizedPromptTemplate) return null;
  const safePurpose = purpose || '';
  const safeInput = inputText || '';
  return globalThis.optimizedPromptTemplate
    .split('${purpose}').join(safePurpose)
    .split('${input}').join(safeInput);
}

function buildCoverPrompt(purpose, inputText) {
  if (!globalThis.coverPromptTemplate) return null;
  const safePurpose = purpose || '';
  const safeInput = inputText || '';
  return globalThis.coverPromptTemplate
    .split('${purpose}').join(safePurpose)
    .split('${input}').join(safeInput);
}

function buildTopQuestionsPrompt(inputText) {
  if (!globalThis.topQuestionsTemplate) return null;
  const safeInput = inputText || '';
  return globalThis.topQuestionsTemplate.split('${input}').join(safeInput);
}

function buildFastAnswersPrompt(inputText, outputLanguage) {
  if (!globalThis.fastAnswersTemplate) return null;
  const safeInput = inputText || '';
  const prompt = globalThis.fastAnswersTemplate.split('${input}').join(safeInput);
  // 当前默认简体中文；未来设置层可把用户选择的语言传给共享解析器。
  return globalThis.CCSPromptLanguage?.apply
    ? globalThis.CCSPromptLanguage.apply(prompt, outputLanguage)
    : prompt.split('${outputLanguage}').join(outputLanguage || '简体中文');
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
  if (globalThis.menuToggleConfig && Object.keys(globalThis.menuToggleConfig).length > 0) {
    return globalThis.menuToggleConfig;
  }

  // 加载统一配置
  const config = await loadUnifiedMenuConfig();
  if (!config) {
    globalThis.menuToggleConfig = {};
    return globalThis.menuToggleConfig;
  }

  // 从统一配置中提取 enabled 状态，构建 menuToggleConfig
  globalThis.menuToggleConfig = {};

  // 处理所有菜单组中的项目
  if (Array.isArray(config.groups)) {
    for (const group of config.groups) {
      if (Array.isArray(group.items)) {
        for (const item of group.items) {
          if (item.id && typeof item.enabled === 'boolean') {
            globalThis.menuToggleConfig[item.id] = item.enabled;
          }
          // 处理子菜单
          if (Array.isArray(item.children)) {
            for (const child of item.children) {
              if (child.id && typeof child.enabled === 'boolean') {
                globalThis.menuToggleConfig[child.id] = child.enabled;
              }
            }
          }
        }
      }
    }
  }

  return globalThis.menuToggleConfig;
}

function isMenuEnabled(menuId) {
  if (!globalThis.menuToggleConfig) return true;
  const flag = globalThis.menuToggleConfig[menuId];
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

/**
 * 引擎菜单标题统一 SSoT — 从 config/engines.json 生成 "${icon} ${label}"。
 * 所有 AI 任务（速答/百问/优化）的引擎子菜单标题、popup/sidepanel 都用这个，
 * 不再各自维护 ENGINE_TITLES 表。
 * 回退顺序：engines.json -> fallbackLabel -> id 原样。
 */
function getEngineTitle(engineId, fallbackLabel) {
  const engine = getEngine(engineId);
  if (engine) {
    const icon = engine.icon || '';
    const label = engine.label || fallbackLabel || engineId;
    return icon ? `${icon} ${label}` : label;
  }
  return fallbackLabel || engineId;
}

function getEngineUrlPattern(engineId, type = 'prompt') {
  const engine = getEngine(engineId);
  if (!engine) return null;
  return type === 'search' ? engine.searchUrlPattern : engine.urlPattern;
}

function populateOptimizedMenuMap(config) {
  // 确保 optimizedPromptMenuMap 是一个 Map
  if (!globalThis.optimizedPromptMenuMap || !(globalThis.optimizedPromptMenuMap instanceof Map)) {
    globalThis.optimizedPromptMenuMap = new Map();
  }
  globalThis.optimizedPromptMenuMap.clear();
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
      globalThis.optimizedPromptMenuMap.set(menuId, {
        purpose: category.purpose || category.label || '',
        urlPattern: engine.urlPattern || ''
      });
    });
  });
}

function populateCoverMenuMap(config) {
  if (!globalThis.coverPromptMenuMap || !(globalThis.coverPromptMenuMap instanceof Map)) {
    globalThis.coverPromptMenuMap = new Map();
  }
  globalThis.coverPromptMenuMap.clear();
  if (!config || !Array.isArray(config.categories)) return;
  config.categories.forEach((category) => {
    const categoryId = category.id;
    if (!categoryId) return;
    (category.engines || []).forEach((engine) => {
      if (!engine || !engine.id) return;
      const menuId = `ccs-cover-${categoryId}-${engine.id}`;
      if (!isMenuEnabled(menuId)) return;
      globalThis.coverPromptMenuMap.set(menuId, {
        purpose: category.purpose || category.label || '',
        urlPattern: engine.urlPattern || ''
      });
    });
  });
}

// ==================== 菜单图标配置（存根） ====================

/**
 * 加载菜单图标配置
 * 注意：菜单图标配置文件不存在，此函数返回空配置
 * @returns {Promise<Object|null>}
 */
async function loadMenuIconConfig() {
  // 菜单图标配置文件不存在，返回空配置
  return { items: {} };
}

// ==================== 导出到全局 ====================

globalThis.loadOptimizedPromptConfig = loadOptimizedPromptConfig;
globalThis.loadCoverPromptConfig = loadCoverPromptConfig;
globalThis.loadTopQuestionsConfig = loadTopQuestionsConfig;
globalThis.loadFastAnswersConfig = loadFastAnswersConfig;
globalThis.buildOptimizedPrompt = buildOptimizedPrompt;
globalThis.buildCoverPrompt = buildCoverPrompt;
globalThis.buildTopQuestionsPrompt = buildTopQuestionsPrompt;
globalThis.buildFastAnswersPrompt = buildFastAnswersPrompt;
globalThis.loadUnifiedMenuConfig = loadUnifiedMenuConfig;
globalThis.loadMenuToggleConfig = loadMenuToggleConfig;
globalThis.isMenuEnabled = isMenuEnabled;
globalThis.loadEnginesConfig = loadEnginesConfig;
globalThis.getEngine = getEngine;
globalThis.getEngineTitle = getEngineTitle;
globalThis.getEngineUrlPattern = getEngineUrlPattern;
globalThis.populateOptimizedMenuMap = populateOptimizedMenuMap;
globalThis.populateCoverMenuMap = populateCoverMenuMap;
globalThis.loadMenuIconConfig = loadMenuIconConfig;
