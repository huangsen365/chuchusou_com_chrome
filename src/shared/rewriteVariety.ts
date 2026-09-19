/**
 * 长文改写「形式轮换」单一来源（TypeScript 口径，与 shared/rewriteVariety.js 1:1 对等）。
 *
 * 用本地轮换计数器 n 查表生成「本篇的形式安排」，注入 ${varietyPlan}；只安排标题 / 开头 /
 * 结尾的形式和一个可选的第二视角，概念仍然只能来自素材。表在 articleRewritePrompts.json
 * 的 varietyPlan 字段里。
 */
export const REWRITE_VARIETY_PLACEHOLDER = "${varietyPlan}"
export const REWRITE_VARIETY_COUNTER_KEY = "ccs_rewrite_variety_counter"
export const REWRITE_VARIETY_EMPTY_PLAN_TEXT = "（本篇不做额外形式安排，按素材自行选择标题、开头与结尾的形式。）"
export const REWRITE_VARIETY_CYCLE = 1800

export interface RewriteVarietyConfig {
  titleForms?: string[]
  openingForms?: string[]
  endingForms?: string[]
  secondLenses?: string[]
}

export interface RewriteVarietyPlan {
  counter: number
  title: string
  opening: string
  ending: string
  lens: string
}

function pick(list: string[] | undefined, index: number): string {
  if (!Array.isArray(list) || list.length === 0) return ""
  const size = list.length
  const value = list[((index % size) + size) % size]
  return typeof value === "string" ? value.trim() : ""
}

function normalizeCounter(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

export function seedFromDate(date?: Date): number {
  // 不用 instanceof（跨 realm 会失败），用鸭子类型判断
  const d = date && typeof date.getTime === "function" && !Number.isNaN(date.getTime()) ? date : new Date()
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  const dayOfYear = Math.floor((d.getTime() - yearStart) / 86400000)
  return (((dayOfYear * 24 + d.getUTCHours()) % REWRITE_VARIETY_CYCLE) + REWRITE_VARIETY_CYCLE) % REWRITE_VARIETY_CYCLE
}

export function resolveRewriteVarietyPlan(config: RewriteVarietyConfig | undefined, counter: unknown): RewriteVarietyPlan {
  const n = normalizeCounter(counter) ?? 0
  return {
    counter: n,
    title: pick(config?.titleForms, n),
    opening: pick(config?.openingForms, n),
    ending: pick(config?.endingForms, n + Math.floor(n / 5)),
    lens: pick(config?.secondLenses, n * 5 + Math.floor(n / 12))
  }
}

export function renderRewriteVarietyPlan(plan: RewriteVarietyPlan | null | undefined): string {
  if (!plan || !plan.title || !plan.opening || !plan.ending) return ""
  const lines = [
    `- 主标题采用「${plan.title}」的形式；`,
    `- 开头从「${plan.opening}」进入；`,
    `- 结尾用「${plan.ending}」收束；`
  ]
  if (plan.lens) {
    lines.push(`- 如果素材允许，可以从「${plan.lens}」的角度补一个类比或解释；素材不允许就不补，不要为了用它而扭曲素材。`)
  }
  return lines.join("\n")
}

export function applyRewriteVarietyPlan(template: string, planText?: string | null): string {
  const text = typeof planText === "string" && planText.trim() ? planText.trim() : REWRITE_VARIETY_EMPTY_PLAN_TEXT
  return String(template || "").split(REWRITE_VARIETY_PLACEHOLDER).join(text)
}

type StorageLike = {
  get: (keys: string[], callback: (data: Record<string, unknown>) => void) => void
  set: (values: Record<string, unknown>, callback?: () => void) => void
}

function storageArea(): StorageLike | null {
  const area = (globalThis as { chrome?: { storage?: { local?: StorageLike } } }).chrome?.storage?.local
  return area && typeof area.get === "function" && typeof area.set === "function" ? area : null
}

export function nextRewriteVarietyCounter(): Promise<number> {
  return new Promise((resolve) => {
    const area = storageArea()
    if (!area) {
      resolve(seedFromDate())
      return
    }
    try {
      area.get([REWRITE_VARIETY_COUNTER_KEY], (data) => {
        void (globalThis as { chrome?: { runtime?: { lastError?: unknown } } }).chrome?.runtime?.lastError
        const stored = normalizeCounter(data?.[REWRITE_VARIETY_COUNTER_KEY])
        const n = stored == null ? seedFromDate() : stored
        try {
          area.set({ [REWRITE_VARIETY_COUNTER_KEY]: (n + 1) % REWRITE_VARIETY_CYCLE }, () => {
            void (globalThis as { chrome?: { runtime?: { lastError?: unknown } } }).chrome?.runtime?.lastError
            resolve(n)
          })
        } catch {
          resolve(n)
        }
      })
    } catch {
      resolve(seedFromDate())
    }
  })
}

export async function buildRewriteVarietyPlanText(config: RewriteVarietyConfig | undefined): Promise<string> {
  const n = await nextRewriteVarietyCounter()
  return renderRewriteVarietyPlan(resolveRewriteVarietyPlan(config, n))
}
