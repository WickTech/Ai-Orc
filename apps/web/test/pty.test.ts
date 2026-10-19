import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { execFileSync } from "child_process"
import { realpathSync, writeFileSync } from "fs"
import path from "path"
import { cleanupTempDirs, tempDir, withTempHome } from "./helpers"

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

  it("sends a terminal:warning when the output loops, and still forwards the output", async () => {
    const pty = await load()
    const ws = fakeWs()
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:spawn", id: "loop1", toolId: "claude" }))
    procs[0].emitData("Error: edit failed, retrying\n".repeat(12))
    const types = ws.sent.map((m) => m.type)
    expect(types).toEqual(["terminal:output", "terminal:warning"])
    expect(String(ws.sent[1].data)).toMatch(/Possible loop/)
    expect(ws.sent[1].id).toBe("loop1")
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

function makeRepo(): string {
  const dir = realpathSync(tempDir("ai-orc-repo-"))
  const run = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
    })
  run("init", "-q", "-b", "main")
  writeFileSync(path.join(dir, "a.txt"), "one\n")
  run("add", ".")
  run("commit", "-q", "-m", "init")
  return dir
}

async function loadWithRepo() {
  const { mod, home } = await withTempHome(() => import("@/lib/pty"))
  const db = await import("@/lib/db")
  const wt = await import("@/lib/worktree")
  const repo = makeRepo()
  await db.setConfig({ repos: [repo] })
  return { pty: mod, home, repo, repoId: wt.repoIdFor(repo) }
}

describe("isolated worktree sessions", () => {
  it("spawns inside a fresh worktree and tells the client the branch and path", async () => {
    const { pty, repoId } = await loadWithRepo()
    const ws = fakeWs()
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:spawn", id: "w1", toolId: "claude", repoId }))
    expect(spawnMock).toHaveBeenCalledTimes(1)
    const opts = spawnMock.mock.calls[0][2] as { cwd: string }
    expect(opts.cwd).toContain(path.join(".ai-orc", "worktrees", repoId, "w1"))
    const info = ws.sent.find((m) => m.type === "terminal:worktree")
    expect(info).toMatchObject({ id: "w1", branch: "axion/claude-w1", path: opts.cwd })
  })

  it("reuses the worktree when the same session is started again (restart), even if main became dirty", async () => {
    const { pty, repo, repoId } = await loadWithRepo()
    const ws = fakeWs()
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:spawn", id: "w5", toolId: "claude", repoId }))
    const first = (spawnMock.mock.calls[0][2] as { cwd: string }).cwd
    writeFileSync(path.join(repo, "a.txt"), "dirty\n")
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:spawn", id: "w5", toolId: "claude", repoId }))
    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect((spawnMock.mock.calls[1][2] as { cwd: string }).cwd).toBe(first)
  })

  it("does not reuse a worktree that belongs to a different tool", async () => {
    const { pty, repoId } = await loadWithRepo()
    const ws = fakeWs()
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:spawn", id: "w6", toolId: "claude", repoId }))
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:spawn", id: "w6", toolId: "codex", repoId }))
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(ws.sent.some((m) => String(m.data ?? "").includes("already exists"))).toBe(true)
  })

  it("refuses an unknown repo id without spawning", async () => {
    const { pty } = await loadWithRepo()
    const ws = fakeWs()
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:spawn", id: "w2", toolId: "claude", repoId: "deadbeef0000" }))
    expect(spawnMock).not.toHaveBeenCalled()
    expect(String(ws.sent[0].data)).toContain("Unknown repository")
    expect(ws.sent.some((m) => m.type === "terminal:exit" && m.code === 1)).toBe(true)
  })

  it("refuses to start when the repository has uncommitted changes", async () => {
    const { pty, repo, repoId } = await loadWithRepo()
    writeFileSync(path.join(repo, "a.txt"), "dirty\n")
    const ws = fakeWs()
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:spawn", id: "w3", toolId: "claude", repoId }))
    expect(spawnMock).not.toHaveBeenCalled()
    expect(String(ws.sent[0].data)).toContain("uncommitted changes")
  })

  it("ignores a client-supplied cwd or path and only trusts the configured repo list", async () => {
    const { pty, repoId } = await loadWithRepo()
    const ws = fakeWs()
    await pty.handleWsMessage(
      ws as never,
      msg({ type: "terminal:spawn", id: "w4", toolId: "claude", repoId, cwd: "/etc", path: "/etc" }),
    )
    expect((spawnMock.mock.calls[0][2] as { cwd: string }).cwd).not.toContain("/etc")
  })

  it("rejects a session id that is not a safe slug", async () => {
    const { pty, repoId } = await loadWithRepo()
    const ws = fakeWs()
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:spawn", id: "../x", toolId: "claude", repoId }))
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it("keeps launching plain sessions in the home directory when no repo is chosen", async () => {
    const { pty, home } = await loadWithRepo()
    const ws = fakeWs()
    await pty.handleWsMessage(ws as never, msg({ type: "terminal:spawn", id: "p1", toolId: "claude" }))
    expect((spawnMock.mock.calls[0][2] as { cwd: string }).cwd).toBe(home)
  })
})
