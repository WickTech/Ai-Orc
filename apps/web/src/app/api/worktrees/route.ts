import path from "path"
import { NextResponse } from "next/server"
import { getConfig } from "@/lib/db"
import { listWorktrees, removeWorktree, repoIdFor, validateRepo, WorktreeError } from "@/lib/worktree"

async function configuredRepos(): Promise<{ id: string; path: string; name: string }[]> {
  const { repos } = await getConfig()
  const out: { id: string; path: string; name: string }[] = []
  for (const candidate of repos) {
    const real = await validateRepo(candidate).catch(() => null)
    if (real) out.push({ id: repoIdFor(real), path: real, name: path.basename(real) })
  }
  return out
}

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

  const repo = (await configuredRepos()).find((r) => r.id === body.repoId)
  if (!repo) return NextResponse.json({ error: "Unknown repository" }, { status: 404 })

  try {
    await removeWorktree(repo.path, body.id, { force: body.force === true })
  } catch (err) {
    if (err instanceof WorktreeError) {
      const status = /not found/.test(err.message) ? 404 : /uncommitted or unmerged/.test(err.message) ? 409 : 400
      return NextResponse.json({ error: err.message }, { status })
    }
    throw err
  }
  return NextResponse.json({ ok: true })
}
