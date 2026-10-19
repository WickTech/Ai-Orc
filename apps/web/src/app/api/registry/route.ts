import { NextResponse } from "next/server"
import { getTools } from "@/lib/db"

export async function GET() {
  const tools = await getTools()
  return NextResponse.json(tools)
}
