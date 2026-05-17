/**
 * 关键字提取 (TypeScript port)
 *
 * 与 background/keywords.js 1:1 行为对等。**零 chrome.* 依赖**（debug log 走可选参数注入）。
 *
 * extractSearchKeywords 内部用 globalThis.BG_DBG / cleanupTitleKeyword；
 * TS 版本通过 options.debug 和 cleanupTitleKeyword 参数注入，默认行为与 legacy 一致。
 */

import { cleanupTitleKeyword as defaultCleanupTitleKeyword } from "./utils/TextUtils"

export function isGenericHostKeyword(hostname: string, keyword: string | null | undefined): boolean {
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

export function safeDecodeParam(value: unknown): string {
  if (typeof value !== "string" || !value) return (value as string) ?? ""
  if (!/%[0-9A-Fa-f]{2}/.test(value)) return value
  try {
    return decodeURIComponent(value)
  } catch (_) {
    return value
  }
}

export const COMMON_QUERY_KEYS = [
  "q", "query", "search", "s", "kw", "keyword", "wd", "word", "p", "text", "k", "searchword"
] as const

export const PARAM_BLACKLIST =
  /^(utm_|ref|fbclid|gclid|tbm|hl|source|sourceid|ie|oe|biw|bih|sa|ved|ei|sclient|cs|aep|atvm|chrome_task)/i

export interface HeuristicMatch {
  key: string
  value: string
  score: number
}

export function heuristicExtractFromParams(searchParams: URLSearchParams): HeuristicMatch | null {
  const candidates: HeuristicMatch[] = []
  for (const [key, value] of searchParams) {
    if (!value || value.length < 2 || value.length > 500) continue
    if (PARAM_BLACKLIST.test(key)) continue

    let score = 0
    if ((COMMON_QUERY_KEYS as readonly string[]).includes(key.toLowerCase())) score += 10
    score += Math.min(value.length / 10, 5)
    if (/[一-龥]/.test(value)) score += 3
    if (/^https?:\/\//.test(value)) score -= 100
    if (/^[0-9a-f-]{20,}$/i.test(value)) score -= 100
    if (/^\d+$/.test(value)) score -= 5

    if (score > 0) candidates.push({ key, value, score })
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0]
}

export interface TabLike {
  title?: string
  url?: string
}

export interface ExtractOptions {
  debug?: (...args: unknown[]) => void
  cleanupTitleKeyword?: (title: string) => string
}

/**
 * 与 legacy 一致：返回提取到的关键字字符串，找不到返回 null。
 */
export async function extractSearchKeywords(
  url: string,
  tab?: TabLike | null,
  options: ExtractOptions = {}
): Promise<string | null> {
  const dbg = options.debug || (() => {})
  const cleanupTitle = options.cleanupTitleKeyword || defaultCleanupTitleKeyword

  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname
    const searchParams = urlObj.searchParams
    dbg("[触触搜][BG][DEBUG] extractSearchKeywords called", { url, hostname, title: tab?.title })

    // 百度搜索
    if (hostname.includes("baidu.com")) {
      const wd = searchParams.get("wd") || searchParams.get("word") || searchParams.get("kw")
      if (wd) {
        const kw = safeDecodeParam(wd)
        dbg("[触触搜][BG][DEBUG] matched baidu wd:", kw)
        return kw
      }
    }

    // ChatGPT
    if (hostname.includes("chatgpt.com")) {
      const q = searchParams.get("q")
      if (q) {
        const kw = safeDecodeParam(q)
        if (kw && !isGenericHostKeyword(hostname, kw)) {
          dbg("[触触搜][BG][DEBUG] matched chatgpt q:", kw)
          return kw
        }
      }
    }

    // Claude
    if (hostname.includes("claude.ai")) {
      const q = searchParams.get("q") || searchParams.get("prompt")
      if (q) {
        const kw = safeDecodeParam(q)
        if (kw && !isGenericHostKeyword(hostname, kw)) {
          dbg("[触触搜][BG][DEBUG] matched claude q:", kw)
          return kw
        }
      }
    }

    // Google 搜索
    if (hostname.includes("google.")) {
      const q = searchParams.get("q")
      if (q) {
        const kw = safeDecodeParam(q)
        dbg("[触触搜][BG][DEBUG] matched google q:", kw)
        return kw
      }
    }

    // 必应
    if (hostname.includes("bing.com") || hostname.includes("cn.bing.com")) {
      const q = searchParams.get("q")
      if (q) {
        const kw = safeDecodeParam(q)
        dbg("[触触搜][BG][DEBUG] matched bing q:", kw)
        return kw
      }
    }

    // 搜狗
    if (hostname.includes("sogou.com")) {
      const query = searchParams.get("query") || searchParams.get("keyword")
      if (query) {
        const kw = safeDecodeParam(query)
        dbg("[触触搜][BG][DEBUG] matched sogou query:", kw)
        return kw
      }
    }

    // 360
    if (hostname.includes("so.com") || hostname.includes("360.cn")) {
      const q = searchParams.get("q")
      if (q) {
        const kw = safeDecodeParam(q)
        dbg("[触触搜][BG][DEBUG] matched 360 q:", kw)
        return kw
      }
    }

    // 神马
    if (hostname.includes("m.sm.cn") || hostname.includes("sm.cn")) {
      const q = searchParams.get("q")
      if (q) {
        const kw = safeDecodeParam(q)
        dbg("[触触搜][BG][DEBUG] matched sm q:", kw)
        return kw
      }
    }

    // 头条
    if (hostname.includes("toutiao.com")) {
      const keyword = searchParams.get("keyword")
      if (keyword) {
        const kw = safeDecodeParam(keyword)
        dbg("[触触搜][BG][DEBUG] matched toutiao keyword:", kw)
        return kw
      }
    }

    // DuckDuckGo
    if (hostname.includes("duckduckgo.com")) {
      const q = searchParams.get("q")
      if (q) {
        const kw = safeDecodeParam(q)
        dbg("[触触搜][BG][DEBUG] matched ddg q:", kw)
        return kw
      }
    }

    // Yahoo
    if (hostname.includes("yahoo.com") || hostname.includes("yahoo.co.jp")) {
      const p = searchParams.get("p")
      if (p) {
        const kw = safeDecodeParam(p)
        dbg("[触触搜][BG][DEBUG] matched yahoo p:", kw)
        return kw
      }
    }

    // Yandex
    if (hostname.includes("yandex.")) {
      const text = searchParams.get("text")
      if (text) {
        const kw = safeDecodeParam(text)
        dbg("[触触搜][BG][DEBUG] matched yandex text:", kw)
        return kw
      }
    }

    // Startpage
    if (hostname.includes("startpage.com")) {
      const query = searchParams.get("query")
      if (query) {
        const kw = safeDecodeParam(query)
        dbg("[触触搜][BG][DEBUG] matched startpage query:", kw)
        return kw
      }
    }

    // 知乎
    if (hostname.includes("zhihu.com")) {
      const q = searchParams.get("q")
      if (q) {
        const kw = safeDecodeParam(q)
        dbg("[触触搜][BG][DEBUG] matched zhihu q:", kw)
        return kw
      }
    }

    // 微博
    if (hostname.includes("weibo.com") || hostname.includes("weibo.cn")) {
      const q = searchParams.get("q")
      if (q) {
        const kw = safeDecodeParam(q)
        dbg("[触触搜][BG][DEBUG] matched weibo q:", kw)
        return kw
      }
    }

    // GitHub
    if (hostname.includes("github.com")) {
      const q = searchParams.get("q")
      if (q) {
        const kw = safeDecodeParam(q)
        dbg("[触触搜][BG][DEBUG] matched github q:", kw)
        return kw
      }
    }

    // B 站
    if (hostname.includes("bilibili.com")) {
      const keyword = searchParams.get("keyword")
      if (keyword) {
        const kw = safeDecodeParam(keyword)
        dbg("[触触搜][BG][DEBUG] matched bilibili keyword:", kw)
        return kw
      }
    }

    // 淘宝/天猫
    if (hostname.includes("taobao.com") || hostname.includes("tmall.com")) {
      const q = searchParams.get("q") || searchParams.get("keyword")
      if (q) {
        const kw = safeDecodeParam(q)
        dbg("[触触搜][BG][DEBUG] matched taobao/tmall q:", kw)
        return kw
      }
    }

    // 京东
    if (hostname.includes("jd.com")) {
      const keyword = searchParams.get("keyword")
      if (keyword) {
        const kw = safeDecodeParam(keyword)
        dbg("[触触搜][BG][DEBUG] matched jd keyword:", kw)
        return kw
      }
    }

    // 启发式兜底
    const heuristic = heuristicExtractFromParams(searchParams)
    if (heuristic) {
      const kw = safeDecodeParam(heuristic.value)
      dbg("[触触搜][BG][DEBUG] matched heuristic:", { hostname, key: heuristic.key, score: heuristic.score, kw })
      return kw
    }

    // 标题兜底
    if (tab && tab.title) {
      let title = tab.title

      const suffixes = [
        " - 百度搜索",
        " - Google 搜索",
        " - 搜狗搜索",
        " - 360搜索",
        " - Bing",
        " - 知乎",
        " - 微博",
        " - GitHub",
        " - Stack Overflow",
        " - CSDN博客",
        " - 简书",
        " - 掘金",
        " - 博客园",
        " | ",
        " - ",
        " – ",
        " — "
      ]

      for (const suffix of suffixes) {
        const index = title.lastIndexOf(suffix)
        if (index > 0) {
          title = title.substring(0, index)
          break
        }
      }

      title = cleanupTitle(title)

      if (title.length > 50) {
        title = title.substring(0, 50) + "..."
      }

      const cleaned = title.trim()
      dbg("[触触搜][BG][DEBUG] final title keyword:", cleaned)
      return cleaned
    }
  } catch (error) {
    console.error("[触触搜][BG][DEBUG] Error extracting keywords:", error)
  }

  return null
}

export default {
  isGenericHostKeyword,
  safeDecodeParam,
  COMMON_QUERY_KEYS,
  PARAM_BLACKLIST,
  heuristicExtractFromParams,
  extractSearchKeywords
}
