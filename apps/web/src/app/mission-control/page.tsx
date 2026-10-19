"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { SessionBoard } from "@/components/sessions/SessionBoard"
import type { McMetric, MissionControl } from "@/lib/missionControl"

const fmt = (m: McMetric) => (m.value === null ? "UNAVAILABLE" : String(m.value))

function Metric({ label, metric }: { label: string; metric: McMetric }) {
  return (
    <div className="rounded-md border border-white/10 p-3" title={`${metric.source || "no source"} · ${metric.asOf || "no date"}${metric.reason ? ` · ${metric.reason}` : ""}`}>
      <p className="text-[10px] uppercase tracking-wider text-white/30">{label}</p>
      <p className={`text-lg font-mono ${metric.value === null ? "text-white/30" : "text-white"}`}>{fmt(metric)}</p>
    </div>
  )
}

export default function MissionControlPage() {
  const [data, setData] = useState<MissionControl | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/mission-control")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) setError(body.error ?? `Could not load mission control (HTTP ${res.status})`)
        else setData(body)
      })
      .catch(() => setError("Could not reach the server"))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Mission Control</h1>
          <p className="text-white/40 text-sm mt-1">
            Read-only status of your projects. Every number shows its source and date on hover; unverified numbers are UNAVAILABLE.
            {data && ` Generated ${new Date(data.generatedAt).toLocaleString()} (${data.dataMode}).`}
          </p>
        </div>

        <SessionBoard />

        {loading && <Loader2 className="h-5 w-5 animate-spin text-white/40" />}
        {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}

        {data && (
          <>
            {data.alerts.length > 0 && (
              <section aria-label="Alerts" className="space-y-2">
                {data.alerts.map((a, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                      a.severity === "critical" ? "border-red-500/40 text-red-300 bg-red-500/10" : "border-amber-500/40 text-amber-300 bg-amber-500/10"
                    }`}
                  >
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span className="flex-1">{a.message}</span>
                    <span className="text-xs opacity-60">{a.source}</span>
                  </div>
                ))}
              </section>
            )}

            {data.targets.length > 0 && (
              <section aria-label="Objective" className="space-y-2">
                <h2 className="text-xs font-semibold text-white/30 uppercase tracking-wider">Objective</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {data.targets.map((t) => (
                    <Metric key={t.id} label={`${t.label} (target ${t.comparator === "atMost" ? "≤" : "≥"} ${t.target})`} metric={t.current} />
                  ))}
                </div>
              </section>
            )}

            {data.sections.map((s) => (
              <section key={s.name} aria-label={s.name} className="p-4 rounded-xl border border-white/10 bg-white/[0.02] space-y-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-white/80 capitalize flex-1">{s.name}</h2>
                  <span className={`text-[10px] rounded border px-1.5 py-0.5 font-mono ${s.status === "OK" ? "border-emerald-500/30 text-emerald-300" : "border-white/20 text-white/40"}`}>
                    {s.status}
                  </span>
                </div>
                {s.status !== "OK" && s.reason && <p className="text-xs text-white/40">{s.reason}</p>}
                {Object.keys(s.totals).length > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {Object.entries(s.totals).map(([key, m]) => (
                      <Metric key={key} label={key} metric={m} />
                    ))}
                  </div>
                )}
                {data.items[s.name]?.length > 0 && (
                  <ul className="text-xs font-mono space-y-1">
                    {data.items[s.name].map((it, i) => (
                      <li key={i} className="text-white/50">
                        {it.url ? (
                          <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:underline">{it.name}</a>
                        ) : (
                          <span className="text-white/80">{it.name}</span>
                        )}{" "}
                        · {it.detail}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
