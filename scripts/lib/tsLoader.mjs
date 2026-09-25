/**
 * 在 node:vm 里加载 src/ 下的 TS 模块（typescript.transpileModule + 递归 CJS resolver）。
 * 供守卫脚本单测 SW bundle 实际打包的 TS 模块。
 */

import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { createRequire } from "node:module"
import ts from "typescript"

const nodeRequire = createRequire(import.meta.url)

export function createTsLoader({ context: extraContext = {} } = {}) {
  const cache = new Map()

  function load(absPath) {
    if (cache.has(absPath)) return cache.get(absPath).exports
    const source = fs.readFileSync(absPath, "utf8")
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
        esModuleInterop: true,
        isolatedModules: true
      },
      fileName: absPath
    })
    const moduleObj = { exports: {} }
    cache.set(absPath, moduleObj)

    const customRequire = (specifier) => {
      if (specifier.startsWith(".")) {
        const base = path.resolve(path.dirname(absPath), specifier)
        const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]
        for (const candidate of candidates) {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return load(candidate)
        }
        throw new Error(`Cannot resolve "${specifier}" from ${absPath}`)
      }
      return nodeRequire(specifier)
    }

    const ctx = {
      module: moduleObj,
      exports: moduleObj.exports,
      require: customRequire,
      console,
      globalThis: {},
      URL, URLSearchParams, Date, Map, Set, Proxy, RegExp, Error,
      Promise, Array, Object, JSON, Number, Boolean, String, Symbol,
      setInterval: () => 0, clearInterval: () => {}, setTimeout, clearTimeout,
      parseInt, parseFloat, isNaN, isFinite,
      encodeURIComponent, decodeURIComponent, atob, btoa,
      ...extraContext
    }
    vm.createContext(ctx)
    vm.runInContext(compiled.outputText, ctx, { filename: absPath })
    return moduleObj.exports
  }

  return load
}
