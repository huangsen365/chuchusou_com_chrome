#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import vm from "node:vm"
import { readEventSources } from "./lib/swSources.mjs"
import { createRepoFetch, readPromptConfig } from "./lib/prompts.mjs"

const root = process.cwd()

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
    fetch: createRepoFetch(root, { prefix: "chrome-extension://test/" }),
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
    fs.readFileSync(path.join(root, "shared/promptTemplate.js"), "utf8"),
    context,
    { filename: "shared/promptTemplate.js" }
  )
  vm.runInContext(
    fs.readFileSync(path.join(root, "modules/chatGptDom.js"), "utf8"),
    context,
    { filename: "modules/chatGptDom.js" }
  )
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
  assert(/- 概念处理：[^\n]+；目标 4～6 个有解释价值的概念，最多 8 个，其中争取 2～3 个来自指定学科；首次出现时加粗，不用普通词凑数。/.test(prompt), `${name}: concept-mode line missing from variety plan`)
  assert(/- 本篇先探索的学科（[^\n]+）：[^、\n]+、[^、\n]+、[^、\n]+；\n- 上一轮安排的学科（本轮优先探索新学科，不禁用相关知识）：[^\n]+；/.test(prompt), `${name}: discipline slice lines missing from variety plan`)
  assert(!prompt.includes("${recentConcepts}"), `${name}: literal recent-concepts placeholder leaked`)
  assert(prompt.includes("最近几篇改写里已经用过的概念（用于提醒避免重复用法"), `${name}: recent-concepts block missing from built prompt`)
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

const { config: sourceJson, template: articleRewriteTemplate } = readPromptConfig(root, "prompts/articleRewritePrompts.json")
assert(sourceJson.id === "article_rewrite" && sourceJson.status === "active", "article rewrite prompt metadata invalid")
assert(Number.isInteger(sourceJson.version) && sourceJson.version >= 30, "article rewrite prompt version must be an integer ≥ 30")
assert(sourceJson.templateFile === "articleRewrite.md", "article rewrite prompt text lives in prompts/articleRewrite.md")
// 章节结构：「# 一、」起连续编号、不跳号不重号（加减章节时只要编号连贯就行，不锁死数量）
{
  const numerals = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]
  const toNumber = (text) => {
    if (text === "十") return 10
    const [tens, ones] = text.includes("十") ? text.split("十") : ["", text]
    return (text.includes("十") ? (tens ? numerals.indexOf(tens) + 1 : 1) * 10 : 0) + (ones ? numerals.indexOf(ones) + 1 : 0)
  }
  const sections = sourceJson.templateLines
    .map((line) => line.match(/^# ([一二三四五六七八九十]+)、/)?.[1])
    .filter(Boolean)
    .map(toNumber)
  assert(sections.length >= 10, `article rewrite prompt lost its numbered sections (found ${sections.length})`)
  sections.forEach((n, i) => assert(n === i + 1, `article rewrite section numbering broken at position ${i + 1}: got ${n}`))
}
// 这四个标记被外部工作流用来识别提示词，任何改版都不能动
for (const marker of ["# 通用「GPT-4.5 感」原始素材深度改写提示词", "# 二十八、输出与排版要求", "主标题 + 小标题 + 正文", "# 原始素材"]) {
  assert(articleRewriteTemplate.includes(marker), `article rewrite prompt must keep the workflow marker: ${marker}`)
}
assert(articleRewriteTemplate.split("${url}").length - 1 === 1, "article rewrite prompt must contain one URL placeholder")
assert(articleRewriteTemplate.split("${outputLanguage}").length - 1 === 1, "article rewrite prompt must contain one output-language placeholder")
assert(articleRewriteTemplate.includes("无论原始素材使用何种语言"), "article rewrite prompt must handle foreign-language source material")

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
  "全文挑出**目标 4～6 个、最多 8 个**",
  "- 全文“真正”是否不超过 1 次，且未出现在标题、首段和末段；",
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
assert(rendered.startsWith("- 主标题采用「") && rendered.includes("\n- 开头从「") && rendered.includes("\n- 结尾用「") &&
  rendered.includes("\n- 本篇先探索的学科（") && rendered.includes("\n- 上一轮安排的学科（本轮优先探索新学科，不禁用相关知识）：") && rendered.includes("\n- 概念处理："),
  "variety plan rendering format drifted")
const covered = new Set()
for (let n = 0; n < 20; n++) varietyApi.resolvePlan(varietyConfig, n).disciplines.forEach((d) => covered.add(d))
assert(covered.size === 60, `20 consecutive slices must cover the whole 60-item pool, got ${covered.size}`)
assert(varietyApi.apply("x ${varietyPlan} y", "") === `x ${varietyApi.EMPTY_PLAN_TEXT} y`, "empty variety plan must fall back to the neutral note")
assert(varietyApi.seedFromDate(new Date(Date.UTC(2026, 0, 1, 0))) === 0 && varietyApi.seedFromDate(new Date(Date.UTC(2026, 0, 2, 3))) === 27, "date seed drifted")
assert(articleRewriteTemplate.includes("本篇的形式安排（由扩展按轮换计数生成"), "variety plan heading missing from template")
assert(articleRewriteTemplate.split("${varietyPlan}").length - 1 === 1, "article rewrite prompt must contain one variety-plan placeholder")
assert(articleRewriteTemplate.includes("如果被安排的标题形式和开头方式碰巧是同一种手法"), "same-kind title/opening fallback rule missing")

// 先探索再筛选：统一概念规则，保留跨学科类比边界与解释增量要求。
for (const rule of [
  "素材问题表",
  "不限制概念的学科或原文用词",
  "素材决定要解释的问题，学科提供解释问题的工具",
  "# 五、主动探索跨学科概念，再检验解释价值",
  "对本篇指定的每个学科，先寻找至少 2 个候选概念",
  "候选清单和筛选过程不输出",
  "对应在哪些条件下成立、在哪些地方失效",
  "可以推断素材没说出口的机制，但不能虚构事实",
  "跨领域类比可以启发理解，不能直接证明现实结论",
  "概念可以通用，应用必须具体",
  "不要求每个学科都入选，也不平均分配",
  "不要用普通词加粗来补足名额",
  "“合作就是共同做事”这种同义解释不计入目标",
  "示例只展示对应关系和解释增量",
  "只写“友谊像桥梁，需要维护”没有增加判断",
  "只写“团队像一道菜，要搭配好”没有说清机制",
  "指定学科完成探索后仍不足，可以补充其他学科",
  "用于提醒避免重复用法，不是禁用词表",
  "列表只记录名称，不代表你知道此前的具体讲法",
  "- 跨领域类比是否被误当成现实因果证据，术语是否保留了原意；",
  "- 复用近期概念时，是否提供了针对当前问题的具体解释，而不是只换措辞；",
  "# 二十三、允许对原始材料进行必要纠偏，但成品必须独立成文",
  "修正要静默完成：直接写出修正后的判断，作为文章自己的观点陈述；不要在正文里写“原文说 X，但 X 过于绝对”这类批改过程。",
  "成品必须独立成文。读者手里没有素材，正文里不得出现“原文”“素材”“原始材料”“这段话”“这句话”“上文”“作者说”“题主”“楼主”这类指向来源的表述",
  "**独立成文。** 通篇没有任何一处让读者意识到它是从另一段文字改写来的。",
  "- 正文是否出现了“原文”“素材”“这句话”“作者说”等指向来源的表述，或把纠偏过程写了出来。"
]) {
  assert(articleRewriteTemplate.includes(rule), `cross-disciplinary concept rule missing: ${rule}`)
}
for (const obsoleteRule of ["“原来这就是某种效应。”", "“这不是能力问题，而是结构问题。”", "对不上素材关键词表的概念，不命名", "都必须能对应到这张表：", "只用素材自己出现过的词来命名概念，不引入任何外部术语", "# 二十三、允许对原始材料进行必要纠偏\n"]) {
  assert(!articleRewriteTemplate.includes(obsoleteRule), `concept-priming example remains: ${obsoleteRule}`)
}
assert(articleRewriteTemplate.split("${recentConcepts}").length - 1 === 1, "article rewrite prompt must contain one recent-concepts placeholder")
for (const keyword of ["直接命名", "联想", "融合", "拓展"]) {
  assert(varietyConfig.conceptModes.some((mode) => mode.includes(keyword)), `conceptModes must include a 「${keyword}」 mode`)
}
assert(varietyConfig.openingForms[1].includes("不加「原文说」"), "source-quote opening form must tell the model not to attribute to 原文")
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
const { template: fastAnswersTemplate } = readPromptConfig(root, "prompts/fastAnswersPrompts.json")
for (const rule of [
  "素材决定要解释的问题，学科提供解释问题的工具",
  "概念可以通用，应用必须具体",
  "跨领域类比不能直接证明现实结论",
  "短篇和中篇按篇幅选用能增加理解的概念，不强求数量或加粗",
  "对每个学科先寻找至少 2 个候选",
  "完成探索后有效候选不足可以减少",
  "不是禁用词表",
  "后续 A/B 如附有更具体的改写要求，以该轮要求为准"
]) {
  assert(fastAnswersTemplate.includes(rule), `fast answers concept rule missing: ${rule}`)
}
// 检查两轮完整提示词和动态安排，避免上游或末尾残留的禁令抵消新策略。
for (const obsoleteRule of [
  "概念只从素材里来", "素材关键词表", "其余学科的概念本篇不用",
  "只能从本篇允许借用的学科里借", "一百篇不同题材", "通用心理学、经济学效应类词汇默认不用",
  "也不要换个说法暗示它们", "本文默认不用", "本篇不借", "最近几篇已经用过的概念不加粗也不使用"
]) {
  for (const [name, text] of [["article", articleRewriteTemplate], ["fast answers", fastAnswersTemplate], ["variety", rendered]]) {
    assert(!text.includes(obsoleteRule), `${name}: conflicting concept restriction remains: ${obsoleteRule}`)
  }
}
assert(fastAnswersTemplate.includes("“真正”全文不用") && fastAnswersTemplate.includes("三种回答都必须独立成文") && fastAnswersTemplate.includes("不得出现“原文”“素材”"),
  "fast answers prompt must ban 「真正」 and require standalone answers")
await verifyApi("modules/articleRewriteRuntime.js", legacy.api, legacy)

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"))
const contentScripts = manifest.content_scripts?.flatMap((entry) => entry.js || []) || []
for (const file of [
  "modules/chatGptDom.js",
  "modules/articleRewriteRuntime.js",
  "modules/googleDocsRewrite.js",
  "modules/chatGptSelectARewrite.js"
]) {
  assert(contentScripts.includes(file), `manifest must load ${file}`)
}
assert(
  contentScripts.indexOf("modules/chatGptDom.js") < contentScripts.indexOf("modules/articleRewriteRuntime.js") &&
  contentScripts.indexOf("modules/articleRewriteRuntime.js") < contentScripts.indexOf("modules/googleDocsRewrite.js") &&
  contentScripts.indexOf("modules/articleRewriteRuntime.js") < contentScripts.indexOf("modules/chatGptSelectARewrite.js"),
  "article rewrite runtime must load before site adapters"
)

const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8")
const backgroundSource = readEventSources(root)
assert(contentSource.includes("preserveExistingDraft: true"), "AI fill relay must preserve existing drafts")
assert(contentSource.includes("stage: 'existing_draft'"), "AI fill relay must expose existing-draft failures")
assert(backgroundSource.includes("ccsCreateGoogleDocRewrite"), "background Google Docs rewrite route missing")
assert(backgroundSource.includes("pending-prompt-target-mismatch"), "relay target binding check missing")

console.log("[verify-article-rewrite] ✓ 提示词、严格 A/B 匹配、Docs URL、草稿保护与双目标消息协议验证通过")
