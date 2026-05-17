/**
 * Tab-keyed 关键字 / 标题缓存 (TypeScript port)
 *
 * 抽自 background/base.js 行 127-220 的 5 个函数（占 base.js 的 ~10%）。
 * 这块逻辑是其他 SW 模块（KeywordService / KeywordSyncManager / menuHandlers）
 * 的共同依赖，先 port 出来便于其他模块 ESM import。
 *
 * Legacy 通过 `latestTitleByTab` global object 共享状态，本 TS 版本支持两种用法：
 *   1. 工厂模式：`createTabStateStore()` 返回新实例，状态封装在闭包
 *   2. 注入模式：传入 `store` 参数复用 legacy globalThis.latestTitleByTab，与现有代码共存
 *
 * BUGFIX 保留：maxAge=30000ms（v1.6.0+，从 5s 延长到 30s 提高缓存命中率）。
 */

export interface TitleEntry {
  title?: string
  pageTitle?: string
  timestamp?: number
  keyword?: string
  keywordNormalized?: string
  keywordTimestamp?: number
}

export type TabStateStore = Record<number, TitleEntry>

export interface TabStateOptions {
  /** 复用外部 store（如 legacy globalThis.latestTitleByTab） */
  store?: TabStateStore
  /** 关键字规范化函数（来自 utils/TextUtils.ts） */
  normalizeSearchText?: (s: string) => string
  /** logMenuEvent 注入（用于 cache-expired 日志） */
  logMenuEvent?: (stage: string, payload: Record<string, unknown>) => void
}

export const DEFAULT_MAX_AGE_MS = 30_000  // BUGFIX v1.6.0: 从 5s 延长到 30s

export class TabStateCache {
  store: TabStateStore
  normalizeSearchText: (s: string) => string
  logMenuEvent: (stage: string, payload: Record<string, unknown>) => void

  constructor(opts: TabStateOptions = {}) {
    this.store = opts.store ?? {}
    this.normalizeSearchText = opts.normalizeSearchText || ((s: string) => (s || "").trim())
    this.logMenuEvent = opts.logMenuEvent || (() => { /* noop */ })
  }

  getOrCreate(tabId: number | null | undefined): TitleEntry | null {
    if (tabId == null) return null
    let entry = this.store[tabId]
    if (!entry) {
      entry = {}
      this.store[tabId] = entry
    }
    return entry
  }

  updateTitle(tabId: number | null | undefined, pageTitle: string): void {
    if (tabId == null || typeof pageTitle !== "string") return
    const entry = this.getOrCreate(tabId)
    if (!entry) return
    entry.title = pageTitle
    entry.pageTitle = pageTitle
    entry.timestamp = Date.now()
  }

  updateKeyword(tabId: number | null | undefined, keyword: string, normalized?: string): void {
    if (tabId == null || typeof keyword !== "string") return
    const entry = this.getOrCreate(tabId)
    if (!entry) return
    entry.keyword = keyword
    entry.keywordNormalized = typeof normalized === "string" ? normalized : this.normalizeSearchText(keyword)
    entry.keywordTimestamp = Date.now()
  }

  getPageTitle(tabId: number | null | undefined, maxAge: number = DEFAULT_MAX_AGE_MS): string {
    if (tabId == null) return ""
    const entry = this.store[tabId]
    if (!entry) return ""
    const age = Date.now() - (entry.timestamp || 0)
    if (age > maxAge) {
      this.logMenuEvent("cached-title-expired", {
        tabId, age, maxAge, title: entry.pageTitle || entry.title
      })
      return ""
    }
    return entry.pageTitle || entry.title || ""
  }

  getKeyword(tabId: number | null | undefined, maxAge: number = DEFAULT_MAX_AGE_MS): string {
    if (tabId == null) return ""
    const entry = this.store[tabId]
    if (!entry) return ""
    const keywordAge = Date.now() - (entry.keywordTimestamp || 0)
    if (keywordAge > maxAge) {
      this.logMenuEvent("cached-keyword-expired", {
        tabId, age: keywordAge, maxAge, keyword: entry.keyword
      })
      return ""
    }
    return entry.keyword || ""
  }

  clearTab(tabId: number | null | undefined): void {
    if (tabId == null) return
    delete this.store[tabId]
  }

  getStats(): { tabCount: number } {
    return { tabCount: Object.keys(this.store).length }
  }
}

export function createTabStateCache(opts: TabStateOptions = {}): TabStateCache {
  return new TabStateCache(opts)
}

export default TabStateCache
