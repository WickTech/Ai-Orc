import { allowedOrigins, allowedHosts } from "@/lib/allowedOrigins"

// Constant-time comparison so a token can't be guessed byte by byte from
// response timing. Empty or missing values never match.
export function tokensEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  let diff = a.length ^ b.length
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

export interface UpgradeRequest {
  url?: string
  headers: { origin?: string; host?: string }
}

// WebSocket handshakes aren't covered by the same-origin policy, so require
// the right path, an allowed Origin, and an allowed Host (DNS rebinding).
export function isAllowedUpgrade(
  request: UpgradeRequest,
  origins: Set<string>,
  hosts: Set<string>
): boolean {
  const pathname = (request.url ?? "").split("?")[0]
  const { origin, host } = request.headers
  return pathname === "/ws" && !!origin && origins.has(origin) && !!host && hosts.has(host)
}

export type RequestVerdict = { ok: true } | { ok: false; error: string }

export interface RequestInfo {
  method: string
  host: string | null
  origin: string | null
  authorization: string | null
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

// Policy for /api requests:
//  1. Host must be one of our own (blocks DNS rebinding, including reads).
//  2. Mutating requests from a browser carry an Origin and it must be ours.
//  3. Mutating requests without an Origin (curl, scripts) must present
//     AI_ORC_TOKEN as a bearer token; with no token configured they are refused.
export function evaluateRequest(
  req: RequestInfo,
  ctx: { origins: Set<string>; hosts: Set<string>; token?: string }
): RequestVerdict {
  if (!req.host || !ctx.hosts.has(req.host)) return { ok: false, error: "Invalid host" }
  if (SAFE_METHODS.has(req.method)) return { ok: true }

  if (req.origin) {
    return ctx.origins.has(req.origin) ? { ok: true } : { ok: false, error: "Cross-origin request blocked" }
  }

  const bearer = /^Bearer (.+)$/.exec(req.authorization ?? "")?.[1]
  if (tokensEqual(bearer, ctx.token)) return { ok: true }
  return { ok: false, error: "Origin header or API token required" }
}

export function defaultContext(token = process.env.AI_ORC_TOKEN) {
  const origins = allowedOrigins(process.env.PORT ?? "3000", process.env.HOST ?? "127.0.0.1")
  return { origins, hosts: allowedHosts(origins), token }
}
