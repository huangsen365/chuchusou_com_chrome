#!/usr/bin/env node
/**
 * Dual-run verifier: legacy UMD builder (shared/menuStructureBuilder.js)
 * vs. TS port (src/shared/menuStructureBuilder.ts).
 *
 * 两个 builder 用同一组真实 config 跑多组场景（默认 / 全启用 / 单项禁用 /
 * advanced 全关 / 仅 fastQaQuick），输出必须 deep-equal。
 *
 * 任意一组场景不一致即视为 SSoT 漂移，CI 立即失败。
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import vm from "node:vm"
import ts from "typescript"

const root = process.cwd()

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function loadLegacyBuilder() {
  const builderPath = path.join(root, "shared/menuStructureBuilder.js")
  const context = { globalThis: {}, console }
  context.window = context.globalThis
  context.self = context.globalThis
  vm.createContext(context)
  vm.runInContext(fs.readFileSync(builderPath, "utf8"), context, { filename: builderPath })
  return context.globalThis.CCSMenuStructureBuilder
}

function loadTsBuilder() {
  const tsPath = path.join(root, "src/shared/menuStructureBuilder.ts")
  const tsSource = fs.readFileSync(tsPath, "utf8")
  const compiled = ts.transpileModule(tsSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
      esModuleInterop: true,
      isolatedModules: true
    },
    fileName: tsPath
  })

  const moduleObj = { exports: {} }
  const context = {
    module: moduleObj,
    exports: moduleObj.exports,
    require: () => ({}),
    console
  }
  vm.createContext(context)
  vm.runInContext(compiled.outputText, context, { filename: tsPath })

  const builder = moduleObj.exports.CCSMenuStructureBuilder || moduleObj.exports.default
  assert(builder?.build, "TS builder must export CCSMenuStructureBuilder.build")
  return builder
}

function deepEqual(a, b, pathStr = "") {
  if (a === b) return null
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

function runScenario(name, legacyBuilder, tsBuilder, opts) {
  const legacyOut = legacyBuilder.build(opts)
  const tsOut = tsBuilder.build(opts)
  const diff = deepEqual(legacyOut, tsOut)
  if (diff) {
    throw new Error(`Scenario "${name}" diverges: ${diff}`)
  }
  return tsOut
}

function main() {
  const legacyBuilder = loadLegacyBuilder()
  const tsBuilder = loadTsBuilder()

  // 常量表必须 1:1 镜像（防止 SSoT 漂移）
  const constantPairs = [
    ["MENU_DEFS", legacyBuilder.MENU_DEFS, tsBuilder.MENU_DEFS],
    ["FAST_QA_QUICK", legacyBuilder.FAST_QA_QUICK, tsBuilder.FAST_QA_QUICK],
    ["OPTIMIZE_TITLES", legacyBuilder.OPTIMIZE_TITLES, tsBuilder.OPTIMIZE_TITLES],
    ["COVER_TITLES", legacyBuilder.COVER_TITLES, tsBuilder.COVER_TITLES]
  ]
  for (const [label, legacy, ported] of constantPairs) {
    const diff = deepEqual(legacy, ported)
    if (diff) throw new Error(`Constant table "${label}" diverges between legacy and TS: ${diff}`)
  }

  const unifiedConfig = readJson("config/unifiedMenuConfig.json")
  const enginesConfig = readJson("config/engines.json")
  const top100Config = readJson("prompts/topQuestionsPrompts.json")
  const fastqaConfig = readJson("prompts/fastAnswersPrompts.json")
  const optimizeConfig = readJson("prompts/optimizedPrompts.json")
  const coverConfig = readJson("prompts/coverPrompts.json")

  const fullOpts = {
    unifiedConfig,
    enginesConfig,
    top100Config,
    fastqaConfig,
    optimizeConfig,
    coverConfig
  }

  // 场景 1: 真实 unified config（生产路径）
  const defaultOut = runScenario("default-unified-config", legacyBuilder, tsBuilder, fullOpts)
  assert(Array.isArray(defaultOut.groups) && defaultOut.groups.length > 0, "default scenario must produce groups")

  // 场景 2: toggleConfig 留空（全部启用）
  runScenario("no-toggles", legacyBuilder, tsBuilder, {
    ...fullOpts,
    unifiedConfig: null,
    toggleConfig: null
  })

  // 场景 3: 禁用 ccs-google（叶子项）
  runScenario("disable-leaf-ccs-google", legacyBuilder, tsBuilder, {
    ...fullOpts,
    toggleConfig: { "ccs-google": false }
  })

  // 场景 4: 禁用整个 advanced 组的根节点
  runScenario("disable-advanced-roots", legacyBuilder, tsBuilder, {
    ...fullOpts,
    toggleConfig: {
      "ccs-top100-root": false,
      "ccs-fastqa-root": false,
      "ccs-optimize-root": false,
      "ccs-cover-root": false
    }
  })

  // 场景 5: 只剩 fastQaQuick + panel
  const onlyQuickToggle = {}
  for (const group of unifiedConfig.groups || []) {
    for (const item of group.items || []) {
      if (item?.id?.startsWith("ccs-fastqa-") && item.id.endsWith("-quick")) continue
      if (item?.id === "ccs-show-popover") continue
      onlyQuickToggle[item.id] = false
      for (const child of item.children || []) {
        onlyQuickToggle[child.id] = false
      }
    }
  }
  runScenario("only-fastqa-quick-and-panel", legacyBuilder, tsBuilder, {
    ...fullOpts,
    toggleConfig: onlyQuickToggle
  })

  // 场景 6: 空 prompt config（advanced 组应当不出现）
  const emptyAdvancedOut = runScenario("empty-prompt-configs", legacyBuilder, tsBuilder, {
    unifiedConfig,
    enginesConfig,
    top100Config: null,
    fastqaConfig: null,
    optimizeConfig: null,
    coverConfig: null
  })
  assert(!emptyAdvancedOut.groups.some((g) => g.id === "advanced"), "empty prompt configs must drop advanced group")

  // 场景 7: 缺 enginesConfig（label fallback 路径）
  runScenario("missing-engines-config", legacyBuilder, tsBuilder, {
    ...fullOpts,
    enginesConfig: null
  })

  console.log(`[verify-menu-structure-builder-dual] 7 scenarios + 4 constant tables OK`)
}

main()
