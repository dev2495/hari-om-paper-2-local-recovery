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
  { key: "PlantManager", label: "Plant Manager", group: "Production", landing: "/planning/tracker", landingLabel: "Production tracker", summary: "Floor supervision, stage entry and close, holds, reconciliation." },
  { key: "Planner", label: "Planner", group: "Production", landing: "/planning/board/winder", landingLabel: "Planning board", summary: "Release queue, machine and shift planning, MRP signals." },
  { key: "Operator", label: "Operator", group: "Production", landing: "/dashboard", landingLabel: "My work", summary: "QR scan, assigned job card and simple floor input." },
  { key: "Sales", label: "Sales", group: "Commercial", landing: "/sales-orders", landingLabel: "Sales orders", summary: "Customer POs, sales orders, releases and delivery tracking." },
  { key: "Dispatch", label: "Dispatch", group: "Commercial", landing: "/logistics/dispatch", landingLabel: "Dispatch desk", summary: "Finished-goods readiness, challans and customer handoff." },
  { key: "QC", label: "Quality Control", group: "Quality", landing: "/landing/qc", landingLabel: "Quality workspace", summary: "All QC: incoming, stage and final inspections, holds, QC rules." },
  { key: "InwardQC", label: "Inward QC", group: "Quality", landing: "/quality/incoming", landingLabel: "Incoming inspections", summary: "Incoming material QC only: inspect received reels and lots against the material standards." },
  { key: "Store", label: "Store", group: "Stores", landing: "/inventory", landingLabel: "Stock overview", summary: "All stores work: inward, issue, stock count, reservations and stock close." },
  { key: "GRN", label: "GRN / Goods Receipt", group: "Stores", landing: "/purchase/inward", landingLabel: "Goods inward", summary: "Goods receipt only: receive against POs, weigh reels/coils, print labels, GRN register." },
  { key: "RMIssue", label: "Raw Material Issue", group: "Stores", landing: "/inventory/reels/issue", landingLabel: "Reel & material issue", summary: "Raw material issue only: issue reels and materials to machines and job cards, take returns." },
]

export const ROLE_BY_KEY: Record<string, RoleDefinition> = Object.fromEntries(ROLE_DEFINITIONS.map((role) => [role.key, role]))

export function roleLabel(role: string) {
  return ROLE_BY_KEY[role]?.label || role
}

/** Screens shown in the matrix, grouped like the sidebar. Owner/Admin see everything. */
export const MATRIX_SCREENS: Array<{ area: string; screen: string; href: string; access: Record<string, AccessLevel> }> = [
  { area: "Commercial", screen: "Sales orders", href: "/sales-orders", access: { Sales: "work", Planner: "work", PlantManager: "view" } },
  { area: "Commercial", screen: "Dispatch & challans", href: "/logistics/dispatch", access: { Dispatch: "work", Sales: "view", Store: "view" } },
  { area: "Production", screen: "Planning board", href: "/planning/board", access: { Planner: "work", PlantManager: "work" } },
  { area: "Production", screen: "Job cards & stage entry", href: "/production/job-cards", access: { PlantManager: "work", Operator: "work", Planner: "view", QC: "view" } },
  { area: "Production", screen: "Tracker", href: "/planning/tracker", access: { PlantManager: "view", Planner: "view", Dispatch: "view", Operator: "view" } },
  { area: "Production", screen: "Reconciliation", href: "/production/reconciliation", access: { PlantManager: "work" } },
  { area: "Quality", screen: "Incoming (inward) inspections", href: "/quality/incoming", access: { QC: "work", InwardQC: "work", Store: "view", PlantManager: "view" } },
  { area: "Quality", screen: "Material standards (inward QC checks)", href: "/quality/material-standards", access: { QC: "work", InwardQC: "work" } },
  { area: "Quality", screen: "Production / stage inspections", href: "/quality/stage", access: { QC: "work", PlantManager: "view" } },
  { area: "Quality", screen: "Seasonal stage rules", href: "/quality/stage-rules", access: { QC: "work" } },
  { area: "Quality", screen: "Results & holds", href: "/quality/results", access: { QC: "work", PlantManager: "work", InwardQC: "view", Store: "view", Sales: "view", Dispatch: "view" } },
  { area: "Stores", screen: "Goods inward (GRN)", href: "/purchase/inward", access: { Store: "work", GRN: "work", PlantManager: "work" } },
  { area: "Stores", screen: "GRN register & labels", href: "/purchase/receipts", access: { Store: "work", GRN: "work", PlantManager: "work", InwardQC: "view" } },
  { area: "Stores", screen: "Supplier deliveries", href: "/purchase/supplier-deliveries", access: { Store: "work", Planner: "work", PlantManager: "work", GRN: "view" } },
  { area: "Stores", screen: "Reel issue to machines", href: "/inventory/reels/issue", access: { Store: "work", RMIssue: "work", PlantManager: "work" } },
  { area: "Stores", screen: "Material issue to job cards", href: "/inventory/production-issue", access: { Store: "work", RMIssue: "work", PlantManager: "work" } },
  { area: "Stores", screen: "Stock overview & genealogy", href: "/inventory", access: { Store: "work", Planner: "view", PlantManager: "view", GRN: "view", RMIssue: "view", Dispatch: "view" } },
  { area: "Stores", screen: "Stock count & stock close", href: "/inventory/lifecycle", access: { Store: "work", PlantManager: "view", Planner: "view" } },
  { area: "Purchasing", screen: "Purchase orders", href: "/purchase", access: { Store: "work", Planner: "work", PlantManager: "work" } },
  { area: "Design", screen: "Specifications", href: "/specifications", access: {} },
  { area: "Foundation", screen: "Masters (incl. inward QC tolerances)", href: "/masters/papers", access: {} },
  { area: "Foundation", screen: "Users, roles & system", href: "/system/users", access: {} },
]

export function accessFor(screen: (typeof MATRIX_SCREENS)[number], role: string): AccessLevel | null {
  if (ROLE_BY_KEY[role]?.privileged) return "work"
  return screen.access[role] || null
}
