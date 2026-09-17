/**
 * Sidepanel PinnedAction (TypeScript port)
 *
 * 与 sidepanel/sidepanel.js 的 PinnedAction class 1:1 行为对等。
 * 负责 cover 风格 + ratio 比例的 pin / picker / 执行整套流程。
 *
 * chrome.* 依赖通过 globalThis 防御性访问。
 */

// 共享常量 + 辅助函数（同 PopupController 共用，src/shared/coverPinConstants.ts 为 SSoT）
import {
  PIN_STORAGE_KEY, CUSTOM_PURPOSE_KEY, CUSTOM_LINE_KEY, CUSTOM_PURPOSE_MAX,
  DEFAULT_PIN, RATIO_KEY, RATIO_CUSTOM_LIST_KEY, RATIO_CUSTOM_MAX,
  DEFAULT_RATIO, RATIO_RE, RATIO_PRESETS, RATIO_CUSTOM_TRIGGER,
  parseCustomLines, truncateLine,
  type PinSnapshot
} from "../shared/coverPinConstants"

export type { PinSnapshot } from "../shared/coverPinConstants"

const COVER_STYLE_REFERENCE_URL = "https://chatgpt.com/?prompt=" + encodeURIComponent(
  '为"封面图设计风格参考"生成 30 个风格，每行一个。'
)
const COVER_STYLE_REFERENCE_URL_2 = "https://www.google.com/search?q=ChatGPT%20Images%202.0%20%E6%8F%90%E7%A4%BA%E8%AF%8D"

interface ChromeLike {
  storage?: {
    local: {
      get: (keys: string[], cb: (r: Record<string, unknown>) => void) => void
      set: (data: Record<string, unknown>, cb?: () => void) => void
    }
  }
  runtime?: {
    getURL: (p: string) => string
    sendMessage: (m: unknown) => Promise<unknown>
  }
  tabs?: { create: (opts: { url: string; active?: boolean }) => void }
}

function getChrome(): ChromeLike {
  return (globalThis as unknown as { chrome?: ChromeLike }).chrome || ({} as ChromeLike)
}

export interface CoverCategory {
  id: string
  label?: string
  purpose?: string
  credit?: { name?: string; url?: string }
  engines?: Array<{ id: string; label?: string; urlPattern?: string }>
}

export interface CoverConfig {
  categories?: CoverCategory[]
}

export interface SidepanelRendererLike {
  keyword: { text?: string; raw?: string }
  refresh: () => Promise<void>
  showToast: (m: string) => void
}

export class PinnedAction {
  renderer: SidepanelRendererLike
  coverConfig: CoverConfig | null = null
  current: PinSnapshot = { ...DEFAULT_PIN }
  customPurpose = ""
  customSelectedLine = ""
  ratio: string = DEFAULT_RATIO
  customRatios: string[] = []

  draft: PinSnapshot | null = null
  draftCustomPurpose = ""
  draftCustomSelectedLine = ""
  draftRatio: string = DEFAULT_RATIO
  draftCustomRatios: string[] = []
  lastDropdownLines: string[] = []

  constructor(renderer: SidepanelRendererLike) {
    this.renderer = renderer
  }

  async init(): Promise<void> {
    const [stored, customPurpose, customLine, ratioInfo, coverCfg] = await Promise.all([
      this.loadStored(),
      this.loadCustomPurpose(),
      this.loadCustomLine(),
      this.loadRatioInfo(),
      this.loadCoverConfig()
    ])
    this.coverConfig = coverCfg
    this.customPurpose = customPurpose || ""
    this.ratio = ratioInfo.ratio
    this.customRatios = ratioInfo.customRatios
    this.customSelectedLine = customLine || (parseCustomLines(this.customPurpose)[0] || "")

    if (stored && this.findCategory(stored.categoryId, coverCfg)) {
      if (stored.categoryId === "custom" && !this.customSelectedLine) {
        this.current = { ...DEFAULT_PIN }
      } else {
        this.current = stored
      }
    } else {
      this.current = { ...DEFAULT_PIN }
    }

    if (!coverCfg?.categories || coverCfg.categories.length === 0) return

    const pin = document.getElementById("spPin")
    if (pin) (pin as HTMLElement & { hidden: boolean }).hidden = false
    this.render()
    this.attachListeners()
  }

  loadStored(): Promise<PinSnapshot | null> {
    return new Promise((resolve) => {
      try {
        getChrome().storage?.local.get([PIN_STORAGE_KEY], (result) => {
          resolve((result?.[PIN_STORAGE_KEY] as PinSnapshot) || null)
        })
      } catch (_) { resolve(null) }
    })
  }

  loadCustomPurpose(): Promise<string> {
    return new Promise((resolve) => {
      try {
        getChrome().storage?.local.get([CUSTOM_PURPOSE_KEY], (result) => {
          const v = result?.[CUSTOM_PURPOSE_KEY]
          resolve(typeof v === "string" ? v : "")
        })
      } catch (_) { resolve("") }
    })
  }

  loadCustomLine(): Promise<string> {
    return new Promise((resolve) => {
      try {
        getChrome().storage?.local.get([CUSTOM_LINE_KEY], (result) => {
          const v = result?.[CUSTOM_LINE_KEY]
          resolve(typeof v === "string" ? v : "")
        })
      } catch (_) { resolve("") }
    })
  }

  loadRatioInfo(): Promise<{ ratio: string; customRatios: string[] }> {
    return new Promise((resolve) => {
      try {
        getChrome().storage?.local.get([RATIO_KEY, RATIO_CUSTOM_LIST_KEY], (result) => {
          const r = result?.[RATIO_KEY]
          const list = result?.[RATIO_CUSTOM_LIST_KEY]
          resolve({
            ratio: typeof r === "string" && RATIO_RE.test(r.trim()) ? r.trim() : DEFAULT_RATIO,
            customRatios: Array.isArray(list) ? list.filter((x) => typeof x === "string" && RATIO_RE.test(x)) : []
          })
        })
      } catch (_) { resolve({ ratio: DEFAULT_RATIO, customRatios: [] }) }
    })
  }

  async loadCoverConfig(): Promise<CoverConfig | null> {
    try {
      const ch = getChrome()
      const url = ch.runtime?.getURL("prompts/coverPrompts.json")
      if (!url) return null
      const response = await fetch(url)
      if (!response.ok) return null
      return (await response.json()) as CoverConfig
    } catch (_) { return null }
  }

  findCategory(id: string, cfg: CoverConfig | null = this.coverConfig): CoverCategory | null {
    if (!cfg?.categories) return null
    return cfg.categories.find((c) => c.id === id) || null
  }

  render(): void {
    const cat = this.findCategory(this.current.categoryId)
    if (!cat) return
    const styleEl = document.getElementById("spPinStyle")
    const ratioEl = document.getElementById("spPinRatio")
    if (ratioEl) ratioEl.textContent = this.ratio || DEFAULT_RATIO
    if (!styleEl) return
    if (cat.id === "custom") {
      const line = (this.customSelectedLine || "").trim()
      const preview = truncateLine(line)
      styleEl.textContent = preview ? `🖌️ ${preview}` : "🖌️ 自定义风格"
      styleEl.title = line || ""
    } else {
      styleEl.textContent = cat.label || cat.id
      styleEl.title = ""
    }
  }

  attachListeners(): void {
    document.getElementById("spPinAction")?.addEventListener("click", () => this.execute())
    document.getElementById("spPinEdit")?.addEventListener("click", () => this.openPicker())
    document.getElementById("spPinCancel")?.addEventListener("click", () => this.closePicker())
    document.getElementById("spPinSave")?.addEventListener("click", () => this.savePicker())
    this.bindTaskInfoPopover()

    document.querySelectorAll<HTMLElement>(".sp-stanley-entry[data-group]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault()
        const group = el.dataset.group || "stanleyFriends"
        const url = getChrome().runtime?.getURL(`members/members.html?group=${encodeURIComponent(group)}`)
        if (url) getChrome().tabs?.create({ url })
      })
    })
  }

  bindTaskInfoPopover(): void {
    const infoEl = document.getElementById("spPinTaskInfo")
    const popover = document.getElementById("spPinTaskPopover")
    if (!infoEl || !popover) return

    const setOpen = (open: boolean) => {
      ;(popover as HTMLElement & { hidden: boolean }).hidden = !open
      infoEl.setAttribute("aria-expanded", open ? "true" : "false")
    }
    const isOpen = () => !(popover as HTMLElement & { hidden: boolean }).hidden
    const toggle = () => setOpen(!isOpen())
    const close = () => setOpen(false)

    infoEl.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggle() })
    infoEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggle() }
    })

    popover.querySelector<HTMLElement>(".sp-pin-task-popover-close")?.addEventListener("click", close)
    document.addEventListener("click", (e) => {
      if (!isOpen()) return
      const target = e.target as Node
      if (popover.contains(target) || infoEl.contains(target)) return
      close()
    })
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) close() })
    window.addEventListener("blur", () => { if (isOpen()) close() })
    document.addEventListener("visibilitychange", () => { if (document.hidden && isOpen()) close() })
  }

  async execute(): Promise<void> {
    const cat = this.findCategory(this.current.categoryId)
    if (!cat) return
    const engine = (cat.engines || [])[0]
    if (!engine) { this.renderer.showToast("该风格暂无可用引擎"); return }

    let purpose = cat.purpose || cat.label || ""
    if (cat.id === "custom") {
      const userText = (this.customSelectedLine || "").trim()
      if (!userText) { this.renderer.showToast("请先点 ✏️ 填写自定义风格"); return }
      purpose = userText
    }

    await this.renderer.refresh()
    const keyword = this.renderer.keyword.raw || this.renderer.keyword.text || ""
    const menuItemId = `ccs-cover-${cat.id}-${engine.id}`
    try {
      const response = await getChrome().runtime?.sendMessage({
        action: "executeMenuAction", menuItemId, menuType: "cover", keyword,
        urlPattern: engine.urlPattern, engineId: engine.id, purpose, categoryId: cat.id
      }) as { success?: boolean; error?: string } | undefined
      if (response?.error === "no-keyword") {
        this.renderer.showToast("没有选中文本或无法提取关键词")
      }
    } catch (_) {
      this.renderer.showToast("操作失败")
    }
  }

  openPicker(): void {
    this.draft = { ...this.current }
    this.draftCustomPurpose = this.customPurpose || ""
    this.draftCustomSelectedLine = this.customSelectedLine || ""
    this.lastDropdownLines = parseCustomLines(this.draftCustomPurpose)
    this.draftRatio = this.ratio || DEFAULT_RATIO
    this.draftCustomRatios = [...this.customRatios]

    const list = document.getElementById("spPinOptions")
    if (!list) return
    list.innerHTML = ""
    ;(this.coverConfig?.categories || []).forEach((cat) => {
      const optId = `pin-opt-${cat.id}`
      const checked = cat.id === this.draft!.categoryId ? "checked" : ""
      const label = document.createElement("label")
      label.className = "sp-pin-option"
      label.htmlFor = optId
      label.innerHTML = `
        <input type="radio" name="pinStyle" id="${optId}" value="${cat.id}" ${checked}>
        <span class="sp-pin-option-label">${cat.id === "custom" ? "🖌️ " + (cat.label || cat.id) : (cat.label || cat.id)}</span>
      `
      // 风格作者署名：coverPrompts.json 的 credit 字段 → 行尾 ⓘ，hover 看链接，点击新标签打开
      const credit = cat.credit && typeof cat.credit.url === "string" && /^https:\/\//.test(cat.credit.url) ? cat.credit : null
      if (credit) {
        const link = document.createElement("a")
        link.className = "sp-pin-option-credit"
        link.href = credit.url as string
        link.target = "_blank"
        link.rel = "noopener"
        const who = credit.name ? `由 ${credit.name} 设计` : "风格作者"
        link.title = `${who} · ${credit.url}（点击打开）`
        link.setAttribute("aria-label", `${who}，打开 ${credit.url}`)
        link.textContent = "ⓘ"
        // <a href> 是交互元素，点它不会触发 label 的单选切换；再拦一下冒泡防外层监听误判
        link.addEventListener("click", (e) => e.stopPropagation())
        label.appendChild(link)
      }
      list.appendChild(label)
    })
    list.onchange = (e: Event) => {
      const target = e.target as HTMLInputElement
      if (target?.name === "pinStyle" && this.draft) {
        this.draft.categoryId = target.value
        this.refreshPickerCustomVisibility()
        this.refreshSaveBtn()
      }
    }

    const ta = document.getElementById("spPinCustomInput") as HTMLTextAreaElement | null
    if (ta) {
      ta.value = this.draftCustomPurpose
      ta.oninput = () => {
        this.draftCustomPurpose = ta.value || ""
        this.activateCustomCategory()
        this.refreshPickerCounter()
        this.rebuildCustomDropdown()
        this.refreshSaveBtn()
      }
    }

    const sel = document.getElementById("spPinCustomSelect") as HTMLSelectElement | null
    if (sel) {
      sel.onchange = () => {
        this.draftCustomSelectedLine = sel.value || ""
        this.activateCustomCategory()
        this.refreshSaveBtn()
      }
    }

    const helpBtn = document.getElementById("spPinCustomHelp") as HTMLButtonElement | null
    if (helpBtn) helpBtn.onclick = () => { try { getChrome().tabs?.create({ url: COVER_STYLE_REFERENCE_URL }) } catch (_) { /* noop */ } }
    const helpBtn2 = document.getElementById("spPinCustomHelp2") as HTMLButtonElement | null
    if (helpBtn2) helpBtn2.onclick = () => { try { getChrome().tabs?.create({ url: COVER_STYLE_REFERENCE_URL_2 }) } catch (_) { /* noop */ } }

    this.refreshPickerCustomVisibility()
    this.refreshPickerCounter()
    this.rebuildCustomDropdown()
    this.bindRatioControls()
    this.rebuildRatioDropdown()
    this.refreshSaveBtn()

    const picker = document.getElementById("spPinPicker")
    if (picker) (picker as HTMLElement & { hidden: boolean }).hidden = false
    try { window.scrollTo({ top: 0, behavior: "smooth" }) } catch (_) { window.scrollTo(0, 0) }
  }

  bindRatioControls(): void {
    const sel = document.getElementById("spPinRatioSelect") as HTMLSelectElement | null
    const customBox = document.getElementById("spPinRatioCustom") as HTMLElement & { hidden: boolean } | null
    const input = document.getElementById("spPinRatioInput") as HTMLInputElement | null
    const addBtn = document.getElementById("spPinRatioAdd") as HTMLButtonElement | null
    const hint = document.getElementById("spPinRatioHint")
    if (!sel || !customBox || !input || !addBtn || !hint) return

    sel.onchange = () => {
      const v = sel.value
      if (v === RATIO_CUSTOM_TRIGGER) {
        customBox.hidden = false
        ;(hint as HTMLElement & { hidden: boolean }).hidden = false
        hint.textContent = "格式：宽:高（数字，可带小数）"
        hint.classList.remove("error")
        input.focus()
      } else {
        customBox.hidden = true
        ;(hint as HTMLElement & { hidden: boolean }).hidden = true
        this.draftRatio = v
      }
    }
    input.oninput = () => {
      input.classList.remove("invalid")
      hint.classList.remove("error")
      hint.textContent = "格式：宽:高（数字，可带小数）"
    }
    input.onkeydown = (e: KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); addBtn.click() } }
    addBtn.onclick = () => {
      const raw = (input.value || "").trim()
      if (!RATIO_RE.test(raw)) {
        input.classList.add("invalid")
        hint.classList.add("error")
        hint.textContent = "格式不对，应为 宽:高（如 2.35:1）"
        return
      }
      if (RATIO_PRESETS.some((p) => p.value === raw) || this.draftCustomRatios.includes(raw)) {
        this.draftRatio = raw
      } else {
        this.draftCustomRatios.unshift(raw)
        if (this.draftCustomRatios.length > RATIO_CUSTOM_MAX) {
          this.draftCustomRatios = this.draftCustomRatios.slice(0, RATIO_CUSTOM_MAX)
        }
        this.draftRatio = raw
      }
      input.value = ""
      customBox.hidden = true
      ;(hint as HTMLElement & { hidden: boolean }).hidden = true
      this.rebuildRatioDropdown()
    }
  }

  rebuildRatioDropdown(): void {
    const sel = document.getElementById("spPinRatioSelect") as HTMLSelectElement | null
    if (!sel) return
    sel.innerHTML = ""
    interface Group { label: string; items: Array<{ value: string; label: string }> }
    const groups: Group[] = []
    if (this.draftCustomRatios.length > 0) {
      groups.push({
        label: "自定义",
        items: this.draftCustomRatios.map((v) => ({ value: v, label: `${v} · 自定义` }))
      })
    }
    groups.push({ label: "预设", items: RATIO_PRESETS as ReadonlyArray<{ value: string; label: string }> as Array<{ value: string; label: string }> })

    for (const g of groups) {
      const og = document.createElement("optgroup")
      og.label = g.label
      for (const it of g.items) {
        const opt = document.createElement("option")
        opt.value = it.value
        opt.textContent = it.label
        if (it.value === this.draftRatio) opt.selected = true
        og.appendChild(opt)
      }
      sel.appendChild(og)
    }

    const trigger = document.createElement("option")
    trigger.value = RATIO_CUSTOM_TRIGGER
    trigger.textContent = "➕ 自定义比例…"
    sel.appendChild(trigger)

    if (![...sel.options].some((o) => o.value === this.draftRatio && o.value !== RATIO_CUSTOM_TRIGGER)) {
      this.draftRatio = DEFAULT_RATIO
      ;[...sel.options].forEach((o) => { o.selected = o.value === DEFAULT_RATIO })
    }
  }

  refreshPickerCustomVisibility(): void {
    const box = document.getElementById("spPinCustom") as HTMLElement & { hidden: boolean } | null
    if (!box) return
    box.hidden = this.draft?.categoryId !== "custom"
  }

  activateCustomCategory(): void {
    if (!this.draft || this.draft.categoryId === "custom") return
    this.draft.categoryId = "custom"
    const radio = document.querySelector<HTMLInputElement>('input[name="pinStyle"][value="custom"]')
    if (radio) radio.checked = true
    this.refreshPickerCustomVisibility()
  }

  refreshPickerCounter(): void {
    const counter = document.getElementById("spPinCustomCounter")
    if (counter) counter.textContent = String((this.draftCustomPurpose || "").length)
  }

  rebuildCustomDropdown(): void {
    const sel = document.getElementById("spPinCustomSelect") as HTMLSelectElement | null
    if (!sel) return
    const lines = parseCustomLines(this.draftCustomPurpose)
    sel.innerHTML = ""
    if (lines.length === 0) {
      const opt = document.createElement("option")
      opt.value = ""
      opt.textContent = "（请先在上方填写至少 1 行预设）"
      opt.disabled = true
      sel.appendChild(opt)
      sel.disabled = true
      this.draftCustomSelectedLine = ""
      this.lastDropdownLines = []
      return
    }
    sel.disabled = false
    const added = [...lines].reverse().find((l) => !this.lastDropdownLines.includes(l))
    let chosen: string
    if (added) chosen = added
    else if (lines.includes(this.draftCustomSelectedLine)) chosen = this.draftCustomSelectedLine
    else chosen = lines[0]

    lines.forEach((line) => {
      const opt = document.createElement("option")
      opt.value = line
      opt.textContent = truncateLine(line)
      opt.title = line
      if (line === chosen) opt.selected = true
      sel.appendChild(opt)
    })
    sel.value = chosen
    this.draftCustomSelectedLine = chosen
    this.lastDropdownLines = [...lines]
  }

  refreshSaveBtn(): void {
    const btn = document.getElementById("spPinSave") as HTMLButtonElement | null
    if (!btn) return
    const blocked = this.draft?.categoryId === "custom" && !(this.draftCustomSelectedLine || "").trim()
    btn.disabled = !!blocked
  }

  closePicker(): void {
    const picker = document.getElementById("spPinPicker")
    if (picker) (picker as HTMLElement & { hidden: boolean }).hidden = true
    this.draft = null
    this.draftCustomPurpose = ""
    this.draftCustomSelectedLine = ""
    this.lastDropdownLines = []
    this.draftRatio = DEFAULT_RATIO
    this.draftCustomRatios = []
  }

  async savePicker(): Promise<void> {
    if (!this.draft) { this.closePicker(); return }
    if (this.draft.categoryId === "custom" && !(this.draftCustomSelectedLine || "").trim()) {
      this.renderer.showToast("请先填写至少 1 行自定义风格")
      return
    }
    this.current = { ...this.draft }
    const writes: Record<string, unknown> = { [PIN_STORAGE_KEY]: this.current }

    if (this.draft.categoryId === "custom") {
      const cleanLines = parseCustomLines(this.draftCustomPurpose)
      const fullText = cleanLines.join("\n").slice(0, CUSTOM_PURPOSE_MAX)
      const selectedLine = (this.draftCustomSelectedLine || "").trim()
      this.customPurpose = fullText
      this.customSelectedLine = selectedLine
      writes[CUSTOM_PURPOSE_KEY] = fullText
      writes[CUSTOM_LINE_KEY] = selectedLine
    }

    const ratio = typeof this.draftRatio === "string" && RATIO_RE.test(this.draftRatio)
      ? this.draftRatio : DEFAULT_RATIO
    this.ratio = ratio
    this.customRatios = [...this.draftCustomRatios]
    writes[RATIO_KEY] = ratio
    writes[RATIO_CUSTOM_LIST_KEY] = this.customRatios

    await new Promise<void>((resolve) => {
      try {
        getChrome().storage?.local.set(writes, () => resolve())
      } catch (_) { resolve() }
    })

    this.render()
    this.closePicker()
    this.renderer.showToast("已保存置顶风格")
  }
}

export default PinnedAction
