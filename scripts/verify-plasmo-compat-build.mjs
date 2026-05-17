#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { execFileSync } from "node:child_process"

const projectRoot = process.cwd()
const buildDir = path.resolve(projectRoot, process.argv[2] || "build/chrome-mv3-prod")
const legacyManifestPath = path.join(projectRoot, "manifest.json")
const buildManifestPath = path.join(buildDir, "manifest.json")

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function collectManifestPaths(manifest) {
  const paths = []

  if (manifest.background?.service_worker) paths.push(manifest.background.service_worker)

  for (const script of manifest.content_scripts || []) {
    paths.push(...(script.js || []), ...(script.css || []))
  }

  if (manifest.action?.default_popup) paths.push(manifest.action.default_popup)
  for (const icon of Object.values(manifest.action?.default_icon || {})) paths.push(icon)
  for (const icon of Object.values(manifest.icons || {})) paths.push(icon)

  if (manifest.side_panel?.default_path) paths.push(manifest.side_panel.default_path)

  return [...new Set(paths)]
}

function main() {
  assert(fs.existsSync(buildDir), `Missing build directory: ${buildDir}`)
  assert(fs.existsSync(buildManifestPath), `Missing build manifest: ${buildManifestPath}`)

  const legacyManifest = readJson(legacyManifestPath)
  const buildManifest = readJson(buildManifestPath)
  const packageJson = readJson(path.join(projectRoot, "package.json"))

  assert(buildManifest.manifest_version === 3, "Build manifest must be MV3")
  assert(buildManifest.version === packageJson.version, `Build version ${buildManifest.version} != package version ${packageJson.version}`)
  assert(buildManifest.name === legacyManifest.name, "Build manifest name drifted from legacy manifest")
  assert(buildManifest.description === legacyManifest.description, "Build manifest description drifted from legacy manifest")
  // SW 入口允许两种合法值：
  //   1. legacy `background/index.js`（manifest 未切到 Plasmo 时）
  //   2. Plasmo 的 `static/background/index.js`（src/background.ts 已接管 SW）
  // 不允许其它路径漂移。无论哪种，SW 文件必须真实存在于 build dir。
  const sw = buildManifest.background?.service_worker
  const allowedSw = new Set([
    legacyManifest.background?.service_worker,
    "static/background/index.js"
  ])
  assert(sw && allowedSw.has(sw), `Background entrypoint drifted: ${sw}`)
  assert(fs.existsSync(path.join(buildDir, sw)), `Background SW file missing: ${sw}`)
  // Popup 入口允许 legacy `popup/popup.html` 或 Plasmo `popup.html`
  const pp = buildManifest.action?.default_popup
  const allowedPp = new Set([
    legacyManifest.action?.default_popup,
    "popup.html"
  ])
  assert(pp && allowedPp.has(pp), `Popup entrypoint drifted: ${pp}`)
  assert(fs.existsSync(path.join(buildDir, pp)), `Popup HTML missing: ${pp}`)
  // Side panel 入口允许：legacy `sidepanel/sidepanel.html` 或 Plasmo `sidepanel.html`
  const sp = buildManifest.side_panel?.default_path
  const allowedSp = new Set([
    legacyManifest.side_panel?.default_path,
    "sidepanel.html"
  ])
  assert(sp && allowedSp.has(sp), `Side panel entrypoint drifted: ${sp}`)
  assert(fs.existsSync(path.join(buildDir, sp)), `Side panel HTML missing: ${sp}`)

  const requiredPaths = collectManifestPaths(buildManifest)
  const missingManifestAssets = requiredPaths.filter((relativePath) => !fs.existsSync(path.join(buildDir, relativePath)))
  assert(missingManifestAssets.length === 0, `Missing manifest assets:\n${missingManifestAssets.join("\n")}`)

  const stableAssets = [
    "config/unifiedMenuConfig.json",
    "config/engines.json",
    "prompts/fastAnswersPrompts.json",
    "prompts/topQuestionsPrompts.json",
    "prompts/optimizedPrompts.json",
    "shared/logger.js",
    "shared/runtimeClient.js",
    "shared/storageDefaults.js",
    "shared/menuStructureBuilder.js",
    "offscreen/voice.html",
    "voice-permission/permission.html",
    "welcome/welcome.html",
    "members/members.html"
  ]

  const missingStableAssets = stableAssets.filter((relativePath) => !fs.existsSync(path.join(buildDir, relativePath)))
  assert(missingStableAssets.length === 0, `Missing stable assets:\n${missingStableAssets.join("\n")}`)

  for (const jsPath of [
    "background/index.js",
    "content.js",
    "popup/popup.js",
    "sidepanel/sidepanel.js"
  ]) {
    execFileSync(process.execPath, ["--check", path.join(buildDir, jsPath)], { stdio: "pipe" })
  }

  console.log("[verify-plasmo-compat] build manifest and stable assets OK")
  console.log(`[verify-plasmo-compat] ${requiredPaths.length} manifest-referenced files present`)
}

main()
