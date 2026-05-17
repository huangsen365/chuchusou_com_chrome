/**
 * Tiny popup bootstrap.
 *
 * Keep this file small: Chrome on some Windows machines delays extension script
 * execution before our code starts. The full popup bundle is loaded after first
 * paint so the static menu can appear immediately.
 */
(function () {
  'use strict';

  const FULL_SCRIPT = chrome.runtime.getURL('popup/popup.bundle.js');
  const KEYWORD_TTL_MS = 5 * 60 * 1000;
  const SIMPLE_URL_TYPES = new Set(['search', 'ai-chat', 'ai-search', 'ecommerce', 'translate', 'portal']);
  const state = {
    activeTab: null,
    destroyed: false,
    fullPromise: null,
    intent: '',
    keyword: { text: '', raw: '' },
    listeners: [],
    storageListener: null
  };

  mark('ccs-popup-boot-start');

  function mark(name) {
    try { performance.mark(name); } catch (_) { /* ignore */ }
  }

  function on(target, event, handler, options) {
    if (!target || !target.addEventListener) return;
    target.addEventListener(event, handler, options);
    state.listeners.push(() => target.removeEventListener(event, handler, options));
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      on(document, 'DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function teardown() {
    state.destroyed = true;
    while (state.listeners.length) {
      try { state.listeners.pop()(); } catch (_) { /* ignore */ }
    }
    if (state.storageListener) {
      try { chrome.storage.onChanged.removeListener(state.storageListener); } catch (_) { /* ignore */ }
      state.storageListener = null;
    }
    mark('ccs-popup-boot-teardown');
  }

  function consumeIntent() {
    const intent = state.intent;
    state.intent = '';
    return intent;
  }

  function loadFull(reason) {
    if (state.fullPromise) return state.fullPromise;
    mark(`ccs-popup-full-load-start:${reason || 'idle'}`);
    state.fullPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${FULL_SCRIPT}"]`);
      if (existing) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = FULL_SCRIPT;
      script.async = true;
      script.dataset.ccsFullPopup = 'true';
      script.onload = () => {
        mark('ccs-popup-full-load-end');
        resolve();
      };
      script.onerror = () => reject(new Error('popup full bundle load failed'));
      document.head.appendChild(script);
    }).catch((error) => {
      state.fullPromise = null;
      showToast('完整功能加载失败，请重开 popup');
      throw error;
    });
    return state.fullPromise;
  }

  function scheduleFullLoad() {
    const afterLoad = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const ric = window.requestIdleCallback;
          if (typeof ric === 'function') {
            ric(() => { loadFull('idle').catch(() => {}); }, { timeout: 1600 });
          } else {
            setTimeout(() => { loadFull('idle').catch(() => {}); }, 600);
          }
        });
      });
    };
    if (document.readyState === 'complete') afterLoad();
    else on(window, 'load', afterLoad, { once: true });
  }

  function getActiveTab() {
    return new Promise((resolve) => {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          resolve(tabs && tabs[0] ? tabs[0] : null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function readKeywordCache(tab) {
    if (!tab?.id) return Promise.resolve(null);
    const key = `ccs_kw_${tab.id}`;
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([key], (data) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          const entry = data?.[key];
          if (!entry || typeof entry !== 'object') { resolve(null); return; }
          if (Date.now() - (entry.ts || 0) > KEYWORD_TTL_MS) { resolve(null); return; }
          if (tab.url && entry.url && entry.url !== tab.url) { resolve(null); return; }
          resolve({ text: entry.text || '', raw: entry.raw || entry.text || '' });
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function sendRuntime(message, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve({ ok: false, error: 'timeout' });
      }, timeoutMs || 1500);
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message || 'runtime-error' });
          } else {
            resolve({ ok: true, data: response || {} });
          }
        });
      } catch (error) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ ok: false, error: error?.message || String(error) });
      }
    });
  }

  function setKeyword(keyword) {
    state.keyword = {
      text: keyword?.text || '',
      raw: keyword?.raw || keyword?.text || ''
    };
    renderKeyword();
  }

  function formatKeyword(text) {
    const compact = String(text || '').replace(/\s+/g, ' ').trim();
    return compact.length > 15 ? `${compact.slice(0, 15)}...` : compact;
  }

  function renderKeyword() {
    const keywordEl = document.getElementById('currentKeyword');
    if (!keywordEl) return;
    const copyEl = document.getElementById('currentKeywordCopy');
    const wrapEl = keywordEl.closest('.menu-keyword-wrap');
    const text = state.keyword.text;
    const raw = state.keyword.raw || text;
    if (text) {
      keywordEl.textContent = `"${formatKeyword(text)}"`;
      if (wrapEl) {
        wrapEl.dataset.fullKeyword = raw;
        wrapEl.classList.add('has-keyword');
      }
      if (copyEl) {
        copyEl.hidden = false;
        copyEl.dataset.keyword = raw;
      }
    } else {
      keywordEl.textContent = '';
      if (wrapEl) {
        wrapEl.dataset.fullKeyword = '';
        wrapEl.classList.remove('has-keyword');
      }
      if (copyEl) {
        copyEl.hidden = true;
        copyEl.dataset.keyword = '';
      }
    }
  }

  async function requestKeyword() {
    const tab = state.activeTab || await getActiveTab();
    if (!tab) return state.keyword;
    state.activeTab = tab;
    const result = await sendRuntime({
      action: 'getKeyword',
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
      intent: 'popup-open'
    }, 1500);
    const fresh = result.ok ? result.data : null;
    if (fresh?.text || fresh?.raw) setKeyword(fresh);
    return state.keyword;
  }

  async function ensureKeyword() {
    if (state.keyword.text || state.keyword.raw) return state.keyword;
    return requestKeyword();
  }

  function itemFromElement(el) {
    return {
      id: el.dataset.menuId || '',
      type: el.dataset.menuType || '',
      urlPattern: el.dataset.urlPattern || '',
      action: el.dataset.action || '',
      engineId: el.dataset.engineId || '',
      purpose: el.dataset.purpose || ''
    };
  }

  function toggleSubmenu(itemEl, itemId) {
    const submenu = document.querySelector(`.submenu[data-parent-id="${itemId}"]`);
    if (!submenu) return;
    submenu.classList.toggle('collapsed');
    itemEl.classList.toggle('expanded');
  }

  async function executeItem(item) {
    await ensureKeyword();
    const searchLike = SIMPLE_URL_TYPES.has(item.type);
    const keyword = searchLike ? (state.keyword.text || state.keyword.raw) : (state.keyword.raw || state.keyword.text);
    if (!keyword) {
      showToast('没有选中文本或无法提取关键词');
      return;
    }

    if (searchLike && item.urlPattern) {
      const url = item.urlPattern.replace('${KEYWORD}', encodeURIComponent(keyword));
      chrome.tabs.create({ url });
      window.close();
      return;
    }

    const result = await sendRuntime({
      action: 'executeMenuAction',
      menuItemId: item.id,
      menuType: item.type,
      keyword,
      urlPattern: item.urlPattern,
      actionType: item.action,
      engineId: item.engineId,
      purpose: item.purpose
    }, 5500);

    if (result.ok && result.data?.success) {
      window.close();
    } else {
      showToast(result.data?.error === 'no-keyword' ? '没有选中文本或无法提取关键词' : '操作失败，请重试');
    }
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'popup-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 1800);
  }

  function bindCoreActions() {
    const menu = document.getElementById('menuContainer');
    on(menu, 'click', (event) => {
      const itemEl = event.target?.closest?.('.menu-item[data-menu-id]');
      if (!itemEl || !menu.contains(itemEl)) return;
      event.preventDefault();
      event.stopPropagation();
      const item = itemFromElement(itemEl);
      if (!item.id) return;
      if (itemEl.classList.contains('has-children')) {
        toggleSubmenu(itemEl, item.id);
        return;
      }
      executeItem(item).catch(() => showToast('操作失败，请重试'));
    });

    const copyBtn = document.getElementById('currentKeywordCopy');
    on(copyBtn, 'click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const keyword = state.keyword.raw || state.keyword.text;
      if (!keyword) {
        showToast('没有可复制的关键字');
        return;
      }
      navigator.clipboard.writeText(keyword).then(() => showToast('已复制到剪贴板')).catch(() => showToast('复制失败'));
    });

    const settingsBtn = document.getElementById('settingsToggle');
    on(settingsBtn, 'click', (event) => {
      event.preventDefault();
      state.intent = 'settings';
      settingsBtn.textContent = '⚙️ 加载中...';
      loadFull('settings').catch(() => {});
    });

    const sidePanelBtn = document.getElementById('openSidePanel');
    on(sidePanelBtn, 'click', async (event) => {
      event.preventDefault();
      try {
        await chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
        window.close();
      } catch (_) {
        state.intent = 'sidepanel';
        loadFull('sidepanel').catch(() => {});
      }
    });
  }

  async function startKeywordCache() {
    const tab = await getActiveTab();
    if (!tab?.id || state.destroyed) return;
    state.activeTab = tab;
    const cached = await readKeywordCache(tab);
    if (cached?.text && !state.destroyed) setKeyword(cached);
    const storageKey = `ccs_kw_${tab.id}`;
    state.storageListener = (changes, areaName) => {
      if (state.destroyed || areaName !== 'local') return;
      const change = changes[storageKey];
      if (!change?.newValue) return;
      if (change.newValue.url && tab.url && change.newValue.url !== tab.url) return;
      setKeyword({
        text: change.newValue.text || '',
        raw: change.newValue.raw || change.newValue.text || ''
      });
    };
    try { chrome.storage.onChanged.addListener(state.storageListener); } catch (_) { /* ignore */ }
  }

  ready(() => {
    bindCoreActions();
    startKeywordCache().catch(() => {});
    mark('ccs-popup-boot-rendered');
    try { performance.measure('ccs-popup-boot-ttfb', 'ccs-popup-boot-start', 'ccs-popup-boot-rendered'); } catch (_) { /* ignore */ }
    scheduleFullLoad();
  });

  globalThis.__CCS_POPUP_BOOT__ = {
    consumeIntent,
    getKeyword: () => ({ ...state.keyword }),
    loadFull,
    teardown
  };
})();
