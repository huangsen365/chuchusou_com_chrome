/**
 * 触触搜 Popup - Toast 通知助手
 * 提供 Popup 页面内的 Toast 通知功能
 *
 * @module popup/modules/ToastHelper
 */

class ToastHelper {
  constructor(options = {}) {
    this.duration = options.duration || 2000;
    this.className = options.className || 'popup-toast';
  }

  /**
   * 显示 Toast 消息
   * @param {string} message - 消息内容
   * @param {Object} options - 选项
   */
  show(message, options = {}) {
    if (!message) return;

    const { duration = this.duration, type = 'info' } = options;

    const toast = document.createElement('div');
    toast.className = `${this.className} ${this.className}-${type}`;
    toast.textContent = message;

    document.body.appendChild(toast);

    // 自动消失
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  /**
   * 显示信息提示
   */
  info(message) {
    this.show(message, { type: 'info' });
  }

  /**
   * 显示成功提示
   */
  success(message) {
    this.show(message, { type: 'success' });
  }

  /**
   * 显示错误提示
   */
  error(message) {
    this.show(message, { type: 'error' });
  }

  /**
   * 显示警告提示
   */
  warning(message) {
    this.show(message, { type: 'warning' });
  }
}

// 导出到全局
window.CCSPopup = window.CCSPopup || {};
window.CCSPopup.ToastHelper = ToastHelper;
