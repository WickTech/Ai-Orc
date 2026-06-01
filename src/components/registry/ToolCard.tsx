"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Terminal, Trash2, ExternalLink } from "lucide-react"
import { useStore } from "@/store"
import { useWebSocket } from "@/providers/WebSocketProvider"
import { useRouter } from "next/navigation"
import type { Tool } from "@/types"

export function ToolCard({ tool, onRemoved }: { tool: Tool; onRemoved?: (id: string) => void }) {
  const [removing, setRemoving] = useState(false)
  const { addTerminal, updateTerminalStatus } = useStore()
  const { send } = useWebSocket()
  const router = useRouter()

  function launch() {
    const id = `${tool.id}-${Date.now()}`
    addTerminal({ id, toolId: tool.id, label: tool.label, status: "running" })
    send({ type: "terminal:spawn", id, command: tool.command, args: tool.args })
    router.push("/terminals")
  }

  async function remove() {
    if (tool.builtin) return
    setRemoving(true)
    await fetch(`/api/registry/${tool.id}`, { method: "DELETE" })
    onRemoved?.(tool.id)
    setRemoving(false)
  }

  return (
    <div className="flex items-center gap-3 p-4 rounded-lg border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition-colors group">
      <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
        <Terminal className="h-4.5 w-4.5 text-blue-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-white/90">{tool.label}</span>
          {tool.builtin && (
            <Badge variant="outline" className="text-xs border-white/20 text-white/30">built-in</Badge>
          )}
        </div>
        <p className="text-xs text-white/40 font-mono mt-0.5 truncate">{tool.command}{tool.args?.length ? " " + tool.args.join(" ") : ""}</p>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {tool.repoUrl && (
          <a
            href={tool.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-white/40 hover:text-white transition-colors hover:bg-white/5"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {!tool.builtin && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-white/40 hover:text-red-400"
            onClick={remove}
            disabled={removing}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button size="sm" onClick={launch} className="h-7 gap-1.5 text-xs bg-blue-600 hover:bg-blue-500">
          <Terminal className="h-3 w-3" />
          Launch
        </Button>
      </div>
    </div>
  )
}
