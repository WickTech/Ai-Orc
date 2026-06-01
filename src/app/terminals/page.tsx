"use client"

import { TerminalGrid } from "@/components/terminal/TerminalGrid"

export default function TerminalsPage() {
  return (
    <div className="flex-1 overflow-hidden flex flex-col h-full">
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
        <h1 className="text-sm font-semibold text-white/70">Terminals</h1>
      </div>
      <div className="flex-1 overflow-hidden">
        <TerminalGrid />
      </div>
    </div>
  )
}
