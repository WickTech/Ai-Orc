"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Bell, BellOff } from "lucide-react"
import { useStore } from "@/store"
import { sessionState, type SessionState } from "@/lib/sessions"
import { desktopEnabled, desktopSupported, disableDesktop, enableDesktop } from "@/lib/desktopNotify"

const STATE_STYLE: Record<SessionState, string> = {
  working: "border-green-500/30 text-green-300",
  idle: "border-amber-500/40 text-amber-300",
  stuck: "border-red-500/40 text-red-300",
  done: "border-white/20 text-white/50",
  failed: "border-red-500/40 text-red-300",
}

const KIND_LABEL = { idle: "Idle", done: "Done", failed: "Failed", stuck: "Stuck" } as const

export function SessionBoard() {
  const { terminals, notifications, markNotificationsRead, clearNotifications } = useStore()
  const [now, setNow] = useState(() => Date.now())
  const [desktop, setDesktop] = useState(false)
  // Browser support is only known after mount: rendering it directly would differ from the server HTML.
  const [canNotify, setCanNotify] = useState(false)

  // Re-evaluate idle state without waiting for other updates.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setCanNotify(desktopSupported())
      setDesktop(desktopEnabled())
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  // Viewing the board counts as reading.
  useEffect(() => {
    markNotificationsRead()
  }, [notifications.length, markNotificationsRead])

  async function toggleDesktop() {
    if (desktop) {
      disableDesktop()
      setDesktop(false)
    } else {
      setDesktop(await enableDesktop())
    }
  }

  return (
    <div className="space-y-6">
      <section aria-label="Sessions" className="space-y-2">
        <h2 className="text-xs font-semibold text-white/30 uppercase tracking-wider">Agent sessions</h2>
        {terminals.length === 0 ? (
          <p className="text-sm text-white/40">
            No sessions in this browser tab. Start one from the <Link href="/" className="text-blue-300 hover:underline">Dashboard</Link>.
          </p>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {terminals.map((t) => {
              const state = sessionState(t, now)
              return (
                <Link
                  key={t.id}
                  href="/terminals"
                  className="rounded-md border border-white/10 p-3 hover:bg-white/5 space-y-1"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white/80 font-mono flex-1">{t.label}</span>
                    <span className={`text-[10px] rounded border px-1.5 py-0.5 font-mono uppercase ${STATE_STYLE[state]}`}>{state}</span>
                  </div>
                  {t.branch && <p className="text-[11px] font-mono text-emerald-300/70">{t.branch}</p>}
                  {t.warning && <p className="text-xs text-amber-300">{t.warning}</p>}
                </Link>
              )
            })}
          </div>
        )}
        <p className="text-xs text-white/30">
          Sessions awaiting review or verification are on the <Link href="/worktrees" className="text-blue-300 hover:underline">Worktrees</Link> page.
        </p>
      </section>

      <section aria-label="Notifications" className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold text-white/30 uppercase tracking-wider flex-1">Notifications</h2>
          {canNotify && (
            <button
              type="button"
              onClick={toggleDesktop}
              className="flex items-center gap-1.5 text-xs rounded-md border border-white/15 px-2 py-1 text-white/70 hover:bg-white/10"
            >
              {desktop ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
              {desktop ? "Turn off desktop alerts" : "Turn on desktop alerts"}
            </button>
          )}
          {notifications.length > 0 && (
            <button type="button" onClick={clearNotifications} className="text-xs text-white/50 hover:text-white">
              Clear
            </button>
          )}
        </div>
        {notifications.length === 0 ? (
          <p className="text-sm text-white/40">Nothing yet. You are told when a session goes idle, finishes, fails or looks stuck.</p>
        ) : (
          <ul className="text-xs font-mono space-y-1">
            {notifications.map((n) => (
              <li key={n.id} className="text-white/50">
                {new Date(n.at).toLocaleTimeString()} · <span className="text-white/80">{KIND_LABEL[n.kind]}</span> · {n.message}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
