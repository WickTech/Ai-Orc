import path from "path"
import { getConfig } from "@/lib/db"
import { repoIdFor, validateRepo, WorktreeError, type WorktreeErrorCode } from "@/lib/worktree"

export interface RepoRef {
  id: string
  path: string
  name: string
}

/** Saved repos that still exist on disk, with their ids. */
export async function configuredRepos(): Promise<RepoRef[]> {
  const { repos } = await getConfig()
  const out: RepoRef[] = []
  for (const candidate of repos) {
    const real = await validateRepo(candidate).catch(() => null)
    if (real) out.push({ id: repoIdFor(real), path: real, name: path.basename(real) })
  }
  return out
}

export async function findRepo(repoId: unknown): Promise<RepoRef | undefined> {
  if (typeof repoId !== "string") return undefined
  return (await configuredRepos()).find((r) => r.id === repoId)
}

const STATUS: Record<WorktreeErrorCode, number> = { invalid: 400, not_found: 404, conflict: 409 }

/** Maps a WorktreeError to an HTTP status; other errors are rethrown. */
export function errorStatus(err: unknown): number {
  if (err instanceof WorktreeError) return STATUS[err.code]
  throw err
}
