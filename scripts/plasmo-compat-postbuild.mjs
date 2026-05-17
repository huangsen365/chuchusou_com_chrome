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

  const compatManifest = {
    ...legacyManifest,
    version: packageJson.version || legacyManifest.version,
    minimum_chrome_version:
      packageJson.manifest?.minimum_chrome_version || legacyManifest.minimum_chrome_version || "114"
  }

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
