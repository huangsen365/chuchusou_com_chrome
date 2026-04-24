/**
 * 文本长度保护 (TextLimits)
 *
 * 目的：在把用户选中文字拼入 URL 之前，按目标引擎的承载能力做截断，
 * 并通过 toast 温馨提示用户。避免因为选中文字过长导致：
 *   - Google / Google AI 模式 (udm=50): URL 接近 2048 后被截断或 414
 *   - 其它 AI 对话: 偶发打开后内容不完整
 *
 * 设计要点：
 * - 仅截断"用户侧 raw 文本"，不动 prompt 模板的骨架
 * - 限制值按 menuId 前缀 / 特征匹配，不需要逐个 id 枚举
 * - 触发截断时通过 chrome.tabs.sendMessage({action:'showToast'}) 提示用户
 * - 纯加法：外部不调用则零影响；调用方视情况决定是否启用
 */

// ============================================================================
// 【全局开关】长度保护总闸 —— 2026-04 用户决策：暂时全部让开，用户多长就传多长
// ----------------------------------------------------------------------------
// true  = 启用长度保护（截断 + toast + URL 硬上限兜底）
// false = 完全让开（applyTextLimit 原文直通、enforceFinalUrlCap 原 URL 直通）
//
// 所有原有代码（LIMITS / smartTruncate / toast / URL 兜底）全部保留，
// 只是通过两个函数顶部的 early return 让它走不到。哪天想回滚只需改回 true。
// ============================================================================
const TEXT_LIMITS_ENABLED = false;

// 用户选中原文的"软提示阈值"——超出就提示，但未必截断
const SOFT_WARN_THRESHOLD = 1500;

// 各类菜单对"用户原文"的硬截断上限（扣除 prompt 模板开销后的安全预算）
const LIMITS = {
  googleAi: 1200,      // udm=50 搜索形态，2048 URL 上限扣除 encode + 模板后约 1200
  aiChat: 6000,        // ChatGPT/Claude/Grok/文心: ?q=... 承载较宽
  search: 1500,        // 百度/Google/知乎/微信/淘宝/京东/V2EX/翻译等普通搜索
  default: 1500        // 未知场景的保守值
};

// 最终编码后 URL 的兜底硬上限（防意外）
const FINAL_URL_HARD_CAP = 1900;

/**
 * 根据 menuId 判定此次操作的"原文"承载上限。
 * 规则按优先级从上到下：
 *   - 包含 "google-ai" → googleAi
 *   - 任何涉及 Google 搜索普通形态 ccs-google (非 ai) → search
 *   - fastqa / top100 / optimize 的 google-ai 分支 → googleAi
 *   - fastqa / top100 / optimize 的其它引擎 → aiChat
 *   - ccs-chatgpt / ccs-claude / ccs-grok / ccs-yiyan / ccs-tongyi → aiChat
 *   - 其它 → search
 */
function getLimitForMenu(menuId) {
  if (!menuId || typeof menuId !== 'string') return LIMITS.default;

  // Google AI 模式（任何变体）优先判定
  if (menuId.includes('google-ai')) return LIMITS.googleAi;

  // AI 对话引擎（包括主菜单、快捷菜单、百问/速答/优化子项）
  // 特征：id 里出现 chatgpt/claude/grok/yiyan/tongyi
  if (/chatgpt|claude|grok|yiyan|tongyi/i.test(menuId)) return LIMITS.aiChat;

  // 其它（搜索引擎 / 电商 / 翻译 / 入口）
  return LIMITS.search;
}

/**
 * 截断一段文本到指定字符数，尽量保留完整句子/词。
 * 截断时在末尾加省略号 "…"。
 */
function smartTruncate(text, maxChars) {
  if (typeof text !== 'string') return '';
  if (text.length <= maxChars) return text;

  // 给省略号留 1 个字符位，确保返回长度严格 <= maxChars
  const budget = Math.max(1, maxChars - 1);
  const hard = text.slice(0, budget);
  const breakChars = ['\n', '。', '！', '？', '.', '!', '?', '；', ';', '，', ',', ' ', '\t'];
  let bestBreak = -1;
  for (let i = hard.length - 1; i >= Math.max(0, hard.length - 80); i--) {
    if (breakChars.includes(hard[i])) { bestBreak = i; break; }
  }
  const cutAt = bestBreak > Math.floor(budget * 0.7) ? bestBreak + 1 : hard.length;
  return hard.slice(0, cutAt).replace(/\s+$/, '') + '…';
}

/**
 * 给 background 用：在跳转前处理 rawText。
 *
 * @param {string} menuId 菜单 id
 * @param {string} rawText 用户原始选中文字（未编码）
 * @param {Object} [options]
 * @param {number} [options.tabId] 用于 toast 展示的 tabId；不传则不弹 toast
 * @param {string} [options.menuTitle] 菜单标题，用于 toast 文案
 * @returns {{ text: string, truncated: boolean, original: number, limit: number }}
 */
function applyTextLimit(menuId, rawText, options = {}) {
  const src = typeof rawText === 'string' ? rawText : '';

  // 【总闸关闭】—— 原文直通，零干涉、不截断、不发 toast
  // 下面的完整实现全部保留（LIMITS / smartTruncate / toast 分支）只是走不到。
  // 哪天想恢复长度保护，把 TEXT_LIMITS_ENABLED 改回 true 即可。
  if (!TEXT_LIMITS_ENABLED) {
    return { text: src, truncated: false, original: src.length, limit: Infinity };
  }

  const original = src.length;
  const limit = getLimitForMenu(menuId);
  const needTruncate = original > limit;
  const needSoftWarn = !needTruncate && original > SOFT_WARN_THRESHOLD;

  const text = needTruncate ? smartTruncate(src, limit) : src;

  // 只在有 tabId 时发送 toast（避免 sendMessage 到不存在的 tab 抛错）
  if (options.tabId != null && (needTruncate || needSoftWarn)) {
    const msg = needTruncate
      ? `选中文字较长，已截断 ${original} → ${text.length} 字符以适配该引擎`
      : `选中文字 ${original} 字符较长，部分引擎可能截断内容，若异常请缩小选区`;
    try {
      chrome.tabs.sendMessage(options.tabId, {
        action: 'showToast',
        message: msg
      }).catch(() => {});
    } catch (_) { /* ignore */ }
  }

  return { text, truncated: needTruncate, original, limit };
}

/**
 * 给 URLBuilder / tryOpenMenuUrl 用：最终 URL 长度兜底。
 * 若构造出的 URL 超过硬上限，返回截断后的安全版本。
 *
 * @param {string} url 构造好的完整 URL
 * @returns {string}
 */
function enforceFinalUrlCap(url) {
  if (typeof url !== 'string') return url;

  // 【总闸关闭】—— 原 URL 直通，不做硬上限兜底截断
  if (!TEXT_LIMITS_ENABLED) return url;

  if (url.length <= FINAL_URL_HARD_CAP) return url;
  // 简单策略：按硬上限截断。大多数情况下第一层 applyTextLimit 已经截了，这里只是兜底
  return url.slice(0, FINAL_URL_HARD_CAP);
}

// 导出到全局（Service Worker importScripts 共享作用域）
globalThis.TextLimits = {
  SOFT_WARN_THRESHOLD,
  LIMITS,
  FINAL_URL_HARD_CAP,
  getLimitForMenu,
  smartTruncate,
  applyTextLimit,
  enforceFinalUrlCap
};
// 顶层常用函数也直接暴露，方便各文件调用
globalThis.applyTextLimit = applyTextLimit;
globalThis.enforceFinalUrlCap = enforceFinalUrlCap;
