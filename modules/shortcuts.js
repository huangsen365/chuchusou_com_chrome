(function() {
  'use strict';

  // 确保全局命名空间存在
  window.CCSModules = window.CCSModules || {};
  
  // Shortcuts 模块 - 快捷键管理
  const Shortcuts = {
    // 默认快捷键配置
    shortcuts: {
      'Alt+S': 'openPanel',
      'Ctrl+Shift+S': 'openPanel',
      'Alt+Shift+S': 'togglePanel',
      'Alt+Q': 'quickSearch',
      'Alt+C': 'quickCopy',
      'Escape': 'closePanel'
    },

    // 当前快捷键设置
    currentShortcut: 'Alt+S',

    // 注册的快捷键处理器
    handlers: {},

    // 初始化快捷键监听
    init() {
      // 从设置中加载快捷键配置
      const Settings = window.CCSModules?.Settings;
      if (Settings && Settings.current) {
        this.currentShortcut = Settings.current.shortcutKey || 'Alt+S';
      }

      // 绑定键盘事件
      document.addEventListener('keydown', (e) => this.handleKeyDown(e), true);
      document.addEventListener('keyup', (e) => this.handleKeyUp(e), true);

      // 注册默认处理器
      this.registerDefaultHandlers();
    },

    // 注册默认处理器
    registerDefaultHandlers() {
      // 打开面板
      this.register('openPanel', () => {
        console.log('[触触搜] 快捷键触发：打开面板');
        
        // 检查是否有 initDockBar 函数
        if (window.__initDockBar) {
          window.__initDockBar();
        } else if (window.CCSModules?.UIManager) {
          window.CCSModules.UIManager.showPanel();
        }
      });

      // 切换面板
      this.register('togglePanel', () => {
        console.log('[触触搜] 快捷键触发：切换面板');
        if (window.CCSModules?.UIManager) {
          window.CCSModules.UIManager.togglePanel();
        }
      });

      // 快速搜索
      this.register('quickSearch', () => {
        const text = window.CCSModules?.Selection?.getCurrentSearchText();
        if (text && window.CCSModules?.Search) {
          window.CCSModules.Search.performSearch('google', text);
        }
      });

      // 快速复制
      this.register('quickCopy', () => {
        const text = window.CCSModules?.Selection?.getCurrentSearchText();
        if (text) {
          navigator.clipboard.writeText(text);
          if (window.CCSModules?.Toast) {
            window.CCSModules.Toast.show('已复制到剪贴板');
          }
        }
      });

      // 关闭面板
      this.register('closePanel', () => {
        if (window.hidePopover) {
          window.hidePopover();
        } else if (window.CCSModules?.UIManager) {
          window.CCSModules.UIManager.hidePanel();
        }
      });
    },

    // 处理按键按下
    handleKeyDown(e) {
      // 忽略输入框中的快捷键
      if (this.isInputElement(e.target)) {
        return;
      }

      const shortcut = this.getShortcutString(e);
      
      // 检查是否匹配配置的快捷键
      if (this.matchesShortcut(e, this.currentShortcut)) {
        e.preventDefault();
        e.stopPropagation();
        this.handleSearchShortcut(e);
        return;
      }

      // 检查其他快捷键
      const action = this.shortcuts[shortcut];
      if (action && this.handlers[action]) {
        e.preventDefault();
        e.stopPropagation();
        this.handlers[action](e);
      }
    },

    // 处理按键释放
    handleKeyUp(e) {
      // 可以用于处理需要在按键释放时触发的操作
    },

    // 获取快捷键字符串
    getShortcutString(e) {
      const parts = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Meta');
      
      // 获取按键
      let key = e.key;
      if (key === ' ') key = 'Space';
      else if (key.length === 1) key = key.toUpperCase();
      
      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
        parts.push(key);
      }
      
      return parts.join('+');
    },

    // 匹配快捷键
    matchesShortcut(e, shortcutStr) {
      if (!shortcutStr) return false;
      
      const parts = shortcutStr.split('+').map(p => p.trim().toLowerCase());
      const hasCtrl = parts.includes('ctrl');
      const hasAlt = parts.includes('alt');
      const hasShift = parts.includes('shift');
      const hasMeta = parts.includes('meta');
      
      // 检查修饰键
      if (hasCtrl !== e.ctrlKey) return false;
      if (hasAlt !== e.altKey) return false;
      if (hasShift !== e.shiftKey) return false;
      if (hasMeta !== e.metaKey) return false;
      
      // 检查主键
      const mainKey = parts.find(p => !['ctrl', 'alt', 'shift', 'meta'].includes(p));
      if (!mainKey) return false;
      
      const eventKey = e.key.toLowerCase();
      return eventKey === mainKey || 
             (mainKey === 'space' && eventKey === ' ') ||
             (mainKey.length === 1 && eventKey === mainKey);
    },

    // 处理搜索快捷键
    handleSearchShortcut(e) {
      console.log('[触触搜] 搜索快捷键触发');
      
      // 检查设置
      const Settings = window.CCSModules?.Settings;
      if (Settings && Settings.current) {
        const { mode, isBlacklisted, barClosed } = Settings.current;
        
        // 检查是否应该响应
        if (mode === 'disabled') {
          console.log('[触触搜] 插件已禁用，忽略快捷键');
          return;
        }
        
        if (isBlacklisted) {
          console.log('[触触搜] 当前页面在黑名单中，忽略快捷键');
          return;
        }

        // 更新设置以显示底部栏
        Settings.current.layout = 'bottom';
        Settings.current.globalDock = true;
        Settings.current.barClosed = false;
        Settings.current.mode = 'normal';
        Settings.save();
      }

      // 触发打开面板
      if (this.handlers.openPanel) {
        this.handlers.openPanel();
      }
    },

    // 注册快捷键处理器
    register(action, handler) {
      this.handlers[action] = handler;
    },

    // 注销快捷键处理器
    unregister(action) {
      delete this.handlers[action];
    },

    // 更新快捷键配置
    updateShortcut(newShortcut) {
      this.currentShortcut = newShortcut;
      
      // 保存到设置
      const Settings = window.CCSModules?.Settings;
      if (Settings) {
        Settings.set('shortcutKey', newShortcut);
      }
    },

    // 检查是否为输入元素
    isInputElement(element) {
      const tagName = element.tagName.toLowerCase();
      const isEditable = element.contentEditable === 'true';
      const isInput = ['input', 'textarea', 'select'].includes(tagName);
      
      return isEditable || isInput;
    },

    // 获取所有可用的快捷键选项
    getAvailableShortcuts() {
      return [
        { value: 'Alt+S', label: 'Alt+S（默认）' },
        { value: 'Ctrl+Shift+S', label: 'Ctrl+Shift+S' },
        { value: 'Alt+Shift+S', label: 'Alt+Shift+S' },
        { value: 'Ctrl+Alt+S', label: 'Ctrl+Alt+S' },
        { value: 'Alt+Q', label: 'Alt+Q' },
        { value: 'Alt+E', label: 'Alt+E' },
        { value: 'Ctrl+Space', label: 'Ctrl+Space' },
        { value: 'Alt+Space', label: 'Alt+Space' }
      ];
    },

    // 禁用快捷键
    disable() {
      document.removeEventListener('keydown', this.handleKeyDown);
      document.removeEventListener('keyup', this.handleKeyUp);
    },

    // 启用快捷键
    enable() {
      this.disable(); // 先移除避免重复
      document.addEventListener('keydown', (e) => this.handleKeyDown(e), true);
      document.addEventListener('keyup', (e) => this.handleKeyUp(e), true);
    }
  };

  // 导出模块
  window.CCSModules.Shortcuts = Shortcuts;
  
  // 兼容性：导出全局函数
  window.matchesShortcut = (e, shortcut) => Shortcuts.matchesShortcut(e, shortcut);
  window.handleSearchShortcut = (e) => Shortcuts.handleSearchShortcut(e);
})();