import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanupTempDirs, withTempHome } from "./helpers"

type Handler = (arg: never) => void
function fakeProc() {
  const handlers: Record<string, Handler> = {}
  return {
    onData: (h: Handler) => void (handlers.data = h),
    onExit: (h: Handler) => void (handlers.exit = h),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    emitData: (d: string) => handlers.data?.(d as never),
    emitExit: (code: number) => handlers.exit?.({ exitCode: code } as never),
  }
}

const spawnMock = vi.fn()
vi.mock("node-pty", () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }))

function fakeWs() {
  const sent: Array<Record<string, unknown>> = []
  return { readyState: 1, send: (s: string) => sent.push(JSON.parse(s)), sent }
}

let procs: ReturnType<typeof fakeProc>[]

beforeEach(() => {
  procs = []
  spawnMock.mockReset()
  spawnMock.mockImplementation(() => {
    const p = fakeProc()
    procs.push(p)
    return p
  })
})

afterEach(() => {
  cleanupTempDirs()
  vi.unstubAllEnvs()
})

async function load() {
  const { mod } = await withTempHome(() => import("@/lib/pty"))
  return mod
}

const msg = (m: object) => JSON.stringify(m)

describe("handleWsMessage", () => {
  it("spawns the opencode adapter by its bare command", async () => {
    const pty = await load()
    const ws = fakeWs()
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:spawn", id: "t9", toolId: "opencode" }))
    expect(spawnMock.mock.calls[0][0]).toBe("opencode")
    expect(spawnMock.mock.calls[0][1]).toEqual([])
  })

  it("spawns a registered tool using the server-side command and args", async () => {
    const pty = await load()
    const ws = fakeWs()
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:spawn", id: "t1", toolId: "claude" }))
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock.mock.calls[0][0]).toBe("claude")
    expect(spawnMock.mock.calls[0][1]).toEqual([])
    expect(pty.getRunningPtys()).toEqual(["t1"])
  })

  it("ignores a client-supplied command/args and uses the registry's", async () => {
    const pty = await load()
    const ws = fakeWs()
    await pty.handleWsMessage(
      ws as never,
      msg({ type: "terminal:spawn", id: "t1", toolId: "claude", command: "rm", args: ["-rf", "/"] })
    )
    expect(spawnMock.mock.calls[0][0]).toBe("claude")
    expect(spawnMock.mock.calls[0][1]).toEqual([])
  })

  it("reports an unknown tool and does not spawn", async () => {
    const pty = await load()
    const ws = fakeWs()
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:spawn", id: "t1", toolId: "nope" }))
    expect(spawnMock).not.toHaveBeenCalled()
    expect(ws.sent[0].type).toBe("terminal:output")
    expect(String(ws.sent[0].data)).toContain('Unknown tool: "nope"')
    expect(ws.sent[1]).toMatchObject({ type: "terminal:exit", id: "t1", code: 1 })
  })

  it("ignores spawn requests missing id or toolId", async () => {
    const pty = await load()
    const ws = fakeWs()
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:spawn", toolId: "claude" }))
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:spawn", id: "t1" }))
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it("ignores malformed JSON and unknown message types", async () => {
    const pty = await load()
    const ws = fakeWs()
    await expect(pty.handleWsMessage(ws as never, "{not json")).resolves.toBeUndefined()
    await expect(pty.handleWsMessage(ws as never, msg({ type: "terminal:explode" }))).resolves.toBeUndefined()
    expect(ws.sent).toEqual([])
  })

  it("forwards input, resize and kill to the right terminal", async () => {
    const pty = await load()
    const ws = fakeWs()
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:spawn", id: "t1", toolId: "claude" }))
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:input", id: "t1", data: "ls\r" }))
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:resize", id: "t1", cols: 120, rows: 40 }))
    expect(procs[0].write).toHaveBeenCalledWith("ls\r")
    expect(procs[0].resize).toHaveBeenCalledWith(120, 40)
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:kill", id: "t1" }))
    expect(procs[0].kill).toHaveBeenCalled()
    expect(pty.getRunningPtys()).toEqual([])
  })

  it("input for an unknown terminal id is a no-op", async () => {
    const pty = await load()
    const ws = fakeWs()
    await expect(pty.handleWsMessage(ws as never, msg({ type: "terminal:input", id: "ghost", data: "x" }))).resolves.toBeUndefined()
  })

  it("streams output and the exit code to the client, then forgets the terminal", async () => {
    const pty = await load()
    const ws = fakeWs()
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:spawn", id: "t1", toolId: "claude" }))
    procs[0].emitData("hello")
    procs[0].emitExit(0)
    expect(ws.sent).toEqual([
      { type: "terminal:output", id: "t1", data: "hello" },
      { type: "terminal:exit", id: "t1", code: 0 },
    ])
    expect(pty.getRunningPtys()).toEqual([])
  })

  it("spawning with an id already in use kills the previous terminal", async () => {
    const pty = await load()
    const ws = fakeWs()
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:spawn", id: "t1", toolId: "claude" }))
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:spawn", id: "t1", toolId: "gemini" }))
    expect(procs[0].kill).toHaveBeenCalled()
    expect(pty.getRunningPtys()).toEqual(["t1"])
  })

  it("reports a spawn failure instead of throwing", async () => {
    const pty = await load()
    const ws = fakeWs()
    spawnMock.mockImplementationOnce(() => {
      throw new Error("ENOENT")
    })
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:spawn", id: "t1", toolId: "claude" }))
    expect(String(ws.sent[0].data)).toContain('Failed to spawn "claude"')
    expect(ws.sent[1]).toMatchObject({ type: "terminal:exit", code: 1 })
    expect(pty.getRunningPtys()).toEqual([])
  })
})

describe("cleanupClientPtys", () => {
  it("kills only the terminals that belong to the disconnected client", async () => {
    const pty = await load()
    const a = fakeWs()
    const b = fakeWs()
    await pty.handleWsMessage(a as never, msg({ type: "terminal:spawn", id: "a1", toolId: "claude" }))
    await pty.handleWsMessage(b as never, msg({ type: "terminal:spawn", id: "b1", toolId: "claude" }))
    pty.cleanupClientPtys(a as never)
    expect(procs[0].kill).toHaveBeenCalled()
    expect(procs[1].kill).not.toHaveBeenCalled()
    expect(pty.getRunningPtys()).toEqual(["b1"])
  })
})
