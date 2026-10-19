import * as pty from "node-pty"
import type { WebSocket } from "ws"
import type { WsMessage } from "@/types"
import { getConfig, getTools } from "@/lib/db"
import { createWorktree, findWorktree, repoIdFor, validateRepo, WorktreeError } from "@/lib/worktree"

interface PtyEntry {
  process: pty.IPty
  clientWs: WebSocket
}

const ptyMap = new Map<string, PtyEntry>()

function send(ws: WebSocket, msg: WsMessage): void {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(msg))
  }
}

export function spawnPty(id: string, command: string, args: string[], ws: WebSocket, cwd?: string): void {
  killPty(id)

  let proc: pty.IPty
  try {
    proc = pty.spawn(command, args, {
      name: "xterm-color",
      cols: 80,
      rows: 24,
      cwd: cwd ?? (process.env.HOME || process.cwd()),
      env: process.env as Record<string, string>,
    })
  } catch (err) {
    send(ws, { type: "terminal:output", id, data: `\r\n\x1b[31mFailed to spawn "${command}": ${err}\x1b[0m\r\n` })
    send(ws, { type: "terminal:exit", id, code: 1 })
    return
  }

  ptyMap.set(id, { process: proc, clientWs: ws })

  proc.onData((data) => send(ws, { type: "terminal:output", id, data }))
  proc.onExit(({ exitCode }) => {
    send(ws, { type: "terminal:exit", id, code: exitCode })
    ptyMap.delete(id)
  })
}

export function sendInput(id: string, data: string): void {
  ptyMap.get(id)?.process.write(data)
}

export function resizePty(id: string, cols: number, rows: number): void {
  ptyMap.get(id)?.process.resize(cols, rows)
}

export function killPty(id: string): void {
  const entry = ptyMap.get(id)
  if (entry) {
    try { entry.process.kill() } catch {}
    ptyMap.delete(id)
  }
}

async function startWorktreeSession(ws: WebSocket, id: string, toolId: string, repoId: string): Promise<string> {
  const { repos } = await getConfig()
  let repoPath: string | undefined
  for (const candidate of repos) {
    const real = await validateRepo(candidate).catch(() => null)
    if (real && repoIdFor(real) === repoId) repoPath = real
  }
  if (!repoPath) throw new WorktreeError("Unknown repository: add it in Settings first")
  // Restarting a session resumes its worktree (the agent's work is in it).
  const existing = await findWorktree(repoPath, id)
  if (existing?.exists && existing.toolId === toolId) {
    send(ws, { type: "terminal:worktree", id, branch: existing.branch, path: existing.path })
    return existing.path
  }
  const info = await createWorktree({ repoPath, sessionId: id, toolId })
  send(ws, { type: "terminal:worktree", id, branch: info.branch, path: info.path })
  return info.path
}

export async function handleWsMessage(ws: WebSocket, raw: string): Promise<void> {
  let msg: WsMessage
  try {
    msg = JSON.parse(raw)
  } catch {
    return
  }

  switch (msg.type) {
    case "terminal:spawn": {
      if (!msg.id || !msg.toolId) break
      const tools = await getTools()
      const tool = tools.find((t) => t.id === msg.toolId)
      if (!tool) {
        send(ws, { type: "terminal:output", id: msg.id, data: `\r\n\x1b[31mUnknown tool: "${msg.toolId}"\x1b[0m\r\n` })
        send(ws, { type: "terminal:exit", id: msg.id, code: 1 })
        break
      }
      let cwd: string | undefined
      if (msg.repoId) {
        // Only ids of repos in the saved config are honoured; the message never
        // carries a path, so a client cannot pick an arbitrary directory.
        try {
          cwd = await startWorktreeSession(ws, msg.id, tool.id, msg.repoId)
        } catch (err) {
          const text = err instanceof WorktreeError ? err.message : String(err)
          send(ws, { type: "terminal:output", id: msg.id, data: `\r\n\x1b[31m${text}\x1b[0m\r\n` })
          send(ws, { type: "terminal:exit", id: msg.id, code: 1 })
          break
        }
      }
      spawnPty(msg.id, tool.command, tool.args ?? [], ws, cwd)
      break
    }
    case "terminal:input":
      if (msg.id && msg.data != null) sendInput(msg.id, msg.data)
      break
    case "terminal:resize":
      if (msg.id && msg.cols && msg.rows) resizePty(msg.id, msg.cols, msg.rows)
      break
    case "terminal:kill":
      if (msg.id) killPty(msg.id)
      break
  }
}

export function cleanupClientPtys(ws: WebSocket): void {
  for (const [id, entry] of ptyMap) {
    if (entry.clientWs === ws) {
      try { entry.process.kill() } catch {}
      ptyMap.delete(id)
    }
  }
}

export function getRunningPtys(): string[] {
  return [...ptyMap.keys()]
}
