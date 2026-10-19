import { createServer } from "http"
import { parse } from "url"
import next from "next"
import { WebSocketServer, WebSocket } from "ws"
import { handleWsMessage, cleanupClientPtys } from "./src/lib/pty"
import { startVaultWatcher } from "./src/lib/vault"
import { getConfig } from "./src/lib/db"
import { allowedOrigins, allowedHosts } from "./src/lib/allowedOrigins"
import { isAllowedUpgrade } from "./src/lib/security"
import type { WsMessage } from "./src/types"

process.on("uncaughtException", (err) => {
  console.error("[Axion] Uncaught exception:", err)
})

process.on("unhandledRejection", (reason) => {
  console.error("[Axion] Unhandled rejection:", reason)
})

const dev = process.env.NODE_ENV !== "production"
// Default to loopback only — WSL2 forwards localhost automatically, so
// 0.0.0.0 isn't needed for the documented WSL use case and previously
// exposed the unauthenticated terminal-spawn WebSocket to the whole LAN.
// Set HOST=0.0.0.0 explicitly to opt into LAN exposure.
const hostname = process.env.HOST ?? "127.0.0.1"
const port = parseInt(process.env.PORT ?? "3000", 10)

const clients = new Set<WebSocket>()

// Browsers don't enforce same-origin on WebSocket handshakes, so binding to
// loopback alone doesn't stop a malicious webpage from opening ws://127.0.0.1
// directly and driving unauthenticated terminal spawn. Require the handshake's
// Origin to be this app's own served origin.
const ALLOWED_WS_ORIGINS = allowedOrigins(port, hostname)
const ALLOWED_WS_HOSTS = allowedHosts(ALLOWED_WS_ORIGINS)

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
        console.error("[Axion] Request handler error:", err)
        res.statusCode = 500
        res.end("Internal server error")
      }
    })

    httpServer.on("error", (err) => {
      console.error("[Axion] HTTP server error:", err)
    })

    const wss = new WebSocketServer({ noServer: true })

    httpServer.on("upgrade", (request, socket, head) => {
      if (isAllowedUpgrade(request, ALLOWED_WS_ORIGINS, ALLOWED_WS_HOSTS)) {
        wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request))
      } else {
        socket.destroy()
      }
    })

    wss.on("connection", (ws: WebSocket) => {
      clients.add(ws)
      ws.on("message", (raw) => {
        handleWsMessage(ws, raw.toString()).catch((err) => console.error("[Axion] WS message error:", err))
      })
      ws.on("close", () => {
        clients.delete(ws)
        cleanupClientPtys(ws)
      })
    })

    httpServer.listen(port, hostname, () => {
      console.log(`\n  \x1b[36m Axion\x1b[0m  ready on \x1b[4mhttp://localhost:${port}\x1b[0m\n`)
    })
  })
  .catch((err) => {
    console.error("[Axion] Failed to start:", err)
    process.exit(1)
  })
