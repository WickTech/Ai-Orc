import { NextResponse } from "next/server"
import { readVaultFile, writeVaultFile, resolveInVault, VaultPathError } from "@/lib/vault"
import { getConfig } from "@/lib/db"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const filePath = searchParams.get("path")
  if (!filePath) return NextResponse.json({ error: "Missing path" }, { status: 400 })

  const config = await getConfig()
  let real: string
  try {
    real = await resolveInVault(config.vaultPath, filePath)
  } catch (err) {
    if (err instanceof VaultPathError) {
      return NextResponse.json({ error: "Path outside vault" }, { status: 403 })
    }
    return NextResponse.json({ error: "File not found" }, { status: 404 })
  }

  // resolveInVault also accepts not-yet-existing paths (for writes), so a
  // missing file surfaces here rather than there.
  try {
    const content = await readVaultFile(real)
    return NextResponse.json({ content })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }
    throw err
  }
}

export async function PUT(req: Request) {
  const { path: filePath, content } = await req.json()
  if (!filePath || content == null) {
    return NextResponse.json({ error: "Missing path or content" }, { status: 400 })
  }

  const config = await getConfig()
  let real: string
  try {
    real = await resolveInVault(config.vaultPath, filePath)
  } catch (err) {
    if (err instanceof VaultPathError) {
      return NextResponse.json({ error: "Path outside vault" }, { status: 403 })
    }
    return NextResponse.json({ error: "Parent directory not found" }, { status: 404 })
  }

  await writeVaultFile(real, content)
  return NextResponse.json({ ok: true })
}
