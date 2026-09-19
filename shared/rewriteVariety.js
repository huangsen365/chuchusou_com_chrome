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
   *   第二视角 = secondLenses[(n * 5 + floor(n / 12)) % 12]  5 与 12 互质，相邻两篇必不同
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

  function resolvePlan(config, counter) {
    const n = normalizeCounter(counter) ?? 0;
    return {
      counter: n,
      title: pick(config?.titleForms, n),
      opening: pick(config?.openingForms, n),
      ending: pick(config?.endingForms, n + Math.floor(n / 5)),
      lens: pick(config?.secondLenses, n * 5 + Math.floor(n / 12))
    };
  }

  function renderPlan(plan) {
    if (!plan || !plan.title || !plan.opening || !plan.ending) return '';
    const lines = [
      `- 主标题采用「${plan.title}」的形式；`,
      `- 开头从「${plan.opening}」进入；`,
      `- 结尾用「${plan.ending}」收束；`
    ];
    if (plan.lens) {
      lines.push(`- 如果素材允许，可以从「${plan.lens}」的角度补一个类比或解释；素材不允许就不补，不要为了用它而扭曲素材。`);
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
    seedFromDate,
    resolvePlan,
    renderPlan,
    apply,
    nextCounter,
    buildPlanText
  });
})();
