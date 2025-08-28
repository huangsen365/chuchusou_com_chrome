(function() {
  'use strict';

  // 创建全局命名空间
  window.CCSModules = window.CCSModules || {};
  
  // Utils 模块 - 通用工具函数
  const Utils = {
    // 调试日志
    DEBUG_REQUEST_ID: 0,
    
    // 安全发送Chrome消息
    safeChromeSendMessage(message) {
      try {
        if (chrome.runtime && chrome.runtime.id) {
          chrome.runtime.sendMessage(message);
        }
      } catch (err) {
        console.warn('[触触搜] Chrome runtime 不可用:', err.message);
      }
    },

    // HTML转义
    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    },

    // 获取视口象限
    getViewportQuadrant(x, y) {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const centerX = viewportWidth / 2;
      const centerY = viewportHeight / 2;
      
      if (x < centerX && y < centerY) return 'top-left';
      if (x >= centerX && y < centerY) return 'top-right';
      if (x < centerX && y >= centerY) return 'bottom-left';
      return 'bottom-right';
    },

    // 防抖函数
    debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    },

    // 节流函数
    throttle(func, limit) {
      let inThrottle;
      return function(...args) {
        if (!inThrottle) {
          func.apply(this, args);
          inThrottle = true;
          setTimeout(() => inThrottle = false, limit);
        }
      };
    },

    // 检查是否为有效URL
    isValidUrl(string) {
      try {
        new URL(string);
        return true;
      } catch (_) {
        return false;
      }
    },

    // 截断文本
    truncateText(text, maxLength = 50) {
      if (!text) return '';
      return text.length > maxLength ? 
        text.substring(0, maxLength) + '...' : 
        text;
    },

    // 获取当前时间戳
    getTimestamp() {
      return new Date().getTime();
    },

    // 深拷贝对象
    deepClone(obj) {
      if (obj === null || typeof obj !== 'object') return obj;
      if (obj instanceof Date) return new Date(obj);
      if (obj instanceof Array) return obj.map(item => this.deepClone(item));
      
      const clonedObj = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          clonedObj[key] = this.deepClone(obj[key]);
        }
      }
      return clonedObj;
    },

    // 合并对象
    mergeObjects(target, ...sources) {
      if (!sources.length) return target;
      const source = sources.shift();
      
      if (this.isObject(target) && this.isObject(source)) {
        for (const key in source) {
          if (this.isObject(source[key])) {
            if (!target[key]) Object.assign(target, { [key]: {} });
            this.mergeObjects(target[key], source[key]);
          } else {
            Object.assign(target, { [key]: source[key] });
          }
        }
      }
      
      return this.mergeObjects(target, ...sources);
    },

    // 检查是否为对象
    isObject(item) {
      return item && typeof item === 'object' && !Array.isArray(item);
    },

    // 生成唯一ID
    generateId(prefix = 'ccs') {
      return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    },

    // 等待元素出现
    waitForElement(selector, timeout = 5000) {
      return new Promise((resolve, reject) => {
        const element = document.querySelector(selector);
        if (element) {
          resolve(element);
          return;
        }
        
        const observer = new MutationObserver((mutations, obs) => {
          const element = document.querySelector(selector);
          if (element) {
            obs.disconnect();
            resolve(element);
          }
        });
        
        observer.observe(document.body, {
          childList: true,
          subtree: true
        });
        
        setTimeout(() => {
          observer.disconnect();
          reject(new Error(`Element ${selector} not found within ${timeout}ms`));
        }, timeout);
      });
    }
  };

  // 导出模块
  window.CCSModules.Utils = Utils;
})();