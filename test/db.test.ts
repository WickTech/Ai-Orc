import { afterEach, describe, expect, it, vi } from "vitest"
import { existsSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { cleanupTempDirs, withTempHome } from "./helpers"

afterEach(() => {
  cleanupTempDirs()
  vi.unstubAllEnvs()
})

const load = () => import("@/lib/db")

describe("db", () => {
  it("creates ~/.ai-orc/db.json with the built-in tools on first use", async () => {
    const { mod, home } = await withTempHome(load)
    const tools = await mod.getTools()
    expect(tools.map((t) => t.id)).toEqual(["claude", "gemini", "codex"])
    expect(tools.every((t) => t.builtin)).toBe(true)
    expect(existsSync(path.join(home, ".ai-orc", "db.json"))).toBe(true)
  })

  it("defaults to no vault and port 3000", async () => {
    const { mod } = await withTempHome(load)
    expect(await mod.getConfig()).toEqual({ vaultPath: "", port: 3000 })
  })

  it("merges config updates and persists them", async () => {
    const { mod, home } = await withTempHome(load)
    await mod.setConfig({ vaultPath: "/tmp/vault" })
    expect((await mod.getConfig()).vaultPath).toBe("/tmp/vault")
    const onDisk = JSON.parse(readFileSync(path.join(home, ".ai-orc", "db.json"), "utf-8"))
    expect(onDisk.config).toEqual({ vaultPath: "/tmp/vault", port: 3000 })
  })

  it("upserts a tool by id", async () => {
    const { mod } = await withTempHome(load)
    await mod.addTool({ id: "x", label: "X", command: "x" })
    await mod.addTool({ id: "x", label: "X2", command: "x2" })
    const tools = await mod.getTools()
    expect(tools.filter((t) => t.id === "x")).toEqual([{ id: "x", label: "X2", command: "x2" }])
  })

  it("removes custom tools but never built-ins", async () => {
    const { mod } = await withTempHome(load)
    await mod.addTool({ id: "x", label: "X", command: "x" })
    await mod.removeTool("x")
    await mod.removeTool("claude")
    const ids = (await mod.getTools()).map((t) => t.id)
    expect(ids).not.toContain("x")
    expect(ids).toContain("claude")
  })

  it("fills missing fields when db.json is partial", async () => {
    const { mod, home } = await withTempHome(load)
    await mod.getTools() // creates the file
    writeFileSync(path.join(home, ".ai-orc", "db.json"), JSON.stringify({ config: { vaultPath: "/v" } }))
    expect(await mod.getConfig()).toEqual({ vaultPath: "/v", port: 3000 })
    expect((await mod.getTools()).length).toBe(3)
  })

  // Known gaps (see PR description):
  it.todo("a registry tool whose id equals a built-in id must not replace the built-in")
  it.todo("setConfig validates input (type of vaultPath, allowed keys)")
})
