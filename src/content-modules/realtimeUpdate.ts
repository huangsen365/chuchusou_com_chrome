/**
 * Content script - RealtimeUpdate 模块 (TypeScript port)
 *
 * 与 modules/realtimeUpdate.js 1:1 行为对等。chrome.* 只在 saveSettings helper（不在 RealtimeUpdate 类里）。
 */

interface GlobalContent {
  shadowRoot?: ShadowRoot
  popover?: HTMLElement
  CCSModules?: { KeywordExtractor?: { getCurrentSearchText?: (force?: boolean) => string } }
  getCurrentSearchText?: (force?: boolean) => string
}

export interface RealtimeUpdateStatus {
  currentHref: string
  currentTitle: string
  lastObservedHref: string
  lastObservedTitle: string
  isMonitoring: boolean
}

export class RealtimeUpdateManager {
  lastObservedHref: string = window.location.href
  lastObservedTitle: string = document.title || ""
  realtimeUpdateTimer: ReturnType<typeof setTimeout> | null = null
  monitorInterval: ReturnType<typeof setInterval> | null = null
  CHECK_INTERVAL = 500
  UPDATE_DELAY = 120
  private titleObserver: MutationObserver | null = null

  init(): void {
    this.lastObservedHref = window.location.href
    this.lastObservedTitle = document.title || ""
    this.startMonitoring()
  }

  startMonitoring(): void {
    this.monitorInterval = setInterval(() => { this.checkForChanges() }, this.CHECK_INTERVAL)

    this.titleObserver = new MutationObserver(() => {
      if (document.title !== this.lastObservedTitle) {
        this.lastObservedTitle = document.title
        this.scheduleUpdate()
      }
    })

    this.titleObserver.observe(document.querySelector("title") || document.head, {
      childList: true, characterData: true, subtree: true
    })

    window.addEventListener("popstate", () => { this.checkForChanges() })

    const originalPushState = history.pushState
    const originalReplaceState = history.replaceState
    const self = this

    history.pushState = function (...args) {
      originalPushState.apply(history, args as Parameters<typeof history.pushState>)
      setTimeout(() => self.checkForChanges(), 0)
    }
    history.replaceState = function (...args) {
      originalReplaceState.apply(history, args as Parameters<typeof history.replaceState>)
      setTimeout(() => self.checkForChanges(), 0)
    }
  }

  checkForChanges(): void {
    const currentHref = window.location.href
    const currentTitle = document.title || ""

    if (currentHref !== this.lastObservedHref || currentTitle !== this.lastObservedTitle) {
      console.log("[触触搜] 检测到页面变化:", {
        urlChanged: currentHref !== this.lastObservedHref,
        titleChanged: currentTitle !== this.lastObservedTitle,
        oldUrl: this.lastObservedHref, newUrl: currentHref,
        oldTitle: this.lastObservedTitle, newTitle: currentTitle
      })
      this.lastObservedHref = currentHref
      this.lastObservedTitle = currentTitle
      this.scheduleUpdate()
    }
  }

  scheduleUpdate(): void {
    if (this.realtimeUpdateTimer) clearTimeout(this.realtimeUpdateTimer)
    this.realtimeUpdateTimer = setTimeout(() => { this.updateUI(false) }, this.UPDATE_DELAY)
  }

  updateUI(forceRefresh: boolean = false): void {
    try {
      const w = window as unknown as GlobalContent
      if (!w.shadowRoot || !w.popover) return

      const getCurrentText = (): string => {
        if (w.CCSModules?.KeywordExtractor?.getCurrentSearchText) {
          return w.CCSModules.KeywordExtractor.getCurrentSearchText(forceRefresh)
        }
        if (w.getCurrentSearchText) return w.getCurrentSearchText(forceRefresh)
        return ""
      }

      const t = getCurrentText()
      if (!t) return

      const titleEl = w.shadowRoot.querySelector<HTMLElement>(".ccs-title")
      if (titleEl) {
        titleEl.title = t
        titleEl.textContent = `🔍 触触搜: "${t}"`
      }
      console.log("[触触搜] UI已更新，当前文本:", t)
    } catch (err) {
      console.log("[触触搜] 更新UI时出错:", err)
    }
  }

  forceUpdate(): void { this.updateUI(true) }

  stopMonitoring(): void {
    if (this.monitorInterval) { clearInterval(this.monitorInterval); this.monitorInterval = null }
    if (this.realtimeUpdateTimer) { clearTimeout(this.realtimeUpdateTimer); this.realtimeUpdateTimer = null }
    if (this.titleObserver) { this.titleObserver.disconnect(); this.titleObserver = null }
  }

  getStatus(): RealtimeUpdateStatus {
    return {
      currentHref: window.location.href,
      currentTitle: document.title,
      lastObservedHref: this.lastObservedHref,
      lastObservedTitle: this.lastObservedTitle,
      isMonitoring: !!this.monitorInterval
    }
  }
}

export const RealtimeUpdate = new RealtimeUpdateManager()

export default RealtimeUpdate
