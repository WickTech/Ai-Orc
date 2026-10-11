import * as pty from "node-pty"
import type { WebSocket } from "ws"
import type { WsMessage } from "@/types"
import { getTools } from "@/lib/db"

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

export function spawnPty(id: string, command: string, args: string[], ws: WebSocket): void {
  killPty(id)

  let proc: pty.IPty
  try {
    proc = pty.spawn(command, args, {
      name: "xterm-color",
      cols: 80,
      rows: 24,
      cwd: process.env.HOME || process.cwd(),
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
      spawnPty(msg.id, tool.command, tool.args ?? [], ws)
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
