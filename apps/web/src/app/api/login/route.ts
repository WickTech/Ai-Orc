import { NextResponse } from "next/server"
import { SESSION_COOKIE, sessionValue, tokensEqual } from "@/lib/security"

const MAX_FAILURES = 10
const WINDOW_MS = 60_000
let failures: number[] = []

/** Signs in with AI_ORC_TOKEN and sets an HttpOnly session cookie for the browser. */
export async function POST(req: Request) {
  const token = process.env.AI_ORC_TOKEN
  if (!token) return NextResponse.json({ error: "Sign-in is not enabled: set AI_ORC_TOKEN" }, { status: 404 })

  const now = Date.now()
  failures = failures.filter((t) => now - t < WINDOW_MS)
  if (failures.length >= MAX_FAILURES) {
    return NextResponse.json({ error: "Too many attempts: wait a minute" }, { status: 429 })
  }

  let supplied: unknown
  try {
    supplied = (await req.json())?.token
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (typeof supplied !== "string" || !tokensEqual(supplied, token)) {
    failures.push(now)
    return NextResponse.json({ error: "Wrong token" }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, sessionValue(token), {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 7 * 24 * 3600,
  })
  return res
}
