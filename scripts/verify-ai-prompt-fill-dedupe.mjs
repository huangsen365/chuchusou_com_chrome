#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { readPromptConfig } from "./lib/prompts.mjs"

const root = process.cwd()
const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8")
// manifest 里 modules/chatGptDom.js 先于 content.js 加载（ChatGPT 输入框定位在里面）
const chatGptDomSource = fs.readFileSync(path.join(root, "modules/chatGptDom.js"), "utf8")
// 提示词正文在 prompts/*.md（JSON 的 templateFile 指向），readPromptConfig 展开成 templateLines
const fastAnswersConfig = readPromptConfig(root, "prompts/fastAnswersPrompts.json").config
const topQuestionsConfig = readPromptConfig(root, "prompts/topQuestionsPrompts.json").config
const optimizedPromptsConfig = readPromptConfig(root, "prompts/optimizedPrompts.json").config
const coverPromptsConfig = readPromptConfig(root, "prompts/coverPrompts.json").config
const FASTQA_PROMPT = fastAnswersConfig.templateLines.join("\n").replaceAll("${input}", "文心一言速答重复填充回归验证")
const MARKER_HEAD = "请针对以下主题生成回答："
const MARKER_TAIL = "* B 的口吻要求："

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type
    this.bubbles = !!init.bubbles
    this.cancelable = !!init.cancelable
    this.defaultPrevented = false
    this.target = null
    if (init.clipboardData !== undefined) {
      this.clipboardData = init.clipboardData
    }
  }

  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true
  }
}

class FakeDataTransfer {
  constructor() {
    this._data = new Map()
  }

  setData(type, value) {
    this._data.set(String(type), String(value || ""))
  }

  getData(type) {
    return this._data.get(String(type)) || ""
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
    if (child?.nodeType === 11 && Array.isArray(child.children)) {
      for (const fragmentChild of child.children) this.appendChild(fragmentChild)
      child.children = []
      return child
    }
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
    if (selector === "br" || selector.split(",").some((part) => part.trim() === "br")) {
      return collectElements(this).filter((element) => element.tagName === "BR")
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
  duplicatePromptOnFirstInput = false,
  consumesPaste = true,
  consumesPasteSilently = false,
  consumesInsertHtml = false,
  yiyanSlateBridge = false,
  editorTag = "div"
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
    removeEventListener(type, listener) {
      documentListeners.set(type, (documentListeners.get(type) || []).filter((entry) => entry !== listener))
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
      if (editor.tagName === "TEXTAREA" && selector.includes("textarea")) return [editor]
      if (editor.tagName === "INPUT" && selector.includes("input")) return [editor]
      if (editor.isContentEditable && selector.includes("contenteditable")) return [editor]
      return []
    },
    getElementById(id) {
      return collectElements(document.body).find((element) => element.id === id) || null
    },
    execCommand(command, _showUI, value) {
      execCommands.push({ command, value })
      if (command === "delete") {
        editor.children = []
        editor._text = ""
        return true
      }
      if (command === "insertHTML" && insertHtmlReceiver) {
        return insertHtmlReceiver(String(value || ""))
      }
      if (command === "insertParagraph" || command === "insertLineBreak") {
        editor.textContent = `${editor.textContent}\n`
        return true
      }
      if (command === "insertText") {
        editor.textContent = `${editor.textContent}${String(value || "")}`
        return true
      }
      return false
    }
  }

  document.body = new FakeElement("body", document)
  let editor = new FakeElement(editorTag, document)
  if (editor.tagName === "TEXTAREA" || editor.tagName === "INPUT") {
    editor.value = initialText
    editor.setAttribute("placeholder", "询问AI任何问题")
  } else {
    editor.setAttribute("contenteditable", "true")
    editor.setAttribute("role", "textbox")
    editor.textContent = initialText
  }
  if (duplicatePromptOnFirstInput) editor.__duplicatePromptOnInput = prompt
  document.body.appendChild(editor)

  // 模拟 ChatGPT(ProseMirror) / Grok(Lexical) 那种 React 系编辑器：
  // - 合成 paste 因 isTrusted=false 不消费
  // - 但 Chrome 内核发出的 insertHTML→beforeinput 会被它们处理
  let insertHtmlReceiver = null
  if (consumesInsertHtml) {
    insertHtmlReceiver = (html) => {
      editor.children = []
      editor._text = ""
      // 模拟 ProseMirror/Lexical 的"逐 <p> 解析"：每个 <p>...</p> 变一个段落节点，
      // 段落之间用一个 <br> 标记 textContent 里的换行。
      const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi
      const matches = []
      let m
      while ((m = pRegex.exec(html)) !== null) matches.push(m[1])
      matches.forEach((inner, index) => {
        if (index > 0) editor.appendChild(new FakeElement("br", document))
        const text = inner
          .replace(/<br\s*\/?>/gi, "")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
        if (text) editor.appendChild(new FakeNode(3, text))
      })
      const inputEvent = new FakeEvent("input", { bubbles: true, cancelable: false })
      editor.dispatchEvent(inputEvent)
      return true
    }
  }

  // 模拟 简单 contenteditable（如 yiyan）：editor 自带 paste handler，
  // 收到 paste 时调用 preventDefault 并把多行内容按 paragraph+br 落进 DOM。
  // consumesPasteSilently=true 时模拟 yiyan v4 的 case：paste consumed 但不 dispatch input ——
  // 此时 React state 不同步，必须靠 content.js 自己 dispatchEditableEvents 兜底。
  if (consumesPaste || consumesPasteSilently) {
    editor.addEventListener("paste", function onProseMirrorPaste(event) {
      const data = event.clipboardData
      if (!data || typeof data.getData !== "function") return
      const plain = data.getData("text/plain") || ""
      if (!plain) return
      event.preventDefault()
      this.children = []
      this._text = ""
      const lines = String(plain).split("\n")
      lines.forEach((line, index) => {
        if (index > 0) this.appendChild(new FakeElement("br", document))
        if (line) this.appendChild(new FakeNode(3, line))
      })
      if (!consumesPasteSilently) {
        const inputEvent = new FakeEvent("input", { bubbles: true, cancelable: false })
        this.dispatchEvent(inputEvent)
      }
    })
  }
  // 计数所有 input 事件，确保填完后至少有一次 React-syncable input 触发
  editor.__inputEventCount = 0
  editor.addEventListener("input", () => {
    editor.__inputEventCount += 1
  })

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
    ClipboardEvent: FakeEvent,
    InputEvent: FakeEvent,
    CompositionEvent: FakeEvent,
    FocusEvent: FakeEvent,
    DataTransfer: FakeDataTransfer,
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
          if (message.action === "ccsFillYiyanSlatePromptInMainWorld") {
            if (!yiyanSlateBridge) {
              callback?.({ ok: false, error: "slate-bridge-disabled" })
              return
            }
            const beforeLength = normalize(editor.textContent).length
            editor.textContent = String(message.text || "")
            editor.dispatchEvent(new FakeEvent("input", { bubbles: true, cancelable: true }))
            callback?.({
              ok: true,
              method: "yiyan-slate-main-world",
              beforeLength,
              afterLength: normalize(editor.textContent).length
            })
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

  vm.createContext(context)
  vm.runInContext(chatGptDomSource, context, { filename: "modules/chatGptDom.js" })
  vm.runInContext(contentSource, context, { filename: "content.js" })

  return {
    context,
    get editor() { return editor },
    replaceEditor(text = "") {
      const replacement = new FakeElement(editorTag, document)
      replacement.setAttribute("contenteditable", "true")
      replacement.setAttribute("role", "textbox")
      replacement.textContent = text
      document.body.replaceChildren(replacement)
      editor = replacement
    },
    dispatchUserEvent(type, init = {}) {
      const event = Object.assign(new FakeEvent(type), { target: editor, isTrusted: true }, init)
      for (const listener of documentListeners.get(type) || []) listener(event)
    },
    listenerCount(type) { return (documentListeners.get(type) || []).length },
    pendingGets,
    ackMessages,
    runtimeMessages,
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
  assert.equal(
    countOccurrences(actual, "\n") >= Math.floor(countOccurrences(FASTQA_PROMPT, "\n") * 0.8),
    true,
    "editor should preserve the fastqa prompt line break structure"
  )
  assert.equal(
    editor.querySelectorAll("br").length >= Math.floor(countOccurrences(FASTQA_PROMPT, "\n") * 0.8),
    true,
    "editor should contain structural line break nodes, not only raw newline characters"
  )
}

function assertNoBulkMultilineInsertText(execCommands) {
  // 任何走 execCommand fallback 的路径都不允许把整段带 \n 的文本一次性塞进去
  // ——现代编辑器（ProseMirror/Lexical）会把 \n 吞成一行，导致用户看到"只剩一段、后面全丢"。
  const bulkMultilineTextCommands = execCommands.filter((entry) => {
    return entry.command === "insertText" && String(entry.value || "").includes("\n")
  })
  assert.equal(bulkMultilineTextCommands.length, 0, "contenteditable fill should not bulk insert multi-line text")
}

function assertPromptTemplateNewlines() {
  const configs = [
    ["fastqa", fastAnswersConfig],
    ["top100", topQuestionsConfig],
    ["optimize", optimizedPromptsConfig],
    ["cover", coverPromptsConfig]
  ]
  for (const [name, config] of configs) {
    const template = config.templateLines.join("\n")
    assert.equal(template.includes("\\n"), false, `${name} template should not contain literal backslash-n separators`)
    assert.equal(template.includes("\n\n"), true, `${name} template should preserve blank lines`)
    const prompt = template
      .replaceAll("${input}", "换行验证主题")
      .replaceAll("${purpose}", "换行验证目的")
      .replaceAll("${ratio}", "5:2")
    assert.equal(prompt.includes("换行验证主题"), true, `${name} prompt should include input`)
    assert.equal(prompt.split("\n").length, template.split("\n").length, `${name} prompt should keep real newline structure`)
  }
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

async function verifyExistingUnrelatedDraftIsPreserved() {
  const draft = "这是用户尚未发送的独立草稿，不能被自动提示词覆盖。"
  const harness = makeHarness({ initialText: draft })

  const fill = harness.sendFill()
  await harness.flush()
  assert.equal(fill.response?.ok, false, "existing draft should reject automatic fill")
  assert.equal(fill.response?.stage, "existing_draft", "existing draft rejection should be explicit")
  assert.equal(normalize(harness.editor.textContent), draft, "existing draft must remain unchanged")
  assert.equal(harness.ackMessages.length, 0, "rejected prompt must remain unacknowledged")
}

async function verifyAsyncEditorDuplicationIsStabilized() {
  const harness = makeHarness({ duplicatePromptOnFirstInput: true })

  const fill = harness.sendFill()
  await harness.flush()
  assert.equal(fill.response?.ok, true)
  assertSinglePrompt(harness.editor)
  assert.equal(harness.ackMessages.length, 1)
  // 不再禁止 bulk insertText —— 它是 Lexical PlainText/yiyan 系编辑器的合法 tier 2。
  // 通过 assertSinglePrompt 已经验证最终结果保留了换行结构。
}

async function verifyClaudeMultilineUsesPasteHandler() {
  const harness = makeHarness({
    url: "https://claude.ai/new#ccs_pp=pclaude_123456",
    pendingId: "pclaude_123456"
  })

  const fill = harness.sendFill()
  await harness.flush()
  assert.equal(fill.response?.ok, true)
  assertSinglePrompt(harness.editor)
  assert.equal(
    harness.editor.__pasteEvents >= 1,
    true,
    "ProseMirror-style editor fill should dispatch synthetic paste at least once"
  )
  // 不再禁止 bulk insertText —— 它是 Lexical PlainText/yiyan 系编辑器的合法 tier 2。
  // 通过 assertSinglePrompt 已经验证最终结果保留了换行结构。
}

async function verifySupportedContenteditableEnginesPreserveNewlines() {
  const engines = [
    ["chatgpt", "https://chatgpt.com/#ccs_pp=pchatgpt_123456"],
    ["claude", "https://claude.ai/new#ccs_pp=pclaude_abcdef"],
    ["grok", "https://grok.com/#ccs_pp=pgrok_123456"],
    ["yiyan", "https://yiyan.baidu.com/#ccs_pp=pyiyan_123456"],
    ["google-ai", "https://www.google.com/search?udm=50#ccs_pp=pgoogle_123456"]
  ]

  for (const [engine, url] of engines) {
    const harness = makeHarness({ url, pendingId: `p${engine.replace(/[^a-z]/g, "")}_line` })
    const fill = harness.sendFill()
    await harness.flush()
    assert.equal(fill.response?.ok, true, `${engine} fill should succeed`)
    assertSinglePrompt(harness.editor)
    assert.equal(
      harness.editor.__pasteEvents >= 1,
      true,
      `${engine} fill should route through synthetic paste`
    )
    // 不再禁止 bulk insertText —— 它是 Lexical PlainText/yiyan 系编辑器的合法 tier 2。
  // 通过 assertSinglePrompt 已经验证最终结果保留了换行结构。
  }
}

async function verifyYiyanUsesSlateMainWorldBridge() {
  const harness = makeHarness({
    url: "https://yiyan.baidu.com/#ccs_pp=pyiyan_slate_bridge",
    pendingId: "pyiyan_slate_bridge",
    consumesPaste: false,
    yiyanSlateBridge: true
  })

  const fill = harness.sendFill()
  await harness.flush(120)

  assert.equal(fill.response?.ok, true, "Yiyan Slate bridge fill should succeed")
  assert.equal(
    harness.runtimeMessages.some((message) => message.action === "ccsFillYiyanSlatePromptInMainWorld"),
    true,
    "Yiyan fill should ask background to run the MAIN-world Slate bridge"
  )
  assert.equal(harness.execCommands.length, 0, "Slate bridge success should not fall back to execCommand DOM fill")
  assert.equal(harness.editor.__pasteEvents, 0, "Slate bridge success should not dispatch synthetic paste")
  assert.equal(harness.editor.__inputEventCount >= 1, true, "Slate bridge should still emit an input event")

  const editorText = normalize(harness.editor.textContent)
  assert.equal(editorText.includes(MARKER_HEAD), true, "Slate bridge text should include the prompt head")
  assert.equal(editorText.includes(MARKER_TAIL), true, "Slate bridge text should include the prompt tail")
  assert.equal(
    countOccurrences(editorText, "\n") >= Math.floor(countOccurrences(FASTQA_PROMPT, "\n") * 0.8),
    true,
    "Slate bridge text should preserve newline characters"
  )
}

async function verifyChatBaiduTextareaUsesGenericRelayFill() {
  const pendingId = "pwenxin_textarea_123"
  const harness = makeHarness({
    url: `https://chat.baidu.com/?enter_type=yiyan_site#ccs_pp=${pendingId}`,
    pendingId,
    editorTag: "textarea",
    consumesPaste: false,
    yiyanSlateBridge: true
  })

  await harness.flush()
  assert.equal(harness.pendingGets.length, 1, "Wenxin new site should pull its relayed prompt")

  harness.pendingGets[0].callback({ ok: true, prompt: FASTQA_PROMPT, pendingId })
  await harness.flush(120)

  assert.equal(normalize(harness.editor.value), normalize(FASTQA_PROMPT), "Wenxin textarea should receive the full prompt")
  assert.equal(harness.editor.__inputEventCount >= 1, true, "Wenxin textarea fill should dispatch an input event")
  assert.equal(
    harness.runtimeMessages.some((message) => message.action === "ccsFillYiyanSlatePromptInMainWorld"),
    false,
    "Wenxin new site must not invoke the legacy Slate bridge"
  )
  assert.equal(harness.ackMessages.length, 1, "Wenxin new-site relay should be acknowledged once")

  const cleaned = new URL(harness.context.location.href)
  assert.equal(cleaned.hostname, "chat.baidu.com")
  assert.equal(cleaned.searchParams.get("enter_type"), "yiyan_site")
  assert.equal(cleaned.hash.includes("ccs_pp"), false, "relay marker should be removed after filling")
}

async function verifySilentPasteStillDispatchesInput() {
  // 回归测试：模拟 yiyan v4 —— paste 被消费但 React state 没同步（editor 内部 onPaste 不 fire input）。
  // content.js 必须自己 dispatchEditableEvents，否则页面提交时被 React 报"没有输入内容"。
  const harness = makeHarness({
    url: "https://yiyan.baidu.com/?q=manual",
    consumesPaste: false,
    consumesPasteSilently: true
  })
  const fill = harness.sendFill()
  await harness.flush()
  assert.equal(fill.response?.ok, true, "silent-paste editor fill should still succeed")
  assert.equal(
    harness.editor.__inputEventCount >= 1,
    true,
    "after silent paste, content.js must dispatch at least one input event so React state can sync"
  )
}

async function verifyFallbackWhenEditorRejectsPaste() {
  // 模拟"裸 contenteditable，没有 paste handler"——content.js 必须自动降级到 execCommand 或 DOM fallback，
  // 不能因为 paste 没人消费就把 prompt 丢掉。
  const harness = makeHarness({
    url: "https://yiyan.baidu.com/?q=manual",
    consumesPaste: false
  })
  const fill = harness.sendFill()
  await harness.flush()
  assert.equal(fill.response?.ok, true, "fill should still succeed even when paste is not consumed")
  assertSinglePrompt(harness.editor)
  // 不再禁止 bulk insertText —— 它是 Lexical PlainText/yiyan 系编辑器的合法 tier 2。
  // 通过 assertSinglePrompt 已经验证最终结果保留了换行结构。
}

async function verifyPullPushRaceRespectsUserClear() {
  // 模拟 push/pull 竞态后用户提交：
  //   1. push 先到，fill 成功，aiPromptFillDone 标记 set
  //   2. 用户点发送，Yiyan 清空编辑器
  //   3. pull 延迟返回，触发 already-filled 分支
  //   → 这条分支**不能再 refill**，否则用户看到 prompt 死回来
  const pendingId = "pfast_yiyan_submit"
  const harness = makeHarness({
    url: `https://yiyan.baidu.com/#ccs_pp=${pendingId}`,
    pendingId
  })

  await harness.flush()
  const pushed = harness.sendFill()
  await harness.flush()
  assert.equal(pushed.response?.ok, true, "initial push fill should succeed")

  // 用户点发送，编辑器被外部清空
  harness.editor.children = []
  harness.editor._text = ""

  // pull 现在才返回（race）
  harness.pendingGets[0].callback({ ok: true, prompt: FASTQA_PROMPT, pendingId })
  await harness.flush(500)

  const editorText = normalize(harness.editor.textContent)
  assert.equal(
    editorText,
    "",
    "after user submit, the duplicate pull response must NOT refill the prompt back into the editor"
  )
}

async function verifyStabilizeRespectsUserClear() {
  // 模拟 yiyan 场景：填写成功后，用户点发送，Yiyan 把编辑器清空。
  // stabilize 必须把"完全空"识别为用户操作，不能再重填提示词回来。
  const harness = makeHarness()

  const fill = harness.sendFill()
  await harness.flush()
  assert.equal(fill.response?.ok, true, "initial fill should succeed")

  // 模拟用户点发送，编辑器外部清空
  harness.editor.children = []
  harness.editor._text = ""

  // 等 stabilize 完成（120 + 350 + 700 = 1170ms 总窗口，flush 多轮 microtasks）
  await harness.flush(500)

  const editorText = normalize(harness.editor.textContent)
  assert.equal(
    editorText,
    "",
    "stabilize must NOT refill the prompt after user clears the editor (e.g., after pressing submit)"
  )
}

async function verifyChatGptStyleEditorUsesInsertHtml() {
  // 模拟 ChatGPT (ProseMirror) / Grok (Lexical)：合成 paste isTrusted=false 被无视，
  // 但 Chrome 原生 insertHTML 通过 beforeinput 走通——这是我们必须覆盖的核心场景。
  const harness = makeHarness({
    url: "https://chatgpt.com/#ccs_pp=pchatgpt_react_only",
    pendingId: "pchatgpt_react_only",
    consumesPaste: false,
    consumesInsertHtml: true
  })
  const fill = harness.sendFill()
  await harness.flush()
  assert.equal(fill.response?.ok, true, "ChatGPT-style editor fill should succeed via insertHTML")
  // 不再禁止 bulk insertText —— 它是 Lexical PlainText/yiyan 系编辑器的合法 tier 2。
  // 通过 assertSinglePrompt 已经验证最终结果保留了换行结构。
  const insertHtmlCalls = harness.execCommands.filter((c) => c.command === "insertHTML")
  assert.equal(insertHtmlCalls.length >= 1, true, "ChatGPT-style editor should be filled via at least one insertHTML call")
  // Editor 吃掉了空行（只保留非空段落），验证应仍然通过
  const editorText = normalize(harness.editor.textContent)
  assert.equal(editorText.length > 0, true, "editor should be filled with content")
  // 检查关键 head / tail marker 都在
  assert.equal(editorText.includes(MARKER_HEAD), true, "head marker should be present after insertHTML")
  assert.equal(editorText.includes(MARKER_TAIL), true, "tail marker should be present after insertHTML")
  // 至少要有大量段落换行（不能 collapse 成一行）
  assert.equal(
    countOccurrences(editorText, "\n") >= 5,
    true,
    "editor should contain multiple structural paragraph breaks even when blank lines are dropped"
  )
}

async function verifyChatGptHydrationKeepsPendingUntilStable() {
  for (const replace of [false, true]) {
    const pendingId = `pchatgpt_hydration_${replace}`
    const harness = makeHarness({
      url: `https://chatgpt.com/?hints=reason#ccs_pp=${pendingId}`,
      pendingId, consumesPaste: false, consumesInsertHtml: true
    })
    let reverted = false
    harness.editor.addEventListener("input", () => {
      if (reverted) return
      reverted = true
      // A framework microtask, with no user gesture; it can also replace the DOM node.
      Promise.resolve().then(() => {
        if (replace) harness.replaceEditor()
        else harness.editor.textContent = ""
        // Query cleanup during hydration is not a switch to another conversation.
        harness.context.location.href = `https://chatgpt.com/#ccs_pp=${pendingId}`
        assert.equal(harness.ackMessages.length, 0, "unstable prompt must remain pending")
      })
    })
    await harness.flush()
    harness.pendingGets[0].callback({ ok: true, prompt: FASTQA_PROMPT, pendingId })
    await harness.flush(200)
    assert.deepEqual(
      normalize(harness.editor.textContent).split("\n").filter((line) => line.trim()),
      normalize(FASTQA_PROMPT).split("\n").filter((line) => line.trim()),
      "hydration retry must restore every prompt line exactly once"
    )
    assert.equal(harness.ackMessages.length, 1, "restored stable prompt should be acknowledged once")
    assert.equal(harness.context.location.href, "https://chatgpt.com/")
    assert.equal(harness.listenerCount("beforeinput"), 0, "fill gesture listeners must be removed")
  }

  const harness = makeHarness({
    url: "https://chatgpt.com/#ccs_pp=pchatgpt_never_stable",
    pendingId: "pchatgpt_never_stable", consumesPaste: false, consumesInsertHtml: true
  })
  harness.editor.addEventListener("input", () => {
    Promise.resolve().then(() => { harness.editor.textContent = "" })
  })
  const fill = harness.sendFill()
  await harness.flush(3000)
  assert.equal(fill.response?.ok, false, "persistent framework reverts must exhaust the bounded retries")
  assert.equal(fill.response?.error, "fill-not-stable")
  assert.equal(harness.execCommands.filter((entry) => entry.command === "insertHTML").length, 80)
  assert.equal(harness.ackMessages.length, 0, "failed stabilization must never delete the pending prompt")
  assert(harness.context.location.href.includes("ccs_pp="), "failed stabilization must retain the relay marker")
  assert.equal(harness.listenerCount("beforeinput"), 0, "failed fill must remove gesture listeners")
}

// ChatGPT 新开页面加载完成时会换输入框，并把框里的纯文本按 Markdown 转义后搬进新框
// （与 2026-10 实测一致：行首 # - + > 前加 \\、「1.」→「1\\.」、所有 * _ ` [ ] \\ 前加 \\）。
function chatGptMarkdownEscape(text) {
  return String(text).split("\n").map((line) => {
    let escaped = line.replace(/[\\`*_[\]]/g, "\\$&")
    escaped = escaped.replace(/^(\s*)([#>+-])/, "$1\\$2")
    escaped = escaped.replace(/^(\s*\d+)\./, "$1\\.")
    return escaped
  }).join("\n")
}

async function verifyChatGptEscapedComposerSwapIsRepaired() {
  const escaped = chatGptMarkdownEscape(FASTQA_PROMPT)
  assert.notEqual(escaped, FASTQA_PROMPT, "fixture prompt must contain Markdown characters")
  assert(escaped.includes("\\*\\*") && escaped.includes("1\\.") && escaped.includes("\\#"), "escape fixture must mirror ChatGPT")
  const promptLines = normalize(FASTQA_PROMPT).split("\n").filter((line) => line.trim())
  // 测试环境里定时器是微任务，修复观察的约 15 秒窗口几百个微任务就走完：等填入一确认就换框
  const fillAndWaitForAck = async (harness) => {
    const fill = harness.sendFill()
    for (let i = 0; i < 2000 && harness.ackMessages.length === 0; i++) await harness.flush(1)
    return fill
  }
  const editorLines = (harness) => normalize(harness.editor.textContent).split("\n").filter((line) => line.trim())

  // 1) 换框发生在填入确认之前：新框里的转义版是我们自己的，不能当成用户草稿放弃
  {
    const pendingId = "pchatgpt_escaped_swap"
    const harness = makeHarness({
      url: `https://chatgpt.com/?hints=reason#ccs_pp=${pendingId}`,
      pendingId, consumesPaste: false, consumesInsertHtml: true
    })
    let swapped = false
    harness.editor.addEventListener("input", () => {
      if (swapped) return
      swapped = true
      Promise.resolve().then(() => {
        harness.replaceEditor(escaped)
        harness.context.location.href = `https://chatgpt.com/#ccs_pp=${pendingId}`
      })
    })
    await harness.flush()
    harness.pendingGets[0].callback({ ok: true, prompt: FASTQA_PROMPT, pendingId })
    await harness.flush(400)
    assert.equal(swapped, true, "fixture must swap the composer")
    assert.deepEqual(editorLines(harness), promptLines, "escaped copy must be replaced by the original prompt")
    assert(!harness.editor.textContent.includes("\\"), "no backslash may survive in the composer")
    assert.equal(harness.ackMessages.length, 1, "repaired prompt is acknowledged once")
  }

  // 2) 换框发生在确认之后：填入后的修复观察会用原文重填
  {
    const pendingId = "pchatgpt_escaped_late"
    const harness = makeHarness({ url: `https://chatgpt.com/#ccs_pp=${pendingId}`, pendingId, consumesPaste: false, consumesInsertHtml: true })
    const fill = await fillAndWaitForAck(harness)
    assert.equal(harness.ackMessages.length, 1)
    harness.replaceEditor(escaped)
    await harness.flush(400)
    assert.equal(fill.response?.ok, true)
    assert.deepEqual(editorLines(harness), promptLines, "late swap must be repaired with the original prompt")
    assert(!harness.editor.textContent.includes("\\"), "late swap must not leave backslashes")
    assert.equal(harness.ackMessages.length, 1, "repair must not acknowledge again")
  }

  // 3) 用户自己的内容一律不碰：换来的是用户草稿，或转义版后面被用户加了字
  for (const [label, text] of [
    ["user draft", "我自己写的草稿，不要覆盖"],
    ["escaped copy edited by the user", `${escaped}\n我补充一句`]
  ]) {
    const pendingId = `pchatgpt_escaped_user_${label.length}`
    const harness = makeHarness({ url: `https://chatgpt.com/#ccs_pp=${pendingId}`, pendingId, consumesPaste: false, consumesInsertHtml: true })
    const fill = await fillAndWaitForAck(harness)
    harness.replaceEditor(text)
    const before = harness.execCommands.length
    await harness.flush(400)
    assert.equal(fill.response?.ok, true)
    assert.equal(harness.editor.textContent, text, `${label} must stay untouched`)
    assert.equal(harness.execCommands.length, before, `${label} must not trigger any write`)
  }
}

async function verifyChatGptUserTakeoverCancelsDelivery() {
  for (const key of ["Backspace", "Enter"]) {
    const pendingId = `pchatgpt_takeover_${key}`
    const harness = makeHarness({
      url: `https://chatgpt.com/#ccs_pp=${pendingId}`,
      pendingId, consumesPaste: false, consumesInsertHtml: true
    })
    const schedule = harness.context.setTimeout
    let acted = false
    harness.context.setTimeout = (fn, delay) => schedule(() => {
      if (delay === 120 && !acted) {
        acted = true
        harness.dispatchUserEvent("keydown", { key })
        harness.editor.textContent = ""
      }
      fn()
    })
    const fill = harness.sendFill()
    await harness.flush(200)
    assert.equal(fill.response?.reason, "user-takeover", "trusted delete/send must stop automatic filling")
    assert.equal(harness.editor.textContent, "", "user-cleared/submitted composer must stay empty")
    assert.equal(harness.ackMessages.length, 1, "user cancellation must delete persistent relay for a safe refresh")
    assert.equal(harness.context.location.href, "https://chatgpt.com/", "cancelled relay must not survive in the URL")
    const lateDelivery = harness.sendFill()
    await harness.flush(50)
    assert.equal(lateDelivery.response?.reason, "user-takeover", "late push must not revive a cancelled prompt")
    assert.equal(harness.editor.textContent, "")
    assert.equal(harness.ackMessages.length, 1)
    assert.equal(harness.listenerCount("beforeinput"), 0, "cancelled fill must remove gesture listeners")
  }
}

assertPromptTemplateNewlines()
await verifyPullPushRaceDoesNotDuplicate()
await verifyConcurrentMessagesDedupe()
await verifyExistingDuplicateIsRepaired()
await verifyExistingUnrelatedDraftIsPreserved()
await verifyAsyncEditorDuplicationIsStabilized()
await verifyClaudeMultilineUsesPasteHandler()
await verifySupportedContenteditableEnginesPreserveNewlines()
await verifyYiyanUsesSlateMainWorldBridge()
await verifyChatBaiduTextareaUsesGenericRelayFill()
await verifyFallbackWhenEditorRejectsPaste()
await verifyChatGptStyleEditorUsesInsertHtml()
await verifySilentPasteStillDispatchesInput()
await verifyStabilizeRespectsUserClear()
await verifyPullPushRaceRespectsUserClear()
await verifyChatGptHydrationKeepsPendingUntilStable()
await verifyChatGptUserTakeoverCancelsDelivery()
await verifyChatGptEscapedComposerSwapIsRepaired()

console.log("AI prompt fill dedupe verifier passed")
