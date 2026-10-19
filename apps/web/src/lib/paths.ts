import { existsSync } from "fs"
import os from "os"
import path from "path"

/**
 * Where Axion keeps its data: ~/.axion. Installs that predate the rename keep
 * using ~/.ai-orc until it is moved by hand: git records the absolute path of
 * every session worktree, so moving the folder underneath live sessions would
 * break them. Resolved per call because the home directory is not known at
 * import time in tests.
 */
export function dataDir(): string {
  const home = os.homedir()
  const current = path.join(home, ".axion")
  const legacy = path.join(home, ".ai-orc")
  return !existsSync(current) && existsSync(legacy) ? legacy : current
}

/** API token for sign-in and scripts: AXION_TOKEN, or the older AI_ORC_TOKEN. */
export function apiToken(): string | undefined {
  return process.env.AXION_TOKEN || process.env.AI_ORC_TOKEN || undefined
}
