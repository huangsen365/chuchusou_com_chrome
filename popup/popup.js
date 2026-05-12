/**
 * 触触搜 Popup - 菜单式UI
 * 点击扩展icon时显示与右键菜单相同的层级菜单
 */

class PopupMenuRenderer {
  constructor() {
    this.config = null;
    this.keyword = { text: '', raw: '' };
    this.menuToggleConfig = null;
    this.currentMode = 'menu'; // 'menu' or 'settings'
    this.promptLibraryManager = null;
  }

  async init() {
    try {
      // 并行加载配置和关键词（菜单结构已由 background 处理好，包含启用/禁用过滤）
      const [config, keyword] = await Promise.all([
        this.loadMenuConfig(),
        this.getCurrentKeyword()
      ]);

      this.config = config;
      this.keyword = keyword;

      this.render();
      this.bindEvents();
      this.initSettings();
      this.loadVersion();
    } catch (error) {
      console.error('[触触搜] Popup 初始化失败:', error);
      this.showError('加载失败，请重试');
    }
  }

  loadVersion() {
    const manifest = chrome.runtime.getManifest();
    const versionEl = document.getElementById('versionNumber');
    if (versionEl && manifest.version) {
      versionEl.textContent = `v${manifest.version}`;
    }
  }

  async loadMenuConfig() {
    // 从 background 获取与右键菜单一致的菜单结构
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'getMenuStructure' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[触触搜] 获取菜单结构失败:', chrome.runtime.lastError);
          reject(new Error('配置加载失败'));
          return;
        }
        if (response && response.success) {
          resolve(response.structure);
        } else {
          reject(new Error(response?.error || '配置加载失败'));
        }
      });
    });
  }

  async getCurrentKeyword() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) {
          resolve({ text: '', raw: '' });
          return;
        }
        chrome.runtime.sendMessage({
          action: 'getSearchText',
          tabId: tabs[0].id,
          url: tabs[0].url,
          title: tabs[0].title,
          forceFresh: true
        }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ text: '', raw: '' });
            return;
          }
          resolve({
            text: response?.text || '',
            raw: response?.raw || response?.text || ''
          });
        });
      });
    });
  }

  // isMenuEnabled: background 已经过滤了禁用的菜单项，这里始终返回 true
  isMenuEnabled(menuId) {
    return true;
  }

  render() {
    const container = document.getElementById('menuContainer');
    container.innerHTML = '';

    // 显示当前关键词
    const keywordEl = document.getElementById('currentKeyword');
    const keywordCopyEl = document.getElementById('currentKeywordCopy');
    const keywordWrapEl = keywordEl?.closest('.menu-keyword-wrap');
    if (this.keyword.text) {
      const displayText = this.formatKeyword(this.keyword.text);
      const fullKeyword = this.keyword.raw || this.keyword.text;
      keywordEl.textContent = `"${displayText}"`;
      // 用自定义 CSS tooltip 替代原生 title：原生 title 有浏览器级延迟，hover 体感慢。
      if (keywordWrapEl) keywordWrapEl.dataset.fullKeyword = fullKeyword;
      keywordEl.removeAttribute('title');
      keywordEl.style.display = 'block';
      if (keywordCopyEl) {
        keywordCopyEl.hidden = false;
        keywordCopyEl.dataset.keyword = fullKeyword;
      }
    } else {
      keywordEl.textContent = '';
      if (keywordWrapEl) keywordWrapEl.dataset.fullKeyword = '';
      keywordEl.removeAttribute('title');
      keywordEl.style.display = 'none';
      if (keywordCopyEl) {
        keywordCopyEl.hidden = true;
        keywordCopyEl.dataset.keyword = '';
      }
    }

    // 渲染菜单组
    if (!this.config || !this.config.groups) {
      container.innerHTML = '<div class="menu-empty">无菜单配置</div>';
      return;
    }

    this.config.groups.forEach((group, index) => {
      // 跳过 panel 组（设置入口已在底部）
      if (group.id === 'panel') return;

      // 分隔线策略：字段驱动
      //   group.separator === 'before' → 在该 group 之前插一条
      //   group.separator === 'after'  → 在该 group 之后插一条
      //   未标 / 'none'                → 不插（注意：相邻 group 可能用 before/after 补上）
      //
      // ⚠️ 新增 group 时记得同步挂 separator 字段（base.js 的 getPopupMenuStructure 里）
      //    否则与 sidebar / 右键菜单 group 边界分隔线不一致。

      // separator before
      if (group.separator === 'before' && index > 0) {
        container.appendChild(this.createSeparator());
      }

      this.renderGroup(container, group);

      // separator after
      if (group.separator === 'after') {
        container.appendChild(this.createSeparator());
      }
    });
  }

  formatKeyword(text) {
    if (!text) return '';
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.length > 15 ? compact.substring(0, 15) + '...' : compact;
  }

  createSeparator() {
    const sep = document.createElement('div');
    sep.className = 'menu-separator';
    return sep;
  }

  renderGroup(container, group) {
    if (!group.items) return;

    group.items.forEach(item => {
      if (!this.isMenuEnabled(item.id)) return;
      if (item.enabled === false) return;

      const itemEl = this.createMenuItem(item);
      container.appendChild(itemEl);

      // 子菜单容器（初始隐藏）
      if (item.children && item.children.length > 0) {
        const submenu = this.createSubmenu(item.children, item.id);
        container.appendChild(submenu);
      }
    });
  }

  createMenuItem(item) {
    const el = document.createElement('div');
    el.className = 'menu-item';
    el.dataset.menuId = item.id;
    el.dataset.menuType = item.type || '';

    const hasChildren = item.children && item.children.length > 0;
    if (hasChildren) {
      el.classList.add('has-children');
    }

    // 获取显示标题
    let displayTitle = item.title || '';
    // 对于搜索类菜单，简化标题显示
    if (item.type === 'fastqa-quick') {
      // "触触搜 · 速答壹拾佰 - ChatGPT" → "速答 · ChatGPT"
      const match = displayTitle.match(/- (.+)$/);
      if (match) {
        displayTitle = `速答 · ${match[1]}`;
      }
    }

    el.innerHTML = `
      <span class="item-icon">${item.icon || ''}</span>
      <span class="item-title">${displayTitle}</span>
      ${hasChildren ? '<span class="item-arrow">▶</span>' : ''}
    `;

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (hasChildren) {
        this.toggleSubmenu(el, item.id);
      } else {
        this.handleClick(item);
      }
    });

    return el;
  }

  createSubmenu(children, parentId, level = 1) {
    const submenu = document.createElement('div');
    submenu.className = 'submenu collapsed';
    submenu.dataset.parentId = parentId;
    submenu.dataset.level = level;

    children.forEach(child => {
      if (!this.isMenuEnabled(child.id)) return;
      if (child.enabled === false) return;

      const hasChildren = child.children && child.children.length > 0;

      const childEl = document.createElement('div');
      childEl.className = `menu-item submenu-item level-${level}`;
      childEl.dataset.menuId = child.id;
      childEl.dataset.menuType = child.type || '';

      if (hasChildren) {
        childEl.classList.add('has-children');
      }

      childEl.innerHTML = `
        <span class="item-icon">${child.icon || ''}</span>
        <span class="item-title">${child.title}</span>
        ${hasChildren ? '<span class="item-arrow">▶</span>' : ''}
      `;

      childEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (hasChildren) {
          this.toggleSubmenu(childEl, child.id);
        } else {
          this.handleClick(child);
        }
      });

      submenu.appendChild(childEl);

      // 递归创建更深层次的子菜单
      if (hasChildren) {
        const nestedSubmenu = this.createSubmenu(child.children, child.id, level + 1);
        submenu.appendChild(nestedSubmenu);
      }
    });

    return submenu;
  }

  toggleSubmenu(parentEl, parentId) {
    const submenu = document.querySelector(`.submenu[data-parent-id="${parentId}"]`);
    if (submenu) {
      submenu.classList.toggle('collapsed');
      parentEl.classList.toggle('expanded');
    }
  }

  async handleClick(item) {
    const keyword = this.keyword.raw || this.keyword.text;

    // 发送消息给 background 执行
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'executeMenuAction',
        menuItemId: item.id,
        menuType: item.type,
        keyword: keyword,
        urlPattern: item.urlPattern,
        actionType: item.action,
        engineId: item.engineId,
        purpose: item.purpose  // 优化提示词需要 purpose 参数
      });

      if (response && response.success) {
        // 关闭 popup
        window.close();
      } else if (response && response.error === 'no-keyword') {
        this.showToast('没有选中文本或无法提取关键词');
      }
    } catch (error) {
      console.error('[触触搜] 菜单操作失败:', error);
      this.showToast('操作失败');
    }
  }

  bindEvents() {
    // 设置按钮点击
    const settingsToggle = document.getElementById('settingsToggle');
    settingsToggle.addEventListener('click', () => this.showSettings());

    // 返回菜单按钮
    const backToMenu = document.getElementById('backToMenu');
    backToMenu.addEventListener('click', () => this.showMenu());

    // 侧边栏切换（按当前状态显示「打开/关闭」相反操作）
    this.setupSidePanelButton();

    // 关键字复制按钮
    const keywordCopy = document.getElementById('currentKeywordCopy');
    if (keywordCopy) {
      keywordCopy.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.copyCurrentKeyword();
      });
    }
  }

  async copyCurrentKeyword() {
    const keyword = this.keyword.raw || this.keyword.text;
    if (!keyword) {
      this.showToast('没有可复制的关键字');
      return;
    }

    const btn = document.getElementById('currentKeywordCopy');
    try {
      await navigator.clipboard.writeText(keyword);
      if (btn) {
        const original = btn.textContent;
        btn.textContent = '✓';
        btn.classList.add('copied');
        btn.disabled = true;
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove('copied');
          btn.disabled = false;
        }, 1200);
      }
    } catch (error) {
      console.error('[触触搜] 复制关键字失败:', error);
      this.showToast('复制失败');
    }
  }

  async setupSidePanelButton() {
    const btn = document.getElementById('openSidePanel');
    if (!btn) return;

    let isOpen = false;
    let windowId = null;
    try {
      const win = await chrome.windows.getCurrent();
      windowId = win.id;
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: 'getSidePanelState', windowId },
          (resp) => {
            if (chrome.runtime.lastError) resolve(null);
            else resolve(resp);
          }
        );
      });
      isOpen = !!(response && response.isOpen);
    } catch (_) {
      isOpen = false;
    }

    btn.textContent = isOpen ? '📕 关闭侧边栏' : '📑 打开侧边栏';

    btn.addEventListener('click', async () => {
      if (isOpen) {
        await this.closeSidePanel(windowId);
      } else {
        await this.openSidePanel();
      }
    });
  }

  async closeSidePanel(windowId) {
    try {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: 'closeSidePanel', windowId },
          (resp) => {
            if (chrome.runtime.lastError) resolve(null);
            else resolve(resp);
          }
        );
      });
      window.close();
    } catch (error) {
      console.error('[触触搜] Close side panel failed:', error);
      this.showToast('关闭侧边栏失败');
    }
  }

  async openSidePanel() {
    if (!chrome.sidePanel || !chrome.sidePanel.open) {
      this.showToast('当前浏览器不支持侧边栏');
      return;
    }

    try {
      // Keep this call directly in click flow to preserve user gesture.
      await chrome.sidePanel.open({
        windowId: chrome.windows.WINDOW_ID_CURRENT
      });
      window.close();
      return;
    } catch (windowError) {
      console.warn('[触触搜] Open side panel by window failed:', windowError);
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        throw new Error('No active tab for side panel fallback');
      }

      if (chrome.sidePanel.setOptions) {
        await chrome.sidePanel.setOptions({
          tabId: tab.id,
          path: 'sidepanel/sidepanel.html',
          enabled: true
        });
      }

      await chrome.sidePanel.open({ tabId: tab.id });
      window.close();
    } catch (error) {
      console.error('[触触搜] Open side panel failed:', error);
      this.showToast('打开侧边栏失败，请重试');
    }
  }

  showSettings() {
    this.currentMode = 'settings';
    document.getElementById('menuContainer').style.display = 'none';
    document.getElementById('settingsPanel').style.display = 'block';
    document.getElementById('settingsToggle').style.display = 'none';
  }

  showMenu() {
    this.currentMode = 'menu';
    document.getElementById('menuContainer').style.display = 'block';
    document.getElementById('settingsPanel').style.display = 'none';
    document.getElementById('settingsToggle').style.display = 'block';
    // 隐藏所有子面板
    document.getElementById('blacklistSection').style.display = 'none';
    document.getElementById('shortcutSection').style.display = 'none';
    document.getElementById('debugSection').style.display = 'none';
    const promptLibrarySection = document.getElementById('promptLibrarySection');
    if (promptLibrarySection) promptLibrarySection.style.display = 'none';
  }

  showError(message) {
    const container = document.getElementById('menuContainer');
    container.innerHTML = `<div class="menu-error">${message}</div>`;
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'popup-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // ==================== 设置功能（保留自原有代码） ====================

  initSettings() {
    // 初始化启用/禁用状态
    chrome.storage.local.get(['enabled'], (result) => {
      const enabled = result.enabled !== false;
      this.updateToggleButton(enabled);
    });

    // 初始化调试按钮状态
    this.initDebugToggle();
    // 初始化语音功能开关（默认关，实验性）
    this.initVoiceToggle();

    // 绑定设置按钮事件
    document.querySelectorAll('.setting-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.currentTarget.dataset.action;
        this.handleSettingAction(action);
      });
    });

    // 初始化黑名单
    this.loadBlacklist();

    // 初始化快捷键设置
    this.initShortcutSettings();

    // 初始化提示词库
    this.initPromptLibrary();
  }

  initPromptLibrary() {
    if (window.CCSPopup && window.CCSPopup.PromptLibraryManager) {
      this.promptLibraryManager = new window.CCSPopup.PromptLibraryManager({
        onToast: (msg) => this.showToast(msg)
      });
      this.promptLibraryManager.init();
    }
  }

  handleSettingAction(action) {
    switch (action) {
      case 'toggle':
        this.toggleExtension();
        break;
      case 'blacklist':
        this.toggleBlacklistSection();
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
        this.toggleShortcutSettings();
        break;
      case 'prompt-library':
        this.togglePromptLibrarySection();
        break;
      case 'open-welcome':
        chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') });
        window.close();
        break;
    }
  }

  toggleExtension() {
    chrome.storage.local.get(['enabled'], (result) => {
      const currentState = result.enabled !== false;
      const newState = !currentState;

      chrome.storage.local.set({ enabled: newState }, () => {
        this.updateToggleButton(newState);
        this.showToast(newState ? '插件已启用' : '插件已禁用');

        // 通知content script状态改变
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

  updateToggleButton(enabled) {
    const toggleBtn = document.querySelector('[data-action="toggle"]');
    if (toggleBtn) {
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
  }

  initDebugToggle() {
    const btn = document.querySelector('[data-action="debug"]');
    if (!btn) return;

    chrome.storage.local.get(['ccs_debug'], (res) => {
      const enabled = !!res.ccs_debug;
      this.setDebugButtonState(enabled);
    });
  }

  setDebugButtonState(enabled) {
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

  toggleDebug() {
    chrome.storage.local.get(['ccs_debug'], (res) => {
      const current = !!res.ccs_debug;
      const next = !current;
      chrome.storage.local.set({ ccs_debug: next }, () => {
        this.setDebugButtonState(next);
        chrome.runtime.sendMessage({ action: 'updateDebug', enabled: next }).catch(() => {});
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'updateDebug', enabled: next }).catch(() => {});
          }
        });
        this.showToast(next ? '调试已开启' : '调试已关闭');
      });
    });
  }

  // 初始化语音功能开关——默认关闭（实验性，主动开启才生效）
  initVoiceToggle() {
    const btn = document.querySelector('[data-action="voice"]');
    if (!btn) return;
    chrome.storage.local.get(['ccs_voice_enabled'], (res) => {
      this.setVoiceButtonState(!!res.ccs_voice_enabled);
    });
  }

  setVoiceButtonState(enabled) {
    const btn = document.querySelector('[data-action="voice"]');
    if (!btn) return;
    const label = btn.querySelector('.setting-label');
    const icon = btn.querySelector('.setting-icon');
    icon.textContent = '🎤';
    btn.title = '实验性功能：通过语音说出引擎名快速搜索（默认关）';
    // 主 label 只用 6 字保持与其它设置按钮等宽（与"调试日志：关"对齐），
    // "实验性"通过 .setting-badge 小角标表达，不挤压网格
    label.textContent = enabled ? '语音功能：开' : '语音功能：关';
    if (enabled) {
      btn.style.background = '#fff8e1';
      btn.style.borderColor = '#fbc02d';
    } else {
      btn.style.background = '';
      btn.style.borderColor = '';
    }
  }

  // 切换语音功能：开则 sidepanel 实例化语音模块、显示 🎤；关则全部不激活。
  // sidepanel 通过 storage onChanged 实时响应，无需重开。
  toggleVoice() {
    chrome.storage.local.get(['ccs_voice_enabled'], (res) => {
      const current = !!res.ccs_voice_enabled;
      const next = !current;
      chrome.storage.local.set({ ccs_voice_enabled: next }, () => {
        this.setVoiceButtonState(next);
        // 短文案与"调试已开启/关闭"等同类 toast 风格对齐，不再带括号注释
        this.showToast(next ? '语音功能已开启' : '语音功能已关闭');
      });
    });
  }

  toggleBlacklistSection() {
    const blacklistSection = document.getElementById('blacklistSection');
    const shortcutSection = document.getElementById('shortcutSection');
    const debugSection = document.getElementById('debugSection');
    const promptLibrarySection = document.getElementById('promptLibrarySection');

    if (blacklistSection.style.display === 'none') {
      blacklistSection.style.display = 'block';
      shortcutSection.style.display = 'none';
      debugSection.style.display = 'none';
      if (promptLibrarySection) promptLibrarySection.style.display = 'none';
      this.loadBlacklist();
    } else {
      blacklistSection.style.display = 'none';
    }
  }

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

      const clearBtn = document.querySelector('.clear-blacklist');
      if (clearBtn) {
        clearBtn.onclick = () => this.clearAllBlacklist();
      }
    });
  }

  removeFromBlacklist(host) {
    chrome.storage.local.get(['ccs_settings'], (result) => {
      const settings = result.ccs_settings || { blacklist: [] };
      const index = settings.blacklist.indexOf(host);

      if (index > -1) {
        settings.blacklist.splice(index, 1);
        chrome.storage.local.set({ ccs_settings: settings }, () => {
          this.showToast(`已移除: ${host}`);
          this.loadBlacklist();

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

  clearAllBlacklist() {
    if (confirm('确定要清空所有黑名单吗？')) {
      chrome.storage.local.get(['ccs_settings'], (result) => {
        const settings = result.ccs_settings || {};
        settings.blacklist = [];

        chrome.storage.local.set({ ccs_settings: settings }, () => {
          this.showToast('黑名单已清空');
          this.loadBlacklist();

          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
              chrome.tabs.sendMessage(tabs[0].id, {
                action: 'updateBlacklist',
                blacklist: []
              }).catch(() => {});
            }
          });
        });
      });
    }
  }

  initShortcutSettings() {
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

  toggleShortcutSettings() {
    const shortcutSection = document.getElementById('shortcutSection');
    const blacklistSection = document.getElementById('blacklistSection');
    const debugSection = document.getElementById('debugSection');
    const promptLibrarySection = document.getElementById('promptLibrarySection');

    if (shortcutSection.style.display === 'none') {
      shortcutSection.style.display = 'block';
      blacklistSection.style.display = 'none';
      debugSection.style.display = 'none';
      if (promptLibrarySection) promptLibrarySection.style.display = 'none';
    } else {
      shortcutSection.style.display = 'none';
    }
  }

  togglePromptLibrarySection() {
    const promptLibrarySection = document.getElementById('promptLibrarySection');
    const shortcutSection = document.getElementById('shortcutSection');
    const blacklistSection = document.getElementById('blacklistSection');
    const debugSection = document.getElementById('debugSection');

    if (!promptLibrarySection) return;

    if (promptLibrarySection.style.display === 'none') {
      promptLibrarySection.style.display = 'block';
      shortcutSection.style.display = 'none';
      blacklistSection.style.display = 'none';
      debugSection.style.display = 'none';
      // Initialize and render prompt library
      if (this.promptLibraryManager) {
        this.promptLibraryManager.renderList();
      }
    } else {
      promptLibrarySection.style.display = 'none';
    }
  }

  saveShortcutSettings() {
    const select = document.querySelector('.shortcut-key-select');
    if (!select) return;

    const newShortcut = select.value;

    chrome.storage.local.get(['ccs_settings'], (result) => {
      const settings = result.ccs_settings || {};
      settings.shortcutKey = newShortcut;

      chrome.storage.local.set({ ccs_settings: settings }, () => {
        this.showToast('快捷键已更新为: ' + newShortcut);

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

  async exportMenuState() {
    const btn = document.querySelector('[data-action="export-menu-state"]');
    if (btn) {
      btn.disabled = true;
      const label = btn.querySelector('.setting-label');
      label.textContent = '获取中...';
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
          this.showToast('获取菜单状态失败');
        }

        if (btn) {
          btn.disabled = false;
          const label = btn.querySelector('.setting-label');
          label.textContent = '导出菜单状态';
        }
      });
    } catch (error) {
      this.showToast('获取菜单状态失败');
      if (btn) {
        btn.disabled = false;
        const label = btn.querySelector('.setting-label');
        label.textContent = '导出菜单状态';
      }
    }
  }

  showMenuDebugInfo(data) {
    const debugSection = document.getElementById('debugSection');
    const textEl = document.querySelector('.menu-debug-text');
    const blacklistSection = document.getElementById('blacklistSection');
    const shortcutSection = document.getElementById('shortcutSection');
    const promptLibrarySection = document.getElementById('promptLibrarySection');

    if (!debugSection || !textEl) return;

    const formatted = JSON.stringify(data, null, 2);
    textEl.textContent = formatted;

    blacklistSection.style.display = 'none';
    shortcutSection.style.display = 'none';
    if (promptLibrarySection) promptLibrarySection.style.display = 'none';
    debugSection.style.display = 'block';

    navigator.clipboard.writeText(formatted).then(() => {
      this.showToast('菜单状态已复制到剪贴板');
    }).catch(() => {});

    const copyBtn = document.querySelector('.copy-debug-info');
    const closeBtn = document.querySelector('.close-debug-info');

    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(formatted).then(() => {
          this.showToast('已复制到剪贴板');
        }).catch(() => {
          this.showToast('复制失败');
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

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  const renderer = new PopupMenuRenderer();
  renderer.init();
});
