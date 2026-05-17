/**
 * Content script - RecoveryPopover 模块 (TypeScript port)
 *
 * 与 modules/recoveryPopover.js 1:1 行为对等。**零 chrome.* 依赖**。
 */

export interface RecoveryPopoverOptions {
  onRemoveFromBlacklist?: () => void
  onTempEnable?: () => void
  onClose?: () => void
}

export interface RecoverySettings {
  isBlacklisted?: boolean
  mode?: string
  originalMode?: string
  blacklist?: string[]
}

interface GlobalContent {
  popover?: HTMLElement
  shadowRoot?: ShadowRoot
  showToast?: (m: string) => void
  CCSModules?: {
    TextSync?: { setShadowRoot?: (s: ShadowRoot) => void }
    Blacklist?: { remove?: (h: string) => boolean; getList?: () => string[] }
    Toast?: { show?: (m: string) => void }
  }
}

export class RecoveryPopoverManager {
  show(x: number, y: number, options: RecoveryPopoverOptions = {}): HTMLElement {
    const w = window as unknown as GlobalContent
    if (w.popover) w.popover.remove()

    const popover = document.createElement("div")
    popover.id = "ccs-popover-container"
    popover.style.position = "absolute"
    popover.style.zIndex = "2147483647"
    popover.style.left = `${x}px`
    popover.style.top = `${y}px`

    const shadowRoot = popover.attachShadow({ mode: "open" })

    if (w.CCSModules?.TextSync?.setShadowRoot) {
      w.CCSModules.TextSync.setShadowRoot(shadowRoot)
    }

    const wrapper = document.createElement("div")
    wrapper.className = "ccs-recovery-popover"
    wrapper.innerHTML = `
      <div class="ccs-header recovery">
        <span class="ccs-title">🔍 触触搜 - 已禁用</span>
        <button class="ccs-close">✕</button>
      </div>
      <div class="ccs-recovery-content">
        <div class="ccs-message">
          <span class="icon">🚫</span>
          <p>当前网站 <strong>${window.location.hostname}</strong> 在黑名单中</p>
        </div>
        <div class="ccs-recovery-actions">
          <button class="ccs-remove-blacklist">移出黑名单并启用</button>
          <button class="ccs-temp-enable">临时启用（本次）</button>
        </div>
        <div class="ccs-recovery-tips">
          💡 提示：<kbd>Alt+S</kbd> 或 <kbd>Alt+右键</kbd> 快速唤起
        </div>
      </div>
    `

    const style = document.createElement("style")
    style.textContent = this.getStyles()

    shadowRoot.appendChild(style)
    shadowRoot.appendChild(wrapper)

    shadowRoot.querySelector(".ccs-close")?.addEventListener("click", () => {
      popover.remove()
      options.onClose?.()
    })
    shadowRoot.querySelector(".ccs-remove-blacklist")?.addEventListener("click", () => {
      options.onRemoveFromBlacklist?.()
      popover.remove()
    })
    shadowRoot.querySelector(".ccs-temp-enable")?.addEventListener("click", () => {
      options.onTempEnable?.()
      popover.remove()
    })

    document.body.appendChild(popover)
    ;(window as unknown as GlobalContent).popover = popover
    ;(window as unknown as GlobalContent).shadowRoot = shadowRoot

    return popover
  }

  getStyles(): string {
    return `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      .ccs-recovery-popover {
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        width: 280px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        font-size: 14px;
        color: #333;
        overflow: hidden;
        animation: fadeIn 0.2s ease-out;
      }
      @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
      .ccs-header.recovery {
        background: linear-gradient(135deg, #f56565 0%, #c53030 100%);
        color: white; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center;
      }
      .ccs-title { font-weight: bold; font-size: 14px; }
      .ccs-close {
        background: none; border: none; color: white; cursor: pointer; font-size: 16px; padding: 0;
        width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
        border-radius: 4px; transition: background-color 0.2s;
      }
      .ccs-close:hover { background-color: rgba(255,255,255,0.2); }
      .ccs-recovery-content { padding: 15px; }
      .ccs-message { text-align: center; margin-bottom: 15px; }
      .ccs-message .icon { font-size: 32px; display: block; margin-bottom: 8px; }
      .ccs-message p { font-size: 13px; color: #4a5568; }
      .ccs-message strong { color: #2d3748; }
      .ccs-recovery-actions { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
      .ccs-recovery-actions button {
        padding: 8px 12px; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; transition: all 0.2s;
      }
      .ccs-remove-blacklist { background: #48bb78; color: white; }
      .ccs-remove-blacklist:hover { background: #38a169; }
      .ccs-temp-enable { background: #f7fafc; color: #4a5568; border: 1px solid #e2e8f0; }
      .ccs-temp-enable:hover { background: #edf2f7; border-color: #cbd5e0; }
      .ccs-recovery-tips { font-size: 11px; color: #718096; text-align: center; padding-top: 10px; border-top: 1px solid #e2e8f0; }
      kbd { background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 3px; padding: 2px 4px; font-family: monospace; font-size: 10px; }
    `
  }

  handleRemoveFromBlacklist(settings: RecoverySettings, saveCallback?: () => void): boolean {
    const w = window as unknown as GlobalContent
    const currentHost = window.location.hostname

    if (w.CCSModules?.Blacklist?.remove) {
      w.CCSModules.Blacklist.remove(currentHost)
      settings.isBlacklisted = false
      settings.mode = settings.originalMode || "normal"
      settings.blacklist = w.CCSModules.Blacklist.getList?.()
    } else if (settings.blacklist) {
      const index = settings.blacklist.indexOf(currentHost)
      if (index > -1) {
        settings.blacklist.splice(index, 1)
        settings.isBlacklisted = false
        settings.mode = settings.originalMode || "normal"
      }
    }

    saveCallback?.()

    if (w.showToast) w.showToast("已移出黑名单，插件已启用")
    else if (w.CCSModules?.Toast?.show) w.CCSModules.Toast.show("已移出黑名单，插件已启用")

    return true
  }

  handleTempEnable(settings: RecoverySettings): boolean {
    settings.mode = "normal"
    console.log("[触触搜] 临时启用插件（不保存）")
    return true
  }
}

export const RecoveryPopover = new RecoveryPopoverManager()

export default RecoveryPopover
