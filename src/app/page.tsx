"use client"

import { useEffect } from "react"
import Link from "next/link"
import { useStore } from "@/store"
import { Terminal, Activity, Cpu, Zap } from "lucide-react"
import type { Tool } from "@/types"

function ToolLaunchCard({ tool }: { tool: Tool }) {
  const { terminals } = useStore()
  const running = terminals.filter((t) => t.toolId === tool.id && t.status === "running")
  const href = `/terminals?label=${encodeURIComponent(tool.label)}&toolId=${tool.id}`

  return (
    <div className="p-5 rounded-xl border border-white/10 bg-white/[0.02] flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
          <Cpu className="h-5 w-5 text-blue-400" />
        </div>
        <div className="flex items-center gap-1.5">
          {running.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              {running.length} running
            </span>
          )}
          {tool.builtin && (
            <span className="text-[10px] border border-white/15 text-white/30 rounded px-1.5 py-0.5">built-in</span>
          )}
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-white/90 text-base">{tool.label}</h3>
        <p className="text-sm text-white/40 font-mono mt-1">{tool.command}</p>
      </div>

      <Link
        href={href}
        className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-sm font-medium py-2 px-3 transition-colors"
      >
        <Terminal className="h-3.5 w-3.5" />
        Launch Terminal
      </Link>
    </div>
  )
}

export default function DashboardPage() {
  const { tools, setTools, terminals } = useStore()

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.tools) && d.tools.length > 0) setTools(d.tools)
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const running = terminals.filter((t) => t.status === "running").length

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            <p className="text-white/40 text-sm mt-1">Observe and launch your AI tools from one place.</p>
          </div>
          <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
            <Activity className="h-4 w-4 text-green-400" />
            <span className="text-sm text-white/60">
              <span className="text-white font-medium">{running}</span> running
            </span>
          </div>
        </div>

        {tools.length === 0 ? (
          <div className="text-center py-16 text-white/30">
            <Zap className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p>No tools configured. Go to Registry to add one.</p>
          </div>
        ) : (
          <div>
            <h2 className="text-xs font-semibold text-white/30 uppercase tracking-wider mb-3">Tools & Models</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {tools.map((tool) => <ToolLaunchCard key={tool.id} tool={tool} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
