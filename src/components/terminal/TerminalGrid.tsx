"use client"

import { useStore } from "@/store"
import { useWebSocket } from "@/providers/WebSocketProvider"
import { TerminalPanel } from "./TerminalPanel"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

export function TerminalGrid() {
  const { terminals, activeTerminalId, setActiveTerminal, removeTerminal, tools } = useStore()
  const { send } = useWebSocket()

  if (terminals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/30 gap-3">
        <p className="text-lg">No terminals open</p>
        <p className="text-sm">Launch a tool from the Dashboard to get started.</p>
      </div>
    )
  }

  function closeTerminal(id: string) {
    send({ type: "terminal:kill", id })
    removeTerminal(id)
  }

  const active = terminals.find((t) => t.id === activeTerminalId) ?? terminals[0]

  return (
    <div className="flex flex-col h-full gap-0">
      <div className="flex items-center gap-1 px-2 py-1.5 bg-[#161b22] border-b border-white/10 overflow-x-auto">
        {terminals.map((t) => (
          <div
            key={t.id}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-md text-sm font-mono cursor-pointer select-none group transition-colors",
              t.id === active?.id
                ? "bg-white/10 text-white"
                : "text-white/50 hover:text-white/80 hover:bg-white/5"
            )}
            onClick={() => setActiveTerminal(t.id)}
          >
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                t.status === "running" ? "bg-green-400" : t.status === "exited" ? "bg-red-400" : "bg-yellow-400"
              )}
            />
            <span className="max-w-[120px] truncate">{t.label}</span>
            <button
              className="ml-1 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
              onClick={(e) => { e.stopPropagation(); closeTerminal(t.id) }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex-1 p-2 overflow-hidden relative">
        {terminals.map((t) => {
          const tool = tools.find((tl) => tl.id === t.toolId) ?? { command: t.label, args: [] }
          return (
            <div
              key={t.id}
              className={cn("absolute inset-2", t.id !== active?.id && "hidden")}
            >
              <TerminalPanel terminal={t} tool={tool} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
