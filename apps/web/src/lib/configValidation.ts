import { promises as fs } from "fs"
import os from "os"
import path from "path"
import type { AppConfig } from "@/types"

export class ConfigValidationError extends Error {}

const ALLOWED_KEYS = new Set(["vaultPath", "port"])

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
  if ("port" in input) {
    const port = input.port
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ConfigValidationError("port must be an integer between 1 and 65535")
    }
    out.port = port
  }
  return out
}
