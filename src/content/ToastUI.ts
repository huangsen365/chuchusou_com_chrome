/**
 * 触触搜 - Toast 通知组件 (TypeScript port)
 *
 * 与 content/ToastUI.js 1:1 行为对等。**零 chrome.* 依赖**（纯 DOM API）。
 */

export type ToastPosition =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left"
  | "bottom-center"
  | "top-center"

export type ToastType = "info" | "success" | "error" | "warning"

export interface ToastOptions {
  duration?: number
  position?: ToastPosition
  containerClass?: string
}

export interface ShowOptions {
  type?: ToastType
  duration?: number
}

export class Toast {
  duration: number
  position: ToastPosition
  containerClass: string

  constructor(options: ToastOptions = {}) {
    this.duration = options.duration ?? 2000
    this.position = options.position ?? "bottom-right"
    this.containerClass = options.containerClass ?? "ccs-toast-container"
  }

  show(message: string, options: ShowOptions = {}): void {
    if (!message) return

    const type = options.type ?? "info"
    const duration = options.duration ?? this.duration

    const toast = document.createElement("div")
    toast.className = `ccs-toast ccs-toast-${type}`
    toast.textContent = message

    this._applyStyles(toast, type)

    document.body.appendChild(toast)

    requestAnimationFrame(() => {
      toast.style.opacity = "1"
      toast.style.transform = "translateY(0)"
    })

    setTimeout(() => {
      toast.style.opacity = "0"
      toast.style.transform = "translateY(10px)"
      setTimeout(() => toast.remove(), 200)
    }, duration)
  }

  info(message: string): void { this.show(message, { type: "info" }) }
  success(message: string): void { this.show(message, { type: "success" }) }
  error(message: string): void { this.show(message, { type: "error" }) }
  warning(message: string): void { this.show(message, { type: "warning" }) }
  showContextMenuToast(message: string): void { this.info(message) }

  private _applyStyles(toast: HTMLElement, type: ToastType): void {
    const colors: Record<ToastType, { bg: string; color: string }> = {
      info:    { bg: "rgba(0, 0, 0, 0.85)",     color: "#fff" },
      success: { bg: "rgba(39, 174, 96, 0.95)", color: "#fff" },
      error:   { bg: "rgba(231, 76, 60, 0.95)", color: "#fff" },
      warning: { bg: "rgba(241, 196, 15, 0.95)", color: "#333" }
    }
    const { bg, color } = colors[type] || colors.info
    const positionStyles = this._getPositionStyles()

    toast.style.cssText = `
      position: fixed;
      ${positionStyles}
      background: ${bg};
      color: ${color};
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 2147483647;
      opacity: 0;
      transform: translateY(10px);
      transition: opacity 0.2s ease, transform 0.2s ease;
      max-width: 300px;
      word-wrap: break-word;
      pointer-events: none;
    `
  }

  private _getPositionStyles(): string {
    const positions: Record<ToastPosition, string> = {
      "bottom-right":  "bottom: 20px; right: 20px;",
      "bottom-left":   "bottom: 20px; left: 20px;",
      "top-right":     "top: 20px; right: 20px;",
      "top-left":      "top: 20px; left: 20px;",
      "bottom-center": "bottom: 20px; left: 50%; transform: translateX(-50%);",
      "top-center":    "top: 20px; left: 50%; transform: translateX(-50%);"
    }
    return positions[this.position] || positions["bottom-right"]
  }
}

export const defaultToast = new Toast()

export default Toast
