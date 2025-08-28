(function() {
  'use strict';

  // 确保全局命名空间存在
  window.CCSModules = window.CCSModules || {};
  
  // Settings 模块 - 设置管理
  const Settings = {
    // 默认设置
    defaults: {
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
    },

    // 当前设置
    current: null,

    // 设置变化监听器
    listeners: [],

    // 初始化设置
    async init() {
      this.current = { ...this.defaults };
      await this.load();
      this.checkBlacklist();
      return this.current;
    },

    // 加载设置
    async load() {
      return new Promise((resolve) => {
        chrome.storage.local.get(['ccs_settings', 'ccs_debug'], (result) => {
          console.log('[触触搜] 加载设置:', result.ccs_settings);
          
          if (result.ccs_settings) {
            this.current = { ...this.current, ...result.ccs_settings };
            
            // 确保blacklist数组存在
            if (!Array.isArray(this.current.blacklist)) {
              this.current.blacklist = [];
            }
            
            // 迁移：为旧用户的 miniButtons 添加 lowercase
            if (Array.isArray(this.current.miniButtons) && 
                !this.current.miniButtons.includes('lowercase')) {
              this.current.miniButtons.push('lowercase');
              this.save();
            }
            
            // 若开启全局悬停模式，默认使用底部栏布局
            try {
              if (this.current.globalDock && 
                  this.current.mode === 'normal' && 
                  !this.current.barClosed) {
                this.current.layout = 'bottom';
              }
            } catch (_) {}
          }
          
          // 处理调试模式
          if (typeof result.ccs_debug === 'boolean') {
            window.CCS_DEBUG = result.ccs_debug;
          } else {
            // 首次默认关闭调试
            chrome.storage.local.set({ ccs_debug: false });
            window.CCS_DEBUG = false;
          }
          
          console.log('[触触搜] 合并后设置:', {
            globalDock: this.current.globalDock,
            layout: this.current.layout,
            barClosed: this.current.barClosed,
            mode: this.current.mode,
            blacklist: this.current.blacklist
          });
          
          resolve(this.current);
        });
      });
    },

    // 保存设置
    save() {
      console.log('[触触搜] 保存设置:', {
        globalDock: this.current.globalDock,
        layout: this.current.layout,
        barClosed: this.current.barClosed
      });
      
      chrome.storage.local.set({ ccs_settings: this.current });
      this.notifyListeners('save', this.current);
    },

    // 更新设置
    update(updates) {
      const oldSettings = { ...this.current };
      this.current = { ...this.current, ...updates };
      this.save();
      this.notifyListeners('update', { old: oldSettings, new: this.current });
    },

    // 获取设置
    get(key) {
      return key ? this.current[key] : this.current;
    },

    // 设置单个值
    set(key, value) {
      this.current[key] = value;
      this.save();
    },

    // 检查黑名单
    checkBlacklist() {
      const hostname = window.location.hostname;
      this.current.isBlacklisted = this.current.blacklist.some(domain => {
        if (domain.startsWith('*.')) {
          const mainDomain = domain.slice(2);
          return hostname.endsWith(mainDomain) || hostname === mainDomain.slice(1);
        }
        return hostname === domain || hostname.endsWith('.' + domain);
      });
      
      console.log('[触触搜] 黑名单检查:', {
        hostname,
        blacklist: this.current.blacklist,
        isBlacklisted: this.current.isBlacklisted
      });
    },

    // 添加到黑名单
    addToBlacklist(domain) {
      if (!this.current.blacklist.includes(domain)) {
        this.current.blacklist.push(domain);
        this.save();
        this.checkBlacklist();
      }
    },

    // 从黑名单移除
    removeFromBlacklist(domain) {
      const index = this.current.blacklist.indexOf(domain);
      if (index > -1) {
        this.current.blacklist.splice(index, 1);
        this.save();
        this.checkBlacklist();
      }
    },

    // 切换黑名单
    toggleBlacklist() {
      const hostname = window.location.hostname;
      if (this.current.isBlacklisted) {
        this.removeFromBlacklist(hostname);
      } else {
        this.addToBlacklist(hostname);
      }
      return this.current.isBlacklisted;
    },

    // 添加监听器
    addListener(callback) {
      this.listeners.push(callback);
    },

    // 移除监听器
    removeListener(callback) {
      const index = this.listeners.indexOf(callback);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    },

    // 通知监听器
    notifyListeners(type, data) {
      this.listeners.forEach(callback => {
        try {
          callback(type, data);
        } catch (e) {
          console.error('[触触搜] 设置监听器错误:', e);
        }
      });
    },

    // 重置设置
    reset() {
      this.current = { ...this.defaults };
      this.save();
    },

    // 导出设置
    export() {
      return JSON.stringify(this.current, null, 2);
    },

    // 导入设置
    import(jsonString) {
      try {
        const imported = JSON.parse(jsonString);
        this.current = { ...this.defaults, ...imported };
        this.save();
        return true;
      } catch (e) {
        console.error('[触触搜] 导入设置失败:', e);
        return false;
      }
    }
  };

  // 导出模块
  window.CCSModules.Settings = Settings;
  
  // 兼容性：导出主要函数
  window.saveSettings = () => Settings.save();
  window.checkBlacklist = () => Settings.checkBlacklist();
})();