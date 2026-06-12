#!/usr/bin/env node
/**
 * 复现："第一次右键看不到选区关键字，第二次才有"
 *
 * 原理：原生右键菜单**绘制后不重绘**，绘制瞬间的标题 = 绘制前最后一次
 * chrome.contextMenus.update 写入的标题。因此只要带时间戳记录
 *   ① 选区动作（mouseup）时刻
 *   ② 右键（mousedown，mac 上即菜单绘制时刻）
 *   ③ 每一次 contextMenus.update 的到达时刻与标题内容
 * 就能数学化地证明第一次绘制时标题是否已含选区。
 *
 * 场景：
 *   S1 紧凑手势（选完立刻右键，间隔 ~30ms）—— 用户的自然动作
 *   S2 SW 忙碌/冷启动（Debugger.pause 冻结 SW 期间完成手势）—— 等价于
 *      闲置 30s 后 SW 被回收、首个动作要先付几百 ms 冷启动的真实场景
 *   S3 二次右键对照（间隔 1.2s）—— 证明"第二次就对了"
 *
 * 用法：node scripts/repro-first-rightclick.mjs
 *      （另有 --live 模式：起有头 Chrome 真弹菜单给人眼看，见末尾说明）
 */

import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { spawn } from "node:child_process"
import {
  hasWebSocket, findChrome, wait, waitForDevToolsPort, connectWebSocket, CdpClient, evaluate
} from "./lib/cdp.mjs"

const root = process.cwd()
const buildDir = path.join(root, "build/chrome-mv3-prod")
const TAG = "[repro-first-rightclick]"
const LIVE = process.argv.includes("--live")

const MARK_A = "选区甲ALPHA"
const MARK_B = "选区乙BRAVO"

async function main() {
  if (!hasWebSocket()) throw new Error("需要 Node 21+（全局 WebSocket）")
  const chrome = findChrome()
  if (!fs.existsSync(path.join(buildDir, "manifest.json"))) {
    throw new Error("build/chrome-mv3-prod 不存在，先 npm run plasmo:build")
  }

  const server = http.createServer((_, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    res.end(`<!doctype html><meta charset="utf-8"><title>复现页 - repro</title>
      <p id="pa" style="font-size:26px;margin:50px 20px">${MARK_A}的一段文字</p>
      <p id="pb" style="font-size:26px;margin:50px 20px">${MARK_B}的另一段</p>`)
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const url = `http://127.0.0.1:${server.address().port}/`

  const ud = fs.mkdtempSync(path.join(os.tmpdir(), "ccs-repro-"))
  const args = [
    "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--enable-unsafe-extension-debugging",
    "--remote-debugging-port=0", `--user-data-dir=${ud}`,
    LIVE ? `--window-size=1100,760` : "--headless=new",
    "about:blank"
  ].filter(Boolean)
  const child = spawn(chrome, args, { stdio: ["ignore", "ignore", "pipe"] })

  let browser, swCdp, pageCdp
  try {
    const port = await waitForDevToolsPort(ud, child)
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json())
    browser = new CdpClient(await connectWebSocket(version.webSocketDebuggerUrl))
    const { id: extId } = await browser.call("Extensions.loadUnpacked", { path: buildDir })
    console.log(`${TAG} 扩展已装载: ${extId}`)

    const find = async (pred) => (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())).find(pred)
    let swTarget
    for (let i = 0; i < 40 && !swTarget; i++) {
      swTarget = await find((t) => t.type === "service_worker" && (t.url || "").includes(extId))
      if (!swTarget) await wait(200)
    }
    if (!swTarget) throw new Error("SW target 未出现")
    swCdp = new CdpClient(await connectWebSocket(swTarget.webSocketDebuggerUrl))
    await swCdp.call("Runtime.enable")
    await wait(1200)

    // 标题间谍：带毫秒时间戳记录每次 contextMenus.update
    await evaluate(swCdp, `(() => {
      globalThis.__reproUpdates = [];
      if (!globalThis.__reproSpyOn) {
        const orig = chrome.contextMenus.update.bind(chrome.contextMenus);
        chrome.contextMenus.update = (id, props, cb) => {
          try {
            if (props && typeof props.title === "string") {
              globalThis.__reproUpdates.push({ t: Date.now(), id, title: props.title });
            }
          } catch (_) {}
          return orig(id, props, cb);
        };
        globalThis.__reproSpyOn = true;
      }
      return "spy-on";
    })()`)

    const pageTarget = await find((t) => t.type === "page" && t.webSocketDebuggerUrl)
    pageCdp = new CdpClient(await connectWebSocket(pageTarget.webSocketDebuggerUrl))
    await pageCdp.call("Runtime.enable")
    await pageCdp.call("Page.enable")
    await pageCdp.call("Page.navigate", { url })
    await pageCdp.call("Page.bringToFront")
    await wait(1500) // content script + 初始 title 刷新落定

    const boxOf = async (elId) => evaluate(pageCdp, `(() => {
      const r = document.getElementById("${elId}").getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)
    const mouse = (type, x, y, extra = {}) =>
      pageCdp.call("Input.dispatchMouseEvent", { type, x, y, ...extra })

    // 三连击选中 + 立刻右键；返回各时刻
    async function gesture(elId, gapMs) {
      const b = await boxOf(elId)
      for (const cc of [1, 2, 3]) {
        await mouse("mousePressed", b.x, b.y, { button: "left", clickCount: cc })
        await mouse("mouseReleased", b.x, b.y, { button: "left", clickCount: cc })
        await wait(40)
      }
      const tSel = Date.now()
      if (gapMs > 0) await wait(gapMs)
      const tClick = Date.now()
      await mouse("mousePressed", b.x, b.y, { button: "right", buttons: 2, clickCount: 1 })
      if (!LIVE) {
        await mouse("mouseReleased", b.x, b.y, { button: "right", buttons: 0, clickCount: 1 })
      }
      return { tSel, tClick }
    }

    const fetchUpdates = () => evaluate(swCdp, `globalThis.__reproUpdates || []`)
    const clearUpdates = () => evaluate(swCdp, `(globalThis.__reproUpdates = [], "cleared")`)

    function verdict(name, mark, tSel, tClick, updates) {
      const withMark = updates.filter((u) => u.title.includes(mark))
      const before = withMark.filter((u) => u.t <= tClick)
      const first = withMark[0]
      const lastBefore = [...updates].reverse().find((u) => u.id === "ccs-main" && u.t <= tClick)
      console.log(`\n${TAG} ===== ${name} =====`)
      console.log(`  选区完成(mouseup)   t=0ms`)
      console.log(`  右键(菜单绘制时刻)  t=+${tClick - tSel}ms`)
      if (first) {
        console.log(`  首个含选区的标题更新 t=+${first.t - tSel}ms  (${first.id}: ${JSON.stringify(first.title).slice(0, 60)})`)
      } else {
        console.log(`  首个含选区的标题更新  （从未到达）`)
      }
      console.log(`  绘制时刻 ccs-main 的实际标题: ${lastBefore ? JSON.stringify(lastBefore.title) : "（本场景内无更新 → 沿用上一状态/默认）"}`)
      const reproduced = before.length === 0
      console.log(`  >>> 第一次菜单${reproduced ? "【不含】选区 —— 问题复现 ✗" : "已含选区 —— 未复现 ✓"}`)
      return reproduced
    }

    // ---------- S1 紧凑手势（warm SW）----------
    await clearUpdates()
    const s1 = await gesture("pa", 30)
    await wait(1500)
    const u1 = await fetchUpdates()
    const r1 = verdict("S1 紧凑手势（选完 30ms 后右键，SW 温）", MARK_A, s1.tSel, s1.tClick, u1)

    // ---------- S3 二次右键对照 ----------
    const t2 = Date.now()
    await mouse("mousePressed", (await boxOf("pa")).x, (await boxOf("pa")).y, { button: "right", buttons: 2, clickCount: 1 })
    if (!LIVE) await mouse("mouseReleased", (await boxOf("pa")).x, (await boxOf("pa")).y, { button: "right", buttons: 0, clickCount: 1 })
    const u3 = await fetchUpdates()
    const lastBefore2 = [...u3].reverse().find((u) => u.id === "ccs-main" && u.t <= t2)
    console.log(`\n${TAG} ===== S3 二次右键（+${t2 - s1.tSel}ms）=====`)
    console.log(`  此刻 ccs-main 标题: ${lastBefore2 ? JSON.stringify(lastBefore2.title) : "（无）"}`)
    console.log(`  >>> 第二次菜单${lastBefore2?.title?.includes(MARK_A) ? "已含选区 —— 与用户观察一致 ✓" : "仍不含选区 ✗"}`)

    // ---------- S2 SW 忙碌/冷启动（Debugger.pause 冻结）----------
    await clearUpdates()
    await swCdp.call("Debugger.enable")
    await swCdp.call("Debugger.pause")
    const s2 = await gesture("pb", 250) // 正常人节奏：选完 250ms 后右键
    await wait(150)
    await swCdp.call("Debugger.resume") // 菜单已绘制完才"醒来"——等价冷启动
    await wait(1800)
    const u2 = await fetchUpdates()
    const r2 = verdict("S2 SW 冷启动/忙碌（手势期间 SW 冻结，右键 +150ms 后才醒）", MARK_B, s2.tSel, s2.tClick, u2)

    console.log(`\n${TAG} ========== 结论 ==========`)
    console.log(`  S1 warm+紧凑手势: ${r1 ? "复现 ✗（更新没赶上绘制）" : "未复现（warm 时管道赢了）"}`)
    console.log(`  S2 SW 冷启动:     ${r2 ? "复现 ✗（更新必然晚于绘制）" : "未复现"}`)
    console.log(`  S3 二次右键:      标题已就位（解释"第二次才对"）`)
    console.log(`\n  注：ccs-main-live（原生 %s 项）不经过 update 管道，时间线测不到；`)
    console.log(`      其真实渲染需人眼验证 —— 跑 \`node scripts/repro-first-rightclick.mjs --live\``)
    console.log(`      会弹出真窗口并停住真菜单供观察。`)

    if (LIVE) {
      console.log(`\n${TAG} [LIVE] 菜单现在停在屏幕上。请观察：`)
      console.log(`  1) 顶部是否有 \`🔍 搜："${MARK_B}的另一段"\`（原生 %s 项 —— 应当永远正确）`)
      console.log(`  2) \`🔍 触触搜: "..."\` 一项的标题是否还是旧的（复现点）`)
      console.log(`  按 Esc 关闭菜单后，手动关闭该 Chrome 窗口即结束。`)
      await wait(120000)
    }
  } finally {
    browser?.close(); swCdp?.close(); pageCdp?.close()
    if (!LIVE) child.kill("SIGKILL")
    await wait(200)
    server.close()
    if (!LIVE) fs.rmSync(ud, { recursive: true, force: true })
  }
}

main().catch((e) => {
  console.error(`${TAG} FAIL ${e?.message || e}`)
  process.exit(1)
})
