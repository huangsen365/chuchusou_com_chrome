#!/usr/bin/env node
/**
 * Structural verifier for DOM-bound TS modules.
 *
 * These modules depend on document / window / navigator and cannot be dual-run
 * without a full jsdom setup. Instead, we verify:
 *  1. TS module compiles + exposes expected names
 *  2. Class instances have expected method signatures
 *  3. Pure static functions on TS module match legacy behavior (where possible)
 *
 * Covered:
 *  - content/TextEncoder.js           ↔ src/content/TextEncoder.ts (CCSTextEncoder)
 *  - content/ClipboardHelper.js       ↔ src/content/ClipboardHelper.ts
 *  - content/ToastUI.js               ↔ src/content/ToastUI.ts
 *  - content/SelectionManager.js      ↔ src/content/SelectionManager.ts
 *  - popup/modules/ToastHelper.js     ↔ src/popup/modules/ToastHelper.ts
 *  - popup/modules/MenuRenderer.js    ↔ src/popup/modules/MenuRenderer.ts
 */

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import vm from "node:vm"
import { createRequire } from "node:module"
import ts from "typescript"

const root = process.cwd()
const nodeRequire = createRequire(import.meta.url)

function assert(c, m) { if (!c) throw new Error(m) }

function createTsLoader() {
  const cache = new Map()
  function load(absPath) {
    if (cache.has(absPath)) return cache.get(absPath).exports
    const source = fs.readFileSync(absPath, "utf8")
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, isolatedModules: true },
      fileName: absPath
    })
    const moduleObj = { exports: {} }
    cache.set(absPath, moduleObj)
    const customRequire = (spec) => {
      if (spec.startsWith(".")) {
        const base = path.resolve(path.dirname(absPath), spec)
        const cands = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]
        for (const c of cands) if (fs.existsSync(c) && fs.statSync(c).isFile()) return load(c)
        throw new Error(`Cannot resolve "${spec}" from ${absPath}`)
      }
      return nodeRequire(spec)
    }
    const ctx = {
      module: moduleObj, exports: moduleObj.exports, require: customRequire, console,
      globalThis: {},
      URL, URLSearchParams, Date, Map, Set, Proxy, RegExp, Error,
      Promise, Array, Object, JSON, Number, Boolean, String, Math,
      setInterval: () => 0, clearInterval: () => {}, setTimeout, clearTimeout,
      parseInt, parseFloat, isNaN, isFinite,
      encodeURIComponent, decodeURIComponent, atob, btoa,
      // 为 TextEncoder 提供 escape/unescape（legacy 用了）
      escape: globalThis.escape, unescape: globalThis.unescape,
      Symbol,
      // navigator / document / window 在 structural test 阶段不实际调用
      navigator: { clipboard: null },
      document: null,
      window: null
    }
    vm.createContext(ctx)
    vm.runInContext(compiled.outputText, ctx, { filename: absPath })
    return moduleObj.exports
  }
  return load
}

function verifyHasMethods(name, instance, methods) {
  for (const m of methods) {
    assert(typeof instance[m] === "function", `${name}.${m} must be a function (got ${typeof instance[m]})`)
  }
}

function main() {
  const loadTs = createTsLoader()

  // ============ TextEncoder ============
  const tsEnc = loadTs(path.join(root, "src/content/TextEncoder.ts"))
  const Encoder = tsEnc.CCSTextEncoder || tsEnc.default
  assert(Encoder, "CCSTextEncoder must be exported")
  for (const m of ["encodeBase64", "decodeBase64", "encodeURL", "decodeURL", "pseudoMD5", "toUpperCase", "toLowerCase", "runCommand"]) {
    assert(typeof Encoder[m] === "function", `CCSTextEncoder.${m} must be a static function`)
  }
  // 跑几条纯函数 case
  assert(Encoder.encodeBase64("hello") === "aGVsbG8=", "encodeBase64('hello')")
  assert(Encoder.decodeBase64("aGVsbG8=") === "hello", "decodeBase64('aGVsbG8=')")
  assert(Encoder.encodeURL("a b") === "a%20b", "encodeURL")
  assert(Encoder.decodeURL("a%20b") === "a b", "decodeURL")
  assert(Encoder.toUpperCase("abc") === "ABC", "toUpperCase")
  assert(Encoder.toLowerCase("ABC") === "abc", "toLowerCase")
  assert(Encoder.pseudoMD5("test").length === 32, "pseudoMD5 length")
  assert(Encoder.pseudoMD5("") === "00000000000000000000000000000000", "pseudoMD5 empty")
  assert(Encoder.runCommand("base64", "x") === Encoder.encodeBase64("x"), "runCommand base64")
  assert(Encoder.runCommand("unknown", "x") === null, "runCommand unknown")

  // ============ ClipboardHelper ============
  const tsClip = loadTs(path.join(root, "src/content/ClipboardHelper.ts"))
  const Clipboard = tsClip.ClipboardHelper || tsClip.default
  assert(Clipboard, "ClipboardHelper must be exported")
  for (const m of ["copy", "read", "isClipboardAPISupported"]) {
    assert(typeof Clipboard[m] === "function", `ClipboardHelper.${m}`)
  }
  // navigator.clipboard 是 null，isClipboardAPISupported 应返回 false
  assert(Clipboard.isClipboardAPISupported() === false, "isClipboardAPISupported when no API")

  // ============ ToastUI ============
  const tsToastUI = loadTs(path.join(root, "src/content/ToastUI.ts"))
  const Toast = tsToastUI.Toast || tsToastUI.default
  assert(Toast, "Toast class must be exported")
  // 不能 new (DOM 在 ctx 里是 null)，但 prototype 方法应存在
  for (const m of ["show", "info", "success", "error", "warning", "showContextMenuToast"]) {
    assert(typeof Toast.prototype[m] === "function", `Toast.prototype.${m}`)
  }

  // ============ SelectionManager ============
  const tsSel = loadTs(path.join(root, "src/content/SelectionManager.ts"))
  const Sel = tsSel.SelectionManager || tsSel.default
  assert(Sel, "SelectionManager must be exported")
  for (const m of ["readCurrentSelection", "applySelection", "updateSelection", "getPreferredText", "getSnapshot", "setUserSelecting", "isSelecting"]) {
    assert(typeof Sel.prototype[m] === "function", `SelectionManager.prototype.${m}`)
  }

  // ============ popup/modules/ToastHelper ============
  const tsPopupToast = loadTs(path.join(root, "src/popup/modules/ToastHelper.ts"))
  const PopupToast = tsPopupToast.ToastHelper || tsPopupToast.default
  assert(PopupToast, "popup ToastHelper must be exported")
  for (const m of ["show", "info", "success", "error", "warning"]) {
    assert(typeof PopupToast.prototype[m] === "function", `popup ToastHelper.prototype.${m}`)
  }

  // ============ popup/modules/MenuRenderer ============
  const tsRenderer = loadTs(path.join(root, "src/popup/modules/MenuRenderer.ts"))
  const Renderer = tsRenderer.MenuRenderer || tsRenderer.default
  assert(Renderer, "MenuRenderer must be exported")
  for (const m of ["render", "showError"]) {
    assert(typeof Renderer.prototype[m] === "function", `MenuRenderer.prototype.${m}`)
  }

  // ============ content-modules: blacklist / toast / commands / buttonDefinitions / textSync ============
  const tsBlacklist = loadTs(path.join(root, "src/content-modules/blacklist.ts"))
  const BlacklistMgr = tsBlacklist.BlacklistManager
  assert(BlacklistMgr, "BlacklistManager must be exported")
  for (const m of ["init", "check", "add", "remove", "toggle", "getCurrentStatus", "clear", "getList", "setList", "contains"]) {
    assert(typeof BlacklistMgr.prototype[m] === "function", `BlacklistManager.${m}`)
  }
  // 跑纯函数（不需 window）：add / remove / getList / contains / setList
  const bl = Object.create(BlacklistMgr.prototype)
  bl.list = []
  bl.isBlacklisted = false
  bl.originalMode = "normal"
  assert(bl.add("example.com") === true, "blacklist.add new")
  assert(bl.add("example.com") === false, "blacklist.add dup")
  assert(bl.contains("example.com") === true, "blacklist.contains")
  assert(bl.remove("example.com") === true, "blacklist.remove")
  assert(bl.remove("example.com") === false, "blacklist.remove dup")
  assert(bl.setList(["a.com", "b.com"]) === true, "blacklist.setList")
  assert(JSON.stringify(bl.getList()) === '["a.com","b.com"]', "blacklist.getList")

  const tsContentToast = loadTs(path.join(root, "src/content-modules/toast.ts"))
  const ContentToast = tsContentToast.CCSContentToast
  assert(ContentToast, "CCSContentToast must be exported")
  for (const m of ["show", "success", "error", "warning", "info", "showContextMenuToast", "clearAll"]) {
    assert(typeof ContentToast.prototype[m] === "function", `CCSContentToast.${m}`)
  }

  const tsCommands = loadTs(path.join(root, "src/content-modules/commands.ts"))
  const CmdMgr = tsCommands.CommandsManager
  assert(CmdMgr, "CommandsManager must be exported")
  const cm = new CmdMgr()
  assert(cm.getCommandList().includes("base64"), "cm.getCommandList base64")
  assert(cm.getCommandList().includes("md5"), "cm.getCommandList md5")
  assert(cm.execute("upper", ["hello"]) === "HELLO", "cm upper")
  assert(cm.execute("lower", ["HELLO"]) === "hello", "cm lower")
  assert(cm.execute("base64", ["hello"]) === "aGVsbG8=", "cm base64")
  assert(cm.execute("base64", ["-d", "aGVsbG8="]) === "hello", "cm base64 decode")
  assert(cm.execute("url", ["a b"]) === "a%20b", "cm url enc")
  assert(cm.execute("url", ["decode", "a%20b"]) === "a b", "cm url dec")
  assert(cm.execute("nonexistent", []) === null, "cm unknown")
  assert(cm.isValidCommand("base64") === true, "cm isValid")
  assert(cm.isValidCommand("x") === false, "cm isValid x")
  const p1 = cm.parseAndExecute("/upper hello", "")
  assert(p1?.success === true && p1.result === "HELLO", "cm parse /upper")
  const p2 = cm.parseAndExecute("/unknown")
  assert(p2?.success === false, "cm parse unknown")
  assert(cm.parseAndExecute("") === null, "cm parse empty")
  assert(cm.parseAndExecute("not slash") === null, "cm parse not slash")

  const tsBtnDef = loadTs(path.join(root, "src/content-modules/buttonDefinitions.ts"))
  const BtnDefMgr = tsBtnDef.ButtonDefinitionsManager
  assert(BtnDefMgr, "ButtonDefinitionsManager must be exported")
  const bd = Object.create(BtnDefMgr.prototype)
  assert(JSON.stringify(bd.getMiniModeButtons()) === '["baidu","google","chuchusou","copy","lowercase"]', "bd miniMode")
  assert(JSON.stringify(bd.getNormalModeButtons()) === '["baidu","google","chatgpt","chuchusou","copy"]', "bd normalMode")
  assert(bd.isSearchEngineButton("baidu") === true, "bd isSearchEngine")
  assert(bd.isToolButton("copy") === true, "bd isTool")

  const tsTextSync = loadTs(path.join(root, "src/content-modules/textSync.ts"))
  const TSMgr = tsTextSync.TextSyncManager
  assert(TSMgr, "TextSyncManager must be exported")
  const ts2 = Object.create(TSMgr.prototype)
  ts2.selectedText = ""
  ts2.lastNonEmptySelection = ""
  ts2.shadowRoot = null
  assert(ts2.setSelectedText("hi") === "hi", "ts setSelectedText")
  assert(ts2.getSelectedText() === "hi", "ts getSelectedText")
  assert(ts2.setLastNonEmptySelection("foo") === "foo", "ts setLast")
  assert(ts2.setLastNonEmptySelection("") === "foo", "ts setLast empty keep")
  assert(ts2.getLastNonEmptySelection() === "foo", "ts getLast")

  console.log("[verify-dom-modules-structural] 11 DOM/content TS modules OK")
}

main()
