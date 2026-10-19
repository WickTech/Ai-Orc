"use client"

import { createContext, useContext, useEffect, useRef, useCallback, type ReactNode } from "react"
import { useStore } from "@/store"
import { recordOutput } from "@/lib/sessions"
import type { WsMessage } from "@/types"

type Handler = (msg: WsMessage) => void

interface WsContextValue {
  send: (msg: WsMessage) => void
  subscribe: (handler: Handler) => () => void
}

const WsContext = createContext<WsContextValue>({ send: () => {}, subscribe: () => () => {} })

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const wsRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef(new Set<Handler>())
  const { setTerminalExit, setTerminalWorktree, setTerminalWarning, notify } = useStore()

  useEffect(() => {
    // Match the page scheme: an unencrypted socket URL is blocked as mixed content
    // when the app is served over HTTPS (e.g. behind a TLS reverse proxy).
    const scheme = window.location.protocol === "https:" ? "wss" : "ws"
    const ws = new WebSocket(`${scheme}://${window.location.host}/ws`)
    wsRef.current = ws

    ws.onmessage = (event) => {
      const msg: WsMessage = JSON.parse(event.data)
      if (msg.type === "terminal:output" && msg.id) {
        recordOutput(msg.id)
      }
      if (msg.type === "terminal:exit" && msg.id) {
        const code = msg.code ?? 0
        setTerminalExit(msg.id, code)
        notify(code === 0 ? "done" : "failed", msg.id, code === 0 ? "Session finished" : `Session exited with code ${code}`)
      }
      if (msg.type === "terminal:worktree" && msg.id && msg.branch && msg.path) {
        setTerminalWorktree(msg.id, msg.branch, msg.path)
      }
      if (msg.type === "terminal:warning" && msg.id && msg.data) {
        setTerminalWarning(msg.id, msg.data)
        notify("stuck", msg.id, msg.data)
      }
      handlersRef.current.forEach((fn) => fn(msg))
    }

    ws.onclose = () => { wsRef.current = null }

    return () => {
      ws.close()
    }
  }, [setTerminalExit, setTerminalWorktree, setTerminalWarning, notify])

  const send = useCallback((msg: WsMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  const subscribe = useCallback((handler: Handler) => {
    handlersRef.current.add(handler)
    return () => { handlersRef.current.delete(handler) }
  }, [])

  return <WsContext.Provider value={{ send, subscribe }}>{children}</WsContext.Provider>
}

export const useWebSocket = () => useContext(WsContext)
