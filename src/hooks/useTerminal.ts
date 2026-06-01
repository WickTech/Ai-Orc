"use client"

import { useEffect, useRef, type RefObject } from "react"
import { useWebSocket } from "@/providers/WebSocketProvider"
import type { WsMessage } from "@/types"

export function useTerminal(id: string, containerRef: RefObject<HTMLDivElement | null>) {
  const { send, subscribe } = useWebSocket()
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    let term: import("@xterm/xterm").Terminal
    let fitAddon: import("@xterm/addon-fit").FitAddon
    let ro: ResizeObserver

    async function init() {
      const { Terminal } = await import("@xterm/xterm")
      const { FitAddon } = await import("@xterm/addon-fit")
      await import("@xterm/xterm/css/xterm.css")

      term = new Terminal({
        theme: { background: "#0d1117", foreground: "#c9d1d9", cursor: "#58a6ff", selectionBackground: "#264f78" },
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace',
        fontSize: 14,
        lineHeight: 1.4,
        cursorBlink: true,
        scrollback: 5000,
      })
      fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.open(containerRef.current!)
      fitAddon.fit()
      termRef.current = term

      term.onData((data) => send({ type: "terminal:input", id, data }))

      ro = new ResizeObserver(() => {
        fitAddon.fit()
        send({ type: "terminal:resize", id, cols: term.cols, rows: term.rows })
      })
      ro.observe(containerRef.current!)
    }

    init()

    const unsubscribe = subscribe((msg: WsMessage) => {
      if (msg.id !== id) return
      if (msg.type === "terminal:output" && msg.data) term?.write(msg.data)
      if (msg.type === "terminal:exit") term?.writeln("\r\n\x1b[33m[process exited]\x1b[0m")
    })

    return () => {
      unsubscribe()
      ro?.disconnect()
      term?.dispose()
      termRef.current = null
    }
  }, [id, containerRef, send, subscribe])

  return { terminal: termRef }
}
