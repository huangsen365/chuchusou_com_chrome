#!/usr/bin/env node
/**
 * ccs_* 存储键守卫：shared/storageKeys.js 是唯一登记处。
 *
 *  1. 表内键名 / 前缀不重复。
 *  2. 代码里出现的每个 ccs_ 名字（字符串、属性访问、对象键、模板字符串前缀）都必须是
 *     登记过的键，或以登记过的前缀开头 —— 拼错 / 各写各的键名（曾经：TS 读
 *     ccs_menu_icon_support，icons.js 写 ccs_menu_icon_supported）会在这里直接红。
 *  3. 定义「键常量」（const X = 'ccs_…' / static X = 'ccs_…'）只能从 CCSStorageKeys 取，
 *     不许再抄一份字面量；加载早于注册表的文件（boot 脚本、src/**\/*.ts）除外。
 *  4. 注册表在 SW / 内容脚本 / popup / sidepanel bundle 里都是第一个加载。
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import vm from "node:vm"

const root = process.cwd()
const TAG = "[verify-storage-keys]"
const violations = []

// ---- 注册表 ----
const context = {}
context.globalThis = context
vm.createContext(context)
vm.runInContext(fs.readFileSync(path.join(root, "shared/storageKeys.js"), "utf8"), context)
const registry = context.CCSStorageKeys
if (!registry) {
  console.error(`${TAG} ✗ shared/storageKeys.js 没有导出 CCSStorageKeys`)
  process.exit(1)
}
const keys = Object.entries(registry).filter(([, v]) => typeof v === "string").map(([, v]) => v)
const prefixes = Object.values(registry.PREFIX || {})
const urlParams = Object.values(registry.URL_PARAM || {})
const all = [...keys, ...prefixes, ...urlParams]
const dupes = all.filter((v, i) => all.indexOf(v) !== i)
if (dupes.length) violations.push(`注册表有重复值: ${[...new Set(dupes)].join(", ")}`)
for (const v of all) if (!/^ccs_[a-z0-9_]+$/.test(v)) violations.push(`注册表值不合规（应为 ccs_ 小写下划线）: ${v}`)

const known = new Set([...keys, ...urlParams])
const isRegistered = (name) => known.has(name) || prefixes.some((p) => name.startsWith(p))

// ---- 扫描 ----
function listFiles(dir, exts) {
  const abs = path.join(root, dir)
  if (!fs.existsSync(abs)) return []
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) return listFiles(rel, exts)
    return exts.some((e) => entry.name.endsWith(e)) && !entry.name.endsWith(".bundle.js") ? [rel] : []
  })
}
const files = [
  ...["background", "shared", "modules", "content", "popup", "sidepanel", "offscreen", "welcome", "members", "voice-permission"]
    .flatMap((d) => listFiles(d, [".js", ".html"])),
  ...listFiles("src", [".ts"]),
  "content.js", "dockbar.js", "privacy.js"
].filter((f) => f !== "shared/storageKeys.js" && fs.existsSync(path.join(root, f)))

// 加载早于注册表、只能写字面量的文件
const literalAllowed = (file) => file.startsWith("src/") || file.endsWith(".boot.js")

let occurrences = 0
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), "utf8")
  const lines = source.split("\n")
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "")
    if (/^\s*\*/.test(line)) return // 块注释行
    for (const m of code.matchAll(/\bccs_[A-Za-z0-9_]+/g)) {
      const name = m[0]
      // 标识符（非字符串、非属性/对象键）——例如 eslint 全局 ccs_dockbar 之类的模块名，不是存储键
      const before = code[m.index - 1] || ""
      const after = code.slice(m.index + name.length).trimStart()[0] || ""
      const quoted = /['"`]/.test(before)
      const property = before === "." || (before === "?" && code[m.index - 2] === ".")
      const objectKey = after === ":" && !quoted && !/[?]/.test(code.slice(0, m.index).slice(-2))
      if (!quoted && !property && !objectKey) continue
      occurrences++
      if (!isRegistered(name)) {
        violations.push(`${file}:${i + 1} 出现未登记的键 ${name} —— 先登记到 shared/storageKeys.js（拼错了？）`)
      }
    }
    // 键常量必须从注册表取
    if (!literalAllowed(file) && /^\s*(?:const|let|var|static)\s+[A-Za-z_$][\w$]*\s*=\s*['"`]ccs_/.test(code)) {
      violations.push(`${file}:${i + 1} 键常量写成了字面量 —— 改为 globalThis.CCSStorageKeys.XXX`)
    }
  })
}

// ---- TS（SW bundle）里只能写字面量的键常量：逐个对上注册表里的同一个键 ----
for (const [file, constName, registryName] of [
  ["src/background/baseBridge.ts", "MENU_ICON_SUPPORT_STORAGE_KEY", "MENU_ICON_SUPPORT"],
  ["src/shared/coverPinConstants.ts", "PIN_STORAGE_KEY", "COVER_PIN"],
  ["src/shared/coverPinConstants.ts", "CUSTOM_PURPOSE_KEY", "COVER_CUSTOM_PURPOSE"],
  ["src/shared/coverPinConstants.ts", "CUSTOM_LINE_KEY", "COVER_CUSTOM_LINE"],
  ["src/shared/coverPinConstants.ts", "RATIO_KEY", "COVER_RATIO"],
  ["src/shared/coverPinConstants.ts", "RATIO_CUSTOM_LIST_KEY", "COVER_CUSTOM_RATIOS"]
]) {
  const source = fs.readFileSync(path.join(root, file), "utf8")
  const value = source.match(new RegExp(`(?:export )?const ${constName} = "([^"]+)"`))?.[1]
  if (value !== registry[registryName]) {
    violations.push(`${file} ${constName} = "${value}" 与注册表 ${registryName} = "${registry[registryName]}" 不一致`)
  }
}

// ---- 加载顺序 ----
const entry = fs.readFileSync(path.join(root, "src/background.ts"), "utf8")
const firstImport = entry.match(/absoluteUrl\("([^"]+)"\)/)?.[1]
if (firstImport !== "shared/storageKeys.js") violations.push(`src/background.ts 的第一个 importScripts 必须是 shared/storageKeys.js（现在是 ${firstImport}）`)
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"))
const mainScripts = manifest.content_scripts?.find((c) => (c.js || []).includes("content.js"))?.js || []
if (mainScripts[0] !== "shared/storageKeys.js") violations.push(`manifest content_scripts 第一个必须是 shared/storageKeys.js（现在是 ${mainScripts[0]}）`)
const bundler = fs.readFileSync(path.join(root, "scripts/bundle-shared-deps.mjs"), "utf8")
for (const list of ["POPUP_DEPS", "SIDEPANEL_DEPS"]) {
  const first = bundler.match(new RegExp(`const ${list} = \\[\\s*"([^"]+)"`))?.[1]
  if (first !== "shared/storageKeys.js") violations.push(`scripts/bundle-shared-deps.mjs ${list} 第一个必须是 shared/storageKeys.js（现在是 ${first}）`)
}
const reinject = fs.readFileSync(path.join(root, "background/events/menuState.js"), "utf8")
if (!reinject.includes("files: ['shared/storageKeys.js',")) violations.push("background/events/menuState.js 补注入 content.js 时必须先注入 shared/storageKeys.js")

if (violations.length) {
  for (const v of violations) console.error(`${TAG} ✗ ${v}`)
  process.exit(1)
}
console.log(`${TAG} ✓ ${keys.length} 个键 + ${prefixes.length} 个前缀；代码里 ${occurrences} 处 ccs_ 引用全部登记在册，键常量都取自注册表`)
