/**
 * One place that says what each role is for, where it lands after sign-in, and which
 * screens it works in. Used by the Roles & access matrix, the user editor and the landing
 * redirect, so the three never disagree. The backend enforces the same scope per endpoint.
 */

export type AccessLevel = "work" | "view"

export type RoleDefinition = {
  key: string
  label: string
  /** One line for the user editor card. */
  summary: string
  /** Where the user lands after sign-in or when switching to this role. */
  landing: string
  landingLabel: string
  /** Department grouping used by the user editor presets. */
  group: "Management" | "Commercial" | "Production" | "Quality" | "Stores"
  privileged?: boolean
}

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  { key: "Owner", label: "Owner", group: "Management", privileged: true, landing: "/landing/owner", landingLabel: "Owner command centre", summary: "Everything, plus approvals, season switch, costing and sign-off." },
  { key: "Admin", label: "Admin", group: "Management", privileged: true, landing: "/landing/admin", landingLabel: "Admin workspace", summary: "Users, roles, plants, machines, masters and every module." },
  { key: "PlantManager", label: "Plant Manager", group: "Production", landing: "/production/job-cards", landingLabel: "Job cards", summary: "Floor supervision, stage entry and close, holds, reconciliation." },
  { key: "Planner", label: "Planner", group: "Production", landing: "/planning/board/winder", landingLabel: "Planning board", summary: "Release queue, machine and shift planning, and material arrivals on the RM inward calendar." },
  { key: "Operator", label: "Operator", group: "Production", landing: "/dashboard", landingLabel: "My work", summary: "QR scan, assigned job card and simple floor input." },
  { key: "Sales", label: "Sales", group: "Commercial", landing: "/sales-orders", landingLabel: "Sales orders", summary: "Customer POs, sales orders, releases and delivery tracking." },
  { key: "Dispatch", label: "Dispatch", group: "Commercial", landing: "/logistics/dispatch", landingLabel: "Dispatch desk", summary: "Finished-goods readiness, challans and customer handoff." },
  { key: "QC", label: "Quality Control", group: "Quality", landing: "/landing/qc", landingLabel: "QC desk", summary: "All QC: incoming, stage and final inspections, holds, QC rules." },
  { key: "InwardQC", label: "Inward QC", group: "Quality", landing: "/quality/incoming", landingLabel: "Incoming QC", summary: "Incoming material QC only: inspect received reels and lots against the material standards." },
  { key: "InProcessQC", label: "In-process QC", group: "Quality", landing: "/quality", landingLabel: "QC desk (stage QC)", summary: "Stage QC only: winding, oven and process readings on each batch (2+ per check); out-of-band readings are flagged, not held." },
  { key: "Store", label: "Store", group: "Stores", landing: "/inventory", landingLabel: "Stock overview", summary: "All stores work: inward, issue, stock count, reservations and stock close." },
  { key: "GRN", label: "GRN / Goods Receipt", group: "Stores", landing: "/purchase/inward", landingLabel: "Goods inward", summary: "Goods receipt only: receive against POs, weigh reels/coils, print labels, GRN register." },
  { key: "RMIssue", label: "Raw Material Issue", group: "Stores", landing: "/inventory/reels/issue", landingLabel: "Reel & material issue", summary: "Raw material issue only: issue reels, coils and materials to the floor by shift; take part in stock counts." },
]

export const ROLE_BY_KEY: Record<string, RoleDefinition> = Object.fromEntries(ROLE_DEFINITIONS.map((role) => [role.key, role]))

export function roleLabel(role: string) {
  return ROLE_BY_KEY[role]?.label || role
}

// Short plain names for sentences ("This page is for the Owner and Goods inward."): no codes.
const ROLE_PLAIN: Record<string, string> = { GRN: "Goods inward", RMIssue: "Material issue", QC: "Quality", Accounts: "Accounts", Purchase: "Purchase" }

export function rolePlainLabel(role: string) {
  return ROLE_PLAIN[role] || roleLabel(role).replace(/([a-z])([A-Z])/g, "$1 $2")
}

/** "the Owner, Admin and Plant Manager": unique roles in order, in plain words. */
export function rolesSentence(roles: string[]) {
  const names = Array.from(new Set(roles.filter(Boolean).map(rolePlainLabel)))
  if (!names.length) return ""
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
  return `the ${list}`
}

/** Screens shown in the matrix, grouped like the sidebar. Owner/Admin see everything. */
export const MATRIX_SCREENS: Array<{ area: string; screen: string; href: string; access: Record<string, AccessLevel> }> = [
  { area: "Commercial", screen: "Sales orders", href: "/sales-orders", access: { Sales: "work", Planner: "work", PlantManager: "view" } },
  { area: "Commercial", screen: "Dispatch & challans", href: "/logistics/dispatch", access: { Dispatch: "work", Sales: "view", Store: "view" } },
  { area: "Production", screen: "Planning board", href: "/planning/board", access: { Planner: "work", PlantManager: "work" } },
  { area: "Production", screen: "Job cards & stage entry", href: "/production/job-cards", access: { PlantManager: "work", Operator: "work", Planner: "view", QC: "view", InProcessQC: "view" } },
  { area: "Production", screen: "Job card manager (split, edit, force close)", href: "/production/job-cards/manage", access: { PlantManager: "work", Planner: "work" } },
  { area: "Production", screen: "Log output and QC (floor)", href: "/production/entry", access: { Operator: "work", PlantManager: "work", QC: "work", InProcessQC: "work" } },
  { area: "Production", screen: "Month-end close (notes; the Owner closes)", href: "/production/reconciliation", access: { PlantManager: "work" } },
  { area: "Production", screen: "Usage limits (Owner and Admin edit)", href: "/production/reconciliation/limits", access: { PlantManager: "view" } },
  { area: "Quality", screen: "Incoming (inward) inspections", href: "/quality/incoming", access: { QC: "work", InwardQC: "work", Store: "view", PlantManager: "view" } },
  { area: "Quality", screen: "Material standards (inward QC checks)", href: "/quality/material-standards", access: { QC: "work", InwardQC: "work" } },
  { area: "Quality", screen: "In-process (stage) QC", href: "/quality/stage", access: { QC: "work", InProcessQC: "work", PlantManager: "view" } },
  { area: "Quality", screen: "Process stage rules", href: "/quality/stage-rules", access: { QC: "work" } },
  { area: "Quality", screen: "Holds & inspections (plant head decides)", href: "/quality/results", access: { PlantManager: "work", QC: "view", InwardQC: "view", InProcessQC: "view", Store: "view", Sales: "view", Dispatch: "view" } },
  { area: "Quality", screen: "Customer complaints", href: "/quality/returns", access: { QC: "work", PlantManager: "work", Store: "work", Sales: "view", Dispatch: "view" } },
  { area: "Stores", screen: "Goods inward (GRN)", href: "/purchase/inward", access: { Store: "work", GRN: "work", PlantManager: "work" } },
  { area: "Stores", screen: "GRN register & labels", href: "/purchase/receipts", access: { Store: "work", GRN: "work", PlantManager: "work", InwardQC: "view", QC: "view" } },
  { area: "Stores", screen: "Expected arrivals", href: "/purchase/supplier-deliveries", access: { Store: "work", Planner: "work", PlantManager: "work", GRN: "view" } },
  { area: "Stores", screen: "Reel & coil issue to floor (+ slitting cards)", href: "/inventory/reels/issue", access: { Store: "work", RMIssue: "work", PlantManager: "work" } },
  { area: "Stores", screen: "Material issue to floor", href: "/inventory/production-issue", access: { Store: "work", RMIssue: "work", PlantManager: "work" } },
  { area: "Stores", screen: "Slitting report", href: "/reports/slitting", access: { Store: "view", RMIssue: "view", PlantManager: "view", Planner: "view" } },
  { area: "Stores", screen: "Stock overview & genealogy", href: "/inventory", access: { Store: "work", Planner: "view", PlantManager: "view", GRN: "view", RMIssue: "view", Dispatch: "view" } },
  // Anyone signed in may start a count and count; only the Owner approves counts and corrections (client 2026-10-28).
  { area: "Stores", screen: "Stock counts & book (count, raise corrections)", href: "/inventory/stock-control", access: { Store: "work", GRN: "work", RMIssue: "work", PlantManager: "work", Planner: "work", Operator: "work", QC: "work", InwardQC: "work", InProcessQC: "work", Sales: "work", Dispatch: "work" } },
  { area: "Stores", screen: "Locations, moves & rack labels", href: "/inventory/locations", access: { Store: "work", PlantManager: "work", GRN: "work", RMIssue: "work", Dispatch: "work", Planner: "view", Operator: "view", QC: "view", InwardQC: "view", InProcessQC: "view", Sales: "view" } },
  { area: "Purchasing", screen: "Purchase orders (send scheduled drafts)", href: "/purchase", access: { Store: "work", Planner: "work", PlantManager: "work" } },
  { area: "Purchasing", screen: "RM inward calendar (the Owner approves arrivals)", href: "/purchase/scheduler", access: { Planner: "work", Store: "work", PlantManager: "work", GRN: "view" } },
  { area: "Design", screen: "Specifications", href: "/specifications", access: {} },
  { area: "Foundation", screen: "Masters (incl. inward QC bands per line)", href: "/masters/papers", access: {} },
  { area: "Foundation", screen: "Users, roles & system", href: "/system/users", access: {} },
]

export function accessFor(screen: (typeof MATRIX_SCREENS)[number], role: string): AccessLevel | null {
  if (ROLE_BY_KEY[role]?.privileged) return "work"
  return screen.access[role] || null
}

/**
 * May any of these roles open this link? The most specific matrix screen that covers the path decides
 * ("/inventory/reels/issue" beats "/inventory"); a path no screen covers (scan, inbox, a job card's own
 * page under "/production/job-cards") follows its parent screen or is open. Used to drop links and
 * buttons a role would only meet as "This page is not open to your role" (operator landing, 30 Oct).
 */
export function canOpenScreen(href: string | null | undefined, roles: Array<string | null | undefined>): boolean {
  const path = String(href || "").split(/[?#]/)[0].replace(/\/+$/, "") || "/"
  if (!path.startsWith("/")) return true
  const covering = MATRIX_SCREENS.filter((screen) => path === screen.href || path.startsWith(`${screen.href}/`))
  if (!covering.length) return true
  const screen = covering.reduce((best, row) => (row.href.length > best.href.length ? row : best))
  return roles.some((role) => Boolean(role) && accessFor(screen, String(role)) !== null)
}

/** Roles the production service lets read /job-cards/aggregates (planning.py get_job_card_aggregates). */
export const JOB_CARD_AGGREGATE_ROLES = ["Owner", "Admin", "PlantManager", "Planner", "Store", "Sales", "Dispatch"] as const

export function canReadJobCardAggregates(roles: Array<string | null | undefined>) {
  return roles.some((role) => Boolean(role) && (JOB_CARD_AGGREGATE_ROLES as readonly string[]).includes(role as string))
}
