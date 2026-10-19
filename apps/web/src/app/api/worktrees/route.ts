import { NextResponse } from "next/server"
import { appendAudit } from "@/lib/audit"
import { configuredRepos, errorStatus, findRepo } from "@/lib/repos"
import { findWorktree, listWorktrees, removeWorktree } from "@/lib/worktree"

export async function GET() {
  const repos = await configuredRepos()
  const worktrees = await listWorktrees(repos.map((r) => r.path))
  return NextResponse.json({ repos, worktrees })
}

export async function DELETE(req: Request) {
  let body: { repoId?: unknown; id?: unknown; force?: unknown }
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

  const force = body.force === true
  try {
    const before = await findWorktree(repo.path, body.id).catch(() => null)
    await removeWorktree(repo.path, body.id, { force })
    await appendAudit({
      action: "removed",
      repoId: repo.id,
      session: body.id,
      branch: before?.branch,
      detail: force ? "forced" : "clean",
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: errorStatus(err) })
  }
  return NextResponse.json({ ok: true })
}
