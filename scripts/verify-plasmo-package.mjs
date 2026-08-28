#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { execFileSync } from "node:child_process"

const projectRoot = process.cwd()
const zipPath = path.resolve(projectRoot, process.argv[2] || "build/chrome-mv3-prod.zip")

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"))
}

function zipList(file) {
  return execFileSync("unzip", ["-Z1", file], { encoding: "utf8" })
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function zipRead(file, entry) {
  return execFileSync("unzip", ["-p", file, entry], { encoding: "utf8" })
}

function main() {
  assert(fs.existsSync(zipPath), `Missing Plasmo package zip: ${zipPath}`)

  const entries = new Set(zipList(zipPath))
  assert(entries.has("manifest.json"), "Package missing manifest.json")

  const manifest = JSON.parse(zipRead(zipPath, "manifest.json"))
  const legacyManifest = readJson("manifest.json")
  const packageJson = readJson("package.json")

  assert(manifest.manifest_version === 3, "Package manifest must be MV3")
  assert(manifest.version === packageJson.version, `Package version ${manifest.version} != package version ${packageJson.version}`)
  assert(manifest.name === legacyManifest.name, "Package manifest name drifted from legacy manifest")
  assert(manifest.description === legacyManifest.description, "Package manifest description drifted from legacy manifest")
  assert(manifest.background?.service_worker === legacyManifest.background?.service_worker, "Package background entrypoint drifted")
  assert(manifest.action?.default_popup === legacyManifest.action?.default_popup, "Package popup entrypoint drifted")
  assert(manifest.side_panel?.default_path === legacyManifest.side_panel?.default_path, "Package side panel entrypoint drifted")

  const requiredEntries = [
    "background/index.js",
    "popup/popup.html",
    "popup/popup.js",
    "popup/popup.css",
    "sidepanel/sidepanel.html",
    "sidepanel/sidepanel.js",
    "sidepanel/sidepanel.css",
    "content.js",
    "content.css",
    "config/unifiedMenuConfig.json",
    "config/engines.json",
    "prompts/fastAnswersPrompts.json",
    "prompts/topQuestionsPrompts.json",
    "prompts/optimizedPrompts.json",
    "prompts/coverPrompts.json",
    "prompts/articleRewritePrompts.json",
    "shared/menuStructureBuilder.js",
    "shared/keywordClient.js",
    "offscreen/voice.html",
    "offscreen/voice.js",
    "voice-permission/permission.html",
    "voice-permission/permission.js",
    "welcome/welcome.html",
    "welcome/welcome.js",
    "members/members.html",
    "privacy.html",
    "icons/16x16.png",
    "icons/48x48.png",
    "icons/128x128.png"
  ]

  const missingEntries = requiredEntries.filter((entry) => !entries.has(entry))
  assert(missingEntries.length === 0, `Package missing required entries:\n${missingEntries.join("\n")}`)

  const forbiddenPrefixes = [
    "node_modules/",
    ".git/",
    ".plasmo/",
    "src/",
    "docs/"
  ]
  const forbiddenEntries = [...entries].filter((entry) => forbiddenPrefixes.some((prefix) => entry.startsWith(prefix)))
  assert(forbiddenEntries.length === 0, `Package contains source-only entries:\n${forbiddenEntries.join("\n")}`)

  assert(entries.size >= 80, `Package entry count looks too small: ${entries.size}`)
  console.log(`[verify-plasmo-package] ${path.relative(projectRoot, zipPath)} OK (${entries.size} entries)`)
}

main()
