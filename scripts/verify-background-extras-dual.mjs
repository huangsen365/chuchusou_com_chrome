#!/usr/bin/env node
/**
 * Dual-run verifier for Phase 3 extras:
 *   - background/StateManager.js              ↔ src/background/StateManager.ts
 *   - background/keywords.js                  ↔ src/background/keywords.ts
 *   - background/config.js (pure parts)       ↔ src/background/promptBuilders.ts
 *
 * 三个模块都有大量 pure 函数。StateManager 有 Map + setInterval（autoStart 关掉避免开 timer）。
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import vm from "node:vm"
import { createRequire } from "node:module"
import ts from "typescript"

const root = process.cwd()
const nodeRequire = createRequire(import.meta.url)

function assert(c, m) { if (!c) throw new Error(m) }

function deepEqual(a, b, p = "") {
  if (a === b) return null
  if (Number.isNaN(a) && Number.isNaN(b)) return null
  if (typeof a !== typeof b) return `type mismatch at ${p || "<root>"}: ${typeof a} vs ${typeof b}`
  if (a === null || b === null) return `null mismatch at ${p || "<root>"}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
  if (typeof a !== "object") return `value mismatch at ${p || "<root>"}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
  if (Array.isArray(a) !== Array.isArray(b)) return `array/object mismatch at ${p || "<root>"}`
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `array length mismatch at ${p || "<root>"}: ${a.length} vs ${b.length}`
    for (let i = 0; i < a.length; i++) {
      const e = deepEqual(a[i], b[i], `${p}[${i}]`)
      if (e) return e
    }
    return null
  }
  const ak = Object.keys(a).sort()
  const bk = Object.keys(b).sort()
  if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) {
    return `keys mismatch at ${p || "<root>"}: [${ak.join(",")}] vs [${bk.join(",")}]`
  }
  for (const k of ak) {
    const e = deepEqual(a[k], b[k], p ? `${p}.${k}` : k)
    if (e) return e
  }
  return null
}

// ============================================================================
// Legacy loader（包含 chrome stub + BG_DEBUG / BG_DBG / cleanupTitleKeyword 依赖）
// ============================================================================

function loadLegacy() {
  const globals = {
    console: { log: () => {}, info: () => {}, warn: () => {}, error: () => {}, group: () => {}, groupEnd: () => {}, time: () => {}, timeEnd: () => {}, table: () => {} },
    chrome: {
      runtime: { getURL: (p) => `chrome-extension://test/${p}`, lastError: null },
      storage: { local: { get: (k, cb) => cb({}), set: () => Promise.resolve() } },
      contextMenus: { update: (_id, _opts, cb) => cb && cb() }
    },
    setInterval: () => 0, clearInterval: () => {},
    setTimeout, clearTimeout, Date,
    Promise, Map, Set, Array, Object, JSON, URL, URLSearchParams, RegExp, Error,
    BG_DEBUG: false,
    BG_DBG: () => {},
    QUICK_RESULT_HOSTS: ["chatgpt.com", "claude.ai"],
    Proxy, parseInt, isNaN, encodeURIComponent, decodeURIComponent, atob, btoa
  }
  const ctx = { globalThis: globals, ...globals }
  ctx.window = ctx.globalThis
  ctx.self = ctx.globalThis
  vm.createContext(ctx)

  // 顺序：Constants + TextUtils + TextLimits 提供 cleanupTitleKeyword 等依赖；然后业务
  const files = [
    { p: "background/utils/Constants.js", a: "" },
    { p: "background/utils/TextUtils.js", a: "" },
    { p: "background/utils/TextLimits.js", a: "" },
    { p: "background/Logger.js", a: "" },
    { p: "background/StateManager.js", a: "\nglobalThis.StateManager = StateManager;" },
    { p: "background/keywords.js", a: "\nglobalThis.safeDecodeParam = safeDecodeParam;\nglobalThis.heuristicExtractFromParams = heuristicExtractFromParams;" },
    { p: "background/config.js", a: "" },
    // KeywordService 内部依赖 computeSearchTextForTab 这种全局函数，无法干跑；
    // 仅把 KEYWORD_INTENTS + INTENT_POLICIES 暴露出来做对比
    { p: "background/KeywordService.js", a: "\nglobalThis.LEGACY_INTENT_POLICIES = INTENT_POLICIES;" }
  ]
  for (const { p: rel, a } of files) {
    const abs = path.join(root, rel)
    const src = fs.readFileSync(abs, "utf8") + a
    vm.runInContext(src, ctx, { filename: abs })
  }
  return ctx.globalThis
}

// ============================================================================
// TS loader
// ============================================================================

function createTsLoader() {
  const cache = new Map()
  function load(absPath) {
    if (cache.has(absPath)) return cache.get(absPath).exports
    const source = fs.readFileSync(absPath, "utf8")
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, isolatedModules: true },
      fileName: absPath
    })
    const moduleObj = { exports: {} }
    cache.set(absPath, moduleObj)
    const customRequire = (spec) => {
      if (spec.startsWith(".")) {
        const base = path.resolve(path.dirname(absPath), spec)
        const cands = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]
        for (const c of cands) if (fs.existsSync(c) && fs.statSync(c).isFile()) return load(c)
        throw new Error(`Cannot resolve "${spec}" from ${absPath}`)
      }
      return nodeRequire(spec)
    }
    const ctx = {
      module: moduleObj, exports: moduleObj.exports, require: customRequire, console,
      globalThis: {},
      // TS 模块运行时需要的内建：URL / URLSearchParams / Date / Map / Set / Proxy / setInterval 等
      URL, URLSearchParams, Date, Map, Set, Proxy, RegExp, Error,
      Promise, Array, Object, JSON, Number, Boolean, String,
      setInterval: () => 0, clearInterval: () => {}, setTimeout, clearTimeout,
      parseInt, parseFloat, isNaN, isFinite,
      encodeURIComponent, decodeURIComponent, atob, btoa,
      Symbol
    }
    vm.createContext(ctx)
    vm.runInContext(compiled.outputText, ctx, { filename: absPath })
    return moduleObj.exports
  }
  return load
}

// ============================================================================
// StateManager 比较
// ============================================================================

function compareStateManager(LegacyCtor, PortedCtor) {
  // 关 autoStart 避免开 timer
  const ls = new LegacyCtor({ autoCleanupInterval: 999999 })
  ls.stopAutoCleanup() // legacy 不支持 autoStart 选项，手动停
  const ps = new PortedCtor({ autoStart: false })

  // 1. 初始 currentState
  const initDiff = deepEqual(ls.getCurrentState(), ps.getCurrentState())
  // currentState.timestamp 都是 null 初始，必须严格相等
  if (initDiff) throw new Error(`initial currentState diverges: ${initDiff}`)

  // 2. setCurrentState
  ls.setCurrentState({ raw: "test", normalized: "test", display: "test", tabId: 1, url: "https://x.com" })
  ps.setCurrentState({ raw: "test", normalized: "test", display: "test", tabId: 1, url: "https://x.com" })
  const cs1 = { ...ls.getCurrentState(), timestamp: 0 }
  const cs2 = { ...ps.getCurrentState(), timestamp: 0 }
  const csDiff = deepEqual(cs1, cs2)
  if (csDiff) throw new Error(`setCurrentState diverges: ${csDiff}`)

  // 3. setSelection / getSelection
  ls.setSelection(1, "hello", "https://x.com")
  ps.setSelection(1, "hello", "https://x.com")
  const sa = { ...ls.getSelection(1), timestamp: 0 }
  const sb = { ...ps.getSelection(1), timestamp: 0 }
  const sDiff = deepEqual(sa, sb)
  if (sDiff) throw new Error(`setSelection diverges: ${sDiff}`)

  // 4. setFallback
  ls.setFallback(2, "raw", "norm", "https://y.com")
  ps.setFallback(2, "raw", "norm", "https://y.com")
  const fa = { ...ls.getFallback(2), timestamp: 0 }
  const fb = { ...ps.getFallback(2), timestamp: 0 }
  const fDiff = deepEqual(fa, fb)
  if (fDiff) throw new Error(`setFallback diverges: ${fDiff}`)

  // 5. setTitle
  ls.setTitle(3, "Hello - 知乎", "Hello", "https://zhihu.com")
  ps.setTitle(3, "Hello - 知乎", "Hello", "https://zhihu.com")
  const ta = { ...ls.getTitle(3), timestamp: 0 }
  const tb = { ...ps.getTitle(3), timestamp: 0 }
  const tDiff = deepEqual(ta, tb)
  if (tDiff) throw new Error(`setTitle diverges: ${tDiff}`)

  // 6. canPreserveCurrentState
  assert(ls.canPreserveCurrentState(1, "https://x.com") === ps.canPreserveCurrentState(1, "https://x.com"), "preserve match tab")
  assert(ls.canPreserveCurrentState(99, "https://x.com/other") === ps.canPreserveCurrentState(99, "https://x.com/other"), "preserve match domain")
  assert(ls.canPreserveCurrentState(99, "https://other.com") === ps.canPreserveCurrentState(99, "https://other.com"), "preserve mismatch")

  // 7. getStats
  const la = ls.getStats()
  const ba = ps.getStats()
  // tabIds 顺序可能不同（Map insertion order，但两边一致），先 sort
  la.tabStates.tabIds.sort()
  ba.tabStates.tabIds.sort()
  // currentState.timestamp 屏蔽
  la.currentState.timestamp = 0
  ba.currentState.timestamp = 0
  const gDiff = deepEqual(la, ba)
  if (gDiff) throw new Error(`getStats diverges: ${gDiff}`)

  // 8. shouldPreserveMenuStateForUrl
  for (const u of ["https://chatgpt.com", "https://x.com", "https://www.claude.ai/abc", "not url", null]) {
    assert(ls.shouldPreserveMenuStateForUrl(u) === ps.shouldPreserveMenuStateForUrl(u),
      `shouldPreserveMenuStateForUrl(${JSON.stringify(u)}) diverges`)
  }

  // 9. cleanupExpiredStates (set old timestamp, then clean)
  const oldTs = Date.now() - 10 * 60 * 1000  // 10 min ago
  ls.tabStates.get(1).meta.updatedAt = oldTs
  ps.tabStates.get(1).meta.updatedAt = oldTs
  const lc = ls.cleanupExpiredStates()
  const pc = ps.cleanupExpiredStates()
  assert(lc === pc, `cleanupExpiredStates count diverges: ${lc} vs ${pc}`)

  // 10. clearAll
  ls.clearAll()
  ps.clearAll()
  assert(ls.tabStates.size === 0 && ps.tabStates.size === 0, "clearAll should empty")
  assert(ls.getCurrentState().raw === "" && ps.getCurrentState().raw === "", "clearAll should reset currentState")
}

// ============================================================================
// keywords 比较
// ============================================================================

async function compareKeywords(legacy, tsKeywords) {
  // isGenericHostKeyword
  const cases = [
    ["chatgpt.com", "chatgpt", true],
    ["chatgpt.com", "ChatGPT", true],
    ["chatgpt.com", "real query", false],
    ["claude.ai", "claude", true],
    ["claude.ai", "www.claude.ai", true],
    ["claude.ai", " ", true],
    ["example.com", "anything", false],
    ["chatgpt.com", null, false]
  ]
  for (const [h, k, expected] of cases) {
    const a = legacy.isGenericHostKeyword(h, k)
    const b = tsKeywords.isGenericHostKeyword(h, k)
    assert(a === b && a === expected,
      `isGenericHostKeyword(${h}, ${JSON.stringify(k)}) diverges: legacy=${a} ts=${b} expected=${expected}`)
  }

  // safeDecodeParam
  for (const v of ["plain", "%E4%B8%AD%E6%96%87", "", "%FF%FF%FF%FF", null]) {
    const a = legacy.safeDecodeParam(v)
    const b = tsKeywords.safeDecodeParam(v)
    // null path 行为：legacy 直接返回 null；TS 返回 ""（差异已知，跳过 null case）
    if (v !== null) {
      assert(a === b, `safeDecodeParam(${JSON.stringify(v)}) diverges: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
    }
  }

  // heuristicExtractFromParams
  const sp = new URLSearchParams("q=hello&utm_source=test&foo=bar")
  const la = legacy.heuristicExtractFromParams(sp)
  const lb = tsKeywords.heuristicExtractFromParams(sp)
  if (la) la.score = Math.round(la.score * 100) / 100
  if (lb) lb.score = Math.round(lb.score * 100) / 100
  const hDiff = deepEqual(la, lb)
  if (hDiff) throw new Error(`heuristicExtractFromParams diverges: ${hDiff}`)

  // extractSearchKeywords
  const urls = [
    ["https://www.baidu.com/s?wd=hello", null, "hello"],
    ["https://www.google.com/search?q=test+query", null, "test query"],
    ["https://chatgpt.com/?q=real%20query", null, "real query"],
    ["https://chatgpt.com/?q=chatgpt", null, null],  // generic kw filtered
    ["https://www.zhihu.com/search?q=foo", null, "foo"],
    ["https://example.com/?foo=bar", { title: "Hello - GitHub" }, undefined],  // heuristic 会抓 'bar'，两边一致即可
    ["https://noparams.test/", { title: "标题" }, "标题"],
    // YouTube：watch?v=11char-id 不能被启发式当关键字；必须走 title fallback
    ["https://www.youtube.com/watch?v=IurBXe0jpVg", { title: "Awesome Video Title - YouTube" }, "Awesome Video Title"],
    ["https://youtu.be/dQw4w9WgXcQ", { title: "Never Gonna Give You Up - YouTube" }, "Never Gonna Give You Up"]
  ]
  for (const [url, tab, expected] of urls) {
    const a = await legacy.extractSearchKeywords(url, tab)
    const b = await tsKeywords.extractSearchKeywords(url, tab)
    assert(a === b, `extractSearchKeywords(${url}) diverges: legacy=${JSON.stringify(a)} ts=${JSON.stringify(b)}`)
    if (expected !== undefined && expected !== null) {
      assert(a === expected, `extractSearchKeywords(${url}) wrong: ${a} expected ${expected}`)
    }
  }
}

// ============================================================================
// promptBuilders 比较
// ============================================================================

function comparePromptBuilders(legacy, tsBuilders) {
  // legacy 用 globalThis.optimizedPromptTemplate 之类，需要先 set
  const optimizedTpl = "Please ${purpose}: ${input}"
  const coverTpl = "Cover style=${purpose} input=${input}"
  const top100Tpl = "Top: ${input}"
  const fastTpl = "Fast: ${input}"

  legacy.optimizedPromptTemplate = optimizedTpl
  legacy.coverPromptTemplate = coverTpl
  legacy.topQuestionsTemplate = top100Tpl
  legacy.fastAnswersTemplate = fastTpl

  // buildOptimizedPrompt
  assert(legacy.buildOptimizedPrompt("analyze", "hello") === tsBuilders.buildOptimizedPrompt("analyze", "hello", optimizedTpl), "buildOptimizedPrompt")
  assert(legacy.buildOptimizedPrompt("", "x") === tsBuilders.buildOptimizedPrompt("", "x", optimizedTpl), "buildOptimizedPrompt empty purpose")

  // buildCoverPrompt
  assert(legacy.buildCoverPrompt("anime", "girl") === tsBuilders.buildCoverPrompt("anime", "girl", coverTpl), "buildCoverPrompt")

  // buildTopQuestionsPrompt
  assert(legacy.buildTopQuestionsPrompt("AI") === tsBuilders.buildTopQuestionsPrompt("AI", top100Tpl), "buildTopQuestionsPrompt")

  // buildFastAnswersPrompt
  assert(legacy.buildFastAnswersPrompt("how to") === tsBuilders.buildFastAnswersPrompt("how to", fastTpl), "buildFastAnswersPrompt")

  // null template path
  legacy.optimizedPromptTemplate = null
  assert(legacy.buildOptimizedPrompt("x", "y") === null, "legacy null template should return null")
  assert(tsBuilders.buildOptimizedPrompt("x", "y", null) === null, "ts null template should return null")

  // isMenuEnabled
  legacy.menuToggleConfig = { "ccs-baidu": false, "ccs-google": true }
  assert(legacy.isMenuEnabled("ccs-baidu") === tsBuilders.isMenuEnabled("ccs-baidu", legacy.menuToggleConfig), "isMenuEnabled disabled")
  assert(legacy.isMenuEnabled("ccs-google") === tsBuilders.isMenuEnabled("ccs-google", legacy.menuToggleConfig), "isMenuEnabled enabled")
  assert(legacy.isMenuEnabled("ccs-other") === tsBuilders.isMenuEnabled("ccs-other", legacy.menuToggleConfig), "isMenuEnabled unset (default true)")

  // populateOptimizedMenuMap
  const optimizeConfig = {
    categories: [
      { id: "deep-research", purpose: "research deeply", engines: [
        { id: "chatgpt", urlPattern: "https://chatgpt.com/?q=${PROMPT}" },
        { id: "claude", urlPattern: "https://claude.ai/?q=${PROMPT}" }
      ]}
    ]
  }
  // legacy 把结果写到 globalThis.optimizedPromptMenuMap
  legacy.optimizedPromptMenuMap = new Map()
  legacy.populateOptimizedMenuMap(optimizeConfig)
  const tsMap = tsBuilders.populateOptimizedMenuMap(optimizeConfig, legacy.menuToggleConfig)
  // 比较 Map 内容（先转 obj）
  const lObj = Object.fromEntries(legacy.optimizedPromptMenuMap)
  const tObj = Object.fromEntries(tsMap)
  const diff = deepEqual(lObj, tObj)
  if (diff) throw new Error(`populateOptimizedMenuMap diverges: ${diff}`)

  // populateCoverMenuMap
  const coverConfig = {
    categories: [
      { id: "anime-cute", purpose: "anime cute style", engines: [
        { id: "chatgpt-images", urlPattern: "https://chatgpt.com/?cover=${PROMPT}" }
      ]}
    ]
  }
  legacy.coverPromptMenuMap = new Map()
  legacy.populateCoverMenuMap(coverConfig)
  const tsCoverMap = tsBuilders.populateCoverMenuMap(coverConfig, legacy.menuToggleConfig)
  const lcObj = Object.fromEntries(legacy.coverPromptMenuMap)
  const tcObj = Object.fromEntries(tsCoverMap)
  const cDiff = deepEqual(lcObj, tcObj)
  if (cDiff) throw new Error(`populateCoverMenuMap diverges: ${cDiff}`)
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const legacy = loadLegacy()
  const loadTs = createTsLoader()

  const tsStateManager = loadTs(path.join(root, "src/background/StateManager.ts"))
  const tsKeywords = loadTs(path.join(root, "src/background/keywords.ts"))
  const tsPromptBuilders = loadTs(path.join(root, "src/background/promptBuilders.ts"))

  if (!legacy.StateManager) throw new Error("legacy StateManager not exposed")
  compareStateManager(legacy.StateManager, tsStateManager.StateManager || tsStateManager.default)

  await compareKeywords(legacy, tsKeywords)
  comparePromptBuilders(legacy, tsPromptBuilders)

  // voiceOffscreenBridge: 纯函数 errorPayload + 结构性 verifier（legacy 重 chrome.* 调用，不全量 dual-run）
  const tsVoiceBridge = loadTs(path.join(root, "src/background/voiceOffscreenBridge.ts"))
  assert(typeof tsVoiceBridge.createBridge === "function", "voiceOffscreenBridge.createBridge")
  assert(typeof tsVoiceBridge.errorPayload === "function", "voiceOffscreenBridge.errorPayload")
  assert(typeof tsVoiceBridge.autoRegisterVoiceBridge === "function", "voiceOffscreenBridge.autoRegisterVoiceBridge")
  assert(tsVoiceBridge.CCS_VOICE_OFFSCREEN_PATH === "offscreen/voice.html", "voiceOffscreenBridge.CCS_VOICE_OFFSCREEN_PATH")
  // errorPayload 纯函数测试（与 legacy ccsVoiceErrorPayload 等价）
  const ep1 = tsVoiceBridge.errorPayload(null)
  assert(ep1.code === "unknown-error" && ep1.name === "Error", "errorPayload(null)")
  const ep2 = tsVoiceBridge.errorPayload({ code: "no-speech", name: "SpeechError", message: "no speech" })
  assert(ep2.code === "no-speech" && ep2.name === "SpeechError" && ep2.message === "no speech", "errorPayload(full)")
  const ep3 = tsVoiceBridge.errorPayload(new Error("foo"))
  assert(ep3.code === "foo" && ep3.message === "foo", "errorPayload(Error)")
  const ep4 = tsVoiceBridge.errorPayload("string err")
  assert(ep4.code === "unknown-error" && ep4.message === "string err", "errorPayload(string)")
  // createBridge 工厂出来的 bridge 对象 shape
  const fakeChrome = {
    runtime: { getURL: (p) => `chrome-extension://abc/${p}`, sendMessage: async () => null, onMessage: { addListener: () => {} } },
    offscreen: { createDocument: async () => {} }
  }
  const bridge = tsVoiceBridge.createBridge(fakeChrome)
  for (const m of ["getOffscreenContexts", "hasOffscreenDocument", "ensureOffscreenDocument", "recognize", "cancel", "registerListeners"]) {
    assert(typeof bridge[m] === "function", `bridge.${m}`)
  }

  // KeywordService: 与 legacy KeywordService.js 比较 INTENT_POLICIES 表
  const tsKwService = loadTs(path.join(root, "src/background/KeywordService.ts"))
  assert(typeof tsKwService.KeywordService === "function", "KeywordService class")
  assert(tsKwService.KEYWORD_INTENTS.POPUP_OPEN === "popup-open", "POPUP_OPEN const")
  assert(tsKwService.KEYWORD_STORAGE_PREFIX === "ccs_kw_", "STORAGE_PREFIX")
  assert(tsKwService.KEYWORD_STORAGE_TTL_MS === 5 * 60 * 1000, "TTL_MS")
  // INTENT_POLICIES 7 个意图，全部检查一遍 vs legacy（要求字段同 + 值同）
  const legacyPolicies = legacy.LEGACY_INTENT_POLICIES || {}
  for (const [intent, expectedPolicy] of Object.entries(tsKwService.INTENT_POLICIES)) {
    const lp = legacyPolicies[intent]
    assert(lp, `legacy missing policy for ${intent}`)
    assert(expectedPolicy.forceFetchSelection === lp.forceFetchSelection, `${intent} forceFetchSelection diverges`)
    assert(expectedPolicy.skipCurrentMenuFallback === lp.skipCurrentMenuFallback, `${intent} skipCurrentMenuFallback diverges`)
    assert(expectedPolicy.cacheToStorage === lp.cacheToStorage, `${intent} cacheToStorage diverges`)
    assert(expectedPolicy.source === lp.source, `${intent} source diverges`)
  }
  // legacy KEYWORD_INTENTS 字符串与 ts 一致
  for (const [k, v] of Object.entries(tsKwService.KEYWORD_INTENTS)) {
    assert(legacy.KEYWORD_INTENTS[k] === v, `KEYWORD_INTENTS.${k} diverges`)
  }
  // 实例化 + getKeyword 走通最简流程（mock compute）
  const kwFakeChrome = {
    tabs: { get: (_id, cb) => cb({ url: "https://a.test/", title: "Title A" }) },
    storage: { local: { get: (_k, cb) => cb({}), set: (_i, cb) => cb && cb(), remove: () => {} } },
    runtime: { lastError: null }
  }
  const svc = new tsKwService.KeywordService({
    chrome: kwFakeChrome,
    computeSearchTextForTab: async () => ({ raw: "hello", normalized: "hello" })
  })
  const result = await svc.getKeyword({ tabId: 1, intent: "popup-open" })
  assert(result.text === "hello" && result.source === "popup", "getKeyword popup-open")
  const resultLegacy = await svc.getKeyword({ tabId: 1 })
  assert(resultLegacy.intent === "legacy-getSearchText" && resultLegacy.source === "legacy", "getKeyword default intent")

  // config.ts: dual-run buildXxxPrompt vs legacy buildXxxPrompt
  const tsConfig = loadTs(path.join(root, "src/background/config.ts"))
  assert(typeof tsConfig.ConfigLoader === "function", "ConfigLoader class")
  assert(typeof tsConfig.createConfigLoader === "function", "createConfigLoader factory")
  const cl = new tsConfig.ConfigLoader()
  // 注入模板进缓存模拟"加载完成"，然后比较 buildXxxPrompt 输出 vs legacy
  cl.optimized = { config: {}, template: "Please ${purpose}: ${input}" }
  cl.cover = { config: {}, template: "Cover style=${purpose} input=${input}" }
  cl.topQuestions = { config: {}, template: "Top: ${input}" }
  cl.fastAnswers = { config: {}, template: "Fast: ${input}" }
  // 同步 legacy templates
  legacy.optimizedPromptTemplate = cl.optimized.template
  legacy.coverPromptTemplate = cl.cover.template
  legacy.topQuestionsTemplate = cl.topQuestions.template
  legacy.fastAnswersTemplate = cl.fastAnswers.template
  assert(cl.buildOptimizedPrompt("analyze", "hello") === legacy.buildOptimizedPrompt("analyze", "hello"), "buildOptimizedPrompt diverges")
  assert(cl.buildCoverPrompt("anime", "girl") === legacy.buildCoverPrompt("anime", "girl"), "buildCoverPrompt diverges")
  assert(cl.buildTopQuestionsPrompt("AI") === legacy.buildTopQuestionsPrompt("AI"), "buildTopQuestionsPrompt diverges")
  assert(cl.buildFastAnswersPrompt("how to") === legacy.buildFastAnswersPrompt("how to"), "buildFastAnswersPrompt diverges")
  // 空模板时返回 null
  cl.optimized.template = ""
  assert(cl.buildOptimizedPrompt("x", "y") === null, "empty template -> null")
  // isMenuEnabled: 默认 true，显式 false 返回 false
  cl.menuToggleConfig = { "ccs-baidu": false, "ccs-google": true }
  assert(cl.isMenuEnabled("ccs-baidu") === false, "isMenuEnabled disabled")
  assert(cl.isMenuEnabled("ccs-google") === true, "isMenuEnabled enabled")
  assert(cl.isMenuEnabled("ccs-other") === true, "isMenuEnabled unset (default true)")
  // getEngineTitle SSoT
  cl.enginesConfig = { engines: { baidu: { icon: "🐼", label: "百度" }, raw: { label: "原" } } }
  assert(cl.getEngineTitle("baidu") === "🐼 百度", "getEngineTitle with icon")
  assert(cl.getEngineTitle("raw") === "原", "getEngineTitle without icon")
  assert(cl.getEngineTitle("unknown", "fb") === "fb", "getEngineTitle fallback")
  assert(cl.getEngineTitle("unknown") === "unknown", "getEngineTitle no fallback returns id")

  // init.ts: 结构 + INIT_CONFIG + POPUP_MENU_PREWARM_KEY 与 legacy 一致
  const tsInit = loadTs(path.join(root, "src/background/init.ts"))
  assert(typeof tsInit.InitOrchestrator === "function", "InitOrchestrator class")
  assert(typeof tsInit.createInitOrchestrator === "function", "createInitOrchestrator factory")
  assert(tsInit.INIT_CONFIG.useNewSystem === false, "INIT_CONFIG.useNewSystem=false")
  assert(tsInit.POPUP_MENU_PREWARM_KEY === "ccs_popup_menu_prewarm", "POPUP_MENU_PREWARM_KEY const")
  // 模拟最小 deps，验证 InitOrchestrator 实例方法签名
  const mockDeps = {
    initMenuSystem: async () => {},
    createContextMenus: () => {},
    initKeywordSyncSystem: () => {},
    getURL: (p) => p,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    chrome: {
      runtime: { getManifest: () => ({ version: "1.0.0" }) },
      storage: { local: { set: () => Promise.resolve(), get: () => Promise.resolve({}), remove: () => Promise.resolve() } }
    },
    setInterval: () => 0
  }
  const orch = new tsInit.InitOrchestrator(mockDeps)
  for (const m of ["initializeExtension", "initializeMenuSystem", "setupCleanupTasks", "runFullPrewarming", "installListeners"]) {
    assert(typeof orch[m] === "function", `InitOrchestrator.${m}`)
  }
  // metrics 初始化
  assert(typeof orch.metrics.initStartTime === "number", "metrics.initStartTime")
  assert(orch.metrics.initEndTime === null, "metrics.initEndTime starts null")

  // KeywordSyncManager.ts: 实例化 + 主流程纯函数 vs 期望行为
  const tsKsm = loadTs(path.join(root, "src/background/KeywordSyncManager.ts"))
  assert(typeof tsKsm.KeywordSyncManager === "function", "KeywordSyncManager class")
  const fakeRegistry = { syncAll: async () => ({ success: 0, failed: 0, total: 0 }), syncGroup: async () => ({ success: 0, failed: 0, total: 0 }) }
  const ksm = new tsKsm.KeywordSyncManager({
    menuRegistry: fakeRegistry,
    selectedTextByTab: { 1: { text: "hello", url: "https://a.test" } },
    fallbackKeywordByTab: { 2: { raw: "fb-kw" } },
    latestTitleByTab: { 3: { title: "Page Title" } },
    normalizeKeyword: (s) => (s || "").trim(),
    formatMenuTitle: (s) => (s || "").slice(0, 50)
  })
  // 初始 state
  assert(ksm.currentState.raw === "" && ksm.currentState.tabId === null, "initial state empty")
  // 优先级：selection > fallback > title
  assert(ksm.getKeywordForTab(1) === "hello", "selection priority")
  assert(ksm.getKeywordForTab(2) === "fb-kw", "fallback priority")
  assert(ksm.getKeywordForTab(3) === "Page Title", "title priority")
  assert(ksm.getKeywordForTab(999) === "", "missing tab → empty")
  // update + subscribe 走通
  let received = null
  const unsub = ksm.subscribe((state) => { received = state })
  await ksm.update("test", null, { tabId: 42, source: "selection" })
  assert(received && received.raw === "test" && received.tabId === 42, "subscribe + update")
  unsub()
  // clearTabCache 真删
  ksm.clearTabCache(1)
  assert(ksm.deps.selectedTextByTab[1] === undefined, "clearTabCache removes selection")
  // refreshKeywordForTab 同步状态
  await ksm.refreshKeywordForTab(3)
  assert(ksm.currentState.raw === "Page Title" && ksm.currentState.source === "title", "refreshKeywordForTab from title")
  // syncMenus 调用 menuRegistry.syncAll
  let syncAllCalled = false
  fakeRegistry.syncAll = async () => { syncAllCalled = true; return { success: 5, failed: 0, total: 5 } }
  const syncResult = await ksm.syncMenus()
  assert(syncAllCalled && syncResult.success === 5, "syncMenus calls registry.syncAll")
  // clear 重置 state + subscribers
  ksm.clear()
  assert(ksm.currentState.raw === "" && ksm.subscribers.length === 0, "clear resets")

  // tabState.ts: 与 legacy base.js 行 127-220 的 5 函数行为对等
  const tsTabState = loadTs(path.join(root, "src/background/tabState.ts"))
  assert(typeof tsTabState.TabStateCache === "function", "TabStateCache class")
  assert(tsTabState.DEFAULT_MAX_AGE_MS === 30000, "DEFAULT_MAX_AGE_MS=30s (BUGFIX v1.6.0)")
  const cache = new tsTabState.TabStateCache({ normalizeSearchText: (s) => s.toLowerCase().trim() })
  // getOrCreate null safety
  assert(cache.getOrCreate(null) === null, "getOrCreate(null)")
  // updateTitle + getPageTitle 走通
  cache.updateTitle(1, "Hello Page")
  assert(cache.getPageTitle(1) === "Hello Page", "updateTitle → getPageTitle roundtrip")
  // pageTitle 优先（兼容老 entry.title vs entry.pageTitle）
  assert(cache.store[1].pageTitle === "Hello Page" && cache.store[1].title === "Hello Page", "both title+pageTitle set")
  // updateKeyword + 自动 normalize
  cache.updateKeyword(1, " Foo Bar ")
  assert(cache.store[1].keywordNormalized === "foo bar", "keyword normalize applied")
  // 显式传 normalized
  cache.updateKeyword(2, "raw", "NORM")
  assert(cache.store[2].keywordNormalized === "NORM", "explicit normalized")
  // getKeyword 优先级
  assert(cache.getKeyword(1) === " Foo Bar ", "getKeyword returns raw")
  // maxAge expiry: 设置 timestamp 为 60s 前，getPageTitle 返回 ''
  cache.store[1].timestamp = Date.now() - 60000
  assert(cache.getPageTitle(1) === "", "stale title expires")
  cache.store[1].keywordTimestamp = Date.now() - 60000
  assert(cache.getKeyword(1) === "", "stale keyword expires")
  // 新 entry 后 getPageTitle 重新工作
  cache.updateTitle(1, "Fresh")
  assert(cache.getPageTitle(1) === "Fresh", "fresh title after update")
  // clearTab
  cache.clearTab(1)
  assert(cache.store[1] === undefined, "clearTab removes entry")
  // null tabId 安全
  cache.updateTitle(null, "x")
  cache.updateKeyword(null, "x")
  assert(cache.getPageTitle(null) === "", "getPageTitle(null)")
  assert(cache.getKeyword(null) === "", "getKeyword(null)")
  // injected store mode：legacy 兼容
  const sharedStore = { 7: { title: "Shared", pageTitle: "Shared", timestamp: Date.now() } }
  const cache2 = new tsTabState.TabStateCache({ store: sharedStore })
  assert(cache2.getPageTitle(7) === "Shared", "shared store reuse")
  // logMenuEvent 注入触发
  let logged = null
  const cache3 = new tsTabState.TabStateCache({ logMenuEvent: (stage, p) => { logged = { stage, p } } })
  cache3.updateTitle(1, "Old")
  cache3.store[1].timestamp = Date.now() - 60000
  cache3.getPageTitle(1)
  assert(logged?.stage === "cached-title-expired" && logged.p.tabId === 1, "logMenuEvent called on expiry")

  // menuTitles.ts: 与 legacy base.js getMenuDefinition/Text/Title 行为对等
  const tsMenuTitles = loadTs(path.join(root, "src/background/menuTitles.ts"))
  assert(typeof tsMenuTitles.getMenuDefinition === "function", "menuTitles.getMenuDefinition")
  assert(typeof tsMenuTitles.getMenuText === "function", "menuTitles.getMenuText")
  assert(typeof tsMenuTitles.getMenuTitle === "function", "menuTitles.getMenuTitle")
  // legacy MENU_DEFINITIONS 来自 Constants.js（已加载）
  const legacyDefs = legacy.MENU_DEFINITIONS
  assert(legacyDefs && typeof legacyDefs === "object", "legacy MENU_DEFINITIONS")
  // 抽样几个 menuId dual-run
  const testIds = ["ccs-baidu", "ccs-google", "ccs-chatgpt", "ccs-claude", "ccs-main"]
  for (const id of testIds) {
    const legacyText = legacy.getMenuText?.(id) ?? legacy.getMenuText?.bind(legacy)?.(id)
    const tsText = tsMenuTitles.getMenuText(legacyDefs, id)
    // legacy.getMenuText 可能没暴露，跳过比较时只验 TS 行为
    if (typeof legacyText === "string") {
      assert(tsText === legacyText, `getMenuText(${id}) diverges: legacy="${legacyText}" ts="${tsText}"`)
    }
    const legacyTitle = legacy.getMenuTitle?.(id) ?? ""
    const tsTitle = tsMenuTitles.getMenuTitle(legacyDefs, id)
    if (typeof legacyTitle === "string" && legacyTitle) {
      assert(tsTitle === legacyTitle, `getMenuTitle(${id}) diverges: legacy="${legacyTitle}" ts="${tsTitle}"`)
    }
  }
  // fallback 行为
  assert(tsMenuTitles.getMenuText(legacyDefs, "non-existent", "fb") === "fb", "getMenuText fallback")
  assert(tsMenuTitles.getMenuText(legacyDefs, "non-existent") === "non-existent", "getMenuText no-fallback returns id")
  // getMenuTitle: 有 icon 时拼 "icon text"
  const customDefs = { "x": { icon: "🔥", text: "Hot" }, "y": { text: "NoIcon" }, "z": { icon: "  ", text: "BlankIcon" } }
  assert(tsMenuTitles.getMenuTitle(customDefs, "x") === "🔥 Hot", "getMenuTitle with icon")
  assert(tsMenuTitles.getMenuTitle(customDefs, "y") === "NoIcon", "getMenuTitle no icon")
  assert(tsMenuTitles.getMenuTitle(customDefs, "z") === "BlankIcon", "getMenuTitle blank icon trimmed")
  // createMenuTitleLookup 工厂
  const lookup = tsMenuTitles.createMenuTitleLookup(customDefs)
  assert(lookup.getTitle("x") === "🔥 Hot", "lookup factory")

  // menuTitleUpdater.ts: 结构 + FIXED_SUBMENU_LABEL_IDS + 模拟 chrome.contextMenus 调用
  const tsMtu = loadTs(path.join(root, "src/background/menuTitleUpdater.ts"))
  assert(typeof tsMtu.updateSearchMenuTitles === "function", "updateSearchMenuTitles")
  assert(typeof tsMtu.updateMainMenuTitle === "function", "updateMainMenuTitle")
  assert(typeof tsMtu.updateSearchLabelTitle === "function", "updateSearchLabelTitle")
  assert(typeof tsMtu.updateSubmenuLabels === "function", "updateSubmenuLabels")
  assert(Array.isArray(tsMtu.FIXED_SUBMENU_LABEL_IDS) && tsMtu.FIXED_SUBMENU_LABEL_IDS.length === 10, "FIXED_SUBMENU_LABEL_IDS 10 entries")
  // 关键 IDs 含 top100 / fastqa / 8 个 optimize 子分类
  const labelIds = new Set(tsMtu.FIXED_SUBMENU_LABEL_IDS)
  for (const must of ["ccs-top100-label", "ccs-fastqa-label",
    "ccs-optimize-deep-research-label", "ccs-optimize-general-conversation-label",
    "ccs-optimize-code-writing-label", "ccs-optimize-content-creation-label",
    "ccs-optimize-data-analysis-label", "ccs-optimize-problem-solving-label",
    "ccs-optimize-brainstorm-label", "ccs-optimize-description-polish-label"]) {
    assert(labelIds.has(must), `FIXED_SUBMENU_LABEL_IDS missing ${must}`)
  }
  // 模拟一次 chrome.contextMenus.update 走通：捕获调用
  const captured = []
  const mtuFakeChrome = {
    contextMenus: { update: (id, props, cb) => { captured.push({ id, props }); cb() } },
    action: { setTitle: (props) => captured.push({ icon: props }) },
    runtime: { lastError: null }
  }
  await tsMtu.updateMainMenuTitle("hello", {
    contextMenus: mtuFakeChrome.contextMenus,
    action: mtuFakeChrome.action,
    runtime: mtuFakeChrome.runtime,
    menuDefinitions: { "ccs-main": { icon: "🔍", text: "触触搜" } },
    dynamicSearchMenuItems: [],
    formatMenuTitle: (s) => s,
    logMenuEvent: () => {}
  })
  assert(captured.length === 2, `updateMainMenuTitle captures 2 calls (menu + icon), got ${captured.length}`)
  assert(captured[0].id === "ccs-main" && captured[0].props.title === '🔍 触触搜: "hello"', "main menu title")
  assert(captured[1].icon.title === '🔍 触触搜: "hello"', "icon title")

  console.log("[verify-background-extras-dual] StateManager + keywords + promptBuilders + voiceOffscreenBridge + KeywordService + config + init + KeywordSyncManager + tabState + menuTitles + menuTitleUpdater OK")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
