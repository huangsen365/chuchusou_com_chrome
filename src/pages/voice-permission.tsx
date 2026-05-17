/**
 * Plasmo page: voice-permission/permission.html (麦克风授权页)
 *
 * Phase 7 第四个 Plasmo entry。Web Speech API 录音 + chrome.runtime 通信。
 */

import { useRef, useState } from "react"

type StatusTone = "info" | "success" | "error"
type ErrorLike = { name?: string; message?: string; code?: string }

interface ChromeLike {
  runtime?: { id?: string; sendMessage?: (m: unknown) => Promise<void> }
  storage?: { local?: { set: (data: Record<string, unknown>) => Promise<void> } }
  tabs?: { create?: (opts: { url: string }) => void }
}

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
}

function getChrome(): ChromeLike | null {
  return (globalThis as unknown as { chrome?: ChromeLike }).chrome || null
}

function getSR(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

function getMicSettingsUrl(): string {
  try {
    const extId = getChrome()?.runtime?.id
    if (extId) return `chrome://settings/content/siteDetails?site=chrome-extension%3A%2F%2F${extId}`
  } catch (_) { /* noop */ }
  return "chrome://settings/content/microphone"
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop())
}

async function notifyGranted(): Promise<void> {
  const ch = getChrome()
  try {
    await ch?.storage?.local?.set({ ccs_voice_mic_granted_at: Date.now() })
    await ch?.runtime?.sendMessage?.({ action: "ccsVoicePermissionGranted" })
  } catch (_) { /* noop */ }
}

async function sendRecognized(candidates: Array<{ text: string; score: number }>): Promise<void> {
  try { await getChrome()?.runtime?.sendMessage?.({ action: "ccsVoiceVisibleRecognized", candidates }) } catch (_) { /* noop */ }
}

async function sendVisibleError(error: string): Promise<void> {
  try { await getChrome()?.runtime?.sendMessage?.({ action: "ccsVoiceVisibleError", error }) } catch (_) { /* noop */ }
}

function recognizeWithWebSpeech(): Promise<Array<{ text: string; score: number }>> {
  const SR = getSR()
  if (!SR) {
    const err: Error & { code?: string } = new Error("当前浏览器不支持 Web Speech API")
    err.code = "speech-recognition-unavailable"
    throw err
  }

  return new Promise((resolve, reject) => {
    const recognition = new SR()
    recognition.lang = "zh-CN"
    recognition.interimResults = false
    recognition.maxAlternatives = 10
    recognition.continuous = false

    let settled = false
    const settle = <T,>(fn: (v: T) => void, value: T) => {
      if (settled) return
      settled = true
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

function VoicePermissionPage() {
  const [statusText, setStatusText] = useState("点击「开始录音」后，如果 Chrome 弹出授权框请选择允许。")
  const [statusTone, setStatusTone] = useState<StatusTone>("info")
  const [busy, setBusy] = useState(false)
  const [btnText, setBtnText] = useState("开始录音")
  const grantBtnRef = useRef<HTMLButtonElement>(null)

  const setStatus = (text: string, tone: StatusTone = "info") => {
    setStatusText(text)
    setStatusTone(tone)
  }

  const requestMicAndRecognize = async () => {
    setBusy(true)
    setStatus("正在请求麦克风。如果 Chrome 弹出授权框，请选择允许。")
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stopStream(stream)
      await notifyGranted()
      setStatus('麦克风已就绪，正在听...请说出引擎名，例如"百度""GPT""知乎"。')
      const candidates = await recognizeWithWebSpeech()
      await sendRecognized(candidates)
      const heard = candidates[0]?.text || ""
      setStatus(
        heard ? `已听到：「${heard}」。请回到侧边栏选择候选引擎。` : "识别完成。请回到侧边栏选择候选引擎。",
        "success"
      )
      setBtnText("重新录音")
      setBusy(false)
    } catch (error: unknown) {
      console.warn("[CCS Voice Permission] visible recognition failed:", error)
      const err = (error || {}) as ErrorLike
      const name = err?.name || ""
      const message = err?.message || ""
      const code = err?.code || message || name
      const denied = name === "NotAllowedError" || name === "PermissionDeniedError"
      const text = denied
        ? `仍未获得麦克风权限：${message || name}。请点下方按钮到 Chrome 设置里改为允许。`
        : code === "no-speech"
          ? '没听到声音，请点"重新录音"再试一次。'
          : code === "network"
            ? "浏览器语音识别需要联网，请检查网络后重试。"
            : `录音或识别失败：${message || name || code || "未知错误"}`
      setStatus(text, "error")
      await sendVisibleError(text)
      setBtnText("重新录音")
      setBusy(false)
    }
  }

  const openSettings = () => {
    try { getChrome()?.tabs?.create?.({ url: getMicSettingsUrl() }) } catch (_) { /* noop */ }
  }

  const statusColor = statusTone === "error" ? "#b91c1c" : statusTone === "success" ? "#166534" : "#0c4a6e"

  return (
    <main className="vp-shell">
      <section className="vp-panel">
        <div className="vp-icon">🎤</div>
        <h1>触触搜语音录音</h1>
        <p className="vp-copy">
          Chrome 隐藏录音页可能拿不到麦克风。请在这个可见页面直接录音，说出引擎名后，候选列表会回到侧边栏。
        </p>
        <button ref={grantBtnRef} id="vpGrant" type="button" disabled={busy} onClick={requestMicAndRecognize}>
          {btnText}
        </button>
        <button id="vpSettings" className="secondary" type="button" onClick={openSettings}>
          打开 Chrome 麦克风设置
        </button>
        <p className="vp-status" id="vpStatus" style={{ color: statusColor }}>
          {statusText}
        </p>
      </section>
    </main>
  )
}

export default VoicePermissionPage
