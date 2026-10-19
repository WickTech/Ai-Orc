import { afterEach, describe, expect, it } from "vitest"
import { mkdirSync, symlinkSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { ConfigValidationError, validateConfigUpdate } from "@/lib/configValidation"
import { execFileSync } from "child_process"
import { realpathSync } from "fs"
import { cleanupTempDirs, tempDir } from "./helpers"

function gitRepo(): string {
  const dir = realpathSync(tempDir("repo-"))
  execFileSync("git", ["init", "-q"], { cwd: dir })
  return dir
}

afterEach(cleanupTempDirs)

const bad = (v: unknown) => expect(validateConfigUpdate(v)).rejects.toBeInstanceOf(ConfigValidationError)

describe("validateConfigUpdate", () => {
  it("accepts an existing directory as the vault and returns its real path", async () => {
    const dir = tempDir("vault-")
    const out = await validateConfigUpdate({ vaultPath: dir })
    expect(out.vaultPath).toBeTruthy()
    expect(path.isAbsolute(out.vaultPath!)).toBe(true)
  })

  it("resolves a symlinked vault to its real directory", async () => {
    const dir = tempDir("vault-")
    const holder = tempDir("holder-")
    const link = path.join(holder, "link")
    symlinkSync(dir, link)
    const real = (await validateConfigUpdate({ vaultPath: link })).vaultPath!
    const direct = (await validateConfigUpdate({ vaultPath: dir })).vaultPath!
    expect(real).toBe(direct)
  })

  it("allows clearing the vault with an empty string", async () => {
    expect(await validateConfigUpdate({ vaultPath: "" })).toEqual({ vaultPath: "" })
  })

  it("rejects the filesystem root and the home directory", async () => {
    await bad({ vaultPath: "/" })
    await bad({ vaultPath: os.homedir() })
    await bad({ vaultPath: path.dirname(os.homedir()) })
  })

  it("rejects relative paths, missing paths and files", async () => {
    const dir = tempDir("vault-")
    writeFileSync(path.join(dir, "f.md"), "")
    await bad({ vaultPath: "relative/dir" })
    await bad({ vaultPath: path.join(dir, "missing") })
    await bad({ vaultPath: path.join(dir, "f.md") })
  })

  it("rejects non-string vault paths and NUL bytes", async () => {
    await bad({ vaultPath: 5 })
    await bad({ vaultPath: null })
    await bad({ vaultPath: ["/tmp"] })
    await bad({ vaultPath: "/tmp\0/x" })
  })

  it("validates port as an integer in 1-65535", async () => {
    expect(await validateConfigUpdate({ port: 8080 })).toEqual({ port: 8080 })
    for (const port of [0, 70000, 3.5, "3000", null, NaN]) await bad({ port })
  })

  it("rejects unknown keys (no config pollution)", async () => {
    await bad({ vaultPath: "", evil: true })
    await bad({ __proto__: { x: 1 }, constructor: 1 })
  })

  it("rejects bodies that are not plain objects", async () => {
    for (const v of [null, undefined, "str", 5, [], [{ vaultPath: "" }]]) await bad(v)
  })

  it("accepts an empty object as a no-op", async () => {
    expect(await validateConfigUpdate({})).toEqual({})
  })

  it("nested directories under a normal location are fine", async () => {
    const dir = tempDir("vault-")
    mkdirSync(path.join(dir, "notes"))
    await expect(validateConfigUpdate({ vaultPath: path.join(dir, "notes") })).resolves.toBeTruthy()
  })

  describe("repos", () => {
    it("accepts git repository roots and returns their real paths", async () => {
      const a = gitRepo()
      const b = gitRepo()
      expect((await validateConfigUpdate({ repos: [a, b] })).repos).toEqual([a, b])
    })

    it("de-duplicates repeated entries and accepts an empty list", async () => {
      const a = gitRepo()
      expect((await validateConfigUpdate({ repos: [a, a] })).repos).toEqual([a])
      expect((await validateConfigUpdate({ repos: [] })).repos).toEqual([])
    })

    it("rejects non-arrays, non-strings, non-repos, broad paths and too many entries", async () => {
      await bad({ repos: "/tmp" })
      await bad({ repos: [1] })
      await bad({ repos: [tempDir("plain-")] })
      await bad({ repos: [os.homedir()] })
      await bad({ repos: ["/"] })
      await bad({ repos: ["relative/repo"] })
      await bad({ repos: Array.from({ length: 21 }, () => gitRepo()) })
    })
  })
})

describe("verify", () => {
  it("accepts argv arrays keyed by a repository and returns real paths", async () => {
    const a = gitRepo()
    expect((await validateConfigUpdate({ verify: { [a]: ["npm", "test"] } })).verify).toEqual({ [a]: ["npm", "test"] })
    expect((await validateConfigUpdate({ verify: {} })).verify).toEqual({})
  })

  it("rejects non-objects, non-repos, shell-ish programs, empty and oversized commands", async () => {
    const a = gitRepo()
    await bad({ verify: "npm test" })
    await bad({ verify: [] })
    await bad({ verify: { [tempDir("plain-")]: ["npm"] } })
    await bad({ verify: { [a]: "npm test" } })
    await bad({ verify: { [a]: [] } })
    await bad({ verify: { [a]: ["npm test"] } })
    await bad({ verify: { [a]: ["/bin/sh", "-c", "x"] } })
    await bad({ verify: { [a]: ["sh;rm"] } })
    await bad({ verify: { [a]: ["npm", 1] } })
    await bad({ verify: { [a]: ["npm", "x".repeat(201)] } })
    await bad({ verify: { [a]: Array.from({ length: 21 }, () => "x") } })
  })
})
