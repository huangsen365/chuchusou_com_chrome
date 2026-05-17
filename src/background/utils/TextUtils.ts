/**
 * 触触搜 - 文本处理工具 (TypeScript port)
 *
 * 与 background/utils/TextUtils.js 1:1 行为对等。所有函数纯函数，
 * 不依赖全局可变状态、不调用 chrome.*。
 *
 * 与 legacy 的差异：
 * - legacy getMenuDefinition / getMenuText / getMenuTitle 从 globalThis.MENU_DEFINITIONS 取
 *   shouldPreserveMenuStateForUrl 从 globalThis.QUICK_RESULT_HOSTS 取
 *   本 TS 版本改为可选参数注入，默认值与 legacy 全局默认一致
 *   dual-run verifier 会用同样的 MENU_DEFINITIONS / QUICK_RESULT_HOSTS 输入两边验证。
 */

import {
  KEYWORD_MAX_LENGTH,
  MENU_DEFINITIONS,
  MENU_TITLE_MAX_LENGTH,
  QUICK_RESULT_HOSTS,
  SEARCH_ENGINE_SUFFIXES,
  TITLE_CLEANUP_SUFFIXES,
  type MenuDefinitionEntry
} from "./Constants"

// ==================== 文本格式化 ====================

export function formatMenuTitle(
  text: string | null | undefined,
  maxLength: number = MENU_TITLE_MAX_LENGTH
): string | null {
  if (!text) return null
  const compact = text.replace(/\s+/g, " ").trim()
  if (!compact) return null
  return compact.substring(0, maxLength) + (compact.length > maxLength ? "..." : "")
}

export function normalizeSearchText(raw: string | null | undefined): string {
  if (!raw) return ""
  let text = raw
  try {
    if (/%[0-9A-Fa-f]{2}/.test(text) && decodeURIComponent(text) !== text) {
      text = decodeURIComponent(text)
    }
  } catch (_) {
    // 忽略解码错误
  }
  text = text.replace(/\s+/g, " ").trim()
  return text
}

// ==================== 标题清理 ====================

export function cleanupTitleKeyword(
  rawTitle: string | null | undefined,
  suffixes: readonly string[] = TITLE_CLEANUP_SUFFIXES
): string {
  if (!rawTitle) return ""
  let cleaned = rawTitle.trim()

  suffixes.forEach((suffix) => {
    if (cleaned.endsWith(suffix)) {
      cleaned = cleaned.slice(0, -suffix.length)
    }
  })

  const prefixPattern = /^[\s]*[\(（][^\)）]*[\)）]\s*/
  while (prefixPattern.test(cleaned)) {
    cleaned = cleaned.replace(prefixPattern, "").trim()
  }

  return cleaned.trim()
}

export function extractKeywordFromTitle(
  title: string | null | undefined,
  options: {
    searchEngineSuffixes?: readonly string[]
    titleCleanupSuffixes?: readonly string[]
    keywordMaxLength?: number
  } = {}
): string {
  if (!title) return ""

  const searchEngineSuffixes = options.searchEngineSuffixes ?? SEARCH_ENGINE_SUFFIXES
  const titleCleanupSuffixes = options.titleCleanupSuffixes ?? TITLE_CLEANUP_SUFFIXES
  const keywordMaxLength = options.keywordMaxLength ?? KEYWORD_MAX_LENGTH

  let cleaned = title

  for (const suffix of searchEngineSuffixes) {
    const index = cleaned.lastIndexOf(suffix)
    if (index > 0) {
      cleaned = cleaned.substring(0, index)
      break
    }
  }

  cleaned = cleanupTitleKeyword(cleaned, titleCleanupSuffixes)

  if (cleaned.length > keywordMaxLength) {
    cleaned = cleaned.substring(0, keywordMaxLength) + "..."
  }

  return cleaned.trim()
}

// ==================== 主机名和关键词判断 ====================

export function isGenericHostKeyword(
  hostname: string,
  keyword: string | null | undefined
): boolean {
  if (!keyword) return false
  const value = keyword.trim().toLowerCase()
  if (!value) return true

  if (hostname.includes("chatgpt.com")) {
    if (value === "chatgpt" || value === "chatgpt.com" || value.startsWith("chatgpt.com/")) {
      return true
    }
    if (value === "www.chatgpt.com") {
      return true
    }
  }

  if (hostname.includes("claude.ai")) {
    if (value === "claude" || value === "claude.ai" || value.startsWith("claude.ai/")) {
      return true
    }
    if (value === "www.claude.ai") {
      return true
    }
  }

  return false
}

// ==================== 菜单工具函数 ====================

export function getMenuDefinition(
  menuId: string,
  menuDefinitions: Record<string, MenuDefinitionEntry> = MENU_DEFINITIONS
): MenuDefinitionEntry | null {
  return menuDefinitions[menuId] || null
}

export function getMenuText(
  menuId: string,
  fallback?: string,
  menuDefinitions: Record<string, MenuDefinitionEntry> = MENU_DEFINITIONS
): string {
  const definition = getMenuDefinition(menuId, menuDefinitions)
  if (definition && typeof definition.text === "string" && definition.text) {
    return definition.text
  }
  if (typeof fallback === "string" && fallback) {
    return fallback
  }
  return menuId
}

export function getMenuTitle(
  menuId: string,
  fallback?: string,
  menuDefinitions: Record<string, MenuDefinitionEntry> = MENU_DEFINITIONS
): string {
  const definition = getMenuDefinition(menuId, menuDefinitions)
  const text = getMenuText(menuId, fallback, menuDefinitions)
  if (definition && typeof definition.icon === "string" && definition.icon.trim()) {
    return `${definition.icon.trim()} ${text}`
  }
  return text
}

// ==================== URL 工具函数 ====================

export function shouldPreserveMenuStateForUrl(
  url: string | null | undefined,
  quickResultHosts: readonly string[] = QUICK_RESULT_HOSTS
): boolean {
  if (!url) return false
  try {
    const hostname = new URL(url).hostname
    return quickResultHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))
  } catch (_) {
    return false
  }
}

export interface TabLike {
  url?: string | null
}

export function shouldPreserveMenuStateForTab(
  tab: TabLike | null | undefined,
  quickResultHosts: readonly string[] = QUICK_RESULT_HOSTS
): boolean {
  if (!tab || typeof tab.url !== "string") return false
  return shouldPreserveMenuStateForUrl(tab.url, quickResultHosts)
}

// ==================== 候选项选择 ====================

export interface FirstMeaningfulTextResult {
  raw: string
  trimmed: string
}

export function pickFirstMeaningfulText(
  candidates: readonly (string | null | undefined)[]
): FirstMeaningfulTextResult {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue
    const trimmed = candidate.trim()
    if (trimmed.length > 0) {
      return { raw: candidate, trimmed }
    }
  }
  return { raw: "", trimmed: "" }
}

// ==================== 聚合导出（与 legacy globalThis.TextUtils 对齐） ====================

export const TextUtils = {
  formatMenuTitle,
  normalizeSearchText,
  cleanupTitleKeyword,
  extractKeywordFromTitle,
  isGenericHostKeyword,
  getMenuDefinition,
  getMenuText,
  getMenuTitle,
  shouldPreserveMenuStateForUrl,
  shouldPreserveMenuStateForTab,
  pickFirstMeaningfulText
}

export default TextUtils
