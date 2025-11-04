(function() {
  'use strict';

  // 确保全局命名空间存在
  window.CCSModules = window.CCSModules || {};
  
  // Selection 模块 - 文本选择管理
  const Selection = {
    // 状态
    selectedText: '',
    lastNonEmptySelection: '',
    isProcessingSelection: false,
    
    // 获取当前选中的文本
    getActiveSelectionText() {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const text = selection.toString().trim();
        if (text) {
          this.lastNonEmptySelection = text;
          return text;
        }
      }
      return '';
    },

    // 获取当前搜索文本（带缓存）
    getCurrentSearchText(forceRefresh = false) {
      if (!forceRefresh && this.selectedText) {
        return this.selectedText;
      }
      return this.getUnifiedSearchText({ forceRefresh });
    },

    // 统一的搜索文本获取（优先级：选中 > 缓存 > URL > 标题）
    getUnifiedSearchText(options = {}) {
      const { forceRefresh = false, skipCache = false } = options;
      
      // 1. 优先使用选中文本
      const selected = this.getActiveSelectionText();
      if (selected) {
        this.selectedText = selected;
        return selected;
      }
      
      // 2. 使用缓存的选中文本（除非跳过缓存）
      if (!skipCache && !forceRefresh && this.selectedText) {
        return this.selectedText;
      }
      
      // 3. 使用最后的非空选中文本
      if (this.lastNonEmptySelection) {
        return this.lastNonEmptySelection;
      }
      
      // 4. 尝试从URL提取关键词
      const urlKeyword = this.extractSearchKeywordFromUrl();
      if (urlKeyword) {
        return urlKeyword;
      }
      
      // 5. 使用页面标题
      const title = document.title || '';
      return title.trim();
    },

    // 从URL提取搜索关键词
    extractSearchKeywordFromUrl() {
      const url = window.location.href;
      const hostname = window.location.hostname;
      const params = new URLSearchParams(window.location.search);
      
      // Google
      if (hostname.includes('google.com')) {
        const q = params.get('q');
        if (q) return decodeURIComponent(q);
      }
      
      // 百度
      if (hostname.includes('baidu.com')) {
        const wd = params.get('wd') || params.get('word');
        if (wd) return decodeURIComponent(wd);
      }
      
      // Bing
      if (hostname.includes('bing.com')) {
        const q = params.get('q');
        if (q) return decodeURIComponent(q);
      }
      
      // DuckDuckGo
      if (hostname.includes('duckduckgo.com')) {
        const q = params.get('q');
        if (q) return decodeURIComponent(q);
      }
      
      // 搜狗
      if (hostname.includes('sogou.com')) {
        const query = params.get('query') || params.get('keyword');
        if (query) return decodeURIComponent(query);
      }
      
      // 360搜索
      if (hostname.includes('so.com')) {
        const q = params.get('q');
        if (q) return decodeURIComponent(q);
      }
      
      // B站
      if (hostname.includes('bilibili.com')) {
        const keyword = params.get('keyword');
        if (keyword) return decodeURIComponent(keyword);
      }
      
      // 淘宝/天猫
      if (hostname.includes('taobao.com') || hostname.includes('tmall.com')) {
        const q = params.get('q');
        if (q) return decodeURIComponent(q);
      }
      
      // 京东
      if (hostname.includes('jd.com')) {
        const keyword = params.get('keyword');
        if (keyword) return decodeURIComponent(keyword);
      }
      
      // 知乎
      if (hostname.includes('zhihu.com')) {
        const q = params.get('q');
        if (q) return decodeURIComponent(q);
      }
      
      // GitHub
      if (hostname.includes('github.com')) {
        const q = params.get('q');
        if (q) return decodeURIComponent(q);
      }
      
      // YouTube
      if (hostname.includes('youtube.com')) {
        const search_query = params.get('search_query');
        if (search_query) return decodeURIComponent(search_query);
      }
      
      // 通用：尝试常见的查询参数
      const commonParams = ['q', 'query', 'keyword', 'search', 'wd', 'word', 's', 'text'];
      for (const param of commonParams) {
        const value = params.get(param);
        if (value) {
          return decodeURIComponent(value);
        }
      }
      
      return null;
    },

    // 检测文本类型
    detectTextType(text) {
      if (!text || typeof text !== 'string') return 'text';
      
      // URL检测
      try {
        new URL(text);
        return 'url';
      } catch (e) {
        // 不是完整URL，检查是否像域名
        if (/^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}$/.test(text)) {
          return 'url';
        }
      }
      
      // Email检测
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
        return 'email';
      }
      
      // Base64检测（至少20个字符）
      if (text.length >= 20 && /^[A-Za-z0-9+/]+=*$/.test(text)) {
        try {
          atob(text);
          return 'base64';
        } catch (e) {
          // 不是有效的base64
        }
      }
      
      // JSON检测
      if ((text.startsWith('{') && text.endsWith('}')) || 
          (text.startsWith('[') && text.endsWith(']'))) {
        try {
          JSON.parse(text);
          return 'json';
        } catch (e) {
          // 不是有效的JSON
        }
      }
      
      // 代码检测（简单判断）
      if (text.includes('function') || text.includes('const') || 
          text.includes('var') || text.includes('import') || 
          text.includes('class') || text.includes('def') ||
          text.includes('<?php') || text.includes('public static')) {
        return 'code';
      }
      
      // 数字检测
      if (/^\d+$/.test(text)) {
        return 'number';
      }
      
      // 默认为普通文本
      return 'text';
    },

    // 通知选择变化
    notifySelectionChange() {
      if (this.isProcessingSelection) return;
      
      const currentSelection = this.getActiveSelectionText();
      
      if (currentSelection !== this.selectedText) {
        this.selectedText = currentSelection;
        
        // 触发自定义事件
        const event = new CustomEvent('ccs-selection-change', {
          detail: { 
            text: currentSelection,
            type: this.detectTextType(currentSelection)
          }
        });
        document.dispatchEvent(event);
      }
    },

    // 清除选中
    clearSelection() {
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
      }
      this.selectedText = '';
    },

    // 选中元素的文本
    selectElementText(element) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      this.selectedText = selection.toString();
    },

    // 监听选择变化
    startMonitoring() {
      // 鼠标释放
      document.addEventListener('mouseup', () => {
        setTimeout(() => this.notifySelectionChange(), 10);
      });
      
      // 键盘操作（Shift+方向键选择）
      document.addEventListener('keyup', (e) => {
        if (e.shiftKey || e.key === 'Shift') {
          setTimeout(() => this.notifySelectionChange(), 10);
        }
      });
      
      // 双击选词
      document.addEventListener('dblclick', () => {
        setTimeout(() => this.notifySelectionChange(), 10);
      });
      
      // 三击选段落
      let clickCount = 0;
      let clickTimer = null;
      document.addEventListener('click', () => {
        clickCount++;
        if (clickCount === 3) {
          setTimeout(() => this.notifySelectionChange(), 10);
        }
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => {
          clickCount = 0;
        }, 500);
      });
    },

    // 获取选中区域的位置信息
    getSelectionRect() {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        return range.getBoundingClientRect();
      }
      return null;
    },

    // 同步所有文本变量（兼容性）
    syncAllTextVariables() {
      const currentText = this.getUnifiedSearchText({ forceRefresh: true });
      this.selectedText = currentText;
      return currentText;
    }
  };

  // 导出模块
  window.CCSModules.Selection = Selection;
  
  // 兼容性：导出全局函数
  window.getActiveSelectionText = () => Selection.getActiveSelectionText();
  window.detectTextType = (text) => Selection.detectTextType(text);
  window.notifySelectionChange = () => Selection.notifySelectionChange();
  window.getCurrentSearchText = (forceRefresh) => Selection.getCurrentSearchText(forceRefresh);
  window.syncAllTextVariables = () => Selection.syncAllTextVariables();

  try {
    document.addEventListener('contextmenu', () => {
      try {
        const text = Selection.getActiveSelectionText();
        if (chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
          chrome.runtime.sendMessage({
            action: 'contextMenuPreview',
            selectionText: text
          });
        }
      } catch (_) {}
    }, true);
  } catch (_) {}
})();
