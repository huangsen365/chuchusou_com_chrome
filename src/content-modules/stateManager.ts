/**
 * Content script - StateManager 模块 (TypeScript port)
 *
 * 与 modules/stateManager.js 1:1 行为对等。chrome.storage 通过 globalThis 防御性访问。
 * window 属性 setter/getter 改为显式 syncToWindow + setupPropertyWatchers 调用。
 */

interface ChromeLike {
  storage?: {
    local?: {
      get: (keys: string[], cb: (r: Record<string, unknown>) => void) => void
      set: (data: Record<string, unknown>) => void
    }
  }
}

function getChrome(): ChromeLike | null {
  return (globalThis as unknown as { chrome?: ChromeLike }).chrome || null
}

export interface ContentSettingsShape {
  mode: string
  theme: string
  opacity: number
  position: unknown
  layout: string
  globalDock: boolean
  barClosed: boolean
  blacklist: string[]
  isBlacklisted: boolean
  miniButtons: string[]
  shortcutKey: string
}

export interface ContentInnerState {
  popover: HTMLElement | null
  shadowRoot: ShadowRoot | null
  selectedText: string
  lastNonEmptySelection: string
  domObserver: MutationObserver | null
  isProcessingSelection: boolean
  settings: ContentSettingsShape
}

interface WritableWindow {
  selectedText: string
  lastNonEmptySelection: string
  shadowRoot: ShadowRoot | null
  popover: HTMLElement | null
  settings: ContentSettingsShape
  domObserver: MutationObserver | null
  isProcessingSelection: boolean
  CCS_DEBUG?: boolean
}

export class ContentStateManager {
  _state: ContentInnerState = {
    popover: null,
    shadowRoot: null,
    selectedText: "",
    lastNonEmptySelection: "",
    domObserver: null,
    isProcessingSelection: false,
    settings: {
      mode: "normal", theme: "default", opacity: 1, position: null, layout: "float",
      globalDock: false, barClosed: false, blacklist: [], isBlacklisted: false,
      miniButtons: ["baidu", "google", "chuchusou", "copy", "lowercase"], shortcutKey: "Alt+S"
    }
  }

  init(): ContentInnerState {
    this.syncToWindow()
    this.setupPropertyWatchers()
    return this._state
  }

  syncToWindow(): void {
    const w = window as unknown as WritableWindow
    w.selectedText = this._state.selectedText
    w.lastNonEmptySelection = this._state.lastNonEmptySelection
    w.shadowRoot = this._state.shadowRoot
    w.popover = this._state.popover
    w.settings = this._state.settings
    w.domObserver = this._state.domObserver
    w.isProcessingSelection = this._state.isProcessingSelection
  }

  setupPropertyWatchers(): void {
    const self = this
    Object.defineProperty(window, "selectedText", {
      get: () => self._state.selectedText,
      set: (v: string) => { self._state.selectedText = v; self.onSelectedTextChange(v) },
      configurable: true
    })
    Object.defineProperty(window, "lastNonEmptySelection", {
      get: () => self._state.lastNonEmptySelection,
      set: (v: string) => { self._state.lastNonEmptySelection = v; self.onLastNonEmptySelectionChange(v) },
      configurable: true
    })
    Object.defineProperty(window, "popover", {
      get: () => self._state.popover,
      set: (v: HTMLElement | null) => { self._state.popover = v },
      configurable: true
    })
    Object.defineProperty(window, "shadowRoot", {
      get: () => self._state.shadowRoot,
      set: (v: ShadowRoot | null) => { self._state.shadowRoot = v },
      configurable: true
    })
    Object.defineProperty(window, "isProcessingSelection", {
      get: () => self._state.isProcessingSelection,
      set: (v: boolean) => { self._state.isProcessingSelection = v },
      configurable: true
    })
  }

  getSettings(): ContentSettingsShape { return this._state.settings }

  updateSettings(updates: Partial<ContentSettingsShape>): void {
    Object.assign(this._state.settings, updates)
    ;(window as unknown as WritableWindow).settings = this._state.settings
    this.saveSettings()
  }

  saveSettings(): void {
    console.log("[触触搜] 保存设置:", {
      globalDock: this._state.settings.globalDock,
      layout: this._state.settings.layout,
      barClosed: this._state.settings.barClosed
    })
    getChrome()?.storage?.local?.set({ ccs_settings: this._state.settings })
  }

  loadSettings(callback?: (s: ContentSettingsShape) => void): void {
    const ch = getChrome()
    if (!ch?.storage?.local?.get) {
      callback?.(this._state.settings)
      return
    }
    ch.storage.local.get(["ccs_settings", "ccs_debug"], (result) => {
      const settings = result.ccs_settings as Partial<ContentSettingsShape> | undefined
      console.log("[触触搜] 加载设置:", settings)
      if (settings) {
        Object.assign(this._state.settings, settings)
        if (!Array.isArray(this._state.settings.blacklist)) this._state.settings.blacklist = []
        if (Array.isArray(this._state.settings.miniButtons) && !this._state.settings.miniButtons.includes("lowercase")) {
          this._state.settings.miniButtons.push("lowercase")
          this.saveSettings()
        }
        try {
          if (this._state.settings.globalDock && this._state.settings.mode === "normal" && !this._state.settings.barClosed) {
            this._state.settings.layout = "bottom"
          }
        } catch (_) { /* noop */ }
      }

      const w = window as unknown as WritableWindow
      if (typeof result.ccs_debug === "boolean") {
        w.CCS_DEBUG = result.ccs_debug as boolean
      } else {
        ch.storage?.local?.set({ ccs_debug: false })
        w.CCS_DEBUG = false
      }
      w.settings = this._state.settings
      callback?.(this._state.settings)
    })
  }

  setSelectedText(value: string): void {
    this._state.selectedText = value
    ;(window as unknown as WritableWindow).selectedText = value
  }

  setLastNonEmptySelection(value: string): void {
    this._state.lastNonEmptySelection = value
    ;(window as unknown as WritableWindow).lastNonEmptySelection = value
  }

  setPopover(element: HTMLElement | null): void {
    this._state.popover = element
    ;(window as unknown as WritableWindow).popover = element
  }

  setShadowRoot(shadowRoot: ShadowRoot | null): void {
    this._state.shadowRoot = shadowRoot
    ;(window as unknown as WritableWindow).shadowRoot = shadowRoot
  }

  setDomObserver(observer: MutationObserver | null): void {
    this._state.domObserver = observer
    ;(window as unknown as WritableWindow).domObserver = observer
  }

  setProcessingSelection(value: boolean): void {
    this._state.isProcessingSelection = value
    ;(window as unknown as WritableWindow).isProcessingSelection = value
  }

  getState(): ContentInnerState { return { ...this._state } }

  reset(): void {
    if (this._state.popover) this._state.popover.remove()
    if (this._state.domObserver) this._state.domObserver.disconnect()
    this._state.popover = null
    this._state.shadowRoot = null
    this._state.selectedText = ""
    this._state.lastNonEmptySelection = ""
    this._state.domObserver = null
    this._state.isProcessingSelection = false
    this.syncToWindow()
  }

  onSelectedTextChange(value: string): void {
    console.log("[触触搜] 选中文本更新:", value ? value.substring(0, 50) + "..." : "(空)")
  }

  onLastNonEmptySelectionChange(value: string): void {
    console.log("[触触搜] 最后非空选中文本更新:", value ? value.substring(0, 50) + "..." : "(空)")
  }

  isBlacklisted(): boolean { return this._state.settings.isBlacklisted }
  isDisabled(): boolean { return this._state.settings.mode === "disabled" }
  isMiniMode(): boolean { return this._state.settings.mode === "mini" }
  isBottomLayout(): boolean { return this._state.settings.layout === "bottom" }
  isGlobalDock(): boolean { return this._state.settings.globalDock }
}

export const ContentState = new ContentStateManager()

export default ContentState
