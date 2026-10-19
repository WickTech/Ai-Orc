"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Loader2, Copy, Check, Plus, GitBranch } from "lucide-react"
import type { InstallStep, RegistryAddResult } from "@/types"

interface AddToolModalProps {
  onAdded: (result: RegistryAddResult) => void
}

export function AddToolModal({ onAdded }: AddToolModalProps) {
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<RegistryAddResult | null>(null)

  async function handleAdd() {
    setLoading(true)
    setError("")
    setResult(null)
    try {
      const res = await fetch("/api/registry/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to add tool")
      setResult(data)
      onAdded(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }

  if (result) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center shrink-0 mt-0.5">
            <Check className="h-4 w-4 text-green-400" />
          </div>
          <div>
            <p className="font-semibold text-white">{result.name}</p>
            {result.description && <p className="text-sm text-white/50 mt-0.5 line-clamp-2">{result.description}</p>}
          </div>
        </div>
        {result.installSteps.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-white/40 uppercase tracking-wider">Install steps</p>
            {result.installSteps.map((step, i) => <InstallStepRow key={i} step={step} />)}
          </div>
        ) : (
          <p className="text-sm text-white/40">Repo cloned. No install steps detected — check the README manually.</p>
        )}
        <Button
          variant="outline"
          size="sm"
          className="w-full border-white/10 text-white/60 hover:text-white"
          onClick={() => { setResult(null); setUrl("") }}
        >
          Add another tool
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-white/50 text-sm">
        <GitBranch className="h-4 w-4" />
        <span>Paste a GitHub repository URL to add a tool, skill, or model.</span>
      </div>
      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && url && handleAdd()}
          placeholder="https://github.com/owner/repo"
          className="flex-1 bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:ring-1 focus:ring-blue-500/50"
        />
        <Button onClick={handleAdd} disabled={!url || loading} className="gap-1.5">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {loading ? "Cloning…" : "Add"}
        </Button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}

function InstallStepRow({ step }: { step: InstallStep }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(step.command)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-[#0d1117] rounded-md border border-white/10 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/10">
        <Badge variant="outline" className="text-xs border-white/20 text-white/50">{step.label}</Badge>
        <button onClick={copy} className="text-white/40 hover:text-white/80 transition-colors">
          {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <pre className="px-3 py-2 text-xs font-mono text-green-300/80 overflow-x-auto whitespace-pre-wrap">{step.command}</pre>
    </div>
  )
}
