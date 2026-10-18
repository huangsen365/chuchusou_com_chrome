import { evaluate, wait } from "./cdp.mjs"

// Claude 页面的最小夹具（2026-10 真实页面结构，claude.ai/chat/3afe4cc5… 实测）：
//   回复 [data-testid="assistant-message"]，生成中 data-is-streaming="true"；前面有思考过程折叠行
//   [data-cds="TurnStatus"]；正文 [data-perf-reply-text]；速答的两篇回答是代码块 [data-not-prose]
//   （悬停复制按钮 + 「已复制」状态 + pre），A / B 是两个普通段落；选A改写的长文直接渲染成正文，
//   # 主标题显示成 h2、## 小标题显示成 h3；底栏 [data-testid="message-actions"] 第一个按钮是「Copy」；
//   用户消息 [data-testid="user-message"] 全文都在 DOM 里。
export const CLAUDE_ARTICLE_TITLE = "他每天写一点，三年后换了一种想问题的方式"

const REWRITE_PROMPT = `选A并且按照提示词改写：
# 通用「GPT-4.5 感」原始素材深度改写提示词
# 二十八、输出与排版要求
只需要：主标题 + 小标题 + 正文
# 原始素材
原始素材参考本次对话上下文。`

const escapeHtml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const actionsBar = `<div data-cds="MessageActions" data-testid="message-actions" role="toolbar" aria-label="Message actions" style="display:flex;align-items:center">
    <button type="button" aria-label="Copy">⧉</button><span></span>
    <button type="button" data-testid="action-bar-read-aloud" aria-label="Read aloud">🔊</button>
    <button type="button" aria-label="Good response">👍</button>
    <button type="button" data-testid="action-bar-retry" aria-label="Retry">↻</button>
  </div>`

const codeBlock = (text) => `<div data-not-prose=""><div role="group" aria-label="Code" class="relative group">
    <div class="sticky"><div class="absolute right-0"><button type="button" aria-label="Copy to clipboard">⧉</button><span role="status" class="sr-only">Copied</span></div></div>
    <div class="overflow-x-auto"><pre class="code-block__code"><code>${escapeHtml(text)}</code></pre></div>
  </div></div>`

const turn = (id, query, bodyHtml, streaming = "false") => `<div data-testid="transcript-row" id="${id}-user"><div data-testid="user-message" style="white-space:pre-wrap">${escapeHtml(query)}</div></div>
  <div data-testid="transcript-row" id="${id}">
    <div data-cds="AssistantMessage" data-testid="assistant-message" data-is-streaming="${streaming}">
      <h2 class="sr-only">Claude responded</h2>
      <div class="flex">
        <div data-cds="TurnStatus"><div title="思考过程"><span>整理回答结构</span></div></div>
        <div><div data-cds="Prose"><div data-perf-reply-text="">${bodyHtml}</div></div></div>
      </div>
      ${actionsBar}
    </div>
  </div>`

const composer = `<div contenteditable="true" role="textbox" data-testid="chat-input" aria-label="Write your prompt to Claude" class="tiptap ProseMirror" style="min-height:120px;border:1px solid #999;white-space:pre-wrap"><p><br></p></div>
  <button type="button" data-testid="chat-input-send" aria-label="Send message">Send</button>
  <script>
    window.__claudeSends = 0
    document.querySelector('[data-testid="chat-input-send"]').addEventListener('click', () => { window.__claudeSends += 1 })
  </script>`

export function claudeSelectAFixture() {
  const fastAnswer = `<p dir="ltr">【短篇回答】</p>${codeBlock("这是 Claude 代码块里的短篇回答。")}<p dir="ltr">【中篇回答】</p>${codeBlock("这是 Claude 代码块里的中篇回答。")}` +
    `<p dir="ltr" id="claude-choice-a">A：是否继续生成详细内容？</p><p dir="ltr" id="claude-choice-b">B：是否需要将【短篇回答】和【中篇回答】改得更口语、更有活人感？</p>`
  return `<!doctype html><meta charset="utf-8"><title>Claude select-A fixture</title>
    <style>body { font: 16px/1.5 system-ui; } .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); }</style>
    <main data-testid="transcript-list">
      ${turn("claude-fast", "请针对以下主题生成回答：夹具主题", fastAnswer)}
      ${turn("claude-plain", "随便聊聊", "<p>这是一条普通回答，没有速答结构。</p>")}
      ${turn("claude-streaming", "请针对以下主题生成回答：另一个主题", fastAnswer.replace(/ id="claude-choice-[ab]"/g, ""), "true")}
    </main>
    ${composer}`
}

export async function verifyClaudeSelectA(cdp) {
  return evaluate(cdp, `(${(async function () {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const assert = (condition, label) => { if (!condition) throw new Error(label) }
    const waitFor = async (predicate, label, timeoutMs = 5000) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (predicate()) return
        await delay(50)
      }
      throw new Error(label)
    }
    const marker = '[data-ccs-select-a-rewrite]'
    const turn = (id) => document.getElementById(id)
    const button = () => turn('claude-fast').querySelector(marker)
    const copyOf = (id) => turn(id).querySelector('[data-testid="message-actions"] > button[aria-label="Copy"]')
    const composer = document.querySelector('[data-testid="chat-input"]')

    await waitFor(() => button(), 'Claude 速答回复没有出现选A按钮')
    assert(button().previousElementSibling === copyOf('claude-fast'), '选A按钮没有紧跟在整条回复的 Copy 后面')
    assert(!button().closest('[data-not-prose]'), '选A按钮跑进了代码块')
    assert(!turn('claude-plain').querySelector(marker), '普通回答不该有选A按钮')
    assert(!turn('claude-streaming').querySelector(marker), '生成中的回复不该有选A按钮')
    assert(document.querySelectorAll(marker).length === 1, '选A按钮重复')

    // 生成结束（data-is-streaming 翻成 false）后按钮出现
    turn('claude-streaming').querySelector('[data-testid="assistant-message"]').setAttribute('data-is-streaming', 'false')
    await waitFor(() => turn('claude-streaming').querySelector(marker), '生成结束后没有出现选A按钮')
    turn('claude-streaming').remove()

    // A/B 不完整 → 按钮撤掉；恢复 → 回来
    const choiceB = document.getElementById('claude-choice-b')
    const valid = choiceB.textContent
    choiceB.textContent = 'B：普通的不完整选项。'
    await waitFor(() => !button(), '不完整 A/B 仍保留选A按钮')
    choiceB.textContent = valid
    await waitFor(() => button(), '恢复完整 A/B 后选A按钮没有回来')

    // 底栏重绘 → 按钮回到 Copy 后面
    const footer = turn('claude-fast').querySelector('[data-testid="message-actions"]')
    const rebuilt = footer.cloneNode(true)
    rebuilt.querySelectorAll(marker).forEach((node) => node.remove())
    footer.replaceWith(rebuilt)
    await waitFor(() => button()?.previousElementSibling === copyOf('claude-fast') && rebuilt.contains(button()), '底栏重绘后选A按钮没有恢复')
    // React 重排底栏子节点（真实页面「N minutes ago」更新时会发生）把按钮挤到最前 → 放回 Copy 后面
    rebuilt.prepend(button())
    await waitFor(() => button()?.previousElementSibling === copyOf('claude-fast'), 'React 重排后选A按钮没有回到 Copy 后面')

    // 点击 → 改写提示词进 Claude 输入框，不自动发送
    button().click()
    await waitFor(() => (composer.innerText || '').includes('原始素材参考本次对话上下文。'), 'Claude 输入框没有填入完整选A改写提示词', 8000)
    const filled = composer.innerText
    assert(filled.startsWith('选A并且按照提示词改写：'), 'Claude 输入框缺少选A指令')
    assert(filled.includes('# 通用「GPT-4.5 感」原始素材深度改写提示词'), 'Claude 输入框缺少改写模板')
    assert(!/\$\{[A-Za-z]+\}/.test(filled), 'Claude 填入残留提示词变量')
    assert(window.__claudeSends === 0, '选A自动发送了提示词')
    await waitFor(() => !button().disabled, '填入后选A按钮没有恢复', 6000)

    // 输入框已有草稿 → 不覆盖
    composer.textContent = 'Claude 页面里尚未发送的草稿。'
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: composer.textContent }))
    button().click()
    await waitFor(() => button().textContent.includes('填入失败'), 'Claude 输入框有草稿时没有拒绝覆盖')
    assert(composer.textContent === 'Claude 页面里尚未发送的草稿。' && window.__claudeSends === 0, 'Claude 草稿被覆盖或被发送')
    return { ok: true }
  }).toString()})()`, { timeoutMs: 30_000 })
}

export function claudeLongArticleFixture() {
  const paragraph = (index) => `<p dir="ltr">第 ${index} 段：他每天写下当天最想不通的一件事，这一段用足够长的论述确认正文长度门槛与段落结构都被完整保留下来。</p>`
  const article = `<h2 dir="ltr">${CLAUDE_ARTICLE_TITLE}</h2>` +
    `<p dir="ltr">写作带来的第一个变化是 <strong>认知卸载</strong>：把想法放到纸上，脑子才腾得出空间。</p>` +
    `<h3 dir="ltr">卡住的那一刻，思考才开始</h3>${[1, 2, 3, 4, 5].map(paragraph).join("")}` +
    `<h3 dir="ltr">写过的东西会接住新来的东西</h3>${[6, 7, 8, 9, 10].map(paragraph).join("")}` +
    `<p dir="ltr">&lt;script&gt;alert(1)&lt;/script&gt; 最后一段收束全文。</p>`
  return `<!doctype html><meta charset="utf-8"><title>Claude long-article fixture</title>
    <style>body { font: 16px/1.5 system-ui; } .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); }</style>
    <main data-testid="transcript-list">
      ${turn("claude-rewrite", REWRITE_PROMPT, article, "true")}
      ${turn("claude-ordinary", "请写一篇关于写作的文章。", article)}
    </main>
    ${composer}`
}

const pageCheck = (fn) => `(${fn.toString()})()`

export async function verifyClaudeLongArticle(cdp, swCdp) {
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
    const turn = document.getElementById("claude-rewrite")
    const actions = () => turn.querySelector("[data-ccs-long-article-actions]")
    await waitFor(() => actions()?.dataset.ccsLongArticleState === "generating", "Claude 长文生成中没有挂出等待态按钮")
    assert([...actions().querySelectorAll("button")].every((button) => button.disabled), "Claude 长文生成中按钮未禁用")
    assert(actions().previousElementSibling === turn.querySelector('[data-testid="message-actions"] > button[aria-label="Copy"]'), "Claude 长文按钮没有紧跟在整条回复的 Copy 后面")
    assert(!document.getElementById("claude-ordinary").querySelector("[data-ccs-long-article-actions]"), "普通提问的文章不该挂长文按钮")
    turn.querySelector('[data-testid="assistant-message"]').setAttribute("data-is-streaming", "false")
    await waitFor(() => actions()?.dataset.ccsLongArticleState === "ready", "Claude 长文生成结束后按钮没有变为可用")
    assert(actions().querySelectorAll("button").length === 2 && [...actions().querySelectorAll("button")].every((button) => !button.disabled), "Claude 长文就绪按钮不完整或不可用")
    assert(document.querySelectorAll("[data-ccs-long-article-actions]").length === 1, "Claude 长文按钮重复")
    // React 重排底栏子节点把按钮组挤到最前（真实页面实测）→ 放回 Copy 后面
    const bar = turn.querySelector('[data-testid="message-actions"]')
    bar.prepend(actions())
    await waitFor(() => actions().previousElementSibling === bar.querySelector('button[aria-label="Copy"]'), "React 重排后长文按钮没有回到 Copy 后面")
  }))

  // 2. 点两个按钮，在后台入口截下投递内容（不真开 X / 封面页）
  await evaluate(swCdp, `(() => {
    const actions = globalThis.CCSArticleActions;
    globalThis.__ccsClaudeLong = { originalX: actions.createAndDeliverXArticleDraft, originalRun: globalThis.runAITask, x: [], cover: [] };
    actions.createAndDeliverXArticleDraft = async (input, sourceUrl) => {
      globalThis.__ccsClaudeLong.x.push({ input, sourceUrl });
      return { success: true };
    };
    globalThis.runAITask = async (options) => {
      globalThis.__ccsClaudeLong.cover.push({ taskId: options?.taskId, engineId: options?.engineId, keyword: String(options?.keyword || '') });
      return { ok: true };
    };
  })()`)
  let captured = null
  try {
    for (const marker of ["data-ccs-long-article-cover", "data-ccs-long-article-x-draft"]) {
      await evaluate(cdp, `document.querySelector('#claude-rewrite [${marker}]').click()`)
    }
    for (let i = 0; i < 60; i++) {
      captured = await evaluate(swCdp, `(() => ({ x: globalThis.__ccsClaudeLong.x[0] || null, cover: globalThis.__ccsClaudeLong.cover.find((call) => call.taskId === 'cover') || null }))()`)
      if (captured?.x && captured?.cover) break
      await wait(100)
    }
  } finally {
    await evaluate(swCdp, `(() => {
      const saved = globalThis.__ccsClaudeLong;
      globalThis.CCSArticleActions.createAndDeliverXArticleDraft = saved.originalX;
      globalThis.runAITask = saved.originalRun;
      delete globalThis.__ccsClaudeLong;
    })()`)
  }

  const cover = captured?.cover
  if (!cover?.keyword?.startsWith(CLAUDE_ARTICLE_TITLE) || !cover.keyword.includes("卡住的那一刻，思考才开始") ||
      !cover.keyword.includes("认知卸载") || cover.keyword.length < 600 || cover.engineId !== "chatgpt-images" ||
      /注入X草稿|生成封面|Copy|Read aloud|整理回答结构/.test(cover.keyword)) {
    throw new Error(`Claude 长文封面投递异常: ${JSON.stringify(cover)?.slice(0, 600)}`)
  }
  const x = captured?.x
  const html = x?.input?.bodyHtml || ""
  if (x?.input?.title !== "TA每天写一点，三年后换了一种想问题的方式" || !x.sourceUrl?.startsWith("https://claude.ai/chat/long-article-fixture") ||
      !html.includes("<h2>卡住的那一刻，思考才开始</h2>") || !html.includes("<strong>认知卸载</strong>") || html.includes(CLAUDE_ARTICLE_TITLE) ||
      html.includes("<script>") || /他/.test(html) || !html.includes("TA每天写下")) {
    throw new Error(`Claude 长文 X 草稿投递异常: ${JSON.stringify({ title: x?.input?.title, sourceUrl: x?.sourceUrl, head: html.slice(0, 300) })}`)
  }
}
