"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, ArrowRight, Plus, Trash2 } from "lucide-react"
import type { Task, TaskStatus } from "@/lib/tasks"

interface Repo {
  id: string
  name: string
}

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To do" },
  { status: "doing", label: "Doing" },
  { status: "done", label: "Done" },
]

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [repos, setRepos] = useState<Repo[]>([])
  const [title, setTitle] = useState("")
  const [repoId, setRepoId] = useState("")
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    try {
      const [t, w] = await Promise.all([fetch("/api/tasks"), fetch("/api/worktrees")])
      if (t.ok) setTasks((await t.json()).tasks)
      if (w.ok) setRepos((await w.json()).repos ?? [])
    } catch {
      setError("Could not reach the server")
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(load, 0)
    return () => clearTimeout(timer)
  }, [load])

  async function call(method: string, body: unknown) {
    setError("")
    try {
      const res = await fetch("/api/tasks", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        setError(b.error ?? `Request failed (HTTP ${res.status})`)
        return false
      }
      await load()
      return true
    } catch {
      setError("Could not reach the server")
      return false
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    if (await call("POST", { title, repoId })) setTitle("")
  }

  const repoName = (id?: string) => repos.find((r) => r.id === id)?.name

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Tasks</h1>
          <p className="text-white/40 text-sm mt-1">A local to-do board. Tasks never start agents on their own.</p>
        </div>

        <form onSubmit={add} className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            aria-label="New task"
            placeholder="What needs doing?"
            className="flex-1 bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-white/20 outline-none"
          />
          {repos.length > 0 && (
            <select
              value={repoId}
              onChange={(e) => setRepoId(e.target.value)}
              aria-label="Repository"
              className="bg-white/5 border border-white/10 rounded-md px-2 text-sm text-white/80"
            >
              <option value="">No repository</option>
              {repos.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}
          <button type="submit" className="flex items-center gap-1.5 rounded-md bg-blue-600 hover:bg-blue-500 px-3 text-sm text-white">
            <Plus className="h-4 w-4" /> Add
          </button>
        </form>
        {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}

        <div className="grid md:grid-cols-3 gap-4">
          {COLUMNS.map((col, ci) => (
            <section key={col.status} aria-label={col.label} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-2">
              <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider">
                {col.label} ({tasks.filter((t) => t.status === col.status).length})
              </h2>
              {tasks
                .filter((t) => t.status === col.status)
                .map((t) => (
                  <div key={t.id} className="rounded-md border border-white/10 p-2 space-y-1.5">
                    <p className="text-sm text-white/80 break-words">{t.title}</p>
                    {repoName(t.repoId) && <p className="text-[11px] font-mono text-emerald-300/70">{repoName(t.repoId)}</p>}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={ci === 0}
                        aria-label={`Move "${t.title}" back`}
                        onClick={() => call("PATCH", { id: t.id, status: COLUMNS[ci - 1].status })}
                        className="h-6 w-6 flex items-center justify-center rounded text-white/50 hover:bg-white/10 disabled:opacity-20"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={ci === COLUMNS.length - 1}
                        aria-label={`Move "${t.title}" forward`}
                        onClick={() => call("PATCH", { id: t.id, status: COLUMNS[ci + 1].status })}
                        className="h-6 w-6 flex items-center justify-center rounded text-white/50 hover:bg-white/10 disabled:opacity-20"
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                      <div className="flex-1" />
                      <button
                        type="button"
                        aria-label={`Delete "${t.title}"`}
                        onClick={() => call("DELETE", { id: t.id })}
                        className="h-6 w-6 flex items-center justify-center rounded text-white/40 hover:text-red-400 hover:bg-white/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
