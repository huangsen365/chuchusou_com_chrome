/**
 * 菜单刷新 + 复制 actions (TypeScript port)
 *
 * 抽自 background/base.js 行 622-693 的 3 个 chrome.* action：
 * - refreshMenuTitle(tab, selectionText): 拉关键字 → applyMenuTitle 一站式调用
 * - refreshContextMenu(): chrome.contextMenus.refresh + log
 * - copyTextInTab(tab, text): 双路径复制（先 sendMessage 走 content script,
 *   失败 fallback 注入 chrome.scripting.executeScript）
 *
 * 全部走 deps 注入，与 legacy 共存策略不变。
 */
import {
  setMenuState,
  type MenuStateOrchestratorDeps,
  type MenuStateMeta
} from "./menuStateOrchestrator"

export interface ChromeTabLite {
  id?: number
  url?: string
  title?: string
}

export interface ChromeTabsSendMessageLite {
  sendMessage: (tabId: number, msg: unknown) => Promise<unknown>
}

export interface ChromeScriptingLite {
  executeScript: (opts: {
    target: { tabId: number }
    func: (...args: unknown[]) => unknown
    args?: unknown[]
  }) => Promise<unknown>
}

export interface ComputeSearchTextInput {
  tabId?: number
  tabUrl?: string
  tabTitle: string
  selectionText: string
}

export interface ComputeSearchTextResult {
  raw: string
  normalized: string
  [k: string]: unknown
}

export interface MenuRefreshDeps {
  /** 从 KeywordService 来的 computeSearchTextForTab */
  computeSearchTextForTab: (input: ComputeSearchTextInput) => Promise<ComputeSearchTextResult>
  /** setMenuState orchestrator deps（refreshMenuTitle 会调 applyMenuTitle = setMenuState） */
  setMenuStateDeps: MenuStateOrchestratorDeps
  /** 失败时的 warning 钩子（默认 console.warn） */
  onError?: (err: unknown) => void
}

/**
 * 等价 base.js refreshMenuTitle(tab, selectionText):
 * 1. computeSearchTextForTab(tab + selectionText) → {raw, normalized}
 * 2. applyMenuTitle(normalized, raw, {tabId, url}) ≡ fire-and-forget setMenuState
 */
export async function refreshMenuTitle(
  tab: ChromeTabLite | null | undefined,
  selectionText: string,
  deps: MenuRefreshDeps
): Promise<void> {
  try {
    const result = await deps.computeSearchTextForTab({
      tabId: tab?.id,
      tabUrl: tab?.url,
      tabTitle: tab?.title || "",
      selectionText
    })
    const meta: MenuStateMeta = {
      tabId: tab?.id ?? null,
      url: tab?.url || ""
    }
    void setMenuState(result.raw, result.normalized, meta, deps.setMenuStateDeps)
  } catch (error) {
    if (deps.onError) {
      deps.onError(error)
    } else {
      console.warn("[触触搜][BG] refreshMenuTitle失败:", error)
    }
  }
}

export interface RefreshContextMenuDeps {
  contextMenus?: { refresh?: () => void }
  logMenuEvent: (stage: string, payload: Record<string, unknown>) => void
}

function getDefaultChrome(): {
  contextMenus?: { refresh?: () => void }
  tabs?: ChromeTabsSendMessageLite
  scripting?: ChromeScriptingLite
} {
  const ch = (globalThis as unknown as {
    chrome?: {
      contextMenus?: { refresh?: () => void }
      tabs?: ChromeTabsSendMessageLite
      scripting?: ChromeScriptingLite
    }
  }).chrome
  return ch ?? {}
}

/**
 * 等价 base.js refreshContextMenu(): chrome.contextMenus.refresh + log.
 */
export async function refreshContextMenu(deps: RefreshContextMenuDeps): Promise<void> {
  const cm = deps.contextMenus || getDefaultChrome().contextMenus
  if (cm?.refresh) {
    cm.refresh()
    deps.logMenuEvent("context-menu-refreshed", { timestamp: Date.now() })
  }
}

export interface CopyTextInTabDeps {
  tabs?: ChromeTabsSendMessageLite
  scripting?: ChromeScriptingLite
  /** debug 钩子，默认 console.debug 风格 */
  onDebug?: (msg: string, err: unknown) => void
}

/**
 * 等价 base.js copyTextInTab(tab, text):
 * 1. 先 chrome.tabs.sendMessage(tabId, {action: 'copyText', text}) 走 content script
 * 2. 失败则 chrome.scripting.executeScript 注入 navigator.clipboard / fallback
 *
 * 这个 fallback 函数（运行在 content world）必须自包含 —— 与 legacy 完全一致。
 */
export async function copyTextInTab(
  tab: ChromeTabLite | null | undefined,
  text: string,
  deps: CopyTextInTabDeps = {}
): Promise<boolean> {
  if (!tab || !text || tab.id == null) return false
  const tabId = tab.id
  const tabs = deps.tabs || getDefaultChrome().tabs
  const scripting = deps.scripting || getDefaultChrome().scripting

  if (tabs?.sendMessage) {
    try {
      await tabs.sendMessage(tabId, { action: "copyText", text })
      return true
    } catch (err) {
      deps.onDebug?.("[触触搜][BG][COPY] sendMessage 失败，尝试注入脚本", err)
    }
  }

  if (scripting?.executeScript) {
    try {
      await scripting.executeScript({
        target: { tabId },
        func: (value: unknown) => {
          const v = String(value ?? "")
          const fallbackCopy = () => {
            const textarea = document.createElement("textarea")
            textarea.value = v
            textarea.setAttribute("readonly", "")
            textarea.style.position = "fixed"
            textarea.style.top = "-10000px"
            document.body.appendChild(textarea)
            textarea.select()
            document.execCommand("copy")
            textarea.remove()
          }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(v).catch(fallbackCopy)
          } else {
            fallbackCopy()
          }
        },
        args: [text]
      })
      return true
    } catch (err) {
      console.warn("[触触搜][BG][COPY] 注入复制脚本失败", err)
    }
  }
  return false
}

export default { refreshMenuTitle, refreshContextMenu, copyTextInTab }
