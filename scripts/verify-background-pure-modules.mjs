#!/usr/bin/env node
/**
 * SW 纯逻辑模块行为回归（importScripts 进 SW 的 legacy 源）：
 *   - background/menuIds.js
 *   - background/URLBuilder.js
 *   - background/MenuRegistry.js
 *   - background/tasks/AITaskRegistry.js（用真实 prompts/*.json 跑 buildTaskPrompt）
 *
 * 输出值对照 scripts/fixtures/golden/background-pure-modules.json。快照最初录自 legacy 与
 * TS 移植版逐项 deep-equal 通过时的输出；有意改行为后用 UPDATE_GOLDEN=1 刷新。
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import vm from "node:vm"
import { createGolden } from "./lib/golden.mjs"

const root = process.cwd()

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function loadLegacyGlobals() {
  const noop = () => {}
  const globals = {
    console: { log: noop, info: noop, warn: noop, error: noop, group: noop, groupEnd: noop, time: noop, timeEnd: noop, table: noop },
    chrome: {
      runtime: { lastError: null, getURL: (p) => p },
      contextMenus: { update: (_id, _opts, cb) => cb && cb() }
    },
    // AITaskRegistry.loadTask 走 fetch(chrome.runtime.getURL(promptsFile))：直接读仓库里的 prompts
    fetch: async (url) => {
      const abs = path.join(root, url)
      if (!fs.existsSync(abs)) return { ok: false, status: 404, json: async () => null }
      return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(abs, "utf8")) }
    },
    Promise, Map, Set, Array, Object, JSON
  }
  const context = { globalThis: globals, ...globals }
  context.window = context.globalThis
  context.self = context.globalThis
  vm.createContext(context)

  const files = [
    { rel: "shared/promptLanguage.js", append: "" },
    // URLBuilder.js 没把类挂到 globalThis，追加暴露
    { rel: "background/URLBuilder.js", append: "\nglobalThis.URLBuilder = URLBuilder;" },
    { rel: "background/MenuRegistry.js", append: "" },
    { rel: "background/tasks/AITaskRegistry.js", append: "" },
    {
      rel: "background/menuIds.js",
      append: "\nObject.assign(globalThis, { MENU_IDS, MENU_ID_GROUPS, MENU_ID_PREFIXES, isTop100Menu, isFastQAMenu, isOptimizeMenu, needsDynamicTitle, getAllMenuIds, isValidMenuId, getMenuIdByConstant, getConstantByMenuId });"
    }
  ]
  for (const { rel, append } of files) {
    const abs = path.join(root, rel)
    vm.runInContext(fs.readFileSync(abs, "utf8") + append, context, { filename: abs })
  }
  return context.globalThis
}

function checkMenuIds(golden, legacy) {
  golden.check("MENU_IDS", legacy.MENU_IDS)
  golden.check("MENU_ID_GROUPS", legacy.MENU_ID_GROUPS)
  golden.check("MENU_ID_PREFIXES", legacy.MENU_ID_PREFIXES)
  const ids = ["ccs-top100-chatgpt", "ccs-fastqa-claude", "ccs-optimize-x", "ccs-google", "", null]
  golden.check("menuIdPredicates", ids.map((id) => ({
    id,
    isTop100Menu: legacy.isTop100Menu(id),
    isFastQAMenu: legacy.isFastQAMenu(id),
    isOptimizeMenu: legacy.isOptimizeMenu(id),
    needsDynamicTitle: legacy.needsDynamicTitle(id),
    isValidMenuId: legacy.isValidMenuId(id)
  })))
  golden.check("getMenuIdByConstant", ["ROOT", "CHATGPT", "NONEXISTENT", ""].map((name) => legacy.getMenuIdByConstant(name)))
  golden.check("getConstantByMenuId", ["ccs-main", "ccs-chatgpt", "ccs-unknown"].map((id) => legacy.getConstantByMenuId(id)))
  golden.check("getAllMenuIds", [...legacy.getAllMenuIds()].sort())
}

function checkURLBuilder(golden, URLBuilder) {
  golden.check("URLBuilder.isValidUrl", ["https://x.com/", "not a url", "", "http://a/b?c=d"].map((u) => URLBuilder.isValidUrl(u)))
  golden.check("URLBuilder.buildSimple", [
    ["https://x.com/", "q", "hello"],
    ["https://x.com/path?a=1", "q", "hello world"],
    ["https://x.com/", "q", "中文"]
  ].map((tc) => URLBuilder.buildSimple(...tc)))

  const builder = new URLBuilder()
  const templates = {
    "ccs-baidu": "https://www.baidu.com/s?wd=${KEYWORD}",
    "ccs-chatgpt": "https://chatgpt.com/?q=${PROMPT}",
    "ccs-mixed": "https://x.com/?raw=${RAW_TEXT}&enc=${ENCODED_TEXT}&norm=${NORMALIZED}",
    "ccs-unknown-var": "https://x.com/?u=${SOMEUNKNOWN}"
  }
  builder.registerBatch(templates)
  const params = { raw: "hello world", normalized: "hello world", prompt: "explain this" }
  golden.check("URLBuilder.build", Object.keys(templates).map((id) => builder.build(id, params)))
  golden.check("URLBuilder.build.edges", {
    missingTemplate: builder.build("ccs-nonexistent", params),
    emptyParams: builder.build("ccs-baidu", {})
  })
  golden.check("URLBuilder.lookup", ["ccs-baidu", "ccs-nonexistent"].map((id) => ({ id, has: builder.has(id), template: builder.getTemplate(id) })))
  golden.check("URLBuilder.getAllMenuIds", [...builder.getAllMenuIds()].sort())

  builder.delete("ccs-baidu")
  assert(builder.has("ccs-baidu") === false, "URLBuilder.delete should remove")
  builder.clear()
  assert(builder.templates.size === 0, "URLBuilder.clear should empty")

  const count = builder.loadFromConfig({
    groups: [{ items: [
      { id: "ccs-a", urlPattern: "https://a/?q=${KEYWORD}" },
      { id: "ccs-b", children: [{ id: "ccs-b1", urlPattern: "https://b1/?q=${KEYWORD}" }] }
    ] }]
  })
  golden.check("URLBuilder.loadFromConfig", count)
  assert(builder.has("ccs-a") && builder.has("ccs-b1"), "loadFromConfig registers top-level and nested items")
}

function checkMenuRegistry(golden, MenuRegistry) {
  const registry = new MenuRegistry()
  const configs = [
    { id: "x-label", title: "X" },                                  // auto-sync via -label
    { id: "y-static", title: "Y" },                                 // not synced
    { id: "z-tpl", title: "Z", titleTemplate: "Z ${keyword}" },    // synced via tpl
    { id: "g-grouped", title: "G", syncGroup: "main" },            // synced via group
    { id: "force-yes", title: "F", autoSync: true },               // explicit yes
    { id: "force-no", title: "N", autoSync: false, titleTemplate: "X ${keyword}" } // explicit no
  ]
  for (const c of configs) registry.register(c)

  golden.check("MenuRegistry.syncableItems", [...registry.syncableItems].sort())
  golden.check("MenuRegistry.lookup", ["x-label", "force-no", "not-exist"].map((id) => ({ id, has: registry.has(id), found: registry.get(id) !== undefined })))
  const ctx = { keyword: "test", raw: "test raw", normalized: "test_norm" }
  golden.check("MenuRegistry.renderTitle", configs.map((c) => registry.renderTitle(c, ctx)))
  golden.check("MenuRegistry.renderTitle.emptyCtx", configs.map((c) => registry.renderTitle(c, {})))
  const stats = registry.getStats()
  golden.check("MenuRegistry.getStats", { ...stats, groupDetails: [...stats.groupDetails].sort((x, y) => x.name.localeCompare(y.name)) })

  registry.unregister("force-yes")
  assert(!registry.has("force-yes"), "MenuRegistry.unregister")
  registry.clear()
  assert(registry.items.size === 0, "MenuRegistry.clear")
}

async function checkAITaskRegistry(golden, registry) {
  golden.check("TASK_DEFINITIONS", registry.TASK_DEFINITIONS)
  golden.check("listTaskDefinitions", registry.listTaskDefinitions())
  const menuIds = [
    "ccs-fastqa-root",
    "ccs-fastqa-chatgpt",
    "ccs-fastqa-google-ai",
    "ccs-fastqa-open-all",
    "ccs-top100-claude",
    "ccs-optimize-root",
    "ccs-optimize-deep-research-chatgpt",
    "ccs-optimize-content-creation-grok",
    "ccs-optimize-content-creation-open-all",
    "ccs-optimize-content-creation",                 // 仅 category（submenu）
    "ccs-optimize-google-ai",                        // hasCategories 但无 category → null
    "ccs-cover-anime-cute-chatgpt-images",
    "ccs-cover-open-all",
    "ccs-baidu",                                     // 不属任何 task
    "",
    null,
    "random"
  ]
  golden.check("resolveMenuId", menuIds.map((m) => registry.resolveMenuId(m)))

  // 真实 prompts/fastAnswersPrompts.json：关键字注入 + 默认简体中文 + 语言覆盖
  for (const [kw, opts] of [["hello", {}], ["", {}], ["complex 中文 query", {}], ["x", { vars: { ratio: "9:16" } }]]) {
    const prompt = await registry.buildTaskPrompt("fastqa", kw, opts)
    assert(typeof prompt === "string" && prompt.length > 0, `fastqa buildTaskPrompt returned ${prompt} on kw="${kw}"`)
    assert(kw === "" || prompt.includes(kw), "fastqa prompt must contain the keyword")
    assert(prompt.includes("简体中文"), "fastqa prompt must default to Simplified Chinese")
    assert(!prompt.includes("${outputLanguage}"), "fastqa prompt leaked the output-language placeholder")
  }
  const localized = await registry.buildTaskPrompt("fastqa", "hello", { outputLanguage: "English" })
  assert(localized?.includes("English"), "fastqa prompt language override missing")
  assert(!localized?.includes("${outputLanguage}"), "fastqa language override leaked placeholder")

  // 分类任务：缺 categoryId → null；带 categoryId → 注入 purpose
  assert(await registry.buildTaskPrompt("optimize", "hello") === null, "optimize prompt without categoryId must be null")
  const optimizeTask = await registry.loadTask("optimize")
  const firstCategory = optimizeTask?.categories?.[0]
  assert(firstCategory?.id, "optimize task must have categories")
  const optimized = await registry.buildTaskPrompt("optimize", "hello", { categoryId: firstCategory.id })
  assert(optimized?.includes("hello"), "optimize prompt must contain the keyword")
  assert(!optimized.includes("${"), "optimize prompt must not leak placeholders")
}

const golden = createGolden("background-pure-modules")
const legacy = loadLegacyGlobals()
assert(legacy.URLBuilder && legacy.MenuRegistry && legacy.AITaskRegistry, "legacy modules must expose URLBuilder / MenuRegistry / AITaskRegistry")
checkMenuIds(golden, legacy)
checkURLBuilder(golden, legacy.URLBuilder)
checkMenuRegistry(golden, legacy.MenuRegistry)
await checkAITaskRegistry(golden, legacy.AITaskRegistry)
golden.finish()

console.log("[verify-background-pure-modules] menuIds + URLBuilder + MenuRegistry + AITaskRegistry OK")
