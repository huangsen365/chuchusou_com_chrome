/**
 * 守卫脚本读取提示词：prompts/*.json 的 templateFile 指向同目录 Markdown 正文，
 * 与运行时 shared/promptTemplate.js 相同的规则展开（去掉结尾一个换行、CRLF → LF）。
 */

import fs from "node:fs"
import path from "node:path"

export function markdownToTemplate(text) {
  const normalized = String(text).replace(/\r\n?/g, "\n")
  return normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized
}

// 返回展开后的 config（templateLines 已填好）与 template 字符串
export function readPromptConfig(root, jsonRel) {
  const config = JSON.parse(fs.readFileSync(path.join(root, jsonRel), "utf8"))
  if (typeof config.templateFile === "string" && config.templateFile) {
    const mdPath = path.join(path.dirname(path.join(root, jsonRel)), config.templateFile)
    config.templateLines = markdownToTemplate(fs.readFileSync(mdPath, "utf8")).split("\n")
  }
  const template = Array.isArray(config.templateLines) ? config.templateLines.join("\n") : (config.template || "")
  return { config, template }
}

// 给 node:vm 里的扩展代码用的 fetch 桩：chrome.runtime.getURL 产出的路径 → 仓库文件
export function createRepoFetch(root, { prefix = "" } = {}) {
  return async (url) => {
    const rel = String(url).startsWith(prefix) ? String(url).slice(prefix.length) : String(url)
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) return { ok: false, status: 404, json: async () => null, text: async () => "" }
    const body = fs.readFileSync(abs, "utf8")
    return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body }
  }
}
