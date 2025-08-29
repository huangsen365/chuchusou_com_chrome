(() => {
  'use strict';

  // 确保全局命名空间存在
  window.CCSModules = window.CCSModules || {};

  // TextSync 模块 - 文本同步管理
  const TextSync = {
    // 模块状态
    selectedText: '',
    lastNonEmptySelection: '',
    shadowRoot: null,

    // 初始化模块
    init(shadowRootElement) {
      this.shadowRoot = shadowRootElement;
    },

    // 设置 shadowRoot
    setShadowRoot(shadowRootElement) {
      this.shadowRoot = shadowRootElement;
    },

    // 获取当前选中的文本
    getSelectedText() {
      return this.selectedText;
    },

    // 设置选中的文本
    setSelectedText(text) {
      this.selectedText = text || '';
      return this.selectedText;
    },

    // 获取最后的非空选择
    getLastNonEmptySelection() {
      return this.lastNonEmptySelection;
    },

    // 设置最后的非空选择
    setLastNonEmptySelection(text) {
      if (text && text.trim()) {
        this.lastNonEmptySelection = text;
      }
      return this.lastNonEmptySelection;
    },

    // 统一同步所有文本相关变量
    syncAllTextVariables() {
      console.log('[触触搜] syncAllTextVariables 开始执行 (强制刷新，跳过缓存)');
      
      // 使用统一函数获取最新的文本（强制刷新，跳过缓存）
      let latestText = '';
      if (window.getUnifiedSearchText) {
        latestText = window.getUnifiedSearchText({ forceRefresh: true, skipCache: true });
      } else {
        // 后备方案：直接获取选中文本
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          latestText = selection.toString().trim();
        }
      }
      
      console.log('[触触搜] syncAllTextVariables 获取到的文本:', {
        text: latestText,
        length: latestText ? latestText.length : 0,
        isEmpty: !latestText
      });
      
      // 更新模块内部变量
      this.selectedText = latestText || '';
      
      // 更新全局变量（保持兼容性）
      if (window.selectedText !== undefined) {
        window.selectedText = this.selectedText;
      }
      
      // 更新最近的非空选择（如果有新的选中文本）
      const currentSelection = this.getActiveSelectionText();
      if (currentSelection) {
        console.log('[触触搜] syncAllTextVariables 更新 lastNonEmptySelection:', currentSelection);
        this.lastNonEmptySelection = currentSelection;
        // 更新全局变量（保持兼容性）
        if (window.lastNonEmptySelection !== undefined) {
          window.lastNonEmptySelection = this.lastNonEmptySelection;
        }
      }
      
      // 更新输入框（如果存在）
      if (this.shadowRoot) {
        const input = this.shadowRoot.querySelector('.ccs-input');
        if (input) {
          input.value = this.selectedText;
          console.log('[触触搜] syncAllTextVariables 更新输入框值:', this.selectedText);
        }
      }
      
      // 注意：不再自动更新所有按钮的 data-search-text
      // 按钮的文本应该由悬停事件单独管理，避免覆盖用户选择的文本
      
      console.log('[触触搜] syncAllTextVariables 完成，返回文本:', this.selectedText);
      // 返回同步后的文本
      return this.selectedText;
    },

    // 获取活动的选中文本
    getActiveSelectionText() {
      if (window.getActiveSelectionText) {
        return window.getActiveSelectionText();
      }
      // 后备方案
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const text = selection.toString().trim();
        if (text) {
          return text;
        }
      }
      return '';
    },

    // 更新所有按钮使用相同的文本值
    updateAllButtonsWithSameText(text) {
      if (!this.shadowRoot) {
        // 尝试获取全局 shadowRoot
        if (window.shadowRoot) {
          this.shadowRoot = window.shadowRoot;
        } else {
          return;
        }
      }
      
      const buttons = this.shadowRoot.querySelectorAll('.ccs-button');
      buttons.forEach(button => {
        const btnTitle = button.dataset.btnTitle;
        if (btnTitle) {
          // 更新存储的文本值和tooltip
          button.dataset.searchText = text || '';
          button.title = text ? `${btnTitle}: ${text}` : btnTitle;
        }
      });
    },

    // 更新输入框的值
    updateInputValue(text) {
      if (!this.shadowRoot) {
        // 尝试获取全局 shadowRoot
        if (window.shadowRoot) {
          this.shadowRoot = window.shadowRoot;
        } else {
          return false;
        }
      }
      
      const input = this.shadowRoot.querySelector('.ccs-input');
      if (input) {
        input.value = text || '';
        return true;
      }
      return false;
    },

    // 获取输入框的值
    getInputValue() {
      if (!this.shadowRoot) {
        // 尝试获取全局 shadowRoot
        if (window.shadowRoot) {
          this.shadowRoot = window.shadowRoot;
        } else {
          return '';
        }
      }
      
      const input = this.shadowRoot.querySelector('.ccs-input');
      return input ? input.value : '';
    },

    // 清除选中文本
    clearSelection() {
      this.selectedText = '';
      if (window.selectedText !== undefined) {
        window.selectedText = '';
      }
      this.updateInputValue('');
      this.updateAllButtonsWithSameText('');
    },

    // 刷新文本（强制从页面重新获取）
    refreshText(options = {}) {
      const forceRefresh = options.forceRefresh !== false;
      const skipCache = options.skipCache !== false;
      
      if (window.getUnifiedSearchText) {
        const text = window.getUnifiedSearchText({ forceRefresh, skipCache });
        this.setSelectedText(text);
        if (text) {
          this.setLastNonEmptySelection(text);
        }
        return text;
      }
      
      // 后备方案
      return this.syncAllTextVariables();
    }
  };

  // 导出模块
  window.CCSModules.TextSync = TextSync;
  
  // 导出全局函数以保持兼容性
  window.syncAllTextVariables = () => TextSync.syncAllTextVariables();
  window.updateAllButtonsWithSameText = (text) => TextSync.updateAllButtonsWithSameText(text);
})();