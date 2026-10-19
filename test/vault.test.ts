import { afterEach, describe, expect, it } from "vitest"
import { mkdirSync, symlinkSync, writeFileSync } from "fs"
import path from "path"
import { getVaultTree, isServableVaultFile, resolveInVault, VaultPathError } from "@/lib/vault"
import { cleanupTempDirs, tempDir } from "./helpers"

afterEach(cleanupTempDirs)

function makeVault() {
  const root = tempDir("vault-")
  const outside = tempDir("outside-")
  mkdirSync(path.join(root, "notes"))
  writeFileSync(path.join(root, "notes", "a.md"), "# a")
  writeFileSync(path.join(outside, "secret.md"), "top secret")
  return { root, outside }
}

describe("resolveInVault", () => {
  it("refuses everything when no vault is configured", async () => {
    await expect(resolveInVault("", "/etc/passwd")).rejects.toBeInstanceOf(VaultPathError)
    await expect(resolveInVault("", process.cwd())).rejects.toThrow("No vault configured")
  })

  it("returns the real path of a file inside the vault", async () => {
    const { root } = makeVault()
    const real = await resolveInVault(root, path.join(root, "notes", "a.md"))
    expect(real.endsWith(path.join("notes", "a.md"))).toBe(true)
  })

  it("allows the vault root itself", async () => {
    const { root } = makeVault()
    await expect(resolveInVault(root, root)).resolves.toBeTruthy()
  })

  it("allows creating a new file in an existing vault directory", async () => {
    const { root } = makeVault()
    const real = await resolveInVault(root, path.join(root, "notes", "new.md"))
    expect(real.endsWith(path.join("notes", "new.md"))).toBe(true)
  })

  it("rejects a path outside the vault", async () => {
    const { root, outside } = makeVault()
    await expect(resolveInVault(root, path.join(outside, "secret.md"))).rejects.toBeInstanceOf(VaultPathError)
  })

  it("rejects .. traversal out of the vault", async () => {
    const { root, outside } = makeVault()
    const sneaky = path.join(root, "notes", "..", "..", path.basename(outside), "secret.md")
    await expect(resolveInVault(root, sneaky)).rejects.toBeInstanceOf(VaultPathError)
  })

  it("rejects a sibling directory that merely shares the vault's name prefix", async () => {
    const { root } = makeVault()
    const sibling = `${root}-evil`
    mkdirSync(sibling)
    writeFileSync(path.join(sibling, "x.md"), "x")
    await expect(resolveInVault(root, path.join(sibling, "x.md"))).rejects.toBeInstanceOf(VaultPathError)
    // cleanup of the sibling
    const { rmSync } = await import("fs")
    rmSync(sibling, { recursive: true, force: true })
  })

  it("rejects a file symlink that points outside the vault", async () => {
    const { root, outside } = makeVault()
    symlinkSync(path.join(outside, "secret.md"), path.join(root, "notes", "link.md"))
    await expect(resolveInVault(root, path.join(root, "notes", "link.md"))).rejects.toBeInstanceOf(VaultPathError)
  })

  it("rejects a directory symlink that points outside the vault", async () => {
    const { root, outside } = makeVault()
    symlinkSync(outside, path.join(root, "escape"))
    await expect(resolveInVault(root, path.join(root, "escape", "secret.md"))).rejects.toBeInstanceOf(VaultPathError)
  })

  it("rejects creating a new file through a symlinked parent directory", async () => {
    const { root, outside } = makeVault()
    symlinkSync(outside, path.join(root, "escape"))
    await expect(resolveInVault(root, path.join(root, "escape", "planted.md"))).rejects.toBeInstanceOf(VaultPathError)
  })

  it("allows a symlink that stays inside the vault", async () => {
    const { root } = makeVault()
    symlinkSync(path.join(root, "notes"), path.join(root, "alias"))
    await expect(resolveInVault(root, path.join(root, "alias", "a.md"))).resolves.toBeTruthy()
  })

  it("throws a plain error (not VaultPathError) when the parent directory does not exist", async () => {
    const { root } = makeVault()
    const err = await resolveInVault(root, path.join(root, "missing", "x.md")).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(VaultPathError)
  })
})

describe("getVaultTree", () => {
  it("lists markdown files and folders, skipping dotfiles and non-markdown", async () => {
    const root = tempDir("tree-")
    mkdirSync(path.join(root, "z-dir"))
    mkdirSync(path.join(root, ".obsidian"))
    writeFileSync(path.join(root, "b.md"), "")
    writeFileSync(path.join(root, "a.md"), "")
    writeFileSync(path.join(root, "image.png"), "")
    writeFileSync(path.join(root, ".hidden.md"), "")
    writeFileSync(path.join(root, "z-dir", "inner.md"), "")

    const tree = await getVaultTree(root)
    expect(tree.map((n) => `${n.type}:${n.name}`)).toEqual(["dir:z-dir", "file:a.md", "file:b.md"])
    expect(tree[0].children?.map((c) => c.name)).toEqual(["inner.md"])
  })

  it("returns an empty list for a missing directory", async () => {
    expect(await getVaultTree("/definitely/not/here")).toEqual([])
  })
})

describe("isServableVaultFile", () => {
  it("serves visible .md files", async () => {
    const { root } = makeVault()
    expect(await isServableVaultFile(root, path.join(root, "notes", "a.md"))).toBe(true)
    expect(await isServableVaultFile(root, path.join(root, "notes", "NEW.MD"))).toBe(true)
  })

  it("refuses non-markdown files", async () => {
    const { root } = makeVault()
    for (const name of ["x.txt", "id_rsa", "config.json", "a.md.bak"]) {
      expect(await isServableVaultFile(root, path.join(root, "notes", name)), name).toBe(false)
    }
  })

  it("refuses files inside dot-directories and dotfiles, as the tree view hides them", async () => {
    const { root } = makeVault()
    expect(await isServableVaultFile(root, path.join(root, ".obsidian", "a.md"))).toBe(false)
    expect(await isServableVaultFile(root, path.join(root, "notes", ".secret.md"))).toBe(false)
  })

  it("refuses a path outside the vault", async () => {
    const { root, outside } = makeVault()
    expect(await isServableVaultFile(root, path.join(outside, "secret.md"))).toBe(false)
  })
})
