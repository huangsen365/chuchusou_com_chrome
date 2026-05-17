// Preload extension UI scripts in an offscreen document so Chrome's extension
// script loader / AV scan cost is paid before the user opens popup/sidepanel.
(function () {
  'use strict';

  const TARGETS = [
    'popup/popup.boot.js',
    'sidepanel/sidepanel.boot.js',
    'popup/popup.bundle.js',
    'sidepanel/sidepanel.bundle.js'
  ];

  function loadScript(path) {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL(path);
      script.async = false;
      script.onload = () => resolve({ path, ok: true });
      script.onerror = () => resolve({ path, ok: false });
      document.head.appendChild(script);
    });
  }

  async function run() {
    const startedAt = performance.now();
    const results = [];
    for (const path of TARGETS) {
      results.push(await loadScript(path));
    }
    try {
      await chrome.runtime.sendMessage({
        action: 'ccsUiPrewarmDone',
        elapsedMs: Math.round(performance.now() - startedAt),
        results
      });
    } catch (_) {
      // SW may have gone idle; prewarm still served its purpose.
    }
  }

  run();
})();
