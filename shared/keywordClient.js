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

  const STORAGE_PREFIX = 'ccs_kw_';
  const STORAGE_TTL_MS = 5 * 60 * 1000; // 必须和 background/KeywordService.js 的 KEYWORD_STORAGE_TTL_MS 一致

  async function getActiveTab() {
    return new Promise((resolve) => {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          resolve(tabs && tabs[0] ? tabs[0] : null);
        });
      } catch (_) { resolve(null); }
    });
  }

  /**
   * 直接读 storage 缓存（不发消息，避免唤醒 SW）。
   * popup 打开时用于"零等待"先渲染上次的关键字。
   */
  async function readInstantCache(tabId) {
    if (tabId == null || !chrome?.storage?.local) return null;
    return new Promise((resolve) => {
      const key = `${STORAGE_PREFIX}${tabId}`;
      try {
        chrome.storage.local.get([key], (data) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          const entry = data?.[key];
          if (!entry || typeof entry !== 'object') { resolve(null); return; }
          if (Date.now() - (entry.ts || 0) > STORAGE_TTL_MS) { resolve(null); return; }
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
      readInstantCache(activeTab.id).then((cached) => {
        // 只有"新鲜值还没回来 + 缓存命中 + 用户没主动取消"才回调 instant
        if (!freshResolved && !onInstantCalled && cached && cached.text) {
          onInstantCalled = true;
          try { onInstant(cached); } catch (e) {
            console.warn('[触触搜][KeywordClient] onInstant 回调异常:', e);
          }
        }
      });
    }

    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({
          action: 'getKeyword',
          tabId: activeTab.id,
          url: activeTab.url,
          title: activeTab.title,
          intent
        }, (response) => {
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
  }

  globalThis.CCSKeywordClient = {
    requestKeyword,
    readInstantCache,
    getActiveTab,
    INTENTS
  };
})();
