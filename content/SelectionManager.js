/**
 * 触触搜 - 选区管理器
 * 负责读取、跟踪和同步页面选中文本
 *
 * @module content/SelectionManager
 */

(() => {
  'use strict';

  /**
   * 选区管理器类
   */
  class SelectionManager {
    constructor(options = {}) {
      this.debug = options.debug || false;
      this.syncDelay = options.syncDelay || 35;

      // 状态
      this.currentSelection = '';
      this.lastNonEmptySelection = '';
      this.debounceTimer = null;
      this.isUserSelecting = false;

      // 回调
      this.onSelectionChange = options.onSelectionChange || null;
    }

    /**
     * 读取当前选中文本
     * @returns {string}
     */
    readCurrentSelection() {
      try {
        // 优先从 window.getSelection() 获取
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const raw = selection.toString();
          if (raw && raw.trim().length > 0) {
            return raw;
          }
        }

        // 回退到活动元素
        const fallback = this._readFromActiveElement();
        if (fallback) {
          return fallback;
        }

        return '';
      } catch (err) {
        this._log('读取选中文本失败:', err);
        return '';
      }
    }

    /**
     * 从活动元素读取选区
     * @private
     */
    _readFromActiveElement() {
      const activeElement = document.activeElement;
      return this._extractFromElement(activeElement);
    }

    /**
     * 从元素提取选区文本
     * @private
     */
    _extractFromElement(element) {
      if (!element) return '';

      try {
        // 输入框/文本域
        if (typeof element.value === 'string') {
          const { selectionStart, selectionEnd } = element;
          if (
            typeof selectionStart === 'number' &&
            typeof selectionEnd === 'number' &&
            selectionStart !== selectionEnd
          ) {
            const value = element.value;
            if (value) {
              const start = Math.min(selectionStart, selectionEnd);
              const end = Math.max(selectionStart, selectionEnd);
              const result = value.slice(start, end);
              if (result && result.trim().length > 0) {
                return result;
              }
            }
          }
        }

        // Shadow DOM
        if (element.shadowRoot) {
          const shadowActive = element.shadowRoot.activeElement;
          if (shadowActive && shadowActive !== element) {
            const shadowText = this._extractFromElement(shadowActive);
            if (shadowText) {
              return shadowText;
            }
          }
          const shadowSelection = element.shadowRoot.getSelection
            ? element.shadowRoot.getSelection()
            : null;
          if (shadowSelection && shadowSelection.rangeCount > 0) {
            const raw = shadowSelection.toString();
            if (raw && raw.trim().length > 0) {
              return raw;
            }
          }
        }

        // ContentEditable
        if (element.isContentEditable) {
          const editableSelection = window.getSelection();
          if (editableSelection && editableSelection.rangeCount > 0) {
            const raw = editableSelection.toString();
            if (raw && raw.trim().length > 0) {
              return raw;
            }
          }
        }
      } catch (err) {
        this._log('从元素提取选区失败:', err);
      }

      return '';
    }

    /**
     * 应用选区变更
     * @param {string} text - 选中文本
     * @param {string} trigger - 触发来源
     */
    applySelection(text, trigger = 'unknown') {
      const raw = typeof text === 'string' ? text : '';
      const trimmed = raw.trim();
      const hasContent = trimmed.length > 0;
      const value = hasContent ? trimmed : '';

      // 更新全局变量（兼容性）
      if (typeof window !== 'undefined') {
        window.selectedText = value;
        if (hasContent) {
          window.lastNonEmptySelection = value;
        }
      }

      // 检查是否有变化
      if (this.currentSelection === value) {
        return;
      }

      this.currentSelection = value;
      if (hasContent) {
        this.lastNonEmptySelection = value;
      }

      this._log('同步选中文本', { trigger, text: value });

      // 触发回调
      if (this.onSelectionChange) {
        this.onSelectionChange(value, trigger);
      }
    }

    /**
     * 更新选区（带防抖）
     * @param {string} trigger - 触发来源
     * @param {Object} options - 选项
     */
    updateSelection(trigger, options = {}) {
      const { immediate = false } = options;

      if (immediate) {
        const immediateSelection = this.readCurrentSelection();
        this.applySelection(immediateSelection, trigger);

        // 如果没有读取到，延迟重试
        if (!immediateSelection || !immediateSelection.trim()) {
          setTimeout(() => {
            const retrySelection = this.readCurrentSelection();
            if (retrySelection && retrySelection.trim()) {
              this.applySelection(retrySelection, `${trigger}-retry`);
            }
          }, this.syncDelay);
        }
        return;
      }

      // 防抖处理
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        this.applySelection(this.readCurrentSelection(), trigger);
      }, this.syncDelay);
    }

    /**
     * 获取首选文本
     * @param {string} value - 传入值
     * @returns {string}
     */
    getPreferredText(value) {
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
      if (this.currentSelection && this.currentSelection.length > 0) {
        return this.currentSelection;
      }
      const live = this.readCurrentSelection();
      return live && live.length > 0 ? live : '';
    }

    /**
     * 获取选区快照
     * @param {boolean} preferEmpty - 是否优先返回空值
     * @returns {Object}
     */
    getSnapshot(preferEmpty = false) {
      const live = this.readCurrentSelection();
      let chosen = typeof live === 'string' ? live : '';
      let source = 'live';

      if (!chosen || !chosen.trim()) {
        if (preferEmpty) {
          chosen = '';
          source = 'empty';
        } else if (this.currentSelection && this.currentSelection.trim().length > 0) {
          chosen = this.currentSelection;
          source = 'state';
        } else if (this.lastNonEmptySelection && this.lastNonEmptySelection.trim().length > 0) {
          chosen = this.lastNonEmptySelection;
          source = 'memory';
        } else {
          chosen = '';
          source = 'empty';
        }
      } else if (this.currentSelection !== chosen) {
        this.currentSelection = chosen;
      }

      if (chosen && chosen.trim()) {
        window.selectedText = chosen;
        window.lastNonEmptySelection = chosen;
        this.lastNonEmptySelection = chosen;
      }

      return {
        text: chosen,
        source,
        url: window.location.href,
        title: document.title || ''
      };
    }

    /**
     * 设置选中状态
     * @param {boolean} selecting
     */
    setUserSelecting(selecting) {
      this.isUserSelecting = selecting;
    }

    /**
     * 检查用户是否正在选择
     * @returns {boolean}
     */
    isSelecting() {
      return this.isUserSelecting;
    }

    /**
     * 调试日志
     * @private
     */
    _log(...args) {
      if (this.debug) {
        console.log('[触触搜][Selection]', ...args);
      }
    }
  }

  // 导出到全局
  window.CCSModules = window.CCSModules || {};
  window.CCSModules.SelectionManager = SelectionManager;
})();
