import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { allowedOrigins } from "./lib/allowedOrigins"

const ALLOWED = allowedOrigins(process.env.PORT ?? "3000", process.env.HOST ?? "127.0.0.1")

// Blocks CSRF against mutating API routes (/api/config, /api/registry/*,
// /api/vault/*): a cross-origin request always carries an Origin header
// that won't match this app's own origin, even when it dodges preflight
// via a "simple" Content-Type like text/plain.
export function proxy(req: NextRequest) {
  const isMutating = !["GET", "HEAD", "OPTIONS"].includes(req.method)
  if (isMutating) {
    const origin = req.headers.get("origin")
    if (origin && !ALLOWED.has(origin)) {
      return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 })
    }
  }
  return NextResponse.next()
}

export const config = {
  matcher: "/api/:path*",
}
