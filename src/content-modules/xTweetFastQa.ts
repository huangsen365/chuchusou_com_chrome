/** X 推文 / 长文正文 -> 速答 · ChatGPT 的站点适配器。 */

import {
  startSiteFastQaIntegration,
  type SiteFastQaAdapter,
  type SiteFastQaContent
} from "./siteFastQaRuntime"

const ARTICLE_SELECTOR = 'article[data-testid="tweet"]'
const TWEET_TEXT_SELECTOR = '[data-testid="tweetText"]'
const X_ARTICLE_SELECTOR = '[data-testid="twitterArticleReadView"]'
const X_ARTICLE_TITLE_SELECTOR = '[data-testid="twitter-article-title"]'
const X_ARTICLE_BODY_SELECTOR = '[data-testid="twitterArticleRichTextView"]'
const BUTTON_MARKER = "data-ccs-x-tweet-fastqa"
const HOST_MARKER = "data-ccs-x-tweet-fastqa-host"
const STYLE_ID = "ccs-x-tweet-fastqa-styles"

function isSupportedXPage(hostname = location.hostname): boolean {
  return /(^|\.)(x\.com|twitter\.com)$/i.test(hostname)
}

function belongsToTweetRoot(element: Element, root: HTMLElement): boolean {
  return element.closest(ARTICLE_SELECTOR) === root
}

/** 排除引用推文和嵌套推文，避免把补充卡片误当成主正文。 */
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

function elementText(element: HTMLElement | null | undefined): string {
  if (!element) return ""
  return normalizeTweetBody(element.innerText || element.textContent || "")
}

/** 只返回当前 article 的主推文正文，不包含引用推文或链接卡片。 */
export function extractPrimaryTweetBody(root: HTMLElement): string {
  const textElement = Array.from(root.querySelectorAll<HTMLElement>(TWEET_TEXT_SELECTOR))
    .find((element) => belongsToTweetRoot(element, root) && !isInsideEmbeddedTweet(element, root))
  return elementText(textElement)
}

/** 返回当前推文承载的 X 长文根节点；排除引用卡片和嵌套推文中的文章。 */
function primaryXArticle(root: HTMLElement): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>(X_ARTICLE_SELECTOR))
    .find((element) => belongsToTweetRoot(element, root) && !isInsideEmbeddedTweet(element, root))
    ?? null
}

export function extractXArticleTitle(root: HTMLElement): string {
  return elementText(primaryXArticle(root)?.querySelector<HTMLElement>(X_ARTICLE_TITLE_SELECTOR))
}

export function extractXArticleBody(root: HTMLElement): string {
  return elementText(primaryXArticle(root)?.querySelector<HTMLElement>(X_ARTICLE_BODY_SELECTOR))
}

export function buildTweetFastQaInput(body: string): string {
  const normalized = normalizeTweetBody(body)
  return normalized ? `【推文正文】\n${normalized}\n【正文结束】` : ""
}

export function buildXArticleFastQaInput(title: string, body: string): string {
  const normalizedTitle = normalizeTweetBody(title)
  const normalizedBody = normalizeTweetBody(body)
  if (!normalizedBody) return ""
  return [
    ...(normalizedTitle ? ["【X 长文标题】", normalizedTitle] : []),
    "【X 长文正文】",
    normalizedBody,
    "【正文结束】"
  ].join("\n")
}

function tweetSourceKey(root: HTMLElement, body: string): string {
  const permalink = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'))
    .find((link) =>
      belongsToTweetRoot(link, root) &&
      !isInsideEmbeddedTweet(link, root) &&
      Boolean(link.querySelector("time"))
    )
  if (permalink) {
    try {
      const url = new URL(permalink.getAttribute("href") ?? permalink.href, location.href)
      const match = url.pathname.match(/^\/[^/]+\/status\/\d+/)
      if (match) return `x:${url.origin}${match[0]}`
    } catch (_) {
      // 部分动态挂载阶段 href 可能暂时不完整，退回正文键即可。
    }
  }
  return `x-body:${body}`
}

export function extractXTweetFastQaContent(root: HTMLElement): SiteFastQaContent | null {
  const articleBody = extractXArticleBody(root)
  if (articleBody) {
    const title = extractXArticleTitle(root)
    const keyword = buildXArticleFastQaInput(title, articleBody)
    const postKey = tweetSourceKey(root, articleBody)
    const sourceKey = postKey.startsWith("x:")
      ? `x-article:${postKey.slice(2)}`
      : `x-article-body:${title || articleBody.slice(0, 200)}`
    return {
      platform: "x",
      kind: "article",
      sourceKey,
      keyword,
      body: articleBody,
      ...(title ? { title } : {})
    }
  }

  const body = extractPrimaryTweetBody(root)
  const keyword = buildTweetFastQaInput(body)
  if (!keyword) return null
  return {
    platform: "x",
    kind: "post",
    sourceKey: tweetSourceKey(root, body),
    keyword,
    body
  }
}

function findTweetActionGroups(root: HTMLElement): HTMLElement[] {
  const article = primaryXArticle(root)
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('[role="group"]')).filter((candidate) =>
    !isInsideEmbeddedTweet(candidate, root) &&
    Array.from(candidate.querySelectorAll<HTMLElement>('[data-testid="reply"]'))
      .some((reply) => belongsToTweetRoot(reply, root))
  )
  if (!article) return candidates.slice(0, 1)

  const articleGroup = candidates.find((candidate) => article.contains(candidate))
  const tweetGroup = candidates.find((candidate) => !article.contains(candidate))
  return Array.from(new Set([articleGroup, tweetGroup].filter((group): group is HTMLElement => group != null)))
}

function findTweetActionGroup(root: HTMLElement): HTMLElement | null {
  return findTweetActionGroups(root)[0] ?? null
}

function directGroupChild(element: Element, group: HTMLElement): Element | null {
  let current: Element | null = element
  while (current && current.parentElement !== group) current = current.parentElement
  return current?.parentElement === group ? current : null
}

export const xTweetFastQaAdapter: SiteFastQaAdapter = {
  id: "x",
  styleId: STYLE_ID,
  isSupported: isSupportedXPage,
  styles: `
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
    [${BUTTON_MARKER}] svg { width: 19px; height: 19px; fill: currentColor; }
    @media (prefers-reduced-motion: reduce) {
      [${BUTTON_MARKER}] { transition: none; }
    }
  `,
  findRoots(currentDocument) {
    return Array.from(currentDocument.querySelectorAll<HTMLElement>(ARTICLE_SELECTOR))
  },
  extract(root) {
    return extractXTweetFastQaContent(root)
  },
  findActionContainer(root) {
    return findTweetActionGroup(root)
  },
  findActionContainers(root) {
    return findTweetActionGroups(root)
  },
  insertHost(_root, group, host) {
    const shareButton = Array.from(group.querySelectorAll<HTMLButtonElement>("button"))
      .find((candidate) => /^(分享帖子|分享|Share post)$/i.test(candidate.getAttribute("aria-label") ?? ""))
    const shareCell = shareButton ? directGroupChild(shareButton, group) : null
    if (host.parentElement === group) {
      if (shareCell && host.nextElementSibling === shareCell) return
      if (!shareCell && host === group.lastElementChild) return
    }
    group.insertBefore(host, shareCell)
  },
  decorateHost(host) {
    host.setAttribute(HOST_MARKER, "true")
  },
  decorateButton(button) {
    button.setAttribute(BUTTON_MARKER, "true")
  },
  ownsElement(element, root) {
    return belongsToTweetRoot(element, root)
  },
  copy(state, content) {
    const isArticle = content?.kind === "article"
    if (state === "idle") {
      return {
        label: isArticle ? "用 ChatGPT 速答这篇 X 长文" : "用 ChatGPT 速答这条推文",
        title: isArticle
          ? "速答 · ChatGPT：仅发送这篇 X 长文的标题和正文"
          : "速答 · ChatGPT：仅发送这条推文正文"
      }
    }
    if (state === "busy") {
      return {
        label: "正在发送到 ChatGPT",
        title: isArticle ? "正在提取 X 长文并打开 ChatGPT" : "正在准备速答并打开 ChatGPT"
      }
    }
    if (state === "success") {
      return {
        label: "已发送到 ChatGPT",
        title: isArticle ? "X 长文已发送到速答 · ChatGPT" : "推文正文已发送到速答 · ChatGPT"
      }
    }
    if (state === "error") return { label: "发送失败，可以重试", title: "发送失败，点击重试" }
    return { label: "未提取到 X 正文", title: "这则 X 内容没有可提取的正文" }
  },
  successToast(content) {
    return content.kind === "article"
      ? "X 长文标题和正文已发送到速答 · ChatGPT"
      : "推文正文已发送到速答 · ChatGPT"
  },
  unavailableToast: "未提取到这则 X 内容的正文"
}

export function startXTweetFastQaIntegration(): () => void {
  return startSiteFastQaIntegration(xTweetFastQaAdapter)
}

export const XTweetFastQa = {
  normalizeTweetBody,
  extractPrimaryTweetBody,
  extractXArticleTitle,
  extractXArticleBody,
  buildTweetFastQaInput,
  buildXArticleFastQaInput,
  extract: extractXTweetFastQaContent,
  start: startXTweetFastQaIntegration
}

export default XTweetFastQa
