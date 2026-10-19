"use client"

import "@xterm/xterm/css/xterm.css"
import { useRef } from "react"
import { useTerminal } from "@/hooks/useTerminal"
import { useWebSocket } from "@/providers/WebSocketProvider"
import { useStore } from "@/store"
import { Square, RefreshCw } from "lucide-react"
import type { TerminalState } from "@/types"

interface TerminalPanelProps {
  terminal: TerminalState
  tool: { command: string; args?: string[] }
}

export function TerminalPanel({ terminal, tool }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { send } = useWebSocket()
  const { updateTerminalStatus } = useStore()

  useTerminal(terminal.id, containerRef)

  function handleKill() {
    send({ type: "terminal:kill", id: terminal.id })
    updateTerminalStatus(terminal.id, "exited")
  }

  function handleRestart() {
    send({ type: "terminal:kill", id: terminal.id })
    updateTerminalStatus(terminal.id, "running")
    send({ type: "terminal:spawn", id: terminal.id, toolId: terminal.toolId, repoId: terminal.repoId })
  }

  const statusColor =
    terminal.status === "running" ? "bg-green-500"
    : terminal.status === "exited" ? "bg-red-500"
    : "bg-yellow-500"

  return (
    <div className="flex flex-col h-full bg-[#0d1117] rounded-lg border border-white/10 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-[#161b22]">
        <span className={`inline-block w-2 h-2 rounded-full ${statusColor}`} />
        <span className="text-sm text-white/80 font-mono font-medium">{terminal.label}</span>
        <span className="text-[10px] border border-white/20 text-white/40 rounded px-1 py-0.5 ml-1 font-mono">
          {tool.command}
        </span>
        {terminal.branch && (
          <span
            title={terminal.worktreePath}
            className="text-[10px] border border-emerald-500/30 text-emerald-300/80 rounded px-1 py-0.5 font-mono"
          >
            {terminal.branch}
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          className="h-6 w-6 flex items-center justify-center rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          onClick={handleRestart}
          title="Restart"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="h-6 w-6 flex items-center justify-center rounded text-white/50 hover:text-red-400 hover:bg-white/10 transition-colors"
          onClick={handleKill}
          title="Stop"
        >
          <Square className="h-3.5 w-3.5" />
        </button>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0" />
    </div>
  )
}
