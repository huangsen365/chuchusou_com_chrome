/**
 * KeywordService —— 关键字获取的统一门面（C 档重构产物）
 *
 * 旧架构问题（已通过 docs/TECH_DEBT_AUDIT 和聊天评估梳理）：
 * - popup / sidepanel / 右键菜单 三处都直接调 computeSearchTextForTab(ctx, opts)，
 *   每处自己组装 forceFetchSelection / skipCurrentMenuFallback 等 boolean 旗标，
 *   语义靠注释 + 调用方记忆，缺一个清晰的"调用意图"概念。
 * - popup 和 sidepanel 的 getCurrentKeyword() 函数代码几乎一致但各自维护，
 *   改动需要双向同步，容易漏。
 * - popup 打开时窃焦点 → 当前 tab 失焦 → 部分网站清掉 selection → popup 拿到空。
 *   旧架构没有 storage 级瞬时缓存兜底，用户会看到空白徽章。
 *
 * 本服务做的事：
 * 1. 引入 INTENT 概念（'popup-open' / 'sidepanel-init' / 'contextmenu-click' ...），
 *    每个意图映射到一组明确的 policy（旗标 + 是否写 storage 缓存）。
 * 2. 内部仍调 computeSearchTextForTab() 不重写引擎，只重写门面 —— 行为零变化、有 SSoT。
 * 3. 提供 storage 级 5 分钟 TTL 瞬时缓存（仅 popup-open 意图启用），
 *    搭配 shared/keywordClient.js 让 popup 在 SW 仍在拿新鲜值时立刻渲染上次的值。
 *
 * 入口：
 * - KeywordService.getKeyword(ctx)  —— 主流程，三种调用端都用
 * - KeywordService.readStorageCache(tabId)  —— 客户端瞬时缓存读取（也通过消息给客户端用）
 * - KeywordService.clearTab(tabId)  —— tab 关闭时清理（events.js onRemoved 钩子调用）
 *
 * 不做的事：
 * - 不改 computeSearchTextForTab() 内部
 * - 不替换 KeywordSyncManager（那是菜单标题同步协调者，跟"获取关键字"是两件事）
 * - 不动 currentMenuState / selectedTextByTab / fallbackKeywordByTab / latestTitleByTab
 *   全局对象 —— 它们仍在 base.js / Constants.js 里定义，本服务通过 compute 间接读写
 */

const KEYWORD_INTENTS = {
  POPUP_OPEN: 'popup-open',
  SIDEPANEL_INIT: 'sidepanel-init',
  SIDEPANEL_REFRESH: 'sidepanel-refresh',
  CONTEXT_MENU_CLICK: 'contextmenu-click',
  MENU_PREVIEW: 'menu-preview',
  PAGE_CHANGED: 'page-changed',
  LEGACY: 'legacy-getSearchText'
};

// 每种 intent 的执行策略表
//
// forceFetchSelection: 是否主动 executeScript 读 selection（更新但慢，~50-100ms）
// skipCurrentMenuFallback: 是否跳过 currentMenuState 单例兜底（避免跨 tab 污染）
// cacheToStorage: 是否把成功结果写入 chrome.storage.local（让下次同 tabId 的 popup-open 能瞬时显示）
// source: 标记返回结果的来源（用于 debug / 后续埋点）
const INTENT_POLICIES = {
  'popup-open':        { forceFetchSelection: true,  skipCurrentMenuFallback: true,  cacheToStorage: true,  source: 'popup' },
  'sidepanel-init':    { forceFetchSelection: true,  skipCurrentMenuFallback: true,  cacheToStorage: false, source: 'sidepanel-init' },
  'sidepanel-refresh': { forceFetchSelection: true,  skipCurrentMenuFallback: true,  cacheToStorage: false, source: 'sidepanel-refresh' },
  'contextmenu-click': { forceFetchSelection: true,  skipCurrentMenuFallback: true,  cacheToStorage: false, source: 'context-menu' },
  'menu-preview':      { forceFetchSelection: false, skipCurrentMenuFallback: false, cacheToStorage: false, source: 'menu-preview' },
  'page-changed':      { forceFetchSelection: false, skipCurrentMenuFallback: false, cacheToStorage: false, source: 'tab-event' },
  'legacy-getSearchText': { forceFetchSelection: true, skipCurrentMenuFallback: true, cacheToStorage: false, source: 'legacy' }
};

const KEYWORD_STORAGE_PREFIX = 'ccs_kw_';
const KEYWORD_STORAGE_TTL_MS = 5 * 60 * 1000; // 5 分钟

class KeywordService {
  static async _getFreshTab(tabId) {
    if (tabId == null || !chrome?.tabs?.get) return null;
    return new Promise((resolve) => {
      try {
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(tab || null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  static async _hydrateContext(ctx) {
    const out = {
      tabId: ctx?.tabId,
      url: ctx?.url || '',
      title: ctx?.title || '',
      selectionText: ctx?.selectionText || ''
    };

    const freshTab = await KeywordService._getFreshTab(out.tabId);
    if (!freshTab) return out;

    const freshUrl = freshTab.url || freshTab.pendingUrl || '';
    const freshTitle = freshTab.title || '';

    // Sidepanel 在 chrome:// 页面上经常只能传进空 title/url。这里让 background
    // 用 tabs.get(tabId) 再拿一次当前 tab 元数据，避免把前端的早期空快照当最终结果。
    if (freshUrl) out.url = freshUrl;
    if (freshTitle) {
      out.title = freshTitle;
      if (typeof updateLatestTabTitle === 'function') {
        try { updateLatestTabTitle(out.tabId, freshTitle); } catch (_) { /* ignore */ }
      }
    }

    return out;
  }

  /**
   * 统一获取关键字
   *
   * @param {Object} ctx
   * @param {number|null} ctx.tabId
   * @param {string} ctx.url
   * @param {string} ctx.title
   * @param {string} ctx.intent  —— 见 KEYWORD_INTENTS（不传则按 legacy 处理）
   * @param {string} [ctx.selectionText]  —— 仅 contextmenu-click 提供（info.selectionText）
   * @returns {Promise<{text: string, raw: string, normalized: string, source: string, intent: string}>}
   */
  static async getKeyword(ctx) {
    const intent = ctx?.intent || KEYWORD_INTENTS.LEGACY;
    const policy = INTENT_POLICIES[intent] || INTENT_POLICIES[KEYWORD_INTENTS.LEGACY];
    const hydratedCtx = await KeywordService._hydrateContext(ctx);

    let result;
    try {
      result = await computeSearchTextForTab({
        tabId: hydratedCtx.tabId,
        tabUrl: hydratedCtx.url,
        tabTitle: hydratedCtx.title,
        selectionText: hydratedCtx.selectionText
      }, {
        forceFetchSelection: policy.forceFetchSelection,
        skipCurrentMenuFallback: policy.skipCurrentMenuFallback,
        // Popup/sidepanel explicit refresh already does the direct selection probe
        // through forceFetchSelection. Do not run the older second-chance probe,
        // which doubles chrome.scripting.executeScript cost on pages with no
        // selection and is very visible on low-spec Windows machines.
        allowFallbackSelectionFetch: false
      });
    } catch (error) {
      console.error('[触触搜][KeywordService] compute failed:', error);
      return { text: '', raw: '', normalized: '', source: policy.source, intent };
    }

    const text = result?.normalized || '';
    const raw = result?.raw || '';

    // 仅 popup-open 写 storage 缓存（5 分钟 TTL）。URL 一起入库，读取时强校验，
    // 避免"同 tab 切到 chrome:// 后误把上一个 URL 的旧值当本页关键字显示"。
    if (policy.cacheToStorage && hydratedCtx.tabId != null && text) {
      KeywordService._writeStorageCache(hydratedCtx.tabId, {
        text,
        raw,
        url: hydratedCtx.url
      }).catch(() => { /* 写失败不影响主流程 */ });
    }

    return { text, raw, normalized: text, source: policy.source, intent };
  }

  /**
   * 读 storage 缓存（popup 端"打开瞬间不空白"用）
   *
   * 强校验 URL：缓存里的 url 必须等于 currentUrl 才认。否则即使 tabId 没变，
   * 也可能是用户在同一 tab 内导航到了不能取 selection 的页面（chrome:// 等），
   * 此时不应该把上一个 URL 的关键字"假装"成本页关键字给用户看。
   *
   * @param {number} tabId
   * @param {string} currentUrl  —— 当前 tab 的 URL；不传或传空则跳过 URL 校验（向后兼容）
   * @returns {Promise<{text: string, raw: string}|null>}
   */
  static async readStorageCache(tabId, currentUrl) {
    if (tabId == null || !chrome?.storage?.local) return null;
    return new Promise((resolve) => {
      const key = `${KEYWORD_STORAGE_PREFIX}${tabId}`;
      try {
        chrome.storage.local.get([key], (data) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          const entry = data?.[key];
          if (!entry || typeof entry !== 'object') { resolve(null); return; }
          if (Date.now() - (entry.ts || 0) > KEYWORD_STORAGE_TTL_MS) {
            resolve(null);
            return;
          }
          // URL 强校验：缓存的 URL 和当前 URL 不一致 → 视为 stale，丢弃。
          if (currentUrl && entry.url && entry.url !== currentUrl) {
            resolve(null);
            return;
          }
          resolve({ text: entry.text || '', raw: entry.raw || entry.text || '' });
        });
      } catch (_) { resolve(null); }
    });
  }

  static async _writeStorageCache(tabId, { text, raw, url }) {
    if (tabId == null || !chrome?.storage?.local) return;
    return new Promise((resolve) => {
      const key = `${KEYWORD_STORAGE_PREFIX}${tabId}`;
      try {
        chrome.storage.local.set({
          [key]: { text, raw: raw || text, url: url || '', ts: Date.now() }
        }, () => resolve());
      } catch (_) { resolve(); }
    });
  }

  /**
   * tab 关闭时清理对应缓存
   */
  static async clearTab(tabId) {
    if (tabId == null) return;
    try {
      if (typeof selectedTextByTab === 'object' && selectedTextByTab) delete selectedTextByTab[tabId];
      if (typeof fallbackKeywordByTab === 'object' && fallbackKeywordByTab) delete fallbackKeywordByTab[tabId];
      if (typeof latestTitleByTab === 'object' && latestTitleByTab) delete latestTitleByTab[tabId];
    } catch (_) { /* ignore */ }
    if (chrome?.storage?.local) {
      try {
        chrome.storage.local.remove(`${KEYWORD_STORAGE_PREFIX}${tabId}`);
      } catch (_) { /* ignore */ }
    }
  }
}

globalThis.KeywordService = KeywordService;
globalThis.KEYWORD_INTENTS = KEYWORD_INTENTS;
