/**
 * Tiny sidepanel bootstrap. It keeps the static menu usable while the full
 * sidepanel bundle is loaded after first paint.
 */
(function () {
  'use strict';

  const FULL_SCRIPT = chrome.runtime.getURL('sidepanel/sidepanel.bundle.js');
  const KEYWORD_TTL_MS = 5 * 60 * 1000;
  const SEARCH_TEXT_TYPES = new Set(['search', 'ai-search', 'ecommerce', 'translate', 'portal']);
  const DIRECT_URL_TYPES = new Set(['search', 'ecommerce', 'translate', 'portal']);
  const state = {
    activeTab: null,
    destroyed: false,
    fullPromise: null,
    keyword: { text: '', raw: '' },
    listeners: [],
    storageListener: null
  };

  mark('ccs-sidepanel-boot-start');

  function mark(name) {
    try { performance.mark(name); } catch (_) { /* ignore */ }
  }

  function on(target, event, handler, options) {
    if (!target || !target.addEventListener) return;
    target.addEventListener(event, handler, options);
    state.listeners.push(() => target.removeEventListener(event, handler, options));
  }

  function ready(fn) {
    if (document.readyState === 'loading') on(document, 'DOMContentLoaded', fn, { once: true });
    else fn();
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
    mark('ccs-sidepanel-boot-teardown');
  }

  function loadFull(reason) {
    if (state.fullPromise) return state.fullPromise;
    mark(`ccs-sidepanel-full-load-start:${reason || 'idle'}`);
    state.fullPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${FULL_SCRIPT}"]`);
      if (existing) { resolve(); return; }
      const script = document.createElement('script');
      script.src = FULL_SCRIPT;
      script.async = true;
      script.dataset.ccsFullSidepanel = 'true';
      script.onload = () => {
        mark('ccs-sidepanel-full-load-end');
        resolve();
      };
      script.onerror = () => reject(new Error('sidepanel full bundle load failed'));
      document.head.appendChild(script);
    }).catch((error) => {
      state.fullPromise = null;
      showToast('完整功能加载失败，请重开侧边栏');
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
            ric(() => { loadFull('idle').catch(() => {}); }, { timeout: 1800 });
          } else {
            setTimeout(() => { loadFull('idle').catch(() => {}); }, 700);
          }
        });
      });
    };
    if (document.readyState === 'complete') afterLoad();
    else on(window, 'load', afterLoad, { once: true });
  }

  function syncStickyTopPadding() {
    const stickyTop = document.getElementById('spStickyTop');
    if (!stickyTop) return;
    const apply = () => {
      const h = stickyTop.getBoundingClientRect().height;
      if (h > 0) document.body.style.paddingTop = `${Math.ceil(h)}px`;
    };
    apply();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(apply);
      ro.observe(stickyTop);
      state.listeners.push(() => ro.disconnect());
    }
  }

  function getActiveTab() {
    return new Promise((resolve) => {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          resolve(tabs && tabs[0] ? tabs[0] : null);
        });
      } catch (_) { resolve(null); }
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
      } catch (_) { resolve(null); }
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
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message || 'runtime-error' });
          else resolve({ ok: true, data: response || {} });
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
    return compact.length > 18 ? `${compact.slice(0, 18)}...` : compact;
  }

  function renderKeyword() {
    const keywordEl = document.getElementById('spKeyword');
    if (!keywordEl) return;
    const copyEl = document.getElementById('spKeywordCopy');
    const wrapEl = keywordEl.closest('.sp-keyword-wrap');
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
      intent: 'sidepanel-refresh'
    }, 1600);
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

  async function executeItem(item) {
    await ensureKeyword();
    const searchLike = SEARCH_TEXT_TYPES.has(item.type);
    const keyword = searchLike ? (state.keyword.text || state.keyword.raw) : (state.keyword.raw || state.keyword.text);
    if (!keyword) {
      showToast('没有选中文本或无法提取关键词');
      return;
    }
    if (DIRECT_URL_TYPES.has(item.type) && item.urlPattern) {
      chrome.tabs.create({ url: item.urlPattern.replace('${KEYWORD}', encodeURIComponent(keyword)) });
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
    if (!result.ok || result.data?.error === 'no-keyword') {
      showToast(result.data?.error === 'no-keyword' ? '没有选中文本或无法提取关键词' : '操作失败，请重试');
    }
  }

  function bindCoreActions() {
    const menu = document.getElementById('spMenu');
    on(menu, 'click', (event) => {
      const itemEl = event.target?.closest?.('.sp-menu-item[data-menu-id]');
      if (!itemEl || !menu.contains(itemEl)) return;
      event.preventDefault();
      event.stopPropagation();
      const item = itemFromElement(itemEl);
      if (!item.id) return;
      executeItem(item).catch(() => showToast('操作失败，请重试'));
    });

    const copyBtn = document.getElementById('spKeywordCopy');
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

    const pickerBtns = [
      document.getElementById('spPinEdit'),
      document.getElementById('spClipboardBtn'),
      document.getElementById('spKeywordVoice')
    ].filter(Boolean);
    pickerBtns.forEach((btn) => {
      on(btn, 'click', () => { loadFull('interaction').catch(() => {}); }, { once: true });
    });
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'sp-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 1800);
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
    syncStickyTopPadding();
    bindCoreActions();
    startKeywordCache().catch(() => {});
    mark('ccs-sidepanel-boot-rendered');
    try { performance.measure('ccs-sidepanel-boot-ttfb', 'ccs-sidepanel-boot-start', 'ccs-sidepanel-boot-rendered'); } catch (_) { /* ignore */ }
    scheduleFullLoad();
  });

  globalThis.__CCS_SIDEPANEL_BOOT__ = {
    getKeyword: () => ({ ...state.keyword }),
    loadFull,
    teardown
  };
})();
