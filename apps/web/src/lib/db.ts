import { promises as fs } from "fs"
import path from "path"
import os from "os"
import type { AppConfig, Db, Tool } from "@/types"

const DB_DIR = path.join(os.homedir(), ".ai-orc")
const DB_PATH = path.join(DB_DIR, "db.json")

const DEFAULT_DB: Db = {
  config: { vaultPath: "", port: 3000 },
  tools: [
    { id: "claude", label: "Claude Code", command: "claude", builtin: true },
    { id: "gemini", label: "Gemini CLI", command: "gemini", builtin: true },
    { id: "codex", label: "Codex CLI", command: "codex", builtin: true },
  ],
}

async function ensureDb(): Promise<void> {
  await fs.mkdir(DB_DIR, { recursive: true })
  try {
    await fs.access(DB_PATH)
  } catch {
    await fs.writeFile(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2))
  }
}

async function readDb(): Promise<Db> {
  await ensureDb()
  const raw = await fs.readFile(DB_PATH, "utf-8")
  const parsed = JSON.parse(raw) as Partial<Db>
  return {
    config: { ...DEFAULT_DB.config, ...parsed.config },
    tools: parsed.tools ?? DEFAULT_DB.tools,
  }
}

async function writeDb(db: Db): Promise<void> {
  await ensureDb()
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2))
}

export async function getConfig(): Promise<AppConfig> {
  return (await readDb()).config
}

export async function setConfig(updates: Partial<AppConfig>): Promise<AppConfig> {
  const db = await readDb()
  // Only known keys: callers pass request bodies, so never spread them blindly.
  const known: Partial<AppConfig> = {}
  if (updates.vaultPath !== undefined) known.vaultPath = updates.vaultPath
  if (updates.port !== undefined) known.port = updates.port
  db.config = { ...db.config, ...known }
  await writeDb(db)
  return db.config
}

export async function getTools(): Promise<Tool[]> {
  return (await readDb()).tools
}

export async function addTool(tool: Tool): Promise<Tool[]> {
  const db = await readDb()
  const idx = db.tools.findIndex((t) => t.id === tool.id)
  if (idx >= 0 && db.tools[idx].builtin) throw new Error(`Cannot replace built-in tool "${tool.id}"`)
  if (idx >= 0) db.tools[idx] = tool
  else db.tools.push(tool)
  await writeDb(db)
  return db.tools
}

export async function removeTool(id: string): Promise<Tool[]> {
  const db = await readDb()
  db.tools = db.tools.filter((t) => t.id !== id || t.builtin)
  await writeDb(db)
  return db.tools
}
