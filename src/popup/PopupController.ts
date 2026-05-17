/**
 * Popup 主控制器 (TypeScript port)
 *
 * 与 popup/popup.js 的 PopupMenuRenderer class 1:1 行为对等。
 * 复用已 port 的 src/shared/* + src/popup/modules/* TS 模块。
 *
 * 用法：在 popup.tsx 的 useEffect 里 `new PopupController().init()`。
 */

import { CCSMenuStructureBuilder, type MenuStructure, type MenuStructureItem } from "../shared/menuStructureBuilder"
import { requestKeyword, KEYWORD_INTENTS, type KeywordResult } from "../shared/keywordClient"
import {
  PIN_STORAGE_KEY, CUSTOM_LINE_KEY, CUSTOM_PURPOSE_KEY, RATIO_KEY,
  DEFAULT_PIN, DEFAULT_RATIO
} from "../shared/coverPinConstants"
// PromptLibraryManager 改为 dynamic import —— 用户点设置→提示词库时才加载，
// 不进入首屏 popup bundle，节省 ~485 行 TS 的 parse 时间
import type { PromptLibraryManager as PromptLibraryManagerType } from "./modules/PromptLibraryManager"

interface ChromeLike {
  runtime?: {
    getManifest?: () => { version?: string }
    getURL: (p: string) => string
    sendMessage: (m: unknown, cb?: (r: unknown) => void) => Promise<unknown> | void
    lastError?: { message?: string } | null
  }
  storage?: {
    local: {
      get: (keys: string[], cb: (r: Record<string, unknown>) => void) => void
      set: (data: Record<string, unknown>, cb?: () => void) => void
    }
  }
  windows?: { getCurrent: () => Promise<{ id?: number }>; WINDOW_ID_CURRENT?: number }
  tabs?: {
    query: (q: { active?: boolean; currentWindow?: boolean } | Record<string, never>, cb: (tabs: Array<{ id?: number }>) => void) => Promise<Array<{ id?: number }>>
    sendMessage: (tabId: number, m: unknown) => Promise<void>
    create: (opts: { url: string }) => void
  }
  sidePanel?: {
    open?: (opts: { windowId?: number; tabId?: number }) => Promise<void>
    setOptions?: (opts: { tabId?: number; path?: string; enabled?: boolean }) => Promise<void>
  }
}

function getChrome(): ChromeLike {
  return (globalThis as unknown as { chrome?: ChromeLike }).chrome || ({} as ChromeLike)
}

interface CoverConfigShape {
  categories?: Array<{
    id: string
    label?: string
    purpose?: string
    engines?: Array<{ id: string; urlPattern?: string }>
  }>
}

interface PinSnapshot {
  pin: { taskId: string; categoryId: string }
  category: CoverConfigShape["categories"] extends Array<infer T> | undefined ? T : never
  ratio: string
  customLine: string
}

export class PopupController {
  config: MenuStructure | null = null
  keyword: KeywordResult = { text: "", raw: "" }
  currentMode: "menu" | "settings" = "menu"
  pinnedCover: PinSnapshot | null = null
  promptLibraryManager: PromptLibraryManagerType | null = null

  private _keywordLoadPromise: Promise<KeywordResult> | null = null
  private _settingsInitDone = false
  private _promptLibraryLoadPromise: Promise<void> | null = null
  private _cachedEnabled = true
  private _menuDelegationBound = false
  private _cachedCoverConfig: CoverConfigShape | null = null
  private readonly _initTimeoutMs = 2200

  // 常量已迁到 src/shared/coverPinConstants.ts，PopupController + PinnedAction 共享

  async init(): Promise<void> {
    performance.mark("ccs-popup-start")
    let renderSource = "unknown"
    try {
      this.loadVersion()
      this.bindEvents()
      this.startKeywordLoad()
      this._preloadEnableState()

      let menuStructure = await this._withTimeout(this._tryReadPrebuilt(), this._initTimeoutMs, null)
      if (menuStructure) {
        renderSource = "prebuilt-json"
      } else {
        menuStructure = await this._withTimeout(this._buildMenuFromFetch(), this._initTimeoutMs, null)
        renderSource = "local-fetch"
      }
      // pinned cover 在 prebuilt 之后起，复用 _cachedCoverConfig 避免重复 fetch
      this.initPinnedCover()
      if (!menuStructure) {
        // 降级：保留 popup.tsx 里的静态骨架菜单，避免首开白屏
        console.warn("[触触搜][popup] menu structure unavailable, keep static skeleton")
        return
      }

      this.config = menuStructure
      this.render()
      performance.mark("ccs-popup-rendered")
      try {
        performance.measure("ccs-popup-ttfb", "ccs-popup-start", "ccs-popup-rendered")
        const m = performance.getEntriesByName("ccs-popup-ttfb")[0]
        if (m) console.log(`[触触搜][PERF] popup TTFB: ${m.duration.toFixed(1)}ms (${renderSource})`)
      } catch (_) { /* noop */ }
    } catch (error) {
      console.error("[触触搜] Popup 初始化失败:", error)
      this.showError("加载失败，请重试")
      return
    }
  }

  private async _withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
    return new Promise((resolve) => {
      let settled = false
      let timeoutId: ReturnType<typeof setTimeout> | null = null
      const done = (value: T): void => {
        if (settled) return
        settled = true
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        resolve(value)
      }
      timeoutId = setTimeout(() => {
        console.warn("[触触搜][popup] init timeout fallback")
        done(fallback)
      }, timeoutMs)
      promise.then((value) => done(value)).catch(() => done(fallback))
    })
  }

  private async _tryReadPrebuilt(): Promise<MenuStructure | null> {
    try {
      const data = await this.fetchJSON("popup/popup-menu-prebuilt.json") as
        | { version?: string; structure?: MenuStructure; coverConfig?: CoverConfigShape }
        | null
      if (!data) return null
      const ch = getChrome()
      const currentVersion = ch.runtime?.getManifest?.()?.version
      if (data.version && currentVersion && data.version !== currentVersion) return null
      const s = data.structure
      if (!s || !Array.isArray(s.groups) || s.groups.length === 0) return null
      // v1.6.19 Step 6：cover 内联，给 initPinnedCover 复用
      if (data.coverConfig) this._cachedCoverConfig = data.coverConfig
      return s
    } catch (_) { return null }
  }

  private async _buildMenuFromFetch(): Promise<MenuStructure | null> {
    const [unifiedConfig, top100, fastqa, optimize, cover, engines] = await Promise.all([
      this.fetchJSON("config/unifiedMenuConfig.json"),
      this.fetchJSON("prompts/topQuestionsPrompts.json"),
      this.fetchJSON("prompts/fastAnswersPrompts.json"),
      this.fetchJSON("prompts/optimizedPrompts.json"),
      this.fetchJSON("prompts/coverPrompts.json"),
      this.fetchJSON("config/engines.json")
    ])
    if (!unifiedConfig) return null
    if (cover) this._cachedCoverConfig = cover as CoverConfigShape  // initPinnedCover 复用
    return CCSMenuStructureBuilder.build({
      unifiedConfig: unifiedConfig as Parameters<typeof CCSMenuStructureBuilder.build>[0]["unifiedConfig"],
      enginesConfig: engines as Parameters<typeof CCSMenuStructureBuilder.build>[0]["enginesConfig"],
      top100Config: top100 as Parameters<typeof CCSMenuStructureBuilder.build>[0]["top100Config"],
      fastqaConfig: fastqa as Parameters<typeof CCSMenuStructureBuilder.build>[0]["fastqaConfig"],
      optimizeConfig: optimize as Parameters<typeof CCSMenuStructureBuilder.build>[0]["optimizeConfig"],
      coverConfig: cover as Parameters<typeof CCSMenuStructureBuilder.build>[0]["coverConfig"]
    })
  }

  loadVersion(): void {
    const ch = getChrome()
    const manifest = ch.runtime?.getManifest?.()
    const versionEl = document.getElementById("versionNumber")
    if (versionEl && manifest?.version) versionEl.textContent = `v${manifest.version}`
  }

  fetchJSON(path: string): Promise<unknown> {
    const url = getChrome().runtime?.getURL(path) || path
    return fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null)
  }

  startKeywordLoad(): Promise<KeywordResult> {
    this._keywordLoadPromise = requestKeyword(KEYWORD_INTENTS.POPUP_OPEN, {
      instantFromStorage: true,
      onInstant: (cached) => {
        if (cached?.text) this.applyKeyword(cached)
      }
    }).then((fresh) => {
      if (fresh?.text || !this.keyword?.text) {
        this.applyKeyword(fresh || { text: "", raw: "" })
      }
      return fresh
    }).catch((error) => {
      console.warn("[触触搜] 关键字加载失败:", error)
      return { text: "", raw: "" }
    })
    return this._keywordLoadPromise
  }

  applyKeyword(keyword: { text?: string; raw?: string }): void {
    this.keyword = {
      text: keyword?.text || "",
      raw: keyword?.raw || keyword?.text || ""
    }
    this._renderKeyword()
  }

  _preloadEnableState(): void {
    getChrome().storage?.local.get(["enabled"], (r) => {
      this._cachedEnabled = r.enabled !== false
    })
  }

  async refreshKeyword(): Promise<KeywordResult> {
    const fresh = await requestKeyword(KEYWORD_INTENTS.POPUP_OPEN)
    this.keyword = fresh
    this._renderKeyword()
    return fresh
  }

  isMenuEnabled(_menuId: string): boolean { return true }

  _renderKeyword(): void {
    const keywordEl = document.getElementById("currentKeyword")
    if (!keywordEl) return
    const keywordCopyEl = document.getElementById("currentKeywordCopy") as HTMLElement & { hidden: boolean } | null
    const keywordWrapEl = keywordEl.closest<HTMLElement>(".menu-keyword-wrap")

    if (this.keyword?.text) {
      const displayText = this.formatKeyword(this.keyword.text)
      const fullKeyword = this.keyword.raw || this.keyword.text
      keywordEl.textContent = `"${displayText}"`
      if (keywordWrapEl) {
        keywordWrapEl.dataset.fullKeyword = fullKeyword
        keywordWrapEl.classList.add("has-keyword")
      }
      keywordEl.removeAttribute("title")
      if (keywordCopyEl) {
        keywordCopyEl.hidden = false
        keywordCopyEl.dataset.keyword = fullKeyword
      }
    } else {
      keywordEl.textContent = ""
      if (keywordWrapEl) {
        keywordWrapEl.dataset.fullKeyword = ""
        keywordWrapEl.classList.remove("has-keyword")
      }
      keywordEl.removeAttribute("title")
      if (keywordCopyEl) {
        keywordCopyEl.hidden = true
        keywordCopyEl.dataset.keyword = ""
      }
    }
  }

  render(): void {
    const container = document.getElementById("menuContainer")
    if (!container) return
    this._renderKeyword()

    if (!this.config?.groups) {
      const empty = document.createElement("div")
      empty.className = "menu-empty"
      empty.textContent = "无菜单配置"
      container.replaceChildren(empty)
      return
    }

    // v1.6.19: fragment 完整构建后 replaceChildren 原子 swap，避免静态骨架闪空白
    const fragment = document.createDocumentFragment()
    this.config.groups.forEach((group, index) => {
      if (group.id === "panel") return
      if (group.separator === "before" && index > 0) fragment.appendChild(this.createSeparator())
      this.renderGroup(fragment, group)
      if (group.separator === "after") fragment.appendChild(this.createSeparator())
    })
    container.replaceChildren(fragment)
  }

  formatKeyword(text: string): string {
    if (!text) return ""
    const compact = text.replace(/\s+/g, " ").trim()
    return compact.length > 15 ? compact.substring(0, 15) + "..." : compact
  }

  createSeparator(): HTMLElement {
    const sep = document.createElement("div")
    sep.className = "menu-separator"
    return sep
  }

  renderGroup(container: HTMLElement | DocumentFragment, group: MenuStructure["groups"][number]): void {
    if (!group.items) return
    group.items.forEach((item) => {
      if (!this.isMenuEnabled(item.id)) return
      const itemEl = this.createMenuItem(item)
      container.appendChild(itemEl)
      if (item.children && item.children.length > 0) {
        container.appendChild(this.createSubmenu(item.children, item.id))
      }
    })
  }

  createMenuItem(item: MenuStructureItem): HTMLElement {
    const el = document.createElement("div")
    el.className = "menu-item"
    el.dataset.menuId = item.id
    el.dataset.menuType = item.type || ""
    const hasChildren = !!(item.children && item.children.length > 0)
    if (hasChildren) el.classList.add("has-children")

    let displayTitle = item.title || ""
    if (item.type === "fastqa-quick") {
      const match = displayTitle.match(/- (.+)$/)
      if (match) displayTitle = `速答 · ${match[1]}`
    }

    el.innerHTML = `
      <span class="item-icon">${item.icon || ""}</span>
      <span class="item-title">${displayTitle}</span>
      ${hasChildren ? '<span class="item-arrow">▶</span>' : ""}
    `

    el.addEventListener("click", (e) => {
      e.stopPropagation()
      if (hasChildren) this.toggleSubmenu(el, item.id)
      else this.handleClick(item)
    })
    return el
  }

  createSubmenu(children: MenuStructureItem[], parentId: string, level: number = 1): HTMLElement {
    const submenu = document.createElement("div")
    submenu.className = "submenu collapsed"
    submenu.dataset.parentId = parentId
    submenu.dataset.level = String(level)

    children.forEach((child) => {
      if (!this.isMenuEnabled(child.id)) return
      const hasChildren = !!(child.children && child.children.length > 0)
      const childEl = document.createElement("div")
      childEl.className = `menu-item submenu-item level-${level}`
      childEl.dataset.menuId = child.id
      childEl.dataset.menuType = child.type || ""
      if (hasChildren) childEl.classList.add("has-children")

      childEl.innerHTML = `
        <span class="item-icon">${child.icon || ""}</span>
        <span class="item-title">${child.title}</span>
        ${hasChildren ? '<span class="item-arrow">▶</span>' : ""}
      `
      childEl.addEventListener("click", (e) => {
        e.stopPropagation()
        if (hasChildren) this.toggleSubmenu(childEl, child.id)
        else this.handleClick(child)
      })

      submenu.appendChild(childEl)
      if (hasChildren && child.children) {
        submenu.appendChild(this.createSubmenu(child.children, child.id, level + 1))
      }
    })

    return submenu
  }

  toggleSubmenu(parentEl: HTMLElement, parentId: string): void {
    const submenu = document.querySelector<HTMLElement>(`.submenu[data-parent-id="${parentId}"]`)
    if (!submenu) return
    const willExpand = submenu.classList.contains("collapsed")
    submenu.classList.toggle("collapsed")
    parentEl.classList.toggle("expanded")
    if (willExpand) {
      submenu.addEventListener("transitionend", () => {
        const FOOTER_H = 56
        const BREATH = 12
        const SAFE_BOTTOM = FOOTER_H + BREATH
        const rect = submenu.getBoundingClientRect()
        const viewportH = window.innerHeight || document.documentElement.clientHeight
        const targetMaxBottom = viewportH - SAFE_BOTTOM
        if (rect.bottom <= targetMaxBottom) return
        const delta = Math.ceil(rect.bottom - targetMaxBottom)
        const scroller = document.scrollingElement || document.body
        try { scroller.scrollBy({ top: delta, behavior: "smooth" }) }
        catch (_) { scroller.scrollTop += delta }
      }, { once: true })
    }
  }

  // === Pinned cover ===

  async initPinnedCover(): Promise<void> {
    try {
      const [storage, coverConfig] = await Promise.all([
        this.loadPinStorage(),
        this.loadCoverConfig()
      ])
      if (!coverConfig?.categories || coverConfig.categories.length === 0) return

      let pin = storage.pin && storage.pin.taskId === "cover" ? storage.pin : { ...DEFAULT_PIN }
      const cat = coverConfig.categories.find((c) => c.id === pin.categoryId)
      if (!cat) pin = { ...DEFAULT_PIN }
      const customLine = (storage.customLine || "").trim()
      if (pin.categoryId === "custom" && !customLine) pin = { ...DEFAULT_PIN }

      this.pinnedCover = {
        pin,
        category: coverConfig.categories.find((c) => c.id === pin.categoryId) as PinSnapshot["category"],
        ratio: storage.ratio || DEFAULT_RATIO,
        customLine
      }
      this.renderPinnedCover()
      this.bindPinnedCover()
    } catch (error) {
      console.warn("[触触搜] 置顶封面生成器加载失败:", error)
    }
  }

  loadPinStorage(): Promise<{ pin: { taskId: string; categoryId: string } | null; customLine: string; ratio: string }> {
    return new Promise((resolve) => {
      try {
        getChrome().storage?.local.get(
          [
            PIN_STORAGE_KEY,
            CUSTOM_LINE_KEY,
            CUSTOM_PURPOSE_KEY,
            RATIO_KEY
          ],
          (result) => {
            const pin = (result?.[PIN_STORAGE_KEY] as { taskId: string; categoryId: string } | undefined) || null
            const customLineRaw = (result?.[CUSTOM_LINE_KEY] as string | undefined) || ""
            const customPurposeFirstLine = (result?.[CUSTOM_PURPOSE_KEY] as string | undefined)?.split(/\r?\n/)[0]?.trim() || ""
            const customLine = customLineRaw || customPurposeFirstLine
            const ratioRaw = result?.[RATIO_KEY]
            resolve({
              pin,
              customLine,
              ratio: typeof ratioRaw === "string" ? ratioRaw.trim() : ""
            })
          }
        )
      } catch (_) {
        resolve({ pin: null, customLine: "", ratio: "" })
      }
    })
  }

  async loadCoverConfig(): Promise<CoverConfigShape | null> {
    // v1.6.19 Step 6：优先用主菜单 fetch 已缓存的 coverConfig
    if (this._cachedCoverConfig) return this._cachedCoverConfig
    try {
      const url = getChrome().runtime?.getURL("prompts/coverPrompts.json")
      if (!url) return null
      const response = await fetch(url)
      if (!response.ok) return null
      return (await response.json()) as CoverConfigShape
    } catch (_) { return null }
  }

  renderPinnedCover(): void {
    const section = document.getElementById("popupPin")
    const styleEl = document.getElementById("popupPinStyle")
    const ratioEl = document.getElementById("popupPinRatio")
    if (!section || !styleEl || !this.pinnedCover) return
    const { category, ratio, customLine } = this.pinnedCover
    if (!category) return
    if (category.id === "custom") {
      const preview = customLine.length > 15 ? customLine.slice(0, 15) + "…" : customLine
      styleEl.textContent = preview ? `🖌️ ${preview}` : "🖌️ 自定义风格"
      styleEl.title = customLine || ""
    } else {
      styleEl.textContent = category.label || category.id
      styleEl.title = ""
    }
    if (ratioEl) ratioEl.textContent = ratio || DEFAULT_RATIO
    ;(section as HTMLElement & { hidden: boolean }).hidden = false
  }

  bindPinnedCover(): void {
    document.getElementById("popupPinAction")?.addEventListener("click", () => this.executePinnedCover())
    document.getElementById("popupPinOpenSidepanel")?.addEventListener("click", () => this.openSidePanel())
  }

  async executePinnedCover(): Promise<void> {
    if (!this.pinnedCover) return
    const { category, customLine } = this.pinnedCover
    if (!category) return
    const engine = (category.engines || [])[0]
    if (!engine) { this.showToast("该风格暂无可用引擎"); return }
    let purpose = category.purpose || category.label
    if (category.id === "custom") {
      if (!customLine) { this.showToast("请到侧边栏 ✏️ 填写自定义风格"); return }
      purpose = customLine
    }
    const keyword = this.keyword.raw || this.keyword.text
    const menuItemId = `ccs-cover-${category.id}-${engine.id}`
    try {
      const ch = getChrome()
      const response = await ch.runtime?.sendMessage({
        action: "executeMenuAction",
        menuItemId, menuType: "cover", keyword,
        urlPattern: engine.urlPattern, engineId: engine.id, purpose, categoryId: category.id
      }) as { success?: boolean; error?: string } | undefined
      if (response?.success) window.close()
      else if (response?.error === "no-keyword") this.showToast("没有选中文本或无法提取关键词")
    } catch (error) {
      console.error("[触触搜] 置顶封面启动失败:", error)
      this.showToast("启动失败")
    }
  }

  async handleClick(item: MenuStructureItem): Promise<void> {
    if (!(this.keyword.raw || this.keyword.text) && this._keywordLoadPromise) {
      await Promise.race([
        this._keywordLoadPromise,
        new Promise<unknown>((resolve) => setTimeout(resolve, 600))
      ])
    }
    const keyword = this.keyword.raw || this.keyword.text

    try {
      const response = await getChrome().runtime?.sendMessage({
        action: "executeMenuAction",
        menuItemId: item.id,
        menuType: item.type,
        keyword,
        urlPattern: item.urlPattern,
        actionType: item.action,
        engineId: item.engineId,
        purpose: item.purpose
      }) as { success?: boolean; error?: string } | undefined

      if (response?.success) window.close()
      else if (response?.error === "no-keyword") this.showToast("没有选中文本或无法提取关键词")
    } catch (error) {
      console.error("[触触搜] 菜单操作失败:", error)
      this.showToast("操作失败")
    }
  }

  itemFromElement(el: HTMLElement | null): MenuStructureItem | null {
    if (!el) return null
    return {
      id: el.dataset.menuId || "",
      type: el.dataset.menuType || "",
      title: "",
      icon: "",
      urlPattern: el.dataset.urlPattern || "",
      action: el.dataset.action || "",
      engineId: el.dataset.engineId || "",
      purpose: el.dataset.purpose || ""
    }
  }

  bindEvents(): void {
    document.getElementById("settingsToggle")?.addEventListener("click", () => this.showSettings())
    document.getElementById("backToMenu")?.addEventListener("click", () => this.showMenu())
    this.setupSidePanelButton()

    document.getElementById("currentKeywordCopy")?.addEventListener("click", (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.copyCurrentKeyword()
    })

    const menuContainer = document.getElementById("menuContainer")
    if (menuContainer && !this._menuDelegationBound) {
      this._menuDelegationBound = true
      menuContainer.addEventListener("click", (e) => {
        const itemEl = (e.target as HTMLElement)?.closest?.<HTMLElement>(".menu-item[data-menu-id]")
        if (!itemEl || !menuContainer.contains(itemEl)) return
        const item = this.itemFromElement(itemEl)
        if (!item?.id) return
        this.handleClick(item)
      })
    }
  }

  async copyCurrentKeyword(): Promise<void> {
    const keyword = this.keyword.raw || this.keyword.text
    if (!keyword) { this.showToast("没有可复制的关键字"); return }
    const btn = document.getElementById("currentKeywordCopy") as (HTMLButtonElement | null)
    try {
      await navigator.clipboard.writeText(keyword)
      if (btn) {
        const original = btn.textContent
        btn.textContent = "✓"
        btn.classList.add("copied")
        btn.disabled = true
        setTimeout(() => {
          btn.textContent = original
          btn.classList.remove("copied")
          btn.disabled = false
        }, 1200)
      }
    } catch (error) {
      console.error("[触触搜] 复制关键字失败:", error)
      this.showToast("复制失败")
    }
  }

  async setupSidePanelButton(): Promise<void> {
    const btn = document.getElementById("openSidePanel") as HTMLButtonElement | null
    if (!btn) return
    let isOpen = false
    let windowId: number | null = null
    const updateLabel = () => { btn.textContent = isOpen ? "📕 关闭侧边栏" : "📑 打开侧边栏" }

    try {
      const ch = getChrome()
      const win = await ch.windows?.getCurrent()
      windowId = win?.id ?? null
      const cached = await new Promise<Record<string, unknown>>((resolve) => {
        ch.storage?.local.get([`ccs_sp_open_${windowId}`], resolve)
      })
      isOpen = !!cached?.[`ccs_sp_open_${windowId}`]
    } catch (_) { isOpen = false }
    updateLabel()

    // v1.6.19: SW 校正消息推迟到 idle，先让 popup 完成首屏渲染再唤醒 SW
    if (typeof windowId === "number") {
      const wid = windowId
      const idleSchedule = (fn: () => void) => {
        const ric = (globalThis as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
        if (typeof ric === "function") ric(fn, { timeout: 1200 })
        else setTimeout(fn, 800)
      }
      idleSchedule(() => {
        try {
          getChrome().runtime?.sendMessage({ action: "getSidePanelState", windowId: wid }, (resp) => {
            const ch = getChrome()
            if (ch.runtime?.lastError) return
            const r = resp as { isOpen?: boolean } | undefined
            if (r && !!r.isOpen !== isOpen) { isOpen = !!r.isOpen; updateLabel() }
          })
        } catch (_) { /* ignore */ }
      })
    }

    btn.addEventListener("click", async () => {
      if (isOpen) await this.closeSidePanel(windowId)
      else await this.openSidePanel()
    })
  }

  async closeSidePanel(windowId: number | null): Promise<void> {
    try {
      await new Promise<unknown>((resolve) => {
        getChrome().runtime?.sendMessage({ action: "closeSidePanel", windowId }, (resp) => {
          if (getChrome().runtime?.lastError) resolve(null)
          else resolve(resp)
        })
      })
      window.close()
    } catch (error) {
      console.error("[触触搜] Close side panel failed:", error)
      this.showToast("关闭侧边栏失败")
    }
  }

  async openSidePanel(): Promise<void> {
    const ch = getChrome()
    if (!ch.sidePanel?.open) { this.showToast("当前浏览器不支持侧边栏"); return }
    try {
      await ch.sidePanel.open({ windowId: ch.windows?.WINDOW_ID_CURRENT })
      window.close()
      return
    } catch (windowError) {
      console.warn("[触触搜] Open side panel by window failed:", windowError)
    }
    try {
      const tabs = await new Promise<Array<{ id?: number }>>((resolve) => {
        ch.tabs?.query({ active: true, currentWindow: true }, resolve)
      })
      const tab = tabs[0]
      if (!tab?.id) throw new Error("No active tab for side panel fallback")
      if (ch.sidePanel.setOptions) {
        await ch.sidePanel.setOptions({ tabId: tab.id, path: "sidepanel/sidepanel.html", enabled: true })
      }
      await ch.sidePanel.open({ tabId: tab.id })
      window.close()
    } catch (error) {
      console.error("[触触搜] Open side panel failed:", error)
      this.showToast("打开侧边栏失败，请重试")
    }
  }

  async showSettings(): Promise<void> {
    this.currentMode = "settings"
    const mc = document.getElementById("menuContainer")
    const sp = document.getElementById("settingsPanel")
    const st = document.getElementById("settingsToggle")
    if (mc) mc.style.display = "none"
    if (sp) sp.style.display = "block"
    if (st) st.style.display = "none"
    await this.ensureSettingsInit()
  }

  async ensureSettingsInit(): Promise<void> {
    if (this._settingsInitDone) return
    this._settingsInitDone = true
    this.initSettings()
  }

  async ensurePromptLibrary(): Promise<void> {
    if (!this._promptLibraryLoadPromise) {
      this._promptLibraryLoadPromise = (async () => {
        try {
          // Dynamic import: 真正延迟到用户点击设置→提示词库时才下载 + parse
          // 节省首屏 popup 解析时间（~485 行 TS 不进首帧 bundle）
          const mod = await import("./modules/PromptLibraryManager")
          this.promptLibraryManager = new mod.PromptLibraryManager({
            onToast: (msg: string) => this.showToast(msg)
          })
          await this.promptLibraryManager.init()
        } catch (e) {
          console.error("[触触搜] 加载提示词库模块失败:", e)
          this._promptLibraryLoadPromise = null
          this.showToast("提示词库加载失败")
        }
      })()
    }
    return this._promptLibraryLoadPromise
  }

  showMenu(): void {
    this.currentMode = "menu"
    const mc = document.getElementById("menuContainer")
    const sp = document.getElementById("settingsPanel")
    const st = document.getElementById("settingsToggle")
    if (mc) mc.style.display = "block"
    if (sp) sp.style.display = "none"
    if (st) st.style.display = "block"
    for (const id of ["blacklistSection", "shortcutSection", "debugSection", "promptLibrarySection"]) {
      const el = document.getElementById(id)
      if (el) el.style.display = "none"
    }
  }

  showError(message: string): void {
    const container = document.getElementById("menuContainer")
    if (container) container.innerHTML = `<div class="menu-error">${message}</div>`
  }

  showToast(message: string): void {
    const toast = document.createElement("div")
    toast.className = "popup-toast"
    toast.textContent = message
    document.body.appendChild(toast)
    setTimeout(() => {
      toast.classList.add("fade-out")
      setTimeout(() => toast.remove(), 300)
    }, 2000)
  }

  // ==================== 设置功能 ====================

  initSettings(): void {
    getChrome().storage?.local.get(["enabled", "ccs_debug", "ccs_voice_enabled"], (result) => {
      this.updateToggleButton(result.enabled !== false)
      this.setDebugButtonState(!!result.ccs_debug)
      this.setVoiceButtonState(!!result.ccs_voice_enabled)
    })
    document.querySelectorAll<HTMLElement>(".setting-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const action = (e.currentTarget as HTMLElement).dataset.action
        if (action) this.handleSettingAction(action)
      })
    })
    this.loadBlacklist()
    this.initShortcutSettings()
  }

  handleSettingAction(action: string): void {
    switch (action) {
      case "toggle": this.toggleExtension(); break
      case "blacklist": this.toggleBlacklistSection(); break
      case "debug": this.toggleDebug(); break
      case "voice": this.toggleVoice(); break
      case "export-menu-state": this.exportMenuState(); break
      case "shortcut-settings": this.toggleShortcutSettings(); break
      case "prompt-library": this.togglePromptLibrarySection(); break
      case "open-welcome":
        getChrome().tabs?.create({ url: getChrome().runtime!.getURL("welcome/welcome.html") })
        window.close()
        break
    }
  }

  toggleExtension(): void {
    const ch = getChrome()
    ch.storage?.local.get(["enabled"], (result) => {
      const newState = !(result.enabled !== false)
      ch.storage?.local.set({ enabled: newState }, () => {
        this.updateToggleButton(newState)
        this.showToast(newState ? "插件已启用" : "插件已禁用")
        ch.tabs?.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id != null) {
            ch.tabs?.sendMessage(tabs[0].id, { action: "toggleExtension", enabled: newState })?.catch(() => { /* noop */ })
          }
        })
      })
    })
  }

  updateToggleButton(enabled: boolean): void {
    const btn = document.querySelector<HTMLElement>('[data-action="toggle"]')
    if (!btn) return
    const icon = btn.querySelector<HTMLElement>(".setting-icon")
    const label = btn.querySelector<HTMLElement>(".setting-label")
    if (enabled) {
      if (icon) icon.textContent = "⚡"
      if (label) label.textContent = "点击禁用"
      btn.style.background = "#e8f5e9"
      btn.style.borderColor = "#4caf50"
    } else {
      if (icon) icon.textContent = "⭕"
      if (label) label.textContent = "点击启用"
      btn.style.background = "#ffebee"
      btn.style.borderColor = "#f44336"
    }
  }

  setDebugButtonState(enabled: boolean): void {
    const btn = document.querySelector<HTMLElement>('[data-action="debug"]')
    if (!btn) return
    const label = btn.querySelector<HTMLElement>(".setting-label")
    const icon = btn.querySelector<HTMLElement>(".setting-icon")
    if (icon) icon.textContent = "🐞"
    if (label) label.textContent = enabled ? "调试日志：开" : "调试日志：关"
    btn.style.background = enabled ? "#fff8e1" : ""
    btn.style.borderColor = enabled ? "#fbc02d" : ""
  }

  toggleDebug(): void {
    const ch = getChrome()
    ch.storage?.local.get(["ccs_debug"], (res) => {
      const next = !res.ccs_debug
      ch.storage?.local.set({ ccs_debug: next }, () => {
        this.setDebugButtonState(next)
        try { (ch.runtime?.sendMessage({ action: "updateDebug", enabled: next }) as Promise<unknown> | undefined)?.catch?.(() => { /* noop */ }) } catch (_) { /* noop */ }
        ch.tabs?.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id != null) {
            ch.tabs?.sendMessage(tabs[0].id, { action: "updateDebug", enabled: next })?.catch(() => { /* noop */ })
          }
        })
        this.showToast(next ? "调试已开启" : "调试已关闭")
      })
    })
  }

  setVoiceButtonState(enabled: boolean): void {
    const btn = document.querySelector<HTMLElement>('[data-action="voice"]')
    if (!btn) return
    const label = btn.querySelector<HTMLElement>(".setting-label")
    const icon = btn.querySelector<HTMLElement>(".setting-icon")
    if (icon) icon.textContent = "🎤"
    btn.title = "实验性功能：通过语音说出引擎名快速搜索（默认关）"
    if (label) label.textContent = enabled ? "语音功能：开" : "语音功能：关"
    btn.style.background = enabled ? "#fff8e1" : ""
    btn.style.borderColor = enabled ? "#fbc02d" : ""
  }

  toggleVoice(): void {
    const ch = getChrome()
    ch.storage?.local.get(["ccs_voice_enabled"], (res) => {
      const next = !res.ccs_voice_enabled
      ch.storage?.local.set({ ccs_voice_enabled: next }, () => {
        this.setVoiceButtonState(next)
        this.showToast(next ? "语音功能已开启" : "语音功能已关闭")
      })
    })
  }

  private _showOnly(sectionId: string): void {
    const sections = ["blacklistSection", "shortcutSection", "debugSection", "promptLibrarySection"]
    sections.forEach((id) => {
      const el = document.getElementById(id)
      if (el) el.style.display = id === sectionId ? "block" : "none"
    })
  }

  toggleBlacklistSection(): void {
    const section = document.getElementById("blacklistSection")
    if (!section) return
    if (section.style.display === "none") {
      this._showOnly("blacklistSection")
      this.loadBlacklist()
    } else {
      section.style.display = "none"
    }
  }

  loadBlacklist(): void {
    const ch = getChrome()
    ch.storage?.local.get(["ccs_settings"], (result) => {
      const settings = (result.ccs_settings as { blacklist?: string[] }) || { blacklist: [] }
      const blacklist = settings.blacklist || []
      const countEl = document.querySelector<HTMLElement>(".blacklist-count")
      if (countEl) countEl.textContent = String(blacklist.length)

      const listEl = document.querySelector<HTMLElement>(".blacklist-list")
      if (listEl) {
        if (blacklist.length === 0) listEl.innerHTML = '<div class="blacklist-empty">黑名单为空</div>'
        else {
          listEl.innerHTML = blacklist
            .map((host) => `
              <div class="blacklist-item" data-host="${host}">
                <span class="blacklist-host">${host}</span>
                <button class="blacklist-remove" data-host="${host}">移除</button>
              </div>
            `).join("")
          listEl.querySelectorAll<HTMLElement>(".blacklist-remove").forEach((btn) => {
            btn.addEventListener("click", (e) => {
              const host = (e.target as HTMLElement).dataset.host
              if (host) this.removeFromBlacklist(host)
            })
          })
        }
      }
      const clearBtn = document.querySelector<HTMLElement>(".clear-blacklist")
      if (clearBtn) (clearBtn as HTMLButtonElement).onclick = () => this.clearAllBlacklist()
    })
  }

  removeFromBlacklist(host: string): void {
    const ch = getChrome()
    ch.storage?.local.get(["ccs_settings"], (result) => {
      const settings = (result.ccs_settings as { blacklist: string[] }) || { blacklist: [] }
      const index = settings.blacklist.indexOf(host)
      if (index > -1) {
        settings.blacklist.splice(index, 1)
        ch.storage?.local.set({ ccs_settings: settings }, () => {
          this.showToast(`已移除: ${host}`)
          this.loadBlacklist()
          ch.tabs?.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id != null) {
              ch.tabs?.sendMessage(tabs[0].id, { action: "updateBlacklist", blacklist: settings.blacklist })?.catch(() => { /* noop */ })
            }
          })
        })
      }
    })
  }

  clearAllBlacklist(): void {
    if (!confirm("确定要清空所有黑名单吗？")) return
    const ch = getChrome()
    ch.storage?.local.get(["ccs_settings"], (result) => {
      const settings = (result.ccs_settings as { blacklist?: string[] }) || {}
      settings.blacklist = []
      ch.storage?.local.set({ ccs_settings: settings }, () => {
        this.showToast("黑名单已清空")
        this.loadBlacklist()
        ch.tabs?.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id != null) {
            ch.tabs?.sendMessage(tabs[0].id, { action: "updateBlacklist", blacklist: [] })?.catch(() => { /* noop */ })
          }
        })
      })
    })
  }

  initShortcutSettings(): void {
    const ch = getChrome()
    ch.storage?.local.get(["ccs_settings"], (result) => {
      const settings = (result.ccs_settings as { shortcutKey?: string }) || {}
      const shortcutKey = settings.shortcutKey || "Alt+S"
      const select = document.querySelector<HTMLSelectElement>(".shortcut-key-select")
      if (select) select.value = shortcutKey
    })
    document.querySelector<HTMLElement>(".save-shortcut")?.addEventListener("click", () => this.saveShortcutSettings())
  }

  toggleShortcutSettings(): void {
    const section = document.getElementById("shortcutSection")
    if (!section) return
    if (section.style.display === "none") this._showOnly("shortcutSection")
    else section.style.display = "none"
  }

  async togglePromptLibrarySection(): Promise<void> {
    const section = document.getElementById("promptLibrarySection")
    if (!section) return
    if (section.style.display === "none") {
      this._showOnly("promptLibrarySection")
      await this.ensurePromptLibrary()
      this.promptLibraryManager?.renderList()
    } else {
      section.style.display = "none"
    }
  }

  saveShortcutSettings(): void {
    const select = document.querySelector<HTMLSelectElement>(".shortcut-key-select")
    if (!select) return
    const newShortcut = select.value
    const ch = getChrome()
    ch.storage?.local.get(["ccs_settings"], (result) => {
      const settings = (result.ccs_settings as { shortcutKey?: string }) || {}
      settings.shortcutKey = newShortcut
      ch.storage?.local.set({ ccs_settings: settings }, () => {
        this.showToast("快捷键已更新为: " + newShortcut)
        ch.tabs?.query({}, (tabs) => {
          tabs.forEach((tab) => {
            if (tab.id != null) {
              ch.tabs?.sendMessage(tab.id, { action: "updateShortcut", shortcutKey: newShortcut })?.catch(() => { /* noop */ })
            }
          })
        })
      })
    })
  }

  async exportMenuState(): Promise<void> {
    const btn = document.querySelector<HTMLButtonElement>('[data-action="export-menu-state"]')
    if (btn) {
      btn.disabled = true
      const label = btn.querySelector<HTMLElement>(".setting-label")
      if (label) label.textContent = "获取中..."
    }
    try {
      const ch = getChrome()
      const tabs = await new Promise<Array<{ id?: number }>>((resolve) => {
        ch.tabs?.query({ active: true, currentWindow: true }, resolve)
      })
      const tab = tabs[0]
      ch.runtime?.sendMessage({ action: "getMenuDebugInfo", tabId: tab?.id }, (response) => {
        const r = response as { success?: boolean; data?: unknown } | undefined
        if (r?.success) this.showMenuDebugInfo(r.data)
        else this.showToast("获取菜单状态失败")
        if (btn) {
          btn.disabled = false
          const label = btn.querySelector<HTMLElement>(".setting-label")
          if (label) label.textContent = "导出菜单状态"
        }
      })
    } catch (_) {
      this.showToast("获取菜单状态失败")
      if (btn) {
        btn.disabled = false
        const label = btn.querySelector<HTMLElement>(".setting-label")
        if (label) label.textContent = "导出菜单状态"
      }
    }
  }

  showMenuDebugInfo(data: unknown): void {
    const debugSection = document.getElementById("debugSection")
    const textEl = document.querySelector<HTMLElement>(".menu-debug-text")
    if (!debugSection || !textEl) return
    const formatted = JSON.stringify(data, null, 2)
    textEl.textContent = formatted
    this._showOnly("debugSection")
    navigator.clipboard.writeText(formatted).then(() => {
      this.showToast("菜单状态已复制到剪贴板")
    }).catch(() => { /* noop */ })

    const copyBtn = document.querySelector<HTMLButtonElement>(".copy-debug-info")
    const closeBtn = document.querySelector<HTMLButtonElement>(".close-debug-info")
    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(formatted).then(() => {
          this.showToast("已复制到剪贴板")
        }).catch(() => { this.showToast("复制失败") })
      }
    }
    if (closeBtn) closeBtn.onclick = () => { debugSection.style.display = "none" }
  }
}

export default PopupController
