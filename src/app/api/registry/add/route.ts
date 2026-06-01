import { NextResponse } from "next/server"
import { cloneAndAnalyze } from "@/lib/registry"
import { addTool } from "@/lib/db"

export async function POST(req: Request) {
  const { url } = await req.json()
  if (!url || !url.startsWith("https://github.com/")) {
    return NextResponse.json({ error: "Please provide a valid https://github.com/ URL" }, { status: 400 })
  }

  const result = await cloneAndAnalyze(url)

  await addTool({
    id: result.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    label: result.name,
    command: result.name,
    repoUrl: result.repoUrl,
    clonePath: result.clonePath,
  })

  return NextResponse.json(result)
}
