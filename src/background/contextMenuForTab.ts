/**
 * 标签级菜单标题预设 (TypeScript port)
 *
 * 抽自 background/events.js 行 1325-1333 的 updateContextMenuForTab(tab)：
 * 当 tab URL 变化时（不带选区），从 URL/title 中提取潜在关键字预设到菜单。
 * 实际使用时选中文本会覆盖这个预设（优先级低）。
 *
 * 所有依赖已 port：extractSearchKeywords (keywordResolver.ts) +
 * normalizeSearchText (utils/TextUtils.ts) + setMenuState/applyMenuTitle
 * (menuStateOrchestrator.ts)。本文件是 events.js 中可独立 port 的最后一个
 * 纯函数式入口。
 */
import {
  setMenuState,
  type MenuStateOrchestratorDeps
} from "./menuStateOrchestrator"

export interface TabLite {
  id?: number
  url?: string
  title?: string
}

export interface UpdateContextMenuForTabDeps {
  /** keywordResolver.extractSearchKeywords */
  extractSearchKeywords: (url: string | undefined, tab: TabLite) => Promise<string> | string
  /** utils/TextUtils.normalizeSearchText */
  normalizeSearchText: (s: string) => string
  /** menuStateOrchestrator deps（用于 setMenuState/applyMenuTitle 调用） */
  setMenuStateDeps: MenuStateOrchestratorDeps
}

/**
 * 等价 events.js updateContextMenuForTab(tab):
 * 1. extractSearchKeywords(tab.url, tab) → 潜在关键字 candidate
 * 2. normalize candidate
 * 3. applyMenuTitle(normalized, raw, { tabId, url }) ≡ fire-and-forget setMenuState
 */
export async function updateContextMenuForTab(
  tab: TabLite,
  deps: UpdateContextMenuForTabDeps
): Promise<void> {
  const keywords = await deps.extractSearchKeywords(tab.url, tab)
  const keywordsStr = typeof keywords === "string" ? keywords : ""
  const normalized = keywordsStr ? deps.normalizeSearchText(keywordsStr) : ""
  void setMenuState(keywordsStr || "", normalized, {
    tabId: tab?.id ?? null,
    url: tab?.url || ""
  }, deps.setMenuStateDeps)
}

export default { updateContextMenuForTab }
