(function() {
  'use strict';

  // 确保全局命名空间存在
  window.CCSModules = window.CCSModules || {};
  
  // Toast 模块 - 通知提示功能
  const Toast = {
    // 默认配置
    defaultOptions: {
      duration: 3000,
      position: 'bottom-right',
      animation: true
    },

    // 显示 Toast 通知
    show(message, options = {}) {
      const config = { ...this.defaultOptions, ...options };
      
      // 创建 Toast 元素
      const toast = document.createElement('div');
      toast.className = 'ccs-toast';
      toast.textContent = message;
      
      // 设置样式
      toast.style.cssText = `
        position: fixed;
        ${config.position.includes('bottom') ? 'bottom: 20px;' : 'top: 20px;'}
        ${config.position.includes('right') ? 'right: 20px;' : 'left: 20px;'}
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 12px 20px;
        border-radius: 6px;
        font-size: 14px;
        z-index: 2147483647;
        opacity: 0;
        transform: translateX(20px);
        transition: all 0.3s ease-out;
        max-width: 300px;
        word-wrap: break-word;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      `;
      
      // 添加到页面
      document.body.appendChild(toast);
      
      // 触发动画
      if (config.animation) {
        requestAnimationFrame(() => {
          toast.style.opacity = '1';
          toast.style.transform = 'translateX(0)';
        });
      } else {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
      }
      
      // 自动隐藏
      setTimeout(() => {
        if (config.animation) {
          toast.style.opacity = '0';
          toast.style.transform = 'translateX(20px)';
          setTimeout(() => {
            if (toast.parentNode) {
              toast.remove();
            }
          }, 300);
        } else {
          if (toast.parentNode) {
            toast.remove();
          }
        }
      }, config.duration);
      
      return toast;
    },

    // 显示成功提示
    success(message, options = {}) {
      const toast = this.show(message, options);
      toast.style.background = 'rgba(34, 139, 34, 0.9)';
      return toast;
    },

    // 显示错误提示
    error(message, options = {}) {
      const toast = this.show(message, options);
      toast.style.background = 'rgba(220, 20, 60, 0.9)';
      return toast;
    },

    // 显示警告提示
    warning(message, options = {}) {
      const toast = this.show(message, options);
      toast.style.background = 'rgba(255, 140, 0, 0.9)';
      return toast;
    },

    // 显示信息提示
    info(message, options = {}) {
      const toast = this.show(message, options);
      toast.style.background = 'rgba(30, 144, 255, 0.9)';
      return toast;
    },

    // 显示右键菜单操作的 Toast（保留兼容性）
    showContextMenuToast(message) {
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
    },

    // 清除所有 Toast
    clearAll() {
      const toasts = document.querySelectorAll('.ccs-toast');
      toasts.forEach(toast => {
        if (toast.parentNode) {
          toast.remove();
        }
      });
    }
  };

  // 导出模块
  window.CCSModules.Toast = Toast;
  
  // 兼容性：导出到全局作为函数
  window.showToast = (message, options) => Toast.show(message, options);
  window.showContextMenuToast = (message) => Toast.showContextMenuToast(message);
})();