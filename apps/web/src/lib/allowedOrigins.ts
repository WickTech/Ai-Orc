import { networkInterfaces } from "os"

// Shared between server.ts (WS upgrade) and proxy.ts (CSRF check on mutating
// API routes). req.nextUrl.origin is unreliable here — in this custom-server
// setup it always resolves to http://localhost:<port> regardless of the
// actual Host header, so an explicit allowlist is used instead.
//
// When HOST is set to something other than the 127.0.0.1 default (i.e. the
// user opted into LAN exposure), a browser on the LAN sends Origin as
// http://<this-machine's-LAN-IP>:<port> — not localhost — so the allowlist
// must include this machine's own LAN addresses too, or every LAN request
// gets rejected and HOST=0.0.0.0 silently stops working.
export function allowedOrigins(port: number | string, hostname?: string): Set<string> {
  const origins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`])

  if (hostname && hostname !== "127.0.0.1" && hostname !== "localhost") {
    for (const ifaces of Object.values(networkInterfaces())) {
      for (const iface of ifaces ?? []) {
        if (iface.family === "IPv4" && !iface.internal) {
          origins.add(`http://${iface.address}:${port}`)
        }
      }
    }
  }

  return origins
}

// Host header values (host:port) that correspond to the allowed origins.
// A browser talking to a DNS-rebound name sends that name in Host, so
// checking it on every request closes the rebinding read path that the
// Origin check (mutations and WebSocket only) cannot.
export function allowedHosts(origins: Set<string>): Set<string> {
  return new Set([...origins].map((o) => o.replace(/^https?:\/\//, "")))
}
