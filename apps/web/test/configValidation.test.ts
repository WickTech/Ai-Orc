import { afterEach, describe, expect, it } from "vitest"
import { mkdirSync, symlinkSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { ConfigValidationError, validateConfigUpdate } from "@/lib/configValidation"
import { cleanupTempDirs, tempDir } from "./helpers"

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
})
