/**
 * SW 事件接线：所有 chrome.* 监听都在这里按原顺序注册，handler 分别在
 * background/events/*.js（importScripts 顺序见 src/background.ts，本文件必须最后加载）。
 *
 *   runtime.onInstalled / onStartup → createContextMenus（menuBuilderAttach.ts）+ 欢迎页 / 升级守卫
 *   runtime.onConnect              → ccsHandleRuntimeConnect（events/sidePanel.js）
 *   runtime.onMessage              → ccsDispatchMessage（events/messaging.js 分发表，各领域文件登记）
 *   tabs.onUpdated / onActivated / onRemoved → events/tabs.js
 *   contextMenus.onShown           → events/contextMenuShown.js
 */

chrome.runtime.onInstalled.addListener(createContextMenus);

// 首次安装时弹欢迎页（更新时不弹，避免老用户被打扰）
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') });
  } else if (details.reason === 'update') {
    void ccsInstallSiteFastQaUpdateGuards();
  }
});
if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(createContextMenus);
}

// 预加载调试开关与图标支持状态
ensureMenuIconSupportLoaded();

chrome.runtime.onConnect.addListener(ccsHandleRuntimeConnect);

// 监听来自content script和popup的消息
chrome.runtime.onMessage.addListener(ccsDispatchMessage);

chrome.tabs.onUpdated.addListener(ccsOnTabUpdated);

chrome.tabs.onActivated.addListener(ccsOnTabActivated);

chrome.tabs.onRemoved.addListener(ccsOnTabRemoved);

if (chrome.contextMenus.onShown) {
  chrome.contextMenus.onShown.addListener(ccsOnContextMenuShown);
}

// ==================== 导出到全局 ====================

globalThis.prefetchMenuState = prefetchMenuState;
globalThis.syncSelectionFromTab = syncSelectionFromTab;
