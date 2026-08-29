/** 知乎回答 / 专栏正文 -> 速答 · ChatGPT 的站点适配器。 */

import {
  startSiteFastQaIntegration,
  type SiteFastQaAdapter,
  type SiteFastQaContent,
  type SiteFastQaKind
} from "./siteFastQaRuntime"

const ROOT_SELECTOR = ".ContentItem.AnswerItem, .ContentItem.ArticleItem, article.Post-Main"
const BUTTON_MARKER = "data-ccs-zhihu-fastqa"
const HOST_MARKER = "data-ccs-zhihu-fastqa-host"
const STYLE_ID = "ccs-zhihu-fastqa-styles"

function isSupportedZhihuPage(hostname = location.hostname): boolean {
  return /(^|\.)zhihu\.com$/i.test(hostname)
}

export function normalizeZhihuText(value: string): string {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n[\t ]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function elementText(element: Element | null | undefined): string {
  if (!element) return ""
  return normalizeZhihuText((element as HTMLElement).innerText || element.textContent || "")
}

function directMeta(root: HTMLElement, itemprop: string): string {
  return root.querySelector<HTMLMetaElement>(`:scope > meta[itemprop="${itemprop}"]`)
    ?.content.trim() ?? ""
}

export function canonicalZhihuUrl(candidate: string, pageUrl: string): string | null {
  try {
    const url = new URL(candidate, pageUrl)
    const hostname = url.hostname.toLowerCase()
    const answerMatch = url.pathname.match(/^\/question\/(\d+)\/answer\/(\d+)\/?$/)
    if ((hostname === "www.zhihu.com" || hostname === "zhihu.com") && answerMatch) {
      return `https://www.zhihu.com/question/${answerMatch[1]}/answer/${answerMatch[2]}`
    }
    const articleMatch = url.pathname.match(/^\/p\/(\d+)\/?$/)
    if (hostname === "zhuanlan.zhihu.com" && articleMatch) {
      return `https://zhuanlan.zhihu.com/p/${articleMatch[1]}`
    }
  } catch (_) {
    // 动态卡片挂载期间可能短暂出现不完整链接。
  }
  return null
}

function sourceUrl(root: HTMLElement, pageUrl: string): string | null {
  const candidates = [
    directMeta(root, "url"),
    ...Array.from(root.querySelectorAll<HTMLAnchorElement>(
      '.ContentItem-title a[href], a[href*="/answer/"], a[href*="zhuanlan.zhihu.com/p/"]'
    )).map((link) => link.getAttribute("href") ?? link.href),
    pageUrl
  ].filter(Boolean)
  return candidates
    .map((candidate) => canonicalZhihuUrl(candidate, pageUrl))
    .find((candidate): candidate is string => candidate !== null) ?? null
}

function contentKind(root: HTMLElement): Extract<SiteFastQaKind, "answer" | "article"> {
  return root.matches("article.Post-Main") || root.classList.contains("ArticleItem")
    ? "article"
    : "answer"
}

function contentTitle(root: HTMLElement, kind: "answer" | "article"): string {
  const localTitle = elementText(root.querySelector(".ContentItem-title, .Post-Title"))
    || directMeta(root, "headline")
  if (localTitle || kind !== "answer") return localTitle
  return elementText(root.ownerDocument.querySelector("main h1, h1"))
}

function bodyElement(root: HTMLElement, kind: "answer" | "article"): HTMLElement | null {
  if (root.matches("article.Post-Main")) {
    return root.querySelector<HTMLElement>(".Post-RichTextContainer .RichText, .Post-RichTextContainer")
  }
  if (kind === "article") {
    return root.querySelector<HTMLElement>('[itemprop="articleBody"], .RichContent-inner .RichText')
  }
  return root.querySelector<HTMLElement>('[itemprop="text"], .RichContent-inner .RichText')
}

function cleanPreviewText(value: string): string {
  return value
    .replace(/(?:…|\.\.\.)?\s*阅读全文\s*$/u, "")
    .replace(/\s*收起\s*$/u, "")
    .trim()
}

function stripFallbackAuthorPrefix(root: HTMLElement, preview: string): string {
  if (root.querySelector(".AuthorInfo")) return preview
  const prefix = preview.match(/^([^\n：:]{1,50})[：:]\s*/u)
  return prefix ? preview.slice(prefix[0].length).trim() : preview
}

export function buildZhihuFastQaInput(
  kind: "answer" | "article",
  title: string,
  body: string
): string {
  const normalizedTitle = normalizeZhihuText(title)
  const normalizedBody = normalizeZhihuText(body)
  if (!normalizedBody) return ""
  const titleLabel = kind === "article" ? "知乎文章标题" : "知乎问题"
  const bodyLabel = kind === "article" ? "知乎文章正文" : "知乎回答正文"
  return [
    ...(normalizedTitle ? [`【${titleLabel}】`, normalizedTitle] : []),
    `【${bodyLabel}】`,
    normalizedBody,
    "【正文结束】"
  ].join("\n")
}

export function extractZhihuFastQaContent(
  root: HTMLElement,
  pageUrl = location.href
): SiteFastQaContent | null {
  const kind = contentKind(root)
  const canonicalUrl = sourceUrl(root, pageUrl)
  if (!canonicalUrl) return null

  const title = contentTitle(root, kind)
  const primaryBody = bodyElement(root, kind)
  const fallbackBody = primaryBody ?? root.querySelector<HTMLElement>(".RichContent-inner")
  const rawBody = cleanPreviewText(elementText(fallbackBody))
  const body = cleanPreviewText(stripFallbackAuthorPrefix(root, rawBody))
  const keyword = buildZhihuFastQaInput(kind, title, body)
  if (!keyword) return null

  return {
    platform: "zhihu",
    kind,
    sourceKey: `zhihu:${canonicalUrl}`,
    sourceUrl: canonicalUrl,
    keyword,
    body,
    ...(title ? { title } : {}),
    ...(root.querySelector(".RichContent.is-collapsed") ? { bodyIncomplete: true } : {})
  }
}

function waitForExpandedBody(root: HTMLElement, initialLength: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      observer.disconnect()
      window.clearTimeout(timer)
      resolve()
    }
    const isReady = () => {
      if (!root.isConnected) return true
      const content = extractZhihuFastQaContent(root)
      return !root.querySelector(".RichContent.is-collapsed") &&
        Boolean(content && (content.body.length > initialLength || !content.bodyIncomplete))
    }
    const observer = new MutationObserver(() => {
      if (isReady()) finish()
    })
    const timer = window.setTimeout(finish, 4000)
    observer.observe(root, { childList: true, characterData: true, subtree: true, attributes: true })
    if (isReady()) finish()
  })
}

function isDirectShareAction(element: Element): boolean {
  if (element.matches(".ContentItem-actions")) return false
  return element.matches(".ShareMenu") || /分享/.test(elementText(element))
}

function findZhihuActionContainer(root: HTMLElement): HTMLElement | null {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(".ContentItem-actions"))
  if (!candidates.length) return null
  const withDirectShare = candidates.find((container) =>
    Array.from(container.children).some(isDirectShareAction)
  )
  if (withDirectShare) return withDirectShare
  const leafContainers = candidates.filter((container) =>
    !Array.from(container.children).some((element) => element.matches(".ContentItem-actions"))
  )
  return leafContainers.at(-1) ?? candidates.at(-1) ?? null
}

export async function prepareZhihuFastQaRoot(root: HTMLElement): Promise<void> {
  const collapsed = root.querySelector<HTMLElement>(".RichContent.is-collapsed")
  if (!collapsed) return
  const more = collapsed.querySelector<HTMLButtonElement>("button.ContentItem-more")
    ?? Array.from(collapsed.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => /阅读全文/.test(elementText(button)))
    ?? null
  if (!more) throw new Error("未找到知乎“阅读全文”按钮，请刷新后重试")
  const initialLength = extractZhihuFastQaContent(root)?.body.length ?? 0
  more.click()
  await waitForExpandedBody(root, initialLength)
  const expanded = extractZhihuFastQaContent(root)
  if (!expanded || expanded.bodyIncomplete) {
    throw new Error("知乎全文尚未展开完成，请稍后重试")
  }
}

export const zhihuFastQaAdapter: SiteFastQaAdapter = {
  id: "zhihu",
  styleId: STYLE_ID,
  isSupported: isSupportedZhihuPage,
  styles: `
    [${HOST_MARKER}] {
      display: inline-flex;
      margin-left: 24px;
      align-items: center;
      vertical-align: middle;
    }
    [${BUTTON_MARKER}] {
      display: inline-flex;
      margin: 0;
      padding: 0;
      align-items: center;
      gap: 4px;
      border: 0;
      background: transparent;
      color: #8590a6;
      cursor: pointer;
      font: 400 14px/22px system-ui, sans-serif;
      transition: color 120ms ease, opacity 120ms ease;
    }
    [${BUTTON_MARKER}]:hover:not(:disabled) { color: #175199; }
    [${BUTTON_MARKER}]:focus-visible {
      outline: 2px solid rgb(23 81 153 / 45%);
      outline-offset: 3px;
      border-radius: 3px;
    }
    [${BUTTON_MARKER}]:disabled { cursor: wait; opacity: 0.58; }
    [${BUTTON_MARKER}][data-ccs-state="success"] { color: #1a7f37; opacity: 1; }
    [${BUTTON_MARKER}][data-ccs-state="success"]:disabled { cursor: default; }
    [${BUTTON_MARKER}][data-ccs-state="error"] { color: #b42318; opacity: 1; }
    [${BUTTON_MARKER}][data-ccs-state="unavailable"] { cursor: not-allowed; opacity: 0.38; }
    [${BUTTON_MARKER}] svg {
      width: 17px;
      height: 17px;
      fill: currentColor;
    }
    @media (prefers-reduced-motion: reduce) {
      [${BUTTON_MARKER}] { transition: none; }
    }
  `,
  findRoots(currentDocument) {
    return Array.from(currentDocument.querySelectorAll<HTMLElement>(ROOT_SELECTOR))
  },
  extract(root) {
    return extractZhihuFastQaContent(root)
  },
  prepare(root) {
    return prepareZhihuFastQaRoot(root)
  },
  findActionContainer(root) {
    return findZhihuActionContainer(root)
  },
  insertHost(_root, container, host) {
    const share = Array.from(container.children)
      .find(isDirectShareAction)
    const fallback = Array.from(container.children)
      .find((element) =>
        !element.matches(".ContentItem-actions") &&
        element.matches(".OptionsButton, .Post-ActionMenuButton, .Popover")
      )
    const anchor = share ?? fallback ?? null
    if (host.parentElement === container) {
      if (anchor && host.nextElementSibling === anchor) return
      if (!anchor && host === container.lastElementChild) return
    }
    container.insertBefore(host, anchor)
  },
  createHost() {
    return document.createElement("span")
  },
  decorateHost(host) {
    host.setAttribute(HOST_MARKER, "true")
  },
  decorateButton(button) {
    button.setAttribute(BUTTON_MARKER, "true")
  },
  ownsElement(element, root) {
    return element.closest(ROOT_SELECTOR) === root
  },
  copy(state, content) {
    const isArticle = content?.kind === "article"
    if (state === "idle") {
      return {
        label: isArticle ? "用 ChatGPT 速答这篇知乎文章" : "用 ChatGPT 速答这则知乎回答",
        title: isArticle
          ? "展开并提取这篇知乎文章，发送到速答 · ChatGPT"
          : "展开并提取这则知乎回答，发送到速答 · ChatGPT"
      }
    }
    if (state === "busy") return { label: "正在发送到 ChatGPT", title: "正在提取知乎全文并打开 ChatGPT" }
    if (state === "success") return { label: "已发送到 ChatGPT", title: "知乎正文已发送到速答 · ChatGPT" }
    if (state === "error") return { label: "发送失败，可以重试", title: "发送失败，点击重试" }
    return { label: "未提取到知乎正文", title: "当前内容没有可用于速答的正文" }
  },
  visibleText(state) {
    if (state === "busy") return "发送中"
    if (state === "success") return "已发送"
    if (state === "error") return "重试"
    if (state === "unavailable") return "不可用"
    return "速答"
  },
  successToast(content) {
    return content.kind === "article"
      ? "知乎文章正文已发送到速答 · ChatGPT"
      : "知乎回答正文已发送到速答 · ChatGPT"
  },
  unavailableToast: "未提取到这则知乎内容的正文"
}

export function startZhihuFastQaIntegration(): () => void {
  return startSiteFastQaIntegration(zhihuFastQaAdapter)
}

export const ZhihuFastQa = {
  normalizeZhihuText,
  canonicalZhihuUrl,
  buildZhihuFastQaInput,
  extract: extractZhihuFastQaContent,
  prepare: prepareZhihuFastQaRoot,
  findActionContainer: findZhihuActionContainer,
  start: startZhihuFastQaIntegration
}

export default ZhihuFastQa
