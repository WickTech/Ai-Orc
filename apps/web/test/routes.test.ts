import { afterEach, describe, expect, it, vi } from "vitest"
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "fs"
import path from "path"
import { cleanupTempDirs, tempDir, withTempHome } from "./helpers"

const cloneAndAnalyze = vi.fn()
vi.mock("@/lib/registry", () => ({ cloneAndAnalyze: (...a: unknown[]) => cloneAndAnalyze(...a) }))

afterEach(() => {
  cloneAndAnalyze.mockReset()
  cleanupTempDirs()
  vi.unstubAllEnvs()
})

const json = (body: unknown, method = "POST") =>
  new Request("http://localhost:3000/api/x", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

async function setup() {
  const { mod: db } = await withTempHome(() => import("@/lib/db"))
  return {
    db,
    config: await import("@/app/api/config/route"),
    file: await import("@/app/api/vault/file/route"),
    tree: await import("@/app/api/vault/tree/route"),
    add: await import("@/app/api/registry/add/route"),
    remove: await import("@/app/api/registry/[id]/route"),
    list: await import("@/app/api/registry/route"),
  }
}

describe("/api/config", () => {
  it("returns config and the built-in tools", async () => {
    const { config } = await setup()
    const body = await (await config.GET()).json()
    expect(body.config).toEqual({ vaultPath: "", port: 3000, repos: [], verify: {} })
    expect(body.tools.map((t: { id: string }) => t.id)).toEqual(["claude", "gemini", "codex", "opencode"])
  })

  it("updates the vault path to an existing directory", async () => {
    const { config } = await setup()
    const dir = tempDir("vault-")
    const res = await config.PUT(json({ vaultPath: dir }, "PUT"))
    expect(res.status).toBe(200)
    expect((await res.json()).config.vaultPath).toBeTruthy()
  })

  it("rejects dangerous or malformed updates with 400 and stores nothing", async () => {
    const { config, db } = await setup()
    for (const body of [{ vaultPath: "/" }, { vaultPath: 5 }, { port: 99999 }, { evil: true }, []]) {
      const res = await config.PUT(json(body, "PUT"))
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    const raw = new Request("http://localhost:3000/api/config", { method: "PUT", body: "{nope", headers: { "content-type": "application/json" } })
    expect((await config.PUT(raw)).status).toBe(400)
    expect(await db.getConfig()).toEqual({ vaultPath: "", port: 3000, repos: [], verify: {} })
  })
})

describe("/api/vault/file", () => {
  async function withVault() {
    const ctx = await setup()
    const root = tempDir("vault-")
    const outside = tempDir("outside-")
    writeFileSync(path.join(root, "a.md"), "hello")
    writeFileSync(path.join(outside, "secret.md"), "secret")
    await ctx.db.setConfig({ vaultPath: root })
    return { ...ctx, root, outside }
  }
  const get = (p?: string) => new Request(`http://localhost:3000/api/vault/file${p ? `?path=${encodeURIComponent(p)}` : ""}`)

  it("400 when path is missing", async () => {
    const { file } = await withVault()
    expect((await file.GET(get())).status).toBe(400)
  })

  it("403 for everything while no vault is configured", async () => {
    const { file } = await setup()
    expect((await file.GET(get("/etc/passwd"))).status).toBe(403)
  })

  it("reads a file inside the vault", async () => {
    const { file, root } = await withVault()
    const res = await file.GET(get(path.join(root, "a.md")))
    expect(await res.json()).toEqual({ content: "hello" })
  })

  it("403 for a path outside the vault and for a symlink escape", async () => {
    const { file, root, outside } = await withVault()
    expect((await file.GET(get(path.join(outside, "secret.md")))).status).toBe(403)
    symlinkSync(outside, path.join(root, "escape"))
    expect((await file.GET(get(path.join(root, "escape", "secret.md")))).status).toBe(403)
  })

  it("404 for a missing file", async () => {
    const { file, root } = await withVault()
    expect((await file.GET(get(path.join(root, "nope.md")))).status).toBe(404)
  })

  it("writes a file inside the vault, but 403 outside it", async () => {
    const { file, root, outside } = await withVault()
    const ok = await file.PUT(json({ path: path.join(root, "new.md"), content: "x" }, "PUT"))
    expect(ok.status).toBe(200)
    expect(readFileSync(path.join(root, "new.md"), "utf-8")).toBe("x")

    const bad = await file.PUT(json({ path: path.join(outside, "planted.md"), content: "x" }, "PUT"))
    expect(bad.status).toBe(403)
  })

  it("serves only visible .md files, for reads and writes", async () => {
    const { file, root } = await withVault()
    writeFileSync(path.join(root, "notes.txt"), "plain")
    mkdirSync(path.join(root, ".hidden"))
    writeFileSync(path.join(root, ".hidden", "x.md"), "hidden")
    symlinkSync(path.join(root, "notes.txt"), path.join(root, "alias.md"))

    expect((await file.GET(get(path.join(root, "notes.txt")))).status).toBe(403)
    expect((await file.GET(get(path.join(root, ".hidden", "x.md")))).status).toBe(403)
    expect((await file.GET(get(path.join(root, "alias.md")))).status).toBe(403) // symlink to a non-.md file
    const put = await file.PUT(json({ path: path.join(root, "evil.sh"), content: "x" }, "PUT"))
    expect(put.status).toBe(403)
    expect(existsSync(path.join(root, "evil.sh"))).toBe(false)
  })

  it("400 when a write is missing path or content", async () => {
    const { file, root } = await withVault()
    expect((await file.PUT(json({ path: path.join(root, "x.md") }, "PUT"))).status).toBe(400)
    expect((await file.PUT(json({ content: "x" }, "PUT"))).status).toBe(400)
  })
})

describe("/api/vault/tree", () => {
  it("returns [] when no vault is configured and the tree when one is", async () => {
    const { tree, db } = await setup()
    expect(await (await tree.GET()).json()).toEqual([])
    const root = tempDir("vault-")
    mkdirSync(path.join(root, "d"))
    writeFileSync(path.join(root, "n.md"), "")
    await db.setConfig({ vaultPath: root })
    const names = (await (await tree.GET()).json()).map((n: { name: string }) => n.name)
    expect(names).toEqual(["d", "n.md"])
  })
})

describe("/api/registry", () => {
  it("rejects anything that is not an https://github.com/ URL, without cloning", async () => {
    const { add } = await setup()
    for (const url of [
      "http://github.com/a/b",
      "https://gitlab.com/a/b",
      "https://github.com.evil.example/a/b",
      "git@github.com:a/b.git",
      "file:///etc/passwd",
      "",
    ]) {
      const res = await add.POST(json({ url }))
      expect(res.status, url).toBe(400)
    }
    expect((await add.POST(json({}))).status).toBe(400)
    expect(cloneAndAnalyze).not.toHaveBeenCalled()
  })

  it("registers a cloned repo as a tool", async () => {
    const { add, list } = await setup()
    cloneAndAnalyze.mockResolvedValue({
      name: "Cool_Tool",
      description: "d",
      installSteps: [],
      repoUrl: "https://github.com/a/Cool_Tool",
      clonePath: "/x",
    })
    expect((await add.POST(json({ url: "https://github.com/a/Cool_Tool" }))).status).toBe(200)
    const tools = await (await list.GET()).json()
    expect(tools.find((t: { id: string }) => t.id === "cool-tool")).toMatchObject({ label: "Cool_Tool", repoUrl: "https://github.com/a/Cool_Tool" })
  })

  it("a repo named like a built-in gets its own id and leaves the built-in intact", async () => {
    const { add, list } = await setup()
    cloneAndAnalyze.mockResolvedValue({ name: "codex", description: "", installSteps: [], repoUrl: "https://github.com/evil/codex", clonePath: "/x" })
    expect((await add.POST(json({ url: "https://github.com/evil/codex" }))).status).toBe(200)
    const tools = await (await list.GET()).json()
    const builtin = tools.find((t: { id: string }) => t.id === "codex")
    expect(builtin).toMatchObject({ builtin: true, label: "Codex CLI" })
    expect(tools.find((t: { id: string }) => t.id === "codex-registry")).toMatchObject({ repoUrl: "https://github.com/evil/codex" })
  })

  it("DELETE removes custom tools but not built-ins", async () => {
    const { db, remove } = await setup()
    await db.addTool({ id: "x", label: "X", command: "x" })
    const call = (id: string) => remove.DELETE(new Request("http://localhost/api/registry/" + id, { method: "DELETE" }), { params: Promise.resolve({ id }) })
    expect((await (await call("x")).json()).map((t: { id: string }) => t.id)).not.toContain("x")
    expect((await (await call("claude")).json()).map((t: { id: string }) => t.id)).toContain("claude")
  })
})
