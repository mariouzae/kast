import { execSync } from "child_process"

function getGitCommit() {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["pipe", "pipe", "ignore"] })
      .toString()
      .trim()
  } catch {
    return "unknown"
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    // Next.js forwards only the first 10 MB of a proxied request body by
    // default, so a multi-file upload through the /api rewrite below was cut
    // short and failed with "socket hang up" (HTTP 500). Match the server's
    // own 500 MB upload limit (maxUploadBytes in server/internal/api/router.go).
    proxyClientMaxBodySize: "500mb",
  },
  env: {
    NEXT_PUBLIC_GIT_COMMIT: process.env.GIT_COMMIT || getGitCommit(),
    NEXT_PUBLIC_VERSION:    process.env.npm_package_version || "0.1.0",
  },
  // Proxy all backend paths through the Next.js server so the browser only
  // ever needs to reach the dashboard port — no separate server URL required.
  async rewrites() {
    const api = (process.env.API_URL || "http://localhost:8080").replace(/\/$/, "")
    return [
      { source: "/api/:path*",    destination: `${api}/api/:path*` },
      { source: "/hls/:path*",    destination: `${api}/hls/:path*` },
      { source: "/source/:path*", destination: `${api}/source/:path*` },
      { source: "/whep/:path*",   destination: `${api}/whep/:path*` },
      { source: "/public/:path*", destination: `${api}/public/:path*` },
    ]
  },
}

export default nextConfig
