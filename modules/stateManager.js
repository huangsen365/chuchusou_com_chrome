(function() {
  'use strict';

  // 确保全局命名空间存在
  window.CCSModules = window.CCSModules || {};
  
  // StateManager 模块 - 全局状态管理
  const StateManager = {
    // 内部状态存储
    _state: {
      popover: null,
      shadowRoot: null,
      selectedText: '',
      lastNonEmptySelection: '',
      domObserver: null,
      isProcessingSelection: false,
      settings: {
        mode: 'normal', // normal, mini, disabled
        theme: 'default',
        opacity: 1,
        position: null,
        layout: 'float', // float, bottom
        globalDock: false, // 悬停模式（全局）
        barClosed: false, // 全局关闭底部栏（优先级最高）
        blacklist: [],
        isBlacklisted: false, // 当前页面是否在黑名单中
        miniButtons: ['baidu', 'google', 'chuchusou', 'copy', 'lowercase'], // Mini模式默认按钮
        shortcutKey: 'Alt+S' // 可自定义快捷键
      }
    },
    
    // 初始化状态管理
    init() {
      // 同步到全局 window 对象
      this.syncToWindow();
      
      // 设置属性监听
      this.setupPropertyWatchers();
      
      return this._state;
    },
    
    // 同步状态到 window 对象
    syncToWindow() {
      window.selectedText = this._state.selectedText;
      window.lastNonEmptySelection = this._state.lastNonEmptySelection;
      window.shadowRoot = this._state.shadowRoot;
      window.popover = this._state.popover;
      window.settings = this._state.settings;
      window.domObserver = this._state.domObserver;
      window.isProcessingSelection = this._state.isProcessingSelection;
    },
    
    // 设置属性监听器
    setupPropertyWatchers() {
      // 定义属性的 getter 和 setter
      Object.defineProperty(window, 'selectedText', {
        get: () => this._state.selectedText,
        set: (value) => {
          this._state.selectedText = value;
          this.onSelectedTextChange(value);
        },
        configurable: true
      });
      
      Object.defineProperty(window, 'lastNonEmptySelection', {
        get: () => this._state.lastNonEmptySelection,
        set: (value) => {
          this._state.lastNonEmptySelection = value;
          this.onLastNonEmptySelectionChange(value);
        },
        configurable: true
      });
      
      Object.defineProperty(window, 'popover', {
        get: () => this._state.popover,
        set: (value) => {
          this._state.popover = value;
        },
        configurable: true
      });
      
      Object.defineProperty(window, 'shadowRoot', {
        get: () => this._state.shadowRoot,
        set: (value) => {
          this._state.shadowRoot = value;
        },
        configurable: true
      });
      
      Object.defineProperty(window, 'isProcessingSelection', {
        get: () => this._state.isProcessingSelection,
        set: (value) => {
          this._state.isProcessingSelection = value;
        },
        configurable: true
      });
    },
    
    // 获取设置
    getSettings() {
      return this._state.settings;
    },
    
    // 更新设置
    updateSettings(updates) {
      Object.assign(this._state.settings, updates);
      window.settings = this._state.settings;
      this.saveSettings();
    },
    
    // 保存设置到存储
    saveSettings() {
      console.log('[触触搜] 保存设置:', { 
        globalDock: this._state.settings.globalDock, 
        layout: this._state.settings.layout, 
        barClosed: this._state.settings.barClosed 
      });
      chrome.storage.local.set({ ccs_settings: this._state.settings });
    },
    
    // 从存储加载设置
    loadSettings(callback) {
      chrome.storage.local.get(['ccs_settings', 'ccs_debug'], (result) => {
        console.log('[触触搜] 加载设置:', result.ccs_settings);
        if (result.ccs_settings) {
          Object.assign(this._state.settings, result.ccs_settings);
          
          // 确保blacklist数组存在
          if (!Array.isArray(this._state.settings.blacklist)) {
            this._state.settings.blacklist = [];
          }
          
          // 迁移：为旧用户的 miniButtons 添加 lowercase
          if (Array.isArray(this._state.settings.miniButtons) && 
              !this._state.settings.miniButtons.includes('lowercase')) {
            this._state.settings.miniButtons.push('lowercase');
            this.saveSettings();
          }
          
          // 若开启全局悬停模式，默认使用底部栏布局
          try {
            if (this._state.settings.globalDock && 
                this._state.settings.mode === 'normal' && 
                !this._state.settings.barClosed) {
              this._state.settings.layout = 'bottom';
            }
          } catch (_) {}
        }
        
        // 处理调试设置
        if (typeof result.ccs_debug === 'boolean') {
          window.CCS_DEBUG = result.ccs_debug;
        } else {
          // 首次默认关闭调试
          chrome.storage.local.set({ ccs_debug: false });
          window.CCS_DEBUG = false;
        }
        
        // 同步到 window
        window.settings = this._state.settings;
        
        if (callback) {
          callback(this._state.settings);
        }
      });
    },
    
    // 设置选中文本
    setSelectedText(value) {
      this._state.selectedText = value;
      window.selectedText = value;
    },
    
    // 设置最后非空选中文本
    setLastNonEmptySelection(value) {
      this._state.lastNonEmptySelection = value;
      window.lastNonEmptySelection = value;
    },
    
    // 设置 popover 元素
    setPopover(element) {
      this._state.popover = element;
      window.popover = element;
    },
    
    // 设置 shadowRoot
    setShadowRoot(shadowRoot) {
      this._state.shadowRoot = shadowRoot;
      window.shadowRoot = shadowRoot;
    },
    
    // 设置 DOM 观察器
    setDomObserver(observer) {
      this._state.domObserver = observer;
      window.domObserver = observer;
    },
    
    // 设置处理选择状态
    setProcessingSelection(value) {
      this._state.isProcessingSelection = value;
      window.isProcessingSelection = value;
    },
    
    // 获取当前状态
    getState() {
      return { ...this._state };
    },
    
    // 重置状态
    reset() {
      // 清理旧的 popover
      if (this._state.popover) {
        this._state.popover.remove();
      }
      
      // 停止 DOM 观察器
      if (this._state.domObserver) {
        this._state.domObserver.disconnect();
      }
      
      // 重置状态
      this._state.popover = null;
      this._state.shadowRoot = null;
      this._state.selectedText = '';
      this._state.lastNonEmptySelection = '';
      this._state.domObserver = null;
      this._state.isProcessingSelection = false;
      
      // 同步到 window
      this.syncToWindow();
    },
    
    // 选中文本变化时的回调
    onSelectedTextChange(value) {
      // 可以在这里添加额外的逻辑
      console.log('[触触搜] 选中文本更新:', value ? value.substring(0, 50) + '...' : '(空)');
    },
    
    // 最后非空选中文本变化时的回调
    onLastNonEmptySelectionChange(value) {
      // 可以在这里添加额外的逻辑
      console.log('[触触搜] 最后非空选中文本更新:', value ? value.substring(0, 50) + '...' : '(空)');
    },
    
    // 检查是否处于黑名单模式
    isBlacklisted() {
      return this._state.settings.isBlacklisted;
    },
    
    // 检查是否处于禁用模式
    isDisabled() {
      return this._state.settings.mode === 'disabled';
    },
    
    // 检查是否处于 mini 模式
    isMiniMode() {
      return this._state.settings.mode === 'mini';
    },
    
    // 检查是否处于底部栏模式
    isBottomLayout() {
      return this._state.settings.layout === 'bottom';
    },
    
    // 检查是否启用全局停靠
    isGlobalDock() {
      return this._state.settings.globalDock;
    }
  };

  // 导出模块
  window.CCSModules.StateManager = StateManager;
  
  // 兼容性：导出全局函数
  window.setSelectedText = (value) => StateManager.setSelectedText(value);
  window.setLastNonEmptySelection = (value) => StateManager.setLastNonEmptySelection(value);
  window.saveSettings = () => StateManager.saveSettings();
})();