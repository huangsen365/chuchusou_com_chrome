/**
 * 触触搜 - 剪贴板助手 (TypeScript port)
 *
 * 与 content/ClipboardHelper.js 1:1 行为对等。**零 chrome.* 依赖**（Web API: navigator.clipboard + execCommand fallback）。
 */

export class ClipboardHelper {
  static async copy(text: string | null | undefined): Promise<boolean> {
    if (!text) return true

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch (err) {
        console.warn("[触触搜][Clipboard] Clipboard API 失败，尝试回退方法:", err)
      }
    }

    return ClipboardHelper._fallbackCopy(text)
  }

  static async read(): Promise<string> {
    if (navigator.clipboard?.readText) {
      try {
        return await navigator.clipboard.readText()
      } catch (err) {
        console.warn("[触触搜][Clipboard] 读取剪贴板失败:", err)
        return ""
      }
    }
    return ""
  }

  private static _fallbackCopy(text: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const textarea = document.createElement("textarea")
        textarea.value = text
        textarea.setAttribute("readonly", "")
        textarea.style.cssText = `
          position: fixed;
          top: -10000px;
          left: -10000px;
          width: 1px;
          height: 1px;
          opacity: 0;
        `
        document.body.appendChild(textarea)
        textarea.select()
        textarea.setSelectionRange(0, text.length)
        const succeeded = document.execCommand("copy")
        document.body.removeChild(textarea)
        resolve(succeeded)
      } catch (err) {
        console.warn("[触触搜][Clipboard] 回退复制失败:", err)
        resolve(false)
      }
    })
  }

  static isClipboardAPISupported(): boolean {
    return !!(navigator.clipboard && navigator.clipboard.writeText)
  }
}

export default ClipboardHelper
