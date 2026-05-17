#!/usr/bin/env node
/**
 * Cold-start popup 性能静态分析器
 *
 * 不开 Chrome、不需要任何 user gesture，纯 Node 跑，输出：
 *  1. popup.html 引用的同步脚本链 + 字节数（与 Plasmo demo 的 1 bundle 对比）
 *  2. popup 启动路径里的 chrome.storage / sendMessage / fetch / loadScript 异步调用次数
 *  3. lazy-load 的模块清单及大小（点了设置/提示词库才加载的）
 *  4. cold-disk read 时间模拟（连续读所有同步脚本，逼近"首次安装、磁盘 cache 冷"）
 *  5. 整个 popup 启动链总字节量 + 与 Plasmo demo 143KB 单 bundle 的对比
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { performance } from "node:perf_hooks"

const root = process.cwd()

const COLOR = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
  reset: "\x1b[0m"
}

function color(c, s) {
  return `${COLOR[c]}${s}${COLOR.reset}`
}

function bytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function readFile(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8")
}

function statSize(rel) {
  return fs.statSync(path.join(root, rel)).size
}

// ============================================================================
// 1. 解析 popup.html 同步脚本链
// ============================================================================

function parseSyncLoadChain(htmlPath) {
  const html = readFile(htmlPath)
  const baseDir = path.dirname(htmlPath)

  const scripts = []
  const scriptRegex = /<script\s+src=["']([^"']+)["']/g
  let m
  while ((m = scriptRegex.exec(html))) {
    const src = m[1]
    const resolved = path.normalize(path.join(baseDir, src))
    scripts.push(resolved)
  }

  const styles = []
  const linkRegex = /<link\s+[^>]*href=["']([^"']+)["']/g
  while ((m = linkRegex.exec(html))) {
    if (/rel=["']stylesheet["']/.test(m[0])) {
      const href = m[1]
      const resolved = path.normalize(path.join(baseDir, href))
      styles.push(resolved)
    }
  }

  return { html: htmlPath, scripts, styles }
}

// ============================================================================
// 2. 扫描异步调用 (chrome.storage / sendMessage / fetch / loadScript)
// ============================================================================

function countCalls(source, pattern) {
  const re = typeof pattern === "string" ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g") : pattern
  const matches = source.match(re)
  return matches ? matches.length : 0
}

function scanAsyncCalls(filePath) {
  const source = readFile(filePath)
  return {
    storageLocalGet: countCalls(source, /chrome\.storage\.local\.get/g),
    storageLocalSet: countCalls(source, /chrome\.storage\.local\.set/g),
    sendMessage: countCalls(source, /chrome\.runtime\.sendMessage/g),
    fetch: countCalls(source, /\bfetch\(/g),
    loadScript: countCalls(source, /\bloadScript\(/g),
    importScripts: countCalls(source, /\bimportScripts\(/g),
    eventListeners: countCalls(source, /addEventListener\(/g),
    performanceMark: countCalls(source, /performance\.mark\(/g)
  }
}

// ============================================================================
// 3. 识别 lazy-load 的模块（popup.js 里 loadScript('xxx') 的清单）
// ============================================================================

function extractLazyModules(filePath) {
  const source = readFile(filePath)
  const result = []
  const re = /loadScript\s*\(\s*["']([^"']+)["']/g
  let m
  while ((m = re.exec(source))) {
    result.push(m[1])
  }
  return [...new Set(result)]
}

// ============================================================================
// 4. Cold-read 模拟：连续读所有同步脚本，统计 wall-clock + 字节
// ============================================================================

async function coldReadSimulation(files) {
  const results = []
  for (const file of files) {
    const start = performance.now()
    const content = fs.readFileSync(path.join(root, file), "utf8")
    const end = performance.now()
    results.push({
      file,
      bytes: Buffer.byteLength(content),
      readMs: end - start
    })
  }
  return results
}

// ============================================================================
// 5. 主报告
// ============================================================================

function section(title) {
  console.log("")
  console.log(color("bold", color("cyan", `━━━ ${title} ━━━`)))
}

function row(label, value, hint) {
  const labelStr = label.padEnd(40)
  const valueStr = String(value).padEnd(18)
  console.log(`  ${labelStr} ${color("bold", valueStr)} ${hint ? color("gray", hint) : ""}`)
}

async function main() {
  console.log(color("bold", "📊 触触搜 popup cold-start 静态分析"))
  console.log(color("gray", `   root: ${root}`))

  // ---- popup 同步加载链 ----
  section("1. popup.html 同步加载链（点扩展图标到看见菜单的关键路径）")

  const popupChain = parseSyncLoadChain("popup/popup.html")
  const syncFiles = [
    { kind: "HTML", file: "popup/popup.html" },
    ...popupChain.styles.map((f) => ({ kind: "CSS", file: f })),
    ...popupChain.scripts.map((f) => ({ kind: "JS ", file: f }))
  ]

  let totalSyncBytes = 0
  for (const { kind, file } of syncFiles) {
    const size = statSize(file)
    totalSyncBytes += size
    console.log(`  ${color("yellow", kind)}  ${file.padEnd(50)} ${color("bold", bytes(size))}`)
  }

  console.log("")
  row("同步加载文件数", syncFiles.length, "→ 5 个 HTTP 请求（chrome-extension://）")
  row("同步加载总字节", bytes(totalSyncBytes), "→ 浏览器必须 parse + execute 完才能 render")

  console.log("")
  console.log(color("gray", "  📐 Plasmo demo 对比："))
  row("  Plasmo demo popup.html", "248 B", "纯 <script defer> 一行")
  row("  Plasmo demo popup.xxx.js", "143 KB", "包含 React + ReactDOM + 所有逻辑")
  row("  Plasmo demo 请求数", "2", "1 HTML + 1 bundle")

  // ---- popup.js 内的异步调用 ----
  section("2. popup.js 启动时会发起的异步操作")

  const popupAsync = scanAsyncCalls("popup/popup.js")
  row("chrome.storage.local.get 调用点", popupAsync.storageLocalGet, "每次 ~3-15ms（首装/SW 冷启动会更久）")
  row("chrome.storage.local.set 调用点", popupAsync.storageLocalSet, "")
  row("chrome.runtime.sendMessage 调用点", popupAsync.sendMessage, color("red", "→ 这是冷启动慢的元凶：SW 没 warm 时 50-2000ms"))
  row("fetch( 调用点", popupAsync.fetch, "通常是 JSON config 兜底加载")
  row("loadScript( 调用点", popupAsync.loadScript, "lazy-load 的模块入口")
  row("addEventListener", popupAsync.eventListeners, "事件绑定数（与 perf 无直接关系，作参考）")
  row("performance.mark 调用点", popupAsync.performanceMark, "已埋的性能打点")

  console.log("")
  console.log(color("gray", "  📐 Plasmo demo 对比："))
  row("  Plasmo demo chrome.storage.* 调用", "0", "整个启动期间零 storage 访问")
  row("  Plasmo demo sendMessage 调用", "0", "popup 完全 self-contained")
  row("  Plasmo demo fetch 调用", "0", "所有 config 都 import 进 bundle 了")

  // ---- shared/menuStructureBuilder 异步调用（被同步加载） ----
  const builderAsync = scanAsyncCalls("shared/menuStructureBuilder.js")
  const keywordClientAsync = scanAsyncCalls("shared/keywordClient.js")

  section("3. shared/ 同步脚本里的异步调用（同步加载，但启动后会发起的）")
  row("menuStructureBuilder storage/send/fetch",
      `${builderAsync.storageLocalGet}/${builderAsync.sendMessage}/${builderAsync.fetch}`,
      "纯函数 builder，理想应为 0/0/0")
  row("keywordClient storage/send/fetch",
      `${keywordClientAsync.storageLocalGet}/${keywordClientAsync.sendMessage}/${keywordClientAsync.fetch}`,
      "popup 拿 keyword 用的，sendMessage 走 SW")

  // ---- Lazy-loaded modules ----
  section("4. lazy-load 模块（点设置/提示词库才加载，不影响首屏）")

  const lazyModules = extractLazyModules("popup/popup.js")
  let totalLazyBytes = 0
  if (lazyModules.length === 0) {
    console.log(color("yellow", "  (未在 popup.js 中检测到 loadScript() 调用)"))
  } else {
    for (const mod of lazyModules) {
      const candidates = [
        path.join("popup", mod),
        path.join("popup/modules", mod),
        mod
      ]
      let found = null
      for (const c of candidates) {
        if (fs.existsSync(path.join(root, c))) {
          found = c
          break
        }
      }
      if (found) {
        const sz = statSize(found)
        totalLazyBytes += sz
        console.log(`  ${color("gray", "lazy")} ${found.padEnd(48)} ${bytes(sz)}`)
      } else {
        console.log(`  ${color("gray", "lazy")} ${mod.padEnd(48)} ${color("red", "未找到对应文件")}`)
      }
    }
    console.log("")
    row("lazy 模块总字节", bytes(totalLazyBytes), "首屏不算这部分；点设置才会下载")
  }

  // ---- Cold-disk 读时间模拟 ----
  section("5. Cold-disk read 模拟（连续读所有同步脚本）")

  const coldFiles = syncFiles.map((s) => s.file)
  const readResults = await coldReadSimulation(coldFiles)
  let totalReadMs = 0
  for (const r of readResults) {
    totalReadMs += r.readMs
    const slow = r.readMs > 5 ? color("yellow", `${r.readMs.toFixed(2)} ms`) : `${r.readMs.toFixed(2)} ms`
    console.log(`  ${r.file.padEnd(50)} ${bytes(r.bytes).padEnd(10)} ${slow}`)
  }
  console.log("")
  row("总读取时间（warm cache）", `${totalReadMs.toFixed(2)} ms`, "首装/磁盘繁忙时此数会乘 5-20 倍")

  // ---- 总结对比 ----
  section("6. 总结：触触搜 vs Plasmo demo")

  console.log("")
  console.log(`  ${"维度".padEnd(40)} ${"触触搜 v1.6.16".padEnd(20)} Plasmo demo`)
  console.log(`  ${"─".repeat(40)} ${"─".repeat(20)} ${"─".repeat(20)}`)
  console.log(`  ${"popup 同步加载文件数".padEnd(40)} ${String(syncFiles.length).padEnd(20)} 2`)
  console.log(`  ${"popup 同步加载总字节".padEnd(40)} ${bytes(totalSyncBytes).padEnd(20)} 143 KB`)
  console.log(`  ${"popup.js 内 storage.get 数".padEnd(40)} ${String(popupAsync.storageLocalGet).padEnd(20)} 0`)
  console.log(`  ${"popup.js 内 sendMessage 数".padEnd(40)} ${String(popupAsync.sendMessage).padEnd(20)} 0`)
  console.log(`  ${"popup.js 内 fetch 数".padEnd(40)} ${String(popupAsync.fetch).padEnd(20)} 0`)
  console.log("")

  // ---- 给出明确建议 ----
  section("7. 性能瓶颈定位")

  if (popupAsync.sendMessage > 0) {
    console.log(color("red", `  ⚠ popup.js 有 ${popupAsync.sendMessage} 处 chrome.runtime.sendMessage`))
    console.log(color("gray", "    → 这是冷启动最大杀手。SW 首次启动需 importScripts 串行加载 ~24 个 JS，"))
    console.log(color("gray", "      在首装/低端机/Chrome Web Store install 后第一次打开 popup 时延迟 200-2000ms。"))
    console.log(color("gray", "      Plasmo demo 形态 0 次，启动完全 self-contained。"))
  }

  if (popupAsync.storageLocalGet >= 3) {
    console.log("")
    console.log(color("yellow", `  ⚠ popup.js 有 ${popupAsync.storageLocalGet} 处 chrome.storage.local.get`))
    console.log(color("gray", "    → 每次 3-15ms，首装时 storage 是冷的会更慢。"))
    console.log(color("gray", "      Plasmo demo 形态把 config import 进 bundle，0 次 storage 访问。"))
  }

  if (syncFiles.length > 3) {
    console.log("")
    console.log(color("yellow", `  ⚠ 同步加载 ${syncFiles.length} 个文件`))
    console.log(color("gray", "    → 浏览器要解析 HTML、然后串行下载/解析每个 <script>。"))
    console.log(color("gray", "      Plasmo demo 形态只有 2 个文件，1 个 bundle 一次性 parse+exec。"))
  }

  console.log("")
  console.log(color("green", "  ✓ 跑 ./scripts/test-perf.sh 起一个干净 Chrome profile 装这个项目，"))
  console.log(color("green", "    在 popup DevTools 里测真实 wall-clock 时间，验证以上分析。"))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
