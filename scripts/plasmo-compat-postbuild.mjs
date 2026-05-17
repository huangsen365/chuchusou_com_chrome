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

  // ⚠️ SW 入口必须指 Plasmo bundle `static/background/index.js`。
  // 历史：之前回退到 legacy `background/index.js` 是出于 Chrome 真机回归未做的谨慎。
  // 但 commits 9437c35..725b45d 已经把 base.js / Logger.js / menuBuilder.js /
  // menuHandlers.js / voiceOffscreenBridge.js / init.js 从 legacy index.js 的
  // importScripts 列表里 drop 掉了（由 src/background/*.ts 取代）。如果 manifest 仍
  // 指 legacy index.js，events.js 顶层 `addListener(createContextMenus)` 会拿到
  // undefined → SW Status 15 注册失败。
  // Plasmo bundle (`src/background.ts` 编译产物) 是唯一能跑通的入口：它顶层
  // import 5 个 attach* TS 模块，再 importScripts 17 个剩余 legacy 文件。
  // 其它 3 个 popup/sidepanel/content_scripts 入口保持 legacy，等单独 port 完整再切。
  const background = {
    ...legacyManifest.background,
    service_worker: "static/background/index.js"
  }
  // Popup / Sidepanel / Content scripts 暂时回退到 legacy。
  // 原因：TS port 不完整（sidepanel.js 1664 → SidepanelController 455 行只 27%，缺 17 个 DOM ID；
  //       popup.js 1262 → PopupController 1038 行 82%；content.ts 已聚合但未 Chrome 验证）
  // Plasmo bundle 已生成（popup.html / sidepanel.html / content.{hash}.js）作为预备态，
  // 等 TS port 补齐到 1:1 + Chrome 真机回归后再逐个切。
  const sidePanel = legacyManifest.side_panel
  const action = legacyManifest.action
  const contentScripts = legacyManifest.content_scripts

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
