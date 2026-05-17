/**
 * Voice engine picker bridge (TypeScript port)
 *
 * 与 background/voiceOffscreenBridge.js 1:1 行为对等。
 *
 * 可见 sidepanel 不能可靠触发原生麦克风弹窗，所以把麦克风 + Web Speech 工作
 * 转给 MV3 offscreen document 处理。
 *
 * 纯函数 + chrome.* 通过 deps 注入，方便 dual-run verifier 测试。
 * 在生产 SW 加载时（importScripts 或 ESM import）顶部调用 `registerVoiceBridgeListeners()`
 * 即可挂上 onMessage 监听。
 */

export const CCS_VOICE_OFFSCREEN_PATH = "offscreen/voice.html"

export interface ChromeContext {
  documentUrl?: string
  url?: string
}

export interface ChromeRuntimeLite {
  getURL: (path: string) => string
  getContexts?: (filter: { contextTypes: string[]; documentUrls: string[] }) => Promise<ChromeContext[]>
  sendMessage: (msg: unknown) => Promise<unknown>
  onMessage: {
    addListener: (
      listener: (
        request: VoiceRequest,
        sender: unknown,
        sendResponse: (response: unknown) => void
      ) => boolean | void
    ) => void
  }
}

export interface ChromeOffscreenLite {
  createDocument: (opts: { url: string; reasons: string[]; justification: string }) => Promise<void>
}

export interface ChromeAll {
  runtime: ChromeRuntimeLite
  offscreen?: ChromeOffscreenLite
}

export interface VoiceRequest {
  action?: string
  target?: string
  lang?: string
  maxAlternatives?: number
}

export interface VoiceErrorPayload {
  code: string
  name: string
  message: string
}

export interface VoiceRecognizeResponse {
  success?: boolean
  candidates?: Array<{ text: string; score?: number }>
  error?: VoiceErrorPayload
}

export function errorPayload(error: unknown): VoiceErrorPayload {
  const e = (error || {}) as { code?: string; message?: string; name?: string }
  return {
    code: e.code || e.message || "unknown-error",
    name: e.name || "Error",
    message: e.message || String(error || "unknown-error")
  }
}

interface BridgeState {
  creating: Promise<void> | null
  clientsMatchAll?: () => Promise<ChromeContext[]>
}

export function createBridge(chromeApi: ChromeAll, options: { clientsMatchAll?: () => Promise<ChromeContext[]> } = {}) {
  const state: BridgeState = { creating: null, clientsMatchAll: options.clientsMatchAll }

  async function getOffscreenContexts(): Promise<ChromeContext[]> {
    const offscreenUrl = chromeApi.runtime.getURL(CCS_VOICE_OFFSCREEN_PATH)
    if (chromeApi.runtime.getContexts) {
      return chromeApi.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [offscreenUrl]
      })
    }
    if (state.clientsMatchAll) {
      const matched = await state.clientsMatchAll()
      return matched.filter((c) => c.url === offscreenUrl)
    }
    return []
  }

  async function hasOffscreenDocument(): Promise<boolean> {
    const ctxs = await getOffscreenContexts()
    return ctxs.length > 0
  }

  async function ensureOffscreenDocument(): Promise<void> {
    if (!chromeApi.offscreen?.createDocument) {
      throw new Error("offscreen-unavailable")
    }
    if (await hasOffscreenDocument()) return

    if (!state.creating) {
      state.creating = chromeApi.offscreen
        .createDocument({
          url: CCS_VOICE_OFFSCREEN_PATH,
          reasons: ["USER_MEDIA"],
          justification: "Voice engine picker needs microphone access for one recognition request."
        })
        .finally(() => {
          state.creating = null
        })
    }
    await state.creating
  }

  async function recognize(request: VoiceRequest): Promise<VoiceRecognizeResponse> {
    await ensureOffscreenDocument()
    const response = (await chromeApi.runtime.sendMessage({
      action: "ccsVoiceRecognizeOffscreen",
      target: "ccs-voice-offscreen",
      lang: request.lang || "zh-CN",
      maxAlternatives: request.maxAlternatives || 10
    })) as VoiceRecognizeResponse | undefined
    if (!response) throw new Error("offscreen-no-response")
    return response
  }

  async function cancel(): Promise<{ success: boolean }> {
    if (!(await hasOffscreenDocument())) return { success: true }
    try {
      const response = (await chromeApi.runtime.sendMessage({
        action: "ccsVoiceCancelOffscreen",
        target: "ccs-voice-offscreen"
      })) as { success: boolean } | undefined
      return response || { success: true }
    } catch (_) {
      return { success: true }
    }
  }

  function registerListeners(): void {
    chromeApi.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (!request || request.action !== "ccsVoiceRecognize") return false
      recognize(request)
        .then((response) => sendResponse(response))
        .catch((error) => {
          console.warn("[CCS Voice] Recognition bridge failed:", error)
          sendResponse({ success: false, error: errorPayload(error) })
        })
      return true
    })

    chromeApi.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (!request || request.action !== "ccsVoiceCancel") return false
      cancel()
        .then((response) => sendResponse(response))
        .catch((error) => sendResponse({ success: false, error: errorPayload(error) }))
      return true
    })
  }

  return {
    getOffscreenContexts,
    hasOffscreenDocument,
    ensureOffscreenDocument,
    recognize,
    cancel,
    registerListeners
  }
}

/**
 * 默认导出：自动用 globalThis.chrome 注册一次。
 * 在 SW 启动时（src/background.ts 或 importScripts 加载）顶层调用即可。
 */
export function autoRegisterVoiceBridge(): ReturnType<typeof createBridge> | null {
  const ch = (globalThis as unknown as { chrome?: ChromeAll }).chrome
  if (!ch?.runtime?.onMessage) return null
  const bridge = createBridge(ch)
  bridge.registerListeners()
  return bridge
}

export default { createBridge, autoRegisterVoiceBridge, errorPayload, CCS_VOICE_OFFSCREEN_PATH }
