import articleRewritePrompt from "../assets-json/prompts/articleRewritePrompts.json"
import { applyPromptOutputLanguage, PROMPT_OUTPUT_LANGUAGE_PLACEHOLDER } from "../shared/promptLanguage"

const URL_PLACEHOLDER = "${url}"
const SELECT_A_PREFIX = "选A并且按照提示词改写："
const CONVERSATION_SOURCE_NOTE = "原始素材参考本次对话上下文。"
export const WRITING_BLOCK_SELECTOR = '[data-testid="writing-block-container"], [data-writing-block="true"]'
const ASSISTANT_MESSAGE_SELECTOR = '[data-message-author-role="assistant"][data-message-id]'
const IGNORED_SELECTOR = 'button, [role="toolbar"], nav, menu, [role="menu"]'
const BLOCK_TAGS = new Set([
  "ADDRESS", "BLOCKQUOTE", "DIV", "H1", "H2", "H3", "H4", "H5", "H6",
  "LI", "OL", "P", "PRE", "SECTION", "UL"
])
const GOOGLE_DOC_PATH_PATTERN = /^\/document\/(?:u\/\d+\/)?d\/([^/]+)(?:\/|$)/

export interface PromptFillResult {
  ok?: boolean
  error?: string
  stage?: string
}

export interface RewriteRequestResult {
  success?: boolean
  error?: string
}

interface AIPromptFillApi {
  fill?: (prompt: string, options?: Record<string, unknown>) => Promise<PromptFillResult>
}

interface RewriteWindow extends Window {
  CCSModules?: {
    AIPromptFill?: AIPromptFillApi
    [key: string]: unknown
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function requiredSingleLinePattern(prefix: string, requiredPhrases: Array<string | RegExp>): string {
  return [
    escapeRegExp(prefix),
    ...requiredPhrases.map((phrase) =>
      `(?=[^\\n]*${typeof phrase === "string" ? escapeRegExp(phrase) : phrase.source})`
    ),
    "[^\\n]+"
  ].join("")
}

const FULL_A_PATTERN = requiredSingleLinePattern("A：", [
  "继续生成详细内容", "直接输出正文", "长篇回答", "结尾", "追问", "引导语", /便于(?:直接)?复制使用/u
])
const FULL_B_PATTERN = requiredSingleLinePattern("B：", [
  "【短篇回答】", "【中篇回答】", "讲人话", "活人感", "他、她", "TA"
])
const COMPACT_A_PATTERN = requiredSingleLinePattern("A：", ["继续生成详细内容"])
const COMPACT_B_PATTERN = requiredSingleLinePattern("B：", [
  "【短篇回答】", "【中篇回答】", "更口语", "活人感"
])

function answerShapePattern(aPattern: string, bPattern: string): RegExp {
  return new RegExp([
    "^(?:[^\\n]*[^\\s\\n][^\\n]*\\n+)?【短篇回答】[ \\t]*\\n+([\\s\\S]+?)\\n+",
    "【中篇回答】[ \\t]*\\n+([\\s\\S]+?)\\n+",
    `${aPattern}[ \\t]*\\n+`,
    `${bPattern}$`
  ].join(""), "u")
}

const FULL_RESPONSE_PATTERN = answerShapePattern(FULL_A_PATTERN, FULL_B_PATTERN)
const COMPACT_RESPONSE_PATTERN = answerShapePattern(COMPACT_A_PATTERN, COMPACT_B_PATTERN)

function matchesAnswerShape(text: string, pattern: RegExp): boolean {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").trim()
  const match = pattern.exec(normalized)
  return Boolean(match?.[1]?.trim() && match?.[2]?.trim())
}

export function isFullSelectARewriteResponse(text: string): boolean {
  return matchesAnswerShape(text, FULL_RESPONSE_PATTERN)
}

export function isCompactSelectARewriteResponse(text: string): boolean {
  return matchesAnswerShape(text, COMPACT_RESPONSE_PATTERN)
}

export function responseTextForMatching(root: HTMLElement): string {
  const visit = (node: Node, isRoot = false): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ""
    if (!(node instanceof HTMLElement)) return ""
    if (node.matches(IGNORED_SELECTOR)) return ""
    if (node.tagName === "BR") return "\n"
    let text = Array.from(node.childNodes).map((child) => visit(child)).join("")
    if (!isRoot && BLOCK_TAGS.has(node.tagName)) {
      if (!text.trim()) return "\n"
      if (!text.endsWith("\n")) text += "\n"
    }
    return text
  }
  return visit(root, true)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function assistantMessageFor(root: HTMLElement): HTMLElement | null {
  if (root.matches(ASSISTANT_MESSAGE_SELECTOR)) return root
  return root.closest<HTMLElement>(ASSISTANT_MESSAGE_SELECTOR)
    ?? root.querySelector<HTMLElement>(ASSISTANT_MESSAGE_SELECTOR)
}

function implicitTwoWritingBlockText(root: HTMLElement): string {
  const assistantMessage = assistantMessageFor(root)
  if (!assistantMessage) return ""
  const writingBlocks = Array.from(assistantMessage.querySelectorAll<HTMLElement>(WRITING_BLOCK_SELECTOR))
  if (writingBlocks.length !== 2) return ""
  const shortText = responseTextForMatching(writingBlocks[0])
  const middleText = responseTextForMatching(writingBlocks[1])
  if (!shortText || !middleText) return ""
  const response = assistantMessage.querySelector<HTMLElement>(".markdown") ?? assistantMessage
  const outsideClone = response.cloneNode(true) as HTMLElement
  outsideClone.querySelectorAll(WRITING_BLOCK_SELECTOR).forEach((block) => block.remove())
  const outsideText = responseTextForMatching(outsideClone)
  if (!outsideText.startsWith("A：")) return ""
  return ["【短篇回答】", shortText, "【中篇回答】", middleText, outsideText].join("\n")
}

export function matchesSelectARewriteResponse(root: HTMLElement): boolean {
  const message = assistantMessageFor(root)
  if (!message) return false
  const response = message.querySelector<HTMLElement>(".markdown") ?? message
  const directText = responseTextForMatching(response)
  if (isFullSelectARewriteResponse(directText)) return true
  const writingBlocks = Array.from(message.querySelectorAll<HTMLElement>(WRITING_BLOCK_SELECTOR))
  if (
    writingBlocks.length === 2 &&
    writingBlocks.every((block) => Boolean(responseTextForMatching(block))) &&
    isCompactSelectARewriteResponse(directText)
  ) return true
  const implicitText = implicitTwoWritingBlockText(message)
  return Boolean(implicitText && isFullSelectARewriteResponse(implicitText))
}

export function normalizeGoogleDocUrl(urlValue: string): string {
  try {
    const url = new URL(urlValue)
    const match = url.pathname.match(GOOGLE_DOC_PATH_PATTERN)
    if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || !match?.[1]) return ""
    url.pathname = `/document/d/${match[1]}/edit`
    url.hash = ""
    return url.href
  } catch {
    return ""
  }
}

function activePromptTemplate(): string {
  const template = articleRewritePrompt.templateLines.join("\n").trim()
  if (!template) throw new Error("文章改写提示词模板为空。")
  if (template.split(URL_PLACEHOLDER).length - 1 !== 1) {
    throw new Error("文章改写提示词必须包含且只包含一个 ${url} 占位符。")
  }
  if (template.split(PROMPT_OUTPUT_LANGUAGE_PLACEHOLDER).length - 1 !== 1) {
    throw new Error("文章改写提示词必须包含且只包含一个 ${outputLanguage} 占位符。")
  }
  return template
}

export async function buildSelectARewritePrompt(): Promise<string> {
  const template = activePromptTemplate().replace(URL_PLACEHOLDER, CONVERSATION_SOURCE_NOTE)
  return `${SELECT_A_PREFIX}\n${applyPromptOutputLanguage(template)}`
}

export function fillCurrentComposer(prompt: string): Promise<PromptFillResult> {
  const fill = (window as RewriteWindow).CCSModules?.AIPromptFill?.fill
  if (typeof fill !== "function") {
    return Promise.resolve({ ok: false, error: "composer-fill-unavailable" })
  }
  return fill(prompt, { preserveExistingDraft: true, watchSendResidue: true })
}

export function requestGoogleDocRewrite(sourceUrl: string, target: "chatgpt" | "claude"): Promise<RewriteRequestResult> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ action: "ccsCreateGoogleDocRewrite", sourceUrl, target }, (response) => {
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

export const ArticleRewriteRuntime = {
  WRITING_BLOCK_SELECTOR,
  buildSelectARewritePrompt,
  fillCurrentComposer,
  isCompactSelectARewriteResponse,
  isFullSelectARewriteResponse,
  matchesSelectARewriteResponse,
  normalizeGoogleDocUrl,
  requestGoogleDocRewrite,
  responseTextForMatching
}

export default ArticleRewriteRuntime
