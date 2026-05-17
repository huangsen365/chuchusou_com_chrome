#!/usr/bin/env node
/**
 * Popup 性能预算守门员（perf budget verifier）
 *
 * v1.6.16 实测 popup 冷启动 34ms。要保住这个数字，关键路径上有几条铁律：
 *  1. popup.html 同步加载的 <script> 数量要少（每个都是磁盘读 + 解析 + 执行）
 *  2. 静态预渲染（pre-rendered）的菜单项要够多 —— 保证零 JS 也能首屏看到
 *  3. popup.js 启动路径 chrome.runtime.sendMessage 数要受控（每个都是 IPC RTT）
 *  4. 主 bundle 字节数 < 250KB（Plasmo demo 单 bundle 143KB 是上限基线）
 *
 * 任一不达标 → 退出码 1，npm test 失败。
 *
 * 这只是静态分析，不开 Chrome 不点鼠标。要看真实启动时序请跑 `npm run perf:cold-popup`。
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const root = process.cwd()

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

function readFile(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8")
}

const BUDGETS = {
  // popup.html 内 <script src=...> 同步加载 ≤ MAX_SYNC_SCRIPTS
  // 当前实际 = 3（keywordClient + menuStructureBuilder + popup.js）。给点头部留 2。
  MAX_SYNC_SCRIPTS: 5,
  // 静态预渲染菜单项 ≥ MIN_PRERENDERED_ITEMS（用户首屏立即可见，不依赖 JS）
  // v1.6.16 实际 8 个（百度/Google/ChatGPT/Claude/Grok/yiyan/google-ai/zhihu）
  MIN_PRERENDERED_ITEMS: 8,
  // chrome.runtime / chrome.tabs sendMessage 调用点数 ≤ MAX_SEND_MESSAGE
  // 当前实际 11（settings / sidepanel / pin / content sync 各几条）。给点头部留 4。
  MAX_SEND_MESSAGE: 15,
  // popup.js 文件字节数 ≤ MAX_POPUP_JS_BYTES（仅主入口，不含懒加载模块）
  // 当前 ~50KB；阈值 250KB（Plasmo demo 单 bundle 143KB 上限附近）
  MAX_POPUP_JS_BYTES: 250 * 1024
}

function checkSyncScripts() {
  const html = readFile("popup/popup.html")
  const matches = html.match(/<script\s+src=["'][^"']+["']/g) || []
  const count = matches.length
  if (count > BUDGETS.MAX_SYNC_SCRIPTS) {
    fail(`popup.html 同步 <script> 数 ${count} 超出预算 ${BUDGETS.MAX_SYNC_SCRIPTS}`)
  }
  ok(`popup.html 同步脚本 ${count} ≤ ${BUDGETS.MAX_SYNC_SCRIPTS}`)
}

function checkPrerenderedItems() {
  const html = readFile("popup/popup.html")
  const matches = html.match(/data-menu-id=["']ccs-[^"']+["']/g) || []
  const count = matches.length
  if (count < BUDGETS.MIN_PRERENDERED_ITEMS) {
    fail(`popup.html 静态预渲染菜单项 ${count} 低于下限 ${BUDGETS.MIN_PRERENDERED_ITEMS}（零 JS 首屏会缺项）`)
  }
  ok(`popup.html 预渲染菜单项 ${count} ≥ ${BUDGETS.MIN_PRERENDERED_ITEMS}`)
}

function checkSendMessageCount() {
  const js = readFile("popup/popup.js")
  // 匹配 chrome.runtime.sendMessage / chrome.tabs.sendMessage 调用点
  const matches = js.match(/chrome\.(runtime|tabs)\.sendMessage\b/g) || []
  const count = matches.length
  if (count > BUDGETS.MAX_SEND_MESSAGE) {
    fail(`popup.js sendMessage 调用点 ${count} 超出预算 ${BUDGETS.MAX_SEND_MESSAGE}（每个都是 IPC RTT）`)
  }
  ok(`popup.js sendMessage 调用点 ${count} ≤ ${BUDGETS.MAX_SEND_MESSAGE}`)
}

function checkPopupJsBytes() {
  const stat = fs.statSync(path.join(root, "popup/popup.js"))
  const size = stat.size
  if (size > BUDGETS.MAX_POPUP_JS_BYTES) {
    fail(`popup.js ${size} 字节超出预算 ${BUDGETS.MAX_POPUP_JS_BYTES}（${(size / 1024).toFixed(1)}KB > ${(BUDGETS.MAX_POPUP_JS_BYTES / 1024).toFixed(0)}KB）`)
  }
  ok(`popup.js ${(size / 1024).toFixed(1)}KB ≤ ${(BUDGETS.MAX_POPUP_JS_BYTES / 1024).toFixed(0)}KB`)
}

function main() {
  checkSyncScripts()
  checkPrerenderedItems()
  checkSendMessageCount()
  checkPopupJsBytes()
  console.log(`${COLOR.green}[verify-perf-budget] 4 项 popup 性能预算全部通过${COLOR.reset}`)
}

main()
