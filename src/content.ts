/**
 * 触触搜 - 主内容脚本 (TypeScript port, Plasmo content script entry)
 *
 * 与 content.js + modules/*.js 1:1 行为对等。chrome.* 通过 globalThis 防御性访问。
 *
 * 生产仍跑 legacy content.js + modules/* legacy 脚本（manifest content_scripts 未切）。
 * 本 entry 等 manifest 切换时接管：单 Plasmo bundle 替换 legacy 内容脚本集合。
 *
 * 通过 import 把已 port 的 src/content-modules/*.ts 单例拉起来（构造时已挂上事件），
 * 然后挂到 window.CCSModules 命名空间，与 legacy 脚本对外 API 保持一致。
 */

import { BackgroundComm } from "./content-modules/backgroundComm"
import { Blacklist } from "./content-modules/blacklist"
import { ButtonDefinitions } from "./content-modules/buttonDefinitions"
import { Buttons } from "./content-modules/buttons"
import { Commands } from "./content-modules/commands"
import { ContentState as ContentStateModule } from "./content-modules/stateManager"
import { DOMMonitor } from "./content-modules/domMonitor"
import { Dragging } from "./content-modules/dragging"
import { KeywordExtractor } from "./content-modules/keywordExtractor"
import { Positioning } from "./content-modules/positioning"
import { RealtimeUpdate } from "./content-modules/realtimeUpdate"
import { RecoveryPopover } from "./content-modules/recoveryPopover"
import { Search } from "./content-modules/search"
import { SelectionModule } from "./content-modules/selection"
import { Settings } from "./content-modules/settings"
import { SettingsPanel } from "./content-modules/settingsPanel"
import { Shortcuts } from "./content-modules/shortcuts"
import { TextSync } from "./content-modules/textSync"
import { Toast as ContentToast } from "./content-modules/toast"
import { Utils } from "./content-modules/utils"
import { SiteFastQaRuntime } from "./content-modules/siteFastQaRuntime"
import { startXTweetFastQaIntegration, XTweetFastQa } from "./content-modules/xTweetFastQa"
import { startZhihuFastQaIntegration, ZhihuFastQa } from "./content-modules/zhihuFastQa"
import { ArticleRewriteRuntime } from "./content-modules/articleRewriteRuntime"
import { ChatGptDom } from "./content-modules/chatGptDom"
import { GoogleDocsRewrite, startGoogleDocsRewriteIntegration } from "./content-modules/googleDocsRewrite"
import { ChatGptSelectARewrite, startChatGptSelectARewriteIntegration } from "./content-modules/chatGptSelectARewrite"
import { LongArticleActions } from "./content-modules/longArticleActions"
import { XArticleDraftDelivery } from "./content-modules/xArticleDraftDelivery"

// 把 TS 模块单例都挂到 window.CCSModules，让 legacy 调用点（如 backgroundComm 访问 Toast）
// 不论谁先加载都能找到对方
const _ccsModulesHost = window as unknown as { CCSModules?: Record<string, unknown> }
_ccsModulesHost.CCSModules = _ccsModulesHost.CCSModules || {}
Object.assign(_ccsModulesHost.CCSModules, {
  BackgroundComm,
  Blacklist,
  ButtonDefinitions,
  Buttons,
  Commands,
  ContentState: ContentStateModule,
  DOMMonitor,
  Dragging,
  KeywordExtractor,
  Positioning,
  RealtimeUpdate,
  RecoveryPopover,
  Search,
  SelectionModule,
  Settings,
  SettingsPanel,
  Shortcuts,
  TextSync,
  Toast: ContentToast,
  Utils,
  SiteFastQaRuntime,
  XTweetFastQa,
  ZhihuFastQa,
  ArticleRewriteRuntime,
  ChatGptDom,
  GoogleDocsRewrite,
  ChatGptSelectARewrite,
  LongArticleActions,
  XArticleDraftDelivery
})

const EXTENSION_NAME = "触触搜"
const SELECTION_SYNC_DELAY = 35

interface ContentState {
  debug: boolean
  selection: string
  debounceTimer: ReturnType<typeof setTimeout> | null
  isUserSelecting: boolean
}

interface ChromeLite {
  storage?: {
    local?: {
      get?: (keys: string[], cb: (res: Record<string, unknown>) => void) => void
      set?: (items: Record<string, unknown>) => void
    }
  }
  runtime?: {
    id?: string
    lastError?: { message?: string }
    sendMessage?: (msg: unknown, cb?: (response: any) => void) => void
    onMessage?: {
      addListener: (
        listener: (req: ContentRequest, sender: unknown, sendResponse?: (resp?: unknown) => void) => boolean | void
      ) => void
    }
  }
}

interface ContentRequest {
  action: string
  text?: string
  command?: string
  enabled?: boolean
  message?: string
  preferEmpty?: boolean
  recovery?: UrlRecoverySummary
}

interface CCSModulesShape {
  Toast?: {
    showContextMenuToast: (msg: string) => void
    error: (msg: string) => void
  }
}

interface WindowExtras {
  selectedText?: string
  lastNonEmptySelection?: string
  shadowRoot?: ShadowRoot | null
  CCS_DEBUG?: boolean
  CCSModules?: CCSModulesShape
  createPopover?: () => void
  forceShowPopover?: () => void
  hidePopover?: () => void
  ensureBottomBarVisible?: () => void
  scheduleRealtimeUpdate?: () => void
  __initDockBar?: () => void
  safeChromeSendMessage?: (msg: unknown) => void
}

function getChrome(): ChromeLite | undefined {
  return (globalThis as unknown as { chrome?: ChromeLite }).chrome
}

function getWin(): Window & WindowExtras {
  return window as Window & WindowExtras
}

function waitForDOMReady(): Promise<void> {
  return new Promise((resolve) => {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => resolve(), { once: true })
    } else {
      resolve()
    }
  })
}

const state: ContentState = {
  debug: false,
  selection: "",
  debounceTimer: null,
  isUserSelecting: false
}

const win = getWin()
win.selectedText = ""
win.lastNonEmptySelection = ""
win.shadowRoot = null

const noop = (): void => {}
win.createPopover = noop
win.forceShowPopover = noop
win.hidePopover = noop
win.ensureBottomBarVisible = noop
win.scheduleRealtimeUpdate = noop
win.__initDockBar = (): void => {
  showInfoToast("触触搜面板功能已暂时关闭，可查看 legacy/content.panel-legacy.js 以恢复旧版本逻辑。")
}

const ch = getChrome()
startXTweetFastQaIntegration()
startZhihuFastQaIntegration()
startGoogleDocsRewriteIntegration()
startChatGptSelectARewriteIntegration()
ch?.storage?.local?.get?.(["ccs_debug"], (res) => {
  updateDebug(!!(res as { ccs_debug?: unknown })?.ccs_debug)
})

function updateDebug(enabled: boolean): void {
  state.debug = !!enabled
  win.CCS_DEBUG = state.debug
}

function log(...args: unknown[]): void {
  if (state.debug) {
    console.log(`[${EXTENSION_NAME}]`, ...args)
  }
}

function readCurrentSelection(): string {
  try {
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      const raw = selection.toString()
      if (raw && raw.trim().length > 0) return raw
    }
    const fallback = readSelectionFromActiveElement()
    if (fallback) return fallback
    return ""
  } catch (err) {
    log("读取选中文本失败:", err)
    return ""
  }
}

function readSelectionFromActiveElement(): string {
  return extractSelectionFromElement(document.activeElement)
}

function extractSelectionFromElement(element: Element | null): string {
  if (!element) return ""
  try {
    const inputEl = element as HTMLInputElement
    if (typeof inputEl.value === "string") {
      const { selectionStart, selectionEnd } = inputEl
      if (
        typeof selectionStart === "number" &&
        typeof selectionEnd === "number" &&
        selectionStart !== selectionEnd
      ) {
        const value = inputEl.value
        if (value) {
          const start = Math.min(selectionStart, selectionEnd)
          const end = Math.max(selectionStart, selectionEnd)
          const result = value.slice(start, end)
          if (result && result.trim().length > 0) return result
        }
      }
    }

    const sr = (element as Element & { shadowRoot?: ShadowRoot }).shadowRoot
    if (sr) {
      const shadowActive = sr.activeElement
      if (shadowActive && shadowActive !== element) {
        const shadowText = extractSelectionFromElement(shadowActive)
        if (shadowText) return shadowText
      }
      const shadowSelection = (sr as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.()
      if (shadowSelection && shadowSelection.rangeCount > 0) {
        const raw = shadowSelection.toString()
        if (raw && raw.trim().length > 0) return raw
      }
    }

    const editableEl = element as HTMLElement
    if (editableEl.isContentEditable) {
      const editableSelection = window.getSelection()
      if (editableSelection && editableSelection.rangeCount > 0) {
        const raw = editableSelection.toString()
        if (raw && raw.trim().length > 0) return raw
      }
    }
  } catch (err) {
    log("从元素提取选区失败:", err)
  }

  return ""
}

function applySelection(text: string, trigger: string = "unknown"): void {
  const raw = typeof text === "string" ? text : ""
  const trimmed = raw.trim()
  const hasContent = trimmed.length > 0
  const value = hasContent ? trimmed : ""
  win.selectedText = value
  if (hasContent) win.lastNonEmptySelection = value

  if (state.selection === value) return

  state.selection = value
  log("同步选中文本", { trigger, text: value })
  safeChromeSendMessage({ action: "selectionChanged", text: value })
}

function updateSelection(trigger: string, { immediate = false }: { immediate?: boolean } = {}): void {
  if (immediate) {
    const immediateSelection = readCurrentSelection()
    applySelection(immediateSelection, trigger)
    if (!immediateSelection || !immediateSelection.trim()) {
      setTimeout(() => {
        const retrySelection = readCurrentSelection()
        if (retrySelection && retrySelection.trim()) {
          applySelection(retrySelection, `${trigger}-retry`)
        }
      }, SELECTION_SYNC_DELAY)
    }
    return
  }

  if (state.debounceTimer) clearTimeout(state.debounceTimer)
  state.debounceTimer = setTimeout(() => {
    applySelection(readCurrentSelection(), trigger)
  }, SELECTION_SYNC_DELAY)
}

function handleContextMenu(): void {
  updateSelection("contextmenu", { immediate: true })
  state.isUserSelecting = false
}

document.addEventListener("selectionchange", () => {
  if (!state.isUserSelecting) return
  updateSelection("selectionchange")
})
document.addEventListener(
  "mousedown",
  () => {
    state.isUserSelecting = true
  },
  true
)
document.addEventListener("mouseup", () => {
  updateSelection("mouseup")
  state.isUserSelecting = false
})
document.addEventListener("keydown", (event) => {
  if (event.key === "Shift" || event.shiftKey) state.isUserSelecting = true
  if ((event.ctrlKey || event.metaKey) && event.key === "a") state.isUserSelecting = true
})
document.addEventListener("keyup", (event) => {
  const currentSel = readCurrentSelection()
  const shouldUpdate =
    currentSel || event.key === "Escape" || event.key === "Enter" || event.key === "Shift" || state.isUserSelecting
  if (shouldUpdate) updateSelection("keyup")
  if (!event.shiftKey || event.key === "Shift") state.isUserSelecting = false
})
document.addEventListener("contextmenu", handleContextMenu, true)
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) updateSelection("visibility", { immediate: true })
})

void (async () => {
  await waitForDOMReady()
  updateSelection("init", { immediate: true })
})()

initUrlRecoveryOverlay()

ch?.runtime?.onMessage?.addListener((request, _sender, sendResponse) => {
  switch (request.action) {
    case "updateDebug":
      updateDebug(!!request.enabled)
      ch?.storage?.local?.set?.({ ccs_debug: state.debug })
      sendResponse?.({ ok: true })
      return true
    case "copyText": {
      const candidate = pickPreferredText(request.text)
      if (!candidate) {
        showErrorToast("没有可复制的内容")
        return
      }
      copyToClipboard(candidate)
        .then(() => showInfoToast("已复制到剪贴板"))
        .catch(() => showErrorToast("复制失败，请稍后重试"))
      return
    }
    case "processCommand": {
      const text = pickPreferredText(request.text)
      if (!text) {
        showErrorToast("没有可处理的内容")
        return
      }
      const result = runCommand(request.command || "", text)
      if (result == null) {
        showErrorToast("暂不支持此操作")
        return
      }
      copyToClipboard(result)
        .then(() => showInfoToast(`处理完成并已复制: ${truncateForToast(result)}`))
        .catch(() => showErrorToast("结果复制失败"))
      return
    }
    case "showPopover":
      showInfoToast("底部面板功能已暂停，若需恢复请查看 legacy 目录。")
      return
    case "showToast":
      showInfoToast(request.message || "")
      return
    case "ccsShowUrlRecovery":
      showUrlRecoveryOverlay(request.recovery || {})
      sendResponse?.({ ok: true })
      return true
    case "fetchSelectionSnapshot": {
      const preferEmpty = !!request.preferEmpty
      const live = readCurrentSelection()
      let chosen = typeof live === "string" ? live : ""
      let source = "live"

      if (!chosen || !chosen.trim()) {
        if (preferEmpty) {
          chosen = ""
          source = "empty"
        } else if (state.selection && state.selection.trim().length > 0) {
          chosen = state.selection
          source = "state"
        } else if (win.lastNonEmptySelection && win.lastNonEmptySelection.trim().length > 0) {
          chosen = win.lastNonEmptySelection
          source = "memory"
        } else {
          chosen = ""
          source = "empty"
        }
      } else if (state.selection !== chosen) {
        state.selection = chosen
      }

      if (chosen && chosen.trim()) {
        win.selectedText = chosen
        win.lastNonEmptySelection = chosen
      }

      try {
        sendResponse?.({
          text: chosen,
          source,
          url: window.location.href,
          title: document.title || ""
        })
      } catch (err) {
        log("返回选区快照失败", err)
      }
      return true
    }
    default:
      return
  }
})

function copyToClipboard(text: string): Promise<void> {
  if (!text) return Promise.resolve()
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)

  return new Promise((resolve, reject) => {
    try {
      const textarea = document.createElement("textarea")
      textarea.value = text
      textarea.setAttribute("readonly", "")
      textarea.style.position = "absolute"
      textarea.style.left = "-9999px"
      document.body.appendChild(textarea)
      textarea.select()
      const succeeded = document.execCommand("copy")
      document.body.removeChild(textarea)
      succeeded ? resolve() : reject(new Error("execCommand failed"))
    } catch (err) {
      reject(err)
    }
  })
}

function runCommand(command: string, text: string): string | null {
  switch (command) {
    case "base64":
      return encodeBase64(text)
    case "md5":
      return pseudoMd5(text)
    case "url-encode":
      return encodeURIComponent(text)
    case "upper":
      return text.toUpperCase()
    case "lower":
      return text.toLowerCase()
    default:
      return null
  }
}

function encodeBase64(text: string): string | null {
  try {
    return btoa(unescape(encodeURIComponent(text)))
  } catch (_err) {
    showErrorToast("Base64 编码失败")
    return null
  }
}

function pseudoMd5(text: string): string {
  if (!text) return "00000000000000000000000000000000"
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i)
    hash = ((hash << 5) - hash) + charCode
    hash |= 0
  }
  const normalized = Math.abs(hash).toString(16)
  return normalized.padStart(32, "0").slice(0, 32)
}

function truncateForToast(text: string, max: number = 50): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}...`
}

function showInfoToast(message: string): void {
  if (!message) return
  if (win.CCSModules?.Toast) {
    win.CCSModules.Toast.showContextMenuToast(message)
    return
  }
  fallbackToast(message)
}

function showErrorToast(message: string): void {
  if (!message) return
  if (win.CCSModules?.Toast) {
    win.CCSModules.Toast.error(message)
    return
  }
  fallbackToast(message)
}

function fallbackToast(message: string): void {
  const toast = document.createElement("div")
  toast.textContent = message
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: rgba(0, 0, 0, 0.8);
    color: #fff;
    padding: 12px 16px;
    border-radius: 6px;
    font-size: 14px;
    z-index: 2147483647;
    opacity: 0;
    transition: opacity 0.2s ease;
  `
  document.body.appendChild(toast)
  requestAnimationFrame(() => {
    toast.style.opacity = "1"
  })
  setTimeout(() => {
    toast.style.opacity = "0"
    setTimeout(() => toast.remove(), 200)
  }, 2000)
}

interface UrlRecoverySummary {
  id?: string
  statusCode?: number | null
  error?: string
  originalLength?: number
  originalPreview?: string
  finalUrlLength?: number
  truncated?: boolean
}

function initUrlRecoveryOverlay(): void {
  try {
    if (window.top !== window) return
  } catch (_) {
    return
  }
  waitForDOMReady()
    .then(() => sendRuntimeMessage<{ ok?: boolean; recovery?: UrlRecoverySummary }>({ action: "ccsGetUrlRecovery" }))
    .then((response) => {
      if (response?.ok && response.recovery) showUrlRecoveryOverlay(response.recovery)
    })
    .catch(() => {})
}

function showUrlRecoveryOverlay(recovery: UrlRecoverySummary): void {
  if (!recovery?.id || !document.body) return
  document.getElementById("ccs-url-recovery")?.remove()

  const statusText = recovery.statusCode ? `HTTP ${recovery.statusCode}` : (recovery.error || "页面打开失败")
  const originalLength = Number(recovery.originalLength || 0)
  const finalLength = Number(recovery.finalUrlLength || 0)

  const wrapper = document.createElement("div")
  wrapper.id = "ccs-url-recovery"
  wrapper.style.cssText = `
    position: fixed;
    right: 20px;
    bottom: 20px;
    width: min(360px, calc(100vw - 40px));
    z-index: 2147483647;
    background: #111827;
    color: #fff;
    border: 1px solid rgba(255,255,255,0.16);
    border-radius: 8px;
    box-shadow: 0 18px 45px rgba(0,0,0,0.28);
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    overflow: hidden;
  `

  const body = document.createElement("div")
  body.style.cssText = "padding: 14px 14px 12px;"

  const title = document.createElement("div")
  title.textContent = `触触搜检测到 ${statusText}`
  title.style.cssText = "font-weight: 700; font-size: 14px; margin-bottom: 6px;"

  const detail = document.createElement("div")
  detail.textContent = recovery.truncated
    ? `原内容 ${originalLength} 字，已生成安全版 URL（${finalLength} 字）。`
    : "这次跳转由触触搜发起，可复制原内容或用安全方式重试。"
  detail.style.cssText = "color: rgba(255,255,255,0.78); margin-bottom: 10px;"

  const preview = document.createElement("div")
  preview.textContent = recovery.originalPreview || ""
  preview.style.cssText = `
    display: ${recovery.originalPreview ? "block" : "none"};
    max-height: 54px;
    overflow: hidden;
    color: rgba(255,255,255,0.62);
    background: rgba(255,255,255,0.08);
    border-radius: 6px;
    padding: 8px;
    margin-bottom: 10px;
    word-break: break-word;
  `

  const actions = document.createElement("div")
  actions.style.cssText = "display: flex; gap: 8px; flex-wrap: wrap;"

  const copyBtn = createRecoveryButton("复制原文")
  copyBtn.addEventListener("click", () => {
    sendRuntimeMessage<{ ok?: boolean; text?: string; error?: string }>({
      action: "ccsGetUrlRecoveryText",
      recoveryId: recovery.id,
      field: "original"
    })
      .then((response) => {
        if (!response?.ok || typeof response.text !== "string") throw new Error(response?.error || "missing-text")
        return copyToClipboard(response.text)
      })
      .then(() => showInfoToast("已复制原文"))
      .catch(() => showErrorToast("复制失败"))
  })

  const retryBtn = createRecoveryButton("安全版重试")
  retryBtn.addEventListener("click", () => {
    sendRuntimeMessage<{ ok?: boolean; error?: string }>({ action: "ccsOpenUrlRecoverySafe", recoveryId: recovery.id })
      .then((response) => {
        if (!response?.ok) throw new Error(response?.error || "open-failed")
        showInfoToast("已打开安全版")
      })
      .catch(() => showErrorToast("重试失败"))
  })

  const closeBtn = createRecoveryButton("关闭")
  closeBtn.addEventListener("click", () => {
    wrapper.remove()
    sendRuntimeMessage({ action: "ccsDismissUrlRecovery" }).catch(() => {})
  })

  actions.append(copyBtn, retryBtn, closeBtn)
  body.append(title, detail, preview, actions)
  wrapper.append(body)
  document.body.appendChild(wrapper)
}

function createRecoveryButton(label: string): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.textContent = label
  button.style.cssText = `
    appearance: none;
    border: 1px solid rgba(255,255,255,0.22);
    background: rgba(255,255,255,0.1);
    color: #fff;
    border-radius: 6px;
    padding: 6px 9px;
    cursor: pointer;
    font: inherit;
    white-space: nowrap;
  `
  button.addEventListener("mouseenter", () => { button.style.background = "rgba(255,255,255,0.18)" })
  button.addEventListener("mouseleave", () => { button.style.background = "rgba(255,255,255,0.1)" })
  return button
}

function sendRuntimeMessage<T = any>(message: unknown): Promise<T> {
  return new Promise((resolve) => {
    try {
      if (!ch?.runtime?.id || !ch.runtime.sendMessage) {
        resolve({ ok: false, error: "runtime-unavailable" } as T)
        return
      }
      ch.runtime.sendMessage(message, (response: T) => {
        if (ch.runtime?.lastError) {
          resolve({ ok: false, error: ch.runtime.lastError.message || "runtime-error" } as T)
          return
        }
        resolve(response)
      })
    } catch (err) {
      resolve({ ok: false, error: (err as Error)?.message || "runtime-error" } as T)
    }
  })
}

function safeChromeSendMessage(message: unknown): void {
  try {
    if (ch?.runtime?.id) ch.runtime.sendMessage?.(message)
  } catch (err) {
    log("发送消息失败:", err)
  }
}

win.safeChromeSendMessage = safeChromeSendMessage

function pickPreferredText(value: unknown): string {
  if (typeof value === "string" && value.length > 0) return value
  if (state.selection && state.selection.length > 0) return state.selection
  const live = readCurrentSelection()
  return live && live.length > 0 ? live : ""
}

export {}
