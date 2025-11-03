(async () => {
  if (!chrome?.runtime?.getManifest) {
    console.log('[触触搜][脚本] chrome API unavailable');
    return;
  }
  if (!chrome.runtime.getManifest().background?.service_worker) {
    console.log('[触触搜][脚本] 当前扩展没有 Service Worker');
    return;
  }
  chrome.runtime.sendMessage({ action: 'ccs-log-menu-icons' }, (resp) => {
    console.log('[触触搜][脚本] Sent log request, response:', resp);
  });
})();
