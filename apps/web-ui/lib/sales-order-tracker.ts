/**
 * One reading of a sales order for the Orders list and the Order page (client 2026-10-27):
 * status tab, totals (ordered → released → made → dispatched), due risk, the job cards' state mix
 * and the one next action. Pure functions over the order and job-card summaries the API returns.
 */
import { plantToday } from "@/lib/due-risk"

export type OrderTabKey = "draft" | "approval" | "ready" | "production" | "partly" | "hold" | "closed" | "cancelled" | "all"

export const ORDER_TABS: Array<{ key: OrderTabKey; label: string; counts: string[] }> = [
  { key: "draft", label: "Draft", counts: ["draft"] },
  { key: "approval", label: "Waiting approval", counts: ["submitted"] },
  { key: "ready", label: "Ready to release", counts: ["approved"] },
  { key: "production", label: "In production", counts: ["released", "partially_released"] },
  { key: "partly", label: "Partly dispatched", counts: ["partially_dispatched"] },
  { key: "hold", label: "On hold", counts: ["held"] },
  { key: "closed", label: "Closed", counts: ["closed"] },
  { key: "cancelled", label: "Cancelled", counts: ["cancelled"] },
  { key: "all", label: "All", counts: ["all"] },
]

export function isOrderTab(value: unknown): value is OrderTabKey {
  return ORDER_TABS.some((tab) => tab.key === value)
}

/** Query params the list API needs for one status tab. */
export function orderTabParams(tab: OrderTabKey): Record<string, string | boolean | undefined> {
  switch (tab) {
    case "draft": return { status: "draft" }
    case "approval": return { status: "submitted" }
    case "ready": return { status: "approved" }
    case "production": return { status: "released,partially_released" }
    case "partly": return { status: "partially_dispatched" }
    case "hold": return { held: true }
    case "closed": return { status: "closed" }
    case "cancelled": return { status: "cancelled" }
    default: return {}
  }
}

export function tabCount(counts: Record<string, number> | undefined, tab: OrderTabKey): number | null {
  if (!counts) return null
  const entry = ORDER_TABS.find((row) => row.key === tab)
  if (!entry) return null
  if (tab === "hold") return Number(counts.held || 0)
  return entry.counts.reduce((sum, key) => sum + Number(counts[key] || 0), 0)
}

export type KpiTile = "open" | "unreleased" | "priority" | "overdue" | "ready" | "hold"

/** Extra list params for a KPI tile; "ready" (packed, waiting for a DC) is filtered on the screen. */
export function kpiTileParams(tile: KpiTile | null): Record<string, string | boolean | undefined> {
  switch (tile) {
    case "open": return { status_group: "open" }
    case "unreleased": return { unreleased: true }
    case "priority": return { due: "priority" }
    case "overdue": return { due: "overdue" }
    case "hold": return { held: true }
    default: return {}
  }
}

const num = (value: unknown) => Number(value || 0)

export type OrderTotals = {
  ordered: number
  released: number
  dispatched: number
  hold: number
  shortClosed: number
  unreleased: number
  pending: number
  value: number
  lines: number
}

export function orderTotals(order: any): OrderTotals {
  const lines: any[] = Array.isArray(order?.lines) ? order.lines : []
  const cancelled = String(order?.status || "") === "cancelled"
  const sum = (pick: (line: any) => number) => lines.reduce((total, line) => total + pick(line), 0)
  const ordered = sum((line) => num(line.qty))
  const released = sum((line) => num(line.released_qty))
  const dispatched = sum((line) => num(line.fulfilled_qty))
  const hold = sum((line) => num(line.hold_qty))
  const shortClosed = sum((line) => num(line.short_closed_qty))
  const unreleased = cancelled ? 0 : sum((line) => Math.max(0, Number(line.release_remaining_qty ?? num(line.qty) - num(line.released_qty) - num(line.hold_qty))))
  const pending = cancelled ? 0 : sum((line) => Number(line.pending_qty ?? Math.max(0, num(line.qty) - num(line.fulfilled_qty) - num(line.hold_qty))))
  const value = sum((line) => (line.line_value != null ? num(line.line_value) : num(line.qty) * num(line.effective_rate_per_pc ?? line.rate_per_pc)))
  return { ordered, released, dispatched, hold, shortClosed, unreleased, pending, value, lines: lines.length }
}

export type DueRisk = "overdue" | "today" | "soon" | "ok"

export type OrderDue = { date: string | null; days: number | null; risk: DueRisk | null; label: string }

/** Earliest due date of a line that still has pieces to send; closed/cancelled orders carry no risk. */
export function orderDue(order: any, today = plantToday()): OrderDue {
  const lines: any[] = Array.isArray(order?.lines) ? order.lines : []
  const open = lines.filter((line) => Number(line.pending_qty ?? num(line.qty) - num(line.fulfilled_qty) - num(line.hold_qty)) > 0 && line.due_date)
  const pool = (open.length ? open : lines.filter((line) => line.due_date)).map((line) => String(line.due_date).slice(0, 10)).sort()
  const date = pool[0] || null
  if (!date) return { date: null, days: null, risk: null, label: "No date" }
  const days = Math.round((Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) - Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))) / 86_400_000)
  const finished = ["closed", "cancelled"].includes(String(order?.status || "")) || Boolean(order?.is_held) || !open.length
  if (finished) return { date, days, risk: null, label: "" }
  if (days < 0) return { date, days, risk: "overdue", label: `Overdue ${-days} d` }
  if (days === 0) return { date, days, risk: "today", label: "Due today" }
  if (days === 1) return { date, days, risk: "soon", label: "Tomorrow" }
  if (days <= 3) return { date, days, risk: "soon", label: `in ${days} days` }
  return { date, days, risk: "ok", label: `in ${days} days` }
}

export type OrderStatusKey = Exclude<OrderTabKey, "all">

export function orderStatus(order: any): { key: OrderStatusKey; label: string } {
  const status = String(order?.status || "").toLowerCase()
  if (order?.is_held) return { key: "hold", label: "On hold" }
  if (status === "cancelled") return { key: "cancelled", label: "Cancelled" }
  if (status === "closed") return { key: "closed", label: order?.closure_kind === "SHORT_CLOSED" ? "Closed · short" : "Closed" }
  if (status === "partially_dispatched") return { key: "partly", label: "Partly dispatched" }
  if (status === "released" || status === "partially_released") return { key: "production", label: "In production" }
  if (status === "approved") return { key: "ready", label: "Ready to release" }
  if (status === "submitted") return { key: "approval", label: "Waiting approval" }
  return { key: "draft", label: "Draft" }
}

/** Lifecycle state from a planner summary row (same reading as the job card pages). */
export type CardState = "QUEUED" | "SCHEDULED" | "RUNNING" | "COMPLETED" | "FORCE_CLOSED" | "CANCELLED"

export function cardState(job: any): CardState {
  const status = String(job?.status || "").toUpperCase()
  if (job?.close_mode === "FORCE") return status === "COMPLETED" ? "COMPLETED" : "FORCE_CLOSED"
  if (status === "CANCELLED" || job?.close_mode === "CANCELLED") return "CANCELLED"
  if (status === "COMPLETED") return "COMPLETED"
  if (status === "IN_PROGRESS" || String(job?.active_segment_status || "").toUpperCase() === "RUNNING") return "RUNNING"
  if (job?.current_shift_code || String(job?.active_segment_status || "").toUpperCase() === "ASSIGNED") return "SCHEDULED"
  return "QUEUED"
}

/** Packing and the two QC readings happen at Process, so a card's route is W · O · P · D (S first when slit). */
export const CARD_STAGES = ["SLITTING", "WINDER", "OVEN", "PROCESS", "DISPATCH"] as const
export const STAGE_SHORT: Record<string, string> = { SLITTING: "S", WINDER: "W", OVEN: "O", PROCESS: "P", DISPATCH: "D", DONE: "✓" }
export const STAGE_LABEL: Record<string, string> = { SLITTING: "Slitting", WINDER: "Winding", OVEN: "Oven", PROCESS: "Process", PACKING: "Process", QC: "Process", DISPATCH: "Dispatch", DONE: "Done" }

/** The route stage a card is on; a PACKING or QC step from before the rule reads as Process. */
export function routeStage(stage?: string | null) {
  const key = String(stage || "").toUpperCase()
  return key === "PACKING" || key === "QC" ? "PROCESS" : key
}

/** True once the card's pieces are packed and waiting for a delivery challan. */
export function cardReadyToDispatch(job: any) {
  return String(job?.current_stage || "").toUpperCase() === "DISPATCH" && String(job?.status || "").toUpperCase() !== "COMPLETED"
}

export function cardUnplanned(job: any) {
  const plan = String(job?.plan_status || "").toUpperCase()
  return cardState(job) === "QUEUED" || plan === "NOT_PLANNED" || plan === "MISSED" || plan === "PAST"
}

export type CardMixChip = { key: string; label: string; count: number; tone: "blue" | "violet" | "amber" | "emerald" | "rose" | "slate" }

export type CardSummary = {
  total: number
  chips: CardMixChip[]
  flagged: number
  ready: number
  readyQty: number
  unplanned: number
  running: number
  made: number
  firstReadyId: string | null
}

/** State mix of an order's job cards, with "made" read as the pieces of finished cards. */
export function cardSummary(jobs: any[]): CardSummary {
  const list = Array.isArray(jobs) ? jobs : []
  const counts: Record<string, number> = {}
  let made = 0
  let readyQty = 0
  let firstReadyId: string | null = null
  for (const job of list) {
    const state = cardState(job)
    const key = cardReadyToDispatch(job) ? "READY" : state
    counts[key] = (counts[key] || 0) + 1
    if (state === "COMPLETED" || state === "FORCE_CLOSED") made += Math.max(0, num(job.planned_qty) - num(job.returned_qty))
    if (cardReadyToDispatch(job)) {
      readyQty += Math.max(0, num(job.planned_qty) - num(job.returned_qty))
      made += Math.max(0, num(job.planned_qty) - num(job.returned_qty))
      if (!firstReadyId) firstReadyId = String(job.id)
    }
  }
  const order: Array<[string, string, CardMixChip["tone"]]> = [
    ["RUNNING", "running", "blue"],
    ["SCHEDULED", "scheduled", "violet"],
    ["QUEUED", "in queue", "slate"],
    ["READY", "ready to dispatch", "emerald"],
    ["COMPLETED", "done", "emerald"],
    ["FORCE_CLOSED", "closed early", "amber"],
    ["CANCELLED", "cancelled", "slate"],
  ]
  return {
    total: list.length,
    chips: order.filter(([key]) => counts[key]).map(([key, label, tone]) => ({ key, label, count: counts[key], tone })),
    flagged: list.filter((job) => num(job.qc_flagged_runs) > 0).length,
    ready: counts.READY || 0,
    readyQty,
    unplanned: list.filter((job) => cardState(job) !== "COMPLETED" && cardState(job) !== "FORCE_CLOSED" && cardState(job) !== "CANCELLED" && cardUnplanned(job)).length,
    running: counts.RUNNING || 0,
    made,
    firstReadyId,
  }
}

export type NextActionKey = "submit" | "approve" | "waiting" | "release" | "plan" | "dispatch" | "resume" | "open"

export type NextAction = { key: NextActionKey; label: string; tone: "primary" | "secondary" | "ghost"; hint?: string; href?: string }

/** Who can make (seal) a delivery challan: the same roles as the challan page (Sales only views challans). */
export function canMakeChallan(user?: { role?: string | null; roles?: Array<string | null> | null } | null): boolean {
  const roles = [user?.role, ...(user?.roles || [])]
  return roles.some((role) => ["Owner", "Admin", "Dispatch"].includes(String(role || "")))
}

/** The one thing to do next on this order, for the row button and the page's action bar. */
export function nextAction(order: any, cards: CardSummary, meEmail?: string | null, canChallan = true): NextAction {
  const status = String(order?.status || "").toLowerCase()
  const totals = orderTotals(order)
  const mine = Boolean(meEmail) && String(order?.created_by || "").trim().toLowerCase() === String(meEmail || "").trim().toLowerCase()
  if (order?.is_held) return { key: "resume", label: "Resume", tone: "secondary", hint: "Lift the customer hold; the order goes back to its earlier status" }
  if (status === "cancelled" || status === "closed") return { key: "open", label: "View", tone: "ghost" }
  if (status === "draft") {
    if (mine) return { key: "submit", label: "Send for approval", tone: "secondary", hint: "You entered this order, so another user approves it (maker-checker)" }
    return { key: "approve", label: "Approve", tone: "primary", hint: "Approve the commercial terms; release comes next" }
  }
  if (status === "submitted") {
    if (mine) return { key: "waiting", label: "Waiting approval", tone: "ghost", hint: "You entered this order, so another user approves it (maker-checker)" }
    return { key: "approve", label: "Approve", tone: "primary" }
  }
  if (totals.unreleased > 0) return { key: "release", label: status === "approved" ? "Release" : `Release ${totals.unreleased.toLocaleString("en-IN")}`, tone: "primary", hint: "Make job cards for the lines (one colour per card, with a winder queue)" }
  if (cards.ready > 0 && !canChallan) return { key: "waiting", label: "Waiting for dispatch", tone: "ghost", hint: `${cards.readyQty.toLocaleString("en-IN")} pcs are packed; Dispatch makes the delivery challan` }
  if (cards.ready > 0) return { key: "dispatch", label: `Dispatch ${cards.readyQty.toLocaleString("en-IN")}`, tone: "primary", hint: "Packed pieces are waiting for a delivery challan", href: cards.firstReadyId ? `/logistics/dispatch/new?job_card_id=${cards.firstReadyId}` : "/logistics/dispatch" }
  if (cards.unplanned > 0) return { key: "plan", label: "Plan", tone: "secondary", hint: "A job card of this order has no planner slot yet", href: `/planning/board?section=winder&order_id=${order?.id}&view=calendar` }
  return { key: "open", label: "Open", tone: "ghost" }
}

/** Short reading of where the order is, for the Order page header. */
export function orderHealth(order: any, totals: OrderTotals, cards: CardSummary, due: OrderDue): Array<{ text: string; tone: "blue" | "emerald" | "teal" | "amber" | "rose" | "slate" }> {
  const items: Array<{ text: string; tone: "blue" | "emerald" | "teal" | "amber" | "rose" | "slate" }> = []
  const fmt = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 0 })
  const status = String(order?.status || "")
  if (cards.total) items.push({ text: `${cards.running} of ${cards.total} card${cards.total === 1 ? "" : "s"} running`, tone: "blue" })
  else if (!["draft", "submitted", "cancelled"].includes(status)) items.push({ text: "No job card yet", tone: "slate" })
  items.push({ text: `${fmt(totals.dispatched)} of ${fmt(totals.ordered)} dispatched`, tone: "emerald" })
  if (cards.readyQty > 0) items.push({ text: `${fmt(cards.readyQty)} ready to dispatch`, tone: "teal" })
  if (cards.flagged > 0) items.push({ text: `${cards.flagged} card${cards.flagged === 1 ? "" : "s"} with a flagged QC reading`, tone: "amber" })
  if (order?.is_held) items.push({ text: `On customer hold${order.hold_reason ? ` · ${order.hold_reason}` : ""}`, tone: "rose" })
  else if (status === "cancelled") items.push({ text: `Cancelled${order.closure_reason ? ` · ${order.closure_reason}` : ""}`, tone: "slate" })
  else if (status === "closed") items.push({ text: order?.closure_kind === "SHORT_CLOSED" ? `Short closed · ${fmt(totals.shortClosed)} pcs dropped` : "All dispatched", tone: "slate" })
  else if (due.risk) items.push({ text: `${due.risk === "overdue" ? `overdue by ${-(due.days || 0)} day${due.days === -1 ? "" : "s"}` : due.risk === "today" ? "due today" : `due in ${due.days} day${due.days === 1 ? "" : "s"}`} (${formatShortDate(due.date)})`, tone: due.risk === "overdue" ? "rose" : due.risk === "ok" ? "slate" : "amber" })
  return items
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Server times are UTC without a zone mark; read them as UTC so they show in plant (local) time. */
export function serverTime(value?: string | null): Date | null {
  if (!value) return null
  const text = String(value)
  const parsed = new Date(/T\d{2}:\d{2}/.test(text) && !/(Z|[+-]\d{2}:?\d{2})$/.test(text) ? `${text}Z` : text)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** "27 Oct, 14:02" in the plant's clock. */
export function formatDateTime(value?: string | null, withYear = false) {
  const parsed = serverTime(value)
  if (!parsed) return value ? String(value) : "—"
  const day = parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "Asia/Kolkata" })
  const time = parsed.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })
  return `${day}, ${time}`
}

/** The plant-calendar day (YYYY-MM-DD) an event happened on. */
export function eventDay(value?: string | null) {
  const parsed = serverTime(value)
  return parsed ? parsed.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : ""
}

/** "27 Oct" (with the year only when it is not this year). */
export function formatShortDate(value?: string | null, today = plantToday()) {
  if (!value) return "—"
  // A timestamp is read in the plant's clock; a plain date is taken as it is.
  const text = /T\d{2}:\d{2}/.test(String(value)) ? eventDay(value) || String(value).slice(0, 10) : String(value).slice(0, 10)
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return String(value)
  const day = Number(match[3])
  const month = MONTHS[Number(match[2]) - 1] || match[2]
  return match[1] === today.slice(0, 4) ? `${day} ${month}` : `${day} ${month} ${match[1]}`
}

/** Plain words for what to do next on an order, in order of urgency (Order page › What is next). */
export function whatIsNext(order: any, totals: OrderTotals, cards: CardSummary, jobs: any[], callOffs: any[], canChallan = true): Array<{ title: string; detail: string }> {
  const fmt = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 0 })
  const status = String(order?.status || "")
  const items: Array<{ title: string; detail: string }> = []
  if (status === "cancelled") return [{ title: "Nothing pending", detail: "The order was cancelled; enter a new order if the customer comes back." }]
  if (status === "closed") return [{ title: "Nothing pending", detail: order?.closure_kind === "SHORT_CLOSED" ? "The balance was dropped; everything released is dispatched." : "Everything is dispatched." }]
  if (order?.is_held) items.push({ title: "Resume when the customer is ready", detail: `${fmt(totals.hold)} pcs are held. Lifting the hold puts the order back to its earlier status.` })
  if (status === "draft") items.push({ title: "Send for approval", detail: "Another user approves the commercial terms (maker-checker), then the lines can be released." })
  if (status === "submitted") items.push({ title: "Approve the order", detail: "A user other than the one who entered it approves; then release the lines." })
  if (["approved", "released", "partially_released", "partially_dispatched"].includes(status) && totals.unreleased > 0 && !order?.is_held) {
    items.push({ title: `Release ${fmt(totals.unreleased)} pcs`, detail: "Release makes one job card per line and colour and puts it in the winder queue." })
  }
  if (cards.ready > 0) items.push({ title: canChallan ? `Make a DC for ${fmt(cards.readyQty)} pcs` : `Waiting for Dispatch to make the challan · ${fmt(cards.readyQty)} pcs`, detail: `${cards.ready} card${cards.ready === 1 ? " has" : "s have"} closed Process: packed, with both QC readings in.` })
  const unplanned = jobs.filter((job) => cardState(job) !== "COMPLETED" && cardState(job) !== "FORCE_CLOSED" && cardState(job) !== "CANCELLED" && cardUnplanned(job))
  if (unplanned.length) items.push({ title: `Plan ${unplanned.length} card${unplanned.length === 1 ? "" : "s"}`, detail: unplanned.slice(0, 3).map((job) => `${job.job_card_no || "card"} · ${String(job.plan_status_label || "not planned")}`).join(" · ") })
  const flagged = jobs.filter((job) => num(job.qc_flagged_runs) > 0)
  if (flagged.length) items.push({ title: "Look at the flagged QC readings", detail: flagged.map((job) => `${job.job_card_no || "card"}: ${job.qc_flagged_runs} run${num(job.qc_flagged_runs) === 1 ? "" : "s"} outside the band`).join(" · ") })
  const upcoming = callOffs.filter((row) => row.status !== "cancelled" && !row.immutable).sort((a, b) => String(a.delivery_date).localeCompare(String(b.delivery_date)))[0]
  if (upcoming) items.push({ title: `Next call-off ${formatShortDate(upcoming.delivery_date)} · ${fmt(num(upcoming.quantity))} pcs`, detail: cards.readyQty > 0 ? `${fmt(cards.readyQty)} ready now.` : "Nothing packed for it yet." })
  if (!items.length) items.push({ title: "Nothing pending", detail: cards.total ? "Job cards are running; the floor logs runs and QC on each card." : "Waiting for the next step." })
  return items
}
