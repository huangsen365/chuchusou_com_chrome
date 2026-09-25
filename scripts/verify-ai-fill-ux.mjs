#!/usr/bin/env node
/**
 * AI prompt 自动填充 UX 回归（headless Chrome 素页 + 注入 content.js/toast.js）
 *
 * 用户实报的两类现象（2026-06）：
 *  1. Yiyan：长提示词填充后点击发送"没反应"，字符留在输入框 ——
 *     根因 a) 填充完成 toast 固定 bottom-right + z-index 最大且**不可点透**，
 *     恰好罩住各家 AI 都放在右下角的发送按钮，3 秒内的点击全被吞；
 *     根因 b) push/pull 双投递的"巩固重填"会在用户发送后把旧 prompt 写回输入框。
 *  2. Claude：填充提示气泡在视觉上挡住发送按钮（同一个 toast）。
 *
 * 断言（修复前会挂）：
 *  A. 填充完成 toast 必须在页面**上半部**且 pointer-events 可穿透；
 *     发送按钮中心 elementFromPoint 必须是按钮本身；点击必须真的把内容发出去
 *  B. 模拟"用户已发送并开始打新草稿"后，同一 pendingId 的第二次投递
 *     **不得**把旧 prompt 写回（残缺子串守卫）
 *  C. Lexical 式 revert（内容退化为 prompt 残缺版）时巩固重填仍然生效
 *  D. 受控编辑器（仅 input 事件同步内部 model）在填充后 model 必须等于 prompt
 *     （发送按钮可用性的代理指标 —— 框架态没同步就是"点了发送但发出去是空"）
 *  E. Yiyan 类 IME 编辑器如果要到第二次 compositionend 才提交 model，
 *     填充完成时就必须预同步，用户第一次点发送应成功；更顽固的编辑器仍由
 *     驻留侦测器兜底二次发送。
 *
 * 跳过条件与其它 Chrome 校验一致：无全局 WebSocket / 无 Chrome。
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { spawn } from "node:child_process"
import {
  hasWebSocket, findChrome, waitForDevToolsPort, connectWebSocket, CdpClient, evaluate
} from "./lib/cdp.mjs"

const root = process.cwd()
const TAG = "[verify-ai-fill-ux]"

async function verifyChatGptComposerSelection(cdp, contentSource) {
  // Use the real browser's selector/visibility/event behavior, but fulfill the
  // navigation locally: this fixture never reads or submits a real conversation.
  const fixtureUrl = "https://chatgpt.com/?q=ccs-composer-fixture"
  let interceptionError
  cdp.on("Fetch.requestPaused", ({ requestId }) => {
    cdp.call("Fetch.fulfillRequest", {
      requestId,
      responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "text/html; charset=utf-8" }],
      body: Buffer.from("<!doctype html><html><body></body></html>").toString("base64")
    }).catch((error) => { interceptionError = error })
  })
  await cdp.call("Fetch.enable", { patterns: [{ urlPattern: "https://chatgpt.com/*" }] })
  await cdp.call("Page.navigate", { url: fixtureUrl })
  await evaluate(cdp, `new Promise((resolve) => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', resolve, { once: true });
    else resolve();
  })`)
  if (interceptionError) throw interceptionError

  const results = await evaluate(cdp, `
    (async () => {
      window.chrome = {
        storage: { local: { get: (_keys, cb) => cb({ ccs_debug: false }), set() {} } },
        runtime: { id: 'test-extension', onMessage: { addListener() {} }, sendMessage: (_message, cb) => cb?.({ ok: false }) }
      };
      ${contentSource}
      const prompt = 'ChatGPT composer compatibility test.\\nSecond paragraph with a unique ending.';
      const writingDraft = 'Existing article content must remain unchanged.';
      const setup = (composerMarkup) => {
        document.body.innerHTML =
          '<input type="search" aria-label="Search chats" value="existing search">' +
          '<div class="writing-block-editor"><div class="ProseMirror" contenteditable="true" role="textbox" aria-label="Start writing">' + writingDraft + '</div></div>' +
          '<div hidden><textarea id="prompt-textarea">hidden compatibility field</textarea></div>' +
          '<form data-chatgpt-composer hidden><div data-composer-markdown contenteditable="true" role="textbox">hidden composer</div></form>' +
          composerMarkup;
      };
      const untouched = () =>
        document.querySelector('.writing-block-editor').textContent === writingDraft &&
        document.querySelector('input[type="search"]').value === 'existing search' &&
        document.querySelector('#prompt-textarea').value === 'hidden compatibility field' &&
        document.querySelector('form[hidden]').textContent === 'hidden composer';
      const fill = () => window.CCSModules.AIPromptFill.fill(prompt, { attempts: 1, watchSendResidue: false });
      const results = {};

      // Captured 2026-09 DOM: both writing blocks and the thread composer are
      // editable, with writing blocks occurring first in document order.
      setup('<form data-chatgpt-composer data-composer-placement="thread"><div id="actual-composer" data-composer-markdown contenteditable="true" role="textbox" aria-label="Ask ChatGPT"></div></form>');
      let model = '';
      const actual = document.querySelector('#actual-composer');
      actual.addEventListener('input', () => { model = actual.innerText; });
      const modern = await fill();
      results.modern = modern.ok && actual.innerText.includes('unique ending.') && model.includes('unique ending.') && untouched();

      actual.textContent = 'User draft waiting to be sent.';
      const protectedDraft = await fill();
      results.draft = protectedDraft.stage === 'existing_draft' && actual.textContent === 'User draft waiting to be sent.' && untouched();

      setup('<form><div id="actual-composer" data-testid="prompt-textarea" contenteditable="true" role="textbox"></div></form>');
      const legacy = await fill();
      results.legacy = legacy.ok && document.querySelector('#actual-composer').innerText.includes('unique ending.') && untouched();

      setup('<form><div id="prompt-textarea" contenteditable="true" role="textbox" aria-label="Chat with ChatGPT"></div></form>');
      const legacyId = await fill();
      results.legacyId = legacyId.ok && document.querySelector('form > #prompt-textarea').innerText.includes('unique ending.') && untouched();

      // When only an article editor/search is mounted during a route change,
      // retry later instead of writing a prompt into either of those controls.
      setup('');
      const absent = await fill();
      results.absent = absent.error === 'composer-not-found' && untouched();

      // Message editors and alternate writing-block wrappers must stay intact
      // even when the main composer is unmounted or temporarily unavailable.
      for (const boundary of [
        'data-testid="chatgpt-writing-block"', 'data-oai-writing-block-surface',
        'data-message-author-role="user"', 'data-chatgpt-search-unit-key="user-message"'
      ]) {
        setup('<section ' + boundary + '><div contenteditable="true" role="textbox">User edit in progress.</div><textarea>Article draft.</textarea></section>');
        const excluded = await fill();
        results[boundary] = excluded.error === 'composer-not-found' && untouched() &&
          document.querySelector('section [contenteditable]').textContent === 'User edit in progress.' &&
          document.querySelector('section textarea').value === 'Article draft.';
      }
      return results;
    })()
  `, { timeoutMs: 30_000 })
  for (const [scenario, passed] of Object.entries(results)) {
    if (!passed) throw new Error(`ChatGPT composer selection failed: ${scenario} — ${JSON.stringify(results)}`)
  }
  await cdp.call("Fetch.disable")
}

async function main() {
  if (!hasWebSocket()) {
    console.warn(`${TAG} ⚠ SKIPPED — 此 Node 版本无全局 WebSocket（需 Node 21+）`)
    return
  }
  let chrome
  try {
    chrome = findChrome()
  } catch (err) {
    console.warn(`${TAG} ⚠ SKIPPED — ${err.message}`)
    return
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccs-ai-fill-"))
  const child = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] })

  let cdp
  try {
    const port = await waitForDevToolsPort(userDataDir, child)
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
    const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl)
    if (!page) throw new Error("No page target found")
    cdp = new CdpClient(await connectWebSocket(page.webSocketDebuggerUrl))
    await cdp.call("Runtime.enable")
    await cdp.call("Page.enable")

    const toastSource = fs.readFileSync(path.join(root, "modules/toast.js"), "utf8")
    const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8")

    const expression = `
      (async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const R = {};

        // ===== 模拟 AI 站点 DOM：底部输入框 + 右下角发送按钮（各家通用布局）=====
        document.title = 'AI Fill UX Harness';
        document.body.innerHTML = '';
        const editor = document.createElement('div');
        editor.id = 'ed';
        editor.setAttribute('contenteditable', 'true');
        editor.setAttribute('role', 'textbox');
        editor.style.cssText = 'position:fixed;left:20px;right:100px;bottom:24px;height:120px;border:1px solid #888;overflow:auto;white-space:pre-wrap;';
        const send = document.createElement('button');
        send.id = 'send';
        send.textContent = '发送';
        send.style.cssText = 'position:fixed;right:24px;bottom:24px;width:56px;height:40px;';
        const form = document.createElement('form');
        form.addEventListener('submit', (event) => event.preventDefault());
        form.append(editor, send);
        document.body.append(form);

        // 受控编辑器模型：只有真正的 input 事件才同步（模拟 React/Lexical controlled state）
        window.__model = '';
        editor.addEventListener('input', () => { window.__model = editor.textContent || ''; });
        // 发送行为：读"框架模型"（不是 DOM！），清空编辑器 —— 模拟真实站点
        window.__sent = [];
        send.addEventListener('click', () => {
          window.__sent.push(window.__model);
          editor.replaceChildren();
          window.__model = '';
        });

        // ===== stub chrome =====
        window.__msgs = [];
        window.__listeners = [];
        window.__storageWrites = [];
        window.chrome = {
          storage: { local: { get: (_k, cb) => cb({ ccs_debug: false }), set: (items, cb) => { window.__storageWrites.push(items); if (cb) cb(); } } },
          runtime: {
            id: 'test-extension',
            lastError: undefined,
            sendMessage: (msg, cb) => { window.__msgs.push(msg); if (cb) cb({ ok: true }); },
            onMessage: { addListener: (fn) => { window.__listeners.push(fn); } }
          }
        };

        ${toastSource}
        ${contentSource}
        await wait(80);
        const deliver = (text, pendingId) =>
          window.__listeners[window.__listeners.length - 1]({ action: 'ccsFillAIPrompt', text, pendingId }, {}, () => {});

        const MARK1 = '真实长提示词标记甲';
        const P1 = '请基于以下主题生成内容：' + MARK1 + '\\n' + '细节要求行。'.repeat(40) + '\\n收尾行标记乙';

        // ===== 场景 A + D：填充 → toast 位置/可穿透 → 模型同步 → 点击发送真的发出去 =====
        deliver(P1, 'pendcase0001');
        await wait(1600); // fill + stabilize(120/350/700) + toast

        const toastEl = Array.from(document.querySelectorAll('body > div, body > .ccs-toast'))
          .find((el) => (el.textContent || '').includes('已自动补充完整提示词'));
        R.toastFound = !!toastEl;
        if (toastEl) {
          const tr = toastEl.getBoundingClientRect();
          R.toastInTopHalf = tr.top >= 0 && tr.top < window.innerHeight / 2;
          const atToast = document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2);
          R.toastClickThrough = atToast !== toastEl && !toastEl.contains(atToast);
        }
        const br = send.getBoundingClientRect();
        const atButton = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
        R.sendButtonReachable = atButton === send;
        R.modelSynced = (window.__model || '').includes(MARK1); // 场景 D
        R.editorFilled = (editor.textContent || '').includes(MARK1);

        // 用户点击发送（打在按钮中心坐标上的元素 —— 修复前这里是 toast）
        if (atButton) atButton.click();
        await wait(50);
        R.sentCount = window.__sent.length;
        R.sentHasMark = !!window.__sent[0] && window.__sent[0].includes(MARK1);
        R.editorClearedAfterSend = (editor.textContent || '') === '';

        // ===== 场景 B：发送后用户打新草稿，同 pendingId 二次投递不得写回旧 prompt =====
        editor.focus();
        document.execCommand('insertText', false, '用户新草稿123');
        deliver(P1, 'pendcase0001');
        await wait(1600);
        R.draftPreserved = (editor.textContent || '') === '用户新草稿123';

        // ===== 场景 C：Lexical 式 revert（退化为残缺版）→ 巩固重填仍生效 =====
        editor.replaceChildren();
        const MARK2 = '第二份提示词标记丙';
        const P2 = '另一个任务：' + MARK2 + '\\n' + '正文行。'.repeat(30) + '\\n末行标记丁';
        deliver(P2, 'pendcase0002');
        await wait(1600);
        // 模拟编辑器 reconcile 把内容退化成"前几行"（真实 Lexical revert 丢的是
        // 后续段落，行内分隔符保留 —— 用 insertText 保住换行结构）
        const mangled = P2.split('\\n').slice(0, 2).join('\\n');
        editor.replaceChildren();
        editor.focus();
        document.execCommand('insertText', false, mangled);
        deliver(P2, 'pendcase0002');
        await wait(1600);
        R.revertRestored = (editor.textContent || '').includes('末行标记丁');

        // ===== 场景 E1：Yiyan 类编辑器（内部 model 需要第 2 次 compositionend
        //        才同步）。填充完成时应该已经预同步，首次发送成功。
        document.body.innerHTML = '';
        const ed2 = document.createElement('div');
        ed2.setAttribute('contenteditable', 'true');
        ed2.setAttribute('role', 'textbox');
        ed2.style.cssText = 'position:fixed;left:20px;right:100px;bottom:24px;height:120px;border:1px solid #888;white-space:pre-wrap;';
        const send2 = document.createElement('button');
        send2.textContent = '发送';
        send2.style.cssText = 'position:fixed;right:24px;bottom:24px;width:56px;height:40px;';
        const form2 = document.createElement('form');
        form2.addEventListener('submit', (event) => event.preventDefault());
        form2.append(ed2, send2);
        document.body.append(form2);
        let model2 = '';
        let compCount = 0;
        ed2.addEventListener('compositionend', () => { compCount++; if (compCount >= 2) model2 = ed2.textContent || ''; });
        window.__sent2 = [];
        send2.addEventListener('click', () => {
          if (!model2) return; // 站点：内部 state 为空 → 发送无效，什么都不做
          window.__sent2.push(model2);
          ed2.replaceChildren();
          model2 = '';
        });

        const MARK3 = '顽固编辑器标记戊';
        const P3 = '第三个任务：' + MARK3 + '\\n' + '正文。'.repeat(25) + '\\n末行标记己';
        deliver(P3, 'pendcase0003');
        await wait(1600);
        R.e_filled = (ed2.textContent || '').includes(MARK3);
        R.e_modelSyncedBeforeFirstSend = (model2 || '').includes(MARK3);

        send2.click(); // 用户第一次点发送 —— 应成功
        await wait(80);
        R.e_firstClickSent = window.__sent2.length === 1 && window.__sent2[0].includes(MARK3);
        R.e_editorClearedAfterFirst = (ed2.textContent || '') === '';

        // ===== 场景 E2：更顽固的编辑器（第 3 次 compositionend 才同步）。
        //        预同步仍不够时，驻留侦测器应介入：首次发送无效 → 提示再点 → 二次成功。
        document.body.innerHTML = '';
        const ed3 = document.createElement('div');
        ed3.setAttribute('contenteditable', 'true');
        ed3.setAttribute('role', 'textbox');
        ed3.style.cssText = 'position:fixed;left:20px;right:100px;bottom:24px;height:120px;border:1px solid #888;white-space:pre-wrap;';
        const send3 = document.createElement('button');
        send3.textContent = '发送';
        send3.style.cssText = 'position:fixed;right:24px;bottom:24px;width:56px;height:40px;';
        const form3 = document.createElement('form');
        form3.addEventListener('submit', (event) => event.preventDefault());
        form3.append(ed3, send3);
        document.body.append(form3);
        let model3 = '';
        let compCount3 = 0;
        ed3.addEventListener('compositionend', () => { compCount3++; if (compCount3 >= 3) model3 = ed3.textContent || ''; });
        window.__sent3 = [];
        send3.addEventListener('click', () => {
          if (!model3) return;
          window.__sent3.push(model3);
          ed3.replaceChildren();
          model3 = '';
        });

        const MARK4 = '超顽固编辑器标记庚';
        const P4 = '第四个任务：' + MARK4 + '\\n' + '正文。'.repeat(25) + '\\n末行标记辛';
        deliver(P4, 'pendcase0004');
        await wait(1600);
        R.f_filled = (ed3.textContent || '').includes(MARK4);
        R.f_modelDesyncedAtFirst = !model3;

        // 非发送控件、其他表单的发送、中文选词 Enter 都不应触发再同步或诊断。
        const diagCount = () => window.__storageWrites.filter((w) => Array.isArray(w.ccs_aifill_diag)).length;
        const beforeIgnored = diagCount();
        for (const label of ['选择模型', '添加附件', '复制', '分享']) {
          const control = document.createElement('button');
          control.type = 'button';
          control.textContent = label;
          form3.append(control);
          control.click();
          control.remove();
        }
        const otherForm = document.createElement('form');
        otherForm.innerHTML = '<button type="button" aria-label="Send message">Send message</button>';
        document.body.append(otherForm);
        otherForm.firstChild.click();
        ed3.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
        ed3.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true }));
        ed3.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
        ed3.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true }));
        send3.setAttribute('aria-disabled', 'true');
        send3.click();
        send3.removeAttribute('aria-disabled');
        await wait(1800);
        R.f_ignoredGestures = diagCount() === beforeIgnored && !model3 && compCount3 === 2;
        if (!R.f_ignoredGestures) throw new Error('非发送操作触发了驻留诊断或编辑器再同步');

        send3.click();
        await wait(80);
        R.f_firstClickNoSend = window.__sent3.length === 0;
        await wait(2200); // 驻留侦测器 1.6s 后介入：再同步 + 提示 + 诊断

        R.f_modelAfterResync = (model3 || '').includes(MARK4);
        const retryToast = Array.from(document.querySelectorAll('body > div, body > .ccs-toast'))
          .find((el) => (el.textContent || '').includes('请先确认是否已发送'));
        R.f_retryToastShown = !!retryToast;
        R.f_diagWritten = window.__storageWrites.some((w) =>
          Array.isArray(w.ccs_aifill_diag) && w.ccs_aifill_diag.some((d) => d.kind === 'residue-after-send' && d.fillMethod && d.gesture === 'send-button'));

        send3.click(); // 用户第二次点发送 —— 应成功
        await wait(80);
        R.f_sentFinally = window.__sent3.length === 1 && window.__sent3[0].includes(MARK4);
        R.f_editorClearedFinally = (ed3.textContent || '') === '';

        // 发送后站点仍在处理、输入框被替换，或用户正在编辑，都不能触发旧任务补救。
        for (const scenario of ['processing', 'replaced', 'edited', 'enter']) {
          document.body.innerHTML = '';
          const currentForm = document.createElement('form');
          currentForm.addEventListener('submit', (event) => event.preventDefault());
          currentForm.innerHTML = '<div contenteditable="true" role="textbox" style="min-height:40px"></div><button type="button" data-testid="send-button" aria-label="Send prompt"><span>↑</span></button>';
          document.body.append(currentForm);
          const currentEditor = currentForm.firstElementChild;
          const currentSend = currentForm.lastElementChild;
          const scenarioPrompt = '发送诊断回归：' + scenario + '。正文。'.repeat(30);
          await window.CCSModules.AIPromptFill.fill(scenarioPrompt);
          let resyncs = 0;
          currentEditor.addEventListener('input', () => { resyncs++; });
          const before = diagCount();
          if (scenario === 'enter' || scenario === 'processing') {
            currentEditor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          } else {
            currentSend.firstElementChild.click();
          }
          if (scenario === 'processing') currentSend.disabled = true;
          if (scenario === 'replaced') {
            const replacement = currentEditor.cloneNode(true);
            replacement.addEventListener('input', () => { resyncs++; });
            currentEditor.replaceWith(replacement);
          }
          if (scenario === 'edited') currentEditor.append(document.createTextNode('用户新补充的要求'));
          await wait(1800);
          R['residue_' + scenario] = scenario === 'enter'
            ? diagCount() === before + 1 && resyncs === 1 && window.__storageWrites.at(-1).ccs_aifill_diag[0].gesture === 'composer-enter'
            : diagCount() === before && resyncs === 0;
        }

        return R;
      })()
    `

    // 整套场景链在单次 evaluate 内运行 ~15s，放宽单调用超时
    const r = await evaluate(cdp, expression, { timeoutMs: 90_000 })
    const expect = (cond, label) => {
      if (!cond) throw new Error(`${label} — 结果: ${JSON.stringify(r)}`)
    }
    expect(r.toastFound, "填充完成 toast 未出现")
    expect(r.toastInTopHalf, "A: toast 应在页面上半部（远离发送按钮）")
    expect(r.toastClickThrough, "A: toast 必须 pointer-events 可穿透")
    expect(r.sendButtonReachable, "A: 发送按钮中心被遮挡（elementFromPoint 不是按钮）")
    expect(r.modelSynced, "D: 受控编辑器 model 未同步（点发送会发出空内容）")
    expect(r.editorFilled, "填充内容未落进编辑器")
    expect(r.sentCount === 1 && r.sentHasMark, "A: 点击发送没有把填充内容发出去")
    expect(r.editorClearedAfterSend, "A: 发送后编辑器应被站点清空")
    expect(r.draftPreserved, "B: 二次投递把旧 prompt 写回，覆盖了用户新草稿")
    expect(r.revertRestored, "C: revert 残缺后巩固重填未恢复完整 prompt")
    expect(r.e_filled && r.e_modelSyncedBeforeFirstSend, "E1: Yiyan 类编辑器填充后 model 未预同步")
    expect(r.e_firstClickSent && r.e_editorClearedAfterFirst, "E1: Yiyan 类编辑器首次发送未成功")
    expect(r.f_filled && r.f_modelDesyncedAtFirst, "E2: 超顽固编辑器前置条件不成立（填充/脱钩模拟失败）")
    expect(r.f_ignoredGestures, "非发送按钮、输入法选词和换行不应触发驻留诊断")
    expect(r.f_firstClickNoSend, "E2: 脱钩状态下首次发送本应无效")
    expect(r.f_modelAfterResync, "E2: 驻留侦测器未完成内部状态再同步")
    expect(r.f_retryToastShown, "E2: 未提示用户先确认发送结果")
    expect(r.f_diagWritten, "E2: 诊断记录（含 fillMethod）未写入 storage")
    expect(r.f_sentFinally && r.f_editorClearedFinally, "E2: 再同步后的第二次发送未成功")
    for (const scenario of ['processing', 'replaced', 'edited', 'enter']) {
      expect(r['residue_' + scenario], '发送驻留诊断场景失败: ' + scenario)
    }

    await verifyChatGptComposerSelection(cdp, contentSource)
    console.log(`${TAG} OK — toast 顶部可穿透 / 发送可达 / model 同步 / 发送真出 / 新草稿不被写回 / revert 巩固恢复 / Yiyan 预同步首发成功 / 顽固编辑器驻留自愈 / ChatGPT 新旧输入框定位与正文隔离`)
  } finally {
    cdp?.close()
    child.kill("SIGKILL")
    await new Promise((resolve) => setTimeout(resolve, 200))
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`${TAG} FAIL ${error?.message || error}`)
  process.exit(1)
})
