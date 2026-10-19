import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: ["node-pty", "chokidar", "simple-git"],
}

export default nextConfig
