"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Check, Loader2, FolderOpen } from "lucide-react"

interface Config {
  vaultPath: string
  port: number
}

export default function SettingsPage() {
  const [config, setConfig] = useState<Config>({ vaultPath: "", port: 3000 })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => { if (d.config) setConfig(d.config) })
      .catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    try {
      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-white/40 text-sm mt-1">Configure AI-Orc for your local environment.</p>
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
