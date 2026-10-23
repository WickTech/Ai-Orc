import { afterEach, describe, expect, it, vi } from "vitest"
import { execFileSync } from "child_process"
import { existsSync, readFileSync, realpathSync, writeFileSync } from "fs"
import path from "path"
import { cleanupTempDirs, tempDir, withTempHome } from "./helpers"

afterEach(() => {
  cleanupTempDirs()
  vi.unstubAllEnvs()
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim()
}

function makeRepo(): string {
  const dir = realpathSync(tempDir("ai-orc-repo-"))
  git(dir, "init", "-q", "-b", "main")
  writeFileSync(path.join(dir, "a.txt"), "one\ntwo\nthree\n")
  git(dir, "add", ".")
  git(dir, "commit", "-q", "-m", "init")
  return dir
}

async function setup() {
  vi.stubEnv("GIT_AUTHOR_NAME", "t")
  vi.stubEnv("GIT_AUTHOR_EMAIL", "t@t")
  vi.stubEnv("GIT_COMMITTER_NAME", "t")
  vi.stubEnv("GIT_COMMITTER_EMAIL", "t@t")
  const { mod: wt, home } = await withTempHome(() => import("@/lib/worktree"))
  const review = await import("@/lib/review")
  const audit = await import("@/lib/audit")
  const repo = makeRepo()
  const info = await wt.createWorktree({ repoPath: repo, sessionId: "s1", toolId: "claude" })
  return { wt, review, audit, home, repo, info }
}

describe("getReview", () => {
  it("lists modified, committed and brand-new files with a diff of all of them", async () => {
    const { review, repo, info } = await setup()
    writeFileSync(path.join(info.path, "a.txt"), "one\nTWO\nthree\n")
    writeFileSync(path.join(info.path, "new.txt"), "fresh\n")
    writeFileSync(path.join(info.path, "b.txt"), "committed\n")
    git(info.path, "add", "b.txt")
    git(info.path, "commit", "-q", "-m", "work")

    const r = await review.getReview(repo, "s1")
    expect(r.files.map((f) => f.path).sort()).toEqual(["a.txt", "b.txt", "new.txt"])
    expect(r.diff).toContain("+TWO")
    expect(r.diff).toContain("-two")
    expect(r.diff).toContain("+fresh")
    expect(r.truncated).toBe(false)
    expect(r.branch).toBe(info.branch)
    expect(r.targetBranch).toBe("main")
    expect(r.diffHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("has a stable hash that changes when the work changes", async () => {
    const { review, repo, info } = await setup()
    writeFileSync(path.join(info.path, "a.txt"), "one\nTWO\nthree\n")
    const h1 = (await review.getReview(repo, "s1")).diffHash
    expect((await review.getReview(repo, "s1")).diffHash).toBe(h1)
    writeFileSync(path.join(info.path, "a.txt"), "one\nTWO!\nthree\n")
    expect((await review.getReview(repo, "s1")).diffHash).not.toBe(h1)
  })

  it("reports an empty review for a session with no changes", async () => {
    const { review, repo } = await setup()
    const r = await review.getReview(repo, "s1")
    expect(r.files).toEqual([])
    expect(r.diff).toBe("")
  })

  it("never touches the main checkout", async () => {
    const { review, repo, info } = await setup()
    writeFileSync(path.join(info.path, "new.txt"), "x\n")
    await review.getReview(repo, "s1")
    expect(git(repo, "status", "--porcelain")).toBe("")
  })

  it("truncates a huge diff for display but still hashes all of it", async () => {
    const { review, repo, info } = await setup()
    writeFileSync(path.join(info.path, "big.txt"), "line of text\n".repeat(60_000))
    const r = await review.getReview(repo, "s1")
    expect(r.truncated).toBe(true)
    expect(r.diff.length).toBeLessThanOrEqual(512 * 1024)
    writeFileSync(path.join(info.path, "big.txt"), "line of text\n".repeat(60_000) + "tail\n")
    expect((await review.getReview(repo, "s1")).diffHash).not.toBe(r.diffHash)
  })

  it("fails for an unknown session or one whose directory is gone", async () => {
    const { review, repo, info } = await setup()
    await expect(review.getReview(repo, "nope")).rejects.toThrow(/not found/)
    execFileSync("rm", ["-rf", info.path])
    await expect(review.getReview(repo, "s1")).rejects.toThrow(/missing/)
  })
})

describe("approveMerge", () => {
  it("merges the reviewed work with a merge commit, removes the session and logs it", async () => {
    const { review, audit, repo, info } = await setup()
    writeFileSync(path.join(info.path, "a.txt"), "one\nTWO\nthree\n")
    writeFileSync(path.join(info.path, "new.txt"), "fresh\n")
    const r = await review.getReview(repo, "s1")

    const result = await review.approveMerge(repo, "s1", { diffHash: r.diffHash })
    expect(result.merged).toBe(true)
    expect(readFileSync(path.join(repo, "a.txt"), "utf-8")).toBe("one\nTWO\nthree\n")
    expect(readFileSync(path.join(repo, "new.txt"), "utf-8")).toBe("fresh\n")
    expect(git(repo, "rev-list", "--merges", "--count", "HEAD")).toBe("1")
    expect(git(repo, "status", "--porcelain")).toBe("")
    expect(existsSync(info.path)).toBe(false)
    expect(git(repo, "branch", "--list", info.branch)).toBe("")
    const [entry] = await audit.readAudit(1)
    expect(entry).toMatchObject({ action: "merged", session: "s1", branch: info.branch, diffHash: r.diffHash })
  })

  it("refuses when the work changed after it was reviewed, and leaves everything alone", async () => {
    const { review, audit, repo, info } = await setup()
    writeFileSync(path.join(info.path, "a.txt"), "one\nTWO\nthree\n")
    const r = await review.getReview(repo, "s1")
    writeFileSync(path.join(info.path, "a.txt"), "one\nSNEAKY\nthree\n")

    await expect(review.approveMerge(repo, "s1", { diffHash: r.diffHash })).rejects.toThrow(/changed since/)
    expect(readFileSync(path.join(repo, "a.txt"), "utf-8")).toBe("one\ntwo\nthree\n")
    expect(existsSync(info.path)).toBe(true)
    expect((await audit.readAudit(1))[0]).toMatchObject({ action: "merge-refused", session: "s1" })
  })

  it.each([undefined, "", "abc", "0".repeat(64)])("refuses a missing or wrong hash %j", async (h) => {
    const { review, repo, info } = await setup()
    writeFileSync(path.join(info.path, "new.txt"), "x\n")
    await expect(review.approveMerge(repo, "s1", { diffHash: h as never })).rejects.toThrow(/changed since|review/)
    expect(existsSync(path.join(repo, "new.txt"))).toBe(false)
  })

  it("refuses when there is nothing to merge", async () => {
    const { review, repo } = await setup()
    const r = await review.getReview(repo, "s1")
    await expect(review.approveMerge(repo, "s1", { diffHash: r.diffHash })).rejects.toThrow(/nothing to merge/i)
  })

  it("refuses when the main checkout has uncommitted changes", async () => {
    const { review, repo, info } = await setup()
    writeFileSync(path.join(info.path, "new.txt"), "x\n")
    const r = await review.getReview(repo, "s1")
    writeFileSync(path.join(repo, "a.txt"), "dirty\n")
    await expect(review.approveMerge(repo, "s1", { diffHash: r.diffHash })).rejects.toThrow(/uncommitted changes/)
    expect(existsSync(path.join(repo, "new.txt"))).toBe(false)
  })

  it("refuses before committing when an untracked file in main would be overwritten", async () => {
    const { review, repo, info } = await setup()
    writeFileSync(path.join(info.path, "clash.txt"), "from session\n")
    const r = await review.getReview(repo, "s1")
    writeFileSync(path.join(repo, "clash.txt"), "mine\n")
    await expect(review.approveMerge(repo, "s1", { diffHash: r.diffHash })).rejects.toThrow(/Untracked files .*clash\.txt/)
    expect(readFileSync(path.join(repo, "clash.txt"), "utf-8")).toBe("mine\n")
    expect(git(info.path, "status", "--porcelain")).toContain("clash.txt") // session not committed
    const audit = await import("@/lib/audit")
    expect((await audit.readAudit(1))[0].action).toBe("merge-refused")
  })

  it("is not blocked by an unrelated untracked file in main", async () => {
    const { review, repo, info } = await setup()
    writeFileSync(path.join(info.path, "new.txt"), "x\n")
    const r = await review.getReview(repo, "s1")
    writeFileSync(path.join(repo, "notes.txt"), "mine\n")
    await review.approveMerge(repo, "s1", { diffHash: r.diffHash })
    expect(existsSync(path.join(repo, "new.txt"))).toBe(true)
    expect(existsSync(path.join(repo, "notes.txt"))).toBe(true)
  })

  it("refuses when the repository is on a detached HEAD", async () => {
    const { review, repo, info } = await setup()
    writeFileSync(path.join(info.path, "new.txt"), "x\n")
    const r = await review.getReview(repo, "s1")
    git(repo, "checkout", "-q", "--detach")
    await expect(review.approveMerge(repo, "s1", { diffHash: r.diffHash })).rejects.toThrow(/detached/)
  })

  it("merges cleanly when main moved on with unrelated changes", async () => {
    const { review, repo, info } = await setup()
    writeFileSync(path.join(info.path, "new.txt"), "x\n")
    const r = await review.getReview(repo, "s1")
    writeFileSync(path.join(repo, "other.txt"), "o\n")
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "main moved")
    await review.approveMerge(repo, "s1", { diffHash: r.diffHash })
    expect(existsSync(path.join(repo, "new.txt"))).toBe(true)
    expect(existsSync(path.join(repo, "other.txt"))).toBe(true)
  })

  it("aborts a conflicting merge, leaves main clean and keeps the session", async () => {
    const { review, audit, repo, info } = await setup()
    writeFileSync(path.join(info.path, "a.txt"), "one\nFROM-AGENT\nthree\n")
    const r = await review.getReview(repo, "s1")
    writeFileSync(path.join(repo, "a.txt"), "one\nFROM-MAIN\nthree\n")
    git(repo, "commit", "-q", "-am", "main edit")

    await expect(review.approveMerge(repo, "s1", { diffHash: r.diffHash })).rejects.toThrow(/conflict/)
    expect(git(repo, "status", "--porcelain")).toBe("")
    expect(existsSync(path.join(repo, ".git", "MERGE_HEAD"))).toBe(false)
    expect(readFileSync(path.join(repo, "a.txt"), "utf-8")).toBe("one\nFROM-MAIN\nthree\n")
    expect(existsSync(info.path)).toBe(true)
    expect((await audit.readAudit(1))[0]).toMatchObject({ action: "merge-refused", session: "s1" })
  })

  it("uses a trimmed custom commit message and never treats it as an option", async () => {
    const { review, repo, info } = await setup()
    writeFileSync(path.join(info.path, "new.txt"), "x\n")
    const r = await review.getReview(repo, "s1")
    await review.approveMerge(repo, "s1", { diffHash: r.diffHash, message: "  --amend fix things  " })
    expect(git(repo, "log", "-1", "--format=%s")).toContain("--amend fix things")
    expect(git(repo, "rev-list", "--count", "HEAD")).toBe("3") // init + session commit + merge commit
  })
})

describe("rejectSession", () => {
  it("records the rejection and keeps the worktree", async () => {
    const { review, audit, repo, info } = await setup()
    writeFileSync(path.join(info.path, "new.txt"), "x\n")
    await review.rejectSession(repo, "s1", { reason: "not what I asked" })
    expect(existsSync(info.path)).toBe(true)
    expect((await audit.readAudit(1))[0]).toMatchObject({ action: "rejected", session: "s1", detail: "not what I asked" })
  })

  it("fails for an unknown session", async () => {
    const { review, repo } = await setup()
    await expect(review.rejectSession(repo, "nope", {})).rejects.toThrow(/not found/)
  })
})
