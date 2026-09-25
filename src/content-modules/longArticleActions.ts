import "./chatGptDom"
import "../../modules/longArticleActions.js"

export interface LongArticlePayload {
  title: string
  bodyText: string
  bodyHtml: string
  omittedMedia: boolean
}

export interface LongArticleActionsApi {
  candidateFor: (assistant: HTMLElement) => unknown
  extractArticle: (block: HTMLElement) => LongArticlePayload | null
  isArticleRewritePromptText: (text: string) => boolean
  isSupportedPage: () => boolean
  replaceArticlePayloadTa: (article: LongArticlePayload) => LongArticlePayload
  start: () => () => void
}

interface LongArticleWindow extends Window {
  CCSModules?: Record<string, unknown> & { LongArticleActions?: LongArticleActionsApi }
}

const api = (window as LongArticleWindow).CCSModules?.LongArticleActions
if (!api) throw new Error("LongArticleActions legacy module did not initialize")

export const LongArticleActions = api
export default LongArticleActions
