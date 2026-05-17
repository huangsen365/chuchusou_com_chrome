/**
 * 状态管理器类 (TypeScript port)
 *
 * 与 background/StateManager.js 1:1 行为对等。**零 chrome.* 依赖**。
 * setInterval/clearInterval 走标准 timer，浏览器 + Node 都可用。
 *
 * 唯一差异：`shouldPreserveMenuStateForUrl` 在 legacy 从 globalThis.QUICK_RESULT_HOSTS 取值；
 * TS 版本通过构造选项 `quickResultHosts` 或方法参数注入，默认值 ['chatgpt.com', 'claude.ai'] 与 legacy 一致。
 */

export interface StateManagerOptions {
  stateExpiry?: number
  autoCleanupInterval?: number
  debug?: boolean
  titleCacheExpiry?: number
  keywordCacheExpiry?: number
  selectionCacheExpiry?: number
  quickResultHosts?: readonly string[]
  /**
   * 是否在构造时自动启动 cleanup interval。默认 true（与 legacy 一致）。
   * 测试环境可传 false 避免 setInterval 干扰。
   */
  autoStart?: boolean
}

export interface CurrentState {
  raw: string
  normalized: string
  display: string
  tabId: number | null
  url: string
  timestamp: number | null
}

export interface SelectionState {
  text: string
  url: string
  timestamp: number | null
}

export interface FallbackState {
  raw: string
  normalized: string
  url: string
  timestamp: number | null
}

export interface TitleState {
  text: string
  keyword: string
  url: string
  timestamp: number | null
}

export interface MetaState {
  url: string
  createdAt: number
  updatedAt: number
}

export interface TabState {
  selection: SelectionState
  fallback: FallbackState
  title: TitleState
  meta: MetaState
}

export interface StatsSnapshot {
  currentState: {
    hasContent: boolean
    tabId: number | null
    timestamp: number | null
  }
  tabStates: {
    total: number
    tabIds: number[]
  }
}

export interface TitleEntryCompat {
  title: string
  pageTitle: string
  keyword: string
  keywordNormalized: string
  timestamp: number | null
  keywordTimestamp: number | null
}

const DEFAULT_QUICK_RESULT_HOSTS: readonly string[] = ["chatgpt.com", "claude.ai"]

export class StateManager {
  options: {
    stateExpiry: number
    autoCleanupInterval: number
    debug: boolean
    cacheExpiry: { title: number; keyword: number; selection: number }
    quickResultHosts: readonly string[]
  }
  currentState: CurrentState
  tabStates: Map<number, TabState>
  cleanupTimer: ReturnType<typeof setInterval> | null

  constructor(options: StateManagerOptions = {}) {
    this.options = {
      stateExpiry: options.stateExpiry || 5 * 60 * 1000,
      autoCleanupInterval: options.autoCleanupInterval || 60 * 1000,
      debug: options.debug || false,
      cacheExpiry: {
        title: options.titleCacheExpiry || 30000,
        keyword: options.keywordCacheExpiry || 30000,
        selection: options.selectionCacheExpiry || 10000
      },
      quickResultHosts: options.quickResultHosts || DEFAULT_QUICK_RESULT_HOSTS
    }

    this.currentState = {
      raw: "",
      normalized: "",
      display: "",
      tabId: null,
      url: "",
      timestamp: null
    }

    this.tabStates = new Map()
    this.cleanupTimer = null

    if (options.autoStart !== false) {
      this._startAutoCleanup()
    }
  }

  private _getOrCreateTabState(tabId: number): TabState {
    if (!this.tabStates.has(tabId)) {
      this.tabStates.set(tabId, {
        selection: { text: "", url: "", timestamp: null },
        fallback: { raw: "", normalized: "", url: "", timestamp: null },
        title: { text: "", keyword: "", url: "", timestamp: null },
        meta: { url: "", createdAt: Date.now(), updatedAt: Date.now() }
      })
    }
    return this.tabStates.get(tabId)!
  }

  setCurrentState(state: {
    raw?: string
    normalized?: string
    display?: string
    tabId?: number | null
    url?: string
  }): void {
    this.currentState = {
      raw: state.raw || "",
      normalized: state.normalized || "",
      display: state.display || "",
      tabId: state.tabId ?? null,
      url: state.url || "",
      timestamp: Date.now()
    }
    this._log("setCurrentState", this.currentState)
  }

  getCurrentState(): CurrentState {
    return { ...this.currentState }
  }

  setSelection(tabId: number, text: string, url: string = ""): void {
    const state = this._getOrCreateTabState(tabId)
    state.selection = {
      text: text || "",
      url: url || "",
      timestamp: Date.now()
    }
    state.meta.updatedAt = Date.now()
    this._log("setSelection", { tabId, text, url })
  }

  getSelection(tabId: number): SelectionState | null {
    const state = this.tabStates.get(tabId)
    return state ? { ...state.selection } : null
  }

  setFallback(tabId: number, raw: string, normalized: string, url: string = ""): void {
    const state = this._getOrCreateTabState(tabId)
    state.fallback = {
      raw: raw || "",
      normalized: normalized || "",
      url: url || "",
      timestamp: Date.now()
    }
    state.meta.updatedAt = Date.now()
    this._log("setFallback", { tabId, raw, normalized, url })
  }

  getFallback(tabId: number): FallbackState | null {
    const state = this.tabStates.get(tabId)
    return state ? { ...state.fallback } : null
  }

  setTitle(tabId: number, title: string, keyword: string = "", url: string = ""): void {
    const state = this._getOrCreateTabState(tabId)
    state.title = {
      text: title || "",
      keyword: keyword || "",
      url: url || "",
      timestamp: Date.now()
    }
    state.meta.updatedAt = Date.now()
    this._log("setTitle", { tabId, title, keyword, url })
  }

  getTitle(tabId: number): TitleState | null {
    const state = this.tabStates.get(tabId)
    return state ? { ...state.title } : null
  }

  getTabState(tabId: number): TabState | null {
    const state = this.tabStates.get(tabId)
    if (!state) return null
    return {
      selection: { ...state.selection },
      fallback: { ...state.fallback },
      title: { ...state.title },
      meta: { ...state.meta }
    }
  }

  deleteTabState(tabId: number): boolean {
    const deleted = this.tabStates.delete(tabId)
    if (deleted) this._log("deleteTabState", { tabId })
    return deleted
  }

  cleanupExpiredStates(): number {
    const now = Date.now()
    const expiry = this.options.stateExpiry
    let count = 0
    for (const [tabId, state] of this.tabStates.entries()) {
      if (now - state.meta.updatedAt > expiry) {
        this.tabStates.delete(tabId)
        count++
      }
    }
    if (count > 0) this._log("cleanupExpiredStates", { count, total: this.tabStates.size })
    return count
  }

  clearAll(): void {
    this.currentState = {
      raw: "",
      normalized: "",
      display: "",
      tabId: null,
      url: "",
      timestamp: null
    }
    this.tabStates.clear()
    this._log("clearAll")
  }

  getStats(): StatsSnapshot {
    return {
      currentState: {
        hasContent: !!this.currentState.raw,
        tabId: this.currentState.tabId,
        timestamp: this.currentState.timestamp
      },
      tabStates: {
        total: this.tabStates.size,
        tabIds: Array.from(this.tabStates.keys())
      }
    }
  }

  canPreserveCurrentState(currentTabId: number | null, currentUrl: string | null): boolean {
    if (!this.currentState.raw) return false
    if (this.currentState.tabId === currentTabId) return true
    if (this.currentState.url && currentUrl) {
      const currentDomain = this._extractDomain(currentUrl)
      const stateDomain = this._extractDomain(this.currentState.url)
      if (currentDomain === stateDomain) return true
    }
    return false
  }

  private _extractDomain(url: string): string {
    try {
      return new URL(url).hostname
    } catch {
      return ""
    }
  }

  private _startAutoCleanup(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredStates()
    }, this.options.autoCleanupInterval)
    this._log("_startAutoCleanup", { interval: this.options.autoCleanupInterval })
  }

  stopAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
      this._log("stopAutoCleanup")
    }
  }

  private _log(action: string, data?: unknown): void {
    if (!this.options.debug) return
    console.log(`[StateManager] ${action}`, data ?? "")
  }

  destroy(): void {
    this.stopAutoCleanup()
    this.clearAll()
    this._log("destroy")
  }

  // ==================== 向后兼容代理 ====================

  getLatestTabPageTitle(tabId: number | null | undefined, maxAge: number | null = null): string {
    if (tabId == null) return ""
    const state = this.tabStates.get(tabId)
    if (!state || !state.title) return ""
    const effectiveMaxAge = maxAge || this.options.cacheExpiry.title
    const now = Date.now()
    const age = now - (state.title.timestamp || 0)
    if (age > effectiveMaxAge) {
      this._log("getLatestTabPageTitle-expired", { tabId, age, maxAge: effectiveMaxAge })
      return ""
    }
    return state.title.text || ""
  }

  getLatestTabKeyword(tabId: number | null | undefined, maxAge: number | null = null): string {
    if (tabId == null) return ""
    const state = this.tabStates.get(tabId)
    if (!state || !state.title) return ""
    const effectiveMaxAge = maxAge || this.options.cacheExpiry.keyword
    const now = Date.now()
    const age = now - (state.title.timestamp || 0)
    if (age > effectiveMaxAge) {
      this._log("getLatestTabKeyword-expired", { tabId, age, maxAge: effectiveMaxAge })
      return ""
    }
    return state.title.keyword || ""
  }

  updateLatestTabTitle(tabId: number | null | undefined, pageTitle: string): void {
    if (tabId == null || typeof pageTitle !== "string") return
    const state = this._getOrCreateTabState(tabId)
    state.title.text = pageTitle
    state.title.timestamp = Date.now()
    state.meta.updatedAt = Date.now()
    this._log("updateLatestTabTitle", { tabId, pageTitle })
  }

  updateLatestTabKeyword(
    tabId: number | null | undefined,
    keyword: string,
    normalized?: string
  ): void {
    if (tabId == null || typeof keyword !== "string") return
    const state = this._getOrCreateTabState(tabId)
    state.title.keyword = keyword
    if (typeof normalized === "string") {
      state.fallback.normalized = normalized
    }
    state.title.timestamp = Date.now()
    state.meta.updatedAt = Date.now()
    this._log("updateLatestTabKeyword", { tabId, keyword, normalized })
  }

  getOrCreateTitleEntry(tabId: number | null | undefined): TitleEntryCompat | null {
    if (tabId == null) return null
    const state = this._getOrCreateTabState(tabId)
    return {
      title: state.title.text,
      pageTitle: state.title.text,
      keyword: state.title.keyword,
      keywordNormalized: state.fallback.normalized,
      timestamp: state.title.timestamp,
      keywordTimestamp: state.title.timestamp
    }
  }

  getSelectedText(tabId: number | null | undefined): {
    text: string
    url: string
    timestamp: number | null
  } | null {
    if (tabId == null) return null
    const state = this.tabStates.get(tabId)
    if (!state) return null
    return {
      text: state.selection.text,
      url: state.selection.url,
      timestamp: state.selection.timestamp
    }
  }

  setSelectedText(tabId: number | null | undefined, text: string, url: string = ""): void {
    if (tabId == null) return
    this.setSelection(tabId, text, url)
  }

  getFallbackKeyword(tabId: number | null | undefined): FallbackState | null {
    if (tabId == null) return null
    const state = this.tabStates.get(tabId)
    if (!state) return null
    return {
      raw: state.fallback.raw,
      normalized: state.fallback.normalized,
      url: state.fallback.url,
      timestamp: state.fallback.timestamp
    }
  }

  setFallbackKeyword(
    tabId: number | null | undefined,
    data: { raw?: string; normalized?: string; url?: string }
  ): void {
    if (tabId == null || !data) return
    this.setFallback(tabId, data.raw || "", data.normalized || "", data.url || "")
  }

  shouldPreserveMenuStateForUrl(
    url: string | null | undefined,
    hosts: readonly string[] = this.options.quickResultHosts
  ): boolean {
    if (!url) return false
    try {
      const hostname = new URL(url).hostname
      return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))
    } catch (_) {
      return false
    }
  }

  shouldPreserveMenuStateForTab(
    tab: { url?: string } | null | undefined,
    hosts: readonly string[] = this.options.quickResultHosts
  ): boolean {
    if (!tab || typeof tab.url !== "string") return false
    return this.shouldPreserveMenuStateForUrl(tab.url, hosts)
  }

  /**
   * 兼容 legacy createLegacyProxy（保留同样接口）
   */
  createLegacyProxy(): {
    readonly currentMenuState: CurrentState
    selectedTextByTab: Record<string, unknown>
    fallbackKeywordByTab: Record<string, unknown>
    latestTitleByTab: Record<string, unknown>
  } {
    const self = this
    return {
      get currentMenuState() {
        return self.getCurrentState()
      },
      selectedTextByTab: new Proxy(
        {},
        {
          get(_target, tabId) {
            const numTabId = parseInt(String(tabId), 10)
            if (isNaN(numTabId)) return undefined
            return self.getSelectedText(numTabId)
          },
          set(_target, tabId, value) {
            const numTabId = parseInt(String(tabId), 10)
            if (isNaN(numTabId)) return false
            if (value && typeof value === "object") {
              const v = value as { text?: string; url?: string }
              self.setSelectedText(numTabId, v.text || "", v.url || "")
            }
            return true
          }
        }
      ),
      fallbackKeywordByTab: new Proxy(
        {},
        {
          get(_target, tabId) {
            const numTabId = parseInt(String(tabId), 10)
            if (isNaN(numTabId)) return undefined
            return self.getFallbackKeyword(numTabId)
          },
          set(_target, tabId, value) {
            const numTabId = parseInt(String(tabId), 10)
            if (isNaN(numTabId)) return false
            if (value && typeof value === "object") {
              self.setFallbackKeyword(numTabId, value as { raw?: string; normalized?: string; url?: string })
            }
            return true
          }
        }
      ),
      latestTitleByTab: new Proxy(
        {},
        {
          get(_target, tabId) {
            const numTabId = parseInt(String(tabId), 10)
            if (isNaN(numTabId)) return undefined
            return self.getOrCreateTitleEntry(numTabId)
          },
          set(_target, tabId, value) {
            const numTabId = parseInt(String(tabId), 10)
            if (isNaN(numTabId)) return false
            if (value && typeof value === "object") {
              const v = value as {
                title?: string
                pageTitle?: string
                keyword?: string
                keywordNormalized?: string
              }
              if (v.title || v.pageTitle) {
                self.updateLatestTabTitle(numTabId, v.title || v.pageTitle || "")
              }
              if (v.keyword) {
                self.updateLatestTabKeyword(numTabId, v.keyword, v.keywordNormalized)
              }
            }
            return true
          }
        }
      )
    }
  }
}

export default StateManager
