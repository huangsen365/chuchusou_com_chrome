#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"

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

function main() {
  const unified = readJson("config/unifiedMenuConfig.json")
  const engines = readJson("config/engines.json")
  const promptFiles = [
    "prompts/fastAnswersPrompts.json",
    "prompts/topQuestionsPrompts.json",
    "prompts/optimizedPrompts.json"
  ]

  assert(unified.root?.id === "ccs-main", "unified menu root id must remain ccs-main")
  assert(Array.isArray(unified.groups) && unified.groups.length > 0, "unified menu groups must be non-empty")
  assert(engines.engines && typeof engines.engines === "object", "engines map must exist")

  const allItems = unified.groups.flatMap((group) => flattenItems(group.items || []))
  const ids = new Set()
  const duplicateIds = []
  for (const item of allItems) {
    if (!item.id) throw new Error(`Menu item without id: ${JSON.stringify(item)}`)
    if (ids.has(item.id)) duplicateIds.push(item.id)
    ids.add(item.id)

    if (item.engineId) {
      assert(engines.engines[item.engineId], `Menu item ${item.id} references missing engineId ${item.engineId}`)
    }

    if (item.urlPattern) {
      const hasKnownToken = ["${KEYWORD}", "${keyword}", "${PROMPT}", "${prompt}"].some((token) => item.urlPattern.includes(token))
      assert(hasKnownToken, `Menu item ${item.id} urlPattern has no known interpolation token`)
    }
  }
  assert(duplicateIds.length === 0, `Duplicate menu ids: ${duplicateIds.join(", ")}`)

  for (const [engineId, engine] of Object.entries(engines.engines)) {
    assert(engine.id === engineId, `Engine key/id mismatch: ${engineId} vs ${engine.id}`)
    assert(engine.label, `Engine ${engineId} missing label`)
    assert(engine.urlPattern?.includes("${PROMPT}"), `Engine ${engineId} urlPattern must include \${PROMPT}`)
  }

  for (const promptFile of promptFiles) {
    const prompt = readJson(promptFile)
    assert(Array.isArray(prompt.templateLines) && prompt.templateLines.length > 0, `${promptFile} templateLines must be non-empty`)
    assert(prompt.templateLines.join("\n").includes("${input}"), `${promptFile} template must include \${input}`)
    const promptEngines = [
      ...(prompt.engines || []),
      ...(prompt.categories || []).flatMap((category) => category.engines || [])
    ]
    assert(promptEngines.length > 0, `${promptFile} engines/categories must be non-empty`)
    for (const promptEngine of promptEngines) {
      assert(engines.engines[promptEngine.id], `${promptFile} references missing engine ${promptEngine.id}`)
    }
  }

  console.log(`[verify-shared-config] ${allItems.length} menu items, ${Object.keys(engines.engines).length} engines, ${promptFiles.length} prompt configs OK`)
}

main()
