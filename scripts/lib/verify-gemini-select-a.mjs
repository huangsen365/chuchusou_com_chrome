import { evaluate } from "./cdp.mjs"

// Gemini 速答回复的最小夹具（2026-10 真实页面结构）：<model-response> 正文在 message-content 的
// .markdown（生成中 aria-busy="true"）；writing block 落成 <code-block>，头部 .code-block-decoration 有
// 「Plaintext」标签和复制按钮；整条回复的复制按钮是 <message-actions> 里的 <copy-button>。
// A/B 两行在同一个 <p> 里用真实换行分隔（Gemini 用 pre-wrap 渲染，不是 <br>）。
export function geminiSelectAFixture() {
  const codeBlock = (text) => `<response-element class="no-md md-has-block-component"><code-block><div class="code-block">
      <div class="formatted-code-block-internal-container"><div class="animated-opacity">
        <div class="code-block-decoration header-formatted"><span>Plaintext</span><div class="buttons">
          <gem-icon-button arialabel="Download code"><button aria-label="Download code"><mat-icon fonticon="download">download</mat-icon></button></gem-icon-button>
          <gem-icon-button arialabel="Copy code"><button aria-label="Copy code"><mat-icon fonticon="content_copy">content_copy</mat-icon></button></gem-icon-button>
        </div></div>
        <pre><code role="text" data-test-id="code-content" class="code-container formatted">${text}</code></pre>
      </div></div></div></code-block></response-element>`
  const actions = `<div class="response-container-footer"><message-actions class="hide-on-print"><div class="actions-container-v2"><div class="buttons-container-v2">
      <gem-icon-button arialabel="Good response"><button aria-label="Good response">👍</button></gem-icon-button>
      <gem-icon-button arialabel="Redo"><button aria-label="Redo">↻</button></gem-icon-button>
      <copy-button><gem-icon-button arialabel="Copy"><button aria-label="Copy">⧉</button></gem-icon-button></copy-button>
      <gem-icon-button arialabel="Show more options"><button aria-label="Show more options">⋮</button></gem-icon-button>
    </div></div></message-actions></div>`
  const response = (id, body, busy = "false") => `<div class="conversation-container" id="${id}">
      <user-query><div class="query-text">请针对以下主题生成回答：夹具主题</div></user-query>
      <model-response><div class="response-container">
        <message-content><div class="markdown markdown-main-panel" aria-busy="${busy}" style="white-space:pre-wrap">${body}</div></message-content>
        ${actions}
      </div></model-response>
    </div>`
  const choices = "A：是否继续生成详细内容？\nB：是否需要将【短篇回答】和【中篇回答】改得更口语、更有活人感？"
  const fastAnswer = `<p>【短篇回答】</p>${codeBlock("这是 Gemini 代码块里的短篇回答。")}<p>【中篇回答】</p>${codeBlock("这是 Gemini 代码块里的中篇回答。")}<p id="gemini-choices">${choices}</p>`
  return `<!doctype html><meta charset="utf-8"><title>Gemini select-A fixture</title>
    <style>
      body { font: 16px/1.5 system-ui; }
      .buttons-container-v2 { display: flex; align-items: center; }
      .ql-editor { width: 720px; min-height: 120px; border: 1px solid #999; white-space: pre-wrap; }
    </style>
    <main>
      ${response("gemini-fast", fastAnswer)}
      ${response("gemini-plain", "<p>这是一条普通回答，没有速答结构。</p>")}
      ${response("gemini-streaming", fastAnswer.replace('id="gemini-choices"', ""), "true")}
    </main>
    <rich-textarea><div class="ql-editor ql-blank" contenteditable="true" role="textbox" aria-label="Enter a prompt for Gemini"><p><br></p></div></rich-textarea>
    <button class="send-button" type="button" aria-label="Send message">Send</button>
    <script>
      window.__geminiSends = 0
      document.querySelector('.send-button').addEventListener('click', () => { window.__geminiSends += 1 })
    </script>`
}

export async function verifyGeminiSelectA(cdp) {
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
    const button = () => turn('gemini-fast').querySelector(marker)
    const composer = document.querySelector('rich-textarea .ql-editor')

    await waitFor(() => button(), 'Gemini 速答回复没有出现选A按钮')
    assert(button().previousElementSibling?.tagName === 'COPY-BUTTON', '选A按钮没有紧跟在整条回复的复制按钮后面')
    assert(!button().closest('code-block'), '选A按钮跑进了代码块')
    assert(!turn('gemini-plain').querySelector(marker), '普通回答不该有选A按钮')
    assert(!turn('gemini-streaming').querySelector(marker), '生成中的回复不该有选A按钮')
    assert(document.querySelectorAll(marker).length === 1, '选A按钮重复')

    // 生成结束（aria-busy 翻成 false）后按钮出现
    turn('gemini-streaming').querySelector('.markdown').setAttribute('aria-busy', 'false')
    await waitFor(() => turn('gemini-streaming').querySelector(marker), '生成结束后没有出现选A按钮')
    turn('gemini-streaming').remove()

    // A/B 不完整 → 按钮撤掉；恢复 → 回来
    const choices = document.getElementById('gemini-choices')
    const valid = choices.textContent
    choices.textContent = 'A：是否继续生成详细内容？\nB：普通的不完整选项。'
    await waitFor(() => !button(), '不完整 A/B 仍保留选A按钮')
    choices.textContent = valid
    await waitFor(() => button(), '恢复完整 A/B 后选A按钮没有回来')

    // 底栏重绘（Angular 重建 message-actions）→ 按钮回到复制按钮后面
    const footer = turn('gemini-fast').querySelector('message-actions')
    const rebuilt = footer.cloneNode(true)
    rebuilt.querySelectorAll(marker).forEach((node) => node.remove())
    footer.replaceWith(rebuilt)
    await waitFor(() => button()?.previousElementSibling?.tagName === 'COPY-BUTTON' && rebuilt.contains(button()), '底栏重绘后选A按钮没有恢复')

    // 点击 → 改写提示词进 Gemini 输入框，不自动发送
    button().click()
    await waitFor(() => (composer.innerText || '').includes('原始素材参考本次对话上下文。'), 'Gemini 输入框没有填入完整选A改写提示词', 8000)
    const filled = composer.innerText
    assert(filled.startsWith('选A并且按照提示词改写：'), 'Gemini 输入框缺少选A指令')
    assert(filled.includes('# 通用「GPT-4.5 感」原始素材深度改写提示词'), 'Gemini 输入框缺少改写模板')
    assert(!/\$\{[A-Za-z]+\}/.test(filled), 'Gemini 填入残留提示词变量')
    assert(window.__geminiSends === 0, '选A自动发送了提示词')
    await waitFor(() => !button().disabled, '填入后选A按钮没有恢复', 6000)

    // 输入框已有草稿 → 不覆盖
    composer.textContent = 'Gemini 页面里尚未发送的草稿。'
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: composer.textContent }))
    button().click()
    await waitFor(() => button().textContent.includes('填入失败'), 'Gemini 输入框有草稿时没有拒绝覆盖')
    assert(composer.textContent === 'Gemini 页面里尚未发送的草稿。' && window.__geminiSends === 0, 'Gemini 草稿被覆盖或被发送')
    return { ok: true }
  }).toString()})()`, { timeoutMs: 30_000 })
}
