import path from "path"
import os from "os"
import { promises as fs } from "fs"
import simpleGit from "simple-git"
import type { InstallStep, RegistryAddResult } from "@/types"

const TOOLS_DIR = path.join(os.homedir(), ".ai-orc", "tools")

export async function cloneAndAnalyze(githubUrl: string): Promise<RegistryAddResult> {
  const url = new URL(githubUrl)
  const parts = url.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/")
  if (parts.length < 2) throw new Error("Invalid GitHub URL — expected https://github.com/owner/repo")
  const [owner, repo] = parts
  const clonePath = path.join(TOOLS_DIR, owner, repo)

  await fs.mkdir(path.join(TOOLS_DIR, owner), { recursive: true })

  try {
    await fs.access(clonePath)
    await simpleGit(clonePath).pull()
  } catch {
    await simpleGit().clone(githubUrl, clonePath, ["--depth", "1"])
  }

  let readmeContent = ""
  for (const name of ["README.md", "readme.md", "Readme.md", "README.txt"]) {
    try {
      readmeContent = await fs.readFile(path.join(clonePath, name), "utf-8")
      break
    } catch {}
  }

  return {
    name: repo,
    description: extractDescription(readmeContent),
    installSteps: extractInstallSteps(readmeContent),
    repoUrl: githubUrl,
    clonePath,
  }
}

function extractInstallSteps(readme: string): InstallStep[] {
  const steps: InstallStep[] = []
  const lines = readme.split("\n")
  let inSection = false
  const sectionPattern = /^#{1,3}\s+(install|setup|getting started|quick start|usage)/i
  const nextSectionPattern = /^#{1,3}\s+/

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (sectionPattern.test(line)) {
      inSection = true
      continue
    }
    if (inSection && nextSectionPattern.test(line)) {
      inSection = false
    }
    if (inSection && /^```/.test(line)) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i])
        i++
      }
      const cmd = codeLines.join("\n").trim()
      if (cmd && lang !== "json" && lang !== "yaml" && lang !== "html") {
        steps.push({ label: lang || "shell", command: cmd })
      }
    }
  }

  return steps.slice(0, 8)
}

function extractDescription(readme: string): string {
  for (const line of readme.split("\n")) {
    const t = line.trim()
    if (t && !t.startsWith("#") && !t.startsWith("!") && !t.startsWith("[") && t.length > 20) {
      return t.slice(0, 200)
    }
  }
  return ""
}
