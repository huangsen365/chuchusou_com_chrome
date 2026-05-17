/**
 * Content script - DOMMonitor 模块 (TypeScript port)
 *
 * 与 modules/domMonitor.js 1:1 行为对等。chrome.runtime 通过 globalThis 防御性访问。
 */

export interface DOMMonitorConfig {
  observeBody: boolean
  observeSubtree: boolean
  observeChildList: boolean
  observeAttributes: boolean
  observeCharacterData: boolean
  debounceDelay: number
}

export type DOMMonitorEvent = "pageChanged" | "realtimeUpdate" | "selectionChanged" | "popoverRemoved"

export interface SelectionChangeData {
  text: string
  selection: Selection | null
  event: Event | null
  timestamp: number
}

export interface PageChangeData {
  href: string
  title: string
  eventType?: string
  forceRefresh?: boolean
}

export interface PopoverRemovedData {
  node: Node
  mutation: MutationRecord
}

type Callback<T = unknown> = (data: T) => void

interface ChromeLike {
  runtime?: { sendMessage?: (m: unknown) => void }
}

interface WindowExtras {
  popover?: HTMLElement
  safeChromeSendMessage?: (m: unknown) => void
}

export class DOMMonitorManager {
  domObserver: MutationObserver | null = null
  pageChangeCallbacks: Callback<PageChangeData>[] = []
  selectionChangeCallbacks: Callback<SelectionChangeData>[] = []
  popoverRemovedCallback: Callback<PopoverRemovedData> | null = null

  config: DOMMonitorConfig = {
    observeBody: true,
    observeSubtree: true,
    observeChildList: true,
    observeAttributes: false,
    observeCharacterData: false,
    debounceDelay: 300
  }

  lastObservedHref = ""
  lastObservedTitle = ""
  realtimeUpdateTimer: ReturnType<typeof setTimeout> | null = null

  selectionTimeout: ReturnType<typeof setTimeout> | null = null
  lastSelectedText = ""
  lastSelectionTime = 0
  lastNotifiedText = ""

  init(options: Partial<DOMMonitorConfig> = {}): void {
    this.config = { ...this.config, ...options }
    this.lastObservedHref = window.location.href
    this.lastObservedTitle = document.title || ""
    this.startDOMMonitoring()
    this.startPageChangeMonitoring()
    this.startSelectionMonitoring()
    console.log("[触触搜] DOM监控模块已初始化")
  }

  startDOMMonitoring(targetElement: Element | null = null): void {
    if (this.domObserver) this.domObserver.disconnect()
    this.domObserver = new MutationObserver((mutations) => { this.handleDOMMutations(mutations) })

    const target = targetElement || document.body
    if (!target) {
      console.warn("[触触搜] DOM监控目标不存在，等待document.body加载")
      setTimeout(() => this.startDOMMonitoring(), 100)
      return
    }
    this.domObserver.observe(target, {
      childList: this.config.observeChildList,
      subtree: this.config.observeSubtree,
      attributes: this.config.observeAttributes,
      characterData: this.config.observeCharacterData
    })
    console.log("[触触搜] DOM监控已启动")
  }

  handleDOMMutations(mutations: MutationRecord[]): void {
    mutations.forEach((mutation) => {
      if (mutation.type === "childList") {
        mutation.removedNodes.forEach((node) => { this.checkRemovedNode(node, mutation) })
        mutation.addedNodes.forEach((node) => { this.checkAddedNode(node, mutation) })
      }
    })
  }

  checkRemovedNode(node: Node, mutation: MutationRecord): void {
    const w = window as unknown as WindowExtras
    const popover = w.popover || document.getElementById("ccs-popover-container")
    if (popover && (node === popover || (node.nodeType === 1 && (node as Element).contains?.(popover)))) {
      console.error("[触触搜] ⚠️ Popover被从DOM中移除！", {
        removedNode: node,
        isPopover: node === popover,
        containsPopover: (node as Element).contains?.(popover),
        parentNode: mutation.target,
        stackTrace: new Error().stack
      })
      this.triggerCallback("popoverRemoved", { node, mutation })
    }
  }

  checkAddedNode(_node: Node, _mutation: MutationRecord): void { /* reserved */ }

  startPageChangeMonitoring(): void {
    const originalPushState = history.pushState
    const originalReplaceState = history.replaceState

    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      originalPushState.apply(history, args)
      this.handlePageChange("pushState")
    }
    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      originalReplaceState.apply(history, args)
      this.handlePageChange("replaceState")
    }

    window.addEventListener("popstate", () => { this.handlePageChange("popstate") })
    window.addEventListener("hashchange", () => { this.handlePageChange("hashchange") })

    this.scheduleRealtimeUpdate()
    console.log("[触触搜] 页面变化监控已启动")
  }

  handlePageChange(eventType: string): void {
    console.log("[触触搜] 页面变化检测:", eventType)
    const currentHref = window.location.href
    const currentTitle = document.title || ""
    if (currentHref !== this.lastObservedHref || currentTitle !== this.lastObservedTitle) {
      console.log("[触触搜] 页面已变化:", {
        oldHref: this.lastObservedHref, newHref: currentHref,
        oldTitle: this.lastObservedTitle, newTitle: currentTitle, trigger: eventType
      })
      this.lastObservedHref = currentHref
      this.lastObservedTitle = currentTitle
      this.triggerCallback("pageChanged", { href: currentHref, title: currentTitle, eventType })
    }
  }

  scheduleRealtimeUpdate(): void {
    if (this.realtimeUpdateTimer) clearTimeout(this.realtimeUpdateTimer)
    this.realtimeUpdateTimer = setTimeout(() => {
      this.updateRealtimeFallback()
      this.scheduleRealtimeUpdate()
    }, 500)
  }

  updateRealtimeFallback(forceRefresh: boolean = false): void {
    const currentHref = window.location.href
    const currentTitle = document.title || ""
    if (forceRefresh || currentHref !== this.lastObservedHref || currentTitle !== this.lastObservedTitle) {
      this.lastObservedHref = currentHref
      this.lastObservedTitle = currentTitle
      this.triggerCallback("realtimeUpdate", { href: currentHref, title: currentTitle, forceRefresh })
    }
  }

  startSelectionMonitoring(): void {
    document.addEventListener("selectionchange", () => { this.handleSelectionChange() })
    document.addEventListener("mouseup", (e: MouseEvent) => {
      setTimeout(() => this.handleSelectionChange(e), 10)
    })
    console.log("[触触搜] 选择变化监控已启动")
  }

  handleSelectionChange(event: Event | null = null): void {
    if (this.selectionTimeout) clearTimeout(this.selectionTimeout)
    this.selectionTimeout = setTimeout(() => {
      const selection = window.getSelection()
      const text = selection ? selection.toString().trim() : ""
      if (text !== this.lastSelectedText) {
        const now = Date.now()
        this.lastSelectedText = text
        this.lastSelectionTime = now
        this.triggerCallback("selectionChanged", { text, selection, event, timestamp: now })
        if (text !== this.lastNotifiedText) {
          this.lastNotifiedText = text
          this.notifyBackgroundScript(text)
        }
      }
    }, this.config.debounceDelay)
  }

  notifyBackgroundScript(text: string): void {
    const w = window as unknown as WindowExtras
    if (w.safeChromeSendMessage) {
      w.safeChromeSendMessage({ action: "selectionChanged", text })
      return
    }
    const ch = (globalThis as unknown as { chrome?: ChromeLike }).chrome
    if (ch?.runtime?.sendMessage) {
      try {
        ch.runtime.sendMessage({ action: "selectionChanged", text })
      } catch (e) {
        console.warn("[触触搜] 无法发送消息到background:", e)
      }
    }
  }

  registerCallback(event: DOMMonitorEvent, callback: Callback<unknown>): void {
    switch (event) {
      case "pageChanged":
      case "realtimeUpdate":
        if (!this.pageChangeCallbacks.includes(callback as Callback<PageChangeData>)) {
          this.pageChangeCallbacks.push(callback as Callback<PageChangeData>)
        }
        break
      case "selectionChanged":
        if (!this.selectionChangeCallbacks.includes(callback as Callback<SelectionChangeData>)) {
          this.selectionChangeCallbacks.push(callback as Callback<SelectionChangeData>)
        }
        break
      case "popoverRemoved":
        this.popoverRemovedCallback = callback as Callback<PopoverRemovedData>
        break
    }
  }

  triggerCallback(event: DOMMonitorEvent, data: unknown): void {
    switch (event) {
      case "pageChanged":
      case "realtimeUpdate":
        this.pageChangeCallbacks.forEach((cb) => {
          try { cb(data as PageChangeData) } catch (e) { console.error("[触触搜] 页面变化回调错误:", e) }
        })
        break
      case "selectionChanged":
        this.selectionChangeCallbacks.forEach((cb) => {
          try { cb(data as SelectionChangeData) } catch (e) { console.error("[触触搜] 选择变化回调错误:", e) }
        })
        break
      case "popoverRemoved":
        if (this.popoverRemovedCallback) {
          try { this.popoverRemovedCallback(data as PopoverRemovedData) } catch (e) { console.error("[触触搜] Popover移除回调错误:", e) }
        }
        break
    }
  }

  stop(): void {
    if (this.domObserver) { this.domObserver.disconnect(); this.domObserver = null }
    if (this.realtimeUpdateTimer) { clearTimeout(this.realtimeUpdateTimer); this.realtimeUpdateTimer = null }
    if (this.selectionTimeout) { clearTimeout(this.selectionTimeout); this.selectionTimeout = null }
    console.log("[触触搜] DOM监控已停止")
  }

  restart(options: Partial<DOMMonitorConfig> = {}): void {
    this.stop()
    this.init(options)
  }

  getCurrentSelection(): string { return this.lastSelectedText }
  getPageInfo(): { href: string; title: string } { return { href: this.lastObservedHref, title: this.lastObservedTitle } }
}

export const DOMMonitor = new DOMMonitorManager()

export default DOMMonitor
