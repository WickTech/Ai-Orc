import { afterEach, describe, expect, it, vi } from "vitest"
import { execFileSync } from "child_process"
import { existsSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "fs"
import path from "path"
import { cleanupTempDirs, tempDir, withTempHome } from "./helpers"

afterEach(() => {
  cleanupTempDirs()
  vi.unstubAllEnvs()
})

const load = () => import("@/lib/worktree")

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  }).trim()
}

function makeRepo(): string {
  const dir = realpathSync(tempDir("ai-orc-repo-"))
  git(dir, "init", "-q", "-b", "main")
  writeFileSync(path.join(dir, "a.txt"), "one\n")
  git(dir, "add", ".")
  git(dir, "commit", "-q", "-m", "init")
  return dir
}

async function setup() {
  const { mod, home } = await withTempHome(load)
  return { wt: mod, home, repo: makeRepo() }
}

describe("validateRepo", () => {
  it("returns the realpath of a git repository root", async () => {
    const { wt, repo } = await setup()
    expect(await wt.validateRepo(repo)).toBe(repo)
  })

  it("accepts a symlink to a repository by resolving it", async () => {
    const { wt, repo } = await setup()
    const link = path.join(tempDir(), "link")
    symlinkSync(repo, link)
    expect(await wt.validateRepo(link)).toBe(repo)
  })

  it.each([
    ["relative path", "some/dir"],
    ["NUL byte", "/tmp/x\0y"],
    ["missing path", "/definitely/not/here"],
    ["filesystem root", "/"],
  ])("rejects %s", async (_n, p) => {
    const { wt } = await setup()
    await expect(wt.validateRepo(p)).rejects.toThrow(wt.WorktreeError)
  })

  it("rejects the home directory and a plain non-git folder", async () => {
    const { wt, home } = await setup()
    await expect(wt.validateRepo(home)).rejects.toThrow(/too broad/)
    await expect(wt.validateRepo(tempDir())).rejects.toThrow(/git repository/)
  })

  it("rejects a subdirectory of a repository (must be the root)", async () => {
    const { wt, repo } = await setup()
    mkdirSync(path.join(repo, "sub"))
    await expect(wt.validateRepo(path.join(repo, "sub"))).rejects.toThrow(/repository root/)
  })
})

describe("createWorktree", () => {
  it("creates a worktree on a new axion/ branch under ~/.axion/worktrees", async () => {
    const { wt, repo, home } = await setup()
    const info = await wt.createWorktree({ repoPath: repo, sessionId: "claude-1", toolId: "claude" })
    expect(info.path.startsWith(path.join(realpathSync(home), ".axion", "worktrees") + path.sep)).toBe(true)
    expect(existsSync(path.join(info.path, "a.txt"))).toBe(true)
    expect(info.branch).toBe("axion/claude-claude-1")
    expect(git(info.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(info.branch)
    expect(info.base).toBe(git(repo, "rev-parse", "HEAD"))
    // main checkout is untouched
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main")
    expect(git(repo, "status", "--porcelain")).toBe("")
  })

  it("refuses when the main checkout has uncommitted tracked changes", async () => {
    const { wt, repo } = await setup()
    writeFileSync(path.join(repo, "a.txt"), "changed\n")
    await expect(wt.createWorktree({ repoPath: repo, sessionId: "s1", toolId: "claude" })).rejects.toThrow(
      /uncommitted changes/,
    )
  })

  it("ignores untracked files in the main checkout", async () => {
    const { wt, repo } = await setup()
    writeFileSync(path.join(repo, "scratch.txt"), "x")
    await expect(wt.createWorktree({ repoPath: repo, sessionId: "s1", toolId: "claude" })).resolves.toBeTruthy()
  })

  it("refuses to reuse a session id", async () => {
    const { wt, repo } = await setup()
    await wt.createWorktree({ repoPath: repo, sessionId: "s1", toolId: "claude" })
    await expect(wt.createWorktree({ repoPath: repo, sessionId: "s1", toolId: "claude" })).rejects.toThrow(
      /already exists/,
    )
  })

  it.each(["../escape", "a/b", "", "-rf", "a b", "x".repeat(65), "a\0b"])("rejects session id %j", async (sessionId) => {
    const { wt, repo } = await setup()
    await expect(wt.createWorktree({ repoPath: repo, sessionId, toolId: "claude" })).rejects.toThrow(wt.WorktreeError)
  })

  it("rejects a tool id that is not a safe slug", async () => {
    const { wt, repo } = await setup()
    await expect(wt.createWorktree({ repoPath: repo, sessionId: "s1", toolId: "a/../b" })).rejects.toThrow(
      wt.WorktreeError,
    )
  })

  it("rejects a path that is not a repository root", async () => {
    const { wt } = await setup()
    await expect(wt.createWorktree({ repoPath: tempDir(), sessionId: "s1", toolId: "claude" })).rejects.toThrow(
      wt.WorktreeError,
    )
  })

  it("lets two sessions edit the same file without touching each other", async () => {
    const { wt, repo } = await setup()
    const a = await wt.createWorktree({ repoPath: repo, sessionId: "a1", toolId: "claude" })
    const b = await wt.createWorktree({ repoPath: repo, sessionId: "b1", toolId: "codex" })
    writeFileSync(path.join(a.path, "a.txt"), "from a\n")
    writeFileSync(path.join(b.path, "a.txt"), "from b\n")
    expect(git(a.path, "status", "--porcelain")).toContain("a.txt")
    expect(git(b.path, "status", "--porcelain")).toContain("a.txt")
    expect(git(repo, "status", "--porcelain")).toBe("")
    expect(git(repo, "show", "HEAD:a.txt")).toBe("one")
  })
})

describe("listWorktrees", () => {
  it("reports branch, dirty and ahead for each session worktree", async () => {
    const { wt, repo } = await setup()
    const clean = await wt.createWorktree({ repoPath: repo, sessionId: "clean1", toolId: "claude" })
    const dirty = await wt.createWorktree({ repoPath: repo, sessionId: "dirty1", toolId: "claude" })
    const ahead = await wt.createWorktree({ repoPath: repo, sessionId: "ahead1", toolId: "claude" })
    writeFileSync(path.join(dirty.path, "new.txt"), "x")
    writeFileSync(path.join(ahead.path, "b.txt"), "y")
    git(ahead.path, "add", ".")
    git(ahead.path, "commit", "-q", "-m", "work")

    const list = await wt.listWorktrees([repo])
    const by = Object.fromEntries(list.map((w) => [w.id, w]))
    expect(by[clean.id]).toMatchObject({ dirty: false, ahead: 0, exists: true, branch: clean.branch })
    expect(by[dirty.id]).toMatchObject({ dirty: true, ahead: 0 })
    expect(by[ahead.id]).toMatchObject({ dirty: false, ahead: 1 })
  })

  it("marks a worktree whose directory was deleted by hand as missing", async () => {
    const { wt, repo } = await setup()
    const info = await wt.createWorktree({ repoPath: repo, sessionId: "gone1", toolId: "claude" })
    execFileSync("rm", ["-rf", info.path])
    const [entry] = await wt.listWorktrees([repo])
    expect(entry).toMatchObject({ id: "gone1", exists: false })
  })

  it("returns an empty list when there are no sessions or repos", async () => {
    const { wt, repo } = await setup()
    expect(await wt.listWorktrees([repo])).toEqual([])
    expect(await wt.listWorktrees([])).toEqual([])
  })
})

describe("removeWorktree", () => {
  it("removes a clean worktree, its branch and its metadata", async () => {
    const { wt, repo } = await setup()
    const info = await wt.createWorktree({ repoPath: repo, sessionId: "r1", toolId: "claude" })
    await wt.removeWorktree(repo, "r1", { force: false })
    expect(existsSync(info.path)).toBe(false)
    expect(git(repo, "branch", "--list", info.branch)).toBe("")
    expect(await wt.listWorktrees([repo])).toEqual([])
  })

  it("refuses to remove a worktree with uncommitted files unless forced", async () => {
    const { wt, repo } = await setup()
    const info = await wt.createWorktree({ repoPath: repo, sessionId: "r2", toolId: "claude" })
    writeFileSync(path.join(info.path, "work.txt"), "x")
    await expect(wt.removeWorktree(repo, "r2", { force: false })).rejects.toThrow(/uncommitted or unmerged/)
    expect(existsSync(info.path)).toBe(true)
    await wt.removeWorktree(repo, "r2", { force: true })
    expect(existsSync(info.path)).toBe(false)
  })

  it("refuses to remove a worktree with commits ahead of its base unless forced", async () => {
    const { wt, repo } = await setup()
    const info = await wt.createWorktree({ repoPath: repo, sessionId: "r3", toolId: "claude" })
    writeFileSync(path.join(info.path, "c.txt"), "x")
    git(info.path, "add", ".")
    git(info.path, "commit", "-q", "-m", "work")
    await expect(wt.removeWorktree(repo, "r3", { force: false })).rejects.toThrow(/uncommitted or unmerged/)
    await wt.removeWorktree(repo, "r3", { force: true })
    expect(git(repo, "branch", "--list", info.branch)).toBe("")
  })

  it("cleans up metadata for a worktree whose directory is already gone", async () => {
    const { wt, repo } = await setup()
    const info = await wt.createWorktree({ repoPath: repo, sessionId: "r4", toolId: "claude" })
    execFileSync("rm", ["-rf", info.path])
    await wt.removeWorktree(repo, "r4", { force: false })
    expect(await wt.listWorktrees([repo])).toEqual([])
    expect(git(repo, "branch", "--list", info.branch)).toBe("")
  })

  it("rejects an unknown or unsafe session id", async () => {
    const { wt, repo } = await setup()
    await expect(wt.removeWorktree(repo, "nope", { force: false })).rejects.toThrow(/not found/)
    await expect(wt.removeWorktree(repo, "../../etc", { force: true })).rejects.toThrow(wt.WorktreeError)
  })
})
