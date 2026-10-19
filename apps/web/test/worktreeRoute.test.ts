import { afterEach, describe, expect, it, vi } from "vitest"
import { execFileSync } from "child_process"
import { existsSync, realpathSync, writeFileSync } from "fs"
import path from "path"
import { cleanupTempDirs, tempDir, withTempHome } from "./helpers"

afterEach(() => {
  cleanupTempDirs()
  vi.unstubAllEnvs()
})

const json = (body: unknown, method = "DELETE") =>
  new Request("http://localhost:3000/api/worktrees", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

function makeRepo(): string {
  const dir = realpathSync(tempDir("ai-orc-repo-"))
  const run = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
    })
  run("init", "-q", "-b", "main")
  writeFileSync(path.join(dir, "a.txt"), "one\n")
  run("add", ".")
  run("commit", "-q", "-m", "init")
  return dir
}

async function setup() {
  const { mod: db } = await withTempHome(() => import("@/lib/db"))
  const wt = await import("@/lib/worktree")
  const route = await import("@/app/api/worktrees/route")
  const repo = makeRepo()
  await db.setConfig({ repos: [repo] })
  return { db, wt, route, repo, repoId: wt.repoIdFor(repo) }
}

describe("/api/worktrees", () => {
  it("lists session worktrees with status for configured repos, and the repos themselves", async () => {
    const { wt, route, repo, repoId } = await setup()
    await wt.createWorktree({ repoPath: repo, sessionId: "s1", toolId: "claude" })
    const body = await (await route.GET()).json()
    expect(body.repos).toEqual([{ id: repoId, path: repo, name: path.basename(repo) }])
    expect(body.worktrees).toHaveLength(1)
    expect(body.worktrees[0]).toMatchObject({ id: "s1", repoId, branch: "axion/claude-s1", dirty: false, ahead: 0, exists: true })
  })

  it("returns empty lists when no repos are configured", async () => {
    const { db, route } = await setup()
    await db.setConfig({ repos: [] })
    expect(await (await route.GET()).json()).toEqual({ repos: [], worktrees: [] })
  })

  it("removes a clean worktree", async () => {
    const { wt, route, repo, repoId } = await setup()
    const info = await wt.createWorktree({ repoPath: repo, sessionId: "s2", toolId: "claude" })
    const res = await route.DELETE(json({ repoId, id: "s2" }))
    expect(res.status).toBe(200)
    expect(existsSync(info.path)).toBe(false)
  })

  it("409 for a worktree with unmerged work unless force is true", async () => {
    const { wt, route, repo, repoId } = await setup()
    const info = await wt.createWorktree({ repoPath: repo, sessionId: "s3", toolId: "claude" })
    writeFileSync(path.join(info.path, "new.txt"), "x")
    const refused = await route.DELETE(json({ repoId, id: "s3" }))
    expect(refused.status).toBe(409)
    expect(existsSync(info.path)).toBe(true)
    expect((await route.DELETE(json({ repoId, id: "s3", force: true }))).status).toBe(200)
    expect(existsSync(info.path)).toBe(false)
  })

  it("only treats force as set when it is exactly true", async () => {
    const { wt, route, repo, repoId } = await setup()
    const info = await wt.createWorktree({ repoPath: repo, sessionId: "s4", toolId: "claude" })
    writeFileSync(path.join(info.path, "new.txt"), "x")
    expect((await route.DELETE(json({ repoId, id: "s4", force: "true" }))).status).toBe(409)
  })

  it("400 for malformed bodies and an unsafe id, 404 for unknown repo or session", async () => {
    const { route, repoId } = await setup()
    const raw = new Request("http://localhost:3000/api/worktrees", { method: "DELETE", body: "{nope" })
    expect((await route.DELETE(raw)).status).toBe(400)
    expect((await route.DELETE(json({}))).status).toBe(400)
    expect((await route.DELETE(json({ repoId, id: "../../etc" }))).status).toBe(400)
    expect((await route.DELETE(json({ repoId: "deadbeef0000", id: "s1" }))).status).toBe(404)
    expect((await route.DELETE(json({ repoId, id: "missing" }))).status).toBe(404)
  })
})
