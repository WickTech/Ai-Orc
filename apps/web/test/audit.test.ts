import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync, writeFileSync, appendFileSync } from "fs"
import path from "path"
import { cleanupTempDirs, withTempHome } from "./helpers"

afterEach(() => {
  cleanupTempDirs()
  vi.unstubAllEnvs()
})

const load = () => import("@/lib/audit")

describe("audit log", () => {
  it("appends JSON lines to ~/.axion/audit.log with a timestamp", async () => {
    const { mod, home } = await withTempHome(load)
    await mod.appendAudit({ action: "rejected", repoId: "r1", session: "s1", branch: "axion/x", detail: "no" })
    const lines = readFileSync(path.join(home, ".axion", "audit.log"), "utf-8").trim().split("\n")
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0])
    expect(entry).toMatchObject({ action: "rejected", repoId: "r1", session: "s1", branch: "axion/x", detail: "no" })
    expect(new Date(entry.at).toString()).not.toBe("Invalid Date")
  })

  it("returns the newest entries first and honours the limit", async () => {
    const { mod } = await withTempHome(load)
    for (let i = 0; i < 5; i++) await mod.appendAudit({ action: "rejected", session: `s${i}` })
    const all = await mod.readAudit(100)
    expect(all.map((e) => e.session)).toEqual(["s4", "s3", "s2", "s1", "s0"])
    expect((await mod.readAudit(2)).map((e) => e.session)).toEqual(["s4", "s3"])
  })

  it("returns an empty list when nothing was logged", async () => {
    const { mod } = await withTempHome(load)
    expect(await mod.readAudit(10)).toEqual([])
  })

  it("keeps one entry per line even when a value contains newlines, and caps long strings", async () => {
    const { mod, home } = await withTempHome(load)
    await mod.appendAudit({ action: "rejected", detail: "line1\nline2\r\n" + "x".repeat(5000) })
    const raw = readFileSync(path.join(home, ".axion", "audit.log"), "utf-8")
    expect(raw.trim().split("\n")).toHaveLength(1)
    const [entry] = await mod.readAudit(1)
    expect(entry.detail!.length).toBeLessThanOrEqual(1000)
  })

  it("skips corrupt lines instead of failing", async () => {
    const { mod, home } = await withTempHome(load)
    await mod.appendAudit({ action: "rejected", session: "ok1" })
    appendFileSync(path.join(home, ".axion", "audit.log"), "{not json\n")
    await mod.appendAudit({ action: "rejected", session: "ok2" })
    expect((await mod.readAudit(10)).map((e) => e.session)).toEqual(["ok2", "ok1"])
  })

  it("ignores unknown fields so request bodies cannot inject keys", async () => {
    const { mod } = await withTempHome(load)
    await mod.appendAudit({ action: "rejected", evil: "x", at: "1999-01-01" } as never)
    const [entry] = await mod.readAudit(1)
    expect(entry).not.toHaveProperty("evil")
    expect(entry.at).not.toBe("1999-01-01")
  })

  it("overwrites nothing: an existing file is only appended to", async () => {
    const { mod, home } = await withTempHome(load)
    await mod.appendAudit({ action: "rejected", session: "first" })
    const before = readFileSync(path.join(home, ".axion", "audit.log"), "utf-8")
    await mod.appendAudit({ action: "merged", session: "second" })
    expect(readFileSync(path.join(home, ".axion", "audit.log"), "utf-8").startsWith(before)).toBe(true)
    writeFileSync(path.join(home, ".axion", "other.txt"), "x") // sanity: dir shared, untouched
  })
})
