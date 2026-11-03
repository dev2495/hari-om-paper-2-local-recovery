// Operator scan scope (owner, 2 Nov 2026): an Operator-only login whose employee row in Masters › Employees
// (matched by the login email) is in a stage's department sees only that stage when a card is scanned or
// opened on the floor. Everyone else keeps the full entry form. This is a screen flow only: the server
// rules (who may log, which operators a stage lists) are unchanged.

/** The department in Masters › Employees that runs each floor stage (owner decision 7, 1 Nov 2026). */
export const STAGE_DEPARTMENT: Record<string, string> = { WINDER: "WINDER", OVEN: "OVEN", PROCESS: "PROCESS", PACKING: "PACKING" }

const LABEL: Record<string, string> = { SLITTING: "Slitting", WINDER: "Winding", OVEN: "Oven", PROCESS: "Process", PACKING: "Packing", QC: "Final QC", DISPATCH: "Dispatch" }
const label = (stage?: string | null) => (stage ? LABEL[stage] || stage.charAt(0) + stage.slice(1).toLowerCase() : "")
const fmt = (value: any) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })
const FLOOR_STAGES = new Set(["WINDER", "OVEN", "PROCESS", "PACKING", "QC"])

/** True only for a login whose every role is Operator (a supervisor, QC, planner… with Operator keeps the full form). */
export function isOperatorOnly(roles: Array<string | null | undefined>): boolean {
  const list = roles.map((r) => String(r || "").trim()).filter(Boolean)
  return list.length > 0 && list.every((r) => r.toLowerCase() === "operator")
}

/** The floor stage an employee's department runs, or null (QC, Store, General… run no floor stage). */
export function stageForDepartment(department: any): string | null {
  const dept = String(department || "").trim().toUpperCase()
  return Object.keys(STAGE_DEPARTMENT).find((stage) => STAGE_DEPARTMENT[stage] === dept) || null
}

const activeEmployee = (e: any) => Boolean(e) && e.active !== false && e.is_active !== false
const sameEmail = (a: any, b: any) => {
  const x = String(a || "").trim().toLowerCase()
  return Boolean(x) && x === String(b || "").trim().toLowerCase()
}

export type FloorScope =
  /** Not an Operator-only login: the full entry form, exactly as before. */
  | { kind: "full" }
  /** Operator-only, but its employee rows give no single stage: the full form with a note. */
  | { kind: "unlinked"; why: "no-stage" | "several"; employees: any[] }
  /** Operator-only and not linked to any employee: no stage at all (owner, 3 Nov 2026). */
  | { kind: "none" }
  /** Operator-only and linked: only this stage, logged as this employee. */
  | { kind: "stage"; stage: string; employee: any }

/**
 * Which stage this login works on the floor. The link is the login email written on the employee's row in
 * Masters › Employees (active rows of the card's plant only).
 */
export function floorScope({ roles, email, employees }: { roles: Array<string | null | undefined>; email?: string | null; employees: any[] }): FloorScope {
  if (!isOperatorOnly(roles)) return { kind: "full" }
  const linked = (employees || []).filter((e) => activeEmployee(e) && sameEmail(e.email, email))
  if (!linked.length) return { kind: "none" }
  const withStage = linked.filter((e) => stageForDepartment(e.department))
  const stages = Array.from(new Set(withStage.map((e) => stageForDepartment(e.department) as string)))
  if (!stages.length) return { kind: "unlinked", why: "no-stage", employees: linked }
  if (stages.length > 1) return { kind: "unlinked", why: "several", employees: withStage }
  return { kind: "stage", stage: stages[0], employee: withStage[0] }
}

/** What an Operator-only login not linked to an employee sees instead of any stage. */
export const NOT_LINKED_MESSAGE = "Your login is not linked to an employee; ask the Owner."

/** The note an unlinked operator sees above the full form (or, not linked at all, instead of it). */
export function unlinkedNote(scope: FloorScope): string {
  if (scope.kind === "none") return NOT_LINKED_MESSAGE
  if (scope.kind !== "unlinked") return ""
  if (scope.why === "no-stage") {
    const dept = String(scope.employees[0]?.department || "").trim()
    return `Your employee row (${scope.employees[0]?.name || "you"}) is in ${dept ? `the ${dept} department` : "no department"}, which runs no floor stage, so every stage is shown. Ask the Admin to set your department in Masters › Employees.`
  }
  if (scope.why === "several") return `Your login email is on more than one employee in different departments (${scope.employees.map((e) => e.name).join(", ")}), so every stage is shown. Ask the Admin to keep it on one row in Masters › Employees.`
  return ""
}

export type StageGate = {
  /** The stage takes runs or QC from this login now. */
  open: boolean
  kind: "open" | "missing" | "card-closed" | "closed" | "waiting"
  /** One line in plain words; empty when open. */
  message: string
}

/**
 * Whether a scoped operator's stage is open on this card, as one line. "Waiting" is a stage that has not
 * started and has nothing ready from the stage before it (the same test the Log output form uses for its
 * QC gate), so an operator never gets a form that the server would refuse.
 */
export function scopedStageGate(stages: any[], stage: string, cardOpen = true): StageGate {
  const list = Array.isArray(stages) ? stages : []
  const state = list.find((s) => s?.stage === stage)
  const at = list.find((s) => s?.status !== "COMPLETED" && FLOOR_STAGES.has(s?.stage))
  const atText = at && at.stage !== stage ? ` The card is at ${label(at.stage)} now.` : ""
  if (!state) return { open: false, kind: "missing", message: `This card has no ${label(stage)} stage.${atText}` }
  if (!cardOpen) return { open: false, kind: "card-closed", message: `This card is closed; nothing more to log on ${label(stage)}.` }
  if (state.status === "COMPLETED") return { open: false, kind: "closed", message: `${label(stage)} is closed on this card (${[fmt(state.accepted_total), state.unit, "good"].filter(Boolean).join(" ")}).${atText}` }
  const started = state.status === "RUNNING" || Number(state.accepted_total || 0) > 0 || Number(state.produced_total || 0) > 0 || Number(state.draft_count || 0) > 0
  const index = list.findIndex((s) => s?.stage === stage)
  const prev = index > 0 ? list[index - 1] : undefined
  const gated = Boolean(prev) && prev.stage !== "SLITTING" && state.available_from_upstream != null && Number(state.available_from_upstream) <= 0
  if (!started && gated) {
    const where = at && at.stage !== stage ? label(at.stage) : label(prev.stage)
    const unit = state.input_unit || prev.unit || "output"
    const waiting = Number(state.awaiting_qc_from_upstream || 0)
    return {
      open: false,
      kind: "waiting",
      message: waiting > 0 ? `This card is at ${where}; ${label(stage)} opens when ${label(prev.stage)} QC is recorded (${fmt(waiting)} ${unit} waiting).` : `This card is at ${where}; ${label(stage)} opens when ${label(prev.stage)} passes ${unit}.`,
    }
  }
  return { open: true, kind: "open", message: "" }
}
