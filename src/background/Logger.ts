/**
 * 触触搜 - 日志系统 (TypeScript port)
 *
 * 与 background/Logger.js 等价。差异（故意为之，且 verifier 会避开）：
 * - legacy 在模块加载时给 globalThis._loggerDebug 注册调试命令并 console.log 7 行帮助。
 *   TS 版本改为 `registerLoggerDebug(global)` 显式调用，避免 import 即副作用。
 * - legacy 用 globalThis.BG_DEBUG 控制 logMenuEvent 是否输出。TS 版本接受可选 enabled 参数，
 *   默认从 globalThis.BG_DEBUG 读（向后兼容生产路径）。
 *
 * 共享静态状态（Logger.records / Logger.globalConfig）保留在类静态字段上，与 legacy 一致。
 */

export const LEVELS = Object.freeze({
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 999
})

export type LogLevelValue = (typeof LEVELS)[keyof typeof LEVELS]
export type LogLevelName = keyof typeof LEVELS

export const LEVEL_NAMES = Object.freeze({
  0: "DEBUG",
  1: "INFO",
  2: "WARN",
  3: "ERROR",
  999: "NONE"
}) as Readonly<Record<number, string>>

export interface LoggerGlobalConfig {
  enabled: boolean
  level: LogLevelValue
  timestamp: boolean
  colors: boolean
  prefix: string
}

export interface LoggerRecord {
  level: string
  module: string
  message: string
  data: unknown
  timestamp: number
  sequence: number
}

export interface LoggerOptions {
  enabled?: boolean
  level?: LogLevelValue
  [key: string]: unknown
}

export class Logger {
  static LEVELS = LEVELS
  static LEVEL_NAMES = LEVEL_NAMES

  static globalConfig: LoggerGlobalConfig = {
    enabled: true,
    level: LEVELS.DEBUG,
    timestamp: true,
    colors: true,
    prefix: "[触触搜]"
  }

  static records: LoggerRecord[] = []
  static maxRecords = 1000

  moduleName: string
  options: LoggerOptions
  sequence: number

  constructor(moduleName: string, options: LoggerOptions = {}) {
    this.moduleName = moduleName || "Unknown"
    this.options = {
      enabled: options.enabled !== false,
      level: options.level !== undefined ? options.level : Logger.globalConfig.level,
      ...options
    }
    this.sequence = 0
  }

  static setGlobalLevel(level: LogLevelValue): void {
    Logger.globalConfig.level = level
  }

  static setGlobalEnabled(enabled: boolean): void {
    Logger.globalConfig.enabled = enabled
  }

  static getLevelName(level: number): string {
    return LEVEL_NAMES[level] || "UNKNOWN"
  }

  private _shouldLog(level: LogLevelValue): boolean {
    if (!Logger.globalConfig.enabled || !this.options.enabled) {
      return false
    }
    const effectiveLevel =
      this.options.level !== undefined ? this.options.level : Logger.globalConfig.level
    return level >= effectiveLevel
  }

  private _formatLog(level: LogLevelValue, message: string, data: unknown): LoggerRecord {
    const timestamp = Date.now()
    const levelName = Logger.getLevelName(level)

    const record: LoggerRecord = {
      level: levelName,
      module: this.moduleName,
      message,
      data,
      timestamp,
      sequence: ++this.sequence
    }

    Logger.records.push(record)
    if (Logger.records.length > Logger.maxRecords) {
      Logger.records.shift()
    }

    return record
  }

  private _output(level: LogLevelValue, message: string, data: unknown): void {
    const record = this._formatLog(level, message, data)

    let output = ""
    if (Logger.globalConfig.prefix) {
      output += `${Logger.globalConfig.prefix} `
    }
    if (Logger.globalConfig.timestamp) {
      const time = new Date(record.timestamp).toISOString().split("T")[1].replace("Z", "")
      output += `${time} `
    }
    output += `[${record.level}]`
    output += `[${record.module}]`
    output += ` ${message}`

    const consoleMethod =
      ({
        [LEVELS.DEBUG]: "log",
        [LEVELS.INFO]: "info",
        [LEVELS.WARN]: "warn",
        [LEVELS.ERROR]: "error"
      } as Record<number, "log" | "info" | "warn" | "error">)[level] || "log"

    if (data !== undefined && data !== null) {
      console[consoleMethod](output, data)
    } else {
      console[consoleMethod](output)
    }
  }

  debug(message: string, data?: unknown): void {
    if (this._shouldLog(LEVELS.DEBUG)) {
      this._output(LEVELS.DEBUG, message, data)
    }
  }

  info(message: string, data?: unknown): void {
    if (this._shouldLog(LEVELS.INFO)) {
      this._output(LEVELS.INFO, message, data)
    }
  }

  warn(message: string, data?: unknown): void {
    if (this._shouldLog(LEVELS.WARN)) {
      this._output(LEVELS.WARN, message, data)
    }
  }

  error(message: string, data?: unknown): void {
    if (this._shouldLog(LEVELS.ERROR)) {
      this._output(LEVELS.ERROR, message, data)
    }
  }

  group(label: string): void {
    if (this._shouldLog(LEVELS.DEBUG)) {
      console.group(`${Logger.globalConfig.prefix} [${this.moduleName}] ${label}`)
    }
  }

  groupEnd(): void {
    if (this._shouldLog(LEVELS.DEBUG)) {
      console.groupEnd()
    }
  }

  time(label: string): void {
    if (this._shouldLog(LEVELS.DEBUG)) {
      console.time(`${Logger.globalConfig.prefix} [${this.moduleName}] ${label}`)
    }
  }

  timeEnd(label: string): void {
    if (this._shouldLog(LEVELS.DEBUG)) {
      console.timeEnd(`${Logger.globalConfig.prefix} [${this.moduleName}] ${label}`)
    }
  }

  table(data: unknown): void {
    if (this._shouldLog(LEVELS.DEBUG)) {
      console.table(data)
    }
  }

  static getHistory(
    filters: { module?: string; level?: string; limit?: number } = {}
  ): LoggerRecord[] {
    let records = [...Logger.records]
    if (filters.module) {
      records = records.filter((r) => r.module === filters.module)
    }
    if (filters.level) {
      records = records.filter((r) => r.level === filters.level)
    }
    if (filters.limit) {
      records = records.slice(-filters.limit)
    }
    return records
  }

  static clearHistory(): void {
    Logger.records = []
  }

  static export(): string {
    return JSON.stringify(
      {
        exportTime: new Date().toISOString(),
        records: Logger.records
      },
      null,
      2
    )
  }
}

// ============================================
// 预定义的模块 Logger
// ============================================

export const loggers: Record<string, Logger> = {
  menuSystem: new Logger("MenuSystem"),
  stateManager: new Logger("StateManager"),
  urlBuilder: new Logger("URLBuilder"),
  menuManager: new Logger("MenuManager"),
  menuBuilder: new Logger("MenuBuilder"),
  menuHandlers: new Logger("MenuHandlers"),
  events: new Logger("Events"),
  init: new Logger("Init")
}

export function getLogger(moduleName: string): Logger {
  if (loggers[moduleName]) {
    return loggers[moduleName]
  }
  loggers[moduleName] = new Logger(moduleName)
  return loggers[moduleName]
}

// ============================================
// 调试命令注册（显式调用，不在 import 时自动 fire）
// ============================================

export interface LoggerDebugCommands {
  setLevel: (level: number | string) => void
  enable: () => void
  disable: () => void
  history: (filters?: { module?: string; level?: string; limit?: number }) => LoggerRecord[]
  clear: () => void
  export: () => string
  loggers: () => string[]
}

export function createLoggerDebugCommands(): LoggerDebugCommands {
  return {
    setLevel: (level) => {
      if (typeof level === "string") {
        const levelValue = (LEVELS as Record<string, number>)[level.toUpperCase()]
        if (levelValue !== undefined) {
          Logger.setGlobalLevel(levelValue as LogLevelValue)
          console.log(`日志级别已设置为: ${level.toUpperCase()}`)
        }
      } else {
        Logger.setGlobalLevel(level as LogLevelValue)
        console.log(`日志级别已设置为: ${Logger.getLevelName(level)}`)
      }
    },
    enable: () => {
      Logger.setGlobalEnabled(true)
      console.log("日志已启用")
    },
    disable: () => {
      Logger.setGlobalEnabled(false)
      console.log("日志已禁用")
    },
    history: (filters) => Logger.getHistory(filters),
    clear: () => {
      Logger.clearHistory()
      console.log("日志历史已清空")
    },
    export: () => {
      const data = Logger.export()
      console.log("日志已导出（复制下面的内容）：")
      console.log(data)
      return data
    },
    loggers: () => Object.keys(loggers)
  }
}

/**
 * 显式把 _loggerDebug 注册到给定 global（生产环境调用方在 SW 启动时调用）。
 * 与 legacy `globalThis._loggerDebug = { ... }` 等价，但不在 import 时自动 fire。
 */
export function registerLoggerDebug(globalTarget: Record<string, unknown> = globalThis): void {
  globalTarget._loggerDebug = createLoggerDebugCommands()
}

// ============================================
// 菜单事件日志（与 legacy base.js 的 logMenuEvent 行为对齐）
// ============================================
//
// 历史问题：Logger.js 和 base.js 各有一份 logMenuEvent。importScripts 顺序让
// base.js 的覆盖 Logger.js 的，所以生产用的是 base.js 那套（含 seq + monotonicMs +
// LOG_PREFIX，无 BG_DEBUG 守门）。此处把 Logger.ts 的实现重写成与 base.js 1:1，
// 让 Logger.ts 成为 logMenuEvent 的 SSoT，base.js port 完毕后可以直接删那一份。

const LOG_PREFIX_LOCAL = "[触触搜][MENU]"
let LOG_SEQUENCE = 0

export interface LogPayload {
  timestamp: string
  timeMs: number
  monotonicMs: number | null
  seq: number
  [k: string]: unknown
}

export function buildLogPayload(payload: Record<string, unknown> | null | undefined): LogPayload {
  const now = new Date()
  const monotonicMs = (typeof performance !== "undefined" && performance.now)
    ? Math.round(performance.now())
    : null
  return Object.assign({
    timestamp: now.toISOString(),
    timeMs: now.getTime(),
    monotonicMs,
    seq: ++LOG_SEQUENCE
  }, payload || {})
}

export function logMenuEvent(
  stage: string,
  payload: Record<string, unknown> = {}
): void {
  try {
    const enriched = buildLogPayload(payload)
    const summaryParts: string[] = []
    if (typeof enriched.match === "boolean") summaryParts.push(`match=${enriched.match ? "true" : "false"}`)
    if (typeof enriched.source === "string" && enriched.source) summaryParts.push(`source=${enriched.source}`)
    if (typeof enriched.keyword === "string" && enriched.keyword) summaryParts.push(`keyword="${enriched.keyword}"`)
    if (typeof enriched.title === "string" && enriched.title) summaryParts.push(`title="${enriched.title}"`)
    if (typeof enriched.menuDisplay === "string" && enriched.menuDisplay) summaryParts.push(`menuDisplay="${enriched.menuDisplay}"`)
    if (typeof enriched.menuRaw === "string" && enriched.menuRaw) summaryParts.push(`menuRaw="${enriched.menuRaw}"`)
    const summary = summaryParts.join(" | ")
    if (summary) {
      console.info(`${LOG_PREFIX_LOCAL} ${stage}`, summary, enriched)
    } else {
      console.info(`${LOG_PREFIX_LOCAL} ${stage}`, enriched)
    }
  } catch (_) { /* ignore */ }
}

/** 测试用：重置全局 LOG_SEQUENCE（在 verifier 里清零） */
export function _resetLogSequence(): void {
  LOG_SEQUENCE = 0
}

export default Logger
