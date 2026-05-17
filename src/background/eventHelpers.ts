/**
 * Events 模块通用 helpers (TypeScript port)
 *
 * 抽自 background/events.js 的两个可独立 helper：
 * - snapshotMenuTitles(reason): 调试用，把 8 个关键菜单当前 title/contexts/enabled
 *   通过 logMenuEvent 落日志，方便排查"为什么菜单显示错了"
 * - reinjectContentForTab(tabId, reason): SPA 切页面后 content.js 可能丢失，
 *   用 chrome.scripting.executeScript 重新注入
 *
 * 两者都是 events.js 大监听器中的纯辅助函数，独立 port 后让 events.js 后续可
 * 直接 import 而不用复制粘贴。
 */

export const MENU_TITLE_DEBUG_IDS = [
  "ccs-fastqa-chatgpt-quick",
  "ccs-fastqa-claude-quick",
  "ccs-fastqa-root",
  "ccs-fastqa-open-all",
  "ccs-fastqa-grok-quick",
  "ccs-chuchusou",
  "ccs-chatgpt",
  "ccs-claude"
] as const

export interface ChromeContextMenusGetLite {
  get: (
    id: string,
    cb: (menu: { title?: string; contexts?: string[]; enabled?: boolean } | undefined) => void
  ) => void
}

export interface ChromeRuntimeLastErrorLite {
  lastError?: { message?: string } | null
}

export interface ChromeScriptingLite {
  executeScript: (opts: {
    target: { tabId: number }
    files?: string[]
    func?: (...args: unknown[]) => unknown
    args?: unknown[]
  }) => Promise<unknown>
}

export interface SnapshotMenuTitlesDeps {
  contextMenus?: ChromeContextMenusGetLite
  runtime?: ChromeRuntimeLastErrorLite
  logMenuEvent: (stage: string, payload: Record<string, unknown>) => void
  /** 自定义要 snapshot 的 menu id 列表（默认 MENU_TITLE_DEBUG_IDS） */
  menuIds?: ReadonlyArray<string>
}

function getDefaultChrome(): {
  contextMenus?: ChromeContextMenusGetLite
  runtime?: ChromeRuntimeLastErrorLite
  scripting?: ChromeScriptingLite
} {
  const ch = (globalThis as unknown as {
    chrome?: {
      contextMenus?: ChromeContextMenusGetLite
      runtime?: ChromeRuntimeLastErrorLite
      scripting?: ChromeScriptingLite
    }
  }).chrome
  return ch ?? {}
}

/**
 * 等价 events.js snapshotMenuTitles(reason): 一次性 dump 8 个关键菜单的当前
 * title / contexts / enabled 到日志，失败/异常时分别落不同 stage。
 *
 * 注意：这是 fire-and-forget（chrome.contextMenus.get 是 callback-style），
 * 不返回 Promise。等价 legacy 行为。
 */
export function snapshotMenuTitles(reason: string, deps: SnapshotMenuTitlesDeps): void {
  const cm = deps.contextMenus || getDefaultChrome().contextMenus
  const runtime = deps.runtime || getDefaultChrome().runtime
  const ids = deps.menuIds || MENU_TITLE_DEBUG_IDS
  if (!cm?.get) return
  ids.forEach((menuId) => {
    try {
      cm.get(menuId, (menu) => {
        if (runtime?.lastError || !menu) {
          deps.logMenuEvent("menu-title-snapshot-failed", {
            reason,
            id: menuId,
            error: runtime?.lastError?.message || "not-found"
          })
          return
        }
        deps.logMenuEvent("menu-title-snapshot", {
          reason,
          id: menuId,
          title: menu.title,
          contexts: menu.contexts,
          enabled: menu.enabled
        })
      })
    } catch (error) {
      deps.logMenuEvent("menu-title-snapshot-exception", {
        reason,
        id: menuId,
        error: (error as Error)?.message || String(error)
      })
    }
  })
}

export interface ReinjectContentDeps {
  scripting?: ChromeScriptingLite
  logMenuEvent: (stage: string, payload: Record<string, unknown>) => void
  /** 注入的文件（默认 ['content.js']，等价 legacy） */
  files?: string[]
}

/**
 * 等价 events.js reinjectContentForTab(tabId, reason): SPA 切页面后 content.js
 * 可能丢，重新注入。成功/失败都落日志，返回 boolean。
 */
export async function reinjectContentForTab(
  tabId: number | null | undefined,
  reason: string,
  deps: ReinjectContentDeps
): Promise<boolean> {
  if (tabId == null) return false
  const scripting = deps.scripting || getDefaultChrome().scripting
  if (!scripting?.executeScript) return false

  try {
    await scripting.executeScript({
      target: { tabId },
      files: deps.files || ["content.js"]
    })
    deps.logMenuEvent("selection-sync-reinject", { tabId, reason })
    return true
  } catch (injectError) {
    deps.logMenuEvent("selection-sync-reinject-error", {
      tabId,
      reason,
      error: (injectError as Error)?.message || String(injectError)
    })
    return false
  }
}

export default { MENU_TITLE_DEBUG_IDS, snapshotMenuTitles, reinjectContentForTab }
