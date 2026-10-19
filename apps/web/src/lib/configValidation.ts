import { promises as fs } from "fs"
import os from "os"
import path from "path"
import type { AppConfig } from "@/types"
import { validateRepo, WorktreeError } from "@/lib/worktree"

export class ConfigValidationError extends Error {}

const ALLOWED_KEYS = new Set(["vaultPath", "port", "repos", "verify"])
const MAX_REPOS = 20

async function validateVaultPath(value: unknown): Promise<string> {
  if (typeof value !== "string") throw new ConfigValidationError("vaultPath must be a string")
  if (value === "") return "" // clears the vault
  if (value.includes("\0")) throw new ConfigValidationError("vaultPath contains a NUL byte")
  if (!path.isAbsolute(value)) throw new ConfigValidationError("vaultPath must be an absolute path")

  let real: string
  try {
    real = await fs.realpath(value)
    if (!(await fs.stat(real)).isDirectory()) throw new Error("not a directory")
  } catch {
    throw new ConfigValidationError("vaultPath must be an existing directory")
  }

  // A vault of "/" or of a directory that contains the home folder would make
  // the vault API a window onto the whole machine.
  const home = await fs.realpath(os.homedir()).catch(() => os.homedir())
  if (real === path.parse(real).root || real === home || home.startsWith(real + path.sep)) {
    throw new ConfigValidationError("vaultPath is too broad: choose a dedicated folder")
  }
  return real
}

async function validateRepos(value: unknown): Promise<string[]> {
  if (!Array.isArray(value)) throw new ConfigValidationError("repos must be an array of paths")
  if (value.length > MAX_REPOS) throw new ConfigValidationError(`repos can hold at most ${MAX_REPOS} entries`)
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry !== "string") throw new ConfigValidationError("repos must be an array of paths")
    try {
      const real = await validateRepo(entry)
      if (!out.includes(real)) out.push(real)
    } catch (err) {
      if (err instanceof WorktreeError) throw new ConfigValidationError(`${entry}: ${err.message}`)
      throw err
    }
  }
  return out
}

const COMMAND_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/

// The command runs without a shell inside a session worktree, so it is an argv
// array whose program is a bare name found on PATH (same rule as agent tools).
async function validateVerify(value: unknown): Promise<Record<string, string[]>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigValidationError("verify must be an object mapping repository paths to commands")
  }
  const out: Record<string, string[]> = {}
  for (const [repo, argv] of Object.entries(value)) {
    let real: string
    try {
      real = await validateRepo(repo)
    } catch (err) {
      if (err instanceof WorktreeError) throw new ConfigValidationError(`${repo}: ${err.message}`)
      throw err
    }
    if (!Array.isArray(argv) || argv.length === 0 || argv.length > 20) {
      throw new ConfigValidationError("A verify command must be an array of 1 to 20 strings")
    }
    for (const part of argv) {
      if (typeof part !== "string" || part.length > 200 || part.includes("\0")) {
        throw new ConfigValidationError("Verify command arguments must be strings of at most 200 characters")
      }
    }
    if (!COMMAND_RE.test(argv[0])) throw new ConfigValidationError("The verify program must be a bare command name such as npm or pytest")
    out[real] = argv
  }
  return out
}

export async function validateConfigUpdate(body: unknown): Promise<Partial<AppConfig>> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ConfigValidationError("Body must be a JSON object")
  }
  const out: Partial<AppConfig> = {}
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) throw new ConfigValidationError(`Unknown setting: ${key}`)
  }
  const input = body as Record<string, unknown>
  if ("vaultPath" in input) out.vaultPath = await validateVaultPath(input.vaultPath)
  if ("repos" in input) out.repos = await validateRepos(input.repos)
  if ("verify" in input) out.verify = await validateVerify(input.verify)
  if ("port" in input) {
    const port = input.port
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ConfigValidationError("port must be an integer between 1 and 65535")
    }
    out.port = port
  }
  return out
}
