import { NextResponse } from "next/server"
import { cloneAndAnalyze } from "@/lib/registry"
import { addTool, getTools } from "@/lib/db"

export async function POST(req: Request) {
  const { url } = await req.json()
  if (!url || !url.startsWith("https://github.com/")) {
    return NextResponse.json({ error: "Please provide a valid https://github.com/ URL" }, { status: 400 })
  }

  let result
  try {
    result = await cloneAndAnalyze(url)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Clone failed" }, { status: 400 })
  }

  // A repo called "claude" or "codex" must not overwrite the built-in tool.
  let id = result.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  const tools = await getTools()
  if (tools.some((t) => t.id === id && t.builtin)) id = `${id}-registry`

  await addTool({
    id,
    label: result.name,
    command: result.name,
    repoUrl: result.repoUrl,
    clonePath: result.clonePath,
  })

  return NextResponse.json(result)
}
