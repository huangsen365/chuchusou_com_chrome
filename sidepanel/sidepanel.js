/**
 * 触触搜 Side Panel - 简化快捷菜单
 * 只显示置顶操作 + 一级菜单项（无子菜单）
 */

const PIN_STORAGE_KEY = 'ccs_sidepanel_pinned_action';
const CUSTOM_PURPOSE_KEY = 'ccs_cover_custom_purpose';        // textarea 全文（用户预设库）
const CUSTOM_LINE_KEY = 'ccs_cover_custom_selected_line';      // 当前应用的那一行
const CUSTOM_PURPOSE_MAX = 5000;
const CUSTOM_LINE_PREVIEW_MAX = 15;                            // dropdown 选项 / 卡片副标题截断长度（中文 15 字内，避免挤爆容器）
const DEFAULT_PIN = { taskId: 'cover', categoryId: 'anime-cute' };

// 比例（适用所有封面调用 · 全局生效）
const RATIO_KEY = 'ccs_cover_aspect_ratio';                    // 当前选中比例（如 "5:2"）
const RATIO_CUSTOM_LIST_KEY = 'ccs_cover_custom_ratios';        // 用户保存的自定义比例数组
const RATIO_CUSTOM_MAX = 5;                                     // 最多保留 5 个，溢出剔除最旧
const DEFAULT_RATIO = '5:2';
const RATIO_RE = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/;
// 11 个预设按"宽到窄"排序，覆盖国内外主流自媒体平台
const RATIO_PRESETS = [
  { value: '5:2',    label: '5:2 · 横幅封面（默认）' },
  { value: '6:2',    label: '6:2 · X (Twitter / 推特) 个人主页 Banner（1500×500）' },
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
const COVER_STYLE_REFERENCE_URL = "https://chatgpt.com/?prompt=%E4%B8%BA%22%E5%B0%81%E9%9D%A2%E5%9B%BE%E8%AE%BE%E8%AE%A1%E9%A3%8E%E6%A0%BC%E5%8F%82%E8%80%83%22%E7%94%9F%E6%88%90%2030%20%E4%B8%AA%E9%A3%8E%E6%A0%BC%EF%BC%8C%E6%AF%8F%E8%A1%8C%E4%B8%80%E4%B8%AA%E3%80%82%0A%0A%E5%8F%82%E8%80%83%E6%96%B9%E5%90%91%EF%BC%9A%E6%97%A5%E7%B3%BB%E4%BA%8C%E6%AC%A1%E5%85%83%E6%97%A5%E5%B8%B8%20%2F%20%E6%A0%A1%E5%9B%AD%20%2F%20%E8%BD%BB%E5%96%9C%E5%89%A7%20%2F%20%E5%90%90%E6%A7%BD%20%2F%20%E5%AE%85%E6%96%87%E5%8C%96%20%2F%20%E7%A4%BE%E5%9B%A2%EF%BC%88%E3%80%8A%E5%B9%B8%E8%BF%90%E6%98%9F%E3%80%8B%E3%80%8A%E6%97%A5%E5%B8%B8%E3%80%8B%E3%80%8A%E7%94%B7%E9%AB%98%E6%97%A5%E5%B8%B8%E3%80%8B%E3%80%8A%E9%BD%90%E6%9C%A8%E6%A5%A0%E9%9B%84%E3%80%8B%E3%80%8A%E8%BD%BB%E9%9F%B3%E5%B0%91%E5%A5%B3%E3%80%8B%E3%80%8A%E9%87%8E%E5%B4%8E%E5%90%9B%E3%80%8B%E3%80%8A%E7%8E%B0%E8%A7%86%E7%A0%94%E3%80%8B%E7%AD%89%E6%B0%94%E8%B4%A8%EF%BC%89%E3%80%82%E7%94%B7%E5%A5%B3%E8%A7%92%E8%89%B2%E5%AF%B9%E5%8D%8A%EF%BC%8C%E9%81%BF%E5%85%8D%E9%BB%91%E6%9A%97%E3%80%81%E7%83%AD%E8%A1%80%E6%88%98%E6%96%97%E3%80%81%E8%B5%9B%E5%8D%9A%E6%9C%8B%E5%85%8B%E3%80%81%E6%81%90%E6%80%96%E3%80%81%E6%AC%A7%E7%BE%8E%E5%86%99%E5%AE%9E%E5%8E%9A%E6%B6%82%E3%80%82%0A%0A%E6%A0%BC%E5%BC%8F%EF%BC%9A%E7%BA%AF%E6%96%87%E6%9C%AC%EF%BC%8C%E4%B8%8D%E7%BC%96%E5%8F%B7%E3%80%81%E4%B8%8D%E9%A1%B9%E7%9B%AE%E7%AC%A6%E5%8F%B7%E3%80%81%E4%B8%8D%E8%A7%A3%E9%87%8A%E3%80%82%E5%A5%87%E6%95%B0%E8%A1%8C%E7%94%A8%E5%AE%8C%E6%95%B4%E5%8F%A5%E5%BC%8F%E6%8F%8F%E8%BF%B0%22%E5%9B%BE%E7%89%87%2F%E6%96%87%E5%AD%97%2F%E8%A7%92%E8%89%B2%2F%E9%85%8D%E8%89%B2%2F%E6%B0%9B%E5%9B%B4%2F%E7%82%B9%E5%87%BB%E6%84%9F%22%EF%BC%9B%E5%81%B6%E6%95%B0%E8%A1%8C%E7%94%A8%22%E9%A3%8E%E6%A0%BC%E5%90%8D%E7%A7%B0%EF%BC%88%E5%85%B3%E9%94%AE%E8%AF%8D%E8%A1%A5%E5%85%85%EF%BC%89%22%E6%A0%BC%E5%BC%8F%E3%80%82%E5%8F%AF%E5%8F%82%E8%80%83%E4%B8%80%E4%B8%AA%E6%88%96%E5%A4%9A%E4%B8%AA%E5%8A%A8%E6%BC%AB%E4%BD%9C%E5%93%81%E4%BD%86%E4%B8%8D%E7%85%A7%E6%90%AC%E5%8E%9F%E7%94%BB%E3%80%82%0A%0A%E7%A4%BA%E4%BE%8B%EF%BC%9A%0A%E5%9B%BE%E7%89%87%E6%96%87%E5%AD%97%E8%B6%B3%E5%A4%9F%E5%90%B8%E7%9D%9B%EF%BC%8C%E7%AE%80%E6%B4%81%E6%98%8E%E4%BA%AE%E7%9A%84%E6%97%A5%E7%B3%BB%E6%A0%A1%E5%9B%AD%E5%8A%A8%E6%BC%AB%E7%BA%BF%E7%A8%BF%EF%BC%8C%E5%8F%82%E8%80%83%E3%80%8A%E5%B9%B8%E8%BF%90%E6%98%9F%E3%80%8B%E5%8F%AF%E7%88%B1%E3%80%81%E6%97%A5%E5%B8%B8%E3%80%81%E8%BD%BB%E6%9D%BE%E5%90%90%E6%A7%BD%E6%B0%9B%E5%9B%B4%EF%BC%8C%E6%B8%85%E6%99%B0%E4%B8%BB%E8%89%B2%E8%B0%83%EF%BC%8C%E9%85%8D%E8%89%B2%E6%9F%94%E5%92%8C%E7%BB%9F%E4%B8%80%EF%BC%8C%E6%95%B4%E4%BD%93%E7%B2%BE%E8%87%B4%E5%8F%AF%E7%88%B1%E8%BD%BB%E6%9D%BE%E4%B8%94%E6%9C%89%E7%82%B9%E5%87%BB%E6%AC%B2%E3%80%82%0A%E6%97%A5%E7%B3%BB%E6%A0%A1%E5%9B%AD%E5%90%90%E6%A7%BD%E5%96%9C%E5%89%A7%E9%A3%8E%E6%A0%BC%EF%BC%88%E6%98%8E%E4%BA%AE%E6%95%99%E5%AE%A4%E8%83%8C%E6%99%AF%E3%80%81%E7%94%B7%E5%A5%B3%E5%AD%A6%E7%94%9F%E7%BE%A4%E5%83%8F%E3%80%81%E5%A4%B8%E5%BC%A0%E8%A1%A8%E6%83%85%E3%80%81%E8%BD%BB%E6%9D%BE%E6%90%9E%E7%AC%91%E3%80%81%E6%B8%85%E7%88%BD%E8%B5%9B%E7%92%90%E7%92%90%E4%B8%8A%E8%89%B2%EF%BC%89%0A%0A%E7%9B%B4%E6%8E%A5%E8%BE%93%E5%87%BA%E5%88%97%E8%A1%A8%E3%80%82";
// 第二个参考链接：Google 搜索"ChatGPT Images 2.0 提示词"——给社区/博客等通用结果作灵感来源
const COVER_STYLE_REFERENCE_URL_2 = "https://www.google.com/search?q=ChatGPT%20Images%202.0%20%E6%8F%90%E7%A4%BA%E8%AF%8D";

function parseCustomLines(text) {
  if (typeof text !== 'string') return [];
  return text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
}

function truncateLine(s, max = CUSTOM_LINE_PREVIEW_MAX) {
  if (typeof s !== 'string') return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// 语音模块已拆到 sidepanel/voice.js —— 仅当 ccs_voice_enabled=true 且用户点 🎤 时
// 由 SidePanelRenderer._ensureVoiceLoaded() dynamic <script> 注入，首屏不加载。

// Use JS transforms instead of CSS marquee; Windows can disable/freeze CSS animation here.
// v1.6.22 优化：rAF 循环只在 banner 可见且页面可见时跑——之前永久 rAF 在低配机
// 是常驻 CPU 税。
function setupMarquee(viewportSelector, textSelector, options = {}) {
  const viewport = document.querySelector(viewportSelector);
  const text = document.querySelector(textSelector);
  if (!viewport || !text) return;

  const speed = options.speed || 42;
  let viewportWidth = 0;
  let textWidth = 0;
  let distance = 1;
  let offset = 0;
  let lastTime = 0;
  let rafId = 0;
  let inView = false;
  let pageVisible = (typeof document.visibilityState === 'string')
    ? document.visibilityState !== 'hidden'
    : true;

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
    rafId = requestAnimationFrame(tick);
  };

  const start = () => {
    if (rafId) return;
    if (!inView || !pageVisible) return;
    lastTime = performance.now();
    rafId = requestAnimationFrame(tick);
  };

  const stop = () => {
    if (!rafId) return;
    cancelAnimationFrame(rafId);
    rafId = 0;
  };

  // 可见性闸门 1：IntersectionObserver 监听 banner 是否在视口
  if (typeof IntersectionObserver !== 'undefined') {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        inView = entry.isIntersecting;
      }
      if (inView) start(); else stop();
    }, { threshold: 0.01 });
    io.observe(viewport);
  } else {
    inView = true;  // 老浏览器不支持 IO → 默认按可见处理
  }

  // 可见性闸门 2：tab/sidepanel 切到后台时 visibilitychange 停 rAF
  document.addEventListener('visibilitychange', () => {
    pageVisible = document.visibilityState !== 'hidden';
    if (pageVisible) start(); else stop();
  });

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    viewport._ccsMarqueeState = { observer };
  } else {
    window.addEventListener('resize', measure);
  }

  // 首次 measure + 启动推迟到 idle，不抢首屏 CPU
  const kick = () => {
    measure();
    // IO 还没回调时手动检查一次
    if (typeof IntersectionObserver === 'undefined') {
      inView = true;
    } else {
      const rect = viewport.getBoundingClientRect();
      inView = rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
    }
    start();
  };
  const ric = globalThis.requestIdleCallback;
  if (typeof ric === 'function') ric(kick, { timeout: 1500 });
  else setTimeout(kick, 500);
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
    const ratioEl = document.getElementById('spPinRatio');
    if (ratioEl) {
      ratioEl.textContent = this.ratio || DEFAULT_RATIO;
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

    // 内置风格成员库入口（Stanley / HerName / 未来更多 group）：在新 tab 打开 members.html?group=<id>
    // 独立通道，不动 cover 主流程；新增 group 时只需在 HTML 里加一个 data-group=... 的链接
    document.querySelectorAll('.sp-stanley-entry[data-group]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const group = el.dataset.group || 'stanleyFriends';
        const url = chrome.runtime.getURL(`members/members.html?group=${encodeURIComponent(group)}`);
        chrome.tabs.create({ url });
      });
    });
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
    // 失焦关闭：用户点到其它 Chrome 页 / 其它窗口 / 其它应用，自动收起，避免一直挂在那里
    window.addEventListener('blur', () => {
      if (isOpen()) close();
    });
    // 侧栏被隐藏（折叠 / 切到不同标签的 sidepanel）也关闭
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && isOpen()) close();
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
      const result = await this.renderer.sendRuntimeAction({
        action: 'executeMenuAction',
        menuItemId,
        menuType: 'cover',
        keyword,
        urlPattern: engine.urlPattern,
        engineId: engine.id,
        purpose,
        categoryId: cat.id
      }, { timeoutMs: 5000, retries: 1 });
      if (!result.ok) {
        this.renderer.showToast(this.renderer.runtimeErrorMessage(result.error));
        return;
      }
      const response = result.data;
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
    // 「💡 不知道填什么？(1)」帮助链接：跳 ChatGPT 让它列 30 个封面风格供用户挑
    const helpBtn = document.getElementById('spPinCustomHelp');
    if (helpBtn) {
      helpBtn.onclick = () => {
        try { chrome.tabs.create({ url: COVER_STYLE_REFERENCE_URL }); } catch (_) { /* ignore */ }
      };
    }
    // 「💡 不知道填什么？(2)」帮助链接：跳 Google 搜"ChatGPT Images 2.0 提示词"，看社区/博客灵感
    const helpBtn2 = document.getElementById('spPinCustomHelp2');
    if (helpBtn2) {
      helpBtn2.onclick = () => {
        try { chrome.tabs.create({ url: COVER_STYLE_REFERENCE_URL_2 }); } catch (_) { /* ignore */ }
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

  async sendRuntimeAction(message, options = {}) {
    const client = globalThis.CCSRuntimeClient;
    if (client?.sendRuntimeMessage) {
      return client.sendRuntimeMessage(message, {
        timeoutMs: options.timeoutMs || 4000,
        retries: options.retries ?? 1
      });
    }
    const startedAt = Date.now();
    try {
      const data = await chrome.runtime.sendMessage(message);
      return { ok: true, data, elapsedMs: Date.now() - startedAt };
    } catch (error) {
      return {
        ok: false,
        error: { code: 'SEND_FAILED', message: error?.message || String(error) },
        elapsedMs: Date.now() - startedAt
      };
    }
  }

  runtimeErrorMessage(error) {
    const code = error?.code || '';
    if (code === 'TIMEOUT') return '后台启动较慢，请重试';
    if (code === 'SW_UNAVAILABLE') return '后台服务暂不可用，请重试';
    if (code === 'CONTENT_UNAVAILABLE') return '当前页面暂不支持直接操作，可刷新页面或使用剪贴板关键字';
    if (code === 'PERMISSION_DENIED') return '当前页面权限受限，无法执行该操作';
    return '操作失败，请重试';
  }

  async init() {
    performance.mark('ccs-sidepanel-start');
    const initRequestId = globalThis.CCSLogger?.createRequestId?.('sidepanel-init') || `sidepanel-init-${Date.now()}`;
    globalThis.CCSLogger?.info?.('sidepanel', 'init-start', initRequestId, 'sidepanel init started');
    void globalThis.CCSStorageDefaults?.ensureDefaults?.({ source: 'sidepanel', requestId: initRequestId });
    // v1.6.19：setupAlivePort 推迟到 idle —— chrome.runtime.connect 会唤醒 SW
    // 跟 sidepanel 首屏抢 CPU。首屏完成后再建立长连接（其用途是保持 SW alive，
    // 不影响首屏体验）。
    const idleSchedule = (fn) => {
      const ric = globalThis.requestIdleCallback;
      if (typeof ric === 'function') ric(fn, { timeout: 1500 });
      else setTimeout(fn, 600);
    };
    idleSchedule(() => this.setupAlivePort());
    this.voiceEnabled = false;
    this.voicePanel = null;
    this.renderKeyword();
    this.bindClipboardButton();
    this.bindCopyKeywordButton();
    this.bindStaticMenuItems();
    this.initVoiceModule();                      // 按 ccs_voice_enabled 开关决定是否激活语音模块
    this.bindTabRefreshListeners();
    this.bindRuntimeMessages();

    // 置顶区独立于主菜单加载，失败不影响整体。
    // v1.6.22：推迟到 idle —— PinnedAction.init 串了 4 个 storage.get + 1 个 fetch（coverPrompts.json）
    // + render + attachListeners。spPin 默认 hidden=true，init 完才 hidden=false，不阻塞首屏
    // 菜单和关键字显示，但同步排进首屏 microtask 会跟它们抢 CPU。
    idleSchedule(() => {
      this.pinned.init().catch((err) => {
        console.warn('[触触搜] Pinned action init failed:', err);
      });
    });

    // v1.6.19 Step 10：菜单是静态 HTML（编译期注入），首屏完全可用。
    // dev mode（plasmo dev / 源目录直跑）静态骨架已有常用菜单作 fallback。
    // 不再发 sendMessage / 不再 fetch menu config / 不再 renderMenu。

    // v1.6.19：首屏不发 sendMessage('getKeyword') —— 与 popup 同款解耦。
    // 流程：先读 storage cache（不需要 SW 醒）→ 显示；同时挂 onChanged 监听
    // 等 SW 写新值。SW 在 selectionChanged/页面切换时会写 ccs_kw_<tabId>。
    // tab 切换/url 变化时 bindTabRefreshListeners 会触发 scheduleRefresh 走
    // 兜底的 sendMessage 路径（用户已感知 sidepanel 已开，1500ms 等待 OK）。
    try {
      const tabInfo = await this.getActiveTab();
      this.currentTabUrl = tabInfo.url || '';
      this._activeTabId = tabInfo?.id ?? null;
      // 1. 先读 storage cache
      if (tabInfo?.id != null) {
        const cached = await CCSKeywordClient.readInstantCache(tabInfo.id, tabInfo.url);
        if (cached?.text) {
          this.keyword = cached;
          this.renderKeyword();
        }
        // 2. 监听 SW 后续写 ccs_kw_<tabId>
        const storageKey = `ccs_kw_${tabInfo.id}`;
        if (!this._kwStorageListener) {
          this._kwStorageListener = (changes, areaName) => {
            if (areaName !== 'local') return;
            const change = changes[storageKey];
            if (!change?.newValue) return;
            if (change.newValue.url && this.currentTabUrl && change.newValue.url !== this.currentTabUrl) return;
            this.keyword = {
              text: change.newValue.text || '',
              raw: change.newValue.raw || change.newValue.text || ''
            };
            this.renderKeyword();
            if (typeof this.renderMenu === 'function' && this.config) this.renderMenu();
          };
          try { chrome.storage.onChanged.addListener(this._kwStorageListener); } catch (_) { /* ignore */ }
        }
      }
      // 3. cache 空 + URL 非空 → idle 后再走 sendMessage 路径。先把侧栏
      // 首屏交还给浏览器，低配 Windows 上不要和页面 load / SW 冷启动抢 CPU。
      if (!this.keyword.text && (tabInfo.url || '').length > 0) {
        this.scheduleRefresh({ delayMs: 700 });
      }
      performance.mark('ccs-sidepanel-rendered');
      try {
        performance.measure('ccs-sidepanel-ttfb', 'ccs-sidepanel-start', 'ccs-sidepanel-rendered');
        const m = performance.getEntriesByName('ccs-sidepanel-ttfb')[0];
        if (m) console.log(`[触触搜][PERF] sidepanel TTFB: ${m.duration.toFixed(1)}ms`);
      } catch (_) { /* perf 失败无所谓 */ }
      globalThis.CCSLogger?.info?.('sidepanel', 'first-paint', initRequestId, 'sidepanel first paint complete');
    } catch (error) {
      globalThis.CCSLogger?.error?.('sidepanel', 'init-error', initRequestId, error?.message || String(error), { stack: error?.stack });
      console.error('[触触搜] Side panel keyword init failed:', error);
    }
  }

  bindTabRefreshListeners() {
    if (this._tabRefreshListenersBound) return;
    this._tabRefreshListenersBound = true;
    // Listen for tab changes to update pinned actions
    // 多事件触发 + debounce + 空结果重试三层防护：解决 chrome:// 等内置页时序竞态
    // （url 事件早期触发时 tab.title 还是空，导致 sidepanel 一次性 refresh 拿空）。
    // 多监听 title 事件确保 title 一旦填进来就触发一次新的 refresh。
    chrome.tabs.onActivated.addListener(() => this.scheduleRefresh());
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.url || changeInfo.title || changeInfo.status === 'complete') {
        this.scheduleRefresh();
      }
    });
  }

  bindRuntimeMessages() {
    if (this._runtimeMessagesBound) return;
    this._runtimeMessagesBound = true;
    // Listen for real-time keyword updates from background
    // 完整签名 (message, sender, sendResponse) —— 之前缺 sender/sendResponse，
    // 拿不到 sender.tab 做 origin 校验且没法对未知 action 返回错误回包
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // 兜底守卫：handler 抛错不应让其它扩展 listener 受牵连
      try {
        if (!message || typeof message !== 'object') {
          return false;
        }
        if (message.action === 'keywordUpdated' && message.keyword) {
          this.keyword = {
            text: message.keyword.text || '',
            raw: message.keyword.raw || message.keyword.text || ''
          };
          this.renderKeyword();
          return false;
        }
        if (message.action === 'ccsVoicePermissionGranted' && this.voicePanel) {
          this.voicePanel.showPermissionReady();
          return false;
        }
        if (message.action === 'ccsVoiceVisibleRecognized' && this.voicePanel) {
          this.voicePanel.finishRecognition(Array.isArray(message.candidates) ? message.candidates : []);
          return false;
        }
        if (message.action === 'ccsVoiceVisibleError' && this.voicePanel) {
          this.voicePanel.showVisibleRecognitionError(message.error || '');
          return false;
        }
        // 未知 action：sendpanel 不响应它，让其它 listener 继续处理
        return false;
      } catch (err) {
        console.warn('[触触搜][SP] onMessage handler 抛错:', err);
        return false;
      }
    });
  }

  itemFromElement(el) {
    if (!el) return null;
    return {
      id: el.dataset.menuId || '',
      type: el.dataset.menuType || '',
      urlPattern: el.dataset.urlPattern || '',
      action: el.dataset.action || '',
      engineId: el.dataset.engineId || '',
      purpose: el.dataset.purpose || ''
    };
  }

  bindStaticMenuItems() {
    const container = document.getElementById('spMenu');
    if (!container || this._staticMenuItemsBound) return;
    this._staticMenuItemsBound = true;
    container.addEventListener('click', (event) => {
      const itemEl = event.target?.closest?.('.sp-menu-item[data-menu-id]');
      if (!itemEl || !container.contains(itemEl)) return;
      const item = this.itemFromElement(itemEl);
      if (!item?.id) return;
      this.handleClick(item);
    });
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

  // scheduleRefresh：debounce 合并连续事件
  // （chrome:// 上 url / title / status 事件常常在几十 ms 内连发，避免一次跳转跑 3 次 refresh）
  scheduleRefresh(options = {}) {
    if (this._refreshDebounceTimer) clearTimeout(this._refreshDebounceTimer);
    const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 150;
    this._refreshDebounceTimer = setTimeout(() => {
      this._refreshDebounceTimer = null;
      this.refresh();
    }, delayMs);
  }

  async refresh() {
    // 取消任何挂起的重试，避免 race（用户主动操作 / 新事件触发新 refresh 时旧重试还在等）
    if (this._refreshRetryTimer) {
      clearTimeout(this._refreshRetryTimer);
      this._refreshRetryTimer = null;
    }
    return this._doRefresh(1);
  }

  // 实际 refresh，attempt 表示当前尝试次数。
  // 空结果时按 attempt 退避重试（处理 chrome:// 上 tab.title 还没填好就被 url 事件叫醒的竞态）。
  async _doRefresh(attempt) {
    try {
      const tabInfo = await this.getActiveTab();
      const newUrl = tabInfo.url || '';
      const urlChanged = newUrl !== this.currentTabUrl;
      this.currentTabUrl = newUrl;

      const newKeyword = await this.getCurrentKeyword(tabInfo, true /* isRefresh */);

      // URL 变化 → 跟随新页面，清掉手动标记
      if (urlChanged) {
        this.keyword = newKeyword;
        this.keywordSetManually = false;
        this.renderKeyword();
      } else if (this.keywordSetManually) {
        // URL 没变 + 用户手动设过 keyword → 一律保留，不论自动提取是否有内容
        // 用户点 📋 是强烈意图信号：在这个页面用剪贴板内容做关键字
        // 退出条件：URL 变化（上面 urlChanged 分支已处理，此时 manual 标志被清掉）或用户再点 📋 写新值
        return;
      } else {
        // 其它情况照常覆盖
        this.keyword = newKeyword;
        this.renderKeyword();
      }

      // 第一次拿空 + 还有重试机会 → 退避重试
      // 真实场景：chrome://settings/help 等内置页 onUpdated.url 事件早期被叫醒，
      // 此时 tab.title 还是空，extract 失败。等几百 ms 后 title 填进来 / bg prefetch
      // 写完 fallbackKeywordByTab，重试就能命中。最多 3 次（400ms / 800ms 间隔，1.2s 内收敛）。
      // 注意：如果用户在重试间隙手动改了 keyword（设了 keywordSetManually），上面的 if 分支
      // 会直接 return，重试不会覆盖。
      if (!newKeyword.text && attempt < 3) {
        this._refreshRetryTimer = setTimeout(() => {
          this._refreshRetryTimer = null;
          this._doRefresh(attempt + 1);
        }, attempt * 400);
      }
    } catch (e) {
      // Ignore refresh errors
    }
  }

  // 三段兜底拿 active tab——直接复用 CCSKeywordClient.getActiveTab（包含 currentWindow / windowId / lastFocusedWindow 三层兜底）。
  // 之前 sidepanel 用单层 currentWindow:true 失败时回退到 {id:null,url:'',title:''} 占位对象，导致
  // 后台收到空 tabId / 空 URL，所有 candidate 路径都跳过，徽章拿不到任何内容（包括 title 兜底）。
  async getActiveTab() {
    const tab = await CCSKeywordClient.getActiveTab();
    return tab || { url: '', title: '', id: null };
  }

  // v1.6.19 Step 10: loadMenuConfig / _fetchJSON 已删 —— 菜单走静态 HTML SSoT。

  // C 档重构：统一过 CCSKeywordClient（shared/keywordClient.js），与 popup 共用同一客户端。
  // 第二参数 isRefresh 区分 init / refresh 两种意图（policy 表见 background/KeywordService.js）。
  async getCurrentKeyword(tabInfo, isRefresh = false) {
    const intent = isRefresh
      ? CCSKeywordClient.INTENTS.SIDEPANEL_REFRESH
      : CCSKeywordClient.INTENTS.SIDEPANEL_INIT;
    return CCSKeywordClient.requestKeyword(intent, {
      tab: tabInfo,
      timeoutMs: 1200,
      retries: 0
    });
  }

  renderKeyword() {
    const el = document.getElementById('spKeyword');
    const clipBtn = document.getElementById('spClipboardBtn');
    const copyBtn = document.getElementById('spKeywordCopy');
    const voiceBtn = document.getElementById('spKeywordVoice');
    const keywordWrapEl = el?.closest('.sp-keyword-wrap');
    // 语音按钮显示需 3 个条件同时满足：浏览器支持 + 用户在设置里开启 + keyword 非空
    const voiceSupported = voiceBtn && voiceBtn.dataset.disabled !== 'true';
    const voiceEnabled = this.voiceEnabled === true;
    if (this.keyword.text) {
      const display = this.keyword.text.replace(/\s+/g, ' ').trim();
      el.textContent = `"${display.length > 20 ? display.substring(0, 20) + '...' : display}"`;
      // 用自定义 CSS tooltip 替代原生 title：原生 title 有浏览器级延迟，hover 体感慢。
      if (keywordWrapEl) {
        keywordWrapEl.dataset.fullKeyword = this.keyword.raw || this.keyword.text || '';
        keywordWrapEl.classList.add('has-keyword');  // 触发 wrap max-width 平滑展开
      }
      el.removeAttribute('title');
      if (clipBtn) {
        clipBtn.hidden = false;
        clipBtn.textContent = '📋 从剪贴板更新关键字';
      }
      if (copyBtn) copyBtn.hidden = false;       // 有 keyword → 露出复制按钮
      if (voiceBtn) voiceBtn.hidden = !(voiceSupported && voiceEnabled);
    } else {
      el.textContent = '';
      if (keywordWrapEl) {
        keywordWrapEl.dataset.fullKeyword = '';
        keywordWrapEl.classList.remove('has-keyword'); // 触发 wrap max-width 平滑折叠
      }
      el.removeAttribute('title');
      if (clipBtn) {
        clipBtn.hidden = false;
        clipBtn.textContent = '📋 从剪贴板读取关键字';
      }
      if (copyBtn) copyBtn.hidden = true;         // 无 keyword → 隐藏复制按钮
      if (voiceBtn) voiceBtn.hidden = true;
    }
  }

  // 语音模块门禁——读取 ccs_voice_enabled 开关，按需 lazy-load sidepanel/voice.js。
  // 首屏永远不 import voice 代码（即使用户开了开关），等用户真的点 🎤 才注入脚本 + 构造 VoicePanel。
  // 这样关掉语音的用户首屏 0 voice 代码，开了语音但当前进 sidepanel 还没点 🎤 的用户首屏也 0 voice 代码。
  initVoiceModule() {
    const VOICE_ENABLED_KEY = 'ccs_voice_enabled';

    // 廉价：浏览器是否支持 Web Speech API（不需要 voice.js 代码就能判断）
    const hasWebSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    const hasRuntimeBridge = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage;
    this._voiceSupported = !!(hasWebSpeech && hasRuntimeBridge);
    if (!this._voiceSupported) {
      const btn = document.getElementById('spKeywordVoice');
      if (btn) {
        btn.dataset.disabled = 'true';
        btn.hidden = true;
      }
    }

    chrome.storage.local.get([VOICE_ENABLED_KEY], (result) => {
      this.voiceEnabled = !!result?.[VOICE_ENABLED_KEY];
      this.renderKeyword();
    });

    // 🎤 点击：lazy 加载 voice.js → 构造 VoicePanel → 调 start()。
    // VoicePanel.bind() 不再绑这个按钮（避免双绑导致一次点击触发两次 start）。
    const voiceBtn = document.getElementById('spKeywordVoice');
    if (voiceBtn && !voiceBtn._ccsLazyClickBound) {
      voiceBtn._ccsLazyClickBound = true;
      voiceBtn.addEventListener('click', () => {
        if (!this.voiceEnabled || !this._voiceSupported) return;
        this._ensureVoiceLoaded()
          .then(() => this.voicePanel?.start())
          .catch((err) => {
            console.warn('[触触搜] 语音模块加载失败:', err);
            this.showToast('语音模块加载失败');
          });
      });
    }

    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (!changes[VOICE_ENABLED_KEY]) return;
        const next = !!changes[VOICE_ENABLED_KEY].newValue;
        this.voiceEnabled = next;
        // 关闭时如果已 lazy 加载过，调 deactivate 收掉 UI 与录音；不卸载脚本（再开仍可复用）
        if (!next && this.voicePanel) {
          this.voicePanel.deactivate();
        }
        this.renderKeyword();
      });
    } catch (_) { /* ignore */ }
  }

  // 按需注入 sidepanel/voice.js，首次返回 Promise 缓存供并发点击复用。
  _ensureVoiceLoaded() {
    if (this.voicePanel) return Promise.resolve();
    if (!this._voiceLoadPromise) {
      this._voiceLoadPromise = this._loadScript('voice.js').then(() => {
        const ns = globalThis.CCSSidepanelVoice;
        if (!ns?.VoicePanel) {
          this._voiceLoadPromise = null;
          throw new Error('voice module did not register CCSSidepanelVoice.VoicePanel');
        }
        if (!this.voicePanel) {
          this.voicePanel = new ns.VoicePanel(this);
        }
      }).catch((err) => {
        this._voiceLoadPromise = null;  // 允许下次重试
        throw err;
      });
    }
    return this._voiceLoadPromise;
  }

  _loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-ccs-lazy="${src}"]`);
      if (existing) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.dataset.ccsLazy = src;
      s.onload = () => resolve();
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    });
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
        this.renderKeyword();   // keyword 非空 → 按钮保留，允许继续从剪贴板更新
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
    // v1.6.19 Step 9：静态菜单已注入，跳过 JS 重建（关键字变化不影响 menu DOM）
    if (container?.dataset?.staticBuilt === 'true') return;
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

    el.addEventListener('click', (event) => {
      event.stopPropagation();
      this.handleClick(item);
    });
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
      const result = await this.sendRuntimeAction({
        action: 'executeMenuAction',
        menuItemId: item.id,
        menuType: item.type,
        keyword: keyword,
        urlPattern: item.urlPattern,
        actionType: item.action,
        engineId: item.engineId,
        purpose: item.purpose
      }, { timeoutMs: 5000, retries: 1 });
      if (!result.ok) {
        this.showToast(this.runtimeErrorMessage(result.error));
        return;
      }
      const response = result.data;

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

// bundle 以 async 加载时可能晚于 DOMContentLoaded，需要 readyState 兜底。
function bootSidePanel() {
  // GUARD：与 popup 同理。offscreen prewarm 把 sidepanel.bundle.js 也注入了预热文档，
  // 那个文档没有 spMenu / spKeyword 等 DOM 元素，init() 会撞 null setProperty。
  // 检测到 spMenu 不在就跳过 init，prewarm 仍能预热 V8 cache。
  if (!document.getElementById('spMenu')) return;
  const boot = globalThis.__CCS_SIDEPANEL_BOOT__;
  try { boot?.teardown?.(); } catch (_) { /* ignore */ }
  syncStickyTopPadding();
  setupMarquee('.sp-pin-tip-marquee', '.sp-pin-tip-text', { speed: 42 });
  const renderer = new SidePanelRenderer();
  Promise.resolve(renderer.init()).then(() => {
    const bootKeyword = boot?.getKeyword?.();
    if (bootKeyword?.text || bootKeyword?.raw) {
      renderer.keyword = bootKeyword;
      renderer.renderKeyword();
    }
  }).catch((error) => {
    console.error('[触触搜] Sidepanel 初始化失败:', error);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootSidePanel, { once: true });
} else {
  bootSidePanel();
}
