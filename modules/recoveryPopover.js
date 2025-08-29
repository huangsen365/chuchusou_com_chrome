(function() {
  'use strict';

  // 确保全局命名空间存在
  window.CCSModules = window.CCSModules || {};
  
  // RecoveryPopover 模块 - 黑名单恢复弹窗功能
  const RecoveryPopover = {
    // 显示恢复popover（黑名单网站专用）
    show(x, y, options = {}) {
      const { 
        onRemoveFromBlacklist, 
        onTempEnable,
        onClose 
      } = options;
      
      // 移除旧的popover
      if (window.popover) {
        window.popover.remove();
      }

      // 创建容器
      const popover = document.createElement('div');
      popover.id = 'ccs-popover-container';
      popover.style.position = 'absolute';
      popover.style.zIndex = '2147483647';
      popover.style.left = `${x}px`;
      popover.style.top = `${y}px`;

      // 创建shadow DOM
      const shadowRoot = popover.attachShadow({ mode: 'open' });
      
      // 初始化 TextSync 模块
      if (window.CCSModules?.TextSync) {
        window.CCSModules.TextSync.setShadowRoot(shadowRoot);
      }

      // 创建恢复界面HTML
      const wrapper = document.createElement('div');
      wrapper.className = 'ccs-recovery-popover';
      wrapper.innerHTML = `
        <div class="ccs-header recovery">
          <span class="ccs-title">🔍 触触搜 - 已禁用</span>
          <button class="ccs-close">✕</button>
        </div>
        <div class="ccs-recovery-content">
          <div class="ccs-message">
            <span class="icon">🚫</span>
            <p>当前网站 <strong>${window.location.hostname}</strong> 在黑名单中</p>
          </div>
          <div class="ccs-recovery-actions">
            <button class="ccs-remove-blacklist">移出黑名单并启用</button>
            <button class="ccs-temp-enable">临时启用（本次）</button>
          </div>
          <div class="ccs-recovery-tips">
            💡 提示：<kbd>Alt+S</kbd> 或 <kbd>Alt+右键</kbd> 快速唤起
          </div>
        </div>
      `;

      // 添加恢复popover的样式
      const style = document.createElement('style');
      style.textContent = this.getStyles();

      shadowRoot.appendChild(style);
      shadowRoot.appendChild(wrapper);

      // 绑定事件
      shadowRoot.querySelector('.ccs-close').addEventListener('click', () => {
        popover.remove();
        if (onClose) onClose();
      });
      
      shadowRoot.querySelector('.ccs-remove-blacklist').addEventListener('click', () => {
        if (onRemoveFromBlacklist) {
          onRemoveFromBlacklist();
        }
        popover.remove();
      });

      shadowRoot.querySelector('.ccs-temp-enable').addEventListener('click', () => {
        if (onTempEnable) {
          onTempEnable();
        }
        popover.remove();
      });

      document.body.appendChild(popover);
      
      // 保存引用
      window.popover = popover;
      window.shadowRoot = shadowRoot;
      
      return popover;
    },
    
    // 获取样式
    getStyles() {
      return `
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        
        .ccs-recovery-popover {
          background: white;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          width: 280px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          font-size: 14px;
          color: #333;
          overflow: hidden;
          animation: fadeIn 0.2s ease-out;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }

        .ccs-header.recovery {
          background: linear-gradient(135deg, #f56565 0%, #c53030 100%);
          color: white;
          padding: 10px 12px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .ccs-title {
          font-weight: bold;
          font-size: 14px;
        }

        .ccs-close {
          background: none;
          border: none;
          color: white;
          cursor: pointer;
          font-size: 16px;
          padding: 0;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          transition: background-color 0.2s;
        }

        .ccs-close:hover {
          background-color: rgba(255,255,255,0.2);
        }

        .ccs-recovery-content {
          padding: 15px;
        }

        .ccs-message {
          text-align: center;
          margin-bottom: 15px;
        }

        .ccs-message .icon {
          font-size: 32px;
          display: block;
          margin-bottom: 8px;
        }

        .ccs-message p {
          font-size: 13px;
          color: #4a5568;
        }

        .ccs-message strong {
          color: #2d3748;
        }

        .ccs-recovery-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 12px;
        }

        .ccs-recovery-actions button {
          padding: 8px 12px;
          border: none;
          border-radius: 6px;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .ccs-remove-blacklist {
          background: #48bb78;
          color: white;
        }

        .ccs-remove-blacklist:hover {
          background: #38a169;
        }

        .ccs-temp-enable {
          background: #f7fafc;
          color: #4a5568;
          border: 1px solid #e2e8f0;
        }

        .ccs-temp-enable:hover {
          background: #edf2f7;
          border-color: #cbd5e0;
        }

        .ccs-recovery-tips {
          font-size: 11px;
          color: #718096;
          text-align: center;
          padding-top: 10px;
          border-top: 1px solid #e2e8f0;
        }

        kbd {
          background: #f7fafc;
          border: 1px solid #e2e8f0;
          border-radius: 3px;
          padding: 2px 4px;
          font-family: monospace;
          font-size: 10px;
        }
      `;
    },
    
    // 处理移出黑名单
    handleRemoveFromBlacklist(settings, saveCallback) {
      const currentHost = window.location.hostname;
      
      if (window.CCSModules?.Blacklist) {
        // 使用 Blacklist 模块
        window.CCSModules.Blacklist.remove(currentHost);
        settings.isBlacklisted = false;
        settings.mode = settings.originalMode || 'normal';
        settings.blacklist = window.CCSModules.Blacklist.getList();
      } else {
        // 后备方案
        const index = settings.blacklist.indexOf(currentHost);
        if (index > -1) {
          settings.blacklist.splice(index, 1);
          settings.isBlacklisted = false;
          settings.mode = settings.originalMode || 'normal';
        }
      }
      
      if (saveCallback) {
        saveCallback();
      }
      
      // 显示提示
      if (window.showToast) {
        window.showToast('已移出黑名单，插件已启用');
      } else if (window.CCSModules?.Toast) {
        window.CCSModules.Toast.show('已移出黑名单，插件已启用');
      }
      
      return true;
    },
    
    // 处理临时启用
    handleTempEnable(settings) {
      settings.mode = 'normal';
      // 不保存，只是临时启用
      console.log('[触触搜] 临时启用插件（不保存）');
      return true;
    }
  };

  // 导出模块
  window.CCSModules.RecoveryPopover = RecoveryPopover;
  
  // 兼容性：导出全局函数
  window.showRecoveryPopover = function(x, y) {
    // 默认的回调函数
    const onRemoveFromBlacklist = () => {
      if (window.settings) {
        RecoveryPopover.handleRemoveFromBlacklist(window.settings, window.saveSettings);
        // 延迟后显示正常popover
        setTimeout(() => {
          if (window.createPopover) window.createPopover();
          if (window.showPopover) window.showPopover(x, y);
        }, 300);
      }
    };
    
    const onTempEnable = () => {
      if (window.settings) {
        RecoveryPopover.handleTempEnable(window.settings);
        // 延迟后显示正常popover
        setTimeout(() => {
          if (window.createPopover) window.createPopover();
          if (window.showPopover) window.showPopover(x, y);
        }, 300);
      }
    };
    
    const onClose = () => {
      if (window.hidePopover) window.hidePopover();
    };
    
    return RecoveryPopover.show(x, y, {
      onRemoveFromBlacklist,
      onTempEnable,
      onClose
    });
  };
})();