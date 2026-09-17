#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import vm from "node:vm"

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

const bg = loadBackgroundApi()
const article = {
  title: "测试长文标题",
  bodyText: "正文段落。".repeat(180),
  bodyHtml: `<p>${"正文段落。".repeat(180)}</p>`
}
assert(bg.api.trustedChatGptSource("https://chatgpt.com/c/abc", "https://chatgpt.com/c/abc"), "trusted ChatGPT source rejected")
assert(
  bg.api.trustedChatGptSource(
    "https://chatgpt.com/c/previous",
    "https://chatgpt.com/c/current",
    "https://chatgpt.com/c/current"
  ),
  "ChatGPT SPA navigation source rejected"
)
assert(
  !bg.api.trustedChatGptSource(
    "https://chatgpt.com/c/previous",
    "https://chatgpt.com/c/current",
    "https://chatgpt.com/c/another"
  ),
  "unrelated ChatGPT source accepted"
)
assert(
  !bg.api.trustedChatGptSource(
    "https://x.com/compose/articles",
    "https://chatgpt.com/c/current",
    "https://chatgpt.com/c/current"
  ),
  "non-ChatGPT sender accepted through its tab URL"
)
assert(!bg.api.trustedChatGptSource("https://chatgpt.com.evil.test/c/abc", "https://chatgpt.com.evil.test/c/abc"), "lookalike ChatGPT host accepted")
const delivery = await bg.api.createAndDeliverXArticleDraft(article, "https://chatgpt.com/c/abc")
assert(delivery.success === true, "X article task delivery failed")
assert(bg.createdTabs[0]?.url === "https://x.com/compose/articles", "wrong X composer URL")
assert(bg.sentMessages[0]?.message?.action === "ccsDeliverXArticleDraft", "X delivery message missing")
assert(await bg.api.taskForTarget(delivery.taskId, delivery.targetTabId), "target-bound task not readable by its tab")
assert(await bg.api.taskForTarget(delivery.taskId, delivery.targetTabId + 1) === null, "task leaked to another tab")

// 封面风格跟随侧边栏置顶（storage key 必须与 src/shared/coverPinConstants.ts 逐字一致）
const pinConstants = fs.readFileSync(path.join(root, "src/shared/coverPinConstants.ts"), "utf8")
const articleActionsSource = fs.readFileSync(path.join(root, "background/articleActions.js"), "utf8")
for (const [name, value] of [
  ["PIN_STORAGE_KEY", "ccs_sidepanel_pinned_action"],
  ["CUSTOM_PURPOSE_KEY", "ccs_cover_custom_purpose"],
  ["CUSTOM_LINE_KEY", "ccs_cover_custom_selected_line"]
]) {
  assert(pinConstants.includes(`export const ${name} = "${value}"`), `coverPinConstants.ts ${name} drifted from "${value}"`)
  assert(articleActionsSource.includes(`'${value}'`), `articleActions.js must read ${name} literal "${value}"`)
}
assert(/DEFAULT_PIN = \{ taskId: "cover", categoryId: "minimal" \}/.test(pinConstants), "DEFAULT_PIN drifted; sync COVER_DEFAULT_CATEGORY")

const coverUrl = "https://chatgpt.com/c/abc"
const lastCover = () => bg.coverCalls[bg.coverCalls.length - 1]

// 1) 未置顶 → 极简留白，不注入 purposeOverride
const cover = await bg.api.createLongArticleCover(article, coverUrl, 9)
assert(cover.success === true, "cover action failed")
assert(lastCover()?.taskId === "cover", "cover action did not reuse cover task")
assert(lastCover()?.categoryId === "minimal", "no pin must fall back to minimal style")
assert(lastCover()?.purposeOverride === undefined, "no pin must not inject purposeOverride")
assert(lastCover()?.keyword.startsWith("测试长文标题\n\n正文段落。"), "cover action did not include full article")
assert(cover.categoryId === "minimal" && typeof cover.styleLabel === "string", "cover response must report resolved style")

// 2) 置顶内置风格 → 跟随
bg.stored.ccs_sidepanel_pinned_action = { taskId: "cover", categoryId: "zhumoqing" }
assert((await bg.api.createLongArticleCover(article, coverUrl, 9)).categoryId === "zhumoqing", "cover response must expose pinned style")
assert(lastCover()?.categoryId === "zhumoqing" && lastCover()?.purposeOverride === undefined, "cover must follow the sidepanel pinned style")

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

// 5) custom 但没有任何文本 → 极简留白
delete bg.stored.ccs_cover_custom_purpose
await bg.api.createLongArticleCover(article, coverUrl, 9)
assert(lastCover()?.categoryId === "minimal" && lastCover()?.purposeOverride === undefined, "custom pin without any purpose must fall back to minimal")

// 6) 置顶的不是封面任务 → 极简留白
bg.stored.ccs_sidepanel_pinned_action = { taskId: "optimize", categoryId: "deep-research" }
await bg.api.createLongArticleCover(article, coverUrl, 9)
assert(lastCover()?.categoryId === "minimal", "non-cover pin must fall back to minimal")

// 7) 置顶的风格已不存在（运行时打不开）→ 退回极简留白重试，按钮不死
bg.stored.ccs_sidepanel_pinned_action = { taskId: "cover", categoryId: "ghost-style" }
const before = bg.coverCalls.length
const ghost = await bg.api.createLongArticleCover(article, coverUrl, 9)
assert(ghost.success === true && ghost.categoryId === "minimal", "stale pinned style must recover with minimal")
assert(bg.coverCalls.length === before + 2 && bg.coverCalls[before].categoryId === "ghost-style" && lastCover()?.categoryId === "minimal", "stale pinned style must be retried exactly once with minimal")
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
assert(longActionSource.includes("extractArticle(current.block)"), "long actions must read the live article at click time")
assert(longActionSource.includes("replaceArticlePayloadTa(article)"), "X draft action must apply TA replacement")
assert(longActionSource.includes("replace(/他/g, 'TA')"), "X draft TA replacement rule missing")
assert(longActionSource.includes("replaceHtmlTextNodes(template.content)"), "X draft HTML text-node replacement missing")
assert(longActionSource.includes("ccs-long-article-action-spinner"), "long actions loading spinner is missing")

const eventSource = fs.readFileSync(path.join(root, "background/events.js"), "utf8")
for (const action of [
  "ccsCreateXArticleDraft",
  "ccsCreateLongArticleCover",
  "ccsXArticleContentReady",
  "ccsGetXArticleDraftTask",
  "ccsCompleteXArticleDraft"
]) {
  assert(eventSource.includes(action), `background route ${action} missing`)
}
assert(
  eventSource.includes("trustedChatGptSource(senderUrl, sourceUrl, senderTabUrl)"),
  "background must pass the current tab URL for ChatGPT SPA navigation"
)

console.log("[verify-long-article-actions] ✓ 长文来源识别、任务隔离、封面跟随侧边栏置顶风格（7 种场景）、MAIN-world Draft.js 写入及保存保护验证通过")
