import { afterEach, describe, expect, it, vi } from "vitest"
import { execFileSync } from "child_process"
import { existsSync, readFileSync, realpathSync, writeFileSync } from "fs"
import path from "path"
import { cleanupTempDirs, tempDir, withTempHome } from "./helpers"

afterEach(() => {
  cleanupTempDirs()
  vi.unstubAllEnvs()
})

const json = (method: string, body: unknown) =>
  new Request("http://localhost:3000/api/tasks", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

async function setup() {
  const { mod: tasks, home } = await withTempHome(() => import("@/lib/tasks"))
  return { tasks, home, route: await import("@/app/api/tasks/route") }
}

describe("tasks", () => {
  it("creates, lists, updates and deletes", async () => {
    const { tasks } = await setup()
    expect(await tasks.listTasks()).toEqual([])
    const t = await tasks.createTask({ title: "  write   docs " })
    expect(t).toMatchObject({ title: "write docs", status: "todo" })
    expect((await tasks.updateTask(t.id, { status: "doing" })).status).toBe("doing")
    expect((await tasks.updateTask(t.id, { title: "renamed" })).title).toBe("renamed")
    await tasks.deleteTask(t.id)
    expect(await tasks.listTasks()).toEqual([])
  })

  it("rejects bad titles, statuses and empty updates", async () => {
    const { tasks } = await setup()
    await expect(tasks.createTask({ title: "" })).rejects.toThrow(/required/)
    await expect(tasks.createTask({ title: "   " })).rejects.toThrow(/required/)
    await expect(tasks.createTask({ title: 5 })).rejects.toThrow(/string/)
    await expect(tasks.createTask({ title: "x".repeat(201) })).rejects.toThrow(/at most/)
    const t = await tasks.createTask({ title: "ok" })
    await expect(tasks.updateTask(t.id, { status: "nope" })).rejects.toThrow(/status/)
    await expect(tasks.updateTask(t.id, {})).rejects.toThrow(/Nothing/)
    await expect(tasks.updateTask("missing", { status: "done" })).rejects.toMatchObject({ code: "not_found" })
    await expect(tasks.deleteTask("missing")).rejects.toMatchObject({ code: "not_found" })
  })

  it("caps the number of tasks", async () => {
    const { tasks } = await setup()
    await Promise.all(Array.from({ length: 200 }, (_, i) => tasks.createTask({ title: `t${i}` })))
    await expect(tasks.createTask({ title: "one more" })).rejects.toThrow(/At most 200/)
  })

  it("does not lose concurrent creates", async () => {
    const { tasks } = await setup()
    await Promise.all(Array.from({ length: 25 }, (_, i) => tasks.createTask({ title: `t${i}` })))
    expect(await tasks.listTasks()).toHaveLength(25)
  })

  it("treats a corrupt file as empty and keeps only well-formed entries", async () => {
    const { tasks, home } = await setup()
    const file = path.join(home, ".ai-orc", "tasks.json")
    await tasks.createTask({ title: "first" })
    writeFileSync(file, "{broken")
    expect(await tasks.listTasks()).toEqual([])
    writeFileSync(file, JSON.stringify([{ id: "1", title: "a", status: "todo", createdAt: "x" }, { id: 2 }, { id: "3", title: "b", status: "weird", createdAt: "x" }]))
    expect((await tasks.listTasks()).map((t) => t.id)).toEqual(["1"])
  })
})

describe("/api/tasks", () => {
  it("validates input and maps errors to statuses", async () => {
    const { route } = await setup()
    expect((await route.POST(new Request("http://localhost:3000/api/tasks", { method: "POST", body: "{" }))).status).toBe(400)
    expect((await route.POST(json("POST", { title: "" }))).status).toBe(400)
    expect((await route.POST(json("POST", { title: "x", repoId: "nope" }))).status).toBe(404)
    const created = await route.POST(json("POST", { title: "ship it" }))
    expect(created.status).toBe(201)
    const { task } = await created.json()
    expect((await route.PATCH(json("PATCH", { id: task.id, status: "done" }))).status).toBe(200)
    expect((await route.PATCH(json("PATCH", { id: task.id, status: "bad" }))).status).toBe(400)
    expect((await route.PATCH(json("PATCH", { id: "zzz", status: "done" }))).status).toBe(404)
    expect((await route.PATCH(json("PATCH", { status: "done" }))).status).toBe(400)
    expect((await route.DELETE(json("DELETE", { id: task.id }))).status).toBe(200)
    expect((await route.DELETE(json("DELETE", { id: task.id }))).status).toBe(404)
    expect((await (await route.GET()).json()).tasks).toEqual([])
  })

  it("links a task to a configured repository only", async () => {
    const { mod: db } = await withTempHome(() => import("@/lib/db"))
    const wt = await import("@/lib/worktree")
    const route = await import("@/app/api/tasks/route")
    const dir = realpathSync(tempDir("ai-orc-repo-"))
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir })
    await db.setConfig({ repos: [dir] })
    const repoId = wt.repoIdFor(dir)
    const res = await route.POST(json("POST", { title: "in repo", repoId }))
    expect(res.status).toBe(201)
    expect((await res.json()).task.repoId).toBe(repoId)
    expect(existsSync(dir)).toBe(true)
    expect(readFileSync(path.join(process.env.HOME ?? "", ".ai-orc", "tasks.json"), "utf-8")).toContain(repoId)
  })
})
