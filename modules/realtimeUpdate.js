(function() {
  'use strict';

  // 确保全局命名空间存在
  window.CCSModules = window.CCSModules || {};
  
  // RealtimeUpdate 模块 - 实时更新UI功能
  const RealtimeUpdate = {
    // 监测的URL和标题
    lastObservedHref: window.location.href,
    lastObservedTitle: document.title || '',
    realtimeUpdateTimer: null,
    
    // 监测间隔（毫秒）
    CHECK_INTERVAL: 500,
    UPDATE_DELAY: 120,
    
    // 初始化模块
    init() {
      this.lastObservedHref = window.location.href;
      this.lastObservedTitle = document.title || '';
      this.startMonitoring();
    },
    
    // 开始监测页面变化
    startMonitoring() {
      // 幂等：第二次调用 init / startMonitoring 时直接 return，
      // 避免 observer / popstate listener / history wrap 叠加
      if (this._monitoring) return;
      this._monitoring = true;

      // 监测URL变化
      this.monitorInterval = setInterval(() => {
        this.checkForChanges();
      }, this.CHECK_INTERVAL);

      // 监听标题变化（引用存到 this._titleObserver，stopMonitoring 时 disconnect）
      this._titleObserver = new MutationObserver(() => {
        if (document.title !== this.lastObservedTitle) {
          this.lastObservedTitle = document.title;
          this.scheduleUpdate();
        }
      });

      this._titleObserver.observe(document.querySelector('title') || document.head, {
        childList: true,
        characterData: true,
        subtree: true
      });

      // 监听历史状态变化（单页应用）—— 引用存好以便后续 remove
      this._onPopState = () => { this.checkForChanges(); };
      window.addEventListener('popstate', this._onPopState);

      // 监听 pushState 和 replaceState
      // 守卫：如果 history.pushState 已被本模块包过，跳过；避免第二次 init 嵌套包装
      if (!history.pushState.__ccs_wrapped) {
        this._origPushState = history.pushState;
        this._origReplaceState = history.replaceState;

        const wrappedPush = function(...args) {
          RealtimeUpdate._origPushState.apply(history, args);
          setTimeout(() => RealtimeUpdate.checkForChanges(), 0);
        };
        wrappedPush.__ccs_wrapped = true;
        history.pushState = wrappedPush;

        const wrappedReplace = function(...args) {
          RealtimeUpdate._origReplaceState.apply(history, args);
          setTimeout(() => RealtimeUpdate.checkForChanges(), 0);
        };
        wrappedReplace.__ccs_wrapped = true;
        history.replaceState = wrappedReplace;
      }
    },
    
    // 检查页面是否有变化
    checkForChanges() {
      const currentHref = window.location.href;
      const currentTitle = document.title || '';
      
      if (currentHref !== this.lastObservedHref || currentTitle !== this.lastObservedTitle) {
        console.log('[触触搜] 检测到页面变化:', {
          urlChanged: currentHref !== this.lastObservedHref,
          titleChanged: currentTitle !== this.lastObservedTitle,
          oldUrl: this.lastObservedHref,
          newUrl: currentHref,
          oldTitle: this.lastObservedTitle,
          newTitle: currentTitle
        });
        
        this.lastObservedHref = currentHref;
        this.lastObservedTitle = currentTitle;
        
        this.scheduleUpdate();
      }
    },
    
    // 调度UI更新
    scheduleUpdate() {
      clearTimeout(this.realtimeUpdateTimer);
      this.realtimeUpdateTimer = setTimeout(() => {
        this.updateUI(false);
      }, this.UPDATE_DELAY);
    },
    
    // 更新UI（实时更新标题等）
    updateUI(forceRefresh = false) {
      try {
        // 检查是否有shadowRoot和popover
        if (!window.shadowRoot || !window.popover) return;
        
        // 使用统一的函数获取当前文本，支持强制刷新
        const getCurrentText = () => {
          if (window.CCSModules?.KeywordExtractor) {
            return window.CCSModules.KeywordExtractor.getCurrentSearchText(forceRefresh);
          } else if (window.getCurrentSearchText) {
            return window.getCurrentSearchText(forceRefresh);
          }
          return '';
        };
        
        const t = getCurrentText();
        if (!t) return;
        
        // 更新标题（若存在）
        const titleEl = window.shadowRoot.querySelector('.ccs-title');
        if (titleEl) {
          titleEl.title = t;
          // 文本显示由CSS省略控制，这里直接设全文
          titleEl.textContent = `🔍 触触搜: "${t}"`;
        }
        
        // 注意：不再自动更新按钮的 data-search-text
        // 让每个按钮独立管理自己的文本
        // 如果需要更新按钮，可以调用：
        // if (window.updateAllButtonsWithSameText) {
        //   window.updateAllButtonsWithSameText(t);
        // }
        
        console.log('[触触搜] UI已更新，当前文本:', t);
      } catch (err) {
        console.log('[触触搜] 更新UI时出错:', err);
      }
    },
    
    // 强制立即更新UI
    forceUpdate() {
      this.updateUI(true);
    },
    
    // 停止监测
    stopMonitoring() {
      this._monitoring = false;

      if (this.monitorInterval) {
        clearInterval(this.monitorInterval);
        this.monitorInterval = null;
      }

      if (this.realtimeUpdateTimer) {
        clearTimeout(this.realtimeUpdateTimer);
        this.realtimeUpdateTimer = null;
      }

      // 解绑 title observer，避免 orphan
      if (this._titleObserver) {
        try { this._titleObserver.disconnect(); } catch (_) { /* ignore */ }
        this._titleObserver = null;
      }

      // 解绑 popstate
      if (this._onPopState) {
        try { window.removeEventListener('popstate', this._onPopState); } catch (_) { /* ignore */ }
        this._onPopState = null;
      }

      // 还原 history.pushState / replaceState
      // 只在确实是本模块包过的情况下还原（避免覆盖其它扩展的包装）
      if (this._origPushState && history.pushState && history.pushState.__ccs_wrapped) {
        history.pushState = this._origPushState;
        this._origPushState = null;
      }
      if (this._origReplaceState && history.replaceState && history.replaceState.__ccs_wrapped) {
        history.replaceState = this._origReplaceState;
        this._origReplaceState = null;
      }
    },
    
    // 获取当前监测状态
    getStatus() {
      return {
        currentHref: window.location.href,
        currentTitle: document.title,
        lastObservedHref: this.lastObservedHref,
        lastObservedTitle: this.lastObservedTitle,
        isMonitoring: !!this.monitorInterval
      };
    }
  };

  // 导出模块
  window.CCSModules.RealtimeUpdate = RealtimeUpdate;
  
  // 兼容性：导出全局函数
  window.scheduleRealtimeUpdate = () => RealtimeUpdate.scheduleUpdate();
  window.updateRealtimeFallbackUI = (forceRefresh) => RealtimeUpdate.updateUI(forceRefresh);
  
  // 保存设置的辅助函数
  window.saveSettings = function() {
    if (window.settings) {
      console.log('[触触搜] 保存设置:', { 
        globalDock: window.settings.globalDock, 
        layout: window.settings.layout, 
        barClosed: window.settings.barClosed 
      });
      chrome.storage.local.set({ ccs_settings: window.settings });
    }
  };
})();