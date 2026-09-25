/**
 * 诊断消息：SW round-trip ping、菜单图标状态、调试开关、导出菜单调试信息。
 */

// v1.6.22 诊断 ping：极轻量，仅用于测 popup → SW 端到端 round-trip。
// popup 发送时记 sentAt，收到响应时 Date.now() - sentAt = SW round-trip 含冷启。
function ccsHandleDiagPing(request, sender, sendResponse) {
  try {
    sendResponse?.({
      ok: true,
      swNow: Date.now(),
      swVersion: chrome.runtime.getManifest().version
    });
  } catch (_) { /* sendResponse race */ }
  return false;
}

function ccsHandleLogMenuIcons(request, sender, sendResponse) {
  const requestId = ccsGetRequestId(request, 'ccs-log-menu-icons');
  const respond = ccsCreateSafeResponder(sendResponse, 'ccs-log-menu-icons', requestId, 4000);
  ccsLogMessage('request', 'ccs-log-menu-icons', requestId);
  loadMenuIconConfig().then((config) => {
    const info = {
      BG_DEBUG,
      iconConfig: config,
      iconMapKeys: Array.from(optimizedPromptMenuMap.keys()),
      cacheSize: menuIconImageCache.size,
      buildCounter: menuBuildCounter,
      timestamp: Date.now()
    };
    console.log('[触触搜][BG][ICON] 状态报告', info);
    respond({ ok: true, info });
  }).catch((err) => {
    console.warn('[触触搜][BG][ICON] 状态报告失败', err);
    respond({ ok: false, error: err?.message || String(err) });
  });
  return true;
}

function ccsHandleUpdateDebug(request, sender, sendResponse) {
  BG_DEBUG = !!request.enabled;
  chrome.storage.local.set({ ccs_debug: BG_DEBUG });
  sendResponse && sendResponse({ ok: true });
  return; // stop further handling
}

// 处理popup的菜单调试信息导出请求
function ccsHandleGetMenuDebugInfo(request, sender, sendResponse) {
  const requestId = ccsGetRequestId(request, 'getMenuDebugInfo');
  const respond = ccsCreateSafeResponder(sendResponse, 'getMenuDebugInfo', requestId, 5000);
  const tabId = request.tabId;
  getMenuDebugInfo(tabId)
    .then(data => {
      respond({ success: true, data });
    })
    .catch(error => {
      console.error('[触触搜][BG] 获取菜单调试信息失败:', error);
      respond({ success: false, error: error?.message || String(error), code: 'MENU_DEBUG_FAILED' });
    });
  return true; // 异步响应
}

ccsRegisterMessageHandlers({
  ccsDiagPing: ccsHandleDiagPing,
  'ccs-log-menu-icons': ccsHandleLogMenuIcons,
  updateDebug: ccsHandleUpdateDebug,
  getMenuDebugInfo: ccsHandleGetMenuDebugInfo
});
