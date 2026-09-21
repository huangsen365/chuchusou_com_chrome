import {
  buildSelectARewritePrompt,
  fillCurrentComposer,
  matchesSelectARewriteResponse
} from "./articleRewriteRuntime"
import { Toast } from "./toast"

const ASSISTANT_MESSAGE_SELECTOR = '[data-message-author-role="assistant"][data-message-id]'
const TURN_SELECTOR = '[data-testid^="conversation-turn-"]'
const COPY_RESPONSE_SELECTOR = 'button[data-testid="copy-turn-action-button"]'
const BUTTON_MARKER = "data-ccs-select-a-rewrite"
const BUTTON_CLASS = "ccs-select-a-rewrite"
const STYLE_ID = "ccs-select-a-rewrite-styles"

export function isSupportedChatGptRewritePage(): boolean {
  const host = location.hostname.toLowerCase()
  return host === "chatgpt.com" || host.endsWith(".chatgpt.com") ||
    host === "chat.openai.com" || host.endsWith(".chat.openai.com")
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement("style")
  style.id = STYLE_ID
  style.textContent = `
    .${BUTTON_CLASS} {
      display: inline-flex; align-items: center; min-height: 32px; padding: 4px 8px;
      border: 0; border-radius: 8px; background: transparent; color: inherit; cursor: pointer;
      font: 500 12px/1.2 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      opacity: 0.82; white-space: nowrap;
      transition: background-color 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
    }
    .${BUTTON_CLASS}:hover:not(:disabled) {
      background-color: color-mix(in srgb, currentColor 8%, transparent);
      box-shadow: 0 1px 5px rgb(0 0 0 / 8%); opacity: 1;
    }
    .${BUTTON_CLASS}:focus-visible {
      outline: 2px solid color-mix(in srgb, currentColor 42%, transparent); outline-offset: 2px;
    }
    .${BUTTON_CLASS}:disabled { cursor: wait; opacity: 0.55; }
    @media (prefers-reduced-motion: reduce) { .${BUTTON_CLASS} { transition: none; } }
  `
  ;(document.head ?? document.documentElement).appendChild(style)
}

async function fillRewritePrompt(button: HTMLButtonElement): Promise<void> {
  const original = button.textContent ?? "↗ 选A并优化改写"
  button.disabled = true
  button.textContent = "⏳ 填入中…"
  try {
    const prompt = await buildSelectARewritePrompt()
    const result = await fillCurrentComposer(prompt)
    if (!result.ok && result.stage === "existing_draft") {
      throw new Error("ChatGPT 输入框已有草稿，为避免覆盖，未填入改写提示词")
    }
    if (!result.ok) {
      throw new Error(result.error === "composer-not-found"
        ? "未找到 ChatGPT 输入框"
        : "ChatGPT 输入框未完整接受改写提示词")
    }
    button.textContent = "✓ 已填入"
    Toast.success("“选A”与优化改写提示词已填入 ChatGPT，请检查后手动发送")
  } catch (error) {
    button.textContent = "⚠ 填入失败"
    Toast.error(error instanceof Error ? error.message : String(error))
  } finally {
    window.setTimeout(() => {
      button.disabled = false
      button.textContent = original
    }, 2500)
  }
}

export function injectChatGptSelectARewrite(root: HTMLElement): void {
  const turn = root.closest<HTMLElement>(TURN_SELECTOR)
  if (!turn) return
  const copyButton = turn.querySelector<HTMLButtonElement>(COPY_RESPONSE_SELECTOR)
  const current = turn.querySelector<HTMLButtonElement>(`[${BUTTON_MARKER}]`)
  // 同一轮可能包含正文和空占位消息，统一判断，避免后面的空节点删掉按钮。
  const matches = Array.from(turn.querySelectorAll<HTMLElement>(ASSISTANT_MESSAGE_SELECTOR))
    .some(matchesSelectARewriteResponse)
  if (!copyButton || !matches) {
    current?.remove()
    return
  }
  if (current) {
    if (current.previousElementSibling !== copyButton) copyButton.insertAdjacentElement("afterend", current)
    return
  }
  const button = document.createElement("button")
  button.type = "button"
  button.className = BUTTON_CLASS
  button.setAttribute(BUTTON_MARKER, "true")
  button.setAttribute("aria-label", "选A并优化改写")
  button.title = "将“选A”和文章优化改写提示词填入 ChatGPT 输入框；不会覆盖草稿，也不会自动发送"
  button.textContent = "↗ 选A并优化改写"
  button.addEventListener("click", () => void fillRewritePrompt(button))
  copyButton.insertAdjacentElement("afterend", button)
}

export function startChatGptSelectARewriteIntegration(): () => void {
  try {
    if (window.top !== window || !isSupportedChatGptRewritePage()) return () => {}
  } catch {
    return () => {}
  }
  ensureStyles()
  let scheduled = false
  const schedule = (): void => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      document.querySelectorAll<HTMLElement>(TURN_SELECTOR).forEach(injectChatGptSelectARewrite)
    })
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true })
  window.addEventListener("popstate", schedule)
  schedule()
  return () => {
    observer.disconnect()
    window.removeEventListener("popstate", schedule)
  }
}

export const ChatGptSelectARewrite = {
  inject: injectChatGptSelectARewrite,
  isSupportedPage: isSupportedChatGptRewritePage,
  start: startChatGptSelectARewriteIntegration
}

export default ChatGptSelectARewrite
