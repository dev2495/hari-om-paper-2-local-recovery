/** @type {import('next').NextConfig} */
const bffInternalUrl = process.env.BFF_INTERNAL_URL || process.env.NEXT_PUBLIC_BFF_URL || "http://127.0.0.1:14000"

const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: "/master",
        destination: "/masters/papers",
        permanent: true,
      },
      {
        source: "/master/items",
        destination: "/inventory/items",
        permanent: true,
      },
      {
        source: "/master/:path*",
        destination: "/masters/:path*",
        permanent: true,
      },
      {
        source: "/specs/:id/edit",
        destination: "/specifications/:id/edit",
        permanent: true,
      },
    ]
  },
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
