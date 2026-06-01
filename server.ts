import { createServer } from "http"
import { parse } from "url"
import next from "next"
import { WebSocketServer, WebSocket } from "ws"
import { handleWsMessage, cleanupClientPtys } from "./src/lib/pty"
import { startVaultWatcher } from "./src/lib/vault"
import { getConfig } from "./src/lib/db"
import type { WsMessage } from "./src/types"

process.on("uncaughtException", (err) => {
  console.error("[AI-Orc] Uncaught exception:", err)
})

process.on("unhandledRejection", (reason) => {
  console.error("[AI-Orc] Unhandled rejection:", reason)
})

const dev = process.env.NODE_ENV !== "production"
const hostname = "0.0.0.0"
const port = parseInt(process.env.PORT ?? "3000", 10)

const clients = new Set<WebSocket>()

export function broadcast(msg: WsMessage): void {
  const data = JSON.stringify(msg)
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data)
  }
}

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app
  .prepare()
  .then(async () => {
    const config = await getConfig()
    if (config.vaultPath) {
      startVaultWatcher(config.vaultPath, broadcast)
    }

    const httpServer = createServer(async (req, res) => {
      try {
        const parsedUrl = parse(req.url!, true)
        await handle(req, res, parsedUrl)
      } catch (err) {
        console.error("[AI-Orc] Request handler error:", err)
        res.statusCode = 500
        res.end("Internal server error")
      }
    })

    httpServer.on("error", (err) => {
      console.error("[AI-Orc] HTTP server error:", err)
    })

    const wss = new WebSocketServer({ noServer: true })

    httpServer.on("upgrade", (request, socket, head) => {
      const { pathname } = parse(request.url!)
      if (pathname === "/ws") {
        wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request))
      } else {
        socket.destroy()
      }
    })

    wss.on("connection", (ws: WebSocket) => {
      clients.add(ws)
      ws.on("message", (raw) => handleWsMessage(ws, raw.toString()))
      ws.on("close", () => {
        clients.delete(ws)
        cleanupClientPtys(ws)
      })
    })

    httpServer.listen(port, hostname, () => {
      console.log(`\n  \x1b[36m AI-Orc\x1b[0m  ready on \x1b[4mhttp://localhost:${port}\x1b[0m\n`)
    })
  })
  .catch((err) => {
    console.error("[AI-Orc] Failed to start:", err)
    process.exit(1)
  })
