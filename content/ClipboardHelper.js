/**
 * 触触搜 - 剪贴板助手
 * 提供跨浏览器的剪贴板操作
 *
 * @module content/ClipboardHelper
 */

(() => {
  'use strict';

  /**
   * 剪贴板助手类
   */
  class ClipboardHelper {
    /**
     * 复制文本到剪贴板
     * @param {string} text - 要复制的文本
     * @returns {Promise<boolean>}
     */
    static async copy(text) {
      if (!text) {
        return Promise.resolve(true);
      }

      // 优先使用 Clipboard API
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch (err) {
          console.warn('[触触搜][Clipboard] Clipboard API 失败，尝试回退方法:', err);
        }
      }

      // 回退到 execCommand
      return ClipboardHelper._fallbackCopy(text);
    }

    /**
     * 从剪贴板读取文本
     * @returns {Promise<string>}
     */
    static async read() {
      if (navigator.clipboard?.readText) {
        try {
          return await navigator.clipboard.readText();
        } catch (err) {
          console.warn('[触触搜][Clipboard] 读取剪贴板失败:', err);
          return '';
        }
      }
      return '';
    }

    /**
     * 回退复制方法
     * @private
     */
    static _fallbackCopy(text) {
      return new Promise((resolve) => {
        try {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.setAttribute('readonly', '');
          textarea.style.cssText = `
            position: fixed;
            top: -10000px;
            left: -10000px;
            width: 1px;
            height: 1px;
            opacity: 0;
          `;

          document.body.appendChild(textarea);
          textarea.select();
          textarea.setSelectionRange(0, text.length);

          const succeeded = document.execCommand('copy');
          document.body.removeChild(textarea);

          resolve(succeeded);
        } catch (err) {
          console.warn('[触触搜][Clipboard] 回退复制失败:', err);
          resolve(false);
        }
      });
    }

    /**
     * 检查剪贴板 API 是否可用
     * @returns {boolean}
     */
    static isClipboardAPISupported() {
      return !!(navigator.clipboard && navigator.clipboard.writeText);
    }
  }

  // 导出到全局
  window.CCSModules = window.CCSModules || {};
  window.CCSModules.ClipboardHelper = ClipboardHelper;
})();
