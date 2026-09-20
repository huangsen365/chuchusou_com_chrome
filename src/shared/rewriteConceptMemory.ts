/**
 * 长文改写「近期概念记忆」单一来源（TypeScript 口径，与 shared/rewriteConceptMemory.js 1:1 对等）。
 *
 * 改写成品就绪时抽出加粗的概念名称，存 chrome.storage.local 保留最近 MAX_RECENT 个；
 * 下次构造改写提示词时注入 ${recentConcepts}，要求本文不要再用。全部本地。
 */
export const RECENT_CONCEPTS_PLACEHOLDER = "${recentConcepts}"
export const RECENT_CONCEPTS_STORAGE_KEY = "ccs_rewrite_recent_concepts"
export const RECENT_CONCEPTS_MAX = 80
export const RECENT_CONCEPTS_MAX_TERM_LENGTH = 30
export const RECENT_CONCEPTS_EMPTY_TEXT = "（无）"

export interface RecentConcept {
  term: string
  ts: number
}

const TRIM_EDGES = /^[\s*_“”"'「」『』()（）[\]【】]+|[\s*_“”"'「」『』()（）[\]【】，。、；：:,.;!?！？]+$/g

export function normalizeConceptTerm(value: unknown): string {
  return String(value ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").replace(TRIM_EDGES, "").trim()
}

// 模糊去重键：不分大小写、去内部空白与引号、剥掉「效应 / 定律 / 法则 / 模型 / 理论 / 原理 / 思维 / 陷阱 / 现象 / 机制」
// 这类后缀——「锚定效应」「锚定」记成一条；剥完不足 2 字则保留原词
const KEY_SUFFIX = /(效应|定律|法则|模型|理论|原理|思维|陷阱|现象|机制)$/
export function conceptDedupeKey(term: unknown): string {
  const base = normalizeConceptTerm(term).toLowerCase().replace(/[\s“”"'「」『』]/g, "")
  const stripped = base.replace(KEY_SUFFIX, "")
  return stripped.length >= 2 ? stripped : base
}

export function extractConceptsFromHtml(html: unknown): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const pattern = /<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi
  let match: RegExpExecArray | null
  const source = String(html ?? "")
  while ((match = pattern.exec(source))) {
    const term = normalizeConceptTerm(match[2])
    if (!term || term.length > RECENT_CONCEPTS_MAX_TERM_LENGTH) continue
    const key = conceptDedupeKey(term)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(term)
  }
  return out
}

function normalizeList(list: unknown): RecentConcept[] {
  if (!Array.isArray(list)) return []
  return list
    .map((item) => (typeof item === "string" ? { term: item, ts: 0 } : item))
    .filter((item): item is { term: string; ts?: unknown } => !!item && typeof item.term === "string" && item.term.trim().length > 0)
    .map((item) => ({ term: normalizeConceptTerm(item.term), ts: Number(item.ts) || 0 }))
    .filter((item) => item.term.length > 0)
}

export function mergeRecentConcepts(existing: unknown, concepts: unknown, now?: number, max?: number): RecentConcept[] {
  const limit = Number.isFinite(max) && (max as number) > 0 ? Math.floor(max as number) : RECENT_CONCEPTS_MAX
  const ts = Number.isFinite(now) ? (now as number) : Date.now()
  const incoming = normalizeList((Array.isArray(concepts) ? concepts : []).map((term) => ({ term, ts })))
  const merged: RecentConcept[] = []
  const seen = new Set<string>()
  for (const item of [...incoming, ...normalizeList(existing)]) {
    const key = conceptDedupeKey(item.term)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(item)
    if (merged.length >= limit) break
  }
  return merged
}

export function renderRecentConcepts(list: unknown): string {
  const terms = normalizeList(list).map((item) => item.term)
  return terms.length ? terms.join("、") : RECENT_CONCEPTS_EMPTY_TEXT
}

export function applyRecentConcepts(template: string, recentText?: string | null): string {
  const text = typeof recentText === "string" && recentText.trim() ? recentText.trim() : RECENT_CONCEPTS_EMPTY_TEXT
  return String(template || "").split(RECENT_CONCEPTS_PLACEHOLDER).join(text)
}

type StorageLike = {
  get: (keys: string[], callback: (data: Record<string, unknown>) => void) => void
  set: (values: Record<string, unknown>, callback?: () => void) => void
}

function storageArea(): StorageLike | null {
  const area = (globalThis as { chrome?: { storage?: { local?: StorageLike } } }).chrome?.storage?.local
  return area && typeof area.get === "function" && typeof area.set === "function" ? area : null
}

export function readRecentConcepts(): Promise<RecentConcept[]> {
  return new Promise((resolve) => {
    const area = storageArea()
    if (!area) {
      resolve([])
      return
    }
    try {
      area.get([RECENT_CONCEPTS_STORAGE_KEY], (data) => {
        void (globalThis as { chrome?: { runtime?: { lastError?: unknown } } }).chrome?.runtime?.lastError
        resolve(normalizeList(data?.[RECENT_CONCEPTS_STORAGE_KEY]))
      })
    } catch {
      resolve([])
    }
  })
}

export async function recordRecentConcepts(concepts: unknown): Promise<RecentConcept[]> {
  const incoming = Array.isArray(concepts) ? concepts.filter((term) => typeof term === "string" && term.trim()) : []
  if (!incoming.length) return []
  const merged = mergeRecentConcepts(await readRecentConcepts(), incoming, Date.now(), RECENT_CONCEPTS_MAX)
  const area = storageArea()
  if (area) {
    await new Promise<void>((resolve) => {
      try {
        area.set({ [RECENT_CONCEPTS_STORAGE_KEY]: merged.slice(0, RECENT_CONCEPTS_MAX) }, () => {
          void (globalThis as { chrome?: { runtime?: { lastError?: unknown } } }).chrome?.runtime?.lastError
          resolve()
        })
      } catch {
        resolve()
      }
    })
  }
  return merged
}

export async function buildRecentConceptsText(): Promise<string> {
  return renderRecentConcepts(await readRecentConcepts())
}
