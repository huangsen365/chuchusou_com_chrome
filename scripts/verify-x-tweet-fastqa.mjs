#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import vm from "node:vm"
import ts from "typescript"

const root = process.cwd()
const ARTICLE_SELECTOR = 'article[data-testid="tweet"]'
const X_ARTICLE_SELECTOR = '[data-testid="twitterArticleReadView"]'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function loadLegacyApi() {
  const windowObject = { CCSModules: {} }
  windowObject.top = windowObject
  const context = {
    window: windowObject,
    location: { hostname: "example.com" },
    document: {},
    chrome: {},
    console,
    MutationObserver: class {},
    requestAnimationFrame: () => 0,
    setTimeout,
    clearTimeout,
    Set,
    Map,
    Array,
    String,
    Promise,
    Error
  }
  vm.createContext(context)
  vm.runInContext(
    fs.readFileSync(path.join(root, "modules/siteFastQaRuntime.js"), "utf8"),
    context,
    { filename: "modules/siteFastQaRuntime.js" }
  )
  vm.runInContext(
    fs.readFileSync(path.join(root, "modules/xTweetFastQa.js"), "utf8"),
    context,
    { filename: "modules/xTweetFastQa.js" }
  )
  return {
    adapter: windowObject.CCSModules.XTweetFastQa,
    runtime: windowObject.CCSModules.SiteFastQaRuntime
  }
}

function createTsLoader() {
  const cache = new Map()
  const load = (absolutePath) => {
    if (cache.has(absolutePath)) return cache.get(absolutePath).exports
    const source = fs.readFileSync(absolutePath, "utf8")
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
        esModuleInterop: true,
        isolatedModules: true
      },
      fileName: absolutePath
    })
    const moduleObject = { exports: {} }
    cache.set(absolutePath, moduleObject)
    const customRequire = (specifier) => {
      const base = path.resolve(path.dirname(absolutePath), specifier)
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return load(candidate)
      }
      throw new Error(`Cannot resolve ${specifier} from ${absolutePath}`)
    }
    const context = {
      module: moduleObject,
      exports: moduleObject.exports,
      require: customRequire,
      console,
      globalThis: {},
      Set,
      Map,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Promise,
      Error,
      Date,
      Math,
      setTimeout,
      clearTimeout
    }
    vm.createContext(context)
    vm.runInContext(compiled.outputText, context, { filename: absolutePath })
    return moduleObject.exports
  }
  return load
}

class FakeElement {
  constructor({ text = "", article = false, role = "", parent = null } = {}) {
    this.innerText = text
    this.textContent = text
    this.article = article
    this.role = role
    this.parentElement = parent
    this.tweetTexts = []
    this.xArticles = []
    this.queryMap = new Map()
  }

  matches(selector) {
    return selector === ARTICLE_SELECTOR ? this.article : false
  }

  getAttribute(name) {
    return name === "role" ? this.role || null : null
  }

  closest(selector) {
    let current = this
    while (current) {
      if (current.matches(selector)) return current
      current = current.parentElement
    }
    return null
  }

  querySelectorAll(selector) {
    if (selector === '[data-testid="tweetText"]') return this.tweetTexts
    if (selector === X_ARTICLE_SELECTOR) return this.xArticles
    return []
  }

  querySelector(selector) {
    return this.queryMap.get(selector) || null
  }
}

function verifyApi(name, api) {
  assert(api && typeof api.extractPrimaryTweetBody === "function", `${name}: missing extractor`)
  assert(typeof api.buildTweetFastQaInput === "function", `${name}: missing formatter`)
  assert(typeof api.extractXArticleBody === "function", `${name}: missing X article extractor`)
  assert(typeof api.buildXArticleFastQaInput === "function", `${name}: missing X article formatter`)

  const rootElement = new FakeElement({ article: true })
  const mainText = new FakeElement({ text: "第一行  \n\n\n第二行", parent: rootElement })
  const quoteLink = new FakeElement({ role: "link", parent: rootElement })
  const quotedText = new FakeElement({ text: "这段引用推文不能发送", parent: quoteLink })
  rootElement.tweetTexts = [mainText, quotedText]

  const extracted = api.extractPrimaryTweetBody(rootElement)
  assert(extracted === "第一行\n\n第二行", `${name}: primary body normalization failed`)
  assert(
    api.buildTweetFastQaInput(extracted) === "【推文正文】\n第一行\n\n第二行\n【正文结束】",
    `${name}: prompt block must contain only the requested delimiters and body`
  )

  const quoteOnlyRoot = new FakeElement({ article: true })
  const quoteOnlyLink = new FakeElement({ role: "link", parent: quoteOnlyRoot })
  const quoteOnlyText = new FakeElement({ text: "只有引用推文", parent: quoteOnlyLink })
  quoteOnlyRoot.tweetTexts = [quoteOnlyText]
  assert(api.extractPrimaryTweetBody(quoteOnlyRoot) === "", `${name}: quote-only post must stay empty`)

  const nestedRoot = new FakeElement({ article: true, parent: rootElement })
  const nestedText = new FakeElement({ text: "嵌套推文", parent: nestedRoot })
  rootElement.tweetTexts = [nestedText]
  assert(api.extractPrimaryTweetBody(rootElement) === "", `${name}: nested article text must be excluded`)
  assert(api.buildTweetFastQaInput("  \n ") === "", `${name}: empty body must not create a request`)

  const articleTweet = new FakeElement({ article: true })
  const articleRoot = new FakeElement({ parent: articleTweet })
  const articleTitle = new FakeElement({ text: "  一篇 X 长文  ", parent: articleRoot })
  const articleBody = new FakeElement({ text: "第一段  \n\n\n第二段", parent: articleRoot })
  articleRoot.queryMap.set('[data-testid="twitter-article-title"]', articleTitle)
  articleRoot.queryMap.set('[data-testid="twitterArticleRichTextView"]', articleBody)
  articleTweet.xArticles = [articleRoot]
  articleTweet.tweetTexts = [new FakeElement({ text: "外层推文摘要不能发送", parent: articleTweet })]

  assert(api.extractXArticleTitle(articleTweet) === "一篇 X 长文", `${name}: X article title extraction failed`)
  assert(api.extractXArticleBody(articleTweet) === "第一段\n\n第二段", `${name}: X article body extraction failed`)
  assert(
    api.buildXArticleFastQaInput("一篇 X 长文", "第一段\n\n第二段") ===
      "【X 长文标题】\n一篇 X 长文\n【X 长文正文】\n第一段\n\n第二段\n【正文结束】",
    `${name}: X article prompt block must contain title, full body, and requested delimiters`
  )
  const articleContent = api.extract(articleTweet)
  assert(articleContent?.kind === "article", `${name}: X article must use article content kind`)
  assert(articleContent?.title === "一篇 X 长文", `${name}: X article title missing from content contract`)
  assert(articleContent?.body === "第一段\n\n第二段", `${name}: X article body missing from content contract`)
  assert(!articleContent?.keyword.includes("外层推文摘要"), `${name}: outer tweet teaser leaked into X article input`)

  const articleCardTweet = new FakeElement({ article: true })
  const articleCardLink = new FakeElement({ role: "link", parent: articleCardTweet })
  const embeddedArticle = new FakeElement({ parent: articleCardLink })
  const embeddedBody = new FakeElement({ text: "引用卡片里的长文不能发送", parent: embeddedArticle })
  embeddedArticle.queryMap.set('[data-testid="twitterArticleRichTextView"]', embeddedBody)
  articleCardTweet.xArticles = [embeddedArticle]
  assert(api.extractXArticleBody(articleCardTweet) === "", `${name}: embedded X article card must be excluded`)
}

const legacyModules = loadLegacyApi()
const loadTs = createTsLoader()
const tsApi = loadTs(path.join(root, "src/content-modules/xTweetFastQa.ts")).XTweetFastQa
const tsRuntime = loadTs(path.join(root, "src/content-modules/siteFastQaRuntime.ts"))

verifyApi("legacy", legacyModules.adapter)
verifyApi("typescript", tsApi)

const runtimeUnavailableMessage = "扩展刚完成升级，请刷新当前页面后再试"
assert(
  legacyModules.runtime.toUserFacingError("Extension context invalidated.") === runtimeUnavailableMessage,
  "legacy runtime must localize an invalidated extension context"
)
assert(
  legacyModules.runtime.toUserFacingError("runtime-unavailable") === runtimeUnavailableMessage,
  "legacy runtime must not expose runtime-unavailable"
)
assert(
  tsRuntime.toUserFacingSiteFastQaError("Could not establish connection") === runtimeUnavailableMessage,
  "TypeScript runtime must localize a disconnected extension context"
)
assert(
  tsRuntime.toUserFacingSiteFastQaError("正文提取失败") === "正文提取失败",
  "unrelated fastqa errors must retain their original message"
)

const legacyRuntimeSource = fs.readFileSync(path.join(root, "modules/siteFastQaRuntime.js"), "utf8")
const legacyAdapterSource = fs.readFileSync(path.join(root, "modules/xTweetFastQa.js"), "utf8")
assert(legacyRuntimeSource.includes("adapter.findActionContainers?.(root)"), "shared runtime must support multiple action containers")
assert(legacyRuntimeSource.includes("container.querySelectorAll(buttonSelector)"), "shared runtime must deduplicate buttons per container")
assert(legacyRuntimeSource.includes("ccsSiteFastqaVersion"), "shared runtime must version every injected fastqa button")
assert(!legacyRuntimeSource.includes("error: 'runtime-unavailable'"), "shared runtime must not return a raw runtime-unavailable error")
assert(legacyAdapterSource.includes("findTweetActionGroups"), "X adapter must discover both long-article action groups")
assert(legacyAdapterSource.includes("findActionContainers(root)"), "X adapter must expose multiple long-article action groups")

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"))
const contentScripts = manifest.content_scripts?.flatMap((entry) => entry.js || []) || []
assert(contentScripts.includes("modules/siteFastQaRuntime.js"), "manifest must load shared site fastqa runtime")
assert(contentScripts.includes("modules/xTweetFastQa.js"), "manifest must load modules/xTweetFastQa.js")
assert(
  contentScripts.indexOf("modules/siteFastQaRuntime.js") < contentScripts.indexOf("modules/xTweetFastQa.js"),
  "shared site fastqa runtime must load before X adapter"
)

console.log("[verify-x-tweet-fastqa] ✓ 推文 / X 长文提取、引用排除、正文块、双操作栏及双轨入口验证通过")
