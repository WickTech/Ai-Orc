"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { LayoutDashboard, TerminalSquare, BookOpen, Package, Settings, Cpu, GitBranch, Radar, ListChecks } from "lucide-react"
import { cn } from "@/lib/utils"
import { useStore } from "@/store"
import { SessionWatcher } from "@/components/sessions/SessionWatcher"

const NAV = [
  { href: "/", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/mission-control", icon: Radar, label: "Mission Control" },
  { href: "/tasks", icon: ListChecks, label: "Tasks" },
  { href: "/terminals", icon: TerminalSquare, label: "Terminals" },
  { href: "/worktrees", icon: GitBranch, label: "Worktrees" },
  { href: "/vault", icon: BookOpen, label: "Vault" },
  { href: "/registry", icon: Package, label: "Registry" },
  { href: "/settings", icon: Settings, label: "Settings" },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { terminals } = useStore()
  const { notifications } = useStore()
  const [needsSignIn, setNeedsSignIn] = useState(false)

  // With AI_ORC_TOKEN set, the API refuses signed-out browsers: say so instead of showing empty pages.
  useEffect(() => {
    if (pathname === "/login") return
    fetch("/api/config")
      .then(async (res) => {
        const body = res.ok ? null : await res.json().catch(() => null)
        setNeedsSignIn(!res.ok && /sign in/i.test(body?.error ?? ""))
      })
      .catch(() => {})
  }, [pathname])
  const runningCount = terminals.filter((t) => t.status === "running").length
  const unread = notifications.filter((n) => !n.read).length

  return (
    <div className="flex h-screen bg-[#0d1117] text-white overflow-hidden">
      <aside className="w-[220px] shrink-0 flex flex-col border-r border-white/10 bg-[#0d1117]">
        <div className="flex items-center gap-2.5 px-4 py-5 border-b border-white/10">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
            <Cpu className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-none">AI-Orc</p>
            <p className="text-[10px] text-white/30 mt-0.5">AI Platform Orchestrator</p>
          </div>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {NAV.map(({ href, icon: Icon, label }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href)
            const badge = href === "/terminals" && runningCount > 0 ? runningCount : href === "/mission-control" && unread > 0 ? unread : null
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                  active
                    ? "bg-blue-600/20 text-blue-300 font-medium"
                    : "text-white/50 hover:text-white/80 hover:bg-white/5"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{label}</span>
                {badge && (
                  <span className="w-4 h-4 rounded-full bg-green-500/20 text-green-400 text-[10px] flex items-center justify-center font-bold">
                    {badge}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="px-4 py-3 border-t border-white/10">
          <p className="text-[10px] text-white/20">Open Source · MIT License</p>
        </div>
      </aside>

      <SessionWatcher />
      <main className="flex-1 overflow-hidden flex flex-col">
        {needsSignIn && (
          <div role="status" className="px-4 py-2 text-sm bg-amber-500/10 text-amber-300 border-b border-amber-500/30">
            This server requires sign-in. <Link href="/login" className="underline">Sign in</Link> to use the app.
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
