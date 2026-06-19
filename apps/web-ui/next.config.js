/** @type {import('next').NextConfig} */
const bffInternalUrl = process.env.BFF_INTERNAL_URL || process.env.NEXT_PUBLIC_BFF_URL || "http://127.0.0.1:14000"

const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: "/master",
        destination: "/masters",
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
        source: "/planning",
        destination: "/planning/board",
        permanent: true,
      },
      {
        source: "/production/planner",
        destination: "/planning/board",
        permanent: true,
      },
      {
        source: "/production/planner/print",
        destination: "/planning/print",
        permanent: true,
      },
      {
        source: "/dispatch",
        destination: "/logistics/dispatch",
        permanent: true,
      },
      {
        source: "/dispatch/:jobCardId/print",
        destination: "/logistics/dispatch/:jobCardId/print",
        permanent: true,
      },
      {
        source: "/dispatch/:jobCardId",
        destination: "/logistics/dispatch",
        permanent: true,
      },
      {
        source: "/specs",
        destination: "/specifications",
        permanent: true,
      },
      {
        source: "/specs/:id/edit",
        destination: "/specifications/:id/edit",
        permanent: true,
      },
      {
        source: "/specs/:path*",
        destination: "/specifications/:path*",
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
