import { ROLE_BY_KEY, canOpenScreen } from "./role-matrix"

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
  | "InProcessQC"
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
  InProcessQC: "In-process QC",
  GRN: "GRN / Goods Receipt",
  RMIssue: "Raw Material Issue",
  Operator: "Operator",
}

export const ROLE_PRIORITY: LandingRole[] = ["Owner", "Admin", "PlantManager", "QC", "Planner", "Store", "Dispatch", "Sales", "InwardQC", "InProcessQC", "GRN", "RMIssue", "Operator"]

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
  InProcessQC: "InProcessQC",
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
    { href: "/production/reconciliation", label: "Month-end close", detail: "Approve the month-end count, read the gaps, close the month." },
  ],
  Admin: [
    { href: "/system/users", label: "Role Matrix", detail: "Manage users, roles, and governance." },
    { href: "/production/reconciliation/limits", label: "Usage limits", detail: "Normal wastage %, allowed gap % and minimum gap per material type (not QC tolerances)." },
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
    { href: "/planning/overview", label: "Planning overview", detail: "Plan against the floor log: on time, early, late and missed slots." },
    { href: "/specifications/new", label: "Spec Sheet", detail: "Create recipe-backed specification sheets." },
  ],
  Store: [
    { href: "/inventory", label: "Inventory Actions", detail: "Run inward, issue, and reservations." },
    { href: "/inventory/genealogy", label: "Genealogy", detail: "Trace reel lineage, issues, and scan events." },
    { href: "/inventory/stock-control", label: "Stock counts & book", detail: "Count racks, raise corrections and read the stock book." },
    { href: "/purchase/inward", label: "PO-linked Inward", detail: "Receive approved PO lines in kg with one AT label per reel or coil." },
  ],
  Dispatch: [
    { href: "/logistics/dispatch", label: "Dispatch Desk", detail: "Move finished-goods lots into challans." },
    { href: "/inventory/reservations", label: "FG Reservations", detail: "Check stock reserved against open customer demand." },
    { href: "/production/job-cards", label: "Job cards", detail: "See cards moving toward dispatch readiness." },
    { href: "/reports/dispatch", label: "Dispatch Reports", detail: "Review shipped quantity and pending handoff." },
  ],
  Sales: [
    { href: "/sales-orders/new", label: "Create Sales Order", detail: "Capture PO demand and release needs." },
    { href: "/sales-orders", label: "Sales Orders", detail: "Approve, release, and track line items." },
    { href: "/sales-orders?due=week", label: "Due this week", detail: "Open orders with lines due in the next 7 days." },
    { href: "/reports/sales", label: "Sales Reports", detail: "Track OTIF and delayed commitments." },
  ],
  InwardQC: [
    { href: "/quality/incoming", label: "Incoming QC", detail: "Inspect received reels and lots; a reading outside its band holds the lot." },
    { href: "/quality/material-standards", label: "Material standards", detail: "The inward QC checks for each material type." },
    { href: "/purchase/receipts", label: "GRN register", detail: "See which receipts are waiting for QC." },
    { href: "/quality/results", label: "Holds & inspections", detail: "Held lots, their decision and return to supplier." },
  ],
  InProcessQC: [
    { href: "/quality", label: "QC desk", detail: "Batches waiting for stage QC and holds waiting for a decision." },
    { href: "/quality/stage", label: "In-process QC", detail: "Winding, oven and process readings on a job card." },
    { href: "/quality/results?tab=jobs", label: "Job-card holds", detail: "Failed batches waiting for the plant head." },
    { href: "/quality/stage-rules", label: "Process stage rules", detail: "The tolerances each stage is checked against." },
  ],
  GRN: [
    { href: "/purchase/inward", label: "Goods inward", detail: "Receive against an approved PO and weigh each reel or coil." },
    { href: "/purchase/receipts", label: "GRN register & labels", detail: "Saved receipts, pending invoices and label reprints." },
    { href: "/purchase/supplier-deliveries", label: "Expected arrivals", detail: "What vendors should deliver today and this week, with Make GRN." },
    { href: "/inventory", label: "Stock overview", detail: "Received stock by material and location." },
  ],
  RMIssue: [
    { href: "/inventory/reels/issue", label: "Reel issue", detail: "Scan and issue reels and coils to the floor by shift." },
    { href: "/inventory/production-issue", label: "Material issue", detail: "Issue adhesive, parchment and packing to the floor by shift." },
    { href: "/inventory/genealogy", label: "Genealogy", detail: "Trace where every issued reel went." },
    { href: "/inventory", label: "Stock overview", detail: "What is available to issue." },
  ],
  Operator: [
    { href: "/production/entry", label: "Log output", detail: "Scan or pick a job card and log the run of your stage." },
    { href: "/production/job-cards", label: "Job cards", detail: "Find a card and open its runs, QC and printable details." },
    { href: "/production/entry?mode=qc", label: "Log QC", detail: "Enter the QC readings of a run (at least 2 per check)." },
    { href: "/scan", label: "Scan a label", detail: "Point the phone camera at a job card or reel label to open it." },
  ],
}

/** Quick actions a role can really open (no shortcut that ends at "not open to your role"). */
export function quickActionsFor(role: LandingRole, roles: Array<string | null | undefined>): QuickAction[] {
  return (LANDING_QUICK_ACTIONS[role] || []).filter((action) => canOpenScreen(action.href, roles))
}

// Where a notification's button takes the user: "Schedule" is planning work even when the link is a job card.
const ACTION_SCREEN: Record<string, string> = {
  schedule: "/planning/board",
  reschedule: "/planning/board",
  dispatch: "/logistics/dispatch",
  inspect: "/quality/incoming",
  decide_lot: "/quality/incoming",
  decide_hold: "/quality/results",
  review_hold: "/quality/results",
}

/**
 * A notification as one role may use it: its link when the role can open that page (else the inbox),
 * and its action word only when the role can do that action. The server routes some events to every
 * floor role ("Reel / coil issued to the floor" links the issue desk), so the landing filters here.
 */
export function inboxTargetFor(item: { href?: string | null; action?: string | null }, roles: Array<string | null | undefined>) {
  const href = item.href && canOpenScreen(item.href, roles) ? item.href : "/inbox"
  const action = item.action && href !== "/inbox" && canOpenScreen(ACTION_SCREEN[item.action] || href, roles) ? item.action : null
  return { href, action }
}
