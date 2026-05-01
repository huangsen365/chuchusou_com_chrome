/**
 * 触触搜 Popup - 设置管理器
 * 负责管理扩展设置
 *
 * @module popup/modules/SettingsManager
 */

class SettingsManager {
  constructor(options = {}) {
    this.onToast = options.onToast || ((msg) => console.log(msg));
    this.promptLibraryManager = null;
  }

  /**
   * 初始化设置
   */
  async init() {
    this._initExtensionToggle();
    this._initDebugToggle();
    this._initVoiceToggle();
    this._initBlacklist();
    this._initShortcutSettings();
    this._initPromptLibrary();
    this._bindSettingButtons();
  }

  /**
   * 初始化语音功能开关——默认关闭（实验性功能，用户主动开启才生效）
   * @private
   */
  _initVoiceToggle() {
    chrome.storage.local.get(['ccs_voice_enabled'], (res) => {
      this._setVoiceButtonState(!!res.ccs_voice_enabled);
    });
  }

  /**
   * 切换语音功能（实验性）。开启后 sidepanel 会显示 🎤 按钮和选引擎流程；
   * 关闭后整个语音模块不实例化、不绑定事件、不查权限。
   */
  toggleVoice() {
    chrome.storage.local.get(['ccs_voice_enabled'], (res) => {
      const current = !!res.ccs_voice_enabled;
      const next = !current;
      chrome.storage.local.set({ ccs_voice_enabled: next }, () => {
        this._setVoiceButtonState(next);
        this.onToast(next ? '语音功能已开启（实验性，需重开侧边栏生效）' : '语音功能已关闭');
      });
    });
  }

  /**
   * 设置语音按钮显示状态
   * @private
   */
  _setVoiceButtonState(enabled) {
    const btn = document.querySelector('[data-action="voice"]');
    if (!btn) return;
    const label = btn.querySelector('.setting-label');
    const icon = btn.querySelector('.setting-icon');
    icon.textContent = '🎤';
    if (enabled) {
      label.textContent = '语音功能：开（实验性）';
      btn.style.background = '#fff8e1';
      btn.style.borderColor = '#fbc02d';
    } else {
      label.textContent = '语音功能：关';
      btn.style.background = '';
      btn.style.borderColor = '';
    }
  }

  /**
   * 初始化提示词库
   * @private
   */
  _initPromptLibrary() {
    if (window.CCSPopup && window.CCSPopup.PromptLibraryManager) {
      this.promptLibraryManager = new window.CCSPopup.PromptLibraryManager({
        onToast: this.onToast
      });
      this.promptLibraryManager.init();
    }
  }

  /**
   * 初始化扩展启用/禁用状态
   * @private
   */
  _initExtensionToggle() {
    chrome.storage.local.get(['enabled'], (result) => {
      const enabled = result.enabled !== false;
      this._updateToggleButton(enabled);
    });
  }

  /**
   * 切换扩展状态
   */
  toggleExtension() {
    chrome.storage.local.get(['enabled'], (result) => {
      const currentState = result.enabled !== false;
      const newState = !currentState;

      chrome.storage.local.set({ enabled: newState }, () => {
        this._updateToggleButton(newState);
        this.onToast(newState ? '插件已启用' : '插件已禁用');

        // 通知 content script
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'toggleExtension',
              enabled: newState
            }).catch(() => {});
          }
        });
      });
    });
  }

  /**
   * 更新切换按钮状态
   * @private
   */
  _updateToggleButton(enabled) {
    const toggleBtn = document.querySelector('[data-action="toggle"]');
    if (!toggleBtn) return;

    const icon = toggleBtn.querySelector('.setting-icon');
    const label = toggleBtn.querySelector('.setting-label');

    if (enabled) {
      icon.textContent = '⚡';
      label.textContent = '点击禁用';
      toggleBtn.style.background = '#e8f5e9';
      toggleBtn.style.borderColor = '#4caf50';
    } else {
      icon.textContent = '⭕';
      label.textContent = '点击启用';
      toggleBtn.style.background = '#ffebee';
      toggleBtn.style.borderColor = '#f44336';
    }
  }

  /**
   * 初始化调试开关
   * @private
   */
  _initDebugToggle() {
    chrome.storage.local.get(['ccs_debug'], (res) => {
      const enabled = !!res.ccs_debug;
      this._setDebugButtonState(enabled);
    });
  }

  /**
   * 切换调试模式
   */
  toggleDebug() {
    chrome.storage.local.get(['ccs_debug'], (res) => {
      const current = !!res.ccs_debug;
      const next = !current;

      chrome.storage.local.set({ ccs_debug: next }, () => {
        this._setDebugButtonState(next);

        // 通知 background 和 content script
        chrome.runtime.sendMessage({ action: 'updateDebug', enabled: next }).catch(() => {});
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'updateDebug', enabled: next }).catch(() => {});
          }
        });

        this.onToast(next ? '调试已开启' : '调试已关闭');
      });
    });
  }

  /**
   * 设置调试按钮状态
   * @private
   */
  _setDebugButtonState(enabled) {
    const btn = document.querySelector('[data-action="debug"]');
    if (!btn) return;

    const label = btn.querySelector('.setting-label');
    const icon = btn.querySelector('.setting-icon');

    if (enabled) {
      icon.textContent = '🐞';
      label.textContent = '调试日志：开';
      btn.style.background = '#fff8e1';
      btn.style.borderColor = '#fbc02d';
    } else {
      icon.textContent = '🐞';
      label.textContent = '调试日志：关';
      btn.style.background = '';
      btn.style.borderColor = '';
    }
  }

  /**
   * 初始化黑名单
   * @private
   */
  _initBlacklist() {
    this.loadBlacklist();

    const clearBtn = document.querySelector('.clear-blacklist');
    if (clearBtn) {
      clearBtn.onclick = () => this.clearAllBlacklist();
    }
  }

  /**
   * 加载黑名单
   */
  loadBlacklist() {
    chrome.storage.local.get(['ccs_settings'], (result) => {
      const settings = result.ccs_settings || { blacklist: [] };
      const blacklist = settings.blacklist || [];

      const countEl = document.querySelector('.blacklist-count');
      if (countEl) {
        countEl.textContent = blacklist.length;
      }

      const listEl = document.querySelector('.blacklist-list');
      if (listEl) {
        if (blacklist.length === 0) {
          listEl.innerHTML = '<div class="blacklist-empty">黑名单为空</div>';
        } else {
          listEl.innerHTML = blacklist.map(host => `
            <div class="blacklist-item" data-host="${host}">
              <span class="blacklist-host">${host}</span>
              <button class="blacklist-remove" data-host="${host}">移除</button>
            </div>
          `).join('');

          listEl.querySelectorAll('.blacklist-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
              const host = e.target.dataset.host;
              this.removeFromBlacklist(host);
            });
          });
        }
      }
    });
  }

  /**
   * 从黑名单移除
   */
  removeFromBlacklist(host) {
    chrome.storage.local.get(['ccs_settings'], (result) => {
      const settings = result.ccs_settings || { blacklist: [] };
      const index = settings.blacklist.indexOf(host);

      if (index > -1) {
        settings.blacklist.splice(index, 1);
        chrome.storage.local.set({ ccs_settings: settings }, () => {
          this.onToast(`已移除: ${host}`);
          this.loadBlacklist();

          // 通知 content script
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
              chrome.tabs.sendMessage(tabs[0].id, {
                action: 'updateBlacklist',
                blacklist: settings.blacklist
              }).catch(() => {});
            }
          });
        });
      }
    });
  }

  /**
   * 清空黑名单
   */
  clearAllBlacklist() {
    if (!confirm('确定要清空所有黑名单吗？')) return;

    chrome.storage.local.get(['ccs_settings'], (result) => {
      const settings = result.ccs_settings || {};
      settings.blacklist = [];

      chrome.storage.local.set({ ccs_settings: settings }, () => {
        this.onToast('黑名单已清空');
        this.loadBlacklist();

        // 通知所有 content script
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
              action: 'updateBlacklist',
              blacklist: []
            }).catch(() => {});
          });
        });
      });
    });
  }

  /**
   * 初始化快捷键设置
   * @private
   */
  _initShortcutSettings() {
    chrome.storage.local.get(['ccs_settings'], (result) => {
      const settings = result.ccs_settings || {};
      const shortcutKey = settings.shortcutKey || 'Alt+S';

      const select = document.querySelector('.shortcut-key-select');
      if (select) {
        select.value = shortcutKey;
      }
    });

    const saveBtn = document.querySelector('.save-shortcut');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveShortcutSettings());
    }
  }

  /**
   * 保存快捷键设置
   */
  saveShortcutSettings() {
    const select = document.querySelector('.shortcut-key-select');
    if (!select) return;

    const newShortcut = select.value;

    chrome.storage.local.get(['ccs_settings'], (result) => {
      const settings = result.ccs_settings || {};
      settings.shortcutKey = newShortcut;

      chrome.storage.local.set({ ccs_settings: settings }, () => {
        this.onToast('快捷键已更新为: ' + newShortcut);

        // 通知所有标签页
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
              action: 'updateShortcut',
              shortcutKey: newShortcut
            }).catch(() => {});
          });
        });
      });
    });
  }

  /**
   * 绑定设置按钮事件
   * @private
   */
  _bindSettingButtons() {
    document.querySelectorAll('.setting-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.currentTarget.dataset.action;
        this.handleSettingAction(action);
      });
    });
  }

  /**
   * 处理设置操作
   */
  handleSettingAction(action) {
    switch (action) {
      case 'toggle':
        this.toggleExtension();
        break;
      case 'blacklist':
        this.toggleSection('blacklistSection');
        break;
      case 'debug':
        this.toggleDebug();
        break;
      case 'voice':
        this.toggleVoice();
        break;
      case 'export-menu-state':
        this.exportMenuState();
        break;
      case 'shortcut-settings':
        this.toggleSection('shortcutSection');
        break;
      case 'prompt-library':
        this.toggleSection('promptLibrarySection');
        break;
    }
  }

  /**
   * 切换设置区域显示
   */
  toggleSection(sectionId) {
    const sections = ['blacklistSection', 'shortcutSection', 'debugSection', 'promptLibrarySection'];
    const targetSection = document.getElementById(sectionId);

    if (!targetSection) return;

    const isHidden = targetSection.style.display === 'none';

    // 隐藏所有区域
    sections.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    // 切换目标区域
    if (isHidden) {
      targetSection.style.display = 'block';
      if (sectionId === 'blacklistSection') {
        this.loadBlacklist();
      }
      if (sectionId === 'promptLibrarySection' && this.promptLibraryManager) {
        this.promptLibraryManager.renderList();
      }
    }
  }

  /**
   * 导出菜单状态
   */
  async exportMenuState() {
    const btn = document.querySelector('[data-action="export-menu-state"]');
    if (btn) {
      btn.disabled = true;
      const label = btn.querySelector('.setting-label');
      if (label) label.textContent = '获取中...';
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      chrome.runtime.sendMessage({
        action: 'getMenuDebugInfo',
        tabId: tab?.id
      }, (response) => {
        if (response && response.success) {
          this.showMenuDebugInfo(response.data);
        } else {
          this.onToast('获取菜单状态失败');
        }

        if (btn) {
          btn.disabled = false;
          const label = btn.querySelector('.setting-label');
          if (label) label.textContent = '导出菜单状态';
        }
      });
    } catch (error) {
      this.onToast('获取菜单状态失败');
      if (btn) {
        btn.disabled = false;
        const label = btn.querySelector('.setting-label');
        if (label) label.textContent = '导出菜单状态';
      }
    }
  }

  /**
   * 显示菜单调试信息
   */
  showMenuDebugInfo(data) {
    const debugSection = document.getElementById('debugSection');
    const textEl = document.querySelector('.menu-debug-text');

    if (!debugSection || !textEl) return;

    const formatted = JSON.stringify(data, null, 2);
    textEl.textContent = formatted;

    // 隐藏其他区域
    document.getElementById('blacklistSection').style.display = 'none';
    document.getElementById('shortcutSection').style.display = 'none';
    debugSection.style.display = 'block';

    // 复制到剪贴板
    navigator.clipboard.writeText(formatted).then(() => {
      this.onToast('菜单状态已复制到剪贴板');
    }).catch(() => {});

    // 绑定按钮
    const copyBtn = document.querySelector('.copy-debug-info');
    const closeBtn = document.querySelector('.close-debug-info');

    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(formatted).then(() => {
          this.onToast('已复制到剪贴板');
        }).catch(() => {
          this.onToast('复制失败');
        });
      };
    }

    if (closeBtn) {
      closeBtn.onclick = () => {
        debugSection.style.display = 'none';
      };
    }
  }
}

// 导出到全局
window.CCSPopup = window.CCSPopup || {};
window.CCSPopup.SettingsManager = SettingsManager;
