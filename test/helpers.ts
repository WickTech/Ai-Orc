import { mkdtempSync, rmSync } from "fs"
import os from "os"
import path from "path"
import { vi } from "vitest"

const dirs: string[] = []

export function tempDir(prefix = "ai-orc-test-"): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

export function cleanupTempDirs(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
}

// db.ts and registry.ts compute their storage dir from os.homedir() at import
// time, so tests point HOME at a fresh temp dir and re-import the module.
export async function withTempHome<T>(load: () => Promise<T>): Promise<{ mod: T; home: string }> {
  const home = tempDir("ai-orc-home-")
  vi.stubEnv("HOME", home)
  vi.stubEnv("USERPROFILE", home)
  vi.resetModules()
  return { mod: await load(), home }
}
