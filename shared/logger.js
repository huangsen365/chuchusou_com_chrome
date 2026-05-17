(function () {
  'use strict';

  const TRACE_KEY = 'ccs_trace_buffer';
  const TRACE_LIMIT = 200;
  const EXTENSION_LABEL = 'extension';
  const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

  let debugEnabled = false;
  let debugLoaded = false;

  function getChrome() {
    try { return globalThis.chrome || null; } catch (_) { return null; }
  }

  function createRequestId(prefix = 'req') {
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix}-${Date.now().toString(36)}-${rand}`;
  }

  function normalizeLevel(level) {
    return Object.prototype.hasOwnProperty.call(LEVELS, level) ? level : 'info';
  }

  function shouldWriteConsole(level) {
    if (debugEnabled) return true;
    return level === 'warn' || level === 'error';
  }

  function format(module, phase, requestId, message) {
    return `[${EXTENSION_LABEL}][${module || 'app'}][${phase || 'log'}][${requestId || '-'}] ${message || ''}`;
  }

  function writeTrace(record) {
    const ch = getChrome();
    const storage = ch?.storage?.session || ch?.storage?.local;
    if (!storage?.get || !storage?.set) return;

    try {
      storage.get([TRACE_KEY], (data) => {
        const current = Array.isArray(data?.[TRACE_KEY]) ? data[TRACE_KEY] : [];
        current.push(record);
        const next = current.slice(-TRACE_LIMIT);
        storage.set({ [TRACE_KEY]: next }, () => {
          // Best effort only. Do not log recursively from the logger.
          try { void ch.runtime?.lastError; } catch (_) { /* noop */ }
        });
      });
    } catch (_) {
      // Best effort only.
    }
  }

  function log(level, module, phase, requestId, message, data) {
    const normalized = normalizeLevel(level);
    const record = {
      ts: Date.now(),
      level: normalized,
      module: module || 'app',
      phase: phase || 'log',
      requestId: requestId || '',
      message: message || '',
      data: typeof data === 'undefined' ? null : data
    };

    const line = format(record.module, record.phase, record.requestId, record.message);
    if (shouldWriteConsole(normalized)) {
      const method = normalized === 'error' ? 'error' : normalized === 'warn' ? 'warn' : 'log';
      try {
        if (typeof data === 'undefined') console[method](line);
        else console[method](line, data);
      } catch (_) {
        // Console can be unavailable in some extension contexts.
      }
    }

    if (debugEnabled || normalized !== 'debug') {
      writeTrace(record);
    }
  }

  function setDebug(enabled) {
    debugEnabled = !!enabled;
    debugLoaded = true;
  }

  function init() {
    if (debugLoaded) return;
    const ch = getChrome();
    try {
      ch?.storage?.local?.get?.(['ccs_debug'], (data) => {
        setDebug(!!data?.ccs_debug);
      });
      ch?.storage?.onChanged?.addListener?.((changes, areaName) => {
        if (areaName !== 'local' || !changes.ccs_debug) return;
        setDebug(!!changes.ccs_debug.newValue);
      });
    } catch (_) {
      setDebug(false);
    }
  }

  function getTraceBuffer() {
    const ch = getChrome();
    const storage = ch?.storage?.session || ch?.storage?.local;
    return new Promise((resolve) => {
      if (!storage?.get) { resolve([]); return; }
      try {
        storage.get([TRACE_KEY], (data) => {
          resolve(Array.isArray(data?.[TRACE_KEY]) ? data[TRACE_KEY] : []);
        });
      } catch (_) {
        resolve([]);
      }
    });
  }

  function clearTraceBuffer() {
    const ch = getChrome();
    const storage = ch?.storage?.session || ch?.storage?.local;
    return new Promise((resolve) => {
      if (!storage?.remove) { resolve(); return; }
      try { storage.remove([TRACE_KEY], () => resolve()); } catch (_) { resolve(); }
    });
  }

  const api = {
    createRequestId,
    format,
    init,
    setDebug,
    getTraceBuffer,
    clearTraceBuffer,
    debug: (module, phase, requestId, message, data) => log('debug', module, phase, requestId, message, data),
    info: (module, phase, requestId, message, data) => log('info', module, phase, requestId, message, data),
    warn: (module, phase, requestId, message, data) => log('warn', module, phase, requestId, message, data),
    error: (module, phase, requestId, message, data) => log('error', module, phase, requestId, message, data)
  };

  globalThis.CCSLogger = api;
  api.init();
})();
