import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { existsSync, mkdirSync, writeFileSync } from "fs"
import path from "path"
import { cleanupTempDirs, withTempHome } from "./helpers"

const clone = vi.fn()
const pull = vi.fn()

vi.mock("simple-git", () => ({
  default: () => ({ clone, pull }),
}))

const README = `# Cool Tool

![badge](https://img.shields.io/x.svg)

A command line tool that does something genuinely useful for people.

## Installation

\`\`\`bash
npm install -g cool-tool
\`\`\`

\`\`\`json
{ "ignored": true }
\`\`\`

## Usage

\`\`\`
cool-tool --help
\`\`\`

## License

\`\`\`bash
echo "not an install step"
\`\`\`
`

beforeEach(() => {
  clone.mockReset()
  pull.mockReset()
  clone.mockImplementation(async (_url: string, target: string) => {
    mkdirSync(target, { recursive: true })
    writeFileSync(path.join(target, "README.md"), README)
  })
})

afterEach(() => {
  cleanupTempDirs()
  vi.unstubAllEnvs()
})

const load = () => import("@/lib/registry")

describe("cloneAndAnalyze", () => {
  it("shallow-clones into ~/.ai-orc/tools/<owner>/<repo>", async () => {
    const { mod, home } = await withTempHome(load)
    const result = await mod.cloneAndAnalyze("https://github.com/acme/cool-tool")

    const expected = path.join(home, ".ai-orc", "tools", "acme", "cool-tool")
    expect(result.clonePath).toBe(expected)
    expect(result.name).toBe("cool-tool")
    expect(clone).toHaveBeenCalledWith("https://github.com/acme/cool-tool", expected, ["--depth", "1"])
  })

  it("strips a trailing .git from the repo name", async () => {
    const { mod } = await withTempHome(load)
    const result = await mod.cloneAndAnalyze("https://github.com/acme/cool-tool.git")
    expect(result.name).toBe("cool-tool")
  })

  it("pulls instead of cloning when the repo is already there", async () => {
    const { mod, home } = await withTempHome(load)
    mkdirSync(path.join(home, ".ai-orc", "tools", "acme", "cool-tool"), { recursive: true })
    await mod.cloneAndAnalyze("https://github.com/acme/cool-tool")
    expect(pull).toHaveBeenCalledTimes(1)
    expect(clone).not.toHaveBeenCalled()
  })

  it("extracts install steps from the install/usage sections only", async () => {
    const { mod } = await withTempHome(load)
    const { installSteps } = await mod.cloneAndAnalyze("https://github.com/acme/cool-tool")
    expect(installSteps).toEqual([
      { label: "bash", command: "npm install -g cool-tool" },
      { label: "shell", command: "cool-tool --help" },
    ])
  })

  it("uses the first plain prose line as the description", async () => {
    const { mod } = await withTempHome(load)
    const { description } = await mod.cloneAndAnalyze("https://github.com/acme/cool-tool")
    expect(description).toBe("A command line tool that does something genuinely useful for people.")
  })

  it("returns empty description and steps when the repo has no README", async () => {
    const { mod } = await withTempHome(load)
    clone.mockImplementation(async (_u: string, target: string) => mkdirSync(target, { recursive: true }))
    const result = await mod.cloneAndAnalyze("https://github.com/acme/empty")
    expect(result.description).toBe("")
    expect(result.installSteps).toEqual([])
  })

  it("caps install steps at 8", async () => {
    const { mod } = await withTempHome(load)
    const blocks = Array.from({ length: 12 }, (_, i) => `\`\`\`sh\nstep ${i}\n\`\`\``).join("\n")
    clone.mockImplementation(async (_u: string, target: string) => {
      mkdirSync(target, { recursive: true })
      writeFileSync(path.join(target, "README.md"), `## Install\n${blocks}\n`)
    })
    const { installSteps } = await mod.cloneAndAnalyze("https://github.com/acme/many")
    expect(installSteps).toHaveLength(8)
  })

  it("rejects input that is not a URL", async () => {
    const { mod } = await withTempHome(load)
    await expect(mod.cloneAndAnalyze("--upload-pack=touch /tmp/pwned")).rejects.toThrow()
    expect(clone).not.toHaveBeenCalled()
  })

  it("rejects a URL without owner/repo", async () => {
    const { mod } = await withTempHome(load)
    await expect(mod.cloneAndAnalyze("https://github.com/just-owner")).rejects.toThrow("Invalid GitHub URL")
    expect(clone).not.toHaveBeenCalled()
  })

  it("never clones outside the tools directory, even with ../ or encoded dot segments", async () => {
    const { mod, home } = await withTempHome(load)
    const toolsDir = path.join(home, ".ai-orc", "tools")
    for (const url of [
      "https://github.com/../x/y",
      "https://github.com/a/%2e%2e/%2e%2e/b/c",
      "https://github.com/a/b/../../../../etc",
    ]) {
      clone.mockClear()
      const result = await mod.cloneAndAnalyze(url).catch(() => null)
      if (result) expect(result.clonePath.startsWith(toolsDir + path.sep), url).toBe(true)
      for (const call of clone.mock.calls) expect((call[1] as string).startsWith(toolsDir + path.sep), url).toBe(true)
    }
    expect(existsSync(path.join(home, "etc"))).toBe(false)
  })

  // Known gap (see PR description): the HTTP route enforces https://github.com/,
  // but cloneAndAnalyze itself accepts any host and scheme.
  it.todo("cloneAndAnalyze rejects non-GitHub hosts and non-https schemes by itself")
})
