"use client"

import { useRef } from "react"
import { useTerminal } from "@/hooks/useTerminal"
import { useWebSocket } from "@/providers/WebSocketProvider"
import { useStore } from "@/store"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
    send({ type: "terminal:spawn", id: terminal.id, command: tool.command, args: tool.args })
  }

  const statusColor =
    terminal.status === "running"
      ? "bg-green-500"
      : terminal.status === "exited"
        ? "bg-red-500"
        : "bg-yellow-500"

  return (
    <div className="flex flex-col h-full bg-[#0d1117] rounded-lg border border-white/10 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-[#161b22]">
        <span className={`inline-block w-2 h-2 rounded-full ${statusColor}`} />
        <span className="text-sm text-white/80 font-mono font-medium">{terminal.label}</span>
        <Badge variant="outline" className="text-xs text-white/40 border-white/20 ml-1">
          {tool.command}
        </Badge>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-white/50 hover:text-white"
          onClick={handleRestart}
          title="Restart"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-white/50 hover:text-red-400"
          onClick={handleKill}
          title="Stop"
        >
          <Square className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div ref={containerRef} className="flex-1 p-1" />
    </div>
  )
}
