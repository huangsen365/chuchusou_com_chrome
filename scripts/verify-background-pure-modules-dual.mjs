#!/usr/bin/env node
/**
 * Dual-run verifier for Phase 3 ported pure modules:
 *   - background/menuIds.js                ↔ src/background/menuIds.ts
 *   - background/URLBuilder.js             ↔ src/background/URLBuilder.ts
 *   - background/MenuRegistry.js           ↔ src/background/MenuRegistry.ts
 *   - background/tasks/AITaskRegistry.js   ↔ src/background/tasks/AITaskRegistry.ts
 *
 * 策略与 verify-background-utils-dual.mjs 同：
 *  - legacy 用 node:vm 共享 globalThis 加载（chrome.* stub）
 *  - TS 用 typescript.transpileModule + 自建 CJS resolver 加载
 *  - 对每个模块跑一组真实输入，逐项 deep-equal
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
// Legacy loader（共享 globalThis 模拟 SW importScripts）
// ============================================================================

function loadLegacyGlobals() {
  const globals = {
    console: {
      log: () => {}, info: () => {}, warn: () => {}, error: () => {},
      group: () => {}, groupEnd: () => {}, time: () => {}, timeEnd: () => {}, table: () => {}
    },
    chrome: {
      runtime: { lastError: null },
      contextMenus: { update: (_id, _opts, cb) => cb && cb() }
    },
    Promise,
    Map,
    Set,
    Array,
    Object,
    JSON
  }
  const context = { globalThis: globals, ...globals }
  context.window = context.globalThis
  context.self = context.globalThis
  vm.createContext(context)

  // Legacy URLBuilder 没显式写 globalThis.URLBuilder，需要追加暴露
  const files = [
    { path: "background/URLBuilder.js", append: "\nglobalThis.URLBuilder = URLBuilder;\nglobalThis.buildUrlWithParam = buildUrlWithParam;" },
    { path: "background/MenuRegistry.js", append: "" },
    { path: "background/tasks/AITaskRegistry.js", append: "" }
  ]
  for (const { path: rel, append } of files) {
    const abs = path.join(root, rel)
    const src = fs.readFileSync(abs, "utf8") + append
    vm.runInContext(src, context, { filename: abs })
  }
  return context.globalThis
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
// menuIds 比较
// ============================================================================

function compareMenuIds(legacy, ported) {
  const diffIds = deepEqual({ ...legacy.MENU_IDS }, { ...ported.MENU_IDS })
  if (diffIds) throw new Error(`MENU_IDS diverges: ${diffIds}`)

  // MENU_ID_GROUPS - 注意 SEARCH_ENGINES 包含 undefined (legacy bug 保留)
  const legacyGroupsClone = {
    DYNAMIC_TITLE: [...legacy.MENU_ID_GROUPS.DYNAMIC_TITLE],
    FAST_QA_QUICK: [...legacy.MENU_ID_GROUPS.FAST_QA_QUICK],
    SEARCH_ENGINES: [...legacy.MENU_ID_GROUPS.SEARCH_ENGINES],
    AI_CHAT: [...legacy.MENU_ID_GROUPS.AI_CHAT],
    GENERAL_SEARCH: [...legacy.MENU_ID_GROUPS.GENERAL_SEARCH],
    ADVANCED: [...legacy.MENU_ID_GROUPS.ADVANCED],
    TOOLS: [...legacy.MENU_ID_GROUPS.TOOLS],
    TRANSFORMS: [...legacy.MENU_ID_GROUPS.TRANSFORMS]
  }
  const tsGroupsClone = {
    DYNAMIC_TITLE: [...ported.MENU_ID_GROUPS.DYNAMIC_TITLE],
    FAST_QA_QUICK: [...ported.MENU_ID_GROUPS.FAST_QA_QUICK],
    SEARCH_ENGINES: [...ported.MENU_ID_GROUPS.SEARCH_ENGINES],
    AI_CHAT: [...ported.MENU_ID_GROUPS.AI_CHAT],
    GENERAL_SEARCH: [...ported.MENU_ID_GROUPS.GENERAL_SEARCH],
    ADVANCED: [...ported.MENU_ID_GROUPS.ADVANCED],
    TOOLS: [...ported.MENU_ID_GROUPS.TOOLS],
    TRANSFORMS: [...ported.MENU_ID_GROUPS.TRANSFORMS]
  }
  // undefined → null normalize 后比较（两边都 normalize 保证对称）
  const normUndefined = (a) => a.map((g) => g === undefined ? null : g)
  for (const k of Object.keys(legacyGroupsClone)) {
    legacyGroupsClone[k] = normUndefined(legacyGroupsClone[k])
    tsGroupsClone[k] = normUndefined(tsGroupsClone[k])
  }
  const diffGroups = deepEqual(legacyGroupsClone, tsGroupsClone)
  if (diffGroups) throw new Error(`MENU_ID_GROUPS diverges: ${diffGroups}`)

  const diffPrefixes = deepEqual({ ...legacy.MENU_ID_PREFIXES }, { ...ported.MENU_ID_PREFIXES })
  if (diffPrefixes) throw new Error(`MENU_ID_PREFIXES diverges: ${diffPrefixes}`)

  // 函数测试
  for (const id of ["ccs-top100-chatgpt", "ccs-fastqa-claude", "ccs-optimize-x", "ccs-google", "", null]) {
    assert(legacy.isTop100Menu(id) === ported.isTop100Menu(id), `isTop100Menu diverges on ${id}`)
    assert(legacy.isFastQAMenu(id) === ported.isFastQAMenu(id), `isFastQAMenu diverges on ${id}`)
    assert(legacy.isOptimizeMenu(id) === ported.isOptimizeMenu(id), `isOptimizeMenu diverges on ${id}`)
    assert(legacy.needsDynamicTitle(id) === ported.needsDynamicTitle(id), `needsDynamicTitle diverges on ${id}`)
    assert(legacy.isValidMenuId(id) === ported.isValidMenuId(id), `isValidMenuId diverges on ${id}`)
  }

  for (const name of ["ROOT", "CHATGPT", "NONEXISTENT", ""]) {
    assert(legacy.getMenuIdByConstant(name) === ported.getMenuIdByConstant(name),
      `getMenuIdByConstant diverges on ${name}`)
  }

  for (const id of ["ccs-main", "ccs-chatgpt", "ccs-unknown"]) {
    assert(legacy.getConstantByMenuId(id) === ported.getConstantByMenuId(id),
      `getConstantByMenuId diverges on ${id}`)
  }

  const allLegacy = legacy.getAllMenuIds().sort()
  const allTs = ported.getAllMenuIds().sort()
  const diffAll = deepEqual(allLegacy, allTs)
  if (diffAll) throw new Error(`getAllMenuIds diverges: ${diffAll}`)
}

// ============================================================================
// URLBuilder 比较
// ============================================================================

function compareURLBuilder(LegacyBuilderCtor, PortedBuilderCtor) {
  // Static
  for (const u of ["https://x.com/", "not a url", "", "http://a/b?c=d"]) {
    assert(LegacyBuilderCtor.isValidUrl(u) === PortedBuilderCtor.isValidUrl(u),
      `isValidUrl diverges on ${u}`)
  }
  for (const tc of [
    ["https://x.com/", "q", "hello"],
    ["https://x.com/path?a=1", "q", "hello world"],
    ["https://x.com/", "q", "中文"]
  ]) {
    const a = LegacyBuilderCtor.buildSimple(...tc)
    const b = PortedBuilderCtor.buildSimple(...tc)
    assert(a === b, `buildSimple diverges on ${JSON.stringify(tc)}: ${a} vs ${b}`)
  }

  // Instance: register + build + has + getTemplate + getAllMenuIds + getStats + delete + clear
  const lb = new LegacyBuilderCtor()
  const tb = new PortedBuilderCtor()

  const templates = {
    "ccs-baidu": "https://www.baidu.com/s?wd=${KEYWORD}",
    "ccs-chatgpt": "https://chatgpt.com/?q=${PROMPT}",
    "ccs-mixed": "https://x.com/?raw=${RAW_TEXT}&enc=${ENCODED_TEXT}&norm=${NORMALIZED}",
    "ccs-unknown-var": "https://x.com/?u=${SOMEUNKNOWN}"
  }
  lb.registerBatch(templates)
  tb.registerBatch(templates)

  const params = { raw: "hello world", normalized: "hello world", prompt: "explain this" }
  for (const [id] of Object.entries(templates)) {
    const a = lb.build(id, params)
    const b = tb.build(id, params)
    assert(a === b, `build(${id}) diverges:\n  ${a}\n  vs\n  ${b}`)
  }

  // Edge: missing template
  assert(lb.build("ccs-nonexistent", params) === tb.build("ccs-nonexistent", params), "build missing")

  // Edge: empty params
  assert(lb.build("ccs-baidu", {}) === tb.build("ccs-baidu", {}), "build empty params")

  // has / getTemplate
  for (const id of ["ccs-baidu", "ccs-nonexistent"]) {
    assert(lb.has(id) === tb.has(id), `has(${id}) diverges`)
    assert(lb.getTemplate(id) === tb.getTemplate(id), `getTemplate(${id}) diverges`)
  }

  // getAllMenuIds sorted
  const aIds = lb.getAllMenuIds().sort()
  const bIds = tb.getAllMenuIds().sort()
  const diffIds = deepEqual(aIds, bIds)
  if (diffIds) throw new Error(`getAllMenuIds diverges: ${diffIds}`)

  // delete
  lb.delete("ccs-baidu")
  tb.delete("ccs-baidu")
  assert(lb.has("ccs-baidu") === false && tb.has("ccs-baidu") === false, "delete should remove")

  // clear
  lb.clear()
  tb.clear()
  assert(lb.templates.size === 0 && tb.templates.size === 0, "clear should empty")

  // loadFromConfig
  const config = {
    groups: [
      { items: [
        { id: "ccs-a", urlPattern: "https://a/?q=${KEYWORD}" },
        { id: "ccs-b", children: [{ id: "ccs-b1", urlPattern: "https://b1/?q=${KEYWORD}" }] }
      ]}
    ]
  }
  const lCount = lb.loadFromConfig(config)
  const tCount = tb.loadFromConfig(config)
  assert(lCount === tCount, `loadFromConfig count diverges: ${lCount} vs ${tCount}`)
  assert(lb.has("ccs-a") && tb.has("ccs-a"), "loadFromConfig top-level")
  assert(lb.has("ccs-b1") && tb.has("ccs-b1"), "loadFromConfig nested")
}

// ============================================================================
// MenuRegistry 比较（纯函数部分）
// ============================================================================

function compareMenuRegistry(LegacyCtor, PortedCtor) {
  const lr = new LegacyCtor()
  const tr = new PortedCtor()

  const configs = [
    { id: "x-label", title: "X" },                                  // auto-sync via -label
    { id: "y-static", title: "Y" },                                 // not synced
    { id: "z-tpl", title: "Z", titleTemplate: "Z ${keyword}" },    // synced via tpl
    { id: "g-grouped", title: "G", syncGroup: "main" },            // synced via group
    { id: "force-yes", title: "F", autoSync: true },               // explicit yes
    { id: "force-no", title: "N", autoSync: false, titleTemplate: "X ${keyword}" } // explicit no
  ]
  for (const c of configs) {
    lr.register(c)
    tr.register({ ...c })
  }

  // syncableItems
  const lSync = [...lr.syncableItems].sort()
  const tSync = [...tr.syncableItems].sort()
  const diffSync = deepEqual(lSync, tSync)
  if (diffSync) throw new Error(`syncableItems diverges: ${diffSync}`)

  // has / get
  for (const id of ["x-label", "force-no", "not-exist"]) {
    assert(lr.has(id) === tr.has(id), `has(${id}) diverges`)
    const lg = lr.get(id), tg = tr.get(id)
    if ((lg === undefined) !== (tg === undefined)) {
      throw new Error(`get(${id}) undefined diverges`)
    }
  }

  // renderTitle
  const ctx = { keyword: "test", raw: "test raw", normalized: "test_norm" }
  for (const c of configs) {
    const a = lr.renderTitle(c, ctx)
    const b = tr.renderTitle(c, ctx)
    assert(a === b, `renderTitle(${c.id}) diverges: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
  }

  // 空 ctx
  for (const c of configs) {
    const a = lr.renderTitle(c, {})
    const b = tr.renderTitle(c, {})
    assert(a === b, `renderTitle(${c.id}) empty ctx diverges: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
  }

  // getStats
  const aStats = lr.getStats()
  const bStats = tr.getStats()
  // groupDetails 顺序在 Map 上是插入顺序，两边一致
  const diffStats = deepEqual(
    { ...aStats, groupDetails: [...aStats.groupDetails].sort((x, y) => x.name.localeCompare(y.name)) },
    { ...bStats, groupDetails: [...bStats.groupDetails].sort((x, y) => x.name.localeCompare(y.name)) }
  )
  if (diffStats) throw new Error(`getStats diverges: ${diffStats}`)

  // unregister
  lr.unregister("force-yes")
  tr.unregister("force-yes")
  assert(!lr.has("force-yes") && !tr.has("force-yes"), "unregister")

  // clear
  lr.clear()
  tr.clear()
  assert(lr.items.size === 0 && tr.items.size === 0, "clear")
}

// ============================================================================
// AITaskRegistry 比较（纯函数：TASK_DEFINITIONS / resolveMenuId / listTaskDefinitions / normalize / buildPromptFromTask）
// ============================================================================

function compareAITaskRegistry(legacy, ported) {
  // TASK_DEFINITIONS 字段镜像
  const diffDefs = deepEqual({ ...legacy.TASK_DEFINITIONS }, { ...ported.TASK_DEFINITIONS })
  if (diffDefs) throw new Error(`TASK_DEFINITIONS diverges: ${diffDefs}`)

  // listTaskDefinitions
  const a = legacy.listTaskDefinitions()
  const b = ported.listTaskDefinitions()
  const diffList = deepEqual(a, b)
  if (diffList) throw new Error(`listTaskDefinitions diverges: ${diffList}`)

  // resolveMenuId 覆盖
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
  for (const m of menuIds) {
    const la = legacy.resolveMenuId(m)
    const tb = ported.resolveMenuId(m)
    const diff = deepEqual(la, tb)
    if (diff) throw new Error(`resolveMenuId(${JSON.stringify(m)}) diverges: ${diff}`)
  }

  // 用真实 prompts json 跑 normalize + buildPromptFromTask
  const rawFastqa = JSON.parse(fs.readFileSync(path.join(root, "prompts/fastAnswersPrompts.json"), "utf8"))
  const def = legacy.TASK_DEFINITIONS.fastqa
  const taskLegacy = (() => {
    // legacy _normalize 是闭包内私有；通过 loadTask 的 cache 不太方便。
    // 这里改用：直接调用 buildTaskPrompt 接口对比就够 — 它会用 fetcher 拉 prompt。
    return null
  })()

  // 对 buildPromptFromTask 用 TS normalize 出的 task 跑两条等效逻辑：
  const task = ported.normalizeTask(def, rawFastqa)

  for (const [kw, opts] of [
    ["hello", {}],
    ["", {}],
    ["complex 中文 query", {}],
    ["x", { vars: { ratio: "9:16" } }]
  ]) {
    const prompt = ported.buildPromptFromTask(task, kw, opts)
    if (prompt == null) throw new Error(`TS buildPromptFromTask returned null on kw="${kw}"`)
    assert(prompt.includes(kw) || kw === "", `TS buildPromptFromTask must contain keyword`)
    assert(prompt.includes("简体中文"), "TS fastqa prompt must default to Simplified Chinese")
    assert(!prompt.includes("${outputLanguage}"), "TS fastqa prompt leaked output-language placeholder")
  }

  const localizedPrompt = ported.buildPromptFromTask(task, "hello", { outputLanguage: "English" })
  assert(localizedPrompt?.includes("English"), "TS fastqa prompt language override missing")
  assert(!localizedPrompt?.includes("${outputLanguage}"), "TS fastqa language override leaked placeholder")
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const legacyGlobals = loadLegacyGlobals()
  const loadTs = createTsLoader()

  const tsMenuIds = loadTs(path.join(root, "src/background/menuIds.ts"))
  const tsURLBuilder = loadTs(path.join(root, "src/background/URLBuilder.ts"))
  const tsMenuRegistry = loadTs(path.join(root, "src/background/MenuRegistry.ts"))
  const tsAITask = loadTs(path.join(root, "src/background/tasks/AITaskRegistry.ts"))

  // legacy menuIds: 这个文件是个 .js 但只 declare globals 没 globalThis. 让 it expose via context
  // ---- legacy menuIds 检查：从 globalThis 拿不到 MENU_IDS（legacy 没 export 到 globalThis）
  // 重新单独跑一次 legacy menuIds.js 把它 expose 出来
  const legacyMenuIdsCtx = { globalThis: {}, console }
  legacyMenuIdsCtx.window = legacyMenuIdsCtx.globalThis
  legacyMenuIdsCtx.self = legacyMenuIdsCtx.globalThis
  vm.createContext(legacyMenuIdsCtx)
  // 包一层把 const 暴露成 context 变量
  const menuIdsSource = fs.readFileSync(path.join(root, "background/menuIds.js"), "utf8") +
    "\nthis.MENU_IDS = MENU_IDS; this.MENU_ID_GROUPS = MENU_ID_GROUPS; this.MENU_ID_PREFIXES = MENU_ID_PREFIXES;\nthis.hasMenuIdPrefix = hasMenuIdPrefix; this.isTop100Menu = isTop100Menu; this.isFastQAMenu = isFastQAMenu; this.isOptimizeMenu = isOptimizeMenu; this.needsDynamicTitle = needsDynamicTitle; this.getAllMenuIds = getAllMenuIds; this.isValidMenuId = isValidMenuId; this.getMenuIdByConstant = getMenuIdByConstant; this.getConstantByMenuId = getConstantByMenuId;"
  vm.runInContext(menuIdsSource, legacyMenuIdsCtx)
  compareMenuIds(legacyMenuIdsCtx, tsMenuIds)

  // URLBuilder
  const LegacyURLBuilder = legacyGlobals.URLBuilder
  if (!LegacyURLBuilder) throw new Error("legacy URLBuilder not exposed on globalThis")
  compareURLBuilder(LegacyURLBuilder, tsURLBuilder.URLBuilder || tsURLBuilder.default)

  // MenuRegistry
  const LegacyMenuRegistry = legacyGlobals.MenuRegistry
  if (!LegacyMenuRegistry) throw new Error("legacy MenuRegistry not exposed on globalThis")
  compareMenuRegistry(LegacyMenuRegistry, tsMenuRegistry.MenuRegistry || tsMenuRegistry.default)

  // AITaskRegistry
  const LegacyAITask = legacyGlobals.AITaskRegistry
  if (!LegacyAITask) throw new Error("legacy AITaskRegistry not exposed on globalThis")
  compareAITaskRegistry(LegacyAITask, tsAITask.AITaskRegistry || tsAITask.default)

  console.log("[verify-background-pure-modules-dual] menuIds + URLBuilder + MenuRegistry + AITaskRegistry OK")
}

main()
