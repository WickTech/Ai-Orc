import { NextResponse } from "next/server"
import { removeTool } from "@/lib/db"

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const tools = await removeTool(id)
  return NextResponse.json(tools)
}
