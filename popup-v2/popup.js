/* popup-v2/popup.js —— 全新极简 popup 实现
 *
 * 设计原则：
 * - 零 sendMessage 关键路径
 * - 零 fetch（菜单写死在 HTML，不读 config）
 * - 零 shared/* 依赖
 * - storage 接口：chrome.storage.local['ccs_kw_${tabId}'] = {text, raw, url, ts}
 *   写入方：background/KeywordService._writeStorageCache（TTL 5 分钟 + URL 强校验）
 */
(() => {
  'use strict';

  const TTL_MS = 5 * 60 * 1000;
  const KW_PREFIX = 'ccs_kw_';
  const URL_HARD_CAP = 1900;

  const kwEl = document.getElementById('kw');
  const copyBtn = document.getElementById('copy');
  const menu = document.getElementById('menu');

  let currentKw = '';
  let currentTabId = null;
  let currentTabUrl = '';

  function setKeyword(s) {
    currentKw = (s || '').trim();
    if (currentKw) {
      kwEl.textContent = currentKw;
      kwEl.title = currentKw;
      kwEl.removeAttribute('data-empty');
      copyBtn.hidden = false;
    } else {
      kwEl.textContent = '';
      kwEl.title = '';
      kwEl.setAttribute('data-empty', '1');
      copyBtn.hidden = true;
    }
  }

  function flash(msg) {
    const saved = currentKw;
    kwEl.textContent = msg;
    kwEl.setAttribute('data-empty', '1');
    setTimeout(() => {
      if (saved) setKeyword(saved); else setKeyword('');
    }, 1200);
  }

  async function loadKeyword() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      if (!tab || tab.id == null) return;
      currentTabId = tab.id;
      currentTabUrl = tab.url || '';

      const key = KW_PREFIX + tab.id;
      const data = await chrome.storage.local.get([key]);
      const entry = data && data[key];
      if (!entry || typeof entry !== 'object') return;

      // TTL 校验（与 background KeywordService 约定一致）
      if (Date.now() - (entry.ts || 0) > TTL_MS) return;

      // URL 强校验：缓存 URL 与当前 tab URL 不一致 → 视为 stale
      if (currentTabUrl && entry.url && entry.url !== currentTabUrl) return;

      setKeyword(entry.text || entry.raw || '');
    } catch (err) {
      console.warn('[popup-v2] loadKeyword 失败:', err);
    }
  }

  // 监听 storage.onChanged 实时更新（同 tab 内 background 写入立即反映）
  function bindStorageListener() {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        // 只关心当前 tab 的 key
        if (currentTabId == null) return;
        const myKey = KW_PREFIX + currentTabId;
        if (!Object.prototype.hasOwnProperty.call(changes, myKey)) return;
        const v = changes[myKey].newValue;
        if (!v || typeof v !== 'object') {
          setKeyword('');
          return;
        }
        // 同样做 TTL + URL 校验
        if (Date.now() - (v.ts || 0) > TTL_MS) return;
        if (currentTabUrl && v.url && v.url !== currentTabUrl) return;
        setKeyword(v.text || v.raw || '');
      });
    } catch (err) {
      console.warn('[popup-v2] storage listener 失败:', err);
    }
  }

  function bindMenuClick() {
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.item');
      if (!item) return;
      if (!currentKw) {
        flash('请先选中文字');
        return;
      }
      let url = item.dataset.tpl;
      if (!url) return;
      const encoded = encodeURIComponent(currentKw);
      url = url.replace('${KW}', encoded);
      // 硬截 URL 上限（与 background TextLimits 兜底一致）
      if (url.length > URL_HARD_CAP) url = url.slice(0, URL_HARD_CAP);
      try {
        chrome.tabs.create({ url });
        // 关 popup（用户预期点了就走）
        setTimeout(() => window.close(), 30);
      } catch (err) {
        console.warn('[popup-v2] tabs.create 失败:', err);
      }
    });
  }

  function bindCopy() {
    copyBtn.addEventListener('click', async () => {
      if (!currentKw) return;
      try {
        await navigator.clipboard.writeText(currentKw);
        const original = copyBtn.textContent;
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = original; }, 800);
      } catch (err) {
        console.warn('[popup-v2] clipboard 写入失败:', err);
      }
    });
  }

  // 启动：HTML 已就绪（script 在 body 末尾，无需等 DOMContentLoaded）
  bindMenuClick();
  bindCopy();
  bindStorageListener();
  loadKeyword();
})();
