import { promises as fs } from "fs"
import path from "path"

export interface McMetric {
  value: number | null
  status: string
  source: string
  asOf: string
  reason: string | null
}

export interface McAlert {
  message: string
  severity: "critical" | "warning"
  source: string
  asOf: string
}

export interface McTarget {
  id: string
  label: string
  comparator: string
  target: number
  current: McMetric
}

export interface McSection {
  name: string
  status: string
  source: string
  asOf: string
  reason: string | null
  totals: Record<string, McMetric>
}

export interface McItem {
  name: string
  detail: string
  url: string | null
}

export interface MissionControl {
  generatedAt: string
  dataMode: string
  alerts: McAlert[]
  targets: McTarget[]
  sections: McSection[]
  /** Per-section lists (github repos, vercel projects), reduced to what the page shows. */
  items: Record<string, McItem[]>
}

const SECTIONS = ["github", "vercel", "gmail", "supabase", "orchestrator"]
const MAX_ITEMS = 50

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v.slice(0, 500) : fallback)
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

function metric(v: unknown): McMetric {
  const m = rec(v)
  const value = typeof m.value === "number" && Number.isFinite(m.value) ? m.value : null
  // Rule 3 of the original dashboard: a number that cannot be verified is UNAVAILABLE.
  const status = value === null ? "UNAVAILABLE" : str(m.status, "UNAVAILABLE")
  return { value, status, source: str(m.source), asOf: str(m.asOf), reason: typeof m.reason === "string" ? m.reason.slice(0, 500) : null }
}

/** Only https links are rendered as links. */
function safeUrl(v: unknown): string | null {
  if (typeof v !== "string") return null
  try {
    const u = new URL(v)
    return u.protocol === "https:" ? u.toString() : null
  } catch {
    return null
  }
}

function items(section: string, doc: Record<string, unknown>): McItem[] {
  const raw = section === "github" ? doc.repos : section === "vercel" ? doc.projects : undefined
  if (!Array.isArray(raw)) return []
  return raw.slice(0, MAX_ITEMS).map((entry) => {
    const e = rec(entry)
    const detail =
      section === "github"
        ? `CI ${str(e.ci, "unknown")} · ${num(e.openPRs)} PRs · ${num(e.openIssues)} issues`
        : `${str(e.state, "unknown")}${e.error ? ` · ${str(e.error)}` : ""}`
    return { name: str(e.name, "(unnamed)"), detail, url: safeUrl(e.url) }
  })
}

const num = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? String(v) : "?")

/** Reduces an untrusted mission-control document to the fields the page renders. */
export function toMissionControl(input: unknown): MissionControl {
  const doc = rec(input)
  if (doc.schemaVersion !== 1) throw new Error("Unsupported mission-control schema version")

  const alerts: McAlert[] = (Array.isArray(doc.alerts) ? doc.alerts : []).slice(0, MAX_ITEMS).map((a) => {
    const x = rec(a)
    return { message: str(x.message), severity: x.severity === "critical" ? "critical" : "warning", source: str(x.source), asOf: str(x.asOf) }
  })

  const targets: McTarget[] = (Array.isArray(rec(doc.objective).targets) ? (rec(doc.objective).targets as unknown[]) : [])
    .slice(0, MAX_ITEMS)
    .map((t) => {
      const x = rec(t)
      return {
        id: str(x.id),
        label: str(x.label),
        comparator: str(x.comparator),
        target: typeof x.target === "number" ? x.target : 0,
        current: metric(x.current),
      }
    })

  const sections: McSection[] = []
  const lists: Record<string, McItem[]> = {}
  for (const name of SECTIONS) {
    const s = rec(doc[name])
    const totals: Record<string, McMetric> = {}
    for (const [key, value] of Object.entries(rec(s.totals)).slice(0, 20)) totals[key] = metric(value)
    sections.push({
      name,
      status: str(s.status, "UNAVAILABLE"),
      source: str(s.source),
      asOf: str(s.asOf),
      reason: typeof s.reason === "string" ? s.reason.slice(0, 500) : null,
      totals,
    })
    lists[name] = items(name, s)
  }

  return { generatedAt: str(doc.generatedAt), dataMode: str(doc.dataMode, "unknown"), alerts, targets, sections, items: lists }
}

/** AXION_DATA_FILE overrides the default location inside the monorepo (apps/web is the cwd). */
export function missionControlFile(): string {
  return process.env.AXION_DATA_FILE || path.resolve(/* turbopackIgnore: true */ "../../packages/core/data/mission-control.json")
}

export type McResult = { ok: true; data: MissionControl } | { ok: false; status: number; error: string }

export async function loadMissionControl(): Promise<McResult> {
  let raw: string
  try {
    raw = await fs.readFile(/* turbopackIgnore: true */ missionControlFile(), "utf-8")
  } catch {
    return { ok: false, status: 404, error: "No mission-control data yet: run `npm run -w @wicktech/axion-core build:data`" }
  }
  try {
    return { ok: true, data: toMissionControl(JSON.parse(raw)) }
  } catch (err) {
    return { ok: false, status: 500, error: `Mission-control data is invalid: ${err instanceof Error ? err.message : "unreadable"}` }
  }
}
