/**
 * 触触搜 - Toast 通知组件 (TypeScript port)
 *
 * 与 content/ToastUI.js 1:1 行为对等。**零 chrome.* 依赖**（纯 DOM API）。
 * 颜色 + 位置 + z-index + 字体栈复用 `src/shared/Toast.ts` SSoT。
 */

import {
  type ToastType,
  type ToastPosition,
  TOAST_INLINE_COLORS,
  TOAST_POSITION_CSS,
  TOAST_Z_INDEX,
  TOAST_FONT_FAMILY
} from "../shared/Toast"

export type { ToastType, ToastPosition }

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
    const { bg, color } = TOAST_INLINE_COLORS[type] || TOAST_INLINE_COLORS.info
    const positionStyles = TOAST_POSITION_CSS[this.position] || TOAST_POSITION_CSS["bottom-right"]

    toast.style.cssText = `
      position: fixed;
      ${positionStyles}
      background: ${bg};
      color: ${color};
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-family: ${TOAST_FONT_FAMILY};
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: ${TOAST_Z_INDEX};
      opacity: 0;
      transform: translateY(10px);
      transition: opacity 0.2s ease, transform 0.2s ease;
      max-width: 300px;
      word-wrap: break-word;
      pointer-events: none;
    `
  }
}

export const defaultToast = new Toast()

export default Toast
