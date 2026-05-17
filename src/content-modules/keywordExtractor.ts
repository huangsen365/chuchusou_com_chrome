/**
 * Content script - KeywordExtractor 模块 (TypeScript port)
 *
 * 与 modules/keywordExtractor.js 1:1 行为对等。chrome.* 只在 getSmartSearchTextAsync 里
 * （sendMessage 给 background），用动态访问以避免 TS 类型层依赖。
 *
 * 站点关键字提取规则压缩成 table-driven，与 legacy 一致。
 */

interface SiteRule {
  hostMatch: string[]
  paramKeys: string[]
  label: string
}

const SITE_RULES: SiteRule[] = [
  { hostMatch: ["baidu.com"],                  paramKeys: ["wd", "word", "kw"],         label: "百度" },
  { hostMatch: ["google."],                    paramKeys: ["q"],                         label: "Google" },
  { hostMatch: ["bing.com", "cn.bing.com"],   paramKeys: ["q"],                         label: "Bing" },
  { hostMatch: ["sogou.com"],                  paramKeys: ["query", "keyword"],         label: "搜狗" },
  { hostMatch: ["so.com", "360.cn"],          paramKeys: ["q"],                         label: "360" },
  { hostMatch: ["m.sm.cn", "sm.cn"],          paramKeys: ["q"],                         label: "神马" },
  { hostMatch: ["toutiao.com"],                paramKeys: ["keyword"],                   label: "头条" },
  { hostMatch: ["duckduckgo.com"],             paramKeys: ["q"],                         label: "DuckDuckGo" },
  { hostMatch: ["yahoo.com", "yahoo.co.jp"],  paramKeys: ["p"],                         label: "Yahoo" },
  { hostMatch: ["yandex."],                    paramKeys: ["text"],                      label: "Yandex" },
  { hostMatch: ["startpage.com"],              paramKeys: ["query"],                     label: "Startpage" },
  { hostMatch: ["zhihu.com"],                  paramKeys: ["q"],                         label: "知乎" },
  { hostMatch: ["weibo.com", "weibo.cn"],     paramKeys: ["q"],                         label: "微博" },
  { hostMatch: ["github.com"],                 paramKeys: ["q"],                         label: "GitHub" },
  { hostMatch: ["bilibili.com"],               paramKeys: ["keyword"],                   label: "B站" },
  { hostMatch: ["taobao.com", "tmall.com"],   paramKeys: ["q", "keyword"],             label: "淘宝/天猫" },
  { hostMatch: ["jd.com"],                     paramKeys: ["keyword"],                   label: "京东" }
]

function safeDecodeParam(value: unknown): string {
  if (typeof value !== "string" || !value) return (value as string) ?? ""
  if (!/%[0-9A-Fa-f]{2}/.test(value)) return value
  try { return decodeURIComponent(value) } catch (_) { return value }
}

export interface UnifiedSearchOptions {
  skipCache?: boolean
  forceRefresh?: boolean
}

interface GlobalContent {
  lastNonEmptySelection?: string
  selectedText?: string
}

export class KeywordExtractorManager {
  extractSearchKeyword(): string | null {
    try {
      const hostname = window.location.hostname
      const params = new URLSearchParams(window.location.search)
      console.log("[触触搜] extractSearchKeyword - 开始检查URL关键词:", {
        hostname, search: window.location.search, paramsCount: Array.from(params.keys()).length
      })

      for (const rule of SITE_RULES) {
        if (!rule.hostMatch.some((h) => hostname.includes(h))) continue
        for (const key of rule.paramKeys) {
          const v = params.get(key)
          if (v) {
            const decoded = safeDecodeParam(v)
            console.log(`[触触搜] extractSearchKeyword - ${rule.label}搜索关键词:`, decoded)
            return decoded
          }
        }
      }

      console.log("[触触搜] extractSearchKeyword - 当前网站没有匹配的搜索引擎规则")
    } catch (e) {
      console.log("[触触搜] extractSearchKeyword - 提取关键词时出错:", (e as Error).message)
    }
    return null
  }

  getActiveSelectionText(): string {
    try {
      const ae = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) {
        const start = ae.selectionStart
        const end = ae.selectionEnd
        if (typeof start === "number" && typeof end === "number" && end > start) {
          const text = String(ae.value).substring(start, end).trim()
          if (text) {
            console.log("[触触搜] getActiveSelectionText - 从输入框获取选中文本:", {
              element: ae.tagName, text, length: text.length
            })
            return text
          }
        }
      }
    } catch (_) { /* noop */ }

    try {
      const selection = (window.getSelection()?.toString() || "").trim()
      if (selection) {
        console.log("[触触搜] getActiveSelectionText - 从window.getSelection获取选中文本:", { text: selection, length: selection.length })
      } else {
        console.log("[触触搜] getActiveSelectionText - 没有选中文本")
      }
      return selection
    } catch (_) {
      console.log("[触触搜] getActiveSelectionText - 获取选中文本失败")
      return ""
    }
  }

  getUnifiedSearchText(options: UnifiedSearchOptions = {}): string {
    const { skipCache = false, forceRefresh = false } = options
    console.log("[触触搜] getUnifiedSearchText 开始执行:", {
      skipCache, forceRefresh, currentUrl: window.location.href, currentTitle: document.title
    })

    const selected = this.getActiveSelectionText()
    if (selected) {
      console.log("[触触搜] Fallback 优先级1 - 找到选中文本:", { text: selected, length: selected.length, source: "selection" })
      return selected
    }
    console.log("[触触搜] Fallback 优先级1 - 没有选中文本")

    const searchKeyword = this.extractSearchKeyword()
    if (searchKeyword) {
      console.log("[触触搜] Fallback 优先级2 - 从URL提取到搜索关键词:", {
        text: searchKeyword, length: searchKeyword.length, source: "url_keyword", hostname: window.location.hostname
      })
      return searchKeyword
    }
    console.log("[触触搜] Fallback 优先级2 - URL中没有搜索关键词")

    const title = document.title
    if (title) {
      let trimmedTitle = title.trim()
      trimmedTitle = trimmedTitle.replace(/^\([^)]+\)\s*/, "")
      trimmedTitle = trimmedTitle.replace(/\s*[-–—]\s*(知乎|百度|Google|微博|豆瓣|简书|CSDN|博客园|掘金|SegmentFault|Stack Overflow).*$/, "")
      if (trimmedTitle) {
        console.log("[触触搜] Fallback 优先级3 - 使用页面标题:", {
          text: trimmedTitle, length: trimmedTitle.length, source: "page_title", originalTitle: title
        })
        return trimmedTitle
      }
    }
    console.log("[触触搜] Fallback 优先级3 - 页面标题为空或无效")

    if (!skipCache && !forceRefresh) {
      const w = window as unknown as GlobalContent
      if (w.lastNonEmptySelection) {
        console.log("[触触搜] Fallback 优先级4 - 使用缓存的最近选中文本:", {
          text: w.lastNonEmptySelection, length: w.lastNonEmptySelection.length, source: "lastNonEmptySelection"
        })
        return w.lastNonEmptySelection
      }
      if (w.selectedText) {
        console.log("[触触搜] Fallback 优先级4 - 使用缓存的全局选中文本:", {
          text: w.selectedText, length: w.selectedText.length, source: "selectedText"
        })
        return w.selectedText
      }
      console.log("[触触搜] Fallback 优先级4 - 没有缓存的文本")
    } else {
      console.log(`[触触搜] Fallback 优先级4 - 跳过缓存 (skipCache=${skipCache}, forceRefresh=${forceRefresh})`)
    }

    console.log("[触触搜] Fallback 所有优先级均无结果，返回空字符串")
    return ""
  }

  getSmartSearchText(skipCache: boolean = false): string {
    return this.getUnifiedSearchText({ skipCache })
  }

  getCurrentSearchText(forceRefresh: boolean = false): string {
    return this.getUnifiedSearchText({ forceRefresh, skipCache: forceRefresh })
  }

  async getSmartSearchTextAsync(): Promise<string> {
    try {
      const ch = (globalThis as unknown as { chrome?: { runtime?: { sendMessage: (m: unknown) => Promise<{ keyword?: string }> } } }).chrome
      if (ch?.runtime?.sendMessage) {
        const response = await ch.runtime.sendMessage({
          action: "getSearchKeyword",
          windowSelection: window.getSelection()?.toString() || ""
        })
        if (response?.keyword) return response.keyword
      }
    } catch (err) {
      console.log("[触触搜] 无法从background获取关键词:", err)
    }

    const local = this.extractSearchKeyword()
    if (local) return local

    const selected = window.getSelection()?.toString().trim() || ""
    if (selected) return selected

    return this.getUnifiedSearchText({ forceRefresh: true, skipCache: true })
  }
}

export const KeywordExtractor = new KeywordExtractorManager()

export default KeywordExtractor
