"use client"

import { useEffect, useState } from "react"
import { AddToolModal } from "@/components/registry/AddToolModal"
import { ToolCard } from "@/components/registry/ToolCard"
import { Package } from "lucide-react"
import type { Tool, RegistryAddResult } from "@/types"

export default function RegistryPage() {
  const [tools, setTools] = useState<Tool[]>([])

  async function load() {
    const res = await fetch("/api/registry")
    const data = await res.json()
    if (Array.isArray(data)) setTools(data)
  }

  useEffect(() => { load() }, [])

  function handleAdded(result: RegistryAddResult) {
    const newTool: Tool = {
      id: result.name.toLowerCase().replace(/\s+/g, "-"),
      label: result.name,
      command: result.name,
      repoUrl: result.repoUrl,
      clonePath: result.clonePath,
    }
    setTools((prev) => {
      const exists = prev.find((t) => t.id === newTool.id)
      return exists ? prev : [...prev, newTool]
    })
  }

  function handleRemoved(id: string) {
    setTools((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Tool Registry</h1>
          <p className="text-white/40 text-sm mt-1">
            Add any open-source AI tool, model, or skill by pasting its GitHub URL.
          </p>
        </div>

        <div className="p-5 rounded-xl border border-white/10 bg-white/[0.02]">
          <AddToolModal onAdded={handleAdded} />
        </div>

        <div>
          <h2 className="text-xs font-semibold text-white/30 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Package className="h-3.5 w-3.5" />
            Installed Tools ({tools.length})
          </h2>
          <div className="space-y-2">
            {tools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} onRemoved={handleRemoved} />
            ))}
            {tools.length === 0 && (
              <p className="text-white/30 text-sm text-center py-8">No tools installed yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
