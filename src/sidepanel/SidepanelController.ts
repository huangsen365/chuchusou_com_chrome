/**
 * Sidepanel 主控制器 (TypeScript port)
 *
 * Port 自 sidepanel/sidepanel.js 的 SidePanelRenderer class。
 *
 * 包含：
 *   - init + alive port + tab refresh listeners + runtime messages
 *   - keyword 加载 / 刷新（含 chrome:// 等内置页的退避重试）
 *   - 静态菜单 binding + handleClick
 *   - 复制关键字 / 剪贴板读取兜底
 *   - PinnedAction (cover 风格 + ratio 选择) —— 见 PinnedAction.ts
 *
 * 故意不迁的：VoicePanel / VoiceRecognizer / OffscreenSpeechRecognizer
 *   实验性语音功能（默认关），等用户激活时再 dynamic import。
 */

import { requestKeyword, getActiveTab, KEYWORD_INTENTS, type KeywordResult } from "../shared/keywordClient"
import { PinnedAction } from "./PinnedAction"

interface ChromeLike {
  windows?: { getCurrent: () => Promise<{ id?: number }> }
  runtime?: {
    connect: (info: { name: string }) => chrome.runtime.Port
    sendMessage: (m: unknown, cb?: (r: unknown) => void) => Promise<unknown> | void
    onMessage?: { addListener: (l: (m: { action?: string; [k: string]: unknown }) => void) => void }
    getURL?: (p: string) => string
    lastError?: { message?: string } | null
  }
  tabs?: {
    onActivated?: { addListener: (l: () => void) => void }
    onUpdated?: { addListener: (l: (tabId: number, change: { url?: string; title?: string; status?: string }) => void) => void }
    create?: (opts: { url: string }) => void
  }
  storage?: {
    local: {
      get: (keys: string[], cb: (r: Record<string, unknown>) => void) => void
    }
    onChanged?: {
      addListener: (l: (changes: Record<string, { newValue?: unknown }>, area: string) => void) => void
    }
  }
}

function getChrome(): ChromeLike {
  return (globalThis as unknown as { chrome?: ChromeLike }).chrome || ({} as ChromeLike)
}

const VOICE_ENABLED_KEY = "ccs_voice_enabled"

export interface MenuItemPayload {
  id: string
  type: string
  urlPattern: string
  action: string
  engineId: string
  purpose: string
}

interface MenuStructureGroup {
  id: string
  separator?: string
  items?: Array<{ id: string; [k: string]: unknown }>
}

interface MenuStructure {
  groups: MenuStructureGroup[]
}

export class SidepanelController {
  config: MenuStructure | null = null
  keyword: KeywordResult = { text: "", raw: "" }
  currentTabUrl = ""
  keywordSetManually = false
  voiceEnabled = false
  pinned: PinnedAction

  private _tabRefreshListenersBound = false
  private _runtimeMessagesBound = false
  private _staticMenuItemsBound = false
  private _refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private _refreshRetryTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.pinned = new PinnedAction(this)
  }

  async init(): Promise<void> {
    this.setupAlivePort()
    this.renderKeyword()
    this.bindClipboardButton()
    this.bindCopyKeywordButton()
    this.bindStaticMenuItems()
    this.initVoiceModule()
    this.bindTabRefreshListeners()
    this.bindRuntimeMessages()

    // PinnedAction 独立初始化，失败不影响主菜单
    this.pinned.init().catch((err) => {
      console.warn("[触触搜] PinnedAction init failed:", err)
    })

    this.loadMenuConfig().then((config) => {
      this.config = config
      this.renderMenu()
    }).catch((error) => {
      console.error("[触触搜] Side panel menu config failed:", error)
    })

    try {
      const tabInfo = await this.getActiveTab()
      this.currentTabUrl = tabInfo.url || ""
      this.keyword = await this.getCurrentKeyword(tabInfo, false)
      this.renderKeyword()

      if (!this.keyword.text && (tabInfo.url || "").length > 0) {
        this.scheduleRefresh()
      }
    } catch (error) {
      console.error("[触触搜] Side panel keyword init failed:", error)
    }
  }

  bindTabRefreshListeners(): void {
    if (this._tabRefreshListenersBound) return
    this._tabRefreshListenersBound = true
    const ch = getChrome()
    ch.tabs?.onActivated?.addListener(() => this.scheduleRefresh())
    ch.tabs?.onUpdated?.addListener((_tabId, changeInfo) => {
      if (changeInfo.url || changeInfo.title || changeInfo.status === "complete") {
        this.scheduleRefresh()
      }
    })
  }

  bindRuntimeMessages(): void {
    if (this._runtimeMessagesBound) return
    this._runtimeMessagesBound = true
    const ch = getChrome()
    ch.runtime?.onMessage?.addListener((message) => {
      if (message.action === "keywordUpdated" && message.keyword) {
        const k = message.keyword as { text?: string; raw?: string }
        this.keyword = {
          text: k.text || "",
          raw: k.raw || k.text || ""
        }
        this.renderKeyword()
        return
      }
      // 语音相关消息：转发给 legacy VoicePanel（如果激活了语音模块）
      const w = window as unknown as { CCSSidepanel?: { voicePanel?: { showPermissionReady?: () => void; finishRecognition?: (c: Array<{ text: string; score: number }>) => void; showVisibleRecognitionError?: (e: string) => void } } }
      const voicePanel = w.CCSSidepanel?.voicePanel
      if (!voicePanel) return
      if (message.action === "ccsVoicePermissionGranted") voicePanel.showPermissionReady?.()
      if (message.action === "ccsVoiceVisibleRecognized") {
        voicePanel.finishRecognition?.(Array.isArray(message.candidates) ? message.candidates as Array<{ text: string; score: number }> : [])
      }
      if (message.action === "ccsVoiceVisibleError") voicePanel.showVisibleRecognitionError?.(String(message.error || ""))
    })
  }

  itemFromElement(el: HTMLElement | null): MenuItemPayload | null {
    if (!el) return null
    return {
      id: el.dataset.menuId || "",
      type: el.dataset.menuType || "",
      urlPattern: el.dataset.urlPattern || "",
      action: el.dataset.action || "",
      engineId: el.dataset.engineId || "",
      purpose: el.dataset.purpose || ""
    }
  }

  bindStaticMenuItems(): void {
    const container = document.getElementById("spMenu")
    if (!container || this._staticMenuItemsBound) return
    this._staticMenuItemsBound = true
    container.addEventListener("click", (event) => {
      const itemEl = (event.target as HTMLElement)?.closest?.<HTMLElement>(".sp-menu-item[data-menu-id]")
      if (!itemEl || !container.contains(itemEl)) return
      const item = this.itemFromElement(itemEl)
      if (!item?.id) return
      this.handleClick(item)
    })
  }

  async setupAlivePort(): Promise<void> {
    try {
      const ch = getChrome()
      const win = await ch.windows?.getCurrent()
      const port = ch.runtime?.connect({ name: "sidepanel-alive" })
      if (!port) return
      port.postMessage({ windowId: win?.id })
      port.onMessage.addListener((msg: { action?: string }) => {
        if (msg?.action === "close") {
          try { window.close() } catch (_) { /* noop */ }
        }
      })
      port.onDisconnect.addListener(() => {
        setTimeout(() => this.setupAlivePort(), 500)
      })
    } catch (e) {
      console.warn("[触触搜] sidepanel alive port setup failed:", e)
    }
  }

  scheduleRefresh(): void {
    if (this._refreshDebounceTimer) clearTimeout(this._refreshDebounceTimer)
    this._refreshDebounceTimer = setTimeout(() => {
      this._refreshDebounceTimer = null
      this.refresh()
    }, 50)
  }

  async refresh(): Promise<void> {
    if (this._refreshRetryTimer) {
      clearTimeout(this._refreshRetryTimer)
      this._refreshRetryTimer = null
    }
    return this._doRefresh(1)
  }

  private async _doRefresh(attempt: number): Promise<void> {
    try {
      const tabInfo = await this.getActiveTab()
      const newUrl = tabInfo.url || ""
      const urlChanged = newUrl !== this.currentTabUrl
      this.currentTabUrl = newUrl

      const newKeyword = await this.getCurrentKeyword(tabInfo, true)

      if (urlChanged) {
        this.keyword = newKeyword
        this.keywordSetManually = false
        this.renderKeyword()
      } else if (this.keywordSetManually) {
        return
      } else {
        this.keyword = newKeyword
        this.renderKeyword()
      }

      if (!newKeyword.text && attempt < 3) {
        this._refreshRetryTimer = setTimeout(() => {
          this._refreshRetryTimer = null
          this._doRefresh(attempt + 1)
        }, attempt * 400)
      }
    } catch (_) { /* ignore */ }
  }

  async getActiveTab(): Promise<chrome.tabs.Tab> {
    const tab = await getActiveTab()
    return tab || ({ url: "", title: "", id: undefined } as unknown as chrome.tabs.Tab)
  }

  loadMenuConfig(): Promise<MenuStructure> {
    return new Promise((resolve, reject) => {
      const ch = getChrome()
      if (!ch.runtime?.sendMessage) {
        reject(new Error("chrome.runtime unavailable"))
        return
      }
      ch.runtime.sendMessage({ action: "getMenuStructure" }, (response: unknown) => {
        if (ch.runtime?.lastError) {
          reject(new Error("Config load failed"))
          return
        }
        const r = response as { success?: boolean; structure?: MenuStructure; error?: string } | undefined
        if (r?.success && r.structure) resolve(r.structure)
        else reject(new Error(r?.error || "Config load failed"))
      })
    })
  }

  async getCurrentKeyword(tabInfo: chrome.tabs.Tab, isRefresh: boolean): Promise<KeywordResult> {
    const intent = isRefresh ? KEYWORD_INTENTS.SIDEPANEL_REFRESH : KEYWORD_INTENTS.SIDEPANEL_INIT
    return requestKeyword(intent, { tab: tabInfo })
  }

  renderKeyword(): void {
    const el = document.getElementById("spKeyword")
    const clipBtn = document.getElementById("spClipboardBtn") as (HTMLButtonElement | null)
    const copyBtn = document.getElementById("spKeywordCopy") as (HTMLButtonElement | null)
    const voiceBtn = document.getElementById("spKeywordVoice") as (HTMLButtonElement | null)
    const keywordWrapEl = el?.closest<HTMLElement>(".sp-keyword-wrap") || null

    const voiceSupported = voiceBtn && voiceBtn.dataset.disabled !== "true"
    const voiceEnabled = this.voiceEnabled === true

    if (this.keyword.text) {
      if (el) {
        const display = this.keyword.text.replace(/\s+/g, " ").trim()
        el.textContent = `"${display.length > 20 ? display.substring(0, 20) + "..." : display}"`
      }
      if (keywordWrapEl) {
        keywordWrapEl.dataset.fullKeyword = this.keyword.raw || this.keyword.text || ""
        keywordWrapEl.classList.add("has-keyword")
      }
      el?.removeAttribute("title")
      if (clipBtn) { clipBtn.hidden = false; clipBtn.textContent = "📋 从剪贴板更新关键字" }
      if (copyBtn) copyBtn.hidden = false
      if (voiceBtn) voiceBtn.hidden = !(voiceSupported && voiceEnabled)
    } else {
      if (el) el.textContent = ""
      if (keywordWrapEl) {
        keywordWrapEl.dataset.fullKeyword = ""
        keywordWrapEl.classList.remove("has-keyword")
      }
      el?.removeAttribute("title")
      if (clipBtn) { clipBtn.hidden = false; clipBtn.textContent = "📋 从剪贴板读取关键字" }
      if (copyBtn) copyBtn.hidden = true
      if (voiceBtn) voiceBtn.hidden = true
    }
  }

  initVoiceModule(): void {
    const ch = getChrome()
    ch.storage?.local.get([VOICE_ENABLED_KEY], (result) => {
      this.voiceEnabled = !!result?.[VOICE_ENABLED_KEY]
      this.renderKeyword()
      // legacy VoicePanel 实例化仍由 globalThis 上的旧代码处理；下一会话再迁
    })

    try {
      ch.storage?.onChanged?.addListener((changes, area) => {
        if (area !== "local" || !changes[VOICE_ENABLED_KEY]) return
        const next = !!changes[VOICE_ENABLED_KEY].newValue
        this.voiceEnabled = next
        this.renderKeyword()
      })
    } catch (_) { /* noop */ }
  }

  bindCopyKeywordButton(): void {
    const btn = document.getElementById("spKeywordCopy") as (HTMLButtonElement | null)
    if (!btn) return
    const original = btn.textContent
    btn.addEventListener("click", async (e) => {
      e.stopPropagation()
      const text = (this.keyword.raw || this.keyword.text || "").trim()
      if (!text) return
      try {
        await navigator.clipboard.writeText(text)
        btn.textContent = "✓"
        btn.classList.add("copied")
        btn.disabled = true
        setTimeout(() => {
          btn.textContent = original
          btn.classList.remove("copied")
          btn.disabled = false
        }, 1200)
      } catch (err) {
        console.warn("[触触搜] 复制关键字失败:", err)
        this.showToast("复制失败，请检查浏览器权限")
      }
    })
  }

  bindClipboardButton(): void {
    const btn = document.getElementById("spClipboardBtn") as (HTMLButtonElement | null)
    if (!btn) return
    const original = btn.textContent
    const reset = () => { btn.disabled = false; btn.textContent = original }
    btn.addEventListener("click", async () => {
      btn.disabled = true
      btn.textContent = "⏳ 正在读取剪贴板..."
      try {
        const text = await navigator.clipboard.readText()
        const cleaned = (text || "").trim()
        if (!cleaned) {
          this.showToast("剪贴板为空")
          reset()
          return
        }
        this.keyword = { text: cleaned, raw: cleaned }
        this.keywordSetManually = true
        this.renderKeyword()
        btn.textContent = "✓ 已写入关键字"
        setTimeout(reset, 1200)
      } catch (err) {
        console.warn("[触触搜] 读取剪贴板失败:", err)
        this.showToast("读取剪贴板失败，请检查权限")
        reset()
      }
    })
  }

  renderMenu(): void {
    // 完整菜单结构渲染。legacy 实现写入 spMenu 的 dynamic 部分（百问 / 速答 / 优化 / 封面）。
    // 静态部分 8 个 menu items 已在 HTML 里预渲染（v1.6.16 优化），无需重渲染。
    // 完整 dynamic 渲染逻辑较复杂，下一会话扩展。
  }

  async handleClick(item: MenuItemPayload): Promise<void> {
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
      if (response?.error === "no-keyword") {
        this.showToast("没有选中文本或无法提取关键词")
      }
    } catch (error) {
      console.error("[触触搜] 菜单操作失败:", error)
      this.showToast("操作失败")
    }
  }

  showToast(message: string): void {
    const toast = document.createElement("div")
    toast.className = "sp-toast"
    toast.textContent = message
    document.body.appendChild(toast)
    setTimeout(() => {
      toast.classList.add("fade-out")
      setTimeout(() => toast.remove(), 300)
    }, 2000)
  }
}

export default SidepanelController
