import { promises as fs } from "fs"
import path from "path"
import chokidar, { type FSWatcher } from "chokidar"
import type { VaultFile, WsMessage } from "@/types"

let watcher: FSWatcher | null = null

export async function getVaultTree(vaultPath: string): Promise<VaultFile[]> {
  async function walk(dir: string): Promise<VaultFile[]> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const items: VaultFile[] = []
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const children = await walk(fullPath)
        items.push({ name: entry.name, path: fullPath, type: "dir", children })
      } else if (entry.name.endsWith(".md")) {
        items.push({ name: entry.name, path: fullPath, type: "file" })
      }
    }
    return items.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }
  return walk(vaultPath)
}

export async function readVaultFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf-8")
}

export async function writeVaultFile(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, "utf-8")
}

export function startVaultWatcher(
  vaultPath: string,
  broadcast: (msg: WsMessage) => void
): void {
  if (watcher) { watcher.close(); watcher = null }
  watcher = chokidar.watch(vaultPath, {
    ignored: /(^|[/\\])\../,
    ignoreInitial: true,
    persistent: true,
  })
  watcher
    .on("add", (p) => broadcast({ type: "vault:change", path: p, event: "add" }))
    .on("change", (p) => broadcast({ type: "vault:change", path: p, event: "change" }))
    .on("unlink", (p) => broadcast({ type: "vault:change", path: p, event: "unlink" }))
}

export function stopVaultWatcher(): void {
  watcher?.close()
  watcher = null
}
