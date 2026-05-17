/**
 * 文本长度保护 (TextLimits) — TypeScript port
 *
 * 与 background/utils/TextLimits.js 1:1 行为对等。Toast 的 chrome.tabs.sendMessage
 * 副作用**留在 legacy**，TS 版本只提供纯函数（截断 / URL 兜底 / 限值查询）。
 * 这样 dual-run verifier 可以无副作用地对比两边。
 *
 * ⚠️ 关键约束（CLAUDE.md 强调）：
 *   TEXT_LIMITS_ENABLED = false 是用户决策的总闸，**禁止擅自打开**。
 *   两个主函数都会 early return 让原文/原 URL 直通。要恢复保护改这一行即可。
 */

// ============================================================================
// 【全局开关】长度保护总闸 —— 与 legacy 完全一致：false = 让开
// ============================================================================
export const TEXT_LIMITS_ENABLED = false

export const SOFT_WARN_THRESHOLD = 1500

export const LIMITS = {
  googleAi: 1200,
  aiChat: 6000,
  search: 1500,
  default: 1500
} as const

export const FINAL_URL_HARD_CAP = 1900

export function getLimitForMenu(menuId: string | null | undefined): number {
  if (!menuId || typeof menuId !== "string") return LIMITS.default

  if (menuId.includes("google-ai")) return LIMITS.googleAi

  if (/chatgpt|claude|grok|yiyan|tongyi/i.test(menuId)) return LIMITS.aiChat

  return LIMITS.search
}

export function smartTruncate(text: string | null | undefined, maxChars: number): string {
  if (typeof text !== "string") return ""
  if (text.length <= maxChars) return text

  const budget = Math.max(1, maxChars - 1)
  const hard = text.slice(0, budget)
  const breakChars = ["\n", "。", "！", "？", ".", "!", "?", "；", ";", "，", ",", " ", "\t"]
  let bestBreak = -1
  for (let i = hard.length - 1; i >= Math.max(0, hard.length - 80); i--) {
    if (breakChars.includes(hard[i])) {
      bestBreak = i
      break
    }
  }
  const cutAt = bestBreak > Math.floor(budget * 0.7) ? bestBreak + 1 : hard.length
  return hard.slice(0, cutAt).replace(/\s+$/, "") + "…"
}

export interface ApplyTextLimitResult {
  text: string
  truncated: boolean
  original: number
  limit: number
}

/**
 * TS 版本只返回结果，不发 toast 副作用。
 * 与 legacy 在 TEXT_LIMITS_ENABLED=false 时**完全一致**——legacy 此时也不发 toast，
 * 只是 early return。dual-run 重点验证 disabled 路径（生产真实路径）+ 主动 enabled 路径（边界）。
 */
export function applyTextLimit(
  menuId: string,
  rawText: string | null | undefined,
  options: { enabled?: boolean } = {}
): ApplyTextLimitResult {
  const src = typeof rawText === "string" ? rawText : ""
  const enabled = options.enabled ?? TEXT_LIMITS_ENABLED

  if (!enabled) {
    return { text: src, truncated: false, original: src.length, limit: Infinity }
  }

  const original = src.length
  const limit = getLimitForMenu(menuId)
  const needTruncate = original > limit

  const text = needTruncate ? smartTruncate(src, limit) : src

  return { text, truncated: needTruncate, original, limit }
}

export function enforceFinalUrlCap(url: string, options: { enabled?: boolean } = {}): string {
  if (typeof url !== "string") return url
  const enabled = options.enabled ?? TEXT_LIMITS_ENABLED

  if (!enabled) return url

  if (url.length <= FINAL_URL_HARD_CAP) return url
  return url.slice(0, FINAL_URL_HARD_CAP)
}

export const TextLimits = {
  TEXT_LIMITS_ENABLED,
  SOFT_WARN_THRESHOLD,
  LIMITS,
  FINAL_URL_HARD_CAP,
  getLimitForMenu,
  smartTruncate,
  applyTextLimit,
  enforceFinalUrlCap
}

export default TextLimits
