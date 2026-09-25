(function () {
  'use strict';

  const DEFAULT_RUNTIME_TIMEOUT_MS = 1500;
  const DEFAULT_TAB_TIMEOUT_MS = 900;
  const CONTENT_BOOT_DELAY_MS = 100;

  const ErrorCodes = {
    TIMEOUT: 'TIMEOUT',
    RUNTIME_UNAVAILABLE: 'RUNTIME_UNAVAILABLE',
    SW_UNAVAILABLE: 'SW_UNAVAILABLE',
    CONTENT_UNAVAILABLE: 'CONTENT_UNAVAILABLE',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    SEND_FAILED: 'SEND_FAILED'
  };

  function logger() {
    return globalThis.CCSLogger || {
      createRequestId: (prefix) => `${prefix || 'req'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {}
    };
  }

  function getChrome() {
    try { return globalThis.chrome || null; } catch (_) { return null; }
  }

  function elapsed(startedAt) {
    return Date.now() - startedAt;
  }

  function makeError(code, message, cause) {
    return {
      code,
      message: message || code,
      cause: cause ? String(cause) : undefined
    };
  }

  function normalizeResponse(response, requestId, startedAt) {
    if (response && typeof response === 'object' && response.ok === false) {
      return {
        ...response,
        requestId: response.requestId || requestId,
        elapsedMs: response.elapsedMs ?? elapsed(startedAt)
      };
    }
    if (response && typeof response === 'object' && response.ok === true && Object.prototype.hasOwnProperty.call(response, 'data')) {
      return {
        ...response,
        requestId: response.requestId || requestId,
        elapsedMs: response.elapsedMs ?? elapsed(startedAt)
      };
    }
    return {
      ok: true,
      data: response,
      requestId,
      elapsedMs: elapsed(startedAt)
    };
  }

  function isReceivingEndError(message) {
    return /Receiving end does not exist|Could not establish connection|message port closed|Extension context invalidated/i.test(message || '');
  }

  function isPermissionError(message) {
    return /Cannot access|The extensions gallery cannot be scripted|chrome:\/\/|Cannot access contents of url|permission/i.test(message || '');
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function sendRuntimeMessage(message, options = {}) {
    const ch = getChrome();
    const log = logger();
    const action = message?.action || message?.type || 'runtime-message';
    const requestId = options.requestId || message?.requestId || log.createRequestId(action);
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_RUNTIME_TIMEOUT_MS;
    const retries = Number.isFinite(options.retries) ? options.retries : 0;
    const startedAt = Date.now();

    if (!ch?.runtime?.sendMessage) {
      return Promise.resolve({
        ok: false,
        error: makeError(ErrorCodes.RUNTIME_UNAVAILABLE, 'chrome.runtime.sendMessage unavailable'),
        requestId,
        elapsedMs: elapsed(startedAt)
      });
    }

    const payload = { ...(message || {}), requestId };

    function attempt(remainingRetries) {
      log.debug('runtime', 'send', requestId, action, { timeoutMs, remainingRetries });
      return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          log.warn('runtime', 'timeout', requestId, action, { timeoutMs });
          resolve({
            ok: false,
            error: makeError(ErrorCodes.TIMEOUT, `${action} timed out after ${timeoutMs}ms`),
            requestId,
            elapsedMs: elapsed(startedAt)
          });
        }, timeoutMs);

        try {
          ch.runtime.sendMessage(payload, (response) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);

            const lastError = ch.runtime.lastError?.message || '';
            if (lastError) {
              const code = isReceivingEndError(lastError) ? ErrorCodes.SW_UNAVAILABLE : ErrorCodes.SEND_FAILED;
              log.warn('runtime', 'lastError', requestId, action, { code, message: lastError });
              resolve({
                ok: false,
                error: makeError(code, lastError),
                requestId,
                elapsedMs: elapsed(startedAt)
              });
              return;
            }

            const normalized = normalizeResponse(response, requestId, startedAt);
            log.debug('runtime', normalized.ok ? 'response' : 'error', requestId, action, normalized.ok ? undefined : normalized.error);
            resolve(normalized);
          });
        } catch (error) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          log.warn('runtime', 'exception', requestId, action, { message: error?.message || String(error) });
          resolve({
            ok: false,
            error: makeError(ErrorCodes.SEND_FAILED, error?.message || String(error)),
            requestId,
            elapsedMs: elapsed(startedAt)
          });
        }
      }).then(async (result) => {
        if (result.ok || remainingRetries <= 0) return result;
        if (![ErrorCodes.TIMEOUT, ErrorCodes.SW_UNAVAILABLE].includes(result.error?.code)) return result;
        await delay(options.retryDelayMs || 120);
        return attempt(remainingRetries - 1);
      });
    }

    return attempt(retries);
  }

  async function executeContentScript(tabId, files) {
    const ch = getChrome();
    if (tabId == null || !ch?.scripting?.executeScript) return false;
    try {
      await ch.scripting.executeScript({
        target: { tabId },
        files: files || ['content.js']
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  function sendTabMessage(tabId, message, options = {}) {
    const ch = getChrome();
    const log = logger();
    const action = message?.action || message?.type || 'tab-message';
    const requestId = options.requestId || message?.requestId || log.createRequestId(action);
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TAB_TIMEOUT_MS;
    const injectFallback = options.injectFallback !== false;
    const startedAt = Date.now();

    if (tabId == null || !ch?.tabs?.sendMessage) {
      return Promise.resolve({
        ok: false,
        error: makeError(ErrorCodes.CONTENT_UNAVAILABLE, 'tabId or chrome.tabs.sendMessage unavailable'),
        requestId,
        elapsedMs: elapsed(startedAt)
      });
    }

    const payload = { ...(message || {}), requestId };

    function attempt(allowInject) {
      log.debug('tab', 'send', requestId, action, { tabId, timeoutMs, allowInject });
      return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          log.warn('tab', 'timeout', requestId, action, { tabId, timeoutMs });
          resolve({
            ok: false,
            error: makeError(ErrorCodes.TIMEOUT, `${action} timed out after ${timeoutMs}ms`),
            requestId,
            elapsedMs: elapsed(startedAt)
          });
        }, timeoutMs);

        try {
          ch.tabs.sendMessage(tabId, payload, (response) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);

            const lastError = ch.runtime?.lastError?.message || '';
            if (lastError) {
              const code = isPermissionError(lastError)
                ? ErrorCodes.PERMISSION_DENIED
                : ErrorCodes.CONTENT_UNAVAILABLE;
              log.warn('tab', 'lastError', requestId, action, { tabId, code, message: lastError });
              resolve({
                ok: false,
                error: makeError(code, lastError),
                requestId,
                elapsedMs: elapsed(startedAt)
              });
              return;
            }

            resolve(normalizeResponse(response, requestId, startedAt));
          });
        } catch (error) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            ok: false,
            error: makeError(ErrorCodes.SEND_FAILED, error?.message || String(error)),
            requestId,
            elapsedMs: elapsed(startedAt)
          });
        }
      }).then(async (result) => {
        if (result.ok || !allowInject || !injectFallback) return result;
        const messageText = result.error?.message || '';
        if (result.error?.code !== ErrorCodes.CONTENT_UNAVAILABLE && !isReceivingEndError(messageText)) return result;
        const injected = await executeContentScript(tabId, options.injectFiles || ['content.js']);
        if (!injected) return result;
        await delay(options.injectDelayMs || CONTENT_BOOT_DELAY_MS);
        return attempt(false);
      });
    }

    return attempt(true);
  }

  globalThis.CCSRuntimeClient = {
    ErrorCodes,
    sendRuntimeMessage,
    sendTabMessage,
    executeContentScript
  };
})();
