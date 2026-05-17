/**
 * 菜单标题动态更新 (TypeScript port)
 *
 * 抽自 background/base.js 行 319-446 的 4 个 chrome.contextMenus.update 函数：
 * - updateSearchMenuTitles(displayText): 批量更新 N 个搜索引擎菜单
 * - updateMainMenuTitle(displayText): 更新顶层 ccs-main 菜单 + chrome.action 图标 title
 * - updateSearchLabelTitle(displayText): 更新 ccs-search-label
 * - updateSubmenuLabels(displayText): 批量更新 10 个 submenu label
 *
 * **去屎山**：legacy 这 4 个函数各自展开 `chrome.contextMenus.update` + 错误处理
 * + logMenuEvent —— 收敛到 _updateMenuItem(menuId, title, eventName) 单一 helper。
 * legacy ~125 行 → 本 port ~100 行（去掉重复模板）。
 *
 * 全部 chrome.* 通过 deps 注入；logMenuEvent / formatMenuTitle / getMenuTitle
 * / currentMenuState 也通过 deps 解耦，与 legacy 共存或独立运行。
 */

import { getMenuTitle, type MenuDefinitions } from "./menuTitles"

export interface ChromeContextMenusLite {
  update: (id: string, props: { title: string }, cb: () => void) => void
}

export interface ChromeActionLite {
  setTitle?: (props: { title: string }) => void
}

export interface ChromeRuntimeLite {
  lastError?: { message?: string }
}

export interface MenuStateLike {
  display?: string
  raw?: string
  normalized?: string
}

export interface MenuTitleUpdaterDeps {
  /** chrome.contextMenus；不传则用 globalThis.chrome.contextMenus */
  contextMenus?: ChromeContextMenusLite
  /** chrome.action；不传则用 globalThis.chrome.action */
  action?: ChromeActionLite
  /** chrome.runtime；不传则用 globalThis.chrome.runtime */
  runtime?: ChromeRuntimeLite
  /** MENU_DEFINITIONS 字典 */
  menuDefinitions: MenuDefinitions
  /** 动态搜索菜单 ID 列表 */
  dynamicSearchMenuItems: string[]
  /** 文本截断格式化函数（来自 utils/TextUtils.ts） */
  formatMenuTitle: (s: string) => string
  /** logMenuEvent hook（来自 base.js / Logger.ts） */
  logMenuEvent?: (stage: string, payload: Record<string, unknown>) => void
  /** 当前菜单状态（read-only snapshot），用于日志上下文 */
  currentMenuState?: MenuStateLike
}

function getDefaultChrome(): {
  contextMenus?: ChromeContextMenusLite
  action?: ChromeActionLite
  runtime?: ChromeRuntimeLite
} {
  const ch = (globalThis as unknown as { chrome?: { contextMenus?: ChromeContextMenusLite; action?: ChromeActionLite; runtime?: ChromeRuntimeLite } }).chrome
  return ch ?? {}
}

/** 把 4 个 chrome.contextMenus.update 调用收敛到的共享 helper */
function updateMenuItem(
  deps: MenuTitleUpdaterDeps,
  menuId: string,
  title: string,
  failedEventName: string,
  failedPayload: Record<string, unknown> = {}
): Promise<{ success: boolean; error?: string }> {
  const contextMenus = deps.contextMenus || getDefaultChrome().contextMenus
  const runtime = deps.runtime || getDefaultChrome().runtime
  if (!contextMenus?.update) return Promise.resolve({ success: false, error: "no chrome.contextMenus" })

  return new Promise((resolve) => {
    contextMenus.update(menuId, { title }, () => {
      const lastErrorMsg = runtime?.lastError?.message || ""
      if (lastErrorMsg) {
        if (!/Cannot find menu item/i.test(lastErrorMsg)) {
          deps.logMenuEvent?.(failedEventName, { id: menuId, error: lastErrorMsg, ...failedPayload })
        }
        resolve({ success: false, error: lastErrorMsg })
      } else {
        resolve({ success: true })
      }
    })
  })
}

export function updateSearchMenuTitles(displayText: string, deps: MenuTitleUpdaterDeps): void {
  const formatted = displayText ? deps.formatMenuTitle(displayText) : ""
  for (const menuId of deps.dynamicSearchMenuItems) {
    const baseTitle = getMenuTitle(deps.menuDefinitions, menuId)
    const title = formatted ? `${baseTitle}: "${formatted}"` : baseTitle
    // 不 await，与 legacy 一致（fire-and-forget batch update）
    void updateMenuItem(deps, menuId, title, "search-menu-title-update-failed")
    deps.logMenuEvent?.("search-menu-title", {
      id: menuId, title, baseTitle, formatted,
      menuDisplay: deps.currentMenuState?.display || "",
      menuRaw: deps.currentMenuState?.raw || "",
      menuNormalized: deps.currentMenuState?.normalized || ""
    })
  }
}

export async function updateMainMenuTitle(displayText: string, deps: MenuTitleUpdaterDeps): Promise<void> {
  const baseTitle = getMenuTitle(deps.menuDefinitions, "ccs-main")
  const menuTitle = displayText ? `${baseTitle}: "${displayText}"` : baseTitle
  const iconTitle = menuTitle

  await updateMenuItem(deps, "ccs-main", menuTitle, "main-title-update-failed")

  const action = deps.action || getDefaultChrome().action
  if (action?.setTitle) action.setTitle({ title: iconTitle })
  deps.logMenuEvent?.("main-title", { menuTitle, iconTitle, displayText })
}

export async function updateSearchLabelTitle(displayText: string, deps: MenuTitleUpdaterDeps): Promise<void> {
  const formatted = displayText ? deps.formatMenuTitle(displayText) : ""
  const title = formatted ? `🔍 触触搜: "${formatted}"` : "🔍 触触搜"
  await updateMenuItem(deps, "ccs-search-label", title, "search-label-update-failed")
  deps.logMenuEvent?.("search-label", { title, displayText })
}

/** 10 个 fixed submenu label IDs（与 legacy 一致） */
export const FIXED_SUBMENU_LABEL_IDS = [
  "ccs-top100-label",
  "ccs-fastqa-label",
  "ccs-optimize-deep-research-label",
  "ccs-optimize-general-conversation-label",
  "ccs-optimize-code-writing-label",
  "ccs-optimize-content-creation-label",
  "ccs-optimize-data-analysis-label",
  "ccs-optimize-problem-solving-label",
  "ccs-optimize-brainstorm-label",
  "ccs-optimize-description-polish-label"
] as const

export async function updateSubmenuLabels(displayText: string, deps: MenuTitleUpdaterDeps): Promise<void> {
  const formatted = displayText ? deps.formatMenuTitle(displayText) : ""
  const title = formatted ? `🔍 触触搜: "${formatted}"` : "🔍 触触搜"

  const updatePromises = FIXED_SUBMENU_LABEL_IDS.map((labelId) =>
    updateMenuItem(deps, labelId, title, "submenu-label-update-failed", { labelId }).then((result) => {
      if (result.success) deps.logMenuEvent?.("submenu-label-updated", { labelId, title })
      return { labelId, success: result.success, error: result.error }
    })
  )

  const results = await Promise.all(updatePromises)
  const successCount = results.filter((r) => r.success).length
  const failedCount = results.filter((r) => !r.success).length

  deps.logMenuEvent?.("submenu-labels-updated", {
    title, displayText,
    totalLabels: FIXED_SUBMENU_LABEL_IDS.length,
    successCount, failedCount
  })
}

export default {
  updateSearchMenuTitles,
  updateMainMenuTitle,
  updateSearchLabelTitle,
  updateSubmenuLabels,
  FIXED_SUBMENU_LABEL_IDS
}
