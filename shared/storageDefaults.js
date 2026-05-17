(function () {
  'use strict';

  const DEFAULT_SETTINGS = {
    mode: 'normal',
    theme: 'default',
    opacity: 1,
    position: null,
    layout: 'float',
    globalDock: false,
    barClosed: false,
    blacklist: [],
    isBlacklisted: false,
    miniButtons: ['baidu', 'google', 'chuchusou', 'copy', 'lowercase'],
    shortcutKey: 'Alt+S'
  };

  const DEFAULTS = {
    enabled: true,
    ccs_debug: false,
    ccs_voice_enabled: false,
    ccs_schema_version: 1,
    ccs_settings: DEFAULT_SETTINGS
  };

  function getChrome() {
    try { return globalThis.chrome || null; } catch (_) { return null; }
  }

  function log(level, phase, requestId, message, data) {
    const logger = globalThis.CCSLogger;
    if (logger?.[level]) logger[level]('storage', phase, requestId, message, data);
  }

  function ensureDefaults(options = {}) {
    const ch = getChrome();
    const requestId = options.requestId || globalThis.CCSLogger?.createRequestId?.('storage-defaults') || `storage-${Date.now()}`;
    const source = options.source || 'unknown';

    return new Promise((resolve) => {
      const local = ch?.storage?.local;
      if (!local?.get || !local?.set) {
        resolve({ ok: false, patched: [], error: 'storage-unavailable', requestId });
        return;
      }

      const keys = Object.keys(DEFAULTS);
      log('debug', 'defaults-start', requestId, 'checking defaults', { source, keys });
      try {
        local.get(keys, (current) => {
          const lastError = ch.runtime?.lastError?.message || '';
          if (lastError) {
            log('warn', 'defaults-read-error', requestId, lastError, { source });
            resolve({ ok: false, patched: [], error: lastError, requestId });
            return;
          }

          const patch = {};
          keys.forEach((key) => {
            if (typeof current?.[key] === 'undefined') patch[key] = DEFAULTS[key];
          });

          if (Object.keys(patch).length === 0) {
            resolve({ ok: true, patched: [], requestId });
            return;
          }

          local.set(patch, () => {
            const writeError = ch.runtime?.lastError?.message || '';
            if (writeError) {
              log('warn', 'defaults-write-error', requestId, writeError, { source, patch: Object.keys(patch) });
              resolve({ ok: false, patched: Object.keys(patch), error: writeError, requestId });
              return;
            }
            log('info', 'defaults-written', requestId, 'storage defaults patched', { source, keys: Object.keys(patch) });
            resolve({ ok: true, patched: Object.keys(patch), requestId });
          });
        });
      } catch (error) {
        const message = error?.message || String(error);
        log('warn', 'defaults-exception', requestId, message, { source });
        resolve({ ok: false, patched: [], error: message, requestId });
      }
    });
  }

  globalThis.CCSStorageDefaults = {
    DEFAULTS,
    DEFAULT_SETTINGS,
    ensureDefaults
  };
})();
