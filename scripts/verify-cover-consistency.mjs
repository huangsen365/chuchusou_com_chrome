#!/usr/bin/env node
/**
 * 封面生成器一致性守卫（三入口：右键菜单 / Popup / Sidepanel）
 *
 * 封面风格的 SSoT：一个风格一个文件 prompts/cover/<id>.json（id / label / icon / purpose，
 * 可选 credit / palettes / engines），prompts/cover/index.json 的 order 决定三入口的显示顺序；
 * 构建时由 scripts/lib/coverStyles.mjs 组装成运行时读取的 prompts/coverPrompts.json。
 * 菜单标题不再建表，统一是 icon + 空格 + label。周边仍需手工同步的登记点：
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
import { COVER_STYLE_DIR, assembleCoverPrompts } from "./lib/coverStyles.mjs"

const root = process.cwd()
const TAG = "[verify-cover-consistency]"
const read = (p) => fs.readFileSync(path.join(root, p), "utf8")

let checks = 0
function fail(msg) {
  console.error(`${TAG} ✗ ${msg}`)
  process.exitCode = 1
}
function ok() { checks++ }

// ---- 1. SSoT：prompts/cover/ 风格文件组装后的基本形态（缺文件 / 多文件 / id 不符由组装器直接抛错）----
let coverConfig = { categories: [] }
try {
  coverConfig = assembleCoverPrompts(root)
} catch (error) {
  fail(error.message)
}
const categories = Array.isArray(coverConfig.categories) ? coverConfig.categories : []
if (categories.length < 2) fail(`${COVER_STYLE_DIR}/ 风格数量异常（${categories.length}）`)
const ids = categories.map((c) => c.id)
for (const c of categories) {
  const file = `${COVER_STYLE_DIR}/${c.id}.json`
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.id || "")) fail(`${file} 的 id 只能用小写字母、数字和连字符（会拼进菜单 id）`)
  if (typeof c.label !== "string" || !c.label.trim()) fail(`${file} 缺 label`)
  if (typeof c.icon !== "string" || !c.icon.trim()) fail(`${file} 缺 icon —— 菜单标题是 icon + 空格 + label`)
  if (typeof c.purpose !== "string" || !c.purpose.trim()) fail(`${file} 缺 purpose`)
  if (c.id !== "custom" && !(Array.isArray(c.engines) && c.engines[0]?.urlPattern)) {
    fail(`${file} 缺 engines[0].urlPattern（也没从 index.json 继承到）—— 三入口都开不出去`)
  }
  if (c.credit && !(c.credit.name && /^https:\/\//.test(c.credit.url || ""))) fail(`${file} 的 credit 需要 name 和 https 链接`)
}
if (!ids.includes("custom")) fail(`${COVER_STYLE_DIR}/ 缺 custom 风格 —— sidepanel 自定义风格失效`)
if (new Set(categories.map((c) => c.label)).size !== categories.length) fail("封面风格 label 有重复 —— 三入口里分不清")
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

// ---- 2. 菜单标题不建表：不许再出现手抄的风格标题表 ----
for (const [file, pattern] of [
  ["background/utils/Constants.js", /COVER_CATEGORY_TITLES/],
  ["src/shared/menuStructureBuilder.ts", /COVER_TITLES\b/],
  ["src/background/menuBuilderAttach.ts", /COVER_CATEGORY_TITLES/]
]) {
  if (pattern.test(read(file))) fail(`${file} 又出现了封面风格标题表 —— 标题统一由风格文件的 icon + label 生成`)
}
for (const c of categories) {
  if (c.id === "custom") continue
  for (const file of ["background/utils/Constants.js", "src/shared/menuStructureBuilder.ts"]) {
    if (read(file).includes(`ccs-cover-${c.id}-`)) fail(`${file} 手写了 ccs-cover-${c.id}-* 菜单条目 —— 封面风格菜单全部由风格文件生成`)
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
  console.error(`${TAG} 修复指引：新增 / 修改风格只动 prompts/cover/<id>.json，`
    + `新增时把 id 加进 prompts/cover/index.json 的 order；`
    + `pin/比例默认值唯一改动点是 src/shared/coverPinConstants.ts，`
    + `改完同步 popup/popup.js、sidepanel/sidepanel.js 字面量与 AITaskHandler 兜底`)
  process.exit(1)
}
console.log(`${TAG} 全部 OK — ${categories.length} 个封面风格三入口一致`
  + `（${COVER_STYLE_DIR}/ 一风格一文件；默认风格 ${defaultCategoryId} / 默认比例 ${SSOT.DEFAULT_RATIO} 全通道一致；`
  + `${ssotRatioValues.length} 个比例预设 sidepanel 对齐）`)
