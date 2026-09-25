/**
 * Legacy → TS bridge for base.js (Plasmo SW entry)
 *
 * 这是切换 SW 入口到纯 TS 的"桥梁"模块：
 * - 把 src/background/*.ts 里 port 好的函数挂到 globalThis 上
 * - 用 LAZY 查找模式：globalThis.* deps 在调用时取，不在 attach 时取
 *   （这样 importScripts 加载 Constants.js / TextUtils.js / MenuRegistry.js 之后，
 *    deps 全部到位再被 call）
 *
 * 加载时序（关键）：
 *   1. src/background.ts 静态 import baseBridge → 本文件副作用：globalThis.X = function
 *   2. importScripts(Constants.js / TextUtils.js / ...) → 设置 currentMenuState 等共享状态
 *   3. importScripts(menuBuilder.js / menuHandlers.js / events.js / init.js) → 调用 globalThis.setMenuState 等
 *
 * 此时 base.js 已被从 importScripts 列表里移除 —— 由本桥梁完全替代。
 *
 * 注意：本桥梁不参与 base.js 内 `if (typeof X === 'undefined') { function X(){} }` 那种
 * fallback 自定义实现 —— TextUtils.js / Constants.js 才是 SSoT。
 */

import { setMenuState as tsSetMenuState, applyMenuTitle as tsApplyMenuTitle, type MenuStateOrchestratorDeps } from "./menuStateOrchestrator"
import {
  refreshMenuTitle as tsRefreshMenuTitle,
  refreshContextMenu as tsRefreshContextMenu,
  copyTextInTab as tsCopyTextInTab
} from "./menuActions"
import {
  updateMainMenuTitle as tsUpdateMainMenuTitle,
  updateSearchLabelTitle as tsUpdateSearchLabelTitle,
  updateSubmenuLabels as tsUpdateSubmenuLabels,
  updateSearchMenuTitles as tsUpdateSearchMenuTitles
} from "./menuTitleUpdater"
import { getMenuDebugInfo as tsGetMenuDebugInfo } from "./menuDebugInfo"
import { getPopupMenuStructure as tsGetPopupMenuStructure } from "./popupMenuStructure"
import {
  TabStateCache,
  type TabStateStore,
  DEFAULT_MAX_AGE_MS
} from "./tabState"
import {
  getMenuDefinition as tsGetMenuDefinition,
  getMenuText as tsGetMenuText,
  getMenuTitle as tsGetMenuTitle
} from "./menuTitles"
import {
  initKeywordSyncSystem as tsInitKeywordSyncSystem,
  ensureMenuIconSupportLoaded as tsEnsureMenuIconSupportLoaded,
  createMenuIconSupportState,
  type MenuIconSupportState
} from "./bootstrap"
import { logMenuEvent as tsLogMenuEvent, buildLogPayload as tsBuildLogPayload } from "./Logger"

// 把 globalThis 视作可变 record
type GlobalRecord = Record<string, unknown> & { chrome?: any }
const G = globalThis as unknown as GlobalRecord

// ============================================
// 共享状态：menuIcon 支持持久化（base.js 内部 state）
// ============================================
const menuIconState: MenuIconSupportState = createMenuIconSupportState()
// 必须与 background/icons.js 写入的键一致（shared/storageKeys.js MENU_ICON_SUPPORT；原 base.js 读的就是它）
const MENU_ICON_SUPPORT_STORAGE_KEY = "ccs_menu_icon_supported"

// ============================================
// 工具：用 globalThis 上的真实依赖构造 setMenuState 的 deps
// 在调用时 lazy 取（importScripts 后才到位）
// ============================================
function buildSetMenuStateDeps(): MenuStateOrchestratorDeps {
  return {
    currentMenuState: (G.currentMenuState as MenuStateOrchestratorDeps["currentMenuState"]) ?? {
      raw: "", normalized: "", display: "", tabId: null, url: ""
    },
    formatMenuTitle: (G.formatMenuTitle as (s: string) => string) ?? ((s: string) => s),
    tabs: G.chrome?.tabs,
    contextMenus: G.chrome?.contextMenus,
    contextMenusRefresh: G.chrome?.contextMenus,
    runtimeSendMessage: G.chrome?.runtime,
    action: G.chrome?.action,
    runtime: G.chrome?.runtime,
    menuDefinitions: (G.MENU_DEFINITIONS as Record<string, { icon?: string; text?: string }>) ?? {},
    dynamicSearchMenuItems: (G.dynamicSearchMenuItems as string[]) ?? [],
    updateLatestTabKeyword: (G.updateLatestTabKeyword as (tabId: number, kw: string, n: string) => void),
    keywordSyncManager: (G.keywordSyncManager as MenuStateOrchestratorDeps["keywordSyncManager"]) ?? null,
    logMenuEvent: ((stage: string, payload: Record<string, unknown>) => {
      // 优先用 globalThis 上 legacy 自己定义的 logMenuEvent（保留生产行为），
      // 否则 fallback 到 TS Logger.ts 版本
      const f = G.logMenuEvent as ((s: string, p: Record<string, unknown>) => void) | undefined
      if (typeof f === "function") f(stage, payload)
      else tsLogMenuEvent(stage, payload)
    }),
    refreshDelayMs: 50
  }
}

function buildMenuTitleUpdaterDeps() {
  return {
    contextMenus: G.chrome?.contextMenus,
    action: G.chrome?.action,
    runtime: G.chrome?.runtime,
    menuDefinitions: (G.MENU_DEFINITIONS as Record<string, { icon?: string; text?: string }>) ?? {},
    dynamicSearchMenuItems: (G.dynamicSearchMenuItems as string[]) ?? [],
    formatMenuTitle: (G.formatMenuTitle as (s: string) => string) ?? ((s: string) => s),
    logMenuEvent: G.logMenuEvent as (s: string, p: Record<string, unknown>) => void,
    currentMenuState: G.currentMenuState as { display?: string; raw?: string; normalized?: string }
  }
}

// ============================================
// TabStateCache：共享 globalThis.latestTitleByTab 作为后端 store
// ============================================
function getTabStore(): TabStateStore {
  if (!G.latestTitleByTab) G.latestTitleByTab = {}
  return G.latestTitleByTab as TabStateStore
}

function getTabStateCache(): TabStateCache {
  // 每次 build 一个 wrapper（state 在 globalThis 上是 idempotent）
  return new TabStateCache({
    store: getTabStore(),
    normalizeSearchText: (G.normalizeSearchText as (s: string) => string) ?? ((s: string) => s),
    logMenuEvent: G.logMenuEvent as (s: string, p: Record<string, unknown>) => void
  })
}

// ============================================
// 把所有 base.js 暴露的全局函数装到 globalThis
// （包装成 attachBaseBridge 函数，由 src/background.ts 在 importScripts 后调用，
//  这样 TS 版本最终覆盖 legacy）
// ============================================

export function attachBaseBridge(): void {

// --- 日志（base.js 重写过 Logger.js 的 logMenuEvent，TS 版本对齐生产行为）---
G.logMenuEvent = tsLogMenuEvent
G.buildLogPayload = tsBuildLogPayload

// --- 状态写入/读取 ---
G.updateLatestTabTitle = (tabId: number, pageTitle: string) => {
  getTabStateCache().updateTitle(tabId, pageTitle)
}
G.updateLatestTabKeyword = (tabId: number, keyword: string, normalized?: string) => {
  getTabStateCache().updateKeyword(tabId, keyword, normalized)
}
G.getLatestTabPageTitle = (tabId: number, maxAge?: number) => {
  return getTabStateCache().getPageTitle(tabId, maxAge ?? DEFAULT_MAX_AGE_MS)
}
G.getLatestTabKeyword = (tabId: number, maxAge?: number) => {
  return getTabStateCache().getKeyword(tabId, maxAge ?? DEFAULT_MAX_AGE_MS)
}
G.getOrCreateTitleEntry = (tabId: number) => {
  return getTabStateCache().getOrCreate(tabId)
}

// --- 菜单 title 查询（与 menuTitles.ts 对齐）---
G.getMenuDefinition = (menuId: string) => {
  const defs = (G.MENU_DEFINITIONS as Record<string, { icon?: string; text?: string }>) ?? {}
  return tsGetMenuDefinition(defs, menuId)
}
G.getMenuText = (menuId: string, fallback?: string) => {
  const defs = (G.MENU_DEFINITIONS as Record<string, { icon?: string; text?: string }>) ?? {}
  return tsGetMenuText(defs, menuId, fallback)
}
G.getMenuTitle = (menuId: string, fallback?: string) => {
  const defs = (G.MENU_DEFINITIONS as Record<string, { icon?: string; text?: string }>) ?? {}
  return tsGetMenuTitle(defs, menuId, fallback)
}

// --- 菜单标题更新 ---
G.updateSearchMenuTitles = (displayText: string) => {
  tsUpdateSearchMenuTitles(displayText, buildMenuTitleUpdaterDeps())
}
G.updateMainMenuTitle = async (displayText: string) => {
  await tsUpdateMainMenuTitle(displayText, buildMenuTitleUpdaterDeps())
}
G.updateSearchLabelTitle = async (displayText: string) => {
  await tsUpdateSearchLabelTitle(displayText, buildMenuTitleUpdaterDeps())
}
G.updateSubmenuLabels = async (displayText: string) => {
  await tsUpdateSubmenuLabels(displayText, buildMenuTitleUpdaterDeps())
}

// --- 核心状态 orchestrator ---
G.setMenuState = async (raw: string, normalized: string, meta?: { tabId?: number | null; url?: string }) => {
  await tsSetMenuState(raw, normalized, meta, buildSetMenuStateDeps())
}
G.applyMenuTitle = (normalized: string, raw: string = "", meta?: { tabId?: number | null; url?: string }) => {
  tsApplyMenuTitle(normalized, raw, meta, buildSetMenuStateDeps())
}

// --- 刷新 / 复制 ---
G.refreshMenuTitle = async (tab: { id?: number; url?: string; title?: string } | undefined, selectionText: string = "") => {
  const computeSearchTextForTab = G.computeSearchTextForTab as (input: {
    tabId?: number; tabUrl?: string; tabTitle: string; selectionText: string
  }, options?: { allowFallbackSelectionFetch?: boolean }) => Promise<{ raw: string; normalized: string }>
  if (typeof computeSearchTextForTab !== "function") return
  await tsRefreshMenuTitle(tab, selectionText, {
    computeSearchTextForTab,
    setMenuStateDeps: buildSetMenuStateDeps()
  })
}
G.refreshContextMenu = async () => {
  await tsRefreshContextMenu({
    contextMenus: G.chrome?.contextMenus,
    logMenuEvent: G.logMenuEvent as (s: string, p: Record<string, unknown>) => void
  })
}
G.copyTextInTab = async (tab: { id?: number } | undefined, text: string) => {
  return tsCopyTextInTab(tab, text, {
    tabs: G.chrome?.tabs,
    scripting: G.chrome?.scripting,
    onDebug: G.BG_DBG as ((msg: string, err: unknown) => void) | undefined
  })
}

// --- Debug / Popup 数据 ---
G.getMenuDebugInfo = async (tabId: number | null) => {
  return tsGetMenuDebugInfo(tabId, {
    currentMenuState: (G.currentMenuState as MenuStateOrchestratorDeps["currentMenuState"]) ?? {
      raw: "", normalized: "", display: "", tabId: null, url: ""
    },
    selectedTextByTab: G.selectedTextByTab as Record<string | number, unknown> | null,
    fallbackKeywordByTab: G.fallbackKeywordByTab as Record<string | number, unknown> | null,
    latestTitleByTab: G.latestTitleByTab as Record<string | number, unknown> | null,
    menuRegistry: G.menuRegistry as any,
    keywordSyncManager: G.keywordSyncManager as any,
    tabs: G.chrome?.tabs
  })
}
G.getPopupMenuStructure = async () => {
  return tsGetPopupMenuStructure()
}

// --- Bootstrap ---
G.initKeywordSyncSystem = () => {
  return tsInitKeywordSyncSystem({
    menuRegistry: G.menuRegistry as any,
    KeywordSyncManagerClass: G.KeywordSyncManager as any,
    existingInstance: G.keywordSyncManager
  })
}
G.ensureMenuIconSupportLoaded = () => {
  return tsEnsureMenuIconSupportLoaded({
    state: menuIconState,
    storage: G.chrome?.storage?.local,
    storageKey: MENU_ICON_SUPPORT_STORAGE_KEY,
    setDebug: (v: boolean) => { G.BG_DEBUG = v },
    logMenuEvent: G.logMenuEvent as (s: string, p: Record<string, unknown>) => void
  })
}

// MENU_ICON_SUPPORT 状态查询（供 icons.js 用）
Object.defineProperty(G, "menuIconUpdateSupported", {
  configurable: true,
  get() { return menuIconState.supported },
  set(v: boolean) { menuIconState.supported = v }
})
Object.defineProperty(G, "menuIconSupportLoaded", {
  configurable: true,
  get() { return menuIconState.loaded },
  set(v: boolean) { menuIconState.loaded = v }
})

console.log("[触触搜][baseBridge] TS bridge attached to globalThis (overrides legacy base.js exports)")

}  // end attachBaseBridge

export default attachBaseBridge
