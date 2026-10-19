import { promises as fs } from "fs"
import { repoIdFor, sessionFile } from "@/lib/worktree"

export interface VerifyResult {
  passed: boolean
  /** null when the process was killed (timeout) or could not start. */
  exitCode: number | null
  timedOut: boolean
  command: string[]
  /** Tail of the combined stdout/stderr. */
  output: string
  /** Hash of the session diff after the command ran: the state that was verified. */
  diffHash: string
  at: string
}

export async function readVerify(repoPath: string, id: string): Promise<VerifyResult | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(sessionFile(repoIdFor(repoPath), id, "verify"), "utf-8")) as VerifyResult
    if (typeof parsed.passed !== "boolean" || typeof parsed.diffHash !== "string") return null
    return parsed
  } catch {
    return null
  }
}

export async function writeVerify(repoPath: string, id: string, result: VerifyResult): Promise<void> {
  await fs.writeFile(sessionFile(repoIdFor(repoPath), id, "verify"), JSON.stringify(result, null, 2))
}
