import { afterEach, describe, expect, it, vi } from "vitest"
import { existsSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { cleanupTempDirs, tempDir } from "./helpers"
import { loadMissionControl, toMissionControl } from "@/lib/missionControl"

afterEach(() => {
  cleanupTempDirs()
  vi.unstubAllEnvs()
})

const fixture = () =>
  JSON.parse(readFileSync(path.resolve(__dirname, "../../../packages/core/test/fixtures/mission-control.valid.json"), "utf-8"))

describe("toMissionControl", () => {
  it("reduces a valid document and keeps source and date on every metric", () => {
    const mc = toMissionControl(fixture())
    const github = mc.sections.find((s) => s.name === "github")!
    expect(github.totals.openPRs).toMatchObject({ value: 5, status: "OK", source: "gh:example-org" })
    expect(mc.items.github[0]).toMatchObject({ name: "demo-repo", url: "https://github.com/example-org/demo-repo" })
    expect(mc.items.github[0].detail).toBe("CI success · 2 PRs · 3 issues")
  })

  it("never shows a number without a value as available", () => {
    const doc = fixture()
    doc.github.totals.openPRs = { value: null, status: "OK", source: "x", asOf: "y", reason: null }
    expect(toMissionControl(doc).sections[0].totals.openPRs.status).toBe("UNAVAILABLE")
  })

  it("renders only https links", () => {
    const doc = fixture()
    doc.github.repos[0].url = "javascript:alert(1)"
    doc.github.repos[1].url = "http://insecure.example"
    const [a, b] = toMissionControl(doc).items.github
    expect(a.url).toBeNull()
    expect(b.url).toBeNull()
  })

  it("rejects unknown schema versions and tolerates missing sections", () => {
    expect(() => toMissionControl({ schemaVersion: 2 })).toThrow(/schema version/)
    expect(() => toMissionControl("nope")).toThrow()
    const mc = toMissionControl({ schemaVersion: 1 })
    expect(mc.sections.every((s) => s.status === "UNAVAILABLE")).toBe(true)
  })

  it("caps list sizes and field lengths", () => {
    const doc = fixture()
    doc.github.repos = Array.from({ length: 500 }, (_, i) => ({ name: "r".repeat(2000) + i }))
    const mc = toMissionControl(doc)
    expect(mc.items.github).toHaveLength(50)
    expect(mc.items.github[0].name.length).toBeLessThanOrEqual(500)
  })
})

describe("loadMissionControl", () => {
  it("returns 404 with a hint when the data file is missing", async () => {
    vi.stubEnv("AXION_DATA_FILE", path.join(tempDir("mc-"), "none.json"))
    expect(await loadMissionControl()).toMatchObject({ ok: false, status: 404 })
  })

  it("returns 500 for corrupt data and the data for a valid file", async () => {
    const file = path.join(tempDir("mc-"), "mc.json")
    vi.stubEnv("AXION_DATA_FILE", file)
    writeFileSync(file, "{not json")
    expect(await loadMissionControl()).toMatchObject({ ok: false, status: 500 })
    writeFileSync(file, JSON.stringify(fixture()))
    const ok = await loadMissionControl()
    expect(ok.ok).toBe(true)
  })

  it("defaults to the data file inside packages/core", async () => {
    const { missionControlFile } = await import("@/lib/missionControl")
    const file = missionControlFile()
    expect(file).toBe(path.resolve(__dirname, "../../../packages/core/data/mission-control.json"))
    // The data file itself is generated and gitignored, but its folder is in the repo.
    expect(existsSync(path.dirname(file))).toBe(true)
  })
})

describe("GET /api/mission-control", () => {
  it("returns the reduced document, or the loader's error status", async () => {
    const route = await import("@/app/api/mission-control/route")
    const file = path.join(tempDir("mc-"), "mc.json")
    vi.stubEnv("AXION_DATA_FILE", file)
    expect((await route.GET()).status).toBe(404)
    writeFileSync(file, JSON.stringify(fixture()))
    const res = await route.GET()
    expect(res.status).toBe(200)
    expect((await res.json()).sections).toHaveLength(5)
  })
})
