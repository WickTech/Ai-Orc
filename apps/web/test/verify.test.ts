import { afterEach, describe, expect, it, vi } from "vitest"
import { execFileSync } from "child_process"
import { existsSync, realpathSync, writeFileSync } from "fs"
import path from "path"
import { cleanupTempDirs, tempDir, withTempHome } from "./helpers"

afterEach(() => {
  cleanupTempDirs()
  vi.unstubAllEnvs()
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim()
}

async function setup(verify?: string[]) {
  for (const k of ["AUTHOR", "COMMITTER"]) {
    vi.stubEnv(`GIT_${k}_NAME`, "t")
    vi.stubEnv(`GIT_${k}_EMAIL`, "t@t")
  }
  const { mod: db } = await withTempHome(() => import("@/lib/db"))
  const wt = await import("@/lib/worktree")
  const dir = realpathSync(tempDir("ai-orc-repo-"))
  git(dir, "init", "-q", "-b", "main")
  writeFileSync(path.join(dir, "a.txt"), "one\n")
  git(dir, "add", ".")
  git(dir, "commit", "-q", "-m", "init")
  await db.setConfig({ repos: [dir], ...(verify ? { verify: { [dir]: verify } } : {}) })
  const info = await wt.createWorktree({ repoPath: dir, sessionId: "s1", toolId: "claude" })
  writeFileSync(path.join(info.path, "new.txt"), "fresh\n")
  return { db, dir, info, verify: await import("@/lib/verify"), review: await import("@/lib/review"), audit: await import("@/lib/audit") }
}

describe("runVerify", () => {
  it("refuses when no command is configured", async () => {
    const { verify, dir } = await setup()
    await expect(verify.runVerify(dir, "s1")).rejects.toThrow(/No verify command/)
  })

  it("records a passing run against the current diff and audits it", async () => {
    const { verify, review, audit, dir } = await setup(["node", "-e", "process.exit(0)"])
    const r = await verify.runVerify(dir, "s1")
    expect(r.passed).toBe(true)
    expect(r.exitCode).toBe(0)
    expect(r.diffHash).toBe((await review.getReview(dir, "s1")).diffHash)
    expect((await review.getReview(dir, "s1")).verify?.passed).toBe(true)
    expect((await audit.readAudit(5))[0].action).toBe("verified")
  })

  it("records a failing run with its output", async () => {
    const { verify, audit, dir } = await setup(["node", "-e", "console.log('boom'); process.exit(3)"])
    const r = await verify.runVerify(dir, "s1")
    expect(r.passed).toBe(false)
    expect(r.exitCode).toBe(3)
    expect(r.output).toContain("boom")
    expect((await audit.readAudit(5))[0].action).toBe("verify-failed")
  })

  it("kills a run that exceeds the timeout", async () => {
    const { verify, dir } = await setup(["node", "-e", "setTimeout(()=>{}, 60000)"])
    const r = await verify.runVerify(dir, "s1", { timeoutMs: 300 })
    expect(r.passed).toBe(false)
    expect(r.timedOut).toBe(true)
  })

  it("fails cleanly when the program does not exist", async () => {
    const { verify, dir } = await setup(["definitely-not-a-program-xyz"])
    const r = await verify.runVerify(dir, "s1")
    expect(r.passed).toBe(false)
    expect(r.output).toMatch(/Could not start/)
  })

  it("runs inside the session worktree, not the main checkout", async () => {
    const { verify, dir, info } = await setup(["node", "-e", "require('fs').writeFileSync('ran.txt','x')"])
    await verify.runVerify(dir, "s1")
    expect(existsSync(path.join(info.path, "ran.txt"))).toBe(true)
    expect(existsSync(path.join(dir, "ran.txt"))).toBe(false)
  })

  it("rejects a second run while one is in progress", async () => {
    const { verify, dir } = await setup(["node", "-e", "setTimeout(()=>{}, 800)"])
    const first = verify.runVerify(dir, "s1")
    await new Promise((r) => setTimeout(r, 100))
    await expect(verify.runVerify(dir, "s1")).rejects.toThrow(/already running/)
    await first
  })
})

describe("approval with a verify command", () => {
  it("refuses to merge an unverified session", async () => {
    const { review, dir } = await setup(["node", "-e", "process.exit(0)"])
    const { diffHash } = await review.getReview(dir, "s1")
    await expect(review.approveMerge(dir, "s1", { diffHash })).rejects.toThrow(/requires verification/)
    expect(existsSync(path.join(dir, "new.txt"))).toBe(false)
  })

  it("refuses to merge after a failed verification", async () => {
    const { review, verify, dir } = await setup(["node", "-e", "process.exit(1)"])
    const r = await verify.runVerify(dir, "s1")
    await expect(review.approveMerge(dir, "s1", { diffHash: r.diffHash })).rejects.toThrow(/Verification failed/)
  })

  it("refuses when the session changed after it passed", async () => {
    const { review, verify, dir, info } = await setup(["node", "-e", "process.exit(0)"])
    await verify.runVerify(dir, "s1")
    writeFileSync(path.join(info.path, "sneaky.txt"), "later\n")
    const { diffHash } = await review.getReview(dir, "s1")
    await expect(review.approveMerge(dir, "s1", { diffHash })).rejects.toThrow(/requires verification/)
  })

  it("merges a session that passed on the exact diff", async () => {
    const { review, verify, dir } = await setup(["node", "-e", "process.exit(0)"])
    const r = await verify.runVerify(dir, "s1")
    await review.approveMerge(dir, "s1", { diffHash: r.diffHash })
    expect(existsSync(path.join(dir, "new.txt"))).toBe(true)
  })

  it("does not require verification when none is configured", async () => {
    const { review, dir } = await setup()
    const { diffHash } = await review.getReview(dir, "s1")
    await review.approveMerge(dir, "s1", { diffHash })
    expect(existsSync(path.join(dir, "new.txt"))).toBe(true)
  })
})
