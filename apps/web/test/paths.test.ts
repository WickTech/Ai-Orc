import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdirSync } from "fs"
import path from "path"
import { cleanupTempDirs, tempDir } from "./helpers"
import { apiToken, dataDir } from "@/lib/paths"

afterEach(() => {
  cleanupTempDirs()
  vi.unstubAllEnvs()
})

function home() {
  const dir = tempDir("home-")
  vi.stubEnv("HOME", dir)
  return dir
}

describe("dataDir", () => {
  it("is ~/.axion on a fresh machine", () => {
    const h = home()
    expect(dataDir()).toBe(path.join(h, ".axion"))
  })

  it("keeps using ~/.ai-orc when only that exists, so live worktrees keep working", () => {
    const h = home()
    mkdirSync(path.join(h, ".ai-orc"))
    expect(dataDir()).toBe(path.join(h, ".ai-orc"))
  })

  it("prefers ~/.axion when both exist", () => {
    const h = home()
    mkdirSync(path.join(h, ".ai-orc"))
    mkdirSync(path.join(h, ".axion"))
    expect(dataDir()).toBe(path.join(h, ".axion"))
  })
})

describe("apiToken", () => {
  it("reads AXION_TOKEN, falls back to AI_ORC_TOKEN, prefers the new name, ignores empty", () => {
    expect(apiToken()).toBeUndefined()
    vi.stubEnv("AI_ORC_TOKEN", "old-token-value")
    expect(apiToken()).toBe("old-token-value")
    vi.stubEnv("AXION_TOKEN", "new-token-value")
    expect(apiToken()).toBe("new-token-value")
    vi.stubEnv("AXION_TOKEN", "")
    vi.stubEnv("AI_ORC_TOKEN", "")
    expect(apiToken()).toBeUndefined()
  })
})
