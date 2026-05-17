/**
 * 触触搜 Popup - Toast 通知助手 (TypeScript port)
 *
 * 与 popup/modules/ToastHelper.js 1:1 行为对等。**零 chrome.* 依赖**。
 */

export type ToastType = "info" | "success" | "error" | "warning"

export interface ToastHelperOptions {
  duration?: number
  className?: string
}

export interface ShowOptions {
  duration?: number
  type?: ToastType
}

export class ToastHelper {
  duration: number
  className: string

  constructor(options: ToastHelperOptions = {}) {
    this.duration = options.duration ?? 2000
    this.className = options.className ?? "popup-toast"
  }

  show(message: string, options: ShowOptions = {}): void {
    if (!message) return
    const duration = options.duration ?? this.duration
    const type = options.type ?? "info"

    const toast = document.createElement("div")
    toast.className = `${this.className} ${this.className}-${type}`
    toast.textContent = message

    document.body.appendChild(toast)

    setTimeout(() => {
      toast.classList.add("fade-out")
      setTimeout(() => toast.remove(), 300)
    }, duration)
  }

  info(message: string): void { this.show(message, { type: "info" }) }
  success(message: string): void { this.show(message, { type: "success" }) }
  error(message: string): void { this.show(message, { type: "error" }) }
  warning(message: string): void { this.show(message, { type: "warning" }) }
}

export default ToastHelper
