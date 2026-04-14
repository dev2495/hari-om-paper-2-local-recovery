export type LandingRole =
  | "Owner"
  | "Admin"
  | "PlantManager"
  | "Planner"
  | "Production"
  | "Store"
  | "Sales"
  | "QC"

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
  Production: "Production",
  Store: "Store",
  Sales: "Sales",
  QC: "QC",
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
    { href: "/reports/owner", label: "Owner Pack", detail: "Monitor cross-plant operations." },
    { href: "/master", label: "Master Data", detail: "Update canonical data dictionaries." },
    { href: "/planning", label: "Planning Board", detail: "Inspect route-level readiness." },
  ],
  PlantManager: [
    { href: "/planning/board?section=winder", label: "Winder Plan", detail: "Schedule machine and shift assignments." },
    { href: "/production/supervisor-entry", label: "Supervisor Entry", detail: "Review stage output logs." },
    { href: "/production/job-cards", label: "Job Cards", detail: "Track cards through the production spine." },
    { href: "/dispatch", label: "Dispatch Ready", detail: "Confirm finished jobs ready for handoff." },
  ],
  Planner: [
    { href: "/sales-orders", label: "Sales Queue", detail: "Review approvals and pending releases." },
    { href: "/planning", label: "Planning Workspace", detail: "Plan by stage, machine, and shift." },
    { href: "/planning/tracker", label: "Tracker", detail: "Monitor WIP and delays by stage." },
    { href: "/specifications/new", label: "Spec Sheet", detail: "Create recipe-backed specification sheets." },
  ],
  Production: [
    { href: "/production/job-cards", label: "Open Job Cards", detail: "Open card-wise execution details." },
    { href: "/production/supervisor-entry", label: "Supervisor Entry", detail: "Capture WINDER, OVEN, and PROCESS outputs." },
    { href: "/production/reconciliation", label: "Reconciliation", detail: "Resolve losses and closing metrics." },
    { href: "/inventory/reels/issue", label: "Reel Issues", detail: "Track and close reel issue records." },
  ],
  Store: [
    { href: "/inventory", label: "Inventory Actions", detail: "Run inward, issue, and reservations." },
    { href: "/inventory/valuation", label: "Valuation", detail: "Audit stock value and risk items." },
    { href: "/dispatch", label: "Dispatch", detail: "Move ready jobs into challan flow." },
    { href: "/inventory/reels/inward", label: "Reel Inward", detail: "Record reel-wise inward entries." },
  ],
  Sales: [
    { href: "/sales-orders/new", label: "Create Sales Order", detail: "Capture PO demand and release needs." },
    { href: "/sales-orders", label: "Sales Orders", detail: "Approve, release, and track line items." },
    { href: "/reports/sales", label: "Sales Reports", detail: "Track OTIF and delayed commitments." },
    { href: "/dispatch", label: "Dispatch Status", detail: "Check commercial handoff status." },
  ],
  QC: [
    { href: "/production/supervisor-entry", label: "QC Stage Entries", detail: "Verify inspection and hold events." },
    { href: "/reports/exceptions", label: "Exceptions", detail: "Inspect blocked jobs and QC holds." },
    { href: "/production/job-cards", label: "Job Card Checks", detail: "Review stage-wise quality notes." },
    { href: "/inventory", label: "Inventory Risk", detail: "Review held or constrained stock." },
  ],
}
