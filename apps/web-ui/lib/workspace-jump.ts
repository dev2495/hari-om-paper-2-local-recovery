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
  { name: "Supplier deliveries", href: "/purchase/supplier-deliveries", description: "Confirmed arrivals and receipt allocations.", group: "Purchasing" },
  { name: "RM Schedule", href: "/purchase/scheduler", description: "Monthly procurement calendar and workbook import.", group: "Purchasing", keywords: ["calendar", "excel", "workbook"] },
  { name: "Goods inward", href: "/purchase/inward", description: "Measured receipt and distinct physical lot labels.", group: "Stores & inventory", keywords: ["grn", "receipt"] },
  { name: "GRN register", href: "/purchase/receipts", description: "Receipts, invoice status and saved labels.", group: "Stores & inventory" },
  { name: "Dashboard", href: "/dashboard", description: "Control room overview, alerts, and operating posture.", group: "Overview" },
  { name: "Guide", href: "/help", description: "Flow maps, field rules, and operator checklists.", group: "Overview" },
  { name: "Sales Orders", href: "/sales-orders", description: "Commercial demand, releases, and customer intake.", group: "Operations", keywords: ["so", "po", "customer"] },
  { name: "New sales order", href: "/sales-orders/new", description: "Create a customer PO or internal sales order.", group: "Operations" },
  { name: "Pending Orders", href: "/sales-orders/pending", description: "All in-scope pending demand with server totals and export.", group: "Operations" },
  { name: "Job Cards", href: "/production/job-cards", description: "Release truth, execution packets, and printable cards.", group: "Operations" },
  { name: "Planner", href: "/planning/board", description: "Machine queues, shift scheduling, and stage balancing.", group: "Operations" },
  { name: "Tracker", href: "/planning/tracker", description: "Live segment posture and release-to-dispatch tracking.", group: "Operations" },
  { name: "Quality", href: "/quality", description: "Inspection lifecycle, holds, release decisions, and audit evidence.", group: "Operations", keywords: ["qc"] },
  { name: "Incoming QC", href: "/quality/incoming", description: "Inspect receipt lots against the item quality profile.", group: "Operations" },
  { name: "Stage QC", href: "/quality/stage", description: "Winding, oven, and process measurements against frozen ranges.", group: "Operations" },
  { name: "QC results", href: "/quality/results", description: "Inspections, holds, and dispositions.", group: "Operations" },
  { name: "Reconciliation", href: "/production/reconciliation", description: "Material retally, close posture, and monthly actuals.", group: "Operations" },
  { name: "Stock Lifecycle", href: "/inventory/lifecycle", description: "Opening → daily → cert → carry-forward → reco → lock.", group: "Supply Chain" },
  { name: "Inventory", href: "/inventory", description: "Raw material inward, reel issue, balances, and valuation.", group: "Supply Chain" },
  { name: "Purchase", href: "/purchase", description: "Supplier purchase orders, GRN receipts, and delivery schedules.", group: "Supply Chain", keywords: ["po", "grn", "vendor"] },
  { name: "Genealogy", href: "/inventory/genealogy", description: "Reel lineage, slit children, issue scans, and trace exceptions.", group: "Supply Chain" },
  { name: "Manual FG", href: "/inventory/fg-inward", description: "Rework yield, returns, and adjustments.", group: "Supply Chain" },
  { name: "MRP", href: "/analytics/mrp", description: "Reorder-policy review and demand/BOM coverage.", group: "Supply Chain" },
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
  for (const child of Object.values(MODULE_NAVIGATION).flat()) if (!entries.some(item => item.href === child.href)) entries.push({ ...child, description: "Open " + child.name.toLowerCase(), group: "Workspace" })
  return entries.filter((item) => {
    const haystack = `${item.name} ${item.href} ${item.description} ${item.group} ${(item.keywords || []).join(" ")}`.toLowerCase()
    return haystack.includes(needle)
  }).slice(0, limit)
}
