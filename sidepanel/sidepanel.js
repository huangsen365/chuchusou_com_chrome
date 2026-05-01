/**
 * 触触搜 Side Panel - 简化快捷菜单
 * 只显示置顶操作 + 一级菜单项（无子菜单）
 */

const PIN_STORAGE_KEY = 'ccs_sidepanel_pinned_action';
const CUSTOM_PURPOSE_KEY = 'ccs_cover_custom_purpose';        // textarea 全文（用户预设库）
const CUSTOM_LINE_KEY = 'ccs_cover_custom_selected_line';      // 当前应用的那一行
const CUSTOM_PURPOSE_MAX = 600;
const CUSTOM_LINE_PREVIEW_MAX = 15;                            // dropdown 选项 / 卡片副标题截断长度（中文 15 字内，避免挤爆容器）
const DEFAULT_PIN = { taskId: 'cover', categoryId: 'xiaohongshu' };

// 比例（适用所有封面调用 · 全局生效）
const RATIO_KEY = 'ccs_cover_aspect_ratio';                    // 当前选中比例（如 "5:2"）
const RATIO_CUSTOM_LIST_KEY = 'ccs_cover_custom_ratios';        // 用户保存的自定义比例数组
const RATIO_CUSTOM_MAX = 5;                                     // 最多保留 5 个，溢出剔除最旧
const DEFAULT_RATIO = '5:2';
const RATIO_RE = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/;
// 10 个预设按"宽到窄"排序，覆盖国内外主流自媒体平台
const RATIO_PRESETS = [
  { value: '5:2',    label: '5:2 · 横幅封面（默认）' },
  { value: '2.35:1', label: '2.35:1 · 微信公众号头图 / 电影宽屏' },
  { value: '2:1',    label: '2:1 · 横幅卡片（Twitter / 知乎）' },
  { value: '16:9',   label: '16:9 · 通用横屏（YouTube / B 站 / 视频号）' },
  { value: '3:2',    label: '3:2 · 头条号 / 摄影标准' },
  { value: '4:3',    label: '4:3 · 传统媒体 / PPT' },
  { value: '1:1',    label: '1:1 · 方形（Instagram / 微博 / 朋友圈）' },
  { value: '4:5',    label: '4:5 · 竖版图文（Instagram 推荐）' },
  { value: '3:4',    label: '3:4 · 竖版封面（小红书原生 / Pinterest）' },
  { value: '9:16',   label: '9:16 · 手机竖屏（抖音 / TikTok / Reels / 视频号）' }
];
const RATIO_CUSTOM_TRIGGER = '__custom__';

// 自定义风格"不知道填什么？"参考链接——让 ChatGPT 列 30 个封面风格名供用户挑选
const COVER_STYLE_REFERENCE_URL = 'https://chatgpt.com/?prompt=%E6%88%91%E9%9C%80%E8%A6%81%E4%BD%A0%E4%B8%BA%E2%80%9C%E5%B0%81%E9%9D%A2%E5%9B%BE%E8%AE%BE%E8%AE%A1%E9%A3%8E%E6%A0%BC%E5%8F%82%E8%80%83%E2%80%9D%E7%94%9F%E6%88%90%E4%B8%80%E4%B8%AA%E5%88%97%E8%A1%A8%E3%80%82%0A%0A%E8%A6%81%E6%B1%82%EF%BC%9A%0A-+%E8%BE%93%E5%87%BA%E7%BA%A630%E4%B8%AA%E9%A3%8E%E6%A0%BC%E5%90%8D%E7%A7%B0%0A-+%E6%AF%8F%E8%A1%8C%E4%B8%80%E4%B8%AA%E9%A3%8E%E6%A0%BC%0A-+%E4%BB%85%E4%BD%BF%E7%94%A8%E7%BA%AF%E6%96%87%E6%9C%AC%EF%BC%88plain+text%EF%BC%89%EF%BC%8C%E4%B8%8D%E8%A6%81%E4%BD%BF%E7%94%A8%E7%BC%96%E5%8F%B7%E3%80%81%E7%AC%A6%E5%8F%B7%E6%88%96%E8%A7%A3%E9%87%8A%0A-+%E4%B8%8D%E8%A6%81%E6%B7%BB%E5%8A%A0%E4%BB%BB%E4%BD%95%E9%A2%9D%E5%A4%96%E8%AF%B4%E6%98%8E%E6%88%96%E5%89%8D%E5%90%8E%E7%BC%80%E6%96%87%E5%AD%97%0A-+%E9%A3%8E%E6%A0%BC%E5%8F%AF%E4%BB%A5%E6%9D%A5%E8%87%AA%E5%85%A8%E7%90%83%EF%BC%8C%E4%BD%86%E8%AF%B7%E4%BC%98%E5%85%88%E5%8C%85%E5%90%AB%E7%AC%A6%E5%90%88%E5%8D%8E%E4%BA%BA%2F%E4%B8%AD%E5%9B%BD%E5%AE%A1%E7%BE%8E%E7%9A%84%E8%AE%BE%E8%AE%A1%E9%A3%8E%E6%A0%BC%0A-+%E9%A3%8E%E6%A0%BC%E5%90%8D%E7%A7%B0%E5%B0%BD%E9%87%8F%E7%AE%80%E6%B4%81%EF%BC%88%E5%A6%82%E2%80%9CXX%E9%A3%8E%E6%A0%BC%E2%80%9D%E6%88%96%E5%B8%B8%E8%A7%81%E8%A1%A8%E8%BE%BE%EF%BC%89%0A%0A%E7%A4%BA%E4%BE%8B%E6%A0%BC%E5%BC%8F%EF%BC%88%E4%BB%85%E4%BE%9B%E5%8F%82%E8%80%83%EF%BC%8C%E4%B8%8D%E8%A6%81%E5%A4%8D%E7%94%A8%E7%A4%BA%E4%BE%8B%E5%86%85%E5%AE%B9%EF%BC%89%EF%BC%9A%0A%E5%B0%8F%E7%BA%A2%E4%B9%A6%E5%B0%81%E9%9D%A2%E9%A3%8E%E6%A0%BC%0A%E6%A4%B0%E6%A0%91%E7%89%8C%E6%B5%B7%E6%8A%A5%E9%A3%8E%E6%A0%BC%0A%0A%E8%AF%B7%E7%9B%B4%E6%8E%A5%E8%BE%93%E5%87%BA%E5%88%97%E8%A1%A8%E5%86%85%E5%AE%B9%E3%80%82';

function parseCustomLines(text) {
  if (typeof text !== 'string') return [];
  return text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
}

function truncateLine(s, max = CUSTOM_LINE_PREVIEW_MAX) {
  if (typeof s !== 'string') return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// Use JS transforms instead of CSS marquee; Windows can disable/freeze CSS animation here.
function setupMarquee(viewportSelector, textSelector, options = {}) {
  const viewport = document.querySelector(viewportSelector);
  const text = document.querySelector(textSelector);
  if (!viewport || !text) return;

  const speed = options.speed || 42;
  let viewportWidth = 0;
  let textWidth = 0;
  let distance = 1;
  let offset = 0;
  let lastTime = performance.now();

  text.style.animation = 'none';
  text.style.paddingLeft = '0';

  const measure = () => {
    viewportWidth = Math.ceil(viewport.getBoundingClientRect().width);
    textWidth = Math.ceil(text.scrollWidth || text.getBoundingClientRect().width);
    distance = Math.max(1, viewportWidth + textWidth);
    offset %= distance;
  };

  const tick = (now) => {
    if (viewportWidth <= 0 || textWidth <= 0) {
      measure();
    }

    const delta = Math.min(now - lastTime, 100);
    offset = (offset + delta * speed / 1000) % distance;

    lastTime = now;
    text.style.transform = `translateX(${Math.round(viewportWidth - offset)}px)`;
    requestAnimationFrame(tick);
  };

  measure();
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    viewport._ccsMarqueeState = { observer };
  } else {
    window.addEventListener('resize', measure);
  }
  window.addEventListener('load', measure, { once: true });
  requestAnimationFrame(tick);
}

class PinnedAction {
  constructor(renderer) {
    this.renderer = renderer;
    this.coverConfig = null;
    this.current = { ...DEFAULT_PIN };
    this.customPurpose = '';        // textarea 全文（多行预设库）
    this.customSelectedLine = '';   // 当前应用的那一行
    this.ratio = DEFAULT_RATIO;     // 当前选中比例
    this.customRatios = [];         // 用户保存的自定义比例
    this.draft = null;
    this.draftCustomPurpose = '';
    this.draftCustomSelectedLine = '';
    this.draftRatio = DEFAULT_RATIO;
    this.draftCustomRatios = [];
  }

  async init() {
    const [stored, customPurpose, customLine, ratioInfo, coverCfg] = await Promise.all([
      this.loadStored(),
      this.loadCustomPurpose(),
      this.loadCustomLine(),
      this.loadRatioInfo(),
      this.loadCoverConfig()
    ]);
    this.coverConfig = coverCfg;
    this.customPurpose = customPurpose || '';
    this.ratio = ratioInfo.ratio;
    this.customRatios = ratioInfo.customRatios;
    // 兼容旧版本：CUSTOM_LINE_KEY 没存过时，把全文作为单行 fallback
    this.customSelectedLine = customLine || (parseCustomLines(this.customPurpose)[0] || '');
    if (stored && this.findCategory(stored.categoryId, coverCfg)) {
      // custom 风格但没保存过有效行 → 退回默认
      if (stored.categoryId === 'custom' && !this.customSelectedLine) {
        this.current = { ...DEFAULT_PIN };
      } else {
        this.current = stored;
      }
    } else {
      this.current = { ...DEFAULT_PIN };
    }
    if (!coverCfg || !Array.isArray(coverCfg.categories) || coverCfg.categories.length === 0) {
      // 没有 cover 配置就不显示置顶区
      return;
    }
    document.getElementById('spPin').hidden = false;
    this.render();
    this.attachListeners();
  }

  loadStored() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([PIN_STORAGE_KEY], (result) => {
          resolve(result?.[PIN_STORAGE_KEY] || null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  loadCustomPurpose() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([CUSTOM_PURPOSE_KEY], (result) => {
          const v = result?.[CUSTOM_PURPOSE_KEY];
          resolve(typeof v === 'string' ? v : '');
        });
      } catch (_) {
        resolve('');
      }
    });
  }

  loadCustomLine() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([CUSTOM_LINE_KEY], (result) => {
          const v = result?.[CUSTOM_LINE_KEY];
          resolve(typeof v === 'string' ? v : '');
        });
      } catch (_) {
        resolve('');
      }
    });
  }

  loadRatioInfo() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([RATIO_KEY, RATIO_CUSTOM_LIST_KEY], (result) => {
          const r = result?.[RATIO_KEY];
          const list = result?.[RATIO_CUSTOM_LIST_KEY];
          resolve({
            ratio: (typeof r === 'string' && RATIO_RE.test(r.trim())) ? r.trim() : DEFAULT_RATIO,
            customRatios: Array.isArray(list) ? list.filter((x) => typeof x === 'string' && RATIO_RE.test(x)) : []
          });
        });
      } catch (_) {
        resolve({ ratio: DEFAULT_RATIO, customRatios: [] });
      }
    });
  }

  async loadCoverConfig() {
    try {
      const url = chrome.runtime.getURL('prompts/coverPrompts.json');
      const response = await fetch(url);
      if (!response.ok) return null;
      return await response.json();
    } catch (_) {
      return null;
    }
  }

  findCategory(id, cfg = this.coverConfig) {
    if (!cfg || !Array.isArray(cfg.categories)) return null;
    return cfg.categories.find((c) => c.id === id) || null;
  }

  render() {
    const cat = this.findCategory(this.current.categoryId);
    if (!cat) return;
    const styleEl = document.getElementById('spPinStyle');
    const taskEl = document.getElementById('spPinTask');
    if (taskEl) {
      taskEl.textContent = '封面生成器（建议字数适中）';
      taskEl.title = '建议选择字数适中，否则图片效果不佳';
    }
    if (!styleEl) return;
    if (cat.id === 'custom') {
      // 自定义：副标题用当前选中行的截断预览（应用层 truncateLine 默认 15 字 + CSS ellipsis 兜底）
      const line = (this.customSelectedLine || '').trim();
      const preview = truncateLine(line);
      styleEl.textContent = preview ? `🖌️ ${preview}` : '🖌️ 自定义风格';
      styleEl.title = line || '';
    } else {
      styleEl.textContent = cat.label || cat.id;
      styleEl.title = '';
    }
  }

  attachListeners() {
    document.getElementById('spPinAction').addEventListener('click', () => this.execute());
    document.getElementById('spPinEdit').addEventListener('click', () => this.openPicker());
    document.getElementById('spPinCancel').addEventListener('click', () => this.closePicker());
    document.getElementById('spPinSave').addEventListener('click', () => this.savePicker());
    this.bindTaskInfoPopover();
  }

  // ⓘ 详情弹层：click 切换（不是 hover）；点外部 / ESC / × 关闭
  // 点 ⓘ 时 stopPropagation 防止冒泡触发 .sp-pin-action 的 execute()
  bindTaskInfoPopover() {
    const infoEl = document.getElementById('spPinTaskInfo');
    const popover = document.getElementById('spPinTaskPopover');
    if (!infoEl || !popover) return;

    const setOpen = (open) => {
      popover.hidden = !open;
      infoEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    const isOpen = () => !popover.hidden;
    const toggle = () => setOpen(!isOpen());
    const close = () => setOpen(false);

    infoEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();              // 阻止冒泡到 .sp-pin-action button → 不触发封面生成
      toggle();
    });
    // 键盘可达：tab focus 后 Enter/Space 切换
    infoEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }
    });

    const closeBtn = popover.querySelector('.sp-pin-task-popover-close');
    if (closeBtn) closeBtn.addEventListener('click', close);

    // 点击 popover/info 之外的任意位置关闭
    document.addEventListener('click', (e) => {
      if (!isOpen()) return;
      if (popover.contains(e.target) || infoEl.contains(e.target)) return;
      close();
    });
    // ESC 关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) close();
    });
  }

  async execute() {
    const cat = this.findCategory(this.current.categoryId);
    if (!cat) return;
    const engine = (cat.engines || [])[0];
    if (!engine) {
      this.renderer.showToast('该风格暂无可用引擎');
      return;
    }
    // 自定义风格：用 storage 里用户填写的文本作为 purpose；无文本则提示先去设置
    let purpose = cat.purpose || cat.label;
    if (cat.id === 'custom') {
      const userText = (this.customSelectedLine || '').trim();
      if (!userText) {
        this.renderer.showToast('请先点 ✏️ 填写自定义风格');
        return;
      }
      purpose = userText;
    }
    await this.renderer.refresh();
    const keyword = this.renderer.keyword.raw || this.renderer.keyword.text;
    const menuItemId = `ccs-cover-${cat.id}-${engine.id}`;
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'executeMenuAction',
        menuItemId,
        menuType: 'cover',
        keyword,
        urlPattern: engine.urlPattern,
        engineId: engine.id,
        purpose,
        categoryId: cat.id
      });
      if (response && response.error === 'no-keyword') {
        this.renderer.showToast('没有选中文本或无法提取关键词');
      }
    } catch (_) {
      this.renderer.showToast('操作失败');
    }
  }

  openPicker() {
    this.draft = { ...this.current };
    this.draftCustomPurpose = this.customPurpose || '';
    this.draftCustomSelectedLine = this.customSelectedLine || '';
    // 打开 picker 时把当前 textarea 解析的行作为基线，避免首次 rebuild 把现有行误判成"新增"
    this.lastDropdownLines = parseCustomLines(this.draftCustomPurpose);
    this.draftRatio = this.ratio || DEFAULT_RATIO;
    this.draftCustomRatios = [...this.customRatios];
    const list = document.getElementById('spPinOptions');
    list.innerHTML = '';
    (this.coverConfig?.categories || []).forEach((cat) => {
      const optId = `pin-opt-${cat.id}`;
      const checked = cat.id === this.draft.categoryId ? 'checked' : '';
      const label = document.createElement('label');
      label.className = 'sp-pin-option';
      label.htmlFor = optId;
      label.innerHTML = `
        <input type="radio" name="pinStyle" id="${optId}" value="${cat.id}" ${checked}>
        <span class="sp-pin-option-label">${cat.id === 'custom' ? '🖌️ ' + (cat.label || cat.id) : (cat.label || cat.id)}</span>
      `;
      list.appendChild(label);
    });
    list.onchange = (e) => {
      const target = e.target;
      if (target && target.name === 'pinStyle') {
        this.draft.categoryId = target.value;
        this.refreshPickerCustomVisibility();
        this.refreshSaveBtn();
      }
    };
    // 初始化 textarea
    const ta = document.getElementById('spPinCustomInput');
    if (ta) {
      ta.value = this.draftCustomPurpose;
      ta.oninput = () => {
        this.draftCustomPurpose = ta.value || '';
        this.activateCustomCategory();   // 用户在编辑自定义文本 → 意图就是用自定义
        this.refreshPickerCounter();
        this.rebuildCustomDropdown();
        this.refreshSaveBtn();
      };
    }
    // 初始化 dropdown
    const sel = document.getElementById('spPinCustomSelect');
    if (sel) {
      sel.onchange = () => {
        this.draftCustomSelectedLine = sel.value || '';
        this.activateCustomCategory();   // 用户在选 dropdown 行 → 自动激活自定义模式
        this.refreshSaveBtn();
      };
    }
    // 「💡 不知道填什么？」帮助链接：跳 ChatGPT 让它列 30 个封面风格供用户挑
    const helpBtn = document.getElementById('spPinCustomHelp');
    if (helpBtn) {
      helpBtn.onclick = () => {
        try { chrome.tabs.create({ url: COVER_STYLE_REFERENCE_URL }); } catch (_) { /* ignore */ }
      };
    }
    this.refreshPickerCustomVisibility();
    this.refreshPickerCounter();
    this.rebuildCustomDropdown();
    this.bindRatioControls();
    this.rebuildRatioDropdown();
    this.refreshSaveBtn();
    const picker = document.getElementById('spPinPicker');
    picker.hidden = false;
    // .sp-pin 已经 sticky 在顶部，picker 在主滚动区，用户当前滚到中段时点 ✏️ 会看不到 picker；
    // 自动滚回顶部确保 picker 可见
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
  }

  bindRatioControls() {
    const sel = document.getElementById('spPinRatioSelect');
    const customBox = document.getElementById('spPinRatioCustom');
    const input = document.getElementById('spPinRatioInput');
    const addBtn = document.getElementById('spPinRatioAdd');
    const hint = document.getElementById('spPinRatioHint');
    if (!sel || !customBox || !input || !addBtn || !hint) return;

    sel.onchange = () => {
      const v = sel.value;
      if (v === RATIO_CUSTOM_TRIGGER) {
        customBox.hidden = false;
        hint.hidden = false;
        hint.textContent = '格式：宽:高（数字，可带小数）';
        hint.classList.remove('error');
        input.focus();
      } else {
        customBox.hidden = true;
        hint.hidden = true;
        this.draftRatio = v;
      }
    };
    input.oninput = () => {
      input.classList.remove('invalid');
      hint.classList.remove('error');
      hint.textContent = '格式：宽:高（数字，可带小数）';
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); }
    };
    addBtn.onclick = () => {
      const raw = (input.value || '').trim();
      if (!RATIO_RE.test(raw)) {
        input.classList.add('invalid');
        hint.classList.add('error');
        hint.textContent = '格式不对，应为 宽:高（如 2.35:1）';
        return;
      }
      // 已存在 → 直接选中，不重复加
      if (RATIO_PRESETS.some((p) => p.value === raw) || this.draftCustomRatios.includes(raw)) {
        this.draftRatio = raw;
      } else {
        this.draftCustomRatios.unshift(raw);
        if (this.draftCustomRatios.length > RATIO_CUSTOM_MAX) {
          this.draftCustomRatios = this.draftCustomRatios.slice(0, RATIO_CUSTOM_MAX);
        }
        this.draftRatio = raw;
      }
      input.value = '';
      customBox.hidden = true;
      hint.hidden = true;
      this.rebuildRatioDropdown();
    };
  }

  rebuildRatioDropdown() {
    const sel = document.getElementById('spPinRatioSelect');
    if (!sel) return;
    sel.innerHTML = '';
    const groups = [];
    if (this.draftCustomRatios.length > 0) {
      groups.push({ label: '自定义', items: this.draftCustomRatios.map((v) => ({ value: v, label: `${v} · 自定义` })) });
    }
    groups.push({ label: '预设', items: RATIO_PRESETS });
    for (const g of groups) {
      const og = document.createElement('optgroup');
      og.label = g.label;
      for (const it of g.items) {
        const opt = document.createElement('option');
        opt.value = it.value;
        opt.textContent = it.label;
        if (it.value === this.draftRatio) opt.selected = true;
        og.appendChild(opt);
      }
      sel.appendChild(og);
    }
    // 末尾加"+ 自定义"触发项
    const trigger = document.createElement('option');
    trigger.value = RATIO_CUSTOM_TRIGGER;
    trigger.textContent = '➕ 自定义比例…';
    sel.appendChild(trigger);
    // 当前 draftRatio 不在任何 option 里 → 退回默认
    if (![...sel.options].some((o) => o.value === this.draftRatio && o.value !== RATIO_CUSTOM_TRIGGER)) {
      this.draftRatio = DEFAULT_RATIO;
      [...sel.options].forEach((o) => { o.selected = o.value === DEFAULT_RATIO; });
    }
  }

  refreshPickerCustomVisibility() {
    const box = document.getElementById('spPinCustom');
    if (!box) return;
    box.hidden = this.draft?.categoryId !== 'custom';
  }

  /**
   * 用户在自定义编辑区做了任意操作（改 textarea / 选 dropdown）→
   * 自动把 radio 切到「自定义」并同步 UI，不需要再手动点上面的 radio。
   * 已是 custom 时是 no-op。
   */
  activateCustomCategory() {
    if (!this.draft || this.draft.categoryId === 'custom') return;
    this.draft.categoryId = 'custom';
    const radio = document.querySelector('input[name="pinStyle"][value="custom"]');
    if (radio) radio.checked = true;
    this.refreshPickerCustomVisibility();
  }

  refreshPickerCounter() {
    const counter = document.getElementById('spPinCustomCounter');
    if (counter) counter.textContent = String((this.draftCustomPurpose || '').length);
  }

  rebuildCustomDropdown() {
    const sel = document.getElementById('spPinCustomSelect');
    if (!sel) return;
    const lines = parseCustomLines(this.draftCustomPurpose);
    sel.innerHTML = '';
    if (lines.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '（请先在上方填写至少 1 行预设）';
      opt.disabled = true;
      sel.appendChild(opt);
      sel.disabled = true;
      this.draftCustomSelectedLine = '';
      this.lastDropdownLines = [];
      return;
    }
    sel.disabled = false;
    // 优先级：(1) 用户刚加的新行（最末一个新增）→ 自动选中  (2) 原选中行还在 → 保持
    //         (3) 退回第一行
    // 从后往前找：用户多行粘贴时，最末新增行通常是用户最关注的
    const added = [...lines].reverse().find((l) => !this.lastDropdownLines.includes(l));
    let chosen;
    if (added) {
      chosen = added;
    } else if (lines.includes(this.draftCustomSelectedLine)) {
      chosen = this.draftCustomSelectedLine;
    } else {
      chosen = lines[0];
    }
    lines.forEach((line) => {
      const opt = document.createElement('option');
      opt.value = line;
      opt.textContent = truncateLine(line);
      opt.title = line;
      if (line === chosen) opt.selected = true;
      sel.appendChild(opt);
    });
    // 显式同步 select.value，防止某些浏览器在 innerHTML 重建后 selectedIndex 残留默认 0
    sel.value = chosen;
    this.draftCustomSelectedLine = chosen;
    this.lastDropdownLines = [...lines];
  }

  refreshSaveBtn() {
    const btn = document.getElementById('spPinSave');
    if (!btn) return;
    // custom 必须有选中行才能保存；其它风格随时可保存
    const blocked = this.draft?.categoryId === 'custom' && !(this.draftCustomSelectedLine || '').trim();
    btn.disabled = !!blocked;
  }

  closePicker() {
    document.getElementById('spPinPicker').hidden = true;
    this.draft = null;
    this.draftCustomPurpose = '';
    this.draftCustomSelectedLine = '';
    this.lastDropdownLines = [];
    this.draftRatio = DEFAULT_RATIO;
    this.draftCustomRatios = [];
  }

  async savePicker() {
    if (!this.draft) {
      this.closePicker();
      return;
    }
    if (this.draft.categoryId === 'custom' && !(this.draftCustomSelectedLine || '').trim()) {
      this.renderer.showToast('请先填写至少 1 行自定义风格');
      return;
    }
    this.current = { ...this.draft };
    const writes = { [PIN_STORAGE_KEY]: this.current };
    if (this.draft.categoryId === 'custom') {
      // 保存时统一 trim：parseCustomLines 已经做了 per-line trim + 丢空行，
      // 再 join('\n') 得到干净版本——避免用户输入残留前后空格 / 多余空行
      const cleanLines = parseCustomLines(this.draftCustomPurpose);
      const fullText = cleanLines.join('\n').slice(0, CUSTOM_PURPOSE_MAX);
      const selectedLine = (this.draftCustomSelectedLine || '').trim();
      this.customPurpose = fullText;
      this.customSelectedLine = selectedLine;
      writes[CUSTOM_PURPOSE_KEY] = fullText;
      writes[CUSTOM_LINE_KEY] = selectedLine;
    }
    // 比例：始终保存（与置顶风格独立但同存）
    const ratio = (typeof this.draftRatio === 'string' && RATIO_RE.test(this.draftRatio)) ? this.draftRatio : DEFAULT_RATIO;
    this.ratio = ratio;
    this.customRatios = [...this.draftCustomRatios];
    writes[RATIO_KEY] = ratio;
    writes[RATIO_CUSTOM_LIST_KEY] = this.customRatios;
    await new Promise((resolve) => {
      try {
        chrome.storage.local.set(writes, () => resolve());
      } catch (_) {
        resolve();
      }
    });
    this.render();
    this.closePicker();
    this.renderer.showToast('已保存置顶风格');
  }
}

class SidePanelRenderer {
  constructor() {
    this.config = null;
    this.keyword = { text: '', raw: '' };
    this.currentTabUrl = '';
    this.pinned = new PinnedAction(this);
    // 用户手动从剪贴板写入 keyword 时设 true；URL 变化时回 false
    // 用于防止后续 refresh() 在 chrome:// 等不支持选区的页面拉不到、把手动设的 keyword 清空
    this.keywordSetManually = false;
  }

  async init() {
    this.setupAlivePort();
    try {
      const [config, tabInfo] = await Promise.all([
        this.loadMenuConfig(),
        this.getActiveTab()
      ]);

      this.config = config;
      this.currentTabUrl = tabInfo.url || '';

      // Get keyword
      this.keyword = await this.getCurrentKeyword(tabInfo);

      this.renderKeyword();
      this.renderMenu();
      this.bindClipboardButton();
      this.bindCopyKeywordButton();
      // 置顶区独立于主菜单加载，失败不影响整体
      this.pinned.init().catch((err) => {
        console.warn('[触触搜] Pinned action init failed:', err);
      });

      // Listen for tab changes to update pinned actions
      chrome.tabs.onActivated.addListener(() => this.refresh());
      chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (changeInfo.url || changeInfo.status === 'complete') {
          this.refresh();
        }
      });

      // Listen for real-time keyword updates from background
      chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'keywordUpdated' && message.keyword) {
          this.keyword = {
            text: message.keyword.text || '',
            raw: message.keyword.raw || message.keyword.text || ''
          };
          this.renderKeyword();
        }
      });
    } catch (error) {
      console.error('[触触搜] Side panel init failed:', error);
      document.getElementById('spMenu').innerHTML =
        '<div class="sp-empty">加载失败，请重试</div>';
    }
  }

  // 通过 port 连接告诉 background 本侧边栏在哪个 window 活着，
  // 同时监听 background 发来的关闭信号（popup 点「关闭」时触发）
  // SW 重启 / 扩展重载会让 port 断开，自动重连保证状态不假报
  async setupAlivePort() {
    try {
      const win = await chrome.windows.getCurrent();
      const port = chrome.runtime.connect({ name: 'sidepanel-alive' });
      port.postMessage({ windowId: win.id });
      port.onMessage.addListener((msg) => {
        if (msg && msg.action === 'close') {
          try { window.close(); } catch (_) { /* 兜底 */ }
        }
      });
      port.onDisconnect.addListener(() => {
        // SW 重启或扩展重载导致断连，500ms 后重新建链
        setTimeout(() => this.setupAlivePort(), 500);
      });
    } catch (e) {
      console.warn('[触触搜] sidepanel alive port setup failed:', e);
    }
  }

  async refresh() {
    try {
      const tabInfo = await this.getActiveTab();
      const newUrl = tabInfo.url || '';
      const urlChanged = newUrl !== this.currentTabUrl;
      this.currentTabUrl = newUrl;

      const newKeyword = await this.getCurrentKeyword(tabInfo);

      // URL 变化 → 跟随新页面，清掉手动标记
      if (urlChanged) {
        this.keyword = newKeyword;
        this.keywordSetManually = false;
        this.renderKeyword();
        return;
      }

      // URL 没变 + 用户手动设过 keyword → 一律保留，不论自动提取是否有内容
      // 用户点 📋 是强烈意图信号：在这个页面用剪贴板内容做关键字
      // 之前的弱保护（仅 newKeyword 为空时不覆盖）会让标题提取 / 缓存选区悄悄替掉手动值，
      // 表现为"最后一次动作不是 📋 时，系统回到默认机制"——剪贴板数据其实在第一次 handleClick→refresh 时就被冲掉了
      // 退出条件：URL 变化（上面 urlChanged 分支已处理，此时 manual 标志被清掉）或用户再点 📋 写新值
      if (this.keywordSetManually) {
        return;
      }

      // 其它情况照常覆盖
      this.keyword = newKeyword;
      this.renderKeyword();
    } catch (e) {
      // Ignore refresh errors
    }
  }

  async getActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs[0] || { url: '', title: '', id: null });
      });
    });
  }

  async loadMenuConfig() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'getMenuStructure' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error('Config load failed'));
          return;
        }
        if (response && response.success) {
          resolve(response.structure);
        } else {
          reject(new Error(response?.error || 'Config load failed'));
        }
      });
    });
  }

  async getCurrentKeyword(tabInfo) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'getSearchText',
        tabId: tabInfo.id,
        url: tabInfo.url,
        title: tabInfo.title,
        forceFresh: true
      }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ text: '', raw: '' });
          return;
        }
        resolve({
          text: response?.text || '',
          raw: response?.raw || response?.text || ''
        });
      });
    });
  }

  renderKeyword() {
    const el = document.getElementById('spKeyword');
    const clipBtn = document.getElementById('spClipboardBtn');
    const copyBtn = document.getElementById('spKeywordCopy');
    if (this.keyword.text) {
      const display = this.keyword.text.replace(/\s+/g, ' ').trim();
      el.textContent = `"${display.length > 20 ? display.substring(0, 20) + '...' : display}"`;
      el.title = this.keyword.raw;
      if (clipBtn) clipBtn.hidden = true;
      if (copyBtn) copyBtn.hidden = false;       // 有 keyword → 露出复制按钮
    } else {
      el.textContent = '';
      if (clipBtn) clipBtn.hidden = false;
      if (copyBtn) copyBtn.hidden = true;         // 无 keyword → 隐藏复制按钮
    }
  }

  // 复制关键字按钮——keyword 徽章左侧的 📋 小图标
  // 点击把当前关键字（优先 raw 保段落）写到剪贴板，方便用户复用到其它地方
  bindCopyKeywordButton() {
    const btn = document.getElementById('spKeywordCopy');
    if (!btn) return;
    const original = btn.textContent;
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const text = (this.keyword.raw || this.keyword.text || '').trim();
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = '✓';
        btn.classList.add('copied');
        btn.disabled = true;
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove('copied');
          btn.disabled = false;
        }, 1200);
      } catch (err) {
        console.warn('[触触搜] 复制关键字失败:', err);
        this.showToast('复制失败，请检查浏览器权限');
      }
    });
  }

  // 剪贴板读取按钮——给 chrome:// 等不支持选区的页面做兜底
  // 用户复制文字后点这个按钮，把剪贴板内容写入关键字
  bindClipboardButton() {
    const btn = document.getElementById('spClipboardBtn');
    if (!btn) return;
    const original = btn.textContent;
    const reset = () => {
      btn.disabled = false;
      btn.textContent = original;
    };
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '⏳ 正在读取剪贴板...';
      try {
        const text = await navigator.clipboard.readText();
        const cleaned = (text || '').trim();
        if (!cleaned) {
          btn.textContent = '⚠️ 剪贴板为空，请先复制文字再点';
          setTimeout(reset, 2000);
          return;
        }
        // 上限对齐 backend AI Chat 引擎硬上限（utils/TextLimits.js LIMITS.aiChat = 6000）
        // 之前 500 太小，多段换行内容会被吃掉；下游 applyTextLimit 仍按 menuId 做引擎级保护
        const limited = cleaned.slice(0, 6000);
        this.keyword = {
          // text 用于徽章显示，把换行/连续空白合成单空格（视觉紧凑，不影响真实数据）
          text: limited.replace(/\s+/g, ' '),
          // raw 保留原始换行——执行菜单时走 keyword.raw，确保多段文字完整透传
          raw: limited
        };
        // 标记为手动设——后续 refresh() 在同 URL 下不会用空 keyword 覆盖它
        this.keywordSetManually = true;
        this.renderKeyword();   // keyword 非空 → 自动隐藏按钮
        this.renderMenu();       // 用新关键字重渲染菜单 URL
        // 即使按钮已 hidden，也立即重置文字 / disabled——
        // 否则后续 tab 事件触发 refresh() 让按钮重新露出时会"卡在正在读取"
        reset();
      } catch (err) {
        console.warn('[触触搜] 读剪贴板失败:', err);
        btn.textContent = '⚠️ 读取失败，请重试';
        setTimeout(reset, 2000);
      }
    });
  }

  renderMenu() {
    const container = document.getElementById('spMenu');
    container.innerHTML = '';

    if (!this.config || !this.config.groups) {
      container.innerHTML = '<div class="sp-empty">无菜单配置</div>';
      return;
    }

    let hasItems = false;

    this.config.groups.forEach((group, index) => {
      // Skip panel group
      if (group.id === 'panel') return;
      if (!group.items) return;

      // Filter to only leaf items (no children or empty children)
      const leafItems = group.items.filter(item => {
        if (item.enabled === false) return false;
        if (item.children && item.children.length > 0) return false;
        return true;
      });

      if (leafItems.length === 0) return;

      // Add separator between groups
      if (hasItems) {
        container.appendChild(this.createSeparator());
      }

      leafItems.forEach(item => {
        container.appendChild(this.createMenuItem(item));
      });

      hasItems = true;
    });

    if (!hasItems) {
      container.innerHTML = '<div class="sp-empty">无可用菜单项</div>';
    }
  }

  createSeparator() {
    const sep = document.createElement('div');
    sep.className = 'sp-separator';
    return sep;
  }

  createMenuItem(item) {
    const el = document.createElement('div');
    el.className = 'sp-menu-item';

    // Simplify title for fastqa-quick type
    let displayTitle = item.title || '';
    if (item.type === 'fastqa-quick') {
      const match = displayTitle.match(/- (.+)$/);
      if (match) {
        displayTitle = `速答 · ${match[1]}`;
      }
    }

    el.innerHTML = `
      <span class="sp-item-icon">${item.icon || ''}</span>
      <span class="sp-item-title">${displayTitle}</span>
    `;

    el.addEventListener('click', () => this.handleClick(item));
    return el;
  }

  async handleClick(item) {
    await this.refresh();
    // 关键字按目标类型分流：
    // - 搜索类 (search/ai-search/ecommerce/translate/portal)：取 keyword.text（已合并换行/连续空白成单空格）
    //   → 多段剪贴板内容里的 \n 不会编码成 %0A 灌进搜索查询、破坏语义
    // - AI 对话 / 速答 / 百问 / 优化 / 封面 / 工具：取 keyword.raw 保留原始段落结构
    const SEARCH_LIKE_TYPES = ['search', 'ai-search', 'ecommerce', 'translate', 'portal'];
    const keyword = SEARCH_LIKE_TYPES.includes(item.type)
      ? (this.keyword.text || this.keyword.raw)
      : (this.keyword.raw || this.keyword.text);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'executeMenuAction',
        menuItemId: item.id,
        menuType: item.type,
        keyword: keyword,
        urlPattern: item.urlPattern,
        actionType: item.action,
        engineId: item.engineId,
        purpose: item.purpose
      });

      if (response && response.error === 'no-keyword') {
        this.showToast('没有选中文本或无法提取关键词');
      }
    } catch (error) {
      console.error('[触触搜] Menu action failed:', error);
      this.showToast('操作失败');
    }
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'sp-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }
}

// 置顶区高度随剪贴板按钮 hidden/show 而变（多 ~44px），用 ResizeObserver
// 实时把真实高度同步到 body padding-top，避免菜单被压住或留出空白
function syncStickyTopPadding() {
  const stickyTop = document.getElementById('spStickyTop');
  if (!stickyTop) return;
  const apply = () => {
    const h = stickyTop.getBoundingClientRect().height;
    if (h > 0) document.body.style.paddingTop = `${Math.ceil(h)}px`;
  };
  apply();
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(apply).observe(stickyTop);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  syncStickyTopPadding();
  setupMarquee('.sp-pin-tip-marquee', '.sp-pin-tip-text', { speed: 42 });
  const renderer = new SidePanelRenderer();
  renderer.init();
});
