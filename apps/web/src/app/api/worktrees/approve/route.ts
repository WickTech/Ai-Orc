import { NextResponse } from "next/server"
import { errorStatus, findRepo } from "@/lib/repos"
import { approveMerge } from "@/lib/review"

export async function POST(req: Request) {
  let body: { repoId?: unknown; id?: unknown; diffHash?: unknown; message?: unknown }
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
    const result = await approveMerge(repo.path, body.id, {
      diffHash: typeof body.diffHash === "string" ? body.diffHash : undefined,
      message: typeof body.message === "string" ? body.message : undefined,
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: errorStatus(err) })
  }
}
