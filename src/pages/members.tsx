/**
 * Plasmo page: members.html (成员页 - Stanley 和他的朋友们 / HerName)
 *
 * Phase 7 第三个 Plasmo entry。
 * URL 参数 ?group=stanleyFriends / herName 决定加载哪份 JSON。
 * 不替换 legacy members.html。
 */

import { useEffect, useState, type ReactNode } from "react"

const GROUPS: Record<string, string> = {
  stanleyFriends: "prompts/stanleyFriends.json",
  herName: "prompts/herName.json"
}
const DEFAULT_GROUP = "stanleyFriends"

interface PromptEntry {
  label?: string
  description?: string
  text?: string
}

interface MemberEntry {
  id?: string
  displayName?: string
  xHandle?: string
  altHandle?: string
  avatarUrl?: string
  bio?: string
  prompts?: PromptEntry[]
}

interface GroupConfig {
  categoryLabel?: string
  categoryDescription?: string
  members?: MemberEntry[]
}

function resolveGroupId(): string {
  const params = new URLSearchParams(window.location.search)
  const raw = params.get("group") || ""
  return Object.prototype.hasOwnProperty.call(GROUPS, raw) ? raw : DEFAULT_GROUP
}

async function loadConfig(groupId: string): Promise<GroupConfig> {
  const path = GROUPS[groupId] || GROUPS[DEFAULT_GROUP]
  const ch = (globalThis as unknown as { chrome?: { runtime?: { getURL?: (p: string) => string } } }).chrome
  const url = ch?.runtime?.getURL?.(path) || path
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return (await resp.json()) as GroupConfig
}

function useToast(): [string | null, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 2400)
    return () => clearTimeout(t)
  }, [msg])
  return [msg, setMsg]
}

function PromptItem({ prompt, idx }: { prompt: PromptEntry; idx: number }): ReactNode {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt.text || "")
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch (err) {
      console.error("[触触搜] 复制失败:", err)
    }
  }
  return (
    <div className="mb-prompt">
      <div className="mb-prompt-head">
        <div className="mb-prompt-meta">
          <div className="mb-prompt-label">{prompt.label || `提示词 ${idx + 1}`}</div>
          {prompt.description && <div className="mb-prompt-desc">{prompt.description}</div>}
        </div>
        <button
          className={`mb-prompt-copy${copied ? " copied" : ""}`}
          type="button"
          onClick={handleCopy}>
          {copied ? "✓ 已复制" : "📋 复制"}
        </button>
      </div>
      <pre className="mb-prompt-text">{prompt.text || ""}</pre>
    </div>
  )
}

function MemberCard({ member }: { member: MemberEntry }): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const handles: string[] = []
  if (member.xHandle) handles.push(`𝕏 ${member.xHandle}`)
  if (member.altHandle) handles.push(`@ ${member.altHandle}`)

  return (
    <article className={`mb-card${expanded ? " expanded" : ""}`} data-member-id={member.id || ""}>
      <div
        className="mb-card-head"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setExpanded(!expanded)
          }
        }}>
        <div className="mb-avatar">
          {member.avatarUrl ? (
            <img
              src={member.avatarUrl}
              alt={member.displayName || ""}
              onError={(e) => {
                const span = document.createElement("span")
                span.textContent = "🧑"
                ;(e.target as HTMLElement).replaceWith(span)
              }}
            />
          ) : (
            <span>🧑</span>
          )}
        </div>
        <div className="mb-card-meta">
          <div className="mb-card-name">{member.displayName || member.id || "未命名"}</div>
          <div className="mb-card-handles">
            {handles.map((h, i) => (
              <span key={i} className="mb-card-handle">{h}</span>
            ))}
          </div>
        </div>
        <span className="mb-card-arrow">▶</span>
      </div>
      {member.bio && <div className="mb-card-bio">{member.bio}</div>}
      {expanded && (
        <div className="mb-prompts">
          {!member.prompts || member.prompts.length === 0 ? (
            <p style={{ color: "#6b7280", fontSize: "12px", padding: "4px 0" }}>该成员还没有提示词。</p>
          ) : (
            member.prompts.map((p, idx) => <PromptItem key={idx} prompt={p} idx={idx} />)
          )}
        </div>
      )}
    </article>
  )
}

function MembersPage() {
  const [config, setConfig] = useState<GroupConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const groupId = resolveGroupId()
    loadConfig(groupId)
      .then((c) => {
        setConfig(c)
        setLoading(false)
      })
      .catch((err: Error) => {
        console.error(`[触触搜] 加载 group=${groupId} 失败:`, err)
        setError(err.message || String(err))
        setLoading(false)
      })
  }, [])

  const title = config?.categoryLabel || "Stanley 和他的朋友们"
  const desc = config?.categoryDescription || ""

  return (
    <>
      <header className="mb-header">
        <div className="mb-header-inner">
          <h1 className="mb-title">
            <span className="mb-title-icon">🧑‍🤝‍🧑</span>
            <span className="mb-title-text">{title}</span>
          </h1>
          {desc && <p className="mb-desc">{desc}</p>}
        </div>
      </header>

      <main className="mb-main">
        {loading && <div className="mb-loading">加载中…</div>}
        {error && (
          <div className="mb-error">
            <p>加载失败：<span>{error}</span></p>
          </div>
        )}
        {config && !error && (
          <div className="mb-grid">
            {!config.members || config.members.length === 0 ? (
              <p style={{ gridColumn: "1 / -1", textAlign: "center", color: "#6b7280" }}>
                还没有成员，请在 <code>prompts/stanleyFriends.json</code> 里添加。
              </p>
            ) : (
              config.members.map((m, i) => <MemberCard key={m.id || i} member={m} />)
            )}
          </div>
        )}
      </main>

      <footer className="mb-footer">
        <span className="mb-footer-tip">💡 点击成员展开 → 复制提示词 → 回到网页选中文字 → 右键菜单 / Popup pin 生成封面</span>
      </footer>
    </>
  )
}

export default MembersPage
