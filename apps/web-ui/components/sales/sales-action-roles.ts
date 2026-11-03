/**
 * Who may do what on a sales order: the same roles the sales service enforces (require_role in
 * sales_orders.py, CLOSURE_ROLES in order_closure.py). Owner and Admin always pass, as on the server.
 * A button a role can never use is hidden, not just disabled (review 3 Nov 2026).
 */
export type SalesAction =
  | "create" | "edit" | "submit" | "approve" | "hold" | "resume" | "close"
  | "release" | "customerPo" | "schedule" | "colours" | "plan"

export const SALES_ACTION_ROLES: Record<SalesAction, readonly string[]> = {
  create: ["Sales"], // POST /sales-orders
  edit: ["Sales"], // PUT /sales-orders/{id}
  submit: ["Sales"], // Send for approval is the same PUT
  approve: ["Sales", "Planner"],
  hold: ["Sales"],
  resume: ["Sales"],
  close: ["Sales", "PlantManager"], // cancel / short close
  release: ["Sales", "Planner"], // release-bulk and line release
  customerPo: ["Sales"],
  schedule: ["Sales", "Planner"], // call-offs and date shift
  colours: ["Sales", "Planner", "PlantManager"],
  plan: ["Planner", "PlantManager"], // the /planning pages (RoleGate)
}

type RoleUser = { role?: string | null; roles?: Array<string | null> | null } | null | undefined

export function salesUserRoles(user: RoleUser): Set<string> {
  return new Set([user?.role, ...(user?.roles || [])].map((role) => String(role || "").trim()).filter(Boolean))
}

export function canDoSalesAction(user: RoleUser, action: SalesAction): boolean {
  const roles = salesUserRoles(user)
  if (roles.has("Owner") || roles.has("Admin")) return true
  return SALES_ACTION_ROLES[action].some((role) => roles.has(role))
}

/** Every action at once, for a page: `const can = salesActionRoles(user)` then `can.hold`. */
export function salesActionRoles(user: RoleUser): Record<SalesAction, boolean> {
  return Object.fromEntries(
    (Object.keys(SALES_ACTION_ROLES) as SalesAction[]).map((action) => [action, canDoSalesAction(user, action)]),
  ) as Record<SalesAction, boolean>
}

/** The plant a write goes to: a real plant, never "All visible plants". */
export function concretePlant(value: unknown): string | undefined {
  const text = String(value ?? "").trim()
  return text && text.toUpperCase() !== "ALL" ? text : undefined
}
