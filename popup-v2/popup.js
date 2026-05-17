/* popup-v2/popup.js —— 全新极简 popup
 *
 * 关键路径设计（不变）：
 * - 首帧 0 sendMessage（菜单写死 HTML，关键字直接读 storage）
 * - 0 阻塞依赖（pin / toggle 状态都来自 storage 并行读）
 *
 * 业务模块：
 * - keyword 显示 + 复制
 * - 封面生成器快捷启动（用户在侧边栏 pin 过才显示）—— 点了 sendMessage 给 background
 * - 8 项核心菜单 —— 点了直接 chrome.tabs.create
 * - 启用/调试 inline toggle —— storage set + best-effort 通知 content/background
 * - 打开侧边栏 —— chrome.sidePanel.open
 *
 * 数据接口（与 background / sidepanel 已有约定一致）：
 *   ccs_kw_${tabId}                     = {text, raw, url, ts}   TTL 5min, URL strict
 *   ccs_sidepanel_pinned_action         = {taskId, categoryId}
 *   ccs_cover_aspect_ratio              = '5:2' / ...
 *   ccs_cover_custom_selected_line      = '...' (categoryId='custom' 时用)
 *   enabled                             = bool   扩展启用开关
 *   ccs_debug                           = bool   调试日志开关
 *   prompts/coverPrompts.json           本地配置（categories[].id/.label/.engines[]/.purpose）
 */
(() => {
  'use strict';

  // ===== 常量 =====
  const TTL_MS = 5 * 60 * 1000;
  const KW_PREFIX = 'ccs_kw_';
  const URL_HARD_CAP = 1900;
  const STORAGE_KEYS = [
    'ccs_sidepanel_pinned_action',
    'ccs_cover_aspect_ratio',
    'ccs_cover_custom_selected_line',
    'enabled',
    'ccs_debug'
  ];

  // ===== DOM refs =====
  const $kw = document.getElementById('kw');
  const $copy = document.getElementById('copy');
  const $menu = document.getElementById('menu');
  const $pin = document.getElementById('pin');
  const $pinBtn = document.getElementById('pinBtn');
  const $pinEdit = document.getElementById('pinEdit');
  const $pinStyle = document.getElementById('pinStyle');
  const $pinRatio = document.getElementById('pinRatio');
  const $qEnable = document.getElementById('qEnable');
  const $qDebug = document.getElementById('qDebug');
  const $qEnableLabel = document.getElementById('qEnableLabel');
  const $qDebugLabel = document.getElementById('qDebugLabel');
  const $openSP = document.getElementById('openSP');

  // ===== 状态 =====
  let currentKw = '';
  let currentTabId = null;
  let currentTabUrl = '';
  let pinnedCategoryId = null;   // null = 没 pin
  let customLine = '';
  let coverConfig = null;        // coverPrompts.json，懒加载，并行 fetch

  // ===== 工具 =====
  function setKeyword(s) {
    currentKw = (s || '').trim();
    if (currentKw) {
      $kw.textContent = currentKw;
      $kw.title = currentKw;
      $kw.removeAttribute('data-empty');
      $copy.hidden = false;
    } else {
      $kw.textContent = '';
      $kw.title = '';
      $kw.setAttribute('data-empty', '1');
      $copy.hidden = true;
    }
  }

  function flash(msg) {
    const saved = currentKw;
    $kw.textContent = msg;
    $kw.setAttribute('data-empty', '1');
    setTimeout(() => { setKeyword(saved); }, 1200);
  }

  // 拿当前标签 id + url
  async function queryActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return (tabs && tabs[0]) || null;
  }

  // 打开侧边栏：优先 windowId (无异步依赖，保 user gesture)，失败再 fallback tabId
  // 必须在 click handler 同步链路内调，否则 user activation 会失效（Chrome MV3 要求）
  async function openSidePanel() {
    if (!chrome.sidePanel || !chrome.sidePanel.open) {
      flash('浏览器不支持侧边栏');
      return;
    }
    try {
      await chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
      setTimeout(() => window.close(), 30);
      return;
    } catch (err) {
      // 个别窗口场景 windowId 路径会拒绝，fallback 试 tabId
      console.warn('[popup-v2] sidePanel.open by windowId 失败:', err);
    }
    try {
      if (currentTabId != null) {
        await chrome.sidePanel.open({ tabId: currentTabId });
        setTimeout(() => window.close(), 30);
      }
    } catch (err) {
      console.warn('[popup-v2] sidePanel.open by tabId 失败:', err);
    }
  }

  // 静默 sendMessage：用于通知 content script / background，失败不抛
  function fireRuntime(payload) {
    try { chrome.runtime.sendMessage(payload).catch(() => {}); } catch (_) {}
  }
  function fireTab(tabId, payload) {
    if (tabId == null) return;
    try { chrome.tabs.sendMessage(tabId, payload).catch(() => {}); } catch (_) {}
  }

  // ===== 启动：并行读 storage + 找 tab + fetch coverPrompts.json + 获取关键字 =====
  async function bootstrap() {
    // 1. tab 查询 + storage 批读 + coverPrompts 并行
    let tab = null;
    let store = {};
    let cover = null;
    try {
      [tab, store, cover] = await Promise.all([
        // 用 keywordClient 提供的 3 段 fallback active tab 查询（不是裸的 chrome.tabs.query）
        globalThis.CCSKeywordClient?.getActiveTab?.() || queryActiveTab(),
        chrome.storage.local.get(STORAGE_KEYS),
        fetch('../prompts/coverPrompts.json').then(r => r.ok ? r.json() : null).catch(() => null)
      ]);
    } catch (err) {
      console.warn('[popup-v2] bootstrap 并行加载失败:', err);
    }

    // 2. 关键字获取 —— 完整 fallback chain（与旧 popup 一致）：
    //    a) storage 缓存命中 → 立刻渲染（首帧不等任何 IO）
    //    b) 同时给 background 发 getKeyword 拿 fresh 值（背靠 KeywordService 多源融合：
    //       selectedTextByTab / fallbackKeywordByTab / latestTitleByTab / 标题剥后缀 / heuristic ...）
    //    c) fresh 回来覆盖 instant
    //    d) onChanged 监听 storage 实时更新
    if (tab && tab.id != null) {
      currentTabId = tab.id;
      currentTabUrl = tab.url || '';

      if (globalThis.CCSKeywordClient) {
        // 用 shared/keywordClient.js 的标准 pattern：instantFromStorage + 并发 sendMessage
        globalThis.CCSKeywordClient.requestKeyword('popup-open', {
          tab,
          instantFromStorage: true,
          onInstant: (cached) => {
            // storage 命中：用户体感"零等待"出关键字
            if (!currentKw && cached?.text) setKeyword(cached.text);
          }
        }).then((fresh) => {
          // fresh 值回来：可能比 instant 更新（background 重算 selectedText / 标题等）
          if (fresh?.text) setKeyword(fresh.text);
        }).catch((err) => {
          console.warn('[popup-v2] requestKeyword 失败:', err);
        });
      } else {
        // 极端 fallback：keywordClient 没加载（不应发生）→ 直接读 storage
        try {
          const kwKey = KW_PREFIX + tab.id;
          const d = await chrome.storage.local.get([kwKey]);
          const entry = d && d[kwKey];
          if (entry && typeof entry === 'object'
              && Date.now() - (entry.ts || 0) <= TTL_MS
              && (!currentTabUrl || !entry.url || entry.url === currentTabUrl)) {
            setKeyword(entry.text || entry.raw || '');
          }
        } catch (_) {}
      }
    }

    // 3. Pin 渲染
    coverConfig = cover;
    customLine = (store['ccs_cover_custom_selected_line'] || '').trim();
    renderPin(store['ccs_sidepanel_pinned_action'], store['ccs_cover_aspect_ratio']);

    // 4. Toggle 状态：enabled 默认 true，ccs_debug 默认 false
    renderToggle($qEnable, $qEnableLabel, store['enabled'] !== false, '已启用', '已停用');
    renderToggle($qDebug, $qDebugLabel, store['ccs_debug'] === true, '调试开', '调试关');
  }

  // ===== Pin 渲染 =====
  function renderPin(pin, ratio) {
    if (!pin || pin.taskId !== 'cover' || !pin.categoryId || !coverConfig) {
      $pin.hidden = true;
      return;
    }
    const cat = (coverConfig.categories || []).find(c => c.id === pin.categoryId);
    if (!cat || !cat.engines || !cat.engines[0]) {
      $pin.hidden = true;
      return;
    }
    pinnedCategoryId = cat.id;
    // 自定义 + 用户输入了一行 → 显示用户那行；否则显示分类名
    const styleText = (cat.id === 'custom' && customLine) ? customLine : (cat.label || cat.id);
    $pinStyle.textContent = styleText;
    $pinStyle.title = styleText;
    $pinRatio.textContent = ratio || '5:2';
    $pin.hidden = false;
  }

  // ===== Toggle 渲染 =====
  function renderToggle(btn, labelEl, active, onText, offText) {
    btn.setAttribute('data-active', active ? '1' : '0');
    labelEl.textContent = active ? onText : offText;
  }

  // ===== 事件绑定 =====
  function bindEvents() {
    // 菜单点击
    $menu.addEventListener('click', (e) => {
      const item = e.target.closest('.item');
      if (!item) return;
      if (!currentKw) { flash('请先选中文字'); return; }
      let url = item.dataset.tpl || '';
      if (!url) return;
      url = url.replace('${KW}', encodeURIComponent(currentKw));
      if (url.length > URL_HARD_CAP) url = url.slice(0, URL_HARD_CAP);
      try {
        chrome.tabs.create({ url });
        setTimeout(() => window.close(), 30);
      } catch (err) { console.warn('[popup-v2] tabs.create:', err); }
    });

    // 复制
    $copy.addEventListener('click', async () => {
      if (!currentKw) return;
      try {
        await navigator.clipboard.writeText(currentKw);
        const o = $copy.textContent;
        $copy.textContent = '✓';
        setTimeout(() => { $copy.textContent = o; }, 800);
      } catch (_) {}
    });

    // 封面生成器
    $pinBtn.addEventListener('click', async () => {
      if (!currentKw) { flash('请先选中文字'); return; }
      if (!pinnedCategoryId || !coverConfig) return;
      const cat = coverConfig.categories.find(c => c.id === pinnedCategoryId);
      if (!cat || !cat.engines || !cat.engines[0]) return;
      const engine = cat.engines[0];
      const purpose = (cat.id === 'custom' && customLine) ? customLine : (cat.purpose || '');
      try {
        await chrome.runtime.sendMessage({
          action: 'executeMenuAction',
          menuItemId: `ccs-cover-${cat.id}-${engine.id}`,
          menuType: 'cover',
          keyword: currentKw,
          urlPattern: engine.urlPattern || '',
          engineId: engine.id,
          purpose
        });
      } catch (err) {
        console.warn('[popup-v2] cover executeMenuAction 失败:', err);
      }
      setTimeout(() => window.close(), 30);
    });

    // 改风格 / 比例 → 跳侧边栏
    $pinEdit.addEventListener('click', () => { openSidePanel(); });

    // 启用 toggle
    $qEnable.addEventListener('click', () => {
      const next = $qEnable.getAttribute('data-active') !== '1';
      renderToggle($qEnable, $qEnableLabel, next, '已启用', '已停用');
      chrome.storage.local.set({ enabled: next }).catch(() => {});
      // 通知当前 tab content script（best effort）
      fireTab(currentTabId, { action: 'toggleExtension', enabled: next });
    });

    // 调试 toggle
    $qDebug.addEventListener('click', () => {
      const next = $qDebug.getAttribute('data-active') !== '1';
      renderToggle($qDebug, $qDebugLabel, next, '调试开', '调试关');
      chrome.storage.local.set({ ccs_debug: next }).catch(() => {});
      fireRuntime({ action: 'updateDebug', enabled: next });
      fireTab(currentTabId, { action: 'updateDebug', enabled: next });
    });

    // 打开侧边栏
    $openSP.addEventListener('click', () => { openSidePanel(); });

    // 监听 storage 实时更新关键字（同 tab 内 background 写入立即反映）
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || currentTabId == null) return;
        const myKey = KW_PREFIX + currentTabId;
        if (!Object.prototype.hasOwnProperty.call(changes, myKey)) return;
        const v = changes[myKey].newValue;
        if (!v || typeof v !== 'object') { setKeyword(''); return; }
        if (Date.now() - (v.ts || 0) > TTL_MS) return;
        if (currentTabUrl && v.url && v.url !== currentTabUrl) return;
        setKeyword(v.text || v.raw || '');
      });
    } catch (_) {}
  }

  // ===== 启动 =====
  bindEvents();
  bootstrap();
})();
