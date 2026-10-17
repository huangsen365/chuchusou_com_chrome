#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import vm from "node:vm"
import { readEventSources, registeredMessageActions } from "./lib/swSources.mjs"

const root = process.cwd()

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function loadLongArticleApi() {
  const windowObject = { CCSModules: {} }
  windowObject.top = windowObject
  const context = {
    window: windowObject,
    location: { hostname: "example.com", href: "https://example.com/" },
    document: {},
    chrome: {},
    URL,
    Set,
    Map,
    WeakMap,
    Array,
    String,
    RegExp,
    Promise,
    Error,
    Node: { TEXT_NODE: 3 },
    Element: class {},
    HTMLElement: class {},
    MutationObserver: class {},
    requestAnimationFrame: () => 0,
    console
  }
  vm.createContext(context)
  vm.runInContext(
    fs.readFileSync(path.join(root, "modules/chatGptDom.js"), "utf8"),
    context,
    { filename: "modules/chatGptDom.js" }
  )
  vm.runInContext(
    fs.readFileSync(path.join(root, "modules/longArticleActions.js"), "utf8"),
    context,
    { filename: "modules/longArticleActions.js" }
  )
  return windowObject.CCSModules.LongArticleActions
}

function loadBackgroundApi() {
  const stored = {}
  const createdTabs = []
  const sentMessages = []
  const coverCalls = []
  let nextTabId = 40
  const chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys, callback) {
          if (keys === null) {
            callback({ ...stored })
            return
          }
          const list = Array.isArray(keys) ? keys : [keys]
          callback(Object.fromEntries(list.filter((key) => key in stored).map((key) => [key, stored[key]])))
        },
        set(values, callback) {
          Object.assign(stored, values)
          callback?.()
        },
        remove(keys, callback) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]
          callback?.()
        }
      }
    },
    tabs: {
      create(options, callback) {
        const tab = { id: nextTabId++, status: "complete", url: options.url }
        createdTabs.push(tab)
        callback(tab)
      },
      get(tabId, callback) {
        callback(createdTabs.find((tab) => tab.id === tabId))
      },
      sendMessage(tabId, message, callback) {
        sentMessages.push({ tabId, message })
        callback({ success: true })
      }
    }
  }
  const context = {
    chrome,
    globalThis: null,
    crypto: { randomUUID: () => "ccs-test-task-1234" },
    URL,
    Date,
    Math,
    Object,
    Array,
    String,
    Promise,
    Error,
    setTimeout,
    clearTimeout,
    runAITask: async (options) => {
      coverCalls.push(options)
      // 模拟置顶了一个已被删除的风格：注册表打不开 → 失败
      if (options.categoryId === "ghost-style") return { success: false, error: "engine-url-not-found" }
      return { success: true, opened: 1 }
    },
    console
  }
  context.globalThis = context
  vm.createContext(context)
  // 与 SW 一致：键名注册表先于 articleActions.js 加载
  vm.runInContext(fs.readFileSync(path.join(root, "shared/storageKeys.js"), "utf8"), context, { filename: "shared/storageKeys.js" })
  vm.runInContext(
    fs.readFileSync(path.join(root, "background/articleActions.js"), "utf8"),
    context,
    { filename: "background/articleActions.js" }
  )
  return { api: context.CCSArticleActions, stored, createdTabs, sentMessages, coverCalls }
}

function verifyMainWorldBridge() {
  const requestId = "state-request-1234"
  let titleValue = ""
  let bodyValue = ""
  const titleElement = {
    getAttribute: (name) => name === "data-ccs-main-title" ? requestId : null,
    "__reactProps$title": {
      value: "",
      maxLength: 250,
      onChange: (event) => { titleValue = event.target.value }
    }
  }
  const currentState = { getCurrentContent() {}, getSelection() {} }
  const bodyElement = {
    getAttribute: (name) => name === "data-ccs-main-body" ? requestId : null,
    "__reactProps$body": {
      editorState: currentState,
      onChange: (state) => { bodyValue = state.__plainText }
    }
  }
  const content = {
    getLastBlock: () => ({ getKey: () => "last", getLength: () => bodyValue.length }),
    getBlockMap: () => ({ size: 2 }),
    getPlainText: () => "第一节\n正文内容"
  }
  const Draft = {
    convertFromHTML: () => ({ contentBlocks: [{}, {}], entityMap: {} }),
    ContentState: { createFromBlockArray: () => content },
    EditorState: {
      push: () => ({ __plainText: "第一节\n正文内容" }),
      forceSelection: (state) => state
    },
    SelectionState: { createEmpty: () => ({ merge: () => ({}) }) }
  }
  const runtime = () => Draft
  runtime.c = { 1: { exports: Draft } }
  const listeners = new Map()
  const posted = []
  const windowObject = {
    webpackChunk_twitter_responsive_web: {
      push(chunk) { chunk[2](runtime) }
    },
    addEventListener(type, listener) { listeners.set(type, listener) },
    postMessage(value) { posted.push(value) }
  }
  const context = {
    window: windowObject,
    document: {
      querySelectorAll(selector) {
        if (selector === "[data-ccs-main-title]") return [titleElement]
        if (selector === "[data-ccs-main-body]") return [bodyElement]
        return []
      }
    },
    location: { origin: "https://x.com" },
    Object,
    Array,
    Set,
    Date,
    Math,
    RegExp,
    String,
    Error,
    console
  }
  vm.createContext(context)
  vm.runInContext(
    fs.readFileSync(path.join(root, "modules/xArticleMainWorld.js"), "utf8"),
    context,
    { filename: "modules/xArticleMainWorld.js" }
  )
  listeners.get("message")({
    source: windowObject,
    data: {
      channel: "ccs:x-article-state-request",
      requestId,
      title: "长文标题",
      bodyHtml: "<h2>第一节</h2><p>正文内容</p>"
    }
  })
  assert(titleValue === "长文标题", "MAIN-world bridge did not update React title state")
  assert(bodyValue === "第一节\n正文内容", "MAIN-world bridge did not update Draft.js body state")
  assert(posted.at(-1)?.ok === true, "MAIN-world bridge did not acknowledge state write")
}

const longApi = loadLongArticleApi()
assert(longApi && typeof longApi.isArticleRewritePromptText === "function", "long-article API missing")
assert(typeof longApi.replaceArticlePayloadTa === "function", "X draft TA replacement API missing")
const prompt = [
  "选A并且按照提示词改写：",
  "# 通用「GPT-4.5 感」原始素材深度改写提示词",
  "# 二十八、输出与排版要求",
  "主标题 + 小标题 + 正文",
  "# 原始素材",
  "原始素材参考本次对话上下文。"
].join("\n")
assert(longApi.isArticleRewritePromptText(prompt), "valid rewrite workflow prompt rejected")
assert(
  longApi.isArticleRewritePromptText(prompt.replace("原始素材参考本次对话上下文。", "https://docs.google.com/document/d/doc-id/edit")),
  "valid Google Docs rewrite prompt rejected"
)
assert(!longApi.isArticleRewritePromptText(prompt.replace("# 二十八、输出与排版要求", "输出要求")), "partial prompt fingerprint accepted")
assert(!longApi.isArticleRewritePromptText("请写一篇很长的文章"), "generic long-answer prompt accepted")

// Gemini 把整篇放进「Markdown」代码块：# 主标题 / ## 小标题 / **加粗** / 空行分段（2026-10 实测）。
// 转换只拼字符串、不碰 DOM（页面有 Trusted Types），所以能在这里直接测。
{
  const paragraph = (n) => `第 ${n} 段正文，这里有足够长的论述，用来确认整篇文章的长度门槛与段落结构都被保留下来。`
  const markdown = [
    "# Google靠给混乱网页排座次起家",
    "",
    paragraph(1),
    "",
    `谷歌的核心是 **PageRank算法** 与 *双边市场*，见 [官方说明](https://example.com/a?x=1&y=2)，或 [危险链接](javascript:alert(1))。`,
    "",
    "## 为什么容易停留在表面",
    "",
    ...Array.from({ length: 12 }, (_, i) => [paragraph(i + 2), ""]).flat(),
    "- 第一条要点",
    "- 第二条要点",
    "",
    "1. 有序一",
    "2. 有序二",
    "",
    "> 引用里的话",
    "",
    "<script>alert(1)</script> 结尾段落。"
  ].join("\n")
  const parsed = longApi.articleFromMarkdown(markdown)
  assert(parsed?.title === "Google靠给混乱网页排座次起家", `markdown title wrong: ${parsed?.title}`)
  assert(parsed.bodyHtml.startsWith("<p>第 1 段正文"), "markdown body must start after the title")
  assert(!parsed.bodyHtml.includes("Google靠给混乱网页排座次起家"), "markdown title must not repeat in the body")
  assert(parsed.bodyHtml.includes("<strong>PageRank算法</strong>") && parsed.bodyHtml.includes("<em>双边市场</em>"), "markdown bold/italic not converted")
  assert(parsed.bodyHtml.includes('<a href="https://example.com/a?x=1&amp;y=2">官方说明</a>'), "markdown http link not converted")
  assert(!parsed.bodyHtml.includes("javascript:") || !parsed.bodyHtml.includes('href="javascript'), "non-http link must not become an anchor")
  assert(parsed.bodyHtml.includes("<h2>为什么容易停留在表面</h2>"), "markdown ## heading must become h2")
  assert(parsed.bodyHtml.includes("<ul><li>第一条要点</li><li>第二条要点</li></ul>") && parsed.bodyHtml.includes("<ol><li>有序一</li><li>有序二</li></ol>"), "markdown lists not converted")
  assert(parsed.bodyHtml.includes("<blockquote><p>引用里的话</p></blockquote>"), "markdown quote not converted")
  assert(parsed.bodyHtml.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && !parsed.bodyHtml.includes("<script>"), "raw HTML in markdown must be escaped")
  assert(!/\*\*|\[官方说明\]/.test(parsed.bodyText) && parsed.bodyText.includes("PageRank算法"), "markdown syntax must be stripped from bodyText")
  assert(longApi.validArticle(parsed)?.title === parsed.title, "a full markdown article must be deliverable")
  assert(longApi.articleFromMarkdown("没有主标题的一段话\n\n正文") === null, "markdown without a leading # title is not an article")
  assert(longApi.articleFromMarkdown("## 只有二级标题\n\n正文") === null, "a ## heading is not a main title")
  assert(longApi.validArticle(longApi.articleFromMarkdown("# 标题\n\n太短的正文")) === null, "too-short markdown article must not be deliverable")
}

const bg = loadBackgroundApi()
const article = {
  title: "测试长文标题",
  bodyText: "正文段落。".repeat(180),
  bodyHtml: `<p>${"正文段落。".repeat(180)}</p>`
}
assert(bg.api.trustedArticleSource("https://chatgpt.com/c/abc", "https://chatgpt.com/c/abc"), "trusted ChatGPT source rejected")
assert(
  bg.api.trustedArticleSource(
    "https://chatgpt.com/c/previous",
    "https://chatgpt.com/c/current",
    "https://chatgpt.com/c/current"
  ),
  "ChatGPT SPA navigation source rejected"
)
assert(
  !bg.api.trustedArticleSource(
    "https://chatgpt.com/c/previous",
    "https://chatgpt.com/c/current",
    "https://chatgpt.com/c/another"
  ),
  "unrelated ChatGPT source accepted"
)
assert(
  !bg.api.trustedArticleSource(
    "https://x.com/compose/articles",
    "https://chatgpt.com/c/current",
    "https://chatgpt.com/c/current"
  ),
  "non-ChatGPT sender accepted through its tab URL"
)
assert(!bg.api.trustedArticleSource("https://chatgpt.com.evil.test/c/abc", "https://chatgpt.com.evil.test/c/abc"), "lookalike ChatGPT host accepted")
assert(bg.api.trustedArticleSource("https://gemini.google.com/app/abc", "https://gemini.google.com/app/abc"), "trusted Gemini source rejected")
assert(
  bg.api.trustedArticleSource("https://gemini.google.com/app", "https://gemini.google.com/app/abc", "https://gemini.google.com/app/abc"),
  "Gemini SPA navigation source rejected"
)
assert(
  !bg.api.trustedArticleSource("https://gemini.google.com/app/abc", "https://chatgpt.com/c/abc", "https://chatgpt.com/c/abc"),
  "a Gemini sender must not act for a ChatGPT source"
)
assert(!bg.api.trustedArticleSource("https://gemini.google.com.evil.test/app/abc", "https://gemini.google.com.evil.test/app/abc"), "lookalike Gemini host accepted")
assert(!bg.api.trustedArticleSource("https://www.google.com/search?q=x", "https://www.google.com/search?q=x"), "plain Google pages are not article sources")
const delivery = await bg.api.createAndDeliverXArticleDraft(article, "https://chatgpt.com/c/abc")
assert(delivery.success === true, "X article task delivery failed")
assert(bg.createdTabs[0]?.url === "https://x.com/compose/articles", "wrong X composer URL")
assert(bg.sentMessages[0]?.message?.action === "ccsDeliverXArticleDraft", "X delivery message missing")
assert(await bg.api.taskForTarget(delivery.taskId, delivery.targetTabId), "target-bound task not readable by its tab")
assert(await bg.api.taskForTarget(delivery.taskId, delivery.targetTabId + 1) === null, "task leaked to another tab")

// 封面风格跟随侧边栏置顶（storage key：coverPinConstants.ts 与 shared/storageKeys.js 必须一致，SW 从后者取）
const pinConstants = fs.readFileSync(path.join(root, "src/shared/coverPinConstants.ts"), "utf8")
const articleActionsSource = fs.readFileSync(path.join(root, "background/articleActions.js"), "utf8")
const storageKeysSource = fs.readFileSync(path.join(root, "shared/storageKeys.js"), "utf8")
for (const [name, registryName, value] of [
  ["PIN_STORAGE_KEY", "COVER_PIN", "ccs_sidepanel_pinned_action"],
  ["CUSTOM_PURPOSE_KEY", "COVER_CUSTOM_PURPOSE", "ccs_cover_custom_purpose"],
  ["CUSTOM_LINE_KEY", "COVER_CUSTOM_LINE", "ccs_cover_custom_selected_line"]
]) {
  assert(pinConstants.includes(`export const ${name} = "${value}"`), `coverPinConstants.ts ${name} drifted from "${value}"`)
  assert(storageKeysSource.includes(`${registryName}: '${value}'`), `shared/storageKeys.js ${registryName} drifted from "${value}"`)
  assert(articleActionsSource.includes(`globalThis.CCSStorageKeys.${registryName}`), `articleActions.js must read ${registryName} from CCSStorageKeys`)
}
assert(/DEFAULT_PIN = \{ taskId: "cover", categoryId: "zhumoqing" \}/.test(pinConstants), "DEFAULT_PIN drifted; sync COVER_DEFAULT_CATEGORY")

const coverUrl = "https://chatgpt.com/c/abc"
const lastCover = () => bg.coverCalls[bg.coverCalls.length - 1]

// 1) 未置顶 → 默认风格（zhumoqing），不注入 purposeOverride
const cover = await bg.api.createLongArticleCover(article, coverUrl, 9)
assert(cover.success === true, "cover action failed")
assert(lastCover()?.taskId === "cover", "cover action did not reuse cover task")
assert(lastCover()?.categoryId === "zhumoqing", "no pin must fall back to the default style")
assert(lastCover()?.purposeOverride === undefined, "no pin must not inject purposeOverride")
assert(lastCover()?.keyword.startsWith("测试长文标题\n\n正文段落。"), "cover action did not include full article")
assert(cover.categoryId === "zhumoqing" && typeof cover.styleLabel === "string", "cover response must report resolved style")

// 2) 置顶内置风格（非默认值）→ 跟随
bg.stored.ccs_sidepanel_pinned_action = { taskId: "cover", categoryId: "xiaohongshu" }
assert((await bg.api.createLongArticleCover(article, coverUrl, 9)).categoryId === "xiaohongshu", "cover response must expose pinned style")
assert(lastCover()?.categoryId === "xiaohongshu" && lastCover()?.purposeOverride === undefined, "cover must follow the sidepanel pinned style")

// 3) 置顶 custom + 已选中行 → purposeOverride = 该行
bg.stored.ccs_sidepanel_pinned_action = { taskId: "cover", categoryId: "custom" }
bg.stored.ccs_cover_custom_purpose = "水墨国风\n赛博霓虹"
bg.stored.ccs_cover_custom_selected_line = "赛博霓虹"
const custom = await bg.api.createLongArticleCover(article, coverUrl, 9)
assert(lastCover()?.categoryId === "custom" && lastCover()?.purposeOverride === "赛博霓虹", "custom pin must inject the selected line as purposeOverride")
assert(custom.styleLabel === "赛博霓虹", "custom style label must be the selected line")

// 4) custom 没存过选中行 → 预设库全文首行（与 sidepanel 兼容逻辑一致）
delete bg.stored.ccs_cover_custom_selected_line
await bg.api.createLongArticleCover(article, coverUrl, 9)
assert(lastCover()?.purposeOverride === "水墨国风", "custom pin without selected line must fall back to first preset line")

// 5) custom 但没有任何文本 → 默认风格
delete bg.stored.ccs_cover_custom_purpose
await bg.api.createLongArticleCover(article, coverUrl, 9)
assert(lastCover()?.categoryId === "zhumoqing" && lastCover()?.purposeOverride === undefined, "custom pin without any purpose must fall back to the default style")

// 6) 置顶的不是封面任务 → 默认风格
bg.stored.ccs_sidepanel_pinned_action = { taskId: "optimize", categoryId: "deep-research" }
await bg.api.createLongArticleCover(article, coverUrl, 9)
assert(lastCover()?.categoryId === "zhumoqing", "non-cover pin must fall back to the default style")

// 7) 置顶的风格已不存在（运行时打不开）→ 退回默认风格重试，按钮不死
bg.stored.ccs_sidepanel_pinned_action = { taskId: "cover", categoryId: "ghost-style" }
const before = bg.coverCalls.length
const ghost = await bg.api.createLongArticleCover(article, coverUrl, 9)
assert(ghost.success === true && ghost.categoryId === "zhumoqing", "stale pinned style must recover with the default style")
assert(bg.coverCalls.length === before + 2 && bg.coverCalls[before].categoryId === "ghost-style" && lastCover()?.categoryId === "zhumoqing", "stale pinned style must be retried exactly once with the default style")
delete bg.stored.ccs_sidepanel_pinned_action

verifyMainWorldBridge()

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"))
const allScripts = manifest.content_scripts.flatMap((entry) => entry.js || [])
for (const file of ["modules/longArticleActions.js", "modules/xArticleDraftDelivery.js", "modules/xArticleMainWorld.js"]) {
  assert(allScripts.includes(file), `manifest must load ${file}`)
}
const mainWorld = manifest.content_scripts.find((entry) => entry.js?.includes("modules/xArticleMainWorld.js"))
assert(mainWorld?.world === "MAIN", "X Draft.js bridge must run in MAIN world")
assert(mainWorld?.matches?.every((value) => value.includes("/compose/articles")), "MAIN-world bridge scope is too broad")

const deliverySource = fs.readFileSync(path.join(root, "modules/xArticleDraftDelivery.js"), "utf8")
assert(deliverySource.includes("已有内容，为避免覆盖已停止注入"), "existing-draft protection missing")
assert(deliverySource.includes("waitForExactContent"), "exact X content verification missing")
assert(deliverySource.includes("waitForSave"), "X auto-save verification missing")
assert(deliverySource.includes("create|write|write article"), "X article-list create control is not recognized")
assert(deliverySource.includes("main button, main a[href]"), "X write-control lookup is not scoped to main")
assert(deliverySource.includes('placeholder*="标题"'), "localized X title placeholder is not recognized")
assert(deliverySource.includes("scoreTitleCandidate"), "DraftBridge title-candidate fallback is missing")
assert(deliverySource.includes("scoreBodyCandidate"), "DraftBridge body-candidate fallback is missing")
assert(!deliverySource.includes("publish"), "delivery module must never publish")

const longActionSource = fs.readFileSync(path.join(root, "modules/longArticleActions.js"), "utf8")
assert(longActionSource.includes("workflowCandidateFor"), "long actions must mount before the article payload is ready")
assert(longActionSource.includes("ccsLongArticleState"), "long actions generation state is missing")
assert(longActionSource.includes("'generating'"), "long actions generating state is missing")
assert(longActionSource.includes("'settling'"), "long actions settling state is missing")
// 点击时重新向站点要一次文章（不复用挂载时的快照）：ChatGPT 与 Gemini 都经 site.inspect → article()
assert(longActionSource.includes("const current = site.inspect(assistant);") && longActionSource.includes("current.article()"),
  "long actions must read the live article at click time")
assert(longActionSource.includes("replaceArticlePayloadTa(article)"), "X draft action must apply TA replacement")
assert(longActionSource.includes("replace(/他/g, 'TA')"), "X draft TA replacement rule missing")
assert(longActionSource.includes("replaceHtmlTextNodes(template.content)"), "X draft HTML text-node replacement missing")
assert(longActionSource.includes("ccs-long-article-action-spinner"), "long actions loading spinner is missing")

const eventSource = readEventSources(root)
const registeredActions = registeredMessageActions(root)
for (const action of [
  "ccsCreateXArticleDraft",
  "ccsCreateLongArticleCover",
  "ccsXArticleContentReady",
  "ccsGetXArticleDraftTask",
  "ccsCompleteXArticleDraft"
]) {
  assert(registeredActions.includes(action), `background route ${action} missing`)
}
assert(
  eventSource.includes("trustedArticleSource(senderUrl, sourceUrl, senderTabUrl)"),
  "background must pass the current tab URL for ChatGPT / Gemini SPA navigation"
)

console.log("[verify-long-article-actions] ✓ 长文来源识别、任务隔离、封面跟随侧边栏置顶风格（7 种场景）、MAIN-world Draft.js 写入及保存保护验证通过")
