"use client"

import { Suspense, useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { useStore } from "@/store"
import { useWebSocket } from "@/providers/WebSocketProvider"
import { TerminalGrid } from "@/components/terminal/TerminalGrid"

function SpawnFromUrl() {
  const params = useSearchParams()
  const router = useRouter()
  const { addTerminal } = useStore()
  const { send } = useWebSocket()

  useEffect(() => {
    const label = params.get("label")
    const toolId = params.get("toolId") ?? params.get("id")?.replace(/-\d+$/, "") ?? ""
    const id = params.get("id") ?? (toolId ? `${toolId}-${Date.now()}` : null)

    if (id && toolId && label) {
      addTerminal({ id, toolId, label, status: "running" })
      send({ type: "terminal:spawn", id, toolId })
      router.replace("/terminals")
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

export default function TerminalsPage() {
  return (
    <div className="flex-1 overflow-hidden flex flex-col h-full">
      <Suspense fallback={null}>
        <SpawnFromUrl />
      </Suspense>
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
        <h1 className="text-sm font-semibold text-white/70">Terminals</h1>
      </div>
      <div className="flex-1 overflow-hidden">
        <TerminalGrid />
      </div>
    </div>
  )
}
