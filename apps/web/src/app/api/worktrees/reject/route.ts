import { NextResponse } from "next/server"
import { errorStatus, findRepo } from "@/lib/repos"
import { rejectSession } from "@/lib/review"

export async function POST(req: Request) {
  let body: { repoId?: unknown; id?: unknown; reason?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (typeof body?.repoId !== "string" || typeof body?.id !== "string") {
    return NextResponse.json({ error: "repoId and id are required" }, { status: 400 })
  }

  const repo = await findRepo(body.repoId)
  if (!repo) return NextResponse.json({ error: "Unknown repository" }, { status: 404 })
  try {
    await rejectSession(repo.path, body.id, { reason: typeof body.reason === "string" ? body.reason : undefined })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: errorStatus(err) })
  }
}
