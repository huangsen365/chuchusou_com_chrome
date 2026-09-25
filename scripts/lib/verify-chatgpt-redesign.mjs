import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { evaluate, wait } from "./cdp.mjs"

// 2026-09 页面结构的最小夹具：一轮同时包含 user / assistant，完全不保留
// conversation-turn、data-message-author-role、data-message-id 或旧 composer id。
export function chatgptRedesignFixture(longArticleParagraphs) {
  const block = (title, body, id = "") => `<div data-testid="chatgpt-writing-block" data-oai-writing-block-surface data-writing-block-variant="document" ${id ? `id="${id}"` : ""}>
    <header><button aria-label="Add to library"><span>${title}</span></button><div><span class="contents"><button aria-label="Copy">Copy</button></span><button aria-label="More options">More</button></div></header>
    <div class="writing-block-editor"><div class="ProseMirror" contenteditable="true" role="textbox" aria-label="Start writing">${body}</div></div>
  </div>`
  const user = (key, body) => `<div data-chatgpt-search-unit-key="${key}:0:user" data-chatgpt-search-message-ids="user-${key}"><div data-user-message-bubble="true" style="white-space:pre-wrap">${body}</div></div>`
  const assistant = (key, body, attrs = "") => `<div data-chatgpt-search-unit-key="${key}:2:assistant" data-chatgpt-search-message-ids="assistant-${key}" data-content-search-unit-key="${key}:2:assistant" ${attrs}>
    <h4 data-conversation-role="assistant">ChatGPT said:</h4><div data-chatgpt-selection-message-id="assistant-${key}"><div data-markdown-text-style="assistant-message">${body}</div></div></div>`
  const nativeControl = (label) => `<button class="fixture-native-action" aria-label="${label}"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="M3 3h10v10H3Z" fill="none" stroke="currentColor"/></svg></button>`
  const controls = `<div class="turn-action-controls"><div><span class="contents">${nativeControl("Copy")}</span><span class="contents">${nativeControl("Rate response")}</span>${nativeControl("Share")}${nativeControl("Read aloud")}${nativeControl("Regenerate")}</div></div>`
  const choices = `<p>【短篇回答】</p>${block("短篇回答", "<p>这是独立 Writing block 中的短篇回答。</p>")}
    <p>【中篇回答】</p>${block("中篇回答", "<p>这是独立 Writing block 中的中篇回答。</p>")}
    <p id="redesign-choices">A：是否继续生成详细内容？<br>B：是否需要将【短篇回答】和【中篇回答】改得更口语、更有活人感？</p>`
  const prompt = `选A并且按照提示词改写：
# 通用「GPT-4.5 感」原始素材深度改写提示词
# 二十八、输出与排版要求
只需要：主标题 + 小标题 + 正文
# 原始素材
原始素材参考本次对话上下文。`
  return `<!doctype html><html data-codex-window-type="browser"><meta charset="utf-8"><title>ChatGPT redesigned DOM fixture</title>
    <style>
      :root {--spacing:4px;--radius-lg:8px}
      body {font:16px/1.5 system-ui} [contenteditable] {min-height:30px;white-space:pre-wrap} .contents {display:contents} [data-composer-markdown] {min-height:160px;border:1px solid #999}
      .turn-action-controls {display:flex;align-items:center}
      .turn-action-controls > div {display:flex;flex-wrap:wrap;align-items:center;width:max-content;max-width:100%}
      .fixture-native-action {display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;border:0;background:transparent}
      /* 真实 ChatGPT browser surface 的 utilities 规则，文字按钮需要声明 content 宽度。 */
      @layer utilities {
        .turn-action-controls:where([data-codex-window-type=browser] .turn-action-controls){--icon-size:var(--icon-leading-size);min-height:calc(var(--spacing) * 8);gap:0}
        .turn-action-controls:where([data-codex-window-type=browser] .turn-action-controls)>div{gap:0}
        .turn-action-controls:where([data-codex-window-type=browser] .turn-action-controls) button{height:calc(var(--spacing) * 8);border-radius:var(--radius-lg)}
        .turn-action-controls:where([data-codex-window-type=browser] .turn-action-controls) button:not([data-turn-action-width=content]){width:calc(var(--spacing) * 8);padding:0}
      }
    </style>
    <main>
      <div data-turn-key="turn-select">${user("turn-select", "请提供短篇和中篇回答。")}${assistant("turn-select", choices)}${controls}</div>
      <div data-turn-key="turn-fake">${user("turn-fake", choices.replace('id="redesign-choices"', ""))}${assistant("turn-fake", "<p>这是普通回答，没有选 A 工作流。</p>")}${controls}</div>
      <div data-turn-key="turn-long">${user("turn-long", prompt)}${assistant("turn-long", block("成熟判断来自理解事情背后的结构", `<h2>为什么容易停留在表面</h2>${longArticleParagraphs}`, "redesign-article"), 'data-is-streaming="true"')}${controls}</div>
    </main>
    <form data-chatgpt-composer><div contenteditable="true" data-composer-markdown role="textbox" aria-label="Ask ChatGPT"></div><button type="submit">Send</button></form>
    <script>window.__submitClicks = 0; document.querySelector('form').addEventListener('submit', (event) => {event.preventDefault(); window.__submitClicks += 1})</script>`
}

export async function verifyChatgptRedesign(cdp, swCdp) {
  await evaluate(cdp, `(${(async function () {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const assert = (condition, label) => { if (!condition) throw new Error(label) }
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        if (predicate()) return
        await delay(50)
      }
      throw new Error(label)
    }
    const marker = '[data-ccs-select-a-rewrite]'
    const select = document.querySelector('[data-turn-key="turn-select"]')
    const button = () => select.querySelector(marker)
    const choices = document.getElementById('redesign-choices')
    const composer = document.querySelector('[data-chatgpt-composer] [data-composer-markdown]')
    const originalEditors = [...document.querySelectorAll('.writing-block-editor .ProseMirror')].map((editor) => editor.innerHTML)
    assert(!document.querySelector('[data-message-author-role], [data-message-id], [data-testid^="conversation-turn-"], #prompt-textarea'), '新版夹具意外包含旧 DOM 选择器')
    await waitFor(() => button(), '新版回复没有选 A 入口')
    assert(document.querySelectorAll(marker).length === 1, '用户伪造选 A 回复被识别，或重复注入')
    const placedCorrectly = () => button()?.previousElementSibling?.matches('span.contents') &&
      button().previousElementSibling.querySelector('button[aria-label="Copy"]') &&
      button().closest('.turn-action-controls') && !button().closest('span.contents')
    assert(placedCorrectly(), '选 A 未紧邻整轮 Copy wrapper 或混入 Writing block / tooltip')

    const validChoices = choices.innerHTML
    choices.textContent = 'A：是否继续生成详细内容？ B：普通的不完整选项。'
    await waitFor(() => !button(), '不完整 A/B 内容错误保留选 A 入口')
    choices.innerHTML = validChoices
    await waitFor(() => button(), '恢复完整 A/B 内容后没有选 A 入口')
    const controls = select.querySelector('.turn-action-controls')
    const replacement = controls.cloneNode(true)
    replacement.querySelectorAll(marker).forEach((node) => node.remove())
    controls.replaceWith(replacement)
    await waitFor(placedCorrectly, '整轮动作栏重建后未恢复选 A 入口')
    assert(document.querySelectorAll(marker).length === 1, '整轮动作栏重建导致重复入口')
    button().click()
    await waitFor(() => composer.textContent.includes('原始素材参考本次对话上下文。'), '新版主输入框未填入完整选 A 提示词')
    assert(composer.textContent.startsWith('选A并且按照提示词改写：'), '新版主输入框缺少选 A 指令')
    assert(!composer.textContent.includes('${outputLanguage}'), '新版填充残留提示词变量')
    assert(window.__submitClicks === 0, '选 A 自动发送了提示词')
    assert(JSON.stringify(originalEditors) === JSON.stringify([...document.querySelectorAll('.writing-block-editor .ProseMirror')].map((editor) => editor.innerHTML)), '选 A 填充修改了 Writing block 编辑器')
    await waitFor(() => !button().disabled, '选 A 填充后按钮未恢复')
    composer.textContent = '新版页面中尚未发送的独立草稿。'
    composer.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:composer.textContent}))
    button().click()
    await waitFor(() => button().textContent.includes('填入失败'), '新版主输入框没有拒绝覆盖已有草稿')
    assert(composer.textContent === '新版页面中尚未发送的独立草稿。' && window.__submitClicks === 0, '新版已有草稿被覆盖或自动发送')

    const turn = document.querySelector('[data-turn-key="turn-long"]')
    const unit = turn.querySelector('[data-chatgpt-search-unit-key$=":assistant"]')
    const block = document.getElementById('redesign-article')
    const actions = () => turn.querySelector('[data-ccs-long-article-actions]')
    await waitFor(() => actions()?.dataset.ccsLongArticleState === 'generating', '新版长文生成中未显示等待态')
    assert([...actions().querySelectorAll('button')].every((node) => node.disabled && node.getAttribute('aria-busy') === 'true'), '新版生成中长文按钮未禁用')
    assert(actions().closest('header') && !actions().closest('span.contents') && actions().previousElementSibling?.querySelector('button[aria-label="Copy"]'), '新版长文动作未位于 header Copy wrapper 之后')
    assert(!block.querySelector('.ProseMirror').contains(actions()), '新版长文动作侵入编辑器')
    unit.removeAttribute('data-is-streaming')
    await waitFor(() => actions()?.dataset.ccsLongArticleState === 'settling', '新版长文完成后缺少稳定等待态')
    await waitFor(() => actions()?.dataset.ccsLongArticleState === 'ready', '新版长文未读取同轮用户工作流或 header 标题')
    assert(actions().querySelectorAll('button').length === 2 && [...actions().querySelectorAll('button')].every((node) => !node.disabled), '新版长文就绪按钮不完整或不可用')
    assert(turn.querySelectorAll('[data-ccs-long-article-actions]').length === 1, '新版长文动作重复注入')
  }).toString()})()`, { timeoutMs: 25_000 })

  // 点真实扩展按钮并在后台任务边界读取最终文章，验证 header 标题与正文实际进入投递。
  await evaluate(swCdp, `(() => {
    globalThis.__ccsRedesignOriginalRunAITask = globalThis.runAITask;
    globalThis.__ccsRedesignCoverCalls = [];
    globalThis.runAITask = async (options) => {
      globalThis.__ccsRedesignCoverCalls.push({ taskId: options?.taskId, keyword: String(options?.keyword || '') });
      return { ok: true };
    };
  })()`)
  let coverCall
  try {
    await evaluate(cdp, `document.querySelector('#redesign-article [data-ccs-long-article-cover]').click()`)
    for (let i = 0; i < 40; i++) {
      coverCall = await evaluate(swCdp, `globalThis.__ccsRedesignCoverCalls.find((call) => call.taskId === 'cover') || null`)
      if (coverCall) break
      await wait(100)
    }
  } finally {
    await evaluate(swCdp, `(() => {
      globalThis.runAITask = globalThis.__ccsRedesignOriginalRunAITask;
      delete globalThis.__ccsRedesignOriginalRunAITask;
      delete globalThis.__ccsRedesignCoverCalls;
    })()`)
  }
  if (!coverCall?.keyword?.startsWith("成熟判断来自理解事情背后的结构") ||
      !coverCall.keyword.includes("为什么容易停留在表面") || coverCall.keyword.length < 600 ||
      /Add to library|Start writing|ChatGPT said:|生成封面|注入X草稿/.test(coverCall.keyword)) {
    throw new Error(`新版 Writing block header 标题/正文投递异常: ${JSON.stringify(coverCall)?.slice(0, 500)}`)
  }

  const result = await evaluate(cdp, `(${(async function () {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const assert = (condition, label) => { if (!condition) throw new Error(label) }
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        if (predicate()) return
        await delay(50)
      }
      throw new Error(label)
    }
    const turn = document.querySelector('[data-turn-key="turn-long"]')
    const unit = turn.querySelector('[data-chatgpt-search-unit-key$=":assistant"]')
    const markdown = unit.querySelector('[data-markdown-text-style="assistant-message"]')
    const block = document.getElementById('redesign-article')
    const user = turn.querySelector('[data-user-message-bubble]')
    const actions = () => turn.querySelector('[data-ccs-long-article-actions]')
    const ready = () => actions()?.dataset.ccsLongArticleState === 'ready'
    const bodyHtml = block.querySelector('.ProseMirror').innerHTML
    markdown.innerHTML = '<h1>普通 Markdown 长文兼容标题</h1>' + bodyHtml
    await waitFor(() => ready() && actions().closest('.turn-action-controls'), '新版纯 Markdown 长文未迁移到整轮底栏')
    assert(!unit.contains(actions()) && !actions().closest('span.contents'), '纯 Markdown 动作落入正文或 tooltip wrapper')
    assert(actions().previousElementSibling?.querySelector('button[aria-label="Copy"]'), '纯 Markdown 动作未紧邻整轮 Copy wrapper')
    assert(turn.querySelectorAll('[data-ccs-long-article-actions]').length === 1, '新版切换纯 Markdown 后重复动作')
    const footer = turn.querySelector('.turn-action-controls')
    const replacement = footer.cloneNode(true)
    replacement.querySelectorAll('[data-ccs-long-article-actions]').forEach((node) => node.remove())
    footer.replaceWith(replacement)
    await waitFor(() => ready() && replacement.contains(actions()), '新版底栏重建后长文动作丢失')

    const sourcePrompt = user.textContent
    user.textContent = '请写一篇普通文章。'
    await waitFor(() => !actions(), '同轮普通用户输入仍借用其他轮的旧工作流')
    user.textContent = sourcePrompt
    await waitFor(ready, '恢复同轮工作流后长文动作未恢复')
    const nextTurn = document.createElement('div')
    nextTurn.setAttribute('data-turn-key', 'turn-next')
    nextTurn.innerHTML = '<div data-chatgpt-search-unit-key="turn-next:0:user" data-chatgpt-search-message-ids="user-next"><div data-user-message-bubble="true">普通后续提问。</div></div>' +
      '<div data-chatgpt-search-unit-key="turn-next:2:assistant" data-chatgpt-search-message-ids="assistant-next" data-content-search-unit-key="turn-next:2:assistant"><h4 data-conversation-role="assistant">ChatGPT said:</h4><div data-chatgpt-selection-message-id="assistant-next"><div data-markdown-text-style="assistant-message">' + markdown.innerHTML + '</div></div></div>' +
      '<div class="turn-action-controls"><div><span class="contents"><button aria-label="Copy">Copy</button></span><span class="contents"><button aria-label="Rate response">Rate</button></span><button aria-label="Share">Share</button></div></div>'
    turn.after(nextTurn)
    await delay(150)
    assert(!nextTurn.querySelector('[data-ccs-long-article-actions]'), '后续普通轮错误使用旧改写来源')
    nextTurn.querySelector('[data-chatgpt-search-unit-key$=":user"]').remove()
    await delay(150)
    assert(!nextTurn.querySelector('[data-ccs-long-article-actions]'), '缺失用户节点的后续轮借用了旧来源')
    const stop = document.createElement('button')
    stop.setAttribute('data-testid', 'stop-button')
    stop.setAttribute('aria-label', 'Stop generating')
    document.querySelector('[data-chatgpt-composer]').append(stop)
    await delay(200)
    assert(ready(), '后续回复生成中错误冻结已完成的历史长文')
    nextTurn.remove()
    await waitFor(() => actions()?.dataset.ccsLongArticleState === 'generating', '全局停止按钮未保护最新轮长文')
    stop.remove()
    await waitFor(ready, '全局生成状态结束后新版长文未恢复')

    // 同轮可能保留先前的 A/B chunk，再追加最终文章；两个模块必须共享稳定顺序，
    // 不能在 MutationObserver 回调中不断争抢同一个 Copy 后的位置。
    const choicesChunk = document.createElement('div')
    choicesChunk.setAttribute('data-chatgpt-search-unit-key', 'turn-long:1:assistant')
    choicesChunk.setAttribute('data-chatgpt-search-message-ids', 'assistant-long-choices')
    choicesChunk.setAttribute('data-content-search-unit-key', 'turn-long:1:assistant')
    choicesChunk.innerHTML = '<h4 data-conversation-role="assistant">ChatGPT said:</h4><div data-chatgpt-selection-message-id="assistant-long-choices"><div data-markdown-text-style="assistant-message"></div></div>'
    const choicesBody = choicesChunk.querySelector('[data-markdown-text-style="assistant-message"]')
    for (const text of [
      '【短篇回答】',
      '这是一句完整的短篇回答。',
      '【中篇回答】',
      '这是中篇回答正文。',
      'A：用户是否需要继续生成详细内容（该部分生成时直接输出正文，不得出现“长篇回答”等字样，且结尾不得包含任何追问或引导语，便于复制使用）',
      'B：请将【短篇回答】和【中篇回答】麻烦你讲人话，要有活人感（如出现“他、她”，统一替换为“TA”）'
    ]) {
      const paragraph = document.createElement('p')
      paragraph.textContent = text
      choicesBody.append(paragraph)
    }
    unit.before(choicesChunk)
    const sharedChoice = () => turn.querySelector('[data-ccs-select-a-rewrite]')
    const controlsOrdered = () => ready() && sharedChoice()?.previousElementSibling?.querySelector('button[aria-label="Copy"]') &&
      actions().previousElementSibling === sharedChoice()
    await waitFor(controlsOrdered, '同轮选 A 与长文动作未按 Copy → 选 A → 长文组共存')
    await delay(100)
    const choiceControl = sharedChoice()
    const articleControls = actions()
    let controlMoves = 0
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of [...record.addedNodes, ...record.removedNodes]) {
          if (node === choiceControl || node === articleControls) controlMoves += 1
        }
      }
    })
    observer.observe(turn, {childList:true, subtree:true})
    try {
      const iconTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title')
      iconTitle.textContent = 'Rate response'
      replacement.querySelector('[aria-label="Rate response"] svg').append(iconTitle)
      await delay(350)
    } finally {
      observer.disconnect()
    }
    assert(controlMoves === 0 && controlsOrdered(), '同轮选 A 与长文动作持续互移，触发 MutationObserver 循环')
    assert(turn.querySelectorAll('[data-ccs-select-a-rewrite]').length === 1 && turn.querySelectorAll('[data-ccs-long-article-actions]').length === 1, '同轮双入口重复注入')
    assert(window.__submitClicks === 0, '新版兼容回归意外自动发送')
    return {selectA: true, composer: true, headerTitle: true, plainMarkdown: true, streaming: true, sharedToolbar: true}
  }).toString()})()`, { timeoutMs: 25_000 })
  await verifyChatgptActionLayout(cdp)
  await evaluate(cdp, `(${(async function () {
    const turn = document.querySelector('[data-turn-key="turn-long"]')
    turn.querySelector('[data-chatgpt-search-unit-key="turn-long:1:assistant"]').remove()
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      const actions = turn.querySelector('[data-ccs-long-article-actions]')
      if (!turn.querySelector('[data-ccs-select-a-rewrite]') && actions?.dataset.ccsLongArticleState === 'ready' && actions.previousElementSibling?.querySelector('button[aria-label="Copy"]')) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('移除同轮 A/B chunk 后长文动作未恢复到 Copy 后')
  }).toString()})()`)
  return {...result, actionLayout: true}
}

// 用真实浏览器布局和命中检测检查文字按钮，而不只断言 CSS 声明存在。
export async function verifyChatgptActionLayout(cdp) {
  const measure = (turnKey, state, expectedWidth) => {
    const turn = document.querySelector(`[data-turn-key="${turnKey}"]`)
    const row = turn.querySelector('.turn-action-controls > div')
    const rowRect = row.getBoundingClientRect()
    const buttons = [...row.querySelectorAll('button')]
    const extensionButtons = buttons.filter((button) => button.matches('[data-ccs-select-a-rewrite], [data-ccs-long-article-x-draft], [data-ccs-long-article-cover]'))
    const fail = (message, extra = {}) => {throw new Error(`${turnKey}/${state}/${expectedWidth}px: ${message} ${JSON.stringify(extra)}`)}
    const describe = (rect) => ({left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom, width:rect.width, height:rect.height})
    if (extensionButtons.length !== (turnKey === 'turn-long' ? 3 : 1)) fail('文字按钮数量错误')
    if (Math.abs(rowRect.width - expectedWidth) > 1) fail('测试动作栏宽度未生效', describe(rowRect))
    for (const button of extensionButtons) {
      const rect = button.getBoundingClientRect()
      if (rect.width <= 32 || rect.height < 28) fail('文字按钮仍被压缩为原生图标尺寸', {label:button.textContent, ...describe(rect)})
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(walker.currentNode)
        for (const textRect of range.getClientRects()) {
          if (!textRect.width || !textRect.height) continue
          if (textRect.left < rect.left - 1 || textRect.right > rect.right + 1 || textRect.top < rect.top - 1 || textRect.bottom > rect.bottom + 1) {
            fail('文字超出按钮点击区域', {label:button.textContent, button:describe(rect), text:describe(textRect)})
          }
        }
      }
    }
    const rectangles = buttons.map((button) => ({button, rect:button.getBoundingClientRect()}))
    for (const {button, rect} of rectangles) {
      if (rect.left < rowRect.left - 1 || rect.right > rowRect.right + 1) fail('按钮超出窄动作栏', {label:button.getAttribute('aria-label'), ...describe(rect)})
      for (const x of [rect.left + 3, (rect.left + rect.right) / 2, rect.right - 3]) {
        const y = (rect.top + rect.bottom) / 2
        if (document.elementFromPoint(x, y)?.closest('button') !== button) fail('按钮可点击区域被其他元素遮挡', {label:button.getAttribute('aria-label') || button.textContent, x, y})
      }
    }
    for (let i = 0; i < rectangles.length; i++) {
      for (let j = i + 1; j < rectangles.length; j++) {
        const a = rectangles[i].rect
        const b = rectangles[j].rect
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
          fail('相邻按钮点击区域重叠', {a:rectangles[i].button.textContent, b:rectangles[j].button.textContent})
        }
      }
    }
    const lines = new Set(rectangles.map(({rect}) => Math.round(rect.top)))
    if (expectedWidth <= 192 && lines.size < 2) fail('窄栏动作没有换行')
    const choice = extensionButtons[0]
    if (state === 'hover' && !choice.matches(':hover')) fail('未进入真实 hover 状态')
    if (state === 'focus' && document.activeElement !== choice) fail('未进入聚焦状态')
    return {turnKey, state, width:expectedWidth, lines:lines.size}
  }
  const measurements = []
  for (const turnKey of ['turn-select', 'turn-long']) {
    for (const width of [640, 192, 160]) {
      await cdp.call('Input.dispatchMouseEvent', {type:'mouseMoved', x:0, y:0})
      const position = await evaluate(cdp, `(() => {
        document.activeElement?.blur();
        const row = document.querySelector('[data-turn-key="${turnKey}"] .turn-action-controls > div');
        row.style.width = '${width}px';
        row.scrollIntoView({block:'center'});
        const rect = row.querySelector('[data-ccs-select-a-rewrite]').getBoundingClientRect();
        return {x:(rect.left + rect.right)/2,y:(rect.top + rect.bottom)/2};
      })()`)
      for (const state of ['normal', 'hover', 'focus']) {
        if (state === 'hover') await cdp.call('Input.dispatchMouseEvent', {type:'mouseMoved', ...position})
        if (state === 'focus') {
          await cdp.call('Input.dispatchMouseEvent', {type:'mouseMoved', x:0, y:0})
          await evaluate(cdp, `document.querySelector('[data-turn-key="${turnKey}"] [data-ccs-select-a-rewrite]').focus()`)
        }
        measurements.push(await evaluate(cdp, `(${measure.toString()})(${JSON.stringify(turnKey)}, ${JSON.stringify(state)}, ${width})`))
      }
    }
    await evaluate(cdp, `document.querySelector('[data-turn-key="${turnKey}"] .turn-action-controls > div').style.removeProperty('width')`)
  }
  await evaluate(cdp, `(() => {
    document.activeElement?.blur();
    const row = document.querySelector('[data-turn-key="turn-long"] .turn-action-controls > div');
    row.style.width = '640px';
    row.scrollIntoView({block:'center'});
  })()`)
  const screenshotPath = process.env.CCS_LAYOUT_SCREENSHOT
  if (screenshotPath) {
    if (!path.isAbsolute(screenshotPath)) throw new Error('CCS_LAYOUT_SCREENSHOT 必须是绝对路径')
    const screenshot = await cdp.call('Page.captureScreenshot', {format:'png', captureBeyondViewport:false})
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'))
  }
  return measurements
}
