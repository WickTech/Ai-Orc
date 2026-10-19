import { describe, expect, it } from "vitest"
import { DoomLoopDetector } from "@/lib/doomLoop"

const lines = (n: number, text: string) => Array.from({ length: n }, () => text).join("\r\n") + "\r\n"

describe("DoomLoopDetector", () => {
  it("stays quiet for varied output", () => {
    const d = new DoomLoopDetector()
    for (let i = 0; i < 100; i++) expect(d.feed(`working on step number ${i}\n`)).toBeNull()
  })

  it("flags one line repeated many times", () => {
    const d = new DoomLoopDetector()
    expect(d.feed(lines(11, "Error: edit failed, retrying"))).toBeNull()
    expect(d.feed("Error: edit failed, retrying\n")).toMatch(/same line 12 times/)
  })

  it("flags a repeating cycle of lines", () => {
    const d = new DoomLoopDetector()
    let warning: string | null = null
    for (let i = 0; i < 5; i++) warning = d.feed("running tests please wait\ntests failed: 3 errors\nediting file again\n")
    expect(warning).toMatch(/same 3 lines 5 times/)
  })

  it("does not flag a pattern that is broken by new output", () => {
    const d = new DoomLoopDetector()
    for (let i = 0; i < 4; i++) expect(d.feed("running tests please wait\ntests failed: 3 errors\n")).toBeNull()
    expect(d.feed("something different happened here\n")).toBeNull()
    expect(d.feed("running tests please wait\ntests failed: 3 errors\n")).toBeNull()
  })

  it("ignores short lines, blanks, spinners and ANSI colour codes", () => {
    const d = new DoomLoopDetector()
    expect(d.feed(lines(50, "..."))).toBeNull()
    expect(d.feed(lines(50, "\x1b[2K\x1b[1G|"))).toBeNull()
    const colored = "\x1b[31mError: edit failed, retrying\x1b[0m\n"
    expect(d.feed(colored.repeat(12))).toMatch(/Possible loop/)
  })

  it("assembles lines split across chunks and warns once per loop", () => {
    const d = new DoomLoopDetector()
    const out: (string | null)[] = []
    for (let i = 0; i < 13; i++) out.push(d.feed("Error: edit fai"), d.feed("led, retrying\n"))
    expect(out.filter(Boolean)).toHaveLength(1)
  })

  it("bounds memory for output without newlines", () => {
    const d = new DoomLoopDetector()
    expect(d.feed("x".repeat(1_000_000))).toBeNull()
  })
})
