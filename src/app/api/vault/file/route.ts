import { NextResponse } from "next/server"
import { readVaultFile, writeVaultFile } from "@/lib/vault"
import { getConfig } from "@/lib/db"
import path from "path"

function isInsideVault(vaultPath: string, filePath: string): boolean {
  const resolved = path.resolve(filePath)
  return resolved.startsWith(path.resolve(vaultPath))
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const filePath = searchParams.get("path")
  if (!filePath) return NextResponse.json({ error: "Missing path" }, { status: 400 })

  const config = await getConfig()
  if (!isInsideVault(config.vaultPath, filePath)) {
    return NextResponse.json({ error: "Path outside vault" }, { status: 403 })
  }

  const content = await readVaultFile(filePath)
  return NextResponse.json({ content })
}

export async function PUT(req: Request) {
  const { path: filePath, content } = await req.json()
  if (!filePath || content == null) {
    return NextResponse.json({ error: "Missing path or content" }, { status: 400 })
  }

  const config = await getConfig()
  if (!isInsideVault(config.vaultPath, filePath)) {
    return NextResponse.json({ error: "Path outside vault" }, { status: 403 })
  }

  await writeVaultFile(filePath, content)
  return NextResponse.json({ ok: true })
}
