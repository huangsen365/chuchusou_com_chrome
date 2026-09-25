#!/usr/bin/env node
/**
 * 封面生成器一致性守卫（三入口：右键菜单 / Popup / Sidepanel）
 *
 * 背景（2026-07 审计）：封面风格清单的 SSoT 是 prompts/coverPrompts.json 的
 * categories（三入口都按它的顺序遍历，排序天然一致），但周边有一批"必须与
 * 它/彼此手工同步"的登记点，此前只靠注释约定：
 *  - 标题表 2 份：COVER_CATEGORY_TITLES（background/utils/Constants.js，右键菜单）+
 *    COVER_TITLES（src/shared/menuStructureBuilder.ts，popup / sidepanel）
 *  - pin 默认风格 / storage key / 默认比例：src/shared/coverPinConstants.ts 为
 *    名义 SSoT，但生产 popup（popup/popup.js）与 sidepanel（sidepanel/sidepanel.js）
 *    是 legacy 普通脚本没法 import，各自硬编码一份字面量；SW 的
 *    menuBuilderAttach.ts 曾经也硬编码（已改为 import）
 *  - AITaskHandler.js 的 ${ratio} 兜底字面量
 *
 * 本脚本锁死上述所有登记点：新增/改名风格漏改任意一处、或默认值各处漂移
 * → npm test / CI 直接红。
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import vm from "node:vm"

const root = process.cwd()
const TAG = "[verify-cover-consistency]"
const read = (p) => fs.readFileSync(path.join(root, p), "utf8")

let checks = 0
function fail(msg) {
  console.error(`${TAG} ✗ ${msg}`)
  process.exitCode = 1
}
function ok() { checks++ }

// ---- 1. SSoT：coverPrompts.json categories 基本形态 ----
const coverConfig = JSON.parse(read("prompts/coverPrompts.json"))
const categories = Array.isArray(coverConfig.categories) ? coverConfig.categories : []
if (categories.length < 2) fail(`coverPrompts.json categories 数量异常（${categories.length}）`)
const ids = categories.map((c) => c.id)
if (new Set(ids).size !== ids.length) fail(`coverPrompts.json categories id 有重复：${ids.join(",")}`)
for (const c of categories) {
  if (!c.id || typeof c.label !== "string" || !c.label.trim()) {
    fail(`coverPrompts.json category ${c.id || "(无 id)"} 缺 label`)
  }
  if (c.id !== "custom" && !(Array.isArray(c.engines) && c.engines[0]?.urlPattern)) {
    fail(`coverPrompts.json category ${c.id} 缺 engines[0].urlPattern —— 三入口都开不出去`)
  }
}
if (!ids.includes("custom")) fail(`coverPrompts.json 缺 custom 分类 —— sidepanel 自定义风格失效`)
ok()

// ---- 1b. 墨清配色轮换表：27 组合法十六进制色，purpose 恰好一个 ${coverPalette} ----
{
  const mq = categories.find((c) => c.id === "zhumoqing")
  const pal = Array.isArray(mq?.palettes) ? mq.palettes : []
  if (pal.length !== 27) fail(`墨清 palettes 应为 27 组，实际 ${pal.length}`)
  const HEX = /^#[0-9A-F]{6}$/
  pal.forEach((p, i) => {
    if (!p?.name || !HEX.test(p.bg) || !HEX.test(p.title) || !HEX.test(p.accent)) fail(`墨清 palettes[${i}] 字段非法: ${JSON.stringify(p)}`)
  })
  if (new Set(pal.map((p) => `${p.bg}|${p.accent}`)).size !== pal.length) fail("墨清 palettes 有重复的背景+点缀组合")
  if (new Set(pal.map((p) => p.name)).size !== pal.length) fail("墨清 palettes 名称重复")
  pal.forEach((p, i) => { if (p.accent === pal[(i + 1) % pal.length].accent) fail(`墨清 palettes[${i}] 与下一组点缀色相同，轮换时会连续撞色`) })
  if ((mq?.purpose || "").split("${coverPalette}").length - 1 !== 1) fail("墨清 purpose 必须恰好包含一个 ${coverPalette}")
  for (const c of categories) if (c.id !== "zhumoqing" && (c.purpose || "").includes("${coverPalette}")) fail(`${c.id} 不应含 \${coverPalette}`)
}
ok()

// ---- 2. 标题表 2 份：键集合 == SSoT id 集合，值两处逐字一致，且以 label 结尾 ----
function extractTitleTable(file, marker) {
  const src = read(file)
  const idx = src.indexOf(marker)
  if (idx < 0) {
    fail(`${file} 找不到 ${marker}（结构变了请同步本脚本）`)
    return null
  }
  const block = src.slice(idx, src.indexOf("}", idx))
  const table = {}
  for (const m of block.matchAll(/["']([\w-]+)["']\s*:\s*["']([^"']+)["']/g)) table[m[1]] = m[2]
  return table
}
const TITLE_TABLES = [
  ["background/utils/Constants.js", "const COVER_CATEGORY_TITLES = {"],
  ["src/shared/menuStructureBuilder.ts", "export const COVER_TITLES"],
].map(([f, marker]) => [f, extractTitleTable(f, marker)])

for (const [file, table] of TITLE_TABLES) {
  if (!table) continue
  for (const c of categories) {
    const v = table[c.id]
    if (!v) {
      fail(`${file} 标题表缺 "${c.id}" —— 新风格漏登记，菜单标题会掉 emoji 静默 fallback`)
    } else if (!v.endsWith(c.label)) {
      fail(`${file} 标题表 "${c.id}" 值 "${v}" 与 SSoT label "${c.label}" 不一致（应为 emoji + 空格 + label）`)
    }
  }
  for (const k of Object.keys(table)) {
    if (!ids.includes(k)) fail(`${file} 标题表有僵尸条目 "${k}"（SSoT 已无此风格）`)
  }
}
const [refFile, refTable] = TITLE_TABLES[0]
for (const [file, table] of TITLE_TABLES.slice(1)) {
  if (!table || !refTable) continue
  for (const id of ids) {
    if (table[id] !== refTable[id]) {
      fail(`标题表分裂："${id}" 在 ${refFile} 是 "${refTable[id]}"，在 ${file} 是 "${table[id]}"`)
    }
  }
}
ok()

// ---- 3. coverPinConstants.ts（pin/比例 SSoT）自身取值 ----
const pinConstSrc = read("src/shared/coverPinConstants.ts")
function constStr(name) {
  const m = pinConstSrc.match(new RegExp(`export const ${name} = "([^"]+)"`))
  if (!m) { fail(`coverPinConstants.ts 找不到 ${name}`); return null }
  return m[1]
}
const SSOT = {
  PIN_STORAGE_KEY: constStr("PIN_STORAGE_KEY"),
  CUSTOM_PURPOSE_KEY: constStr("CUSTOM_PURPOSE_KEY"),
  CUSTOM_LINE_KEY: constStr("CUSTOM_LINE_KEY"),
  RATIO_KEY: constStr("RATIO_KEY"),
  RATIO_CUSTOM_LIST_KEY: constStr("RATIO_CUSTOM_LIST_KEY"),
  DEFAULT_RATIO: constStr("DEFAULT_RATIO")
}
const defaultPinMatch = pinConstSrc.match(/DEFAULT_PIN = \{ taskId: "cover", categoryId: "([^"]+)" \}/)
if (!defaultPinMatch) fail(`coverPinConstants.ts 找不到 DEFAULT_PIN 定义（形态变了请同步本脚本）`)
const defaultCategoryId = defaultPinMatch?.[1] || null
if (defaultCategoryId && !ids.includes(defaultCategoryId)) {
  fail(`DEFAULT_PIN.categoryId "${defaultCategoryId}" 不在 coverPrompts.json categories 里 —— 默认 pin 必失效`)
}
if (defaultCategoryId === "custom") {
  fail(`DEFAULT_PIN.categoryId 不能是 custom（无字眼时 custom 本身会被回退）`)
}
const ssotRatioValues = [...pinConstSrc.matchAll(/\{ value: "([^"]+)",/g)].map((m) => m[1])
if (ssotRatioValues[0] !== SSOT.DEFAULT_RATIO) {
  fail(`RATIO_PRESETS 首项 "${ssotRatioValues[0]}" ≠ DEFAULT_RATIO "${SSOT.DEFAULT_RATIO}"（默认项应排第一）`)
}
ok()

// ---- 4. storage key：JS 侧注册表 shared/storageKeys.js 与 TS 侧 coverPinConstants.ts 逐字一致，
//         popup / sidepanel / SW 的键常量必须取自注册表；默认值（比例 / 置顶风格）仍是字面量，逐字对齐 SSoT ----
const registryCtx = {}
registryCtx.globalThis = registryCtx
vm.createContext(registryCtx)
vm.runInContext(read("shared/storageKeys.js"), registryCtx)
const REGISTRY = registryCtx.CCSStorageKeys
const KEY_PAIRS = [
  ["COVER_PIN", "PIN_STORAGE_KEY"],
  ["COVER_CUSTOM_PURPOSE", "CUSTOM_PURPOSE_KEY"],
  ["COVER_CUSTOM_LINE", "CUSTOM_LINE_KEY"],
  ["COVER_RATIO", "RATIO_KEY"],
  ["COVER_CUSTOM_RATIOS", "RATIO_CUSTOM_LIST_KEY"]
]
for (const [registryName, ssotName] of KEY_PAIRS) {
  if (REGISTRY?.[registryName] !== SSOT[ssotName]) {
    fail(`shared/storageKeys.js ${registryName} = "${REGISTRY?.[registryName]}" 与 coverPinConstants.ts ${ssotName} = "${SSOT[ssotName]}" 漂移`)
  }
}
function assertFromRegistry(file, src, name, registryName) {
  if (!new RegExp(`${name}\\s*=\\s*globalThis\\.CCSStorageKeys\\.${registryName}\\b`).test(src)) {
    fail(`${file} 的 ${name} 必须取自 globalThis.CCSStorageKeys.${registryName}`)
  }
}
function assertLiteral(file, src, name, expected) {
  if (expected == null) return
  const m = src.match(new RegExp(`${name}\\s*=\\s*'([^']+)'`))
  if (!m) { fail(`${file} 找不到 ${name} 字面量（形态变了请同步本脚本）`); return }
  if (m[1] !== expected) {
    fail(`${file} ${name} = '${m[1]}' 与 coverPinConstants.ts 的 "${expected}" 漂移`)
  }
}
for (const file of ["popup/popup.js", "sidepanel/sidepanel.js"]) {
  const src = read(file)
  assertFromRegistry(file, src, "PIN_STORAGE_KEY", "COVER_PIN")
  assertFromRegistry(file, src, "CUSTOM_PURPOSE_KEY", "COVER_CUSTOM_PURPOSE")
  assertFromRegistry(file, src, "CUSTOM_LINE_KEY", "COVER_CUSTOM_LINE")
  assertFromRegistry(file, src, "RATIO_KEY", "COVER_RATIO")
  assertLiteral(file, src, "DEFAULT_RATIO", SSOT.DEFAULT_RATIO)
  const pinM = src.match(/DEFAULT_PIN\s*=\s*\{\s*taskId:\s*'cover',\s*categoryId:\s*'([^']+)'\s*\}/)
  if (!pinM) fail(`${file} 找不到 DEFAULT_PIN 字面量（形态变了请同步本脚本）`)
  else if (pinM[1] !== defaultCategoryId) {
    fail(`${file} DEFAULT_PIN.categoryId '${pinM[1]}' 与 coverPinConstants.ts 的 "${defaultCategoryId}" 漂移 —— 三入口默认风格分裂`)
  }
}
// sidepanel 的比例预设清单（值 + 顺序）必须与 SSoT 完全一致
const spSrc = read("sidepanel/sidepanel.js")
assertFromRegistry("sidepanel/sidepanel.js", spSrc, "RATIO_CUSTOM_LIST_KEY", "COVER_CUSTOM_RATIOS")
const actionsSrc = read("background/articleActions.js")
assertFromRegistry("background/articleActions.js", actionsSrc, "COVER_PIN_STORAGE_KEY", "COVER_PIN")
assertFromRegistry("background/articleActions.js", actionsSrc, "COVER_CUSTOM_PURPOSE_KEY", "COVER_CUSTOM_PURPOSE")
assertFromRegistry("background/articleActions.js", actionsSrc, "COVER_CUSTOM_LINE_KEY", "COVER_CUSTOM_LINE")
const spRatioValues = [...spSrc.matchAll(/\{ value: '([^']+)',/g)].map((m) => m[1])
if (JSON.stringify(spRatioValues) !== JSON.stringify(ssotRatioValues)) {
  fail(`sidepanel/sidepanel.js RATIO_PRESETS [${spRatioValues.join(" ")}] 与 coverPinConstants.ts [${ssotRatioValues.join(" ")}] 漂移`)
}
ok()

// ---- 5. AITaskHandler 的 ${ratio} 兜底字面量必须 == DEFAULT_RATIO ----
for (const file of ["background/tasks/AITaskHandler.js"]) {
  const src = read(file)
  const fallbacks = [...src.matchAll(/vars\.ratio\s*=[^\n]*?["']([\d.]+:[\d.]+)["']/g)].map((m) => m[1])
  if (fallbacks.length === 0) fail(`${file} 找不到 vars.ratio 兜底字面量（形态变了请同步本脚本）`)
  for (const v of fallbacks) {
    if (v !== SSOT.DEFAULT_RATIO) {
      fail(`${file} ratio 兜底 "${v}" 与 DEFAULT_RATIO "${SSOT.DEFAULT_RATIO}" 漂移`)
    }
  }
}
ok()

// ---- 6. SW menuBuilderAttach.ts 必须 import SSoT，不许再硬编码 ----
const builderSrc = read("src/background/menuBuilderAttach.ts")
if (!builderSrc.includes('from "../shared/coverPinConstants"')) {
  fail(`menuBuilderAttach.ts 不再 import coverPinConstants —— pin 常量回到硬编码老路`)
}
for (const [name, literal] of [
  ["PIN_STORAGE_KEY", SSOT.PIN_STORAGE_KEY],
  ["CUSTOM_LINE_KEY", SSOT.CUSTOM_LINE_KEY],
  ["CUSTOM_PURPOSE_KEY", SSOT.CUSTOM_PURPOSE_KEY]
]) {
  if (literal && builderSrc.includes(`"${literal}"`)) {
    fail(`menuBuilderAttach.ts 出现 ${name} 裸字面量 "${literal}" —— 应从 coverPinConstants import`)
  }
}
if (/COVER_PIN_DEFAULT_CATEGORY\s*=/.test(builderSrc)) {
  fail(`menuBuilderAttach.ts 出现本地 COVER_PIN_DEFAULT_CATEGORY —— 默认风格应取 DEFAULT_PIN.categoryId`)
}
ok()

if (process.exitCode) {
  console.error(`${TAG} 修复指引：风格清单唯一改动点是 prompts/coverPrompts.json，`
    + `改完同步 2 份标题表（background/utils/Constants.js + src/shared/menuStructureBuilder.ts）；`
    + `pin/比例默认值唯一改动点是 src/shared/coverPinConstants.ts，`
    + `改完同步 popup/popup.js、sidepanel/sidepanel.js 字面量与 AITaskHandler 兜底`)
  process.exit(1)
}
console.log(`${TAG} 全部 OK — ${categories.length} 个封面风格三入口一致`
  + `（标题表 2 份逐字对齐；默认风格 ${defaultCategoryId} / 默认比例 ${SSOT.DEFAULT_RATIO} 全通道一致；`
  + `${ssotRatioValues.length} 个比例预设 sidepanel 对齐）`)
