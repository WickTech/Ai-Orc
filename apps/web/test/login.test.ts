import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => vi.unstubAllEnvs())

const TOKEN = "s3cret-token-value"
const post = (body: unknown) =>
  new Request("http://localhost:3000/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

async function load() {
  vi.resetModules()
  return import("@/app/api/login/route")
}

describe("POST /api/login", () => {
  it("is disabled without a configured token", async () => {
    const { POST } = await load()
    expect((await POST(post({ token: "x" }))).status).toBe(404)
  })

  it("sets an HttpOnly SameSite=Strict cookie holding a derived value, never the token", async () => {
    vi.stubEnv("AI_ORC_TOKEN", TOKEN)
    const { POST } = await load()
    const { sessionValue } = await import("@/lib/security")
    const res = await POST(post({ token: TOKEN }))
    expect(res.status).toBe(200)
    const cookie = res.headers.get("set-cookie") ?? ""
    expect(cookie).toContain(`axion_session=${sessionValue(TOKEN)}`)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=strict/i)
    expect(cookie).not.toContain(TOKEN)
  })

  it("rejects wrong, missing and non-string tokens without a cookie", async () => {
    vi.stubEnv("AI_ORC_TOKEN", TOKEN)
    const { POST } = await load()
    for (const body of [{ token: "wrong" }, {}, { token: 5 }, { token: "" }]) {
      const res = await POST(post(body))
      expect(res.status).toBe(401)
      expect(res.headers.get("set-cookie")).toBeNull()
    }
    expect((await POST(new Request("http://localhost:3000/api/login", { method: "POST", body: "{" }))).status).toBe(400)
  })

  it("throttles repeated failures, even for the right token afterwards", async () => {
    vi.stubEnv("AI_ORC_TOKEN", TOKEN)
    const { POST } = await load()
    for (let i = 0; i < 10; i++) expect((await POST(post({ token: "wrong" }))).status).toBe(401)
    expect((await POST(post({ token: "wrong" }))).status).toBe(429)
    expect((await POST(post({ token: TOKEN }))).status).toBe(429)
  })
})
