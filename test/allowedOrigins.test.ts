import { describe, expect, it, vi } from "vitest"

vi.mock("os", async (orig) => {
  const real = await orig<typeof import("os")>()
  return {
    ...real,
    default: real,
    networkInterfaces: () => ({
      eth0: [
        { family: "IPv4", internal: false, address: "192.168.1.50" },
        { family: "IPv6", internal: false, address: "fe80::1" },
      ],
      lo: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
    }),
  }
})

import { allowedOrigins } from "@/lib/allowedOrigins"

describe("allowedOrigins", () => {
  it("allows only loopback origins by default", () => {
    expect([...allowedOrigins(3000)].sort()).toEqual(["http://127.0.0.1:3000", "http://localhost:3000"])
  })

  it("stays loopback-only when HOST is 127.0.0.1 or localhost", () => {
    expect(allowedOrigins(3000, "127.0.0.1").size).toBe(2)
    expect(allowedOrigins(3000, "localhost").size).toBe(2)
  })

  it("adds this machine's LAN IPv4 addresses when HOST opts into LAN exposure", () => {
    const origins = allowedOrigins(4000, "0.0.0.0")
    expect(origins.has("http://192.168.1.50:4000")).toBe(true)
    expect(origins.has("http://localhost:4000")).toBe(true)
  })

  it("ignores IPv6 and internal interfaces", () => {
    const origins = allowedOrigins(3000, "0.0.0.0")
    expect([...origins].some((o) => o.includes("fe80"))).toBe(false)
    expect(origins.size).toBe(3)
  })

  it("is port-specific: another port's origin is not allowed", () => {
    expect(allowedOrigins(3000).has("http://localhost:3001")).toBe(false)
  })

  it("never allows an arbitrary website origin", () => {
    expect(allowedOrigins(3000, "0.0.0.0").has("https://evil.example")).toBe(false)
  })
})
