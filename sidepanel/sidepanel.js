/**
 * 触触搜 Side Panel - 简化快捷菜单
 * 只显示置顶操作 + 一级菜单项（无子菜单）
 */

const PIN_STORAGE_KEY = 'ccs_sidepanel_pinned_action';
const DEFAULT_PIN = { taskId: 'cover', categoryId: 'xiaohongshu' };

// Use JS transforms instead of CSS marquee; Windows can disable/freeze CSS animation here.
function setupMarquee(viewportSelector, textSelector, options = {}) {
  const viewport = document.querySelector(viewportSelector);
  const text = document.querySelector(textSelector);
  if (!viewport || !text) return;

  const speed = options.speed || 42;
  let viewportWidth = 0;
  let textWidth = 0;
  let distance = 1;
  let offset = 0;
  let lastTime = performance.now();

  text.style.animation = 'none';
  text.style.paddingLeft = '0';

  const measure = () => {
    viewportWidth = Math.ceil(viewport.getBoundingClientRect().width);
    textWidth = Math.ceil(text.scrollWidth || text.getBoundingClientRect().width);
    distance = Math.max(1, viewportWidth + textWidth);
    offset %= distance;
  };

  const tick = (now) => {
    if (viewportWidth <= 0 || textWidth <= 0) {
      measure();
    }

    const delta = Math.min(now - lastTime, 100);
    offset = (offset + delta * speed / 1000) % distance;

    lastTime = now;
    text.style.transform = `translateX(${Math.round(viewportWidth - offset)}px)`;
    requestAnimationFrame(tick);
  };

  measure();
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    viewport._ccsMarqueeState = { observer };
  } else {
    window.addEventListener('resize', measure);
  }
  window.addEventListener('load', measure, { once: true });
  requestAnimationFrame(tick);
}

class PinnedAction {
  constructor(renderer) {
    this.renderer = renderer;
    this.coverConfig = null;
    this.current = { ...DEFAULT_PIN };
    this.draft = null;
  }

  async init() {
    const [stored, coverCfg] = await Promise.all([
      this.loadStored(),
      this.loadCoverConfig()
    ]);
    this.coverConfig = coverCfg;
    if (stored && this.findCategory(stored.categoryId, coverCfg)) {
      this.current = stored;
    } else {
      this.current = { ...DEFAULT_PIN };
    }
    if (!coverCfg || !Array.isArray(coverCfg.categories) || coverCfg.categories.length === 0) {
      // 没有 cover 配置就不显示置顶区
      return;
    }
    document.getElementById('spPin').hidden = false;
    this.render();
    this.attachListeners();
  }

  loadStored() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([PIN_STORAGE_KEY], (result) => {
          resolve(result?.[PIN_STORAGE_KEY] || null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  async loadCoverConfig() {
    try {
      const url = chrome.runtime.getURL('prompts/coverPrompts.json');
      const response = await fetch(url);
      if (!response.ok) return null;
      return await response.json();
    } catch (_) {
      return null;
    }
  }

  findCategory(id, cfg = this.coverConfig) {
    if (!cfg || !Array.isArray(cfg.categories)) return null;
    return cfg.categories.find((c) => c.id === id) || null;
  }

  render() {
    const cat = this.findCategory(this.current.categoryId);
    if (!cat) return;
    const styleEl = document.getElementById('spPinStyle');
    const taskEl = document.getElementById('spPinTask');
    if (taskEl) taskEl.textContent = '封面生成器';
    if (styleEl) styleEl.textContent = cat.label || cat.id;
  }

  attachListeners() {
    document.getElementById('spPinAction').addEventListener('click', () => this.execute());
    document.getElementById('spPinEdit').addEventListener('click', () => this.openPicker());
    document.getElementById('spPinCancel').addEventListener('click', () => this.closePicker());
    document.getElementById('spPinSave').addEventListener('click', () => this.savePicker());
  }

  async execute() {
    const cat = this.findCategory(this.current.categoryId);
    if (!cat) return;
    const engine = (cat.engines || [])[0];
    if (!engine) {
      this.renderer.showToast('该风格暂无可用引擎');
      return;
    }
    await this.renderer.refresh();
    const keyword = this.renderer.keyword.raw || this.renderer.keyword.text;
    const menuItemId = `ccs-cover-${cat.id}-${engine.id}`;
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'executeMenuAction',
        menuItemId,
        menuType: 'cover',
        keyword,
        urlPattern: engine.urlPattern,
        engineId: engine.id,
        purpose: cat.purpose || cat.label,
        categoryId: cat.id
      });
      if (response && response.error === 'no-keyword') {
        this.renderer.showToast('没有选中文本或无法提取关键词');
      }
    } catch (_) {
      this.renderer.showToast('操作失败');
    }
  }

  openPicker() {
    this.draft = { ...this.current };
    const list = document.getElementById('spPinOptions');
    list.innerHTML = '';
    (this.coverConfig?.categories || []).forEach((cat) => {
      const optId = `pin-opt-${cat.id}`;
      const checked = cat.id === this.draft.categoryId ? 'checked' : '';
      const label = document.createElement('label');
      label.className = 'sp-pin-option';
      label.htmlFor = optId;
      label.innerHTML = `
        <input type="radio" name="pinStyle" id="${optId}" value="${cat.id}" ${checked}>
        <span class="sp-pin-option-label">${cat.label || cat.id}</span>
      `;
      list.appendChild(label);
    });
    list.onchange = (e) => {
      const target = e.target;
      if (target && target.name === 'pinStyle') {
        this.draft.categoryId = target.value;
      }
    };
    document.getElementById('spPinPicker').hidden = false;
  }

  closePicker() {
    document.getElementById('spPinPicker').hidden = true;
    this.draft = null;
  }

  async savePicker() {
    if (!this.draft) {
      this.closePicker();
      return;
    }
    this.current = { ...this.draft };
    await new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [PIN_STORAGE_KEY]: this.current }, () => resolve());
      } catch (_) {
        resolve();
      }
    });
    this.render();
    this.closePicker();
    this.renderer.showToast('已保存置顶风格');
  }
}

class SidePanelRenderer {
  constructor() {
    this.config = null;
    this.keyword = { text: '', raw: '' };
    this.currentTabUrl = '';
    this.pinned = new PinnedAction(this);
    // 用户手动从剪贴板写入 keyword 时设 true；URL 变化时回 false
    // 用于防止后续 refresh() 在 chrome:// 等不支持选区的页面拉不到、把手动设的 keyword 清空
    this.keywordSetManually = false;
  }

  async init() {
    this.setupAlivePort();
    try {
      const [config, tabInfo] = await Promise.all([
        this.loadMenuConfig(),
        this.getActiveTab()
      ]);

      this.config = config;
      this.currentTabUrl = tabInfo.url || '';

      // Get keyword
      this.keyword = await this.getCurrentKeyword(tabInfo);

      this.renderKeyword();
      this.renderMenu();
      this.bindClipboardButton();
      // 置顶区独立于主菜单加载，失败不影响整体
      this.pinned.init().catch((err) => {
        console.warn('[触触搜] Pinned action init failed:', err);
      });

      // Listen for tab changes to update pinned actions
      chrome.tabs.onActivated.addListener(() => this.refresh());
      chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (changeInfo.url || changeInfo.status === 'complete') {
          this.refresh();
        }
      });

      // Listen for real-time keyword updates from background
      chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'keywordUpdated' && message.keyword) {
          this.keyword = {
            text: message.keyword.text || '',
            raw: message.keyword.raw || message.keyword.text || ''
          };
          this.renderKeyword();
        }
      });
    } catch (error) {
      console.error('[触触搜] Side panel init failed:', error);
      document.getElementById('spMenu').innerHTML =
        '<div class="sp-empty">加载失败，请重试</div>';
    }
  }

  // 通过 port 连接告诉 background 本侧边栏在哪个 window 活着，
  // 同时监听 background 发来的关闭信号（popup 点「关闭」时触发）
  // SW 重启 / 扩展重载会让 port 断开，自动重连保证状态不假报
  async setupAlivePort() {
    try {
      const win = await chrome.windows.getCurrent();
      const port = chrome.runtime.connect({ name: 'sidepanel-alive' });
      port.postMessage({ windowId: win.id });
      port.onMessage.addListener((msg) => {
        if (msg && msg.action === 'close') {
          try { window.close(); } catch (_) { /* 兜底 */ }
        }
      });
      port.onDisconnect.addListener(() => {
        // SW 重启或扩展重载导致断连，500ms 后重新建链
        setTimeout(() => this.setupAlivePort(), 500);
      });
    } catch (e) {
      console.warn('[触触搜] sidepanel alive port setup failed:', e);
    }
  }

  async refresh() {
    try {
      const tabInfo = await this.getActiveTab();
      const newUrl = tabInfo.url || '';
      const urlChanged = newUrl !== this.currentTabUrl;
      this.currentTabUrl = newUrl;

      const newKeyword = await this.getCurrentKeyword(tabInfo);

      // URL 变化 → 跟随新页面，清掉手动标记
      if (urlChanged) {
        this.keyword = newKeyword;
        this.keywordSetManually = false;
        this.renderKeyword();
        return;
      }

      // URL 没变，但用户手动设过 keyword 且自动提取又空 → 保留手动设的，不覆盖
      // （比如 chrome:// 页面 user 用剪贴板按钮写了 keyword，
      //   后续 tab 事件触发 refresh()，自动提取还是空，不能把手动的清掉）
      if (this.keywordSetManually && (!newKeyword || !newKeyword.text)) {
        return;
      }

      // 其它情况照常覆盖
      this.keyword = newKeyword;
      this.renderKeyword();
    } catch (e) {
      // Ignore refresh errors
    }
  }

  async getActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs[0] || { url: '', title: '', id: null });
      });
    });
  }

  async loadMenuConfig() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'getMenuStructure' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error('Config load failed'));
          return;
        }
        if (response && response.success) {
          resolve(response.structure);
        } else {
          reject(new Error(response?.error || 'Config load failed'));
        }
      });
    });
  }

  async getCurrentKeyword(tabInfo) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'getSearchText',
        tabId: tabInfo.id,
        url: tabInfo.url,
        title: tabInfo.title,
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
  }

  renderKeyword() {
    const el = document.getElementById('spKeyword');
    const clipBtn = document.getElementById('spClipboardBtn');
    if (this.keyword.text) {
      const display = this.keyword.text.replace(/\s+/g, ' ').trim();
      el.textContent = `"${display.length > 20 ? display.substring(0, 20) + '...' : display}"`;
      el.title = this.keyword.raw;
      if (clipBtn) clipBtn.hidden = true;
    } else {
      el.textContent = '';
      if (clipBtn) clipBtn.hidden = false;
    }
  }

  // 剪贴板读取按钮——给 chrome:// 等不支持选区的页面做兜底
  // 用户复制文字后点这个按钮，把剪贴板内容写入关键字
  bindClipboardButton() {
    const btn = document.getElementById('spClipboardBtn');
    if (!btn) return;
    const original = btn.textContent;
    const reset = () => {
      btn.disabled = false;
      btn.textContent = original;
    };
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '⏳ 正在读取剪贴板...';
      try {
        const text = await navigator.clipboard.readText();
        const cleaned = (text || '').trim();
        if (!cleaned) {
          btn.textContent = '⚠️ 剪贴板为空，请先复制文字再点';
          setTimeout(reset, 2000);
          return;
        }
        const limited = cleaned.slice(0, 500);
        this.keyword = {
          text: limited.replace(/\s+/g, ' '),
          raw: limited
        };
        // 标记为手动设——后续 refresh() 在同 URL 下不会用空 keyword 覆盖它
        this.keywordSetManually = true;
        this.renderKeyword();   // keyword 非空 → 自动隐藏按钮
        this.renderMenu();       // 用新关键字重渲染菜单 URL
        // 即使按钮已 hidden，也立即重置文字 / disabled——
        // 否则后续 tab 事件触发 refresh() 让按钮重新露出时会"卡在正在读取"
        reset();
      } catch (err) {
        console.warn('[触触搜] 读剪贴板失败:', err);
        btn.textContent = '⚠️ 读取失败，请重试';
        setTimeout(reset, 2000);
      }
    });
  }

  renderMenu() {
    const container = document.getElementById('spMenu');
    container.innerHTML = '';

    if (!this.config || !this.config.groups) {
      container.innerHTML = '<div class="sp-empty">无菜单配置</div>';
      return;
    }

    let hasItems = false;

    this.config.groups.forEach((group, index) => {
      // Skip panel group
      if (group.id === 'panel') return;
      if (!group.items) return;

      // Filter to only leaf items (no children or empty children)
      const leafItems = group.items.filter(item => {
        if (item.enabled === false) return false;
        if (item.children && item.children.length > 0) return false;
        return true;
      });

      if (leafItems.length === 0) return;

      // Add separator between groups
      if (hasItems) {
        container.appendChild(this.createSeparator());
      }

      leafItems.forEach(item => {
        container.appendChild(this.createMenuItem(item));
      });

      hasItems = true;
    });

    if (!hasItems) {
      container.innerHTML = '<div class="sp-empty">无可用菜单项</div>';
    }
  }

  createSeparator() {
    const sep = document.createElement('div');
    sep.className = 'sp-separator';
    return sep;
  }

  createMenuItem(item) {
    const el = document.createElement('div');
    el.className = 'sp-menu-item';

    // Simplify title for fastqa-quick type
    let displayTitle = item.title || '';
    if (item.type === 'fastqa-quick') {
      const match = displayTitle.match(/- (.+)$/);
      if (match) {
        displayTitle = `速答 · ${match[1]}`;
      }
    }

    el.innerHTML = `
      <span class="sp-item-icon">${item.icon || ''}</span>
      <span class="sp-item-title">${displayTitle}</span>
    `;

    el.addEventListener('click', () => this.handleClick(item));
    return el;
  }

  async handleClick(item) {
    await this.refresh();
    const keyword = this.keyword.raw || this.keyword.text;

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'executeMenuAction',
        menuItemId: item.id,
        menuType: item.type,
        keyword: keyword,
        urlPattern: item.urlPattern,
        actionType: item.action,
        engineId: item.engineId,
        purpose: item.purpose
      });

      if (response && response.error === 'no-keyword') {
        this.showToast('没有选中文本或无法提取关键词');
      }
    } catch (error) {
      console.error('[触触搜] Menu action failed:', error);
      this.showToast('操作失败');
    }
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'sp-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }
}

// 置顶区高度随剪贴板按钮 hidden/show 而变（多 ~44px），用 ResizeObserver
// 实时把真实高度同步到 body padding-top，避免菜单被压住或留出空白
function syncStickyTopPadding() {
  const stickyTop = document.getElementById('spStickyTop');
  if (!stickyTop) return;
  const apply = () => {
    const h = stickyTop.getBoundingClientRect().height;
    if (h > 0) document.body.style.paddingTop = `${Math.ceil(h)}px`;
  };
  apply();
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(apply).observe(stickyTop);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  syncStickyTopPadding();
  setupMarquee('.sp-pin-tip-marquee', '.sp-pin-tip-text', { speed: 42 });
  const renderer = new SidePanelRenderer();
  renderer.init();
});
