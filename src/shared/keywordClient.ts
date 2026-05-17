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
}

export const KEYWORD_STORAGE_PREFIX = "ccs_kw_"
export const KEYWORD_STORAGE_TTL_MS = 5 * 60 * 1000

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

  return new Promise((resolve) => {
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
          freshResolved = true
          if (chrome.runtime.lastError) {
            resolve({ text: "", raw: "" })
            return
          }

          resolve({
            text: response?.text || "",
            raw: response?.raw || response?.text || ""
          })
        }
      )
    } catch (error) {
      freshResolved = true
      console.warn("[触触搜][KeywordClient] sendMessage 异常:", error)
      resolve({ text: "", raw: "" })
    }
  })
}
