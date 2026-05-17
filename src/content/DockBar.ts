/**
 * 触触搜 - 底部停靠栏模块 (TypeScript port)
 *
 * 与 dockbar.js 1:1 行为对等。**零 chrome.* 依赖**（纯 DOM + 状态）。
 *
 * 原 IIFE 写法导出 `window.DockBar` 单例（object literal with methods）。
 * 这里 port 成 class + 默认导出 singleton。生产仍跑 legacy dockbar.js；
 * 当 manifest 切到 Plasmo content script entry 时，本 TS 版本接管。
 */

export interface DockBarSettings {
  globalDock: boolean
  layout: "float" | "bottom" | string
  mode: "normal" | "mini" | string
  isBlacklisted?: boolean
  position?: { x?: number; y?: number } | null
  barClosed?: boolean
}

export interface DockBarCallbacks {
  onEnableGlobalDock?: () => void
  onEnableTempDock?: () => void
  onUndock?: () => void
  onClose?: () => void
  onInitDockBar?: () => void
  onEnsureVisible?: (force: boolean) => void
}

export interface DockBarStateSnapshot {
  globalDock: boolean
  layout: string
  barClosed?: boolean
  isTempDock: boolean
  isVisible: boolean
}

interface InternalState {
  isInitialized: boolean
  isTempDock: boolean
  isVisible: boolean
  container: HTMLElement | null
  shadowRoot: ShadowRoot | null
}

export class DockBar {
  state: InternalState = {
    isInitialized: false,
    isTempDock: false,
    isVisible: false,
    container: null,
    shadowRoot: null
  }

  settings: DockBarSettings | null = null
  callbacks: DockBarCallbacks = {}

  init(settings: DockBarSettings, callbacks: DockBarCallbacks = {}): void {
    this.settings = settings
    this.callbacks = callbacks
    this.state.isInitialized = true
    console.log("[DockBar] 初始化完成")
  }

  createDockBarHTML(_displayText: string, _buttons: unknown): string {
    const s = this.settings as DockBarSettings
    const badgeHtml = s.globalDock
      ? '<span class="ccs-global-badge" title="悬停模式（全局）">全局</span>'
      : this.state.isTempDock
        ? '<span class="ccs-temp-badge" title="悬停模式（临时）">临时</span>'
        : ""

    return `
        <div class="ccs-bottom" data-draggable="false">
          <div class="ccs-bottom-buttons"></div>
          <div class="ccs-bottom-controls">
            ${badgeHtml}
            <button class="ccs-close-bottom" title="关闭底部栏">✕</button>
            <button class="ccs-undock" title="悬浮模式">↕️</button>
          </div>
        </div>
      `
  }

  getStyles(): string {
    return `
        /* 底部停靠模式 */
        .ccs-popover.docked-bottom {
          width: 100vw;
          border-radius: 8px 8px 0 0;
          pointer-events: auto;
        }

        .ccs-bottom {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 16px;
          background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
          color: white;
        }

        .ccs-bottom-buttons {
          flex: 1;
          display: flex;
          gap: 8px;
          overflow-x: auto;
          scrollbar-width: thin;
        }

        .ccs-bottom-controls {
          margin-left: 8px;
          flex-shrink: 0;
        }

        .ccs-undock {
          background: rgba(255,255,255,0.2);
          border: none;
          color: white;
          font-size: 14px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
        }

        .ccs-undock:hover {
          background: rgba(255,255,255,0.3);
        }

        .ccs-close-bottom {
          background: transparent;
          border: none;
          color: white;
          font-size: 18px;
          cursor: pointer;
          padding: 4px;
          margin-right: 8px;
        }

        .ccs-close-bottom:hover {
          background: rgba(255,255,255,0.2);
          border-radius: 4px;
        }

        .ccs-global-badge {
          display: inline-block;
          background: rgba(255,255,255,0.85);
          color: #4c51bf;
          font-size: 10px;
          font-weight: bold;
          border-radius: 8px;
          padding: 2px 6px;
          margin-right: 6px;
        }

        .ccs-temp-badge {
          display: inline-block;
          background: rgba(255,255,255,0.85);
          color: #2b6cb0;
          font-size: 10px;
          font-weight: bold;
          border-radius: 8px;
          padding: 2px 6px;
          margin-right: 6px;
        }

        .docked-bottom .ccs-header {
          cursor: default;
        }

        .docked-bottom .ccs-buttons { display: none; }
        .docked-bottom .ccs-mini-buttons { display: none; }

        /* 压缩按钮风格（底部栏） */
        .docked-bottom .ccs-button {
          flex: 0 0 auto;
          min-width: 64px;
          padding: 6px 6px;
          border: 1px solid rgba(226, 232, 240, 0.8);
          background: rgba(247, 250, 252, 0.9);
        }

        .docked-bottom .ccs-button-icon {
          font-size: 16px;
        }

        .docked-bottom .ccs-button-label {
          font-size: 9px;
          color: #2d3748;
        }

        /* Dock 菜单样式 */
        .ccs-dock-menu {
          position: absolute;
          right: 0;
          top: 30px;
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          padding: 4px;
          min-width: 150px;
          display: none;
          z-index: 9999;
        }

        .ccs-header-buttons:hover .ccs-dock-menu {
          display: block;
        }

        .ccs-dock-menu button {
          display: block;
          width: 160px;
          text-align: left;
          padding: 8px 12px;
          background: white;
          color: #2d3748;
          border: 1px solid transparent;
          border-radius: 4px;
          font-size: 12px;
          transition: all 0.2s;
          margin: 4px 0;
          cursor: pointer;
        }

        .ccs-dock-menu button:hover {
          background: #f7fafc;
        }

        .ccs-dock-shortcut {
          display: block;
          width: 160px;
          padding: 8px;
          color: #718096;
          font-size: 10px;
          text-align: center;
          border-top: 1px solid #e2e8f0;
          margin-top: 4px;
          line-height: 1.2;
          letter-spacing: 0.5px;
          font-weight: 500;
          cursor: default;
        }

        /* 确保 dock 菜单按钮在白色背景上保持深色 */
        .ccs-header .ccs-dock-menu button {
          color: #2d3748 !important;
          background: #ffffff !important;
          border: 1px solid #e2e8f0 !important;
        }
      `
  }

  createDockMenuHTML(): string {
    return `
        <button class="ccs-dock-toggle" title="底部栏">📌</button>
        <div class="ccs-dock-menu" style="display:none;">
          <button class="ccs-dock-global">开启底部栏（全局）</button>
          <button class="ccs-dock-temp">开启底部栏（当前页）</button>
          <div class="ccs-dock-shortcut">打开触触搜面板 (Alt+S)</div>
        </div>
      `
  }

  bindDockBarEvents(shadowRoot: ShadowRoot): void {
    this.state.shadowRoot = shadowRoot

    const undockBtn = shadowRoot.querySelector(".ccs-undock") as HTMLElement | null
    if (undockBtn) {
      undockBtn.addEventListener("click", () => {
        console.log("[DockBar] 点击解除停靠按钮")
        this.undock()
      })
    }

    const closeBtn = shadowRoot.querySelector(".ccs-close-bottom") as HTMLElement | null
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        console.log("[DockBar] 点击关闭底部栏按钮")
        this.close()
      })
    }

    this.bindDockToggleEvents(shadowRoot)
  }

  bindDockToggleEvents(shadowRoot: ShadowRoot): void {
    const dockToggle = shadowRoot.querySelector(".ccs-dock-toggle") as HTMLElement | null
    const dockMenu = shadowRoot.querySelector(".ccs-dock-menu") as HTMLElement | null

    if (dockToggle) {
      dockToggle.addEventListener("click", () => {
        console.log("[DockBar] 点击停靠切换按钮")
        this.enableGlobalDock()
      })

      let dockMenuTimer: ReturnType<typeof setTimeout> | null = null
      const showDockMenu = (): void => {
        if (dockMenuTimer) clearTimeout(dockMenuTimer)
        if (dockMenu) dockMenu.style.display = "block"
      }
      const hideDockMenu = (): void => {
        if (dockMenuTimer) clearTimeout(dockMenuTimer)
        dockMenuTimer = setTimeout(() => {
          if (dockMenu) dockMenu.style.display = "none"
        }, 150)
      }

      dockToggle.addEventListener("mouseenter", showDockMenu)
      dockToggle.addEventListener("mouseleave", hideDockMenu)

      if (dockMenu) {
        dockMenu.addEventListener("mouseenter", showDockMenu)
        dockMenu.addEventListener("mouseleave", hideDockMenu)

        const globalBtn = dockMenu.querySelector(".ccs-dock-global") as HTMLElement | null
        const tempBtn = dockMenu.querySelector(".ccs-dock-temp") as HTMLElement | null

        if (globalBtn) {
          globalBtn.addEventListener("click", () => {
            console.log("[DockBar] 点击全局底部栏按钮")
            this.enableGlobalDock()
            if (dockMenu) dockMenu.style.display = "none"
          })
        }

        if (tempBtn) {
          tempBtn.addEventListener("click", () => {
            console.log("[DockBar] 点击当前页底部栏按钮")
            this.enableTempDock()
            if (dockMenu) dockMenu.style.display = "none"
          })
        }
      }
    }
  }

  enableGlobalDock(): void {
    const s = this.settings as DockBarSettings
    s.globalDock = true
    s.layout = "bottom"
    s.mode = "normal"
    this.state.isTempDock = false
    s.barClosed = false

    this.callbacks.onEnableGlobalDock?.()
  }

  enableTempDock(): void {
    const s = this.settings as DockBarSettings
    s.globalDock = true
    s.layout = "bottom"
    s.mode = "normal"
    this.state.isTempDock = false
    s.barClosed = false

    this.callbacks.onEnableTempDock?.()
  }

  undock(): void {
    const s = this.settings as DockBarSettings
    s.layout = "float"
    s.globalDock = false
    this.state.isTempDock = false
    s.position = null

    this.callbacks.onUndock?.()
  }

  close(): void {
    const s = this.settings as DockBarSettings
    s.barClosed = true
    this.state.isTempDock = false

    this.callbacks.onClose?.()
  }

  initDockBar(): void {
    const s = this.settings as DockBarSettings
    if (s.mode === "normal" && !s.isBlacklisted) {
      s.layout = "bottom"
      s.globalDock = true
      s.barClosed = false

      console.log("[DockBar] 初始化底部栏...")

      this.callbacks.onInitDockBar?.()

      setInterval(() => {
        if (s.globalDock && !s.barClosed && s.mode === "normal" && !s.isBlacklisted) {
          this.ensureBottomBarVisible()
        }
      }, 2000)
    }
  }

  ensureBottomBarVisible(force: boolean = false): void {
    try {
      const s = this.settings as DockBarSettings
      if (s.globalDock && !s.barClosed && s.mode === "normal" && !s.isBlacklisted) {
        s.layout = "bottom"
        this.callbacks.onEnsureVisible?.(force)
      }
    } catch (e) {
      console.warn("[DockBar] ensureBottomBarVisible error:", e)
    }
  }

  shouldShowAsBottom(): boolean {
    const s = this.settings as DockBarSettings
    return s.mode === "normal" && s.layout === "bottom"
  }

  isDocked(): boolean {
    return (this.settings as DockBarSettings).layout === "bottom"
  }

  getState(): DockBarStateSnapshot {
    const s = this.settings as DockBarSettings
    return {
      globalDock: s.globalDock,
      layout: s.layout,
      barClosed: s.barClosed,
      isTempDock: this.state.isTempDock,
      isVisible: this.state.isVisible
    }
  }

  setTempDock(value: boolean): void {
    this.state.isTempDock = value
  }
}

export const defaultDockBar = new DockBar()

export default DockBar
