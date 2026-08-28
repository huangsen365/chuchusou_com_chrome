import "../../modules/xArticleDraftDelivery.js"

export interface XArticleDeliveryResult {
  success?: boolean
  retryable?: boolean
  warning?: string
  error?: string
}

export interface XArticleDraftDeliveryApi {
  deliver: (taskId: string) => Promise<XArticleDeliveryResult>
  findEditors: () => { title: HTMLElement; body: HTMLElement } | null
  isSupportedPage: () => boolean
  normalizeText: (value: unknown) => string
  start: () => () => void
}

interface XDeliveryWindow extends Window {
  CCSModules?: Record<string, unknown> & { XArticleDraftDelivery?: XArticleDraftDeliveryApi }
}

const api = (window as XDeliveryWindow).CCSModules?.XArticleDraftDelivery
if (!api) throw new Error("XArticleDraftDelivery legacy module did not initialize")

export const XArticleDraftDelivery = api
export default XArticleDraftDelivery
