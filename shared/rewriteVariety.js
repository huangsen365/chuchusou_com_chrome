(function() {
  'use strict';

  /**
   * 长文改写「形式轮换」的 legacy 运行时单一来源（SW 与内容脚本共用）。
   *
   * 单次提示词没有跨文章记忆，模型每次都会退回自己最熟的那几种标题 / 开头 / 结尾。
   * 这里用一个本地轮换计数器 n 查表，把「本篇采用哪种形式」写成具体指令注入
   * ${varietyPlan}。它只安排形式和一个可选的第二视角，概念仍然只能来自素材
   * （见 articleRewritePrompts.json 第四节「知识跟着素材走」）。
   *
   * 映射（表在 articleRewritePrompts.json 的 varietyPlan 字段里，可直接改）：
   *   标题   = titleForms[n % 6]
   *   开头   = openingForms[n % 5]
   *   结尾   = endingForms[(n + floor(n / 5)) % 5]     相邻两篇必不同，且与开头的配对每 5 篇漂移一次
   *   可借学科 = disciplinePool[((3n + i) * 7) % 60]，i = 0..2  7 与 60 互质：相邻两篇切片不重叠，20 篇轮完全池；
   *              上一篇（n-1）的切片本篇自动排除，无需存储
   *   概念处理 = conceptModes[(n + floor(n / 4)) % 4]          步长 1 或 2，相邻两篇必不同（加粗目标 4～6、上限 8，固定不轮换）
   */
  const PLACEHOLDER = '${varietyPlan}';
  const COUNTER_KEY = 'ccs_rewrite_variety_counter';
  const EMPTY_PLAN_TEXT = '（本篇不做额外形式安排，按素材自行选择标题、开头与结尾的形式。）';
  const CYCLE = 1800;

  function pick(list, index) {
    if (!Array.isArray(list) || list.length === 0) return '';
    const size = list.length;
    const value = list[((index % size) + size) % size];
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizeCounter(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  }

  // 首次使用没有计数器时，用日期 + 小时做起点：不同用户从轮换周期的不同位置开始
  function seedFromDate(date) {
    // 不用 instanceof（跨 realm 会失败），用鸭子类型判断
    const d = date && typeof date.getTime === 'function' && !Number.isNaN(date.getTime()) ? date : new Date();
    const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
    const dayOfYear = Math.floor((d.getTime() - yearStart) / 86400000);
    return ((dayOfYear * 24 + d.getUTCHours()) % CYCLE + CYCLE) % CYCLE;
  }

  const SLICE_SIZE = 3;
  const SLICE_STRIDE = 7;

  // 第 n 篇可借用的学科切片：池按类分组时，步长 7 让三个学科落在不同类
  function disciplineSlice(pool, n) {
    if (!Array.isArray(pool) || pool.length === 0) return [];
    const out = [];
    for (let i = 0; i < SLICE_SIZE; i++) {
      const term = pick(pool, (SLICE_SIZE * n + i) * SLICE_STRIDE);
      if (term && !out.includes(term)) out.push(term);
    }
    return out;
  }

  function resolvePlan(config, counter) {
    const n = normalizeCounter(counter) ?? 0;
    return {
      counter: n,
      title: pick(config?.titleForms, n),
      opening: pick(config?.openingForms, n),
      ending: pick(config?.endingForms, n + Math.floor(n / 5)),
      mode: pick(config?.conceptModes, n + Math.floor(n / 4)),
      disciplines: disciplineSlice(config?.disciplinePool, n),
      excludedDisciplines: disciplineSlice(config?.disciplinePool, n - 1)
    };
  }

  function renderPlan(plan) {
    if (!plan || !plan.title || !plan.opening || !plan.ending) return '';
    const lines = [
      `- 主标题采用「${plan.title}」的形式；`,
      `- 开头从「${plan.opening}」进入；`,
      `- 结尾用「${plan.ending}」收束；`
    ];
    if (Array.isArray(plan.disciplines) && plan.disciplines.length) {
      lines.push(`- 本篇可借用的学科（只在需要外部概念解释素材里的具体机制时借，每个借来的概念都要对应素材关键词表；其余学科的概念本篇不用）：${plan.disciplines.join('、')}；`);
    }
    if (Array.isArray(plan.excludedDisciplines) && plan.excludedDisciplines.length) {
      lines.push(`- 上一篇借用过的学科，本篇不借：${plan.excludedDisciplines.join('、')}；`);
    }
    if (plan.mode) {
      lines.push(`- 概念处理：${plan.mode}；加粗目标 4～6 个，最多 8 个。`);
    }
    return lines.join('\n');
  }

  function apply(template, planText) {
    const text = typeof planText === 'string' && planText.trim() ? planText.trim() : EMPTY_PLAN_TEXT;
    return String(template || '').split(PLACEHOLDER).join(text);
  }

  function storageArea() {
    return globalThis.chrome?.storage?.local || null;
  }

  // 读当前 n → 写回 n + 1 → 返回本篇使用的 n。没有 storage（测试 / 受限环境）时退回日期种子。
  function nextCounter() {
    return new Promise((resolve) => {
      const area = storageArea();
      if (!area?.get || !area?.set) {
        resolve(seedFromDate());
        return;
      }
      try {
        area.get([COUNTER_KEY], (data) => {
          void globalThis.chrome?.runtime?.lastError;
          const stored = normalizeCounter(data?.[COUNTER_KEY]);
          const n = stored == null ? seedFromDate() : stored;
          try {
            area.set({ [COUNTER_KEY]: (n + 1) % CYCLE }, () => {
              void globalThis.chrome?.runtime?.lastError;
              resolve(n);
            });
          } catch (_) {
            resolve(n);
          }
        });
      } catch (_) {
        resolve(seedFromDate());
      }
    });
  }

  async function buildPlanText(config) {
    const n = await nextCounter();
    return renderPlan(resolvePlan(config, n));
  }

  globalThis.CCSRewriteVariety = Object.freeze({
    PLACEHOLDER,
    COUNTER_KEY,
    EMPTY_PLAN_TEXT,
    CYCLE,
    SLICE_SIZE,
    SLICE_STRIDE,
    seedFromDate,
    disciplineSlice,
    resolvePlan,
    renderPlan,
    apply,
    nextCounter,
    buildPlanText
  });
})();
