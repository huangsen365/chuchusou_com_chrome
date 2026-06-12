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
        document.body.append(editor, send);

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

        // ===== 场景 E：顽固编辑器（内部 model 与 DOM 脱钩，仅第 2 次 compositionend
        //        才同步 —— 模拟 Yiyan"DOM 有字、state 空、点发送无效"）
        //        期望：首次发送无效 → 驻留侦测器再同步 + 提示 → 第二次发送成功
        document.body.innerHTML = '';
        const ed2 = document.createElement('div');
        ed2.setAttribute('contenteditable', 'true');
        ed2.setAttribute('role', 'textbox');
        ed2.style.cssText = 'position:fixed;left:20px;right:100px;bottom:24px;height:120px;border:1px solid #888;white-space:pre-wrap;';
        const send2 = document.createElement('button');
        send2.textContent = '发送';
        send2.style.cssText = 'position:fixed;right:24px;bottom:24px;width:56px;height:40px;';
        document.body.append(ed2, send2);
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
        R.e_modelDesyncedAtFirst = !model2; // 第一次填充后 model 应仍为空（脱钩成立）

        send2.click(); // 用户第一次点发送 —— 无效
        await wait(80);
        R.e_firstClickNoSend = window.__sent2.length === 0;
        await wait(2200); // 驻留侦测器 1.6s 后介入：再同步 + 提示 + 诊断

        R.e_modelAfterResync = (model2 || '').includes(MARK3);
        const retryToast = Array.from(document.querySelectorAll('body > div, body > .ccs-toast'))
          .find((el) => (el.textContent || '').includes('请再点一次发送'));
        R.e_retryToastShown = !!retryToast;
        R.e_diagWritten = window.__storageWrites.some((w) =>
          Array.isArray(w.ccs_aifill_diag) && w.ccs_aifill_diag.some((d) => d.kind === 'residue-after-send' && d.fillMethod));

        send2.click(); // 用户第二次点发送 —— 应成功
        await wait(80);
        R.e_sentFinally = window.__sent2.length === 1 && window.__sent2[0].includes(MARK3);
        R.e_editorClearedFinally = (ed2.textContent || '') === '';

        return R;
      })()
    `

    const r = await evaluate(cdp, expression)
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
    expect(r.e_filled && r.e_modelDesyncedAtFirst, "E: 顽固编辑器前置条件不成立（填充/脱钩模拟失败）")
    expect(r.e_firstClickNoSend, "E: 脱钩状态下首次发送本应无效")
    expect(r.e_modelAfterResync, "E: 驻留侦测器未完成内部状态再同步")
    expect(r.e_retryToastShown, "E: 未提示用户'请再点一次发送'")
    expect(r.e_diagWritten, "E: 诊断记录（含 fillMethod）未写入 storage")
    expect(r.e_sentFinally && r.e_editorClearedFinally, "E: 再同步后的第二次发送未成功")

    console.log(`${TAG} OK — toast 顶部可穿透 / 发送可达 / model 同步 / 发送真出 / 新草稿不被写回 / revert 巩固恢复 / 顽固编辑器驻留自愈（侦测→再同步→提示→二次发送成功）`)
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
