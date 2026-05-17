/**
 * Content script - Selection 模块 (TypeScript port)
 *
 * 与 modules/selection.js 1:1 行为对等。chrome.runtime 通过 globalThis 防御性访问。
 *
 * 注意：legacy 在 module-load 时给 document 加 contextmenu listener，TS 版本改为
 * 显式 startContextMenuPreview() 方法，避免 import 即副作用。
 */

function safeDecodeParam(value: unknown): string {
  if (typeof value !== "string" || !value) return (value as string) ?? ""
  if (!/%[0-9A-Fa-f]{2}/.test(value)) return value
  try { return decodeURIComponent(value) } catch (_) { return value }
}

interface SiteParamRule {
  hostMatch: string[]
  keys: string[]
}

const URL_RULES: SiteParamRule[] = [
  { hostMatch: ["google.com"],                paramKeys: ["q"] }      as unknown as SiteParamRule,
  { hostMatch: ["baidu.com"],                 paramKeys: ["wd", "word"] } as unknown as SiteParamRule,
  { hostMatch: ["bing.com"],                  paramKeys: ["q"] }      as unknown as SiteParamRule,
  { hostMatch: ["duckduckgo.com"],            paramKeys: ["q"] }      as unknown as SiteParamRule,
  { hostMatch: ["sogou.com"],                 paramKeys: ["query", "keyword"] } as unknown as SiteParamRule,
  { hostMatch: ["so.com"],                    paramKeys: ["q"] }      as unknown as SiteParamRule,
  { hostMatch: ["bilibili.com"],              paramKeys: ["keyword"] } as unknown as SiteParamRule,
  { hostMatch: ["taobao.com", "tmall.com"],  paramKeys: ["q"] }      as unknown as SiteParamRule,
  { hostMatch: ["jd.com"],                    paramKeys: ["keyword"] } as unknown as SiteParamRule,
  { hostMatch: ["zhihu.com"],                 paramKeys: ["q"] }      as unknown as SiteParamRule,
  { hostMatch: ["github.com"],                paramKeys: ["q"] }      as unknown as SiteParamRule,
  { hostMatch: ["youtube.com"],               paramKeys: ["search_query"] } as unknown as SiteParamRule
].map(r => ({ hostMatch: (r as unknown as { hostMatch: string[] }).hostMatch, keys: (r as unknown as { paramKeys: string[] }).paramKeys })) as unknown as SiteParamRule[]

const COMMON_PARAMS = ["q", "query", "keyword", "search", "wd", "word", "s", "text"]

export interface UnifiedOptions { forceRefresh?: boolean; skipCache?: boolean }

export type DetectedTextType = "url" | "email" | "base64" | "json" | "code" | "number" | "text"

interface ChromeLike {
  runtime?: { sendMessage?: (m: unknown) => void }
}

export class SelectionModuleManager {
  selectedText = ""
  lastNonEmptySelection = ""
  isProcessingSelection = false
  private contextMenuHandler?: () => void

  getActiveSelectionText(): string {
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      const text = selection.toString().trim()
      if (text) {
        this.lastNonEmptySelection = text
        return text
      }
    }
    return ""
  }

  getCurrentSearchText(forceRefresh: boolean = false): string {
    if (!forceRefresh && this.selectedText) return this.selectedText
    return this.getUnifiedSearchText({ forceRefresh })
  }

  getUnifiedSearchText(options: UnifiedOptions = {}): string {
    const { forceRefresh = false, skipCache = false } = options

    const selected = this.getActiveSelectionText()
    if (selected) { this.selectedText = selected; return selected }
    if (!skipCache && !forceRefresh && this.selectedText) return this.selectedText
    if (this.lastNonEmptySelection) return this.lastNonEmptySelection
    const urlKeyword = this.extractSearchKeywordFromUrl()
    if (urlKeyword) return urlKeyword
    return (document.title || "").trim()
  }

  extractSearchKeywordFromUrl(): string | null {
    const hostname = window.location.hostname
    const params = new URLSearchParams(window.location.search)

    for (const rule of URL_RULES) {
      if (!rule.hostMatch.some((h) => hostname.includes(h))) continue
      for (const key of rule.keys) {
        const v = params.get(key)
        if (v) return safeDecodeParam(v)
      }
    }

    for (const param of COMMON_PARAMS) {
      const value = params.get(param)
      if (value) return safeDecodeParam(value)
    }
    return null
  }

  detectTextType(text: string | null | undefined): DetectedTextType {
    if (!text || typeof text !== "string") return "text"

    try { new URL(text); return "url" } catch (_) {
      if (/^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}$/.test(text)) return "url"
    }

    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return "email"

    if (text.length >= 20 && /^[A-Za-z0-9+/]+=*$/.test(text)) {
      try { atob(text); return "base64" } catch (_) { /* not base64 */ }
    }

    if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
      try { JSON.parse(text); return "json" } catch (_) { /* not json */ }
    }

    if (
      text.includes("function") || text.includes("const") || text.includes("var") ||
      text.includes("import") || text.includes("class") || text.includes("def") ||
      text.includes("<?php") || text.includes("public static")
    ) return "code"

    if (/^\d+$/.test(text)) return "number"

    return "text"
  }

  notifySelectionChange(): void {
    if (this.isProcessingSelection) return
    const currentSelection = this.getActiveSelectionText()
    if (currentSelection !== this.selectedText) {
      this.selectedText = currentSelection
      const event = new CustomEvent("ccs-selection-change", {
        detail: { text: currentSelection, type: this.detectTextType(currentSelection) }
      })
      document.dispatchEvent(event)
    }
  }

  clearSelection(): void {
    const selection = window.getSelection()
    selection?.removeAllRanges()
    this.selectedText = ""
  }

  selectElementText(element: Element): void {
    const selection = window.getSelection()
    if (!selection) return
    const range = document.createRange()
    range.selectNodeContents(element)
    selection.removeAllRanges()
    selection.addRange(range)
    this.selectedText = selection.toString()
  }

  startMonitoring(): void {
    document.addEventListener("mouseup", () => {
      setTimeout(() => this.notifySelectionChange(), 10)
    })
    document.addEventListener("keyup", (e: KeyboardEvent) => {
      if (e.shiftKey || e.key === "Shift") {
        setTimeout(() => this.notifySelectionChange(), 10)
      }
    })
    document.addEventListener("dblclick", () => {
      setTimeout(() => this.notifySelectionChange(), 10)
    })

    let clickCount = 0
    let clickTimer: ReturnType<typeof setTimeout> | null = null
    document.addEventListener("click", () => {
      clickCount++
      if (clickCount === 3) setTimeout(() => this.notifySelectionChange(), 10)
      if (clickTimer) clearTimeout(clickTimer)
      clickTimer = setTimeout(() => { clickCount = 0 }, 500)
    })
  }

  getSelectionRect(): DOMRect | null {
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      return range.getBoundingClientRect()
    }
    return null
  }

  syncAllTextVariables(): string {
    const currentText = this.getUnifiedSearchText({ forceRefresh: true })
    this.selectedText = currentText
    return currentText
  }

  /**
   * 显式启动 contextmenu preview，发 sendMessage 给 background。
   * Legacy 在 module load 时自动绑定；TS 版本要显式调用避免 import 即副作用。
   */
  startContextMenuPreview(): void {
    if (this.contextMenuHandler) return
    this.contextMenuHandler = () => {
      try {
        const text = this.getActiveSelectionText()
        const ch = (globalThis as unknown as { chrome?: ChromeLike }).chrome
        if (ch?.runtime?.sendMessage) {
          ch.runtime.sendMessage({ action: "contextMenuPreview", selectionText: text })
        }
      } catch (_) { /* noop */ }
    }
    document.addEventListener("contextmenu", this.contextMenuHandler, true)
  }

  stopContextMenuPreview(): void {
    if (this.contextMenuHandler) {
      document.removeEventListener("contextmenu", this.contextMenuHandler, true)
      this.contextMenuHandler = undefined
    }
  }
}

export const SelectionModule = new SelectionModuleManager()

export default SelectionModule
