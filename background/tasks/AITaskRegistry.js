/**
 * AI 任务注册表 (AITaskRegistry)
 *
 * 把"速答壹拾佰 / 触触搜百问 / 优化提示词"这三类 AI 入口统一抽象成
 * "AI 任务 (AITask)"概念。
 *
 * 统一 Schema（规范化后的内部表示）:
 * {
 *   id: 'fastqa' | 'top100' | 'optimize' | ...,
 *   label: '速答壹拾佰',
 *   icon: '⚡',
 *   menuRootId: 'ccs-fastqa-root',       // 对应右键菜单的 root id
 *   menuIdPrefix: 'ccs-fastqa',           // 生成子菜单 id 的前缀
 *   templateVariable: 'input',            // prompt 模板里占位符 (${input} / ${purpose} ...)
 *   hasCategories: false,                 // 是否二级（有 category 维度）
 *   showOpenAll: true,                    // 是否提供"打开以下全部"
 *   template: '...',                      // 无 categories 时的单模板
 *   engines: [ { id, label, urlPattern } ],
 *   categories: [                         // 有 categories 时
 *     { id, label, purpose, template, engines: [...] }
 *   ]
 * }
 *
 * 兼容策略：
 * - 不修改现有 prompts/*.json 结构，通过 adapter 把老结构 normalize 成新 schema
 * - 不接管现有菜单构建流程（老的 populateXxxMenus 仍工作）
 * - 新增的 AITaskHandler 作为运行时"快速通道"，未命中回落到老逻辑
 *
 * 扩展点：将来加"AI 邮件""AI 翻译"等新入口，只需：
 *   1. 新建 prompts/xxxPrompts.json
 *   2. 在 TASK_DEFINITIONS 加一条注册
 *   3. 无需再写新的 _handle*Action / populate*Menus
 */

// 任务定义（声明式）——加新任务只改这里
const TASK_DEFINITIONS = {
  fastqa: {
    id: 'fastqa',
    label: '速答壹拾佰',
    icon: '⚡',
    menuRootId: 'ccs-fastqa-root',
    menuIdPrefix: 'ccs-fastqa',
    promptsFile: 'prompts/fastAnswersPrompts.json',
    templateVariable: 'input',
    hasCategories: false,
    showOpenAll: true
  },
  top100: {
    id: 'top100',
    label: '触触搜百问',
    icon: '💯',
    menuRootId: 'ccs-top100-root',
    menuIdPrefix: 'ccs-top100',
    promptsFile: 'prompts/topQuestionsPrompts.json',
    templateVariable: 'input',
    hasCategories: false,
    showOpenAll: true
  },
  optimize: {
    id: 'optimize',
    label: '优化提示词',
    icon: '🧠',
    menuRootId: 'ccs-optimize-root',
    menuIdPrefix: 'ccs-optimize',
    promptsFile: 'prompts/optimizedPrompts.json',
    templateVariable: 'input',
    hasCategories: true,             // 二维：category × engine
    showOpenAll: true,                // 给 optimize 也加上（每个 category 级 open-all）
    categoryVariable: 'purpose',      // category 会注入到 prompt 的 ${purpose}
    categoryTitlesKey: 'OPTIMIZE_CATEGORY_TITLES'
  },
  cover: {
    id: 'cover',
    label: '封面生成器',
    icon: '🎨',
    menuRootId: 'ccs-cover-root',
    menuIdPrefix: 'ccs-cover',
    promptsFile: 'prompts/coverPrompts.json',
    templateVariable: 'input',
    hasCategories: true,             // 二维：category(风格) × engine
    showOpenAll: false,               // 单引擎，"打开以下全部"无意义
    categoryVariable: 'purpose',      // 风格指令注入到 prompt 的 ${purpose}
    categoryTitlesKey: 'COVER_CATEGORY_TITLES'
  }
};

// 规范化后的任务缓存
const _taskCache = new Map();

/**
 * 加载 + 规范化一个任务定义。返回统一 schema 的对象。
 */
async function loadTask(taskId) {
  if (_taskCache.has(taskId)) return _taskCache.get(taskId);
  const def = TASK_DEFINITIONS[taskId];
  if (!def) return null;

  try {
    const url = chrome.runtime.getURL(def.promptsFile);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.json();

    const task = _normalize(def, raw);
    _taskCache.set(taskId, task);
    return task;
  } catch (err) {
    console.warn(`[AITaskRegistry] loadTask(${taskId}) failed:`, err?.message);
    return null;
  }
}

/**
 * 把原始 prompts JSON 规范化成统一 schema。
 * 同时保留原始字段以便兼容。
 */
function _normalize(def, raw) {
  const template = Array.isArray(raw.templateLines)
    ? raw.templateLines.join('\n')
    : (raw.template || '');

  const task = {
    ...def,
    label: raw.label || def.label,
    icon: raw.icon || def.icon,
    // 允许 JSON 覆盖 showOpenAll
    showOpenAll: typeof raw.showOpenAll === 'boolean' ? raw.showOpenAll : def.showOpenAll,
    template,
    engines: [],
    categories: []
  };

  if (def.hasCategories && Array.isArray(raw.categories)) {
    task.categories = raw.categories.map((cat) => {
      const catTemplate = Array.isArray(cat.templateLines)
        ? cat.templateLines.join('\n')
        : (cat.template || template);  // 无 category 模板则回退到顶层模板
      return {
        id: cat.id,
        label: cat.label,
        purpose: cat.purpose || cat.label || '',
        template: catTemplate,
        engines: Array.isArray(cat.engines) ? cat.engines.map(_normEngine) : []
      };
    });
  }

  if (Array.isArray(raw.engines)) {
    task.engines = raw.engines.map(_normEngine);
  }

  return task;
}

function _normEngine(e) {
  return {
    id: e.id,
    label: e.label,
    urlPattern: e.urlPattern
  };
}

/**
 * 构造一个任务的 prompt 文本。
 *
 * @param {string} taskId
 * @param {string} keyword 用户原文（已做字数保护）
 * @param {Object} [options]
 * @param {string} [options.categoryId] 若 hasCategories，必须提供
 * @returns {Promise<string|null>}
 */
async function buildTaskPrompt(taskId, keyword, options = {}) {
  const task = await loadTask(taskId);
  if (!task) return null;

  let template = task.template;
  let purpose = '';

  if (task.hasCategories) {
    const cat = (task.categories || []).find((c) => c.id === options.categoryId);
    if (!cat) return null;
    template = cat.template || template;
    purpose = cat.purpose || cat.label || '';
  }

  if (!template) return null;

  // 变量替换
  let prompt = template;
  prompt = prompt.split('${' + task.templateVariable + '}').join(keyword || '');
  if (task.categoryVariable) {
    prompt = prompt.split('${' + task.categoryVariable + '}').join(purpose);
  }
  return prompt;
}

/**
 * 获取某任务下某引擎的 URL pattern。
 * 如果有 category，优先从该 category 的 engines 里找。
 */
async function getTaskEngineUrl(taskId, engineId, options = {}) {
  const task = await loadTask(taskId);
  if (!task) return null;

  let enginePool = task.engines;
  if (task.hasCategories && options.categoryId) {
    const cat = (task.categories || []).find((c) => c.id === options.categoryId);
    if (cat) enginePool = cat.engines;
  }
  const engine = (enginePool || []).find((e) => e.id === engineId);
  return engine?.urlPattern || null;
}

/**
 * 列出某任务下所有可用引擎（过滤启用状态）。
 * 用于"打开以下全部"。
 *
 * @returns {Promise<Array<{id, label, urlPattern, menuId}>>}
 */
async function listTaskEngines(taskId, options = {}) {
  const task = await loadTask(taskId);
  if (!task) return [];

  let pool = task.engines;
  let menuIdBuilder = (eid) => `${task.menuIdPrefix}-${eid}`;

  if (task.hasCategories && options.categoryId) {
    const cat = (task.categories || []).find((c) => c.id === options.categoryId);
    if (!cat) return [];
    pool = cat.engines;
    menuIdBuilder = (eid) => `${task.menuIdPrefix}-${options.categoryId}-${eid}`;
  }

  const out = [];
  for (const e of pool || []) {
    const menuId = menuIdBuilder(e.id);
    if (typeof isMenuEnabled === 'function' && !isMenuEnabled(menuId)) continue;
    out.push({ id: e.id, label: e.label, urlPattern: e.urlPattern, menuId });
  }
  return out;
}

/**
 * 根据 menuItemId 反解出所属任务和维度参数。
 *
 * @param {string} menuId
 * @returns {{ taskId, engineId, categoryId } | null}
 */
function resolveMenuId(menuId) {
  if (!menuId) return null;

  for (const [taskId, def] of Object.entries(TASK_DEFINITIONS)) {
    const prefix = def.menuIdPrefix + '-';
    if (!menuId.startsWith(prefix)) continue;
    if (menuId === def.menuRootId) return { taskId, root: true };
    const rest = menuId.slice(prefix.length);

    // open-all 特殊形式
    if (rest === 'open-all') return { taskId, openAll: true, all: true };
    if (def.hasCategories && rest.endsWith('-open-all')) {
      const catId = rest.slice(0, -'-open-all'.length);
      return { taskId, openAll: true, categoryId: catId };
    }

    if (def.hasCategories) {
      // rest = "<categoryId>" 或 "<categoryId>-<engineId>"
      // 简化：找最后一段作 engineId，前面作 categoryId
      // 但 categoryId 本身可能带连字符，如 "deep-research"
      // 约定：engineId 必须是已知引擎（chatgpt/claude/grok/yiyan/google-ai）
      const KNOWN_ENGINE_IDS = ['chatgpt-images', 'chatgpt', 'claude', 'grok', 'yiyan', 'google-ai'];
      for (const eid of KNOWN_ENGINE_IDS) {
        if (rest === eid) {
          // 未带 category，不是合法叶子
          return null;
        }
        if (rest.endsWith('-' + eid)) {
          const catId = rest.slice(0, rest.length - eid.length - 1);
          return { taskId, categoryId: catId, engineId: eid };
        }
      }
      // 只有 categoryId 无 engineId → 分类节点（submenu）
      if (rest && !rest.includes('/')) return { taskId, categoryId: rest };
    } else {
      // rest 就是 engineId
      return { taskId, engineId: rest };
    }
  }
  return null;
}

/**
 * 提供给 MenuBuilder 用：列出所有任务定义。
 */
function listTaskDefinitions() {
  return Object.values(TASK_DEFINITIONS).map((d) => ({ ...d }));
}

// 导出
globalThis.AITaskRegistry = {
  TASK_DEFINITIONS,
  loadTask,
  buildTaskPrompt,
  getTaskEngineUrl,
  listTaskEngines,
  resolveMenuId,
  listTaskDefinitions,
  _clearCache: () => _taskCache.clear()  // 测试/重载用
};
