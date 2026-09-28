#!/usr/bin/env node
/**
 * 把 prompts/cover/*.json（一个风格一个文件）组装成 build 里的 prompts/coverPrompts.json，
 * 并删掉 build 里复制过去的 prompts/cover/ 源文件（运行时只读组装结果）。
 * 在 plasmo:build 里紧跟 plasmo-compat-postbuild 运行。
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { COVER_STYLE_DIR, writeAssembledCoverPrompts } from "./lib/coverStyles.mjs"

const root = process.cwd()
const buildDir = path.resolve(root, process.argv[2] || "build/chrome-mv3-prod")

if (!fs.existsSync(buildDir)) {
  console.error(`[build-cover-prompts] build dir 不存在: ${buildDir}（先跑 plasmo build + postbuild）`)
  process.exit(1)
}
const { count } = writeAssembledCoverPrompts(root, buildDir)
fs.rmSync(path.join(buildDir, COVER_STYLE_DIR), { recursive: true, force: true })
console.log(`[build-cover-prompts] ✓ ${count} 个封面风格 → prompts/coverPrompts.json`)
