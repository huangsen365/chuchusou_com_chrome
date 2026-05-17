/**
 * KeywordService —— 关键字获取的统一门面（TypeScript port）
 *
 * 与 background/KeywordService.js 1:1 行为对等。
 *
 * 旧架构问题（已通过 docs/TECH_DEBT_AUDIT 和聊天评估梳理）：
 * - popup / sidepanel / 右键菜单 三处都直接调 computeSearchTextForTab(ctx, opts)，
 *   每处自己组装 forceFetchSelection / skipCurrentMenuFallback 等 boolean 旗标。
 * - popup 和 sidepanel 的 getCurrentKeyword() 函数代码几乎一致但各自维护。
 * - popup 打开时窃焦点 → tab 失焦 → selection 被清 → popup 拿到空。无 storage 兜底。
 *
 * 本服务做的事：
 * 1. INTENT 概念（'popup-open' / 'sidepanel-init' / 'contextmenu-click' ...），每个意图映射到 policy。
 * 2. 内部仍调 computeSearchTextForTab() —— 行为零变化、有 SSoT。
 * 3. 提供 storage 级 5 分钟 TTL 瞬时缓存（仅 popup-open 启用）。
 *
 * 所有 chrome.* + 全局可变状态通过 deps 注入；自包含纯 TS 模块。
 */

export const KEYWORD_INTENTS = {
  POPUP_OPEN: "popup-open",
  SIDEPANEL_INIT: "sidepanel-init",
  SIDEPANEL_REFRESH: "sidepanel-refresh",
  CONTEXT_MENU_CLICK: "contextmenu-click",
  MENU_PREVIEW: "menu-preview",
  PAGE_CHANGED: "page-changed",
  LEGACY: "legacy-getSearchText"
} as const

export type KeywordIntent = (typeof KEYWORD_INTENTS)[keyof typeof KEYWORD_INTENTS]

export interface IntentPolicy {
  forceFetchSelection: boolean
  skipCurrentMenuFallback: boolean
  cacheToStorage: boolean
  source: string
}

export const INTENT_POLICIES: Record<string, IntentPolicy> = {
  "popup-open":           { forceFetchSelection: true,  skipCurrentMenuFallback: true,  cacheToStorage: true,  source: "popup" },
  "sidepanel-init":       { forceFetchSelection: true,  skipCurrentMenuFallback: true,  cacheToStorage: false, source: "sidepanel-init" },
  "sidepanel-refresh":    { forceFetchSelection: true,  skipCurrentMenuFallback: true,  cacheToStorage: false, source: "sidepanel-refresh" },
  "contextmenu-click":    { forceFetchSelection: true,  skipCurrentMenuFallback: true,  cacheToStorage: false, source: "context-menu" },
  "menu-preview":         { forceFetchSelection: false, skipCurrentMenuFallback: false, cacheToStorage: false, source: "menu-preview" },
  "page-changed":         { forceFetchSelection: false, skipCurrentMenuFallback: false, cacheToStorage: false, source: "tab-event" },
  "legacy-getSearchText": { forceFetchSelection: true,  skipCurrentMenuFallback: true,  cacheToStorage: false, source: "legacy" }
}

export const KEYWORD_STORAGE_PREFIX = "ccs_kw_"
export const KEYWORD_STORAGE_TTL_MS = 5 * 60 * 1000

export interface KeywordContext {
  tabId?: number | null
  url?: string
  title?: string
  selectionText?: string
  intent?: string
}

export interface KeywordResult {
  text: string
  raw: string
  normalized: string
  source: string
  intent: string
}

export interface ComputeOptions {
  forceFetchSelection?: boolean
  skipCurrentMenuFallback?: boolean
}

export interface ComputeResult {
  raw: string
  normalized: string
}

export interface ChromeTabsLite {
  get: (tabId: number, cb: (tab: { url?: string; title?: string; pendingUrl?: string } | null) => void) => void
}

export interface ChromeStorageLite {
  get: (keys: string[], cb: (data: Record<string, unknown>) => void) => void
  set: (items: Record<string, unknown>, cb?: () => void) => void
  remove: (key: string) => void
}

export interface KeywordServiceDeps {
  /** chrome.* injection */
  chrome?: {
    tabs?: ChromeTabsLite
    storage?: { local?: ChromeStorageLite }
    runtime?: { lastError?: unknown }
  }
  /** core engine: computeSearchTextForTab from keywordResolver */
  computeSearchTextForTab: (
    input: { tabId?: number | null; tabUrl?: string; tabTitle?: string; selectionText?: string },
    options: ComputeOptions
  ) => Promise<ComputeResult>
  /** global state hooks（来自 base.js / Constants.js）—— null/undefined 则跳过 */
  selectedTextByTab?: Record<number, unknown>
  fallbackKeywordByTab?: Record<number, unknown>
  latestTitleByTab?: Record<number, unknown>
  updateLatestTabTitle?: (tabId: number, title: string) => void
}

export class KeywordService {
  deps: KeywordServiceDeps

  constructor(deps: KeywordServiceDeps) {
    this.deps = deps
  }

  private async _getFreshTab(tabId: number | null | undefined): Promise<{ url?: string; title?: string; pendingUrl?: string } | null> {
    const ch = this.deps.chrome
    if (tabId == null || !ch?.tabs?.get) return null
    return new Promise((resolve) => {
      try {
        ch.tabs!.get(tabId, (tab) => {
          if (ch.runtime?.lastError) { resolve(null); return }
          resolve(tab || null)
        })
      } catch (_) { resolve(null) }
    })
  }

  private async _hydrateContext(ctx: KeywordContext | null | undefined): Promise<{ tabId?: number | null; url: string; title: string; selectionText: string }> {
    const out = {
      tabId: ctx?.tabId,
      url: ctx?.url || "",
      title: ctx?.title || "",
      selectionText: ctx?.selectionText || ""
    }

    const freshTab = await this._getFreshTab(out.tabId)
    if (!freshTab) return out

    const freshUrl = freshTab.url || freshTab.pendingUrl || ""
    const freshTitle = freshTab.title || ""
    if (freshUrl) out.url = freshUrl
    if (freshTitle) {
      out.title = freshTitle
      if (this.deps.updateLatestTabTitle && out.tabId != null) {
        try { this.deps.updateLatestTabTitle(out.tabId, freshTitle) } catch (_) { /* ignore */ }
      }
    }
    return out
  }

  async getKeyword(ctx: KeywordContext): Promise<KeywordResult> {
    const intent = ctx?.intent || KEYWORD_INTENTS.LEGACY
    const policy = INTENT_POLICIES[intent] || INTENT_POLICIES[KEYWORD_INTENTS.LEGACY]
    const hydrated = await this._hydrateContext(ctx)

    let result: ComputeResult | undefined
    try {
      result = await this.deps.computeSearchTextForTab({
        tabId: hydrated.tabId,
        tabUrl: hydrated.url,
        tabTitle: hydrated.title,
        selectionText: hydrated.selectionText
      }, {
        forceFetchSelection: policy.forceFetchSelection,
        skipCurrentMenuFallback: policy.skipCurrentMenuFallback
      })
    } catch (error) {
      console.error("[触触搜][KeywordService] compute failed:", error)
      return { text: "", raw: "", normalized: "", source: policy.source, intent }
    }

    const text = result?.normalized || ""
    const raw = result?.raw || ""

    if (policy.cacheToStorage && hydrated.tabId != null && text) {
      this._writeStorageCache(hydrated.tabId, { text, raw, url: hydrated.url }).catch(() => { /* noop */ })
    }
    return { text, raw, normalized: text, source: policy.source, intent }
  }

  async readStorageCache(tabId: number | null | undefined, currentUrl?: string): Promise<{ text: string; raw: string } | null> {
    const storage = this.deps.chrome?.storage?.local
    if (tabId == null || !storage) return null
    return new Promise((resolve) => {
      const key = `${KEYWORD_STORAGE_PREFIX}${tabId}`
      try {
        storage.get([key], (data) => {
          if (this.deps.chrome?.runtime?.lastError) { resolve(null); return }
          const entry = data?.[key] as { ts?: number; url?: string; text?: string; raw?: string } | undefined
          if (!entry || typeof entry !== "object") { resolve(null); return }
          if (Date.now() - (entry.ts || 0) > KEYWORD_STORAGE_TTL_MS) { resolve(null); return }
          if (currentUrl && entry.url && entry.url !== currentUrl) { resolve(null); return }
          resolve({ text: entry.text || "", raw: entry.raw || entry.text || "" })
        })
      } catch (_) { resolve(null) }
    })
  }

  private async _writeStorageCache(tabId: number, payload: { text: string; raw: string; url: string }): Promise<void> {
    const storage = this.deps.chrome?.storage?.local
    if (tabId == null || !storage) return
    return new Promise((resolve) => {
      const key = `${KEYWORD_STORAGE_PREFIX}${tabId}`
      try {
        storage.set({
          [key]: { text: payload.text, raw: payload.raw || payload.text, url: payload.url || "", ts: Date.now() }
        }, () => resolve())
      } catch (_) { resolve() }
    })
  }

  async clearTab(tabId: number | null | undefined): Promise<void> {
    if (tabId == null) return
    try {
      if (this.deps.selectedTextByTab) delete this.deps.selectedTextByTab[tabId]
      if (this.deps.fallbackKeywordByTab) delete this.deps.fallbackKeywordByTab[tabId]
      if (this.deps.latestTitleByTab) delete this.deps.latestTitleByTab[tabId]
    } catch (_) { /* ignore */ }
    const storage = this.deps.chrome?.storage?.local
    if (storage) {
      try { storage.remove(`${KEYWORD_STORAGE_PREFIX}${tabId}`) } catch (_) { /* ignore */ }
    }
  }
}

export default KeywordService
