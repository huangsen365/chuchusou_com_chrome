import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import vm from "node:vm"

const root = process.cwd()

function loadRuntime() {
  const storage = new Map()
  const createdTabs = []
  const sentMessages = []
  const completedListeners = []
  const errorListeners = []

  let nextTabId = 1
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
    setTimeout(fn) {
      Promise.resolve().then(fn)
      return 0
    },
    clearTimeout() {},
    encodeURIComponent,
    decodeURIComponent,
    chrome: {
      runtime: { lastError: null },
      storage: {
        session: {
          get(keys, cb) {
            const out = {}
            for (const key of keys) out[key] = storage.get(key)
            cb(out)
          },
          set(items, cb) {
            for (const [key, value] of Object.entries(items)) storage.set(key, value)
            cb?.()
          },
          remove(keys, cb) {
            for (const key of keys) storage.delete(key)
            cb?.()
          }
        }
      },
      tabs: {
        create(opts, cb) {
          const tab = { id: nextTabId++, url: opts.url, active: opts.active !== false }
          createdTabs.push({ opts, tab })
          cb?.(tab)
        },
        sendMessage(tabId, message, cb) {
          sentMessages.push({ tabId, message })
          cb?.({ ok: true })
          return { catch() {} }
        }
      },
      webRequest: {
        onCompleted: {
          addListener(listener) {
            completedListeners.push(listener)
          }
        },
        onErrorOccurred: {
          addListener(listener) {
            errorListeners.push(listener)
          }
        }
      }
    }
  }
  context.globalThis = context
  context.self = context

  for (const rel of ["background/chatgptPromptRelay.js", "background/urlSafety.js"]) {
    const code = fs.readFileSync(path.join(root, rel), "utf8")
    vm.runInNewContext(code, context, { filename: rel })
  }

  return { context, storage, createdTabs, sentMessages, completedListeners, errorListeners }
}

function relayIdFromUrl(rawUrl) {
  const url = new URL(rawUrl)
  const fromQuery = url.searchParams.get("ccs_pp")
  if (fromQuery) return fromQuery
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""))
  return hash.get("ccs_pp")
}

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function verifyAiRelay(runtime) {
  const { context, createdTabs, sentMessages } = runtime
  const prompt = "封面生成器长提示 ".repeat(400)
  const url = await context.ccsPrepareAIPromptUrl(
    "https://chatgpt.com/?prompt=${PROMPT}",
    prompt,
    { source: "test", menuId: "ccs-cover-x-chatgpt-images", engineId: "chatgpt" }
  )

  assert(url.length < 500, `relay URL should stay short, got ${url.length}`)
  const relayId = relayIdFromUrl(url)
  assert(relayId, "relay URL should contain ccs_pp")

  const pending = await context.ccsReadPendingAIPrompt(relayId)
  assert.equal(pending.prompt, prompt, "pending prompt should keep full text")
  assert.equal(pending.directUrlLength > context.CCS_AI_PROMPT_RELAY.DIRECT_URL_LIMIT, true)

  const tab = await context.ccsOpenPreparedAIPromptUrl(url)
  await tick()
  assert.equal(createdTabs.length, 1, "prepared AI URL should open one tab")
  assert.equal(sentMessages.length, 0, "AI relay should not push prompt from background; content script pulls it once")
  const recovery = await context.ccsReadUrlRecoveryForTab(tab.id)
  assert.equal(recovery.kind, "ai")
  assert.equal(recovery.originalText, prompt)
}

async function verifyGoogleAiRelay(runtime) {
  const { context } = runtime
  const prompt = "Google AI 长提示 ".repeat(500)
  const url = await context.ccsPrepareAIPromptUrl(
    "https://www.google.com/search?udm=50&ie=UTF-8&oe=UTF-8&q=${PROMPT}",
    prompt,
    { source: "test", menuId: "ccs-google-ai-chat", engineId: "google-ai" }
  )

  const parsed = new URL(url)
  assert.equal(parsed.hostname, "www.google.com")
  assert.equal(parsed.pathname, "/search")
  assert.equal(parsed.searchParams.get("udm"), "50")
  assert.equal(parsed.searchParams.has("q"), false, "Google AI relay should not auto-submit a q search")
  assert(parsed.searchParams.get("ccs_pp"), "Google AI relay should carry ccs_pp in query")
  assert(relayIdFromUrl(url), "Google AI relay should also carry ccs_pp in hash")
  assert.equal(context.ccsIsSupportedAIUrl(url), true)

  const shortUrl = await context.ccsPrepareAIPromptUrl(
    "https://www.google.com/search?udm=50&ie=UTF-8&oe=UTF-8&q=${PROMPT}",
    "短提示",
    { source: "test", menuId: "ccs-google-ai-chat", engineId: "google-ai" }
  )
  const shortParsed = new URL(shortUrl)
  assert(shortParsed.searchParams.get("ccs_pp"), "Google AI should use relay even for short prompts")
  assert.equal(shortParsed.searchParams.has("q"), false, "short Google AI relay should not include q")

  const hashOnlyGoogle = "https://www.google.com/search?ie=UTF-8#ccs_pp=pabc_123456"
  assert.equal(context.ccsIsSupportedAIUrl(hashOnlyGoogle), true, "google relay hash URL should be supported even after udm rewrite")
}

async function verifyRegularUrlTruncation(runtime) {
  const { context, createdTabs, completedListeners, sentMessages } = runtime
  const text = "很长的普通搜索参数".repeat(800)
  const prepared = context.ccsPrepareRegularUrl(
    "https://www.google.com/search?q=${KEYWORD}",
    text,
    { source: "test", menuId: "ccs-google" }
  )

  assert.equal(prepared.truncated, true, "regular search should truncate over-budget text")
  assert(prepared.url.length <= context.CCS_URL_SAFETY.REGULAR_URL_HARD_CAP)
  assert.equal(prepared.record.originalText, text)
  assert(prepared.record.effectiveText.length < text.length)

  const tab = await context.ccsOpenUrlWithRecovery(prepared.url, prepared.record)
  await tick()
  assert.equal(createdTabs.length, 2, "regular URL should open one more tab")
  assert.equal(completedListeners.length, 1, "webRequest monitor should be installed")

  completedListeners[0]({
    tabId: tab.id,
    type: "main_frame",
    statusCode: 431,
    url: prepared.url
  })
  await tick()

  const recovery = await context.ccsReadUrlRecoveryForTab(tab.id)
  assert.equal(recovery.statusCode, 431)
  assert.equal(sentMessages.at(-1).message.action, "ccsShowUrlRecovery")
  assert.equal(sentMessages.at(-1).message.recovery.statusCode, 431)

  const reopened = await context.ccsOpenUrlRecoverySafe(recovery.id)
  assert.equal(reopened.ok, true)
}

async function verifyFourOhFour(runtime) {
  const { context, completedListeners, sentMessages } = runtime
  const prepared = context.ccsPrepareRegularUrl(
    "https://example.com/search?q=${KEYWORD}",
    "short query",
    { source: "test", menuId: "ccs-example" }
  )
  const tab = await context.ccsOpenUrlWithRecovery(prepared.url, prepared.record)
  await tick()
  completedListeners[0]({
    tabId: tab.id,
    type: "main_frame",
    statusCode: 404,
    url: prepared.url
  })
  await tick()
  assert.equal(sentMessages.at(-1).message.recovery.statusCode, 404)
}

async function verifyLocalHttpStatuses() {
  const server = http.createServer((req, res) => {
    if (req.url === "/status-431") {
      res.writeHead(431, { "content-type": "text/plain" })
      res.end("request header fields too large")
      return
    }
    res.writeHead(404, { "content-type": "text/plain" })
    res.end("not found")
  })

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address()
  try {
    const r431 = await fetch(`http://127.0.0.1:${port}/status-431`)
    assert.equal(r431.status, 431)
    const r404 = await fetch(`http://127.0.0.1:${port}/status-404`)
    assert.equal(r404.status, 404)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"))
}

function collectUnifiedMenuPatterns() {
  const config = readJson("src/assets-json/config/unifiedMenuConfig.json")
  const out = []
  const visit = (item) => {
    if (item?.urlPattern) out.push({ id: item.id || "unknown", pattern: item.urlPattern, source: "unified" })
    for (const child of item?.children || []) visit(child)
  }
  for (const group of config.groups || []) {
    for (const item of group.items || []) visit(item)
  }
  return out
}

function collectPromptPatterns() {
  const out = []
  const addEngine = (source, id, engine) => {
    if (engine?.urlPattern) {
      out.push({ id: `${id}-${engine.id || "engine"}`, pattern: engine.urlPattern, source })
    }
  }

  const fastAnswers = readJson("src/assets-json/prompts/fastAnswersPrompts.json")
  for (const engine of fastAnswers.engines || []) addEngine("fastqa", "fastqa", engine)

  const topQuestions = readJson("src/assets-json/prompts/topQuestionsPrompts.json")
  for (const engine of topQuestions.engines || []) addEngine("top100", "top100", engine)

  const optimized = readJson("src/assets-json/prompts/optimizedPrompts.json")
  for (const category of optimized.categories || []) {
    for (const engine of category.engines || []) addEngine("optimize", category.id || "category", engine)
  }

  const cover = readJson("src/assets-json/prompts/coverPrompts.json")
  for (const category of cover.categories || []) {
    for (const engine of category.engines || []) addEngine("cover", category.id || "category", engine)
  }

  return out
}

async function verifyConfiguredPatterns(runtime) {
  const { context } = runtime
  const longText = "URL safety 长文本 ".repeat(900)
  const patterns = [...collectUnifiedMenuPatterns(), ...collectPromptPatterns()]
  assert(patterns.length > 20, "expected configured URL patterns to be collected")

  for (const item of patterns) {
    const direct = context.ccsBuildUrlFromPattern(item.pattern, longText)
    if (context.ccsIsSupportedAIUrl(direct)) {
      const prepared = await context.ccsPrepareAIPromptUrl(item.pattern, longText, {
        source: `config-${item.source}`,
        menuId: item.id
      })
      assert(
        prepared.length <= context.CCS_AI_PROMPT_RELAY.DIRECT_URL_LIMIT,
        `${item.source}:${item.id} AI URL should be direct-safe or relayed (${prepared.length})`
      )
      continue
    }

    const prepared = context.ccsPrepareRegularUrl(item.pattern, longText, {
      source: `config-${item.source}`,
      menuId: item.id
    })
    assert(
      prepared.url.length <= context.CCS_URL_SAFETY.REGULAR_URL_HARD_CAP,
      `${item.source}:${item.id} regular URL exceeds cap (${prepared.url.length})`
    )
  }
}

const runtime = loadRuntime()
await verifyAiRelay(runtime)
await verifyGoogleAiRelay(runtime)
await verifyRegularUrlTruncation(runtime)
await verifyFourOhFour(runtime)
await verifyConfiguredPatterns(runtime)
await verifyLocalHttpStatuses()

console.log("[verify-url-safety] AI relay + Google AI relay preservation + regular URL truncation + configured engines + 431/404 recovery OK")
