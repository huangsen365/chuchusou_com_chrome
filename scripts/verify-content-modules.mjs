#!/usr/bin/env node
/**
 * 内容脚本纯逻辑模块的行为回归（直接跑 manifest 实际注入的 legacy 文件）：
 *  - content/TextEncoder.js       编码 / 伪 MD5 / runCommand
 *  - modules/commands.js          斜杠命令解析与执行
 *  - modules/blacklist.js         黑名单增删查
 *  - modules/buttonDefinitions.js 默认按钮组合
 *  - modules/textSync.js          选区文本缓存
 *
 * 这些模块依赖 window 但以上路径不碰 DOM，在 node:vm 里给一个最小 window 即可。
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import vm from "node:vm"

const root = process.cwd()

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function loadContentModules(files) {
  const win = {
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    atob, btoa, escape, unescape, encodeURIComponent, decodeURIComponent,
    navigator: { clipboard: null },
    location: { hostname: "example.com", href: "https://example.com/" },
    chrome: { runtime: { sendMessage() {}, onMessage: { addListener() {} } }, storage: { local: { get() {}, set() {} } } },
    document: { querySelector: () => null, addEventListener() {} },
    setTimeout, clearTimeout
  }
  win.window = win
  win.self = win
  win.globalThis = win
  vm.createContext(win)
  for (const rel of files) {
    const abs = path.join(root, rel)
    vm.runInContext(fs.readFileSync(abs, "utf8"), win, { filename: abs })
  }
  return win
}

const win = loadContentModules([
  "content/TextEncoder.js",
  "modules/commands.js",
  "modules/blacklist.js",
  "modules/buttonDefinitions.js",
  "modules/textSync.js"
])
const { TextEncoder: Encoder, Commands, Blacklist, ButtonDefinitions, TextSync } = win.CCSModules

// ============ TextEncoder ============
assert(Encoder, "CCSModules.TextEncoder must be exposed")
assert(Encoder.encodeBase64("hello") === "aGVsbG8=", "encodeBase64('hello')")
assert(Encoder.decodeBase64("aGVsbG8=") === "hello", "decodeBase64('aGVsbG8=')")
assert(Encoder.decodeBase64(Encoder.encodeBase64("中文 ok")) === "中文 ok", "base64 round-trips CJK text")
assert(Encoder.encodeURL("a b") === "a%20b", "encodeURL")
assert(Encoder.decodeURL("a%20b") === "a b", "decodeURL")
assert(Encoder.toUpperCase("abc") === "ABC", "toUpperCase")
assert(Encoder.toLowerCase("ABC") === "abc", "toLowerCase")
assert(Encoder.pseudoMD5("test").length === 32, "pseudoMD5 length")
assert(Encoder.pseudoMD5("test") === Encoder.pseudoMD5("test"), "pseudoMD5 deterministic")
assert(Encoder.runCommand("base64", "x") === Encoder.encodeBase64("x"), "runCommand base64")
assert(Encoder.runCommand("unknown", "x") === null, "runCommand unknown")

// ============ Commands ============
assert(Commands, "CCSModules.Commands must be exposed")
assert(Commands.getCommandList().includes("base64"), "command list has base64")
assert(Commands.getCommandList().includes("md5"), "command list has md5")
assert(Commands.execute("upper", ["hello"]) === "HELLO", "upper")
assert(Commands.execute("lower", ["HELLO"]) === "hello", "lower")
assert(Commands.execute("base64", ["hello"]) === "aGVsbG8=", "base64 encode")
assert(Commands.execute("base64", ["-d", "aGVsbG8="]) === "hello", "base64 decode")
assert(Commands.execute("url", ["a b"]) === "a%20b", "url encode")
assert(Commands.execute("url", ["decode", "a%20b"]) === "a b", "url decode")
assert(Commands.execute("nonexistent", []) === null, "unknown command")
assert(Commands.isValidCommand("base64") === true, "isValidCommand base64")
assert(Commands.isValidCommand("x") === false, "isValidCommand x")
const parsed = Commands.parseAndExecute("/upper hello", "")
assert(parsed?.success === true && parsed.result === "HELLO", "parse /upper")
assert(Commands.parseAndExecute("/unknown")?.success === false, "parse unknown")
assert(Commands.parseAndExecute("") === null, "parse empty")
assert(Commands.parseAndExecute("not slash") === null, "parse not slash")

// ============ Blacklist ============
assert(Blacklist, "CCSModules.Blacklist must be exposed")
Blacklist.list = []
assert(Blacklist.add("example.com") === true, "blacklist add new")
assert(Blacklist.add("example.com") === false, "blacklist add duplicate")
assert(Blacklist.contains("example.com") === true, "blacklist contains")
assert(Blacklist.remove("example.com") === true, "blacklist remove")
assert(Blacklist.remove("example.com") === false, "blacklist remove missing")
Blacklist.setList(["a.com", "b.com"])
assert(JSON.stringify(Blacklist.getList()) === '["a.com","b.com"]', "blacklist getList")

// ============ ButtonDefinitions ============
assert(ButtonDefinitions, "CCSModules.ButtonDefinitions must be exposed")
assert(JSON.stringify(ButtonDefinitions.getMiniModeButtons()) === '["baidu","google","chuchusou","copy","lowercase"]', "mini mode buttons")
assert(JSON.stringify(ButtonDefinitions.getNormalModeButtons()) === '["baidu","google","chatgpt","chuchusou","copy"]', "normal mode buttons")
for (const id of [...ButtonDefinitions.getMiniModeButtons(), ...ButtonDefinitions.getNormalModeButtons()]) {
  assert(ButtonDefinitions.getButtonById(id), `default button "${id}" must be defined`)
}

// ============ TextSync ============
assert(TextSync, "CCSModules.TextSync must be exposed")
TextSync.setSelectedText("hi")
assert(TextSync.getSelectedText() === "hi", "TextSync selected text")
TextSync.setLastNonEmptySelection("foo")
TextSync.setLastNonEmptySelection("")
assert(TextSync.getLastNonEmptySelection() === "foo", "TextSync keeps last non-empty selection")

console.log("[verify-content-modules] TextEncoder + Commands + Blacklist + ButtonDefinitions + TextSync OK")
