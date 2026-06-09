/* sidepanel-v2/sidepanel.js —— 全新极简 sidepanel
 *
 * 设计原则（与 popup-v2 一致）：
 * - 首帧 0 sendMessage（菜单 HTML prebuild 注入；关键字 storage instant + fresh 并发）
 * - 0 React / 0 Plasmo bundle / 纯 vanilla JS
 * - 复用 shared/{keywordClient, runtimeClient, logger}
 * - Voice 模块 lazy load（batch 4 实现）
 * - 封面 picker（batch 2 实现）
 * - alive port + tab listener（batch 5）
 *
 * 本批次（batch 1）：基础骨架 + 关键字 fallback chain + 复制 + 剪贴板按钮
 */
(() => {
  'use strict';

  // ===== 常量 =====
  const TTL_MS = 5 * 60 * 1000;
  const KW_PREFIX = 'ccs_kw_';
  const TAB_REFRESH_DEBOUNCE_MS = 50;

  // 封面相关 storage keys（与旧 sidepanel + popup-v2 + background 完全一致）
  const PIN_STORAGE_KEY = 'ccs_sidepanel_pinned_action';
  const CUSTOM_PURPOSE_KEY = 'ccs_cover_custom_purpose';
  const CUSTOM_LINE_KEY = 'ccs_cover_custom_selected_line';
  const RATIO_KEY = 'ccs_cover_aspect_ratio';
  const RATIO_CUSTOM_LIST_KEY = 'ccs_cover_custom_ratios';
  const CUSTOM_PURPOSE_MAX = 5000;
  const CUSTOM_LINE_PREVIEW_MAX = 15;
  const RATIO_CUSTOM_MAX = 5;
  const DEFAULT_PIN = { taskId: 'cover', categoryId: 'minimal' };
  const DEFAULT_RATIO = '5:2';
  const RATIO_CUSTOM_TRIGGER = '__custom__';
  const RATIO_RE = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/;
  const RATIO_PRESETS = [
    { value: '5:2',    label: '5:2 · 横幅封面（默认）' },
    { value: '6:2',    label: '6:2 · X (Twitter) 个人主页 Banner（1500×500）' },
    { value: '2.35:1', label: '2.35:1 · 微信公众号头图 / 电影宽屏' },
    { value: '2:1',    label: '2:1 · 横幅卡片' },
    { value: '16:9',   label: '16:9 · 通用横屏（YouTube / B 站）' },
    { value: '3:2',    label: '3:2 · 头条号 / 摄影标准' },
    { value: '4:3',    label: '4:3 · 传统媒体 / PPT' },
    { value: '1:1',    label: '1:1 · 方形（Instagram / 微博）' },
    { value: '4:5',    label: '4:5 · 竖版图文（Instagram 推荐）' },
    { value: '3:4',    label: '3:4 · 竖版封面（小红书 / Pinterest）' },
    { value: '9:16',   label: '9:16 · 手机竖屏（抖音 / TikTok）' }
  ];
  // 「💡 不知道填什么？」帮助链接 —— 跳 ChatGPT / Google 找风格灵感
  const COVER_HELP_URL_1 = 'https://chatgpt.com/?prompt=' + encodeURIComponent('为"封面图设计风格参考"生成 30 个风格，每行一个');
  const COVER_HELP_URL_2 = 'https://www.google.com/search?q=' + encodeURIComponent('ChatGPT Images 2.0 提示词');

  function parseCustomLines(text) {
    if (typeof text !== 'string') return [];
    return text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
  }
  function truncateLine(s, max = CUSTOM_LINE_PREVIEW_MAX) {
    if (typeof s !== 'string') return '';
    return s.length > max ? s.slice(0, max) + '…' : s;
  }

  // ===== DOM refs =====
  const $kw = document.getElementById('spKeyword');
  const $kwCopy = document.getElementById('spKeywordCopy');
  const $kwVoice = document.getElementById('spKeywordVoice');
  const $clipboardBtn = document.getElementById('spClipboardBtn');
  const $tipWarn = document.getElementById('spPinTipWarn');
  const $tipPopover = document.getElementById('spPinTipPopover');
  const $tipClose = document.getElementById('spPinTipClose');
  const $menu = document.getElementById('spMenu');

  // 封面卡片
  const $pin = document.getElementById('spPin');
  const $pinAction = document.getElementById('spPinAction');
  const $pinEdit = document.getElementById('spPinEdit');
  const $pinStyle = document.getElementById('spPinStyle');
  const $pinRatio = document.getElementById('spPinRatio');

  // Picker
  const $picker = document.getElementById('spPinPicker');
  const $pickerOptions = document.getElementById('spPinOptions');
  const $pickerCustom = document.getElementById('spPinCustom');
  const $pickerCustomInput = document.getElementById('spPinCustomInput');
  const $pickerCustomSelect = document.getElementById('spPinCustomSelect');
  const $pickerCustomCounter = document.getElementById('spPinCustomCounter');
  const $pickerCustomHelp = document.getElementById('spPinCustomHelp');
  const $pickerCustomHelp2 = document.getElementById('spPinCustomHelp2');
  const $pickerRatioSelect = document.getElementById('spPinRatioSelect');
  const $pickerRatioCustom = document.getElementById('spPinRatioCustom');
  const $pickerRatioInput = document.getElementById('spPinRatioInput');
  const $pickerRatioAdd = document.getElementById('spPinRatioAdd');
  const $pickerRatioHint = document.getElementById('spPinRatioHint');
  const $pickerCancel = document.getElementById('spPinCancel');
  const $pickerSave = document.getElementById('spPinSave');

  // ===== 状态 =====
  let currentKw = '';
  let currentTabId = null;
  let currentTabUrl = '';
  let refreshTimer = null;

  // Voice 模块（lazy load）
  let voicePanel = null;
  let voiceEnabled = false;
  let voiceLoadPromise = null;

  // 封面状态
  let coverConfig = null;
  let pinCurrent = { ...DEFAULT_PIN };
  let pinCustomPurpose = '';
  let pinCustomSelectedLine = '';
  let pinRatio = DEFAULT_RATIO;
  let pinCustomRatios = [];
  // picker 内的 draft（取消时丢弃）
  let pickerDraft = null;
  let pickerLastDropdownLines = [];

  // ===== 工具 =====
  function showToast(message) {
    const t = document.createElement('div');
    t.className = 'sp-toast';
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => {
      t.classList.add('fade-out');
      setTimeout(() => t.remove(), 300);
    }, 2000);
  }

  function setKeyword(s) {
    currentKw = (s || '').trim();
    if (currentKw) {
      $kw.textContent = currentKw.length > 20 ? currentKw.slice(0, 20) + '…' : currentKw;
      $kw.title = currentKw;
      $kw.removeAttribute('data-empty');
      $kwCopy.hidden = false;
      $clipboardBtn.hidden = true;
    } else {
      $kw.textContent = '';
      $kw.title = '';
      $kw.setAttribute('data-empty', '1');
      $kwCopy.hidden = true;
      // 关键字空时显示剪贴板兜底按钮
      $clipboardBtn.hidden = false;
    }
    // 通知后续 batch（cover / voice）状态变化
    document.dispatchEvent(new CustomEvent('sp-keyword-change', { detail: { keyword: currentKw } }));
  }

  // ===== Pin / Cover Picker =====
  function findCategory(id, cfg = coverConfig) {
    if (!cfg || !Array.isArray(cfg.categories)) return null;
    return cfg.categories.find((c) => c.id === id) || null;
  }

  // 初始化封面：并行读 5 个 storage key + fetch coverPrompts.json，然后渲染卡片
  async function initPin() {
    const [stored, customPurpose, customLine, ratioInfo, cover] = await Promise.all([
      chrome.storage.local.get([PIN_STORAGE_KEY]).then((r) => r[PIN_STORAGE_KEY] || null).catch(() => null),
      chrome.storage.local.get([CUSTOM_PURPOSE_KEY]).then((r) => r[CUSTOM_PURPOSE_KEY] || '').catch(() => ''),
      chrome.storage.local.get([CUSTOM_LINE_KEY]).then((r) => r[CUSTOM_LINE_KEY] || '').catch(() => ''),
      chrome.storage.local.get([RATIO_KEY, RATIO_CUSTOM_LIST_KEY]).then((r) => ({
        ratio: (typeof r[RATIO_KEY] === 'string' && RATIO_RE.test(r[RATIO_KEY].trim())) ? r[RATIO_KEY].trim() : DEFAULT_RATIO,
        custom: Array.isArray(r[RATIO_CUSTOM_LIST_KEY]) ? r[RATIO_CUSTOM_LIST_KEY].filter((x) => typeof x === 'string' && RATIO_RE.test(x)) : []
      })).catch(() => ({ ratio: DEFAULT_RATIO, custom: [] })),
      fetch('../prompts/coverPrompts.json').then((r) => r.ok ? r.json() : null).catch(() => null)
    ]);

    coverConfig = cover;
    pinCustomPurpose = customPurpose || '';
    pinCustomSelectedLine = customLine || (parseCustomLines(pinCustomPurpose)[0] || '');
    pinRatio = ratioInfo.ratio;
    pinCustomRatios = ratioInfo.custom;
    if (stored && findCategory(stored.categoryId)) {
      pinCurrent = (stored.categoryId === 'custom' && !pinCustomSelectedLine) ? { ...DEFAULT_PIN } : stored;
    } else {
      pinCurrent = { ...DEFAULT_PIN };
    }

    if (!coverConfig || !coverConfig.categories || coverConfig.categories.length === 0) return;
    $pin.hidden = false;
    renderPin();
  }

  function renderPin() {
    const cat = findCategory(pinCurrent.categoryId);
    if (!cat) return;
    if ($pinRatio) $pinRatio.textContent = pinRatio || DEFAULT_RATIO;
    if (!$pinStyle) return;
    if (cat.id === 'custom') {
      const line = (pinCustomSelectedLine || '').trim();
      const preview = truncateLine(line);
      $pinStyle.textContent = preview ? `🖌️ ${preview}` : '🖌️ 自定义风格';
      $pinStyle.title = line || '';
    } else {
      $pinStyle.textContent = cat.label || cat.id;
      $pinStyle.title = '';
    }
  }

  // 🎨 卡片 click → 走 executeMenuAction sendMessage 让 background 拼 prompt 开 URL
  async function executePin() {
    const cat = findCategory(pinCurrent.categoryId);
    if (!cat) return;
    const engine = (cat.engines || [])[0];
    if (!engine) { showToast('该风格暂无可用引擎'); return; }

    let purpose = cat.purpose || cat.label;
    if (cat.id === 'custom') {
      const userText = (pinCustomSelectedLine || '').trim();
      if (!userText) { showToast('请先点 ✏️ 填写自定义风格'); return; }
      purpose = userText;
    }
    if (!currentKw) { showToast('请先选中文字'); return; }
    const payload = {
      action: 'executeMenuAction',
      menuItemId: `ccs-cover-${cat.id}-${engine.id}`,
      menuType: 'cover',
      keyword: currentKw,
      urlPattern: engine.urlPattern,
      engineId: engine.id,
      purpose,
      categoryId: cat.id
    };
    try {
      const client = globalThis.CCSRuntimeClient;
      if (client?.sendRuntimeMessage) {
        const result = await client.sendRuntimeMessage(payload, { timeoutMs: 5000, retries: 1 });
        if (!result.ok) { showToast('操作失败'); return; }
        const resp = result.data || {};
        if (resp.error === 'no-keyword') showToast('没有选中文本或无法提取关键词');
      } else {
        chrome.runtime.sendMessage(payload).catch(() => {});
      }
    } catch (_) { showToast('操作失败'); }
  }

  // ===== Picker =====
  function openPicker() {
    pickerDraft = { ...pinCurrent };
    pickerDraft.customPurpose = pinCustomPurpose;
    pickerDraft.customSelectedLine = pinCustomSelectedLine;
    pickerDraft.ratio = pinRatio;
    pickerDraft.customRatios = [...pinCustomRatios];
    pickerLastDropdownLines = parseCustomLines(pickerDraft.customPurpose);

    // 分类 radio
    $pickerOptions.innerHTML = '';
    (coverConfig?.categories || []).forEach((cat) => {
      const optId = `pin-opt-${cat.id}`;
      const checked = cat.id === pickerDraft.categoryId ? 'checked' : '';
      const label = document.createElement('label');
      label.className = 'sp-pin-option';
      label.htmlFor = optId;
      const labelText = cat.id === 'custom' ? `🖌️ ${cat.label || cat.id}` : (cat.label || cat.id);
      label.innerHTML = `<input type="radio" name="pinStyle" id="${optId}" value="${cat.id}" ${checked}><span class="sp-pin-option-label"></span>`;
      label.querySelector('.sp-pin-option-label').textContent = labelText;
      $pickerOptions.appendChild(label);
    });

    // textarea
    if ($pickerCustomInput) $pickerCustomInput.value = pickerDraft.customPurpose;

    refreshPickerCustomVisibility();
    refreshPickerCounter();
    rebuildCustomDropdown();
    rebuildRatioDropdown();
    refreshSaveBtn();
    $picker.hidden = false;
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
  }

  function closePicker() {
    $picker.hidden = true;
    pickerDraft = null;
    pickerLastDropdownLines = [];
  }

  function refreshPickerCustomVisibility() {
    if (!$pickerCustom) return;
    $pickerCustom.hidden = pickerDraft?.categoryId !== 'custom';
  }

  function refreshPickerCounter() {
    if (!$pickerCustomCounter) return;
    $pickerCustomCounter.textContent = String((pickerDraft?.customPurpose || '').length);
  }

  function activateCustomCategory() {
    if (!pickerDraft || pickerDraft.categoryId === 'custom') return;
    pickerDraft.categoryId = 'custom';
    const radio = $pickerOptions.querySelector('input[name="pinStyle"][value="custom"]');
    if (radio) radio.checked = true;
    refreshPickerCustomVisibility();
  }

  function rebuildCustomDropdown() {
    if (!$pickerCustomSelect) return;
    const lines = parseCustomLines(pickerDraft?.customPurpose || '');
    $pickerCustomSelect.innerHTML = '';
    if (lines.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '（请先在上方填写至少 1 行预设）';
      opt.disabled = true;
      $pickerCustomSelect.appendChild(opt);
      $pickerCustomSelect.disabled = true;
      if (pickerDraft) pickerDraft.customSelectedLine = '';
      pickerLastDropdownLines = [];
      return;
    }
    $pickerCustomSelect.disabled = false;
    const added = [...lines].reverse().find((l) => !pickerLastDropdownLines.includes(l));
    let chosen;
    if (added) chosen = added;
    else if (lines.includes(pickerDraft.customSelectedLine)) chosen = pickerDraft.customSelectedLine;
    else chosen = lines[0];
    lines.forEach((line) => {
      const opt = document.createElement('option');
      opt.value = line;
      opt.textContent = truncateLine(line);
      opt.title = line;
      if (line === chosen) opt.selected = true;
      $pickerCustomSelect.appendChild(opt);
    });
    $pickerCustomSelect.value = chosen;
    pickerDraft.customSelectedLine = chosen;
    pickerLastDropdownLines = [...lines];
  }

  function rebuildRatioDropdown() {
    if (!$pickerRatioSelect) return;
    $pickerRatioSelect.innerHTML = '';
    const groups = [];
    if (pickerDraft.customRatios.length > 0) {
      groups.push({ label: '自定义', items: pickerDraft.customRatios.map((v) => ({ value: v, label: `${v} · 自定义` })) });
    }
    groups.push({ label: '预设', items: RATIO_PRESETS });
    for (const g of groups) {
      const og = document.createElement('optgroup');
      og.label = g.label;
      for (const it of g.items) {
        const opt = document.createElement('option');
        opt.value = it.value;
        opt.textContent = it.label;
        if (it.value === pickerDraft.ratio) opt.selected = true;
        og.appendChild(opt);
      }
      $pickerRatioSelect.appendChild(og);
    }
    const trigger = document.createElement('option');
    trigger.value = RATIO_CUSTOM_TRIGGER;
    trigger.textContent = '➕ 自定义比例…';
    $pickerRatioSelect.appendChild(trigger);
    if (![...$pickerRatioSelect.options].some((o) => o.value === pickerDraft.ratio && o.value !== RATIO_CUSTOM_TRIGGER)) {
      pickerDraft.ratio = DEFAULT_RATIO;
      [...$pickerRatioSelect.options].forEach((o) => { o.selected = o.value === DEFAULT_RATIO; });
    }
  }

  function refreshSaveBtn() {
    if (!$pickerSave) return;
    const blocked = pickerDraft?.categoryId === 'custom' && !(pickerDraft.customSelectedLine || '').trim();
    $pickerSave.disabled = !!blocked;
  }

  async function savePicker() {
    if (!pickerDraft) { closePicker(); return; }
    if (pickerDraft.categoryId === 'custom' && !(pickerDraft.customSelectedLine || '').trim()) {
      showToast('请先填写至少 1 行自定义风格');
      return;
    }
    pinCurrent = { taskId: 'cover', categoryId: pickerDraft.categoryId };
    const writes = { [PIN_STORAGE_KEY]: pinCurrent };
    if (pickerDraft.categoryId === 'custom') {
      const cleanLines = parseCustomLines(pickerDraft.customPurpose);
      const fullText = cleanLines.join('\n').slice(0, CUSTOM_PURPOSE_MAX);
      const selectedLine = (pickerDraft.customSelectedLine || '').trim();
      pinCustomPurpose = fullText;
      pinCustomSelectedLine = selectedLine;
      writes[CUSTOM_PURPOSE_KEY] = fullText;
      writes[CUSTOM_LINE_KEY] = selectedLine;
    }
    const ratio = (typeof pickerDraft.ratio === 'string' && RATIO_RE.test(pickerDraft.ratio)) ? pickerDraft.ratio : DEFAULT_RATIO;
    pinRatio = ratio;
    pinCustomRatios = [...pickerDraft.customRatios];
    writes[RATIO_KEY] = ratio;
    writes[RATIO_CUSTOM_LIST_KEY] = pinCustomRatios;
    try { await chrome.storage.local.set(writes); } catch (_) {}
    renderPin();
    closePicker();
    showToast('已保存置顶风格');
  }

  function bindPickerEvents() {
    if ($pinAction) $pinAction.addEventListener('click', executePin);
    if ($pinEdit) $pinEdit.addEventListener('click', openPicker);
    if ($pickerCancel) $pickerCancel.addEventListener('click', closePicker);
    if ($pickerSave) $pickerSave.addEventListener('click', savePicker);

    // 分类 radio change
    if ($pickerOptions) {
      $pickerOptions.addEventListener('change', (e) => {
        const t = e.target;
        if (t && t.name === 'pinStyle') {
          pickerDraft.categoryId = t.value;
          refreshPickerCustomVisibility();
          refreshSaveBtn();
        }
      });
    }
    // textarea input
    if ($pickerCustomInput) {
      $pickerCustomInput.addEventListener('input', () => {
        if (!pickerDraft) return;
        pickerDraft.customPurpose = $pickerCustomInput.value || '';
        activateCustomCategory();
        refreshPickerCounter();
        rebuildCustomDropdown();
        refreshSaveBtn();
      });
    }
    // dropdown change
    if ($pickerCustomSelect) {
      $pickerCustomSelect.addEventListener('change', () => {
        if (!pickerDraft) return;
        pickerDraft.customSelectedLine = $pickerCustomSelect.value || '';
        activateCustomCategory();
        refreshSaveBtn();
      });
    }
    // help links
    if ($pickerCustomHelp) {
      $pickerCustomHelp.addEventListener('click', () => {
        try { chrome.tabs.create({ url: COVER_HELP_URL_1 }); } catch (_) {}
      });
    }
    if ($pickerCustomHelp2) {
      $pickerCustomHelp2.addEventListener('click', () => {
        try { chrome.tabs.create({ url: COVER_HELP_URL_2 }); } catch (_) {}
      });
    }

    // Ratio select / 自定义比例输入
    if ($pickerRatioSelect) {
      $pickerRatioSelect.addEventListener('change', () => {
        const v = $pickerRatioSelect.value;
        if (v === RATIO_CUSTOM_TRIGGER) {
          $pickerRatioCustom.hidden = false;
          $pickerRatioHint.hidden = false;
          $pickerRatioHint.textContent = '格式：宽:高（数字，可带小数）';
          $pickerRatioHint.classList.remove('error');
          $pickerRatioInput.focus();
        } else {
          $pickerRatioCustom.hidden = true;
          $pickerRatioHint.hidden = true;
          pickerDraft.ratio = v;
        }
      });
    }
    if ($pickerRatioInput) {
      $pickerRatioInput.addEventListener('input', () => {
        $pickerRatioInput.classList.remove('invalid');
        $pickerRatioHint.classList.remove('error');
        $pickerRatioHint.textContent = '格式：宽:高（数字，可带小数）';
      });
      $pickerRatioInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); $pickerRatioAdd.click(); }
      });
    }
    if ($pickerRatioAdd) {
      $pickerRatioAdd.addEventListener('click', () => {
        const raw = ($pickerRatioInput.value || '').trim();
        if (!RATIO_RE.test(raw)) {
          $pickerRatioInput.classList.add('invalid');
          $pickerRatioHint.classList.add('error');
          $pickerRatioHint.textContent = '格式不对，应为 宽:高（如 2.35:1）';
          return;
        }
        if (RATIO_PRESETS.some((p) => p.value === raw) || pickerDraft.customRatios.includes(raw)) {
          pickerDraft.ratio = raw;
        } else {
          pickerDraft.customRatios.unshift(raw);
          if (pickerDraft.customRatios.length > RATIO_CUSTOM_MAX) {
            pickerDraft.customRatios = pickerDraft.customRatios.slice(0, RATIO_CUSTOM_MAX);
          }
          pickerDraft.ratio = raw;
        }
        $pickerRatioInput.value = '';
        $pickerRatioCustom.hidden = true;
        $pickerRatioHint.hidden = true;
        rebuildRatioDropdown();
      });
    }
  }

  // 拿 active tab（用 CCSKeywordClient 的 3 段 fallback）
  async function queryActiveTab() {
    if (globalThis.CCSKeywordClient?.getActiveTab) {
      return await globalThis.CCSKeywordClient.getActiveTab();
    }
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs && tabs[0] || null;
    } catch (_) { return null; }
  }

  // 关键字加载：与 popup-v2 同 pattern
  // - storage instant + sendMessage fresh 并发
  // - storage 命中先渲染（onInstant），fresh 回来覆盖
  async function loadKeyword(tab) {
    if (!tab || tab.id == null) return;
    currentTabId = tab.id;
    currentTabUrl = tab.url || '';

    if (globalThis.CCSKeywordClient) {
      globalThis.CCSKeywordClient.requestKeyword('sidepanel-init', {
        tab,
        instantFromStorage: true,
        onInstant: (cached) => {
          if (!currentKw && cached?.text) setKeyword(cached.text);
        }
      }).then((fresh) => {
        if (fresh?.text) setKeyword(fresh.text);
      }).catch((err) => {
        console.warn('[sp-v2] requestKeyword 失败:', err);
      });
    } else {
      // 极端 fallback：直接 storage 读
      try {
        const key = KW_PREFIX + tab.id;
        const d = await chrome.storage.local.get([key]);
        const e = d && d[key];
        if (e && typeof e === 'object'
            && Date.now() - (e.ts || 0) <= TTL_MS
            && (!currentTabUrl || !e.url || e.url === currentTabUrl)) {
          setKeyword(e.text || e.raw || '');
        }
      } catch (_) {}
    }
  }

  // 切标签 / URL 变化 / 标题变化 → 50ms debounce 刷新
  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      const tab = await queryActiveTab();
      if (tab && tab.id !== currentTabId) {
        // 切标签了：清当前关键字，再加载新 tab
        setKeyword('');
      }
      await loadKeyword(tab);
    }, TAB_REFRESH_DEBOUNCE_MS);
  }

  // ===== 事件绑定 =====
  function bindEvents() {
    // 复制关键字
    $kwCopy.addEventListener('click', async () => {
      if (!currentKw) return;
      try {
        await navigator.clipboard.writeText(currentKw);
        const o = $kwCopy.textContent;
        $kwCopy.textContent = '✓';
        setTimeout(() => { $kwCopy.textContent = o; }, 800);
      } catch (_) { showToast('复制失败'); }
    });

    // 剪贴板兜底：读 navigator.clipboard.readText → 写 storage → 触发刷新
    $clipboardBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        const cleaned = (text || '').trim();
        if (!cleaned) { showToast('剪贴板为空'); return; }
        // 上限对齐 AI 引擎硬上限（与旧 sidepanel 一致）
        const limited = cleaned.slice(0, 6000);
        setKeyword(limited);
        // 同步写 storage 让其它路径也能拿到（popup 等）
        if (currentTabId != null) {
          const payload = { text: limited, raw: limited, url: currentTabUrl || '', ts: Date.now() };
          try { await chrome.storage.local.set({ [KW_PREFIX + currentTabId]: payload }); } catch (_) {}
        }
      } catch (err) {
        console.warn('[sp-v2] 剪贴板读取失败:', err);
        showToast('剪贴板读取失败');
      }
    });

    // AI 提示 popover toggle（点 ⚠️ 切换显隐 + 外部点击关闭 + ESC 关闭）
    if ($tipWarn) {
      $tipWarn.addEventListener('click', (e) => {
        e.stopPropagation();
        $tipPopover.hidden = !$tipPopover.hidden;
      });
    }
    if ($tipClose) {
      $tipClose.addEventListener('click', () => { $tipPopover.hidden = true; });
    }
    document.addEventListener('click', (e) => {
      if (!$tipPopover.hidden && !$tipPopover.contains(e.target) && e.target !== $tipWarn) {
        $tipPopover.hidden = true;
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$tipPopover.hidden) $tipPopover.hidden = true;
    });

    // storage onChanged 实时刷新关键字
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || currentTabId == null) return;
        const myKey = KW_PREFIX + currentTabId;
        if (!Object.prototype.hasOwnProperty.call(changes, myKey)) return;
        const v = changes[myKey].newValue;
        if (!v || typeof v !== 'object') { setKeyword(''); return; }
        if (Date.now() - (v.ts || 0) > TTL_MS) return;
        if (currentTabUrl && v.url && v.url !== currentTabUrl) return;
        setKeyword(v.text || v.raw || '');
      });
    } catch (_) {}

    // tab onActivated / onUpdated（debounce 50ms 刷新）
    try {
      chrome.tabs.onActivated.addListener(() => scheduleRefresh());
      chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
        if (tab && tab.active && (info.url || info.title || info.status === 'complete')) {
          scheduleRefresh();
        }
      });
    } catch (_) {}

    // 菜单 click 委托：与 popup-v2 同套路 —— 统一发 executeMenuAction 让 background 处理
    $menu.addEventListener('click', async (e) => {
      const itemEl = e.target.closest('.sp-menu-item[data-menu-id]');
      if (!itemEl || !$menu.contains(itemEl)) return;
      if (!currentKw) { showToast('请先选中文字'); return; }
      const item = {
        id: itemEl.dataset.menuId || '',
        type: itemEl.dataset.menuType || '',
        urlPattern: itemEl.dataset.urlPattern || '',
        action: itemEl.dataset.action || '',
        engineId: itemEl.dataset.engineId || '',
        purpose: itemEl.dataset.purpose || ''
      };
      const payload = {
        action: 'executeMenuAction',
        menuItemId: item.id,
        menuType: item.type,
        keyword: currentKw,
        urlPattern: item.urlPattern,
        actionType: item.action,
        engineId: item.engineId,
        purpose: item.purpose
      };
      try {
        const client = globalThis.CCSRuntimeClient;
        if (client?.sendRuntimeMessage) {
          const result = await client.sendRuntimeMessage(payload, { timeoutMs: 5000, retries: 1 });
          if (!result.ok) { showToast('操作失败'); return; }
          const resp = result.data || {};
          if (resp.success) {
            // sidepanel 不 window.close()，让用户继续操作
          } else if (resp.error === 'no-keyword') {
            showToast('没有可用关键字');
          }
        } else {
          chrome.runtime.sendMessage(payload).catch(() => {});
        }
      } catch (err) {
        console.warn('[sp-v2] executeMenuAction 失败:', err);
        showToast('操作失败');
      }
    });

    // background push keywordUpdated（即时回包）
    try {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        try {
          if (!message || typeof message !== 'object') return false;
          if (message.action === 'keywordUpdated' && message.keyword) {
            setKeyword(message.keyword.text || message.keyword.raw || '');
            return false;
          }
          // Voice 模块相关 push（仅在已 lazy load 时转发）
          if (message.action === 'ccsVoicePermissionGranted' ||
              message.action === 'ccsVoiceVisibleRecognized' ||
              message.action === 'ccsVoiceVisibleError') {
            if (voicePanel) voicePanel.handleMessage(message.action, message);
            return false;
          }
        } catch (err) { console.warn('[sp-v2] onMessage 错误:', err); }
        return false;
      });
    } catch (_) {}
  }

  // ===== Voice lazy load =====
  // 启动期读 ccs_voice_enabled，true 才显示 🎤 按钮；点了才 dynamic load voice.js
  function bindVoiceEntry() {
    chrome.storage.local.get(['ccs_voice_enabled'], (r) => {
      voiceEnabled = r.ccs_voice_enabled === true;
      updateVoiceBtnVisibility();
    });
    if ($kwVoice) {
      $kwVoice.addEventListener('click', async () => {
        if (!voiceEnabled) { showToast('请先到 popup 设置启用语音功能'); return; }
        try {
          await ensureVoiceLoaded();
          if (voicePanel) voicePanel.start();
        } catch (err) {
          console.warn('[sp-v2] voice 加载失败:', err);
          showToast('语音模块加载失败');
        }
      });
    }
    // storage 监听 voice toggle 变化（popup 改了立即同步）
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !('ccs_voice_enabled' in changes)) return;
        voiceEnabled = changes.ccs_voice_enabled.newValue === true;
        updateVoiceBtnVisibility();
        if (!voiceEnabled && voicePanel) voicePanel.cancel();
      });
    } catch (_) {}
  }

  function updateVoiceBtnVisibility() {
    if (!$kwVoice) return;
    // 显示条件：voiceEnabled + 关键字非空（让用户先有 keyword 再点 🎤）
    $kwVoice.hidden = !(voiceEnabled && currentKw);
  }

  function ensureVoiceLoaded() {
    if (voicePanel) return Promise.resolve();
    if (voiceLoadPromise) return voiceLoadPromise;
    voiceLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'voice.js';
      s.onload = () => {
        if (!globalThis.CCSVoice?.create) { reject(new Error('CCSVoice 未注册')); return; }
        voicePanel = globalThis.CCSVoice.create({
          showToast,
          getKeyword: () => currentKw,
          // 候选词被选中 → 走 executeMenuAction（voice "选引擎"，keyword 用当前已选）
          onPick: (item) => {
            const payload = {
              action: 'executeMenuAction',
              menuItemId: item.id,
              menuType: item.type || 'search',
              keyword: currentKw,
              urlPattern: item.urlPattern,
              engineId: item.engineId,
              actionType: item.action,
              purpose: item.purpose
            };
            try {
              const client = globalThis.CCSRuntimeClient;
              if (client?.sendRuntimeMessage) client.sendRuntimeMessage(payload, { timeoutMs: 5000, retries: 1 });
              else chrome.runtime.sendMessage(payload).catch(() => {});
            } catch (_) {}
          },
          // 候选引擎集合：从 prebuild 注入的菜单里取所有 leaf search/ai-chat/translate 类
          collectEngineItems: () => {
            const items = [];
            const validTypes = new Set(['search', 'ai-chat', 'ai-search', 'ecommerce', 'translate', 'portal']);
            $menu.querySelectorAll('.sp-menu-item[data-menu-id]').forEach((el) => {
              const type = el.dataset.menuType || '';
              if (!validTypes.has(type)) return;
              items.push({
                id: el.dataset.menuId || '',
                type,
                title: el.querySelector('.sp-item-title')?.textContent || '',
                icon: el.querySelector('.sp-item-icon')?.textContent || '',
                urlPattern: el.dataset.urlPattern || '',
                engineId: el.dataset.engineId || ''
              });
            });
            return items;
          }
        });
        resolve();
      };
      s.onerror = (e) => { voiceLoadPromise = null; reject(e); };
      document.head.appendChild(s);
    });
    return voiceLoadPromise;
  }

  // 关键字变化时刷新 🎤 按钮可见性
  document.addEventListener('sp-keyword-change', () => updateVoiceBtnVisibility());

  // ===== Alive port =====
  // sidepanel 打开时建一条 chrome.runtime.connect('sidepanel-alive') 长连接：
  // - SW 在 sidepanel 开着的全程不会被 idle evict（消息往返保持唤醒）
  // - 监听 background 推送 {action: 'close'} 自动 window.close()
  // - port 断开后 500ms 重连（SW 重启 / 网络抖动 / chrome 内部 GC 等场景）
  // - 推迟到 requestIdleCallback（800ms 兜底）执行，不和首屏争 CPU
  let alivePort = null;
  let aliveReconnectTimer = null;
  function setupAlivePort() {
    if (alivePort) return;
    try {
      alivePort = chrome.runtime.connect({ name: 'sidepanel-alive' });
      alivePort.onMessage.addListener((msg) => {
        if (msg && msg.action === 'close') {
          try { window.close(); } catch (_) {}
        }
      });
      alivePort.onDisconnect.addListener(() => {
        alivePort = null;
        if (aliveReconnectTimer) clearTimeout(aliveReconnectTimer);
        aliveReconnectTimer = setTimeout(setupAlivePort, 500);
      });
    } catch (err) {
      console.warn('[sp-v2] alive port 失败:', err);
      alivePort = null;
    }
  }
  function idleSchedule(fn, fallbackMs = 800) {
    if (typeof globalThis.requestIdleCallback === 'function') {
      globalThis.requestIdleCallback(fn, { timeout: fallbackMs });
    } else {
      setTimeout(fn, fallbackMs);
    }
  }
  idleSchedule(setupAlivePort, 800);

  // ===== 启动 =====
  bindEvents();
  bindPickerEvents();
  bindVoiceEntry();
  queryActiveTab().then(loadKeyword);
  initPin();   // 并行拉 storage + coverPrompts.json，启动后渲染封面卡片
})();
