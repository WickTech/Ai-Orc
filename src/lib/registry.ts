import path from "path"
import os from "os"
import { promises as fs } from "fs"
import simpleGit from "simple-git"
import type { InstallStep, RegistryAddResult } from "@/types"

const TOOLS_DIR = path.join(os.homedir(), ".ai-orc", "tools")

const SEGMENT = /^[A-Za-z0-9._-]+$/

// Only https://github.com/<owner>/<repo> is accepted: no other host or scheme
// (git would happily clone file:// or ssh:// URLs), no credentials or port,
// no extra path, and owner/repo limited to GitHub's own character set so they
// are safe to use as directory names.
export function parseGithubRepoUrl(input: string): { owner: string; repo: string; url: string } {
  const invalid = () => new Error("Invalid GitHub URL — expected https://github.com/owner/repo")
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw invalid()
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password) {
    throw invalid()
  }
  const parts = url.pathname.replace(/^\//, "").replace(/\/$/, "").split("/")
  if (parts.length !== 2) throw invalid()
  const owner = parts[0]
  const repo = parts[1].replace(/\.git$/, "")
  for (const segment of [owner, repo]) {
    if (!SEGMENT.test(segment) || segment === "." || segment === ".." || segment.startsWith("-")) throw invalid()
  }
  return { owner, repo, url: `https://github.com/${owner}/${repo}` }
}

export async function cloneAndAnalyze(githubUrl: string): Promise<RegistryAddResult> {
  const { owner, repo, url: repoUrl } = parseGithubRepoUrl(githubUrl)
  const clonePath = path.join(TOOLS_DIR, owner, repo)

  await fs.mkdir(path.join(TOOLS_DIR, owner), { recursive: true })

  try {
    await fs.access(clonePath)
    await simpleGit(clonePath).pull()
  } catch {
    await simpleGit().clone(repoUrl, clonePath, ["--depth", "1"])
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
    repoUrl,
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
