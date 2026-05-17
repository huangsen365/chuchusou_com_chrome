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
  const $menu = document.getElementById('menuContainer');
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
  const $settingsToggle = document.getElementById('settingsToggle');
  const $settingsPanel = document.getElementById('settingsPanel');
  const $backToMenu = document.getElementById('backToMenu');
  const $quick = document.getElementById('quick');
  const $sLabelEnable = document.getElementById('sLabelEnable');
  const $sLabelDebug = document.getElementById('sLabelDebug');
  const $sLabelVoice = document.getElementById('sLabelVoice');
  const $blacklistSection = document.getElementById('blacklistSection');
  const $shortcutSection = document.getElementById('shortcutSection');
  const $promptLibrarySection = document.getElementById('promptLibrarySection');
  const $debugSection = document.getElementById('debugSection');
  const $versionNumber = document.getElementById('versionNumber');

  // ===== 状态 =====
  let currentKw = '';
  let currentTabId = null;
  let currentTabUrl = '';
  let pinnedCategoryId = null;   // null = 没 pin
  let customLine = '';
  let coverConfig = null;        // coverPrompts.json，懒加载，并行 fetch

  // ===== 工具 =====
  // 浮层 toast（与旧 popup 同行为：2s 自动消失）
  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'popup-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // HTML 转义（blacklist host / prompt name 等用户输入渲染前过）
  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  }

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

    // 5. 版本号从 manifest 读
    try {
      const mf = chrome.runtime.getManifest();
      if (mf && mf.version && $versionNumber) {
        $versionNumber.textContent = 'v' + mf.version;
      }
    } catch (_) {}
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

  // ===== Submenu 展开/折叠 =====
  // prebuild-popup-menu.mjs 输出格式：
  //   <div class="menu-item has-children" data-menu-id="X">...</div>
  //   <div class="submenu collapsed" data-parent-id="X">...children...</div>
  function toggleSubmenu(parentEl) {
    const parentId = parentEl.dataset.menuId;
    if (!parentId) return;
    // 自己手转义 quote / backslash 避免 selector 注入（CSS.escape 在 popup 上下文中 ESLint 会标 no-undef）
    const safeId = parentId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const submenu = $menu.querySelector(`.submenu[data-parent-id="${safeId}"]`);
    if (!submenu) return;
    submenu.classList.toggle('collapsed');
    parentEl.classList.toggle('expanded');
  }

  // ===== Settings panel show/hide =====
  // 主面板与 settings 互斥：开 settings → 隐藏 menu/pin/quick；返回菜单 → 反过来
  function showSettings() {
    $menu.hidden = true;
    $pin.dataset._wasShown = $pin.hidden ? '0' : '1';
    $pin.hidden = true;
    $quick.hidden = true;
    $settingsPanel.hidden = false;
    syncSettingLabels();
  }
  function showMenu() {
    $settingsPanel.hidden = true;
    hideAllSubPanels();
    $menu.hidden = false;
    if ($pin.dataset._wasShown === '1') $pin.hidden = false;
    $quick.hidden = false;
  }
  function hideAllSubPanels() {
    $blacklistSection.hidden = true;
    $shortcutSection.hidden = true;
    $promptLibrarySection.hidden = true;
    $debugSection.hidden = true;
  }
  function openSubPanel(target) {
    hideAllSubPanels();
    target.hidden = false;
  }

  // 进入 settings 时刷新 8 个按钮标签状态
  function syncSettingLabels() {
    chrome.storage.local.get(['enabled', 'ccs_debug', 'ccs_voice_enabled'], (r) => {
      $sLabelEnable.textContent = r.enabled === false ? '已停用' : '已启用';
      $sLabelDebug.textContent = r.ccs_debug === true ? '调试日志：开' : '调试日志：关';
      $sLabelVoice.textContent = r.ccs_voice_enabled === true ? '语音功能：开' : '语音功能：关';
    });
  }

  // ===== Settings actions =====
  function actionToggleEnable() {
    chrome.storage.local.get(['enabled'], (r) => {
      const next = r.enabled === false;  // 当前 false 就开，否则关（默认 true → 关）
      chrome.storage.local.set({ enabled: next });
      fireTab(currentTabId, { action: 'toggleExtension', enabled: next });
      renderToggle($qEnable, $qEnableLabel, next, '已启用', '已停用');
      $sLabelEnable.textContent = next ? '已启用' : '已停用';
      showToast(next ? '已启用' : '已停用');
    });
  }

  function actionToggleDebug() {
    chrome.storage.local.get(['ccs_debug'], (r) => {
      const next = !r.ccs_debug;
      chrome.storage.local.set({ ccs_debug: next });
      fireRuntime({ action: 'updateDebug', enabled: next });
      fireTab(currentTabId, { action: 'updateDebug', enabled: next });
      renderToggle($qDebug, $qDebugLabel, next, '调试开', '调试关');
      $sLabelDebug.textContent = next ? '调试日志：开' : '调试日志：关';
      showToast(next ? '调试日志已开启' : '调试日志已关闭');
    });
  }

  function actionToggleVoice() {
    chrome.storage.local.get(['ccs_voice_enabled'], (r) => {
      const next = !r.ccs_voice_enabled;
      chrome.storage.local.set({ ccs_voice_enabled: next });
      $sLabelVoice.textContent = next ? '语音功能：开' : '语音功能：关';
      showToast(next ? '语音功能已开启' : '语音功能已关闭');
    });
  }

  function actionOpenWelcome() {
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') });
      setTimeout(() => window.close(), 30);
    } catch (err) { console.warn('[popup-v2] open welcome 失败:', err); }
  }

  // 黑名单：读 ccs_settings.blacklist 数组，渲染列表，单项移除 / 清空
  function actionBlacklist() {
    openSubPanel($blacklistSection);
    loadBlacklist();
  }
  function loadBlacklist() {
    chrome.storage.local.get(['ccs_settings'], (r) => {
      const settings = r.ccs_settings || {};
      const list = settings.blacklist || [];
      const countEl = $blacklistSection.querySelector('.blacklist-count');
      const listEl = $blacklistSection.querySelector('.blacklist-list');
      if (countEl) countEl.textContent = list.length;
      if (!listEl) return;
      if (list.length === 0) {
        listEl.innerHTML = '<div class="blacklist-empty">黑名单为空</div>';
        return;
      }
      listEl.innerHTML = list.map((host) => {
        const safe = escapeHtml(host);
        return `<div class="blacklist-item" data-host="${safe}">`
          + `<span class="blacklist-host">${safe}</span>`
          + `<button class="blacklist-remove" type="button" data-host="${safe}">移除</button>`
          + `</div>`;
      }).join('');
      listEl.querySelectorAll('.blacklist-remove').forEach((btn) => {
        btn.addEventListener('click', () => removeFromBlacklist(btn.dataset.host));
      });
    });
  }
  function removeFromBlacklist(host) {
    chrome.storage.local.get(['ccs_settings'], (r) => {
      const settings = r.ccs_settings || {};
      settings.blacklist = (settings.blacklist || []).filter((h) => h !== host);
      chrome.storage.local.set({ ccs_settings: settings }, () => {
        loadBlacklist();
        showToast('已恢复');
      });
    });
  }
  function clearAllBlacklist() {
    if (!confirm('确认清空全部黑名单？')) return;
    chrome.storage.local.get(['ccs_settings'], (r) => {
      const settings = r.ccs_settings || {};
      settings.blacklist = [];
      chrome.storage.local.set({ ccs_settings: settings }, () => {
        loadBlacklist();
        showToast('黑名单已清空');
      });
    });
  }

  // 快捷键设置
  function actionShortcutSettings() {
    openSubPanel($shortcutSection);
    chrome.storage.local.get(['ccs_settings'], (r) => {
      const cur = (r.ccs_settings && r.ccs_settings.shortcutKey) || 'Alt+S';
      const sel = $shortcutSection.querySelector('.shortcut-key-select');
      if (sel) sel.value = cur;
    });
  }
  function saveShortcut() {
    const sel = $shortcutSection.querySelector('.shortcut-key-select');
    if (!sel) return;
    const next = sel.value;
    chrome.storage.local.get(['ccs_settings'], (r) => {
      const settings = r.ccs_settings || {};
      settings.shortcutKey = next;
      chrome.storage.local.set({ ccs_settings: settings }, () => {
        showToast('快捷键已更新：' + next);
        // 广播给所有 tab 让 content script shortcuts 模块 update
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach((t) => {
            try { chrome.tabs.sendMessage(t.id, { action: 'updateShortcut', shortcutKey: next }).catch(() => {}); } catch (_) {}
          });
        });
      });
    });
  }

  // 提示词库（PromptLibraryManager lazy load）
  let promptLibraryManager = null;
  let promptLibraryLoadPromise = null;
  function actionPromptLibrary() {
    openSubPanel($promptLibrarySection);
    ensurePromptLibrary().then(() => {
      if (promptLibraryManager) promptLibraryManager.renderList();
    });
  }
  function ensurePromptLibrary() {
    if (promptLibraryManager) return Promise.resolve();
    if (promptLibraryLoadPromise) return promptLibraryLoadPromise;
    promptLibraryLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '../popup/modules/PromptLibraryManager.js';
      s.onload = () => {
        // PromptLibraryManager 类在全局或 window.CCSPopup 暴露（两种导出方式都兼容）
        const Klass = window.PromptLibraryManager
          || (window.CCSPopup && window.CCSPopup.PromptLibraryManager);
        if (!Klass) { reject(new Error('PromptLibraryManager 未注册')); return; }
        promptLibraryManager = new Klass({ onToast: showToast });
        promptLibraryManager.init().then(resolve).catch(reject);
      };
      s.onerror = (e) => { promptLibraryLoadPromise = null; reject(e); };
      document.head.appendChild(s);
    });
    return promptLibraryLoadPromise.catch((err) => {
      console.error('[popup-v2] 加载提示词库失败:', err);
      showToast('提示词库加载失败');
      promptLibraryLoadPromise = null;
    });
  }

  // 导出菜单状态
  async function actionExportMenuState() {
    const btn = $settingsPanel.querySelector('[data-action="export-menu-state"] .setting-label');
    const origLabel = btn ? btn.textContent : '';
    if (btn) btn.textContent = '获取中...';
    try {
      const tab = await queryActiveTab();
      const client = globalThis.CCSRuntimeClient;
      const payload = { action: 'getMenuDebugInfo', tabId: tab?.id };
      let resp = null;
      if (client?.sendRuntimeMessage) {
        const result = await client.sendRuntimeMessage(payload, { timeoutMs: 5000, retries: 0 });
        if (result.ok) resp = result.data;
      } else {
        resp = await new Promise((res) => {
          try { chrome.runtime.sendMessage(payload, (r) => res(r)); }
          catch (_) { res(null); }
        });
      }
      if (resp && resp.success) {
        const trace = await (globalThis.CCSLogger?.getTraceBuffer?.() || Promise.resolve([]));
        const data = { ...resp.data, runtimeTrace: Array.isArray(trace) ? trace : [] };
        showMenuDebugInfo(data);
      } else {
        showToast('获取菜单状态失败');
      }
    } catch (err) {
      console.warn('[popup-v2] export menu state 失败:', err);
      showToast('获取菜单状态失败');
    } finally {
      if (btn) btn.textContent = origLabel || '导出菜单状态';
    }
  }
  function showMenuDebugInfo(data) {
    openSubPanel($debugSection);
    const formatted = JSON.stringify(data, null, 2);
    const textEl = $debugSection.querySelector('.menu-debug-text');
    if (textEl) textEl.textContent = formatted;
    navigator.clipboard?.writeText(formatted).then(() => {
      showToast('菜单状态已复制到剪贴板');
    }).catch(() => {});
    const copyBtn = $debugSection.querySelector('.copy-debug-info');
    const closeBtn = $debugSection.querySelector('.close-debug-info');
    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard?.writeText(formatted)
          .then(() => showToast('已复制到剪贴板'))
          .catch(() => showToast('复制失败'));
      };
    }
    if (closeBtn) closeBtn.onclick = () => { $debugSection.hidden = true; };
  }

  // 8 action 调度表
  const SETTING_ACTIONS = {
    'toggle': actionToggleEnable,
    'debug': actionToggleDebug,
    'voice': actionToggleVoice,
    'open-welcome': actionOpenWelcome,
    'blacklist': actionBlacklist,
    'shortcut-settings': actionShortcutSettings,
    'prompt-library': actionPromptLibrary,
    'export-menu-state': actionExportMenuState
  };

  // ===== 事件绑定 =====
  function bindEvents() {
    // 菜单点击委托：识别 prebuild-popup-menu.mjs 输出的 data-* 字段
    // - has-children 节点：toggle 子菜单展开/折叠
    // - leaf 节点：sendMessage(executeMenuAction) 让 background 处理（与旧 popup 一致）
    //   因为 fastqa/top100/optimize 要拼 prompt，tool 要做剪贴板/编码 —— 都必须经 background
    $menu.addEventListener('click', async (e) => {
      const itemEl = e.target.closest('.menu-item[data-menu-id]');
      if (!itemEl || !$menu.contains(itemEl)) return;

      // 父节点：toggle 子菜单
      if (itemEl.classList.contains('has-children')) {
        toggleSubmenu(itemEl);
        return;
      }

      // Leaf 节点：发消息给 background
      if (!currentKw) { flash('请先选中文字'); return; }
      const item = {
        id: itemEl.dataset.menuId || '',
        type: itemEl.dataset.menuType || '',
        urlPattern: itemEl.dataset.urlPattern || '',
        action: itemEl.dataset.action || '',
        engineId: itemEl.dataset.engineId || '',
        purpose: itemEl.dataset.purpose || ''
      };
      try {
        const payload = {
          action: 'executeMenuAction',
          menuItemId: item.id,
          menuType: item.type,
          keyword: currentKw,
          urlPattern: item.urlPattern,
          actionType: item.action,
          engineId: item.engineId,
          purpose: item.purpose
        };
        // 优先用 CCSRuntimeClient（timeout + retry），fallback 裸 sendMessage
        const client = globalThis.CCSRuntimeClient;
        if (client?.sendRuntimeMessage) {
          const result = await client.sendRuntimeMessage(payload, { timeoutMs: 5000, retries: 1 });
          if (!result.ok) {
            console.warn('[popup-v2] executeMenuAction 失败:', result.error);
            flash('操作失败');
            return;
          }
          const resp = result.data || {};
          if (resp.success) {
            setTimeout(() => window.close(), 30);
          } else if (resp.error === 'no-keyword') {
            flash('没有可用关键字');
          }
        } else {
          chrome.runtime.sendMessage(payload, (resp) => {
            if (resp && resp.success) setTimeout(() => window.close(), 30);
          });
        }
      } catch (err) {
        console.warn('[popup-v2] sendMessage 失败:', err);
        flash('操作失败');
      }
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

    // ===== Settings panel 切换 + 8 个 action dispatcher =====
    $settingsToggle.addEventListener('click', showSettings);
    $backToMenu.addEventListener('click', showMenu);

    $settingsPanel.addEventListener('click', (e) => {
      const btn = e.target.closest('.setting-btn[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const fn = SETTING_ACTIONS[action];
      if (typeof fn === 'function') fn();
    });

    // 子面板内部按钮（clear blacklist / save shortcut 等）—— 委托
    const clearBlacklistBtn = $blacklistSection.querySelector('.clear-blacklist');
    if (clearBlacklistBtn) clearBlacklistBtn.addEventListener('click', clearAllBlacklist);
    const saveShortcutBtn = $shortcutSection.querySelector('.save-shortcut');
    if (saveShortcutBtn) saveShortcutBtn.addEventListener('click', saveShortcut);

    // 监听 storage 同步 settings labels（如别处改了 enabled / ccs_debug / ccs_voice_enabled）
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if ('enabled' in changes || 'ccs_debug' in changes || 'ccs_voice_enabled' in changes) {
          if (!$settingsPanel.hidden) syncSettingLabels();
        }
      });
    } catch (_) {}

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
