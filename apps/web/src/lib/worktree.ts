import { spawn } from "child_process"
import { createHash } from "crypto"
import { promises as fs } from "fs"
import os from "os"
import path from "path"

export class WorktreeError extends Error {}

export interface WorktreeInfo {
  id: string
  repoId: string
  repoPath: string
  path: string
  branch: string
  base: string
  toolId: string
  createdAt: string
}

export interface WorktreeStatus extends WorktreeInfo {
  /** The worktree directory still exists on disk. */
  exists: boolean
  /** Uncommitted changes, including untracked files the agent created. */
  dirty: boolean
  /** Commits on the session branch that are not in its base commit. */
  ahead: number
}

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const BRANCH_RE = /^axion\/[A-Za-z0-9._-]+$/

// Resolved on every call: the home directory is not known at import time in tests.
function worktreesRoot(): string {
  return path.join(os.homedir(), ".ai-orc", "worktrees")
}

export function repoIdFor(realRepoPath: string): string {
  return createHash("sha256").update(realRepoPath).digest("hex").slice(0, 12)
}

async function git(cwd: string, args: string[]): Promise<string> {
  // spawn without a shell: arguments are never interpreted.
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d) => (stdout += d))
    child.stderr.on("data", (d) => (stderr += d))
    child.on("error", (err) => reject(new WorktreeError(`git ${args[0]} failed: ${err.message}`)))
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new WorktreeError(`git ${args[0]} failed: ${stderr.trim() || `exit code ${code}`}`))
    })
  })
}

function assertSlug(value: string, what: string): void {
  if (typeof value !== "string" || !SLUG_RE.test(value)) {
    throw new WorktreeError(`Invalid ${what}: use letters, digits, "-" or "_" (max 64 characters)`)
  }
}

/** Returns the realpath of a git repository root, or throws WorktreeError. */
export async function validateRepo(input: string): Promise<string> {
  if (typeof input !== "string" || input.includes("\0")) throw new WorktreeError("Repository path is invalid")
  if (!path.isAbsolute(input)) throw new WorktreeError("Repository path must be absolute")

  let real: string
  try {
    real = await fs.realpath(input)
    if (!(await fs.stat(real)).isDirectory()) throw new Error("not a directory")
  } catch {
    throw new WorktreeError("Repository path must be an existing directory")
  }

  // Same reasoning as the vault: "/" or a parent of $HOME is never a project.
  const home = await fs.realpath(os.homedir()).catch(() => os.homedir())
  if (real === path.parse(real).root || real === home || home.startsWith(real + path.sep)) {
    throw new WorktreeError("Repository path is too broad: choose a project folder")
  }

  let top: string
  try {
    top = await fs.realpath(await git(real, ["rev-parse", "--show-toplevel"]))
  } catch {
    throw new WorktreeError("Not a git repository")
  }
  if (top !== real) throw new WorktreeError(`Path must be the repository root (${top})`)
  return real
}

interface Meta {
  id: string
  toolId: string
  branch: string
  base: string
  createdAt: string
}

function metaPath(repoId: string, id: string): string {
  // repoId is a hash we computed and id is validated as a slug by every caller.
  return path.join(worktreesRoot(), repoId, `${id}.json`) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
}

function worktreePath(repoId: string, id: string): string {
  // id is validated as a slug by every caller, so it cannot contain separators.
  const dir = path.join(worktreesRoot(), repoId, id) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  if (!dir.startsWith(worktreesRoot() + path.sep)) throw new WorktreeError("Invalid worktree path")
  return dir
}

async function readMeta(repoId: string, id: string): Promise<Meta | null> {
  try {
    const meta = JSON.parse(await fs.readFile(metaPath(repoId, id), "utf-8")) as Meta
    if (typeof meta.branch !== "string" || !BRANCH_RE.test(meta.branch)) return null
    if (typeof meta.base !== "string" || !/^[0-9a-f]{7,64}$/.test(meta.base)) return null
    return meta
  } catch {
    return null
  }
}

export async function createWorktree(opts: { repoPath: string; sessionId: string; toolId: string }): Promise<WorktreeInfo> {
  assertSlug(opts.sessionId, "session id")
  assertSlug(opts.toolId, "tool id")
  const repoPath = await validateRepo(opts.repoPath)

  // Tracked changes would not appear in the new worktree, which is confusing
  // for the agent and for the person reviewing; untracked files do not matter.
  if ((await git(repoPath, ["status", "--porcelain", "--untracked-files=no"])) !== "") {
    throw new WorktreeError("The repository has uncommitted changes: commit or stash them before starting an isolated session")
  }

  const repoId = repoIdFor(repoPath)
  const dir = worktreePath(repoId, opts.sessionId)
  if ((await readMeta(repoId, opts.sessionId)) || (await exists(dir))) {
    throw new WorktreeError(`A worktree for session "${opts.sessionId}" already exists`)
  }

  const branch = `axion/${opts.toolId}-${opts.sessionId}`
  const base = await git(repoPath, ["rev-parse", "HEAD"])
  await fs.mkdir(path.dirname(dir), { recursive: true })
  await git(repoPath, ["worktree", "add", "-b", branch, dir, base])

  const createdAt = new Date().toISOString()
  const meta: Meta = { id: opts.sessionId, toolId: opts.toolId, branch, base, createdAt }
  await fs.writeFile(metaPath(repoId, opts.sessionId), JSON.stringify(meta, null, 2))
  return { id: opts.sessionId, repoId, repoPath, path: dir, branch, base, toolId: opts.toolId, createdAt }
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true, () => false)
}

async function statusOf(repoPath: string, repoId: string, meta: Meta): Promise<WorktreeStatus> {
  const dir = worktreePath(repoId, meta.id)
  const present = await exists(dir)
  let dirty = false
  if (present) dirty = (await git(dir, ["status", "--porcelain"]).catch(() => "")) !== ""
  const ahead = await git(repoPath, ["rev-list", "--count", `${meta.base}..${meta.branch}`])
    .then((n) => Number(n) || 0)
    .catch(() => 0)
  return { ...meta, repoId, repoPath, path: dir, exists: present, dirty, ahead }
}

export async function listWorktrees(repoPaths: string[]): Promise<WorktreeStatus[]> {
  const out: WorktreeStatus[] = []
  for (const input of repoPaths) {
    let repoPath: string
    try {
      repoPath = await validateRepo(input)
    } catch {
      continue // a repo that disappeared from disk should not break the list
    }
    const repoId = repoIdFor(repoPath)
    // repoId is a hash computed from the validated repo path, never user input.
    const files = await fs.readdir(path.join(worktreesRoot(), repoId)).catch(() => [] as string[]) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    for (const file of files.filter((f) => f.endsWith(".json")).sort()) {
      const id = file.slice(0, -".json".length)
      if (!SLUG_RE.test(id)) continue
      const meta = await readMeta(repoId, id)
      if (meta) out.push(await statusOf(repoPath, repoId, meta))
    }
  }
  return out
}

export async function removeWorktree(repoInput: string, id: string, opts: { force: boolean }): Promise<void> {
  assertSlug(id, "session id")
  const repoPath = await validateRepo(repoInput)
  const repoId = repoIdFor(repoPath)
  const meta = await readMeta(repoId, id)
  if (!meta) throw new WorktreeError(`Worktree session "${id}" not found`)

  const status = await statusOf(repoPath, repoId, meta)
  if (!opts.force && (status.dirty || status.ahead > 0)) {
    throw new WorktreeError("Worktree has uncommitted or unmerged work; remove with force to discard it")
  }

  if (status.exists) await git(repoPath, ["worktree", "remove", "--force", status.path])
  else await git(repoPath, ["worktree", "prune"])
  await git(repoPath, ["branch", "-D", meta.branch]).catch(() => undefined) // already gone is fine
  await fs.rm(metaPath(repoId, id), { force: true })
}

/** The status of an existing session worktree, or null when there is none. */
export async function findWorktree(repoPath: string, id: string): Promise<WorktreeStatus | null> {
  assertSlug(id, "session id")
  const real = await validateRepo(repoPath)
  const repoId = repoIdFor(real)
  const meta = await readMeta(repoId, id)
  return meta ? statusOf(real, repoId, meta) : null
}
