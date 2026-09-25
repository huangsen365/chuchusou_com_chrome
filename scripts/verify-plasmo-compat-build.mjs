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
  // 入口固定：SW = Plasmo 编译的 src/background.ts；popup / sidepanel = 普通 HTML 页
  const sw = buildManifest.background?.service_worker
  assert(sw === "static/background/index.js", `Background entrypoint drifted: ${sw}`)
  assert(legacyManifest.background?.service_worker === sw, `manifest.json service_worker must be ${sw}`)
  assert(fs.existsSync(path.join(buildDir, sw)), `Background SW file missing: ${sw}`)
  const pp = buildManifest.action?.default_popup
  assert(pp === "popup/popup.html" && pp === legacyManifest.action?.default_popup, `Popup entrypoint drifted: ${pp}`)
  assert(fs.existsSync(path.join(buildDir, pp)), `Popup HTML missing: ${pp}`)
  const sp = buildManifest.side_panel?.default_path
  assert(sp === "sidepanel/sidepanel.html" && sp === legacyManifest.side_panel?.default_path, `Side panel entrypoint drifted: ${sp}`)
  assert(fs.existsSync(path.join(buildDir, sp)), `Side panel HTML missing: ${sp}`)

  const requiredPaths = collectManifestPaths(buildManifest)
  const missingManifestAssets = requiredPaths.filter((relativePath) => !fs.existsSync(path.join(buildDir, relativePath)))
  assert(missingManifestAssets.length === 0, `Missing manifest assets:\n${missingManifestAssets.join("\n")}`)

  const stableAssets = [
    "config/unifiedMenuConfig.json",
    "background/chatgptPromptRelay.js",
    "config/engines.json",
    "prompts/fastAnswersPrompts.json",
    "prompts/topQuestionsPrompts.json",
    "prompts/optimizedPrompts.json",
    "prompts/articleRewritePrompts.json",
    "shared/logger.js",
    "shared/runtimeClient.js",
    "shared/storageDefaults.js",
    "popup/popup.bundle.js",
    "sidepanel/sidepanel.bundle.js",
    "offscreen/voice.html",
    "voice-permission/permission.html",
    "privacy.js",
    "welcome/welcome.html",
    "members/members.html"
  ]

  const missingStableAssets = stableAssets.filter((relativePath) => !fs.existsSync(path.join(buildDir, relativePath)))
  assert(missingStableAssets.length === 0, `Missing stable assets:\n${missingStableAssets.join("\n")}`)

  for (const jsPath of [
    "static/background/index.js",
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
