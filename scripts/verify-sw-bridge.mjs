#!/usr/bin/env node
/**
 * SW 入口守卫
 *
 * 生产 SW = Plasmo 编译的 src/background.ts（static/background/index.js）：先调用 attach*
 * TS 模块，再 importScripts 一串 background/*.js / shared/*.js 普通脚本，最后 attachInit()。
 *
 * 验证项：
 *  1. importScripts 列表里每个文件都存在于源码树（build 后也存在于 build/）
 *  2. events.js 是列表最后一项；attach* 在 importScripts 之前、attachInit 在之后
 *  3. 列表里的文件不能同时有 TS 实现（一份逻辑只能有一个源）
 *  4. 退役文件（legacy/background-retired/）不回流
 *  5. background/ 根目录只允许 importScripts 列表里的 .js（防僵尸文件 / 同步冲突副本进商店 zip）
 *  6. SW bundle 确实包含 importScripts 调用 + 关键引用
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const root = process.cwd()
const buildDir = path.join(root, "build/chrome-mv3-prod")

function assert(cond, msg) {
  if (!cond) {
    console.error(`[verify-sw-bridge] ✗ ${msg}`)
    process.exit(1)
  }
}

const entrySource = fs.readFileSync(path.join(root, "src/background.ts"), "utf8")
const imports = [...entrySource.matchAll(/absoluteUrl\("([^"]+)"\)/g)].map((m) => m[1])
assert(imports.length >= 15, `src/background.ts importScripts 列表提取异常（${imports.length} 项）——结构变了请同步本脚本`)

// 1. 每个 target 都存在
for (const target of imports) {
  assert(fs.existsSync(path.join(root, target)), `importScripts 目标不存在: ${target}`)
}
assert(new Set(imports).size === imports.length, "importScripts 列表有重复项")
console.log(`[verify-sw-bridge] ✓ ${imports.length} 个 importScripts 目标文件全部存在`)

// 2. 顺序不变量
assert(imports[imports.length - 1] === "background/events.js",
  `events.js 必须是 importScripts 列表最后一项，实际最后一项是 ${imports[imports.length - 1]}`)
const importCallIndex = entrySource.indexOf("sw.importScripts(")
for (const attach of ["attachBaseBridge()", "attachMenuBuilder()", "attachMenuHandlers()", "autoRegisterVoiceBridge()"]) {
  const idx = entrySource.indexOf(`\n${attach}`)
  assert(idx !== -1 && idx < importCallIndex, `${attach} 必须在 importScripts 之前调用（events.js 顶层依赖它提供的 globalThis 符号）`)
}
const initIdx = entrySource.indexOf("\nattachInit()")
assert(initIdx > importCallIndex, "attachInit() 必须在 importScripts 之后调用（依赖 g.MenuSystem / g.initKeywordSyncSystem）")
console.log("[verify-sw-bridge] ✓ attach* → importScripts → attachInit 顺序正确，events.js 在末位")

// 3. 一份逻辑一个源：importScripts 的 JS 不能在 src/ 下再有同名 TS 实现
for (const target of imports) {
  const tsTwin = path.join(root, "src", target.replace(/\.js$/, ".ts"))
  assert(!fs.existsSync(tsTwin), `${target} 同时存在 TS 实现 ${path.relative(root, tsTwin)} —— 改写成 TS 后要从 importScripts 删掉原文件`)
}
console.log("[verify-sw-bridge] ✓ importScripts 模块没有 TS 孪生实现")

// 4. 退役文件不回流
const retiredDir = path.join(root, "legacy/background-retired")
if (fs.existsSync(retiredDir)) {
  const retired = fs.readdirSync(retiredDir).filter((f) => f.endsWith(".js"))
  for (const f of retired) {
    assert(!imports.includes(`background/${f}`), `退役文件 ${f} 重新出现在 src/background.ts importScripts`)
    assert(!fs.existsSync(path.join(root, "background", f)), `退役文件 ${f} 同时存在于 background/ 与 legacy/background-retired/`)
    if (fs.existsSync(buildDir)) {
      assert(!fs.existsSync(path.join(buildDir, "background", f)), `退役文件 ${f} 被打进了 build/（postbuild 不应复制 legacy/）`)
    }
  }
  console.log(`[verify-sw-bridge] ✓ ${retired.length} 个退役文件未混入 importScripts / background/ / build/`)
}

// 5. background/ 根目录白名单：每个根级 .js 都必须在 importScripts 列表里。抓两类污染：
// 误入的僵尸文件、OneDrive 同步冲突副本（实测出现过 events-<机器名>.js —— postbuild 会把它整目录打进商店 zip）。
{
  const rootJs = fs.readdirSync(path.join(root, "background")).filter((f) => f.endsWith(".js"))
  const allowed = new Set(imports.filter((t) => t.startsWith("background/") && !t.slice("background/".length).includes("/")).map((t) => t.slice("background/".length)))
  const strays = rootJs.filter((f) => !allowed.has(f))
  assert(strays.length === 0, `background/ 根目录有不明 .js 文件: ${strays.join(", ")}（僵尸或同步冲突副本，会被打进商店 zip）`)
  console.log(`[verify-sw-bridge] ✓ background/ 根目录 ${rootJs.length} 个 .js 全部在 importScripts 列表内`)
}

// 6. build 产物
const swBundlePath = path.join(buildDir, "static/background/index.js")
if (fs.existsSync(swBundlePath)) {
  for (const target of imports) {
    assert(fs.existsSync(path.join(buildDir, target)), `build 里找不到 ${target}`)
  }
  const bundle = fs.readFileSync(swBundlePath, "utf8")
  assert(/\.importScripts\s*\(/.test(bundle), "SW bundle 里找不到 .importScripts(...) 调用 — Plasmo 可能 tree-shake 掉了")
  for (const target of imports) {
    assert(bundle.includes(target), `SW bundle 里缺少 ${target} 引用`)
  }
  assert(bundle.includes("attachInit"), "SW bundle 里缺少 attachInit 引用（initAttach.ts 未 bundle）")
  console.log(`[verify-sw-bridge] ✓ SW bundle 包含 importScripts + 全部 ${imports.length} 个 target 引用，build/ 里文件齐全`)
} else {
  console.warn("[verify-sw-bridge] ⚠ SW bundle 不存在，跳过 build 产物检查（跑 npm run plasmo:build 后再试）")
}

console.log("[verify-sw-bridge] 全部 OK")
