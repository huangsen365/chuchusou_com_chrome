/* sidepanel-v2/sidepanel.js —— 全新极简 sidepanel
 *
 * 设计原则（与 popup-v2 一致）：
 * - 首帧 0 sendMessage（菜单 HTML prebuild 注入；关键字 storage instant + fresh 并发）
 * - 0 React / 0 Plasmo bundle / 纯 vanilla JS
 * - 复用 shared/{keywordClient, runtimeClient, logger}
 * - Voice 模块 lazy load（batch 4 实现）
 * - 封面 picker（batch 2 实现）
 * - alive port + tab listener（batch 5）
 *
 * 本批次（batch 1）：基础骨架 + 关键字 fallback chain + 复制 + 剪贴板按钮
 */
(() => {
  'use strict';

  // ===== 常量 =====
  const TTL_MS = 5 * 60 * 1000;
  const KW_PREFIX = 'ccs_kw_';
  const TAB_REFRESH_DEBOUNCE_MS = 50;

  // ===== DOM refs =====
  const $kw = document.getElementById('spKeyword');
  const $kwCopy = document.getElementById('spKeywordCopy');
  // 留作 batch 4 voice 模块用，目前 lint 容许 _ 前缀的 unused 标识
  const _$kwVoice = document.getElementById('spKeywordVoice');
  void _$kwVoice;
  const $clipboardBtn = document.getElementById('spClipboardBtn');
  const $tipWarn = document.getElementById('spPinTipWarn');
  const $tipPopover = document.getElementById('spPinTipPopover');
  const $tipClose = document.getElementById('spPinTipClose');
  const $menu = document.getElementById('spMenu');

  // ===== 状态 =====
  let currentKw = '';
  let currentTabId = null;
  let currentTabUrl = '';
  let refreshTimer = null;

  // ===== 工具 =====
  function showToast(message) {
    const t = document.createElement('div');
    t.className = 'sp-toast';
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => {
      t.classList.add('fade-out');
      setTimeout(() => t.remove(), 300);
    }, 2000);
  }

  function setKeyword(s) {
    currentKw = (s || '').trim();
    if (currentKw) {
      $kw.textContent = currentKw.length > 20 ? currentKw.slice(0, 20) + '…' : currentKw;
      $kw.title = currentKw;
      $kw.removeAttribute('data-empty');
      $kwCopy.hidden = false;
      $clipboardBtn.hidden = true;
    } else {
      $kw.textContent = '';
      $kw.title = '';
      $kw.setAttribute('data-empty', '1');
      $kwCopy.hidden = true;
      // 关键字空时显示剪贴板兜底按钮
      $clipboardBtn.hidden = false;
    }
    // 通知后续 batch（cover / voice）状态变化
    document.dispatchEvent(new CustomEvent('sp-keyword-change', { detail: { keyword: currentKw } }));
  }

  // 拿 active tab（用 CCSKeywordClient 的 3 段 fallback）
  async function queryActiveTab() {
    if (globalThis.CCSKeywordClient?.getActiveTab) {
      return await globalThis.CCSKeywordClient.getActiveTab();
    }
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs && tabs[0] || null;
    } catch (_) { return null; }
  }

  // 关键字加载：与 popup-v2 同 pattern
  // - storage instant + sendMessage fresh 并发
  // - storage 命中先渲染（onInstant），fresh 回来覆盖
  async function loadKeyword(tab) {
    if (!tab || tab.id == null) return;
    currentTabId = tab.id;
    currentTabUrl = tab.url || '';

    if (globalThis.CCSKeywordClient) {
      globalThis.CCSKeywordClient.requestKeyword('sidepanel-init', {
        tab,
        instantFromStorage: true,
        onInstant: (cached) => {
          if (!currentKw && cached?.text) setKeyword(cached.text);
        }
      }).then((fresh) => {
        if (fresh?.text) setKeyword(fresh.text);
      }).catch((err) => {
        console.warn('[sp-v2] requestKeyword 失败:', err);
      });
    } else {
      // 极端 fallback：直接 storage 读
      try {
        const key = KW_PREFIX + tab.id;
        const d = await chrome.storage.local.get([key]);
        const e = d && d[key];
        if (e && typeof e === 'object'
            && Date.now() - (e.ts || 0) <= TTL_MS
            && (!currentTabUrl || !e.url || e.url === currentTabUrl)) {
          setKeyword(e.text || e.raw || '');
        }
      } catch (_) {}
    }
  }

  // 切标签 / URL 变化 / 标题变化 → 50ms debounce 刷新
  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      const tab = await queryActiveTab();
      if (tab && tab.id !== currentTabId) {
        // 切标签了：清当前关键字，再加载新 tab
        setKeyword('');
      }
      await loadKeyword(tab);
    }, TAB_REFRESH_DEBOUNCE_MS);
  }

  // ===== 事件绑定 =====
  function bindEvents() {
    // 复制关键字
    $kwCopy.addEventListener('click', async () => {
      if (!currentKw) return;
      try {
        await navigator.clipboard.writeText(currentKw);
        const o = $kwCopy.textContent;
        $kwCopy.textContent = '✓';
        setTimeout(() => { $kwCopy.textContent = o; }, 800);
      } catch (_) { showToast('复制失败'); }
    });

    // 剪贴板兜底：读 navigator.clipboard.readText → 写 storage → 触发刷新
    $clipboardBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        const cleaned = (text || '').trim();
        if (!cleaned) { showToast('剪贴板为空'); return; }
        // 上限对齐 AI 引擎硬上限（与旧 sidepanel 一致）
        const limited = cleaned.slice(0, 6000);
        setKeyword(limited);
        // 同步写 storage 让其它路径也能拿到（popup 等）
        if (currentTabId != null) {
          const payload = { text: limited, raw: limited, url: currentTabUrl || '', ts: Date.now() };
          try { await chrome.storage.local.set({ [KW_PREFIX + currentTabId]: payload }); } catch (_) {}
        }
      } catch (err) {
        console.warn('[sp-v2] 剪贴板读取失败:', err);
        showToast('剪贴板读取失败');
      }
    });

    // AI 提示 popover toggle（点 ⚠️ 切换显隐 + 外部点击关闭 + ESC 关闭）
    if ($tipWarn) {
      $tipWarn.addEventListener('click', (e) => {
        e.stopPropagation();
        $tipPopover.hidden = !$tipPopover.hidden;
      });
    }
    if ($tipClose) {
      $tipClose.addEventListener('click', () => { $tipPopover.hidden = true; });
    }
    document.addEventListener('click', (e) => {
      if (!$tipPopover.hidden && !$tipPopover.contains(e.target) && e.target !== $tipWarn) {
        $tipPopover.hidden = true;
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$tipPopover.hidden) $tipPopover.hidden = true;
    });

    // storage onChanged 实时刷新关键字
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

    // tab onActivated / onUpdated（debounce 50ms 刷新）
    try {
      chrome.tabs.onActivated.addListener(() => scheduleRefresh());
      chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
        if (tab && tab.active && (info.url || info.title || info.status === 'complete')) {
          scheduleRefresh();
        }
      });
    } catch (_) {}

    // 菜单 click 委托：与 popup-v2 同套路 —— 统一发 executeMenuAction 让 background 处理
    $menu.addEventListener('click', async (e) => {
      const itemEl = e.target.closest('.sp-menu-item[data-menu-id]');
      if (!itemEl || !$menu.contains(itemEl)) return;
      if (!currentKw) { showToast('请先选中文字'); return; }
      const item = {
        id: itemEl.dataset.menuId || '',
        type: itemEl.dataset.menuType || '',
        urlPattern: itemEl.dataset.urlPattern || '',
        action: itemEl.dataset.action || '',
        engineId: itemEl.dataset.engineId || '',
        purpose: itemEl.dataset.purpose || ''
      };
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
      try {
        const client = globalThis.CCSRuntimeClient;
        if (client?.sendRuntimeMessage) {
          const result = await client.sendRuntimeMessage(payload, { timeoutMs: 5000, retries: 1 });
          if (!result.ok) { showToast('操作失败'); return; }
          const resp = result.data || {};
          if (resp.success) {
            // sidepanel 不 window.close()，让用户继续操作
          } else if (resp.error === 'no-keyword') {
            showToast('没有可用关键字');
          }
        } else {
          chrome.runtime.sendMessage(payload).catch(() => {});
        }
      } catch (err) {
        console.warn('[sp-v2] executeMenuAction 失败:', err);
        showToast('操作失败');
      }
    });

    // background push keywordUpdated（即时回包）
    try {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        try {
          if (!message || typeof message !== 'object') return false;
          if (message.action === 'keywordUpdated' && message.keyword) {
            setKeyword(message.keyword.text || message.keyword.raw || '');
            return false;
          }
        } catch (err) { console.warn('[sp-v2] onMessage 错误:', err); }
        return false;
      });
    } catch (_) {}
  }

  // ===== 启动 =====
  bindEvents();
  queryActiveTab().then(loadKeyword);
})();
