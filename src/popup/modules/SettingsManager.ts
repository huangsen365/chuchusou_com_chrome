/**
 * Popup - 设置管理器 (TypeScript port)
 *
 * 与 popup/modules/SettingsManager.js 1:1 行为对等。chrome.* 通过 globalThis 防御性访问。
 */

import { PromptLibraryManager } from "./PromptLibraryManager"

export interface SettingsManagerOptions {
  onToast?: (msg: string) => void
}

interface ChromeLike {
  storage?: {
    local?: {
      get: (keys: string[], cb: (r: Record<string, unknown>) => void) => void
      set: (data: Record<string, unknown>, cb?: () => void) => void
    }
  }
  runtime?: { sendMessage?: (m: unknown) => Promise<unknown> }
  tabs?: {
    query: (q: { active?: boolean; currentWindow?: boolean } | Record<string, never>, cb: (tabs: Array<{ id?: number }>) => void) => void
    sendMessage?: (tabId: number, m: unknown) => Promise<void>
  }
}

function getChrome(): ChromeLike | null {
  return (globalThis as unknown as { chrome?: ChromeLike }).chrome || null
}

export class SettingsManager {
  onToast: (msg: string) => void
  promptLibraryManager: PromptLibraryManager | null = null

  constructor(options: SettingsManagerOptions = {}) {
    this.onToast = options.onToast || ((msg: string) => console.log(msg))
  }

  async init(): Promise<void> {
    this._initExtensionToggle()
    this._initDebugToggle()
    this._initVoiceToggle()
    this._initBlacklist()
    this._initShortcutSettings()
    this._initPromptLibrary()
    this._bindSettingButtons()
  }

  private _initVoiceToggle(): void {
    const ch = getChrome()
    ch?.storage?.local?.get(["ccs_voice_enabled"], (res) => {
      this._setVoiceButtonState(!!res.ccs_voice_enabled)
    })
  }

  toggleVoice(): void {
    const ch = getChrome()
    ch?.storage?.local?.get(["ccs_voice_enabled"], (res) => {
      const current = !!res.ccs_voice_enabled
      const next = !current
      ch.storage?.local?.set({ ccs_voice_enabled: next }, () => {
        this._setVoiceButtonState(next)
        this.onToast(next ? "语音功能已开启（实验性，需重开侧边栏生效）" : "语音功能已关闭")
      })
    })
  }

  private _setVoiceButtonState(enabled: boolean): void {
    const btn = document.querySelector<HTMLElement>('[data-action="voice"]')
    if (!btn) return
    const label = btn.querySelector<HTMLElement>(".setting-label")
    const icon = btn.querySelector<HTMLElement>(".setting-icon")
    if (icon) icon.textContent = "🎤"
    if (enabled) {
      if (label) label.textContent = "语音功能：开（实验性）"
      btn.style.background = "#fff8e1"
      btn.style.borderColor = "#fbc02d"
    } else {
      if (label) label.textContent = "语音功能：关"
      btn.style.background = ""
      btn.style.borderColor = ""
    }
  }

  private _initPromptLibrary(): void {
    this.promptLibraryManager = new PromptLibraryManager({ onToast: this.onToast })
    this.promptLibraryManager.init()
  }

  private _initExtensionToggle(): void {
    const ch = getChrome()
    ch?.storage?.local?.get(["enabled"], (result) => {
      const enabled = result.enabled !== false
      this._updateToggleButton(enabled)
    })
  }

  toggleExtension(): void {
    const ch = getChrome()
    ch?.storage?.local?.get(["enabled"], (result) => {
      const currentState = result.enabled !== false
      const newState = !currentState
      ch.storage?.local?.set({ enabled: newState }, () => {
        this._updateToggleButton(newState)
        this.onToast(newState ? "插件已启用" : "插件已禁用")
        ch.tabs?.query?.({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id != null) {
            ch.tabs?.sendMessage?.(tabs[0].id, { action: "toggleExtension", enabled: newState })?.catch(() => { /* noop */ })
          }
        })
      })
    })
  }

  private _updateToggleButton(enabled: boolean): void {
    const btn = document.querySelector<HTMLElement>('[data-action="toggle"]')
    if (!btn) return
    const icon = btn.querySelector<HTMLElement>(".setting-icon")
    const label = btn.querySelector<HTMLElement>(".setting-label")
    if (enabled) {
      if (icon) icon.textContent = "⚡"
      if (label) label.textContent = "点击禁用"
      btn.style.background = "#e8f5e9"
      btn.style.borderColor = "#4caf50"
    } else {
      if (icon) icon.textContent = "⭕"
      if (label) label.textContent = "点击启用"
      btn.style.background = "#ffebee"
      btn.style.borderColor = "#f44336"
    }
  }

  private _initDebugToggle(): void {
    const ch = getChrome()
    ch?.storage?.local?.get(["ccs_debug"], (res) => {
      this._setDebugButtonState(!!res.ccs_debug)
    })
  }

  toggleDebug(): void {
    const ch = getChrome()
    ch?.storage?.local?.get(["ccs_debug"], (res) => {
      const current = !!res.ccs_debug
      const next = !current
      ch.storage?.local?.set({ ccs_debug: next }, () => {
        this._setDebugButtonState(next)
        ch.runtime?.sendMessage?.({ action: "updateDebug", enabled: next })?.catch(() => { /* noop */ })
        ch.tabs?.query?.({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id != null) {
            ch.tabs?.sendMessage?.(tabs[0].id, { action: "updateDebug", enabled: next })?.catch(() => { /* noop */ })
          }
        })
        this.onToast(next ? "调试已开启" : "调试已关闭")
      })
    })
  }

  private _setDebugButtonState(enabled: boolean): void {
    const btn = document.querySelector<HTMLElement>('[data-action="debug"]')
    if (!btn) return
    const label = btn.querySelector<HTMLElement>(".setting-label")
    const icon = btn.querySelector<HTMLElement>(".setting-icon")
    if (icon) icon.textContent = "🐞"
    if (enabled) {
      if (label) label.textContent = "调试日志：开"
      btn.style.background = "#fff8e1"
      btn.style.borderColor = "#fbc02d"
    } else {
      if (label) label.textContent = "调试日志：关"
      btn.style.background = ""
      btn.style.borderColor = ""
    }
  }

  private _initBlacklist(): void {
    this.loadBlacklist()
    const clearBtn = document.querySelector<HTMLElement>(".clear-blacklist")
    if (clearBtn) clearBtn.onclick = () => this.clearAllBlacklist()
  }

  loadBlacklist(): void {
    const ch = getChrome()
    ch?.storage?.local?.get(["ccs_settings"], (result) => {
      const settings = (result.ccs_settings as { blacklist?: string[] }) || { blacklist: [] }
      const blacklist = settings.blacklist || []
      const countEl = document.querySelector<HTMLElement>(".blacklist-count")
      if (countEl) countEl.textContent = String(blacklist.length)
      const listEl = document.querySelector<HTMLElement>(".blacklist-list")
      if (!listEl) return
      if (blacklist.length === 0) {
        listEl.innerHTML = '<div class="blacklist-empty">黑名单为空</div>'
      } else {
        listEl.innerHTML = blacklist
          .map((host) => `
            <div class="blacklist-item" data-host="${host}">
              <span class="blacklist-host">${host}</span>
              <button class="blacklist-remove" data-host="${host}">移除</button>
            </div>
          `)
          .join("")
        listEl.querySelectorAll<HTMLElement>(".blacklist-remove").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            const host = (e.target as HTMLElement).dataset.host
            if (host) this.removeFromBlacklist(host)
          })
        })
      }
    })
  }

  removeFromBlacklist(host: string): void {
    const ch = getChrome()
    ch?.storage?.local?.get(["ccs_settings"], (result) => {
      const settings = (result.ccs_settings as { blacklist: string[] }) || { blacklist: [] }
      const index = settings.blacklist.indexOf(host)
      if (index > -1) {
        settings.blacklist.splice(index, 1)
        ch.storage?.local?.set({ ccs_settings: settings }, () => {
          this.onToast(`已移除: ${host}`)
          this.loadBlacklist()
          ch.tabs?.query?.({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id != null) {
              ch.tabs?.sendMessage?.(tabs[0].id, { action: "updateBlacklist", blacklist: settings.blacklist })?.catch(() => { /* noop */ })
            }
          })
        })
      }
    })
  }

  clearAllBlacklist(): void {
    if (!confirm("确定要清空所有黑名单吗？")) return
    const ch = getChrome()
    ch?.storage?.local?.get(["ccs_settings"], (result) => {
      const settings = (result.ccs_settings as { blacklist?: string[] }) || {}
      settings.blacklist = []
      ch.storage?.local?.set({ ccs_settings: settings }, () => {
        this.onToast("黑名单已清空")
        this.loadBlacklist()
        ch.tabs?.query?.({}, (tabs) => {
          tabs.forEach((tab) => {
            if (tab.id != null) {
              ch.tabs?.sendMessage?.(tab.id, { action: "updateBlacklist", blacklist: [] })?.catch(() => { /* noop */ })
            }
          })
        })
      })
    })
  }

  private _initShortcutSettings(): void {
    const ch = getChrome()
    ch?.storage?.local?.get(["ccs_settings"], (result) => {
      const settings = (result.ccs_settings as { shortcutKey?: string }) || {}
      const shortcutKey = settings.shortcutKey || "Alt+S"
      const select = document.querySelector<HTMLSelectElement>(".shortcut-key-select")
      if (select) select.value = shortcutKey
    })
    const saveBtn = document.querySelector<HTMLElement>(".save-shortcut")
    saveBtn?.addEventListener("click", () => this.saveShortcutSettings())
  }

  saveShortcutSettings(): void {
    const select = document.querySelector<HTMLSelectElement>(".shortcut-key-select")
    if (!select) return
    const newShortcut = select.value
    const ch = getChrome()
    ch?.storage?.local?.get(["ccs_settings"], (result) => {
      const settings = (result.ccs_settings as { shortcutKey?: string }) || {}
      settings.shortcutKey = newShortcut
      ch.storage?.local?.set({ ccs_settings: settings }, () => {
        this.onToast("快捷键已更新为: " + newShortcut)
        ch.tabs?.query?.({}, (tabs) => {
          tabs.forEach((tab) => {
            if (tab.id != null) {
              ch.tabs?.sendMessage?.(tab.id, { action: "updateShortcut", shortcutKey: newShortcut })?.catch(() => { /* noop */ })
            }
          })
        })
      })
    })
  }

  private _bindSettingButtons(): void {
    document.querySelectorAll<HTMLElement>(".setting-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const action = (e.currentTarget as HTMLElement).dataset.action
        if (action) this.handleSettingAction(action)
      })
    })
  }

  handleSettingAction(action: string): void {
    switch (action) {
      case "toggle": this.toggleExtension(); break
      case "blacklist": this.toggleSection("blacklistSection"); break
      case "debug": this.toggleDebug(); break
      case "voice": this.toggleVoice(); break
      case "export-menu-state": this.exportMenuState(); break
      case "shortcut-settings": this.toggleSection("shortcutSection"); break
      case "prompt-library": this.toggleSection("promptLibrarySection"); break
    }
  }

  toggleSection(sectionId: string): void {
    const sections = ["blacklistSection", "shortcutSection", "debugSection", "promptLibrarySection"]
    const targetSection = document.getElementById(sectionId)
    if (!targetSection) return
    const isHidden = targetSection.style.display === "none"
    sections.forEach((id) => {
      const el = document.getElementById(id)
      if (el) el.style.display = "none"
    })
    if (isHidden) {
      targetSection.style.display = "block"
      if (sectionId === "blacklistSection") this.loadBlacklist()
      if (sectionId === "promptLibrarySection" && this.promptLibraryManager) {
        this.promptLibraryManager.renderList()
      }
    }
  }

  async exportMenuState(): Promise<void> {
    const btn = document.querySelector<HTMLElement>('[data-action="export-menu-state"]')
    if (btn) {
      ;(btn as HTMLButtonElement).disabled = true
      const label = btn.querySelector<HTMLElement>(".setting-label")
      if (label) label.textContent = "获取中..."
    }
    try {
      const ch = getChrome()
      if (!ch?.tabs?.query || !ch.runtime?.sendMessage) return
      const [tab] = await new Promise<Array<{ id?: number }>>((resolve) => {
        ch.tabs!.query({ active: true, currentWindow: true }, resolve)
      })
      ch.runtime.sendMessage({ action: "getMenuDebugInfo", tabId: tab?.id })
        .then((response) => {
          const r = response as { success?: boolean; data?: unknown } | null | undefined
          if (r?.success) this.showMenuDebugInfo(r.data)
          else this.onToast("获取菜单状态失败")
          if (btn) {
            ;(btn as HTMLButtonElement).disabled = false
            const label = btn.querySelector<HTMLElement>(".setting-label")
            if (label) label.textContent = "导出菜单状态"
          }
        })
        .catch(() => {
          this.onToast("获取菜单状态失败")
          if (btn) {
            ;(btn as HTMLButtonElement).disabled = false
            const label = btn.querySelector<HTMLElement>(".setting-label")
            if (label) label.textContent = "导出菜单状态"
          }
        })
    } catch (_) {
      this.onToast("获取菜单状态失败")
      if (btn) {
        ;(btn as HTMLButtonElement).disabled = false
        const label = btn.querySelector<HTMLElement>(".setting-label")
        if (label) label.textContent = "导出菜单状态"
      }
    }
  }

  showMenuDebugInfo(data: unknown): void {
    const debugSection = document.getElementById("debugSection")
    const textEl = document.querySelector<HTMLElement>(".menu-debug-text")
    if (!debugSection || !textEl) return
    const formatted = JSON.stringify(data, null, 2)
    textEl.textContent = formatted
    const bl = document.getElementById("blacklistSection")
    const sc = document.getElementById("shortcutSection")
    if (bl) bl.style.display = "none"
    if (sc) sc.style.display = "none"
    debugSection.style.display = "block"
    navigator.clipboard.writeText(formatted).then(() => {
      this.onToast("菜单状态已复制到剪贴板")
    }).catch(() => { /* noop */ })

    const copyBtn = document.querySelector<HTMLElement>(".copy-debug-info")
    const closeBtn = document.querySelector<HTMLElement>(".close-debug-info")
    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(formatted).then(() => {
          this.onToast("已复制到剪贴板")
        }).catch(() => { this.onToast("复制失败") })
      }
    }
    if (closeBtn) {
      closeBtn.onclick = () => { debugSection.style.display = "none" }
    }
  }
}

export default SettingsManager
