import { NextResponse } from "next/server"
import { getConfig, setConfig, getTools } from "@/lib/db"
import { ConfigValidationError, validateConfigUpdate } from "@/lib/configValidation"

export async function GET() {
  const [config, tools] = await Promise.all([getConfig(), getTools()])
  return NextResponse.json({ config, tools })
}

export async function PUT(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let updates
  try {
    updates = await validateConfigUpdate(body)
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    throw err
  }

  const config = await setConfig(updates)
  return NextResponse.json({ config })
}
