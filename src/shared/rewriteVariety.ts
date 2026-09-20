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
  conceptModes?: string[]
  disciplinePool?: string[]
}

export interface RewriteVarietyPlan {
  counter: number
  title: string
  opening: string
  ending: string
  mode: string
  disciplines: string[]
  excludedDisciplines: string[]
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

export const REWRITE_VARIETY_SLICE_SIZE = 3
export const REWRITE_VARIETY_SLICE_STRIDE = 7

// 第 n 篇可借用的学科切片：池按类分组时，步长 7 让三个学科落在不同类
export function disciplineSlice(pool: string[] | undefined, n: number): string[] {
  if (!Array.isArray(pool) || pool.length === 0) return []
  const out: string[] = []
  for (let i = 0; i < REWRITE_VARIETY_SLICE_SIZE; i++) {
    const term = pick(pool, (REWRITE_VARIETY_SLICE_SIZE * n + i) * REWRITE_VARIETY_SLICE_STRIDE)
    if (term && !out.includes(term)) out.push(term)
  }
  return out
}

export function resolveRewriteVarietyPlan(config: RewriteVarietyConfig | undefined, counter: unknown): RewriteVarietyPlan {
  const n = normalizeCounter(counter) ?? 0
  return {
    counter: n,
    title: pick(config?.titleForms, n),
    opening: pick(config?.openingForms, n),
    ending: pick(config?.endingForms, n + Math.floor(n / 5)),
    mode: pick(config?.conceptModes, n + Math.floor(n / 4)),
    disciplines: disciplineSlice(config?.disciplinePool, n),
    excludedDisciplines: disciplineSlice(config?.disciplinePool, n - 1)
  }
}

export function renderRewriteVarietyPlan(plan: RewriteVarietyPlan | null | undefined): string {
  if (!plan || !plan.title || !plan.opening || !plan.ending) return ""
  const lines = [
    `- 主标题采用「${plan.title}」的形式；`,
    `- 开头从「${plan.opening}」进入；`,
    `- 结尾用「${plan.ending}」收束；`
  ]
  if (Array.isArray(plan.disciplines) && plan.disciplines.length) {
    lines.push(`- 本篇可借用的学科（只在需要外部概念解释素材里的具体机制时借，每个借来的概念都要对应素材关键词表；其余学科的概念本篇不用）：${plan.disciplines.join("、")}；`)
  }
  if (Array.isArray(plan.excludedDisciplines) && plan.excludedDisciplines.length) {
    lines.push(`- 上一篇借用过的学科，本篇不借：${plan.excludedDisciplines.join("、")}；`)
  }
  if (plan.mode) {
    lines.push(`- 概念处理：${plan.mode}；加粗上限仍是最多 6 个。`)
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
