export const KEYWORD_INTENTS = {
  POPUP_OPEN: "popup-open",
  SIDEPANEL_INIT: "sidepanel-init",
  SIDEPANEL_REFRESH: "sidepanel-refresh"
} as const

export type KeywordIntent = (typeof KEYWORD_INTENTS)[keyof typeof KEYWORD_INTENTS]

export interface KeywordResult {
  text: string
  raw: string
}

export interface KeywordCacheEntry extends KeywordResult {
  ts?: number
  url?: string
}

export interface KeywordRequestOptions {
  tab?: chrome.tabs.Tab | null
  instantFromStorage?: boolean
  onInstant?: (cached: KeywordResult) => void
  /** 单次尝试超时；冷启动场景可放宽（如 3000ms）。与 shared/keywordClient.js 对齐 */
  timeoutMs?: number
  /** 超时 / SW 未就绪时的重试次数，默认 1（与 shared/keywordClient.js 一致） */
  retries?: number
}

export const KEYWORD_STORAGE_PREFIX = "ccs_kw_"
export const KEYWORD_STORAGE_TTL_MS = 5 * 60 * 1000
// 与 shared/keywordClient.js 的 REQUEST_TIMEOUT_MS 对齐（JS 版是生产主路径）
const KEYWORD_REQUEST_TIMEOUT_MS = 1500
const KEYWORD_RETRY_DELAY_MS = 120

function isReceivingEndError(message: string): boolean {
  return /Receiving end does not exist|Could not establish connection|message port closed|Extension context invalidated/i.test(message || "")
}

function queryTabs(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query(queryInfo, (tabs) => {
        resolve(tabs?.[0] || null)
      })
    } catch {
      resolve(null)
    }
  })
}

function getCurrentWindow(): Promise<chrome.windows.Window | null> {
  return new Promise((resolve) => {
    try {
      chrome.windows.getCurrent((windowInfo) => resolve(windowInfo || null))
    } catch {
      resolve(null)
    }
  })
}

export async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const fromCurrent = await queryTabs({ active: true, currentWindow: true })
  if (fromCurrent) return fromCurrent

  const currentWindow = await getCurrentWindow()
  if (currentWindow?.id != null) {
    const fromWindow = await queryTabs({ active: true, windowId: currentWindow.id })
    if (fromWindow) return fromWindow
  }

  return queryTabs({ active: true, lastFocusedWindow: true })
}

export async function readInstantCache(
  tabId: number | undefined,
  currentUrl?: string
): Promise<KeywordResult | null> {
  if (tabId == null || !chrome?.storage?.local) return null

  return new Promise((resolve) => {
    const key = `${KEYWORD_STORAGE_PREFIX}${tabId}`
    try {
      chrome.storage.local.get([key], (data) => {
        if (chrome.runtime.lastError) {
          resolve(null)
          return
        }

        const entry = data?.[key] as KeywordCacheEntry | undefined
        if (!entry || typeof entry !== "object") {
          resolve(null)
          return
        }

        if (Date.now() - (entry.ts || 0) > KEYWORD_STORAGE_TTL_MS) {
          resolve(null)
          return
        }

        if (currentUrl && entry.url && entry.url !== currentUrl) {
          resolve(null)
          return
        }

        resolve({ text: entry.text || "", raw: entry.raw || entry.text || "" })
      })
    } catch {
      resolve(null)
    }
  })
}

export async function requestKeyword(
  intent: KeywordIntent,
  options: KeywordRequestOptions = {}
): Promise<KeywordResult> {
  const { tab = null, instantFromStorage = false, onInstant = null } = options
  const activeTab = tab || (await getActiveTab())
  if (!activeTab) return { text: "", raw: "" }

  let freshResolved = false
  let onInstantCalled = false

  if (instantFromStorage && typeof onInstant === "function") {
    readInstantCache(activeTab.id, activeTab.url).then((cached) => {
      if (!freshResolved && !onInstantCalled && cached?.text) {
        onInstantCalled = true
        try {
          onInstant(cached)
        } catch (error) {
          console.warn("[触触搜][KeywordClient] onInstant 回调异常:", error)
        }
      }
    })
  }

  const timeoutMs = options.timeoutMs || KEYWORD_REQUEST_TIMEOUT_MS
  const maxRetries = options.retries ?? 1

  return new Promise((resolve) => {
    let settled = false
    const finalize = (payload: KeywordResult): void => {
      if (settled) return
      settled = true
      resolve(payload)
    }

    // 与 shared/runtimeClient.js 同语义：仅对"超时 / SW 未就绪"重试（间隔 120ms），
    // 其它 lastError / 异常直接以空结果收尾。
    const attempt = (remainingRetries: number): void => {
      if (settled) return
      let attemptDone = false
      const timeoutId = setTimeout(() => {
        if (settled || attemptDone) return
        attemptDone = true
        if (remainingRetries > 0) {
          setTimeout(() => attempt(remainingRetries - 1), KEYWORD_RETRY_DELAY_MS)
        } else {
          console.warn("[触触搜][KeywordClient] getKeyword timeout:", { intent, tabId: activeTab.id, timeoutMs })
          finalize({ text: "", raw: "" })
        }
      }, timeoutMs)

      try {
        chrome.runtime.sendMessage(
          {
            action: "getKeyword",
            tabId: activeTab.id,
            url: activeTab.url,
            title: activeTab.title,
            intent
          },
          (response?: Partial<KeywordResult>) => {
            const lastError = chrome.runtime.lastError?.message || ""
            if (settled || attemptDone) return
            attemptDone = true
            clearTimeout(timeoutId)
            if (lastError) {
              if (isReceivingEndError(lastError) && remainingRetries > 0) {
                // 重试期间不置 freshResolved —— 允许 instant 缓存先渲染（与 JS 版一致）
                setTimeout(() => attempt(remainingRetries - 1), KEYWORD_RETRY_DELAY_MS)
              } else {
                freshResolved = true
                finalize({ text: "", raw: "" })
              }
              return
            }

            freshResolved = true
            finalize({
              text: response?.text || "",
              raw: response?.raw || response?.text || ""
            })
          }
        )
      } catch (error) {
        if (settled || attemptDone) return
        attemptDone = true
        clearTimeout(timeoutId)
        freshResolved = true
        console.warn("[触触搜][KeywordClient] sendMessage 异常:", error)
        finalize({ text: "", raw: "" })
      }
    }

    attempt(maxRetries)
  })
}
