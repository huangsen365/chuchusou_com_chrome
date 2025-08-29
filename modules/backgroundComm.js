(function() {
  'use strict';

  // 确保全局命名空间存在
  window.CCSModules = window.CCSModules || {};
  
  // BackgroundComm 模块 - 后台通信功能
  const BackgroundComm = {
    // 调试请求ID
    DEBUG_REQUEST_ID: 0,
    
    // 初始化消息监听器
    init(handlers = {}) {
      this.setupMessageListener(handlers);
    },
    
    // 向background请求关键词（与右键提取一致）
    requestKeywordsFromBackground() {
      return new Promise((resolve) => {
        try {
          if (!(chrome.runtime && chrome.runtime.id)) {
            resolve(null);
            return;
          }
          const reqId = ++this.DEBUG_REQUEST_ID;
          if (window.CCS_DEBUG) {
            console.log('[触触搜][DEBUG] requestKeywordsFromBackground start', { 
              reqId, 
              url: window.location.href, 
              title: document.title 
            });
          }
          let settled = false;
          const payload = {
            action: 'extractKeywords',
            url: window.location.href,
            title: document.title || ''
          };
          chrome.runtime.sendMessage(payload, (response) => {
            settled = true;
            if (window.CCS_DEBUG) {
              console.log('[触触搜][DEBUG] background response', { reqId, response });
            }
            if (response && response.keywords) {
              resolve(response.keywords);
            } else {
              resolve(null);
            }
          });
          setTimeout(() => {
            if (!settled) {
              if (window.CCS_DEBUG) {
                console.warn('[触触搜][DEBUG] background response timeout', { reqId });
              }
              resolve(null);
            }
          }, 1200);
        } catch (_) {
          resolve(null);
        }
      });
    },
    
    // 发送消息到background
    sendMessage(message, callback) {
      try {
        if (chrome.runtime && chrome.runtime.id) {
          chrome.runtime.sendMessage(message, callback);
          return true;
        }
      } catch (err) {
        console.warn('[触触搜] 发送消息失败:', err);
      }
      return false;
    },
    
    // 更新调试状态
    updateDebugStatus(enabled) {
      return this.sendMessage({ action: 'updateDebug', enabled });
    },
    
    // 设置消息监听器
    setupMessageListener(handlers) {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        // 处理调试状态更新
        if (request.action === 'updateDebug') {
          window.CCS_DEBUG = !!request.enabled;
          try {
            if (window.showToast) {
              window.showToast(window.CCS_DEBUG ? '调试已开启' : '调试已关闭');
            }
          } catch (_) {}
          chrome.storage.local.set({ ccs_debug: window.CCS_DEBUG });
          if (handlers.onDebugUpdate) {
            handlers.onDebugUpdate(window.CCS_DEBUG);
          }
        }
        
        // 处理扩展开关
        if (request.action === 'toggleExtension') {
          if (handlers.onToggleExtension) {
            handlers.onToggleExtension(request.enabled);
          }
        }
        
        // 处理黑名单更新
        if (request.action === 'updateBlacklist') {
          if (handlers.onUpdateBlacklist) {
            handlers.onUpdateBlacklist(request.blacklist);
          }
        }
        
        // 处理快捷键更新
        if (request.action === 'updateShortcut') {
          if (handlers.onUpdateShortcut) {
            handlers.onUpdateShortcut(request.shortcutKey);
          }
        }
        
        // 处理右键菜单复制文本
        if (request.action === 'copyText') {
          navigator.clipboard.writeText(request.text).then(() => {
            this.showContextMenuToast('已复制到剪贴板');
          });
          if (handlers.onCopyText) {
            handlers.onCopyText(request.text);
          }
        }
        
        // 处理右键菜单命令
        if (request.action === 'processCommand') {
          this.processCommand(request.command, request.text);
          if (handlers.onProcessCommand) {
            handlers.onProcessCommand(request.command, request.text);
          }
        }
        
        // 处理显示popover请求
        if (request.action === 'showPopover') {
          if (handlers.onShowPopover) {
            handlers.onShowPopover(request.text);
          }
        }
        
        // 处理显示Toast提示
        if (request.action === 'showToast') {
          this.showContextMenuToast(request.message);
          if (handlers.onShowToast) {
            handlers.onShowToast(request.message);
          }
        }
        
        // 自定义处理器
        if (handlers.onMessage) {
          handlers.onMessage(request, sender, sendResponse);
        }
      });
    },
    
    // 处理命令
    processCommand(command, text) {
      let result;
      switch (command) {
        case 'base64':
          result = btoa(unescape(encodeURIComponent(text)));
          break;
        case 'md5':
          // 与弹窗按钮一致，使用相同的md5逻辑
          result = window.commands?.md5 ? window.commands.md5([text]) : '';
          break;
        case 'url-encode':
          result = encodeURIComponent(text);
          break;
        case 'upper':
          result = text.toUpperCase();
          break;
        case 'lower':
          result = text.toLowerCase();
          break;
      }
      if (result) {
        navigator.clipboard.writeText(result).then(() => {
          this.showContextMenuToast(`处理完成并已复制: ${result.substring(0, 50)}${result.length > 50 ? '...' : ''}`);
        });
      }
      return result;
    },
    
    // 显示右键菜单操作的Toast提示
    showContextMenuToast(message) {
      // 优先使用Toast模块
      if (window.CCSModules?.Toast) {
        window.CCSModules.Toast.showContextMenuToast(message);
        return;
      }
      
      // 后备实现
      const toast = document.createElement('div');
      toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 12px 20px;
        border-radius: 6px;
        font-size: 14px;
        z-index: 2147483647;
        animation: slideIn 0.3s ease-out;
      `;
      toast.textContent = message;
      
      const style = document.createElement('style');
      style.textContent = `
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `;
      document.head.appendChild(style);
      document.body.appendChild(toast);
      
      setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease-out reverse';
        setTimeout(() => {
          toast.remove();
          style.remove();
        }, 300);
      }, 3000);
    }
  };

  // 导出模块
  window.CCSModules.BackgroundComm = BackgroundComm;
  
  // 兼容性：导出全局函数
  window.requestKeywordsFromBackground = () => BackgroundComm.requestKeywordsFromBackground();
  window.showContextMenuToast = (message) => BackgroundComm.showContextMenuToast(message);
  
  // 导出调试请求ID（兼容旧代码）
  window.DEBUG_REQUEST_ID = 0;
  Object.defineProperty(window, 'DEBUG_REQUEST_ID', {
    get() { return BackgroundComm.DEBUG_REQUEST_ID; },
    set(value) { BackgroundComm.DEBUG_REQUEST_ID = value; }
  });
})();