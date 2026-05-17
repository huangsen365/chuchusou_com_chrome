/**
 * Plasmo offscreen page: offscreen/voice.html (隐藏的录音页)
 *
 * Phase 7 第五个 Plasmo entry。无 UI，仅监听 chrome.runtime.onMessage 处理录音请求。
 */

interface SpeechAlternative { transcript: string; confidence: number }
interface SpeechResults { length: number; [i: number]: SpeechAlternative }
interface SpeechEvent { results: { [i: number]: SpeechResults } }
interface SpeechErrorEvent { error: string }

type SpeechRecognitionCtor = new () => {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  continuous: boolean
  onresult: (e: SpeechEvent) => void
  onerror: (e: SpeechErrorEvent) => void
  onend: () => void
  start: () => void
  abort: () => void
}

interface SerializedError {
  code: string
  name: string
  message: string
  permissionState: string | null
}

interface RecognizeOptions {
  lang?: string
  maxAlternatives?: number
  target?: string
  action?: string
}

interface ChromeLike {
  runtime?: {
    onMessage?: {
      addListener: (l: (req: RecognizeOptions, sender: unknown, sendResponse: (r?: unknown) => void) => boolean | void) => void
    }
  }
}

let activeRecognition: InstanceType<SpeechRecognitionCtor> | null = null
let activeStream: MediaStream | null = null

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

function serializeError(error: unknown, fallbackCode = "recognition-error"): SerializedError {
  const e = error as { code?: string; name?: string; message?: string; permissionState?: string } | null
  return {
    code: e?.code || e?.message || e?.name || fallbackCode,
    name: e?.name || "Error",
    message: e?.message || String(error || fallbackCode),
    permissionState: e?.permissionState || null
  }
}

function stopActiveStream(): void {
  if (!activeStream) return
  activeStream.getTracks().forEach((track) => track.stop())
  activeStream = null
}

function abortActiveRecognition(): void {
  if (!activeRecognition) return
  try { activeRecognition.abort() } catch (_) { /* noop */ }
  activeRecognition = null
}

async function queryMicPermission(): Promise<string> {
  try {
    const perms = navigator.permissions as { query?: (descriptor: { name: PermissionName }) => Promise<{ state?: string }> }
    if (!perms?.query) return "unknown"
    const status = await perms.query({ name: "microphone" as PermissionName })
    return status?.state || "unknown"
  } catch (_) {
    return "unknown"
  }
}

async function requestMicAccess(): Promise<string> {
  if (!navigator.mediaDevices?.getUserMedia) {
    const err: Error & { code?: string } = new Error("media-devices-unavailable")
    err.code = "media-devices-unavailable"
    throw err
  }

  const permissionState = await queryMicPermission()
  if (permissionState === "denied") {
    const err: Error & { code?: string; name?: string; permissionState?: string } = new Error("permission-denied")
    err.name = "NotAllowedError"
    err.code = "permission-denied"
    err.permissionState = permissionState
    throw err
  }

  try {
    activeStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    return permissionState
  } catch (error) {
    ;(error as { permissionState?: string }).permissionState = permissionState
    throw error
  } finally {
    stopActiveStream()
  }
}

function recognizeWithWebSpeech(options: RecognizeOptions): Promise<Array<{ text: string; score: number }>> {
  const SR = getSpeechRecognitionCtor()
  if (!SR) {
    const err: Error & { code?: string } = new Error("speech-recognition-unavailable")
    err.code = "speech-recognition-unavailable"
    throw err
  }

  return new Promise((resolve, reject) => {
    const recognition = new SR()
    activeRecognition = recognition
    recognition.lang = options.lang || "zh-CN"
    recognition.interimResults = false
    recognition.maxAlternatives = options.maxAlternatives || 10
    recognition.continuous = false

    let settled = false
    const settle = <T>(fn: (v: T) => void, value: T) => {
      if (settled) return
      settled = true
      activeRecognition = null
      fn(value)
    }

    recognition.onresult = (event) => {
      const out: Array<{ text: string; score: number }> = []
      const alternatives = event.results?.[0]
      if (alternatives) {
        for (let i = 0; i < alternatives.length; i++) {
          out.push({
            text: alternatives[i].transcript,
            score: alternatives[i].confidence ?? 0.5
          })
        }
      }
      settle(resolve, out)
    }
    recognition.onerror = (event) => {
      const err: Error & { code?: string } = new Error(event.error || "recognition-error")
      err.code = event.error || "recognition-error"
      settle(reject, err)
    }
    recognition.onend = () => {
      const err: Error & { code?: string } = new Error("no-speech")
      err.code = "no-speech"
      settle(reject, err)
    }

    try { recognition.start() } catch (error) { settle(reject, error as Error) }
  })
}

async function recognize(options: RecognizeOptions): Promise<{
  success: boolean
  candidates?: Array<{ text: string; score: number }>
  permissionState?: string
}> {
  abortActiveRecognition()
  stopActiveStream()
  const permissionState = await requestMicAccess()
  const candidates = await recognizeWithWebSpeech(options)
  return { success: true, candidates, permissionState }
}

const ch = (globalThis as unknown as { chrome?: ChromeLike }).chrome
ch?.runtime?.onMessage?.addListener((request, _sender, sendResponse) => {
  if (!request || request.target !== "ccs-voice-offscreen") return false

  if (request.action === "ccsVoiceRecognizeOffscreen") {
    recognize(request)
      .then((response) => sendResponse(response))
      .catch((error) => {
        console.warn("[CCS Voice Offscreen] Recognition failed:", error)
        sendResponse({ success: false, error: serializeError(error) })
      })
    return true
  }

  if (request.action === "ccsVoiceCancelOffscreen") {
    abortActiveRecognition()
    stopActiveStream()
    sendResponse({ success: true })
    return false
  }

  return false
})

export {}
