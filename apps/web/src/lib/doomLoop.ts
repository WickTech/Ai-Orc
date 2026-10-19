// Spots an agent stuck repeating itself by looking at its terminal output.
// Advisory only: the person decides whether to stop the session.

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g
const MIN_LINE = 8 // spinners, prompts and blank-ish lines carry no signal
const MAX_LINES = 200
const MAX_PENDING = 4096
const MAX_CYCLE = 6
// A single line must repeat more often than a multi-line cycle to count.
const SINGLE_REPEATS = 12
const CYCLE_REPEATS = 5

export class DoomLoopDetector {
  private lines: string[] = []
  private pending = ""

  /** Feeds terminal output. Returns a warning when a loop is detected, else null. */
  feed(data: string): string | null {
    this.pending += data.replace(ANSI_RE, "")
    const parts = this.pending.split(/\r\n|\n|\r/)
    this.pending = (parts.pop() ?? "").slice(-MAX_PENDING)

    let warning: string | null = null
    for (const raw of parts) {
      const line = raw.trim()
      if (line.length < MIN_LINE) continue
      this.lines.push(line)
      if (this.lines.length > MAX_LINES) this.lines.shift()
      warning ??= this.check()
    }
    if (warning) this.lines = [] // report once, then start counting afresh
    return warning
  }

  private check(): string | null {
    for (let k = 1; k <= MAX_CYCLE; k++) {
      const reps = k === 1 ? SINGLE_REPEATS : CYCLE_REPEATS
      const need = k * reps
      if (this.lines.length < need) continue
      const tail = this.lines.slice(-need)
      // A run of one identical line is the k=1 case, not a longer cycle.
      if (k > 1 && new Set(tail.slice(0, k)).size === 1) continue
      if (tail.every((line, i) => line === tail[i % k])) {
        const what = k === 1 ? `the same line ${reps} times in a row` : `the same ${k} lines ${reps} times in a row`
        return `Possible loop: the agent printed ${what}. Check the session and stop it if it is stuck.`
      }
    }
    return null
  }
}
