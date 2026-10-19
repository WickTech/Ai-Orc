"use client"

import { useEffect, useState } from "react"
import { GitBranch, Loader2, Trash2 } from "lucide-react"

interface Repo {
  id: string
  name: string
  path: string
}

interface Session {
  id: string
  repoId: string
  toolId: string
  branch: string
  path: string
  exists: boolean
  dirty: boolean
  ahead: number
  createdAt: string
}

export default function WorktreesPage() {
  const [repos, setRepos] = useState<Repo[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")

  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch("/api/worktrees")
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return
        setRepos(body.repos ?? [])
        setSessions(body.worktrees ?? [])
      })
      .catch(() => {
        if (!cancelled) setError("Could not load worktrees")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refresh])

  async function remove(s: Session) {
    const hasWork = s.dirty || s.ahead > 0
    if (hasWork && !window.confirm(`"${s.branch}" has uncommitted or unmerged work. Delete it anyway?`)) return
    setBusy(s.id)
    setError("")
    try {
      const res = await fetch("/api/worktrees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: s.repoId, id: s.id, force: hasWork }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `Could not remove worktree (HTTP ${res.status})`)
      }
    } catch {
      setError("Could not reach the server")
    } finally {
      setBusy("")
      setRefresh((n) => n + 1)
    }
  }

  const repoName = (id: string) => repos.find((r) => r.id === id)?.name ?? id

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Worktrees</h1>
          <p className="text-white/40 text-sm mt-1">
            Isolated agent sessions. Each has its own branch; remove one when you are done with it.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-white/40" />
        ) : repos.length === 0 ? (
          <p className="text-white/40 text-sm">Add a repository in Settings to start isolated sessions.</p>
        ) : sessions.length === 0 ? (
          <p className="text-white/40 text-sm">No isolated sessions yet. Pick a repository when launching a tool on the Dashboard.</p>
        ) : (
          <ul className="space-y-3">
            {sessions.map((s) => (
              <li key={`${s.repoId}/${s.id}`} className="p-4 rounded-xl border border-white/10 bg-white/[0.02] flex items-center gap-4">
                <GitBranch className="h-4 w-4 text-emerald-300/80 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-sm text-white/90 truncate">{s.branch}</p>
                  <p className="text-xs text-white/40 truncate" title={s.path}>
                    {repoName(s.repoId)} · {s.toolId} · {s.path}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  {!s.exists && <span className="text-red-300">missing on disk</span>}
                  {s.dirty && <span className="text-amber-300">uncommitted changes</span>}
                  {s.ahead > 0 && <span className="text-sky-300">{s.ahead} commit{s.ahead === 1 ? "" : "s"}</span>}
                  {s.exists && !s.dirty && s.ahead === 0 && <span className="text-white/40">clean</span>}
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${s.branch}`}
                  disabled={busy === s.id}
                  onClick={() => remove(s)}
                  className="h-8 w-8 flex items-center justify-center rounded text-white/50 hover:text-red-300 hover:bg-white/10 disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
