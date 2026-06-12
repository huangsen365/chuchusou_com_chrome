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

  call(method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
  }

  close() {
    try { this.ws.close() } catch (_) { /* noop */ }
  }
}

export async function evaluate(cdp, expression) {
  const result = await cdp.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || result.exceptionDetails.exception?.description || "Runtime.evaluate failed")
  }
  return result.result?.value
}
