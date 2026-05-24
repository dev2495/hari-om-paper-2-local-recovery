export type LandingRole =
  | "Owner"
  | "Admin"
  | "PlantManager"
  | "Planner"
  | "Store"
  | "Dispatch"
  | "Sales"
  | "Operator"

type QuickAction = {
  href: string
  label: string
  detail: string
}

export const LANDING_LABELS: Record<LandingRole, string> = {
  Owner: "Owner",
  Admin: "Admin",
  PlantManager: "Plant Manager",
  Planner: "Planner",
  Store: "Store",
  Dispatch: "Dispatch",
  Sales: "Sales",
  Operator: "Operator",
}

export const ROLE_PRIORITY: LandingRole[] = ["Owner", "Admin", "PlantManager", "Planner", "Store", "Dispatch", "Sales", "Operator"]

// Legacy role aliases are normalized here only so old auth/session rows land on a canonical workspace.
// User-facing navigation policy should use the condensed role matrix above.
export const ROLE_TO_LANDING: Record<string, LandingRole> = {
  Owner: "Owner",
  Admin: "Admin",
  PlantManager: "PlantManager",
  SupervisorEntry: "PlantManager",
  Production: "PlantManager",
  QC: "PlantManager",
  Planner: "Planner",
  Store: "Store",
  Dispatch: "Dispatch",
  DispatchMaker: "Dispatch",
  DispatchApprover: "Dispatch",
  Sales: "Sales",
  SOMaker: "Sales",
  SOApprover: "Sales",
  Operator: "Operator",
}

export function resolveLandingRole(roles: string[] = []): LandingRole {
  const mapped = new Set(roles.map((role) => ROLE_TO_LANDING[role]).filter(Boolean))
  return ROLE_PRIORITY.find((role) => mapped.has(role)) || "Operator"
}

export function rolesForSwitcher(roles: string[] = []) {
  const unique = Array.from(new Set(roles.map((role) => ROLE_TO_LANDING[role] || role).filter(Boolean)))
  return ROLE_PRIORITY.filter((role) => unique.includes(role))
}

export function landingPathForRole(role: string | null | undefined) {
  const landingRole = ROLE_TO_LANDING[String(role || "")] || resolveLandingRole(role ? [role] : [])
  if (landingRole === "Owner") return "/landing/owner"
  if (landingRole === "Admin") return "/landing/admin"
  if (landingRole === "Planner") return "/planning/board/winder"
  if (landingRole === "PlantManager") return "/planning/tracker"
  if (landingRole === "Sales") return "/sales-orders"
  if (landingRole === "Store") return "/inventory"
  if (landingRole === "Dispatch") return "/logistics/dispatch"
  return "/dashboard"
}

export const LANDING_QUICK_ACTIONS: Record<LandingRole, QuickAction[]> = {
  Owner: [
    { href: "/reports/owner", label: "Owner Pack", detail: "Review KPI stack, OTIF, and exceptions." },
    { href: "/planning", label: "Planning Board", detail: "Check route loading and bottlenecks." },
    { href: "/production/job-cards", label: "Job Cards", detail: "Validate active cards and stage completion." },
    { href: "/production/reconciliation", label: "Reconciliation", detail: "Close cost and material variances." },
  ],
  Admin: [
    { href: "/system/users", label: "Role Matrix", detail: "Manage users, roles, and governance." },
    { href: "/quality", label: "Quality Lifecycle", detail: "Review holds, inspections, and release decisions." },
    { href: "/reports/owner", label: "Owner Pack", detail: "Monitor cross-plant operations." },
    { href: "/planning", label: "Planning Board", detail: "Inspect route-level readiness." },
  ],
  PlantManager: [
    { href: "/planning/board?section=winder", label: "Winder Plan", detail: "Schedule machine and shift assignments." },
    { href: "/quality", label: "Quality Desk", detail: "Log inspections and release active holds." },
    { href: "/production/job-cards", label: "Job Cards", detail: "Track cards through the production spine." },
    { href: "/dispatch", label: "Dispatch Ready", detail: "Confirm finished jobs ready for handoff." },
  ],
  Planner: [
    { href: "/sales-orders", label: "Sales Queue", detail: "Review approvals and pending releases." },
    { href: "/planning", label: "Planning Workspace", detail: "Plan by stage, machine, and shift." },
    { href: "/planning/tracker", label: "Tracker", detail: "Monitor WIP and delays by stage." },
    { href: "/specifications/new", label: "Spec Sheet", detail: "Create recipe-backed specification sheets." },
  ],
  Store: [
    { href: "/inventory", label: "Inventory Actions", detail: "Run inward, issue, and reservations." },
    { href: "/inventory/genealogy", label: "Genealogy", detail: "Trace reel lineage, issues, and scan events." },
    { href: "/inventory/valuation", label: "Valuation", detail: "Audit stock value and risk items." },
    { href: "/inventory/reels/inward", label: "Reel Inward", detail: "Record reel-wise inward entries." },
  ],
  Dispatch: [
    { href: "/logistics/dispatch", label: "Dispatch Desk", detail: "Move finished-goods lots into challans." },
    { href: "/inventory/reservations", label: "FG Reservations", detail: "Check stock reserved against open customer demand." },
    { href: "/planning/tracker", label: "Ready Tracker", detail: "See jobs moving toward dispatch readiness." },
    { href: "/reports/dispatch", label: "Dispatch Reports", detail: "Review shipped quantity and pending handoff." },
  ],
  Sales: [
    { href: "/sales-orders/new", label: "Create Sales Order", detail: "Capture PO demand and release needs." },
    { href: "/sales-orders", label: "Sales Orders", detail: "Approve, release, and track line items." },
    { href: "/reports/sales", label: "Sales Reports", detail: "Track OTIF and delayed commitments." },
    { href: "/dispatch", label: "Dispatch Status", detail: "Check commercial handoff status." },
  ],
  Operator: [
    { href: "/production/supervisor-entry", label: "QR / Stage Entry", detail: "Scan job card and enter stage output." },
    { href: "/production/job-cards", label: "Assigned Job Cards", detail: "Open printable job-card details." },
    { href: "/planning/tracker", label: "Stage Tracker", detail: "Check where scanned jobs are standing." },
    { href: "/dashboard", label: "My Work", detail: "Return to the operator landing." },
  ],
}
