import "../../modules/chatGptDom.js"

export interface ChatGptDomApi {
  TURN_SELECTOR: string
  MESSAGE_SELECTOR: string
  ASSISTANT_SELECTOR: string
  MARKDOWN_SELECTOR: string
  WRITING_BLOCK_SELECTOR: string
  WRITING_EDITOR_SELECTOR: string
  assistantMessageFor: (root: Element) => HTMLElement | null
  assistantMessages: (root?: ParentNode) => HTMLElement[]
  messageRole: (root: Element) => string
  messages: (root?: ParentNode) => HTMLElement[]
  markdownFor: (message: Element) => HTMLElement
  markdownRoots: (message: Element) => HTMLElement[]
  writingBlocks: (root: Element) => HTMLElement[]
  turnFor: (root: Element) => HTMLElement | null
  previousUserMessage: (assistant: Element) => HTMLElement | null
  responseCopyButton: (turn: Element) => HTMLButtonElement | null
  actionAnchor: (copyButton: Element) => HTMLElement
  insertAfterAction: (copyButton: Element, node: HTMLElement) => void
}

const host = window as Window & { CCSModules?: { ChatGptDom?: ChatGptDomApi } }
const api = host.CCSModules?.ChatGptDom
if (!api) throw new Error("ChatGptDom legacy module did not initialize")

export const ChatGptDom = api
export default ChatGptDom
