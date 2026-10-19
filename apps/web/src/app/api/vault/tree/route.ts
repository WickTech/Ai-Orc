import { NextResponse } from "next/server"
import { getConfig } from "@/lib/db"
import { getVaultTree } from "@/lib/vault"

export async function GET() {
  const config = await getConfig()
  if (!config.vaultPath) return NextResponse.json([])
  const tree = await getVaultTree(config.vaultPath)
  return NextResponse.json(tree)
}
