/**
 * 侧边栏存活追踪（sidepanel-alive / welcome-watcher 端口）与开关状态消息。
 *
 * onConnect 监听在 events.js 注册，这里只提供 handler。
 */

// ========== 侧边栏存活追踪 ==========
// 通过 port 连接判断每个 window 的侧边栏是否打开
// 用于 popup 按钮显示「打开/关闭」相反状态 + 远程触发侧边栏自关闭
const sidePanelPortsByWindow = new Map(); // Map<windowId, Set<port>>

// 欢迎页订阅侧边栏开关状态——welcome 页停留时间长，需要 push 推送状态变化
const welcomePortsByWindow = new Map(); // Map<windowId, Set<port>>

function isSidePanelOpenInWindow(windowId) {
  const set = sidePanelPortsByWindow.get(windowId);
  return !!(set && set.size > 0);
}

function notifyWelcomeWatchers(windowId) {
  const watchers = welcomePortsByWindow.get(windowId);
  if (!watchers) return;
  const isOpen = isSidePanelOpenInWindow(windowId);
  for (const port of watchers) {
    try { port.postMessage({ action: 'sidePanelStateChanged', isOpen }); } catch (_) { /* port 已断 */ }
  }
}

// v1.6.15 预热：把 sidepanel 是否打开持久化到 chrome.storage.local，
// 让 popup 打开时即时显示「打开/关闭」按钮 label，不必等 sendMessage 回 SW（~50-300ms）。
function persistSidePanelState(windowId) {
  if (typeof windowId !== 'number') return;
  const isOpen = isSidePanelOpenInWindow(windowId);
  try {
    chrome.storage.local.set({ [`ccs_sp_open_${windowId}`]: isOpen });
  } catch (_) { /* best effort */ }
}

function ccsHandleRuntimeConnect(port) {
  // 侧边栏存活心跳——侧边栏页面打开就连，关闭就自动断
  if (port.name === 'sidepanel-alive') {
    let windowId = null;
    port.onMessage.addListener((msg) => {
      if (msg && typeof msg.windowId === 'number') {
        windowId = msg.windowId;
        if (!sidePanelPortsByWindow.has(windowId)) {
          sidePanelPortsByWindow.set(windowId, new Set());
        }
        sidePanelPortsByWindow.get(windowId).add(port);
        notifyWelcomeWatchers(windowId);   // 侧边栏开 → 通知 welcome 订阅者
        persistSidePanelState(windowId);   // v1.6.15: 同步到 storage 给 popup 即时读
      }
    });
    port.onDisconnect.addListener(() => {
      if (windowId !== null) {
        const set = sidePanelPortsByWindow.get(windowId);
        if (set) {
          set.delete(port);
          if (set.size === 0) sidePanelPortsByWindow.delete(windowId);
        }
        notifyWelcomeWatchers(windowId);   // 侧边栏关 → 通知 welcome 订阅者
        persistSidePanelState(windowId);   // v1.6.15: 同步到 storage 给 popup 即时读
      }
    });
    return;
  }

  // 欢迎页订阅侧边栏状态——一连上立即推送当前状态，之后实时更新
  if (port.name === 'welcome-watcher') {
    let windowId = null;
    port.onMessage.addListener((msg) => {
      if (msg && typeof msg.windowId === 'number') {
        windowId = msg.windowId;
        if (!welcomePortsByWindow.has(windowId)) {
          welcomePortsByWindow.set(windowId, new Set());
        }
        welcomePortsByWindow.get(windowId).add(port);
        // 立即把当前状态推过去，避免 welcome 页等下一次状态变化才知道
        try {
          port.postMessage({
            action: 'sidePanelStateChanged',
            isOpen: isSidePanelOpenInWindow(windowId)
          });
        } catch (_) { /* port 已断 */ }
      }
    });
    port.onDisconnect.addListener(() => {
      if (windowId !== null) {
        const set = welcomePortsByWindow.get(windowId);
        if (set) {
          set.delete(port);
          if (set.size === 0) welcomePortsByWindow.delete(windowId);
        }
      }
    });
    return;
  }
}

function ccsHandleGetSidePanelState(request, sender, sendResponse) {
  const windowId = request && typeof request.windowId === 'number' ? request.windowId : null;
  const set = windowId !== null ? sidePanelPortsByWindow.get(windowId) : null;
  const isOpen = !!(set && set.size > 0);
  sendResponse?.({ isOpen });
  return false;
}

function ccsHandleCloseSidePanel(request, sender, sendResponse) {
  const windowId = request && typeof request.windowId === 'number' ? request.windowId : null;
  const set = windowId !== null ? sidePanelPortsByWindow.get(windowId) : null;
  if (set) {
    for (const port of set) {
      try { port.postMessage({ action: 'close' }); } catch (_) { /* port 已断 */ }
    }
  }
  sendResponse?.({ ok: !!(set && set.size > 0) });
  return false;
}

ccsRegisterMessageHandlers({
  getSidePanelState: ccsHandleGetSidePanelState,
  closeSidePanel: ccsHandleCloseSidePanel
});
