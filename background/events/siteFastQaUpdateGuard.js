/**
 * 扩展升级后接管旧页面上的站点速答按钮（onInstalled update 时由 events.js 调用）。
 */

/**
 * 扩展升级不会刷新已打开的网站标签：旧 content script 的扩展上下文会失效，
 * 但它插入的 X / 知乎速答按钮仍留在 DOM。这里由新版本 SW 往旧页面注入一个
 * 极小的升级守卫，接管旧按钮点击并让用户自行刷新，避免暴露
 * `runtime-unavailable`，也避免未经同意自动刷新而丢失页面状态。
 *
 * 守卫只处理版本标记缺失/不等于当前版本的按钮；刷新后由 manifest 正常加载
 * 的新版按钮不会被拦截。函数必须完全自包含，供 scripting.executeScript 序列化。
 */
function ccsInstallSiteFastQaUpdateGuardInPage(currentVersion) {
  const BUTTON_SELECTOR = '[data-ccs-site-fastqa]';
  const VERSION_ATTR = 'data-ccs-site-fastqa-version';
  const STALE_ATTR = 'data-ccs-site-fastqa-stale-update';
  const TOAST_ID = 'ccs-site-fastqa-update-toast';
  const STYLE_ID = 'ccs-site-fastqa-update-guard-style';
  const GLOBAL_KEY = '__ccsSiteFastQaUpdateGuard';
  const globalScope = globalThis;

  const previous = globalScope[GLOBAL_KEY];
  if (previous?.version === currentVersion) {
    previous.scan?.();
    return { installed: false, reused: true, staleButtons: previous.count?.() || 0 };
  }
  previous?.dispose?.();

  const isStale = (button) => button.getAttribute(VERSION_ATTR) !== currentVersion;

  const markButton = (button) => {
    if (!(button instanceof Element) || button.tagName !== 'BUTTON') return;
    if (!isStale(button)) {
      button.removeAttribute(STALE_ATTR);
      return;
    }
    if (button.getAttribute(STALE_ATTR) !== 'true') button.setAttribute(STALE_ATTR, 'true');
    if (button.disabled) button.disabled = false;
    if (button.getAttribute('aria-disabled') !== 'false') button.setAttribute('aria-disabled', 'false');
    if (button.dataset.ccsState !== 'upgrade-required') button.dataset.ccsState = 'upgrade-required';
    const title = '扩展已升级，点击刷新页面后继续使用速答';
    if (button.title !== title) button.title = title;
    const host = button.closest('[data-ccs-site-fastqa-host]');
    if (host && host.title !== title) host.title = title;
  };

  const scanRoot = (root) => {
    if (root instanceof Element && root.matches(BUTTON_SELECTOR)) markButton(root);
    root.querySelectorAll?.(BUTTON_SELECTOR).forEach(markButton);
  };

  const scan = () => scanRoot(document);
  const count = () => Array.from(document.querySelectorAll(BUTTON_SELECTOR)).filter(isStale).length;

  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${TOAST_ID} {
        position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
        display: flex; max-width: 360px; align-items: center; gap: 10px;
        box-sizing: border-box; padding: 12px 14px; border-radius: 8px;
        background: rgba(32, 33, 36, .96); color: #fff;
        font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 6px 24px rgba(0, 0, 0, .28);
      }
      #${TOAST_ID} button {
        flex: none; border: 0; border-radius: 6px; padding: 6px 10px;
        font: inherit; cursor: pointer;
      }
      #${TOAST_ID} [data-ccs-site-fastqa-refresh] { background: #fff; color: #202124; font-weight: 600; }
      #${TOAST_ID} [data-ccs-site-fastqa-dismiss] { background: transparent; color: #d7d7d7; padding-inline: 4px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  };

  const showRefreshToast = () => {
    const existing = document.getElementById(TOAST_ID);
    if (existing) return existing;
    ensureStyle();
    const toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    const message = document.createElement('span');
    message.textContent = '扩展已升级，请刷新当前页面后继续使用速答。';
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.setAttribute('data-ccs-site-fastqa-refresh', 'true');
    refresh.textContent = '刷新页面';
    refresh.addEventListener('click', () => location.reload());
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.setAttribute('data-ccs-site-fastqa-dismiss', 'true');
    dismiss.setAttribute('aria-label', '稍后刷新');
    dismiss.textContent = '稍后';
    dismiss.addEventListener('click', () => toast.remove());
    toast.append(message, refresh, dismiss);
    (document.body || document.documentElement).appendChild(toast);
    return toast;
  };

  const handleClick = (event) => {
    const target = event.target instanceof Element ? event.target.closest(BUTTON_SELECTOR) : null;
    if (!target || !isStale(target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showRefreshToast();
  };

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes') markButton(mutation.target);
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) scanRoot(node);
      });
    });
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled', 'aria-disabled', 'data-ccs-state', VERSION_ATTR]
  });
  document.addEventListener('click', handleClick, true);
  scan();

  globalScope[GLOBAL_KEY] = {
    version: currentVersion,
    scan,
    count,
    dispose: () => {
      observer.disconnect();
      document.removeEventListener('click', handleClick, true);
    }
  };
  return { installed: true, reused: false, staleButtons: count() };
}

async function ccsInstallSiteFastQaUpdateGuards() {
  const currentVersion = chrome.runtime.getManifest().version;
  const urlPatterns = [
    '*://x.com/*',
    '*://*.x.com/*',
    '*://twitter.com/*',
    '*://*.twitter.com/*',
    '*://zhihu.com/*',
    '*://*.zhihu.com/*'
  ];
  try {
    const tabs = await chrome.tabs.query({ url: urlPatterns });
    const eligibleTabs = tabs.filter((tab) => tab.id != null);
    const results = await Promise.allSettled(eligibleTabs.map((tab) =>
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: ccsInstallSiteFastQaUpdateGuardInPage,
        args: [currentVersion]
      })
    ));
    const installed = results.filter((result) => result.status === 'fulfilled').length;
    globalThis.logMenuEvent?.('site-fastqa-update-guards', {
      version: currentVersion,
      eligibleTabs: eligibleTabs.length,
      installed,
      failed: results.length - installed
    });
    return { eligibleTabs: eligibleTabs.length, installed, failed: results.length - installed };
  } catch (error) {
    globalThis.logMenuEvent?.('site-fastqa-update-guards-error', {
      version: currentVersion,
      error: error?.message || String(error)
    });
    return { eligibleTabs: 0, installed: 0, failed: 1 };
  }
}
