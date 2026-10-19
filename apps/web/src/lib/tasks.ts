import { randomUUID } from "crypto"
import { promises as fs } from "fs"
import { dataDir } from "@/lib/paths"
import path from "path"

export const TASK_STATUSES = ["todo", "doing", "done"] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export interface Task {
  id: string
  title: string
  status: TaskStatus
  /** Id of a configured repo this task belongs to. */
  repoId?: string
  createdAt: string
  updatedAt: string
}

export class TaskError extends Error {
  constructor(message: string, readonly code: "invalid" | "not_found" = "invalid") {
    super(message)
  }
}

const MAX_TASKS = 200
const MAX_TITLE = 200

// Resolved per call: the home directory is not known at import time in tests.
function tasksFile(): string {
  return path.join(dataDir(), "tasks.json")
}

// Read-modify-write cycles run one at a time so concurrent requests cannot lose updates.
let queue: Promise<unknown> = Promise.resolve()
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}

async function readAll(): Promise<Task[]> {
  let raw: string
  try {
    raw = await fs.readFile(tasksFile(), "utf-8")
  } catch {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (t): t is Task =>
        typeof t?.id === "string" && typeof t.title === "string" && TASK_STATUSES.includes(t.status) && typeof t.createdAt === "string",
    )
  } catch {
    return []
  }
}

async function writeAll(tasks: Task[]): Promise<void> {
  const file = tasksFile()
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(tasks, null, 2))
  await fs.rename(tmp, file)
}

function cleanTitle(value: unknown): string {
  if (typeof value !== "string") throw new TaskError("title must be a string")
  const title = value.replace(/\s+/g, " ").trim()
  if (!title) throw new TaskError("title is required")
  if (title.length > MAX_TITLE) throw new TaskError(`title can be at most ${MAX_TITLE} characters`)
  return title
}

function cleanStatus(value: unknown): TaskStatus {
  if (typeof value !== "string" || !(TASK_STATUSES as readonly string[]).includes(value)) {
    throw new TaskError(`status must be one of: ${TASK_STATUSES.join(", ")}`)
  }
  return value as TaskStatus
}

export function listTasks(): Promise<Task[]> {
  return readAll()
}

export async function createTask(input: { title: unknown; repoId?: string }): Promise<Task> {
  const title = cleanTitle(input.title)
  return exclusive(async () => {
    const tasks = await readAll()
    if (tasks.length >= MAX_TASKS) throw new TaskError(`At most ${MAX_TASKS} tasks: delete some first`)
    const now = new Date().toISOString()
    const task: Task = { id: randomUUID(), title, status: "todo", createdAt: now, updatedAt: now, ...(input.repoId ? { repoId: input.repoId } : {}) }
    await writeAll([...tasks, task])
    return task
  })
}

export async function updateTask(id: string, patch: { title?: unknown; status?: unknown }): Promise<Task> {
  const title = patch.title === undefined ? undefined : cleanTitle(patch.title)
  const status = patch.status === undefined ? undefined : cleanStatus(patch.status)
  if (title === undefined && status === undefined) throw new TaskError("Nothing to update")
  return exclusive(async () => {
    const tasks = await readAll()
    const task = tasks.find((t) => t.id === id)
    if (!task) throw new TaskError("Task not found", "not_found")
    if (title !== undefined) task.title = title
    if (status !== undefined) task.status = status
    task.updatedAt = new Date().toISOString()
    await writeAll(tasks)
    return task
  })
}

export async function deleteTask(id: string): Promise<void> {
  return exclusive(async () => {
    const tasks = await readAll()
    if (!tasks.some((t) => t.id === id)) throw new TaskError("Task not found", "not_found")
    await writeAll(tasks.filter((t) => t.id !== id))
  })
}
