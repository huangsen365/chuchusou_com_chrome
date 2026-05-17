/**
 * Content script - Settings 模块 (TypeScript port)
 *
 * 与 modules/settings.js 1:1 行为对等。chrome.storage 通过 globalThis.chrome 防御性访问。
 */

export interface SettingsShape {
  mode: "normal" | "mini" | "disabled" | string
  theme: string
  opacity: number
  position: { x?: number; y?: number; left?: number; top?: number } | null
  layout: "float" | "bottom" | string
  globalDock: boolean
  barClosed: boolean
  blacklist: string[]
  isBlacklisted: boolean
  miniButtons: string[]
  shortcutKey: string
  originalMode?: string
}

export type SettingsListener = (type: string, data: unknown) => void

interface ChromeLike {
  storage?: {
    local?: {
      get: (keys: string[], cb: (r: Record<string, unknown>) => void) => void
      set: (data: Record<string, unknown>, cb?: () => void) => void
    }
  }
}

function getChrome(): ChromeLike | null {
  return (globalThis as unknown as { chrome?: ChromeLike }).chrome || null
}

export class SettingsManager {
  defaults: SettingsShape = {
    mode: "normal",
    theme: "default",
    opacity: 1,
    position: null,
    layout: "float",
    globalDock: false,
    barClosed: false,
    blacklist: [],
    isBlacklisted: false,
    miniButtons: ["baidu", "google", "chuchusou", "copy", "lowercase"],
    shortcutKey: "Alt+S"
  }
  current: SettingsShape = { ...this.defaults }
  listeners: SettingsListener[] = []

  async init(): Promise<SettingsShape> {
    this.current = { ...this.defaults }
    await this.load()
    this.checkBlacklist()
    return this.current
  }

  load(): Promise<SettingsShape> {
    return new Promise((resolve) => {
      const ch = getChrome()
      if (!ch?.storage?.local?.get) {
        resolve(this.current)
        return
      }
      ch.storage.local.get(["ccs_settings", "ccs_debug"], (result) => {
        const settings = result.ccs_settings as Partial<SettingsShape> | undefined
        console.log("[触触搜] 加载设置:", settings)
        if (settings) {
          this.current = { ...this.current, ...settings }
          if (!Array.isArray(this.current.blacklist)) this.current.blacklist = []
          if (Array.isArray(this.current.miniButtons) && !this.current.miniButtons.includes("lowercase")) {
            this.current.miniButtons.push("lowercase")
            this.save()
          }
          try {
            if (this.current.globalDock && this.current.mode === "normal" && !this.current.barClosed) {
              this.current.layout = "bottom"
            }
          } catch (_) { /* noop */ }
        }

        const debugWin = window as unknown as { CCS_DEBUG?: boolean }
        if (typeof result.ccs_debug === "boolean") {
          debugWin.CCS_DEBUG = result.ccs_debug as boolean
        } else {
          ch.storage?.local?.set({ ccs_debug: false })
          debugWin.CCS_DEBUG = false
        }

        console.log("[触触搜] 合并后设置:", {
          globalDock: this.current.globalDock, layout: this.current.layout,
          barClosed: this.current.barClosed, mode: this.current.mode, blacklist: this.current.blacklist
        })

        resolve(this.current)
      })
    })
  }

  save(): void {
    console.log("[触触搜] 保存设置:", {
      globalDock: this.current.globalDock, layout: this.current.layout, barClosed: this.current.barClosed
    })
    const ch = getChrome()
    ch?.storage?.local?.set({ ccs_settings: this.current })
    this.notifyListeners("save", this.current)
  }

  update(updates: Partial<SettingsShape>): void {
    const oldSettings = { ...this.current }
    this.current = { ...this.current, ...updates }
    this.save()
    this.notifyListeners("update", { old: oldSettings, new: this.current })
  }

  get<K extends keyof SettingsShape>(key?: K): SettingsShape | SettingsShape[K] {
    return key ? this.current[key] : this.current
  }

  set<K extends keyof SettingsShape>(key: K, value: SettingsShape[K]): void {
    this.current[key] = value
    this.save()
  }

  checkBlacklist(): void {
    const hostname = window.location.hostname
    this.current.isBlacklisted = this.current.blacklist.some((domain) => {
      if (domain.startsWith("*.")) {
        const mainDomain = domain.slice(2)
        return hostname.endsWith(mainDomain) || hostname === mainDomain.slice(1)
      }
      return hostname === domain || hostname.endsWith("." + domain)
    })
    console.log("[触触搜] 黑名单检查:", { hostname, blacklist: this.current.blacklist, isBlacklisted: this.current.isBlacklisted })
  }

  addToBlacklist(domain: string): void {
    if (!this.current.blacklist.includes(domain)) {
      this.current.blacklist.push(domain)
      this.save()
      this.checkBlacklist()
    }
  }

  removeFromBlacklist(domain: string): void {
    const index = this.current.blacklist.indexOf(domain)
    if (index > -1) {
      this.current.blacklist.splice(index, 1)
      this.save()
      this.checkBlacklist()
    }
  }

  toggleBlacklist(): boolean {
    const hostname = window.location.hostname
    if (this.current.isBlacklisted) this.removeFromBlacklist(hostname)
    else this.addToBlacklist(hostname)
    return this.current.isBlacklisted
  }

  addListener(callback: SettingsListener): void { this.listeners.push(callback) }

  removeListener(callback: SettingsListener): void {
    const index = this.listeners.indexOf(callback)
    if (index > -1) this.listeners.splice(index, 1)
  }

  notifyListeners(type: string, data: unknown): void {
    this.listeners.forEach((callback) => {
      try { callback(type, data) } catch (e) { console.error("[触触搜] 设置监听器错误:", e) }
    })
  }

  reset(): void {
    this.current = { ...this.defaults }
    this.save()
  }

  export(): string { return JSON.stringify(this.current, null, 2) }

  import(jsonString: string): boolean {
    try {
      const imported = JSON.parse(jsonString)
      this.current = { ...this.defaults, ...imported }
      this.save()
      return true
    } catch (e) {
      console.error("[触触搜] 导入设置失败:", e)
      return false
    }
  }
}

export const Settings = new SettingsManager()

export default Settings
