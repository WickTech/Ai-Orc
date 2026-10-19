import { afterEach, describe, expect, it, vi } from "vitest"
import { execFileSync } from "child_process"
import { existsSync, readFileSync, realpathSync, writeFileSync } from "fs"
import path from "path"
import { cleanupTempDirs, tempDir, withTempHome } from "./helpers"

afterEach(() => {
  cleanupTempDirs()
  vi.unstubAllEnvs()
})

const post = (body: unknown) =>
  new Request("http://localhost:3000/api/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
const del = (body: unknown) =>
  new Request("http://localhost:3000/api/x", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
const get = (qs: string) => new Request(`http://localhost:3000/api/x?${qs}`)

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim()
}

async function setup() {
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
  await db.setConfig({ repos: [dir] })
  const info = await wt.createWorktree({ repoPath: dir, sessionId: "s1", toolId: "claude" })
  writeFileSync(path.join(info.path, "new.txt"), "fresh\n")
  return {
    repo: dir,
    repoId: wt.repoIdFor(dir),
    info,
    review: await import("@/app/api/worktrees/review/route"),
    approve: await import("@/app/api/worktrees/approve/route"),
    reject: await import("@/app/api/worktrees/reject/route"),
    worktrees: await import("@/app/api/worktrees/route"),
    audit: await import("@/app/api/audit/route"),
  }
}

describe("GET /api/worktrees/review", () => {
  it("returns the files, diff and hash of a session", async () => {
    const { review, repoId } = await setup()
    const res = await review.GET(get(`repoId=${repoId}&id=s1`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.files).toEqual([{ path: "new.txt", status: "added", additions: 1, deletions: 0 }])
    expect(body.diff).toContain("+fresh")
    expect(body.diffHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("400 without params, 404 for unknown repo or session", async () => {
    const { review, repoId } = await setup()
    expect((await review.GET(get(""))).status).toBe(400)
    expect((await review.GET(get(`repoId=deadbeef0000&id=s1`))).status).toBe(404)
    expect((await review.GET(get(`repoId=${repoId}&id=nope`))).status).toBe(404)
    expect((await review.GET(get(`repoId=${repoId}&id=../../etc`))).status).toBe(400)
  })
})

describe("POST /api/worktrees/approve", () => {
  it("merges only when the hash from the review is sent", async () => {
    const { review, approve, repo, repoId } = await setup()
    const { diffHash } = await (await review.GET(get(`repoId=${repoId}&id=s1`))).json()
    const res = await approve.POST(post({ repoId, id: "s1", diffHash }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ merged: true, target: "main" })
    expect(readFileSync(path.join(repo, "new.txt"), "utf-8")).toBe("fresh\n")
  })

  it("409 when no hash is sent: approval cannot be skipped", async () => {
    const { approve, repo, repoId } = await setup()
    const res = await approve.POST(post({ repoId, id: "s1" }))
    expect(res.status).toBe(409)
    expect(existsSync(path.join(repo, "new.txt"))).toBe(false)
  })

  it("409 for a stale hash after the work changed", async () => {
    const { review, approve, info, repo, repoId } = await setup()
    const { diffHash } = await (await review.GET(get(`repoId=${repoId}&id=s1`))).json()
    writeFileSync(path.join(info.path, "new.txt"), "changed after review\n")
    expect((await approve.POST(post({ repoId, id: "s1", diffHash }))).status).toBe(409)
    expect(existsSync(path.join(repo, "new.txt"))).toBe(false)
  })

  it("400 for malformed bodies, 404 for unknown repo or session", async () => {
    const { approve, repoId } = await setup()
    expect((await approve.POST(new Request("http://localhost:3000/api/x", { method: "POST", body: "{nope" }))).status).toBe(400)
    expect((await approve.POST(post({}))).status).toBe(400)
    expect((await approve.POST(post({ repoId: "deadbeef0000", id: "s1" }))).status).toBe(404)
    expect((await approve.POST(post({ repoId, id: "nope", diffHash: "x" }))).status).toBe(404)
  })
})

describe("POST /api/worktrees/reject and the audit trail", () => {
  it("records a rejection, keeps the session and shows it in /api/audit", async () => {
    const { reject, audit, info, repoId } = await setup()
    expect((await reject.POST(post({ repoId, id: "s1", reason: "wrong approach" }))).status).toBe(200)
    expect(existsSync(info.path)).toBe(true)
    const { entries } = await (await audit.GET(get(""))).json()
    expect(entries[0]).toMatchObject({ action: "rejected", session: "s1", detail: "wrong approach" })
  })

  it("logs removals, merges and refused merges in order, newest first", async () => {
    const { review, approve, worktrees, audit, repoId } = await setup()
    await approve.POST(post({ repoId, id: "s1" })) // refused: no hash
    const { diffHash } = await (await review.GET(get(`repoId=${repoId}&id=s1`))).json()
    await approve.POST(post({ repoId, id: "s1", diffHash })) // merged
    expect((await worktrees.DELETE(del({ repoId, id: "s1" }))).status).toBe(404) // already gone
    const { entries } = await (await audit.GET(get(""))).json()
    expect(entries.map((e: { action: string }) => e.action)).toEqual(["merged", "merge-refused"])
  })

  it("logs a forced removal", async () => {
    const { worktrees, audit, repoId } = await setup()
    expect((await worktrees.DELETE(del({ repoId, id: "s1" }))).status).toBe(409)
    expect((await worktrees.DELETE(del({ repoId, id: "s1", force: true }))).status).toBe(200)
    const { entries } = await (await audit.GET(get(""))).json()
    expect(entries[0]).toMatchObject({ action: "removed", session: "s1", detail: "forced" })
  })

  it("caps the audit limit and ignores a bad one", async () => {
    const { audit } = await setup()
    expect((await audit.GET(get("limit=-5"))).status).toBe(200)
    expect((await audit.GET(get("limit=99999"))).status).toBe(200)
    expect((await audit.GET(get("limit=abc"))).status).toBe(200)
  })
})
