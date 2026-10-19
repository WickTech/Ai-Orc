import { createHash } from "crypto"
import { appendAudit } from "@/lib/audit"
import {
  findWorktree,
  removeWorktree,
  repoIdFor,
  runGit,
  validateRepo,
  WorktreeError,
  type WorktreeStatus,
} from "@/lib/worktree"

const MAX_DISPLAY = 512 * 1024
const MAX_MESSAGE = 200

export interface ReviewFile {
  path: string
  status: "added" | "modified" | "deleted" | "other"
  additions: number | null
  deletions: number | null
}

export interface Review {
  id: string
  branch: string
  base: string
  files: ReviewFile[]
  diff: string
  truncated: boolean
  /** Hash of the complete diff: approval is bound to exactly this content. */
  diffHash: string
  /** Branch checked out in the main repo (where the merge would land), null when detached. */
  targetBranch: string | null
}

async function sessionOf(repoPath: string, id: string): Promise<WorktreeStatus> {
  const status = await findWorktree(repoPath, id)
  if (!status) throw new WorktreeError(`Worktree session "${id}" not found`, "not_found")
  if (!status.exists) throw new WorktreeError(`Worktree for session "${id}" is missing on disk`, "not_found")
  return status
}

function statusName(code: string): ReviewFile["status"] {
  return code === "A" ? "added" : code === "M" ? "modified" : code === "D" ? "deleted" : "other"
}

async function targetBranchOf(repoPath: string): Promise<string | null> {
  const name = await runGit(repoPath, ["symbolic-ref", "--short", "-q", "HEAD"]).catch(() => "")
  return name || null
}

async function buildReview(repoPath: string, status: WorktreeStatus): Promise<Review> {
  const wt = status.path
  // Intent-to-add makes brand-new files show up in the diff. It only touches
  // this session's own worktree index, never the main checkout.
  await runGit(wt, ["add", "-N", "--", "."])

  const base = status.base
  const diffArgs = ["diff", "--no-color", "--no-ext-diff", "--no-renames"]
  const [full, shown, nameStatus, numstat] = await Promise.all([
    runGit(wt, [...diffArgs, "--binary", base]),
    runGit(wt, [...diffArgs, base]),
    runGit(wt, [...diffArgs, "--name-status", "-z", base]),
    runGit(wt, [...diffArgs, "--numstat", "-z", base]),
  ])

  const counts = new Map<string, [number | null, number | null]>()
  for (const entry of numstat.split("\0").filter(Boolean)) {
    const [add, del, ...rest] = entry.split("\t")
    counts.set(rest.join("\t"), [add === "-" ? null : Number(add), del === "-" ? null : Number(del)])
  }
  const parts = nameStatus.split("\0").filter(Boolean)
  const files: ReviewFile[] = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [additions, deletions] = counts.get(parts[i + 1]) ?? [null, null]
    files.push({ path: parts[i + 1], status: statusName(parts[i]), additions, deletions })
  }

  return {
    id: status.id,
    branch: status.branch,
    base,
    files,
    diff: shown.length > MAX_DISPLAY ? shown.slice(0, MAX_DISPLAY) : shown,
    truncated: shown.length > MAX_DISPLAY,
    diffHash: createHash("sha256").update(base).update("\0").update(full).digest("hex"),
    targetBranch: await targetBranchOf(repoPath),
  }
}

export async function getReview(repoInput: string, id: string): Promise<Review> {
  const repoPath = await validateRepo(repoInput)
  return buildReview(repoPath, await sessionOf(repoPath, id))
}

function cleanMessage(message: unknown, fallback: string): string {
  if (typeof message !== "string") return fallback
  const text = message.replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE)
  return text || fallback
}

async function refuse(repoPath: string, status: WorktreeStatus, detail: string): Promise<never> {
  await appendAudit({ action: "merge-refused", repoId: repoIdFor(repoPath), session: status.id, branch: status.branch, detail })
  throw new WorktreeError(detail, "conflict")
}

/**
 * Merges a session into the branch checked out in the main repo, but only if
 * `diffHash` matches the diff as it is right now (what you reviewed is what
 * lands) and the main checkout is clean.
 */
export async function approveMerge(
  repoInput: string,
  id: string,
  opts: { diffHash?: string; message?: string },
): Promise<{ merged: true; branch: string; target: string }> {
  const repoPath = await validateRepo(repoInput)
  const status = await sessionOf(repoPath, id)
  const review = await buildReview(repoPath, status)

  if (typeof opts.diffHash !== "string" || opts.diffHash !== review.diffHash) {
    return refuse(repoPath, status, "The session changed since you reviewed it: review the new diff before approving")
  }
  if (review.files.length === 0) return refuse(repoPath, status, "Nothing to merge: the session has no changes")
  if (!review.targetBranch) return refuse(repoPath, status, "The repository is on a detached HEAD: check out a branch to merge into")
  if ((await runGit(repoPath, ["status", "--porcelain", "--untracked-files=no"])) !== "") {
    return refuse(repoPath, status, "The repository has uncommitted changes: commit or stash them before merging")
  }

  const message = cleanMessage(opts.message, `Axion session ${status.branch}`)
  if ((await runGit(status.path, ["status", "--porcelain"])) !== "") {
    await runGit(status.path, ["add", "-A"])
    await runGit(status.path, ["commit", "-m", message])
  }

  try {
    await runGit(repoPath, ["merge", "--no-ff", "-m", `Merge ${status.branch}: ${message}`, status.branch])
  } catch (err) {
    const unmerged = await runGit(repoPath, ["diff", "--name-only", "--diff-filter=U"]).catch(() => "")
    await runGit(repoPath, ["merge", "--abort"]).catch(() => undefined)
    const reason = unmerged
      ? `Merge conflict in: ${unmerged.split("\n").join(", ")}. Nothing was merged; resolve it in the worktree or reject the session`
      : `Merge failed: ${err instanceof Error ? err.message : String(err)}`
    return refuse(repoPath, status, reason)
  }

  await appendAudit({
    action: "merged",
    repoId: repoIdFor(repoPath),
    session: status.id,
    branch: status.branch,
    diffHash: review.diffHash,
    detail: `into ${review.targetBranch}`,
  })
  // The work now lives in the target branch, so the session is safe to drop.
  await removeWorktree(repoPath, id, { force: true })
  return { merged: true, branch: status.branch, target: review.targetBranch }
}

export async function rejectSession(repoInput: string, id: string, opts: { reason?: string }): Promise<void> {
  const repoPath = await validateRepo(repoInput)
  const status = await findWorktree(repoPath, id)
  if (!status) throw new WorktreeError(`Worktree session "${id}" not found`, "not_found")
  await appendAudit({
    action: "rejected",
    repoId: repoIdFor(repoPath),
    session: status.id,
    branch: status.branch,
    detail: cleanMessage(opts.reason, "rejected"),
  })
}
