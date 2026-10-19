import { NextResponse } from "next/server"
import { findRepo } from "@/lib/repos"
import { createTask, deleteTask, listTasks, TaskError, updateTask } from "@/lib/tasks"

async function body(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await req.json()
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function fail(err: unknown) {
  if (err instanceof TaskError) return NextResponse.json({ error: err.message }, { status: err.code === "not_found" ? 404 : 400 })
  throw err
}

export async function GET() {
  return NextResponse.json({ tasks: await listTasks() })
}

export async function POST(req: Request) {
  const b = await body(req)
  if (!b) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  let repoId: string | undefined
  if (b.repoId !== undefined && b.repoId !== "") {
    if (!(await findRepo(b.repoId))) return NextResponse.json({ error: "Unknown repository" }, { status: 404 })
    repoId = b.repoId as string
  }
  try {
    return NextResponse.json({ task: await createTask({ title: b.title, repoId }) }, { status: 201 })
  } catch (err) {
    return fail(err)
  }
}

export async function PATCH(req: Request) {
  const b = await body(req)
  if (!b || typeof b.id !== "string") return NextResponse.json({ error: "id is required" }, { status: 400 })
  try {
    return NextResponse.json({ task: await updateTask(b.id, { title: b.title, status: b.status }) })
  } catch (err) {
    return fail(err)
  }
}

export async function DELETE(req: Request) {
  const b = await body(req)
  if (!b || typeof b.id !== "string") return NextResponse.json({ error: "id is required" }, { status: 400 })
  try {
    await deleteTask(b.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return fail(err)
  }
}
