/**
 * Golden snapshot helper for single-source behavior tests.
 *
 * 用法：
 *   const golden = createGolden("background-utils")
 *   golden.check("formatMenuTitle", cases.map(...))
 *   golden.finish()
 *
 * 快照文件：scripts/fixtures/golden/<name>.json
 * 刷新快照（确认行为变更是有意的之后）：UPDATE_GOLDEN=1 node scripts/verify-xxx.mjs
 *
 * 值会先做规范化再比较：undefined / NaN / Infinity / Map / Set / 函数都有稳定表示，
 * 所以 legacy 函数返回 undefined 与返回 null 能被区分开。
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const goldenDir = path.join(process.cwd(), "scripts/fixtures/golden")

export function normalizeForGolden(value, seen = new WeakSet()) {
  if (value === undefined) return { $undefined: true }
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { $number: "NaN" }
    if (!Number.isFinite(value)) return { $number: value > 0 ? "Infinity" : "-Infinity" }
    return value
  }
  if (typeof value === "bigint") return { $bigint: String(value) }
  if (typeof value === "function") return { $function: value.name || "anonymous" }
  if (typeof value === "symbol") return { $symbol: String(value.description) }
  if (value === null || typeof value !== "object") return value
  if (seen.has(value)) return { $circular: true }
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map((item) => normalizeForGolden(item, seen))
    // vm 上下文里的 Map/Set 与主 realm 不是同一个构造器，按 toStringTag 判断
    const tag = Object.prototype.toString.call(value)
    if (tag === "[object Map]") {
      return { $map: [...value.entries()].map(([k, v]) => [normalizeForGolden(k, seen), normalizeForGolden(v, seen)]) }
    }
    if (tag === "[object Set]") return { $set: [...value].map((item) => normalizeForGolden(item, seen)) }
    if (tag === "[object RegExp]") return { $regexp: String(value) }
    if (tag === "[object Date]") return { $date: value.toISOString() }
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = normalizeForGolden(value[key], seen)
    return out
  } finally {
    seen.delete(value)
  }
}

function firstDifference(expected, actual, at = "") {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return null
  const where = at || "<root>"
  if (typeof expected !== typeof actual || expected === null || actual === null || typeof expected !== "object") {
    return `${where}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  }
  if (Array.isArray(expected) !== Array.isArray(actual)) return `${where}: array/object mismatch`
  if (Array.isArray(expected) && expected.length !== actual.length) {
    return `${where}: expected length ${expected.length}, got ${actual.length}`
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)])
  for (const key of keys) {
    const diff = firstDifference(expected[key], actual[key], Array.isArray(expected) ? `${at}[${key}]` : at ? `${at}.${key}` : key)
    if (diff) return diff
  }
  return `${where}: differs`
}

export function createGolden(name) {
  const file = path.join(goldenDir, `${name}.json`)
  const update = process.env.UPDATE_GOLDEN === "1"
  let expected = {}
  if (!update) {
    if (!fs.existsSync(file)) {
      throw new Error(`golden snapshot missing: ${path.relative(process.cwd(), file)}（首次生成用 UPDATE_GOLDEN=1）`)
    }
    expected = JSON.parse(fs.readFileSync(file, "utf8"))
  }
  const actual = {}

  return {
    check(label, value) {
      if (Object.prototype.hasOwnProperty.call(actual, label)) throw new Error(`golden label used twice: ${label}`)
      const normalized = normalizeForGolden(value)
      actual[label] = normalized
      if (update) return
      if (!Object.prototype.hasOwnProperty.call(expected, label)) {
        throw new Error(`golden ${name}: 快照里没有 "${label}"（新增用例后用 UPDATE_GOLDEN=1 刷新）`)
      }
      const diff = firstDifference(expected[label], normalized)
      if (diff) throw new Error(`golden ${name} › ${label} 行为变了 — ${diff}`)
    },
    finish() {
      if (update) {
        fs.mkdirSync(goldenDir, { recursive: true })
        fs.writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`)
        console.log(`[golden] wrote ${path.relative(process.cwd(), file)} (${Object.keys(actual).length} entries)`)
        return
      }
      const stale = Object.keys(expected).filter((label) => !Object.prototype.hasOwnProperty.call(actual, label))
      if (stale.length) throw new Error(`golden ${name}: 快照里有未再检查的条目 ${stale.join(", ")}（删用例后用 UPDATE_GOLDEN=1 刷新）`)
    }
  }
}
