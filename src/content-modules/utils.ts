/**
 * Content script - Utils 模块 (TypeScript port)
 *
 * 与 modules/utils.js 1:1 行为对等。chrome.* 只在 safeChromeSendMessage 里，已做防御。
 */

export class CCSUtils {
  DEBUG_REQUEST_ID = 0

  safeChromeSendMessage(message: unknown): void {
    try {
      const ch = (globalThis as unknown as { chrome?: { runtime?: { id?: string; sendMessage?: (m: unknown) => void } } }).chrome
      if (ch?.runtime?.id && ch.runtime.sendMessage) {
        ch.runtime.sendMessage(message)
      }
    } catch (err) {
      console.warn("[触触搜] Chrome runtime 不可用:", (err as Error).message)
    }
  }

  escapeHtml(text: string): string {
    const div = document.createElement("div")
    div.textContent = text
    return div.innerHTML
  }

  getViewportQuadrant(x: number, y: number): "top-left" | "top-right" | "bottom-left" | "bottom-right" {
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const centerX = viewportWidth / 2
    const centerY = viewportHeight / 2
    if (x < centerX && y < centerY) return "top-left"
    if (x >= centerX && y < centerY) return "top-right"
    if (x < centerX && y >= centerY) return "bottom-left"
    return "bottom-right"
  }

  debounce<T extends (...args: unknown[]) => unknown>(func: T, wait: number): (...args: Parameters<T>) => void {
    let timeout: ReturnType<typeof setTimeout> | undefined
    return (...args: Parameters<T>) => {
      const later = () => {
        clearTimeout(timeout)
        func(...args)
      }
      clearTimeout(timeout)
      timeout = setTimeout(later, wait)
    }
  }

  throttle<T extends (...args: unknown[]) => unknown>(func: T, limit: number): (...args: Parameters<T>) => void {
    let inThrottle = false
    return function (this: unknown, ...args: Parameters<T>) {
      if (!inThrottle) {
        func.apply(this, args)
        inThrottle = true
        setTimeout(() => { inThrottle = false }, limit)
      }
    }
  }

  isValidUrl(s: string): boolean {
    try { new URL(s); return true } catch (_) { return false }
  }

  truncateText(text: string | null | undefined, maxLength: number = 50): string {
    if (!text) return ""
    return text.length > maxLength ? text.substring(0, maxLength) + "..." : text
  }

  getTimestamp(): number { return new Date().getTime() }

  deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== "object") return obj
    if (obj instanceof Date) return new Date(obj) as unknown as T
    if (Array.isArray(obj)) return obj.map((item) => this.deepClone(item)) as unknown as T
    const clonedObj: Record<string, unknown> = {}
    for (const key in obj as Record<string, unknown>) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        clonedObj[key] = this.deepClone((obj as Record<string, unknown>)[key])
      }
    }
    return clonedObj as T
  }

  mergeObjects(target: Record<string, unknown>, ...sources: Record<string, unknown>[]): Record<string, unknown> {
    if (!sources.length) return target
    const source = sources.shift()
    if (this.isObject(target) && this.isObject(source)) {
      for (const key in source!) {
        if (this.isObject(source![key])) {
          if (!target[key]) Object.assign(target, { [key]: {} })
          this.mergeObjects(target[key] as Record<string, unknown>, source![key] as Record<string, unknown>)
        } else {
          Object.assign(target, { [key]: source![key] })
        }
      }
    }
    return this.mergeObjects(target, ...sources)
  }

  isObject(item: unknown): item is Record<string, unknown> {
    return !!item && typeof item === "object" && !Array.isArray(item)
  }

  generateId(prefix: string = "ccs"): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  }

  waitForElement(selector: string, timeout: number = 5000): Promise<Element> {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector)
      if (element) { resolve(element); return }
      const observer = new MutationObserver((_mutations, obs) => {
        const el = document.querySelector(selector)
        if (el) { obs.disconnect(); resolve(el) }
      })
      observer.observe(document.body, { childList: true, subtree: true })
      setTimeout(() => {
        observer.disconnect()
        reject(new Error(`Element ${selector} not found within ${timeout}ms`))
      }, timeout)
    })
  }
}

export const Utils = new CCSUtils()

export default Utils
