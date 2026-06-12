#!/usr/bin/env node
/**
 * 有头 Chrome 真菜单视觉取证：自动弹出原生右键菜单并 screencapture 全屏。
 *
 * L1 首次右键（冷）：选中文字 → Debugger.pause 冻结 SW（等价冷启动）→ 右键
 *    → 真菜单弹出（原生 %s 项由 Chrome 绘制时代入选区；ccs-main 标题停留在旧值）
 *    → 截屏 /tmp/ccs-shot-first.png
 * L2 二次右键等效（温+已更新）：选中文字 → 等 1s 让标题更新落地 → 右键
 *    → 截屏 /tmp/ccs-shot-second.png
 *
 * 注意：mac 原生菜单是模态嵌套事件循环，右键 Input 事件发出后 CDP 回包会被卡住
 * —— 因此右键调用不 await，截屏后直接 SIGKILL 整个 Chrome（菜单随进程消失）。
 * 每个场景独立启动一次 Chrome，互不污染。
 *
 * 用法：node scripts/repro-live-shot.mjs
 */

import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { spawn, execFileSync } from "node:child_process"
import {
  findChrome, wait, waitForDevToolsPort, connectWebSocket, CdpClient, evaluate
} from "./lib/cdp.mjs"

const root = process.cwd()
const buildDir = path.join(root, "build/chrome-mv3-prod")
const TAG = "[repro-live-shot]"
const MARK = "视觉取证选区文本"

async function scenario(name, outPng, { freezeSW }) {
  const server = http.createServer((_, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    res.end(`<!doctype html><meta charset="utf-8"><title>视觉取证页 - ${name}</title>
      <h2 style="margin:30px">${name}</h2>
      <p id="t" style="font-size:30px;margin:60px 30px">${MARK}</p>`)
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const url = `http://127.0.0.1:${server.address().port}/`

  const ud = fs.mkdtempSync(path.join(os.tmpdir(), "ccs-shot-"))
  const child = spawn(findChrome(), [
    "--no-first-run", "--no-default-browser-check",
    "--enable-unsafe-extension-debugging",
    "--remote-debugging-port=0", `--user-data-dir=${ud}`,
    "--window-size=1000,700", "--window-position=80,60",
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] })

  try {
    const port = await waitForDevToolsPort(ud, child)
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json())
    const browser = new CdpClient(await connectWebSocket(version.webSocketDebuggerUrl))
    const { id: extId } = await browser.call("Extensions.loadUnpacked", { path: buildDir })

    const find = async (pred) => (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())).find(pred)
    let swTarget
    for (let i = 0; i < 40 && !swTarget; i++) {
      swTarget = await find((t) => t.type === "service_worker" && (t.url || "").includes(extId))
      if (!swTarget) await wait(200)
    }
    const swCdp = new CdpClient(await connectWebSocket(swTarget.webSocketDebuggerUrl))
    await swCdp.call("Runtime.enable")
    await wait(1200)

    const pageTarget = await find((t) => t.type === "page" && t.webSocketDebuggerUrl)
    const pageCdp = new CdpClient(await connectWebSocket(pageTarget.webSocketDebuggerUrl))
    await pageCdp.call("Runtime.enable")
    await pageCdp.call("Page.enable")
    await pageCdp.call("Page.navigate", { url })
    await pageCdp.call("Page.bringToFront")
    await wait(1800)

    const box = await evaluate(pageCdp, `(() => {
      const r = document.getElementById("t").getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)
    const mouse = (type, extra = {}) =>
      pageCdp.call("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, ...extra })

    // 三连击选中
    for (const cc of [1, 2, 3]) {
      await mouse("mousePressed", { button: "left", clickCount: cc })
      await mouse("mouseReleased", { button: "left", clickCount: cc })
      await wait(50)
    }
    console.log(`${TAG} [${name}] 已选中 "${MARK}"`)

    if (freezeSW) {
      await swCdp.call("Debugger.enable")
      await swCdp.call("Debugger.pause")
      console.log(`${TAG} [${name}] SW 已冻结（等价冷启动）`)
      await wait(80)
    } else {
      await wait(1000) // 让标题更新落地（二次右键等效态）
      console.log(`${TAG} [${name}] 已等待标题更新落地`)
    }

    // 右键 —— 原生菜单进入模态循环，不 await（回包会被卡住）
    mouse("mousePressed", { button: "right", buttons: 2, clickCount: 1 }).catch(() => {})
    console.log(`${TAG} [${name}] 右键已发出，等菜单弹出…`)
    await wait(900)

    execFileSync("screencapture", ["-x", outPng])
    console.log(`${TAG} [${name}] 已截屏 → ${outPng}`)
  } finally {
    try { child.kill("SIGKILL") } catch (_) { /* noop */ }
    await wait(300)
    server.close()
    fs.rmSync(ud, { recursive: true, force: true })
  }
}

await scenario("L1 首次右键（SW 冷启动）", "/tmp/ccs-shot-first.png", { freezeSW: true })
await scenario("L2 二次右键等效（标题已更新）", "/tmp/ccs-shot-second.png", { freezeSW: false })
console.log(`${TAG} 完成。对比 /tmp/ccs-shot-first.png 与 /tmp/ccs-shot-second.png`)
