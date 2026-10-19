import { afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { proxy } from "@/proxy"

const HOST = { host: "localhost:3000" }
const req = (method: string, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/config", { method, headers: { ...HOST, ...headers } })

afterEach(() => vi.unstubAllEnvs())

describe("proxy: CSRF guard on mutating requests", () => {
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
    expect(proxy(req("PUT", { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" })).status).toBe(200)
  })

  it("does not block safe methods on an allowed host, even cross-origin", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(proxy(req(method, { origin: "https://evil.example" })).status, method).toBe(200)
    }
  })

  it("rejects a lookalike origin with the same prefix", () => {
    expect(proxy(req("POST", { origin: "http://localhost:3000.evil.example" })).status).toBe(403)
  })
})

describe("proxy: Host header (DNS rebinding)", () => {
  it("rejects any request whose Host is not an allowed host, including GET", async () => {
    for (const method of ["GET", "POST"]) {
      const res = proxy(req(method, { host: "evil.example:3000", origin: "http://evil.example:3000" }))
      expect(res.status, method).toBe(403)
      expect(await res.json()).toEqual({ error: "Invalid host" })
    }
  })

  it("rejects a request with no Host header", () => {
    const r = new NextRequest("http://localhost:3000/api/config", { method: "GET" })
    expect(proxy(r).status).toBe(403)
  })

  it("rejects the right host on the wrong port", () => {
    expect(proxy(req("GET", { host: "localhost:4000" })).status).toBe(403)
  })

  it("allows loopback hosts", () => {
    expect(proxy(req("GET", { host: "localhost:3000" })).status).toBe(200)
    expect(proxy(req("GET", { host: "127.0.0.1:3000" })).status).toBe(200)
  })
})

describe("proxy: requests without an Origin header", () => {
  it("rejects a mutating request with no Origin and no token", async () => {
    const res = proxy(req("POST"))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/Origin|token/i)
  })

  it("rejects it even when AI_ORC_TOKEN is unset and a bearer token is sent", () => {
    expect(proxy(req("POST", { authorization: "Bearer anything" })).status).toBe(403)
  })

  it("accepts a correct bearer token when AI_ORC_TOKEN is set", () => {
    vi.stubEnv("AI_ORC_TOKEN", "s3cret-token-value")
    expect(proxy(req("POST", { authorization: "Bearer s3cret-token-value" })).status).toBe(200)
  })

  it("rejects a wrong or malformed token", () => {
    vi.stubEnv("AI_ORC_TOKEN", "s3cret-token-value")
    for (const authorization of ["Bearer wrong", "Bearer s3cret-token-valu", "s3cret-token-value", "Basic s3cret-token-value", ""]) {
      expect(proxy(req("POST", { authorization })).status, authorization).toBe(403)
    }
  })

  it("a token does not bypass the Host check", () => {
    vi.stubEnv("AI_ORC_TOKEN", "s3cret-token-value")
    expect(proxy(req("POST", { host: "evil.example:3000", authorization: "Bearer s3cret-token-value" })).status).toBe(403)
  })

  it("GET needs no token", () => {
    expect(proxy(req("GET")).status).toBe(200)
  })
})
