import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { defaultContext, evaluateRequest } from "./lib/security"

// Guards every /api route (policy in lib/security.ts): Host must be ours
// (DNS rebinding), mutating browser requests must come from our own origin
// (CSRF), and origin-less mutating requests need AI_ORC_TOKEN.
export function proxy(req: NextRequest) {
  const verdict = evaluateRequest(
    {
      method: req.method,
      host: req.headers.get("host"),
      origin: req.headers.get("origin"),
      authorization: req.headers.get("authorization"),
    },
    defaultContext()
  )
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: 403 })
  return NextResponse.next()
}

export const config = {
  matcher: "/api/:path*",
}
