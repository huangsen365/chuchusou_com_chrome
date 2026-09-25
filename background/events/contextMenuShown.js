/**
 * 右键菜单弹出（contextMenus.onShown）时刷新动态标题，监听在 events.js 注册。
 */

function ccsOnContextMenuShown(info, tab) {
  const tabId = tab?.id ?? null;
  const tabUrl = tab?.url || '';
  logMenuEvent('context-onShown', {
    tabId,
    menuIds: Array.isArray(info?.menuIds) ? info.menuIds : [],
    contexts: info?.contexts || []
  });
  if (tabId == null) {
    if (chrome.contextMenus.refresh) {
      chrome.contextMenus.refresh();
    }
    return;
  }
  (async () => {
    try {
      // BUGFIX: Force refresh tab info to ensure we have the latest title and URL
      let freshTab = tab;
      if (tabId != null) {
        try {
          freshTab = await chrome.tabs.get(tabId);
          logMenuEvent('onShown-tab-refreshed', {
            tabId,
            freshTitle: freshTab?.title,
            originalTitle: tab?.title,
            titleChanged: freshTab?.title !== tab?.title
          });
        } catch (err) {
          // Tab may have been closed, use original tab object
          logMenuEvent('onShown-tab-refresh-failed', {
            tabId,
            error: err?.message
          });
        }
      }

      // BUGFIX: Clear stale currentMenuState if it's from a different tab
      const isCurrentMenuStateStale = currentMenuState.tabId != null && currentMenuState.tabId !== tabId;
      if (isCurrentMenuStateStale) {
        logMenuEvent('onShown-clearing-stale-state', {
          staleTabId: currentMenuState.tabId,
          currentTabId: tabId,
          staleUrl: currentMenuState.url,
          currentUrl: freshTab?.url || tabUrl
        });
      }

      const synced = await syncSelectionFromTab(freshTab, 'menu-shown', { updateMenu: false });
      let raw = '';
      let normalized = '';
      if (typeof synced === 'string' && synced.trim()) {
        raw = synced;
        normalized = normalizeSearchText(synced);
      } else {
        const stored = selectedTextByTab[tabId];
        const storedText = typeof stored?.text === 'string' ? stored.text.trim() : '';
        const storedAge = stored?.timestamp ? (Date.now() - stored.timestamp) : Infinity;
        const isCacheFresh = storedAge < 10000; // 10 seconds threshold

        // BUGFIX: Validate cache freshness before using stored selection
        if (storedText && isCacheFresh) {
          raw = storedText;
          normalized = normalizeSearchText(storedText);
          logMenuEvent('onShown-used-cached-selection', {
            tabId,
            age: storedAge,
            text: storedText.substring(0, 50)
          });
        } else {
          if (storedText && !isCacheFresh) {
            logMenuEvent('onShown-cache-expired', {
              tabId,
              age: storedAge,
              text: storedText.substring(0, 50)
            });
          }
          const result = await computeSearchTextForTab({
            tabId,
            tabUrl: freshTab?.url || tabUrl,
            // BUGFIX: Always use freshly fetched tab.title, no fallback to cache
            // This prevents using a cached title from a different tab
            tabTitle: freshTab?.title || '',
            selectionText: ''
          }, {
            forceFetchSelection: false,
            allowFallbackSelectionFetch: false,
            // BUGFIX: Only skip fallback if currentMenuState is from a different tab
            // This allows using cached selection for the same tab after switching back
            skipCurrentMenuFallback: isCurrentMenuStateStale
          });
          raw = result?.raw || '';
          normalized = result?.normalized || '';

          // BUGFIX: Retry mechanism for late-updating titles
          // If we only got URL-based keywords but no title-based keywords, retry after a short delay
          if (raw && !freshTab?.title) {
            logMenuEvent('onShown-scheduling-retry', {
              tabId,
              reason: 'no-title-on-first-attempt',
              currentKeyword: raw.substring(0, 50)
            });

            setTimeout(async () => {
              try {
                const retryTab = await chrome.tabs.get(tabId);
                if (retryTab && retryTab.title && retryTab.url === (freshTab?.url || tabUrl)) {
                  updateLatestTabTitle(tabId, retryTab.title);
                  const retryResult = await computeSearchTextForTab({
                    tabId,
                    tabUrl: retryTab.url,
                    tabTitle: retryTab.title,
                    selectionText: ''
                  }, {
                    forceFetchSelection: false,
                    skipCurrentMenuFallback: false,
                    allowFallbackSelectionFetch: false
                  });

                  const retryRaw = retryResult?.raw || '';
                  const retryNormalized = retryResult?.normalized || '';

                  // Only update if we got a better result (with title)
                  if (retryRaw && retryRaw !== raw) {
                    setMenuState(retryRaw, retryNormalized || retryRaw, {
                      tabId,
                      url: retryTab.url
                    });
                    await refreshContextMenu();
                    logMenuEvent('onShown-retry-success', {
                      tabId,
                      oldKeyword: raw.substring(0, 50),
                      newKeyword: retryRaw.substring(0, 50),
                      title: retryTab.title
                    });
                  }
                }
              } catch (err) {
                logMenuEvent('onShown-retry-failed', {
                  tabId,
                  error: err?.message
                });
              }
            }, 150); // 150ms delay for title to update
          }
        }
      }
      if (raw || normalized) {
        await setMenuState(raw, normalized || raw, {
          tabId,
          url: freshTab?.url || tabUrl
        });
      }
    } catch (error) {
      logMenuEvent('context-onShown-error', {
        tabId,
        error: error?.message || String(error)
      });
    } finally {
      snapshotMenuTitles('onShown-final');
      // BUGFIX: Add delay before refresh to ensure Chrome updates its menu cache
      // This prevents showing stale menu items when onShown triggers
      if (chrome.contextMenus.refresh) {
        setTimeout(() => {
          chrome.contextMenus.refresh();
          logMenuEvent('onShown-refreshed-delayed', {
            timestamp: Date.now(),
            delayMs: 50
          });
        }, 50);
      }
    }
  })();
}
