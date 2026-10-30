const fs = require("fs")
const path = require("path")

const webRoot = path.resolve(__dirname, "..")
const dashboardRoot = path.join(webRoot, "app", "(dashboard)")
const guideContentPath = path.join(webRoot, "lib", "guide-content.ts")

const routePatterns = [
  { pattern: /^\/settings\/production-season(?:\/.*)?$/, guideId: "specifications" },
  { pattern: /^\/(?:dashboard|control-tower|landing|help|inbox)(?:\/.*)?$/, guideId: "dashboard" },
  { pattern: /^\/scan(?:\/.*)?$/, guideId: "scan" },
  { pattern: /^\/sales-orders(?:\/.*)?$/, guideId: "sales" },
  { pattern: /^\/(?:specs|specifications)(?:\/.*)?$/, guideId: "specifications" },
  { pattern: /^\/purchase\/scheduler(?:\/.*)?$/, guideId: "purchase-scheduler" },
  { pattern: /^\/purchase\/supplier-deliveries(?:\/.*)?$/, guideId: "supplier-promises" },
  { pattern: /^\/purchase\/(?:inward|receipts)(?:\/.*)?$/, guideId: "purchase-inward" },
  { pattern: /^\/purchase\/(?:discrepancies|debit-notes)(?:\/.*)?$/, guideId: "purchase-commercial" },
  { pattern: /^\/purchase(?:\/.*)?$/, guideId: "purchase" },
  { pattern: /^\/analytics\/mrp(?:\/.*)?$/, guideId: "purchase-scheduler" },
  { pattern: /^\/analytics(?:-|\/|$)/, guideId: "reports" },
  { pattern: /^\/reports(?:\/.*)?$/, guideId: "reports" },
  { pattern: /^\/inventory-rm-inward(?:\/.*)?$/, guideId: "raw-inward" },
  { pattern: /^\/inventory-reels-issue(?:\/.*)?$/, guideId: "production-issue" },
  { pattern: /^\/inventory-reel-trace(?:\/.*)?$/, guideId: "genealogy" },
  { pattern: /^\/inventory-valuation(?:\/.*)?$/, guideId: "inventory" },
  { pattern: /^\/inventory\/(?:raw-material-inward|reels\/inward)(?:\/.*)?$/, guideId: "purchase-inward" },
  { pattern: /^\/inventory\/stock-alert(?:-policies|s)(?:\/.*)?$/, guideId: "stock-alerts" },
  { pattern: /^\/inventory\/rm-costing(?:\/.*)?$/, guideId: "rm-costing" },
  { pattern: /^\/inventory\/(?:reels\/issue|production-issue)(?:\/.*)?$/, guideId: "production-issue" },
  { pattern: /^\/inventory\/(?:lifecycle|ledger|stock-control|counts)(?:\/.*)?$/, guideId: "stock-counts" },
  { pattern: /^\/inventory\/locations(?:\/.*)?$/, guideId: "locations" },
  { pattern: /^\/inventory\/genealogy(?:\/.*)?$/, guideId: "genealogy" },
  { pattern: /^\/inventory\/fg-inward(?:\/.*)?$/, guideId: "manual-fg" },
  { pattern: /^\/inventory(?:\/.*)?$/, guideId: "inventory" },
  { pattern: /^\/(?:planning|planning\/board|production\/planner)(?:\/.*)?$/, guideId: "planning" },
  { pattern: /^\/(?:job-cards|production\/job-cards|production\/entry|production\/eod-entry|production\/supervisor-entry)(?:\/.*)?$/, guideId: "job-cards" },
  { pattern: /^\/operations(?:\/.*)?$/, guideId: "job-cards" },
  { pattern: /^\/production\/reconciliation\/limits(?:\/.*)?$/, guideId: "usage-limits" },
  { pattern: /^\/production\/reconciliation(?:\/.*)?$/, guideId: "month-end-close" },
  { pattern: /^\/quality(?:\/.*)?$/, guideId: "quality" },
  { pattern: /^\/(?:dispatch|logistics\/dispatch)(?:\/.*)?$/, guideId: "dispatch" },
  { pattern: /^\/masters?(?:\/.*)?$/, guideId: "masters" },
  { pattern: /^\/system(?:\/.*)?$/, guideId: "system" },
]

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, files)
    } else if (entry.isFile() && entry.name === "page.tsx") {
      files.push(fullPath)
    }
  }
  return files
}

function routeFromPage(filePath) {
  const relDir = path.relative(dashboardRoot, path.dirname(filePath))
  if (!relDir || relDir === ".") return "/"
  return `/${relDir.split(path.sep).join("/")}`
}

function guideIdForRoute(route) {
  const match = routePatterns.find((entry) => entry.pattern.test(route))
  return match?.guideId || null
}

const guideContent = fs.readFileSync(guideContentPath, "utf8")
const guideIds = new Set(Array.from(guideContent.matchAll(/id:\s*"([^"]+)"/g)).map((match) => match[1]))
const missingGuideIds = Array.from(new Set(routePatterns.map((entry) => entry.guideId))).filter((guideId) => !guideIds.has(guideId))

if (missingGuideIds.length) {
  console.error(`Missing guide content for ids: ${missingGuideIds.join(", ")}`)
  process.exit(1)
}

// Routes of the Stock / Month-end / RM calendar build (client 2026-10-28) must keep their own guide.
const requiredGuides = {
  "/inventory/stock-control": "stock-counts",
  "/inventory/counts/[id]": "stock-counts",
  "/inventory/counts/[id]/rack/[locationId]": "stock-counts",
  "/inventory/locations": "locations",
  "/inventory/locations/[id]": "locations",
  "/inventory/locations/labels": "locations",
  "/production/reconciliation": "month-end-close",
  "/production/reconciliation/limits": "usage-limits",
  "/purchase/scheduler": "purchase-scheduler",
  "/purchase/supplier-deliveries": "supplier-promises",
}
const wrongGuides = Object.entries(requiredGuides).filter(([route, guideId]) => guideIdForRoute(route) !== guideId || !guideIds.has(guideId))
if (wrongGuides.length) {
  console.error("Routes without their own guide:")
  for (const [route, guideId] of wrongGuides) console.error(`- ${route} should use ${guideId}`)
  process.exit(1)
}

const routes = walk(dashboardRoot)
  .map(routeFromPage)
  .filter((route) => route !== "/[...legacy]")
  .sort()

const uncovered = routes.filter((route) => !guideIdForRoute(route))

if (uncovered.length) {
  console.error("Dashboard routes without contextual guide coverage:")
  for (const route of uncovered) {
    console.error(`- ${route}`)
  }
  process.exit(1)
}

console.log(`Help coverage OK: ${routes.length} dashboard routes map to ${guideIds.size} guides.`)
