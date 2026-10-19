import type { TerminalState } from "@/types"

/** No output for this long after a session printed something: it is probably waiting for you. */
export const IDLE_AFTER_MS = 30_000

export type SessionState = "working" | "idle" | "done" | "failed" | "stuck"

// Last output time per terminal. Kept outside the store: output arrives many
// times a second and must not re-render the app.
const lastOutput = new Map<string, number>()

export function recordOutput(id: string, now = Date.now()): void {
  lastOutput.set(id, now)
}

export function lastOutputAt(id: string): number | undefined {
  return lastOutput.get(id)
}

export function forgetOutput(id: string): void {
  lastOutput.delete(id)
}

export function sessionState(t: TerminalState, now = Date.now(), lastAt = lastOutput.get(t.id)): SessionState {
  if (t.status === "exited") return t.exitCode === undefined || t.exitCode === 0 ? "done" : "failed"
  if (t.warning) return "stuck"
  if (t.status === "running" && lastAt !== undefined && now - lastAt >= IDLE_AFTER_MS) return "idle"
  return "working"
}
