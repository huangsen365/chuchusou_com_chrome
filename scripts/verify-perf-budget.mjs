#!/usr/bin/env node
/**
 * Plasmo 产物性能预算守门员（perf budget verifier）
 *
 * Plasmo 全 manifest 接管后，监控对象从 legacy popup/* 切换到 build 产物：
 *  1. popup bundle 字节数 ≤ 600KB（React + PopupController + 依赖）
 *  2. content bundle 字节数 ≤ 250KB（20 个聚合模块 + 主入口）
 *  3. sidepanel bundle 字节数 ≤ 600KB（含可能 lazy import 的 Voice）
 *  4. SW bundle 字节数 ≤ 50KB（Plasmo SW 入口本身极薄，只 importScripts legacy）
 *
 * 这些预算保守，目的是在 Plasmo bundle 失控（比如 React Native 误装、大 lib 误进）时拦下来。
 * 真实启动时序请跑 `npm run perf:cold-popup` 或在 Chrome devtools 看 cold start。
 *
 * 任一不达标 → 退出码 1，npm test 失败。需要先 `npm run plasmo:build`。
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const root = process.cwd()
const buildDir = path.join(root, "build/chrome-mv3-prod")

const COLOR = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  reset: "\x1b[0m"
}

function fail(msg) {
  console.error(`${COLOR.red}[verify-perf-budget] ✗ ${msg}${COLOR.reset}`)
  process.exit(1)
}

function ok(msg) {
  console.log(`${COLOR.green}[verify-perf-budget] ✓ ${msg}${COLOR.reset}`)
}

function warn(msg) {
  console.warn(`${COLOR.yellow}[verify-perf-budget] ⚠ ${msg}${COLOR.reset}`)
}

const BUDGETS = {
  POPUP_BUNDLE_MAX: 600 * 1024,     // Plasmo React popup
  CONTENT_BUNDLE_MAX: 250 * 1024,   // 20 个聚合模块 + 主入口
  SIDEPANEL_BUNDLE_MAX: 600 * 1024, // React + PinnedAction + dynamic Voice
  SW_BUNDLE_MAX: 50 * 1024          // Plasmo SW 极薄（importScripts bridge）
}

/**
 * 在 build dir 找匹配 prefix.{hash}.js 的 bundle 文件
 * 例如 prefix="popup" 会匹配 popup.abc123.js（Plasmo hashed filename）
 */
function findHashedBundle(prefix) {
  if (!fs.existsSync(buildDir)) return null
  const entries = fs.readdirSync(buildDir)
  // Plasmo hashed: prefix.{8hex}.js
  const hashedRe = new RegExp(`^${prefix}\\.[0-9a-f]{6,}\\.js$`)
  const hit = entries.find((f) => hashedRe.test(f))
  if (hit) return path.join(buildDir, hit)
  // 退路：精确 prefix.js（无 hash）
  const exact = path.join(buildDir, `${prefix}.js`)
  if (fs.existsSync(exact)) return exact
  return null
}

function checkBundleSize(label, file, max) {
  if (!file) {
    warn(`${label} bundle 找不到（跑 npm run plasmo:build 后再试）`)
    return
  }
  const size = fs.statSync(file).size
  const rel = path.relative(root, file)
  if (size > max) {
    fail(`${label} bundle ${rel} ${(size / 1024).toFixed(1)}KB 超出预算 ${(max / 1024).toFixed(0)}KB`)
  }
  ok(`${label} bundle ${rel} ${(size / 1024).toFixed(1)}KB ≤ ${(max / 1024).toFixed(0)}KB`)
}

function checkSwBundle() {
  const swPath = path.join(buildDir, "static/background/index.js")
  if (!fs.existsSync(swPath)) {
    warn("SW bundle 找不到（跑 npm run plasmo:build 后再试）")
    return
  }
  const size = fs.statSync(swPath).size
  if (size > BUDGETS.SW_BUNDLE_MAX) {
    fail(`SW bundle ${(size / 1024).toFixed(1)}KB 超出预算 ${(BUDGETS.SW_BUNDLE_MAX / 1024).toFixed(0)}KB（应只是 importScripts bridge，超出说明误塞了大依赖）`)
  }
  ok(`SW bundle static/background/index.js ${(size / 1024).toFixed(1)}KB ≤ ${(BUDGETS.SW_BUNDLE_MAX / 1024).toFixed(0)}KB`)
}

function main() {
  if (!fs.existsSync(buildDir)) {
    warn(`build dir ${path.relative(root, buildDir)} 不存在，跳过 perf budget 检查（先跑 npm run plasmo:build）`)
    process.exit(0)
  }

  checkBundleSize("popup", findHashedBundle("popup"), BUDGETS.POPUP_BUNDLE_MAX)
  checkBundleSize("content", findHashedBundle("content"), BUDGETS.CONTENT_BUNDLE_MAX)
  checkBundleSize("sidepanel", findHashedBundle("sidepanel"), BUDGETS.SIDEPANEL_BUNDLE_MAX)
  checkSwBundle()
  console.log(`${COLOR.green}[verify-perf-budget] 4 项 Plasmo bundle 预算全部通过${COLOR.reset}`)
}

main()
