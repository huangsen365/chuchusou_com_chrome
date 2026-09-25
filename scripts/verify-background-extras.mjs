#!/usr/bin/env node
/**
 * SW 后台模块行为回归（全部针对实际进 SW 的代码）：
 *
 * importScripts 进 SW 的 legacy 源（输出对照 scripts/fixtures/golden/background-extras.json，
 * 快照最初录自 legacy 与 TS 移植版逐项 deep-equal 通过时的输出；有意改行为后 UPDATE_GOLDEN=1 刷新）：
 *   StateManager / keywords / config（prompt 构造、菜单开关、getEngineTitle）/
 *   KeywordService 意图策略表 / menuSystem 外壳
 *
 * SW bundle 里的 TS 模块（src/background/*.ts，经 src/background.ts 打包）：
 *   voiceOffscreenBridge / init / tabState / menuTitles / menuTitleUpdater /
 *   menuStateOrchestrator / menuActions / popupMenuStructure / menuDebugInfo /
 *   bootstrap / menuHandlersAttach / menuBuilderHelpers / menuBuilderAttach（选区孪生树）
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import vm from "node:vm"
import { createGolden } from "./lib/golden.mjs"
import { createTsLoader } from "./lib/tsLoader.mjs"

const root = process.cwd()

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
    Proxy, parseInt, isNaN, encodeURIComponent, decodeURIComponent, atob, btoa,
    // config.js loadEnginesConfig 走 fetch(chrome.runtime.getURL(...))：直接读仓库文件
    fetch: async (url) => {
      const abs = path.join(root, String(url).replace("chrome-extension://test/", ""))
      if (!fs.existsSync(abs)) return { ok: false, status: 404, json: async () => null }
      return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(abs, "utf8")) }
    }
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
    { p: "background/StateManager.js", a: "\nglobalThis.StateManager = StateManager;" },
    { p: "background/keywords.js", a: "\nglobalThis.safeDecodeParam = safeDecodeParam;\nglobalThis.heuristicExtractFromParams = heuristicExtractFromParams;" },
    { p: "background/config.js", a: "" },
    // KeywordService 内部依赖 computeSearchTextForTab 这种全局函数，无法干跑；
    // 仅把意图策略表 + ccs_kw_ 缓存契约暴露出来做回归
    { p: "background/KeywordService.js", a: "\nglobalThis.LEGACY_INTENT_POLICIES = INTENT_POLICIES;\nglobalThis.LEGACY_KEYWORD_STORAGE = { prefix: KEYWORD_STORAGE_PREFIX, ttlMs: KEYWORD_STORAGE_TTL_MS };" }
  ]
  for (const { p: rel, a } of files) {
    const abs = path.join(root, rel)
    const src = fs.readFileSync(abs, "utf8") + a
    vm.runInContext(src, ctx, { filename: abs })
  }
  return ctx.globalThis
}

// ============================================================================
// StateManager（legacy background/StateManager.js）
// ============================================================================

function checkStateManager(golden, StateManager) {
  const sm = new StateManager({ autoCleanupInterval: 999999 })
  sm.stopAutoCleanup()
  const zeroTs = (state) => (state ? { ...state, timestamp: 0 } : state)
  const out = {}
  out.initial = sm.getCurrentState()
  sm.setCurrentState({ raw: "test", normalized: "test", display: "test", tabId: 1, url: "https://x.com" })
  out.afterSetCurrentState = zeroTs(sm.getCurrentState())
  sm.setSelection(1, "hello", "https://x.com")
  out.selection = zeroTs(sm.getSelection(1))
  sm.setFallback(2, "raw", "norm", "https://y.com")
  out.fallback = zeroTs(sm.getFallback(2))
  sm.setTitle(3, "Hello - 知乎", "Hello", "https://zhihu.com")
  out.title = zeroTs(sm.getTitle(3))
  out.canPreserveCurrentState = [
    [1, "https://x.com"],          // 同 tab
    [99, "https://x.com/other"],   // 同域
    [99, "https://other.com"]      // 不匹配
  ].map(([tabId, url]) => sm.canPreserveCurrentState(tabId, url))
  const stats = sm.getStats()
  stats.tabStates.tabIds.sort()
  stats.currentState.timestamp = 0
  out.stats = stats
  out.shouldPreserveMenuStateForUrl = ["https://chatgpt.com", "https://x.com", "https://www.claude.ai/abc", "not url", null]
    .map((u) => sm.shouldPreserveMenuStateForUrl(u))
  sm.tabStates.get(1).meta.updatedAt = Date.now() - 10 * 60 * 1000 // 10 分钟前
  out.cleanupExpiredStates = sm.cleanupExpiredStates()
  golden.check("StateManager", out)

  sm.clearAll()
  assert(sm.tabStates.size === 0, "StateManager.clearAll should empty tabStates")
  assert(sm.getCurrentState().raw === "", "StateManager.clearAll should reset currentState")
}

// ============================================================================
// keywords（legacy background/keywords.js）
// ============================================================================

async function checkKeywords(golden, legacy) {
  for (const [host, kw, expected] of [
    ["chatgpt.com", "chatgpt", true],
    ["chatgpt.com", "ChatGPT", true],
    ["chatgpt.com", "real query", false],
    ["claude.ai", "claude", true],
    ["claude.ai", "www.claude.ai", true],
    ["claude.ai", " ", true],
    ["example.com", "anything", false],
    ["chatgpt.com", null, false]
  ]) {
    assert(legacy.isGenericHostKeyword(host, kw) === expected, `isGenericHostKeyword(${host}, ${JSON.stringify(kw)}) should be ${expected}`)
  }

  golden.check("safeDecodeParam", ["plain", "%E4%B8%AD%E6%96%87", "", "%FF%FF%FF%FF", null].map((v) => legacy.safeDecodeParam(v)))

  // heuristicExtractFromParams 选取规则回归
  // 历史 bug：value.length<2 一刀切丢掉 q=d / q=中，噪声参数 src=typed_query 捡漏当选
  const heuristicCases = [
    ["q=hello&utm_source=test&foo=bar", "q", "hello"],
    ["q=d&src=typed_query", "q", "d"],                    // 单字符关键字必须压过噪声参数
    ["q=%E4%B8%AD&src=typed_query", "q", "中"],            // 单汉字同理
    ["p=1&title=hello world", "title", "hello world"],    // 纯数字单字符是分页参数，不是关键字
    ["src=typed_query", null, null]                        // 只剩噪声参数 → 无候选（走 title fallback）
  ]
  const heuristicResults = []
  for (const [qs, expectKey, expectValue] of heuristicCases) {
    const hit = legacy.heuristicExtractFromParams(new URLSearchParams(qs))
    if (hit) hit.score = Math.round(hit.score * 100) / 100
    heuristicResults.push(hit)
    if (expectKey === null) {
      assert(hit === null, `heuristicExtractFromParams(${qs}) 应无候选，实际 ${JSON.stringify(hit)}`)
    } else {
      assert(hit && hit.key === expectKey && hit.value === expectValue,
        `heuristicExtractFromParams(${qs}) 应选 ${expectKey}=${expectValue}，实际 ${JSON.stringify(hit)}`)
    }
  }
  golden.check("heuristicExtractFromParams", heuristicResults)

  const urls = [
    ["https://www.baidu.com/s?wd=hello", null, "hello"],
    ["https://www.google.com/search?q=test+query", null, "test query"],
    ["https://chatgpt.com/?q=real%20query", null, "real query"],
    ["https://chatgpt.com/?q=chatgpt", null, null],  // 站名当关键字：这一层不过滤，结果由快照锁定
    ["https://www.zhihu.com/search?q=foo", null, "foo"],
    ["https://example.com/?foo=bar", { title: "Hello - GitHub" }, undefined],  // 启发式会抓 'bar'，由快照锁定
    ["https://noparams.test/", { title: "标题" }, "标题"],
    // YouTube：watch?v=11char-id 不能被启发式当关键字；必须走 title fallback
    ["https://www.youtube.com/watch?v=IurBXe0jpVg", { title: "Awesome Video Title - YouTube" }, "Awesome Video Title"],
    ["https://youtu.be/dQw4w9WgXcQ", { title: "Never Gonna Give You Up - YouTube" }, "Never Gonna Give You Up"],
    // X (Twitter)：站点规则必须命中 q，且不能被 ?src=typed_query 噪声参数盖掉
    ["https://x.com/search?q=d&src=typed_query", { title: "d - 在 X 上搜索" }, "d"],
    ["https://x.com/search?q=%E4%B8%AD&src=typed_query", null, "中"],
    ["https://twitter.com/search?q=hello+world&src=typed_query", null, "hello world"],
    // X 规则必须后缀匹配：netflix.com 含 "x.com" 子串，误命中会把 URL 值当关键字返回
    // （正确路径：非 X → 启发式 → q 是 URL 被判负分 → 无候选 → title fallback）
    ["https://www.netflix.com/watch?q=https%3A%2F%2Fexample.com", { title: "网飞标题" }, "网飞标题"],
    // X 分享链接 ?s=20：分享码不是关键字，必须跳过启发式走 title（顺带剥掉 " / X" 尾巴）
    ["https://x.com/someone/status/1234567890?s=20",
      { title: "某人 在 X 上：「今天天气不错」 / X" }, "某人 在 X 上：「今天天气不错」"],
    // 跳过名单同样必须后缀匹配：youtube.com.evil.test 不是 YouTube，不该被跳过
    ["https://youtube.com.evil.test/?q=hello", { title: "钓鱼站标题" }, "hello"]
  ]
  const extracted = []
  for (const [url, tab, expected] of urls) {
    const got = await legacy.extractSearchKeywords(url, tab)
    extracted.push(got)
    if (expected !== undefined && expected !== null) {
      assert(got === expected, `extractSearchKeywords(${url}) wrong: ${got} expected ${expected}`)
    }
  }
  golden.check("extractSearchKeywords", extracted)
}

// ============================================================================
// prompt 构造 + 菜单开关 + 引擎标题（legacy background/config.js）
// ============================================================================

async function checkConfig(golden, legacy) {
  legacy.optimizedPromptTemplate = "Please ${purpose}: ${input}"
  legacy.coverPromptTemplate = "Cover style=${purpose} input=${input}"
  legacy.topQuestionsTemplate = "Top: ${input}"
  legacy.fastAnswersTemplate = "Fast: ${input}; language=${outputLanguage}"

  golden.check("buildPrompts", {
    optimized: legacy.buildOptimizedPrompt("analyze", "hello"),
    optimizedEmptyPurpose: legacy.buildOptimizedPrompt("", "x"),
    cover: legacy.buildCoverPrompt("anime", "girl"),
    topQuestions: legacy.buildTopQuestionsPrompt("AI"),
    fastAnswers: legacy.buildFastAnswersPrompt("how to"),
    fastAnswersJapanese: legacy.buildFastAnswersPrompt("how to", "日本語")
  })
  assert(legacy.buildFastAnswersPrompt("how to").includes("language=简体中文"), "buildFastAnswersPrompt must default to Simplified Chinese")
  legacy.optimizedPromptTemplate = null
  assert(legacy.buildOptimizedPrompt("x", "y") === null, "buildOptimizedPrompt with no template should return null")

  legacy.menuToggleConfig = { "ccs-baidu": false, "ccs-google": true }
  assert(legacy.isMenuEnabled("ccs-baidu") === false, "isMenuEnabled disabled")
  assert(legacy.isMenuEnabled("ccs-google") === true, "isMenuEnabled enabled")
  assert(legacy.isMenuEnabled("ccs-other") === true, "isMenuEnabled unset defaults to true")

  legacy.optimizedPromptMenuMap = new Map()
  legacy.populateOptimizedMenuMap({
    categories: [
      { id: "deep-research", purpose: "research deeply", engines: [
        { id: "chatgpt", urlPattern: "https://chatgpt.com/?q=${PROMPT}" },
        { id: "claude", urlPattern: "https://claude.ai/?q=${PROMPT}" }
      ] }
    ]
  })
  golden.check("populateOptimizedMenuMap", legacy.optimizedPromptMenuMap)

  legacy.coverPromptMenuMap = new Map()
  legacy.populateCoverMenuMap({
    categories: [
      { id: "anime-cute", purpose: "anime cute style", engines: [
        { id: "chatgpt-images", urlPattern: "https://chatgpt.com/?cover=${PROMPT}" }
      ] }
    ]
  })
  golden.check("populateCoverMenuMap", legacy.coverPromptMenuMap)

  // getEngineTitle SSoT：从真实 config/engines.json 读 icon + label
  const engines = JSON.parse(fs.readFileSync(path.join(root, "config/engines.json"), "utf8")).engines
  assert(await legacy.loadEnginesConfig(), "loadEnginesConfig should load config/engines.json")
  for (const [id, engine] of Object.entries(engines)) {
    const label = engine.label || id
    const expected = engine.icon ? `${engine.icon} ${label}` : label
    assert(legacy.getEngineTitle(id) === expected, `getEngineTitle(${id}) should be "${expected}", got "${legacy.getEngineTitle(id)}"`)
  }
  assert(legacy.getEngineTitle("unknown-engine", "fb") === "fb", "getEngineTitle fallback label")
  assert(legacy.getEngineTitle("unknown-engine") === "unknown-engine", "getEngineTitle without fallback returns the id")
}

// ============================================================================
// KeywordService 意图策略表（legacy background/KeywordService.js）
// ============================================================================

function checkKeywordService(golden, legacy) {
  assert(typeof legacy.KeywordService === "function", "KeywordService class must be exposed")
  assert(legacy.KEYWORD_INTENTS.POPUP_OPEN === "popup-open", "KEYWORD_INTENTS.POPUP_OPEN")
  // ccs_kw_ 前缀 + 5 分钟 TTL 是 popup / sidepanel / content 共用的缓存契约
  assert(legacy.LEGACY_KEYWORD_STORAGE.prefix === "ccs_kw_", "KEYWORD_STORAGE_PREFIX")
  assert(legacy.LEGACY_KEYWORD_STORAGE.ttlMs === 5 * 60 * 1000, "KEYWORD_STORAGE_TTL_MS")
  golden.check("KEYWORD_INTENTS", legacy.KEYWORD_INTENTS)
  golden.check("INTENT_POLICIES", legacy.LEGACY_INTENT_POLICIES)
}

// ============================================================================
// MenuSystem 外壳（legacy background/menuSystem.js）：API 键集合 + 未 init 行为
// ============================================================================

function checkMenuSystem(golden) {
  const silentConsole = { log: () => {}, warn: () => {}, error: () => {} }
  const msGlobals = { console: silentConsole }
  const msCtx = { globalThis: msGlobals, ...msGlobals }
  msCtx.self = msCtx.globalThis
  vm.createContext(msCtx)
  const msAbs = path.join(root, "background/menuSystem.js")
  vm.runInContext(fs.readFileSync(msAbs, "utf8"), msCtx, { filename: msAbs })
  const menuSystem = msCtx.globalThis.MenuSystem
  assert(menuSystem && typeof menuSystem.init === "function", "MenuSystem 未暴露到 globalThis")

  golden.check("MenuSystem.keys", Object.keys(menuSystem).sort())
  // 未 init：maxDisplayLength 默认 20
  golden.check("MenuSystem.formatMenuTitle",
    ["", "短标题", "x".repeat(19), "y".repeat(20), "z".repeat(21), "周杰伦".repeat(10)].map((input) => menuSystem.formatMenuTitle(input)))
  assert(menuSystem.buildMenuUrl("ccs-baidu", {}) === null, "buildMenuUrl 未 init 应返回 null")
  for (const getter of ["getStateManager", "getURLBuilder", "getSystemConfig"]) {
    assert(menuSystem[getter]() === null, `${getter} 未 init 应返回 null`)
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const golden = createGolden("background-extras")
  const legacy = loadLegacy()
  const loadTs = createTsLoader()

  assert(legacy.StateManager, "legacy StateManager not exposed")
  checkStateManager(golden, legacy.StateManager)
  await checkKeywords(golden, legacy)
  await checkConfig(golden, legacy)
  checkKeywordService(golden, legacy)
  checkMenuSystem(golden)
  golden.finish()

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


  // init.ts: 结构 + INIT_CONFIG 与 legacy 一致（v1.6.19 起 POPUP_MENU_PREWARM_KEY 已删）
  const tsInit = loadTs(path.join(root, "src/background/init.ts"))
  assert(typeof tsInit.InitOrchestrator === "function", "InitOrchestrator class")
  assert(typeof tsInit.createInitOrchestrator === "function", "createInitOrchestrator factory")
  assert(tsInit.INIT_CONFIG.useNewSystem === false, "INIT_CONFIG.useNewSystem=false")
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

  // menuStateOrchestrator.ts: 端到端 mock chrome.* 跑通 setMenuState
  const tsMso = loadTs(path.join(root, "src/background/menuStateOrchestrator.ts"))
  assert(typeof tsMso.setMenuState === "function", "setMenuState exists")
  assert(typeof tsMso.applyMenuTitle === "function", "applyMenuTitle exists")

  // 端到端：模拟一次完整状态更新，验证状态写入 + tabState 更新 + chrome.* 调用
  const msoCalls = []
  const sharedState = { raw: "", normalized: "", display: "", tabId: null, url: "" }
  const tabKeywords = {}
  const msoFakeChrome = {
    contextMenus: {
      update: (id, props, cb) => { msoCalls.push({ k: "menu-update", id, title: props.title }); cb() },
      refresh: () => { msoCalls.push({ k: "menu-refresh" }) }
    },
    tabs: { query: async () => [{ id: 42 }] },
    runtime: {
      sendMessage: async (msg) => { msoCalls.push({ k: "sendMessage", msg }) },
      lastError: null
    },
    action: { setTitle: (props) => msoCalls.push({ k: "icon-title", title: props.title }) }
  }
  const logs = []
  await tsMso.setMenuState("hello world", "hello world", { tabId: 42, url: "https://x.com" }, {
    currentMenuState: sharedState,
    formatMenuTitle: (s) => s.length > 20 ? s.substring(0, 20) + "..." : s,
    tabs: msoFakeChrome.tabs,
    contextMenus: msoFakeChrome.contextMenus,
    contextMenusRefresh: msoFakeChrome.contextMenus,
    runtimeSendMessage: msoFakeChrome.runtime,
    action: msoFakeChrome.action,
    runtime: msoFakeChrome.runtime,
    menuDefinitions: {
      "ccs-main": { icon: "🔍", text: "触触搜" },
      "ccs-search-label": { text: "搜索引擎" },
      "ccs-top100-label": { text: "百问" }
    },
    dynamicSearchMenuItems: [],
    updateLatestTabKeyword: (tabId, keyword, normalized) => { tabKeywords[tabId] = { keyword, normalized } },
    keywordSyncManager: null,
    logMenuEvent: (stage, payload) => logs.push({ stage, payload }),
    refreshDelayMs: 1,
    setTimeoutFn: (cb) => cb()
  })
  assert(sharedState.raw === "hello world", "currentMenuState.raw written")
  assert(sharedState.normalized === "hello world", "currentMenuState.normalized written")
  assert(sharedState.display === "hello world", "currentMenuState.display written")
  assert(sharedState.tabId === 42, "currentMenuState.tabId written")
  assert(sharedState.url === "https://x.com", "currentMenuState.url written")
  assert(tabKeywords[42]?.keyword === "hello world", "updateLatestTabKeyword called")
  const stages = logs.map((l) => l.stage)
  assert(stages.includes("state-update"), "state-update log")
  assert(stages.includes("keyword-sync-old-system-forced"), "keyword-sync-old-system-forced log")
  assert(stages.includes("context-menu-refreshed-delayed"), "context-menu-refreshed-delayed log")
  assert(msoCalls.some((c) => c.k === "menu-update" && c.id === "ccs-main"), "ccs-main updated")
  assert(msoCalls.some((c) => c.k === "menu-refresh"), "chrome.contextMenus.refresh called")
  assert(msoCalls.some((c) => c.k === "sendMessage" && c.msg.action === "keywordUpdated"), "keywordUpdated broadcast")
  assert(msoCalls.some((c) => c.k === "icon-title"), "chrome.action.setTitle called")

  // Edge: inactive tab → reject, state 不变
  const sharedState2 = { raw: "initial", normalized: "initial", display: "initial", tabId: 99, url: "" }
  const calls2 = []
  await tsMso.setMenuState("rejected", "rejected", { tabId: 1, url: "" }, {
    currentMenuState: sharedState2,
    formatMenuTitle: (s) => s,
    tabs: { query: async () => [{ id: 999 }] },
    contextMenus: { update: (id, p, cb) => cb() },
    contextMenusRefresh: { refresh: () => calls2.push("refresh") },
    runtimeSendMessage: { sendMessage: async () => calls2.push("send") },
    action: {},
    runtime: { lastError: null },
    menuDefinitions: { "ccs-main": { icon: "🔍", text: "触触搜" } },
    dynamicSearchMenuItems: [],
    logMenuEvent: () => {},
    keywordSyncManager: null,
    refreshDelayMs: 1,
    setTimeoutFn: (cb) => cb()
  })
  assert(sharedState2.raw === "initial", "inactive-tab reject keeps state.raw unchanged")
  assert(calls2.length === 0, "inactive-tab reject 不触发 refresh/sendMessage")

  // Edge: 标题单调性守卫 —— 同 tab + 同/未知 URL 时，空写入不得抹掉非空标题
  // （L6 取证：新开标签多写入者竞态，空结果若最后落地标题直到切 Tab 才恢复）
  {
    const guardState = { raw: "页面关键词", normalized: "页面关键词", display: "页面关键词", tabId: 7, url: "https://same.example/" }
    const guardLogs = []
    const guardDeps = {
      currentMenuState: guardState,
      formatMenuTitle: (s) => s,
      tabs: { query: async () => [{ id: 7 }] },
      contextMenus: { update: (id, p, cb) => cb() },
      contextMenusRefresh: { refresh: () => {} },
      runtimeSendMessage: { sendMessage: async () => {} },
      action: {},
      runtime: { lastError: null },
      menuDefinitions: { "ccs-main": { icon: "🔍", text: "触触搜" } },
      dynamicSearchMenuItems: [],
      logMenuEvent: (stage) => guardLogs.push(stage),
      keywordSyncManager: null,
      refreshDelayMs: 1,
      setTimeoutFn: (cb) => cb()
    }
    // 1) 同 tab + 同 url 的空写入 → 拦截
    await tsMso.setMenuState("", "", { tabId: 7, url: "https://same.example/" }, guardDeps)
    assert(guardState.raw === "页面关键词", "wipe-guard: 空写入不得覆盖非空标题")
    assert(guardLogs.includes("menu-title-wipe-suppressed"), "wipe-guard: 必须留下取证日志")
    // 2) 同 tab + 缺 url 的空写入 → 同样拦截（来路不明的清空一律视为竞态）
    await tsMso.setMenuState("", "", { tabId: 7 }, guardDeps)
    assert(guardState.raw === "页面关键词", "wipe-guard: 缺 url 的空写入同样拦截")
    // 3) URL 已变（导航换页）的空写入 → 放行（合法清空）
    await tsMso.setMenuState("", "", { tabId: 7, url: "https://other.example/" }, guardDeps)
    assert(guardState.raw === "", "wipe-guard: URL 变化的清空必须放行")
    // 4) tab 已变的空写入 → 放行
    guardState.raw = "再填一个"; guardState.tabId = 7
    await tsMso.setMenuState("", "", { tabId: 8, url: "" }, guardDeps)
    assert(guardState.raw === "", "wipe-guard: tabId 变化的清空必须放行")
  }

  // menuActions.ts: refreshMenuTitle + refreshContextMenu + copyTextInTab
  const tsMa = loadTs(path.join(root, "src/background/menuActions.ts"))
  assert(typeof tsMa.refreshMenuTitle === "function", "refreshMenuTitle exists")
  assert(typeof tsMa.refreshContextMenu === "function", "refreshContextMenu exists")
  assert(typeof tsMa.copyTextInTab === "function", "copyTextInTab exists")

  // refreshContextMenu: 触发 refresh + log
  let refreshCalled = 0
  const refreshLogs = []
  await tsMa.refreshContextMenu({
    contextMenus: { refresh: () => refreshCalled++ },
    logMenuEvent: (stage, payload) => refreshLogs.push({ stage, payload })
  })
  assert(refreshCalled === 1, "refresh called once")
  assert(refreshLogs.length === 1 && refreshLogs[0].stage === "context-menu-refreshed", "refresh log emitted")

  // copyTextInTab: 路径 1 成功 (sendMessage)
  let smCount = 0
  const r1 = await tsMa.copyTextInTab({ id: 7 }, "hi", {
    tabs: { sendMessage: async () => { smCount++; return undefined } },
    scripting: { executeScript: async () => { throw new Error("should not call") } }
  })
  assert(r1 === true && smCount === 1, "copyTextInTab path 1 (sendMessage) success")

  // copyTextInTab: sendMessage 失败 → fallback executeScript
  let exCount = 0
  let dbgCount = 0
  const r2 = await tsMa.copyTextInTab({ id: 8 }, "fallback", {
    tabs: { sendMessage: async () => { throw new Error("no content script") } },
    scripting: { executeScript: async () => { exCount++ } },
    onDebug: () => { dbgCount++ }
  })
  assert(r2 === true && exCount === 1 && dbgCount === 1, "copyTextInTab path 2 (executeScript fallback) success")

  // copyTextInTab: 两路都失败 → false
  const r3 = await tsMa.copyTextInTab({ id: 9 }, "none", {
    tabs: { sendMessage: async () => { throw new Error("x") } },
    scripting: { executeScript: async () => { throw new Error("y") } },
    onDebug: () => {}
  })
  assert(r3 === false, "copyTextInTab both paths fail → false")

  // copyTextInTab: 空参数防御
  assert((await tsMa.copyTextInTab(null, "x", {})) === false, "copy null tab → false")
  assert((await tsMa.copyTextInTab({ id: 1 }, "", {})) === false, "copy empty text → false")

  // refreshMenuTitle: 触发 computeSearchTextForTab → setMenuState
  let csCalled = 0
  const refreshState = { raw: "", normalized: "", display: "", tabId: null, url: "" }
  const refreshLogs2 = []
  await tsMa.refreshMenuTitle({ id: 5, url: "https://t.test", title: "T" }, "selected", {
    computeSearchTextForTab: async (input) => {
      csCalled++
      assert(input.tabId === 5 && input.selectionText === "selected", "compute called with right input")
      return { raw: "selected", normalized: "selected" }
    },
    setMenuStateDeps: {
      currentMenuState: refreshState,
      formatMenuTitle: (s) => s,
      tabs: { query: async () => [{ id: 5 }] },
      contextMenus: { update: (id, p, cb) => cb() },
      contextMenusRefresh: { refresh: () => {} },
      runtimeSendMessage: { sendMessage: async () => {} },
      action: {},
      runtime: { lastError: null },
      menuDefinitions: { "ccs-main": { icon: "🔍", text: "触触搜" } },
      dynamicSearchMenuItems: [],
      logMenuEvent: (stage, payload) => refreshLogs2.push({ stage, payload }),
      keywordSyncManager: null,
      refreshDelayMs: 1,
      setTimeoutFn: (cb) => cb()
    }
  })
  // refreshMenuTitle 内部 fire-and-forget，需要等待 microtask 让 setMenuState 完成
  await new Promise((r) => setTimeout(r, 50))
  assert(csCalled === 1, "computeSearchTextForTab called once")
  assert(refreshState.raw === "selected", "refreshMenuTitle propagates to setMenuState")

  // popupMenuStructure.ts: 6-loader 并行 + 落 CCSMenuStructureBuilder.build
  const tsPms = loadTs(path.join(root, "src/background/popupMenuStructure.ts"))
  assert(typeof tsPms.getPopupMenuStructure === "function", "getPopupMenuStructure exists")

  // 模拟 6 个 loader，验证并发调用 + 拼参数正确
  const loaderCalls = []
  const ms = await tsPms.getPopupMenuStructure({
    loaders: {
      loadUnifiedMenuConfig: async () => { loaderCalls.push("unified"); return { groups: [] } },
      loadTopQuestionsConfig: async () => { loaderCalls.push("top100"); return null },
      loadFastAnswersConfig: async () => { loaderCalls.push("fastqa"); return null },
      loadOptimizedPromptConfig: async () => { loaderCalls.push("optimize"); return null },
      loadCoverPromptConfig: async () => { loaderCalls.push("cover"); return null },
      loadEnginesConfig: async () => { loaderCalls.push("engines"); return { engines: {} } }
    }
  })
  assert(loaderCalls.length === 6, `6 loaders called, got ${loaderCalls.length}`)
  assert(ms && typeof ms === "object" && Array.isArray(ms.groups), "builder returns MenuStructure with groups[]")

  // safeLoad: loader 抛错时不挂，返回 null 兜底
  const ms2 = await tsPms.getPopupMenuStructure({
    loaders: {
      loadUnifiedMenuConfig: async () => { throw new Error("network down") },
      loadTopQuestionsConfig: async () => null,
      loadFastAnswersConfig: async () => null,
      loadOptimizedPromptConfig: async () => null,
      loadCoverPromptConfig: async () => null,
      loadEnginesConfig: async () => null
    }
  })
  assert(ms2 && Array.isArray(ms2.groups), "errored loader 兜底返回 null，builder 仍返回 valid structure")

  // menuDebugInfo.ts: 5 section + chrome.tabs.get mock
  const tsMdi = loadTs(path.join(root, "src/background/menuDebugInfo.ts"))
  assert(typeof tsMdi.getMenuDebugInfo === "function", "getMenuDebugInfo exists")

  const debugInfo = await tsMdi.getMenuDebugInfo(42, {
    currentMenuState: { raw: "r", normalized: "n", display: "d", tabId: 42, url: "https://t.test" },
    selectedTextByTab: { 42: "selected" },
    fallbackKeywordByTab: { 42: "fb" },
    latestTitleByTab: { 42: { title: "T" } },
    menuRegistry: {
      getStats: () => ({ total: 5 }),
      getAllMenuIds: () => ["ccs-main", "ccs-baidu"],
      get: (id) => id === "ccs-main"
        ? { title: "触触搜", icon: "🔍", titleTemplate: "${baseTitle}", syncGroup: "main", autoSync: true, parentId: null }
        : { title: "百度" }
    },
    keywordSyncManager: {
      getState: () => ({ keyword: "n" }),
      getStats: () => ({ syncs: 10 })
    },
    tabs: { get: async (id) => ({ url: `https://tab${id}.test`, title: `Tab ${id}` }) }
  })

  // 必备字段
  assert(typeof debugInfo.timestamp === "string", "timestamp")
  assert(typeof debugInfo.generatedAt === "number", "generatedAt")
  assert(debugInfo.activeTab.tabId === 42, "activeTab.tabId")
  assert(debugInfo.activeTab.url === "https://tab42.test", "activeTab.url via chrome.tabs.get")
  assert(debugInfo.activeTab.title === "Tab 42", "activeTab.title via chrome.tabs.get")
  assert(debugInfo.currentMenuState.raw === "r", "currentMenuState.raw")
  assert(debugInfo.globalCaches.selectedTextByTab[42] === "selected", "selectedTextByTab copied")
  assert(debugInfo.globalCaches.fallbackKeywordByTab[42] === "fb", "fallbackKeywordByTab copied")
  assert(debugInfo.globalCaches.latestTitleByTab[42].title === "T", "latestTitleByTab copied")
  assert(debugInfo.menuRegistry.available === true, "menuRegistry available")
  assert(debugInfo.menuRegistry.stats.total === 5, "menuRegistry.stats")
  assert(debugInfo.menuRegistry.registeredMenus["ccs-main"].title === "触触搜", "registeredMenus filled")
  assert(debugInfo.keywordSyncManager.available === true, "keywordSyncManager available")
  assert(debugInfo.keywordSyncManager.stats.syncs === 10, "keywordSyncManager.stats")
  assert(Array.isArray(debugInfo.dataFlow.steps) && debugInfo.dataFlow.steps.length === 11, "dataFlow 11 steps")

  // Edge: tab.get 抛错 → error 落字段
  const dbg2 = await tsMdi.getMenuDebugInfo(99, {
    currentMenuState: { raw: "", normalized: "", display: "", tabId: null, url: "" },
    tabs: { get: async () => { throw new Error("tab not found") } }
  })
  assert(dbg2.activeTab.error === "tab not found", "tab.get error captured")
  assert(dbg2.menuRegistry.available === false, "menuRegistry available=false when undefined")

  // bootstrap.ts: initKeywordSyncSystem + ensureMenuIconSupportLoaded
  const tsBoot = loadTs(path.join(root, "src/background/bootstrap.ts"))
  assert(typeof tsBoot.initKeywordSyncSystem === "function", "initKeywordSyncSystem exists")
  assert(typeof tsBoot.ensureMenuIconSupportLoaded === "function", "ensureMenuIconSupportLoaded exists")

  // initKeywordSyncSystem: 缺 menuRegistry → no-menu-registry
  const boot1 = tsBoot.initKeywordSyncSystem({ log: () => {}, warn: () => {} })
  assert(boot1.created === false && boot1.error === "no-menu-registry", "no menuRegistry returns no-menu-registry")

  // initKeywordSyncSystem: 缺 KeywordSyncManagerClass → no-ctor
  const boot2 = tsBoot.initKeywordSyncSystem({
    menuRegistry: { getStats: () => ({ total: 3 }) },
    log: () => {}, warn: () => {}
  })
  assert(boot2.created === false && boot2.error === "no-ctor", "no class returns no-ctor")

  // initKeywordSyncSystem: 完整路径 → created=true
  let ctorCalled = 0
  class FakeKSM {
    constructor(reg) { ctorCalled++; this.reg = reg }
    getStats() { return { managed: 5 } }
  }
  const boot3 = tsBoot.initKeywordSyncSystem({
    menuRegistry: { getStats: () => ({ total: 3 }) },
    KeywordSyncManagerClass: FakeKSM,
    log: () => {}, warn: () => {}
  })
  assert(boot3.created === true && ctorCalled === 1, "new instance created")
  assert(boot3.instance instanceof FakeKSM, "instance is FakeKSM")

  // initKeywordSyncSystem: existingInstance → 不重复构造
  const existing = new FakeKSM({ getStats: () => ({}) })
  ctorCalled = 0
  const boot4 = tsBoot.initKeywordSyncSystem({
    menuRegistry: { getStats: () => ({}) },
    KeywordSyncManagerClass: FakeKSM,
    existingInstance: existing,
    log: () => {}, warn: () => {}
  })
  assert(boot4.created === false && boot4.instance === existing && ctorCalled === 0, "existing instance reused")

  // ensureMenuIconSupportLoaded: 首次调 → storage.get 跑一次 → loaded=true
  const state = tsBoot.createMenuIconSupportState()
  let storageCalls = 0
  let debugSet = null
  const bootLogs = []
  await tsBoot.ensureMenuIconSupportLoaded({
    state,
    storage: {
      get: (keys, cb) => {
        storageCalls++
        cb({ ccs_debug: true, ccs_menu_icon_support: false })
      }
    },
    storageKey: "ccs_menu_icon_support",
    setDebug: (v) => { debugSet = v },
    logMenuEvent: (stage, payload) => bootLogs.push({ stage, payload })
  })
  assert(state.loaded === true, "state.loaded after first call")
  assert(state.supported === false, "supported persisted as false")
  assert(debugSet === true, "BG_DEBUG set from storage")
  assert(bootLogs[0]?.stage === "icon-skip", "icon-skip logged")
  assert(storageCalls === 1, "storage.get called once")

  // ensureMenuIconSupportLoaded: 再次调 → 直接 resolve，不再访问 storage
  await tsBoot.ensureMenuIconSupportLoaded({
    state,
    storage: { get: () => { storageCalls++ } },
    storageKey: "ccs_menu_icon_support"
  })
  assert(storageCalls === 1, "second call skips storage (idempotent)")

  // ensureMenuIconSupportLoaded: 并发调 → 同一个 Promise
  const state2 = tsBoot.createMenuIconSupportState()
  let concurrentCalls = 0
  const storage2 = {
    get: (keys, cb) => {
      concurrentCalls++
      setTimeout(() => cb({}), 5)
    }
  }
  const p1 = tsBoot.ensureMenuIconSupportLoaded({ state: state2, storage: storage2, storageKey: "x" })
  const p2 = tsBoot.ensureMenuIconSupportLoaded({ state: state2, storage: storage2, storageKey: "x" })
  await Promise.all([p1, p2])
  assert(concurrentCalls === 1, "concurrent calls dedupe to single storage.get")


  // menuHandlersAttach.ts: right-click click path hydrates stale/partial tab snapshots
  const tsMha = loadTs(path.join(root, "src/background/menuHandlersAttach.ts"))
  assert(typeof tsMha.hydrateContextMenuTab === "function", "hydrateContextMenuTab exists")
  const hydrateLogs = []
  const hydratedTab = await tsMha.hydrateContextMenuTab(
    { id: 77, title: "", url: "" },
    {
      chrome: { tabs: { get: async (tabId) => ({ id: tabId, url: "https://example.com/page", title: "Hydrated Page Title" }) } },
      logMenuEvent: (stage, payload) => hydrateLogs.push({ stage, payload })
    }
  )
  assert(hydratedTab.url === "https://example.com/page", "hydrateContextMenuTab fills missing url")
  assert(hydratedTab.title === "Hydrated Page Title", "hydrateContextMenuTab fills missing title")
  const pendingHydrated = await tsMha.hydrateContextMenuTab(
    { id: 78, url: "", title: "" },
    { chrome: { tabs: { get: async () => ({ id: 78, pendingUrl: "https://pending.test/", title: "Pending Title" }) } } }
  )
  assert(pendingHydrated.url === "https://pending.test/", "hydrateContextMenuTab uses pendingUrl fallback")
  const failedHydrate = await tsMha.hydrateContextMenuTab(
    { id: 79, url: "https://old.test/", title: "Old" },
    {
      chrome: { tabs: { get: async () => { throw new Error("tabs.get failed") } } },
      logMenuEvent: (stage, payload) => hydrateLogs.push({ stage, payload })
    }
  )
  assert(failedHydrate.url === "https://old.test/" && failedHydrate.title === "Old", "hydrateContextMenuTab preserves original on failure")
  assert(hydrateLogs.some((l) => l.stage === "context-click-tab-hydrate-failed"), "hydrate failure logged")

  // menuBuilderHelpers.ts: extractErrorMessage / createMenuItem / removeAllContextMenus / isStaleBuild
  const tsMbh = loadTs(path.join(root, "src/background/menuBuilderHelpers.ts"))
  // extractErrorMessage
  assert(tsMbh.extractErrorMessage(null) === "", "null → ''")
  assert(tsMbh.extractErrorMessage("oops") === "oops", "string passthrough")
  assert(tsMbh.extractErrorMessage(new Error("boom")) === "boom", "Error.message")
  assert(tsMbh.extractErrorMessage({ message: "msg" }) === "msg", "{message}")
  assert(tsMbh.extractErrorMessage({ a: 1 }) === '{"a":1}', "JSON fallback")
  // MENU_CONTEXTS_DEFAULT
  assert(Array.isArray(tsMbh.MENU_CONTEXTS_DEFAULT) && tsMbh.MENU_CONTEXTS_DEFAULT.length === 2, "MENU_CONTEXTS_DEFAULT 2 items")
  // isStaleBuild
  assert(tsMbh.isStaleBuild(1, 2) === true, "stale build 1 vs 2")
  assert(tsMbh.isStaleBuild(3, 3) === false, "same build not stale")

  // createMenuItem 成功路径
  const okResult = await tsMbh.createMenuItem({ id: "test-id" }, {}, {
    contextMenus: { create: (opts, cb) => cb() },
    runtime: { lastError: null }
  })
  assert(okResult.ok === true, "createMenuItem ok")

  // createMenuItem 失败路径 + logMenuEvent 钩子
  const errLogs = []
  const errResult = await tsMbh.createMenuItem({ id: "bad-id" }, {
    failureLogStage: "create-failed",
    logMenuEvent: (stage, payload) => errLogs.push({ stage, payload })
  }, {
    contextMenus: { create: (opts, cb) => cb() },
    runtime: { lastError: { message: "duplicate id" } }
  })
  assert(errResult.ok === false, "createMenuItem failure")
  assert(errLogs[0]?.stage === "create-failed" && errLogs[0].payload.id === "bad-id", "failure logged with id")

  // createMenuItem onSuccess/onError 回调
  let successOpts = null
  await tsMbh.createMenuItem({ id: "cb-test", title: "T" }, {
    onSuccess: (o) => { successOpts = o }
  }, {
    contextMenus: { create: (opts, cb) => cb() },
    runtime: { lastError: null }
  })
  assert(successOpts?.id === "cb-test", "onSuccess receives options")

  // removeAllContextMenus: Promise-style (length=0)
  let prCalled = 0
  const pRemove = (() => { prCalled++; return Promise.resolve() })
  Object.defineProperty(pRemove, "length", { value: 0 })
  await tsMbh.removeAllContextMenus({
    contextMenus: { create: () => {}, removeAll: pRemove },
    runtime: { lastError: null }
  })
  assert(prCalled === 1, "Promise-style removeAll called")

  // removeAllContextMenus: callback-style (length=1)
  let cbCalled = 0
  const cbRemove = function (cb) { cbCalled++; cb() }
  await tsMbh.removeAllContextMenus({
    contextMenus: { create: () => {}, removeAll: cbRemove },
    runtime: { lastError: null }
  })
  assert(cbCalled === 1, "callback-style removeAll called")


  // 选区孪生树契约（视觉取证 L1-L4 锁定的架构）：
  // 1) 双根必须上下文互斥（同上下文双根会被 Chrome 折叠成扩展名父项）
  // 2) 仅根与各级顶部 label 用原生 %s；可点击叶子保持固定标题
  // 3) 点击入口做 --sel 后缀归一化，两棵树共享全部点击语义
  {
    const builderPath = path.join(root, "src/background/menuBuilderAttach.ts")
    const builderSrc = fs.readFileSync(builderPath, "utf8")
    const builderModule = loadTs(builderPath)
    assert(typeof builderModule.selectionTwinTitle === "function", "selectionTwinTitle pure helper must be exported")
    assert(builderSrc.includes('const SEL_SUFFIX = "--sel"'), "孪生后缀常量")
    assert(builderSrc.includes('id === "ccs-main" ? "ccs-main-live" : id + SEL_SUFFIX'), "孪生 id 映射（ccs-main → ccs-main-live）")
    assert(builderSrc.includes("contexts: [\"selection\"]".replace(/\\/g, "\\")) || builderSrc.includes('contexts: ["selection"]'), "孪生树必须 selection 专属")
    assert(builderModule.selectionTwinTitle({ id: "ccs-main", title: "🔍 触触搜" }) === '🔍 搜："%s"', "孪生根标题必须用原生 %s")
    assert(
      builderModule.selectionTwinTitle({ id: "ccs-search-label", title: "🔍 触触搜" }) === '🔍 触触搜: "%s"',
      "二级菜单顶部 label 应保留关键词"
    )
    for (const { id, title } of [
      { id: "ccs-baidu", title: "🐼 百度搜索" },
      { id: "ccs-google", title: "🔎 Google 搜索" },
      { id: "ccs-x", title: "𝕏 X（推特）搜索" },
      { id: "ccs-chatgpt", title: "🤖 ChatGPT" },
      { id: "ccs-claude", title: "🧠 Claude" },
      { id: "ccs-grok", title: "🦊 Grok" },
      { id: "ccs-yiyan", title: "🧠 文心一言" },
      { id: "ccs-google-ai-chat", title: "✨ Google AI 模式" },
      { id: "ccs-fastqa-chatgpt-quick", title: "🤖 触触搜 · 速答壹拾佰 - ChatGPT" },
      { id: "ccs-fastqa-claude-quick", title: "🧠 触触搜 · 速答壹拾佰 - Claude" },
      { id: "ccs-fastqa-grok-quick", title: "🦊 触触搜 · 速答壹拾佰 - Grok" },
      { id: "ccs-fastqa-yiyan-quick", title: "🧠 触触搜 · 速答壹拾佰 - 文心一言" },
      { id: "ccs-fastqa-google-ai-quick", title: "✨ 触触搜 · 速答壹拾佰 - Google AI 模式" }
    ]) {
      const twinTitle = builderModule.selectionTwinTitle({ id, title })
      assert(twinTitle === title, `${id} 孪生子项应保持固定标题`)
      assert(!twinTitle.includes("%s"), `${id} 孪生子项不应重复显示关键词`)
    }
    assert(builderSrc.includes('id: "ccs-main", title:') && builderSrc.includes('contexts: ["page"]'), "ccs-main 必须仅 page 上下文（editable 会与 selection 共存触发折叠 —— F2 取证）")
    const handlerSrc = fs.readFileSync(path.join(root, "src/background/menuHandlersAttach.ts"), "utf8")
    assert(handlerSrc.includes('rawMenuItemId.endsWith("--sel")'), "点击入口必须做 --sel 归一化")
    assert(handlerSrc.includes('rawMenuItemId.slice(0, -5)'), "归一化应去掉 --sel 后缀")
    assert(handlerSrc.includes('rawMenuItemId === "ccs-main-live"'), "孪生根（submenu 容器）点击应忽略")
  }


  console.log("[verify-background-extras] StateManager + keywords + config + KeywordService + menuSystem + voiceOffscreenBridge + init + tabState + menuTitles + menuTitleUpdater + menuStateOrchestrator + menuActions + popupMenuStructure + menuDebugInfo + bootstrap + menuHandlersAttach + menuBuilderHelpers + mainLive OK")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
