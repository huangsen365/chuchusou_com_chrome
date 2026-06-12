/**
 * 共享 CDP（Chrome DevTools Protocol）管道
 *
 * 被 verify-select-all-protection.mjs / verify-extension-smoke.mjs 复用。
 * 依赖全局 WebSocket（Node 21+）；调用方应先 hasWebSocket() 特性检测并优雅跳过。
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const chromeCandidates = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean)

export function hasWebSocket() {
  return typeof WebSocket !== "undefined"
}

export function findChrome() {
  for (const candidate of chromeCandidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error("Chrome not found. Set CHROME_BIN to run this verifier.")
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function waitForDevToolsPort(userDataDir, child, timeoutMs = 10_000) {
  const portFile = path.join(userDataDir, "DevToolsActivePort")
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`Chrome exited early with code ${child.exitCode}`)
    }
    if (fs.existsSync(portFile)) {
      const [port] = fs.readFileSync(portFile, "utf8").trim().split(/\r?\n/)
      if (port) return port
    }
    await wait(100)
  }
  throw new Error("Timed out waiting for Chrome DevToolsActivePort")
}

export function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.addEventListener("open", () => resolve(ws), { once: true })
    ws.addEventListener("error", reject, { once: true })
  })
}

export class CdpClient {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.eventListeners = new Map()
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data)
      if (msg.method && this.eventListeners.has(msg.method)) {
        for (const fn of this.eventListeners.get(msg.method)) fn(msg.params)
      }
      if (!msg.id || !this.pending.has(msg.id)) return
      const { resolve, reject } = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      if (msg.error) reject(new Error(`${msg.error.message || "CDP error"} ${JSON.stringify(msg.error.data || "")}`))
      else resolve(msg.result)
    })
  }

  on(method, fn) {
    if (!this.eventListeners.has(method)) this.eventListeners.set(method, [])
    this.eventListeners.get(method).push(fn)
  }

  call(method, params = {}, { timeoutMs = 20_000 } = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      // 单调用超时：target 死亡（页面自关/崩溃）时 CDP 永不回包 ——
      // 没有这层兜底就是无声悬挂直到全局看门狗（实测踩过：popup 点击后
      // window.close 赢过回包的竞态）。
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        reject(new Error(`CDP ${method} 在 ${timeoutMs}ms 内无回包（target 可能已关闭）`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) }
      })
    })
  }

  close() {
    try { this.ws.close() } catch (_) { /* noop */ }
  }
}

export async function evaluate(cdp, expression, { timeoutMs } = {}) {
  const result = await cdp.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, timeoutMs ? { timeoutMs } : {})
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || result.exceptionDetails.exception?.description || "Runtime.evaluate failed")
  }
  return result.result?.value
}
