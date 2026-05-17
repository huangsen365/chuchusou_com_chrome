/**
 * Content script - SettingsPanel 模块 (TypeScript port)
 *
 * 与 modules/settingsPanel.js 1:1 行为对等。chrome.storage / chrome.runtime 通过 globalThis 防御性访问。
 */

import type { ContentSettingsShape } from "./stateManager"

export interface SettingsPanelCallbacks {
  onBarEnableChange?: (enabled: boolean, settings: ContentSettingsShape) => void
  onDebugToggle?: (enabled: boolean) => void
  onGlobalDockChange?: (enabled: boolean, settings: ContentSettingsShape) => void
  onShortcutChange?: (key: string) => void
  onModeChange?: (mode: string, settings: ContentSettingsShape) => void
  onOpacityChange?: (opacity: number) => void
  onBlacklistToggle?: () => boolean
}

interface ChromeLike {
  storage?: { local?: { set: (data: Record<string, unknown>) => void } }
  runtime?: { sendMessage?: (m: unknown) => void }
}

interface WindowExtras {
  CCS_DEBUG?: boolean
  showToast?: (m: string) => void
  CCSModules?: {
    Toast?: { show?: (m: string) => void }
    BackgroundComm?: { updateDebugStatus?: (b: boolean) => void }
  }
}

function getChrome(): ChromeLike | null {
  return (globalThis as unknown as { chrome?: ChromeLike }).chrome || null
}

export class SettingsPanelManager {
  generateHTML(settings: ContentSettingsShape): string {
    const w = window as unknown as WindowExtras
    return `
      <div class="ccs-settings-panel" style="display: none;">
        <h3>设置</h3>
        <div class="setting-item">
          <label>调试日志：</label>
          <input type="checkbox" class="debug-toggle" ${w.CCS_DEBUG ? "checked" : ""}>
        </div>
        <div class="setting-item">
          <label>显示模式：</label>
          <select class="mode-select">
            <option value="normal">普通</option>
            <option value="mini">迷你</option>
            <option value="disabled">禁用</option>
          </select>
        </div>
        <div class="setting-item">
          <label>透明度：</label>
          <input type="range" class="opacity-slider" min="0.3" max="1" step="0.1" value="${settings.opacity}">
          <span class="opacity-value">${Math.round(settings.opacity * 100)}%</span>
        </div>
        <div class="setting-item">
          <label>启用底部栏：</label>
          <input type="checkbox" class="bar-enable-toggle" ${!settings.barClosed ? "checked" : ""}>
        </div>
        <div class="setting-item">
          <label>底部栏（全局）：</label>
          <input type="checkbox" class="global-dock-toggle" ${settings.globalDock ? "checked" : ""}>
        </div>
        <div class="setting-item">
          <label>快捷键：</label>
          <select class="shortcut-select">
            <option value="Alt+S" ${settings.shortcutKey === "Alt+S" ? "selected" : ""}>Alt+S（默认）</option>
            <option value="Ctrl+Shift+S" ${settings.shortcutKey === "Ctrl+Shift+S" ? "selected" : ""}>Ctrl+Shift+S</option>
            <option value="Alt+Shift+S" ${settings.shortcutKey === "Alt+Shift+S" ? "selected" : ""}>Alt+Shift+S</option>
            <option value="Ctrl+Alt+S" ${settings.shortcutKey === "Ctrl+Alt+S" ? "selected" : ""}>Ctrl+Alt+S</option>
            <option value="Alt+Q" ${settings.shortcutKey === "Alt+Q" ? "selected" : ""}>Alt+Q</option>
            <option value="Alt+E" ${settings.shortcutKey === "Alt+E" ? "selected" : ""}>Alt+E</option>
          </select>
        </div>
        <div class="setting-item">
          <label>黑名单：</label>
          <button class="toggle-blacklist-btn">
            ${settings.isBlacklisted ? "移出黑名单" : "加入黑名单"}
          </button>
        </div>
      </div>
    `
  }

  toggle(shadowRoot: ShadowRoot | null | undefined): boolean {
    const panel = shadowRoot?.querySelector<HTMLElement>(".ccs-settings-panel")
    if (panel) {
      panel.style.display = panel.style.display === "none" ? "block" : "none"
      return panel.style.display === "block"
    }
    return false
  }

  bindEvents(
    shadowRoot: ShadowRoot | null | undefined,
    settings: ContentSettingsShape,
    callbacks: SettingsPanelCallbacks = {}
  ): void {
    const panel = shadowRoot?.querySelector<HTMLElement>(".ccs-settings-panel")
    if (!panel) return

    const w = window as unknown as WindowExtras

    const barEnableCheckbox = panel.querySelector<HTMLInputElement>(".bar-enable-toggle")
    if (barEnableCheckbox) {
      barEnableCheckbox.addEventListener("change", (e) => {
        const enable = (e.target as HTMLInputElement).checked
        settings.barClosed = !enable
        callbacks.onBarEnableChange?.(enable, settings)
      })
    }

    const debugToggle = panel.querySelector<HTMLInputElement>(".debug-toggle")
    if (debugToggle) {
      debugToggle.addEventListener("change", (e) => {
        const enabled = !!(e.target as HTMLInputElement).checked
        w.CCS_DEBUG = enabled
        getChrome()?.storage?.local?.set({ ccs_debug: enabled })
        callbacks.onDebugToggle?.(enabled)
        this.showToast(enabled ? "调试已开启" : "调试已关闭")
        console.log(`[触触搜] 调试日志已${enabled ? "开启" : "关闭"}。可在设置中随时切换。`)
        if (w.CCSModules?.BackgroundComm?.updateDebugStatus) {
          w.CCSModules.BackgroundComm.updateDebugStatus(enabled)
        } else {
          try { getChrome()?.runtime?.sendMessage?.({ action: "updateDebug", enabled }) } catch (_) { /* noop */ }
        }
      })
    }

    const globalDockCheckbox = panel.querySelector<HTMLInputElement>(".global-dock-toggle")
    if (globalDockCheckbox) {
      globalDockCheckbox.addEventListener("change", (e) => {
        const checked = (e.target as HTMLInputElement).checked
        settings.globalDock = checked
        callbacks.onGlobalDockChange?.(checked, settings)
      })
    }

    const shortcutSelect = panel.querySelector<HTMLSelectElement>(".shortcut-select")
    if (shortcutSelect) {
      shortcutSelect.addEventListener("change", (e) => {
        const value = (e.target as HTMLSelectElement).value
        settings.shortcutKey = value
        callbacks.onShortcutChange?.(value)
        this.showToast("快捷键已更改为: " + settings.shortcutKey)
      })
    }

    const modeSelect = panel.querySelector<HTMLSelectElement>(".mode-select")
    if (modeSelect) {
      modeSelect.value = settings.mode
      modeSelect.addEventListener("change", (e) => {
        const newMode = (e.target as HTMLSelectElement).value
        if (newMode === "disabled") {
          if (confirm("禁用后需要在Chrome扩展管理页重新启用，确定要禁用吗？")) {
            settings.mode = newMode
            callbacks.onModeChange?.(newMode, settings)
          } else {
            modeSelect.value = settings.mode
          }
        } else {
          settings.mode = newMode
          callbacks.onModeChange?.(newMode, settings)
        }
      })
    }

    const opacitySlider = panel.querySelector<HTMLInputElement>(".opacity-slider")
    const opacityValue = panel.querySelector<HTMLElement>(".opacity-value")
    if (opacitySlider) {
      opacitySlider.addEventListener("input", (e) => {
        const value = parseFloat((e.target as HTMLInputElement).value)
        settings.opacity = value
        if (opacityValue) opacityValue.textContent = Math.round(value * 100) + "%"
        callbacks.onOpacityChange?.(value)
      })
    }

    const blacklistBtn = panel.querySelector<HTMLButtonElement>(".toggle-blacklist-btn")
    if (blacklistBtn) {
      blacklistBtn.addEventListener("click", () => {
        if (callbacks.onBlacklistToggle) {
          const newState = callbacks.onBlacklistToggle()
          blacklistBtn.textContent = newState ? "移出黑名单" : "加入黑名单"
        }
      })
    }
  }

  showToast(message: string): void {
    const w = window as unknown as WindowExtras
    if (w.showToast) w.showToast(message)
    else if (w.CCSModules?.Toast?.show) w.CCSModules.Toast.show(message)
    else console.log("[触触搜]", message)
  }

  updateBlacklistButton(shadowRoot: ShadowRoot | null | undefined, isBlacklisted: boolean): void {
    const btn = shadowRoot?.querySelector<HTMLButtonElement>(".toggle-blacklist-btn")
    if (btn) btn.textContent = isBlacklisted ? "移出黑名单" : "加入黑名单"
  }

  updateModeSelect(shadowRoot: ShadowRoot | null | undefined, mode: string): void {
    const select = shadowRoot?.querySelector<HTMLSelectElement>(".mode-select")
    if (select) select.value = mode
  }

  updateOpacityDisplay(shadowRoot: ShadowRoot | null | undefined, opacity: number): void {
    const slider = shadowRoot?.querySelector<HTMLInputElement>(".opacity-slider")
    const value = shadowRoot?.querySelector<HTMLElement>(".opacity-value")
    if (slider) slider.value = String(opacity)
    if (value) value.textContent = Math.round(opacity * 100) + "%"
  }

  getStyles(): string {
    return `
      .ccs-settings-panel {
        position: absolute; top: 100%; left: 0; right: 0;
        background: white; border: 1px solid #e0e0e0; border-radius: 0 0 8px 8px;
        padding: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        max-height: 300px; overflow-y: auto;
      }
      .ccs-settings-panel h3 { margin: 0 0 10px 0; font-size: 14px; color: #333; }
      .setting-item { display: flex; align-items: center; margin-bottom: 8px; font-size: 12px; }
      .setting-item label { flex: 0 0 100px; color: #666; }
      .setting-item input[type="checkbox"], .setting-item select, .setting-item input[type="range"] { margin: 0; }
      .setting-item .opacity-value { margin-left: 8px; color: #666; min-width: 35px; }
      .setting-item button {
        padding: 4px 12px; border: 1px solid #ddd; border-radius: 4px;
        background: white; color: #333; cursor: pointer; font-size: 12px;
      }
      .setting-item button:hover { background: #f0f0f0; }
      .mini-mode .ccs-settings-panel { font-size: 11px; }
      .mini-mode .setting-item label { flex: 0 0 80px; }
      .docked-bottom .ccs-settings-panel {
        position: fixed; top: auto; bottom: 60px; left: 50%; transform: translateX(-50%);
        width: 350px; max-width: 90%; border-radius: 8px; box-shadow: 0 -4px 12px rgba(0,0,0,0.15);
      }
    `
  }
}

export const SettingsPanel = new SettingsPanelManager()

export default SettingsPanel
