import { evaluate } from "./cdp.mjs"

// 在真实扩展夹具里切换文章容器，之后由主冒烟脚本点击 X / 封面验证完整投递。
export async function verifyPlainArticleActions(cdp) {
  return evaluate(cdp, `(${(async function () {
    const message = document.querySelector('[data-message-id="assistant-long-rewrite-1"]')
    const turn = message.closest('[data-testid^="conversation-turn-"]')
    const writingBlock = message.querySelector('[data-testid="writing-block-container"]')
    const editor = writingBlock.querySelector('.ProseMirror')
    const article = document.createElement('div')
    article.className = 'markdown prose'
    article.innerHTML = editor.innerHTML
    const footer = document.createElement('div')
    footer.setAttribute('role', 'group')
    footer.innerHTML = '<button data-testid="copy-turn-action-button" aria-label="Copy response">Copy</button>'
    const actionsSelector = '[data-ccs-long-article-actions]'
    const actions = () => turn.querySelector(actionsSelector)
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const assert = (condition, label) => { if (!condition) throw new Error(label) }
    const waitFor = async (predicate, label) => {
      const until = Date.now() + 4500
      while (Date.now() < until) {
        if (predicate()) return
        await delay(50)
      }
      throw new Error(label)
    }
    const ready = () => actions()?.dataset.ccsLongArticleState === 'ready'
    const reset = () => {
      message.replaceChildren(article)
      article.innerHTML = editor.innerHTML
    }

    message.setAttribute('data-is-streaming', 'true')
    message.replaceChildren(article)
    turn.append(footer)
    await waitFor(() => actions()?.dataset.ccsLongArticleState === 'generating', '普通长文生成中缺少按钮等待态')
    assert(actions().previousElementSibling?.dataset.testid === 'copy-turn-action-button', '按钮未紧邻本条回复的复制按钮')
    assert(!message.contains(actions()), '普通长文按钮应在正文外的回复底栏')
    assert([...actions().querySelectorAll('button')].every((button) => button.disabled), '生成中的普通长文按钮可点击')
    message.removeAttribute('data-is-streaming')
    await waitFor(() => actions()?.dataset.ccsLongArticleState === 'settling', '普通长文缺少稳定等待态')
    await waitFor(ready, '普通长文完成后按钮未恢复')
    assert(turn.querySelectorAll(actionsSelector).length === 1, '切换容器后重复注入按钮')
    assert(actions().querySelectorAll('button').length === 2, '普通长文按钮数量不符')
    assert([...actions().querySelectorAll('button')].every((button) => !button.disabled), '完整普通长文按钮不可点击')

    // 同轮空消息可在正文前后移动；只要该轮仍在生成，就继续禁用动作。
    const empty = turn.querySelector('[data-message-id="assistant-long-empty-before"]')
    empty.setAttribute('data-is-streaming', 'true')
    await waitFor(() => actions()?.dataset.ccsLongArticleState === 'generating', '同轮空消息仍在生成时未禁用长文按钮')
    assert([...actions().querySelectorAll('button')].every((button) => button.disabled), '同轮生成状态未保护长文投递')
    empty.removeAttribute('data-is-streaming')
    message.after(empty)
    await waitFor(ready, '空消息移到正文后未恢复长文按钮')
    message.before(empty)
    await delay(100)
    assert(ready() && turn.querySelectorAll(actionsSelector).length === 1, '空消息移到正文前破坏长文识别')

    const secondArticle = message.cloneNode(true)
    turn.append(secondArticle)
    await waitFor(() => !actions(), '同轮两篇文章仍允许投递不明确的正文')
    secondArticle.remove()
    await waitFor(ready, '同轮恢复唯一文章后按钮没有恢复')

    // 空节点只在同轮内跳过，不能把其他轮的旧改写提示词当作来源。
    const unrelatedTurn = document.createElement('section')
    unrelatedTurn.setAttribute('data-testid', 'conversation-turn-unrelated')
    unrelatedTurn.innerHTML = '<div data-message-author-role="assistant"></div>'
    turn.before(unrelatedTurn)
    await waitFor(() => !actions(), '错误越过另一轮回复使用旧提示词')
    unrelatedTurn.remove()
    await waitFor(ready, '恢复相邻提示词后长文按钮没有恢复')

    // DOM 重渲染复制按钮、消息节点，以及 writing block / 普通回复互转。
    footer.firstElementChild.replaceWith(footer.firstElementChild.cloneNode(true))
    await waitFor(() => actions()?.previousElementSibling === footer.firstElementChild, '底栏重渲染后按钮未重新定位')
    const replacement = message.cloneNode(true)
    message.replaceWith(replacement)
    await waitFor(() => actions() && actions().dataset.ccsLongArticleState !== 'ready', '消息替换后遗留旧动作栏')
    await waitFor(ready, '消息替换后未重新识别文章')
    assert(turn.querySelectorAll(actionsSelector).length === 1, '消息替换后动作栏重复')
    replacement.replaceWith(message)
    await waitFor(() => actions() && !ready(), '原消息重新挂载后未更新动作栏')
    await waitFor(ready, '原消息重新挂载后按钮未就绪')
    message.replaceChildren(writingBlock)
    await waitFor(() => writingBlock.contains(actions()), 'writing block 恢复后按钮没有迁回块内')
    assert(turn.querySelectorAll(actionsSelector).length === 1, 'writing block 恢复后动作栏重复')
    reset()
    await waitFor(() => actions()?.parentElement === footer && ready(), '普通回复恢复后按钮没有迁回底栏')

    // 明确的工作流来源、唯一主标题和完整正文缺一不可。
    const user = document.querySelector('[data-message-id="user-long-rewrite-1"]')
    const prompt = user.textContent
    user.textContent = '请写一篇同样长度的普通回答。'
    await waitFor(() => !actions(), '普通聊天误出现长文动作')
    user.textContent = prompt
    await waitFor(ready, '恢复改写来源后未识别文章')
    article.querySelector('h1').remove()
    await waitFor(() => !actions(), '缺少标题的普通回复仍有动作栏')
    reset()
    article.append(article.querySelector('h1').cloneNode(true))
    await delay(100)
    assert(!actions(), '多个主标题被当成单篇文章')
    reset()
    article.querySelectorAll('p').forEach((node) => node.remove())
    await waitFor(() => actions()?.dataset.ccsLongArticleState === 'unavailable', '正文不足时未禁用动作')
    assert([...actions().querySelectorAll('button')].every((button) => button.disabled), '正文不足时仍能投递')
    message.replaceChildren(writingBlock.cloneNode(true), writingBlock.cloneNode(true))
    await waitFor(() => !actions(), '多个 writing block 被错误回退到普通回复')
    reset()
    await waitFor(ready, '边界场景后未恢复正常文章')

    // 副标题、加粗、链接继续交给后面的 X 精确写入断言；混入的控件必须排除。
    const ignoredControls = document.createElement('div')
    ignoredControls.setAttribute('role', 'toolbar')
    ignoredControls.textContent = '不应进入正文的工具栏标记'
    article.append(ignoredControls)
    article.insertAdjacentHTML('beforeend', '<button>不应进入正文的按钮标记</button>')
    assert(turn.querySelectorAll(actionsSelector).length === 1, '普通长文重复注入动作栏')

    window.__restoreLongWritingBlock = () => {
      message.replaceChildren(writingBlock)
      footer.remove()
    }
    return { title: article.querySelector('h1').textContent, actions: actions().querySelectorAll('button').length }
  }).toString()})()`, { timeoutMs: 30_000 })
}
