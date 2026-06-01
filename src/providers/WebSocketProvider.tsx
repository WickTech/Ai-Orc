"use client"

import { createContext, useContext, useEffect, useRef, useCallback, type ReactNode } from "react"
import { useStore } from "@/store"
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
  const { updateTerminalStatus } = useStore()

  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.host}/ws`)
    wsRef.current = ws

    ws.onmessage = (event) => {
      const msg: WsMessage = JSON.parse(event.data)
      if (msg.type === "terminal:exit" && msg.id) {
        updateTerminalStatus(msg.id, "exited")
      }
      handlersRef.current.forEach((fn) => fn(msg))
    }

    ws.onclose = () => { wsRef.current = null }

    return () => {
      ws.close()
    }
  }, [updateTerminalStatus])

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
