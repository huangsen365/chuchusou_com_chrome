/**
 * 标签页事件 handler（onUpdated / onActivated / onRemoved），监听在 events.js 注册。
 */


// v1.6.22 性能实验：onUpdated 精简模式开关。
//
// 背景：低配 Windows 新开网页时复现"后台启动较慢，请重试"。溯源链路是
// chrome.tabs.onUpdated 在单次跳转里会触发 3 次（title / loading / complete），
// 每次都跑 prefetchMenuState + refreshMenuTitle，加上 complete 阶段会调
// syncSelectionFromTab，新页面 content.js 尚未注入 → reinject 兜底 → 再 sendMessage
// 重试，最后还有一个 setTimeout 300ms 延迟二次 prefetch。SW 持续忙 3-6 秒，期间
// popup/sidepanel 发出的 executeMenuAction 排队，runtimeClient 5000ms × 2 retry
// 仍可能撞上忙窗口超时，触发 popup.js:176 / sidepanel.js:734 的 TIMEOUT 文案。
//
// LITE=true（默认）：
//   - title 变化只刷 in-memory cache，不再 prefetch / refreshMenuTitle
//   - loading 只清 selection / fallback 缓存，不 prefetch
//   - complete 只跑一次 prefetch + refreshMenuTitle，跳过 syncSelectionFromTab
//     content.js 在 manifest run_at:document_start 已自动注入，它读到 selection
//     后会主动发 selectionChanged 上来，无需 SW 这边主动 fetch + reinject
//   - 删除 setTimeout 300ms 延迟二次 prefetch（SPA 站点菜单标题最坏延迟一次轮询）
// LITE=false：恢复 v1.6.21 完整行为，所有事件路径原样执行
//
// 若上架低配 Windows 后右键菜单标题/关键字同步出问题，把这里改成 false 即可回滚。
const BG_TABS_ONUPDATED_LITE = true;

async function ccsOnTabUpdated(tabId, changeInfo, tab) {
  if (BG_TABS_ONUPDATED_LITE) {
    if (typeof changeInfo.title === 'string') {
      updateLatestTabTitle(tabId, changeInfo.title);
      // v1.6.34: title 到达即刷新右键菜单标题，**不等 status=complete**。
      // 原生右键菜单弹出后不会重绘 —— 标题必须在用户右键之前就正确；
      // 静态资源慢的页面 complete 可能晚好几秒，期间右键看到的是旧标题/无关键词
      //（contextMenuPreview 路径的 update 在菜单已弹出后才落地，治不了"这一次"）。
      // 性能：一次导航 title 事件通常 1-2 次，这里只做 prefetch + refreshMenuTitle，
      // LITE 当年砍掉的 syncSelectionFromTab / reinject / 延迟二次 prefetch 仍然不做。
      const titleUrl = changeInfo.url || tab?.url || '';
      if (titleUrl) {
        const titleTab = Object.assign({}, tab, { id: tabId, url: titleUrl, title: changeInfo.title });
        await prefetchMenuState(titleTab, 'title-arrived');
        const storedSel = selectedTextByTab[tabId];
        const hasSel = storedSel && typeof storedSel.text === 'string' && storedSel.text.trim().length > 0;
        const preserveTitle = shouldPreserveMenuStateForUrl(titleUrl);
        if (!(preserveTitle && hasSel && storedSel.url === titleUrl)) {
          await refreshMenuTitle(titleTab);
        }
      }
    }
    if (changeInfo.status === 'loading') {
      delete selectedTextByTab[tabId];
      delete fallbackKeywordByTab[tabId];
    }
    if (changeInfo.status === 'complete' && tab.url) {
      const candidateUrl = changeInfo.url || tab.url;
      // title 回填：complete 事件的 tab.title 偶发为空（L6 取证中空标题写入者
      // 的来源之一），用 title 事件喂过的内存缓存兜底
      const candidateTitle = tab.title || getLatestTabPageTitle(tabId) || '';
      const mergedTab = Object.assign({}, tab, { id: tabId, url: candidateUrl, title: candidateTitle });
      await prefetchMenuState(mergedTab, 'tab-complete');
      const stored = selectedTextByTab[tabId];
      const hasStoredSelection =
        stored && typeof stored.text === 'string' && stored.text.trim().length > 0;
      const preserve = shouldPreserveMenuStateForUrl(candidateUrl);
      if (preserve && hasStoredSelection && stored.url === (candidateUrl || stored.url)) {
        return;
      }
      await refreshMenuTitle(mergedTab);
    }
    return;
  }

  // ===== 原始完整行为（BG_TABS_ONUPDATED_LITE=false 时走这里）=====
  if (typeof changeInfo.title === 'string') {
    updateLatestTabTitle(tabId, changeInfo.title);
    const mergedForTitle = Object.assign({}, tab, {
      id: tabId,
      title: changeInfo.title
    });
    if (tab?.url || changeInfo.url) {
      mergedForTitle.url = changeInfo.url || tab?.url || '';
      await prefetchMenuState(mergedForTitle, 'title-changed');
    }
    await refreshMenuTitle(mergedForTitle);
  }
  if (changeInfo.status === 'loading') {
    delete selectedTextByTab[tabId];
    delete fallbackKeywordByTab[tabId];
    const mergedLoadingTab = Object.assign({}, tab, {
      id: tabId,
      url: changeInfo.url || tab?.url || ''
    });
    await prefetchMenuState(mergedLoadingTab, 'tab-loading');
  }
  if (changeInfo.status === 'complete' && tab.url) {
    const candidateUrl = changeInfo.url || tab.url;
    const mergedTab = Object.assign({}, tab, { id: tabId, url: candidateUrl });
    await prefetchMenuState(mergedTab, 'tab-complete');
    const syncedText = await syncSelectionFromTab(mergedTab, 'tab-updated');
    if (syncedText) {
      delete fallbackKeywordByTab[tabId];
      return;
    }
    const stored = selectedTextByTab[tabId];
    const hasStoredSelection =
      stored && typeof stored.text === 'string' && stored.text.trim().length > 0;
    const preserve = shouldPreserveMenuStateForUrl(candidateUrl);
    if (preserve && hasStoredSelection && stored.url === (candidateUrl || stored.url)) {
      return;
    }
    await refreshMenuTitle(mergedTab);

    setTimeout(async () => {
      try {
        const freshTab = await chrome.tabs.get(tabId);
        if (freshTab && freshTab.url === candidateUrl) {
          if (freshTab.title && freshTab.title !== (tab.title || '')) {
            updateLatestTabTitle(tabId, freshTab.title);
            logMenuEvent('delayed-title-update', {
              tabId,
              oldTitle: tab.title,
              newTitle: freshTab.title,
              url: candidateUrl
            });
          }
          await prefetchMenuState(freshTab, 'delayed-title-refresh');
        }
      } catch (err) {
        logMenuEvent('delayed-title-refresh-failed', {
          tabId,
          error: err?.message
        });
      }
    }, 300);
  }
}


// 监听标签页激活，动态更新菜单标题
async function ccsOnTabActivated(activeInfo) {
  const tab = await chrome.tabs.get(activeInfo.tabId);

  // BUGFIX: Smart cache preservation - save and restore selection state
  if (currentMenuState.tabId != null && currentMenuState.tabId !== activeInfo.tabId) {
    const previousTabId = currentMenuState.tabId;

    logMenuEvent('tab-activated-state-transition', {
      previousTabId,
      newTabId: activeInfo.tabId,
      hasCurrentState: !!(currentMenuState.raw),
      hasStoredSelection: !!selectedTextByTab[activeInfo.tabId]
    });

    // Save current tab's state to cache before switching
    if (currentMenuState.raw && currentMenuState.raw.trim()) {
      selectedTextByTab[previousTabId] = {
        text: currentMenuState.raw,
        url: currentMenuState.url,
        timestamp: Date.now()
      };
      logMenuEvent('tab-activated-saved-to-cache', {
        tabId: previousTabId,
        text: currentMenuState.raw.substring(0, 50)
      });
    }

    // Try to restore new tab's state from cache
    const cached = selectedTextByTab[activeInfo.tabId];
    if (cached && cached.text && cached.text.trim()) {
      const age = Date.now() - (cached.timestamp || 0);
      const isFresh = age < 10000; // 10 seconds threshold
      const urlMatches = cached.url === tab.url;

      if (isFresh && urlMatches) {
        // Restore from cache
        setMenuState(cached.text, normalizeSearchText(cached.text), {
          tabId: activeInfo.tabId,
          url: tab.url
        });
        logMenuEvent('tab-activated-restored-from-cache', {
          tabId: activeInfo.tabId,
          age,
          text: cached.text.substring(0, 50)
        });
      } else {
        // Cache expired or URL changed, clear state
        // BUGFIX: Set tabId to new active tab immediately to prevent stale messages
        currentMenuState.raw = '';
        currentMenuState.normalized = '';
        currentMenuState.display = '';
        currentMenuState.tabId = activeInfo.tabId; // ✅ Set to new tab, not null
        currentMenuState.url = tab.url || '';
        logMenuEvent('tab-activated-cache-invalid', {
          tabId: activeInfo.tabId,
          age,
          isFresh,
          urlMatches
        });
      }
    } else {
      // No cache, clear state
      // BUGFIX: Set tabId to new active tab immediately to prevent stale messages
      currentMenuState.raw = '';
      currentMenuState.normalized = '';
      currentMenuState.display = '';
      currentMenuState.tabId = activeInfo.tabId; // ✅ Set to new tab, not null
      currentMenuState.url = tab.url || '';
    }
  }

  // BUGFIX: Immediately update latestTitleByTab cache with fresh tab title
  // This ensures onShown will have up-to-date data if triggered quickly after tab switch
  if (tab?.id != null && tab?.title) {
    updateLatestTabTitle(tab.id, tab.title);
    logMenuEvent('tab-activated-title-preload', {
      tabId: tab.id,
      title: tab.title,
      url: tab.url
    });
  }

  // BUGFIX: Preload keywords to prevent empty menu on first right-click
  // Extract keywords from URL/title and cache them immediately
  if (tab?.url && tab?.id != null) {
    try {
      const keywords = await extractSearchKeywords(tab.url, tab);
      if (keywords && keywords.trim()) {
        fallbackKeywordByTab[activeInfo.tabId] = {
          raw: keywords,
          normalized: normalizeSearchText(keywords),
          timestamp: Date.now(),
          url: tab.url
        };
        logMenuEvent('tab-activated-keyword-preload', {
          tabId: activeInfo.tabId,
          keywords: keywords.substring(0, 50),
          url: tab.url
        });
      }
    } catch (err) {
      // Keyword extraction failed, but don't block other operations
      logMenuEvent('tab-activated-keyword-preload-failed', {
        tabId: activeInfo.tabId,
        error: err?.message
      });
    }
  }

  if (tab?.url) {
    await prefetchMenuState(tab, 'tab-activated');
  }
  const syncedText = await syncSelectionFromTab(tab, 'tab-activated');
  if (syncedText) {
    delete fallbackKeywordByTab[activeInfo.tabId];
    return;
  }
  const stored = selectedTextByTab[activeInfo.tabId];
  const hasStoredSelection =
    stored && typeof stored.text === 'string' && stored.text.trim().length > 0;
  const preserve = shouldPreserveMenuStateForTab(tab);
  if (preserve && hasStoredSelection && stored.url === (tab.url || stored.url)) {
    return;
  }
  await refreshMenuTitle(tab);
}


// BUGFIX: Clean up stale cache entries when tabs are closed
function ccsOnTabRemoved(tabId, removeInfo) {
  logMenuEvent('tab-removed', {
    tabId,
    windowClosing: removeInfo.windowClosing
  });

  // Clean up per-tab caches to prevent memory leaks and stale data
  // C 档重构：内存缓存 + storage 缓存一起清，走 KeywordService.clearTab
  KeywordService.clearTab(tabId);
  if (typeof ccsClearUrlRecoveryForTab === 'function') {
    ccsClearUrlRecoveryForTab(tabId).catch(() => {});
  }

  // Clear currentMenuState if it belongs to the closed tab
  if (currentMenuState.tabId === tabId) {
    logMenuEvent('tab-removed-clearing-current-state', {
      tabId,
      url: currentMenuState.url
    });
    currentMenuState.raw = '';
    currentMenuState.normalized = '';
    currentMenuState.display = '';
    currentMenuState.tabId = null;
    currentMenuState.url = '';
  }
}
