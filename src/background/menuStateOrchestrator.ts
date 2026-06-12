/**
 * 菜单状态 orchestrator (TypeScript port)
 *
 * 抽自 background/base.js 行 448-620 的 setMenuState (170 行) + applyMenuTitle (3 行)。
 *
 * 这是 base.js 的"心脏"：把 formatMenuTitle / tabState / menuTitleUpdater /
 * KeywordSyncManager / chrome.contextMenus.refresh / chrome.runtime.sendMessage
 * 全部串起来，每次选区/标题变化都会触发一次。
 *
 * **去屎山**：legacy 用 6 个 globalThis 隐式依赖（currentMenuState / formatMenuTitle /
 * keywordSyncManager / updateMainMenuTitle / updateSearchLabelTitle /
 * updateSubmenuLabels）。本 port 全部通过 deps 注入，纯函数式可测试。
 *
 * 与 legacy 共存策略：deps.currentMenuState 可传 globalThis.currentMenuState 复用
 * 同一份状态，TS class 与 legacy 函数读写同一对象，无 split-brain。
 */
import {
  updateSearchMenuTitles,
  updateMainMenuTitle,
  updateSearchLabelTitle,
  updateSubmenuLabels,
  type MenuTitleUpdaterDeps
} from "./menuTitleUpdater"

export interface MenuStateLike {
  raw: string
  normalized: string
  display: string
  tabId: number | null
  url: string
}

export interface MenuStateMeta {
  tabId?: number | null
  url?: string
}

export interface KeywordSyncManagerLike {
  update: (raw: string, normalized: string, meta: MenuStateMeta | undefined) => Promise<unknown>
  syncMenus: () => Promise<unknown>
}

export interface ChromeTabsLite {
  query: (q: { active?: boolean; currentWindow?: boolean }) => Promise<{ id?: number }[]>
}

export interface ChromeContextMenusRefreshLite {
  refresh?: () => void
}

export interface ChromeRuntimeSendMsgLite {
  sendMessage: (msg: unknown) => Promise<unknown>
}

export interface MenuStateOrchestratorDeps extends MenuTitleUpdaterDeps {
  /** 全局当前菜单状态对象 —— 与 legacy globalThis.currentMenuState 共享 */
  currentMenuState: MenuStateLike
  /** 文本截断格式化函数（来自 utils/TextUtils.ts） */
  formatMenuTitle: (s: string) => string
  /** chrome.tabs（用于 active tab 校验） */
  tabs?: ChromeTabsLite
  /** chrome.contextMenus（用于 refresh，与 menuTitleUpdater 共享） */
  contextMenusRefresh?: ChromeContextMenusRefreshLite
  /** chrome.runtime.sendMessage（用于广播 keywordUpdated） */
  runtimeSendMessage?: ChromeRuntimeSendMsgLite
  /** TabStateCache.updateKeyword (来自 tabState.ts) */
  updateLatestTabKeyword?: (tabId: number, keyword: string, normalized: string) => void
  /** KeywordSyncManager 实例（如已初始化） */
  keywordSyncManager?: KeywordSyncManagerLike | null
  /** logMenuEvent hook（来自 Logger.ts） */
  logMenuEvent: (stage: string, payload: Record<string, unknown>) => void
  /** chrome.contextMenus.refresh 延迟（ms），默认 50 */
  refreshDelayMs?: number
  /** setTimeout 注入（测试用） */
  setTimeoutFn?: (cb: () => void, ms: number) => void
}

function getDefaultChrome(): {
  tabs?: ChromeTabsLite
  contextMenus?: ChromeContextMenusRefreshLite
  runtime?: ChromeRuntimeSendMsgLite
} {
  const ch = (globalThis as unknown as {
    chrome?: {
      tabs?: ChromeTabsLite
      contextMenus?: ChromeContextMenusRefreshLite
      runtime?: ChromeRuntimeSendMsgLite
    }
  }).chrome
  return ch ?? {}
}

/**
 * 设置当前菜单状态。等价于 base.js 的 setMenuState(rawText, normalizedText, meta)。
 *
 * 完整副作用清单：
 * 1. 计算 display = formatMenuTitle(normalized || raw)
 * 2. 检测 tab ID 切换，记录 state-update-tab-change
 * 3. 用 chrome.tabs.query 校验 active tab，非活动 tab 直接 reject（fail-open）
 * 4. 写入 deps.currentMenuState.{raw,normalized,display,tabId,url}
 * 5. 调 updateLatestTabKeyword 更新 tab 关键字缓存
 * 6. 触发 keywordSyncManager.update + syncMenus
 * 7. 并行调 updateMainMenuTitle / updateSearchLabelTitle / updateSubmenuLabels
 * 8. 同步调 updateSearchMenuTitles
 * 9. setTimeout(chrome.contextMenus.refresh, 50)
 * 10. chrome.runtime.sendMessage({action: 'keywordUpdated', ...})
 */
export async function setMenuState(
  rawText: string | null | undefined,
  normalizedText: string | null | undefined,
  meta: MenuStateMeta | null | undefined,
  deps: MenuStateOrchestratorDeps
): Promise<void> {
  const raw = typeof rawText === "string" ? rawText : ""
  const normalized = typeof normalizedText === "string" ? normalizedText : ""
  const base = normalized || raw
  const displayText = base ? deps.formatMenuTitle(base) : ""

  // BUGFIX: Log tab ID transitions to detect cross-tab contamination
  const previousTabId = deps.currentMenuState.tabId
  const newTabId =
    meta && typeof meta === "object" && "tabId" in meta
      ? typeof meta.tabId === "number"
        ? meta.tabId
        : null
      : previousTabId

  if (previousTabId != null && newTabId != null && previousTabId !== newTabId) {
    deps.logMenuEvent("state-update-tab-change", {
      previousTabId,
      newTabId,
      previousUrl: deps.currentMenuState.url,
      newUrl: meta?.url || deps.currentMenuState.url,
      raw,
      normalized
    })
  }

  // BUGFIX: Warn if setting state without explicit tab ID
  if (raw && !newTabId) {
    deps.logMenuEvent("state-update-missing-tabid", {
      raw,
      normalized,
      url: meta?.url || deps.currentMenuState.url
    })
  }

  // BUGFIX: Validate that the requested tabId is the currently active tab
  // FAIL-OPEN MODE: Only reject if CERTAIN the message is from inactive tab
  if (newTabId != null && raw) {
    const tabs = deps.tabs || getDefaultChrome().tabs
    if (tabs?.query) {
      try {
        const activeTabs = await tabs.query({ active: true, currentWindow: true })
        const activeTabId = activeTabs?.[0]?.id ?? null

        if (activeTabId != null && newTabId !== activeTabId) {
          deps.logMenuEvent("state-update-rejected-inactive-tab", {
            requestedTabId: newTabId,
            activeTabId,
            raw: raw?.substring(0, 50),
            normalized: normalized?.substring(0, 50)
          })
          return
        }

        if (activeTabId == null) {
          deps.logMenuEvent("state-update-validation-null-active", {
            newTabId,
            raw: raw?.substring(0, 50),
            reason: "chrome.tabs.query returned no active tab, allowing through (fail-open)"
          })
        }
      } catch (error) {
        deps.logMenuEvent("state-update-validation-error", {
          error: (error as Error)?.message,
          tabId: newTabId
        })
      }
    }
  }

  // 标题单调性守卫（2026-06 L6 取证）：新开标签时 onActivated/loading/title/
  // complete 多个异步写入者并发，实测出现"+46ms 写入正确标题 → +54ms 被空结果
  // 写入者抹成光板 → 落地顺序决定成败"的竞态 —— 用户机器上空写入者最后落地，
  // 菜单标题保持无关键字直到切 Tab。规则：**同 tab、URL 未变时，空关键字
  // 不得覆盖已有的非空标题**。合法清空场景不受影响：导航换页 URL 必变、
  // 切 tab tabId 必变、清选区路径写的是非空的页面关键词。
  const wipeSameTab = newTabId != null && previousTabId === newTabId
  const wipeSameUrl = !meta?.url || meta.url === deps.currentMenuState.url
  if (!raw && wipeSameTab && wipeSameUrl && deps.currentMenuState.raw) {
    deps.logMenuEvent("menu-title-wipe-suppressed", {
      tabId: newTabId,
      url: meta?.url || "",
      keptRaw: (deps.currentMenuState.raw || "").slice(0, 50)
    })
    return
  }

  deps.currentMenuState.raw = raw
  deps.currentMenuState.normalized = normalized
  deps.currentMenuState.display = displayText
  if (meta && typeof meta === "object") {
    if ("tabId" in meta) {
      deps.currentMenuState.tabId = typeof meta.tabId === "number" ? meta.tabId : null
    }
    if ("url" in meta) {
      deps.currentMenuState.url = typeof meta.url === "string" ? meta.url : ""
    }
  }

  const targetTabId = typeof meta?.tabId === "number" ? meta.tabId : null
  if (targetTabId != null) {
    const keywordCandidate = raw || normalized
    if (keywordCandidate && deps.updateLatestTabKeyword) {
      deps.updateLatestTabKeyword(targetTabId, keywordCandidate, normalized || keywordCandidate)
    }
  }
  deps.logMenuEvent("state-update", { ...deps.currentMenuState })

  // 新架构：使用 KeywordSyncManager 统一同步所有菜单（尝试更新，不强制依赖）
  if (deps.keywordSyncManager) {
    try {
      await deps.keywordSyncManager.update(raw, normalized, meta || undefined)
      const syncResult = await deps.keywordSyncManager.syncMenus()

      deps.logMenuEvent("keyword-sync-via-new-system", {
        raw,
        normalized,
        displayText,
        tabId: newTabId,
        syncResult
      })
    } catch (error) {
      console.error("[触触搜] 新同步系统更新失败:", error)
      deps.logMenuEvent("keyword-sync-error", {
        error: (error as Error)?.message,
        stack: (error as Error)?.stack
      })
    }
  }

  // BUGFIX: 强制使用旧系统更新所有菜单，确保优化提示词菜单总是被正确更新
  // TIMING FIX: Wait for all menu updates to complete before returning
  await Promise.all([
    updateMainMenuTitle(displayText, deps),
    updateSearchLabelTitle(displayText, deps),
    updateSubmenuLabels(displayText, deps)
  ])
  updateSearchMenuTitles(displayText, deps)

  deps.logMenuEvent("keyword-sync-old-system-forced", {
    display: displayText,
    raw,
    normalized
  })

  // BUGFIX: Add small delay before refreshing to ensure Chrome updates its internal menu cache
  const refreshDelay = deps.refreshDelayMs ?? 50
  const contextMenusRefresh = deps.contextMenusRefresh || getDefaultChrome().contextMenus
  if (contextMenusRefresh?.refresh) {
    const refreshFn = contextMenusRefresh.refresh
    const sched = deps.setTimeoutFn || ((cb: () => void, ms: number) => { setTimeout(cb, ms) })
    sched(() => {
      refreshFn()
      deps.logMenuEvent("context-menu-refreshed-delayed", {
        timestamp: Date.now(),
        delayMs: refreshDelay
      })
    }, refreshDelay)
  }

  // Broadcast keyword change to extension pages (sidepanel)
  const runtimeSendMessage = deps.runtimeSendMessage || getDefaultChrome().runtime
  if (runtimeSendMessage?.sendMessage) {
    runtimeSendMessage
      .sendMessage({
        action: "keywordUpdated",
        keyword: { text: normalized || raw, raw }
      })
      .catch(() => { /* swallow */ })
  }
}

/**
 * applyMenuTitle 同步 wrapper —— 与 base.js 行 618-620 等价：fire-and-forget setMenuState。
 */
export function applyMenuTitle(
  normalizedText: string,
  rawText: string,
  meta: MenuStateMeta | undefined,
  deps: MenuStateOrchestratorDeps
): void {
  void setMenuState(rawText || "", normalizedText, meta, deps)
}

export default { setMenuState, applyMenuTitle }
