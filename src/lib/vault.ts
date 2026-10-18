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

// path.resolve is purely lexical — it never touches the filesystem — so a
// symlink under the vault pointing outside it passes a naive prefix check
// but is transparently followed by fs.readFile/writeFile. This resolves
// symlinks (via fs.realpath) before the containment check and returns the
// real path callers must actually read/write, so check-time and use-time
// can't diverge.
export class VaultPathError extends Error {}

export async function resolveInVault(vaultPath: string, filePath: string): Promise<string> {
  // Before a vault is ever configured, vaultPath is "". path.resolve("")
  // is process.cwd() — the app's own source tree — which would otherwise
  // become a valid "vault root" and grant read/write of the whole app.
  if (!vaultPath) throw new VaultPathError("No vault configured")

  const realVaultRoot = await fs.realpath(path.resolve(vaultPath))
  const requested = path.resolve(filePath)

  let real: string
  try {
    // Existing target (read, or overwriting an existing file) — resolve
    // symlinks at every path component, including the final one.
    real = await fs.realpath(requested)
  } catch {
    // New file being created — the target itself can't be realpath'd yet,
    // but its parent directory must exist and gets resolved instead, which
    // still catches a symlinked parent directory pointing outside the vault.
    const realParent = await fs.realpath(path.dirname(requested))
    real = path.join(realParent, path.basename(requested))
  }

  if (real !== realVaultRoot && !real.startsWith(realVaultRoot + path.sep)) {
    throw new VaultPathError("Path outside vault")
  }
  return real
}

// The vault API serves notes, not arbitrary files: only .md, and nothing under
// a dot-directory or dotfile (the tree view already hides those). `real` must
// be the resolved path from resolveInVault so symlinks can't dodge the check.
export async function isServableVaultFile(vaultPath: string, real: string): Promise<boolean> {
  if (!vaultPath) return false
  const root = await fs.realpath(path.resolve(vaultPath)).catch(() => null)
  if (!root) return false
  const rel = path.relative(root, real)
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return false
  if (rel.split(path.sep).some((segment) => segment.startsWith("."))) return false
  return real.toLowerCase().endsWith(".md")
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
