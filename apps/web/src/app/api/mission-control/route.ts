import { NextResponse } from "next/server"
import { loadMissionControl } from "@/lib/missionControl"

export async function GET() {
  const result = await loadMissionControl()
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.data)
}
