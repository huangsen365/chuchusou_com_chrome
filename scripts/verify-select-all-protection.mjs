#!/usr/bin/env node

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

const root = process.cwd()
const chromeCandidates = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean)

function findChrome() {
  for (const candidate of chromeCandidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error("Chrome not found. Set CHROME_BIN to run this verifier.")
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForDevToolsPort(userDataDir, child) {
  const portFile = path.join(userDataDir, "DevToolsActivePort")
  const deadline = Date.now() + 10_000
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

function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.addEventListener("open", () => resolve(ws), { once: true })
    ws.addEventListener("error", reject, { once: true })
  })
}

class CdpClient {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data)
      if (!msg.id || !this.pending.has(msg.id)) return
      const { resolve, reject } = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      if (msg.error) reject(new Error(`${msg.error.message || "CDP error"} ${JSON.stringify(msg.error.data || "")}`))
      else resolve(msg.result)
    })
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

async function evaluate(cdp, expression) {
  const result = await cdp.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed")
  }
  return result.result?.value
}

async function main() {
  // 找不到 Chrome 时优雅跳过（CI ubuntu-latest / 本地 mac 都有 Chrome；
  // 无 Chrome 的环境不该因此 brick 整条 npm test 链）。测试失败仍硬性报错。
  let chrome
  try {
    chrome = findChrome()
  } catch (err) {
    console.warn(`[verify-select-all-protection] ⚠ SKIPPED — ${err.message}`)
    return
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccs-select-all-"))
  const child = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] })

  let stderr = ""
  child.stderr.on("data", (chunk) => { stderr += chunk.toString() })

  let cdp
  try {
    const port = await waitForDevToolsPort(userDataDir, child)
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
    const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl)
    if (!page) throw new Error("No page target found")

    cdp = new CdpClient(await connectWebSocket(page.webSocketDebuggerUrl))
    await cdp.call("Runtime.enable")
    await cdp.call("Page.enable")

    const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8")
    const expression = `
      (async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        document.title = 'HTML Title Should Not Win';
        document.body.innerHTML = \`
          <main>
            <div id="editor" contenteditable="true" style="white-space: pre-wrap">
              <p>第一段：全选应该保留这一整段。</p>
              <span contenteditable="false"><img alt="image-breaker" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></span>
              <p>第二段：图片节点后面的文字不能丢。</p>
              <p>第三段：慢速释放快捷键时也不能退回页面标题。</p>
            </div>
          </main>
        \`;
        window.__ccsMessages = [];
        window.__ccsListeners = [];
        window.__ccsStorageWrites = [];
        window.chrome = {
          storage: {
            local: {
              get: (_keys, cb) => cb({ ccs_debug: true }),
              set: (items) => { window.__ccsStorageWrites.push(items); }
            }
          },
          runtime: {
            id: 'test-extension',
            sendMessage: (msg) => { window.__ccsMessages.push(msg); },
            onMessage: { addListener: (fn) => { window.__ccsListeners.push(fn); } }
          }
        };
        ${contentSource}
        await wait(60);

        const editor = document.getElementById('editor');
        const selectEditor = () => {
          const range = document.createRange();
          range.selectNodeContents(editor);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        };

        editor.focus();
        selectEditor();
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'a',
          ctrlKey: true,
          bubbles: true,
          cancelable: true
        }));
        await wait(60);

        const selectionMessages = () => window.__ccsMessages.filter((msg) => msg.action === 'selectionChanged');
        const afterSelectAll = selectionMessages();
        const longMessage = afterSelectAll[afterSelectAll.length - 1];
        if (!longMessage || !longMessage.text.includes('第二段') || !longMessage.text.includes('第三段')) {
          throw new Error('select-all did not capture the full rich-text editor content');
        }

        window.getSelection().removeAllRanges();
        document.dispatchEvent(new KeyboardEvent('keyup', {
          key: 'a',
          ctrlKey: true,
          bubbles: true,
          cancelable: true
        }));
        await wait(90);
        const afterSlowRelease = selectionMessages();
        const newMessages = afterSlowRelease.slice(afterSelectAll.length);
        if (newMessages.some((msg) => !msg.text || msg.text.trim().length === 0)) {
          throw new Error('slow keyup sent an empty selection during select-all protection');
        }

        let snapshot = null;
        window.__ccsListeners[0]({ action: 'fetchSelectionSnapshot', preferEmpty: true }, {}, (response) => {
          snapshot = response;
        });
        if (!snapshot || snapshot.source !== 'protected-state' || !snapshot.text.includes('第三段')) {
          throw new Error('fetchSelectionSnapshot did not preserve protected select-all state');
        }

        document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        window.getSelection().removeAllRanges();
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        await wait(90);
        const afterMouseClear = selectionMessages();
        const mouseClearSent = afterMouseClear.slice(afterSlowRelease.length)
          .some((msg) => msg.trigger === 'mouseup' && (!msg.text || msg.text.trim().length === 0));
        if (!mouseClearSent) {
          throw new Error('explicit mouse clear should still send an empty selection');
        }

        return {
          capturedLength: longMessage.text.trim().length,
          slowReleaseMessages: newMessages.length,
          snapshotSource: snapshot.source,
          mouseClearSent
        };
      })()
    `

    const value = await evaluate(cdp, expression)
    console.log(`[verify-select-all-protection] OK ${JSON.stringify(value)}`)
  } finally {
    cdp?.close()
    child.kill()
    fs.rmSync(userDataDir, { recursive: true, force: true })
    if (child.exitCode && stderr) {
      console.error(stderr)
    }
  }
}

main().catch((error) => {
  console.error(`[verify-select-all-protection] FAIL ${error?.message || error}`)
  process.exit(1)
})
