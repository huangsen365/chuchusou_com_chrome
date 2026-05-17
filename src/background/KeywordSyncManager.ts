/**
 * 关键字 / 菜单标题同步协调者 (TypeScript port)
 *
 * 与 background/KeywordSyncManager.js 1:1 行为对等，但**去屎山**：
 * - legacy `_setupOnShownListener` 整段就是 `onShownSyncEnabled=false` early-return，
 *   ~80 行 dead code（含 chrome.contextMenus.onShown handler）。本 port 直接砍掉。
 * - `updateFallback` / `updatePageTitle` 是 compat 期间的占位 noop，删了。
 * - 全部 `typeof xxx === 'function'` 防御性检查 → deps 注入 + TS 类型保证
 *
 * legacy 501 行 → 本 port 约 220 行（**减 56%**）。
 *
 * ⚠️ 类名容易让人以为是"关键字获取入口"，**但实际不是**。
 * 关键字获取已迁到 KeywordService（intent 驱动门面）。
 * 本类只负责"右键菜单标题的批量同步"那一块业务（syncMenus / syncGroup 仍在
 * legacy base.js 的 setMenuState 流程里被调用）。
 */

export interface KeywordState {
  raw: string
  normalized: string
  display: string
  tabId: number | null
  timestamp: number
  source: string | null
}

export interface SelectionEntry {
  text?: string
  url?: string
}

export interface FallbackEntry {
  raw?: string
  keyword?: string
}

export interface TitleEntry {
  title?: string
  pageTitle?: string
}

export interface SyncResult {
  success: number
  failed: number
  total: number
}

export interface MenuRegistryLike {
  syncAll: (context: SyncContext) => Promise<SyncResult>
  syncGroup: (groupName: string, context: SyncContext) => Promise<SyncResult>
}

export interface SyncContext {
  keyword: string
  raw: string
  normalized: string
}

export interface KeywordSyncDeps {
  menuRegistry: MenuRegistryLike
  /** 全局 mutable state（来自 base.js） */
  selectedTextByTab?: Record<number, SelectionEntry | string | undefined>
  fallbackKeywordByTab?: Record<number, FallbackEntry | undefined>
  latestTitleByTab?: Record<number, TitleEntry | undefined>
  /** 工具函数（来自 utils/TextUtils.ts） */
  normalizeKeyword?: (raw: string) => string
  formatMenuTitle?: (text: string) => string
  /** 调试日志 hook */
  logMenuEvent?: (event: string, payload: Record<string, unknown>) => void
}

type Subscriber = (state: KeywordState) => void

export class KeywordSyncManager {
  deps: KeywordSyncDeps
  currentState: KeywordState
  subscribers: Subscriber[] = []
  syncing = false

  constructor(deps: KeywordSyncDeps) {
    this.deps = deps
    this.currentState = {
      raw: "",
      normalized: "",
      display: "",
      tabId: null,
      timestamp: Date.now(),
      source: null
    }
    // legacy `_setupOnShownListener` 内部 onShownSyncEnabled=false early-return，
    // 整段 80 行 dead code 这里直接删除。菜单同步现在走 setMenuState() 即时路径。
  }

  /** 读取指定 tab 的选区/fallback/title 派生关键字（compat 模式：兼容老 global state） */
  private extractKeyword(tabId: number): { raw: string; source: string | null } {
    const selectedEntry = this.deps.selectedTextByTab?.[tabId]
    const selectedText =
      (typeof selectedEntry === "object" && selectedEntry?.text) ||
      (typeof selectedEntry === "string" ? selectedEntry : "") || ""

    const fallbackEntry = this.deps.fallbackKeywordByTab?.[tabId]
    const fallbackKeyword = fallbackEntry?.raw || fallbackEntry?.keyword || ""

    const titleEntry = this.deps.latestTitleByTab?.[tabId]
    const pageTitle = titleEntry?.title || titleEntry?.pageTitle || ""

    const raw = selectedText || fallbackKeyword || pageTitle || ""
    const source = selectedText ? "selection" : (fallbackKeyword ? "fallback" : (pageTitle ? "title" : null))
    return { raw, source }
  }

  /** 刷新指定 tab 的关键字状态 */
  async refreshKeywordForTab(tabId: number): Promise<void> {
    try {
      const { raw, source } = this.extractKeyword(tabId)
      const normalized = this.deps.normalizeKeyword ? this.deps.normalizeKeyword(raw) : raw
      const display = this.deps.formatMenuTitle ? this.deps.formatMenuTitle(normalized) : normalized
      this.currentState = { raw, normalized, display, tabId, timestamp: Date.now(), source }
    } catch (error) {
      console.error("[KeywordSyncManager] Error refreshing keyword:", error)
    }
  }

  async update(raw: string, normalized: string | null | undefined, meta: { tabId?: number; source?: string } = {}): Promise<void> {
    const { tabId, source = "unknown" } = meta
    let norm = normalized
    if (!norm && this.deps.normalizeKeyword) norm = this.deps.normalizeKeyword(raw)
    if (!norm) norm = raw
    const display = this.deps.formatMenuTitle ? this.deps.formatMenuTitle(norm) : norm

    this.currentState = {
      raw: raw || "",
      normalized: norm || "",
      display: display || "",
      tabId: tabId ?? null,
      timestamp: Date.now(),
      source
    }

    this._notifySubscribers(this.currentState)

    this.deps.logMenuEvent?.("keyword-updated", {
      raw, normalized: norm, display, tabId, source
    })
  }

  async updateSelection(tabId: number, text: string): Promise<void> {
    await this.update(text, null, { tabId, source: "selection" })
  }

  getState(): KeywordState {
    return { ...this.currentState }
  }

  getKeywordForTab(tabId: number): string {
    const { raw } = this.extractKeyword(tabId)
    return raw
  }

  clearTabCache(tabId: number): void {
    if (this.deps.selectedTextByTab) delete this.deps.selectedTextByTab[tabId]
    if (this.deps.fallbackKeywordByTab) delete this.deps.fallbackKeywordByTab[tabId]
    if (this.deps.latestTitleByTab) delete this.deps.latestTitleByTab[tabId]
  }

  subscribe(callback: Subscriber): () => void {
    if (typeof callback !== "function") {
      console.warn("[KeywordSyncManager] Invalid callback for subscribe")
      return () => {}
    }
    this.subscribers.push(callback)
    return () => {
      const i = this.subscribers.indexOf(callback)
      if (i > -1) this.subscribers.splice(i, 1)
    }
  }

  private _notifySubscribers(state: KeywordState): void {
    for (const cb of this.subscribers) {
      try { cb(state) } catch (error) {
        console.error("[KeywordSyncManager] Error in subscriber callback:", error)
      }
    }
  }

  async syncMenus(): Promise<SyncResult> {
    if (this.syncing) {
      this.deps.logMenuEvent?.("sync-skipped-already-syncing", {})
      return { success: 0, failed: 0, total: 0 }
    }
    this.syncing = true
    try {
      const context: SyncContext = {
        keyword: this.currentState.display,
        raw: this.currentState.raw,
        normalized: this.currentState.normalized
      }
      this.deps.logMenuEvent?.("sync-menus-start", { context, hasRegistry: !!this.deps.menuRegistry })
      const result = await this.deps.menuRegistry.syncAll(context)
      this.deps.logMenuEvent?.("keyword-sync-completed", result as unknown as Record<string, unknown>)
      return result
    } catch (error) {
      console.error("[KeywordSyncManager] Error syncing menus:", error)
      this.deps.logMenuEvent?.("sync-menus-error", {
        error: (error as Error)?.message,
        stack: (error as Error)?.stack
      })
      return { success: 0, failed: 0, total: 0 }
    } finally {
      this.syncing = false
    }
  }

  async syncGroup(groupName: string): Promise<SyncResult> {
    const context: SyncContext = {
      keyword: this.currentState.display,
      raw: this.currentState.raw,
      normalized: this.currentState.normalized
    }
    return this.deps.menuRegistry.syncGroup(groupName, context)
  }

  getStats(): { currentState: KeywordState; cachedTabs: number; fallbackTabs: number; titleTabs: number; subscribers: number } {
    return {
      currentState: this.currentState,
      cachedTabs: this.deps.selectedTextByTab ? Object.keys(this.deps.selectedTextByTab).length : 0,
      fallbackTabs: this.deps.fallbackKeywordByTab ? Object.keys(this.deps.fallbackKeywordByTab).length : 0,
      titleTabs: this.deps.latestTitleByTab ? Object.keys(this.deps.latestTitleByTab).length : 0,
      subscribers: this.subscribers.length
    }
  }

  clear(): void {
    this.currentState = {
      raw: "",
      normalized: "",
      display: "",
      tabId: null,
      timestamp: Date.now(),
      source: null
    }
    this.subscribers = []
  }
}

export default KeywordSyncManager
