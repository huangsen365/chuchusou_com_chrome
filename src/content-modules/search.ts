/**
 * Content script - Search 模块 (TypeScript port)
 *
 * 与 modules/search.js 1:1 行为对等。chrome.runtime.sendMessage 通过 globalThis.chrome 防御性访问。
 */

const ENGINE_URLS: Record<string, (q: string) => string> = {
  baidu: (q) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`,
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  bing: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  duckduckgo: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
  sogou: (q) => `https://www.sogou.com/web?query=${encodeURIComponent(q)}`,
  so360: (q) => `https://www.so.com/s?q=${encodeURIComponent(q)}`,
  yandex: (q) => `https://yandex.com/search/?text=${encodeURIComponent(q)}`,
  yahoo: (q) => `https://search.yahoo.com/search?p=${encodeURIComponent(q)}`,
  chuchusou: (q) => `https://chuchusou.com/?q=${encodeURIComponent(q)}`,
  wikipedia: (q) => `https://wikipedia.org/wiki/${encodeURIComponent(q)}`,
  github: (q) => `https://github.com/search?q=${encodeURIComponent(q)}`,
  stackoverflow: (q) => `https://stackoverflow.com/search?q=${encodeURIComponent(q)}`,
  mdn: (q) => `https://developer.mozilla.org/search?q=${encodeURIComponent(q)}`,
  npm: (q) => `https://www.npmjs.com/search?q=${encodeURIComponent(q)}`,
  youtube: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  bilibili: (q) => `https://search.bilibili.com/all?keyword=${encodeURIComponent(q)}`,
  zhihu: (q) => `https://www.zhihu.com/search?q=${encodeURIComponent(q)}`,
  weibo: (q) => `https://s.weibo.com/weibo?q=${encodeURIComponent(q)}`,
  taobao: (q) => `https://s.taobao.com/search?q=${encodeURIComponent(q)}`,
  jd: (q) => `https://search.jd.com/Search?keyword=${encodeURIComponent(q)}`,
  amazon: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
  translate: (q) => `https://translate.google.com/?text=${encodeURIComponent(q)}`
}

interface SuggestionItem { text: string; description: string }

interface GlobalContent {
  CCS_DEBUG?: boolean
  CCSModules?: {
    Selection?: {
      getActiveSelectionText?: () => string
      lastNonEmptySelection?: string
      extractSearchKeywordFromUrl?: () => string | null
      selectedText?: string
      getUnifiedSearchText?: (o?: { forceRefresh?: boolean; skipCache?: boolean }) => string
    }
    Toast?: { show?: (m: string) => void; error?: (m: string) => void }
  }
}

interface ChromeLike {
  runtime?: { id?: string; sendMessage?: (m: unknown, cb: (r: { keywords?: string } | null | undefined) => void) => void }
}

function getChrome(): ChromeLike | null {
  return (globalThis as unknown as { chrome?: ChromeLike }).chrome || null
}

export class SearchManager {
  DEBUG_REQUEST_ID = 0

  async requestKeywordsFromBackground(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      try {
        const ch = getChrome()
        if (!ch?.runtime?.id || !ch.runtime.sendMessage) { resolve(null); return }
        const reqId = ++this.DEBUG_REQUEST_ID
        const w = window as unknown as GlobalContent
        if (w.CCS_DEBUG) console.log("[触触搜][DEBUG] requestKeywordsFromBackground start", { reqId, url: window.location.href, title: document.title })

        let settled = false
        const payload = { action: "extractKeywords", url: window.location.href, title: document.title || "" }
        ch.runtime.sendMessage(payload, (response) => {
          settled = true
          if (w.CCS_DEBUG) console.log("[触触搜][DEBUG] background response", { reqId, response })
          if (response?.keywords) resolve(response.keywords)
          else resolve(null)
        })

        setTimeout(() => {
          if (!settled) {
            if (w.CCS_DEBUG) console.warn("[触触搜][DEBUG] background response timeout", { reqId })
            resolve(null)
          }
        }, 1200)
      } catch (_) {
        resolve(null)
      }
    })
  }

  async getSmartSearchTextAsync(): Promise<string> {
    const w = window as unknown as GlobalContent
    const Selection = w.CCSModules?.Selection

    const selected = Selection?.getActiveSelectionText?.()
    if (selected) return selected

    if (Selection?.lastNonEmptySelection) return Selection.lastNonEmptySelection

    const fromBg = await this.requestKeywordsFromBackground()
    if (fromBg) return fromBg

    const local = Selection?.extractSearchKeywordFromUrl?.()
    if (local) return local

    return (document.title || "").trim()
  }

  getSmartSearchText(skipCache: boolean = false): string {
    const w = window as unknown as GlobalContent
    const Selection = w.CCSModules?.Selection
    if (!Selection) return ""
    if (!skipCache && Selection.selectedText) return Selection.selectedText
    return Selection.getUnifiedSearchText?.({ skipCache }) || ""
  }

  getRealtimePageTextPreferTitle(): string {
    const w = window as unknown as GlobalContent
    const Selection = w.CCSModules?.Selection
    if (!Selection) return document.title || ""
    return Selection.getUnifiedSearchText?.({ forceRefresh: true, skipCache: true }) || ""
  }

  buildSearchUrl(engineId: string, query: string): string {
    const builder = ENGINE_URLS[engineId] || ENGINE_URLS.google
    return builder(query)
  }

  performSearch(engineId: string, query: string): void {
    const url = this.buildSearchUrl(engineId, query)
    window.open(url, "_blank")
  }

  getSmartSuggestions(input: string, selectedText: string): SuggestionItem[] {
    const suggestions: SuggestionItem[] = []
    const inputLower = input.toLowerCase()

    if (inputLower.includes("search") || inputLower.includes("搜")) {
      suggestions.push({ text: `/search ${selectedText || "关键词"}`, description: "搜索" })
    }
    if (inputLower.includes("trans") || inputLower.includes("翻译")) {
      suggestions.push({ text: `/translate ${selectedText || "文本"}`, description: "翻译" })
    }
    if (inputLower.includes("copy") || inputLower.includes("复制")) {
      suggestions.push({ text: `/copy ${selectedText || ""}`, description: "复制到剪贴板" })
    }
    if (inputLower.includes("base64")) {
      suggestions.push({ text: `/base64 encode ${selectedText || "文本"}`, description: "Base64 编码" })
      suggestions.push({ text: `/base64 decode ${selectedText || "base64字符串"}`, description: "Base64 解码" })
    }
    if (inputLower.includes("url")) {
      suggestions.push({ text: `/url encode ${selectedText || "文本"}`, description: "URL 编码" })
      suggestions.push({ text: `/url decode ${selectedText || "URL编码字符串"}`, description: "URL 解码" })
    }
    if (inputLower.includes("upper") || inputLower.includes("大写")) {
      suggestions.push({ text: `/upper ${selectedText || "文本"}`, description: "转换为大写" })
    }
    if (inputLower.includes("lower") || inputLower.includes("小写")) {
      suggestions.push({ text: `/lower ${selectedText || "文本"}`, description: "转换为小写" })
    }

    if (suggestions.length === 0 && selectedText) {
      suggestions.push({
        text: `/search ${selectedText}`,
        description: `搜索 "${selectedText.substring(0, 20)}${selectedText.length > 20 ? "..." : ""}"`
      })
      suggestions.push({ text: `/copy ${selectedText}`, description: "复制选中的文本" })
    }

    return suggestions.slice(0, 5)
  }

  parseCommand(command: string): { command: string; args: string } | null {
    const parts = command.trim().split(/\s+/)
    if (parts[0].startsWith("/")) {
      const cmd = parts[0].substring(1)
      const args = parts.slice(1).join(" ")
      return { command: cmd, args }
    }
    return null
  }

  executeCommand(command: string, selectedText: string): boolean {
    const parsed = this.parseCommand(command)
    if (!parsed) return false

    const { command: cmd, args } = parsed
    const text = args || selectedText || ""
    const w = window as unknown as GlobalContent
    const toast = w.CCSModules?.Toast

    switch (cmd.toLowerCase()) {
      case "search":
      case "s":
        this.performSearch("google", text); return true
      case "baidu":
      case "bd":
        this.performSearch("baidu", text); return true
      case "translate":
      case "trans":
      case "t":
        this.performSearch("translate", text); return true
      case "copy":
      case "c":
        navigator.clipboard.writeText(text)
        toast?.show?.("已复制到剪贴板")
        return true
      case "upper":
      case "uppercase":
        navigator.clipboard.writeText(text.toUpperCase())
        toast?.show?.("已转换为大写并复制")
        return true
      case "lower":
      case "lowercase":
        navigator.clipboard.writeText(text.toLowerCase())
        toast?.show?.("已转换为小写并复制")
        return true
      case "base64":
        if (args.startsWith("encode")) {
          const textToEncode = args.substring(6).trim() || selectedText
          const encoded = btoa(unescape(encodeURIComponent(textToEncode)))
          navigator.clipboard.writeText(encoded)
          toast?.show?.("已Base64编码并复制")
          return true
        }
        if (args.startsWith("decode")) {
          const textToDecode = args.substring(6).trim() || selectedText
          try {
            const decoded = decodeURIComponent(escape(atob(textToDecode)))
            navigator.clipboard.writeText(decoded)
            toast?.show?.("已Base64解码并复制")
          } catch (_) {
            toast?.error?.("Base64解码失败")
          }
          return true
        }
        break
      case "url":
        if (args.startsWith("encode")) {
          const textToEncode = args.substring(6).trim() || selectedText
          navigator.clipboard.writeText(encodeURIComponent(textToEncode))
          toast?.show?.("已URL编码并复制")
          return true
        }
        if (args.startsWith("decode")) {
          const textToDecode = args.substring(6).trim() || selectedText
          try {
            navigator.clipboard.writeText(decodeURIComponent(textToDecode))
            toast?.show?.("已URL解码并复制")
          } catch (_) {
            toast?.error?.("URL解码失败")
          }
          return true
        }
        break
    }

    return false
  }
}

export const Search = new SearchManager()

export default Search
