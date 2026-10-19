import { NextResponse } from "next/server"
import { errorStatus, findRepo } from "@/lib/repos"
import { getReview } from "@/lib/review"

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams
  const repoId = params.get("repoId")
  const id = params.get("id")
  if (!repoId || !id) return NextResponse.json({ error: "repoId and id are required" }, { status: 400 })

  const repo = await findRepo(repoId)
  if (!repo) return NextResponse.json({ error: "Unknown repository" }, { status: 404 })
  try {
    return NextResponse.json(await getReview(repo.path, id))
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: errorStatus(err) })
  }
}
