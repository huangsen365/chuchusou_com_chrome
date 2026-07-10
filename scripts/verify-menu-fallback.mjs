#!/usr/bin/env node
/**
 * 菜单兜底完整性校验（防"第二个 ccs-x"回潜）
 *
 * 背景（v1.6.40 的坑）：右键菜单是全扩展唯一没有 urlPattern 随身携带的入口，
 * 点击处理 = SSoT 快速通道（tryOpenMenuUrl/URLBuilder）→ 失败落 legacy
 * switch-case 兜底。ccs-x 新增时只走了 SSoT 推荐路径、没登记兜底分支，
 * 一旦 URLBuilder 未就位（如 config 加载失败），右键点它就静默无反应——
 * 而百度/谷歌等老项都有兜底所以一切正常，popup 又因消息自带 urlPattern
 * 不受影响，症状极具迷惑性（"popup 能用、右键不能用"）。
 *
 * 强制不变量：src/background/menuBuilderAttach.ts 的 MENU_GROUPS 里每个静态
 * 菜单 id 必须——
 *  1. 在 src/background/menuHandlersAttach.ts 有 `case "<id>"` 兜底分支（全部组）
 *  2. URL 型组（search/ai/general）还必须在 background/events.js 有 `case '<id>'`
 *     兜底分支（popup/sidepanel 老消息路径的最后防线）
 *  3. URL 型组每个 id 必须在 config/unifiedMenuConfig.json 顶层 items 里
 *     登记 urlPattern（SSoT 主通道本身不缺位）
 *
 * 新增菜单项漏了任意一处 → 本脚本红 → npm test / CI 直接拦下。
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const root = process.cwd()
const TAG = "[verify-menu-fallback]"
const read = (p) => fs.readFileSync(path.join(root, p), "utf8")

function fail(msg) {
  console.error(`${TAG} ✗ ${msg}`)
  process.exitCode = 1
}

// ---- 1. 从 menuBuilderAttach.ts 提取 MENU_GROUPS 静态 id ----
const builderSrc = read("src/background/menuBuilderAttach.ts")
const groupsBlockMatch = builderSrc.match(/const MENU_GROUPS = Object\.freeze\(\{([\s\S]*?)\}\)/)
if (!groupsBlockMatch) {
  fail("在 menuBuilderAttach.ts 里找不到 MENU_GROUPS 定义（结构变了请同步本脚本）")
  process.exit(1)
}
const groupsBlock = groupsBlockMatch[1]
const groups = {}
for (const m of groupsBlock.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
  const [, name, body] = m
  groups[name] = [...body.matchAll(/id:\s*"([^"]+)"/g)].map((x) => x[1])
}
const URL_GROUPS = ["search", "ai", "general"]
const allStaticIds = Object.values(groups).flat()
const urlIds = URL_GROUPS.flatMap((g) => groups[g] || [])
if (urlIds.length < 10) {
  fail(`URL 型组 id 提取数量异常（${urlIds.length} 个，预期 ≥ 10）——正则可能失配`)
}

// ---- 2. menuHandlersAttach.ts：全部静态 id 都要有 case ----
const handlersSrc = read("src/background/menuHandlersAttach.ts")
const tsCases = new Set([...handlersSrc.matchAll(/case "([^"]+)"/g)].map((m) => m[1]))
for (const id of allStaticIds) {
  if (!tsCases.has(id)) {
    fail(`menuHandlersAttach.ts 缺 case "${id}" —— 右键 SSoT 失效时该项将静默无反应（ccs-x 同款坑）`)
  }
}

// ---- 3. events.js：URL 型 id 都要有 case ----
const eventsSrc = read("background/events.js")
const jsCases = new Set([...eventsSrc.matchAll(/case '([^']+)'/g)].map((m) => m[1]))
for (const id of urlIds) {
  if (!jsCases.has(id)) {
    fail(`events.js 缺 case '${id}' —— popup/sidepanel 老消息路径没有该项的最后防线`)
  }
}

// ---- 4. unifiedMenuConfig.json：URL 型 id 都要有 urlPattern（SSoT 主通道在位）----
const config = JSON.parse(read("config/unifiedMenuConfig.json"))
const configUrlIds = new Set()
for (const group of config.groups || []) {
  for (const item of group.items || []) {
    if (item.urlPattern) configUrlIds.add(item.id)
  }
}
for (const id of urlIds) {
  if (!configUrlIds.has(id)) {
    fail(`unifiedMenuConfig.json 缺 ${id} 的 urlPattern —— SSoT 快速通道对它必 miss`)
  }
}

if (process.exitCode) {
  console.error(`${TAG} 修复指引：新增 URL 型菜单项需同时登记 ①unifiedMenuConfig.json（SSoT）`
    + ` ②menuHandlersAttach.ts switch-case ③events.js switch-case，缺一不可`)
  process.exit(1)
}
console.log(`${TAG} 全部 OK — ${allStaticIds.length} 个静态菜单项兜底齐全`
  + `（URL 型 ${urlIds.length} 个三处登记一致：config SSoT + 右键兜底 + popup 老路径兜底）`)
