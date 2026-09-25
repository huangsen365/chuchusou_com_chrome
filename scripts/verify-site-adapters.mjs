#!/usr/bin/env node
/**
 * 站点 DOM 适配器边界守卫
 *
 * 各网站的 DOM 知识（data-testid / 私有 class / 属性名）只能写在该站点的适配器文件里：
 *   ChatGPT      → modules/chatGptDom.js（其它模块经 window.CCSModules.ChatGptDom 取用）
 *   X            → modules/xTweetFastQa.js（读推文 / 长文）、modules/xArticleDraftDelivery.js
 *                  （写长文草稿）、modules/xArticleMainWorld.js（MAIN world，必须自包含）
 *   知乎          → modules/zhihuFastQa.js
 *   Google Docs  → modules/googleDocsRewrite.js
 *
 * 网站改版时只需要改一个地方；新代码要用这些选择器，就从适配器导出，不要复制。
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const root = process.cwd()
const TAG = "[verify-site-adapters]"

const SITES = [
  {
    site: "ChatGPT",
    adapters: ["modules/chatGptDom.js"],
    tokens: [
      "data-message-author-role", "data-chatgpt-", "writing-block", "data-composer-markdown",
      "conversation-turn-", 'data-testid="stop-button"', 'data-testid="send-button"', "fruitjuice", "data-oai-"
    ]
  },
  {
    site: "X",
    adapters: ["modules/xTweetFastQa.js", "modules/xArticleDraftDelivery.js", "modules/xArticleMainWorld.js"],
    tokens: ['data-testid="tweet', "tweetText", "twitterArticle", "twitter-article-"]
  },
  {
    site: "知乎",
    adapters: ["modules/zhihuFastQa.js"],
    tokens: ["RichContent", "ContentItem", "AnswerItem", "Post-RichText", "Post-Main", "Post-Title", "Post-ActionMenuButton"]
  },
  {
    site: "Google Docs",
    adapters: ["modules/googleDocsRewrite.js"],
    tokens: ["docs-titlebar", "kix-"]
  }
]

function listJs(dir) {
  const abs = path.join(root, dir)
  if (!fs.existsSync(abs)) return []
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) return listJs(rel)
    return entry.name.endsWith(".js") && !entry.name.endsWith(".bundle.js") ? [rel] : []
  })
}

const scanned = [
  ...listJs("modules"), ...listJs("content"), ...listJs("shared"), ...listJs("background"),
  ...listJs("popup"), ...listJs("sidepanel"), "content.js", "dockbar.js"
]

const violations = []
for (const { site, adapters, tokens } of SITES) {
  for (const adapter of adapters) {
    if (!fs.existsSync(path.join(root, adapter))) violations.push(`${site} 适配器 ${adapter} 不存在`)
  }
  let found = 0
  for (const file of scanned) {
    const source = fs.readFileSync(path.join(root, file), "utf8")
    for (const token of tokens) {
      if (!source.includes(token)) continue
      if (adapters.includes(file)) found++
      else violations.push(`${file} 出现 ${site} 选择器片段 ${token} —— 应放进 ${adapters.join(" / ")} 并从那里取用`)
    }
  }
  if (!found) violations.push(`${site} 适配器里一个登记的选择器片段都没找到（守卫的 token 表过期了？）`)
}

// ChatGptDom 是 content.js / longArticleActions 等的依赖：manifest 必须先加载它
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"))
const mainScripts = manifest.content_scripts?.find((entry) => (entry.js || []).includes("content.js"))?.js || []
const domIndex = mainScripts.indexOf("modules/chatGptDom.js")
for (const consumer of ["modules/articleRewriteRuntime.js", "modules/chatGptSelectARewrite.js", "modules/longArticleActions.js", "content.js"]) {
  const idx = mainScripts.indexOf(consumer)
  if (domIndex === -1 || idx === -1 || idx < domIndex) violations.push(`manifest 里 modules/chatGptDom.js 必须先于 ${consumer} 加载`)
}
// content.js 单独补注入时也要带上 chatGptDom.js
const reinject = fs.readFileSync(path.join(root, "background/events/menuState.js"), "utf8")
if (!reinject.includes("'modules/chatGptDom.js', 'content.js']")) {
  violations.push("background/events/menuState.js 补注入 content.js 时必须先注入 modules/chatGptDom.js")
}

if (violations.length) {
  for (const v of violations) console.error(`${TAG} ✗ ${v}`)
  process.exit(1)
}
console.log(`${TAG} ✓ ${SITES.length} 个站点的 DOM 选择器都只在各自适配器里（扫描 ${scanned.length} 个文件）`)
