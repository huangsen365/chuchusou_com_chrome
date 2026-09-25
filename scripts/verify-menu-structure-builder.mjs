#!/usr/bin/env node
/**
 * popup / sidepanel 菜单结构构建器回归：src/shared/menuStructureBuilder.ts 是唯一实现
 * （SW 的 getMenuStructure 经 popupMenuStructure.ts 调它；build 期 prebuild-popup-menu.mjs
 * 也用它把菜单预渲染进 popup.html / sidepanel.html）。用真实 config + 多种开关场景跑一遍。
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import vm from "node:vm"
import { createTsLoader } from "./lib/tsLoader.mjs"

const root = process.cwd()

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function flattenItems(items) {
  return items.flatMap((item) => [item, ...(item.children ? flattenItems(item.children) : [])])
}

function loadBuilder() {
  const loadTs = createTsLoader()
  return loadTs(path.join(root, "src/shared/menuStructureBuilder.ts")).CCSMenuStructureBuilder
}

// 右键菜单（background/utils/Constants.js）与 popup/sidepanel（本 builder）各有一份标题表，必须逐字一致
function loadSwConstants() {
  const context = { chrome: { storage: { local: { get: (_keys, cb) => cb({}) } } }, console: { log() {}, warn() {} } }
  context.globalThis = context
  vm.createContext(context)
  const abs = path.join(root, "background/utils/Constants.js")
  vm.runInContext(fs.readFileSync(abs, "utf8"), context, { filename: abs })
  return context
}

function assertTablesMatch(builder) {
  const constants = loadSwConstants()
  const pairs = [
    ["MENU_DEFS", builder.MENU_DEFS, "MENU_DEFINITIONS", constants.MENU_DEFINITIONS],
    ["OPTIMIZE_TITLES", builder.OPTIMIZE_TITLES, "OPTIMIZE_CATEGORY_TITLES", constants.OPTIMIZE_CATEGORY_TITLES],
    ["COVER_TITLES", builder.COVER_TITLES, "COVER_CATEGORY_TITLES", constants.COVER_CATEGORY_TITLES]
  ]
  for (const [builderName, builderTable, constantsName, constantsTable] of pairs) {
    const ids = new Set([...Object.keys(builderTable), ...Object.keys(constantsTable)])
    for (const id of ids) {
      assert(JSON.stringify(builderTable[id]) === JSON.stringify(constantsTable[id]),
        `${builderName}["${id}"] (menuStructureBuilder.ts) = ${JSON.stringify(builderTable[id])} 与 Constants.js ${constantsName} = ${JSON.stringify(constantsTable[id])} 不一致`)
    }
  }
  const quick = (items) => JSON.stringify(items.map(({ id, engineId, menuTitle, menuIcon }) => ({ id, engineId, menuTitle, menuIcon })))
  assert(quick(builder.FAST_QA_QUICK) === quick(constants.FAST_QA_QUICK_ITEMS),
    "FAST_QA_QUICK (menuStructureBuilder.ts) 与 Constants.js FAST_QA_QUICK_ITEMS 不一致")
}

function enabledSourceItems(unifiedConfig) {
  return unifiedConfig.groups.flatMap((group) => flattenItems(group.items || [])).filter((item) => item.enabled !== false)
}

function main() {
  const builder = loadBuilder()
  assert(builder?.build, "CCSMenuStructureBuilder.build must be exported")
  assertTablesMatch(builder)

  const unifiedConfig = readJson("config/unifiedMenuConfig.json")
  const enginesConfig = readJson("config/engines.json")
  const top100Config = readJson("prompts/topQuestionsPrompts.json")
  const fastqaConfig = readJson("prompts/fastAnswersPrompts.json")
  const optimizeConfig = readJson("prompts/optimizedPrompts.json")
  const coverConfig = readJson("prompts/coverPrompts.json")

  const structure = builder.build({
    unifiedConfig,
    enginesConfig,
    top100Config,
    fastqaConfig,
    optimizeConfig,
    coverConfig
  })

  assert(Array.isArray(structure.groups) && structure.groups.length > 0, "builder must return non-empty groups")

  const builtItems = structure.groups.flatMap((group) => flattenItems(group.items || []))
  const builtIds = builtItems.map((item) => item.id)
  const duplicateBuiltIds = builtIds.filter((id, index) => builtIds.indexOf(id) !== index)
  assert(duplicateBuiltIds.length === 0, `builder returned duplicate ids: ${[...new Set(duplicateBuiltIds)].join(", ")}`)

  for (const group of structure.groups) {
    assert(group.id, "builder group missing id")
    assert(Array.isArray(group.items) && group.items.length > 0, `builder group ${group.id} must contain items`)
    for (const item of flattenItems(group.items)) {
      assert(item.id, `builder item missing id in group ${group.id}`)
      assert(item.title, `builder item ${item.id} missing title`)
      assert(item.type, `builder item ${item.id} missing type`)
    }
  }

  const sourceIds = new Set(enabledSourceItems(unifiedConfig).map((item) => item.id))
  const builtIdSet = new Set(builtIds)
  const missingSourceIds = [...sourceIds].filter((id) => !builtIdSet.has(id))
  assert(missingSourceIds.length === 0, `enabled unified menu ids missing from builder output: ${missingSourceIds.join(", ")}`)

  const canonicalGroupOrder = ["fastQaQuick", "search", "ai", "general", "advanced", "tool", "transform", "panel"]
  let previousOrderIndex = -1
  for (const groupId of structure.groups.map((group) => group.id)) {
    const orderIndex = canonicalGroupOrder.indexOf(groupId)
    assert(orderIndex !== -1, `builder returned unknown group id: ${groupId}`)
    assert(orderIndex > previousOrderIndex, `builder group order drifted: ${structure.groups.map((group) => group.id).join(",")}`)
    previousOrderIndex = orderIndex
  }

  const disabledId = "ccs-google"
  const disabledStructure = builder.build({
    unifiedConfig,
    enginesConfig,
    top100Config,
    fastqaConfig,
    optimizeConfig,
    coverConfig,
    toggleConfig: { [disabledId]: false }
  })
  const disabledIds = new Set(disabledStructure.groups.flatMap((group) => flattenItems(group.items || [])).map((item) => item.id))
  assert(!disabledIds.has(disabledId), "explicit toggleConfig=false must hide matching menu item")

  const fullOpts = { unifiedConfig, enginesConfig, top100Config, fastqaConfig, optimizeConfig, coverConfig }
  const idsOf = (out) => new Set(out.groups.flatMap((group) => flattenItems(group.items || [])).map((item) => item.id))

  // 无 unified config / 无开关：全部启用，仍产出分组
  const noToggles = builder.build({ ...fullOpts, unifiedConfig: null, toggleConfig: null })
  assert(noToggles.groups.length > 0, "builder without unified config must still produce groups")

  // 关掉 advanced 的四个根：对应子树整体消失
  const advancedRoots = ["ccs-top100-root", "ccs-fastqa-root", "ccs-optimize-root", "ccs-cover-root"]
  const noAdvanced = idsOf(builder.build({ ...fullOpts, toggleConfig: Object.fromEntries(advancedRoots.map((id) => [id, false])) }))
  for (const id of advancedRoots) assert(!noAdvanced.has(id), `toggleConfig=false must hide ${id}`)

  // 只留速答快捷项 + 面板开关
  const onlyQuickToggle = {}
  for (const group of unifiedConfig.groups || []) {
    for (const item of group.items || []) {
      if (item?.id?.startsWith("ccs-fastqa-") && item.id.endsWith("-quick")) continue
      if (item?.id === "ccs-show-popover") continue
      onlyQuickToggle[item.id] = false
      for (const child of item.children || []) onlyQuickToggle[child.id] = false
    }
  }
  const onlyQuick = builder.build({ ...fullOpts, toggleConfig: onlyQuickToggle })
  const onlyQuickGroups = onlyQuick.groups.map((group) => group.id).join(",")
  assert(onlyQuickGroups === "fastQaQuick,panel", `only-quick toggles should leave fastQaQuick,panel — got ${onlyQuickGroups}`)

  // prompt 配置全空：advanced 组不出现
  const emptyAdvanced = builder.build({ unifiedConfig, enginesConfig, top100Config: null, fastqaConfig: null, optimizeConfig: null, coverConfig: null })
  assert(!emptyAdvanced.groups.some((group) => group.id === "advanced"), "empty prompt configs must drop advanced group")

  // 缺 engines.json：标题走 fallback，结构不变
  const noEngines = builder.build({ ...fullOpts, enginesConfig: null })
  assert(noEngines.groups.length === structure.groups.length, "missing engines config must keep the same groups")
  for (const item of noEngines.groups.flatMap((group) => flattenItems(group.items || []))) {
    assert(item.title, `missing engines config left ${item.id} without a title`)
  }

  console.log(`[verify-menu-structure-builder] ${structure.groups.length} groups, ${builtIds.length} items OK`)
}

main()
