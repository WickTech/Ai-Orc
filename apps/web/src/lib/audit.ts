import { promises as fs } from "fs"
import { dataDir } from "@/lib/paths"
import path from "path"

export type AuditAction = "merged" | "merge-refused" | "rejected" | "removed" | "verified" | "verify-failed"

export interface AuditEntry {
  at: string
  action: AuditAction
  repoId?: string
  session?: string
  branch?: string
  diffHash?: string
  detail?: string
}

const MAX_FIELD = 1000

// Resolved per call: the home directory is not known at import time in tests.
function auditFile(): string {
  return path.join(dataDir(), "audit.log")
}

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  // One entry per line: fold any line breaks so a value cannot forge entries.
  return value.replace(/[\r\n]+/g, " ").slice(0, MAX_FIELD)
}

/** Appends one JSON line. Only known fields are written. */
export async function appendAudit(entry: Omit<AuditEntry, "at">): Promise<void> {
  const record: AuditEntry = {
    at: new Date().toISOString(),
    action: entry.action,
    repoId: clean(entry.repoId),
    session: clean(entry.session),
    branch: clean(entry.branch),
    diffHash: clean(entry.diffHash),
    detail: clean(entry.detail),
  }
  const file = auditFile()
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, JSON.stringify(record) + "\n", "utf-8")
}

/** Newest entries first. Corrupt lines are skipped. */
export async function readAudit(limit: number): Promise<AuditEntry[]> {
  let raw: string
  try {
    raw = await fs.readFile(auditFile(), "utf-8")
  } catch {
    return []
  }
  const out: AuditEntry[] = []
  for (const line of raw.split("\n").reverse()) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as AuditEntry
      if (typeof parsed.action === "string" && typeof parsed.at === "string") out.push(parsed)
    } catch {
      // skip
    }
    if (out.length >= limit) break
  }
  return out
}
