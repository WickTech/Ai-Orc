import { spawn } from "child_process"
import { appendAudit } from "@/lib/audit"
import { getConfig } from "@/lib/db"
import { getReview } from "@/lib/review"
import { readVerify, writeVerify, type VerifyResult } from "@/lib/verifyStore"
import { findWorktree, repoIdFor, validateRepo, WorktreeError } from "@/lib/worktree"

const MAX_OUTPUT = 64 * 1024
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

const running = new Set<string>()

export { readVerify }

/** The verify command configured for a repo, or null. */
export async function verifyCommandFor(repoPath: string): Promise<string[] | null> {
  const { verify } = await getConfig()
  return verify?.[repoPath] ?? null
}

function runCommand(argv: string[], cwd: string, timeoutMs: number): Promise<Omit<VerifyResult, "diffHash" | "at" | "command" | "passed"> & { started: boolean }> {
  return new Promise((resolve) => {
    // No shell, and argv comes from saved config where validateConfigUpdate allows only a bare program name plus plain string arguments.
    const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...process.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"] }) // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
    let output = ""
    let timedOut = false
    const collect = (d: Buffer) => {
      output += d
      if (output.length > MAX_OUTPUT * 2) output = output.slice(-MAX_OUTPUT)
    }
    child.stdout.on("data", collect)
    child.stderr.on("data", collect)
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, timeoutMs)
    child.on("error", (err) => {
      clearTimeout(timer)
      resolve({ exitCode: null, timedOut: false, output: `Could not start "${argv[0]}": ${err.message}`, started: false })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code, timedOut, output: output.slice(-MAX_OUTPUT), started: true })
    })
  })
}

/**
 * Runs the repo's verify command in the session worktree and records the
 * result against the diff as it is after the run. Approval requires a passing
 * result for the current diff.
 */
export async function runVerify(repoInput: string, id: string, opts: { timeoutMs?: number } = {}): Promise<VerifyResult> {
  const repoPath = await validateRepo(repoInput)
  const argv = await verifyCommandFor(repoPath)
  if (!argv) throw new WorktreeError("No verify command is configured for this repository", "invalid")
  const status = await findWorktree(repoPath, id)
  if (!status || !status.exists) throw new WorktreeError(`Worktree session "${id}" not found`, "not_found")

  const key = `${repoPath}\0${id}`
  if (running.has(key)) throw new WorktreeError("Verification is already running for this session", "conflict")
  running.add(key)
  try {
    const run = await runCommand(argv, status.path, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const passed = run.started && !run.timedOut && run.exitCode === 0
    // Hash after the run: the tests may have written files, and what gets
    // merged is the state that was just verified.
    const { diffHash } = await getReview(repoPath, id)
    const result: VerifyResult = {
      passed,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      command: argv,
      output: run.output,
      diffHash,
      at: new Date().toISOString(),
    }
    await writeVerify(repoPath, id, result)
    await appendAudit({
      action: passed ? "verified" : "verify-failed",
      repoId: repoIdFor(repoPath),
      session: id,
      branch: status.branch,
      diffHash,
      detail: run.timedOut ? "timed out" : `exit code ${run.exitCode}`,
    })
    return result
  } finally {
    running.delete(key)
  }
}
