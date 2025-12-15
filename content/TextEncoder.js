/**
 * 触触搜 - 文本编码器
 * 提供各种文本编码和转换功能
 *
 * @module content/TextEncoder
 */

(() => {
  'use strict';

  /**
   * 文本编码器类
   */
  class TextEncoder {
    /**
     * Base64 编码
     * @param {string} text - 输入文本
     * @returns {string|null}
     */
    static encodeBase64(text) {
      if (!text) return '';
      try {
        return btoa(unescape(encodeURIComponent(text)));
      } catch (err) {
        console.warn('[触触搜][Encoder] Base64 编码失败:', err);
        return null;
      }
    }

    /**
     * Base64 解码
     * @param {string} text - Base64 文本
     * @returns {string|null}
     */
    static decodeBase64(text) {
      if (!text) return '';
      try {
        return decodeURIComponent(escape(atob(text)));
      } catch (err) {
        console.warn('[触触搜][Encoder] Base64 解码失败:', err);
        return null;
      }
    }

    /**
     * URL 编码
     * @param {string} text - 输入文本
     * @returns {string}
     */
    static encodeURL(text) {
      if (!text) return '';
      return encodeURIComponent(text);
    }

    /**
     * URL 解码
     * @param {string} text - URL 编码文本
     * @returns {string|null}
     */
    static decodeURL(text) {
      if (!text) return '';
      try {
        return decodeURIComponent(text);
      } catch (err) {
        console.warn('[触触搜][Encoder] URL 解码失败:', err);
        return null;
      }
    }

    /**
     * 伪 MD5 哈希（简化实现，用于演示）
     * @param {string} text - 输入文本
     * @returns {string}
     */
    static pseudoMD5(text) {
      if (!text) {
        return '00000000000000000000000000000000';
      }
      let hash = 0;
      for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + charCode;
        hash |= 0;
      }
      const normalized = Math.abs(hash).toString(16);
      return normalized.padStart(32, '0').slice(0, 32);
    }

    /**
     * 转换为大写
     * @param {string} text - 输入文本
     * @returns {string}
     */
    static toUpperCase(text) {
      if (!text) return '';
      return text.toUpperCase();
    }

    /**
     * 转换为小写
     * @param {string} text - 输入文本
     * @returns {string}
     */
    static toLowerCase(text) {
      if (!text) return '';
      return text.toLowerCase();
    }

    /**
     * 执行命令
     * @param {string} command - 命令名称
     * @param {string} text - 输入文本
     * @returns {string|null}
     */
    static runCommand(command, text) {
      switch (command) {
        case 'base64':
          return TextEncoder.encodeBase64(text);
        case 'base64-decode':
          return TextEncoder.decodeBase64(text);
        case 'md5':
          return TextEncoder.pseudoMD5(text);
        case 'url-encode':
          return TextEncoder.encodeURL(text);
        case 'url-decode':
          return TextEncoder.decodeURL(text);
        case 'upper':
          return TextEncoder.toUpperCase(text);
        case 'lower':
          return TextEncoder.toLowerCase(text);
        default:
          return null;
      }
    }
  }

  // 导出到全局
  window.CCSModules = window.CCSModules || {};
  window.CCSModules.TextEncoder = TextEncoder;
})();
