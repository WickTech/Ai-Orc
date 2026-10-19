"use client"

import { useEffect } from "react"
import { useStore } from "@/store"
import { lastOutputAt, sessionState } from "@/lib/sessions"

const CHECK_EVERY_MS = 5_000

/** Raises an "idle" notification once per quiet period of each running session. */
export function SessionWatcher() {
  useEffect(() => {
    const notifiedFor = new Map<string, number>()
    const timer = setInterval(() => {
      const { terminals, notify } = useStore.getState()
      for (const t of terminals) {
        const at = lastOutputAt(t.id)
        if (at === undefined || sessionState(t) !== "idle" || notifiedFor.get(t.id) === at) continue
        notifiedFor.set(t.id, at)
        notify("idle", t.id, `${t.label} has been quiet for a while: it may be waiting for you`)
      }
    }, CHECK_EVERY_MS)
    return () => clearInterval(timer)
  }, [])
  return null
}
