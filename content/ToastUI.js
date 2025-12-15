/**
 * 触触搜 - Toast 通知组件
 * 提供轻量级的页面内通知功能
 *
 * @module content/ToastUI
 */

(() => {
  'use strict';

  /**
   * Toast 通知类
   */
  class Toast {
    constructor(options = {}) {
      this.duration = options.duration || 2000;
      this.position = options.position || 'bottom-right';
      this.containerClass = options.containerClass || 'ccs-toast-container';
    }

    /**
     * 显示 Toast 消息
     * @param {string} message - 消息内容
     * @param {Object} options - 选项
     */
    show(message, options = {}) {
      if (!message) return;

      const {
        type = 'info',
        duration = this.duration
      } = options;

      const toast = document.createElement('div');
      toast.className = `ccs-toast ccs-toast-${type}`;
      toast.textContent = message;

      // 应用样式
      this._applyStyles(toast, type);

      document.body.appendChild(toast);

      // 淡入动画
      requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
      });

      // 自动消失
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 200);
      }, duration);
    }

    /**
     * 显示信息提示
     * @param {string} message - 消息内容
     */
    info(message) {
      this.show(message, { type: 'info' });
    }

    /**
     * 显示成功提示
     * @param {string} message - 消息内容
     */
    success(message) {
      this.show(message, { type: 'success' });
    }

    /**
     * 显示错误提示
     * @param {string} message - 消息内容
     */
    error(message) {
      this.show(message, { type: 'error' });
    }

    /**
     * 显示警告提示
     * @param {string} message - 消息内容
     */
    warning(message) {
      this.show(message, { type: 'warning' });
    }

    /**
     * 显示右键菜单操作结果
     * @param {string} message - 消息内容
     */
    showContextMenuToast(message) {
      this.info(message);
    }

    /**
     * 应用样式
     * @private
     */
    _applyStyles(toast, type) {
      const colors = {
        info: { bg: 'rgba(0, 0, 0, 0.85)', color: '#fff' },
        success: { bg: 'rgba(39, 174, 96, 0.95)', color: '#fff' },
        error: { bg: 'rgba(231, 76, 60, 0.95)', color: '#fff' },
        warning: { bg: 'rgba(241, 196, 15, 0.95)', color: '#333' }
      };

      const { bg, color } = colors[type] || colors.info;

      const positionStyles = this._getPositionStyles();

      toast.style.cssText = `
        position: fixed;
        ${positionStyles}
        background: ${bg};
        color: ${color};
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 2147483647;
        opacity: 0;
        transform: translateY(10px);
        transition: opacity 0.2s ease, transform 0.2s ease;
        max-width: 300px;
        word-wrap: break-word;
        pointer-events: none;
      `;
    }

    /**
     * 获取位置样式
     * @private
     */
    _getPositionStyles() {
      const positions = {
        'bottom-right': 'bottom: 20px; right: 20px;',
        'bottom-left': 'bottom: 20px; left: 20px;',
        'top-right': 'top: 20px; right: 20px;',
        'top-left': 'top: 20px; left: 20px;',
        'bottom-center': 'bottom: 20px; left: 50%; transform: translateX(-50%);',
        'top-center': 'top: 20px; left: 50%; transform: translateX(-50%);'
      };
      return positions[this.position] || positions['bottom-right'];
    }
  }

  // 创建默认实例
  const defaultToast = new Toast();

  // 导出到全局
  window.CCSModules = window.CCSModules || {};
  window.CCSModules.Toast = defaultToast;
  window.CCSModules.ToastClass = Toast;
})();
