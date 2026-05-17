/**
 * 触触搜 Side Panel - 语音选引擎模块 (TypeScript port, dynamic import)
 *
 * 与 sidepanel/sidepanel.js (行 60-555) 1:1 行为对等。
 *
 * 设计要点（不变）：
 * - 用户已选好 keyword，语音"仅"用于挑引擎
 * - 闭集识别：候选词汇是固定的引擎名表 → 准确率天然高
 * - 永远不自动跳转，给 top-10 候选让用户把关，错了可重录
 * - 每次用户选择都喂给 reranker（chrome.storage.local 历史频次）→ 越用越准
 *
 * 通过 SidepanelController.initVoiceModule() 在 voiceEnabled=true 时 dynamic import，
 * 默认关闭 (`ccs_voice_enabled` flag)，不影响 sidepanel 首屏。
 */

interface ChromeLite {
  runtime?: {
    id?: string
    getURL?: (path: string) => string
    sendMessage?: (msg: unknown) => Promise<unknown>
  }
  storage?: {
    local?: {
      get?: (keys: string[], cb: (res: Record<string, unknown>) => void) => void
      set?: (items: Record<string, unknown>) => void
    }
  }
  tabs?: {
    create?: (opts: { url: string }) => void
  }
}

function getChrome(): ChromeLite | undefined {
  return (globalThis as unknown as { chrome?: ChromeLite }).chrome
}

// 历史频次存储 key（chrome.storage.local 简化版 reranker 数据源）
export const VOICE_HISTORY_KEY = "ccs_voice_history"
// 首次知情同意标志——用户看完说明亲手点"开始"才触发麦克风请求
export const VOICE_INTRO_SEEN_KEY = "ccs_voice_intro_seen"
// 全局开关 key——默认关，用户在 popup 设置里主动开启才会激活整个语音模块
export const VOICE_ENABLED_KEY = "ccs_voice_enabled"

// V1 alias 表硬编码——稳定后挪到 engines.json 的 voiceAliases 字段
// key 是 unifiedMenuConfig 里的 menu item id，确保和现有 handleClick 链路对齐
export const VOICE_ALIAS_MAP: Record<string, string[]> = {
  "ccs-baidu":            ["百度", "baidu", "度娘", "白度", "摆度"],
  "ccs-google":           ["谷歌", "google", "咕咕", "搜歌"],
  "ccs-chatgpt":          ["ChatGPT", "chat gpt", "gpt", "鸡屁屁", "吉皮提", "聊天 gpt", "吉批批", "机批批"],
  "ccs-claude":           ["Claude", "克劳德", "克劳特", "克老德", "克老特"],
  "ccs-grok":             ["Grok", "格罗克", "高科", "格洛克"],
  "ccs-yiyan":            ["文心一言", "文心", "一言", "yiyan"],
  "ccs-google-ai-chat":   ["Google AI", "google ai", "谷歌 AI", "谷歌 ai", "AI 模式", "谷歌 AI 模式"],
  "ccs-zhihu":            ["知乎", "zhihu", "智乎", "只乎"],
  "ccs-weixin":           ["微信", "微信搜一搜", "weixin", "搜一搜"],
  "ccs-taobao":           ["淘宝", "taobao", "掏宝"],
  "ccs-jd":               ["京东", "jd", "jingdong"],
  "ccs-sov2ex":           ["v2ex", "搜 v2ex", "sov2ex", "V 站"],
  "ccs-google-translate": ["翻译", "谷歌翻译", "google 翻译", "translate"],
  "ccs-chuchusou":        ["更多", "更多搜索引擎", "触触搜", "chuchusou", "搜索导航"]
}

// Levenshtein 编辑距离——fuzzy 匹配 ASR 文本和别名
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a) return b.length
  if (!b) return a.length
  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }
  return matrix[b.length][a.length]
}

// 归一化 ASR 文本：小写 + 去标点空白，让"chat gpt"和"chatgpt"能匹配上
export function normalizeAsrText(s: string): string {
  return (s || "").toLowerCase().replace(/[\s.,!?。，！？、；;]/g, "")
}

// 给定一段 ASR 文本，对所有引擎计算最佳别名相似度 ∈ [0,1]
export function aliasMatchScores(asrText: string): Record<string, number> {
  const norm = normalizeAsrText(asrText)
  const out: Record<string, number> = {}
  for (const [engineId, aliases] of Object.entries(VOICE_ALIAS_MAP)) {
    let best = 0
    for (const a of aliases) {
      const aNorm = normalizeAsrText(a)
      if (!aNorm) continue
      const dist = levenshtein(norm, aNorm)
      const maxLen = Math.max(norm.length, aNorm.length, 1)
      const sim = 1 - dist / maxLen
      if (sim > best) best = sim
    }
    out[engineId] = best
  }
  return out
}

export function getVoicePermissionUrl(): string {
  const ch = getChrome()
  return ch?.runtime?.getURL?.("voice-permission/permission.html") || "voice-permission/permission.html"
}

// 麦克风设置页 —— 优先深链到本扩展自身的 site details，让用户不用在列表里翻找
export function getMicSettingsUrl(): string {
  try {
    const ch = getChrome()
    const extId = ch?.runtime?.id
    if (extId) {
      return `chrome://settings/content/siteDetails?site=chrome-extension%3A%2F%2F${extId}`
    }
  } catch (_) { /* fallback below */ }
  return "chrome://settings/content/microphone"
}

// VoiceRecognizer 抽象层——V1 = Web Speech API（浏览器内置，部分实现走云）
// V2 计划：VoskRecognizer 用 Vosk-WASM + grammar 真离线
export interface AsrCandidate {
  text: string
  score?: number
}

export class VoiceRecognizer {
  async recognize(): Promise<AsrCandidate[]> { throw new Error("not implemented") }
  async cancel(): Promise<void> { /* default noop */ }
}

interface VoiceRecognitionErrorPayload {
  code?: string
  message?: string
  name?: string
  permissionState?: string
}

export class VoiceRecognitionError extends Error {
  code: string
  details: VoiceRecognitionErrorPayload | null

  constructor(error: VoiceRecognitionErrorPayload | string | null | undefined) {
    const errObj: VoiceRecognitionErrorPayload =
      typeof error === "string" ? { code: error } : error || {}
    const code = errObj?.code || errObj?.message || errObj?.name || "recognition-error"
    super(code)
    this.name = errObj?.name || "VoiceRecognitionError"
    this.code = code
    this.details = (typeof error === "object" && error) ? error : null
  }
}

interface OffscreenResponse {
  success?: boolean
  error?: VoiceRecognitionErrorPayload
  candidates?: AsrCandidate[]
}

export class OffscreenSpeechRecognizer extends VoiceRecognizer {
  isSupported(): boolean {
    const ch = getChrome()
    const hasRuntimeBridge = !!(ch?.runtime?.sendMessage)
    const w = window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
    const hasWebSpeech = !!(w.SpeechRecognition || w.webkitSpeechRecognition)
    return !!(hasRuntimeBridge && hasWebSpeech)
  }

  async recognize(): Promise<AsrCandidate[]> {
    if (!this.isSupported()) throw new Error("当前浏览器不支持 Web Speech API")
    const ch = getChrome()
    const response = (await ch?.runtime?.sendMessage?.({
      action: "ccsVoiceRecognize",
      lang: "zh-CN",
      maxAlternatives: 10
    })) as OffscreenResponse | undefined
    if (!response) throw new VoiceRecognitionError({ code: "offscreen-no-response" })
    if (!response.success) throw new VoiceRecognitionError(response.error)
    return Array.isArray(response.candidates) ? response.candidates : []
  }

  async cancel(): Promise<void> {
    try {
      const ch = getChrome()
      await ch?.runtime?.sendMessage?.({ action: "ccsVoiceCancel" })
    } catch (_) {
      // Best effort only: the UI state is guarded by recognitionRunId.
    }
  }
}

// VoicePanel 与 SidepanelController（或 legacy renderer）解耦的最小接口
export interface VoiceRendererBridge {
  voiceEnabled: boolean
  config: { groups?: Array<{ items?: Array<MenuItemLite> }> } | null
  keyword: { text: string; raw?: string }
  showToast: (msg: string) => void
  handleClick: (item: MenuItemLite) => void
}

export interface MenuItemLite {
  id: string
  title?: string
  icon?: string
  type?: string
  enabled?: boolean
  children?: MenuItemLite[]
}

interface RankedEngine {
  item: MenuItemLite
  score: number
  matchOnly: number
}

// VoicePanel——录音 → 识别 → 融合排序 → top-10 候选 → 用户选择 → 调度
export class VoicePanel {
  renderer: VoiceRendererBridge
  recognizer: OffscreenSpeechRecognizer
  history: Record<string, number> = {}
  introSeen = false
  busy = false
  recognitionRunId = 0
  helpTargetUrl: string

  constructor(renderer: VoiceRendererBridge) {
    this.renderer = renderer
    this.recognizer = new OffscreenSpeechRecognizer()
    this.helpTargetUrl = getVoicePermissionUrl()
    this.loadHistory()
    this.loadIntroFlag()
    this.bind()
    if (!this.recognizer.isSupported()) {
      // 浏览器不支持 Web Speech API → 永久隐藏入口按钮
      const btn = document.getElementById("spKeywordVoice") as HTMLButtonElement | null
      if (btn) {
        btn.hidden = true
        btn.dataset.disabled = "true"
      }
    }
  }

  loadHistory(): void {
    try {
      const ch = getChrome()
      ch?.storage?.local?.get?.([VOICE_HISTORY_KEY], (result) => {
        this.history = (result?.[VOICE_HISTORY_KEY] as Record<string, number>) || {}
      })
    } catch (_) { /* ignore */ }
  }

  loadIntroFlag(): void {
    try {
      const ch = getChrome()
      ch?.storage?.local?.get?.([VOICE_INTRO_SEEN_KEY], (result) => {
        this.introSeen = !!result?.[VOICE_INTRO_SEEN_KEY]
      })
    } catch (_) { /* ignore */ }
  }

  saveIntroSeen(): void {
    this.introSeen = true
    try {
      const ch = getChrome()
      ch?.storage?.local?.set?.({ [VOICE_INTRO_SEEN_KEY]: true })
    } catch (_) { /* ignore */ }
  }

  saveHistory(): void {
    try {
      const ch = getChrome()
      ch?.storage?.local?.set?.({ [VOICE_HISTORY_KEY]: this.history })
    } catch (_) { /* ignore */ }
  }

  bumpHistory(engineId: string): void {
    this.history[engineId] = (this.history[engineId] || 0) + 1
    this.saveHistory()
  }

  bind(): void {
    const btn = document.getElementById("spKeywordVoice")
    if (btn) btn.addEventListener("click", () => this.start())
    document.getElementById("spVoiceCancel")?.addEventListener("click", () => this.cancel())
    document.getElementById("spVoiceRetry")?.addEventListener("click", () => this.startRecognition())
    document.getElementById("spVoiceIntroOk")?.addEventListener("click", () => this.confirmIntro())
    document.getElementById("spVoiceIntroCancel")?.addEventListener("click", () => this.cancel())
    document.getElementById("spVoiceHelpBtn")?.addEventListener("click", () => {
      try {
        const ch = getChrome()
        ch?.tabs?.create?.({ url: this.helpTargetUrl || getVoicePermissionUrl() })
      } catch (_) { /* ignore */ }
    })
  }

  isEnabled(): boolean {
    return this.renderer?.voiceEnabled === true
  }

  // 从 renderer.config 抓"叶子级搜索引擎"项——直接搜索类，不含子菜单
  // 暂不支持需要二级选择的（速答/百问/优化/封面），那些靠 picker 流程
  collectEngineItems(): MenuItemLite[] {
    const out: MenuItemLite[] = []
    const validTypes = new Set(["search", "ai-chat", "ai-search", "ecommerce", "translate", "portal"])
    for (const group of (this.renderer.config?.groups || [])) {
      if (!group.items) continue
      for (const item of group.items) {
        if (item.children && item.children.length > 0) continue
        if (!item.type || !validTypes.has(item.type)) continue
        if (item.enabled === false) continue
        out.push(item)
      }
    }
    return out
  }

  // 入口：点 🎤 调这里。决定先弹"知情同意"还是直接录音
  start(): void {
    if (!this.isEnabled()) {
      this.deactivate()
      return
    }
    if (this.busy) return
    if (!this.renderer.keyword.text) {
      this.renderer.showToast("请先选中文字或读剪贴板")
      return
    }
    if (!this.introSeen) {
      this.showIntro()
      return
    }
    this.startRecognition()
  }

  // 用户在 intro 页点"明白了，开始录音"——这是真正触发麦克风请求的那一下
  confirmIntro(): void {
    if (!this.isEnabled()) {
      this.deactivate()
      return
    }
    this.saveIntroSeen()
    this.startRecognition()
  }

  // 通过 background/offscreen 启动 SpeechRecognition——麦克风 prompt 由 offscreen document 触发
  async startRecognition(): Promise<void> {
    if (!this.isEnabled()) {
      this.deactivate()
      return
    }
    if (this.busy) return
    const runId = ++this.recognitionRunId
    this.busy = true
    this.showRecordingUi()
    const voiceBtn = document.getElementById("spKeywordVoice") as HTMLButtonElement | null
    if (voiceBtn) voiceBtn.classList.add("recording")
    this.setStatus("recording", "🎤", "正在请求麦克风权限——请留意 Chrome 顶部弹出的授权对话框")

    let candidates: AsrCandidate[]
    try {
      candidates = await this.recognizer.recognize()
    } catch (err) {
      if (runId !== this.recognitionRunId || !this.isEnabled()) return
      console.warn("[触触搜][Voice] 识别失败:", err)
      const e = err as VoiceRecognitionError & VoiceRecognitionErrorPayload
      const code = e.code || e.message || e.name || ""
      if (voiceBtn) voiceBtn.classList.remove("recording")
      this.busy = false
      if (code === "permission-denied" || code === "not-allowed" || code === "service-not-allowed" ||
          code === "NotAllowedError" || e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        const permissionState = e.details?.permissionState || ""
        this.setStatus("error", "🚫", permissionState === "denied" ? "麦克风权限被拒绝" : "需要先完成麦克风授权")
        this.showPermissionHelp(permissionState === "denied" ? "settings" : "grant")
        return
      }
      const msg = code === "no-speech" ? "没听到声音，请再试一次或点取消"
                : code === "audio-capture" || code === "NotFoundError" || code === "DevicesNotFoundError" ? "没找到麦克风设备"
                : code === "network" ? "识别引擎需要联网（V1 用 Web Speech，V2 将切换到本地）"
                : code === "media-devices-unavailable" ? "当前浏览器环境不支持麦克风访问"
                : code === "speech-recognition-unavailable" ? "当前浏览器不支持 Web Speech API"
                : code === "offscreen-unavailable" ? "当前 Chrome 版本不支持扩展离屏录音"
                : `识别失败：${code}`
      this.setStatus("error", "⚠️", msg)
      return
    }
    if (runId !== this.recognitionRunId || !this.isEnabled()) return
    this.finishRecognition(candidates)
  }

  finishRecognition(candidates: AsrCandidate[]): void {
    if (!this.isEnabled()) return
    const voiceBtn = document.getElementById("spKeywordVoice") as HTMLButtonElement | null
    if (voiceBtn) voiceBtn.classList.remove("recording")
    this.busy = false
    document.getElementById("spVoice")!.hidden = false
    document.getElementById("spVoiceIntro")!.hidden = true
    document.getElementById("spVoiceStatus")!.hidden = false
    document.getElementById("spVoiceHelp")!.hidden = true
    document.getElementById("spVoiceActions")!.hidden = false
    const ranked = this.rankEngines(candidates)
    if (!ranked.length) {
      this.setStatus("error", "🤔", "没匹配到引擎，请重录或取消")
      return
    }
    const heard = candidates[0]?.text || ""
    this.setStatus("done", "✓", `听到：「${heard}」—— 请从下方选择`)
    this.renderCandidates(ranked)
  }

  showVisibleRecognitionError(errorText: string): void {
    if (!this.isEnabled()) return
    this.busy = false
    const voiceBtn = document.getElementById("spKeywordVoice") as HTMLButtonElement | null
    if (voiceBtn) voiceBtn.classList.remove("recording")
    document.getElementById("spVoice")!.hidden = false
    document.getElementById("spVoiceIntro")!.hidden = true
    document.getElementById("spVoiceStatus")!.hidden = false
    const listEl = document.getElementById("spVoiceList") as HTMLElement | null
    if (listEl) {
      listEl.hidden = true
      listEl.innerHTML = ""
    }
    document.getElementById("spVoiceHelp")!.hidden = true
    document.getElementById("spVoiceActions")!.hidden = false
    this.setStatus("error", "⚠️", errorText || "可见录音页识别失败，请重试")
  }

  // Joint Scoring：声学分（recogScore）× 别名匹配 + 用户历史 boost
  // 现在 V1 已经"声学+别名"两路融合；V2 加 audio embedding 第三路时只改这里
  rankEngines(asrCandidates: AsrCandidate[]): RankedEngine[] {
    const items = this.collectEngineItems()
    const histValues = Object.values(this.history)
    const maxCount = Math.max(1, ...histValues)

    const engineScores = items.map((item) => {
      let bestPair = 0
      for (const cand of asrCandidates) {
        const aliasScores = aliasMatchScores(cand.text)
        const aSim = aliasScores[item.id] || 0
        // 万一 alias 表没覆盖到，用 title 直接比对兜底
        const titleNorm = normalizeAsrText(item.title || "")
        const candNorm = normalizeAsrText(cand.text)
        const titleSim = titleNorm && candNorm
          ? 1 - levenshtein(candNorm, titleNorm) / Math.max(candNorm.length, titleNorm.length, 1)
          : 0
        const matchSim = Math.max(aSim, titleSim)
        const acousticConf = cand.score || 0.5
        // 声学置信度低时，更依赖文本匹配；高时，加权融合
        const pairScore = acousticConf * 0.4 + matchSim * 0.6
        if (pairScore > bestPair) bestPair = pairScore
      }
      const histBoost = (this.history[item.id] || 0) / maxCount     // [0,1]
      const finalScore = bestPair * 0.85 + histBoost * 0.15
      return { item, score: finalScore, matchOnly: bestPair }
    })

    return engineScores
      .filter((x) => x.matchOnly > 0.15)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
  }

  renderCandidates(ranked: RankedEngine[]): void {
    if (!this.isEnabled()) {
      this.hide()
      return
    }
    const ul = document.getElementById("spVoiceList") as HTMLElement | null
    if (!ul) return
    ul.innerHTML = ""
    ul.hidden = false
    const max = ranked[0]?.score || 1
    ranked.forEach((entry, i) => {
      const li = document.createElement("li")
      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = "sp-voice-item" + (i === 0 ? " top" : "")
      const pct = Math.max(5, Math.round((entry.score / max) * 100))
      const titleSafe = String(entry.item.title || entry.item.id || "").replace(/[<>&]/g, (c) =>
        ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string)
      )
      const iconSafe = String(entry.item.icon || "🔍")
      btn.innerHTML = `
        <span class="sp-voice-item-icon">${iconSafe}</span>
        <span class="sp-voice-item-title">${titleSafe}</span>
        <span class="sp-voice-item-bar"><span class="sp-voice-item-bar-fill" style="width:${pct}%"></span></span>
        <span class="sp-voice-item-pct">${pct}%</span>
      `
      btn.addEventListener("click", () => this.pick(entry.item))
      li.appendChild(btn)
      ul.appendChild(li)
    })
  }

  pick(item: MenuItemLite): void {
    this.bumpHistory(item.id)
    this.hide()
    // 复用现有 handleClick 调度链路——type 路由 / executeMenuAction 全免重写
    this.renderer.handleClick(item)
  }

  cancel(): void {
    this.deactivate()
  }

  deactivate(): void {
    this.recognitionRunId++
    this.busy = false
    const voiceBtn = document.getElementById("spKeywordVoice") as HTMLButtonElement | null
    if (voiceBtn) voiceBtn.classList.remove("recording")
    if (this.recognizer && typeof this.recognizer.cancel === "function") {
      this.recognizer.cancel()
    }
    this.hide()
  }

  // 面板的 4 种"子状态"切换：intro / recording / result / generic-error / permission-denied
  showIntro(): void {
    if (!this.isEnabled()) {
      this.hide()
      return
    }
    document.getElementById("spVoice")!.hidden = false
    document.getElementById("spVoiceIntro")!.hidden = false
    document.getElementById("spVoiceStatus")!.hidden = true
    const listEl = document.getElementById("spVoiceList") as HTMLElement | null
    if (listEl) { listEl.hidden = true; listEl.innerHTML = "" }
    document.getElementById("spVoiceHelp")!.hidden = true
    document.getElementById("spVoiceActions")!.hidden = true
  }

  showRecordingUi(): void {
    if (!this.isEnabled()) {
      this.hide()
      return
    }
    document.getElementById("spVoice")!.hidden = false
    document.getElementById("spVoiceIntro")!.hidden = true
    document.getElementById("spVoiceStatus")!.hidden = false
    const listEl = document.getElementById("spVoiceList") as HTMLElement | null
    if (listEl) { listEl.hidden = true; listEl.innerHTML = "" }
    document.getElementById("spVoiceHelp")!.hidden = true
    document.getElementById("spVoiceActions")!.hidden = false
  }

  showPermissionHelp(kind: "grant" | "settings" = "grant"): void {
    const helpEl = document.getElementById("spVoiceHelp") as HTMLElement | null
    const textEl = helpEl?.querySelector(".sp-voice-help-text") as HTMLElement | null
    const btnEl = document.getElementById("spVoiceHelpBtn") as HTMLElement | null
    if (kind === "settings") {
      this.helpTargetUrl = getMicSettingsUrl()
      if (textEl) textEl.textContent = "Chrome 已记录为拒绝麦克风。点击下面按钮打开本扩展的麦克风设置，把状态改成「允许」，回来点重新录音。"
      if (btnEl) btnEl.textContent = "🔓 去 Chrome 设置开启"
    } else {
      this.helpTargetUrl = getVoicePermissionUrl()
      if (textEl) textEl.textContent = "Chrome 隐藏录音页仍拿不到麦克风。点击下面按钮打开可见录音页，在新页完成录音后，候选列表会回到这里。"
      if (btnEl) btnEl.textContent = "🎤 打开可见录音页"
    }
    if (helpEl) helpEl.hidden = false
  }

  showPermissionReady(): void {
    if (!this.isEnabled()) return
    document.getElementById("spVoice")!.hidden = false
    document.getElementById("spVoiceIntro")!.hidden = true
    document.getElementById("spVoiceStatus")!.hidden = false
    const listEl = document.getElementById("spVoiceList") as HTMLElement | null
    if (listEl) { listEl.hidden = true; listEl.innerHTML = "" }
    document.getElementById("spVoiceHelp")!.hidden = true
    document.getElementById("spVoiceActions")!.hidden = false
    this.setStatus("done", "✓", "麦克风授权成功，请点重新录音")
  }

  hide(): void {
    document.getElementById("spVoice")!.hidden = true
    document.getElementById("spVoiceIntro")!.hidden = true
    document.getElementById("spVoiceStatus")!.hidden = true
    const listEl = document.getElementById("spVoiceList") as HTMLElement | null
    if (listEl) { listEl.hidden = true; listEl.innerHTML = "" }
    document.getElementById("spVoiceHelp")!.hidden = true
    document.getElementById("spVoiceActions")!.hidden = true
  }

  setStatus(state: "recording" | "error" | "done", icon: string, text: string): void {
    const statusEl = document.getElementById("spVoiceStatus")
    if (!statusEl) return
    statusEl.classList.remove("recording", "error", "done")
    statusEl.classList.add(state)
    const iconEl = document.getElementById("spVoiceStatusIcon")
    const textEl = document.getElementById("spVoiceStatusText")
    if (iconEl) iconEl.textContent = icon
    if (textEl) textEl.textContent = text
  }
}

export default VoicePanel
