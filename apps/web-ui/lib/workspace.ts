import { ROLE_BY_KEY } from "./role-matrix"

export type LandingRole =
  | "Owner"
  | "Admin"
  | "PlantManager"
  | "QC"
  | "Planner"
  | "Store"
  | "Dispatch"
  | "Sales"
  | "InwardQC"
  | "GRN"
  | "RMIssue"
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
  QC: "Quality Control",
  Planner: "Planner",
  Store: "Store",
  Dispatch: "Dispatch",
  Sales: "Sales",
  InwardQC: "Inward QC",
  GRN: "GRN / Goods Receipt",
  RMIssue: "Raw Material Issue",
  Operator: "Operator",
}

export const ROLE_PRIORITY: LandingRole[] = ["Owner", "Admin", "PlantManager", "QC", "Planner", "Store", "Dispatch", "Sales", "InwardQC", "GRN", "RMIssue", "Operator"]

// Legacy role aliases are normalized here only so old auth/session rows land on a canonical workspace.
// User-facing navigation policy should use the condensed role matrix above.
export const ROLE_TO_LANDING: Record<string, LandingRole> = {
  Owner: "Owner",
  Admin: "Admin",
  PlantManager: "PlantManager",
  SupervisorEntry: "PlantManager",
  Production: "PlantManager",
  QC: "QC",
  Planner: "Planner",
  Store: "Store",
  Dispatch: "Dispatch",
  DispatchMaker: "Dispatch",
  DispatchApprover: "Dispatch",
  Sales: "Sales",
  SOMaker: "Sales",
  SOApprover: "Sales",
  InwardQC: "InwardQC",
  GRN: "GRN",
  RMIssue: "RMIssue",
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

/** Each role lands on its own desk (see lib/role-matrix.ts for the full role definitions). */
export function landingPathForRole(role: string | null | undefined) {
  const landingRole = ROLE_TO_LANDING[String(role || "")] || resolveLandingRole(role ? [role] : [])
  return ROLE_BY_KEY[landingRole]?.landing || "/dashboard"
}

export const LANDING_QUICK_ACTIONS: Record<LandingRole, QuickAction[]> = {
  Owner: [
    { href: "/sales-orders?due=week", label: "Due this week", detail: "Open orders with lines due in the next 7 days." },
    { href: "/planning/board?section=winder", label: "Planning Board", detail: "Check route loading and bottlenecks." },
    { href: "/production/job-cards", label: "Job Cards", detail: "Validate active cards and stage completion." },
    { href: "/production/reconciliation", label: "Reconciliation", detail: "Close cost and material variances." },
  ],
  Admin: [
    { href: "/system/users", label: "Role Matrix", detail: "Manage users, roles, and governance." },
    { href: "/system/tolerances", label: "Stock variance limits", detail: "Per-plant kg variance allowed in reconciliation and consumption (not QC tolerances)." },
    { href: "/quality", label: "Quality Lifecycle", detail: "Review holds, inspections, and release decisions." },
    { href: "/reports/owner", label: "Owner Pack", detail: "Monitor cross-plant operations." },
  ],
  PlantManager: [
    { href: "/planning/board?section=winder", label: "Winder Plan", detail: "Schedule machine and shift assignments." },
    { href: "/quality", label: "Quality Desk", detail: "Log inspections and release active holds." },
    { href: "/production/job-cards", label: "Job Cards", detail: "Track cards through the production spine." },
    { href: "/logistics/dispatch", label: "Dispatch Ready", detail: "Confirm finished jobs ready for handoff." },
  ],
  QC: [
    { href: "/quality", label: "Quality Desk", detail: "Incoming, stage, and results/holds desks." },
    { href: "/quality/stage", label: "Stage QC", detail: "Enter winding, oven, and process readings against frozen ranges." },
    { href: "/reports/quality", label: "Quality Reports", detail: "Run permitted quality reports for this plant." },
    { href: "/production/job-cards", label: "Assigned Job Cards", detail: "Read authorized job and spec context." },
  ],
  Planner: [
    { href: "/sales-orders?due=week", label: "Due this week", detail: "Open orders with lines due in the next 7 days." },
    { href: "/planning/board?section=winder", label: "Planning Workspace", detail: "Plan by stage, machine, and shift." },
    { href: "/planning/tracker", label: "Tracker", detail: "Monitor WIP and delays by stage." },
    { href: "/specifications/new", label: "Spec Sheet", detail: "Create recipe-backed specification sheets." },
  ],
  Store: [
    { href: "/inventory", label: "Inventory Actions", detail: "Run inward, issue, and reservations." },
    { href: "/inventory/genealogy", label: "Genealogy", detail: "Trace reel lineage, issues, and scan events." },
    { href: "/inventory/valuation", label: "Valuation", detail: "Audit stock value and risk items." },
    { href: "/purchase/inward", label: "PO-linked Inward", detail: "Receive approved PO lines in kg with one AT label per reel or coil." },
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
    { href: "/sales-orders?due=week", label: "Due this week", detail: "Open orders with lines due in the next 7 days." },
    { href: "/reports/sales", label: "Sales Reports", detail: "Track OTIF and delayed commitments." },
  ],
  InwardQC: [
    { href: "/quality/incoming", label: "Incoming inspections", detail: "Inspect received reels and lots, then release or reject them." },
    { href: "/quality/material-standards", label: "Material standards", detail: "The inward QC checks and tolerances for each material." },
    { href: "/purchase/receipts", label: "GRN register", detail: "See which receipts are waiting for QC." },
    { href: "/quality/results", label: "Results & holds", detail: "Rejected lots and their return to supplier." },
  ],
  GRN: [
    { href: "/purchase/inward", label: "Goods inward", detail: "Receive against an approved PO and weigh each reel or coil." },
    { href: "/purchase/receipts", label: "GRN register & labels", detail: "Saved receipts, pending invoices and label reprints." },
    { href: "/purchase/supplier-deliveries", label: "Supplier deliveries", detail: "What is expected to arrive and when." },
    { href: "/inventory", label: "Stock overview", detail: "Received stock by material and location." },
  ],
  RMIssue: [
    { href: "/inventory/reels/issue", label: "Reel issue", detail: "Scan and issue reels to a winder and shift; close with returned weight." },
    { href: "/inventory/production-issue", label: "Material issue", detail: "Issue adhesive, parchment and packing to a job card." },
    { href: "/inventory/genealogy", label: "Genealogy", detail: "Trace where every issued reel went." },
    { href: "/inventory", label: "Stock overview", detail: "What is available to issue." },
  ],
  Operator: [
    { href: "/production/supervisor-entry", label: "QR / Stage Entry", detail: "Scan job card and enter stage output." },
    { href: "/production/job-cards", label: "Assigned Job Cards", detail: "Open printable job-card details." },
    { href: "/planning/tracker", label: "Stage Tracker", detail: "Check where scanned jobs are standing." },
    { href: "/dashboard", label: "My Work", detail: "Return to the operator landing." },
  ],
}
