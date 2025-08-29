(function() {
  'use strict';

  // 确保全局命名空间存在
  window.CCSModules = window.CCSModules || {};
  
  // Blacklist 模块 - 黑名单管理功能
  const Blacklist = {
    // 当前黑名单列表
    list: [],
    
    // 是否在黑名单中的标志
    isBlacklisted: false,
    
    // 原始模式（用于从黑名单恢复时）
    originalMode: 'normal',
    
    // 初始化黑名单模块
    init(settings) {
      this.list = settings.blacklist || [];
      this.check(settings);
    },
    
    // 检查当前网站是否在黑名单中
    check(settings) {
      const currentHost = window.location.hostname;
      
      if (this.list && this.list.includes(currentHost)) {
        // 不直接禁用，而是标记为黑名单状态
        this.isBlacklisted = true;
        settings.isBlacklisted = true;
        
        // 保持原始模式，以便恢复后使用
        this.originalMode = settings.mode || 'normal';
        settings.originalMode = this.originalMode;
        
        // 设置为禁用模式
        settings.mode = 'disabled';
        
        console.log('[触触搜] 网站在黑名单中，禁用功能:', currentHost);
        return true;
      } else {
        this.isBlacklisted = false;
        settings.isBlacklisted = false;
        console.log('[触触搜] 网站不在黑名单中:', currentHost);
        return false;
      }
    },
    
    // 添加网站到黑名单
    add(hostname) {
      if (!this.list.includes(hostname)) {
        this.list.push(hostname);
        console.log('[触触搜] 添加到黑名单:', hostname);
        return true;
      }
      return false;
    },
    
    // 从黑名单移除网站
    remove(hostname) {
      const index = this.list.indexOf(hostname);
      if (index > -1) {
        this.list.splice(index, 1);
        console.log('[触触搜] 从黑名单移除:', hostname);
        return true;
      }
      return false;
    },
    
    // 切换当前网站的黑名单状态
    toggle(settings, saveCallback) {
      const currentHost = window.location.hostname;
      
      if (this.isBlacklisted) {
        // 从黑名单移除
        this.remove(currentHost);
        this.isBlacklisted = false;
        settings.isBlacklisted = false;
        
        // 恢复原始模式
        settings.mode = this.originalMode || 'normal';
        delete settings.originalMode;
        
        console.log('[触触搜] 网站已从黑名单移除，恢复模式:', settings.mode);
      } else {
        // 添加到黑名单
        this.add(currentHost);
        this.isBlacklisted = true;
        settings.isBlacklisted = true;
        
        // 保存当前模式并禁用
        this.originalMode = settings.mode || 'normal';
        settings.originalMode = this.originalMode;
        settings.mode = 'disabled';
        
        console.log('[触触搜] 网站已添加到黑名单，禁用功能');
      }
      
      // 更新设置中的黑名单
      settings.blacklist = this.list;
      
      // 调用保存回调
      if (typeof saveCallback === 'function') {
        saveCallback();
      }
      
      return this.isBlacklisted;
    },
    
    // 获取当前网站的黑名单状态
    getCurrentStatus() {
      return {
        hostname: window.location.hostname,
        isBlacklisted: this.isBlacklisted,
        originalMode: this.originalMode
      };
    },
    
    // 清空黑名单
    clear() {
      this.list = [];
      this.isBlacklisted = false;
      console.log('[触触搜] 黑名单已清空');
    },
    
    // 获取黑名单列表
    getList() {
      return [...this.list]; // 返回副本
    },
    
    // 设置黑名单列表
    setList(newList) {
      if (Array.isArray(newList)) {
        this.list = [...newList];
        return true;
      }
      return false;
    },
    
    // 检查指定域名是否在黑名单中
    contains(hostname) {
      return this.list.includes(hostname);
    }
  };

  // 导出模块
  window.CCSModules.Blacklist = Blacklist;
  
  // 兼容性：导出全局函数
  window.checkBlacklist = function() {
    if (window.settings) {
      return Blacklist.check(window.settings);
    }
    return false;
  };
})();