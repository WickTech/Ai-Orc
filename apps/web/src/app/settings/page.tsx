"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Check, Loader2, FolderOpen, GitBranch, Plus, X } from "lucide-react"

interface Config {
  vaultPath: string
  port: number
  repos: string[]
  verify: Record<string, string[]>
}

export default function SettingsPage() {
  const [config, setConfig] = useState<Config>({ vaultPath: "", port: 3000, repos: [], verify: {} })
  // Verify command per repository row, as typed (split on spaces when saved).
  const [verifyText, setVerifyText] = useState<string[]>([])
  // What the server last returned: only settings you changed are sent, so an old
  // value in an untouched field (e.g. a vault folder that no longer exists) cannot block saving others.
  const [loaded, setLoaded] = useState<Config | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")

  function applyConfig(next: Config) {
    setConfig(next)
    setLoaded(next)
    setVerifyText(next.repos.map((r) => (next.verify?.[r] ?? []).join(" ")))
  }

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => { if (d.config) applyConfig(d.config) })
      .catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(loaded && config.vaultPath === loaded.vaultPath ? {} : { vaultPath: config.vaultPath }),
          ...(loaded && config.port === loaded.port ? {} : { port: config.port }),
          repos: config.repos.map((r) => r.trim()).filter(Boolean),
          verify: Object.fromEntries(
            config.repos
              .map((r, i) => [r.trim(), (verifyText[i] ?? "").trim()] as const)
              .filter(([r, v]) => r && v)
              .map(([r, v]) => [r, v.split(/\s+/)]),
          ),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `Could not save settings (HTTP ${res.status})`)
        return
      }
      const body = await res.json()
      if (body.config) applyConfig(body.config)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setError("Could not reach the server")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-white/40 text-sm mt-1">Configure Axion for your local environment.</p>
        </div>

        <div className="space-y-6">
          <div className="p-5 rounded-xl border border-white/10 bg-white/[0.02] space-y-4">
            <h2 className="text-sm font-semibold text-white/70">Obsidian Vault</h2>
            <div className="space-y-2">
              <label className="text-xs text-white/40">Vault directory path</label>
              <div className="flex gap-2 items-center">
                <FolderOpen className="h-4 w-4 text-white/30 shrink-0" />
                <input
                  type="text"
                  value={config.vaultPath}
                  onChange={(e) => setConfig((c) => ({ ...c, vaultPath: e.target.value }))}
                  placeholder="/home/you/ObsidianVault"
                  className="flex-1 bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-white/20 outline-none focus:ring-1 focus:ring-blue-500/50 font-mono"
                />
              </div>
              <p className="text-xs text-white/30">
                Absolute path to your Obsidian vault folder. Changes take effect on next restart.
              </p>
            </div>
          </div>

          <div className="p-5 rounded-xl border border-white/10 bg-white/[0.02] space-y-4">
            <h2 className="text-sm font-semibold text-white/70">Repositories</h2>
            <div className="space-y-2">
              <label className="text-xs text-white/40">Git repositories that sessions can run in (isolated worktree)</label>
              {config.repos.map((repo, i) => (
                <div key={i} className="space-y-1.5">
                <div className="flex gap-2 items-center">
                  <GitBranch className="h-4 w-4 text-white/30 shrink-0" />
                  <input
                    type="text"
                    value={repo}
                    aria-label={`Repository ${i + 1}`}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, repos: c.repos.map((r, j) => (j === i ? e.target.value : r)) }))
                    }
                    placeholder="/home/you/projects/my-repo"
                    className="flex-1 bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-white/20 outline-none focus:ring-1 focus:ring-blue-500/50 font-mono"
                  />
                  <button
                    type="button"
                    aria-label={`Remove repository ${i + 1}`}
                    onClick={() => {
                      setConfig((c) => ({ ...c, repos: c.repos.filter((_, j) => j !== i) }))
                      setVerifyText((v) => v.filter((_, j) => j !== i))
                    }}
                    className="h-8 w-8 flex items-center justify-center rounded text-white/40 hover:text-white hover:bg-white/10"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <input
                  type="text"
                  value={verifyText[i] ?? ""}
                  aria-label={`Verify command for repository ${i + 1}`}
                  onChange={(e) => setVerifyText((v) => { const n = [...v]; n[i] = e.target.value; return n })}
                  placeholder="Verify command before merge, e.g. npm test (optional)"
                  className="ml-6 w-[calc(100%-1.5rem)] bg-white/5 border border-white/10 rounded-md px-3 py-1.5 text-xs text-white placeholder:text-white/20 outline-none focus:ring-1 focus:ring-blue-500/50 font-mono"
                />
                </div>
              ))}
              <button
                type="button"
                onClick={() => setConfig((c) => ({ ...c, repos: [...c.repos, ""] }))}
                className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300"
              >
                <Plus className="h-3.5 w-3.5" /> Add repository
              </button>
              <p className="text-xs text-white/30">
                Absolute path to a repository root. With a verify command set (program and arguments, no shell), a session can only be merged after that command passes in its worktree on the exact diff you approve. Each isolated session gets its own branch and worktree under ~/.axion/worktrees; your checkout is never touched.
              </p>
            </div>
          </div>

          <div className="p-5 rounded-xl border border-white/10 bg-white/[0.02] space-y-4">
            <h2 className="text-sm font-semibold text-white/70">Server</h2>
            <div className="space-y-2">
              <label className="text-xs text-white/40">Port</label>
              <input
                type="number"
                value={config.port}
                onChange={(e) => setConfig((c) => ({ ...c, port: parseInt(e.target.value) || 3000 }))}
                className="bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500/50 font-mono w-32"
              />
              <p className="text-xs text-white/30">Port used by the custom server (default: 3000). Requires restart.</p>
            </div>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <Button
            onClick={save}
            disabled={saving}
            className="gap-2 bg-blue-600 hover:bg-blue-500"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : saved ? (
              <Check className="h-4 w-4" />
            ) : null}
            {saved ? "Saved" : "Save Settings"}
          </Button>
        </div>
      </div>
    </div>
  )
}
