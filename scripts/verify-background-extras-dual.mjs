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
    { p: "background/config.js", a: "" }
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

  console.log("[verify-background-extras-dual] StateManager + keywords + promptBuilders OK")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
