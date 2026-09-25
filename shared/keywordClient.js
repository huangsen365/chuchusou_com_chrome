/**
 * CCSKeywordClient —— popup / sidepanel 共用的关键字获取客户端（C 档重构产物）
 *
 * 这是 background/KeywordService.js 的客户端镜像：popup 和 sidepanel 不直接 send
 * message，统一过这层薄客户端，让两边的行为保证一致（getCurrentKeyword 不再各写一份）。
 *
 * 暴露：
 * - CCSKeywordClient.requestKeyword(intent, options)  —— 主入口
 * - CCSKeywordClient.readInstantCache(tabId)  —— popup 用，从 storage 读上次的缓存先渲染
 * - CCSKeywordClient.getActiveTab()  —— 工具，查当前 tab
 * - CCSKeywordClient.INTENTS  —— intent 字面量（避免拼写错误）
 *
 * 使用方式：
 *   const fresh = await CCSKeywordClient.requestKeyword('popup-open');
 *   // 或 popup 推荐的瞬时模式：
 *   const fresh = await CCSKeywordClient.requestKeyword('popup-open', {
 *     instantFromStorage: true,
 *     onInstant: (cached) => { this.keyword = cached; this.renderKeyword(); }
 *   });
 */
(function () {
  'use strict';

  const INTENTS = {
    POPUP_OPEN: 'popup-open',
    SIDEPANEL_INIT: 'sidepanel-init',
    SIDEPANEL_REFRESH: 'sidepanel-refresh'
  };

  const STORAGE_PREFIX = globalThis.CCSStorageKeys.PREFIX.KEYWORD;
  const STORAGE_TTL_MS = 5 * 60 * 1000; // 必须和 background/KeywordService.js 的 KEYWORD_STORAGE_TTL_MS 一致
  const REQUEST_TIMEOUT_MS = 1500;

  // 三段兜底拿 active tab：
  // 1) currentWindow:true（popup 上下文稳，sidepanel 偶发返回空数组）
  // 2) chrome.windows.getCurrent() 拿到 windowId 后显式 query({windowId})
  // 3) lastFocusedWindow:true（多窗口/失焦场景兜底）
  // 任一步成功立刻返回，避免假装拿到 {id:null,url:'',title:''} 占位对象。
  async function getActiveTab() {
    const fromCurrent = await new Promise((resolve) => {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          resolve(tabs && tabs[0] ? tabs[0] : null);
        });
      } catch (_) { resolve(null); }
    });
    if (fromCurrent) return fromCurrent;

    try {
      const win = await new Promise((resolve) => {
        try { chrome.windows.getCurrent((w) => resolve(w || null)); } catch (_) { resolve(null); }
      });
      if (win?.id != null) {
        const fromWindow = await new Promise((resolve) => {
          try {
            chrome.tabs.query({ active: true, windowId: win.id }, (tabs) => {
              resolve(tabs && tabs[0] ? tabs[0] : null);
            });
          } catch (_) { resolve(null); }
        });
        if (fromWindow) return fromWindow;
      }
    } catch (_) { /* ignore */ }

    return new Promise((resolve) => {
      try {
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
          resolve(tabs && tabs[0] ? tabs[0] : null);
        });
      } catch (_) { resolve(null); }
    });
  }

  /**
   * 直接读 storage 缓存（不发消息，避免唤醒 SW）。
   * popup 打开时用于"零等待"先渲染上次的关键字。
   *
   * 强校验 URL：缓存的 url 不等于当前 url 就丢弃，避免在 chrome:// 等无法取
   * selection 的页面把上一个页面的关键字"假装"成本页的（用户会误以为正常获取）。
   *
   * @param {number} tabId
   * @param {string} [currentUrl]  —— 当前 tab 的 URL；不传则跳过 URL 校验
   */
  async function readInstantCache(tabId, currentUrl) {
    if (tabId == null || !chrome?.storage?.local) return null;
    return new Promise((resolve) => {
      const key = `${STORAGE_PREFIX}${tabId}`;
      try {
        chrome.storage.local.get([key], (data) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          const entry = data?.[key];
          if (!entry || typeof entry !== 'object') { resolve(null); return; }
          if (Date.now() - (entry.ts || 0) > STORAGE_TTL_MS) { resolve(null); return; }
          // URL 强校验：缓存 URL ≠ 当前 URL → stale → 丢弃
          if (currentUrl && entry.url && entry.url !== currentUrl) {
            resolve(null);
            return;
          }
          resolve({ text: entry.text || '', raw: entry.raw || entry.text || '' });
        });
      } catch (_) { resolve(null); }
    });
  }

  /**
   * 请求关键字。intent 决定 background 的策略。
   *
   * @param {string} intent  —— 见 INTENTS
   * @param {Object} [options]
   * @param {Object} [options.tab]  —— 已知的 tab 对象（省去查 active tab 的 round-trip）
   * @param {boolean} [options.instantFromStorage]  —— 先并发读 storage 缓存，命中即触发 onInstant
   * @param {Function} [options.onInstant]  —— 当 storage 命中且尚未拿到新鲜值时回调（用于先渲染 UI）
   * @returns {Promise<{text: string, raw: string}>}  —— 新鲜值（覆盖任何 instant 值）
   */
  async function requestKeyword(intent, options = {}) {
    const { tab = null, instantFromStorage = false, onInstant = null } = options;
    const activeTab = tab || await getActiveTab();
    if (!activeTab) return { text: '', raw: '' };

    let freshResolved = false;
    let onInstantCalled = false;

    // 并发：读 storage（快）+ 发消息拿新鲜（慢）
    if (instantFromStorage && typeof onInstant === 'function') {
      readInstantCache(activeTab.id, activeTab.url).then((cached) => {
        // 只有"新鲜值还没回来 + 缓存命中 + 用户没主动取消"才回调 instant
        if (!freshResolved && !onInstantCalled && cached && cached.text) {
          onInstantCalled = true;
          try { onInstant(cached); } catch (e) {
            console.warn('[触触搜][KeywordClient] onInstant 回调异常:', e);
          }
        }
      });
    }

    const request = {
      action: 'getKeyword',
      tabId: activeTab.id,
      url: activeTab.url,
      title: activeTab.title,
      intent
    };

    try {
      const client = globalThis.CCSRuntimeClient;
      if (client?.sendRuntimeMessage) {
        const result = await client.sendRuntimeMessage(request, {
          timeoutMs: options.timeoutMs || REQUEST_TIMEOUT_MS,
          retries: options.retries ?? 1
        });
        freshResolved = true;
        if (!result.ok) {
          globalThis.CCSLogger?.warn?.('keyword', 'request-failed', result.requestId, result.error?.code || 'KEYWORD_FAILED', result.error);
          return { text: '', raw: '' };
        }
        const response = result.data || {};
        return {
          text: response?.text || '',
          raw: response?.raw || response?.text || ''
        };
      }

      return await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(request, (response) => {
            freshResolved = true;
            if (chrome.runtime.lastError) {
              resolve({ text: '', raw: '' });
              return;
            }
            resolve({
              text: response?.text || '',
              raw: response?.raw || response?.text || ''
            });
          });
        } catch (e) {
          freshResolved = true;
          console.warn('[触触搜][KeywordClient] sendMessage 异常:', e);
          resolve({ text: '', raw: '' });
        }
      });
    } catch (e) {
      freshResolved = true;
      console.warn('[触触搜][KeywordClient] requestKeyword 异常:', e);
      return { text: '', raw: '' };
    }
  }

  globalThis.CCSKeywordClient = {
    requestKeyword,
    readInstantCache,
    getActiveTab,
    INTENTS
  };
})();
