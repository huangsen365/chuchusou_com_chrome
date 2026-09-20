(function() {
  'use strict';

  /**
   * 长文改写「近期概念记忆」的 legacy 运行时单一来源（SW 与内容脚本共用）。
   *
   * 单次提示词没有跨文章记忆，前几层（概念只从素材来 / 特异性检验 / 处理方式轮换）只能压低
   * 重复概率。这里给模型补一个记忆：改写成品就绪时，内容脚本从正文 HTML 里抽出加粗的概念
   * （提示词规定只有概念名称才加粗），存进 chrome.storage.local 保留最近 MAX_RECENT 个；
   * 下次构造改写提示词时注入 ${recentConcepts}，明确要求本文不要再用。全部本地，不上传。
   */
  const PLACEHOLDER = '${recentConcepts}';
  const STORAGE_KEY = 'ccs_rewrite_recent_concepts';
  const MAX_RECENT = 80;
  const MAX_TERM_LENGTH = 30;
  const EMPTY_TEXT = '（无）';
  const TRIM_EDGES = /^[\s*_“”"'「」『』()（）[\]【】]+|[\s*_“”"'「」『』()（）[\]【】，。、；：:,.;!?！？]+$/g;

  function normalizeTerm(value) {
    return String(value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(TRIM_EDGES, '').trim();
  }

  // 模糊去重键：不分大小写、去内部空白与引号、剥掉「效应 / 定律 / 法则 / 模型 / 理论 / 原理 / 思维 / 陷阱 / 现象 / 机制」
  // 这类后缀——「锚定效应」「锚定」记成一条；剥完不足 2 字则保留原词（避免“效应”本身被剥空）
  const KEY_SUFFIX = /(效应|定律|法则|模型|理论|原理|思维|陷阱|现象|机制)$/;
  function dedupeKey(term) {
    const base = normalizeTerm(term).toLowerCase().replace(/[\s“”"'「」『』]/g, '');
    const stripped = base.replace(KEY_SUFFIX, '');
    return stripped.length >= 2 ? stripped : base;
  }

  // 从改写成品 HTML 里抽 <strong> / <b> 包住的概念名称，按出现顺序去重
  function extractConceptsFromHtml(html) {
    const out = [];
    const seen = new Set();
    const pattern = /<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let match;
    while ((match = pattern.exec(String(html || '')))) {
      const term = normalizeTerm(match[2]);
      if (!term || term.length > MAX_TERM_LENGTH) continue;
      const key = dedupeKey(term);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(term);
    }
    return out;
  }

  function normalizeList(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map((item) => (typeof item === 'string' ? { term: item, ts: 0 } : item))
      .filter((item) => item && typeof item.term === 'string' && item.term.trim())
      .map((item) => ({ term: normalizeTerm(item.term), ts: Number(item.ts) || 0 }))
      .filter((item) => item.term);
  }

  // 新概念放最前，去重（不区分大小写），截到 max；返回新数组，不改入参
  function mergeRecent(existing, concepts, now, max) {
    const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : MAX_RECENT;
    const ts = Number.isFinite(now) ? now : Date.now();
    const incoming = normalizeList((Array.isArray(concepts) ? concepts : []).map((term) => ({ term, ts })));
    const merged = [];
    const seen = new Set();
    for (const item of [...incoming, ...normalizeList(existing)]) {
      const key = dedupeKey(item.term);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
      if (merged.length >= limit) break;
    }
    return merged;
  }

  function renderRecent(list) {
    const terms = normalizeList(list).map((item) => item.term);
    return terms.length ? terms.join('、') : EMPTY_TEXT;
  }

  function apply(template, recentText) {
    const text = typeof recentText === 'string' && recentText.trim() ? recentText.trim() : EMPTY_TEXT;
    return String(template || '').split(PLACEHOLDER).join(text);
  }

  function storageArea() {
    return globalThis.chrome?.storage?.local || null;
  }

  function readRecent() {
    return new Promise((resolve) => {
      const area = storageArea();
      if (!area?.get) {
        resolve([]);
        return;
      }
      try {
        area.get([STORAGE_KEY], (data) => {
          void globalThis.chrome?.runtime?.lastError;
          resolve(normalizeList(data?.[STORAGE_KEY]));
        });
      } catch (_) {
        resolve([]);
      }
    });
  }

  function writeRecent(list) {
    return new Promise((resolve) => {
      const area = storageArea();
      if (!area?.set) {
        resolve(false);
        return;
      }
      try {
        area.set({ [STORAGE_KEY]: normalizeList(list).slice(0, MAX_RECENT) }, () => {
          void globalThis.chrome?.runtime?.lastError;
          resolve(true);
        });
      } catch (_) {
        resolve(false);
      }
    });
  }

  async function recordConcepts(concepts) {
    const incoming = Array.isArray(concepts) ? concepts.filter((term) => typeof term === 'string' && term.trim()) : [];
    if (!incoming.length) return [];
    const merged = mergeRecent(await readRecent(), incoming, Date.now(), MAX_RECENT);
    await writeRecent(merged);
    return merged;
  }

  async function buildRecentText() {
    return renderRecent(await readRecent());
  }

  globalThis.CCSRewriteConceptMemory = Object.freeze({
    PLACEHOLDER,
    STORAGE_KEY,
    MAX_RECENT,
    EMPTY_TEXT,
    normalizeTerm,
    dedupeKey,
    extractConceptsFromHtml,
    mergeRecent,
    renderRecent,
    apply,
    readRecent,
    recordConcepts,
    buildRecentText
  });
})();
