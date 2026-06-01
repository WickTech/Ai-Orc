import { NextResponse } from "next/server"
import { getConfig, setConfig, getTools } from "@/lib/db"

export async function GET() {
  const [config, tools] = await Promise.all([getConfig(), getTools()])
  return NextResponse.json({ config, tools })
}

export async function PUT(req: Request) {
  const body = await req.json()
  const config = await setConfig(body)
  return NextResponse.json({ config })
}
