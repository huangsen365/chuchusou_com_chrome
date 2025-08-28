(function() {
  'use strict';

  // DockBar 模块 - 处理所有底部停靠栏相关功能
  const DockBar = {
    // 内部状态
    state: {
      isInitialized: false,
      isTempDock: false,
      isVisible: false,
      container: null,
      shadowRoot: null
    },

    // 配置和回调
    settings: null,
    callbacks: {},

    // 初始化 DockBar
    init(settings, callbacks = {}) {
      this.settings = settings;
      this.callbacks = callbacks;
      this.state.isInitialized = true;
      console.log('[DockBar] 初始化完成');
    },

    // 创建底部栏 HTML
    createDockBarHTML(displayText, buttons) {
      const badgeHtml = this.settings.globalDock ? 
        '<span class="ccs-global-badge" title="悬停模式（全局）">全局</span>' : 
        (this.state.isTempDock ? '<span class="ccs-temp-badge" title="悬停模式（临时）">临时</span>' : '');
      
      return `
        <div class="ccs-bottom" data-draggable="false">
          <div class="ccs-bottom-buttons"></div>
          <div class="ccs-bottom-controls">
            ${badgeHtml}
            <button class="ccs-close-bottom" title="关闭底部栏">✕</button>
            <button class="ccs-undock" title="悬浮模式">↕️</button>
          </div>
        </div>
      `;
    },

    // 获取 DockBar 相关的 CSS 样式
    getStyles() {
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
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
      `;
    },

    // 创建停靠菜单 HTML
    createDockMenuHTML() {
      return `
        <button class="ccs-dock-toggle" title="底部栏">📌</button>
        <div class="ccs-dock-menu" style="display:none;">
          <button class="ccs-dock-global">开启底部栏（全局）</button>
          <button class="ccs-dock-temp">开启底部栏（当前页）</button>
          <div class="ccs-dock-shortcut">打开触触搜面板 (Alt+S)</div>
        </div>
      `;
    },

    // 绑定 DockBar 事件
    bindDockBarEvents(shadowRoot) {
      this.shadowRoot = shadowRoot;

      // 解除停靠按钮
      const undockBtn = shadowRoot.querySelector('.ccs-undock');
      if (undockBtn) {
        undockBtn.addEventListener('click', () => {
          console.log('[DockBar] 点击解除停靠按钮');
          this.undock();
        });
      }

      // 关闭底部栏按钮
      const closeBtn = shadowRoot.querySelector('.ccs-close-bottom');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          console.log('[DockBar] 点击关闭底部栏按钮');
          this.close();
        });
      }

      // 底部栏切换按钮和菜单
      this.bindDockToggleEvents(shadowRoot);
    },

    // 绑定停靠切换相关事件
    bindDockToggleEvents(shadowRoot) {
      const dockToggle = shadowRoot.querySelector('.ccs-dock-toggle');
      const dockMenu = shadowRoot.querySelector('.ccs-dock-menu');
      
      if (dockToggle) {
        // 默认点击：开启悬停模式（全局）
        dockToggle.addEventListener('click', () => {
          console.log('[DockBar] 点击停靠切换按钮');
          this.enableGlobalDock();
        });

        // 悬停显示菜单
        let dockMenuTimer = null;
        const showDockMenu = () => {
          clearTimeout(dockMenuTimer);
          if (dockMenu) dockMenu.style.display = 'block';
        };
        const hideDockMenu = () => {
          clearTimeout(dockMenuTimer);
          dockMenuTimer = setTimeout(() => { 
            if (dockMenu) dockMenu.style.display = 'none'; 
          }, 150);
        };

        dockToggle.addEventListener('mouseenter', showDockMenu);
        dockToggle.addEventListener('mouseleave', hideDockMenu);
        
        if (dockMenu) {
          dockMenu.addEventListener('mouseenter', showDockMenu);
          dockMenu.addEventListener('mouseleave', hideDockMenu);
          
          const globalBtn = dockMenu.querySelector('.ccs-dock-global');
          const tempBtn = dockMenu.querySelector('.ccs-dock-temp');
          
          if (globalBtn) {
            globalBtn.addEventListener('click', () => {
              console.log('[DockBar] 点击全局底部栏按钮');
              this.enableGlobalDock();
              if (dockMenu) dockMenu.style.display = 'none';
            });
          }
          
          if (tempBtn) {
            tempBtn.addEventListener('click', () => {
              console.log('[DockBar] 点击当前页底部栏按钮');
              this.enableTempDock();
              if (dockMenu) dockMenu.style.display = 'none';
            });
          }
        }
      }
    },

    // 启用全局停靠
    enableGlobalDock() {
      this.settings.globalDock = true;
      this.settings.layout = 'bottom';
      this.settings.mode = 'normal';
      this.state.isTempDock = false;
      this.settings.barClosed = false;
      
      if (this.callbacks.onEnableGlobalDock) {
        this.callbacks.onEnableGlobalDock();
      }
    },

    // 启用临时停靠（当前页）
    enableTempDock() {
      this.settings.globalDock = true; // 保存为全局开启以记住状态
      this.settings.layout = 'bottom';
      this.settings.mode = 'normal';
      this.state.isTempDock = false;
      this.settings.barClosed = false;
      
      if (this.callbacks.onEnableTempDock) {
        this.callbacks.onEnableTempDock();
      }
    },

    // 解除停靠
    undock() {
      this.settings.layout = 'float';
      this.settings.globalDock = false;
      this.state.isTempDock = false;
      this.settings.position = null;
      
      if (this.callbacks.onUndock) {
        this.callbacks.onUndock();
      }
    },

    // 关闭底部栏
    close() {
      this.settings.barClosed = true;
      this.state.isTempDock = false;
      
      if (this.callbacks.onClose) {
        this.callbacks.onClose();
      }
    },

    // 初始化 DockBar（由快捷键触发）
    initDockBar() {
      if (this.settings.mode === 'normal' && !this.settings.isBlacklisted) {
        this.settings.layout = 'bottom';
        this.settings.globalDock = true;
        this.settings.barClosed = false;
        
        console.log('[DockBar] 初始化底部栏...');
        
        if (this.callbacks.onInitDockBar) {
          this.callbacks.onInitDockBar();
        }
        
        // 设置定期检查，确保 dock bar 保持可见
        setInterval(() => {
          if (this.settings.globalDock && !this.settings.barClosed && 
              this.settings.mode === 'normal' && !this.settings.isBlacklisted) {
            this.ensureBottomBarVisible();
          }
        }, 2000);
      }
    },

    // 确保底部栏可见
    ensureBottomBarVisible(force = false) {
      try {
        if (this.settings.globalDock && !this.settings.barClosed && 
            this.settings.mode === 'normal' && !this.settings.isBlacklisted) {
          
          this.settings.layout = 'bottom'; // 始终确保布局正确
          
          if (this.callbacks.onEnsureVisible) {
            this.callbacks.onEnsureVisible(force);
          }
        }
      } catch (e) {
        console.warn('[DockBar] ensureBottomBarVisible error:', e);
      }
    },

    // 检查是否应该显示为底部栏
    shouldShowAsBottom() {
      return this.settings.mode === 'normal' && this.settings.layout === 'bottom';
    },

    // 检查是否处于停靠状态
    isDocked() {
      return this.settings.layout === 'bottom';
    },

    // 获取当前状态
    getState() {
      return {
        globalDock: this.settings.globalDock,
        layout: this.settings.layout,
        barClosed: this.settings.barClosed,
        isTempDock: this.state.isTempDock,
        isVisible: this.state.isVisible
      };
    },

    // 更新临时停靠状态
    setTempDock(value) {
      this.state.isTempDock = value;
    }
  };

  // 导出到全局作用域
  window.DockBar = DockBar;
})();