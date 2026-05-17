#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const projectRoot = process.cwd()
const buildDir = path.resolve(projectRoot, process.argv[2] || "build/chrome-mv3-prod")

const copyDirs = [
  "background",
  "popup",
  "sidepanel",
  "welcome",
  "content",
  "modules",
  "shared",
  "config",
  "prompts",
  "icons",
  "assets",
  "members",
  "offscreen",
  "voice-permission"
]

const copyFiles = [
  "content.js",
  "content.css",
  "dockbar.js",
  "privacy.html"
]

const excludedNames = new Set([
  ".DS_Store",
  "Thumbs.db"
])

const excludedSuffixes = [
  ".log",
  ".bak",
  ".tmp",
  ".sketch",
  ".psd",
  ".ai"
]

function ensureExists(p, label = p) {
  if (!fs.existsSync(p)) {
    throw new Error(`Missing ${label}: ${p}`)
  }
}

function shouldCopy(src) {
  const name = path.basename(src)
  if (excludedNames.has(name)) return false
  return !excludedSuffixes.some((suffix) => name.endsWith(suffix))
}

function copyRecursive(relativePath) {
  const src = path.join(projectRoot, relativePath)
  const dest = path.join(buildDir, relativePath)
  if (!fs.existsSync(src)) return

  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.rmSync(dest, { recursive: true, force: true })
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src)) {
      const childRelativePath = path.join(relativePath, entry)
      const childSrc = path.join(projectRoot, childRelativePath)
      if (shouldCopy(childSrc)) copyRecursive(childRelativePath)
    }
    return
  }

  if (!shouldCopy(src)) return
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"))
}

function writeJson(targetPath, data) {
  fs.writeFileSync(targetPath, `${JSON.stringify(data, null, 2)}\n`)
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
  ensureExists(buildDir, "Plasmo build directory")

  for (const dir of copyDirs) copyRecursive(dir)
  for (const file of copyFiles) copyRecursive(file)

  const legacyManifest = readJson("manifest.json")
  const packageJson = readJson("package.json")
  const plasmoManifestPath = path.join(buildDir, "manifest.json")
  const plasmoManifest = fs.existsSync(plasmoManifestPath)
    ? JSON.parse(fs.readFileSync(plasmoManifestPath, "utf8"))
    : null

  // SW entry：Plasmo 接管（src/background.ts → static/background/index.js），
  // 运行时 importScripts 加载 legacy 模块，行为与之前一致但入口归 Plasmo
  const plasmoServiceWorker = plasmoManifest?.background?.service_worker
  const background = plasmoServiceWorker
    ? { service_worker: plasmoServiceWorker, type: plasmoManifest?.background?.type }
    : legacyManifest.background

  // Side panel：Plasmo 接管（src/sidepanel.tsx → sidepanel.html）
  const plasmoSidePanel = plasmoManifest?.side_panel?.default_path
  const sidePanel = plasmoSidePanel
    ? { ...legacyManifest.side_panel, default_path: plasmoSidePanel }
    : legacyManifest.side_panel

  // Popup：Plasmo 接管（src/popup.tsx → popup.html）
  // 注意：legacy popup.html 静态预渲染 + 0 JS 首屏 (34ms)，
  // 切到 Plasmo React shell 后冷启动会涨到 ~50-80ms（仍在"流畅"区间）
  const plasmoPopup = plasmoManifest?.action?.default_popup
  const action = plasmoPopup
    ? { ...legacyManifest.action, default_popup: plasmoPopup }
    : legacyManifest.action

  // Content scripts：Plasmo 接管（src/content.ts 聚合 20 个 TS 模块 → 单 bundle 97KB）
  // Plasmo 自动生成 hashed filename，由它声明 js 字段。CSS / run_at / all_frames 沿用 legacy
  const plasmoContentScripts = plasmoManifest?.content_scripts
  let contentScripts = legacyManifest.content_scripts
  if (Array.isArray(plasmoContentScripts) && plasmoContentScripts.length > 0) {
    const plasmoCs = plasmoContentScripts[0]
    const legacyCs = (legacyManifest.content_scripts || [{}])[0]
    contentScripts = [{
      ...legacyCs,
      js: plasmoCs.js || legacyCs.js,
      css: (plasmoCs.css && plasmoCs.css.length > 0) ? plasmoCs.css : (legacyCs.css || ["content.css"])
    }]
  }

  const compatManifest = {
    ...legacyManifest,
    version: packageJson.version || legacyManifest.version,
    minimum_chrome_version:
      packageJson.manifest?.minimum_chrome_version || legacyManifest.minimum_chrome_version || "114",
    background,
    side_panel: sidePanel,
    action,
    content_scripts: contentScripts
  }
  // 删除 type 若为 undefined（避免 manifest 里出现 "type": undefined）
  if (!compatManifest.background?.type) delete compatManifest.background?.type

  writeJson(path.join(buildDir, "manifest.json"), compatManifest)

  const missing = collectManifestPaths(compatManifest).filter((relativePath) => {
    return !fs.existsSync(path.join(buildDir, relativePath))
  })

  if (missing.length > 0) {
    throw new Error(`Plasmo compat build is missing manifest assets:\n${missing.join("\n")}`)
  }

  console.log(`[plasmo-compat] Copied ${copyDirs.length} legacy dirs + ${copyFiles.length} files into ${buildDir}`)
  console.log(`[plasmo-compat] Patched manifest to legacy functional entrypoints, version ${compatManifest.version}`)
}

main()
