#!/usr/bin/env node
/**
 * 扩展冒烟回归（真实 Chrome 加载 build 产物）
 *
 * 历史上最严重的发布事故类别是"装上后 Service Worker 直接挂"（漏复制目录 /
 * importScripts 顺序错 / 顶层 ReferenceError）。静态校验（verify-sw-bridge 等）
 * 只能保证文件齐全和列表一致，保证不了 SW 真的能跑起来。
 *
 * 本校验用 headless Chrome 把 build/chrome-mv3-prod 当真扩展装载，断言：
 *  1. 扩展 SW 成功启动（CDP 能发现 service_worker target）
 *  2. SW 启动过程零未捕获异常
 *  3. importScripts 桥接完成：MenuSystem / createContextMenus / getPopupMenuStructure
 *     等关键 globalThis 符号就位
 *  4. 消息/端口/动作协议活着（events.js 回归路径，逐步向 ≥20 路径推进）：
 *     getMenuStructure（≥3 分组）/ getKeyword / ccsDiagPing（版本一致）/
 *     getMenuDebugInfo / sidepanel-alive port 生命周期（onConnect）/
 *     selectionChanged → getKeyword 选区回路（由真实选区捕获路径承担）/ executeMenuAction search
 *     真开新标签且 URL 走 SSoT 模板 / 百度 wd= URL 关键字提取 /
 *     ccs_kw_ storage 即时缓存写入契约 / 真实选区捕获（本地 HTTP 页 +
 *     trusted 三连击 → content.js → SW）/ 右键菜单动态标题（contextMenus.update
 *     间谍断言标题随选区更新）/ popup + sidepanel UI 启动渲染
 *
 * 优雅跳过条件（不 brick npm test 链）：无全局 WebSocket（Node 21+ 才有）/
 * 找不到 Chrome / build 目录不存在。跳过时打 ⚠ 警告；真跑挂了则硬性报错。
 */

import fs from "node:fs"
import http from "node:http"
import https from "node:https"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { spawn } from "node:child_process"
import {
  hasWebSocket, findChrome, wait, waitForDevToolsPort, connectWebSocket, CdpClient, evaluate
} from "./lib/cdp.mjs"

const root = process.cwd()
const buildDir = path.join(root, "build/chrome-mv3-prod")
const TAG = "[verify-extension-smoke]"

function fail(msg) {
  // 抛错而不是 process.exit —— exit 会跳过 finally，留下僵尸 headless Chrome
  // 和未清理的临时 profile（实测踩过）。main().catch 统一打印并置退出码。
  throw new Error(msg)
}

async function findTarget(port, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => [])
    const hit = targets.find(predicate)
    if (hit) return hit
    await wait(200)
  }
  return null
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
  if (!fs.existsSync(path.join(buildDir, "manifest.json"))) {
    console.warn(`${TAG} ⚠ SKIPPED — build/chrome-mv3-prod 不存在（先跑 npm run plasmo:build）`)
    return
  }

  // ===== 本地服务器先于 Chrome 启动（resolver 规则需要端口）=====
  // 去外网化（hermetic）：把 www.baidu.com / chat.baidu.com / www.google.com 解析到本地 HTTPS
  // 服务器。CI 上百度反爬重定向 / 网络抖动曾让路径 9/12/16 随机红 ——
  // "真开标签"类断言只关心扩展行为，不应依赖外部网站的可用性。
  const noSelectionTitleKeyword = "无选区标题回退冒烟标记"
  const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    if ((req.url || "").startsWith("/title2")) {
      res.end(`<!doctype html><meta charset="utf-8"><title>标题先行刷新冒烟标记 - smoke</title>
        <p id="t" style="font-size:24px;margin:60px 20px">第二页正文</p>`)
      return
    }
    res.end(`<!doctype html><meta charset="utf-8"><title>${noSelectionTitleKeyword} - smoke</title>
      <p id="t" style="font-size:24px;margin:60px 20px">真实选区捕获冒烟标记</p>`)
  })
  await new Promise((res) => httpServer.listen(0, "127.0.0.1", res))
  const httpUrl = `http://127.0.0.1:${httpServer.address().port}/`

  const fixtureDir = path.join(root, "scripts/fixtures")
  const httpsServer = https.createServer({
    key: fs.readFileSync(path.join(fixtureDir, "ccs-test-key.pem")),
    cert: fs.readFileSync(path.join(fixtureDir, "ccs-test-cert.pem"))
  }, (req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    const hostname = String(req.headers.host || "").split(":")[0]
    if (hostname === "x.com") {
      if ((req.url || "").startsWith("/article-fastqa")) {
        res.end(`<!doctype html><meta charset="utf-8"><title>X article site-fastqa fixture</title>
          <article data-testid="tweet">
            <div data-testid="User-Name">夹具作者 @fixture</div>
            <article data-testid="twitterArticleReadView">
              <div data-testid="twitter-article-title">X 长文夹具标题</div>
              <div role="group">
                <div><button data-testid="reply" aria-label="回复">回复</button></div>
                <div><button aria-label="转发">转发</button></div>
                <div id="x-article-share-cell"><button aria-label="分享帖子">分享</button></div>
              </div>
              <div data-testid="twitterArticleRichTextView">
                <h2>第一节</h2><p>这是 X 长文第一段。</p><p>这是 X 长文第二段。</p>
              </div>
            </article>
            <a href="/fixture/status/123"><time>刚刚</time></a>
            <div role="group"><div><button data-testid="reply">底部回复</button></div></div>
          </article>`)
        return
      }
      res.end(`<!doctype html><meta charset="utf-8"><title>X site-fastqa fixture</title>
        <article data-testid="tweet">
          <div data-testid="tweetText">共享运行时 X 主推文正文。</div>
          <div role="group">
            <div><button data-testid="reply" aria-label="回复">回复</button></div>
            <div><button aria-label="转发">转发</button></div>
            <div id="x-share-cell"><button aria-label="分享帖子">分享</button></div>
          </div>
        </article>`)
      return
    }
    if (hostname === "www.zhihu.com") {
      res.end(`<!doctype html><meta charset="utf-8"><title>知乎回答 site-fastqa fixture</title>
        <main>
          <h1>怎样验证可扩展站点速答？</h1>
          <div class="ContentItem AnswerItem" itemprop="answer">
            <meta itemprop="url" content="https://www.zhihu.com/question/123/answer/456">
            <h2 class="ContentItem-title"><a href="/question/123/answer/456">怎样验证可扩展站点速答？</a></h2>
            <div class="AuthorInfo"></div>
            <div class="RichContent is-collapsed">
              <div class="RichContent-inner">
                <span class="RichText" itemprop="text">知乎回答折叠摘要。</span>
                <button class="ContentItem-more">阅读全文</button>
              </div>
              <div class="ContentItem-actions">
                <button aria-label="收藏">收藏</button>
                <div class="Popover ShareMenu ContentItem-action"><button>分享</button></div>
                <div class="Popover ContentItem-action"><button aria-label="更多"></button></div>
              </div>
            </div>
          </div>
        </main>
        <script>
          document.querySelector('.ContentItem-more').addEventListener('click', () => {
            const root = document.querySelector('.AnswerItem')
            root.querySelector('.RichContent').classList.remove('is-collapsed')
            root.querySelector('[itemprop="text"]').textContent = '知乎回答展开后的完整正文，用于验证状态恢复。'
            root.querySelector('.ContentItem-actions').outerHTML = '<div class="ContentItem-actions"><button aria-label="收藏">收藏</button><div class="Popover ShareMenu ContentItem-action"><button>分享</button></div><div class="Popover ContentItem-action"><button aria-label="更多"></button></div></div>'
          })
        </script>`)
      return
    }
    if (hostname === "zhuanlan.zhihu.com") {
      res.end(`<!doctype html><meta charset="utf-8"><title>知乎专栏 site-fastqa fixture</title>
        <article class="Post-Main Post-NormalMain">
          <meta itemprop="url" content="https://zhuanlan.zhihu.com/p/789">
          <meta itemprop="headline" content="可扩展速答架构专栏">
          <h1 class="Post-Title">可扩展速答架构专栏</h1>
          <div class="Post-RichTextContainer"><div class="RichText">知乎专栏完整正文。</div></div>
          <div class="Sticky RichContent-actions"><div class="ContentItem-actions">
            <button aria-label="收藏">收藏</button>
            <div class="Popover ShareMenu ContentItem-action"><button>分享</button></div>
            <div class="Post-ActionMenuButton"><button aria-label="更多"></button></div>
          </div></div>
        </article>`)
      return
    }
    res.end(`<!doctype html><meta charset="utf-8"><title>engine-fixture</title><p>本地引擎夹具页 ${req.url}</p>`)
  })
  await new Promise((res) => httpsServer.listen(0, "127.0.0.1", res))
  const httpsPort = httpsServer.address().port

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccs-smoke-"))
  const child = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    // 新版稳定版 Chrome（136+）无视 --load-extension，唯一正路是 CDP
    // Extensions.loadUnpacked（需要下面这个 flag）。不要再加
    // --load-extension/--disable-extensions-except —— 实测会干扰 CDP 装载的扩展。
    "--enable-unsafe-extension-debugging",
    `--host-resolver-rules=MAP www.baidu.com 127.0.0.1:${httpsPort},MAP chat.baidu.com 127.0.0.1:${httpsPort},MAP www.google.com 127.0.0.1:${httpsPort},MAP chatgpt.com 127.0.0.1:${httpsPort},MAP x.com 127.0.0.1:${httpsPort},MAP www.zhihu.com 127.0.0.1:${httpsPort},MAP zhuanlan.zhihu.com 127.0.0.1:${httpsPort}`,
    "--ignore-certificate-errors",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] })

  let browserCdp = null
  let swCdp = null
  let pageCdp = null
  // 全局看门狗：CDP 挂死时兜底（先杀 Chrome 再退，避免僵尸）
  const watchdog = setTimeout(() => {
    console.error(`${TAG} ✗ 全局超时（240s），强制退出`)
    try { child.kill("SIGKILL") } catch (_) { /* noop */ }
    process.exit(1)
  }, 240_000)
  watchdog.unref?.()
  try {
    const port = await waitForDevToolsPort(userDataDir, child)

    // 0. 通过 browser-level CDP 装载未打包扩展（Chrome 126+）
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json())
    browserCdp = new CdpClient(await connectWebSocket(version.webSocketDebuggerUrl))
    try {
      const loaded = await browserCdp.call("Extensions.loadUnpacked", { path: buildDir })
      console.log(`${TAG} ✓ Extensions.loadUnpacked 装载成功（id: ${loaded.id}）`)
    } catch (err) {
      // 老 Chromium 没有该 API；本校验只支持现代路径，优雅跳过
      console.warn(`${TAG} ⚠ SKIPPED — Extensions.loadUnpacked 不可用（${err.message.trim()}）`)
      return
    }

    // 1. SW target 出现 = 扩展装载成功 + SW 至少开始执行
    // 注意：headless Chrome 自带组件扩展也有 SW，必须按我们的 SW 路径精确匹配
    const swTarget = await findTarget(port, (t) =>
      t.type === "service_worker" &&
      /chrome-extension:.*static\/background\/index\.js$/.test(t.url || "") &&
      t.webSocketDebuggerUrl
    )
    if (!swTarget) fail("找不到扩展 service_worker target —— 扩展没装上或 SW 启动即死")
    const extensionId = new URL(swTarget.url).host
    console.log(`${TAG} ✓ SW 启动（${swTarget.url.split("/").slice(3).join("/")}）`)

    // 2+3. 附到 SW：收集异常 + 检查桥接符号
    swCdp = new CdpClient(await connectWebSocket(swTarget.webSocketDebuggerUrl))
    const swExceptions = []
    swCdp.on("Runtime.exceptionThrown", (p) => {
      swExceptions.push(p?.exceptionDetails?.exception?.description || p?.exceptionDetails?.text || "unknown")
    })
    await swCdp.call("Runtime.enable")
    // 给 importScripts + attach 链一点完成时间（通常 <300ms，宽限 1s）
    await wait(1000)

    // 提前安装 logMenuEvent 间谍：全程收集 SW 侧事件，供各路径失败时倾倒现场
    await evaluate(swCdp, `(() => {
      if (!globalThis.__smokeLogSpyInstalled) {
        globalThis.__smokeOriginalLogMenuEvent = globalThis.logMenuEvent;
        globalThis.logMenuEvent = function(stage, payload) {
          try { (globalThis.__smokeMenuEvents ||= []).push({ stage, payload: payload || {} }); } catch (_) {}
          if (typeof globalThis.__smokeOriginalLogMenuEvent === "function") {
            return globalThis.__smokeOriginalLogMenuEvent.apply(this, arguments);
          }
        };
        globalThis.__smokeLogSpyInstalled = true;
      }
      return "spy-on";
    })()`)

    // 注意：StateManager / URLBuilder 是顶层 class 声明 —— 全局词法绑定而非
    // globalThis 属性，必须用裸标识符 typeof 探测
    const bridge = await evaluate(swCdp, `(() => ({
      menuSystem: typeof MenuSystem,
      createContextMenus: typeof createContextMenus,
      popupMenuStructure: typeof getPopupMenuStructure,
      stateManager: typeof StateManager,
      urlBuilder: typeof URLBuilder,
      runAITask: typeof runAITaskByMenuId
    }))()`)
    const expected = {
      menuSystem: "object",
      createContextMenus: "function",
      popupMenuStructure: "function",
      stateManager: "function",
      urlBuilder: "function",
      runAITask: "function"
    }
    for (const [key, type] of Object.entries(expected)) {
      if (bridge?.[key] !== type) fail(`SW 桥接符号缺失: globalThis.${key} 应为 ${type}，实际 ${bridge?.[key]}`)
    }
    console.log(`${TAG} ✓ SW 桥接完成（${Object.keys(expected).length} 个关键 globalThis 符号就位）`)

    if (swExceptions.length > 0) {
      fail(`SW 启动期有 ${swExceptions.length} 个未捕获异常: ${swExceptions[0]}`)
    }
    console.log(`${TAG} ✓ SW 启动期零未捕获异常`)

    // 3.5 ccs-main-live 存在性探针：contextMenus 没有查询 API，轮询 update
    //     直到目标 id 可更新。不能用“重复 id 创建”探针：启动较慢时探针会
    //     抢先占用生产 id，既制造假红，也会反过来阻断真实菜单注册。
    const liveProbe = await evaluate(swCdp, `
      (async () => {
        let lastError = "";
        for (let i = 0; i < 40; i++) {
          lastError = await new Promise((res) => {
            try {
              chrome.contextMenus.update("ccs-main-live", { visible: true }, () => {
                res(chrome.runtime.lastError?.message || "");
              });
            } catch (e) { res(e?.message || String(e)); }
          });
          if (!lastError) return { ok: true, attempts: i + 1 };
          await new Promise((r) => setTimeout(r, 100));
        }
        return { ok: false, lastError };
      })()
    `)
    if (!liveProbe?.ok) fail(`ccs-main-live 未注册（探针结果: ${JSON.stringify(liveProbe)}）`)
    const twinProbe = await evaluate(swCdp, `
      new Promise((res) => {
        try {
          chrome.contextMenus.update("ccs-baidu--sel", { visible: true }, () => {
            const lastError = chrome.runtime.lastError?.message || "";
            res({ ok: !lastError, lastError });
          });
        } catch (e) { res({ ok: false, lastError: e?.message || String(e) }); }
      })
    `)
    if (!twinProbe?.ok) fail(`选区孪生树未注册（ccs-baidu--sel 探针: ${JSON.stringify(twinProbe)}）`)
    console.log(`${TAG} ✓ 选区孪生树已注册（动态关键词根/顶部标签 + 固定标题子项）`)

    // 4. 消息协议：从扩展页（about:blank tab 导航到 welcome 页）发真实消息
    const pageTarget = await findTarget(port, (t) => t.type === "page" && t.webSocketDebuggerUrl)
    if (!pageTarget) fail("找不到 page target")
    pageCdp = new CdpClient(await connectWebSocket(pageTarget.webSocketDebuggerUrl))
    await pageCdp.call("Runtime.enable")
    await pageCdp.call("Page.enable")
    await pageCdp.call("Page.navigate", { url: `chrome-extension://${extensionId}/welcome/welcome.html` })
    await wait(800)

    const menuStructure = await evaluate(pageCdp, `
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ __timeout: true }), 5000);
        chrome.runtime.sendMessage({ action: "getMenuStructure" }, (resp) => {
          clearTimeout(timer);
          // events.js 响应形状: { success: true, structure: { groups: [...] } }
          resolve({
            success: resp?.success === true,
            groups: Array.isArray(resp?.structure?.groups) ? resp.structure.groups.length : -1,
            lastError: chrome.runtime.lastError?.message || null
          });
        });
      })
    `)
    if (menuStructure?.__timeout) fail("getMenuStructure 5s 无响应 —— onMessage 链路死了")
    if (menuStructure?.lastError) fail(`getMenuStructure lastError: ${menuStructure.lastError}`)
    if (!menuStructure?.success) fail("getMenuStructure 返回 success!==true")
    if (!(menuStructure?.groups >= 3)) fail(`getMenuStructure 返回分组数异常: ${menuStructure?.groups}（期望 ≥3）`)
    console.log(`${TAG} ✓ getMenuStructure 响应正常（${menuStructure.groups} 个分组）`)

    const keyword = await evaluate(pageCdp, `
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ __timeout: true }), 5000);
        chrome.runtime.sendMessage(
          { action: "getKeyword", tabId: 999999, url: "https://www.google.com/search?q=smoke+test", title: "smoke", intent: "popup-open" },
          (resp) => {
            clearTimeout(timer);
            resolve({ shape: resp && typeof resp === "object" ? Object.keys(resp).sort().join(",") : typeof resp, lastError: chrome.runtime.lastError?.message || null });
          }
        );
      })
    `)
    if (keyword?.__timeout) fail("getKeyword 5s 无响应 —— 安全兜底响应器（2.5s）没生效")
    if (keyword?.lastError) fail(`getKeyword lastError: ${keyword.lastError}`)
    console.log(`${TAG} ✓ getKeyword 响应正常（字段: ${keyword.shape}）`)

    // 5. ccsDiagPing：SW 心跳 + manifest 版本一致
    const buildVersion = JSON.parse(fs.readFileSync(path.join(buildDir, "manifest.json"), "utf8")).version
    const ping = await evaluate(pageCdp, `
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ __timeout: true }), 5000);
        chrome.runtime.sendMessage({ action: "ccsDiagPing" }, (resp) => {
          clearTimeout(timer);
          resolve({ ok: resp?.ok === true, swVersion: resp?.swVersion || "" });
        });
      })
    `)
    if (!ping?.ok) fail("ccsDiagPing 未返回 ok:true")
    if (ping.swVersion !== buildVersion) fail(`SW 上报版本 ${ping.swVersion} ≠ build manifest ${buildVersion}`)
    console.log(`${TAG} ✓ ccsDiagPing 心跳正常（SW 版本 ${ping.swVersion}）`)

    // 6. getMenuDebugInfo：调试信息通道
    const debugInfo = await evaluate(pageCdp, `
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ __timeout: true }), 6000);
        chrome.runtime.sendMessage({ action: "getMenuDebugInfo", tabId: 1 }, (resp) => {
          clearTimeout(timer);
          resolve({ success: resp?.success === true, hasData: !!resp?.data });
        });
      })
    `)
    if (debugInfo?.__timeout || !debugInfo?.success || !debugInfo?.hasData) {
      fail(`getMenuDebugInfo 异常: ${JSON.stringify(debugInfo)}`)
    }
    console.log(`${TAG} ✓ getMenuDebugInfo 响应正常`)

    // 7. sidepanel-alive port 生命周期（onConnect 路径）：
    //    connect + 注册 windowId → getSidePanelState 翻 true → disconnect → 翻回 false
    const portLifecycle = await evaluate(pageCdp, `
      (async () => {
        const win = await new Promise((res) => chrome.windows.getCurrent(res));
        const ask = () => new Promise((res) =>
          chrome.runtime.sendMessage({ action: "getSidePanelState", windowId: win.id }, (r) => res(!!r?.isOpen)));
        const before = await ask();
        const port = chrome.runtime.connect({ name: "sidepanel-alive" });
        port.postMessage({ windowId: win.id });
        await new Promise((r) => setTimeout(r, 400));
        const during = await ask();
        port.disconnect();
        await new Promise((r) => setTimeout(r, 400));
        const after = await ask();
        return { before, during, after };
      })()
    `)
    if (portLifecycle?.before !== false || portLifecycle?.during !== true || portLifecycle?.after !== false) {
      fail(`sidepanel-alive port 生命周期异常: ${JSON.stringify(portLifecycle)}（期望 false→true→false）`)
    }
    console.log(`${TAG} ✓ sidepanel-alive port 生命周期正常（关→开→关）`)

    // 19. welcome-watcher 推送协议（onConnect 第二分支）：注册即收到当前态(false)，
    //     侧边栏 port 开/关时分别收到 true / false 的实时推送
    const watcherPushes = await evaluate(pageCdp, `
      (async () => {
        const win = await new Promise((res) => chrome.windows.getCurrent(res));
        const pushes = [];
        const watcher = chrome.runtime.connect({ name: "welcome-watcher" });
        watcher.onMessage.addListener((m) => { if (m?.action === "sidePanelStateChanged") pushes.push(m.isOpen); });
        watcher.postMessage({ windowId: win.id });
        await new Promise((r) => setTimeout(r, 300));
        const alive = chrome.runtime.connect({ name: "sidepanel-alive" });
        alive.postMessage({ windowId: win.id });
        await new Promise((r) => setTimeout(r, 300));
        alive.disconnect();
        await new Promise((r) => setTimeout(r, 300));
        watcher.disconnect();
        return pushes;
      })()
    `)
    if (JSON.stringify(watcherPushes) !== JSON.stringify([false, true, false])) {
      fail(`welcome-watcher 推送序列异常: ${JSON.stringify(watcherPushes)}（期望 [false,true,false]）`)
    }
    console.log(`${TAG} ✓ welcome-watcher 推送协议正常（注册即推 + 开关实时推送）`)

    // 8.（已并入 14）selectionChanged → getKeyword 选区回路由"真实选区捕获"
    //    路径承担：trusted 三连击驱动 content.js 真实捕获 → SW → getKeyword，
    //    比 executeScript 合成发送更忠实（后者在 CI 上 sender/tab 归属不稳定，
    //    两次 CI 取证给出两种结果 —— 合成路径与生产路径行为不同，弃用）。

    // 9. executeMenuAction（search 走 SSoT 快速通道）→ 真开新标签且 URL 正确
    const exec = await evaluate(pageCdp, `
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ __timeout: true }), 8000);
        // 按生产消息契约（popup/sidepanel 同款）：search 类必须带 urlPattern
        chrome.runtime.sendMessage(
          {
            action: "executeMenuAction", menuItemId: "ccs-baidu", menuType: "search",
            keyword: "冒烟smoke123", urlPattern: "https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=\${KEYWORD}"
          },
          (resp) => { clearTimeout(timer); resolve({ success: resp?.success === true, raw: resp }); }
        );
      })
    `)
    if (exec?.__timeout || !exec?.success) fail(`executeMenuAction 失败: ${JSON.stringify(exec?.raw || exec)}`)
    const expectedUrlPart = "baidu.com/s?ie=utf-8&oe=utf-8&wd=" + encodeURIComponent("冒烟smoke123")
    const newTab = await findTarget(port, (t) => t.type === "page" && (t.url || "").includes(expectedUrlPart), 8000)
    if (!newTab) fail(`executeMenuAction 后找不到 URL 含 ${expectedUrlPart} 的新标签 —— URLBuilder/tryOpenMenuUrl 链路断了`)
    console.log(`${TAG} ✓ executeMenuAction 真开新标签且 URL 正确（SSoT URLBuilder 链路通）`)

    // 9.1 文心新入口专属契约：短提示也必须走 storage relay，最终标签只带
    //     ccs_pp（enter_type 已去除），不再带已失效的 q 参数。目标域名映射到
    //     本地 HTTPS 夹具，测试只验证扩展行为，不依赖真实文心站可用性。
    const wenxinPrompt = "文心新入口冒烟123"
    const wenxinExec = await evaluate(pageCdp, `
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ __timeout: true }), 8000);
        chrome.runtime.sendMessage(
          {
            action: "executeMenuAction", menuItemId: "ccs-yiyan", menuType: "ai-search",
            keyword: ${JSON.stringify("文心新入口冒烟123")},
            urlPattern: "https://chat.baidu.com/"
          },
          (resp) => { clearTimeout(timer); resolve({ success: resp?.success === true, raw: resp }); }
        );
      })
    `)
    if (wenxinExec?.__timeout || !wenxinExec?.success) {
      fail(`文心 executeMenuAction 失败: ${JSON.stringify(wenxinExec?.raw || wenxinExec)}`)
    }
    const wenxinTabTarget = await findTarget(port, (t) =>
      t.type === "page" && (t.url || "").startsWith("https://chat.baidu.com/"), 8000)
    if (!wenxinTabTarget) fail("文心菜单没有打开 chat.baidu.com 官方新入口")
    const wenxinUrl = new URL(wenxinTabTarget.url)
    const wenxinRelayId = new URLSearchParams(wenxinUrl.hash.replace(/^#/, "")).get("ccs_pp")
    if (wenxinUrl.searchParams.has("enter_type") || wenxinUrl.searchParams.has("q") || !wenxinRelayId) {
      fail(`文心 relay URL 契约异常: ${wenxinUrl}`)
    }
    const relayIdLiteral = /^[A-Za-z0-9_-]{6,80}$/.test(wenxinRelayId) ? JSON.stringify(wenxinRelayId) : null
    if (!relayIdLiteral) fail(`文心 relay id 非法: ${wenxinRelayId}`)
    const storedWenxinRelay = await evaluate(pageCdp, `
      (async () => {
        const relayId = ${relayIdLiteral};
        const promptKey = "ccs_ai_pending_prompt_" + relayId;
        for (let i = 0; i < 20; i++) {
          const tabs = await new Promise((res) => chrome.tabs.query({}, res));
          const tab = tabs.find((t) => (t.url || t.pendingUrl || "").startsWith("https://chat.baidu.com/"));
          const bindingKey = tab ? "ccs_ai_pending_tab_" + tab.id : "";
          const keys = bindingKey ? [promptKey, bindingKey] : [promptKey];
          const data = await new Promise((res) => chrome.storage.session.get(keys, res));
          if (data?.[promptKey]?.prompt && bindingKey && data?.[bindingKey]?.id === relayId) {
            return {
              prompt: data[promptKey].prompt,
              relayEngine: data[promptKey].relayEngine,
              tabBound: !!bindingKey && data?.[bindingKey]?.id === relayId
            };
          }
          await new Promise((r) => setTimeout(r, 100));
        }
        return null;
      })()
    `)
    if (storedWenxinRelay?.prompt !== wenxinPrompt || storedWenxinRelay?.relayEngine !== "yiyan" || !storedWenxinRelay?.tabBound) {
      fail(`文心 relay storage/tab 绑定异常: ${JSON.stringify(storedWenxinRelay)}`)
    }
    console.log(`${TAG} ✓ 文心新入口短提示走 storage relay（新域名 / 无 q / prompt + tab 绑定完整）`)

    // 12. URL 关键字提取子系统（keywords.js 搜索引擎分支）：
    //     复用 #9 开出的"百度"标签（域名已映射到本地 HTTPS 夹具，URL 与 wd=
    //     参数原样保留、无反爬重定向）—— getKeyword 走 tabId 重新水化路径提取关键字
    const urlExtract = await evaluate(pageCdp, `
      (async () => {
        const tabs = await new Promise((res) => chrome.tabs.query({}, res));
        const baiduTab = tabs.find((t) => (t.url || t.pendingUrl || "").includes("baidu.com/s?ie=utf-8&oe=utf-8&wd="));
        if (!baiduTab) return { error: "no-baidu-tab" };
        const url = baiduTab.url || baiduTab.pendingUrl;
        const resp = await new Promise((res) =>
          chrome.runtime.sendMessage(
            { action: "getKeyword", tabId: baiduTab.id, url, title: baiduTab.title || "", intent: "popup-open" },
            res
          ));
        return { tabId: baiduTab.id, text: resp?.text || "", raw: resp?.raw || "", source: resp?.source || "" };
      })()
    `)
    if (!urlExtract?.text?.includes("冒烟smoke123") && !urlExtract?.raw?.includes("冒烟smoke123")) {
      fail(`URL 关键字提取失败: ${JSON.stringify(urlExtract)}`)
    }
    console.log(`${TAG} ✓ URL 关键字提取正常（百度 wd= → "${urlExtract.text.slice(0, 20)}"，source: ${urlExtract.source}）`)

    // 13. ccs_kw_<tabId> storage 即时缓存契约（popup/sidepanel 首屏即时渲染靠它）：
    //     #12 的 getKeyword(popup-open) 解析后 KeywordService 应已持久化
    //     {text, raw, url, ts}。百度域名现已映射本地夹具（hermetic）——
    //     无反爬重定向，wd= 关键字确定性可断言。
    const cacheEntry = await evaluate(pageCdp, `
      (async () => {
        const key = "ccs_kw_" + ${urlExtract.tabId};
        for (let i = 0; i < 10; i++) {
          const data = await new Promise((res) => chrome.storage.local.get([key], res));
          const entry = data?.[key];
          if (entry?.text) return { text: entry.text, hasTs: typeof entry.ts === "number", hasUrl: typeof entry.url === "string" };
          await new Promise((r) => setTimeout(r, 300));
        }
        return { text: "", hasTs: false, hasUrl: false };
      })()
    `)
    if (!cacheEntry?.text?.includes("冒烟smoke123") || !cacheEntry?.hasTs) {
      fail(`ccs_kw_ 即时缓存契约失败: ${JSON.stringify(cacheEntry)}（首屏即时渲染依赖此写入）`)
    }
    console.log(`${TAG} ✓ ccs_kw_ storage 即时缓存写入正常（{text, ts, url} 契约完整）`)

    // 18. 协议扫掠：events.js 其余只读 onMessage handler 一次问遍 ——
    //     getSearchText（KeywordService 兼容入口）/ extractKeywords（URL 取词纯函数链）/
    //     ccsGetUrlRecovery（无恢复记录时的礼貌拒绝）/ contextMenuPreview（debounce，只发不等）
    const sweep = await evaluate(pageCdp, `
      (async () => {
        const tab = await new Promise((res) => chrome.tabs.getCurrent(res));
        const ask = (msg, ms = 4000) => new Promise((res) => {
          const timer = setTimeout(() => res({ __timeout: true }), ms);
          chrome.runtime.sendMessage(msg, (r) => { clearTimeout(timer); res(r ?? { __empty: true }); });
        });
        chrome.runtime.sendMessage({ action: "contextMenuPreview", selectionText: "sweep预览" }); // fire-and-forget
        const [searchText, extract, recovery, slateBridge] = await Promise.all([
          ask({ action: "getSearchText", tabId: tab.id, url: tab.url, title: tab.title }),
          ask({ action: "extractKeywords", url: "https://www.google.com/search?q=sweep%E6%89%AB%E6%8E%A0", title: "x" }),
          ask({ action: "ccsGetUrlRecovery" }),
          // 安全契约：Slate MAIN world 注入只接受来自 yiyan.baidu.com 的 tab 请求，
          // 其它来源（此处是扩展自家 welcome 页）必须被拒，且绝不执行注入
          ask({ action: "ccsFillYiyanSlatePromptInMainWorld", text: "越权注入测试" })
        ]);
        return {
          searchTextOk: !searchText.__timeout && typeof searchText.text === "string",
          extractKw: extract.__timeout ? "(timeout)" : (extract.keywords ?? "(null)"),
          recoveryOk: !recovery.__timeout && recovery.ok === false && typeof recovery.error === "string",
          slateBridgeRejected: !slateBridge.__timeout && slateBridge.ok === false && slateBridge.error === "sender-not-yiyan"
        };
      })()
    `)
    if (!sweep?.searchTextOk) fail(`getSearchText 异常: ${JSON.stringify(sweep)}`)
    if (sweep?.extractKw !== "sweep扫掠") fail(`extractKeywords 取词错误: "${sweep?.extractKw}"（期望 "sweep扫掠"）`)
    if (!sweep?.recoveryOk) fail(`ccsGetUrlRecovery 异常: ${JSON.stringify(sweep)}`)
    if (!sweep?.slateBridgeRejected) fail(`Slate 桥安全契约破裂: 非 yiyan 来源未被拒 ${JSON.stringify(sweep)}`)
    console.log(`${TAG} ✓ 协议扫掠正常（getSearchText / extractKeywords="${sweep.extractKw}" / ccsGetUrlRecovery 礼貌拒绝 / Slate 桥拒绝非 yiyan 来源 / contextMenuPreview 已投递）`)

    // 13.5 站点速答适配器：使用映射到本地 HTTPS 的 X / 知乎真实域名夹具，
    //      让生产 build 中的 content_scripts 按真实 hostname 自动启动。
    const openSiteFixture = async (url) => {
      const { targetId } = await browserCdp.call("Target.createTarget", { url })
      const target = await findTarget(port, (t) => t.id === targetId && t.webSocketDebuggerUrl, 8000)
      if (!target) fail(`站点速答夹具 target 没出现: ${url}`)
      const cdp = new CdpClient(await connectWebSocket(target.webSocketDebuggerUrl))
      const exceptions = []
      cdp.on("Runtime.exceptionThrown", (event) => {
        exceptions.push(event?.exceptionDetails?.exception?.description || event?.exceptionDetails?.text || "unknown")
      })
      await cdp.call("Runtime.enable")
      await cdp.call("Page.enable")
      await browserCdp.call("Target.activateTarget", { targetId })
      await wait(1200)
      return { cdp, exceptions }
    }

    const xFixture = await openSiteFixture("https://x.com/site-fastqa")
    const xFastQa = await evaluate(xFixture.cdp, `(() => {
      const button = document.querySelector('[data-ccs-x-tweet-fastqa]');
      const host = button?.closest('[data-ccs-site-fastqa-host="x"]');
      return {
        count: document.querySelectorAll('[data-ccs-x-tweet-fastqa]').length,
        label: button?.getAttribute('aria-label') || '',
        state: button?.dataset.ccsState || '',
        beforeShare: host?.nextElementSibling?.id === 'x-share-cell'
      };
    })()`)
    if (xFastQa?.count !== 1 || xFastQa.state !== "idle" || !xFastQa.beforeShare || !xFastQa.label.includes("ChatGPT")) {
      fail(`X 速答适配器注入异常: ${JSON.stringify(xFastQa)}`)
    }
    if (xFixture.exceptions.length > 0) fail(`X 速答适配器未捕获异常: ${xFixture.exceptions[0]}`)
    console.log(`${TAG} ✓ X 速答适配器注入正常（单实例 / 分享前 / idle）`)
    xFixture.cdp.close()

    const xArticleFixture = await openSiteFixture("https://x.com/article-fastqa")
    const xArticleFastQa = await evaluate(xArticleFixture.cdp, `(() => {
      const root = document.querySelector('article[data-testid="tweet"]');
      const button = document.querySelector('[data-ccs-x-tweet-fastqa]');
      const host = button?.closest('[data-ccs-site-fastqa-host="x"]');
      return {
        count: document.querySelectorAll('[data-ccs-x-tweet-fastqa]').length,
        kind: button?.dataset.ccsContentKind || '',
        state: button?.dataset.ccsState || '',
        sourceKey: button?.dataset.ccsSourceKey || '',
        label: button?.getAttribute('aria-label') || '',
        beforeArticleShare: host?.nextElementSibling?.id === 'x-article-share-cell',
        domTitle: root?.querySelector('[data-testid="twitter-article-title"]')?.innerText || '',
        domBody: root?.querySelector('[data-testid="twitterArticleRichTextView"]')?.innerText || ''
      };
    })()`)
    if (xArticleFastQa?.count !== 1 || xArticleFastQa.kind !== "article" ||
        xArticleFastQa.state !== "idle" || !xArticleFastQa.sourceKey.startsWith("x-article:") ||
        !xArticleFastQa.label.includes("X 长文") || !xArticleFastQa.beforeArticleShare ||
        xArticleFastQa.domTitle !== "X 长文夹具标题" ||
        !xArticleFastQa.domBody.includes("这是 X 长文第二段。")) {
      fail(`X 长文速答适配器注入异常: ${JSON.stringify(xArticleFastQa)}`)
    }
    if (xArticleFixture.exceptions.length > 0) fail(`X 长文速答适配器未捕获异常: ${xArticleFixture.exceptions[0]}`)
    console.log(`${TAG} ✓ X 长文速答适配器正常（article 识别 / 单实例 / 内层分享前）`)
    xArticleFixture.cdp.close()

    const zhihuFixture = await openSiteFixture("https://www.zhihu.com/question/123/answer/456")
    const zhihuBefore = await evaluate(zhihuFixture.cdp, `(() => {
      const button = document.querySelector('[data-ccs-zhihu-fastqa]');
      const host = button?.closest('[data-ccs-site-fastqa-host="zhihu"]');
      return {
        count: document.querySelectorAll('[data-ccs-zhihu-fastqa]').length,
        text: button?.textContent?.trim() || '',
        state: button?.dataset.ccsState || '',
        beforeShare: host?.nextElementSibling?.classList.contains('ShareMenu') === true,
        collapsed: document.querySelector('.RichContent')?.classList.contains('is-collapsed') === true
      };
    })()`)
    if (zhihuBefore?.count !== 1 || zhihuBefore.text !== "速答" || zhihuBefore.state !== "idle" ||
        !zhihuBefore.beforeShare || !zhihuBefore.collapsed) {
      fail(`知乎回答速答初始注入异常: ${JSON.stringify(zhihuBefore)}`)
    }

    await evaluate(zhihuFixture.cdp, `document.querySelector('[data-ccs-zhihu-fastqa]')?.click()`)
    let zhihuAfter = null
    for (let i = 0; i < 30; i++) {
      await wait(150)
      zhihuAfter = await evaluate(zhihuFixture.cdp, `(() => {
        const button = document.querySelector('[data-ccs-zhihu-fastqa]');
        const host = button?.closest('[data-ccs-site-fastqa-host="zhihu"]');
        return {
          count: document.querySelectorAll('[data-ccs-zhihu-fastqa]').length,
          text: button?.textContent?.trim() || '',
          state: button?.dataset.ccsState || '',
          body: document.querySelector('[itemprop="text"]')?.textContent || '',
          collapsed: document.querySelector('.RichContent')?.classList.contains('is-collapsed') === true,
          beforeShare: host?.nextElementSibling?.classList.contains('ShareMenu') === true
        };
      })()`)
      if (zhihuAfter?.state === "success") break
    }
    if (zhihuAfter?.count !== 1 || zhihuAfter.state !== "success" || zhihuAfter.text !== "已发送" ||
        zhihuAfter.collapsed || !zhihuAfter.body.includes("展开后的完整正文") || !zhihuAfter.beforeShare) {
      fail(`知乎展开/操作栏重建/状态恢复异常: ${JSON.stringify(zhihuAfter)}`)
    }
    if (zhihuFixture.exceptions.length > 0) fail(`知乎回答速答适配器未捕获异常: ${zhihuFixture.exceptions[0]}`)
    const chatGptTarget = await findTarget(port, (t) => t.type === "page" && (t.url || "").includes("chatgpt.com/"), 4000)
    if (!chatGptTarget) fail("知乎速答点击后未走现有 ChatGPT fastqa 链路")
    console.log(`${TAG} ✓ 知乎回答速答全链正常（展开全文 / 操作栏重建 / 状态恢复 / ChatGPT）`)
    zhihuFixture.cdp.close()

    const articleFixture = await openSiteFixture("https://zhuanlan.zhihu.com/p/789")
    const articleFastQa = await evaluate(articleFixture.cdp, `(() => {
      const button = document.querySelector('[data-ccs-zhihu-fastqa]');
      const host = button?.closest('[data-ccs-site-fastqa-host="zhihu"]');
      return {
        count: document.querySelectorAll('[data-ccs-zhihu-fastqa]').length,
        kind: button?.dataset.ccsContentKind || '',
        label: button?.getAttribute('aria-label') || '',
        beforeShare: host?.nextElementSibling?.classList.contains('ShareMenu') === true
      };
    })()`)
    if (articleFastQa?.count !== 1 || articleFastQa.kind !== "article" ||
        !articleFastQa.label.includes("知乎文章") || !articleFastQa.beforeShare) {
      fail(`知乎专栏速答适配器注入异常: ${JSON.stringify(articleFastQa)}`)
    }
    if (articleFixture.exceptions.length > 0) fail(`知乎专栏速答适配器未捕获异常: ${articleFixture.exceptions[0]}`)
    console.log(`${TAG} ✓ 知乎专栏速答适配器注入正常（文章识别 / 分享前 / 单实例）`)
    articleFixture.cdp.close()

    // 14. 真实选区捕获链路（content script 注入 → trusted 鼠标拖选 → mouseup →
    //     selectionChanged → SW 状态）。本地 HTTP 页 + CDP Input trusted 事件，
    //     等价于真人鼠标操作 —— 这是此前认为"只能真机"的路径。
    const httpTabId = await evaluate(pageCdp, `
      new Promise((res) => chrome.tabs.create({ url: "${httpUrl}", active: true }, (tab) => res(tab.id)))
    `)
    const httpTarget = await findTarget(port, (t) => t.type === "page" && (t.url || "").startsWith(httpUrl), 8000)
    if (!httpTarget) fail("本地 HTTP 测试页 target 没出现")
    const httpCdp = new CdpClient(await connectWebSocket(httpTarget.webSocketDebuggerUrl))
    await httpCdp.call("Runtime.enable")
    await httpCdp.call("Page.enable")
    await httpCdp.call("Page.bringToFront") // 没有前台焦点时 Input 事件不产生 selection
    await wait(800) // content script (document_start) + 页面渲染

    // 15.（前置）给 SW 的 chrome.contextMenus.update 装标题记录器 ——
    //     用于断言"选中文本 → 右键菜单标题实时更新"这条原本只能人眼验证的路径
    await evaluate(swCdp, `(() => {
      if (globalThis.__smokeTitleSpy) return "already";
      globalThis.__smokeTitleSpy = [];
      const orig = chrome.contextMenus.update.bind(chrome.contextMenus);
      chrome.contextMenus.update = (id, props, cb) => {
        try { if (props && typeof props.title === "string") globalThis.__smokeTitleSpy.push(props.title) } catch (_) {}
        return orig(id, props, cb);
      };
      return "installed";
    })()`)

    const box = await evaluate(httpCdp, `(() => {
      const r = document.getElementById("t").getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)
    await evaluate(swCdp, `(() => {
      if (!globalThis.__smokeLogSpyInstalled) {
        globalThis.__smokeOriginalLogMenuEvent = globalThis.logMenuEvent;
        globalThis.logMenuEvent = function(stage, payload) {
          try {
            (globalThis.__smokeMenuEvents ||= []).push({ stage, payload: payload || {} });
          } catch (_) {}
          if (typeof globalThis.__smokeOriginalLogMenuEvent === "function") {
            return globalThis.__smokeOriginalLogMenuEvent.apply(this, arguments);
          }
        };
        globalThis.__smokeLogSpyInstalled = true;
      }
      globalThis.__smokeTitleSpy = [];
      globalThis.__smokeMenuEvents = [];
      if (globalThis.latestTitleByTab) delete globalThis.latestTitleByTab[${httpTabId}];
      if (globalThis.selectedTextByTab) delete globalThis.selectedTextByTab[${httpTabId}];
      if (globalThis.fallbackKeywordByTab) delete globalThis.fallbackKeywordByTab[${httpTabId}];
      if (globalThis.currentMenuState) {
        Object.assign(globalThis.currentMenuState, { raw: "", normalized: "", display: "", tabId: null, url: "" });
      }
    })()`)
    const noSelectionBeforeRightClick = await evaluate(httpCdp, `(() => {
      window.getSelection()?.removeAllRanges();
      return { title: document.title, selection: window.getSelection()?.toString() || "" };
    })()`)
    if (noSelectionBeforeRightClick?.selection) {
      fail(`无选区右键前仍存在选区: ${JSON.stringify(noSelectionBeforeRightClick)}`)
    }
    await httpCdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y })
    await httpCdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "right", buttons: 2, clickCount: 1 })
    await httpCdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "right", buttons: 0, clickCount: 1 })
    await wait(800)
    await evaluate(httpCdp, `
      document.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, button: 2, buttons: 2,
        clientX: ${Math.round(box.x)}, clientY: ${Math.round(box.y)}
      }))
    `)
    let noSelectionPreview = null
    for (let i = 0; i < 20; i++) {
      noSelectionPreview = await evaluate(swCdp, `(() => {
        const needle = ${JSON.stringify(noSelectionTitleKeyword)};
        const titles = globalThis.__smokeTitleSpy || [];
        const events = globalThis.__smokeMenuEvents || [];
        const stored = globalThis.selectedTextByTab?.[${httpTabId}];
        const storedText = typeof stored === "string" ? stored : stored?.text;
        return {
          titleHits: titles.filter((t) => String(t).includes(needle)).length,
          hydrated: events.some((e) =>
            e.stage === "context-preview-tab-hydrated" &&
            e.payload?.tabId === ${httpTabId} &&
            String(e.payload?.freshTitle || "").includes(needle)
          ),
          fallback: events.some((e) =>
            e.stage === "context-preview-fallback" &&
            String(e.payload?.raw || "").includes(needle)
          ),
          cached: events.some((e) =>
            e.stage === "context-selection-cache" &&
            e.payload?.tabId === ${httpTabId} &&
            String(e.payload?.text || "").includes(needle)
          ),
          stateRaw: globalThis.currentMenuState?.raw || "",
          storedText: storedText || "",
          lastTitles: titles.slice(-5),
          lastEvents: events.slice(-8).map((e) => ({
            stage: e.stage,
            tabId: e.payload?.tabId,
            source: e.payload?.source,
            text: e.payload?.text,
            raw: e.payload?.raw,
            freshTitle: e.payload?.freshTitle
          }))
        };
      })()`)
      if (
        noSelectionPreview?.hydrated &&
        noSelectionPreview?.fallback &&
        noSelectionPreview?.cached &&
        (
          String(noSelectionPreview?.stateRaw || "").includes(noSelectionTitleKeyword) ||
          String(noSelectionPreview?.storedText || "").includes(noSelectionTitleKeyword)
        )
      ) break
      await wait(200)
    }
    if (!(
      noSelectionPreview?.hydrated &&
      noSelectionPreview?.fallback &&
      noSelectionPreview?.cached &&
      (
        String(noSelectionPreview?.stateRaw || "").includes(noSelectionTitleKeyword) ||
        String(noSelectionPreview?.storedText || "").includes(noSelectionTitleKeyword)
      )
    )) {
      fail(`无选区右键标题 fallback 失败: ${JSON.stringify(noSelectionPreview)}`)
    }
    console.log(`${TAG} ✓ 无选区右键菜单预览可从当前标签标题回退（tabs.get 水化 + title fallback）`)

    // 三连击选中整段（实测比拖选在 headless 下更稳）
    for (const cc of [1, 2, 3]) {
      await httpCdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: cc })
      await httpCdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: cc })
      await wait(80)
    }
    await wait(1200) // content.js mouseup → sendMessage → SW 落状态

    const realSelection = await evaluate(pageCdp, `
      new Promise((res) =>
        chrome.runtime.sendMessage(
          { action: "getKeyword", tabId: ${httpTabId}, url: "${httpUrl}", title: "smoke", intent: "popup-open" },
          (resp) => res({ text: resp?.text || "", raw: resp?.raw || "", source: resp?.source || "" })
        ))
    `)
    // httpCdp 在 15.5（标题先行刷新）之后才关闭
    if (!realSelection?.raw?.includes("真实选区捕获冒烟标记") && !realSelection?.text?.includes("真实选区捕获冒烟标记")) {
      fail(`真实选区捕获链路失败: ${JSON.stringify(realSelection)}`)
    }
    console.log(`${TAG} ✓ 真实选区捕获链路正常（trusted 拖选 → content.js → SW，source: ${realSelection.source}）`)

    // 15. 右键菜单动态标题：选中后 contextMenus.update 必须带着选中文本更新标题
    //     （标题更新可能有 debounce，轮询 spy 最多 4s）
    let titleHits = 0
    for (let i = 0; i < 20; i++) {
      titleHits = await evaluate(swCdp, `
        (globalThis.__smokeTitleSpy || []).filter((t) => t.includes("真实选区捕获冒烟标记")).length
      `)
      if (titleHits > 0) break
      await wait(200)
    }
    if (!(titleHits > 0)) {
      const sample = await evaluate(swCdp, `(globalThis.__smokeTitleSpy || []).slice(-5)`)
      fail(`右键菜单标题未随选区更新（spy 最近记录: ${JSON.stringify(sample)}）`)
    }
    console.log(`${TAG} ✓ 右键菜单动态标题随选区实时更新（contextMenus.update 命中 ${titleHits} 次）`)

    // 15.5 标题先行刷新（用户实报场景的正确测试）：页面导航后 title 一到达，
    //      右键菜单标题就应已更新 —— **全程不发生任何右键/preview 消息**。
    //      原生菜单弹出后不重绘，右键时才修标题永远晚一步；这条断言保证
    //      "用户右键之前标题已就绪"，不依赖 status=complete。
    await evaluate(swCdp, `(globalThis.__smokeTitleSpy = [], "reset")`)
    await httpCdp.call("Page.navigate", { url: `${httpUrl}title2` })
    let titleArrivedHits = 0
    for (let i = 0; i < 25; i++) {
      titleArrivedHits = await evaluate(swCdp, `
        (globalThis.__smokeTitleSpy || []).filter((t) => String(t).includes("标题先行刷新冒烟标记")).length
      `)
      if (titleArrivedHits > 0) break
      await wait(200)
    }
    if (!(titleArrivedHits > 0)) {
      const sample = await evaluate(swCdp, `(globalThis.__smokeTitleSpy || []).slice(-5)`)
      fail(`标题先行刷新失败：title 到达后菜单标题未更新（右键前标题不可能正确）。spy 最近: ${JSON.stringify(sample)}`)
    }
    console.log(`${TAG} ✓ 标题先行刷新正常（title 到达即更新菜单标题，无需右键/complete，命中 ${titleArrivedHits} 次）`)

    // 15.6 新开标签写入者竞态（用户实测场景）：新 tab 触发 onActivated/loading/
    //      title/complete 多个异步写入者，曾出现空结果写入者最后落地把标题抹成
    //      光板（直到切 Tab 才恢复）。守卫上线后：最终标题必含页面关键词，
    //      且 keyword 写入之后**不得**再出现光板写入。
    await evaluate(swCdp, `(globalThis.__smokeTitleSpy = [], "reset")`)
    await evaluate(pageCdp, `new Promise((res) => chrome.tabs.create({ url: "${httpUrl}title2", active: true }, () => res("created")))`)
    let newTabTitles = []
    for (let i = 0; i < 20; i++) {
      await wait(250)
      newTabTitles = await evaluate(swCdp, `
        (globalThis.__smokeTitleSpy || []).filter(() => true)
      `)
      const lastMain = [...newTabTitles].reverse().find((t) => String(t).startsWith("🔍 触触搜"))
      if (lastMain && String(lastMain).includes("标题先行刷新冒烟标记")) break
    }
    const mainTitles = newTabTitles.map(String).filter((t) => t.startsWith("🔍 触触搜"))
    const lastMainTitle = mainTitles[mainTitles.length - 1] || "(无)"
    const keywordIdx = mainTitles.findIndex((t) => t.includes("标题先行刷新冒烟标记"))
    const wipedAfter = keywordIdx >= 0 && mainTitles.slice(keywordIdx + 1).some((t) => t === "🔍 触触搜")
    if (!lastMainTitle.includes("标题先行刷新冒烟标记") || wipedAfter) {
      fail(`新开标签标题竞态复发: titles=${JSON.stringify(mainTitles)} wipedAfter=${wipedAfter}`)
    }
    console.log(`${TAG} ✓ 新开标签标题无竞态（最终含页面关键词，无光板回写）`)

    // 恢复现场：15.5 的导航换掉了选区页，导航回原页并重建选区，
    // 下游 UI 点按路径（#16 期望关键字 = 选区标记）保持原语义
    await httpCdp.call("Page.navigate", { url: httpUrl })
    await wait(800)
    await httpCdp.call("Page.bringToFront")
    const box2 = await evaluate(httpCdp, `(() => {
      const r = document.getElementById("t").getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)
    for (const cc of [1, 2, 3]) {
      await httpCdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: box2.x, y: box2.y, button: "left", clickCount: cc })
      await httpCdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: box2.x, y: box2.y, button: "left", clickCount: cc })
      await wait(80)
    }
    await wait(1200)
    httpCdp.close()

    // 10+11+16+17. popup / sidepanel UI 启动 + 点按实操。
    // 每个 UI 页面用独立 tab + 独立 CDP 客户端 —— popup 点按后 popup.js 会
    // window.close() 自己的标签，复用同一 target 会让后续 CDP 调用永久悬挂（踩过）。
    const openUiPage = async (relPath) => {
      // 先把 http 测试页激活回活动标签（popup/sidepanel 的关键字取自活动标签的
      // 选区），UI 页用 background:true 开，避免它自己成为活动标签
      await browserCdp.call("Target.activateTarget", { targetId: httpTarget.id })
      await wait(200)
      const { targetId } = await browserCdp.call("Target.createTarget", { url: `chrome-extension://${extensionId}/${relPath}`, background: true })
      const target = await findTarget(port, (t) => t.id === targetId && t.webSocketDebuggerUrl, 8000)
      if (!target) fail(`${relPath} 页面 target 没出现`)
      const cdp = new CdpClient(await connectWebSocket(target.webSocketDebuggerUrl))
      const exceptions = []
      cdp.on("Runtime.exceptionThrown", (e) => {
        exceptions.push(e?.exceptionDetails?.exception?.description || e?.exceptionDetails?.text || "unknown")
      })
      await cdp.call("Runtime.enable")
      await wait(1200)
      return { cdp, exceptions }
    }

    // 10+16: popup
    const popupPage = await openUiPage("popup/popup.html")
    const popupUi = await evaluate(popupPage.cdp, `(() => ({
      menuItems: document.querySelectorAll(".menu-item").length,
      staticBuilt: !!document.querySelector("[data-static-built]")
    }))()`)
    if (!(popupUi?.menuItems >= 90)) fail(`popup 菜单渲染异常: ${popupUi?.menuItems} 个 .menu-item（期望 ≥90）`)
    if (!popupUi?.staticBuilt) fail("popup 静态预构建菜单标记（data-static-built）缺失")
    if (popupPage.exceptions.length > 0) fail(`popup 启动期未捕获异常: ${popupPage.exceptions[0]}`)
    console.log(`${TAG} ✓ popup UI 启动正常（${popupUi.menuItems} 个菜单项，零异常）`)

    // 16. popup 菜单项点按：点'百度'项 → executeMenuAction → 新标签。
    //     popup 的关键字来自活动标签（http 测试页的选区文本），与 #9 的关键字
    //     不同，可区分这次点击开出的标签。等关键字异步到位后再点。
    await wait(800)
    // 只发不等：boot 快速通道点击后会 window.close()，关窗可能赢过 CDP 回包
    popupPage.cdp.call("Runtime.evaluate", {
      expression: `document.querySelector('.menu-item[data-menu-id="ccs-baidu"]')?.click()`
    }).catch(() => { /* target 自关属预期 */ })
    const popupClickTab = await findTarget(port, (t) =>
      t.type === "page" && (t.url || "").includes("baidu.com/s?ie=utf-8&oe=utf-8&wd=" + encodeURIComponent("真实选区捕获冒烟标记")), 8000)
    if (!popupClickTab) fail("popup 点按'百度'项后没开出携带选区关键字的标签")
    console.log(`${TAG} ✓ popup 菜单项点按 → executeMenuAction → 新标签（关键字正确传递）`)
    popupPage.cdp.close() // popup 标签可能已自关，客户端直接丢弃

    // 11+17: sidepanel（新独立标签）
    const spPage = await openUiPage("sidepanel/sidepanel.html")
    const spUi = await evaluate(spPage.cdp, `(() => ({
      menuItems: document.querySelectorAll(".sp-menu-item").length,
      keywordEl: !!document.getElementById("spKeyword"),
      pinEl: !!document.getElementById("spPin")
    }))()`)
    if (!(spUi?.menuItems >= 15)) fail(`sidepanel 菜单渲染异常: ${spUi?.menuItems} 个 .sp-menu-item（期望 ≥15）`)
    if (!spUi?.keywordEl || !spUi?.pinEl) fail(`sidepanel 关键元素缺失: ${JSON.stringify(spUi)}`)
    if (spPage.exceptions.length > 0) fail(`sidepanel 启动期未捕获异常: ${spPage.exceptions[0]}`)
    console.log(`${TAG} ✓ sidepanel UI 启动正常（${spUi.menuItems} 个菜单项，关键元素就位，零异常）`)

    // 17. sidepanel 菜单项点按：点'Google'项。此刻活动标签是 #16 开出的百度页
    //     （真实网络下会重定向），sidepanel 拿到的关键字不可预期 ——
    //     只断言"出现了新的 google 搜索标签"，不锁关键字值。
    await wait(800)
    const googleCount = async () =>
      (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()))
        .filter((t) => t.type === "page" && (t.url || "").includes("google.com/search?q=")).length
    const googleCountBefore = await googleCount()
    spPage.cdp.call("Runtime.evaluate", {
      expression: `document.querySelector('.sp-menu-item[data-menu-id="ccs-google"]')?.click()`
    }).catch(() => { /* target 自关属预期 */ })
    let googleCountAfter = googleCountBefore
    for (let i = 0; i < 40; i++) {
      googleCountAfter = await googleCount()
      if (googleCountAfter > googleCountBefore) break
      await wait(200)
    }
    if (!(googleCountAfter > googleCountBefore)) fail("sidepanel 点按'Google'项后没开出新的 google 搜索标签")
    console.log(`${TAG} ✓ sidepanel 菜单项点按 → executeMenuAction → 新标签`)
    spPage.cdp.close()

    console.log(`${TAG} 全部 OK — build 产物在真 Chrome 里 SW 启动 + 桥接 + 15 条协议/端口/动作/存储/选区/菜单标题路径 + X/知乎站点速答 + 2 个 UI 页面启动 + 2 条 UI 点按实操全通`)
  } finally {
    clearTimeout(watchdog)
    try { httpServer?.close() } catch (_) { /* noop */ }
    try { httpsServer?.close() } catch (_) { /* noop */ }
    browserCdp?.close()
    swCdp?.close()
    pageCdp?.close()
    child.kill("SIGKILL")
    await wait(200)
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(`${TAG} ✗ ${err.message}`)
  process.exit(1)
})
