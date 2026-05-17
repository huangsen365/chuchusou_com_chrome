/**
 * 触触搜 Popup - 菜单式UI
 * 点击扩展icon时显示与右键菜单相同的层级菜单
 *
 * 启动路径（v1.6.14 起）：
 *   1. popup.html 静态 shimmer 骨架先出（~20ms）
 *   2. init() 并行 fetch 同源 JSON（config + 4 个 prompts + engines）+ 1 次 storage.get
 *   3. CCSMenuStructureBuilder.build() 纯函数构造菜单
 *   4. render() 一次性 DOM 切换
 *   完全脱离 background SW 冷启动 —— 首屏 TTFB 目标 < 150ms
 */

class PopupMenuRenderer {
  constructor() {
    this.config = null;
    this.keyword = { text: '', raw: '' };
    this.menuToggleConfig = null;
    this.currentMode = 'menu'; // 'menu' or 'settings'
    this.promptLibraryManager = null;
    this._settingsInitDone = false;
    this._promptLibraryLoadPromise = null;
  }

  async init() {
    const T0 = performance.now();
    const trace = { t0: T0, phases: [] };
    const mark = (label) => trace.phases.push({ label, ms: +(performance.now() - T0).toFixed(1) });
    performance.mark('ccs-popup-start');
    let renderSource = 'unknown';
    try {
      this.loadVersion();
      this.bindEvents();
      mark('bind');
      this.startKeywordLoad();
      this._preloadEnableState();
      mark('preload');

      // v1.6.19 Step 9：编译期已经把完整菜单 HTML 注入到 build/popup.html
      // 的 menuContainer（data-static-built="true"）。生产环境直接命中 ——
      // 不需要 fetch / 不需要 DOM 构建 / 不需要 JS render()。
      const container = document.getElementById('menuContainer');
      const staticBuilt = container?.dataset?.staticBuilt === 'true';
      let menuStructure = null;
      if (staticBuilt) {
        renderSource = 'static-html';
        // 仍 fetch prebuilt JSON 是为了拿 coverConfig 给 initPinnedCover（极少量额外开销）
        await this._tryReadPrebuilt();
      } else {
        // dev / fallback 路径
        menuStructure = await this._tryReadPrebuilt();
        if (menuStructure) {
          renderSource = 'prebuilt-json';
        } else {
          menuStructure = await this._buildMenuFromFetch();
          renderSource = 'local-fetch';
        }
      }
      mark('menu-fetched');
      // pinned cover 在 prebuilt 之后起，复用同一份 coverConfig 避免重复 fetch
      this.initPinnedCover();

      if (staticBuilt) {
        // 关键字徽章独立刷一次（不动 menu DOM）
        this._renderKeyword();
      } else {
        if (!menuStructure) throw new Error('菜单结构构建失败');
        this.config = menuStructure;
        this.render();
      }
      mark('rendered');
      performance.mark('ccs-popup-rendered');
      try {
        performance.measure('ccs-popup-ttfb', 'ccs-popup-start', 'ccs-popup-rendered');
        const m = performance.getEntriesByName('ccs-popup-ttfb')[0];
        if (m) console.log(`[触触搜][PERF] popup TTFB: ${m.duration.toFixed(1)}ms (${renderSource})`);
      } catch (_) { /* perf 失败无所谓 */ }
      trace.source = renderSource;
      trace.ttfb = +(performance.now() - T0).toFixed(1);
      this._dumpPerfTrace(trace);
    } catch (error) {
      console.error('[触触搜] Popup 初始化失败:', error);
      this.showError('加载失败，请重试');
      return;
    }

    // 后台增强（不阻塞首屏）
    // 设置面板按需 lazy load —— 用户点 ⚙️ 时才跑 initSettings()。
    // 但启用/禁用状态影响底部按钮配色，仍轻量预读一次。
  }

  // v1.6.19 Step 8：生产诊断 trace。每次 popup 打开把分阶段耗时写 storage，
  // 保留最近 20 次记录。用户报"卡顿"时可在设置面板→导出菜单状态拿到这些
  // 数据反馈给开发者真实生产 TTFB。零控制台噪音（仅 debug 模式打印）。
  _dumpPerfTrace(trace) {
    try {
      chrome.storage.local.get(['ccs_popup_perf_trace', 'ccs_debug'], (r) => {
        const arr = Array.isArray(r?.ccs_popup_perf_trace) ? r.ccs_popup_perf_trace : [];
        arr.push({ ts: Date.now(), ...trace });
        // 保留最近 20 条
        const trimmed = arr.slice(-20);
        chrome.storage.local.set({ ccs_popup_perf_trace: trimmed });
        if (r?.ccs_debug) {
          console.log('[触触搜][PERF-TRACE]', JSON.stringify(trace));
        }
      });
    } catch (_) { /* storage 异常也无所谓 */ }
  }

  // v1.6.19 优先路径：编译期预生成的菜单结构 JSON（1 个 fetch）
  async _tryReadPrebuilt() {
    try {
      const data = await this.fetchJSON('popup/popup-menu-prebuilt.json');
      if (!data) return null;
      const currentVersion = chrome.runtime.getManifest()?.version;
      // 版本不一致就放弃（避免商店升级后旧 prebuilt 还在 / cache 错位）
      if (data.version && currentVersion && data.version !== currentVersion) return null;
      const s = data.structure;
      if (!s || !Array.isArray(s.groups) || s.groups.length === 0) return null;
      // v1.6.19 Step 6：cover 也内联了，缓存给 initPinnedCover 共享
      if (data.coverConfig) this._cachedCoverConfig = data.coverConfig;
      return s;
    } catch (_) {
      return null;
    }
  }

  // Fallback：6 个同源 fetch + builder（不依赖 SW）
  async _buildMenuFromFetch() {
    const [unifiedConfig, top100, fastqa, optimize, cover, engines] = await Promise.all([
      this.fetchJSON('config/unifiedMenuConfig.json'),
      this.fetchJSON('prompts/topQuestionsPrompts.json'),
      this.fetchJSON('prompts/fastAnswersPrompts.json'),
      this.fetchJSON('prompts/optimizedPrompts.json'),
      this.fetchJSON('prompts/coverPrompts.json'),
      this.fetchJSON('config/engines.json')
    ]);
    if (!unifiedConfig) return null;
    if (cover) this._cachedCoverConfig = cover;  // initPinnedCover 复用，避免重复 fetch
    return CCSMenuStructureBuilder.build({
      unifiedConfig,
      enginesConfig: engines,
      top100Config: top100,
      fastqaConfig: fastqa,
      optimizeConfig: optimize,
      coverConfig: cover
    });
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
        CCSKeywordClient.requestKeyword(CCSKeywordClient.INTENTS.POPUP_OPEN),
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
  async refreshKeyword() {
    const fresh = await CCSKeywordClient.requestKeyword(CCSKeywordClient.INTENTS.POPUP_OPEN);
    this.keyword = fresh;
    this._renderKeyword();
    return fresh;
  }

  // isMenuEnabled: background 已经过滤了禁用的菜单项，这里始终返回 true
  isMenuEnabled(menuId) {
    return true;
  }

  // 仅刷新关键字徽章那一块，不重建菜单 DOM（避免丢交互态）。
  // 供 init() 在 fresh 关键字到来后单独触发，避免整页 re-render。
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

  render() {
    const container = document.getElementById('menuContainer');

    // 关键字徽章：与菜单容器独立，先刷
    this._renderKeyword();

    // v1.6.19 Step 9：静态菜单已注入，跳过 JS 重建（保留 HTML 中的完整菜单）
    if (container?.dataset?.staticBuilt === 'true') return;

    // dev / fallback 路径：先构建 DocumentFragment 完整 DOM，最后 replaceChildren 原子 swap
    if (!this.config || !this.config.groups) {
      container.replaceChildren(this._renderEmptyState());
      return;
    }

    const fragment = document.createDocumentFragment();
    this.config.groups.forEach((group, index) => {
      if (group.id === 'panel') return;
      if (group.separator === 'before' && index > 0) {
        fragment.appendChild(this.createSeparator());
      }
      this.renderGroup(fragment, group);
      if (group.separator === 'after') {
        fragment.appendChild(this.createSeparator());
      }
    });

    // 原子替换：静态骨架与完整菜单之间不存在"空白"中间态
    container.replaceChildren(fragment);
  }

  _renderEmptyState() {
    const div = document.createElement('div');
    div.className = 'menu-empty';
    div.textContent = '无菜单配置';
    return div;
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
    // v1.6.19 Step 6：优先用 _tryReadPrebuilt 缓存的 coverConfig（已在主 fetch 里拿过）
    if (this._cachedCoverConfig) return this._cachedCoverConfig;
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
      const response = await chrome.runtime.sendMessage({
        action: 'executeMenuAction',
        menuItemId,
        menuType: 'cover',
        keyword,
        urlPattern: engine.urlPattern,
        engineId: engine.id,
        purpose,
        categoryId: category.id
      });
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
        try {
          chrome.runtime.sendMessage({ action: 'getSidePanelState', windowId }, (resp) => {
            if (chrome.runtime.lastError) return;
            if (resp && !!resp.isOpen !== isOpen) {
              isOpen = !!resp.isOpen;
              updateLabel();
            }
          });
        } catch (_) { /* ignore */ }
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
      // v1.6.19 Step 8：附带本地 popup perf trace（最近 20 次启动耗时）
      const perfTrace = await new Promise((resolve) => {
        try {
          chrome.storage.local.get(['ccs_popup_perf_trace'], (r) => resolve(r?.ccs_popup_perf_trace || []));
        } catch (_) { resolve([]); }
      });

      chrome.runtime.sendMessage({
        action: 'getMenuDebugInfo',
        tabId: tab?.id
      }, (response) => {
        if (response && response.success) {
          const enriched = { ...response.data, _popupPerfTrace: perfTrace };
          this.showMenuDebugInfo(enriched);
        } else {
          // 即使 SW 没响应，也把 perf trace 显示出来（用户报卡顿时这是关键证据）
          if (perfTrace.length > 0) {
            this.showMenuDebugInfo({ _popupPerfTrace: perfTrace, _swUnreachable: true });
          } else {
            this.showToast('获取菜单状态失败');
          }
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
