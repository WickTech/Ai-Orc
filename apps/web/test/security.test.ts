import { describe, expect, it } from "vitest"
import { allowedHosts, allowedOrigins } from "@/lib/allowedOrigins"
import { isAllowedUpgrade, SESSION_COOKIE, sessionValue, tokensEqual } from "@/lib/security"

const origins = allowedOrigins(3000, "127.0.0.1")
const hosts = allowedHosts(origins)

describe("allowedHosts", () => {
  it("derives host:port pairs from the allowed origins", () => {
    expect([...hosts].sort()).toEqual(["127.0.0.1:3000", "localhost:3000"])
  })
})

describe("tokensEqual", () => {
  it("is true only for identical non-empty strings", () => {
    expect(tokensEqual("abc", "abc")).toBe(true)
    expect(tokensEqual("abc", "abd")).toBe(false)
    expect(tokensEqual("abc", "abcd")).toBe(false)
    expect(tokensEqual("", "")).toBe(false)
    expect(tokensEqual(undefined, "abc")).toBe(false)
    expect(tokensEqual("abc", undefined)).toBe(false)
  })
})

describe("isAllowedUpgrade (WebSocket handshake)", () => {
  const ok = { url: "/ws", headers: { origin: "http://localhost:3000", host: "localhost:3000" } }

  it("accepts /ws from an allowed origin and host", () => {
    expect(isAllowedUpgrade(ok, origins, hosts)).toBe(true)
  })

  it("rejects other paths", () => {
    expect(isAllowedUpgrade({ ...ok, url: "/api/ws" }, origins, hosts)).toBe(false)
  })

  it("rejects a missing or foreign Origin", () => {
    expect(isAllowedUpgrade({ ...ok, headers: { host: "localhost:3000" } }, origins, hosts)).toBe(false)
    expect(isAllowedUpgrade({ ...ok, headers: { ...ok.headers, origin: "https://evil.example" } }, origins, hosts)).toBe(false)
  })

  it("rejects a foreign Host even with an allowed Origin (DNS rebinding)", () => {
    expect(isAllowedUpgrade({ ...ok, headers: { ...ok.headers, host: "evil.example:3000" } }, origins, hosts)).toBe(false)
    expect(isAllowedUpgrade({ ...ok, headers: { origin: ok.headers.origin } }, origins, hosts)).toBe(false)
  })
})

describe("isAllowedUpgrade with an API token", () => {
  const TOKEN = "s3cret-token-value"
  const base = { url: "/ws", headers: { origin: "http://localhost:3000", host: "localhost:3000" } }
  const cookie = `${SESSION_COOKIE}=${sessionValue(TOKEN)}`

  it("rejects forged Origin and Host headers without credentials", () => {
    expect(isAllowedUpgrade(base, origins, hosts, TOKEN)).toBe(false)
  })

  it("accepts the session cookie or a bearer token", () => {
    expect(isAllowedUpgrade({ ...base, headers: { ...base.headers, cookie } }, origins, hosts, TOKEN)).toBe(true)
    expect(isAllowedUpgrade({ ...base, headers: { ...base.headers, authorization: `Bearer ${TOKEN}` } }, origins, hosts, TOKEN)).toBe(true)
  })

  it("rejects wrong credentials and still enforces Origin and Host", () => {
    expect(isAllowedUpgrade({ ...base, headers: { ...base.headers, cookie: `${SESSION_COOKIE}=nope` } }, origins, hosts, TOKEN)).toBe(false)
    expect(isAllowedUpgrade({ ...base, headers: { ...base.headers, cookie, origin: "https://evil.example" } }, origins, hosts, TOKEN)).toBe(false)
  })

  it("is unchanged when no token is configured", () => {
    expect(isAllowedUpgrade(base, origins, hosts)).toBe(true)
  })
})
