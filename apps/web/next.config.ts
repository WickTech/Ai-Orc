import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@wicktech/axion-agents"],
  serverExternalPackages: ["node-pty", "chokidar", "simple-git"],
}

export default nextConfig
