/**
 * SW 消息基础设施：分发表 + requestId / 日志 / 安全 sendResponse / 发往标签页的重试。
 */

// ==================== 消息分发表 ====================
// events.js 的 chrome.runtime.onMessage 只做一件事：按 request.action 查这张表。
// 各领域文件（background/events/*.js）在加载时登记自己的 handler；同一个 action
// 只能登记一次。handler 的返回值原样交给 Chrome（true = 异步 sendResponse）。
const CCS_MESSAGE_HANDLERS = new Map();

function ccsRegisterMessageHandlers(handlers) {
  for (const [action, handler] of Object.entries(handlers)) {
    if (typeof handler !== 'function') {
      throw new Error(`[触触搜][BG] message handler for "${action}" is not a function`);
    }
    if (CCS_MESSAGE_HANDLERS.has(action)) {
      throw new Error(`[触触搜][BG] duplicate message handler for "${action}"`);
    }
    CCS_MESSAGE_HANDLERS.set(action, handler);
  }
}

function ccsDispatchMessage(request, sender, sendResponse) {
  const handler = CCS_MESSAGE_HANDLERS.get(request.action);
  if (!handler) return undefined;
  return handler(request, sender, sendResponse);
}

function ccsCreateRequestId(action) {
  return `${action || 'msg'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function ccsGetRequestId(request, action) {
  return request?.requestId || ccsCreateRequestId(action);
}

function ccsLogMessage(phase, action, requestId, payload, level = 'debug') {
  const shouldLog = level === 'warn' || level === 'error' || BG_DEBUG;
  if (!shouldLog) return;
  const line = `[extension][background][${phase}][${requestId || '-'}] ${action || 'message'}`;
  if (level === 'error') console.error(line, payload || '');
  else if (level === 'warn') console.warn(line, payload || '');
  else console.log(line, payload || '');
}

function ccsAttachRequestId(payload, requestId) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  if (Object.prototype.hasOwnProperty.call(payload, 'requestId')) return payload;
  return { ...payload, requestId };
}

function ccsCreateSafeResponder(sendResponse, action, requestId, timeoutMs = 5000) {
  let responded = false;
  const startedAt = Date.now();
  const timer = setTimeout(() => {
    if (responded) return;
    responded = true;
    ccsLogMessage('timeout', action, requestId, { timeoutMs }, 'warn');
    try {
      sendResponse?.({
        success: false,
        ok: false,
        error: 'timeout',
        code: 'TIMEOUT',
        requestId,
        elapsedMs: Date.now() - startedAt
      });
    } catch (_) { /* port closed */ }
  }, timeoutMs);

  return (payload) => {
    if (responded) return;
    responded = true;
    clearTimeout(timer);
    const nextPayload = ccsAttachRequestId(payload, requestId);
    ccsLogMessage('response', action, requestId, {
      elapsedMs: Date.now() - startedAt,
      success: nextPayload?.success,
      ok: nextPayload?.ok,
      error: nextPayload?.error || nextPayload?.code
    });
    try { sendResponse?.(nextPayload); } catch (_) { /* port closed */ }
  };
}

async function ccsSendTabMessageWithFallback(tabId, message, reason) {
  if (tabId == null) {
    return { ok: false, code: 'NO_TAB', error: 'missing tabId' };
  }
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return { ok: true };
  } catch (error) {
    const firstError = error?.message || String(error);
    if (!/Receiving end does not exist|Could not establish connection|message port closed/i.test(firstError)) {
      return { ok: false, code: 'CONTENT_MESSAGE_FAILED', error: firstError };
    }
    const reinjected = await reinjectContentForTab(tabId, reason || 'message-fallback');
    if (!reinjected) {
      return { ok: false, code: 'CONTENT_UNAVAILABLE', error: firstError };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      await chrome.tabs.sendMessage(tabId, message);
      return { ok: true, reinjected: true };
    } catch (retryError) {
      return {
        ok: false,
        code: 'CONTENT_UNAVAILABLE',
        error: retryError?.message || String(retryError)
      };
    }
  }
}
