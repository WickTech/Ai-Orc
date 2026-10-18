import { describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { proxy } from "@/proxy"

const req = (method: string, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/config", { method, headers })

describe("proxy (CSRF guard on /api)", () => {
  it("blocks a cross-origin mutating request with 403", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = proxy(req(method, { origin: "https://evil.example" }))
      expect(res.status, method).toBe(403)
      expect(await res.json()).toEqual({ error: "Cross-origin request blocked" })
    }
  })

  it("blocks a text/plain 'simple request' that skips preflight", () => {
    const res = proxy(req("POST", { origin: "https://evil.example", "content-type": "text/plain" }))
    expect(res.status).toBe(403)
  })

  it("allows a same-origin mutating request", () => {
    expect(proxy(req("PUT", { origin: "http://localhost:3000" })).status).toBe(200)
    expect(proxy(req("PUT", { origin: "http://127.0.0.1:3000" })).status).toBe(200)
  })

  it("does not block safe methods, even cross-origin", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(proxy(req(method, { origin: "https://evil.example" })).status, method).toBe(200)
    }
  })

  it("allows mutating requests with no Origin header (curl, local tools)", () => {
    expect(proxy(req("POST")).status).toBe(200)
  })

  it("rejects a lookalike origin with the same prefix", () => {
    expect(proxy(req("POST", { origin: "http://localhost:3000.evil.example" })).status).toBe(403)
  })

  // Known gaps (see PR description) — kept as todos so they stay visible:
  it.todo("rejects requests whose Host header is not an allowed host (DNS rebinding)")
  it.todo("requires an auth token for mutating requests that carry no Origin header")
})
