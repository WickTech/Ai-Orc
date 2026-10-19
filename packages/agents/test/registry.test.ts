import { describe, expect, it } from "vitest"
import { getAdapter, listAdapters, validateAdapter } from "../src"
import type { AgentAdapter } from "../src"

const base: AgentAdapter = {
  id: "demo",
  label: "Demo",
  command: "demo",
  args: [],
  installHint: "n/a",
  capabilities: { headless: false, mcp: false },
}

describe("agent registry", () => {
  it("ships claude, gemini, codex and opencode in a stable order", () => {
    expect(listAdapters().map((a) => a.id)).toEqual(["claude", "gemini", "codex", "opencode"])
  })

  it("looks adapters up by id", () => {
    expect(getAdapter("opencode")?.command).toBe("opencode")
    expect(getAdapter("nope")).toBeUndefined()
    expect(getAdapter("toString")).toBeUndefined()
  })

  it("builds headless arguments for every adapter that claims headless support", () => {
    expect(getAdapter("claude")!.headlessArgs!("hi")).toEqual(["-p", "hi"])
    expect(getAdapter("codex")!.headlessArgs!("hi")).toEqual(["exec", "hi"])
    expect(getAdapter("opencode")!.headlessArgs!("hi")).toEqual(["run", "hi"])
    for (const a of listAdapters()) expect(typeof a.headlessArgs === "function").toBe(a.capabilities.headless)
  })

  it("keeps a prompt as a single argument even when it contains shell syntax", () => {
    const prompt = "$(rm -rf /); echo 'x' && ls"
    for (const a of listAdapters()) expect(a.headlessArgs!(prompt)).toContain(prompt)
  })

  describe("validateAdapter", () => {
    it("accepts a well-formed adapter", () => {
      expect(validateAdapter(base)).toBe(base)
    })

    it.each(["/bin/sh", "../x", "a b", "rm -rf", "x;y", "", "-flag", "a|b", "$(x)"])(
      "rejects command %j (must be a bare executable name)",
      (command) => {
        expect(() => validateAdapter({ ...base, command })).toThrow(/bare executable name/)
      },
    )

    it.each(["Bad", "has space", "", "-x", "a/b"])("rejects id %j", (id) => {
      expect(() => validateAdapter({ ...base, id })).toThrow(/Invalid agent id/)
    })

    it("requires the headless flag to match headlessArgs", () => {
      expect(() => validateAdapter({ ...base, capabilities: { headless: true, mcp: false } })).toThrow(/headless/)
      expect(() => validateAdapter({ ...base, headlessArgs: () => [] })).toThrow(/headless/)
    })
  })
})
