/**
 * 触触搜 Popup —— 极简渲染模式（参考 test_plasmo_demo）
 *
 * v1.6.19 设计原则：
 * - 菜单是静态 HTML（编译期由 scripts/prebuild-popup-menu.mjs 注入完整结构）
 * - popup.js 只做：绑事件、读关键字 storage、处理 pinned cover、设置面板
 * - 0 fetch 拉菜单 / 0 sendMessage 醒 SW / 0 DOM 构建
 * - 商店生产 popup 首屏 = HTML 解析时间（~10-20ms）
 *
 * dev mode（plasmo dev 没跑 prebuild）：popup.html 自带 6 个常用菜单作 fallback
 * —— 完整菜单看 build/ 产物，dev 用最常用功能。
 */

class PopupMenuRenderer {
  constructor() {
    this.keyword = { text: '', raw: '' };
    this.currentMode = 'menu'; // 'menu' or 'settings'
    this.promptLibraryManager = null;
    this._settingsInitDone = false;
    this._promptLibraryLoadPromise = null;
  }

  async init() {
    performance.mark('ccs-popup-start');
    const initRequestId = globalThis.CCSLogger?.createRequestId?.('popup-init') || `popup-init-${Date.now()}`;
    globalThis.CCSLogger?.info?.('popup', 'init-start', initRequestId, 'popup init started');
    try {
      void globalThis.CCSStorageDefaults?.ensureDefaults?.({ source: 'popup', requestId: initRequestId });
      this.loadVersion();
      this.bindEvents();
      this.startKeywordLoad();
      this._preloadEnableState();
      // initPinnedCover 自己 fetch coverPrompts.json（不依赖任何缓存/SW）
      this.initPinnedCover();
      this._renderKeyword();
      performance.mark('ccs-popup-rendered');
      try {
        performance.measure('ccs-popup-ttfb', 'ccs-popup-start', 'ccs-popup-rendered');
        const m = performance.getEntriesByName('ccs-popup-ttfb')[0];
        if (m) console.log(`[触触搜][PERF] popup TTFB: ${m.duration.toFixed(1)}ms`);
      } catch (_) { /* perf 失败无所谓 */ }
      globalThis.CCSLogger?.info?.('popup', 'first-paint', initRequestId, 'popup first paint complete');
    } catch (error) {
      globalThis.CCSLogger?.error?.('popup', 'init-error', initRequestId, error?.message || String(error), { stack: error?.stack });
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

  fetchJSON(path) {
    return fetch(chrome.runtime.getURL(path))
      .then((r) => r.ok ? r.json() : null)
      .catch(() => null);
  }

  startKeywordLoad() {
    // v1.6.19：popup 首屏不发 sendMessage('getKeyword') —— 商店生产环境 SW 30s
    // idle 即被回收，发消息会触发 SW 冷启动（importScripts 17 个 legacy + side
    // effects ~500ms-2s），跟 popup 渲染抢 CPU 导致 "卡住打不开"。
    // 改成：只读 storage 缓存（SW 写入选区时已经持久化）+ 监听 onChanged 实时刷
    // 新值。用户点击菜单时 handleClick 会兜底发消息（用户已感知 popup 开了）。
    this._keywordLoadPromise = (async () => {
      try {
        const tab = await CCSKeywordClient.getActiveTab();
        if (!tab?.id) return;
        this._activeTabId = tab.id;
        this._activeTabUrl = tab.url || '';
        const cached = await CCSKeywordClient.readInstantCache(tab.id, tab.url);
        if (cached?.text) {
          this.applyKeyword(cached);
        }
        // SW 后续写入 ccs_kw_<tabId>（例如内容脚本上报新选区）→ 自动刷新徽章
        const storageKey = `ccs_kw_${tab.id}`;
        this._kwStorageListener = (changes, areaName) => {
          if (areaName !== 'local') return;
          const change = changes[storageKey];
          if (!change?.newValue) return;
          if (change.newValue.url && this._activeTabUrl && change.newValue.url !== this._activeTabUrl) return;
          this.applyKeyword({
            text: change.newValue.text || '',
            raw: change.newValue.raw || change.newValue.text || ''
          });
        };
        try { chrome.storage.onChanged.addListener(this._kwStorageListener); } catch (_) { /* ignore */ }

        // Cache miss is common after first install/new tab. Keep first paint free of
        // SW work, then refresh the badge in the background with a bounded request.
        const scheduleFreshKeyword = (fn) => {
          const ric = globalThis.requestIdleCallback;
          if (typeof ric === 'function') ric(fn, { timeout: 300 });
          else setTimeout(fn, 120);
        };
        scheduleFreshKeyword(() => {
          this.refreshKeyword({
            timeoutMs: cached?.text ? 900 : 1500,
            retries: cached?.text ? 0 : 1
          }).catch((error) => {
            globalThis.CCSLogger?.warn?.(
              'popup',
              'keyword-refresh-failed',
              globalThis.CCSLogger?.createRequestId?.('popup-keyword') || '',
              error?.message || String(error)
            );
          });
        });
      } catch (error) {
        console.warn('[触触搜] 关键字加载失败:', error);
      }
    })();
    return this._keywordLoadPromise;
  }

  // handleClick / executePinnedCover 兜底用：storage 没缓存（如刚开新 tab 还没
  // 选词或 SW 死过 cache 丢失）时，用户点击之后才发消息唤醒 SW 拿关键字。
  // 这条路径用户已经看到 popup 了，等 200-1500ms 拿关键字没有"打不开"的卡感。
  async _ensureKeywordOrFetch() {
    if (this.keyword.raw || this.keyword.text) return this.keyword;
    try {
      const fresh = await Promise.race([
        CCSKeywordClient.requestKeyword(CCSKeywordClient.INTENTS.POPUP_OPEN, {
          timeoutMs: 1200,
          retries: 0
        }),
        new Promise((resolve) => setTimeout(() => resolve(null), 1500))
      ]);
      if (fresh?.text) this.applyKeyword(fresh);
    } catch (_) { /* ignore */ }
    return this.keyword;
  }

  applyKeyword(keyword) {
    this.keyword = {
      text: keyword?.text || '',
      raw: keyword?.raw || keyword?.text || ''
    };
    this._renderKeyword();
  }

  async sendRuntimeAction(message, options = {}) {
    const client = globalThis.CCSRuntimeClient;
    if (client?.sendRuntimeMessage) {
      return client.sendRuntimeMessage(message, {
        timeoutMs: options.timeoutMs || 4000,
        retries: options.retries ?? 1
      });
    }
    const startedAt = Date.now();
    try {
      const data = await chrome.runtime.sendMessage(message);
      return { ok: true, data, elapsedMs: Date.now() - startedAt };
    } catch (error) {
      return {
        ok: false,
        error: { code: 'SEND_FAILED', message: error?.message || String(error) },
        elapsedMs: Date.now() - startedAt
      };
    }
  }

  runtimeErrorMessage(error) {
    const code = error?.code || '';
    if (code === 'TIMEOUT') return '后台启动较慢，请重试';
    if (code === 'SW_UNAVAILABLE') return '后台服务暂不可用，请重试';
    if (code === 'CONTENT_UNAVAILABLE') return '当前页面暂不支持直接操作，可刷新页面或使用剪贴板关键字';
    if (code === 'PERMISSION_DENIED') return '当前页面权限受限，无法执行该操作';
    return '操作失败，请重试';
  }

  // 设置面板首屏不展示，只在用户点 ⚙️ 时才完整 initSettings。
  // 但启用/禁用状态可能影响顶层 UI（如 toast 区别 etc.），轻量预读。
  _preloadEnableState() {
    chrome.storage.local.get(['enabled'], (r) => {
      this._cachedEnabled = r.enabled !== false;
    });
  }

  // C 档重构后：popup.js 不再直接发消息拿关键字，统一过 CCSKeywordClient。
  // 老调用点（PromptLibraryManager / SettingsManager 等）若需要兜底刷新关键字，
  // 调用 this.refreshKeyword() 即可。
  async refreshKeyword(options = {}) {
    const fresh = await CCSKeywordClient.requestKeyword(CCSKeywordClient.INTENTS.POPUP_OPEN, {
      timeoutMs: options.timeoutMs || 1500,
      retries: options.retries ?? 1
    });
    if (fresh?.text || fresh?.raw) {
      this.keyword = fresh;
      this._renderKeyword();
    }
    return fresh;
  }

  // 关键字徽章渲染（与菜单 DOM 独立 —— 关键字变化不动菜单）
  _renderKeyword() {
    const keywordEl = document.getElementById('currentKeyword');
    if (!keywordEl) return;
    const keywordCopyEl = document.getElementById('currentKeywordCopy');
    const keywordWrapEl = keywordEl.closest('.menu-keyword-wrap');
    if (this.keyword?.text) {
      const displayText = this.formatKeyword(this.keyword.text);
      const fullKeyword = this.keyword.raw || this.keyword.text;
      keywordEl.textContent = `"${displayText}"`;
      if (keywordWrapEl) {
        keywordWrapEl.dataset.fullKeyword = fullKeyword;
        keywordWrapEl.classList.add('has-keyword');
      }
      keywordEl.removeAttribute('title');
      if (keywordCopyEl) {
        keywordCopyEl.hidden = false;
        keywordCopyEl.dataset.keyword = fullKeyword;
      }
    } else {
      keywordEl.textContent = '';
      if (keywordWrapEl) {
        keywordWrapEl.dataset.fullKeyword = '';
        keywordWrapEl.classList.remove('has-keyword');
      }
      keywordEl.removeAttribute('title');
      if (keywordCopyEl) {
        keywordCopyEl.hidden = true;
        keywordCopyEl.dataset.keyword = '';
      }
    }
  }

  formatKeyword(text) {
    if (!text) return '';
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.length > 15 ? compact.substring(0, 15) + '...' : compact;
  }

  // 子菜单展开/折叠（事件代理调用 —— 静态 HTML 里子菜单 DOM 已存在，只切 class）
  toggleSubmenu(parentEl, parentId) {
    const submenu = document.querySelector(`.submenu[data-parent-id="${parentId}"]`);
    if (!submenu) return;
    const willExpand = submenu.classList.contains('collapsed');
    submenu.classList.toggle('collapsed');
    parentEl.classList.toggle('expanded');
    if (willExpand) {
      // 展开后让 submenu 完整露出，避开 popup 底部 fixed .menu-footer（56px）。
      // 注：之前用 scrollIntoView + CSS scroll-padding-bottom，在部分 Chrome 版本上
      // 与 block:'nearest' 配合不可靠，最后一行仍被 footer 遮住。改成显式算偏移 + scrollBy，
      // 强制把 submenu 的底部抬到 footer 上方 12px 处。
      submenu.addEventListener('transitionend', () => {
        const FOOTER_H = 56;
        const BREATH = 12;          // submenu 底部与 footer 之间的呼吸距
        const SAFE_BOTTOM = FOOTER_H + BREATH;
        const rect = submenu.getBoundingClientRect();
        const viewportH = window.innerHeight || document.documentElement.clientHeight;
        const targetMaxBottom = viewportH - SAFE_BOTTOM;
        if (rect.bottom <= targetMaxBottom) return;     // 已经完整露出
        const delta = Math.ceil(rect.bottom - targetMaxBottom);
        // popup 用 body 自身做滚动容器（body { overflow-y: auto; max-height }）
        const scroller = document.scrollingElement || document.body;
        try {
          scroller.scrollBy({ top: delta, behavior: 'smooth' });
        } catch (_) {
          scroller.scrollTop += delta;   // 老浏览器无 options-form scrollBy 时降级
        }
      }, { once: true });
    }
  }

  // === Pinned cover quick-launch（与 sidepanel pin 共享 chrome.storage.local 状态） ===
  // 这些 storage key 必须与 sidepanel/sidepanel.js 顶部声明保持一致；那边是 SSoT，这里只读。
  static PIN_STORAGE_KEY = 'ccs_sidepanel_pinned_action';
  static CUSTOM_LINE_KEY = 'ccs_cover_custom_selected_line';
  static CUSTOM_PURPOSE_KEY = 'ccs_cover_custom_purpose';
  static RATIO_KEY = 'ccs_cover_aspect_ratio';
  static DEFAULT_PIN = { taskId: 'cover', categoryId: 'anime-cute' };
  static DEFAULT_RATIO = '5:2';

  async initPinnedCover() {
    try {
      const [storage, coverConfig] = await Promise.all([
        this.loadPinStorage(),
        this.loadCoverConfig()
      ]);
      if (!coverConfig || !Array.isArray(coverConfig.categories) || coverConfig.categories.length === 0) {
        return;   // 没有 cover 配置就不显示
      }
      let pin = storage.pin && storage.pin.taskId === 'cover' ? storage.pin : { ...PopupMenuRenderer.DEFAULT_PIN };
      const cat = coverConfig.categories.find((c) => c.id === pin.categoryId);
      if (!cat) {
        pin = { ...PopupMenuRenderer.DEFAULT_PIN };
      }
      // 自定义风格：必须有可用文本，否则退回默认（与 sidepanel 同逻辑）
      const customLine = (storage.customLine || '').trim();
      if (pin.categoryId === 'custom' && !customLine) {
        pin = { ...PopupMenuRenderer.DEFAULT_PIN };
      }
      this.pinnedCover = {
        pin,
        category: coverConfig.categories.find((c) => c.id === pin.categoryId),
        ratio: storage.ratio || PopupMenuRenderer.DEFAULT_RATIO,
        customLine
      };
      this.renderPinnedCover();
      this.bindPinnedCover();
    } catch (error) {
      console.warn('[触触搜] 置顶封面生成器加载失败:', error);
    }
  }

  loadPinStorage() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([
          PopupMenuRenderer.PIN_STORAGE_KEY,
          PopupMenuRenderer.CUSTOM_LINE_KEY,
          PopupMenuRenderer.CUSTOM_PURPOSE_KEY,
          PopupMenuRenderer.RATIO_KEY
        ], (result) => {
          resolve({
            pin: result?.[PopupMenuRenderer.PIN_STORAGE_KEY] || null,
            customLine: result?.[PopupMenuRenderer.CUSTOM_LINE_KEY] || result?.[PopupMenuRenderer.CUSTOM_PURPOSE_KEY]?.split(/\r?\n/)[0]?.trim() || '',
            ratio: typeof result?.[PopupMenuRenderer.RATIO_KEY] === 'string' ? result[PopupMenuRenderer.RATIO_KEY].trim() : ''
          });
        });
      } catch (_) {
        resolve({ pin: null, customLine: '', ratio: '' });
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

  renderPinnedCover() {
    const section = document.getElementById('popupPin');
    const styleEl = document.getElementById('popupPinStyle');
    const ratioEl = document.getElementById('popupPinRatio');
    if (!section || !styleEl || !this.pinnedCover) return;
    const { category, ratio, customLine } = this.pinnedCover;
    if (!category) return;
    if (category.id === 'custom') {
      const preview = customLine.length > 15 ? customLine.slice(0, 15) + '…' : customLine;
      styleEl.textContent = preview ? `🖌️ ${preview}` : '🖌️ 自定义风格';
      styleEl.title = customLine || '';
    } else {
      styleEl.textContent = category.label || category.id;
      styleEl.title = '';
    }
    if (ratioEl) ratioEl.textContent = ratio || PopupMenuRenderer.DEFAULT_RATIO;
    section.hidden = false;
  }

  bindPinnedCover() {
    const actionBtn = document.getElementById('popupPinAction');
    if (!actionBtn) return;
    actionBtn.addEventListener('click', () => this.executePinnedCover());

    const hintBtn = document.getElementById('popupPinOpenSidepanel');
    if (hintBtn) {
      hintBtn.addEventListener('click', () => this.openSidePanel());
    }
  }

  async executePinnedCover() {
    if (!this.pinnedCover) return;
    const { category, customLine } = this.pinnedCover;
    if (!category) return;
    const engine = (category.engines || [])[0];
    if (!engine) {
      this.showToast('该风格暂无可用引擎');
      return;
    }
    let purpose = category.purpose || category.label;
    if (category.id === 'custom') {
      if (!customLine) {
        this.showToast('请到侧边栏 ✏️ 填写自定义风格');
        return;
      }
      purpose = customLine;
    }
    await this._ensureKeywordOrFetch();
    const keyword = this.keyword.raw || this.keyword.text;
    const menuItemId = `ccs-cover-${category.id}-${engine.id}`;
    try {
      const result = await this.sendRuntimeAction({
        action: 'executeMenuAction',
        menuItemId,
        menuType: 'cover',
        keyword,
        urlPattern: engine.urlPattern,
        engineId: engine.id,
        purpose,
        categoryId: category.id
      }, { timeoutMs: 5000, retries: 1 });
      if (!result.ok) {
        this.showToast(this.runtimeErrorMessage(result.error));
        return;
      }
      const response = result.data;
      if (response && response.success) {
        window.close();
      } else if (response && response.error === 'no-keyword') {
        this.showToast('没有选中文本或无法提取关键词');
      }
    } catch (error) {
      console.error('[触触搜] 置顶封面启动失败:', error);
      this.showToast('启动失败');
    }
  }

  async handleClick(item) {
    await this._ensureKeywordOrFetch();
    const keyword = this.keyword.raw || this.keyword.text;

    // 发送消息给 background 执行
    try {
      const result = await this.sendRuntimeAction({
        action: 'executeMenuAction',
        menuItemId: item.id,
        menuType: item.type,
        keyword: keyword,
        urlPattern: item.urlPattern,
        actionType: item.action,
        engineId: item.engineId,
        purpose: item.purpose  // 优化提示词需要 purpose 参数
      }, { timeoutMs: 5000, retries: 1 });
      if (!result.ok) {
        this.showToast(this.runtimeErrorMessage(result.error));
        return;
      }
      const response = result.data;

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

  itemFromElement(el) {
    if (!el) return null;
    return {
      id: el.dataset.menuId || '',
      type: el.dataset.menuType || '',
      urlPattern: el.dataset.urlPattern || '',
      action: el.dataset.action || '',
      engineId: el.dataset.engineId || '',
      purpose: el.dataset.purpose || ''
    };
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

    const menuContainer = document.getElementById('menuContainer');
    if (menuContainer && !this._menuDelegationBound) {
      this._menuDelegationBound = true;
      menuContainer.addEventListener('click', (e) => {
        const itemEl = e.target?.closest?.('.menu-item[data-menu-id]');
        if (!itemEl || !menuContainer.contains(itemEl)) return;
        const item = this.itemFromElement(itemEl);
        if (!item?.id) return;
        this.handleClick(item);
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
    const updateLabel = () => {
      btn.textContent = isOpen ? '📕 关闭侧边栏' : '📑 打开侧边栏';
    };

    try {
      const win = await chrome.windows.getCurrent();
      windowId = win.id;
      // v1.6.15 优先：读 background 持久化的 sidepanel 状态（即时）
      const cached = await new Promise((resolve) =>
        chrome.storage.local.get([`ccs_sp_open_${windowId}`], resolve));
      isOpen = !!cached?.[`ccs_sp_open_${windowId}`];
    } catch (_) {
      isOpen = false;
    }
    updateLabel();

    // v1.6.19: SW 校正消息推迟 800ms。先让 popup 完成首屏渲染，再去唤醒
    // SW（商店生产环境 SW 冷启动 ~500ms-2s，跟首屏抢 CPU 是用户报的卡顿
    // 主因）。storage 值 99% 情况下就是对的，校正只在 SW 死过没来得及写
    // 时才有差异。用户点关闭/打开时也会重新拿一次状态做权威判断。
    if (typeof windowId === 'number') {
      const idleSchedule = (fn) => {
        const ric = globalThis.requestIdleCallback;
        if (typeof ric === 'function') ric(fn, { timeout: 1200 });
        else setTimeout(fn, 800);
      };
      idleSchedule(() => {
        this.sendRuntimeAction({ action: 'getSidePanelState', windowId }, {
          timeoutMs: 1200,
          retries: 0
        }).then((result) => {
          if (!result.ok) return;
          const resp = result.data;
          if (resp && !!resp.isOpen !== isOpen) {
            isOpen = !!resp.isOpen;
            updateLabel();
          }
        }).catch(() => {});
      });
    }

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
      await this.sendRuntimeAction({ action: 'closeSidePanel', windowId }, {
        timeoutMs: 1200,
        retries: 0
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

  async showSettings() {
    this.currentMode = 'settings';
    document.getElementById('menuContainer').style.display = 'none';
    document.getElementById('settingsPanel').style.display = 'block';
    document.getElementById('settingsToggle').style.display = 'none';
    // Lazy 初始化设置面板（首次打开扩展不必跑这一坨）
    await this.ensureSettingsInit();
  }

  async ensureSettingsInit() {
    if (this._settingsInitDone) return;
    this._settingsInitDone = true;
    this.initSettings();
  }

  loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-ccs-lazy="${src}"]`);
      if (existing) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.dataset.ccsLazy = src;
      s.onload = () => resolve();
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    });
  }

  async ensurePromptLibrary() {
    if (!this._promptLibraryLoadPromise) {
      this._promptLibraryLoadPromise = this.loadScript('modules/PromptLibraryManager.js')
        .then(() => {
          if (window.CCSPopup && window.CCSPopup.PromptLibraryManager && !this.promptLibraryManager) {
            this.promptLibraryManager = new window.CCSPopup.PromptLibraryManager({
              onToast: (msg) => this.showToast(msg)
            });
            this.promptLibraryManager.init();
          }
        })
        .catch((e) => {
          console.error('[触触搜] 加载提示词库模块失败:', e);
          this._promptLibraryLoadPromise = null;  // 允许重试
          this.showToast('提示词库加载失败');
        });
    }
    return this._promptLibraryLoadPromise;
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
    // 合并多次 storage.get 为一次（原 5 次串行回调改为 1 次）
    chrome.storage.local.get(['enabled', 'ccs_debug', 'ccs_voice_enabled'], (result) => {
      const enabled = result.enabled !== false;
      this.updateToggleButton(enabled);
      this.setDebugButtonState(!!result.ccs_debug);
      this.setVoiceButtonState(!!result.ccs_voice_enabled);
    });

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

    // 提示词库改为 lazy：用户点 "📚 提示词库" 时才加载 PromptLibraryManager.js
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
          listEl.innerHTML = blacklist.map(host => {
            const safe = this._escapeHtml(host);
            return `
            <div class="blacklist-item" data-host="${safe}">
              <span class="blacklist-host">${safe}</span>
              <button class="blacklist-remove" data-host="${safe}">移除</button>
            </div>
          `;
          }).join('');

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

  /**
   * HTML 转义。blacklist host 来自 chrome.storage，渲染前必须过这层
   * （与 PromptLibraryManager._escapeHtml / SettingsManager._escapeHtml 同实现）。
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
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

  async togglePromptLibrarySection() {
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
      // 首次打开提示词库时 lazy 加载 PromptLibraryManager.js
      await this.ensurePromptLibrary();
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
      const result = await this.sendRuntimeAction({
        action: 'getMenuDebugInfo',
        tabId: tab?.id
      }, { timeoutMs: 5000, retries: 0 });
      if (result.ok && result.data && result.data.success) {
        const trace = await globalThis.CCSLogger?.getTraceBuffer?.();
        this.showMenuDebugInfo({
          ...result.data.data,
          runtimeTrace: Array.isArray(trace) ? trace : []
        });
      } else {
        this.showToast('获取菜单状态失败');
      }
      if (btn) {
        btn.disabled = false;
        const label = btn.querySelector('.setting-label');
        label.textContent = '导出菜单状态';
      }
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
