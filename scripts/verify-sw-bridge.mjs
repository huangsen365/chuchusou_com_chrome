#!/usr/bin/env node
/**
 * SW Plasmo 桥接等价性验证
 *
 * 生产 SW 从 legacy `background/index.js` 切到了 Plasmo `static/background/index.js`。
 * 后者 importScripts 各 legacy 模块的绝对 URL。本验证锁住"两边加载列表完全一致"，
 * 防止以后哪边漏改导致 SW 死循环或半截初始化。
 *
 * 验证项：
 *  1. src/background.ts 的 importScripts 列表（顺序敏感）= legacy index.js 的有效 importScripts
 *  2. 全部 24 个 target 文件确实存在于 build/
 *  3. Plasmo 编译输出的 SW bundle 确实包含 self.importScripts 调用
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

// 1. 从 src/background.ts 抽 importScripts 列表（顺序）
function extractPlasmoSwImports() {
  const src = fs.readFileSync(path.join(root, "src/background.ts"), "utf8")
  const regex = /absoluteUrl\("([^"]+)"\)/g
  const list = []
  let m
  while ((m = regex.exec(src))) list.push(m[1])
  return list
}

// 2. 从 legacy background/index.js 抽 ACTIVE importScripts（跳过注释行）
function extractLegacySwImports() {
  const src = fs.readFileSync(path.join(root, "background/index.js"), "utf8")
  const list = []
  for (const line of src.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.startsWith("//")) continue
    const m = trimmed.match(/^['"]([^'"]+\.js)['"]/)
    if (m) {
      // 把 ./xxx → background/xxx，../shared/xxx → shared/xxx
      let p = m[1]
      if (p.startsWith("./")) p = "background/" + p.slice(2)
      else if (p.startsWith("../")) p = p.slice(3)
      list.push(p)
    }
  }
  return list
}

const plasmoList = extractPlasmoSwImports()
const legacyList = extractLegacySwImports()

// 顺序敏感比较
assert(
  plasmoList.length === legacyList.length,
  `import 列表长度不匹配: plasmo=${plasmoList.length} legacy=${legacyList.length}`
)
for (let i = 0; i < plasmoList.length; i++) {
  assert(
    plasmoList[i] === legacyList[i],
    `第 ${i + 1} 个 import 不一致: plasmo="${plasmoList[i]}" legacy="${legacyList[i]}"`
  )
}
console.log(`[verify-sw-bridge] ✓ ${plasmoList.length} 个 import 顺序与 legacy index.js 完全一致`)

// 3. 验证每个目标文件存在于 build/
if (fs.existsSync(buildDir)) {
  for (const target of plasmoList) {
    const p = path.join(buildDir, target)
    assert(fs.existsSync(p), `build 里找不到 ${target}`)
  }
  console.log(`[verify-sw-bridge] ✓ build/ 里 ${plasmoList.length} 个 target 文件全部存在`)
} else {
  console.warn(`[verify-sw-bridge] ⚠ build dir 不存在，跳过文件存在性检查`)
}

// 4. 验证 Plasmo 编译出的 SW bundle 确实做 self.importScripts
const swBundlePath = path.join(buildDir, "static/background/index.js")
if (fs.existsSync(swBundlePath)) {
  const bundle = fs.readFileSync(swBundlePath, "utf8")
  assert(/\.importScripts\s*\(/.test(bundle), "SW bundle 里找不到 .importScripts(...) 调用 — Plasmo 可能 tree-shake 掉了")
  // 至少抽样验证 Constants.js 的引用还在
  assert(bundle.includes("background/utils/Constants.js"), "SW bundle 里缺少 background/utils/Constants.js 引用")
  // init.js 已被 src/background/initAttach.ts 取代，不再 importScripts
  assert(bundle.includes("attachInit"), "SW bundle 里缺少 attachInit 引用（initAttach.ts 未 bundle）")
  console.log(`[verify-sw-bridge] ✓ SW bundle 包含 self.importScripts + 关键 target 引用`)
} else {
  console.warn(`[verify-sw-bridge] ⚠ SW bundle 不存在，跳过 bundle 内容检查（跑 npm run plasmo:build 后再试）`)
}

// 4.5 顺序不变量：events.js 是最后一个 legacy listener 主体，
// 顶层会引用前面所有模块（以及前置 attach 的 TS port）提供的 globalThis 符号，
// 必须排在 importScripts 列表最后（attachInit 在 importScripts 之后另行调用）。
assert(
  plasmoList[plasmoList.length - 1] === "background/events.js",
  `events.js 必须是 importScripts 列表最后一项，实际最后一项是 ${plasmoList[plasmoList.length - 1]}`
)

// 5. 退役文件守卫：legacy/background-retired/ 里的文件不得回到 importScripts / background/ / build
const retiredDir = path.join(root, "legacy/background-retired")
if (fs.existsSync(retiredDir)) {
  const retired = fs.readdirSync(retiredDir).filter((f) => f.endsWith(".js"))
  for (const f of retired) {
    const asTarget = `background/${f}`
    assert(!plasmoList.includes(asTarget), `退役文件 ${f} 重新出现在 src/background.ts importScripts`)
    assert(!legacyList.includes(asTarget), `退役文件 ${f} 重新出现在 background/index.js importScripts`)
    assert(!fs.existsSync(path.join(root, "background", f)), `退役文件 ${f} 同时存在于 background/ 与 legacy/background-retired/`)
    if (fs.existsSync(buildDir)) {
      assert(!fs.existsSync(path.join(buildDir, "background", f)), `退役文件 ${f} 被打进了 build/（postbuild 不应复制 legacy/）`)
    }
  }
  console.log(`[verify-sw-bridge] ✓ ${retired.length} 个退役文件未混入 importScripts / background/ / build/`)
}

console.log(`[verify-sw-bridge] 全部 OK — Plasmo SW 桥接与 legacy index.js 等价`)
