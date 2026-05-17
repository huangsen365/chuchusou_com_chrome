/**
 * Content script - Blacklist 模块 (TypeScript port)
 *
 * 与 modules/blacklist.js 1:1 行为对等。**零 chrome.* 依赖**（用 window.location.hostname）。
 */

export interface BlacklistSettings {
  blacklist?: string[]
  mode?: string
  isBlacklisted?: boolean
  originalMode?: string
}

export interface BlacklistStatus {
  hostname: string
  isBlacklisted: boolean
  originalMode: string
}

export class BlacklistManager {
  list: string[] = []
  isBlacklisted = false
  originalMode = "normal"

  init(settings: BlacklistSettings): void {
    this.list = settings.blacklist || []
    this.check(settings)
  }

  check(settings: BlacklistSettings): boolean {
    const currentHost = window.location.hostname
    if (this.list && this.list.includes(currentHost)) {
      this.isBlacklisted = true
      settings.isBlacklisted = true
      this.originalMode = settings.mode || "normal"
      settings.originalMode = this.originalMode
      settings.mode = "disabled"
      console.log("[触触搜] 网站在黑名单中，禁用功能:", currentHost)
      return true
    }
    this.isBlacklisted = false
    settings.isBlacklisted = false
    console.log("[触触搜] 网站不在黑名单中:", currentHost)
    return false
  }

  add(hostname: string): boolean {
    if (!this.list.includes(hostname)) {
      this.list.push(hostname)
      console.log("[触触搜] 添加到黑名单:", hostname)
      return true
    }
    return false
  }

  remove(hostname: string): boolean {
    const index = this.list.indexOf(hostname)
    if (index > -1) {
      this.list.splice(index, 1)
      console.log("[触触搜] 从黑名单移除:", hostname)
      return true
    }
    return false
  }

  toggle(settings: BlacklistSettings, saveCallback?: () => void): boolean {
    const currentHost = window.location.hostname
    if (this.isBlacklisted) {
      this.remove(currentHost)
      this.isBlacklisted = false
      settings.isBlacklisted = false
      settings.mode = this.originalMode || "normal"
      delete settings.originalMode
      console.log("[触触搜] 网站已从黑名单移除，恢复模式:", settings.mode)
    } else {
      this.add(currentHost)
      this.isBlacklisted = true
      settings.isBlacklisted = true
      this.originalMode = settings.mode || "normal"
      settings.originalMode = this.originalMode
      settings.mode = "disabled"
      console.log("[触触搜] 网站已添加到黑名单，禁用功能")
    }
    settings.blacklist = this.list
    if (typeof saveCallback === "function") saveCallback()
    return this.isBlacklisted
  }

  getCurrentStatus(): BlacklistStatus {
    return {
      hostname: window.location.hostname,
      isBlacklisted: this.isBlacklisted,
      originalMode: this.originalMode
    }
  }

  clear(): void {
    this.list = []
    this.isBlacklisted = false
    console.log("[触触搜] 黑名单已清空")
  }

  getList(): string[] { return [...this.list] }

  setList(newList: unknown): boolean {
    if (Array.isArray(newList)) {
      this.list = [...newList]
      return true
    }
    return false
  }

  contains(hostname: string): boolean {
    return this.list.includes(hostname)
  }
}

export const Blacklist = new BlacklistManager()

export default Blacklist
