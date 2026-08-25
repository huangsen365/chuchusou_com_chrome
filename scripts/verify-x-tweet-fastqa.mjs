#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import vm from "node:vm"
import ts from "typescript"

const root = process.cwd()
const ARTICLE_SELECTOR = 'article[data-testid="tweet"]'

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
  return windowObject.CCSModules.XTweetFastQa
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
    return selector === '[data-testid="tweetText"]' ? this.tweetTexts : []
  }
}

function verifyApi(name, api) {
  assert(api && typeof api.extractPrimaryTweetBody === "function", `${name}: missing extractor`)
  assert(typeof api.buildTweetFastQaInput === "function", `${name}: missing formatter`)

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
}

const legacyApi = loadLegacyApi()
const loadTs = createTsLoader()
const tsApi = loadTs(path.join(root, "src/content-modules/xTweetFastQa.ts")).XTweetFastQa

verifyApi("legacy", legacyApi)
verifyApi("typescript", tsApi)

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"))
const contentScripts = manifest.content_scripts?.flatMap((entry) => entry.js || []) || []
assert(contentScripts.includes("modules/siteFastQaRuntime.js"), "manifest must load shared site fastqa runtime")
assert(contentScripts.includes("modules/xTweetFastQa.js"), "manifest must load modules/xTweetFastQa.js")
assert(
  contentScripts.indexOf("modules/siteFastQaRuntime.js") < contentScripts.indexOf("modules/xTweetFastQa.js"),
  "shared site fastqa runtime must load before X adapter"
)

console.log("[verify-x-tweet-fastqa] ✓ 主推文正文提取、引用排除、精简正文块及双轨入口验证通过")
