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
      },
      // 固定轮换计数器：形式安排不随运行日期漂移；近期概念记忆为空
      storage: {
        local: {
          get(keys, callback) { callback(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k === "ccs_rewrite_variety_counter").map((k) => [k, 4]))) },
          set(values, callback) { callback?.() }
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
    fs.readFileSync(path.join(root, "shared/rewriteVariety.js"), "utf8"),
    context,
    { filename: "shared/rewriteVariety.js" }
  )
  vm.runInContext(
    fs.readFileSync(path.join(root, "shared/rewriteConceptMemory.js"), "utf8"),
    context,
    { filename: "shared/rewriteConceptMemory.js" }
  )
  vm.runInContext(
    fs.readFileSync(path.join(root, "modules/articleRewriteRuntime.js"), "utf8"),
    context,
    { filename: "modules/articleRewriteRuntime.js" }
  )
  return { api: windowObject.CCSModules.ArticleRewriteRuntime, messages, fillCalls, variety: context.CCSRewriteVariety, memory: context.CCSRewriteConceptMemory }
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
  assert(!prompt.includes("${varietyPlan}"), `${name}: literal variety-plan placeholder leaked`)
  assert(prompt.includes("本篇的形式安排（由扩展按轮换计数生成"), `${name}: variety plan heading missing from built prompt`)
  assert(/- 主标题采用「.+?」的形式；\n- 开头从「.+?」进入；\n- 结尾用「.+?」收束；/.test(prompt), `${name}: variety plan lines missing or malformed`)
  assert(/- 概念处理：[^\n]+；加粗目标 4～6 个，最多 8 个。/.test(prompt), `${name}: concept-mode line missing from variety plan`)
  assert(/- 本篇可借用的学科（[^\n]+）：[^、\n]+、[^、\n]+、[^、\n]+；\n- 上一篇借用过的学科，本篇不借：[^\n]+；/.test(prompt), `${name}: discipline slice lines missing from variety plan`)
  assert(!prompt.includes("${recentConcepts}"), `${name}: literal recent-concepts placeholder leaked`)
  assert(prompt.includes("最近几篇改写里已经用过的概念（本文默认不用"), `${name}: recent-concepts block missing from built prompt`)
  assert(prompt.includes("\n（无）"), `${name}: empty recent-concepts must render as （无） without storage`)

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
assert(sourceJson.version === 28, "article rewrite prompt version must be 28")
assert(sourceJson.templateLines.length === 802, "article rewrite prompt line count drifted")
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
// v21 去模具化：提示词自身不再用「真正」当口头禅；标题 / 开头 / 结尾各给多种形式；概念与方法按需
for (const rule of [
  "- “真正”：全文最多出现 1 次，并且不得出现在主标题、小标题、第一段和最后一段；",
  "- “不只是”“不仅仅是”“不是……而是……”：主标题和小标题里禁止使用，正文全文合计最多 2 处；",
  "# 二十、开头直接进入问题，方式按素材选",
  "# 二十一、标题要说出文章的核心，但形式不要固定",
  "标题里禁止出现“真正”“不只是”“不仅仅”“别再”“你以为”。",
  "先看素材决定用哪一种，不要默认选最后一种。",
  "收束的方式同样按素材选，不要固定成一种：",
  "标题、开头、结尾三处不要用同一种手法",
  "但不要每篇都按这个顺序写。",
  "# 十一、素材允许时，加入判断方法",
  "一篇没有方法论的文章，同样可以是好文章。",
  "整篇文章不出现任何“效应”“定律”“模型”式的命名也完全可以。",
  "全文挑出**目标 4～6 个、最多 8 个**",
  "素材确实撑不住时可以更少，但不要为了凑数硬贴。",
  "确实没有，就一个也不加粗。",
  "- 全文“真正”是否不超过 1 次，且未出现在标题、首段和末段；",
  "知识跟着素材走：素材属于哪个领域，就优先用那个领域自己的概念和术语；",
  "这些概念跟着素材走：素材属于哪个领域，就用那个领域自己的术语；"
]) {
  assert(articleRewriteTemplate.includes(rule), `article rewrite anti-template rule missing: ${rule}`)
}
for (const obsoleteRule of [
  "# 二、找到真正值得写的主线",
  "# 二十、开头直接进入真正的问题",
  "# 二十一、标题要表达真正的核心矛盾",
  "理想情况下，读者能够感受到这样的认知过程：",
  "全文挑出 **3～6 个**",
  "全文最多挑出 **6 个**",
  "其中两三个概念刚好解释了",
  "标题必须能够被正文真正支撑。",
  "- 行为经济学；",
  "可以自然适当引入以下领域的知识：",
  "这些概念不限学科。",
  "不必局限于行为经济学或统计学"
]) {
  assert(!articleRewriteTemplate.includes(obsoleteRule), `obsolete template-inducing rule remains: ${obsoleteRule}`)
}
// 「真正」只允许作为引号内的禁用词说明 / 反例出现（当前 5 处），提示词自身语气里不得再用
const zhenzhengTotal = (articleRewriteTemplate.match(/真正/g) || []).length
const zhenzhengQuoted = (articleRewriteTemplate.match(/“真正”|真正厉害的人都|真正重要的不是/g) || []).length
assert(zhenzhengTotal <= 5 && zhenzhengTotal === zhenzhengQuoted,
  `article rewrite prompt uses 「真正」 in its own voice (${zhenzhengTotal} total, ${zhenzhengQuoted} quoted) — this is what made every title contain it`)
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

// 形式轮换：表齐全、映射在范围内、相邻两篇每个轴都不同、渲染格式稳定、空计划有兜底文案
const varietyConfig = sourceJson.varietyPlan
assert(varietyConfig?.titleForms?.length === 6 && varietyConfig.openingForms?.length === 5 &&
  varietyConfig.endingForms?.length === 5 && varietyConfig.conceptModes?.length === 4 && varietyConfig.disciplinePool?.length === 60 &&
  new Set(varietyConfig.disciplinePool).size === 60 && !("secondLenses" in varietyConfig),
  "varietyPlan tables must be 6 / 5 / 5 / 4 entries + a 60-item unique discipline pool (secondLenses retired)")
const varietyApi = legacy.variety
assert(varietyApi && typeof varietyApi.resolvePlan === "function", "shared/rewriteVariety.js did not initialize")
for (let n = 0; n < 200; n++) {
  const a = varietyApi.resolvePlan(varietyConfig, n)
  const b = varietyApi.resolvePlan(varietyConfig, n + 1)
  assert(a.title && a.opening && a.ending && a.mode && a.disciplines.length === 3 && a.excludedDisciplines.length === 3, `variety plan ${n} has an empty axis`)
  assert(a.title !== b.title && a.opening !== b.opening && a.ending !== b.ending && a.mode !== b.mode,
    `consecutive variety plans ${n}/${n + 1} share an axis`)
  assert(!a.disciplines.some((d) => b.disciplines.includes(d)), `consecutive discipline slices ${n}/${n + 1} overlap`)
  assert(JSON.stringify(b.excludedDisciplines) === JSON.stringify(a.disciplines), `plan ${n + 1} must exclude plan ${n}'s slice`)
  const groups = a.disciplines.map((d) => Math.floor(varietyConfig.disciplinePool.indexOf(d) / 6))
  assert(new Set(groups).size === 3, `discipline slice ${n} must span three categories: ${a.disciplines.join("、")}`)
}
const rendered = varietyApi.renderPlan(varietyApi.resolvePlan(varietyConfig, 7))
assert(varietyConfig.conceptModes.every((mode) => /[2-4]～[3-4] 个/.test(mode)), "conceptModes borrowing ranges must be 2～3 / 2～4")
assert(rendered.startsWith("- 主标题采用「") && rendered.includes("\n- 开头从「") && rendered.includes("\n- 结尾用「") &&
  rendered.includes("\n- 本篇可借用的学科（") && rendered.includes("\n- 上一篇借用过的学科，本篇不借：") && rendered.includes("\n- 概念处理："),
  "variety plan rendering format drifted")
const covered = new Set()
for (let n = 0; n < 20; n++) varietyApi.resolvePlan(varietyConfig, n).disciplines.forEach((d) => covered.add(d))
assert(covered.size === 60, `20 consecutive slices must cover the whole 60-item pool, got ${covered.size}`)
assert(varietyApi.apply("x ${varietyPlan} y", "") === `x ${varietyApi.EMPTY_PLAN_TEXT} y`, "empty variety plan must fall back to the neutral note")
assert(varietyApi.seedFromDate(new Date(Date.UTC(2026, 0, 1, 0))) === 0 && varietyApi.seedFromDate(new Date(Date.UTC(2026, 0, 2, 3))) === 27, "date seed drifted")
assert(articleRewriteTemplate.includes("本篇的形式安排（由扩展按轮换计数生成"), "variety plan heading missing from template")
assert(articleRewriteTemplate.split("${varietyPlan}").length - 1 === 1, "article rewrite prompt must contain one variety-plan placeholder")
assert(articleRewriteTemplate.includes("如果被安排的标题形式和开头方式碰巧是同一种手法"), "same-kind title/opening fallback rule missing")

// 概念只从素材来（第一 / 五 / 十二 / 二十八节）+ 近期概念记忆
for (const rule of [
  "同时在内部列一份「素材关键词表」（不输出）。后面所有要命名的概念，都必须能对应到表里的某个具体机制、现象或矛盾——对应的是机制，不要求素材里出现过那个词：",
  "概念从哪里来，有三条路：直接用素材自己的词",
  "通过联想、融合、拓展找到一个能精准解释素材里某个机制的概念。",
  "对不上素材里任何具体机制的概念，不命名，用白话把机制讲清楚",
  "可以推断素材没说出口的机制，但不能虚构事实",
  "不要因为素材没提供现成的词就放弃概念。",
  "- 联想：从素材里的一个具体机制出发，在允许的学科里找一个能解释它的概念",
  "- 融合：把素材自己的说法和一个借来的概念并置，用后者解释前者",
  "- 拓展：把素材里的一个具体现象上升为可迁移的模式",
  "特异性检验：一个概念如果原样搬到另外一百篇不同题材的文章里也能用，它就不够特异，不要用名字。",
  "互联网上常见的通用心理学、经济学效应类词汇默认不用",
  "加粗的概念必须对应素材里的某个具体机制：或是素材自己的词、领域术语，或是从本篇形式安排允许借用的学科里通过联想、融合、拓展借来的概念；最近几篇已经用过的概念不加粗也不使用。",
  "概念以素材为准，需要外部概念解释机制时，只能从本篇允许借用的学科里借",
  "- 每个被命名、被加粗的概念是否都能对应素材里的某个具体机制（而不只是听起来相关）；",
  "最近几篇改写里已经用过的概念（本文默认不用，也不要换个说法暗示它们；只有当某个词正是素材所属领域的基本术语、不用就说不清楚时可以用，但不再加粗、不算本篇的新概念；素材原文本身就包含的词除外）："
]) {
  assert(articleRewriteTemplate.includes(rule), `source-driven concept rule missing: ${rule}`)
}
for (const obsoleteRule of ["“原来这就是某种效应。”", "“这不是能力问题，而是结构问题。”", "对不上素材关键词表的概念，不命名", "都必须能对应到这张表：", "只用素材自己出现过的词来命名概念，不引入任何外部术语"]) {
  assert(!articleRewriteTemplate.includes(obsoleteRule), `concept-priming example remains: ${obsoleteRule}`)
}
assert(articleRewriteTemplate.split("${recentConcepts}").length - 1 === 1, "article rewrite prompt must contain one recent-concepts placeholder")
for (const keyword of ["直接命名", "联想", "融合", "拓展"]) {
  assert(varietyConfig.conceptModes.some((mode) => mode.includes(keyword)), `conceptModes must include a 「${keyword}」 mode`)
}
const memoryApi = legacy.memory
assert(memoryApi && typeof memoryApi.extractConceptsFromHtml === "function", "shared/rewriteConceptMemory.js did not initialize")
const extracted = memoryApi.extractConceptsFromHtml('<p><strong>沉没成本</strong>，<b> 锚定效应 </b>和<strong>沉没成本</strong>；<strong>「路径依赖」</strong><strong></strong></p>')
assert(JSON.stringify(extracted) === JSON.stringify(["沉没成本", "锚定效应", "路径依赖"]), `concept extraction drifted: ${JSON.stringify(extracted)}`)
const mergedRecent = memoryApi.mergeRecent([{ term: "A", ts: 1 }, { term: "b", ts: 1 }], ["c", "B"], 2, 3)
assert(JSON.stringify(mergedRecent.map((item) => item.term)) === JSON.stringify(["c", "B", "A"]), `recent merge order/dedupe/cap drifted: ${JSON.stringify(mergedRecent)}`)
assert(memoryApi.renderRecent([]) === "（无）" && memoryApi.renderRecent(mergedRecent) === "c、B、A", "recent rendering drifted")
assert(memoryApi.apply("x ${recentConcepts} y", "") === "x （无） y", "empty recent list must fall back to （无）")
assert(memoryApi.MAX_RECENT === 80, "recent-concept memory must keep the latest 80 terms")
assert(memoryApi.dedupeKey("锚定效应") === memoryApi.dedupeKey(" 锚定 ") && memoryApi.dedupeKey("「路径依赖」") === memoryApi.dedupeKey("路径依赖") &&
  memoryApi.dedupeKey("Anchoring") === memoryApi.dedupeKey("anchoring") && memoryApi.dedupeKey("效应") === "效应",
  "fuzzy dedupe key drifted")
const fuzzyExtracted = memoryApi.extractConceptsFromHtml('<p><strong>锚定效应</strong>…<strong>锚定</strong>…<strong>幸存者偏差</strong></p>')
assert(JSON.stringify(fuzzyExtracted) === JSON.stringify(["锚定效应", "幸存者偏差"]), `fuzzy extraction dedupe drifted: ${JSON.stringify(fuzzyExtracted)}`)
const fuzzyMerged = memoryApi.mergeRecent([{ term: "锚定效应", ts: 1 }], ["锚定"], 2, 80)
assert(fuzzyMerged.length === 1 && fuzzyMerged[0].term === "锚定" && fuzzyMerged[0].ts === 2, `fuzzy merge must collapse suffix variants keeping the newest: ${JSON.stringify(fuzzyMerged)}`)
const capped = memoryApi.mergeRecent(Array.from({ length: 80 }, (_, i) => ({ term: `概念${i}`, ts: 1 })), ["新概念"], 2)
assert(capped.length === 80 && capped[0].term === "新概念" && !capped.some((item) => item.term === "概念79"), "cap must evict the oldest entry")
const fastAnswersTemplate = JSON.parse(fs.readFileSync(path.join(root, "prompts/fastAnswersPrompts.json"), "utf8")).templateLines.join("\n")
assert(fastAnswersTemplate.includes("概念只从素材里来：素材自己用到的词") && fastAnswersTemplate.includes("互联网上常见的通用心理学、经济学效应类词汇默认不用"),
  "fast answers prompt must carry the same source-driven concept rule")
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
