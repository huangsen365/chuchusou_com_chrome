#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import vm from "node:vm"

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
  const builderPath = path.join(root, "shared/menuStructureBuilder.js")
  const context = { globalThis: {}, console }
  context.window = context.globalThis
  context.self = context.globalThis
  vm.createContext(context)
  vm.runInContext(fs.readFileSync(builderPath, "utf8"), context, { filename: builderPath })
  return context.globalThis.CCSMenuStructureBuilder
}

function enabledSourceItems(unifiedConfig) {
  return unifiedConfig.groups.flatMap((group) => flattenItems(group.items || [])).filter((item) => item.enabled !== false)
}

function main() {
  const builder = loadBuilder()
  assert(builder?.build, "CCSMenuStructureBuilder.build must be exported")

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

  console.log(`[verify-menu-structure-builder] ${structure.groups.length} groups, ${builtIds.length} items OK`)
}

main()
