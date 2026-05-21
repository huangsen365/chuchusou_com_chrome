#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"

const root = process.cwd()
const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8")
const fastAnswersConfig = JSON.parse(fs.readFileSync(path.join(root, "prompts/fastAnswersPrompts.json"), "utf8"))
const FASTQA_PROMPT = fastAnswersConfig.templateLines.join("\n").replaceAll("${input}", "文心一言速答重复填充回归验证")
const MARKER_HEAD = "请针对以下主题生成回答："
const MARKER_TAIL = "* 在用户确认后，再输出详细内容"

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type
    this.bubbles = !!init.bubbles
    this.cancelable = !!init.cancelable
    this.defaultPrevented = false
    this.target = null
  }

  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true
  }
}

class FakeNode {
  constructor(nodeType, text = "") {
    this.nodeType = nodeType
    this._text = text
    this.parentNode = null
  }

  get textContent() {
    return this._text
  }

  set textContent(value) {
    this._text = String(value || "")
  }

  get innerText() {
    return this.textContent
  }

  set innerText(value) {
    this.textContent = value
  }
}

class FakeElement extends FakeNode {
  constructor(tagName, ownerDocument) {
    super(1)
    this.tagName = String(tagName || "div").toUpperCase()
    this.ownerDocument = ownerDocument
    this.attributes = new Map()
    this.children = []
    this.listeners = new Map()
    this.style = { cssText: "" }
    this.disabled = false
    this.readOnly = false
    this.id = ""
    this.type = ""
    this.__duplicatePromptOnInput = ""
    this.__duplicatedOnInput = false
    this.__pasteEvents = 0
  }

  get isContentEditable() {
    const value = this.getAttribute("contenteditable")
    return value === "" || value === "true" || value === "plaintext-only"
  }

  get textContent() {
    if (this.children.length > 0) return this.children.map(nodeToText).join("")
    return this._text
  }

  set textContent(value) {
    this.children = []
    this._text = String(value || "")
  }

  get innerText() {
    return this.textContent
  }

  set innerText(value) {
    this.textContent = value
  }

  setAttribute(name, value) {
    const key = String(name)
    const normalized = String(value)
    this.attributes.set(key, normalized)
    if (key === "id") this.id = normalized
    if (key === "type") this.type = normalized
  }

  getAttribute(name) {
    const key = String(name)
    return this.attributes.has(key) ? this.attributes.get(key) : null
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(listener)
  }

  dispatchEvent(event) {
    event.target = this
    if (event.type === "paste") this.__pasteEvents += 1
    for (const listener of this.listeners.get(event.type) || []) {
      listener.call(this, event)
    }
    if (event.type === "input" && this.__duplicatePromptOnInput && !this.__duplicatedOnInput) {
      this.__duplicatedOnInput = true
      Promise.resolve().then(() => {
        this.textContent = `${this.textContent}\n${this.__duplicatePromptOnInput}`
      })
    }
    return !event.defaultPrevented
  }

  focus() {
    this.ownerDocument.activeElement = this
  }

  appendChild(child) {
    child.parentNode = this
    this.children.push(child)
    return child
  }

  append(...children) {
    for (const child of children) this.appendChild(child)
  }

  replaceChildren(...children) {
    this.children = []
    this._text = ""
    for (const child of children) this.appendChild(child)
  }

  remove() {
    if (!this.parentNode?.children) return
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this)
    this.parentNode = null
  }

  removeChild(child) {
    this.children = this.children.filter((node) => node !== child)
    child.parentNode = null
    return child
  }

  querySelectorAll(selector) {
    if (selector.includes("contenteditable")) {
      return collectElements(this).filter((element) => element.isContentEditable)
    }
    return []
  }

  getBoundingClientRect() {
    return { width: 640, height: 120, top: 0, left: 0, right: 640, bottom: 120 }
  }
}

class FakeDocumentFragment extends FakeElement {
  constructor(ownerDocument) {
    super("#fragment", ownerDocument)
    this.nodeType = 11
  }
}

function nodeToText(node) {
  if (!node) return ""
  if (node.nodeType === 3) return node.textContent || ""
  if (node.tagName === "BR") return "\n"
  if (Array.isArray(node.children) && node.children.length > 0) {
    return node.children.map(nodeToText).join("")
  }
  return node.textContent || ""
}

function collectElements(rootNode) {
  const out = []
  const visit = (node) => {
    if (!node || node.nodeType !== 1) return
    out.push(node)
    for (const child of node.children || []) visit(child)
  }
  visit(rootNode)
  return out
}

function makeLocation(rawUrl) {
  let href = rawUrl
  return {
    get href() {
      return href
    },
    set href(value) {
      href = String(value)
    },
    get hostname() {
      return new URL(href).hostname
    },
    get hash() {
      return new URL(href).hash
    }
  }
}

function makeHarness({
  url = "https://yiyan.baidu.com/?q=manual",
  prompt = FASTQA_PROMPT,
  pendingId = "pfast_123456",
  initialText = "",
  duplicatePromptOnFirstInput = false
} = {}) {
  const documentListeners = new Map()
  const windowListeners = new Map()
  const messageListeners = []
  const runtimeMessages = []
  const pendingGets = []
  const ackMessages = []
  const execCommands = []
  const location = makeLocation(url)

  const document = {
    readyState: "complete",
    hidden: false,
    title: "AI prompt fill verifier",
    activeElement: null,
    body: null,
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, [])
      documentListeners.get(type).push(listener)
    },
    createElement(tagName) {
      return new FakeElement(tagName, document)
    },
    createTextNode(text) {
      return new FakeNode(3, String(text || ""))
    },
    createDocumentFragment() {
      return new FakeDocumentFragment(document)
    },
    createRange() {
      return {
        selectNodeContents(node) {
          this.commonAncestorContainer = node
        }
      }
    },
    querySelectorAll(selector) {
      if (selector.includes("contenteditable")) return [editor]
      return []
    },
    getElementById(id) {
      return collectElements(document.body).find((element) => element.id === id) || null
    },
    execCommand(command, _showUI, value) {
      execCommands.push({ command, value })
      if (command === "delete") {
        editor.textContent = ""
        return true
      }
      if (command === "insertText") {
        editor.textContent = String(value || "")
        return true
      }
      return false
    }
  }

  document.body = new FakeElement("body", document)
  const editor = new FakeElement("div", document)
  editor.setAttribute("contenteditable", "true")
  editor.setAttribute("role", "textbox")
  editor.textContent = initialText
  if (duplicatePromptOnFirstInput) editor.__duplicatePromptOnInput = prompt
  document.body.appendChild(editor)

  const selection = {
    removeAllRanges() {},
    addRange() {},
    toString() {
      return ""
    },
    get rangeCount() {
      return 0
    }
  }

  const context = {
    console,
    URL,
    URLSearchParams,
    Map,
    Set,
    Date,
    Math,
    RegExp,
    Error,
    Promise,
    Event: FakeEvent,
    KeyboardEvent: FakeEvent,
    MouseEvent: FakeEvent,
    HTMLElement: FakeElement,
    document,
    location,
    top: null,
    setTimeout(fn) {
      Promise.resolve().then(fn)
      return 1
    },
    clearTimeout() {},
    setInterval() {
      return 1
    },
    clearInterval() {},
    requestAnimationFrame(fn) {
      Promise.resolve().then(fn)
      return 1
    },
    chrome: {
      storage: {
        local: {
          get(_keys, callback) {
            callback?.({ ccs_debug: false })
          },
          set() {}
        }
      },
      runtime: {
        id: "test-extension",
        lastError: null,
        onMessage: {
          addListener(listener) {
            messageListeners.push(listener)
          }
        },
        sendMessage(message, callback) {
          runtimeMessages.push(message)
          if (message.action === "ccsGetPendingAIPrompt") {
            pendingGets.push({ message, callback })
            return
          }
          if (message.action === "ccsAckPendingAIPrompt" || message.action === "ccsAckPendingChatGptPrompt") {
            ackMessages.push(message)
            callback?.({ ok: true })
            return
          }
          if (message.action === "ccsGetUrlRecovery") {
            callback?.({ ok: false })
            return
          }
          callback?.({ ok: true })
        }
      }
    },
    history: {
      state: null,
      replaceState(state, _title, nextUrl) {
        this.state = state
        location.href = nextUrl
      }
    },
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, [])
      windowListeners.get(type).push(listener)
    },
    getSelection() {
      return selection
    },
    getComputedStyle() {
      return { display: "block", visibility: "visible", opacity: "1" }
    }
  }

  context.window = context
  context.globalThis = context
  context.self = context
  context.top = context

  vm.runInNewContext(contentSource, context, { filename: "content.js" })

  return {
    context,
    editor,
    pendingGets,
    ackMessages,
    execCommands,
    messageListeners,
    async flush(times = 30) {
      for (let i = 0; i < times; i++) await Promise.resolve()
    },
    sendFill(message = {}) {
      let response
      const listener = messageListeners[0]
      assert.equal(typeof listener, "function", "content script should register one message listener")
      listener({
        action: "ccsFillAIPrompt",
        text: prompt,
        pendingId,
        ...message
      }, {}, (value) => {
        response = value
      })
      return {
        get response() {
          return response
        }
      }
    }
  }
}

function normalize(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim()
}

function countOccurrences(value, needle) {
  let count = 0
  let index = 0
  while (index <= value.length) {
    const found = value.indexOf(needle, index)
    if (found === -1) break
    count += 1
    index = found + needle.length
  }
  return count
}

function assertSinglePrompt(editor) {
  const actual = normalize(editor.textContent)
  assert.equal(actual, normalize(FASTQA_PROMPT), "editor should contain exactly one full fastqa prompt")
  assert.equal(countOccurrences(actual, MARKER_HEAD), 1, "fastqa prompt head should appear once")
  assert.equal(countOccurrences(actual, MARKER_TAIL), 1, "fastqa prompt tail should appear once")
}

async function verifyPullPushRaceDoesNotDuplicate() {
  const pendingId = "pfast_race_123"
  const harness = makeHarness({
    url: `https://yiyan.baidu.com/#ccs_pp=${pendingId}`,
    pendingId
  })

  await harness.flush()
  assert.equal(harness.pendingGets.length, 1, "relay URL should start one pending prompt pull")

  const pushed = harness.sendFill()
  await harness.flush()
  assert.equal(pushed.response?.ok, true, "background-style push should fill successfully")
  assertSinglePrompt(harness.editor)
  assert.equal(harness.ackMessages.length, 1, "push fill should ack once")

  harness.pendingGets[0].callback({ ok: true, prompt: FASTQA_PROMPT, pendingId })
  await harness.flush()
  assertSinglePrompt(harness.editor)
  assert.equal(harness.ackMessages.length, 1, "later pull response should not ack/fill a second time")
}

async function verifyConcurrentMessagesDedupe() {
  const harness = makeHarness()
  const first = harness.sendFill()
  const second = harness.sendFill()

  await harness.flush()
  assert.equal(first.response?.ok, true, "first fill should succeed")
  assert.equal(second.response?.ok, false, "second same-tick fill should be rejected while first is in flight")
  assert.equal(second.response?.error, "fill-in-progress")
  assertSinglePrompt(harness.editor)
  assert.equal(harness.ackMessages.length, 1, "concurrent duplicate messages should only ack once")

  const third = harness.sendFill()
  await harness.flush()
  assert.equal(third.response?.ok, true, "later duplicate message should be treated as already filled")
  assert.equal(third.response?.skipped, true)
  assertSinglePrompt(harness.editor)
  assert.equal(harness.ackMessages.length, 1, "already-filled duplicate should not ack again")
}

async function verifyExistingDuplicateIsRepaired() {
  const harness = makeHarness({
    initialText: `${FASTQA_PROMPT}\n\n${FASTQA_PROMPT}`
  })

  const fill = harness.sendFill()
  await harness.flush()
  assert.equal(fill.response?.ok, true)
  assertSinglePrompt(harness.editor)
  assert.equal(harness.ackMessages.length, 1)
}

async function verifyAsyncEditorDuplicationIsStabilized() {
  const harness = makeHarness({ duplicatePromptOnFirstInput: true })

  const fill = harness.sendFill()
  await harness.flush()
  assert.equal(fill.response?.ok, true)
  assertSinglePrompt(harness.editor)
  assert.equal(harness.ackMessages.length, 1)
  assert.equal(harness.editor.__pasteEvents, 0, "contenteditable fill should not dispatch synthetic paste")
  assert.equal(
    harness.execCommands.some((entry) => entry.command === "insertText"),
    true,
    "contenteditable fill should use controlled text insertion"
  )
}

await verifyPullPushRaceDoesNotDuplicate()
await verifyConcurrentMessagesDedupe()
await verifyExistingDuplicateIsRepaired()
await verifyAsyncEditorDuplicationIsStabilized()

console.log("AI prompt fill dedupe verifier passed")
