/**
 * URL 过长导致 431/404 后的恢复页消息。
 *
 * 业务实现在 background/urlSafety.js。
 */

function ccsHandleGetUrlRecovery(request, sender, sendResponse) {
  const tabId = typeof sender?.tab?.id === 'number' ? sender.tab.id : null;
  const respond = ccsCreateSafeResponder(sendResponse, 'ccsGetUrlRecovery', ccsCreateRequestId('ccsGetUrlRecovery'), 3000);
  if (tabId == null || typeof ccsReadUrlRecoveryForTab !== 'function') {
    respond({ ok: false, error: 'missing-tab' });
    return true;
  }
  ccsReadUrlRecoveryForTab(tabId)
    .then((record) => {
      if (!record || !(record.statusCode || record.error)) {
        respond({ ok: false, error: 'recovery-not-found' });
        return;
      }
      const summary = typeof ccsSummarizeUrlRecovery === 'function'
        ? ccsSummarizeUrlRecovery(record)
        : record;
      respond({ ok: true, recovery: summary });
    })
    .catch((error) => respond({ ok: false, error: error?.message || String(error) }));
  return true;
}

function ccsHandleGetUrlRecoveryText(request, sender, sendResponse) {
  const recoveryId = typeof request.recoveryId === 'string' ? request.recoveryId : '';
  const field = request.field === 'effective' ? 'effective' : 'original';
  const respond = ccsCreateSafeResponder(sendResponse, 'ccsGetUrlRecoveryText', recoveryId || ccsCreateRequestId('ccsGetUrlRecoveryText'), 3000);
  if (!recoveryId || typeof ccsGetUrlRecoveryText !== 'function') {
    respond({ ok: false, error: 'missing-recovery-id' });
    return true;
  }
  ccsGetUrlRecoveryText(recoveryId, field)
    .then((text) => {
      if (typeof text !== 'string') {
        respond({ ok: false, error: 'recovery-not-found' });
        return;
      }
      respond({ ok: true, text });
    })
    .catch((error) => respond({ ok: false, error: error?.message || String(error) }));
  return true;
}

function ccsHandleOpenUrlRecoverySafe(request, sender, sendResponse) {
  const recoveryId = typeof request.recoveryId === 'string' ? request.recoveryId : '';
  const respond = ccsCreateSafeResponder(sendResponse, 'ccsOpenUrlRecoverySafe', recoveryId || ccsCreateRequestId('ccsOpenUrlRecoverySafe'), 5000);
  if (!recoveryId || typeof ccsOpenUrlRecoverySafe !== 'function') {
    respond({ ok: false, error: 'missing-recovery-id' });
    return true;
  }
  ccsOpenUrlRecoverySafe(recoveryId, { active: true })
    .then((result) => respond(result || { ok: false, error: 'open-failed' }))
    .catch((error) => respond({ ok: false, error: error?.message || String(error) }));
  return true;
}

function ccsHandleDismissUrlRecovery(request, sender, sendResponse) {
  const tabId = typeof sender?.tab?.id === 'number' ? sender.tab.id : null;
  if (tabId != null && typeof ccsClearUrlRecoveryForTab === 'function') {
    ccsClearUrlRecoveryForTab(tabId).catch(() => {});
  }
  sendResponse?.({ ok: true });
  return true;
}

ccsRegisterMessageHandlers({
  ccsGetUrlRecovery: ccsHandleGetUrlRecovery,
  ccsGetUrlRecoveryText: ccsHandleGetUrlRecoveryText,
  ccsOpenUrlRecoverySafe: ccsHandleOpenUrlRecoverySafe,
  ccsDismissUrlRecovery: ccsHandleDismissUrlRecovery
});
