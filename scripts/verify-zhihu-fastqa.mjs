#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import vm from "node:vm"

const root = process.cwd()

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function loadLegacyApi() {
  const windowObject = { CCSModules: {} }
  windowObject.top = windowObject
  const context = {
    window: windowObject,
    location: { hostname: "example.com", href: "https://example.com/" },
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
    Object,
    String,
    Promise,
    Error,
    URL
  }
  vm.createContext(context)
  for (const filename of ["modules/siteFastQaRuntime.js", "modules/zhihuFastQa.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, filename), "utf8"), context, { filename })
  }
  return windowObject.CCSModules.ZhihuFastQa
}

class FakeTextElement {
  constructor(text) {
    this.innerText = text
    this.textContent = text
  }
}

class FakeZhihuRoot {
  constructor({ kind, title, body, url, collapsed = false }) {
    this.kind = kind
    this.title = new FakeTextElement(title)
    this.body = new FakeTextElement(body)
    this.urlMeta = { content: url }
    this.collapsed = collapsed
    this.classList = { contains: (name) => kind === "article-card" && name === "ArticleItem" }
    this.ownerDocument = { querySelector: () => null }
  }

  matches(selector) {
    return selector === "article.Post-Main" && this.kind === "article"
  }

  querySelector(selector) {
    if (selector === ':scope > meta[itemprop="url"]') return this.urlMeta
    if (selector === ':scope > meta[itemprop="headline"]') return null
    if (selector === ".ContentItem-title, .Post-Title") return this.title
    if (selector === ".Post-RichTextContainer .RichText, .Post-RichTextContainer") {
      return this.kind === "article" ? this.body : null
    }
    if (selector === '[itemprop="articleBody"], .RichContent-inner .RichText') {
      return this.kind === "article-card" ? this.body : null
    }
    if (selector === '[itemprop="text"], .RichContent-inner .RichText') {
      return this.kind === "answer" ? this.body : null
    }
    if (selector === ".RichContent-inner") return null
    if (selector === ".AuthorInfo") return {}
    if (selector === ".RichContent.is-collapsed") return this.collapsed ? {} : null
    return null
  }

  querySelectorAll() {
    return []
  }
}

function verifyApi(name, api) {
  assert(api && typeof api.extract === "function", `${name}: missing extractor`)
  assert(typeof api.buildZhihuFastQaInput === "function", `${name}: missing formatter`)
  assert(typeof api.canonicalZhihuUrl === "function", `${name}: missing canonical URL helper`)

  const answer = new FakeZhihuRoot({
    kind: "answer",
    title: "怎样验证这项重要主张？",
    body: "回答摘要第一行。\n\n回答摘要第二行。 阅读全文",
    url: "https://www.zhihu.com/question/123/answer/456?utm_source=test",
    collapsed: true
  })
  const answerResult = api.extract(answer, "https://www.zhihu.com/")
  assert(answerResult?.kind === "answer", `${name}: answer kind`)
  assert(answerResult?.sourceUrl === "https://www.zhihu.com/question/123/answer/456", `${name}: answer URL`)
  assert(answerResult?.body === "回答摘要第一行。\n\n回答摘要第二行。", `${name}: answer body cleanup`)
  assert(answerResult?.bodyIncomplete === true, `${name}: collapsed answer marker`)
  assert(
    answerResult?.keyword ===
      "【知乎问题】\n怎样验证这项重要主张？\n【知乎回答正文】\n回答摘要第一行。\n\n回答摘要第二行。\n【正文结束】",
    `${name}: answer prompt block`
  )

  const article = new FakeZhihuRoot({
    kind: "article",
    title: "一篇需要速答的知乎文章",
    body: "文章正文提出了一个值得讨论的判断。",
    url: "https://zhuanlan.zhihu.com/p/789"
  })
  const articleResult = api.extract(article, "https://zhuanlan.zhihu.com/p/789")
  assert(articleResult?.kind === "article", `${name}: article kind`)
  assert(
    articleResult?.keyword ===
      "【知乎文章标题】\n一篇需要速答的知乎文章\n【知乎文章正文】\n文章正文提出了一个值得讨论的判断。\n【正文结束】",
    `${name}: article prompt block`
  )

  assert(
    api.canonicalZhihuUrl("https://zhihu.com/question/1/answer/2/", "https://zhihu.com/") ===
      "https://www.zhihu.com/question/1/answer/2",
    `${name}: canonical answer URL`
  )
  assert(
    api.canonicalZhihuUrl("https://zhihu.com.evil.test/question/1/answer/2", "https://zhihu.com/") === null,
    `${name}: malicious suffix must be rejected`
  )
  assert(api.buildZhihuFastQaInput("answer", "", "  \n ") === "", `${name}: empty body`)
}

const legacyApi = loadLegacyApi()

verifyApi("modules/zhihuFastQa.js", legacyApi)

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"))
const contentScripts = manifest.content_scripts?.flatMap((entry) => entry.js || []) || []
const runtimeIndex = contentScripts.indexOf("modules/siteFastQaRuntime.js")
const xIndex = contentScripts.indexOf("modules/xTweetFastQa.js")
const zhihuIndex = contentScripts.indexOf("modules/zhihuFastQa.js")
assert(runtimeIndex >= 0, "manifest must load shared site fastqa runtime")
assert(xIndex > runtimeIndex, "X adapter must load after shared runtime")
assert(zhihuIndex > runtimeIndex, "Zhihu adapter must load after shared runtime")

console.log("[verify-zhihu-fastqa] ✓ 回答/文章提取、正文格式、URL 安全及入口验证通过")
