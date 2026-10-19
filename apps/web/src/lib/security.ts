import { createHash } from "crypto"
import { allowedOrigins, allowedHosts } from "@/lib/allowedOrigins"
import { apiToken } from "@/lib/paths"

// Constant-time comparison so a token can't be guessed byte by byte from
// response timing. Empty or missing values never match.
export function tokensEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  let diff = a.length ^ b.length
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

export const SESSION_COOKIE = "axion_session"

/** What the session cookie holds: derived from the token, never the token itself. */
export function sessionValue(token: string): string {
  return createHash("sha256").update(`axion-session:${token}`).digest("hex")
}

function cookieValue(header: string | null | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return rest.join("=")
  }
  return undefined
}

function bearerOf(authorization: string | null | undefined): string | undefined {
  return /^Bearer (.+)$/.exec(authorization ?? "")?.[1]
}

/** True when the request carries the API token as a bearer or a valid session cookie. */
export function isAuthenticated(token: string, authorization: string | null | undefined, cookie: string | null | undefined): boolean {
  return tokensEqual(bearerOf(authorization), token) || tokensEqual(cookieValue(cookie, SESSION_COOKIE), sessionValue(token))
}

export interface UpgradeRequest {
  url?: string
  headers: { origin?: string; host?: string; cookie?: string; authorization?: string }
}

// WebSocket handshakes aren't covered by the same-origin policy, so require
// the right path, an allowed Origin, and an allowed Host (DNS rebinding).
// With an API token configured the handshake must also be authenticated, so a
// local program that merely forges those headers cannot start terminals.
export function isAllowedUpgrade(
  request: UpgradeRequest,
  origins: Set<string>,
  hosts: Set<string>,
  token?: string
): boolean {
  const pathname = (request.url ?? "").split("?")[0]
  const { origin, host, cookie, authorization } = request.headers
  if (!(pathname === "/ws" && !!origin && origins.has(origin) && !!host && hosts.has(host))) return false
  return !token || isAuthenticated(token, authorization, cookie)
}

export type RequestVerdict = { ok: true } | { ok: false; error: string }

export interface RequestInfo {
  method: string
  pathname?: string
  cookie?: string | null
  host: string | null
  origin: string | null
  authorization: string | null
}

export const LOGIN_PATH = "/api/login"
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

// Policy for /api requests:
//  1. Host must be one of our own (blocks DNS rebinding, including reads).
//  2. Mutating requests from a browser carry an Origin and it must be ours.
//  3. Mutating requests without an Origin (curl, scripts) must present
//     AXION_TOKEN as a bearer token; with no token configured they are refused.
//  4. With AXION_TOKEN configured, every request (reads too) must carry the
//     token as a bearer or the session cookie issued by /api/login.
export function evaluateRequest(
  req: RequestInfo,
  ctx: { origins: Set<string>; hosts: Set<string>; token?: string }
): RequestVerdict {
  if (!req.host || !ctx.hosts.has(req.host)) return { ok: false, error: "Invalid host" }
  if (ctx.token && req.pathname !== LOGIN_PATH && !isAuthenticated(ctx.token, req.authorization, req.cookie)) {
    return { ok: false, error: "Authentication required: sign in at /login" }
  }
  if (req.pathname === LOGIN_PATH && req.method === "POST") {
    // Sign-in comes from the login page: same-origin only, and it carries the token in the body.
    return req.origin && ctx.origins.has(req.origin) ? { ok: true } : { ok: false, error: "Cross-origin request blocked" }
  }
  if (SAFE_METHODS.has(req.method)) return { ok: true }

  if (req.origin) {
    return ctx.origins.has(req.origin) ? { ok: true } : { ok: false, error: "Cross-origin request blocked" }
  }

  if (tokensEqual(bearerOf(req.authorization), ctx.token)) return { ok: true }
  return { ok: false, error: "Origin header or API token required" }
}

export function defaultContext(token = apiToken()) {
  const origins = allowedOrigins(process.env.PORT ?? "3000", process.env.HOST ?? "127.0.0.1")
  return { origins, hosts: allowedHosts(origins), token }
}
