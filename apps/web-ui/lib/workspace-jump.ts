import { MODULE_NAVIGATION } from "./module-navigation"

export type WorkspaceJumpItem = {
  name: string
  href: string
  description: string
  group: string
  keywords?: string[]
}

export const WORKSPACE_JUMP_ITEMS: WorkspaceJumpItem[] = [
  { name: "Inbox", href: "/inbox", description: "Notifications, handoffs, QC holds and your role work queue.", group: "Overview" },
  { name: "Expected arrivals", href: "/purchase/supplier-deliveries", description: "Overdue, today, this week and later vendor deliveries, each with Make GRN.", group: "Purchasing", keywords: ["supplier deliveries", "arrivals", "delivery", "grn"] },
  { name: "RM inward calendar", href: "/purchase/scheduler", description: "Forward RM demand against stock and arrivals; the Owner approves arrivals into draft POs.", group: "Purchasing", keywords: ["calendar", "schedule", "mrp", "shortage", "arrivals", "excel", "workbook"] },
  { name: "Goods inward", href: "/purchase/inward", description: "Measured receipt and distinct physical lot labels.", group: "Stores & inventory", keywords: ["grn", "receipt"] },
  { name: "GRN register", href: "/purchase/receipts", description: "Receipts, invoice status and saved labels.", group: "Stores & inventory" },
  { name: "Dashboard", href: "/dashboard", description: "Control room overview, alerts, and operating posture.", group: "Overview" },
  { name: "Guide", href: "/help", description: "Flow maps, field rules, and operator checklists.", group: "Overview" },
  { name: "Sales Orders", href: "/sales-orders", description: "Commercial demand, releases, and customer intake.", group: "Operations", keywords: ["so", "po", "customer"] },
  { name: "New sales order", href: "/sales-orders/new", description: "Create a customer PO or internal sales order.", group: "Operations" },
  { name: "Pending Orders", href: "/sales-orders?unreleased=1", description: "Sales register filtered to orders with unreleased or undelivered qty.", group: "Operations" },
  { name: "Job Cards", href: "/production/job-cards", description: "Release truth, execution packets, and printable cards.", group: "Operations" },
  { name: "Planner", href: "/planning/board", description: "Machine queues, shift scheduling, and stage balancing.", group: "Operations" },
  { name: "Job card manager", href: "/production/job-cards/manage", description: "Split a card, edit qty or colour, emergency insert, force close, cancel.", group: "Operations", keywords: ["split", "force close"] },
  { name: "Log output", href: "/production/entry", description: "Scan or pick a job card and log a run.", group: "Operations", keywords: ["entry", "scan", "qr"] },
  { name: "Log QC", href: "/production/entry?mode=qc", description: "QC readings of a run, at least 2 per check.", group: "Operations", keywords: ["qc", "readings"] },
  { name: "Quality", href: "/quality", description: "Inspection lifecycle, holds, release decisions, and audit evidence.", group: "Operations", keywords: ["qc"] },
  { name: "Incoming QC", href: "/quality/incoming", description: "Inspect receipt lots against the item quality profile.", group: "Operations" },
  { name: "Stage QC", href: "/quality/stage", description: "Winding, oven, and process measurements against frozen ranges.", group: "Operations" },
  { name: "QC results", href: "/quality/results", description: "Inspections, holds, and dispositions.", group: "Operations" },
  { name: "Month-end close", href: "/production/reconciliation", description: "Spec, issued and counted use per material; notes and the Owner's close.", group: "Operations", keywords: ["reconciliation", "close", "variance", "financial year"] },
  { name: "Usage limits", href: "/production/reconciliation/limits", description: "Normal wastage %, allowed gap % and minimum gap per material type.", group: "Operations", keywords: ["tolerance", "wastage", "variance limits", "gap"] },
  { name: "Stock counts & book", href: "/inventory/stock-control", description: "Spot and month-end counts, corrections and the stock book.", group: "Supply Chain", keywords: ["stock count", "certification", "lifecycle", "correction", "adjustment", "stock book"] },
  { name: "Locations", href: "/inventory/locations", description: "Racks and stores: stock on each, put-away, moves and QR labels.", group: "Supply Chain", keywords: ["rack", "bin", "put away", "move stock", "qr"] },
  { name: "Location labels", href: "/inventory/locations/labels", description: "Print QR labels for racks and stores.", group: "Supply Chain", keywords: ["rack label", "qr", "print"] },
  { name: "Inventory", href: "/inventory", description: "Raw material inward, reel issue, balances, and valuation.", group: "Supply Chain" },
  { name: "Purchase", href: "/purchase", description: "Supplier purchase orders, GRN receipts, and delivery schedules.", group: "Supply Chain", keywords: ["po", "grn", "vendor"] },
  { name: "Genealogy", href: "/inventory/genealogy", description: "Reel lineage, slit children, issue scans, and trace exceptions.", group: "Supply Chain" },
  { name: "Manual FG", href: "/inventory/fg-inward", description: "Rework yield, returns, and adjustments.", group: "Supply Chain" },
  { name: "Dispatch", href: "/logistics/dispatch", description: "Packing handoff, challans, and finished-goods release.", group: "Supply Chain" },
  { name: "Specifications", href: "/specifications", description: "Spec sheet workspace, recipe truth, and print-ready outputs.", group: "Design" },
  { name: "Intelligence", href: "/analytics", description: "Live KPIs and finished reports in one intelligence home.", group: "Intelligence", keywords: ["analytics", "reports", "kpis"] },
  { name: "Owner daily pack", href: "/reports/owner", description: "Dispatch, OTIF, backlog, variance, blocked jobs.", group: "Intelligence" },
  { name: "Operations command", href: "/reports/operations", description: "Stage throughput and machine utilization.", group: "Intelligence" },
  { name: "Quality report", href: "/reports/quality", description: "Variance bridge, hold Pareto, QC pass-rate.", group: "Intelligence" },
  { name: "Dispatch report", href: "/reports/dispatch", description: "Challan throughput and customer SLA.", group: "Intelligence" },
  { name: "Plant comparator", href: "/reports/plants", description: "Cross-plant throughput, yield, OTIF, and inventory.", group: "Intelligence" },
  { name: "Masters", href: "/masters", description: "Papers, mandrels, parchments, customers, and supporting masters.", group: "Foundation" },
  { name: "Papers", href: "/masters/papers", description: "GSM, BF, thickness, and paper definitions.", group: "Foundation" },
  { name: "Customers", href: "/masters/customers", description: "Customer code, GST, PAN, address, and contacts.", group: "Foundation" },
  { name: "System", href: "/system/users", description: "Users, plants, machine setup, and platform governance.", group: "Foundation" },
  { name: "Users", href: "/system/users", description: "Role, plant, and permissions management.", group: "Foundation" },
  { name: "Audit", href: "/system/audit", description: "Login, mutation, permission and report trail.", group: "Foundation" },
  { name: "QC landing", href: "/landing/qc", description: "Quality Control role home.", group: "Overview" },
  { name: "Owner landing", href: "/landing/owner", description: "Owner role home.", group: "Overview" },
  { name: "Admin landing", href: "/landing/admin", description: "Admin role home.", group: "Overview" },
]

export function searchWorkspaceJumps(query: string, limit = 8) {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const entries: WorkspaceJumpItem[] = [...WORKSPACE_JUMP_ITEMS]
  for (const child of Object.values(MODULE_NAVIGATION).flat()) if (!entries.some(item => item.href === child.href)) entries.push({ name: child.name, href: child.href, description: "Open " + child.name.toLowerCase(), group: "Workspace" })
  return entries.filter((item) => {
    const haystack = `${item.name} ${item.href} ${item.description} ${item.group} ${(item.keywords || []).join(" ")}`.toLowerCase()
    return haystack.includes(needle)
  }).slice(0, limit)
}
