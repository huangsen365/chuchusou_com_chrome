/**
 * Content script - TextSync 模块 (TypeScript port)
 *
 * 与 modules/textSync.js 1:1 行为对等。**零 chrome.* 依赖**。
 * 依赖 globalThis 上的 window.getUnifiedSearchText / getActiveSelectionText（兼容期）。
 */

export interface RefreshOptions {
  forceRefresh?: boolean
  skipCache?: boolean
}

interface GlobalContent {
  selectedText?: string
  lastNonEmptySelection?: string
  shadowRoot?: ShadowRoot
  getUnifiedSearchText?: (opts?: { forceRefresh?: boolean; skipCache?: boolean }) => string
  getActiveSelectionText?: () => string
}

export class TextSyncManager {
  selectedText: string = ""
  lastNonEmptySelection: string = ""
  shadowRoot: ShadowRoot | null = null

  init(shadowRootElement: ShadowRoot | null): void { this.shadowRoot = shadowRootElement }
  setShadowRoot(shadowRootElement: ShadowRoot | null): void { this.shadowRoot = shadowRootElement }

  getSelectedText(): string { return this.selectedText }
  setSelectedText(text: string | null | undefined): string {
    this.selectedText = text || ""
    return this.selectedText
  }

  getLastNonEmptySelection(): string { return this.lastNonEmptySelection }
  setLastNonEmptySelection(text: string | null | undefined): string {
    if (text && text.trim()) this.lastNonEmptySelection = text
    return this.lastNonEmptySelection
  }

  syncAllTextVariables(): string {
    const w = window as unknown as GlobalContent
    console.log("[触触搜] syncAllTextVariables 开始执行 (强制刷新，跳过缓存)")
    let latestText = ""
    if (w.getUnifiedSearchText) {
      latestText = w.getUnifiedSearchText({ forceRefresh: true, skipCache: true })
    } else {
      const selection = window.getSelection()
      if (selection && selection.rangeCount > 0) {
        latestText = selection.toString().trim()
      }
    }
    console.log("[触触搜] syncAllTextVariables 获取到的文本:", {
      text: latestText, length: latestText ? latestText.length : 0, isEmpty: !latestText
    })

    this.selectedText = latestText || ""
    if (w.selectedText !== undefined) w.selectedText = this.selectedText

    const currentSelection = this.getActiveSelectionText()
    if (currentSelection) {
      console.log("[触触搜] syncAllTextVariables 更新 lastNonEmptySelection:", currentSelection)
      this.lastNonEmptySelection = currentSelection
      if (w.lastNonEmptySelection !== undefined) w.lastNonEmptySelection = this.lastNonEmptySelection
    }

    if (this.shadowRoot) {
      const input = this.shadowRoot.querySelector<HTMLInputElement>(".ccs-input")
      if (input) {
        input.value = this.selectedText
        console.log("[触触搜] syncAllTextVariables 更新输入框值:", this.selectedText)
      }
    }

    console.log("[触触搜] syncAllTextVariables 完成，返回文本:", this.selectedText)
    return this.selectedText
  }

  getActiveSelectionText(): string {
    const w = window as unknown as GlobalContent
    if (w.getActiveSelectionText) return w.getActiveSelectionText()
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      const text = selection.toString().trim()
      if (text) return text
    }
    return ""
  }

  updateAllButtonsWithSameText(text: string | null | undefined): void {
    if (!this.shadowRoot) {
      const w = window as unknown as GlobalContent
      if (w.shadowRoot) this.shadowRoot = w.shadowRoot
      else return
    }
    const buttons = this.shadowRoot!.querySelectorAll<HTMLElement>(".ccs-button")
    buttons.forEach((button) => {
      const btnTitle = button.dataset.btnTitle
      if (btnTitle) {
        button.dataset.searchText = text || ""
        button.title = text ? `${btnTitle}: ${text}` : btnTitle
      }
    })
  }

  updateInputValue(text: string | null | undefined): boolean {
    if (!this.shadowRoot) {
      const w = window as unknown as GlobalContent
      if (w.shadowRoot) this.shadowRoot = w.shadowRoot
      else return false
    }
    const input = this.shadowRoot!.querySelector<HTMLInputElement>(".ccs-input")
    if (input) {
      input.value = text || ""
      return true
    }
    return false
  }

  getInputValue(): string {
    if (!this.shadowRoot) {
      const w = window as unknown as GlobalContent
      if (w.shadowRoot) this.shadowRoot = w.shadowRoot
      else return ""
    }
    const input = this.shadowRoot!.querySelector<HTMLInputElement>(".ccs-input")
    return input ? input.value : ""
  }

  clearSelection(): void {
    this.selectedText = ""
    const w = window as unknown as GlobalContent
    if (w.selectedText !== undefined) w.selectedText = ""
    this.updateInputValue("")
    this.updateAllButtonsWithSameText("")
  }

  refreshText(options: RefreshOptions = {}): string {
    const forceRefresh = options.forceRefresh !== false
    const skipCache = options.skipCache !== false
    const w = window as unknown as GlobalContent
    if (w.getUnifiedSearchText) {
      const text = w.getUnifiedSearchText({ forceRefresh, skipCache })
      this.setSelectedText(text)
      if (text) this.setLastNonEmptySelection(text)
      return text
    }
    return this.syncAllTextVariables()
  }
}

export const TextSync = new TextSyncManager()

export default TextSync
