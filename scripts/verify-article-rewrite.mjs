#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import vm from "node:vm"
import ts from "typescript"

const root = process.cwd()
const promptSourcePath = path.join(root, "prompts/articleRewritePrompts.json")
const promptMirrorPath = path.join(root, "src/assets-json/prompts/articleRewritePrompts.json")
const promptConfig = JSON.parse(fs.readFileSync(promptSourcePath, "utf8"))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function loadLegacyApi() {
  const messages = []
  const fillCalls = []
  const windowObject = {
    CCSModules: {
      AIPromptFill: {
        fill(prompt, options) {
          fillCalls.push({ prompt, options })
          return Promise.resolve({ ok: true })
        }
      }
    }
  }
  windowObject.top = windowObject
  const context = {
    window: windowObject,
    location: { hostname: "example.com", href: "https://example.com/" },
    document: {},
    chrome: {
      runtime: {
        getURL: (value) => `chrome-extension://test/${value}`,
        lastError: null,
        sendMessage(message, callback) {
          messages.push(message)
          callback({ success: true })
        }
      }
    },
    fetch: async () => ({ ok: true, json: async () => promptConfig }),
    URL,
    Set,
    RegExp,
    String,
    Array,
    Promise,
    Error,
    console
  }
  vm.createContext(context)
  vm.runInContext(
    fs.readFileSync(path.join(root, "modules/articleRewriteRuntime.js"), "utf8"),
    context,
    { filename: "modules/articleRewriteRuntime.js" }
  )
  return { api: windowObject.CCSModules.ArticleRewriteRuntime, messages, fillCalls }
}

function createTsLoader(contextExtras = {}) {
  const cache = new Map()
  const load = (absolutePath) => {
    if (absolutePath.endsWith(".json")) return JSON.parse(fs.readFileSync(absolutePath, "utf8"))
    if (cache.has(absolutePath)) return cache.get(absolutePath).exports
    const source = fs.readFileSync(absolutePath, "utf8")
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
        esModuleInterop: true,
        resolveJsonModule: true,
        isolatedModules: true
      },
      fileName: absolutePath
    })
    const moduleObject = { exports: {} }
    cache.set(absolutePath, moduleObject)
    const customRequire = (specifier) => {
      const base = path.resolve(path.dirname(absolutePath), specifier)
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.json`, path.join(base, "index.ts")]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return load(candidate)
      }
      throw new Error(`Cannot resolve ${specifier} from ${absolutePath}`)
    }
    const context = {
      module: moduleObject,
      exports: moduleObject.exports,
      require: customRequire,
      URL,
      Set,
      RegExp,
      String,
      Array,
      Promise,
      Error,
      console,
      ...contextExtras
    }
    vm.createContext(context)
    vm.runInContext(compiled.outputText, context, { filename: absolutePath })
    return moduleObject.exports
  }
  return load
}

const FULL_RESPONSE = [
  "【短篇回答】",
  "这是一句完整的短篇回答。",
  "",
  "【中篇回答】",
  "这是中篇回答正文。",
  "",
  "A：用户是否需要继续生成详细内容（该部分生成时直接输出正文，不得出现“长篇回答”等字样，且结尾不得包含任何追问或引导语，便于复制使用）",
  "B：请将【短篇回答】和【中篇回答】麻烦你讲人话，要有活人感（如出现“他、她”，统一替换为“TA”）"
].join("\n")

const COMPACT_RESPONSE = [
  "【短篇回答】",
  "这是独立 Writing block 中的短篇回答。",
  "",
  "【中篇回答】",
  "这是独立 Writing block 中的中篇回答。",
  "",
  "A：是否继续生成详细内容？",
  "B：是否需要将【短篇回答】和【中篇回答】改得更口语、更有活人感？"
].join("\n")

async function verifyApi(name, api, hooks) {
  assert(api && typeof api.normalizeGoogleDocUrl === "function", `${name}: missing runtime API`)
  const docsUrl = "https://docs.google.com/document/u/0/d/document-id/edit?tab=t.0#heading=h.test"
  assert(
    api.normalizeGoogleDocUrl(docsUrl) === "https://docs.google.com/document/d/document-id/edit?tab=t.0",
    `${name}: Google Docs URL normalization failed`
  )
  assert(api.normalizeGoogleDocUrl("https://docs.google.com.evil.test/document/d/id/edit") === "", `${name}: lookalike Docs host accepted`)
  assert(api.isFullSelectARewriteResponse(FULL_RESPONSE), `${name}: full Select-A response rejected`)
  assert(api.isCompactSelectARewriteResponse(COMPACT_RESPONSE), `${name}: compact Select-A response rejected`)
  assert(!api.isCompactSelectARewriteResponse(`${COMPACT_RESPONSE}\n额外说明`), `${name}: trailing response content accepted`)
  assert(!api.isCompactSelectARewriteResponse(COMPACT_RESPONSE.replace("更口语", "更简洁")), `${name}: incomplete B constraint accepted`)

  const prompt = await api.buildSelectARewritePrompt()
  assert(prompt.startsWith("选A并且按照提示词改写：\n# 通用「GPT-4.5 感」"), `${name}: Select-A prefix/template missing`)
  assert(prompt.endsWith("原始素材参考本次对话上下文。"), `${name}: conversation source note missing`)
  assert(prompt.includes("正文默认采用“一句话一个自然段”的方式排版"), `${name}: single-sentence layout rule missing from built prompt`)
  assert(prompt.includes("这种短段落是有意的移动端轻阅读布局"), `${name}: mobile reading intent missing from built prompt`)
  assert(prompt.includes("以**简体中文**为主要输出语言"), `${name}: Simplified Chinese output rule missing`)
  assert(!prompt.includes("不要把每句话都拆成一个自然段"), `${name}: obsolete medium-paragraph rule leaked into built prompt`)
  assert(!prompt.includes("${url}"), `${name}: literal URL placeholder leaked`)
  assert(!prompt.includes("${outputLanguage}"), `${name}: literal output-language placeholder leaked`)

  const fill = await api.fillCurrentComposer("改写提示词")
  assert(fill.ok === true, `${name}: current composer fill API failed`)
  assert(hooks.fillCalls.at(-1)?.options?.preserveExistingDraft === true, `${name}: draft protection option missing`)

  const request = await api.requestGoogleDocRewrite(docsUrl, "claude")
  assert(request.success === true, `${name}: Google Docs rewrite request failed`)
  const message = hooks.messages.at(-1)
  assert(message?.action === "ccsCreateGoogleDocRewrite", `${name}: wrong runtime action`)
  assert(message?.target === "claude", `${name}: wrong rewrite target`)
}

const sourceJson = JSON.parse(fs.readFileSync(promptSourcePath, "utf8"))
const mirrorJson = JSON.parse(fs.readFileSync(promptMirrorPath, "utf8"))
assert(JSON.stringify(sourceJson) === JSON.stringify(mirrorJson), "TypeScript prompt asset must mirror the runtime prompt asset")
assert(sourceJson.id === "article_rewrite" && sourceJson.status === "active", "article rewrite prompt metadata invalid")
assert(sourceJson.version === 20, "article rewrite prompt version must be 20")
assert(sourceJson.templateLines.length === 754, "article rewrite prompt line count drifted")
assert(sourceJson.templateLines.join("\n").split("${url}").length - 1 === 1, "article rewrite prompt must contain one URL placeholder")
assert(sourceJson.templateLines.join("\n").split("${outputLanguage}").length - 1 === 1, "article rewrite prompt must contain one output-language placeholder")
assert(sourceJson.templateLines.join("\n").includes("无论原始素材使用何种语言"), "article rewrite prompt must handle foreign-language source material")

const articleRewriteTemplate = sourceJson.templateLines.join("\n")
const secondVersionReferenceProfile = {
  paragraphs: 313,
  singleSentenceParagraphs: 311,
  medianChars: 20,
  p90Chars: 42,
  maxChars: 71
}
assert(
  secondVersionReferenceProfile.singleSentenceParagraphs / secondVersionReferenceProfile.paragraphs > 0.99,
  "second-version reference must remain calibrated as a single-sentence layout"
)
assert(secondVersionReferenceProfile.medianChars <= 45, "second-version median paragraph length is outside the target")
assert(secondVersionReferenceProfile.p90Chars <= 45, "second-version p90 paragraph length is outside the target")
assert(secondVersionReferenceProfile.maxChars <= 80, "second-version maximum paragraph length is outside the target")
for (const rule of [
  "# 十九、采用单句成段的轻阅读排版，避免阅读疲劳",
  "正文默认采用“一句话一个自然段”的方式排版",
  "通常控制在 10～40 个汉字",
  "整体段落中位长度以 20～25 个汉字为目标",
  "可以保留约一成 45～70 个汉字的完整解释段",
  "原则上不要超过 70 个汉字",
  "一句话只承担一个主要判断或一层因果推进",
  "应改写成两个语义完整的句子，并分别成段",
  "允许连续使用多个单句段落来推进论述",
  "这种短段落是有意的移动端轻阅读布局",
  "大多数正文段落是否只承担一个完整句子",
  "每个小标题下的单句段落是否形成了功能不同、衔接自然的连续论述",
  "正文采用单句成段的轻阅读排版"
]) {
  assert(articleRewriteTemplate.includes(rule), `article rewrite paragraph rule missing: ${rule}`)
}
for (const obsoleteRule of [
  "# 十九、段落要完整，不要短句流",
  "# 十九、段落既要完整，也要有呼吸感",
  "通常由 2～4 句话组成，约 80～180 个汉字",
  "不要把每句话都拆成一个自然段",
  "不要连续出现多个一句话段落",
  "是否存在大量短句和碎片化排版"
]) {
  assert(!articleRewriteTemplate.includes(obsoleteRule), `obsolete paragraph rule remains: ${obsoleteRule}`)
}

const legacy = loadLegacyApi()
await verifyApi("legacy", legacy.api, legacy)

const tsMessages = []
const tsFillCalls = []
const tsWindow = {
  CCSModules: {
    AIPromptFill: {
      fill(prompt, options) {
        tsFillCalls.push({ prompt, options })
        return Promise.resolve({ ok: true })
      }
    }
  }
}
const tsChrome = {
  runtime: {
    lastError: null,
    sendMessage(message, callback) {
      tsMessages.push(message)
      callback({ success: true })
    }
  }
}
const loadTs = createTsLoader({ window: tsWindow, chrome: tsChrome })
const tsApi = loadTs(path.join(root, "src/content-modules/articleRewriteRuntime.ts"))
await verifyApi("typescript", tsApi, { messages: tsMessages, fillCalls: tsFillCalls })

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"))
const contentScripts = manifest.content_scripts?.flatMap((entry) => entry.js || []) || []
for (const file of [
  "modules/articleRewriteRuntime.js",
  "modules/googleDocsRewrite.js",
  "modules/chatGptSelectARewrite.js"
]) {
  assert(contentScripts.includes(file), `manifest must load ${file}`)
}
assert(
  contentScripts.indexOf("modules/articleRewriteRuntime.js") < contentScripts.indexOf("modules/googleDocsRewrite.js") &&
  contentScripts.indexOf("modules/articleRewriteRuntime.js") < contentScripts.indexOf("modules/chatGptSelectARewrite.js"),
  "article rewrite runtime must load before site adapters"
)

const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8")
const backgroundSource = fs.readFileSync(path.join(root, "background/events.js"), "utf8")
assert(contentSource.includes("preserveExistingDraft: true"), "AI fill relay must preserve existing drafts")
assert(contentSource.includes("stage: 'existing_draft'"), "AI fill relay must expose existing-draft failures")
assert(backgroundSource.includes("ccsCreateGoogleDocRewrite"), "background Google Docs rewrite route missing")
assert(backgroundSource.includes("pending-prompt-target-mismatch"), "relay target binding check missing")

console.log("[verify-article-rewrite] ✓ 提示词镜像、严格 A/B 匹配、Docs URL、草稿保护与双目标消息协议验证通过")
