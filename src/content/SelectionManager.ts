/**
 * 触触搜 - 选区管理器 (TypeScript port)
 *
 * 与 content/SelectionManager.js 1:1 行为对等。**零 chrome.* 依赖**。
 * 依赖 Web API：window.getSelection / document.activeElement / window.location / document.title
 */

export interface SelectionManagerOptions {
  debug?: boolean
  syncDelay?: number
  onSelectionChange?: (text: string, trigger: string) => void
}

export interface SelectionSnapshot {
  text: string
  source: "live" | "state" | "memory" | "empty"
  url: string
  title: string
}

export interface UpdateSelectionOptions {
  immediate?: boolean
}

interface ElementWithSelection {
  value?: string
  selectionStart?: number | null
  selectionEnd?: number | null
  shadowRoot?: ShadowRoot | null
  isContentEditable?: boolean
}

export class SelectionManager {
  debug: boolean
  syncDelay: number
  currentSelection: string
  lastNonEmptySelection: string
  debounceTimer: ReturnType<typeof setTimeout> | null
  isUserSelecting: boolean
  onSelectionChange: ((text: string, trigger: string) => void) | null

  constructor(options: SelectionManagerOptions = {}) {
    this.debug = options.debug || false
    this.syncDelay = options.syncDelay || 35
    this.currentSelection = ""
    this.lastNonEmptySelection = ""
    this.debounceTimer = null
    this.isUserSelecting = false
    this.onSelectionChange = options.onSelectionChange || null
  }

  readCurrentSelection(): string {
    try {
      const selection = window.getSelection()
      if (selection && selection.rangeCount > 0) {
        const raw = selection.toString()
        if (raw && raw.trim().length > 0) {
          return raw
        }
      }
      const fallback = this._readFromActiveElement()
      if (fallback) return fallback
      return ""
    } catch (err) {
      this._log("读取选中文本失败:", err)
      return ""
    }
  }

  private _readFromActiveElement(): string {
    const activeElement = document.activeElement as Element & ElementWithSelection
    return this._extractFromElement(activeElement)
  }

  private _extractFromElement(element: (Element & ElementWithSelection) | null): string {
    if (!element) return ""
    try {
      if (typeof element.value === "string") {
        const { selectionStart, selectionEnd } = element
        if (
          typeof selectionStart === "number" &&
          typeof selectionEnd === "number" &&
          selectionStart !== selectionEnd
        ) {
          const value = element.value
          if (value) {
            const start = Math.min(selectionStart, selectionEnd)
            const end = Math.max(selectionStart, selectionEnd)
            const result = value.slice(start, end)
            if (result && result.trim().length > 0) return result
          }
        }
      }

      if (element.shadowRoot) {
        const shadowActive = element.shadowRoot.activeElement as Element & ElementWithSelection
        if (shadowActive && shadowActive !== element) {
          const shadowText = this._extractFromElement(shadowActive)
          if (shadowText) return shadowText
        }
        const shadowGetSelection = (element.shadowRoot as ShadowRoot & {
          getSelection?: () => Selection | null
        }).getSelection
        const shadowSelection = shadowGetSelection ? shadowGetSelection.call(element.shadowRoot) : null
        if (shadowSelection && shadowSelection.rangeCount > 0) {
          const raw = shadowSelection.toString()
          if (raw && raw.trim().length > 0) return raw
        }
      }

      if (element.isContentEditable) {
        const editableSelection = window.getSelection()
        if (editableSelection && editableSelection.rangeCount > 0) {
          const raw = editableSelection.toString()
          if (raw && raw.trim().length > 0) return raw
        }
      }
    } catch (err) {
      this._log("从元素提取选区失败:", err)
    }
    return ""
  }

  applySelection(text: string | null | undefined, trigger: string = "unknown"): void {
    const raw = typeof text === "string" ? text : ""
    const trimmed = raw.trim()
    const hasContent = trimmed.length > 0
    const value = hasContent ? trimmed : ""

    // 兼容 legacy window.selectedText
    if (typeof window !== "undefined") {
      ;(window as unknown as { selectedText: string }).selectedText = value
      if (hasContent) {
        ;(window as unknown as { lastNonEmptySelection: string }).lastNonEmptySelection = value
      }
    }

    if (this.currentSelection === value) return

    this.currentSelection = value
    if (hasContent) {
      this.lastNonEmptySelection = value
    }

    this._log("同步选中文本", { trigger, text: value })

    if (this.onSelectionChange) {
      this.onSelectionChange(value, trigger)
    }
  }

  updateSelection(trigger: string, options: UpdateSelectionOptions = {}): void {
    const { immediate = false } = options

    if (immediate) {
      const immediateSelection = this.readCurrentSelection()
      this.applySelection(immediateSelection, trigger)

      if (!immediateSelection || !immediateSelection.trim()) {
        setTimeout(() => {
          const retrySelection = this.readCurrentSelection()
          if (retrySelection && retrySelection.trim()) {
            this.applySelection(retrySelection, `${trigger}-retry`)
          }
        }, this.syncDelay)
      }
      return
    }

    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.applySelection(this.readCurrentSelection(), trigger)
    }, this.syncDelay)
  }

  getPreferredText(value: string | null | undefined): string {
    if (typeof value === "string" && value.length > 0) return value
    if (this.currentSelection && this.currentSelection.length > 0) return this.currentSelection
    const live = this.readCurrentSelection()
    return live && live.length > 0 ? live : ""
  }

  getSnapshot(preferEmpty: boolean = false): SelectionSnapshot {
    const live = this.readCurrentSelection()
    let chosen: string = typeof live === "string" ? live : ""
    let source: SelectionSnapshot["source"] = "live"

    if (!chosen || !chosen.trim()) {
      if (preferEmpty) {
        chosen = ""
        source = "empty"
      } else if (this.currentSelection && this.currentSelection.trim().length > 0) {
        chosen = this.currentSelection
        source = "state"
      } else if (this.lastNonEmptySelection && this.lastNonEmptySelection.trim().length > 0) {
        chosen = this.lastNonEmptySelection
        source = "memory"
      } else {
        chosen = ""
        source = "empty"
      }
    } else if (this.currentSelection !== chosen) {
      this.currentSelection = chosen
    }

    if (chosen && chosen.trim()) {
      ;(window as unknown as { selectedText: string }).selectedText = chosen
      ;(window as unknown as { lastNonEmptySelection: string }).lastNonEmptySelection = chosen
      this.lastNonEmptySelection = chosen
    }

    return {
      text: chosen,
      source,
      url: window.location.href,
      title: document.title || ""
    }
  }

  setUserSelecting(selecting: boolean): void {
    this.isUserSelecting = selecting
  }

  isSelecting(): boolean {
    return this.isUserSelecting
  }

  private _log(...args: unknown[]): void {
    if (this.debug) {
      console.log("[触触搜][Selection]", ...args)
    }
  }
}

export default SelectionManager
