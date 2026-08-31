#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const root = process.cwd()
const WENXIN_ENTRY_URL = "https://chat.baidu.com/"

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"))
}

function stableJson(value) {
  return JSON.stringify(value)
}

function assertJsonMirror(sourcePath, mirrorPath) {
  const source = readJson(sourcePath)
  const mirror = readJson(mirrorPath)
  assert(stableJson(source) === stableJson(mirror), `${mirrorPath} must mirror ${sourcePath}`)
  return mirror
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function flattenItems(items) {
  return items.flatMap((item) => [item, ...(item.children ? flattenItems(item.children) : [])])
}

function main() {
  const unified = assertJsonMirror("config/unifiedMenuConfig.json", "src/assets-json/config/unifiedMenuConfig.json")
  const engines = assertJsonMirror("config/engines.json", "src/assets-json/config/engines.json")
  const promptFiles = [
    { source: "prompts/fastAnswersPrompts.json", mirror: "src/assets-json/prompts/fastAnswersPrompts.json", validateEngineRefs: true },
    { source: "prompts/topQuestionsPrompts.json", mirror: "src/assets-json/prompts/topQuestionsPrompts.json", validateEngineRefs: true },
    { source: "prompts/optimizedPrompts.json", mirror: "src/assets-json/prompts/optimizedPrompts.json", validateEngineRefs: true },
    { source: "prompts/coverPrompts.json", mirror: "src/assets-json/prompts/coverPrompts.json", validateEngineRefs: false }
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
      if (item.engineId === "yiyan" || item.id.includes("yiyan")) {
        assert(item.urlPattern === WENXIN_ENTRY_URL, `Menu item ${item.id} must use the official Wenxin relay entry`)
        continue
      }
      const hasKnownToken = ["${KEYWORD}", "${keyword}", "${PROMPT}", "${prompt}"].some((token) => item.urlPattern.includes(token))
      assert(hasKnownToken, `Menu item ${item.id} urlPattern has no known interpolation token`)
    }
  }
  assert(duplicateIds.length === 0, `Duplicate menu ids: ${duplicateIds.join(", ")}`)

  for (const [engineId, engine] of Object.entries(engines.engines)) {
    assert(engine.id === engineId, `Engine key/id mismatch: ${engineId} vs ${engine.id}`)
    assert(engine.label, `Engine ${engineId} missing label`)
    if (engineId === "yiyan") {
      assert(engine.urlPattern === WENXIN_ENTRY_URL, "Engine yiyan must use the official Wenxin relay entry")
      assert(engine.searchUrlPattern === WENXIN_ENTRY_URL, "Engine yiyan search URL must use the official Wenxin relay entry")
    } else {
      assert(engine.urlPattern?.includes("${PROMPT}"), `Engine ${engineId} urlPattern must include \${PROMPT}`)
    }
  }

  for (const { source: promptFile, mirror: mirrorPromptFile, validateEngineRefs } of promptFiles) {
    const prompt = assertJsonMirror(promptFile, mirrorPromptFile)
    assert(Array.isArray(prompt.templateLines) && prompt.templateLines.length > 0, `${promptFile} templateLines must be non-empty`)
    const promptTemplate = prompt.templateLines.join("\n")
    assert(promptTemplate.includes("${input}"), `${promptFile} template must include \${input}`)
    if (promptFile === "prompts/fastAnswersPrompts.json") {
      assert(promptTemplate.split("${outputLanguage}").length - 1 === 1, "fast answers must contain one output-language placeholder")
      assert(promptTemplate.includes("无论输入素材使用何种语言"), "fast answers must handle foreign-language source material")
      assert(promptTemplate.includes("短篇回答、中篇回答以及后续 A/B 生成的全部正文"), "fast answers language rule must cover short, medium and follow-up output")
      assert(promptTemplate.includes("第一轮回复必须恰好包含两个彼此独立的 writing block"), "fast answers must require two independent writing blocks")
      assert(promptTemplate.includes("在 writing block 之外输出标题：【短篇回答】"), "short answer label must stay outside its writing block")
      assert(promptTemplate.includes("在 writing block 之外输出标题：【中篇回答】"), "medium answer label must stay outside its writing block")
      assert(promptTemplate.includes("在所有 writing block 之外输出以下两个选项"), "A/B options must stay outside writing blocks")
      assert(promptTemplate.includes("用户选择 A："), "fast answers must define the A follow-up")
      assert(promptTemplate.includes("用户选择 B："), "fast answers must define the B follow-up")
    }
    const promptEngines = [
      ...(prompt.engines || []),
      ...(prompt.categories || []).flatMap((category) => category.engines || [])
    ]
    assert(promptEngines.length > 0, `${promptFile} engines/categories must be non-empty`)
    if (validateEngineRefs) {
      for (const promptEngine of promptEngines) {
        assert(engines.engines[promptEngine.id], `${promptFile} references missing engine ${promptEngine.id}`)
      }
    }
  }

  console.log(`[verify-shared-config] ${allItems.length} menu items, ${Object.keys(engines.engines).length} engines, ${promptFiles.length} prompt configs OK`)
}

main()
