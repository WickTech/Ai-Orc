import { NextResponse } from "next/server"
import { readAudit } from "@/lib/audit"

export async function GET(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get("limit"))
  const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, 200) : 100
  return NextResponse.json({ entries: await readAudit(limit) })
}
