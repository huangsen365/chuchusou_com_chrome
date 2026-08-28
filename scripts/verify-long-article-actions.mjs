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
assert(!bg.api.trustedChatGptSource("https://chatgpt.com.evil.test/c/abc", "https://chatgpt.com.evil.test/c/abc"), "lookalike ChatGPT host accepted")
const delivery = await bg.api.createAndDeliverXArticleDraft(article, "https://chatgpt.com/c/abc")
assert(delivery.success === true, "X article task delivery failed")
assert(bg.createdTabs[0]?.url === "https://x.com/compose/articles", "wrong X composer URL")
assert(bg.sentMessages[0]?.message?.action === "ccsDeliverXArticleDraft", "X delivery message missing")
assert(await bg.api.taskForTarget(delivery.taskId, delivery.targetTabId), "target-bound task not readable by its tab")
assert(await bg.api.taskForTarget(delivery.taskId, delivery.targetTabId + 1) === null, "task leaked to another tab")

const cover = await bg.api.createLongArticleCover(article, "https://chatgpt.com/c/abc", 9)
assert(cover.success === true, "cover action failed")
assert(bg.coverCalls[0]?.taskId === "cover", "cover action did not reuse cover task")
assert(bg.coverCalls[0]?.categoryId === "minimal", "long article cover must default to minimal style")
assert(bg.coverCalls[0]?.keyword.startsWith("测试长文标题\n\n正文段落。"), "cover action did not include full article")

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

console.log("[verify-long-article-actions] ✓ 长文来源识别、任务隔离、封面复用、MAIN-world Draft.js 写入及保存保护验证通过")
