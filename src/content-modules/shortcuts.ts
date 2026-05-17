/**
 * Content script - Shortcuts 模块 (TypeScript port)
 *
 * 与 modules/shortcuts.js 1:1 行为对等。**零 chrome.* 依赖**。
 */

export type ShortcutAction = "openPanel" | "togglePanel" | "quickSearch" | "quickCopy" | "closePanel" | string
export type ShortcutHandler = (e: KeyboardEvent) => void

export interface ShortcutOption {
  value: string
  label: string
}

interface GlobalContent {
  CCSModules?: {
    Settings?: {
      current?: {
        shortcutKey?: string
        mode?: string
        isBlacklisted?: boolean
        layout?: string
        globalDock?: boolean
        barClosed?: boolean
      }
      save?: () => void
      set?: (k: string, v: unknown) => void
    }
    UIManager?: { showPanel?: () => void; togglePanel?: () => void; hidePanel?: () => void }
    Selection?: { getCurrentSearchText?: () => string }
    Search?: { performSearch?: (engine: string, text: string) => void }
    Toast?: { show?: (m: string) => void }
  }
  __initDockBar?: () => void
  hidePopover?: () => void
}

export class ShortcutsManager {
  shortcuts: Record<string, ShortcutAction> = {
    "Alt+S": "openPanel",
    "Ctrl+Shift+S": "openPanel",
    "Alt+Shift+S": "togglePanel",
    "Alt+Q": "quickSearch",
    "Alt+C": "quickCopy",
    "Escape": "closePanel"
  }
  currentShortcut: string = "Alt+S"
  handlers: Record<string, ShortcutHandler> = {}
  private _keydownHandler?: (e: KeyboardEvent) => void
  private _keyupHandler?: (e: KeyboardEvent) => void

  init(): void {
    const w = window as unknown as GlobalContent
    const Settings = w.CCSModules?.Settings
    if (Settings?.current) {
      this.currentShortcut = Settings.current.shortcutKey || "Alt+S"
    }
    this._keydownHandler = (e) => this.handleKeyDown(e)
    this._keyupHandler = (e) => this.handleKeyUp(e)
    document.addEventListener("keydown", this._keydownHandler, true)
    document.addEventListener("keyup", this._keyupHandler, true)
    this.registerDefaultHandlers()
  }

  registerDefaultHandlers(): void {
    this.register("openPanel", () => {
      console.log("[触触搜] 快捷键触发：打开面板")
      const w = window as unknown as GlobalContent
      if (w.__initDockBar) w.__initDockBar()
      else if (w.CCSModules?.UIManager?.showPanel) w.CCSModules.UIManager.showPanel()
    })
    this.register("togglePanel", () => {
      console.log("[触触搜] 快捷键触发：切换面板")
      const w = window as unknown as GlobalContent
      if (w.CCSModules?.UIManager?.togglePanel) w.CCSModules.UIManager.togglePanel()
    })
    this.register("quickSearch", () => {
      const w = window as unknown as GlobalContent
      const text = w.CCSModules?.Selection?.getCurrentSearchText?.()
      if (text && w.CCSModules?.Search?.performSearch) {
        w.CCSModules.Search.performSearch("google", text)
      }
    })
    this.register("quickCopy", () => {
      const w = window as unknown as GlobalContent
      const text = w.CCSModules?.Selection?.getCurrentSearchText?.()
      if (text) {
        navigator.clipboard.writeText(text)
        if (w.CCSModules?.Toast?.show) w.CCSModules.Toast.show("已复制到剪贴板")
      }
    })
    this.register("closePanel", () => {
      const w = window as unknown as GlobalContent
      if (w.hidePopover) w.hidePopover()
      else if (w.CCSModules?.UIManager?.hidePanel) w.CCSModules.UIManager.hidePanel()
    })
  }

  handleKeyDown(e: KeyboardEvent): void {
    if (this.isInputElement(e.target as Element)) return

    const shortcut = this.getShortcutString(e)

    if (this.matchesShortcut(e, this.currentShortcut)) {
      e.preventDefault()
      e.stopPropagation()
      this.handleSearchShortcut(e)
      return
    }

    const action = this.shortcuts[shortcut]
    if (action && this.handlers[action]) {
      e.preventDefault()
      e.stopPropagation()
      this.handlers[action](e)
    }
  }

  handleKeyUp(_e: KeyboardEvent): void { /* reserved */ }

  getShortcutString(e: KeyboardEvent): string {
    const parts: string[] = []
    if (e.ctrlKey) parts.push("Ctrl")
    if (e.altKey) parts.push("Alt")
    if (e.shiftKey) parts.push("Shift")
    if (e.metaKey) parts.push("Meta")
    let key = e.key
    if (key === " ") key = "Space"
    else if (key.length === 1) key = key.toUpperCase()
    if (!["Control", "Alt", "Shift", "Meta"].includes(key)) parts.push(key)
    return parts.join("+")
  }

  matchesShortcut(e: KeyboardEvent, shortcutStr: string): boolean {
    if (!shortcutStr) return false
    const parts = shortcutStr.split("+").map((p) => p.trim().toLowerCase())
    const hasCtrl = parts.includes("ctrl")
    const hasAlt = parts.includes("alt")
    const hasShift = parts.includes("shift")
    const hasMeta = parts.includes("meta")
    if (hasCtrl !== e.ctrlKey) return false
    if (hasAlt !== e.altKey) return false
    if (hasShift !== e.shiftKey) return false
    if (hasMeta !== e.metaKey) return false
    const mainKey = parts.find((p) => !["ctrl", "alt", "shift", "meta"].includes(p))
    if (!mainKey) return false
    const eventKey = e.key.toLowerCase()
    return (
      eventKey === mainKey ||
      (mainKey === "space" && eventKey === " ") ||
      (mainKey.length === 1 && eventKey === mainKey)
    )
  }

  handleSearchShortcut(_e: KeyboardEvent): void {
    console.log("[触触搜] 搜索快捷键触发")
    const w = window as unknown as GlobalContent
    const Settings = w.CCSModules?.Settings
    if (Settings?.current) {
      const { mode, isBlacklisted } = Settings.current
      if (mode === "disabled") {
        console.log("[触触搜] 插件已禁用，忽略快捷键")
        return
      }
      if (isBlacklisted) {
        console.log("[触触搜] 当前页面在黑名单中，忽略快捷键")
        return
      }
      Settings.current.layout = "bottom"
      Settings.current.globalDock = true
      Settings.current.barClosed = false
      Settings.current.mode = "normal"
      Settings.save?.()
    }
    if (this.handlers.openPanel) {
      this.handlers.openPanel({} as KeyboardEvent)
    }
  }

  register(action: string, handler: ShortcutHandler): void { this.handlers[action] = handler }
  unregister(action: string): void { delete this.handlers[action] }

  updateShortcut(newShortcut: string): void {
    this.currentShortcut = newShortcut
    const w = window as unknown as GlobalContent
    w.CCSModules?.Settings?.set?.("shortcutKey", newShortcut)
  }

  isInputElement(element: Element | null): boolean {
    if (!element) return false
    const tagName = element.tagName.toLowerCase()
    const isEditable = (element as HTMLElement).contentEditable === "true"
    const isInput = ["input", "textarea", "select"].includes(tagName)
    return isEditable || isInput
  }

  getAvailableShortcuts(): ShortcutOption[] {
    return [
      { value: "Alt+S", label: "Alt+S（默认）" },
      { value: "Ctrl+Shift+S", label: "Ctrl+Shift+S" },
      { value: "Alt+Shift+S", label: "Alt+Shift+S" },
      { value: "Ctrl+Alt+S", label: "Ctrl+Alt+S" },
      { value: "Alt+Q", label: "Alt+Q" },
      { value: "Alt+E", label: "Alt+E" },
      { value: "Ctrl+Space", label: "Ctrl+Space" },
      { value: "Alt+Space", label: "Alt+Space" }
    ]
  }

  disable(): void {
    if (this._keydownHandler) document.removeEventListener("keydown", this._keydownHandler, true)
    if (this._keyupHandler) document.removeEventListener("keyup", this._keyupHandler, true)
  }

  enable(): void {
    this.disable()
    this._keydownHandler = (e) => this.handleKeyDown(e)
    this._keyupHandler = (e) => this.handleKeyUp(e)
    document.addEventListener("keydown", this._keydownHandler, true)
    document.addEventListener("keyup", this._keyupHandler, true)
  }
}

export const Shortcuts = new ShortcutsManager()

export default Shortcuts
