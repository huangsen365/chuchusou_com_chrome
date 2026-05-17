/**
 * Content script - Commands 模块 (TypeScript port)
 *
 * 与 modules/commands.js 1:1 行为对等。**零 chrome.* 依赖**。
 */

export type CommandFn = (args: string[]) => string

export interface CommandParseResult {
  success: boolean
  result?: string
  command?: string
  error?: string
}

const baseCommands: Record<string, CommandFn> = {
  base64: (args) => {
    if (args[0] === "-d") {
      try {
        return atob(args.slice(1).join(" "))
      } catch (_) {
        return "解码失败: 无效的 base64 字符串"
      }
    }
    return btoa(unescape(encodeURIComponent(args.join(" "))))
  },
  md5: (args) => {
    const text = args.join(" ")
    let hash = 0
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return Math.abs(hash).toString(16).padStart(32, "0").slice(0, 32)
  },
  url: (args) => {
    if (args[0] === "decode") return decodeURIComponent(args.slice(1).join(" "))
    return encodeURIComponent(args.join(" "))
  },
  upper: (args) => args.join(" ").toUpperCase(),
  lower: (args) => args.join(" ").toLowerCase(),
  search: (args) => {
    const query = args.join(" ")
    window.open(`https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${encodeURIComponent(query)}`, "_blank")
    return `正在搜索: ${query}`
  },
  copy: (args) => {
    const text = args.join(" ")
    navigator.clipboard
      .writeText(text)
      .then(() => {
        const showToast = (window as unknown as { showToast?: (m: string) => void }).showToast
        if (showToast) showToast("已复制到剪贴板")
      })
      .catch(() => {
        const showToast = (window as unknown as { showToast?: (m: string) => void }).showToast
        if (showToast) showToast("复制失败")
      })
    return "已复制到剪贴板"
  }
}

export class CommandsManager {
  private commands: Record<string, CommandFn>

  constructor() {
    this.commands = { ...baseCommands }
  }

  getCommands(): Record<string, CommandFn> { return this.commands }

  execute(cmd: string, args: string[]): string | null {
    return this.commands[cmd] ? this.commands[cmd](args) : null
  }

  parseAndExecute(inputValue: string, selectedText: string = ""): CommandParseResult | null {
    if (!inputValue || !inputValue.trim()) return null
    const trimmedInput = inputValue.trim()
    if (trimmedInput.startsWith("/")) {
      const parts = trimmedInput.slice(1).split(" ")
      const cmd = parts[0]
      const args = parts.slice(1)
      if (this.commands[cmd]) {
        const finalArgs = args.length ? args : [selectedText]
        return { success: true, result: this.commands[cmd](finalArgs), command: cmd }
      }
      return { success: false, error: `未知命令: ${cmd}` }
    }
    return null
  }

  executeCommand(shadowRoot: ShadowRoot | null | undefined, selectedText: string = ""): void {
    const input = shadowRoot?.querySelector<HTMLInputElement>(".ccs-input")
    const resultDiv = shadowRoot?.querySelector<HTMLElement>(".ccs-result")
    if (!input) return
    const inputValue = input.value.trim()
    if (!inputValue) return

    const commandResult = this.parseAndExecute(inputValue, selectedText)
    if (commandResult) {
      if (commandResult.success && commandResult.result !== undefined) {
        if (resultDiv) {
          resultDiv.textContent = commandResult.result
          resultDiv.style.display = "block"
        }
        navigator.clipboard.writeText(commandResult.result)
        const showToast = (window as unknown as { showToast?: (m: string) => void }).showToast
        if (showToast) showToast("结果已复制到剪贴板")
      } else if (resultDiv) {
        resultDiv.textContent = commandResult.error || ""
        resultDiv.style.display = "block"
      }
    } else {
      window.open(`https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${encodeURIComponent(inputValue)}`, "_blank")
    }
  }

  isValidCommand(cmd: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.commands, cmd)
  }

  getCommandList(): string[] { return Object.keys(this.commands) }

  addCommand(name: string, handler: CommandFn): boolean {
    if (!this.commands[name]) {
      this.commands[name] = handler
      return true
    }
    return false
  }

  removeCommand(name: string): boolean {
    if (this.commands[name]) {
      delete this.commands[name]
      return true
    }
    return false
  }
}

export const Commands = new CommandsManager()

export default Commands
