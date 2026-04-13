/** @type {import('next').NextConfig} */
const bffInternalUrl = process.env.BFF_INTERNAL_URL || "http://localhost:24000"

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${bffInternalUrl}/api/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
