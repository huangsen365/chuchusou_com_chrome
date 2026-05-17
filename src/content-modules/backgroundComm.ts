/**
 * Content script - BackgroundComm 模块 (TypeScript port)
 *
 * 与 modules/backgroundComm.js 1:1 行为对等。chrome.runtime / chrome.storage 通过
 * globalThis 防御性访问。监听 6 种 action 消息：updateDebug / toggleExtension /
 * updateBlacklist / updateShortcut / copyText / processCommand / showPopover / showToast。
 */

export interface BackgroundCommHandlers {
  onDebugUpdate?: (enabled: boolean) => void
  onToggleExtension?: (enabled: boolean) => void
  onUpdateBlacklist?: (blacklist: string[]) => void
  onUpdateShortcut?: (key: string) => void
  onCopyText?: (text: string) => void
  onProcessCommand?: (command: string, text: string) => void
  onShowPopover?: (text: string) => void
  onShowToast?: (message: string) => void
  onMessage?: (request: unknown, sender: unknown, sendResponse: (r?: unknown) => void) => void
}

interface ChromeLike {
  runtime?: {
    id?: string
    sendMessage?: (m: unknown, cb?: (r: unknown) => void) => void
    onMessage?: {
      addListener: (l: (req: { action?: string; [k: string]: unknown }, sender: unknown, sendResponse: (r?: unknown) => void) => void) => void
    }
  }
  storage?: { local?: { set: (data: Record<string, unknown>) => void } }
}

function getChrome(): ChromeLike | null {
  return (globalThis as unknown as { chrome?: ChromeLike }).chrome || null
}

interface CommRequest {
  action?: string
  enabled?: boolean
  blacklist?: string[]
  shortcutKey?: string
  text?: string
  command?: string
  message?: string
  [key: string]: unknown
}

interface WindowExtras {
  CCS_DEBUG?: boolean
  showToast?: (m: string) => void
  commands?: { md5?: (a: string[]) => string }
  CCSModules?: { Toast?: { showContextMenuToast?: (m: string) => void } }
}

export class BackgroundCommManager {
  DEBUG_REQUEST_ID = 0

  init(handlers: BackgroundCommHandlers = {}): void {
    this.setupMessageListener(handlers)
  }

  requestKeywordsFromBackground(): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        const ch = getChrome()
        if (!ch?.runtime?.id || !ch.runtime.sendMessage) { resolve(null); return }
        const reqId = ++this.DEBUG_REQUEST_ID
        const w = window as unknown as WindowExtras
        if (w.CCS_DEBUG) console.log("[触触搜][DEBUG] requestKeywordsFromBackground start", { reqId, url: window.location.href, title: document.title })
        let settled = false
        const payload = { action: "extractKeywords", url: window.location.href, title: document.title || "" }
        ch.runtime.sendMessage(payload, (response: unknown) => {
          settled = true
          if (w.CCS_DEBUG) console.log("[触触搜][DEBUG] background response", { reqId, response })
          const r = response as { keywords?: string } | null | undefined
          if (r?.keywords) resolve(r.keywords)
          else resolve(null)
        })
        setTimeout(() => {
          if (!settled) {
            if (w.CCS_DEBUG) console.warn("[触触搜][DEBUG] background response timeout", { reqId })
            resolve(null)
          }
        }, 1200)
      } catch (_) { resolve(null) }
    })
  }

  sendMessage(message: unknown, callback?: (r: unknown) => void): boolean {
    try {
      const ch = getChrome()
      if (ch?.runtime?.id && ch.runtime.sendMessage) {
        ch.runtime.sendMessage(message, callback)
        return true
      }
    } catch (err) {
      console.warn("[触触搜] 发送消息失败:", err)
    }
    return false
  }

  updateDebugStatus(enabled: boolean): boolean {
    return this.sendMessage({ action: "updateDebug", enabled })
  }

  setupMessageListener(handlers: BackgroundCommHandlers): void {
    const ch = getChrome()
    if (!ch?.runtime?.onMessage) return

    ch.runtime.onMessage.addListener((request: CommRequest, sender, sendResponse) => {
      const w = window as unknown as WindowExtras

      if (request.action === "updateDebug") {
        w.CCS_DEBUG = !!request.enabled
        try { w.showToast?.(w.CCS_DEBUG ? "调试已开启" : "调试已关闭") } catch (_) { /* noop */ }
        ch.storage?.local?.set({ ccs_debug: w.CCS_DEBUG })
        handlers.onDebugUpdate?.(w.CCS_DEBUG)
      }
      if (request.action === "toggleExtension") {
        handlers.onToggleExtension?.(!!request.enabled)
      }
      if (request.action === "updateBlacklist") {
        handlers.onUpdateBlacklist?.((request.blacklist as string[]) || [])
      }
      if (request.action === "updateShortcut") {
        handlers.onUpdateShortcut?.((request.shortcutKey as string) || "")
      }
      if (request.action === "copyText") {
        const t = request.text || ""
        navigator.clipboard.writeText(t).then(() => {
          this.showContextMenuToast("已复制到剪贴板")
        })
        handlers.onCopyText?.(t)
      }
      if (request.action === "processCommand") {
        this.processCommand(request.command || "", request.text || "")
        handlers.onProcessCommand?.(request.command || "", request.text || "")
      }
      if (request.action === "showPopover") {
        handlers.onShowPopover?.((request.text as string) || "")
      }
      if (request.action === "showToast") {
        this.showContextMenuToast(request.message || "")
        handlers.onShowToast?.(request.message || "")
      }
      handlers.onMessage?.(request, sender, sendResponse)
    })
  }

  processCommand(command: string, text: string): string | undefined {
    let result: string | undefined
    const w = window as unknown as WindowExtras
    switch (command) {
      case "base64":     result = btoa(unescape(encodeURIComponent(text))); break
      case "md5":        result = w.commands?.md5 ? w.commands.md5([text]) : ""; break
      case "url-encode": result = encodeURIComponent(text); break
      case "upper":      result = text.toUpperCase(); break
      case "lower":      result = text.toLowerCase(); break
    }
    if (result) {
      navigator.clipboard.writeText(result).then(() => {
        this.showContextMenuToast(`处理完成并已复制: ${result!.substring(0, 50)}${result!.length > 50 ? "..." : ""}`)
      })
    }
    return result
  }

  showContextMenuToast(message: string): void {
    const w = window as unknown as WindowExtras
    if (w.CCSModules?.Toast?.showContextMenuToast) {
      w.CCSModules.Toast.showContextMenuToast(message)
      return
    }

    const toast = document.createElement("div")
    toast.style.cssText = `
      position: fixed; bottom: 20px; right: 20px;
      background: rgba(0, 0, 0, 0.8); color: white;
      padding: 12px 20px; border-radius: 6px; font-size: 14px;
      z-index: 2147483647; animation: slideIn 0.3s ease-out;
    `
    toast.textContent = message
    const style = document.createElement("style")
    style.textContent = `
      @keyframes slideIn {
        from { opacity: 0; transform: translateX(20px); }
        to { opacity: 1; transform: translateX(0); }
      }
    `
    document.head.appendChild(style)
    document.body.appendChild(toast)
    setTimeout(() => {
      toast.style.animation = "slideIn 0.3s ease-out reverse"
      setTimeout(() => { toast.remove(); style.remove() }, 300)
    }, 3000)
  }
}

export const BackgroundComm = new BackgroundCommManager()

export default BackgroundComm
