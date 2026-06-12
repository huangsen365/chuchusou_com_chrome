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
 *     selectionChanged → getKeyword 选区回路 / executeMenuAction search
 *     真开新标签且 URL 走 SSoT 模板
 *
 * 优雅跳过条件（不 brick npm test 链）：无全局 WebSocket（Node 21+ 才有）/
 * 找不到 Chrome / build 目录不存在。跳过时打 ⚠ 警告；真跑挂了则硬性报错。
 */

import fs from "node:fs"
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
  console.error(`${TAG} ✗ ${msg}`)
  process.exit(1)
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
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] })

  let browserCdp = null
  let swCdp = null
  let pageCdp = null
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

    // 8. selectionChanged → getKeyword 回路（选区状态链）
    const selection = await evaluate(pageCdp, `
      (async () => {
        const tab = await new Promise((res) => chrome.tabs.getCurrent(res));
        chrome.runtime.sendMessage({ action: "selectionChanged", text: "选区冒烟测试", trigger: "smoke" });
        await new Promise((r) => setTimeout(r, 800));
        const resp = await new Promise((res) =>
          chrome.runtime.sendMessage(
            { action: "getKeyword", tabId: tab.id, url: tab.url, title: tab.title, intent: "popup-open" },
            res
          ));
        return { raw: resp?.raw || "", text: resp?.text || "", source: resp?.source || "" };
      })()
    `)
    if (!selection?.raw?.includes("选区冒烟测试") && !selection?.text?.includes("选区冒烟测试")) {
      fail(`selectionChanged → getKeyword 回路失败: ${JSON.stringify(selection)}`)
    }
    console.log(`${TAG} ✓ selectionChanged → getKeyword 选区回路正常（source: ${selection.source}）`)

    // 9. executeMenuAction（search 走 SSoT 快速通道）→ 真开新标签且 URL 正确
    const exec = await evaluate(pageCdp, `
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ __timeout: true }), 8000);
        // 按生产消息契约（popup/sidepanel 同款）：search 类必须带 urlPattern
        chrome.runtime.sendMessage(
          {
            action: "executeMenuAction", menuItemId: "ccs-baidu", menuType: "search",
            keyword: "冒烟smoke123", urlPattern: "https://www.baidu.com/s?wd=\${KEYWORD}"
          },
          (resp) => { clearTimeout(timer); resolve({ success: resp?.success === true, raw: resp }); }
        );
      })
    `)
    if (exec?.__timeout || !exec?.success) fail(`executeMenuAction 失败: ${JSON.stringify(exec?.raw || exec)}`)
    const expectedUrlPart = "baidu.com/s?wd=" + encodeURIComponent("冒烟smoke123")
    const newTab = await findTarget(port, (t) => t.type === "page" && (t.url || "").includes(expectedUrlPart), 8000)
    if (!newTab) fail(`executeMenuAction 后找不到 URL 含 ${expectedUrlPart} 的新标签 —— URLBuilder/tryOpenMenuUrl 链路断了`)
    console.log(`${TAG} ✓ executeMenuAction 真开新标签且 URL 正确（SSoT URLBuilder 链路通）`)

    // 10+11. popup / sidepanel UI 启动回归（历史事故："商店版 popup 卡顿/白屏"）：
    //    页面当 tab 打开 → 静态预构建菜单渲染齐全 + 关键元素就位 + 启动零未捕获异常
    const pageExceptions = []
    pageCdp.on("Runtime.exceptionThrown", (p) => {
      pageExceptions.push(p?.exceptionDetails?.exception?.description || p?.exceptionDetails?.text || "unknown")
    })

    await pageCdp.call("Page.navigate", { url: `chrome-extension://${extensionId}/popup/popup.html` })
    await wait(1200)
    const popupUi = await evaluate(pageCdp, `(() => ({
      menuItems: document.querySelectorAll(".menu-item").length,
      staticBuilt: !!document.querySelector("[data-static-built]"),
      keywordEl: !!document.getElementById("currentKeyword") || !!document.querySelector(".keyword, #keyword, [class*='keyword']")
    }))()`)
    if (!(popupUi?.menuItems >= 90)) fail(`popup 菜单渲染异常: ${popupUi?.menuItems} 个 .menu-item（期望 ≥90）`)
    if (!popupUi?.staticBuilt) fail("popup 静态预构建菜单标记（data-static-built）缺失")
    if (pageExceptions.length > 0) fail(`popup 启动期未捕获异常: ${pageExceptions[0]}`)
    console.log(`${TAG} ✓ popup UI 启动正常（${popupUi.menuItems} 个菜单项，零异常）`)

    await pageCdp.call("Page.navigate", { url: `chrome-extension://${extensionId}/sidepanel/sidepanel.html` })
    await wait(1200)
    const spUi = await evaluate(pageCdp, `(() => ({
      menuItems: document.querySelectorAll(".sp-menu-item").length,
      keywordEl: !!document.getElementById("spKeyword"),
      pinEl: !!document.getElementById("spPin")
    }))()`)
    if (!(spUi?.menuItems >= 15)) fail(`sidepanel 菜单渲染异常: ${spUi?.menuItems} 个 .sp-menu-item（期望 ≥15）`)
    if (!spUi?.keywordEl || !spUi?.pinEl) fail(`sidepanel 关键元素缺失: ${JSON.stringify(spUi)}`)
    if (pageExceptions.length > 0) fail(`sidepanel 启动期未捕获异常: ${pageExceptions[0]}`)
    console.log(`${TAG} ✓ sidepanel UI 启动正常（${spUi.menuItems} 个菜单项，关键元素就位，零异常）`)

    console.log(`${TAG} 全部 OK — build 产物在真 Chrome 里 SW 启动 + 桥接 + 9 条消息/端口/动作路径 + 2 个 UI 页面启动全通`)
  } finally {
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
