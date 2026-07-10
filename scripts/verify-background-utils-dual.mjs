#!/usr/bin/env node
/**
 * Dual-run verifier for background utils ported to TS:
 *   - background/utils/Constants.js          ↔ src/background/utils/Constants.ts
 *   - background/utils/TextUtils.js          ↔ src/background/utils/TextUtils.ts
 *   - background/utils/TextLimits.js         ↔ src/background/utils/TextLimits.ts
 *   - legacy/background-retired/Logger.js    ↔ src/background/Logger.ts
 *
 * 策略：
 *  1. 在 Node VM 里以 SW 共享作用域风格加载 legacy 4 个文件（依赖 globalThis 串联）
 *  2. 用 typescript.transpileModule + 自建递归 CJS resolver 加载 TS 模块
 *  3. 对每个 util 跑一组输入/快照，逐项 deep-equal
 *
 * 副作用：
 *  - legacy Constants.js 会调用 chrome.storage.local.get → 我们在 VM 里 stub 一个 no-op
 *  - legacy Logger.js 会注册 globalThis._loggerDebug + 输出 7 行 console.log → 重定向到 noop
 *  - TS 版本不在 import 时 fire 副作用，所以无需处理
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import vm from "node:vm"
import { createRequire } from "node:module"
import ts from "typescript"

const root = process.cwd()
const nodeRequire = createRequire(import.meta.url)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function deepEqual(a, b, pathStr = "") {
  if (a === b) return null
  if (Number.isNaN(a) && Number.isNaN(b)) return null
  if (typeof a !== typeof b) return `type mismatch at ${pathStr || "<root>"}: ${typeof a} vs ${typeof b}`
  if (a === null || b === null) return `null mismatch at ${pathStr || "<root>"}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
  if (typeof a !== "object") {
    return `value mismatch at ${pathStr || "<root>"}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `array/object mismatch at ${pathStr || "<root>"}`
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `array length mismatch at ${pathStr || "<root>"}: ${a.length} vs ${b.length}`
    for (let i = 0; i < a.length; i++) {
      const err = deepEqual(a[i], b[i], `${pathStr}[${i}]`)
      if (err) return err
    }
    return null
  }
  const aKeys = Object.keys(a).sort()
  const bKeys = Object.keys(b).sort()
  if (aKeys.length !== bKeys.length || aKeys.some((k, i) => k !== bKeys[i])) {
    return `keys mismatch at ${pathStr || "<root>"}: [${aKeys.join(",")}] vs [${bKeys.join(",")}]`
  }
  for (const k of aKeys) {
    const err = deepEqual(a[k], b[k], pathStr ? `${pathStr}.${k}` : k)
    if (err) return err
  }
  return null
}

// ============================================================================
// Legacy loader：把 4 个 JS 文件按 SW importScripts 顺序加进同一个 VM globalThis
// ============================================================================

function loadLegacyGlobals() {
  const globals = {
    console: { log: () => {}, info: () => {}, warn: () => {}, error: () => {}, group: () => {}, groupEnd: () => {}, time: () => {}, timeEnd: () => {}, table: () => {} },
    chrome: {
      storage: {
        local: {
          get: (_keys, cb) => {
            // 模拟没数据；legacy Constants.js 只是 BG_DEBUG = !!result[DEBUG]
            try {
              cb({})
            } catch (_) { /* ignore */ }
          }
        }
      },
      tabs: {
        sendMessage: () => Promise.resolve()
      }
    }
  }
  const context = { globalThis: globals, ...globals }
  context.window = context.globalThis
  context.self = context.globalThis
  vm.createContext(context)

  const files = [
    "background/utils/Constants.js",
    "background/utils/TextUtils.js",
    "background/utils/TextLimits.js",
    "legacy/background-retired/Logger.js"
  ]
  for (const rel of files) {
    const abs = path.join(root, rel)
    vm.runInContext(fs.readFileSync(abs, "utf8"), context, { filename: abs })
  }
  return context.globalThis
}

// ============================================================================
// TS loader：递归 CJS resolver + typescript.transpileModule
// ============================================================================

function createTsLoader() {
  const cache = new Map()

  function load(absPath) {
    if (cache.has(absPath)) return cache.get(absPath).exports
    const source = fs.readFileSync(absPath, "utf8")
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
        esModuleInterop: true,
        isolatedModules: true
      },
      fileName: absPath
    })

    const moduleObj = { exports: {} }
    cache.set(absPath, moduleObj)

    const customRequire = (specifier) => {
      if (specifier.startsWith(".")) {
        const base = path.resolve(path.dirname(absPath), specifier)
        const candidates = [
          base,
          `${base}.ts`,
          `${base}.tsx`,
          path.join(base, "index.ts"),
          path.join(base, "index.tsx")
        ]
        for (const candidate of candidates) {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return load(candidate)
          }
        }
        throw new Error(`Cannot resolve relative module "${specifier}" from ${absPath}`)
      }
      return nodeRequire(specifier)
    }

    const context = {
      module: moduleObj,
      exports: moduleObj.exports,
      require: customRequire,
      console,
      globalThis: {}
    }
    vm.createContext(context)
    vm.runInContext(compiled.outputText, context, { filename: absPath })
    return moduleObj.exports
  }

  return load
}

// ============================================================================
// 主流程
// ============================================================================

function compareConstants(legacy, tsConstants) {
  const pairs = [
    ["LOG_PREFIX", legacy.LOG_PREFIX, tsConstants.LOG_PREFIX],
    ["STORAGE_KEYS", legacy.STORAGE_KEYS, tsConstants.STORAGE_KEYS],
    ["QUICK_RESULT_HOSTS", [...legacy.QUICK_RESULT_HOSTS], [...tsConstants.QUICK_RESULT_HOSTS]],
    ["MENU_DEFINITIONS", legacy.MENU_DEFINITIONS, tsConstants.MENU_DEFINITIONS],
    ["FAST_QA_QUICK_ITEMS", legacy.FAST_QA_QUICK_ITEMS, tsConstants.FAST_QA_QUICK_ITEMS],
    ["OPTIMIZE_CATEGORY_TITLES", legacy.OPTIMIZE_CATEGORY_TITLES, tsConstants.OPTIMIZE_CATEGORY_TITLES],
    ["COVER_CATEGORY_TITLES", legacy.COVER_CATEGORY_TITLES, tsConstants.COVER_CATEGORY_TITLES],
    ["DYNAMIC_SEARCH_MENU_ITEMS", [...legacy.DYNAMIC_SEARCH_MENU_ITEMS], [...tsConstants.DYNAMIC_SEARCH_MENU_ITEMS]],
    ["FAST_QA_MENU_ITEMS", [...legacy.FAST_QA_MENU_ITEMS], [...tsConstants.FAST_QA_MENU_ITEMS]],
    ["MENU_TITLE_MAX_LENGTH", legacy.MENU_TITLE_MAX_LENGTH, tsConstants.MENU_TITLE_MAX_LENGTH],
    ["KEYWORD_MAX_LENGTH", legacy.KEYWORD_MAX_LENGTH, tsConstants.KEYWORD_MAX_LENGTH],
    ["TITLE_CLEANUP_SUFFIXES", [...legacy.TITLE_CLEANUP_SUFFIXES], [...tsConstants.TITLE_CLEANUP_SUFFIXES]],
    ["SEARCH_ENGINE_SUFFIXES", [...legacy.SEARCH_ENGINE_SUFFIXES], [...tsConstants.SEARCH_ENGINE_SUFFIXES]],
    ["CACHE_EXPIRY", legacy.CACHE_EXPIRY, tsConstants.CACHE_EXPIRY],
    ["GENERIC_HOST_KEYWORDS", legacy.GENERIC_HOST_KEYWORDS, normalizeReadonlyArrays(tsConstants.GENERIC_HOST_KEYWORDS)]
  ]
  for (const [label, legacyVal, tsVal] of pairs) {
    const diff = deepEqual(legacyVal, tsVal)
    if (diff) throw new Error(`Constant "${label}" diverges: ${diff}`)
  }
  if (legacy.DYNAMIC_SEARCH_MENU_ITEMS.length !== 0 || tsConstants.DYNAMIC_SEARCH_MENU_ITEMS.length !== 0) {
    throw new Error("DYNAMIC_SEARCH_MENU_ITEMS must stay empty so child menu titles never repeat the keyword")
  }
}

function normalizeReadonlyArrays(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = Array.isArray(v) ? [...v] : v
  }
  return out
}

function compareTextUtils(legacy, ported) {
  const formatCases = [
    [null, undefined],
    ["", undefined],
    ["   ", undefined],
    ["Hello", undefined],
    ["A very long sentence that exceeds the limit", undefined],
    ["A very long sentence that exceeds the limit", 5],
    ["  multi   space\ttab", undefined]
  ]
  for (const [input, max] of formatCases) {
    const a = max === undefined ? legacy.formatMenuTitle(input) : legacy.formatMenuTitle(input, max)
    const b = max === undefined ? ported.formatMenuTitle(input) : ported.formatMenuTitle(input, max)
    const diff = deepEqual(a, b)
    if (diff) throw new Error(`formatMenuTitle diverges on ${JSON.stringify({ input, max })}: ${diff}`)
  }

  const normalizeCases = ["", "  hello  world  ", "%E4%B8%AD%E6%96%87", "raw text", null, "not%encoded%abc"]
  for (const input of normalizeCases) {
    const a = legacy.normalizeSearchText(input)
    const b = ported.normalizeSearchText(input)
    const diff = deepEqual(a, b)
    if (diff) throw new Error(`normalizeSearchText diverges on ${JSON.stringify(input)}: ${diff}`)
  }

  const titleCases = [
    "",
    null,
    "Hello - 知乎",
    "Hello – ChatGPT",
    "Hello — Claude",
    "(1) Foo Bar",
    "（提示）some title - 搜索结果",
    "  spaced  out  - 知乎  ",
    "Just plain"
  ]
  for (const input of titleCases) {
    const a = legacy.cleanupTitleKeyword(input)
    const b = ported.cleanupTitleKeyword(input)
    const diff = deepEqual(a, b)
    if (diff) throw new Error(`cleanupTitleKeyword diverges on ${JSON.stringify(input)}: ${diff}`)
  }

  const extractCases = [
    "",
    "Hello - 百度搜索",
    "Hello - Google 搜索 - 副标题",
    "A very long title that should be cut off because it exceeds fifty characters definitely yes for sure",
    "(1) Hello - Bing",
    null
  ]
  for (const input of extractCases) {
    const a = legacy.extractKeywordFromTitle(input)
    const b = ported.extractKeywordFromTitle(input)
    const diff = deepEqual(a, b)
    if (diff) throw new Error(`extractKeywordFromTitle diverges on ${JSON.stringify(input)}: ${diff}`)
  }

  const genericCases = [
    ["chatgpt.com", "chatgpt"],
    ["chatgpt.com", "ChatGPT"],
    ["chatgpt.com", "chatgpt.com/foo"],
    ["chatgpt.com", "real query"],
    ["claude.ai", "claude"],
    ["claude.ai", "www.claude.ai"],
    ["claude.ai", " "],
    ["example.com", "anything"],
    ["chatgpt.com", null]
  ]
  for (const [host, kw] of genericCases) {
    const a = legacy.isGenericHostKeyword(host, kw)
    const b = ported.isGenericHostKeyword(host, kw)
    const diff = deepEqual(a, b)
    if (diff) throw new Error(`isGenericHostKeyword diverges on ${JSON.stringify({ host, kw })}: ${diff}`)
  }

  const menuIds = [
    "ccs-baidu",
    "ccs-google",
    "ccs-chatgpt",
    "ccs-fastqa-chatgpt-quick",
    "ccs-top100-root",
    "ccs-unknown-id"
  ]
  for (const id of menuIds) {
    const aDef = legacy.getMenuDefinition(id)
    const bDef = ported.getMenuDefinition(id)
    const diffDef = deepEqual(aDef, bDef)
    if (diffDef) throw new Error(`getMenuDefinition diverges on ${id}: ${diffDef}`)

    const aText = legacy.getMenuText(id)
    const bText = ported.getMenuText(id)
    if (aText !== bText) throw new Error(`getMenuText diverges on ${id}: ${aText} vs ${bText}`)

    const aTitle = legacy.getMenuTitle(id)
    const bTitle = ported.getMenuTitle(id)
    if (aTitle !== bTitle) throw new Error(`getMenuTitle diverges on ${id}: ${aTitle} vs ${bTitle}`)
  }

  // fallback path
  const aFb = legacy.getMenuText("ccs-unknown-id", "FALLBACK")
  const bFb = ported.getMenuText("ccs-unknown-id", "FALLBACK")
  if (aFb !== bFb) throw new Error(`getMenuText fallback diverges: ${aFb} vs ${bFb}`)

  const urlCases = [
    "https://chatgpt.com/",
    "https://www.chatgpt.com/foo",
    "https://claude.ai/abc",
    "https://www.example.com/",
    "not a url",
    "",
    null
  ]
  for (const url of urlCases) {
    const a = legacy.shouldPreserveMenuStateForUrl(url)
    const b = ported.shouldPreserveMenuStateForUrl(url)
    if (a !== b) throw new Error(`shouldPreserveMenuStateForUrl diverges on ${JSON.stringify(url)}: ${a} vs ${b}`)

    const tab = url == null ? null : { url }
    const at = legacy.shouldPreserveMenuStateForTab(tab)
    const bt = ported.shouldPreserveMenuStateForTab(tab)
    if (at !== bt) throw new Error(`shouldPreserveMenuStateForTab diverges on ${JSON.stringify(tab)}: ${at} vs ${bt}`)
  }

  const pickCases = [
    [["", "  ", "first"]],
    [[null, undefined, "second"]],
    [["only"]],
    [["", "  "]],
    [[]],
    [[" trimmed "]]
  ]
  for (const [arr] of pickCases) {
    const a = legacy.pickFirstMeaningfulText(arr)
    const b = ported.pickFirstMeaningfulText(arr)
    const diff = deepEqual(a, b)
    if (diff) throw new Error(`pickFirstMeaningfulText diverges on ${JSON.stringify(arr)}: ${diff}`)
  }
}

function compareTextLimits(legacy, ported) {
  const tl = legacy.TextLimits
  const tp = ported.TextLimits

  assert(tl.SOFT_WARN_THRESHOLD === tp.SOFT_WARN_THRESHOLD, "SOFT_WARN_THRESHOLD diverges")
  assert(tl.FINAL_URL_HARD_CAP === tp.FINAL_URL_HARD_CAP, "FINAL_URL_HARD_CAP diverges")
  const limitsDiff = deepEqual(tl.LIMITS, tp.LIMITS)
  if (limitsDiff) throw new Error(`LIMITS diverges: ${limitsDiff}`)

  // ⚠️ 关键：TEXT_LIMITS_ENABLED 总闸必须是 false（生产决策）
  assert(ported.TEXT_LIMITS_ENABLED === false, "TS TEXT_LIMITS_ENABLED must remain false (production gate)")

  const menuIds = [
    null,
    "",
    "ccs-google",
    "ccs-google-ai-chat",
    "ccs-fastqa-google-ai-quick",
    "ccs-fastqa-chatgpt-quick",
    "ccs-top100-claude",
    "ccs-optimize-deep-research-grok",
    "ccs-baidu-translate",
    "ccs-unknown"
  ]
  for (const id of menuIds) {
    const a = tl.getLimitForMenu(id)
    const b = tp.getLimitForMenu(id)
    if (a !== b) throw new Error(`getLimitForMenu diverges on ${JSON.stringify(id)}: ${a} vs ${b}`)
  }

  const truncCases = [
    ["", 5],
    ["hi", 5],
    ["hello world", 5],
    ["a".repeat(100), 10],
    ["这是一个非常长的中文测试字符串需要被截断哦", 10],
    ["short. with. some. punctuation. and a comma, etc.", 20]
  ]
  for (const [text, max] of truncCases) {
    const a = tl.smartTruncate(text, max)
    const b = tp.smartTruncate(text, max)
    if (a !== b) throw new Error(`smartTruncate diverges on ${JSON.stringify({ text, max })}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
  }

  // Disabled path (production): 原文直通，无 toast 副作用
  const disabledCases = [
    ["ccs-google", "短文本"],
    ["ccs-google-ai-chat", "x".repeat(2000)],
    ["ccs-unknown", ""],
    ["ccs-fastqa-chatgpt-quick", "y".repeat(10000)]
  ]
  for (const [id, text] of disabledCases) {
    const a = tl.applyTextLimit(id, text) // legacy 自动 disabled
    const b = tp.applyTextLimit(id, text) // TS 自动 disabled
    const diff = deepEqual(a, b)
    if (diff) throw new Error(`applyTextLimit(disabled) diverges on ${id}: ${diff}`)
  }

  // Enabled path (恢复保护时):
  // legacy 没有运行时 enable 开关，所以 enabled 路径只 verify TS 自身行为合理：
  // - 大文本会被截断、truncated=true、original/limit/text 字段合法
  const enabledResult = tp.applyTextLimit("ccs-google-ai-chat", "z".repeat(2000), { enabled: true })
  assert(enabledResult.truncated === true, "applyTextLimit enabled must truncate over-budget input")
  assert(enabledResult.text.length <= 1200, "applyTextLimit enabled googleAi budget should clip <= 1200")
  assert(enabledResult.original === 2000, "applyTextLimit enabled must report original length")
  assert(enabledResult.limit === 1200, "applyTextLimit enabled googleAi must report limit 1200")

  // enforceFinalUrlCap disabled path
  const longUrl = "https://example.com/?q=" + "x".repeat(2500)
  if (tl.enforceFinalUrlCap(longUrl) !== tp.enforceFinalUrlCap(longUrl)) {
    throw new Error("enforceFinalUrlCap(disabled) diverges")
  }
  // enabled path
  const enabledCap = tp.enforceFinalUrlCap(longUrl, { enabled: true })
  assert(enabledCap.length === tp.FINAL_URL_HARD_CAP, "enforceFinalUrlCap enabled must clip to FINAL_URL_HARD_CAP")
  assert(tp.enforceFinalUrlCap("short", { enabled: true }) === "short", "enforceFinalUrlCap enabled must pass through short URL")
}

function compareLogger(legacy, ported) {
  // Static enums
  const diffLevels = deepEqual(
    { ...legacy.Logger.LEVELS },
    { ...ported.Logger.LEVELS }
  )
  if (diffLevels) throw new Error(`Logger.LEVELS diverges: ${diffLevels}`)

  const diffNames = deepEqual(
    { ...legacy.Logger.LEVEL_NAMES },
    { ...ported.Logger.LEVEL_NAMES }
  )
  if (diffNames) throw new Error(`Logger.LEVEL_NAMES diverges: ${diffNames}`)

  // Default globalConfig (compare structure, not reference)
  const diffCfg = deepEqual(
    { ...legacy.Logger.globalConfig },
    { ...ported.Logger.globalConfig }
  )
  if (diffCfg) throw new Error(`Logger.globalConfig diverges: ${diffCfg}`)

  // getLevelName
  for (const lvl of [0, 1, 2, 3, 999, 42]) {
    const a = legacy.Logger.getLevelName(lvl)
    const b = ported.Logger.getLevelName(lvl)
    if (a !== b) throw new Error(`Logger.getLevelName(${lvl}) diverges: ${a} vs ${b}`)
  }

  // Predefined loggers map keys must match (order may differ, set equality is enough)
  const aKeys = new Set(Object.keys(legacy.loggers))
  const bKeys = new Set(Object.keys(ported.loggers))
  if (aKeys.size !== bKeys.size || [...aKeys].some((k) => !bKeys.has(k))) {
    throw new Error(`loggers keys diverge: [${[...aKeys].join(",")}] vs [${[...bKeys].join(",")}]`)
  }

  // getLogger returns same module names
  for (const moduleName of ["MenuSystem", "Custom", "Init"]) {
    const a = legacy.getLogger(moduleName)
    const b = ported.getLogger(moduleName)
    if (a.moduleName !== b.moduleName) throw new Error(`getLogger("${moduleName}") moduleName diverges`)
  }

  // logMenuEvent with explicit disabled — both must be no-op (no records added)
  legacy.Logger.clearHistory()
  ported.Logger.clearHistory()

  // legacy 的 logMenuEvent 检查 globalThis.BG_DEBUG（已 stub 为 undefined → falsy → noop）
  legacy.logMenuEvent("evt-A", { foo: 1 })
  assert(legacy.Logger.records.length === 0, "legacy logMenuEvent must not record when BG_DEBUG falsy")

  ported.logMenuEvent("evt-A", { foo: 1 }, { enabled: false })
  assert(ported.Logger.records.length === 0, "ported logMenuEvent must not record when enabled=false")
}

function main() {
  const legacyGlobals = loadLegacyGlobals()
  const loadTs = createTsLoader()

  const tsConstants = loadTs(path.join(root, "src/background/utils/Constants.ts"))
  const tsTextUtils = loadTs(path.join(root, "src/background/utils/TextUtils.ts"))
  const tsTextLimits = loadTs(path.join(root, "src/background/utils/TextLimits.ts"))
  const tsLogger = loadTs(path.join(root, "src/background/Logger.ts"))

  compareConstants(legacyGlobals, tsConstants)
  compareTextUtils(legacyGlobals, tsTextUtils)
  compareTextLimits(legacyGlobals, tsTextLimits)
  compareLogger(legacyGlobals, tsLogger)

  console.log("[verify-background-utils-dual] Constants + TextUtils + TextLimits + Logger all OK")
}

main()
