import { beforeEach, describe, expect, it } from "vitest"
import { IDLE_AFTER_MS, forgetOutput, lastOutputAt, recordOutput, sessionState } from "@/lib/sessions"
import { useStore } from "@/store"
import type { TerminalState } from "@/types"

const term = (over: Partial<TerminalState> = {}): TerminalState => ({ id: "t1", toolId: "claude", label: "Claude", status: "running", ...over })

describe("sessionState", () => {
  it("is working while output is recent or none has been seen yet", () => {
    expect(sessionState(term(), 1000, undefined)).toBe("working")
    expect(sessionState(term(), 1000 + IDLE_AFTER_MS - 1, 1000)).toBe("working")
  })

  it("is idle once output has been quiet for the idle period", () => {
    expect(sessionState(term(), 1000 + IDLE_AFTER_MS, 1000)).toBe("idle")
  })

  it("reports exit as done or failed by exit code", () => {
    expect(sessionState(term({ status: "exited", exitCode: 0 }), 0, 0)).toBe("done")
    expect(sessionState(term({ status: "exited", exitCode: 2 }), 0, 0)).toBe("failed")
    expect(sessionState(term({ status: "exited" }), 0, 0)).toBe("done")
  })

  it("reports a loop warning as stuck, even when output is recent", () => {
    expect(sessionState(term({ warning: "loop" }), 1000, 1000)).toBe("stuck")
  })

  it("never calls an exited session idle", () => {
    expect(sessionState(term({ status: "exited", exitCode: 0 }), 10 * IDLE_AFTER_MS, 0)).toBe("done")
  })
})

describe("output clock", () => {
  it("records and forgets per terminal", () => {
    recordOutput("a", 5)
    expect(lastOutputAt("a")).toBe(5)
    forgetOutput("a")
    expect(lastOutputAt("a")).toBeUndefined()
  })
})

describe("store notifications and exit handling", () => {
  beforeEach(() => useStore.setState({ terminals: [term()], notifications: [], activeTerminalId: null }))

  it("adds newest first, unread, and caps the list at 50", () => {
    const { notify } = useStore.getState()
    for (let i = 0; i < 60; i++) notify("idle", "t1", `m${i}`)
    const list = useStore.getState().notifications
    expect(list).toHaveLength(50)
    expect(list[0].message).toBe("m59")
    expect(list.every((n) => !n.read)).toBe(true)
    expect(new Set(list.map((n) => n.id)).size).toBe(50)
  })

  it("marks read and clears", () => {
    const s = useStore.getState()
    s.notify("done", "t1", "x")
    useStore.getState().markNotificationsRead()
    expect(useStore.getState().notifications[0].read).toBe(true)
    useStore.getState().clearNotifications()
    expect(useStore.getState().notifications).toEqual([])
  })

  it("stores the exit code and clears it, the warning and the idle clock on restart", () => {
    recordOutput("t1", 1)
    useStore.getState().setTerminalWarning("t1", "loop")
    useStore.getState().setTerminalExit("t1", 3)
    expect(useStore.getState().terminals[0]).toMatchObject({ status: "exited", exitCode: 3, warning: "loop" })
    useStore.getState().updateTerminalStatus("t1", "running")
    const t = useStore.getState().terminals[0]
    expect(t.status).toBe("running")
    expect(t.exitCode).toBeUndefined()
    expect(t.warning).toBeUndefined()
    expect(lastOutputAt("t1")).toBeUndefined()
  })

  it("forgets the idle clock when a terminal is removed", () => {
    recordOutput("t1", 1)
    useStore.getState().removeTerminal("t1")
    expect(lastOutputAt("t1")).toBeUndefined()
  })
})
