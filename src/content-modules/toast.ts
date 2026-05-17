/**
 * Content script - Toast 模块 (TypeScript port)
 *
 * 与 modules/toast.js 1:1 行为对等。**零 chrome.* 依赖**（纯 DOM）。
 * 颜色 + z-index + 位置解析复用 `src/shared/Toast.ts` SSoT。
 */

import {
  TOAST_BRIGHT_COLORS,
  TOAST_Z_INDEX,
  resolvePositionCss,
  type ToastType
} from "../shared/Toast"

export interface ToastOptions {
  duration?: number
  position?: string
  animation?: boolean
}

export class CCSContentToast {
  defaultOptions: Required<ToastOptions> = {
    duration: 3000,
    position: "bottom-right",
    animation: true
  }

  show(message: string, options: ToastOptions = {}): HTMLElement {
    const config = { ...this.defaultOptions, ...options }
    const toast = document.createElement("div")
    toast.className = "ccs-toast"
    toast.textContent = message
    toast.style.cssText = `
      position: fixed;
      ${resolvePositionCss(config.position)}
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 20px;
      border-radius: 6px;
      font-size: 14px;
      z-index: ${TOAST_Z_INDEX};
      opacity: 0;
      transform: translateX(20px);
      transition: all 0.3s ease-out;
      max-width: 300px;
      word-wrap: break-word;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    `
    document.body.appendChild(toast)

    if (config.animation) {
      requestAnimationFrame(() => {
        toast.style.opacity = "1"
        toast.style.transform = "translateX(0)"
      })
    } else {
      toast.style.opacity = "1"
      toast.style.transform = "translateX(0)"
    }

    setTimeout(() => {
      if (config.animation) {
        toast.style.opacity = "0"
        toast.style.transform = "translateX(20px)"
        setTimeout(() => toast.parentNode && toast.remove(), 300)
      } else {
        toast.parentNode && toast.remove()
      }
    }, config.duration)

    return toast
  }

  private _withColor(type: ToastType, message: string, options: ToastOptions): HTMLElement {
    const toast = this.show(message, options)
    toast.style.background = TOAST_BRIGHT_COLORS[type]
    return toast
  }

  success(message: string, options: ToastOptions = {}): HTMLElement { return this._withColor("success", message, options) }
  error(message: string, options: ToastOptions = {}): HTMLElement { return this._withColor("error", message, options) }
  warning(message: string, options: ToastOptions = {}): HTMLElement { return this._withColor("warning", message, options) }
  info(message: string, options: ToastOptions = {}): HTMLElement { return this._withColor("info", message, options) }

  showContextMenuToast(message: string): void {
    const toast = document.createElement("div")
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 20px;
      border-radius: 6px;
      font-size: 14px;
      z-index: 2147483647;
      animation: slideIn 0.3s ease-out;
    `
    toast.textContent = message
    const style = document.createElement("style")
    style.textContent = `
      @keyframes slideIn {
        from { opacity: 0; transform: translateX(20px); }
        to { opacity: 1; transform: translateX(0); }
      }
    `
    document.head.appendChild(style)
    document.body.appendChild(toast)
    setTimeout(() => {
      toast.style.animation = "slideIn 0.3s ease-out reverse"
      setTimeout(() => {
        toast.remove()
        style.remove()
      }, 300)
    }, 3000)
  }

  clearAll(): void {
    const toasts = document.querySelectorAll(".ccs-toast")
    toasts.forEach((t) => t.parentNode && t.remove())
  }
}

export const Toast = new CCSContentToast()

export default Toast
