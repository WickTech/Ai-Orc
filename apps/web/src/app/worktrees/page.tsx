"use client"

import { useEffect, useState } from "react"
import { Check, GitBranch, Loader2, Trash2, X } from "lucide-react"

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

interface ReviewFile {
  path: string
  status: string
  additions: number | null
  deletions: number | null
}

interface Review {
  id: string
  branch: string
  files: ReviewFile[]
  diff: string
  truncated: boolean
  diffHash: string
  verifyRequired: boolean
  verify: { passed: boolean; exitCode: number | null; timedOut: boolean; output: string; diffHash: string; at: string } | null
  targetBranch: string | null
}

interface AuditEntry {
  at: string
  action: string
  session?: string
  branch?: string
  detail?: string
}

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="text-xs font-mono leading-5 overflow-x-auto max-h-96 overflow-y-auto rounded-md bg-black/30 p-3">
      {diff.split("\n").map((line, i) => {
        const color = line.startsWith("+") && !line.startsWith("+++")
          ? "text-green-300"
          : line.startsWith("-") && !line.startsWith("---")
            ? "text-red-300"
            : line.startsWith("@@") || line.startsWith("diff ")
              ? "text-sky-300"
              : "text-white/60"
        return (
          <div key={i} className={color}>
            {line || " "}
          </div>
        )
      })}
    </pre>
  )
}

export default function WorktreesPage() {
  const [repos, setRepos] = useState<Repo[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  const [reviewing, setReviewing] = useState<{ session: Session; review: Review } | null>(null)
  const [message, setMessage] = useState("")
  const [audit, setAudit] = useState<AuditEntry[]>([])

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

  useEffect(() => {
    let cancelled = false
    fetch("/api/audit?limit=20")
      .then((r) => r.json())
      .then((body) => {
        if (!cancelled) setAudit(body.entries ?? [])
      })
      .catch(() => {})
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

  async function openReview(s: Session) {
    setBusy(s.id)
    setError("")
    try {
      const res = await fetch(`/api/worktrees/review?repoId=${encodeURIComponent(s.repoId)}&id=${encodeURIComponent(s.id)}`)
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `Could not load the review (HTTP ${res.status})`)
        return
      }
      setMessage("")
      setReviewing({ session: s, review: body })
    } catch {
      setError("Could not reach the server")
    } finally {
      setBusy("")
    }
  }

  async function runVerify() {
    if (!reviewing) return
    const { session } = reviewing
    setBusy(session.id)
    setError("")
    try {
      const res = await fetch("/api/worktrees/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: session.repoId, id: session.id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `Verification request failed (HTTP ${res.status})`)
        return
      }
      // The run can change the diff (files the command wrote): load the new review.
      const next = await fetch(`/api/worktrees/review?repoId=${encodeURIComponent(session.repoId)}&id=${encodeURIComponent(session.id)}`)
      if (next.ok) setReviewing({ session, review: await next.json() })
    } catch {
      setError("Could not reach the server")
    } finally {
      setBusy("")
    }
  }

  async function decide(kind: "approve" | "reject") {
    if (!reviewing) return
    const { session, review } = reviewing
    setBusy(session.id)
    setError("")
    try {
      const payload =
        kind === "approve"
          ? { repoId: session.repoId, id: session.id, diffHash: review.diffHash, message }
          : { repoId: session.repoId, id: session.id, reason: message }
      const res = await fetch(`/api/worktrees/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `Request failed (HTTP ${res.status})`)
        // A stale diff means the agent kept working: close the panel so it gets re-reviewed.
        if (res.status === 409) setReviewing(null)
        return
      }
      setReviewing(null)
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
                  disabled={busy === s.id || !s.exists}
                  onClick={() => openReview(s)}
                  className="text-xs rounded-md border border-white/15 px-2.5 py-1.5 text-white/70 hover:bg-white/10 disabled:opacity-40"
                >
                  Review
                </button>
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

        {reviewing && (
          <section aria-label="Review" className="p-4 rounded-xl border border-white/15 bg-white/[0.03] space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-white/80 flex-1 font-mono">{reviewing.review.branch}</h2>
              <span className="text-xs text-white/40">
                merges into {reviewing.review.targetBranch ?? "(detached HEAD: cannot merge)"}
              </span>
              <button
                type="button"
                aria-label="Close review"
                onClick={() => setReviewing(null)}
                className="h-7 w-7 flex items-center justify-center rounded text-white/50 hover:text-white hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {reviewing.review.files.length === 0 ? (
              <p className="text-sm text-white/40">This session has no changes yet.</p>
            ) : (
              <>
                <ul className="text-xs font-mono space-y-0.5">
                  {reviewing.review.files.map((f) => (
                    <li key={f.path} className="text-white/70">
                      <span className="text-white/40">{f.status.padEnd(9)}</span>
                      {f.path}{" "}
                      <span className="text-green-300">+{f.additions ?? "bin"}</span>{" "}
                      <span className="text-red-300">-{f.deletions ?? "bin"}</span>
                    </li>
                  ))}
                </ul>
                <DiffView diff={reviewing.review.diff} />
                {reviewing.review.truncated && (
                  <p className="text-xs text-amber-300">
                    The diff is too large to show in full. Approval still covers every change.
                  </p>
                )}
              </>
            )}
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Commit message (approve) or reason (reject), optional"
              className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-white/20 outline-none"
            />
            {reviewing.review.verifyRequired && (
              <div className="rounded-md border border-white/10 p-3 space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-white/70 flex-1">
                    {!reviewing.review.verify
                      ? "Verification required before merge: not run yet."
                      : reviewing.review.verify.diffHash !== reviewing.review.diffHash
                        ? "The session changed since the last verification: run it again."
                        : reviewing.review.verify.passed
                          ? "Verification passed on this diff."
                          : reviewing.review.verify.timedOut
                            ? "Verification timed out."
                            : `Verification failed (exit code ${reviewing.review.verify.exitCode ?? "none"}).`}
                  </span>
                  <button
                    type="button"
                    disabled={busy === reviewing.session.id}
                    onClick={runVerify}
                    className="rounded-md border border-white/15 px-3 py-1.5 text-white/80 hover:bg-white/10 disabled:opacity-40"
                  >
                    {busy === reviewing.session.id ? "Running…" : "Run verification"}
                  </button>
                </div>
                {reviewing.review.verify && !reviewing.review.verify.passed && (
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-white/50 font-mono">{reviewing.review.verify.output}</pre>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={busy === reviewing.session.id}
                onClick={() => decide("reject")}
                className="text-sm rounded-md border border-white/15 px-3 py-1.5 text-white/70 hover:bg-white/10 disabled:opacity-40"
              >
                Reject
              </button>
              <button
                type="button"
                disabled={
                  busy === reviewing.session.id ||
                  reviewing.review.files.length === 0 ||
                  !reviewing.review.targetBranch ||
                  (reviewing.review.verifyRequired &&
                    !(reviewing.review.verify?.passed && reviewing.review.verify.diffHash === reviewing.review.diffHash))
                }
                onClick={() => decide("approve")}
                className="text-sm rounded-md bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-white flex items-center gap-1.5 disabled:opacity-40"
              >
                <Check className="h-4 w-4" /> Approve &amp; merge
              </button>
            </div>
          </section>
        )}

        {audit.length > 0 && (
          <section aria-label="Audit log" className="space-y-2">
            <h2 className="text-xs font-semibold text-white/30 uppercase tracking-wider">Audit log</h2>
            <ul className="text-xs font-mono space-y-1">
              {audit.map((e, i) => (
                <li key={i} className="text-white/50">
                  {new Date(e.at).toLocaleString()} · <span className="text-white/80">{e.action}</span>
                  {e.branch ? ` · ${e.branch}` : ""}
                  {e.detail ? ` · ${e.detail}` : ""}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
