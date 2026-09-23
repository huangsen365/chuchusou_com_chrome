/**
 * AI 任务处理器 (AITaskHandler)
 *
 * 替代原来分散在三处的 _handleFastQaAction / _handleTop100Action /
 * _handleOptimizeAction 的核心逻辑，统一成一个 handle(taskId, options) 接口。
 *
 * 处理流程：
 *   1. 加载任务定义（AITaskRegistry）
 *   2. 应用字数保护（TextLimits）
 *   3. 构造 prompt
 *   4. 取目标引擎 URL 模板
 *   5. 替换 ${PROMPT} → 打开 tab
 *   6. 若 openAll，则对任务下所有已启用引擎循环执行
 *
 * 所有错误都吞掉并返回 { success: false, error, reason }，调用方可自行决定是否
 * 回落到老逻辑。
 */

async function buildAITaskPromptUrl(urlPattern, prompt, meta = {}) {
  if (typeof ccsPrepareAIPromptUrl === 'function') {
    return ccsPrepareAIPromptUrl(urlPattern, prompt, meta);
  }
  if (typeof ccsPrepareChatGptPromptUrl === 'function') {
    return ccsPrepareChatGptPromptUrl(urlPattern, prompt, meta);
  }
  return String(urlPattern || '').split('${PROMPT}').join(encodeURIComponent(prompt || ''));
}

async function openAITaskUrl(url, active) {
  if (typeof ccsOpenPreparedAIPromptUrl === 'function') {
    await ccsOpenPreparedAIPromptUrl(url, { active });
    return;
  }
  if (typeof ccsOpenPreparedChatGptPromptUrl === 'function') {
    await ccsOpenPreparedChatGptPromptUrl(url, { active });
    return;
  }
  const opts = { url };
  if (active !== undefined) opts.active = active;
  chrome.tabs.create(opts);
}

/**
 * 执行一个 AI 任务。
 *
 * @param {Object} options
 * @param {string} options.taskId      - 'fastqa' | 'top100' | 'optimize' | 'cover'
 * @param {string} options.keyword     - 用户选中文字（原始，未编码）
 * @param {string} [options.engineId]  - 目标引擎 id；若为 openAll 可省略
 * @param {string} [options.categoryId]- 二维任务（optimize/cover）的分类 id
 * @param {boolean}[options.openAll]   - 是否"打开以下全部"
 * @param {number} [options.tabId]     - 用于 toast 提示
 * @param {string} [options.purposeOverride] - 运行时覆盖 JSON 里 categories[].purpose（cover 自定义风格用）
 * @returns {Promise<{success:boolean, error?:string, opened?:number}>}
 */
async function runAITask(options = {}) {
  const { taskId, keyword, engineId, categoryId, openAll, tabId, purposeOverride } = options;

  if (!taskId || typeof AITaskRegistry === 'undefined') {
    return { success: false, error: 'registry-unavailable' };
  }
  if (!keyword) {
    return { success: false, error: 'no-keyword' };
  }

  const task = await AITaskRegistry.loadTask(taskId);
  if (!task) return { success: false, error: 'task-not-found' };

  const openAllAxis = task.openAllAxis || 'engine';
  // 二维任务必须给 categoryId —— 但 axis === 'category' 的 openAll（如 cover 一键打开 4 种风格）天然没有 categoryId
  if (task.hasCategories && !categoryId && !(openAll && openAllAxis === 'category')) {
    return { success: false, error: 'missing-category' };
  }

  // 字数保护：以 menuId 为维度决定上限。menuId 用来让 TextLimits 判定引擎类型。
  // 这里的 menuId 取具体叶子（或其中一个引擎，如 openAll 情况）
  let sampleMenuId;
  if (openAll) {
    if (openAllAxis === 'category') {
      // 沿 category 轴批量：用 task 顶层 open-all 作为代表 id
      sampleMenuId = `${task.menuIdPrefix}-open-all`;
    } else {
      sampleMenuId = task.hasCategories
        ? `${task.menuIdPrefix}-${categoryId}-open-all`
        : `${task.menuIdPrefix}-open-all`;
    }
  } else {
    sampleMenuId = task.hasCategories
      ? `${task.menuIdPrefix}-${categoryId}-${engineId}`
      : `${task.menuIdPrefix}-${engineId}`;
  }

  let effectiveKeyword = keyword;
  if (typeof applyTextLimit === 'function') {
    const limited = applyTextLimit(sampleMenuId, keyword, { tabId });
    effectiveKeyword = limited.text;
  }

  // 任务级运行时变量（如 cover 的比例）—— 单一数据源 = chrome.storage.local
  // 这样 sidepanel/events/menuHandlers 三处调用方都不用关心 ratio 透传
  const vars = await collectTaskVars(taskId, { task, categoryId, openAll });

  // 分支：openAll 沿 category 轴（cover）vs openAll 沿 engine 轴 vs 单一引擎
  if (openAll && openAllAxis === 'category') {
    const skipSet = new Set(task.openAllSkipCategoryIds || []);
    const targetCats = (task.categories || []).filter((c) => c && c.id && !skipSet.has(c.id));
    if (!targetCats.length) return { success: false, error: 'no-categories' };
    let opened = 0;
    for (const cat of targetCats) {
      const engine = (cat.engines || [])[0];
      if (!engine || !engine.urlPattern) continue;
      // 每个 category 独立构造 prompt（注入它自己的 purpose）—— 这就是「打开以下全部预设风格」的意义
      const catPrompt = await AITaskRegistry.buildTaskPrompt(taskId, effectiveKeyword, { categoryId: cat.id, vars });
      if (!catPrompt) continue;
      let url = await buildAITaskPromptUrl(engine.urlPattern, catPrompt, {
        source: 'ai-task',
        taskId,
        categoryId: cat.id,
        engineId: engine.id || '',
        menuId: `${task.menuIdPrefix}-${cat.id}-${engine.id || ''}`
      });
      if (typeof enforceFinalUrlCap === 'function') url = enforceFinalUrlCap(url);
      try {
        await openAITaskUrl(url, opened === 0);
        opened++;
      } catch (_) { /* ignore */ }
    }
    return { success: true, opened };
  }

  const prompt = await AITaskRegistry.buildTaskPrompt(taskId, effectiveKeyword, { categoryId, purposeOverride, vars });
  if (!prompt) return { success: false, error: 'template-invalid' };

  if (openAll) {
    const engines = await AITaskRegistry.listTaskEngines(taskId, { categoryId });
    if (!engines.length) return { success: false, error: 'no-enabled-engines' };
    let opened = 0;
    for (const e of engines) {
      if (!e.urlPattern) continue;
      let url = await buildAITaskPromptUrl(e.urlPattern, prompt, {
        source: 'ai-task',
        taskId,
        categoryId: categoryId || '',
        engineId: e.id || '',
        menuId: e.menuId || ''
      });
      if (typeof enforceFinalUrlCap === 'function') url = enforceFinalUrlCap(url);
      try {
        await openAITaskUrl(url, opened === 0);
        opened++;
      } catch (_) { /* ignore */ }
    }
    return { success: true, opened };
  }

  // 单一引擎
  if (!engineId) return { success: false, error: 'missing-engine' };
  const urlPattern = await AITaskRegistry.getTaskEngineUrl(taskId, engineId, { categoryId });
  if (!urlPattern) return { success: false, error: 'engine-url-not-found' };
  let url = await buildAITaskPromptUrl(urlPattern, prompt, {
    source: 'ai-task',
    taskId,
    categoryId: categoryId || '',
    engineId,
    menuId: sampleMenuId
  });
  if (typeof enforceFinalUrlCap === 'function') url = enforceFinalUrlCap(url);
  await openAITaskUrl(url);
  return { success: true, opened: 1 };
}

/**
 * 根据 menuItemId 自动识别并执行（给 menuHandlers.js 的右键菜单点击用）。
 * 如果 menuId 不属于任何任务，返回 { success: false, error: 'not-ai-task' }，
 * 调用方应走老逻辑 fallback。
 *
 * @param {string} menuItemId
 * @param {string} keyword
 * @param {Object} [options]
 * @param {number} [options.tabId]
 * @returns {Promise<{success:boolean, error?:string, opened?:number, matched:boolean}>}
 */
async function runAITaskByMenuId(menuItemId, keyword, options = {}) {
  if (typeof AITaskRegistry === 'undefined') {
    return { success: false, matched: false, error: 'registry-unavailable' };
  }
  const parsed = AITaskRegistry.resolveMenuId(menuItemId);
  if (!parsed) return { success: false, matched: false, error: 'not-ai-task' };

  // root 节点本身不执行
  if (parsed.root) return { success: false, matched: true, error: 'root-no-action' };

  // 只有 category（即 submenu 节点）不执行
  if (parsed.categoryId && !parsed.engineId && !parsed.openAll) {
    return { success: false, matched: true, error: 'category-no-action' };
  }

  const res = await runAITask({
    taskId: parsed.taskId,
    keyword,
    engineId: parsed.engineId,
    categoryId: parsed.categoryId,
    openAll: parsed.openAll,
    tabId: options.tabId
  });
  return { ...res, matched: true };
}

/**
 * 收集任务运行时变量（注入到 prompt 模板）。
 * 当前只有 cover 任务用：从 chrome.storage.local 读用户选的比例。
 * 未来加任何 task-scoped 模板变量直接在这里扩展。
 */
const COVER_PALETTE_COUNTER_KEY = 'ccs_cover_palette_counter';
const COVER_PALETTE_FALLBACK = '点缀色例如暖黄或橙。';

// 封面配色轮换：带 palettes 的风格（当前仅墨清）每次生成按计数器取下一组，写成具体配色指令
function renderCoverPalette(p) {
  const [bgName, accentName] = String(p.name || '').split('·');
  return `本篇配色：背景以浅色 ${p.bg}${bgName ? `（${bgName}）` : ''}为基调，主标题用深色 ${p.title}，` +
    `点缀色用 ${p.accent}${accentName ? `（${accentName}）` : ''}，只点亮一两个关键字；背景插画与整体氛围也沿用这组配色。`;
}

async function nextCoverPalette(palettes) {
  const data = await new Promise((resolve) => chrome.storage.local.get([COVER_PALETTE_COUNTER_KEY], resolve));
  const stored = Number(data && data[COVER_PALETTE_COUNTER_KEY]);
  const n = Number.isFinite(stored) && stored >= 0 ? Math.floor(stored) : 0;
  await new Promise((resolve) => chrome.storage.local.set({ [COVER_PALETTE_COUNTER_KEY]: (n + 1) % palettes.length }, resolve));
  return palettes[n % palettes.length];
}

async function collectTaskVars(taskId, options = {}) {
  const vars = {};
  if (taskId === 'cover') {
    vars.coverPalette = COVER_PALETTE_FALLBACK;
    try {
      const cats = (options.task && options.task.categories) || [];
      const cat = cats.find((c) => Array.isArray(c.palettes) && c.palettes.length &&
        (options.openAll || c.id === options.categoryId));
      if (cat) vars.coverPalette = renderCoverPalette(await nextCoverPalette(cat.palettes));
    } catch (_) { /* 失败保持兜底，不影响生成 */ }
    try {
      const data = await new Promise((resolve) => {
        chrome.storage.local.get(['ccs_cover_aspect_ratio'], resolve);
      });
      const r = (data && data.ccs_cover_aspect_ratio) || '';
      vars.ratio = (typeof r === 'string' && r.trim()) ? r.trim() : '5:2';
    } catch (_) {
      vars.ratio = '5:2';
    }
  }
  return vars;
}

// 导出
globalThis.AITaskHandler = {
  runAITask,
  runAITaskByMenuId
};
globalThis.runAITask = runAITask;
globalThis.runAITaskByMenuId = runAITaskByMenuId;
