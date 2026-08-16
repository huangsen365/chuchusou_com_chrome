/**
 * X 推文正文 -> 速答 · ChatGPT。
 *
 * 页面侧只负责定位用户点击的主推文正文；提示词拼装、长文本 relay、打开
 * ChatGPT 和编辑器填入全部复用后台现有的 fastqa 链路。
 */

import { Toast } from "./toast"

const ARTICLE_SELECTOR = 'article[data-testid="tweet"]'
const TWEET_TEXT_SELECTOR = '[data-testid="tweetText"]'
const BUTTON_MARKER = "data-ccs-x-tweet-fastqa"
const HOST_MARKER = "data-ccs-x-tweet-fastqa-host"
const STYLE_ID = "ccs-x-tweet-fastqa-styles"

type TweetFastQaState = "idle" | "busy" | "success" | "error" | "unavailable"

interface FastQaResponse {
  success?: boolean
  error?: string
}

function isSupportedXPage(hostname = location.hostname): boolean {
  return /(^|\.)(x\.com|twitter\.com)$/i.test(hostname)
}

function belongsToTweetRoot(element: Element, root: HTMLElement): boolean {
  return element.closest(ARTICLE_SELECTOR) === root
}

/**
 * 引用推文通常位于 role="link" 的可点击卡片中；部分页面会直接嵌套另一层
 * article。两种情况都排除，避免主推文没有文字时误把引用推文当成正文。
 */
function isInsideEmbeddedTweet(element: HTMLElement, root: HTMLElement): boolean {
  let current = element.parentElement
  while (current && current !== root) {
    if (current.matches(ARTICLE_SELECTOR) || current.getAttribute("role") === "link") return true
    current = current.parentElement
  }
  return false
}

export function normalizeTweetBody(value: string): string {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function elementText(element: HTMLElement | undefined): string {
  if (!element) return ""
  return normalizeTweetBody(element.innerText || element.textContent || "")
}

/** 只返回当前 article 的主推文正文，不包含引用推文或链接卡片。 */
export function extractPrimaryTweetBody(root: HTMLElement): string {
  const textElement = Array.from(root.querySelectorAll<HTMLElement>(TWEET_TEXT_SELECTOR))
    .find((element) => belongsToTweetRoot(element, root) && !isInsideEmbeddedTweet(element, root))
  return elementText(textElement)
}

export function buildTweetFastQaInput(body: string): string {
  const normalized = normalizeTweetBody(body)
  return normalized ? `【推文正文】\n${normalized}\n【正文结束】` : ""
}

function findTweetActionGroup(root: HTMLElement): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="group"]')).find((group) =>
    Array.from(group.querySelectorAll<HTMLElement>('[data-testid="reply"]'))
      .some((reply) => belongsToTweetRoot(reply, root))
  ) ?? null
}

function directGroupChild(element: Element, group: HTMLElement): Element | null {
  let current: Element | null = element
  while (current && current.parentElement !== group) current = current.parentElement
  return current?.parentElement === group ? current : null
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement("style")
  style.id = STYLE_ID
  style.textContent = `
    [${HOST_MARKER}] {
      display: flex;
      flex: 1 1 0;
      min-width: 0;
      align-items: center;
      justify-content: center;
    }
    [${BUTTON_MARKER}] {
      position: relative;
      display: inline-flex;
      width: 34.75px;
      height: 34.75px;
      margin: -8px;
      padding: 0;
      align-items: center;
      justify-content: center;
      border: 0;
      border-radius: 9999px;
      background: transparent;
      color: rgb(113 118 123);
      cursor: pointer;
      transition: background-color 120ms ease, color 120ms ease, opacity 120ms ease;
    }
    [${BUTTON_MARKER}]:hover:not(:disabled) {
      background: rgb(29 155 240 / 10%);
      color: rgb(29 155 240);
    }
    [${BUTTON_MARKER}]:focus-visible {
      outline: 2px solid rgb(29 155 240 / 55%);
      outline-offset: 2px;
    }
    [${BUTTON_MARKER}]:disabled { cursor: wait; opacity: 0.58; }
    [${BUTTON_MARKER}][data-ccs-state="unavailable"] { cursor: not-allowed; opacity: 0.38; }
    [${BUTTON_MARKER}][data-ccs-state="success"] { color: rgb(0 186 124); }
    [${BUTTON_MARKER}][data-ccs-state="error"] { color: rgb(244 33 46); }
    [${BUTTON_MARKER}] svg {
      width: 19px;
      height: 19px;
      fill: currentColor;
    }
    [${BUTTON_MARKER}] .ccs-x-tweet-fastqa-spinner {
      display: none;
      width: 15px;
      height: 15px;
      box-sizing: border-box;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: ccs-x-tweet-fastqa-spin 720ms linear infinite;
    }
    [${BUTTON_MARKER}][data-ccs-state="busy"] svg { display: none; }
    [${BUTTON_MARKER}][data-ccs-state="busy"] .ccs-x-tweet-fastqa-spinner { display: block; }
    @keyframes ccs-x-tweet-fastqa-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      [${BUTTON_MARKER}] { transition: none; }
      [${BUTTON_MARKER}] .ccs-x-tweet-fastqa-spinner { animation: none; }
    }
  `
  ;(document.head ?? document.documentElement).appendChild(style)
}

function createFastQaIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("aria-hidden", "true")
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
  path.setAttribute("d", "M13.2 2.5 5.4 13h5.7l-.5 8.5L18.7 10H13l.2-7.5Z")
  svg.appendChild(path)
  return svg
}

function setActionState(button: HTMLButtonElement, state: TweetFastQaState): void {
  const copy: Record<TweetFastQaState, { label: string; title: string }> = {
    idle: {
      label: "用 ChatGPT 速答这条推文",
      title: "速答 · ChatGPT：仅发送这条推文正文"
    },
    busy: { label: "正在发送到 ChatGPT", title: "正在准备速答并打开 ChatGPT" },
    success: { label: "已发送到 ChatGPT", title: "推文正文已发送到速答 · ChatGPT" },
    error: { label: "发送失败，可以重试", title: "发送失败，点击重试" },
    unavailable: { label: "未提取到推文正文", title: "这条推文没有可提取的正文" }
  }
  const next = copy[state]
  button.dataset.ccsState = state
  button.disabled = state === "busy" || state === "success" || state === "unavailable"
  button.setAttribute("aria-disabled", String(button.disabled))
  button.setAttribute("aria-label", next.label)
  button.title = next.title
  const host = button.closest<HTMLElement>(`[${HOST_MARKER}]`)
  if (host) host.title = next.title
}

function sendFastQaToChatGpt(keyword: string): Promise<FastQaResponse> {
  return new Promise((resolve) => {
    try {
      if (!chrome.runtime?.id) {
        resolve({ success: false, error: "runtime-unavailable" })
        return
      }
      chrome.runtime.sendMessage({
        action: "executeMenuAction",
        menuItemId: "ccs-fastqa-chatgpt-quick",
        menuType: "fastqa-quick",
        engineId: "chatgpt",
        keyword
      }, (response: FastQaResponse | undefined) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message || "runtime-error" })
          return
        }
        resolve(response ?? { success: false, error: "empty-response" })
      })
    } catch (error) {
      resolve({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
}

function syncAvailability(button: HTMLButtonElement, root: HTMLElement, force = false): void {
  const state = button.dataset.ccsState as TweetFastQaState | undefined
  if (!force && state && !["idle", "unavailable"].includes(state)) return
  setActionState(button, extractPrimaryTweetBody(root) ? "idle" : "unavailable")
}

async function runTweetFastQa(
  root: HTMLElement,
  button: HTMLButtonElement,
  resetTimers: Set<number>
): Promise<void> {
  const keyword = buildTweetFastQaInput(extractPrimaryTweetBody(root))
  if (!keyword) {
    setActionState(button, "unavailable")
    Toast.warning("未提取到这条推文的正文")
    return
  }

  setActionState(button, "busy")
  try {
    const response = await sendFastQaToChatGpt(keyword)
    if (!response.success) throw new Error(response.error || "速答启动失败")
    setActionState(button, "success")
    Toast.success("推文正文已发送到速答 · ChatGPT")
  } catch (error) {
    setActionState(button, "error")
    Toast.error(error instanceof Error ? error.message : String(error))
  } finally {
    const timer = window.setTimeout(() => {
      resetTimers.delete(timer)
      if (button.isConnected) syncAvailability(button, root, true)
    }, 3000)
    resetTimers.add(timer)
  }
}

function injectTweetAction(root: HTMLElement, resetTimers: Set<number>): void {
  const group = findTweetActionGroup(root)
  if (!group) return

  const existing = Array.from(root.querySelectorAll<HTMLButtonElement>(`[${BUTTON_MARKER}]`))
    .find((element) => belongsToTweetRoot(element, root))
  if (existing) {
    syncAvailability(existing, root)
    return
  }
  if (!extractPrimaryTweetBody(root)) return

  const host = document.createElement("div")
  host.setAttribute(HOST_MARKER, "true")
  host.addEventListener("click", (event) => event.stopPropagation())
  host.addEventListener("pointerdown", (event) => event.stopPropagation())

  const button = document.createElement("button")
  button.type = "button"
  button.setAttribute(BUTTON_MARKER, "true")
  const spinner = document.createElement("span")
  spinner.className = "ccs-x-tweet-fastqa-spinner"
  spinner.setAttribute("aria-hidden", "true")
  button.append(createFastQaIcon(), spinner)
  button.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    void runTweetFastQa(root, button, resetTimers)
  })
  host.appendChild(button)
  setActionState(button, "idle")

  const shareButton = Array.from(group.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => /^(分享帖子|分享|Share post)$/i.test(candidate.getAttribute("aria-label") ?? ""))
  const shareCell = shareButton ? directGroupChild(shareButton, group) : null
  group.insertBefore(host, shareCell)
}

export function startXTweetFastQaIntegration(): () => void {
  try {
    if (window.top !== window || !isSupportedXPage()) return () => {}
  } catch (_) {
    return () => {}
  }

  let stopped = false
  let observer: MutationObserver | null = null
  let scheduled = false
  const resetTimers = new Set<number>()

  const scan = () => {
    scheduled = false
    if (stopped) return
    document.querySelectorAll<HTMLElement>(ARTICLE_SELECTOR)
      .forEach((root) => injectTweetAction(root, resetTimers))
  }
  const schedule = () => {
    if (stopped || scheduled) return
    scheduled = true
    requestAnimationFrame(scan)
  }
  const boot = () => {
    if (stopped || observer || !document.documentElement) return
    ensureStyles()
    observer = new MutationObserver(schedule)
    observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true })
    schedule()
  }

  boot()
  if (!observer) document.addEventListener("DOMContentLoaded", boot, { once: true })

  return () => {
    stopped = true
    document.removeEventListener("DOMContentLoaded", boot)
    observer?.disconnect()
    resetTimers.forEach((timer) => window.clearTimeout(timer))
    resetTimers.clear()
    document.querySelectorAll(`[${HOST_MARKER}]`).forEach((host) => host.remove())
  }
}

export const XTweetFastQa = {
  normalizeTweetBody,
  extractPrimaryTweetBody,
  buildTweetFastQaInput,
  start: startXTweetFastQaIntegration
}

export default XTweetFastQa
