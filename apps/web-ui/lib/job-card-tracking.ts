/**
 * Job card tracking helpers (client 2026-10-27): one plain status per card for the job cards list
 * and the manager, the stage track, grouping and the CSV. Pure functions, no React, so the rules
 * are the same on every screen and unit-testable.
 */
import { compactRef } from "./job-card-display"

export type LifecycleState = "QUEUED" | "SCHEDULED" | "RUNNING" | "COMPLETED" | "FORCE_CLOSED" | "CANCELLED"

/** Lifecycle from a planner summary row (no extra request). */
export function lifecycleStateOf(job: any): LifecycleState {
  const status = String(job?.status || "").toUpperCase()
  if (job?.close_mode === "FORCE") return status === "COMPLETED" ? "COMPLETED" : "FORCE_CLOSED"
  if (status === "CANCELLED" || job?.close_mode === "CANCELLED") return "CANCELLED"
  if (status === "COMPLETED") return "COMPLETED"
  if (status === "IN_PROGRESS" || String(job?.active_segment_status || "").toUpperCase() === "RUNNING") return "RUNNING"
  if (job?.current_shift_code || String(job?.active_segment_status || "").toUpperCase() === "ASSIGNED") return "SCHEDULED"
  return "QUEUED"
}

export type TrackStatus = "QUEUE" | "SCHEDULED" | "RUNNING" | "WAITING_QC" | "ON_HOLD" | "READY_DISPATCH" | "CLOSED_EARLY" | "DONE"
export type TrackTone = "blue" | "violet" | "amber" | "rose" | "emerald" | "slate"

export const TRACK_STATUSES: Array<{ key: TrackStatus; label: string; tone: TrackTone; open: boolean; hint: string }> = [
  { key: "QUEUE", label: "Queue", tone: "slate", open: true, hint: "Released, not on the planner board yet" },
  { key: "SCHEDULED", label: "Scheduled", tone: "blue", open: true, hint: "On the board with a date, shift and machine" },
  { key: "RUNNING", label: "Running", tone: "violet", open: true, hint: "The floor is logging runs on the current stage" },
  { key: "WAITING_QC", label: "Waiting QC", tone: "amber", open: true, hint: "At the final QC gate" },
  { key: "ON_HOLD", label: "On hold", tone: "rose", open: true, hint: "An active quality hold stops the next stage" },
  { key: "READY_DISPATCH", label: "Ready to dispatch", tone: "emerald", open: true, hint: "Packed and checked; waiting for the truck" },
  { key: "CLOSED_EARLY", label: "Closed early", tone: "rose", open: false, hint: "Force-closed or cancelled; the balance went back to the order" },
  { key: "DONE", label: "Done", tone: "emerald", open: false, hint: "All stages done" },
]

export function trackStatus(job: any, onHold = false): TrackStatus {
  const life = lifecycleStateOf(job)
  const stage = String(job?.current_stage || "").toUpperCase()
  if (life === "FORCE_CLOSED" || life === "CANCELLED") return "CLOSED_EARLY"
  if (life === "COMPLETED" || stage === "DONE") return "DONE"
  if (onHold) return "ON_HOLD"
  if (stage === "QC") return "WAITING_QC"
  if (stage === "DISPATCH") return "READY_DISPATCH"
  if (life === "RUNNING") return "RUNNING"
  if (life === "SCHEDULED") return "SCHEDULED"
  return "QUEUE"
}

export function trackMeta(key: TrackStatus) {
  return TRACK_STATUSES.find((row) => row.key === key) || TRACK_STATUSES[0]
}

export function isOpenCard(job: any) {
  return trackMeta(trackStatus(job)).open
}

export const STAGE_TRACK: Array<{ stage: string; short: string; label: string }> = [
  { stage: "SLITTING", short: "S", label: "Slitting" },
  { stage: "WINDER", short: "W", label: "Winding" },
  { stage: "OVEN", short: "O", label: "Oven" },
  { stage: "PROCESS", short: "P", label: "Process" },
  { stage: "PACKING", short: "Pk", label: "Packing" },
  { stage: "QC", short: "QC", label: "Final QC" },
  { stage: "DISPATCH", short: "D", label: "Dispatch" },
]

export function stageWord(stage?: string | null) {
  const key = String(stage || "").toUpperCase()
  if (key === "DONE") return "Done"
  return STAGE_TRACK.find((row) => row.stage === key)?.label || (key ? key.charAt(0) + key.slice(1).toLowerCase() : "—")
}

/** The W · O · P · Pk · QC · D track of a card: stages before the current one are done. */
export function stageTrack(job: any): Array<{ stage: string; short: string; label: string; state: "done" | "current" | "pending" }> {
  const current = String(job?.current_stage || "").toUpperCase()
  const life = lifecycleStateOf(job)
  const closed = life === "FORCE_CLOSED" || life === "CANCELLED"
  const route = STAGE_TRACK.filter((row) => row.stage !== "SLITTING" || current === "SLITTING" || job?.requires_slitting)
  const index = route.findIndex((row) => row.stage === current)
  return route.map((row, position) => {
    if (current === "DONE" || life === "COMPLETED") return { ...row, state: "done" as const }
    if (index < 0) return { ...row, state: "pending" as const }
    if (position < index) return { ...row, state: "done" as const }
    if (position === index) return { ...row, state: closed ? ("pending" as const) : ("current" as const) }
    return { ...row, state: "pending" as const }
  })
}

export function orderRef(job: any) {
  return String(job?.sales_order_ref || job?.sales_order_no || job?.order_no || compactRef(job?.sales_order_id, "SO"))
}

export type GroupBy = "none" | "order" | "stage" | "status" | "machine"

export const GROUP_OPTIONS: Array<{ key: GroupBy; label: string }> = [
  { key: "none", label: "None" },
  { key: "order", label: "Sales order" },
  { key: "stage", label: "Stage" },
  { key: "status", label: "Status" },
  { key: "machine", label: "Machine" },
]

export function groupOf(job: any, groupBy: GroupBy, machineLabel: (id: string) => string, statusOf: (job: any) => TrackStatus = (row) => trackStatus(row)): { key: string; label: string; sub: string } {
  if (groupBy === "status") {
    const meta = trackMeta(statusOf(job))
    return { key: meta.key, label: meta.label, sub: meta.hint }
  }
  if (groupBy === "order") {
    const key = String(job?.sales_order_id || "none")
    return { key, label: orderRef(job), sub: [job?.customer_name, job?.due_date ? `due ${dayText(job.due_date)}` : null].filter(Boolean).join(" · ") }
  }
  if (groupBy === "stage") {
    const stage = String(job?.current_stage || "").toUpperCase() || "NONE"
    return { key: stage, label: stageWord(stage), sub: "" }
  }
  if (groupBy === "machine") {
    const id = job?.current_machine_id ? String(job.current_machine_id) : ""
    return { key: id || "none", label: id ? machineLabel(id) : "No machine yet", sub: id ? stageWord(job?.current_stage) : "In the queue or finished" }
  }
  return { key: "all", label: "", sub: "" }
}

export function groupRows<T>(rows: T[], groupBy: GroupBy, machineLabel: (id: string) => string, statusOf?: (job: any) => TrackStatus): Array<{ key: string; label: string; sub: string; rows: T[] }> {
  if (groupBy === "none") return [{ key: "all", label: "", sub: "", rows }]
  const map = new Map<string, { key: string; label: string; sub: string; rows: T[] }>()
  for (const row of rows) {
    const group = groupOf(row, groupBy, machineLabel, statusOf)
    const bucket = map.get(group.key) || { ...group, rows: [] }
    bucket.rows.push(row)
    map.set(group.key, bucket)
  }
  const buckets = Array.from(map.values())
  // Stages in route order and statuses in flow order read top to bottom like the floor.
  if (groupBy === "stage") {
    const order = [...STAGE_TRACK.map((row) => row.stage), "DONE"]
    return buckets.sort((a, b) => (order.indexOf(a.key) < 0 ? 99 : order.indexOf(a.key)) - (order.indexOf(b.key) < 0 ? 99 : order.indexOf(b.key)))
  }
  if (groupBy === "status") {
    const order = TRACK_STATUSES.map((row) => row.key as string)
    return buckets.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  }
  return buckets
}

export function dayText(value?: string | null) {
  if (!value) return ""
  const iso = String(value).slice(0, 10)
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })
}

/**
 * A server timestamp as a Date. The production service writes naive UTC ("2026-10-27T05:30:15"):
 * read without a zone it would show 05:30 instead of 11:00 in the plant, so a missing zone means UTC.
 */
export function serverTime(value?: string | null): Date | null {
  if (!value) return null
  const text = String(value)
  const zoned = /([zZ]|[+-]\d\d:?\d\d)$/.test(text) || !/T\d\d:\d\d/.test(text) ? text : `${text}Z`
  const date = new Date(zoned)
  return Number.isNaN(date.getTime()) ? null : date
}

export function shiftText(code?: string | null) {
  return code ? String(code).replace("SHIFT_", "Shift ") : ""
}

/** Days from today to the due date (plant calendar): negative = late. */
export function dueInDays(dueDate?: string | null, today = new Date()): number | null {
  if (!dueDate) return null
  const due = new Date(`${String(dueDate).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(due.getTime())) return null
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((due.getTime() - start.getTime()) / 86_400_000)
}

export function dueText(days: number | null) {
  if (days === null) return ""
  if (days < 0) return `${Math.abs(days)}d late`
  if (days === 0) return "Due today"
  return `in ${days}d`
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** CSV of the rows as the list shows them (one line per card). */
export function jobCardsCsv(rows: any[], options: { machineLabel: (id: string) => string; holdReason?: (job: any) => string | null }) {
  const header = ["Card", "Customer", "Sales order", "Size", "Colour", "Qty (pcs)", "Weight (kg)", "Status", "Stage", "Machine", "Plan date", "Shift", "Plan status", "Due", "QC flagged runs", "On hold", "Back to order (pcs)"]
  const lines = rows.map((job) => {
    const hold = options.holdReason?.(job) || ""
    return [
      job.job_card_no || job.job_card_ref || job.id,
      job.customer_name || "",
      orderRef(job),
      job.product_size_label || job.product_code || "",
      job.parchment_color || "",
      Number(job.planned_qty || 0),
      job.planned_weight_kg ? Number(job.planned_weight_kg).toFixed(1) : "",
      trackMeta(trackStatus(job, Boolean(hold))).label,
      stageWord(job.current_stage),
      job.current_machine_id ? options.machineLabel(String(job.current_machine_id)) : "",
      job.current_plan_date ? String(job.current_plan_date).slice(0, 10) : "",
      shiftText(job.current_shift_code),
      job.plan_status_label || "",
      job.due_date ? String(job.due_date).slice(0, 10) : "",
      Number(job.qc_flagged_runs || 0),
      hold,
      Number(job.returned_qty || 0),
    ]
      .map(csvCell)
      .join(",")
  })
  return [header.join(","), ...lines].join("\n")
}

export function downloadText(filename: string, text: string, type = "text/csv") {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export type TrailKind = "RELEASE" | "EDIT" | "SPLIT" | "CLOSE" | "CANCEL" | "EMERGENCY" | "PLAN" | "OTHER"
export type TrailChange = { label: string; before?: string | null; after: string }
export type TrailEvent = {
  id: string
  at: string | null
  actor: string | null
  role: string | null
  kind: TrailKind
  title: string
  detail: string | null
  reason: string | null
  changes: TrailChange[]
  card?: { id: string; no: string } | null
}

const pcs = (value: unknown) => `${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })} pcs`
const slotWords = (date?: string | null, shift?: string | null, machine?: string) => [date ? dayText(date) : null, shiftText(shift), machine].filter(Boolean).join(" · ")

/**
 * The management changes of one card in plain words, newest first, with before → after for the
 * quantity even where the audit row only carries the moved qty: the card's qty is walked back from
 * today's value (a split adds back what moved; a force close was made + returned; an edit says both).
 */
export function managementTrail(
  events: Array<{ id: string; action: string; actor: string | null; role: string | null; at: string; payload: Record<string, any> }>,
  currentQty: number,
  machineLabel: (id: string) => string = (id) => compactRef(id, "MC"),
): TrailEvent[] {
  let cursor = Number(currentQty || 0)
  const out: TrailEvent[] = []
  const ordered = [...(events || [])].sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
  for (const event of ordered) {
    const p = event.payload || {}
    const reason = String(p.reason || "").trim() || null
    const base = { id: event.id, at: event.at || null, actor: event.actor, role: event.role, reason, detail: null as string | null, changes: [] as TrailChange[], card: null as TrailEvent["card"] }
    switch (event.action) {
      case "release_sync_create":
      case "released":
      case "created":
        out.push({ ...base, kind: "RELEASE", title: "Released from the sales order", changes: p.released_qty || p.qty ? [{ label: "Qty", after: pcs(p.released_qty || p.qty) }] : [] })
        break
      case "job_card_amended": {
        const before = p.before || {}
        const after = p.after || {}
        const changes: TrailChange[] = []
        if (Number(before.planned_qty) !== Number(after.planned_qty)) changes.push({ label: "Qty", before: pcs(before.planned_qty), after: pcs(after.planned_qty) })
        if ((before.parchment_color || "") !== (after.parchment_color || "")) changes.push({ label: "Colour", before: before.parchment_color || "plain", after: after.parchment_color || "plain" })
        if (before.planned_qty !== undefined) cursor = Number(before.planned_qty)
        out.push({ ...base, kind: "EDIT", title: "Qty / colour edited", changes })
        break
      }
      case "job_card_split": {
        const qty = Number(p.qty || 0)
        const after = cursor
        cursor = after + qty
        out.push({ ...base, kind: "SPLIT", title: `Split into a new card ${p.child_job_card_no || ""}`.trim(), detail: `${pcs(qty)} moved to ${p.child_job_card_no || "the new card"}`, changes: [{ label: "Qty", before: pcs(cursor), after: pcs(after) }], card: p.child_job_card_id ? { id: String(p.child_job_card_id), no: String(p.child_job_card_no || "new card") } : null })
        break
      }
      case "job_card_created_by_split":
        out.push({ ...base, kind: "SPLIT", title: `Created by splitting ${p.parent_job_card_no || "the parent card"}`, changes: [{ label: "Qty", after: pcs(p.qty) }], card: p.parent_job_card_id ? { id: String(p.parent_job_card_id), no: String(p.parent_job_card_no || "parent") } : null })
        break
      case "job_card_force_closed": {
        const made = Number(p.made_qty || 0)
        const returned = Number(p.returned_qty || 0)
        const cancelled = String(p.mode || "").toUpperCase() === "CANCELLED" || made <= 0
        const before = made + returned
        out.push({
          ...base,
          kind: cancelled ? "CANCEL" : "CLOSE",
          title: cancelled ? "Cancelled" : "Force closed",
          detail: cancelled ? `${pcs(returned)} back to the order` : `Made ${pcs(made)} · ${pcs(returned)} back to the order`,
          changes: [{ label: "Qty", before: pcs(before), after: cancelled ? "0 pcs" : pcs(made) }],
        })
        if (!cancelled) cursor = before
        break
      }
      case "job_card_emergency_insert": {
        const bumped = Array.isArray(p.bumped) ? p.bumped : []
        out.push({
          ...base,
          kind: "EMERGENCY",
          title: "Emergency insert",
          detail: bumped.length ? `${bumped.length} card${bumped.length > 1 ? "s" : ""} pushed later: ${bumped.map((row: any) => `${row.job_card_no || "card"} ${slotWords(row.from?.date, row.from?.shift)} → ${slotWords(row.to?.date, row.to?.shift)}`).join("; ")}` : "Nothing had to move",
          changes: [{ label: "Runs first", after: slotWords(p.plan_date, p.shift_code, p.machine_id ? machineLabel(String(p.machine_id)) : undefined) }],
        })
        break
      }
      case "planned":
      case "plan_split": {
        const after = p.after || {}
        const before = p.before || null
        out.push({
          ...base,
          kind: "PLAN",
          title: `${stageWord(p.stage)} ${event.action === "planned" ? "planned" : "plan split"}`,
          detail: event.action === "plan_split" ? p.summary || null : null,
          changes: after.plan_date || after.shift_code ? [{ label: "Slot", before: before && (before.plan_date || before.shift_code) ? slotWords(before.plan_date, before.shift_code, before.machine_id ? machineLabel(String(before.machine_id)) : undefined) : null, after: slotWords(after.plan_date, after.shift_code, after.machine_id ? machineLabel(String(after.machine_id)) : undefined) }] : [],
        })
        break
      }
      case "winder_override":
        out.push({ ...base, kind: "PLAN", title: "Planned on another winder than the release winder", detail: p.note || null })
        break
      case "missed_slot_requeued":
        out.push({ ...base, kind: "PLAN", title: "Slot passed with nothing logged: back to the queue", detail: `${stageWord(p.stage)} · ${slotWords(p.plan_date, p.shift_code)}` })
        break
      case "missed_slot_late_entry":
        out.push({ ...base, kind: "PLAN", title: "Late entry: back on the slot it ran in", detail: slotWords(p.plan_date, p.shift_code) || null })
        break
      case "switched_to_batch_entry":
        out.push({ ...base, kind: "OTHER", title: "Moved to batch entry" })
        break
      default:
        break
    }
  }
  return out
}
