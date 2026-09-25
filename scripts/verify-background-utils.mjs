#!/usr/bin/env node
/**
 * SW 工具层行为回归：
 *   - background/utils/Constants.js / TextUtils.js / TextLimits.js（importScripts 进 SW 的 legacy 源）
 *   - src/background/Logger.ts（SW bundle 里的 TS Logger，经 baseBridge 挂到 globalThis）
 *
 * 输出值对照 scripts/fixtures/golden/background-utils.json。快照最初录自 legacy 与
 * TS 移植版逐项 deep-equal 通过时的输出；有意改行为后用 UPDATE_GOLDEN=1 刷新。
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import vm from "node:vm"
import { createGolden } from "./lib/golden.mjs"
import { createTsLoader } from "./lib/tsLoader.mjs"

const root = process.cwd()

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function loadLegacyGlobals() {
  const noop = () => {}
  const globals = {
    console: { log: noop, info: noop, warn: noop, error: noop, group: noop, groupEnd: noop, time: noop, timeEnd: noop, table: noop },
    chrome: {
      storage: { local: { get: (_keys, cb) => { try { cb({}) } catch (_) { /* ignore */ } } } },
      tabs: { sendMessage: () => Promise.resolve() }
    }
  }
  const context = { globalThis: globals, ...globals }
  context.window = context.globalThis
  context.self = context.globalThis
  vm.createContext(context)
  for (const rel of ["background/utils/Constants.js", "background/utils/TextUtils.js", "background/utils/TextLimits.js"]) {
    const abs = path.join(root, rel)
    vm.runInContext(fs.readFileSync(abs, "utf8"), context, { filename: abs })
  }
  return context.globalThis
}

function checkConstants(golden, legacy) {
  for (const name of [
    "LOG_PREFIX", "STORAGE_KEYS", "QUICK_RESULT_HOSTS", "MENU_DEFINITIONS", "FAST_QA_QUICK_ITEMS",
    "OPTIMIZE_CATEGORY_TITLES", "COVER_CATEGORY_TITLES", "DYNAMIC_SEARCH_MENU_ITEMS", "FAST_QA_MENU_ITEMS",
    "MENU_TITLE_MAX_LENGTH", "KEYWORD_MAX_LENGTH", "TITLE_CLEANUP_SUFFIXES", "SEARCH_ENGINE_SUFFIXES",
    "CACHE_EXPIRY", "GENERIC_HOST_KEYWORDS"
  ]) {
    assert(legacy[name] !== undefined, `Constants.js must expose ${name}`)
    golden.check(`Constants.${name}`, legacy[name])
  }
  assert(legacy.DYNAMIC_SEARCH_MENU_ITEMS.length === 0,
    "DYNAMIC_SEARCH_MENU_ITEMS must stay empty so child menu titles never repeat the keyword")
}

function checkTextUtils(golden, legacy) {
  const normalizeCases = ["", "  hello  world  ", "%E4%B8%AD%E6%96%87", "raw text", null, "not%encoded%abc"]
  golden.check("normalizeSearchText", normalizeCases.map((input) => legacy.normalizeSearchText(input)))

  const titleCases = [
    "", null, "Hello - 知乎", "Hello – ChatGPT", "Hello — Claude", "(1) Foo Bar",
    "（提示）some title - 搜索结果", "  spaced  out  - 知乎  ", "Just plain"
  ]
  golden.check("cleanupTitleKeyword", titleCases.map((input) => legacy.cleanupTitleKeyword(input)))

  const extractCases = [
    "",
    "Hello - 百度搜索",
    "Hello - Google 搜索 - 副标题",
    "A very long title that should be cut off because it exceeds fifty characters definitely yes for sure",
    "(1) Hello - Bing",
    null
  ]
  golden.check("extractKeywordFromTitle", extractCases.map((input) => legacy.extractKeywordFromTitle(input)))

  const genericCases = [
    ["chatgpt.com", "chatgpt"], ["chatgpt.com", "ChatGPT"], ["chatgpt.com", "chatgpt.com/foo"],
    ["chatgpt.com", "real query"], ["claude.ai", "claude"], ["claude.ai", "www.claude.ai"],
    ["claude.ai", " "], ["example.com", "anything"], ["chatgpt.com", null]
  ]
  golden.check("isGenericHostKeyword", genericCases.map(([host, kw]) => legacy.isGenericHostKeyword(host, kw)))

  const menuIds = ["ccs-baidu", "ccs-google", "ccs-chatgpt", "ccs-fastqa-chatgpt-quick", "ccs-top100-root", "ccs-unknown-id"]
  golden.check("menuDefinitionLookups", menuIds.map((id) => ({
    id,
    definition: legacy.getMenuDefinition(id),
    text: legacy.getMenuText(id),
    title: legacy.getMenuTitle(id)
  })))
  golden.check("getMenuText.fallback", legacy.getMenuText("ccs-unknown-id", "FALLBACK"))

  const urlCases = ["https://chatgpt.com/", "https://www.chatgpt.com/foo", "https://claude.ai/abc", "https://www.example.com/", "not a url", "", null]
  golden.check("shouldPreserveMenuState", urlCases.map((url) => ({
    url,
    forUrl: legacy.shouldPreserveMenuStateForUrl(url),
    forTab: legacy.shouldPreserveMenuStateForTab(url == null ? null : { url })
  })))

  const pickCases = [["", "  ", "first"], [null, undefined, "second"], ["only"], ["", "  "], [], [" trimmed "]]
  golden.check("pickFirstMeaningfulText", pickCases.map((arr) => legacy.pickFirstMeaningfulText(arr)))
}

function checkTextLimits(golden, legacy) {
  const tl = legacy.TextLimits
  const source = fs.readFileSync(path.join(root, "background/utils/TextLimits.js"), "utf8")
  // ⚠️ 生产决策：字数保护总闸关闭
  assert(/const TEXT_LIMITS_ENABLED = false;/.test(source), "TextLimits.js TEXT_LIMITS_ENABLED must remain false (production gate)")

  golden.check("TextLimits.constants", {
    SOFT_WARN_THRESHOLD: tl.SOFT_WARN_THRESHOLD,
    FINAL_URL_HARD_CAP: tl.FINAL_URL_HARD_CAP,
    LIMITS: tl.LIMITS
  })

  const menuIds = [
    null, "", "ccs-google", "ccs-google-ai-chat", "ccs-fastqa-google-ai-quick", "ccs-fastqa-chatgpt-quick",
    "ccs-top100-claude", "ccs-optimize-deep-research-grok", "ccs-baidu-translate", "ccs-unknown"
  ]
  golden.check("getLimitForMenu", menuIds.map((id) => tl.getLimitForMenu(id)))

  const truncCases = [
    ["", 5], ["hi", 5], ["hello world", 5], ["a".repeat(100), 10],
    ["这是一个非常长的中文测试字符串需要被截断哦", 10],
    ["short. with. some. punctuation. and a comma, etc.", 20]
  ]
  golden.check("smartTruncate", truncCases.map(([text, max]) => tl.smartTruncate(text, max)))

  // 总闸关闭：原文直通、URL 直通
  const disabledCases = [
    ["ccs-google", "短文本"],
    ["ccs-google-ai-chat", "x".repeat(2000)],
    ["ccs-unknown", ""],
    ["ccs-fastqa-chatgpt-quick", "y".repeat(10000)]
  ]
  for (const [id, text] of disabledCases) {
    const result = tl.applyTextLimit(id, text)
    assert(result.text === text && result.truncated === false, `applyTextLimit(${id}) must pass text through while the gate is off`)
  }
  golden.check("applyTextLimit.disabled", disabledCases.map(([id, text]) => tl.applyTextLimit(id, text)))
  const longUrl = "https://example.com/?q=" + "x".repeat(2500)
  assert(tl.enforceFinalUrlCap(longUrl) === longUrl, "enforceFinalUrlCap must pass URL through while the gate is off")
}

function checkLogger(golden) {
  const silent = { log() {}, info() {}, warn() {}, error() {}, debug() {}, group() {}, groupEnd() {}, table() {} }
  const loadTs = createTsLoader({ context: { console: silent } })
  const logger = loadTs(path.join(root, "src/background/Logger.ts"))
  golden.check("Logger.static", {
    LEVELS: { ...logger.Logger.LEVELS },
    LEVEL_NAMES: { ...logger.Logger.LEVEL_NAMES },
    globalConfig: { ...logger.Logger.globalConfig }
  })
  golden.check("Logger.getLevelName", [0, 1, 2, 3, 999, 42].map((lvl) => logger.Logger.getLevelName(lvl)))
  golden.check("Logger.loggers", Object.keys(logger.loggers).sort())
  for (const moduleName of ["MenuSystem", "Custom", "Init"]) {
    assert(logger.getLogger(moduleName).moduleName === moduleName, `getLogger("${moduleName}") moduleName`)
  }
  logger.Logger.clearHistory()
  logger.logMenuEvent("evt-A", { foo: 1 }, { enabled: false })
  assert(logger.Logger.records.length === 0, "logMenuEvent must not record when enabled=false")
}

const golden = createGolden("background-utils")
const legacy = loadLegacyGlobals()
checkConstants(golden, legacy)
checkTextUtils(golden, legacy)
checkTextLimits(golden, legacy)
checkLogger(golden)
golden.finish()

console.log("[verify-background-utils] Constants + TextUtils + TextLimits + Logger OK")
