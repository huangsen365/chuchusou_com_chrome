(function() {
  'use strict';

  window.CCSModules = window.CCSModules || {};

  const RUNTIME_UNAVAILABLE_MESSAGE = '扩展刚完成升级，请刷新当前页面后再试';
  const RUNTIME_ERROR_PATTERN =
    /runtime-unavailable|Extension context invalidated|Receiving end does not exist|Could not establish connection|message port closed/i;

  function currentRuntimeVersion() {
    try {
      const runtime = globalThis.chrome?.runtime;
      return runtime?.id ? runtime.getManifest?.().version || '' : '';
    } catch (_) {
      return '';
    }
  }

  const runtimeVersion = currentRuntimeVersion();

  function toUserFacingError(error) {
    const message = error instanceof Error ? error.message : String(error || '');
    return RUNTIME_ERROR_PATTERN.test(message)
      ? RUNTIME_UNAVAILABLE_MESSAGE
      : message || '速答启动失败';
  }

  function createFastQaIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('data-ccs-site-fastqa-icon', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M13.2 2.5 5.4 13h5.7l-.5 8.5L18.7 10H13l.2-7.5Z');
    svg.appendChild(path);
    return svg;
  }

  function ensureStyles(adapter) {
    if (document.getElementById(adapter.styleId)) return;
    const style = document.createElement('style');
    style.id = adapter.styleId;
    style.textContent = `
      [data-ccs-site-fastqa="${adapter.id}"] [data-ccs-site-fastqa-spinner] {
        display: none;
        width: 15px;
        height: 15px;
        box-sizing: border-box;
        border: 2px solid currentColor;
        border-right-color: transparent;
        border-radius: 50%;
        animation: ccs-site-fastqa-spin 720ms linear infinite;
      }
      [data-ccs-site-fastqa="${adapter.id}"][data-ccs-state="busy"]
        [data-ccs-site-fastqa-icon] { display: none; }
      [data-ccs-site-fastqa="${adapter.id}"][data-ccs-state="busy"]
        [data-ccs-site-fastqa-spinner] { display: block; }
      @keyframes ccs-site-fastqa-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        [data-ccs-site-fastqa="${adapter.id}"] [data-ccs-site-fastqa-spinner] {
          animation: none;
        }
      }
      ${adapter.styles}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function sendToChatGpt(keyword) {
    return new Promise((resolve) => {
      try {
        const runtime = globalThis.chrome?.runtime;
        if (!runtime?.id) {
          resolve({
            success: false,
            code: 'EXTENSION_CONTEXT_INVALIDATED',
            error: RUNTIME_UNAVAILABLE_MESSAGE
          });
          return;
        }
        runtime.sendMessage({
          action: 'executeMenuAction',
          menuItemId: 'ccs-fastqa-chatgpt-quick',
          menuType: 'fastqa-quick',
          engineId: 'chatgpt',
          keyword
        }, (response) => {
          if (runtime.lastError) {
            resolve({
              success: false,
              error: toUserFacingError(runtime.lastError.message || 'runtime-error')
            });
            return;
          }
          resolve(response || { success: false, error: 'empty-response' });
        });
      } catch (error) {
        resolve({ success: false, error: toUserFacingError(error) });
      }
    });
  }

  function mutationElement(target) {
    return target instanceof Element ? target : target.parentElement;
  }

  function start(adapter) {
    try {
      if (window.top !== window || !adapter.isSupported()) return () => {};
    } catch (_) {
      return () => {};
    }

    const buttonSelector = `[data-ccs-site-fastqa="${adapter.id}"]`;
    const hostSelector = `[data-ccs-site-fastqa-host="${adapter.id}"]`;
    const ownsElement = adapter.ownsElement || ((element, root) => root.contains(element));
    const activeActions = new Map();
    const resetTimers = new Map();
    let stopped = false;
    let observer = null;
    let scheduled = false;

    const actionContainers = (root) => {
      const candidates = adapter.findActionContainers?.(root) || [adapter.findActionContainer(root)];
      return Array.from(new Set(candidates.filter(Boolean)));
    };

    const matchingButtons = (sourceKey) =>
      Array.from(document.querySelectorAll(buttonSelector))
        .filter((button) => button.dataset.ccsSourceKey === sourceKey);

    const setActionState = (button, state, content) => {
      const next = adapter.copy(state, content);
      button.dataset.ccsState = state;
      if (runtimeVersion) {
        button.dataset.ccsSiteFastqaVersion = runtimeVersion;
      }
      if (content) {
        button.dataset.ccsSourceKey = content.sourceKey;
        button.dataset.ccsContentKind = content.kind;
      }
      button.disabled = state === 'busy' || state === 'success' || state === 'unavailable';
      button.setAttribute('aria-disabled', String(button.disabled));
      button.setAttribute('aria-label', next.label);
      button.title = next.title;
      const host = button.closest(hostSelector);
      if (host) host.title = next.title;
      const visibleText = button.querySelector('[data-ccs-site-fastqa-text]');
      if (visibleText) visibleText.textContent = adapter.visibleText?.(state, content) || '';
    };

    const applyActiveState = (sourceKey, active) => {
      matchingButtons(sourceKey).forEach((button) => setActionState(button, active.state, active.content));
    };

    const scheduleReset = (sourceKey) => {
      const existing = resetTimers.get(sourceKey);
      if (existing != null) window.clearTimeout(existing);
      const timer = window.setTimeout(() => {
        resetTimers.delete(sourceKey);
        activeActions.delete(sourceKey);
        schedule();
      }, 3000);
      resetTimers.set(sourceKey, timer);
    };

    const runFastQa = async (root, button) => {
      const preview = adapter.extract(root);
      if (!preview) {
        setActionState(button, 'unavailable', null);
        window.CCSModules.Toast?.warning?.(adapter.unavailableToast || '未提取到可用于速答的正文');
        return;
      }

      const sourceKey = preview.sourceKey;
      const existingTimer = resetTimers.get(sourceKey);
      if (existingTimer != null) {
        window.clearTimeout(existingTimer);
        resetTimers.delete(sourceKey);
      }
      const busy = { content: preview, state: 'busy' };
      activeActions.set(sourceKey, busy);
      applyActiveState(sourceKey, busy);
      setActionState(button, 'busy', preview);

      try {
        await adapter.prepare?.(root);
        const content = adapter.extract(root);
        if (!content?.keyword) throw new Error('未提取到可用于速答的正文');
        const response = await sendToChatGpt(content.keyword);
        if (!response.success) throw new Error(response.error || '速答启动失败');
        const success = { content, state: 'success' };
        activeActions.set(sourceKey, success);
        applyActiveState(sourceKey, success);
        if (button.isConnected) setActionState(button, 'success', content);
        window.CCSModules.Toast?.success?.(adapter.successToast(content));
      } catch (error) {
        const latest = adapter.extract(root) || preview;
        const failed = { content: latest, state: 'error' };
        activeActions.set(sourceKey, failed);
        applyActiveState(sourceKey, failed);
        if (button.isConnected) setActionState(button, 'error', latest);
        window.CCSModules.Toast?.error?.(toUserFacingError(error));
      } finally {
        scheduleReset(sourceKey);
      }
    };

    const inject = (root) => {
      const containers = actionContainers(root);
      if (!containers.length) return;
      const content = adapter.extract(root);
      const rootButtons = Array.from(root.querySelectorAll(buttonSelector))
        .filter((button) => ownsElement(button, root));
      const claimedButtons = new Set();
      containers.forEach((container) => {
        let existing = Array.from(container.querySelectorAll(buttonSelector))
          .find((button) => ownsElement(button, root));
        if (!existing && containers.length === 1) {
          existing = rootButtons.find((button) => !claimedButtons.has(button));
        }
        if (existing) {
          claimedButtons.add(existing);
          const host = existing.closest(hostSelector);
          if (host) adapter.insertHost(root, container, host);
          const active = content ? activeActions.get(content.sourceKey) : undefined;
          setActionState(existing, active?.state || (content ? 'idle' : 'unavailable'), active?.content || content);
          return;
        }
        if (!content) return;

        const host = adapter.createHost?.() || document.createElement('div');
        host.setAttribute('data-ccs-site-fastqa-host', adapter.id);
        adapter.decorateHost?.(host);
        host.addEventListener('click', (event) => event.stopPropagation());
        host.addEventListener('pointerdown', (event) => event.stopPropagation());

        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('data-ccs-site-fastqa', adapter.id);
        adapter.decorateButton?.(button);
        const spinner = document.createElement('span');
        spinner.setAttribute('data-ccs-site-fastqa-spinner', 'true');
        spinner.setAttribute('aria-hidden', 'true');
        button.append(createFastQaIcon(), spinner);
        if (adapter.visibleText) {
          const visibleText = document.createElement('span');
          visibleText.setAttribute('data-ccs-site-fastqa-text', 'true');
          button.appendChild(visibleText);
        }
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          void runFastQa(root, button);
        });
        host.appendChild(button);
        adapter.insertHost(root, container, host);
        const active = activeActions.get(content.sourceKey);
        setActionState(button, active?.state || 'idle', active?.content || content);
      });
    };

    const scan = () => {
      scheduled = false;
      if (stopped) return;
      adapter.findRoots(document).forEach(inject);
    };
    const schedule = () => {
      if (stopped || scheduled) return;
      scheduled = true;
      // 后台标签页里 requestAnimationFrame 不触发：页面隐藏时改用定时器，保证切回前按钮已重建
      if (document.hidden) setTimeout(scan, 32);
      else requestAnimationFrame(scan);
    };
    const boot = () => {
      if (stopped || observer || !document.documentElement) return;
      ensureStyles(adapter);
      observer = new MutationObserver((mutations) => {
        const onlyOwnChanges = mutations.length > 0 && mutations.every((mutation) =>
          Boolean(mutationElement(mutation.target)?.closest(hostSelector))
        );
        if (!onlyOwnChanges) schedule();
      });
      observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
      schedule();
    };

    boot();
    if (!observer) document.addEventListener('DOMContentLoaded', boot, { once: true });

    return () => {
      stopped = true;
      document.removeEventListener('DOMContentLoaded', boot);
      observer?.disconnect();
      resetTimers.forEach((timer) => window.clearTimeout(timer));
      resetTimers.clear();
      activeActions.clear();
      document.querySelectorAll(hostSelector).forEach((host) => host.remove());
    };
  }

  window.CCSModules.SiteFastQaRuntime = {
    sendToChatGpt,
    start,
    toUserFacingError,
    runtimeUnavailableMessage: RUNTIME_UNAVAILABLE_MESSAGE
  };
})();
