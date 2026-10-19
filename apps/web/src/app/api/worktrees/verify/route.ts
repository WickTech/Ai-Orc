import { NextResponse } from "next/server"
import { errorStatus, findRepo } from "@/lib/repos"
import { runVerify } from "@/lib/verify"

export async function POST(req: Request) {
  let body: { repoId?: unknown; id?: unknown }
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
    return NextResponse.json(await runVerify(repo.path, body.id))
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: errorStatus(err) })
  }
}
