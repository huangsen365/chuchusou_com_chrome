(() => {
  'use strict';

  // 确保全局命名空间存在
  window.CCSModules = window.CCSModules || {};

  // DOMMonitor 模块 - DOM变化监控和页面变化检测
  const DOMMonitor = {
    // 监控器实例
    domObserver: null,
    pageChangeCallbacks: [],
    selectionChangeCallbacks: [],
    
    // 配置
    config: {
      observeBody: true,
      observeSubtree: true,
      observeChildList: true,
      observeAttributes: false,
      observeCharacterData: false,
      debounceDelay: 300
    },

    // 页面变化监控
    lastObservedHref: '',
    lastObservedTitle: '',
    realtimeUpdateTimer: null,

    // 选择变化监控
    selectionTimeout: null,
    lastSelectedText: '',
    lastSelectionTime: 0,
    lastNotifiedText: '',

    // 初始化模块
    init(options = {}) {
      this.config = { ...this.config, ...options };
      this.lastObservedHref = window.location.href;
      this.lastObservedTitle = document.title || '';
      
      // 启动各种监控
      this.startDOMMonitoring();
      this.startPageChangeMonitoring();
      this.startSelectionMonitoring();
      
      console.log('[触触搜] DOM监控模块已初始化');
    },

    // 启动DOM监控
    startDOMMonitoring(targetElement = null) {
      // 如果已存在，先断开
      if (this.domObserver) {
        this.domObserver.disconnect();
      }
      
      this.domObserver = new MutationObserver((mutations) => {
        this.handleDOMMutations(mutations);
      });
      
      // 默认监控document.body
      const target = targetElement || document.body;
      if (!target) {
        console.warn('[触触搜] DOM监控目标不存在，等待document.body加载');
        setTimeout(() => this.startDOMMonitoring(), 100);
        return;
      }
      
      // 开始监控
      this.domObserver.observe(target, {
        childList: this.config.observeChildList,
        subtree: this.config.observeSubtree,
        attributes: this.config.observeAttributes,
        characterData: this.config.observeCharacterData
      });
      
      console.log('[触触搜] DOM监控已启动');
    },

    // 处理DOM变化
    handleDOMMutations(mutations) {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          // 检查被移除的节点
          mutation.removedNodes.forEach((node) => {
            this.checkRemovedNode(node, mutation);
          });
          
          // 检查新增的节点
          mutation.addedNodes.forEach((node) => {
            this.checkAddedNode(node, mutation);
          });
        }
      });
    },

    // 检查被移除的节点
    checkRemovedNode(node, mutation) {
      // 检查是否是popover被移除
      const popover = window.popover || document.getElementById('ccs-popover-container');
      if (popover && (node === popover || (node.nodeType === 1 && node.contains && node.contains(popover)))) {
        console.error('[触触搜] ⚠️ Popover被从DOM中移除！', {
          removedNode: node,
          isPopover: node === popover,
          containsPopover: node.contains && popover && node.contains(popover),
          parentNode: mutation.target,
          stackTrace: new Error().stack
        });
        
        // 触发popover移除回调
        this.triggerCallback('popoverRemoved', { node, mutation });
      }
    },

    // 检查新增的节点
    checkAddedNode(node, mutation) {
      // 可以在这里检查特定节点的添加
      // 例如检查是否有冲突的元素被添加
    },

    // 启动页面变化监控
    startPageChangeMonitoring() {
      // 监听URL变化
      const originalPushState = history.pushState;
      const originalReplaceState = history.replaceState;
      
      history.pushState = (...args) => {
        originalPushState.apply(history, args);
        this.handlePageChange('pushState');
      };
      
      history.replaceState = (...args) => {
        originalReplaceState.apply(history, args);
        this.handlePageChange('replaceState');
      };
      
      // 监听popstate事件
      window.addEventListener('popstate', () => {
        this.handlePageChange('popstate');
      });
      
      // 监听hashchange事件
      window.addEventListener('hashchange', () => {
        this.handlePageChange('hashchange');
      });
      
      // 定期检查页面变化
      this.scheduleRealtimeUpdate();
      
      console.log('[触触搜] 页面变化监控已启动');
    },

    // 处理页面变化
    handlePageChange(eventType) {
      console.log('[触触搜] 页面变化检测:', eventType);
      
      const currentHref = window.location.href;
      const currentTitle = document.title || '';
      
      // 检查URL或标题是否变化
      if (currentHref !== this.lastObservedHref || currentTitle !== this.lastObservedTitle) {
        console.log('[触触搜] 页面已变化:', {
          oldHref: this.lastObservedHref,
          newHref: currentHref,
          oldTitle: this.lastObservedTitle,
          newTitle: currentTitle,
          trigger: eventType
        });
        
        this.lastObservedHref = currentHref;
        this.lastObservedTitle = currentTitle;
        
        // 触发页面变化回调
        this.triggerCallback('pageChanged', {
          href: currentHref,
          title: currentTitle,
          eventType
        });
      }
    },

    // 定期检查页面变化
    scheduleRealtimeUpdate() {
      if (this.realtimeUpdateTimer) {
        clearTimeout(this.realtimeUpdateTimer);
      }
      
      this.realtimeUpdateTimer = setTimeout(() => {
        this.updateRealtimeFallback();
        this.scheduleRealtimeUpdate(); // 继续下一轮
      }, 500); // 每500ms检查一次
    },

    // 实时更新检查
    updateRealtimeFallback(forceRefresh = false) {
      const currentHref = window.location.href;
      const currentTitle = document.title || '';
      
      // 检查是否有变化
      if (forceRefresh || currentHref !== this.lastObservedHref || currentTitle !== this.lastObservedTitle) {
        this.lastObservedHref = currentHref;
        this.lastObservedTitle = currentTitle;
        
        // 触发实时更新回调
        this.triggerCallback('realtimeUpdate', {
          href: currentHref,
          title: currentTitle,
          forceRefresh
        });
      }
    },

    // 启动选择变化监控
    startSelectionMonitoring() {
      // 监听选择变化事件
      document.addEventListener('selectionchange', () => {
        this.handleSelectionChange();
      });
      
      // 监听鼠标抬起事件（选择完成）
      document.addEventListener('mouseup', (e) => {
        // 延迟处理，确保选择已完成
        setTimeout(() => {
          this.handleSelectionChange(e);
        }, 10);
      });
      
      console.log('[触触搜] 选择变化监控已启动');
    },

    // 处理选择变化
    handleSelectionChange(event = null) {
      // 清除之前的定时器
      if (this.selectionTimeout) {
        clearTimeout(this.selectionTimeout);
      }
      
      // 防抖处理
      this.selectionTimeout = setTimeout(() => {
        const selection = window.getSelection();
        const text = selection ? selection.toString().trim() : '';
        
        // 检查是否有变化
        if (text !== this.lastSelectedText) {
          const now = Date.now();
          
          // 记录变化
          this.lastSelectedText = text;
          this.lastSelectionTime = now;
          
          // 触发选择变化回调
          this.triggerCallback('selectionChanged', {
            text,
            selection,
            event,
            timestamp: now
          });
          
          // 通知background script（如果文本变化）
          if (text !== this.lastNotifiedText) {
            this.lastNotifiedText = text;
            this.notifyBackgroundScript(text);
          }
        }
      }, this.config.debounceDelay);
    },

    // 通知background script
    notifyBackgroundScript(text) {
      // 安全地发送消息
      if (window.safeChromeSendMessage) {
        window.safeChromeSendMessage({
          action: 'selectionChanged',
          text: text
        });
      } else if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          chrome.runtime.sendMessage({
            action: 'selectionChanged',
            text: text
          });
        } catch (e) {
          console.warn('[触触搜] 无法发送消息到background:', e);
        }
      }
    },

    // 注册回调
    registerCallback(event, callback) {
      switch (event) {
        case 'pageChanged':
        case 'realtimeUpdate':
          if (!this.pageChangeCallbacks.includes(callback)) {
            this.pageChangeCallbacks.push(callback);
          }
          break;
        case 'selectionChanged':
          if (!this.selectionChangeCallbacks.includes(callback)) {
            this.selectionChangeCallbacks.push(callback);
          }
          break;
        case 'popoverRemoved':
          // 特殊事件，直接存储
          this.popoverRemovedCallback = callback;
          break;
      }
    },

    // 触发回调
    triggerCallback(event, data) {
      switch (event) {
        case 'pageChanged':
        case 'realtimeUpdate':
          this.pageChangeCallbacks.forEach(cb => {
            try {
              cb(data);
            } catch (e) {
              console.error('[触触搜] 页面变化回调错误:', e);
            }
          });
          break;
        case 'selectionChanged':
          this.selectionChangeCallbacks.forEach(cb => {
            try {
              cb(data);
            } catch (e) {
              console.error('[触触搜] 选择变化回调错误:', e);
            }
          });
          break;
        case 'popoverRemoved':
          if (this.popoverRemovedCallback) {
            try {
              this.popoverRemovedCallback(data);
            } catch (e) {
              console.error('[触触搜] Popover移除回调错误:', e);
            }
          }
          break;
      }
    },

    // 停止所有监控
    stop() {
      // 停止DOM监控
      if (this.domObserver) {
        this.domObserver.disconnect();
        this.domObserver = null;
      }
      
      // 停止定时器
      if (this.realtimeUpdateTimer) {
        clearTimeout(this.realtimeUpdateTimer);
        this.realtimeUpdateTimer = null;
      }
      
      if (this.selectionTimeout) {
        clearTimeout(this.selectionTimeout);
        this.selectionTimeout = null;
      }
      
      console.log('[触触搜] DOM监控已停止');
    },

    // 重启监控
    restart(options = {}) {
      this.stop();
      this.init(options);
    },

    // 获取当前选中的文本
    getCurrentSelection() {
      return this.lastSelectedText;
    },

    // 获取页面信息
    getPageInfo() {
      return {
        href: this.lastObservedHref,
        title: this.lastObservedTitle
      };
    }
  };

  // 导出模块
  window.CCSModules.DOMMonitor = DOMMonitor;
  
  // 导出全局函数以保持兼容性
  window.startDOMMonitoring = () => DOMMonitor.startDOMMonitoring();
  window.notifySelectionChange = () => DOMMonitor.handleSelectionChange();
  window.scheduleRealtimeUpdate = () => DOMMonitor.scheduleRealtimeUpdate();
  window.updateRealtimeFallbackUI = (forceRefresh) => DOMMonitor.updateRealtimeFallback(forceRefresh);
})();