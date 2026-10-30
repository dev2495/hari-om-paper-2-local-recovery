/** @type {import('next').NextConfig} */
const bffInternalUrl = process.env.BFF_INTERNAL_URL || process.env.NEXT_PUBLIC_BFF_URL || "http://127.0.0.1:14000"

const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
        source: "/production/eod-entry",
        destination: "/production/supervisor-entry",
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
      {
        source: "/reports",
        destination: "/analytics",
        permanent: true,
      },
      {
        source: "/analytics/plants",
        destination: "/reports/plants",
        permanent: true,
      },
      {
        source: "/analytics/dispatch",
        destination: "/reports/dispatch",
        permanent: true,
      },
      // Retired pages (client 2026-10-28). Redirected here, before any page or role gate renders, so every
      // role's old bookmark works; the query string is passed through. Each route also keeps a server
      // redirect page (lib/retired-routes.ts) as a fallback. Not permanent: browsers must not cache them.
      ...[
        ["/system/locations", "/inventory/locations"],
        ["/system/tolerances", "/production/reconciliation/limits"],
        ["/inventory/lifecycle", "/inventory/stock-control"],
        ["/inventory/counts", "/inventory/stock-control?tab=counts"],
        ["/production/reconciliation/actuals", "/production/reconciliation?tab=month"],
        ["/production/reconciliation/drift", "/production/reconciliation?tab=month"],
        ["/production/reconciliation/history", "/production/reconciliation?tab=past"],
        ["/analytics/mrp", "/purchase/scheduler?view=list"],
      ].map(([source, destination]) => ({ source, destination, permanent: false })),
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
