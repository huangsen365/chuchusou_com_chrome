(function() {
  'use strict';

  // 确保全局命名空间存在
  window.CCSModules = window.CCSModules || {};
  
  // SettingsPanel 模块 - 设置面板功能
  const SettingsPanel = {
    // 生成设置面板HTML
    generateHTML(settings) {
      return `
        <div class="ccs-settings-panel" style="display: none;">
          <h3>设置</h3>
          <div class="setting-item">
            <label>调试日志：</label>
            <input type="checkbox" class="debug-toggle" ${window.CCS_DEBUG ? 'checked' : ''}>
          </div>
          <div class="setting-item">
            <label>显示模式：</label>
            <select class="mode-select">
              <option value="normal">普通</option>
              <option value="mini">迷你</option>
              <option value="disabled">禁用</option>
            </select>
          </div>
          <div class="setting-item">
            <label>透明度：</label>
            <input type="range" class="opacity-slider" min="0.3" max="1" step="0.1" value="${settings.opacity}">
            <span class="opacity-value">${Math.round(settings.opacity * 100)}%</span>
          </div>
          <div class="setting-item">
            <label>启用底部栏：</label>
            <input type="checkbox" class="bar-enable-toggle" ${!settings.barClosed ? 'checked' : ''}>
          </div>
          <div class="setting-item">
            <label>底部栏（全局）：</label>
            <input type="checkbox" class="global-dock-toggle" ${settings.globalDock ? 'checked' : ''}>
          </div>
          <div class="setting-item">
            <label>快捷键：</label>
            <select class="shortcut-select">
              <option value="Alt+S" ${settings.shortcutKey === 'Alt+S' ? 'selected' : ''}>Alt+S（默认）</option>
              <option value="Ctrl+Shift+S" ${settings.shortcutKey === 'Ctrl+Shift+S' ? 'selected' : ''}>Ctrl+Shift+S</option>
              <option value="Alt+Shift+S" ${settings.shortcutKey === 'Alt+Shift+S' ? 'selected' : ''}>Alt+Shift+S</option>
              <option value="Ctrl+Alt+S" ${settings.shortcutKey === 'Ctrl+Alt+S' ? 'selected' : ''}>Ctrl+Alt+S</option>
              <option value="Alt+Q" ${settings.shortcutKey === 'Alt+Q' ? 'selected' : ''}>Alt+Q</option>
              <option value="Alt+E" ${settings.shortcutKey === 'Alt+E' ? 'selected' : ''}>Alt+E</option>
            </select>
          </div>
          <div class="setting-item">
            <label>黑名单：</label>
            <button class="toggle-blacklist-btn">
              ${settings.isBlacklisted ? '移出黑名单' : '加入黑名单'}
            </button>
          </div>
        </div>
      `;
    },
    
    // 切换设置面板显示
    toggle(shadowRoot) {
      const panel = shadowRoot?.querySelector('.ccs-settings-panel');
      if (panel) {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        return panel.style.display === 'block';
      }
      return false;
    },
    
    // 绑定设置面板事件
    bindEvents(shadowRoot, settings, callbacks = {}) {
      const settingsPanel = shadowRoot?.querySelector('.ccs-settings-panel');
      if (!settingsPanel) return;
      
      // 启用底部栏（全局关闭开关）
      const barEnableCheckbox = settingsPanel.querySelector('.bar-enable-toggle');
      if (barEnableCheckbox) {
        barEnableCheckbox.addEventListener('change', (e) => {
          const enable = e.target.checked;
          settings.barClosed = !enable;
          if (callbacks.onBarEnableChange) {
            callbacks.onBarEnableChange(enable, settings);
          }
        });
      }
      
      // 调试日志开关
      const debugToggle = settingsPanel.querySelector('.debug-toggle');
      if (debugToggle) {
        debugToggle.addEventListener('change', (e) => {
          const enabled = !!e.target.checked;
          window.CCS_DEBUG = enabled;
          chrome.storage.local.set({ ccs_debug: enabled });
          
          if (callbacks.onDebugToggle) {
            callbacks.onDebugToggle(enabled);
          }
          
          // 显示提示
          this.showToast(enabled ? '调试已开启' : '调试已关闭');
          console.log(`[触触搜] 调试日志已${enabled ? '开启' : '关闭'}。可在设置中随时切换。`);
          
          // 同步到后台
          if (window.CCSModules?.BackgroundComm) {
            window.CCSModules.BackgroundComm.updateDebugStatus(enabled);
          } else {
            try { 
              chrome.runtime.sendMessage({ action: 'updateDebug', enabled }); 
            } catch (_) {}
          }
        });
      }
      
      // 全局底部栏开关
      const globalDockCheckbox = settingsPanel.querySelector('.global-dock-toggle');
      if (globalDockCheckbox) {
        globalDockCheckbox.addEventListener('change', (e) => {
          settings.globalDock = e.target.checked;
          if (callbacks.onGlobalDockChange) {
            callbacks.onGlobalDockChange(e.target.checked, settings);
          }
        });
      }
      
      // 快捷键选择
      const shortcutSelect = settingsPanel.querySelector('.shortcut-select');
      if (shortcutSelect) {
        shortcutSelect.addEventListener('change', (e) => {
          settings.shortcutKey = e.target.value;
          if (callbacks.onShortcutChange) {
            callbacks.onShortcutChange(e.target.value);
          }
          this.showToast('快捷键已更改为: ' + settings.shortcutKey);
        });
      }
      
      // 模式选择
      const modeSelect = settingsPanel.querySelector('.mode-select');
      if (modeSelect) {
        modeSelect.value = settings.mode;
        modeSelect.addEventListener('change', (e) => {
          const newMode = e.target.value;
          if (newMode === 'disabled') {
            if (confirm('禁用后需要在Chrome扩展管理页重新启用，确定要禁用吗？')) {
              settings.mode = newMode;
              if (callbacks.onModeChange) {
                callbacks.onModeChange(newMode, settings);
              }
            } else {
              modeSelect.value = settings.mode;
            }
          } else {
            settings.mode = newMode;
            if (callbacks.onModeChange) {
              callbacks.onModeChange(newMode, settings);
            }
          }
        });
      }
      
      // 透明度滑块
      const opacitySlider = settingsPanel.querySelector('.opacity-slider');
      const opacityValue = settingsPanel.querySelector('.opacity-value');
      if (opacitySlider) {
        opacitySlider.addEventListener('input', (e) => {
          settings.opacity = parseFloat(e.target.value);
          if (opacityValue) {
            opacityValue.textContent = Math.round(settings.opacity * 100) + '%';
          }
          if (callbacks.onOpacityChange) {
            callbacks.onOpacityChange(settings.opacity);
          }
        });
      }
      
      // 黑名单按钮
      const blacklistBtn = settingsPanel.querySelector('.toggle-blacklist-btn');
      if (blacklistBtn) {
        blacklistBtn.addEventListener('click', () => {
          if (callbacks.onBlacklistToggle) {
            const newState = callbacks.onBlacklistToggle();
            blacklistBtn.textContent = newState ? '移出黑名单' : '加入黑名单';
          }
        });
      }
    },
    
    // 显示提示
    showToast(message) {
      if (window.showToast) {
        window.showToast(message);
      } else if (window.CCSModules?.Toast) {
        window.CCSModules.Toast.show(message);
      } else {
        console.log('[触触搜]', message);
      }
    },
    
    // 更新黑名单按钮文本
    updateBlacklistButton(shadowRoot, isBlacklisted) {
      const btn = shadowRoot?.querySelector('.toggle-blacklist-btn');
      if (btn) {
        btn.textContent = isBlacklisted ? '移出黑名单' : '加入黑名单';
      }
    },
    
    // 更新模式选择器
    updateModeSelect(shadowRoot, mode) {
      const select = shadowRoot?.querySelector('.mode-select');
      if (select) {
        select.value = mode;
      }
    },
    
    // 更新透明度显示
    updateOpacityDisplay(shadowRoot, opacity) {
      const slider = shadowRoot?.querySelector('.opacity-slider');
      const value = shadowRoot?.querySelector('.opacity-value');
      if (slider) {
        slider.value = opacity;
      }
      if (value) {
        value.textContent = Math.round(opacity * 100) + '%';
      }
    },
    
    // 获取设置面板样式
    getStyles() {
      return `
        .ccs-settings-panel {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: white;
          border: 1px solid #e0e0e0;
          border-radius: 0 0 8px 8px;
          padding: 10px;
          box-shadow: 0 4px 8px rgba(0,0,0,0.1);
          max-height: 300px;
          overflow-y: auto;
        }
        
        .ccs-settings-panel h3 {
          margin: 0 0 10px 0;
          font-size: 14px;
          color: #333;
        }
        
        .setting-item {
          display: flex;
          align-items: center;
          margin-bottom: 8px;
          font-size: 12px;
        }
        
        .setting-item label {
          flex: 0 0 100px;
          color: #666;
        }
        
        .setting-item input[type="checkbox"],
        .setting-item select,
        .setting-item input[type="range"] {
          margin: 0;
        }
        
        .setting-item .opacity-value {
          margin-left: 8px;
          color: #666;
          min-width: 35px;
        }
        
        .setting-item button {
          padding: 4px 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          background: white;
          color: #333;
          cursor: pointer;
          font-size: 12px;
        }
        
        .setting-item button:hover {
          background: #f0f0f0;
        }
        
        /* Mini模式下的设置面板调整 */
        .mini-mode .ccs-settings-panel {
          font-size: 11px;
        }
        
        .mini-mode .setting-item label {
          flex: 0 0 80px;
        }
        
        /* 底部停靠模式下的设置面板 */
        .docked-bottom .ccs-settings-panel {
          position: fixed;
          top: auto;
          bottom: 60px;
          left: 50%;
          transform: translateX(-50%);
          width: 350px;
          max-width: 90%;
          border-radius: 8px;
          box-shadow: 0 -4px 12px rgba(0,0,0,0.15);
        }
      `;
    }
  };

  // 导出模块
  window.CCSModules.SettingsPanel = SettingsPanel;
  
  // 兼容性：导出全局函数
  window.toggleSettings = function() {
    if (window.shadowRoot) {
      return SettingsPanel.toggle(window.shadowRoot);
    }
    return false;
  };
})();