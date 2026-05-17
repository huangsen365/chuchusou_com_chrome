/**
 * 搜索文本解析器 (TypeScript port)
 *
 * 与 background/keywordResolver.js 1:1 行为对等。
 * 所有 chrome.* + 全局状态依赖（selectedTextByTab / fallbackKeywordByTab / currentMenuState）通过 deps 注入。
 */

export interface ResolverInput {
  tabId?: number | null
  tabUrl?: string
  tabTitle?: string
  selectionText?: string
}

export interface ResolverOptions {
  forceFetchSelection?: boolean
  skipCurrentMenuFallback?: boolean
}

export interface ResolverResult {
  raw: string
  normalized: string
}

export interface SelectionStore {
  [tabId: number]: { text: string; url: string; timestamp?: number } | undefined
}

export interface FallbackStore {
  [tabId: number]: { raw: string; normalized: string; url: string; timestamp?: number } | undefined
}

export interface CurrentMenuStateShape {
  raw?: string
  url?: string
  tabId?: number | null
}

export interface KeywordResolverDeps {
  /** chrome.scripting.executeScript wrapper. Returns selection text from a tab. */
  fetchSelectionFromTab: (tabId: number) => Promise<string>
  /** 提取 URL 关键词 (e.g. baidu.com/?wd=xxx → xxx). 已 port 到 src/background/keywords.ts */
  extractSearchKeywords: (url: string, tab?: { url?: string; title?: string } | null) => Promise<string | null>
  /** 规范化（trim + 合并空白）。已在 utils/TextUtils.ts */
  normalizeSearchText: (s: string) => string
  /** 清理标题（移除站点后缀）。已在 utils/TextUtils.ts */
  cleanupTitleKeyword: (s: string) => string
  /** 检查是否需要保留菜单状态。已在 utils/TextUtils.ts */
  shouldPreserveMenuStateForUrl: (url: string) => boolean
  /** 全局可变状态 */
  selectedTextByTab: SelectionStore
  fallbackKeywordByTab: FallbackStore
  currentMenuState: CurrentMenuStateShape
  /** 调试日志 */
  log?: (stage: string, payload: Record<string, unknown>) => void
}

function logResolver(deps: KeywordResolverDeps, stage: string, payload: Record<string, unknown>): void {
  if (deps.log) {
    try { deps.log(`resolver-${stage}`, payload) } catch (_) { /* noop */ }
  }
}

function isGenericQuickHostKeyword(hostname: string, keyword: string | null | undefined): boolean {
  if (!hostname || !keyword) return false
  const value = keyword.trim().toLowerCase()
  if (!value) return true
  if (hostname.includes("chatgpt.com")) {
    if (value === "chatgpt" || value === "chatgpt.com" || value.startsWith("chatgpt.com/")) return true
    if (value === "www.chatgpt.com") return true
  }
  if (hostname.includes("claude.ai")) {
    if (value === "claude" || value === "claude.ai" || value.startsWith("claude.ai/")) return true
    if (value === "www.claude.ai") return true
  }
  return false
}

function pickFirstMeaningfulText(candidates: string[]): { raw: string; trimmed: string } {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue
    const trimmed = candidate.trim()
    if (trimmed.length > 0) {
      return { raw: candidate, trimmed }
    }
  }
  return { raw: "", trimmed: "" }
}

export async function computeSearchTextForTab(
  input: ResolverInput,
  options: ResolverOptions = {},
  deps: KeywordResolverDeps
): Promise<ResolverResult> {
  const {
    tabId,
    tabUrl,
    tabTitle = "",
    selectionText = ""
  } = input
  const {
    forceFetchSelection = false,
    skipCurrentMenuFallback = false
  } = options || {}

  const candidates: string[] = []
  logResolver(deps, "start", {
    tabId, tabUrl, tabTitle,
    selectionProvided: typeof selectionText === "string" && selectionText.trim().length > 0
  })

  // 1. 用户提供的 selectionText（最高优先级）
  if (typeof selectionText === "string") {
    const trimmedSelection = selectionText.trim()
    if (trimmedSelection.length > 0) {
      candidates.push(selectionText)
      logResolver(deps, "candidate", { source: "selectionText", value: selectionText })
      if (tabId != null) {
        deps.selectedTextByTab[tabId] = { text: selectionText, url: tabUrl || "" }
      }
    }
  }

  // 2. 强制 fetch 选区
  if (forceFetchSelection && tabId != null) {
    const fetchedDirect = await deps.fetchSelectionFromTab(tabId)
    if (typeof fetchedDirect === "string" && fetchedDirect.trim().length > 0) {
      candidates.push(fetchedDirect)
      logResolver(deps, "candidate", { source: "scripting-precheck", value: fetchedDirect, tabId })
      deps.selectedTextByTab[tabId] = { text: fetchedDirect, url: tabUrl || "" }
    }
  }

  // 3. 缓存的选区
  if (tabId != null) {
    const stored = deps.selectedTextByTab[tabId]
    if (stored && typeof stored.text === "string" && stored.text.trim().length > 0) {
      const storedAge = stored.timestamp ? Date.now() - stored.timestamp : Infinity
      const isFresh = storedAge < 10000
      const urlMatches = typeof stored.url === "string" && stored.url === tabUrl

      if (urlMatches || isFresh) {
        candidates.push(stored.text)
        logResolver(deps, "candidate", {
          source: "stored-selection", value: stored.text,
          storedUrl: stored.url, tabUrl, urlMatches, isFresh, ageMs: storedAge
        })
      } else {
        logResolver(deps, "stored-selection-skipped", {
          reason: "stale-or-url-mismatch",
          storedUrl: stored.url, tabUrl, ageMs: storedAge
        })
      }
    }
  }

  // 4. URL 关键词提取
  if (tabUrl) {
    try {
      const extracted = await deps.extractSearchKeywords(tabUrl, { url: tabUrl, title: tabTitle })
      if (typeof extracted === "string" && extracted.trim().length > 0) {
        candidates.push(extracted)
        logResolver(deps, "candidate", {
          source: "url-extracted", value: extracted, tabUrl, tabTitle
        })
        if (tabId != null) {
          deps.fallbackKeywordByTab[tabId] = {
            raw: extracted,
            normalized: deps.normalizeSearchText(extracted),
            timestamp: Date.now(),
            url: tabUrl || ""
          }
        }
      }
    } catch (error) {
      console.warn("[触触搜][BG] extractSearchKeywords失败:", error)
    }
  }

  // 5. 若所有 candidate 都空 + 有 tabId → fetch tab 选区做兜底
  if (!candidates.length && tabId != null) {
    const fetched = await deps.fetchSelectionFromTab(tabId)
    if (typeof fetched === "string" && fetched.trim().length > 0) {
      candidates.push(fetched)
      logResolver(deps, "candidate", { source: "scripting-selection", value: fetched, tabId })
      deps.selectedTextByTab[tabId] = { text: fetched, url: tabUrl || "" }
    }
  }

  // 6. fallback cache（URL 强匹配）
  if (!candidates.length && tabId != null) {
    const stored = deps.fallbackKeywordByTab[tabId]
    if (stored && typeof stored.raw === "string" && stored.raw.trim().length > 0) {
      const urlMatches = typeof stored.url === "string" && stored.url === tabUrl
      if (urlMatches) {
        candidates.push(stored.raw)
        logResolver(deps, "candidate", {
          source: "tab-fallback-cache", value: stored.raw,
          storedUrl: stored.url, tabUrl,
          ageMs: stored.timestamp ? Date.now() - stored.timestamp : null
        })
      } else {
        logResolver(deps, "tab-fallback-cache-skipped", {
          reason: "url-mismatch", storedUrl: stored.url, tabUrl
        })
      }
    }
  }

  // 7. currentMenuState 兜底（防跨 tab 污染：URL + tabId 都匹配才用）
  if (!skipCurrentMenuFallback && !candidates.length && deps.currentMenuState) {
    const preservedRaw = deps.currentMenuState.raw
    const preservedUrl = deps.currentMenuState.url
    const preservedTabId = deps.currentMenuState.tabId
    if (preservedRaw && preservedRaw.trim().length > 0) {
      const preserveByUrl = tabUrl ? deps.shouldPreserveMenuStateForUrl(tabUrl) : false
      const sameUrl = typeof preservedUrl === "string" && !!preservedUrl && tabUrl === preservedUrl
      const sameTab = typeof preservedTabId === "number" && tabId != null && preservedTabId === tabId

      let targetHostname = ""
      try { targetHostname = tabUrl ? new URL(tabUrl).hostname : "" } catch (_) { /* noop */ }

      const allowPreserve = sameUrl && sameTab && preserveByUrl
      if (allowPreserve && !isGenericQuickHostKeyword(targetHostname, preservedRaw)) {
        candidates.push(preservedRaw)
        logResolver(deps, "candidate", {
          source: "current-menu-state", value: preservedRaw,
          tabUrl, preservedUrl, preservedTabId,
          reason: "url-and-tab-match"
        })
      }
    }
  }

  // 8. 选第一个有意义的
  const { raw, trimmed } = pickFirstMeaningfulText(candidates)
  const normalizedSource = trimmed || raw
  const result: ResolverResult = {
    raw,
    normalized: deps.normalizeSearchText(normalizedSource)
  }
  logResolver(deps, "result", {
    candidatesCount: candidates.length,
    raw: result.raw, normalized: result.normalized,
    tabId, tabUrl, tabTitle
  })
  return result
}

/**
 * 创建一个使用 chrome.scripting.executeScript 的 fetchSelectionFromTab 实现。
 * 生产 SW 直接传给 computeSearchTextForTab 的 deps。
 */
export function createChromeScriptingFetcher(): (tabId: number) => Promise<string> {
  return async (tabId: number) => {
    const ch = (globalThis as unknown as {
      chrome?: {
        scripting?: {
          executeScript: (opts: { target: { tabId: number }; func: () => string }) => Promise<Array<{ result?: string }>>
        }
      }
    }).chrome
    if (tabId == null || !ch?.scripting?.executeScript) {
      return ""
    }
    try {
      const results = await ch.scripting.executeScript({
        target: { tabId },
        func: () => {
          try {
            const selection = window.getSelection ? window.getSelection() : null
            if (selection && selection.rangeCount > 0) {
              const text = selection.toString()
              if (text && text.trim().length > 0) return text
            }
            const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
            if (active && typeof active.value === "string") {
              const { selectionStart, selectionEnd, value } = active
              if (typeof selectionStart === "number" && typeof selectionEnd === "number" &&
                  selectionStart !== selectionEnd && value) {
                const start = Math.min(selectionStart, selectionEnd)
                const end = Math.max(selectionStart, selectionEnd)
                const slice = value.slice(start, end)
                if (slice && slice.trim().length > 0) return slice
              }
            }
            return ""
          } catch (_) {
            return ""
          }
        }
      })
      if (Array.isArray(results) && results.length > 0) {
        const value = results[0]?.result
        return typeof value === "string" ? value : ""
      }
      return ""
    } catch (_) {
      return ""
    }
  }
}

export default { computeSearchTextForTab, createChromeScriptingFetcher }
