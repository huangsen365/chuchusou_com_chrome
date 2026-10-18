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

  // 站点速答能发往的引擎：选A改写 → 长文注入X草稿 / 生成封面这条链路只在这三家走得通。
  // 显示名与图标取自 config/engines.json（后台代读）；默认引擎存在 CCSStorageKeys.SITE_FASTQA_ENGINE，
  // 悬停弹出的引擎选择只改这一次发往哪里，「设为默认」才写存储。
  const ENGINE_IDS = Object.freeze(['chatgpt', 'gemini', 'claude']);
  const FALLBACK_ENGINE_ID = 'chatgpt';
  const engineInfo = {};
  const defaultEngineListeners = new Set();
  let defaultEngineId = FALLBACK_ENGINE_ID;
  let settingsPromise = null;

  function normalizeEngineId(value) {
    return ENGINE_IDS.includes(value) ? value : FALLBACK_ENGINE_ID;
  }

  function engineLabel(engineId) {
    return engineInfo[engineId]?.label || engineId;
  }

  function engineStorageKey() {
    return globalThis.CCSStorageKeys?.SITE_FASTQA_ENGINE || '';
  }

  // 内容脚本 fetch 不到扩展里的 config/engines.json，经后台 ccsGetEngineLabels 代读
  function loadEngineInfo() {
    return new Promise((resolve) => {
      try {
        const runtime = globalThis.chrome?.runtime;
        if (!runtime?.id) {
          resolve();
          return;
        }
        runtime.sendMessage({ action: 'ccsGetEngineLabels', engineIds: ENGINE_IDS }, (response) => {
          try {
            if (!runtime.lastError && response?.success) {
              ENGINE_IDS.forEach((id) => {
                const engine = response.engines?.[id];
                if (engine?.label) engineInfo[id] = { label: engine.label, icon: engine.icon || '' };
              });
            }
          } catch (_) {}
          resolve();
        });
      } catch (_) {
        resolve();
      }
    });
  }

  function readDefaultEngine() {
    return new Promise((resolve) => {
      try {
        const key = engineStorageKey();
        const storage = globalThis.chrome?.storage?.local;
        if (!key || !storage || !globalThis.chrome?.runtime?.id) {
          resolve();
          return;
        }
        storage.get([key], (data) => {
          try {
            if (!globalThis.chrome.runtime.lastError) defaultEngineId = normalizeEngineId(data?.[key]);
          } catch (_) {}
          resolve();
        });
      } catch (_) {
        resolve();
      }
    });
  }

  function setDefaultEngine(engineId, { persist = false } = {}) {
    const next = normalizeEngineId(engineId);
    if (persist) {
      try {
        const key = engineStorageKey();
        if (key) globalThis.chrome?.storage?.local?.set({ [key]: next });
      } catch (_) {}
    }
    if (next === defaultEngineId) return;
    defaultEngineId = next;
    defaultEngineListeners.forEach((listener) => listener());
    if (picker.anchor) renderPicker();
  }

  function loadSiteFastQaSettings() {
    if (!settingsPromise) {
      try {
        globalThis.chrome?.storage?.onChanged?.addListener((changes, areaName) => {
          const key = engineStorageKey();
          if (areaName === 'local' && key && changes[key]) setDefaultEngine(changes[key].newValue);
        });
      } catch (_) {}
      settingsPromise = Promise.all([loadEngineInfo(), readDefaultEngine()]);
    }
    return settingsPromise;
  }

  // 引擎选择浮层：挂在 body 上的 shadow DOM（不受网站样式影响，也不在 X 帖子的点击区域里），
  // position: fixed 跟着按钮定位，上方放不下就放到下方。
  const PICKER_HOST_ATTR = 'data-ccs-site-fastqa-picker';
  const PICKER_OPEN_DELAY = 350;
  const PICKER_CLOSE_DELAY = 220;
  const PICKER_GAP = 6;
  const PICKER_MARGIN = 8;
  const PICKER_STYLES = `
    :host { all: initial; }
    [data-ccs-picker] {
      box-sizing: border-box;
      min-width: 196px;
      padding: 6px;
      border: 1px solid rgb(15 20 25 / 10%);
      border-radius: 12px;
      background: #fff;
      color: #0f1419;
      box-shadow: 0 10px 30px rgb(15 20 25 / 18%), 0 1px 3px rgb(15 20 25 / 10%);
      font: 14px/20px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB",
        "Microsoft YaHei", sans-serif;
      opacity: 0;
      transform: translateY(4px);
      transition: opacity 120ms ease, transform 120ms ease;
    }
    [data-ccs-picker][data-placement="below"] { transform: translateY(-4px); }
    [data-ccs-picker][data-open] { opacity: 1; transform: none; }
    [data-ccs-picker][data-theme="dark"] {
      border-color: rgb(255 255 255 / 14%);
      background: #16181c;
      color: #e7e9ea;
      box-shadow: 0 10px 30px rgb(0 0 0 / 55%);
    }
    [data-ccs-picker-title] { padding: 4px 10px 6px; color: #536471; font-size: 12px; line-height: 16px; }
    [data-ccs-picker-row] { display: flex; align-items: center; gap: 6px; padding-right: 6px; border-radius: 8px; }
    [data-ccs-picker-row]:hover { background: rgb(15 20 25 / 6%); }
    button {
      margin: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    button:focus-visible { outline: 2px solid rgb(29 155 240 / 70%); outline-offset: -2px; }
    [data-ccs-picker-send] {
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      border-radius: 8px;
      text-align: left;
    }
    [data-ccs-picker-send]:disabled { cursor: default; opacity: 0.5; }
    [data-ccs-picker-icon] { width: 18px; text-align: center; }
    [data-ccs-picker-tag] { flex: none; color: #536471; font-size: 12px; line-height: 16px; }
    [data-ccs-picker-tag="sent"] { color: #00ba7c; }
    [data-ccs-picker-pin] { flex: none; padding: 2px 8px; border-radius: 9999px; color: #536471; font-size: 12px; line-height: 16px; }
    [data-ccs-picker-pin]:hover { background: rgb(29 155 240 / 12%); color: #1d9bf0; }
    [data-theme="dark"] [data-ccs-picker-title],
    [data-theme="dark"] [data-ccs-picker-tag]:not([data-ccs-picker-tag="sent"]),
    [data-theme="dark"] [data-ccs-picker-pin] { color: #8b98a5; }
    [data-theme="dark"] [data-ccs-picker-row]:hover { background: rgb(255 255 255 / 8%); }
    @media (prefers-reduced-motion: reduce) {
      [data-ccs-picker] { transition: none; }
    }
  `;

  const picker = {
    host: null,
    panel: null,
    anchor: null,
    options: null,
    openTimer: null,
    closeTimer: null,
    rendering: false,
    frame: 0,
    titles: []
  };

  function isPickerNode(node) {
    return node instanceof Element && node.hasAttribute(PICKER_HOST_ATTR);
  }

  function pageTheme(anchor) {
    for (let element = anchor; element instanceof Element; element = element.parentElement) {
      const match = /rgba?\(([^)]+)\)/.exec(getComputedStyle(element).backgroundColor || '');
      if (!match) continue;
      const [red, green, blue, alpha = 1] = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      if (alpha > 0.5) return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255 < 0.5 ? 'dark' : 'light';
    }
    return 'light';
  }

  function pickerButtons() {
    return Array.from(picker.panel?.querySelectorAll('button:not(:disabled)') || []);
  }

  function focusPickerButton(index) {
    const buttons = pickerButtons();
    if (buttons.length) buttons[(index + buttons.length) % buttons.length].focus();
  }

  function cancelPickerOpen() {
    window.clearTimeout(picker.openTimer);
    picker.openTimer = null;
  }

  function cancelPickerClose() {
    window.clearTimeout(picker.closeTimer);
    picker.closeTimer = null;
  }

  function schedulePickerClose() {
    cancelPickerClose();
    picker.closeTimer = window.setTimeout(() => closePicker(), PICKER_CLOSE_DELAY);
  }

  function schedulePickerOpen(anchor, options) {
    cancelPickerClose();
    if (picker.anchor === anchor) return;
    cancelPickerOpen();
    picker.openTimer = window.setTimeout(() => {
      picker.openTimer = null;
      if (anchor.isConnected && anchor.matches(':hover')) openPicker(anchor, options);
    }, PICKER_OPEN_DELAY);
  }

  function ensurePickerElements() {
    if (picker.host) return;
    const host = document.createElement('div');
    host.setAttribute(PICKER_HOST_ATTR, 'true');
    host.style.cssText = 'position: fixed; top: 0; left: 0; z-index: 2147483646; display: block;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = PICKER_STYLES;
    const panel = document.createElement('div');
    panel.setAttribute('data-ccs-picker', '');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '选择这次速答发到哪个 AI');
    panel.addEventListener('pointerenter', cancelPickerClose);
    panel.addEventListener('pointerleave', (event) => {
      if (event.pointerType !== 'touch') schedulePickerClose();
    });
    panel.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const index = pickerButtons().indexOf(shadow.activeElement);
      if (index < 0) focusPickerButton(event.key === 'ArrowDown' ? 0 : -1);
      else focusPickerButton(index + (event.key === 'ArrowDown' ? 1 : -1));
    });
    panel.addEventListener('focusout', (event) => {
      if (picker.rendering || panel.contains(event.relatedTarget) || event.relatedTarget === picker.anchor) return;
      closePicker();
    });
    shadow.append(style, panel);
    picker.host = host;
    picker.panel = panel;
  }

  // 浮层开着时按钮的 title 暂存在 picker.titles 里，关闭时再还原
  function setTitle(element, title) {
    const stashed = picker.titles.find(([candidate]) => candidate === element);
    if (stashed) stashed[1] = title;
    else element.title = title;
  }

  function pickerTag(kind, text) {
    const tag = document.createElement('span');
    tag.setAttribute('data-ccs-picker-tag', kind);
    tag.textContent = text;
    return tag;
  }

  function renderPicker() {
    const { panel, anchor, options } = picker;
    if (!panel || !anchor || !options) return;
    const active = options.activeAction();
    const busy = active?.state === 'busy';
    const sentEngineId = active?.state === 'success' ? active.engineId : '';
    const focusedEngine = panel.contains(panel.getRootNode().activeElement)
      ? panel.getRootNode().activeElement.closest('[data-ccs-picker-row]')?.dataset.engine || ''
      : '';
    picker.rendering = true;
    panel.dataset.theme = pageTheme(anchor);
    const title = document.createElement('div');
    title.setAttribute('data-ccs-picker-title', '');
    title.textContent = '这次发到';
    const rows = ENGINE_IDS.map((engineId) => {
      const label = engineLabel(engineId);
      const sent = sentEngineId === engineId;
      const row = document.createElement('div');
      row.setAttribute('data-ccs-picker-row', '');
      row.dataset.engine = engineId;

      const send = document.createElement('button');
      send.type = 'button';
      send.setAttribute('data-ccs-picker-send', '');
      send.disabled = busy || sent;
      send.setAttribute('aria-label', sent ? `已发送到 ${label}` : `这次发到 ${label}`);
      const icon = engineInfo[engineId]?.icon;
      if (icon) {
        const iconElement = document.createElement('span');
        iconElement.setAttribute('data-ccs-picker-icon', '');
        iconElement.setAttribute('aria-hidden', 'true');
        iconElement.textContent = icon;
        send.appendChild(iconElement);
      }
      send.append(label);
      send.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const onPick = picker.options?.onPick;
        // 键盘触发（detail 为 0）才把焦点还给闪电，鼠标点选不留焦点框
        closePicker({ restoreFocus: event.detail === 0 });
        onPick?.(engineId);
      });
      row.appendChild(send);

      if (sent) row.appendChild(pickerTag('sent', '已发送'));
      if (engineId === defaultEngineId) {
        row.appendChild(pickerTag('default', '默认'));
      } else {
        const pin = document.createElement('button');
        pin.type = 'button';
        pin.setAttribute('data-ccs-picker-pin', '');
        pin.textContent = '设为默认';
        pin.setAttribute('aria-label', `把 ${label} 设为默认：以后直接点闪电就发到 ${label}`);
        pin.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          setDefaultEngine(engineId, { persist: true });
          window.CCSModules.Toast?.success?.(`已设为默认：以后直接点闪电就发到 ${label}`);
        });
        row.appendChild(pin);
      }
      return row;
    });
    panel.replaceChildren(title, ...rows);
    picker.rendering = false;
    if (focusedEngine) {
      const row = panel.querySelector(`[data-ccs-picker-row][data-engine="${focusedEngine}"]`);
      Array.from(row?.querySelectorAll('button') || []).find((button) => !button.disabled)?.focus();
    }
  }

  function positionPicker() {
    const { host, panel, anchor } = picker;
    if (!host || !panel || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    if (!anchor.isConnected || rect.bottom < 0 || rect.top > window.innerHeight) {
      closePicker();
      return;
    }
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    let top = rect.top - height - PICKER_GAP;
    const below = top < PICKER_MARGIN;
    if (below) top = Math.min(rect.bottom + PICKER_GAP, window.innerHeight - height - PICKER_MARGIN);
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - width / 2, PICKER_MARGIN),
      viewportWidth - width - PICKER_MARGIN
    );
    host.style.top = `${Math.round(top)}px`;
    host.style.left = `${Math.round(left)}px`;
    panel.dataset.placement = below ? 'below' : 'above';
  }

  function onPickerViewportChange() {
    if (picker.frame) return;
    picker.frame = window.requestAnimationFrame(() => {
      picker.frame = 0;
      positionPicker();
    });
  }

  function onPickerOutsidePointer(event) {
    const path = event.composedPath?.() || [];
    if (!path.includes(picker.host) && !path.includes(picker.anchor)) closePicker();
  }

  function onPickerEscape(event) {
    if (event.key !== 'Escape' || !picker.anchor) return;
    event.preventDefault();
    event.stopPropagation();
    closePicker({ restoreFocus: (event.composedPath?.() || []).includes(picker.host) });
  }

  function openPicker(anchor, options) {
    cancelPickerOpen();
    cancelPickerClose();
    if (picker.anchor && picker.anchor !== anchor) closePicker();
    ensurePickerElements();
    picker.anchor = anchor;
    picker.options = options;
    anchor.setAttribute('aria-expanded', 'true');
    // 浮层开着时先收起按钮的原生 title 提示，免得两层提示叠在一起
    picker.titles = [anchor, anchor.closest('[data-ccs-site-fastqa-host]')]
      .filter((element) => element?.hasAttribute('title'))
      .map((element) => [element, element.getAttribute('title')]);
    picker.titles.forEach(([element]) => element.removeAttribute('title'));
    renderPicker();
    picker.panel.removeAttribute('data-open');
    (document.body || document.documentElement).appendChild(picker.host);
    positionPicker();
    // positionPicker 读过布局，透明初始态已生效，这里再打开才有淡入过渡
    picker.panel.setAttribute('data-open', '');
    window.addEventListener('scroll', onPickerViewportChange, { capture: true, passive: true });
    window.addEventListener('resize', onPickerViewportChange, { passive: true });
    document.addEventListener('pointerdown', onPickerOutsidePointer, true);
    document.addEventListener('keydown', onPickerEscape, true);
  }

  function closePicker({ restoreFocus = false } = {}) {
    cancelPickerOpen();
    cancelPickerClose();
    const anchor = picker.anchor;
    if (!anchor) return;
    picker.anchor = null;
    picker.options = null;
    anchor.setAttribute('aria-expanded', 'false');
    picker.titles.forEach(([element, title]) => element.setAttribute('title', title));
    picker.titles = [];
    picker.host?.remove();
    if (picker.frame) window.cancelAnimationFrame(picker.frame);
    picker.frame = 0;
    window.removeEventListener('scroll', onPickerViewportChange, { capture: true });
    window.removeEventListener('resize', onPickerViewportChange);
    document.removeEventListener('pointerdown', onPickerOutsidePointer, true);
    document.removeEventListener('keydown', onPickerEscape, true);
    if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
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

  function sendFastQa(keyword, engineId) {
    const engine = normalizeEngineId(engineId);
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
          menuItemId: `ccs-fastqa-${engine}-quick`,
          menuType: 'fastqa-quick',
          engineId: engine,
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

  const PICKER_STATES = new Set(['idle', 'success', 'error']);

  function pickerAllowed(button) {
    return PICKER_STATES.has(button.dataset.ccsState) && !button.hasAttribute('data-ccs-site-fastqa-stale-update');
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
    let settingsReady = false;

    const actionContainers = (root) => {
      const candidates = adapter.findActionContainers?.(root) || [adapter.findActionContainer(root)];
      return Array.from(new Set(candidates.filter(Boolean)));
    };

    const matchingButtons = (sourceKey) =>
      Array.from(document.querySelectorAll(buttonSelector))
        .filter((button) => button.dataset.ccsSourceKey === sourceKey);

    // idle / unavailable 显示默认引擎；busy / success / error 显示这一次实际发往的引擎
    const setActionState = (button, state, content, engineId) => {
      const engine = state === 'busy' || state === 'success' || state === 'error'
        ? normalizeEngineId(engineId || defaultEngineId)
        : defaultEngineId;
      const next = adapter.copy(state, content, engineLabel(engine));
      button.dataset.ccsState = state;
      button.dataset.ccsEngine = engine;
      if (runtimeVersion) {
        button.dataset.ccsSiteFastqaVersion = runtimeVersion;
      }
      if (content) {
        button.dataset.ccsSourceKey = content.sourceKey;
        button.dataset.ccsContentKind = content.kind;
      }
      // success 不禁用：发完一家还能悬停换另一家；同一家重复点击由 runFastQa 拦下
      button.disabled = state === 'busy' || state === 'unavailable';
      button.setAttribute('aria-disabled', String(button.disabled));
      button.setAttribute('aria-label', next.label);
      setTitle(button, next.title);
      const host = button.closest(hostSelector);
      if (host) setTitle(host, next.title);
      const visibleText = button.querySelector('[data-ccs-site-fastqa-text]');
      if (visibleText) visibleText.textContent = adapter.visibleText?.(state, content) || '';
      if (picker.anchor === button && !pickerAllowed(button)) closePicker();
    };

    const applyActiveState = (sourceKey, active) => {
      matchingButtons(sourceKey)
        .forEach((button) => setActionState(button, active.state, active.content, active.engineId));
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

    const runFastQa = async (root, button, engineId) => {
      const preview = adapter.extract(root);
      if (!preview) {
        setActionState(button, 'unavailable', null);
        window.CCSModules.Toast?.warning?.(adapter.unavailableToast || '未提取到可用于速答的正文');
        return;
      }

      const sourceKey = preview.sourceKey;
      const current = activeActions.get(sourceKey);
      if (current?.state === 'busy' || (current?.state === 'success' && current.engineId === engineId)) return;
      const existingTimer = resetTimers.get(sourceKey);
      if (existingTimer != null) {
        window.clearTimeout(existingTimer);
        resetTimers.delete(sourceKey);
      }
      const busy = { content: preview, state: 'busy', engineId };
      activeActions.set(sourceKey, busy);
      applyActiveState(sourceKey, busy);
      setActionState(button, 'busy', preview, engineId);

      try {
        await adapter.prepare?.(root);
        const content = adapter.extract(root);
        if (!content?.keyword) throw new Error('未提取到可用于速答的正文');
        const response = await sendFastQa(content.keyword, engineId);
        if (!response.success) throw new Error(response.error || '速答启动失败');
        const success = { content, state: 'success', engineId };
        activeActions.set(sourceKey, success);
        applyActiveState(sourceKey, success);
        if (button.isConnected) setActionState(button, 'success', content, engineId);
        window.CCSModules.Toast?.success?.(adapter.successToast(content, engineLabel(engineId)));
      } catch (error) {
        const latest = adapter.extract(root) || preview;
        const failed = { content: latest, state: 'error', engineId };
        activeActions.set(sourceKey, failed);
        applyActiveState(sourceKey, failed);
        if (button.isConnected) setActionState(button, 'error', latest, engineId);
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
          setActionState(
            existing,
            active?.state || (content ? 'idle' : 'unavailable'),
            active?.content || content,
            active?.engineId
          );
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
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-expanded', 'false');
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
        const pickerOptions = {
          activeAction: () => activeActions.get(button.dataset.ccsSourceKey),
          onPick: (engineId) => {
            void runFastQa(root, button, engineId);
          }
        };
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          closePicker();
          // 失败后点「重试」发回失败的那一家，其余情况发默认引擎
          const active = activeActions.get(button.dataset.ccsSourceKey);
          void runFastQa(root, button, active?.state === 'error' ? active.engineId : defaultEngineId);
        });
        button.addEventListener('pointerenter', (event) => {
          if (event.pointerType !== 'touch' && pickerAllowed(button)) schedulePickerOpen(button, pickerOptions);
        });
        button.addEventListener('pointerleave', () => {
          cancelPickerOpen();
          if (picker.anchor === button) schedulePickerClose();
        });
        button.addEventListener('keydown', (event) => {
          if ((event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || !pickerAllowed(button)) return;
          event.preventDefault();
          event.stopPropagation();
          if (picker.anchor !== button) openPicker(button, pickerOptions);
          focusPickerButton(event.key === 'ArrowDown' ? 0 : -1);
        });
        host.appendChild(button);
        adapter.insertHost(root, container, host);
        const active = activeActions.get(content.sourceKey);
        setActionState(button, active?.state || 'idle', active?.content || content, active?.engineId);
      });
    };

    const scan = () => {
      scheduled = false;
      if (stopped || !settingsReady) return;
      if (picker.anchor && !picker.anchor.isConnected) closePicker();
      adapter.findRoots(document).forEach(inject);
    };
    const schedule = () => {
      if (stopped || scheduled) return;
      scheduled = true;
      // 后台标签页里 requestAnimationFrame 不触发：页面隐藏时改用定时器，保证切回前按钮已重建
      if (document.hidden) setTimeout(scan, 32);
      else requestAnimationFrame(scan);
    };
    const isOwnMutation = (mutation) => {
      if (mutationElement(mutation.target)?.closest(hostSelector)) return true;
      if (mutation.type !== 'childList') return false;
      const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
      return nodes.length > 0 && nodes.every(isPickerNode);
    };
    const boot = () => {
      if (stopped || observer || !document.documentElement) return;
      ensureStyles(adapter);
      observer = new MutationObserver((mutations) => {
        if (!mutations.every(isOwnMutation)) schedule();
      });
      observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
      schedule();
    };

    // 引擎名和默认引擎读到之前不建按钮，避免先显示 ChatGPT 再跳成别家
    defaultEngineListeners.add(schedule);
    void loadSiteFastQaSettings().then(() => {
      settingsReady = true;
      schedule();
    });
    boot();
    if (!observer) document.addEventListener('DOMContentLoaded', boot, { once: true });

    return () => {
      stopped = true;
      defaultEngineListeners.delete(schedule);
      document.removeEventListener('DOMContentLoaded', boot);
      observer?.disconnect();
      closePicker();
      resetTimers.forEach((timer) => window.clearTimeout(timer));
      resetTimers.clear();
      activeActions.clear();
      document.querySelectorAll(hostSelector).forEach((host) => host.remove());
    };
  }

  window.CCSModules.SiteFastQaRuntime = {
    engineIds: ENGINE_IDS,
    normalizeEngineId,
    sendFastQa,
    start,
    toUserFacingError,
    runtimeUnavailableMessage: RUNTIME_UNAVAILABLE_MESSAGE
  };
})();
