import { evaluate, wait } from "./cdp.mjs"

// Gemini 选A改写长文的最小夹具（2026-10 真实页面结构）：一轮是 .conversation-container，用户消息 <user-query>
// 折叠显示但全文在 DOM 里；回复把整篇放进「Markdown」代码块（# 主标题 / ## 小标题 / **加粗**，空行分段），
// 「注入X草稿 / 生成封面」放在代码块头部右上角（下载 / 复制代码后面）；文章直接渲染成页面时放在底栏复制按钮后面。
// 另一轮普通提问配同一篇文章，不该出按钮。
// 夹具页面按 Gemini 的做法带 require-trusted-types-for（由 smoke 服务器加响应头），扩展的写法必须在它下面可用。
export const GEMINI_ARTICLE_TITLE = "他把混乱网页排成了秩序"

const REWRITE_PROMPT = `选A并且按照提示词改写：
# 通用「GPT-4.5 感」原始素材深度改写提示词
# 二十八、输出与排版要求
只需要：主标题 + 小标题 + 正文
# 原始素材
原始素材参考本次对话上下文。`

const escapeHtml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export function geminiLongArticleFixture() {
  const paragraphs = Array.from({ length: 10 }, (_, index) =>
    `第 ${index + 1} 段：他认为一家公司的护城河来自持续积累的数据与习惯，这一段用足够长的论述确认正文长度门槛与段落结构都被完整保留。`
  )
  const markdown = [
    `# ${GEMINI_ARTICLE_TITLE}`,
    "",
    "谷歌的起点是 **PageRank算法**：把网页之间的链接当作投票。",
    "",
    "## 第一节：排座次的生意",
    "",
    ...paragraphs.slice(0, 5).flatMap((p) => [p, ""]),
    "## 第二节：亲手拆掉的入口",
    "",
    ...paragraphs.slice(5).flatMap((p) => [p, ""]),
    "<script>alert(1)</script> 最后一段收束全文。"
  ].join("\n")
  const actions = `<div class="response-container-footer"><message-actions class="hide-on-print"><div class="actions-container-v2"><div class="buttons-container-v2">
      <gem-icon-button arialabel="Good response"><button aria-label="Good response">👍</button></gem-icon-button>
      <copy-button><gem-icon-button arialabel="Copy"><button aria-label="Copy">⧉</button></gem-icon-button></copy-button>
      <gem-icon-button arialabel="Show more options"><button aria-label="Show more options">⋮</button></gem-icon-button>
    </div></div></message-actions></div>`
  // 真实嵌套：.code-block > 有底色的 .formatted-code-block-internal-container（大圆角、顶部 26px 内边距）
  //   > .animated-opacity > [头部（标了语言才有）, pre]
  const articleBlock = `<response-element class="no-md md-has-block-component"><code-block><div class="code-block" style="position:relative">
      <div class="formatted-code-block-internal-container" style="background:#171717;color:#e3e3e3;border-radius:40px;padding:26px 0 0 32px"><div class="animated-opacity">
      <div class="code-block-decoration header-formatted" style="display:flex;justify-content:space-between;position:sticky;top:0"><span>Markdown</span><div class="buttons">
        <gem-icon-button arialabel="Download code"><button aria-label="Download code"><span class="mat-mdc-button-persistent-ripple"></span></button></gem-icon-button>
        <gem-icon-button arialabel="Copy code"><button aria-label="Copy code"><span class="mat-mdc-button-persistent-ripple"></span></button></gem-icon-button>
      </div></div>
      <pre style="margin:0"><code role="text" data-test-id="code-content" class="code-container formatted">${escapeHtml(markdown)}</code></pre>
    </div></div></div></code-block></response-element>`
  const turn = (id, query, busy) => `<div class="conversation-container" id="${id}">
      <user-query><div class="query-text gds-body-l collapsed" style="white-space:pre-wrap">${escapeHtml(query)}</div><button aria-label="Expand">⌄</button></user-query>
      <model-response><div class="response-container">
        <message-content><div class="markdown markdown-main-panel" aria-busy="${busy}">${articleBlock}</div></message-content>
        ${actions}
      </div></model-response>
    </div>`
  return `<!doctype html><meta charset="utf-8"><title>Gemini long-article fixture</title>
    <style>
      body { font: 16px/1.5 system-ui; } .buttons-container-v2 { display: flex; align-items: center; }
      /* 与真实 Gemini 相同的尺寸（2026-10 实测）：头部 flex 居中；右侧按钮组是普通块，里面是 36px 高的行内块图标。
         图标按钮里没有文字（字形不在文档流里），行内块的基线就是它的底边——vertical-align: middle 因此对不齐 */
      .code-block-decoration { align-items: center; } .code-block-decoration .buttons { display: block; line-height: 20px; font-size: 15px; }
      gem-icon-button { display: inline-block; } gem-icon-button button { display: flex; box-sizing: border-box; width: 36px; height: 36px; padding: 6px; border: 0; font-size: 24px; }
      gem-icon-button .mat-mdc-button-persistent-ripple { display: block; width: 24px; height: 24px; }
    </style>
    <main>
      ${turn("gemini-rewrite", REWRITE_PROMPT, "true")}
      ${turn("gemini-ordinary", "请写一篇关于谷歌的文章。", "false")}
    </main>`
}

const pageCheck = (fn) => `(${fn.toString()})()`

export async function verifyGeminiLongArticle(cdp, swCdp) {
  // 1. 生成中就挂上（禁用 + 等待态），生成结束确认稳定后可用；普通提问的同一篇文章不挂
  await evaluate(cdp, pageCheck(async function () {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const assert = (condition, label) => { if (!condition) throw new Error(label) }
    const waitFor = async (predicate, label, timeoutMs = 6000) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (predicate()) return
        await delay(50)
      }
      throw new Error(label)
    }
    const turn = document.getElementById("gemini-rewrite")
    const actions = () => turn.querySelector("[data-ccs-long-article-actions]")
    await waitFor(() => actions()?.dataset.ccsLongArticleState === "generating", "Gemini 长文生成中没有挂出等待态按钮")
    assert([...actions().querySelectorAll("button")].every((button) => button.disabled), "Gemini 长文生成中按钮未禁用")
    const header = turn.querySelector("code-block .code-block-decoration .buttons")
    assert(actions().parentElement === header && header.lastElementChild === actions(), "Gemini 长文按钮没有放在代码块头部右上角的按钮组末尾")
    assert(actions().previousElementSibling?.getAttribute("arialabel") === "Copy code", "Gemini 长文按钮没有紧跟在复制代码按钮后面")
    assert(!turn.querySelector("message-actions [data-ccs-long-article-actions]"), "代码块里的长文不该把按钮放到底栏")
    // 垂直方向与同组图标同一条中线，且不把头部撑高（曾经低 8px、头部高 36→40）
    const center = (element) => { const rect = element.getBoundingClientRect(); return rect.top + rect.height / 2 }
    const icon = header.querySelector("gem-icon-button")
    assert(Math.abs(center(actions()) - center(icon)) <= 1, `长文按钮与代码块图标没对齐：按钮中线 ${center(actions())}，图标中线 ${center(icon)}`)
    assert(Math.abs(header.getBoundingClientRect().height - icon.getBoundingClientRect().height) <= 1, `长文按钮把代码块头部撑高了：${header.getBoundingClientRect().height}px`)
    assert(!document.getElementById("gemini-ordinary").querySelector("[data-ccs-long-article-actions]"), "普通提问的文章不该挂长文按钮")
    turn.querySelector(".markdown").setAttribute("aria-busy", "false")
    await waitFor(() => actions()?.dataset.ccsLongArticleState === "ready", "Gemini 长文生成结束后按钮没有变为可用")
    assert(actions().querySelectorAll("button").length === 2 && [...actions().querySelectorAll("button")].every((button) => !button.disabled), "Gemini 长文就绪按钮不完整或不可用")
    assert(document.querySelectorAll("[data-ccs-long-article-actions]").length === 1, "Gemini 长文按钮重复")
  }))

  // 2. 点两个按钮，在后台入口截下投递内容（不真开 X / 封面页）
  await evaluate(swCdp, `(() => {
    const actions = globalThis.CCSArticleActions;
    globalThis.__ccsGeminiLong = { originalX: actions.createAndDeliverXArticleDraft, originalRun: globalThis.runAITask, x: [], cover: [] };
    actions.createAndDeliverXArticleDraft = async (input, sourceUrl) => {
      globalThis.__ccsGeminiLong.x.push({ input, sourceUrl });
      return { success: true };
    };
    globalThis.runAITask = async (options) => {
      globalThis.__ccsGeminiLong.cover.push({ taskId: options?.taskId, engineId: options?.engineId, keyword: String(options?.keyword || '') });
      return { ok: true };
    };
  })()`)
  let captured = null
  try {
    for (const marker of ["data-ccs-long-article-cover", "data-ccs-long-article-x-draft"]) {
      await evaluate(cdp, `document.querySelector('#gemini-rewrite [${marker}]').click()`)
    }
    for (let i = 0; i < 60; i++) {
      captured = await evaluate(swCdp, `(() => ({ x: globalThis.__ccsGeminiLong.x[0] || null, cover: globalThis.__ccsGeminiLong.cover.find((call) => call.taskId === 'cover') || null }))()`)
      if (captured?.x && captured?.cover) break
      await wait(100)
    }
  } finally {
    await evaluate(swCdp, `(() => {
      const saved = globalThis.__ccsGeminiLong;
      globalThis.CCSArticleActions.createAndDeliverXArticleDraft = saved.originalX;
      globalThis.runAITask = saved.originalRun;
      delete globalThis.__ccsGeminiLong;
    })()`)
  }

  const cover = captured?.cover
  if (!cover?.keyword?.startsWith(GEMINI_ARTICLE_TITLE) || !cover.keyword.includes("第一节：排座次的生意") ||
      !cover.keyword.includes("PageRank算法") || cover.keyword.length < 600 || cover.engineId !== "chatgpt-images" ||
      /\*\*|^#|\n#|Markdown|Copy code|注入X草稿|生成封面/.test(cover.keyword)) {
    throw new Error(`Gemini 长文封面投递异常: ${JSON.stringify(cover)?.slice(0, 600)}`)
  }
  const x = captured?.x
  const html = x?.input?.bodyHtml || ""
  if (x?.input?.title !== "TA把混乱网页排成了秩序" || !x.sourceUrl?.startsWith("https://gemini.google.com/app/long-article-fixture") ||
      !html.includes("<h2>第一节：排座次的生意</h2>") || !html.includes("<strong>PageRank算法</strong>") ||
      html.includes("<script>") || !html.includes("&lt;script&gt;") || /他/.test(html) || !html.includes("TA认为")) {
    throw new Error(`Gemini 长文 X 草稿投递异常: ${JSON.stringify({ title: x?.input?.title, sourceUrl: x?.sourceUrl, head: html.slice(0, 300) })}`)
  }

  // 2.5 没标语言的代码块没有头部（2026-10 实测 d8c61168…：框里直接是 pre）：按钮改放在看得见的框里
  //     最上面补的一行、靠右，不压到正文、不贴大圆角；头部回来后按钮回到头部、补的那行收掉
  await evaluate(cdp, pageCheck(async function () {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const assert = (condition, label) => { if (!condition) throw new Error(label) }
    const waitFor = async (predicate, label, timeoutMs = 6000) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (predicate()) return
        await delay(50)
      }
      throw new Error(label)
    }
    const turn = document.getElementById("gemini-rewrite")
    const frame = turn.querySelector("code-block .formatted-code-block-internal-container")
    const header = frame.querySelector(".code-block-decoration")
    const headerParent = header.parentElement
    const headerNext = header.nextElementSibling
    const actions = () => turn.querySelector("[data-ccs-long-article-actions]")
    const ownRow = () => frame.querySelector(":scope > [data-ccs-gemini-block-actions]")
    header.remove()
    await waitFor(() => ownRow()?.contains(actions()), "代码块没有头部时长文按钮没有挪到代码块顶部那一行")
    assert(frame.firstElementChild === ownRow(), "补的那一行应在看得见的框里最上面")
    const frameRect = frame.getBoundingClientRect()
    const actionsRect = actions().getBoundingClientRect()
    const preRect = frame.querySelector("pre").getBoundingClientRect()
    const where = JSON.stringify({ frame: [frameRect.top, frameRect.right], actions: [actionsRect.top, actionsRect.right, actionsRect.bottom], preTop: preRect.top })
    assert(actionsRect.top >= frameRect.top && actionsRect.top - frameRect.top <= 16, `按钮不在框顶：${where}`)
    assert(frameRect.right - actionsRect.right >= 16 && frameRect.right - actionsRect.right <= 48, `按钮没有靠右，或贴进了圆角：${where}`)
    assert(actionsRect.bottom <= preRect.top + 1, `按钮压到了正文：${where}`)
    await waitFor(() => actions().dataset.ccsLongArticleState === "ready" && ![...actions().querySelectorAll("button")].some((button) => button.disabled), "挪到补的那一行后按钮不可用")
    headerParent.insertBefore(header, headerNext)
    await waitFor(() => header.querySelector(".buttons")?.lastElementChild === actions() && !ownRow(), "头部回来后按钮没有回到头部，或补的那一行没收掉")
    const headerRect = header.getBoundingClientRect()
    if (Math.abs((headerRect.top + headerRect.height / 2) - (actions().getBoundingClientRect().top + actions().getBoundingClientRect().height / 2)) > 1) {
      throw new Error("头部回来后按钮与图标没对齐")
    }
  }))

  // 3. Gemini 也可能直接把文章渲染成页面（h1 / h2 / p，没有代码块）：同样识别为可用
  await evaluate(cdp, pageCheck(async function () {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const waitFor = async (predicate, label, timeoutMs = 8000) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (predicate()) return
        await delay(50)
      }
      throw new Error(label)
    }
    const turn = document.getElementById("gemini-rewrite")
    const markdown = turn.querySelector(".markdown")
    const element = (tag, text) => Object.assign(document.createElement(tag), { textContent: text })
    // 正文要过 600 字的可投递门槛（与 Markdown 版同一套 validArticle）
    const paragraphs = Array.from({ length: 16 }, (_, i) => element("p", `渲染版第 ${i + 1} 段：这一段同样用足够长的论述，确认 Gemini 直接渲染成页面的文章也能被识别、提取并投递到封面和 X 草稿。`))
    markdown.replaceChildren(element("h1", "渲染版主标题"), element("h2", "渲染版小标题"), ...paragraphs)
    await waitFor(() => turn.querySelector("[data-ccs-long-article-actions]")?.dataset.ccsLongArticleState === "ready" &&
      ![...turn.querySelectorAll("[data-ccs-long-article-actions] button")].some((button) => button.disabled),
    "Gemini 渲染版长文没有识别为可用")
    const actions = turn.querySelector("[data-ccs-long-article-actions]")
    if (actions.previousElementSibling?.tagName !== "COPY-BUTTON" || !actions.closest("message-actions")) {
      throw new Error("Gemini 渲染版长文的按钮应在底栏复制按钮后面")
    }
  }))
}
