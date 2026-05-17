#!/usr/bin/env node
/**
 * popup 菜单结构预编译
 *
 * 编译时把 6 个 JSON config 跑一遍 CCSMenuStructureBuilder，输出
 * `popup/popup-menu-prebuilt.json` 单文件。popup 启动时优先 fetch 这一个文件
 * （~5-15ms），fallback 才是 6 个 fetch + builder（~30-50ms）。
 *
 * 二选一的考量：
 *  - 预编译产物体积约 30-50KB，对 popup 来说是一次性加载
 *  - 不依赖 SW（不像之前的 storage prewarm 路径）
 *  - 与 popup.html 静态骨架配合：骨架先出，prebuilt 拉回来后补差异
 *
 * 输出：popup/popup-menu-prebuilt.json + build/chrome-mv3-prod/popup/popup-menu-prebuilt.json
 * 失败时不中断 build —— popup 仍有 6 fetch + builder fallback。
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import vm from "node:vm"

const root = process.cwd()
const buildDir = path.resolve(root, process.argv[2] || "build/chrome-mv3-prod")

function loadJSON(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"))
  } catch (e) {
    console.warn(`[prebuild-popup-menu] 加载 ${rel} 失败:`, e.message)
    return null
  }
}

function loadBuilder() {
  const src = fs.readFileSync(path.join(root, "shared/menuStructureBuilder.js"), "utf8")
  const sandbox = { globalThis: {}, console }
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox)
  return sandbox.globalThis.CCSMenuStructureBuilder
}

function main() {
  const builder = loadBuilder()
  if (!builder || typeof builder.build !== "function") {
    console.warn("[prebuild-popup-menu] menuStructureBuilder 未导出 build")
    process.exit(0)
  }

  const unifiedConfig = loadJSON("config/unifiedMenuConfig.json")
  const enginesConfig = loadJSON("config/engines.json")
  const top100Config = loadJSON("prompts/topQuestionsPrompts.json")
  const fastqaConfig = loadJSON("prompts/fastAnswersPrompts.json")
  const optimizeConfig = loadJSON("prompts/optimizedPrompts.json")
  const coverConfig = loadJSON("prompts/coverPrompts.json")

  if (!unifiedConfig) {
    console.warn("[prebuild-popup-menu] unifiedMenuConfig 缺失，跳过")
    process.exit(0)
  }

  const structure = builder.build({
    unifiedConfig,
    enginesConfig,
    top100Config,
    fastqaConfig,
    optimizeConfig,
    coverConfig
  })

  if (!structure || !Array.isArray(structure.groups) || structure.groups.length === 0) {
    console.warn("[prebuild-popup-menu] builder 输出空 structure，跳过")
    process.exit(0)
  }

  const manifestVersion = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"))?.version || "0.0.0" } catch (_) { return "0.0.0" }
  })()

  // v1.6.19 Step 6: 把 coverConfig 也内联，让 popup initPinnedCover 不必再发
  // 一次 fetch(prompts/coverPrompts.json) —— popup 启动总 fetch 数从 2 降到 1。
  const out = {
    version: manifestVersion,
    builtAt: new Date().toISOString(),
    structure,
    coverConfig
  }

  const json = JSON.stringify(out)
  const sizeKB = (json.length / 1024).toFixed(1)

  // 仅写 build 产物（zip 上架用）—— 源目录保持干净。
  // plasmo dev / 源目录直接运行 popup 时，prebuilt 路径会读不到，自动 fallback
  // 到 6 fetch + builder 路径（与 v1.6.18 之前等价，dev 不需要这个优化）。
  const buildPath = path.join(buildDir, "popup/popup-menu-prebuilt.json")
  if (fs.existsSync(path.dirname(buildPath))) {
    fs.writeFileSync(buildPath, json, "utf8")
    console.log(`[prebuild-popup-menu] ✓ ${structure.groups.length} groups, ${sizeKB}KB → ${path.relative(root, buildPath)}`)
  } else {
    console.warn(`[prebuild-popup-menu] ⚠ ${path.dirname(buildPath)} 不存在，跳过`)
  }
}

main()
