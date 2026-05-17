#!/usr/bin/env node
/**
 * popup 菜单结构预编译
 *
 * 编译时把 6 个 JSON config 跑一遍 CCSMenuStructureBuilder，输出
 * `popup/popup-menu-prebuilt.json` 单文件。popup 启动时优先 fetch 这一个文件
 * （~5-15ms），fallback 才是 6 个 fetch + builder（~30-50ms）。
 *
 * 二选一的考量：
 *  - 预编译产物体积约 30-50KB，对 popup 来说是一次性加载
 *  - 不依赖 SW（不像之前的 storage prewarm 路径）
 *  - 与 popup.html 静态骨架配合：骨架先出，prebuilt 拉回来后补差异
 *
 * 输出：popup/popup-menu-prebuilt.json + build/chrome-mv3-prod/popup/popup-menu-prebuilt.json
 * 失败时不中断 build —— popup 仍有 6 fetch + builder fallback。
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import vm from "node:vm"

const root = process.cwd()
const buildDir = path.resolve(root, process.argv[2] || "build/chrome-mv3-prod")

function loadJSON(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"))
  } catch (e) {
    console.warn(`[prebuild-popup-menu] 加载 ${rel} 失败:`, e.message)
    return null
  }
}

function loadBuilder() {
  const src = fs.readFileSync(path.join(root, "shared/menuStructureBuilder.js"), "utf8")
  const sandbox = { globalThis: {}, console }
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox)
  return sandbox.globalThis.CCSMenuStructureBuilder
}

function escapeHTML(s) {
  if (typeof s !== "string") return ""
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[c])
}

// 跟 popup.js createMenuItem / createSubmenu 输出对齐，让 popup.js 跳过 render() 不影响交互
function itemAttrs(item) {
  const attrs = [
    `data-menu-id="${escapeHTML(item.id || "")}"`,
    `data-menu-type="${escapeHTML(item.type || "")}"`
  ]
  if (item.urlPattern) attrs.push(`data-url-pattern="${escapeHTML(item.urlPattern)}"`)
  if (item.action) attrs.push(`data-action="${escapeHTML(item.action)}"`)
  if (item.engineId) attrs.push(`data-engine-id="${escapeHTML(item.engineId)}"`)
  if (item.purpose) attrs.push(`data-purpose="${escapeHTML(item.purpose)}"`)
  return attrs.join(" ")
}

function renderSubmenu(children, parentId, level) {
  if (!children?.length) return ""
  const childHTML = children.map((child) => {
    const hasGrand = child.children && child.children.length > 0
    const cls = `menu-item submenu-item level-${level}${hasGrand ? " has-children" : ""}`
    const arrow = hasGrand ? "<span class=\"item-arrow\">▶</span>" : ""
    return [
      `<div class="${cls}" ${itemAttrs(child)}>`,
      `<span class="item-icon">${escapeHTML(child.icon || "")}</span>`,
      `<span class="item-title">${escapeHTML(child.title || "")}</span>`,
      arrow,
      `</div>`,
      renderSubmenu(child.children, child.id, level + 1)
    ].join("")
  }).join("")
  return `<div class="submenu collapsed" data-parent-id="${escapeHTML(parentId)}" data-level="${level}">${childHTML}</div>`
}

function renderMenuItem(item) {
  const hasChildren = item.children && item.children.length > 0
  const cls = `menu-item${hasChildren ? " has-children" : ""}`
  const arrow = hasChildren ? "<span class=\"item-arrow\">▶</span>" : ""
  // popup.js 对 fastqa-quick 类有特殊标题简化逻辑，这里同步处理
  let displayTitle = item.title || ""
  if (item.type === "fastqa-quick") {
    const m = displayTitle.match(/- (.+)$/)
    if (m) displayTitle = `速答 · ${m[1]}`
  }
  return [
    `<div class="${cls}" ${itemAttrs(item)}>`,
    `<span class="item-icon">${escapeHTML(item.icon || "")}</span>`,
    `<span class="item-title">${escapeHTML(displayTitle)}</span>`,
    arrow,
    `</div>`,
    hasChildren ? renderSubmenu(item.children, item.id, 1) : ""
  ].join("")
}

function renderStaticMenu(structure) {
  const parts = []
  structure.groups.forEach((group, idx) => {
    if (group.id === "panel") return
    if (group.separator === "before" && idx > 0) parts.push("<div class=\"menu-separator\"></div>")
    if (group.items) {
      group.items.forEach((item) => {
        if (item.enabled === false) return
        parts.push(renderMenuItem(item))
      })
    }
    if (group.separator === "after") parts.push("<div class=\"menu-separator\"></div>")
  })
  return parts.join("\n      ")
}

// sidepanel 渲染：扁平、只渲染 leaf 节点（无子菜单），用 sp-* class
function renderSidepanelMenu(structure) {
  const parts = []
  let lastGroupHadItems = false
  structure.groups.forEach((group) => {
    if (group.id === "panel") return
    if (!group.items) return
    const leafs = group.items.filter((it) => it.enabled !== false && !(it.children && it.children.length > 0))
    if (leafs.length === 0) return
    if (lastGroupHadItems) parts.push("<div class=\"sp-separator\"></div>")
    leafs.forEach((item) => {
      let displayTitle = item.title || ""
      if (item.type === "fastqa-quick") {
        const m = displayTitle.match(/- (.+)$/)
        if (m) displayTitle = `速答 · ${m[1]}`
      }
      parts.push([
        `<div class="sp-menu-item" ${itemAttrs(item)}>`,
        `<span class="sp-item-icon">${escapeHTML(item.icon || "")}</span>`,
        `<span class="sp-item-title">${escapeHTML(displayTitle)}</span>`,
        `</div>`
      ].join(""))
    })
    lastGroupHadItems = true
  })
  return parts.join("\n      ")
}

function injectStaticMenu(htmlPath, menuHTML, opts = {}) {
  const containerId = opts.containerId || "menuContainer"
  const containerClass = opts.containerClass || "menu-container"
  const html = fs.readFileSync(htmlPath, "utf8")
  const startRegex = new RegExp(`<div\\s+class="${containerClass}"\\s+id="${containerId}">`)
  const startMatch = html.match(startRegex)
  if (!startMatch) return false
  const startIdx = startMatch.index
  const openEnd = startIdx + startMatch[0].length
  // stack-match the closing </div>
  let depth = 1
  let i = openEnd
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf("<div", i)
    const nextClose = html.indexOf("</div>", i)
    if (nextClose === -1) return false
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i = nextOpen + 4
    } else {
      depth--
      i = nextClose + 6
      if (depth === 0) {
        const before = html.slice(0, startIdx)
        const after = html.slice(i)
        const newOpen = `<div class="${containerClass}" id="${containerId}" data-static-built="true">`
        const replacement = `${newOpen}\n      ${menuHTML}\n    </div>`
        fs.writeFileSync(htmlPath, before + replacement + after, "utf8")
        return true
      }
    }
  }
  return false
}

function main() {
  const builder = loadBuilder()
  if (!builder || typeof builder.build !== "function") {
    console.warn("[prebuild-popup-menu] menuStructureBuilder 未导出 build")
    process.exit(0)
  }

  const unifiedConfig = loadJSON("config/unifiedMenuConfig.json")
  const enginesConfig = loadJSON("config/engines.json")
  const top100Config = loadJSON("prompts/topQuestionsPrompts.json")
  const fastqaConfig = loadJSON("prompts/fastAnswersPrompts.json")
  const optimizeConfig = loadJSON("prompts/optimizedPrompts.json")
  const coverConfig = loadJSON("prompts/coverPrompts.json")

  if (!unifiedConfig) {
    console.warn("[prebuild-popup-menu] unifiedMenuConfig 缺失，跳过")
    process.exit(0)
  }

  const structure = builder.build({
    unifiedConfig,
    enginesConfig,
    top100Config,
    fastqaConfig,
    optimizeConfig,
    coverConfig
  })

  if (!structure || !Array.isArray(structure.groups) || structure.groups.length === 0) {
    console.warn("[prebuild-popup-menu] builder 输出空 structure，跳过")
    process.exit(0)
  }

  // v1.6.19 Step 10：完全删除 popup-menu-prebuilt.json 输出。popup.js / sidepanel.js
  // 不再读这个文件 —— 静态 HTML 注入已经是 SSoT，coverConfig 由各自直接 fetch。
  // 把完整菜单 HTML 注入到 build 的 popup.html / sidepanel.html，
  // 让生产环境 popup/sidepanel 打开时 container 直接是完整菜单（零 JS DOM 构建）。
  // popup.js / sidepanel.js 检测 data-static-built 跳过 render() 节省 ~5-20ms。
  const popupPath = path.join(buildDir, "popup/popup.html")
  if (fs.existsSync(popupPath)) {
    if (injectStaticMenu(popupPath, renderStaticMenu(structure))) {
      console.log("[prebuild-popup-menu] ✓ 静态菜单注入 → popup/popup.html (data-static-built)")
    } else {
      console.warn("[prebuild-popup-menu] ⚠ popup/popup.html 找不到 menuContainer 标记，跳过注入")
    }
  }
  // popup-v2 共用同一份 hierarchical 菜单 HTML（容器 id/class 与旧 popup 完全一致）
  const popupV2Path = path.join(buildDir, "popup-v2/popup.html")
  if (fs.existsSync(popupV2Path)) {
    if (injectStaticMenu(popupV2Path, renderStaticMenu(structure))) {
      console.log("[prebuild-popup-menu] ✓ 静态菜单注入 → popup-v2/popup.html (data-static-built)")
    } else {
      console.warn("[prebuild-popup-menu] ⚠ popup-v2/popup.html 找不到 menuContainer 标记，跳过注入")
    }
  }
  const sidepanelPath = path.join(buildDir, "sidepanel/sidepanel.html")
  if (fs.existsSync(sidepanelPath)) {
    if (injectStaticMenu(sidepanelPath, renderSidepanelMenu(structure), {
      containerId: "spMenu",
      containerClass: "sp-menu"
    })) {
      console.log("[prebuild-popup-menu] ✓ 静态菜单注入 → sidepanel/sidepanel.html (data-static-built)")
    } else {
      console.warn("[prebuild-popup-menu] ⚠ sidepanel/sidepanel.html 找不到 spMenu 标记，跳过注入")
    }
  }
  // sidepanel-v2 共用同一份 flat sidepanel 菜单 HTML（容器 id/class 与旧版完全一致）
  const sidepanelV2Path = path.join(buildDir, "sidepanel-v2/sidepanel.html")
  if (fs.existsSync(sidepanelV2Path)) {
    if (injectStaticMenu(sidepanelV2Path, renderSidepanelMenu(structure), {
      containerId: "spMenu",
      containerClass: "sp-menu"
    })) {
      console.log("[prebuild-popup-menu] ✓ 静态菜单注入 → sidepanel-v2/sidepanel.html (data-static-built)")
    } else {
      console.warn("[prebuild-popup-menu] ⚠ sidepanel-v2/sidepanel.html 找不到 spMenu 标记，跳过注入")
    }
  }
}

main()
