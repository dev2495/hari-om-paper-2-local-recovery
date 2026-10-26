/**
 * Planner queue filters (client 2026-10-26): one filter model for the open queue on the 3-day board
 * and the month calendar, the quick badges, the removable chips and the saved views. Pure functions,
 * no React, so the matching and sorting rules are unit-testable and the same everywhere.
 */
import { workloadMachine, type WorkloadGrouping } from "./planner-workload"

export type QueueDue = "any" | "overdue" | "today" | "3d" | "7d" | "custom"
export type QueueFlag = "missed" | "emergency" | "split_card" | "stale" | "waiting" | "split_plan"
export type QueueSort = "due" | "qty" | "created" | "customer" | "priority"

export type QueueFilters = {
  search: string
  /** Release / preferred winder ids (or "unassigned"). Empty = any machine. */
  machines: string[]
  due: QueueDue
  due_from: string | null
  due_to: string | null
  /** Customer names as shown on the card. Empty = any customer. */
  customers: string[]
  /** Parchment colours; "Plain" = cards without a colour. Empty = any. */
  colours: string[]
  /** Size labels. Empty = any. */
  sizes: string[]
  qty_min: number | null
  qty_max: number | null
  /** Every flag chosen must be true on the card. */
  flags: QueueFlag[]
  /** Cards waiting for the previous stage's plan (locked) are shown at the bottom by default. */
  show_waiting: boolean
  sort: QueueSort
}

export const EMPTY_QUEUE_FILTERS: QueueFilters = {
  search: "",
  machines: [],
  due: "any",
  due_from: null,
  due_to: null,
  customers: [],
  colours: [],
  sizes: [],
  qty_min: null,
  qty_max: null,
  flags: [],
  show_waiting: true,
  sort: "due",
}

export const PLAIN_COLOUR = "Plain"

export const DUE_OPTIONS: Array<{ key: QueueDue; label: string }> = [
  { key: "any", label: "Any date" },
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "3d", label: "Due in 3 days" },
  { key: "7d", label: "Due in 7 days" },
  { key: "custom", label: "Between dates" },
]

export const FLAG_OPTIONS: Array<{ key: QueueFlag; label: string; hint: string }> = [
  { key: "missed", label: "Missed slot", hint: "Slot passed with no floor entry" },
  { key: "emergency", label: "Emergency", hint: "Runs first" },
  { key: "split_card", label: "Split card", hint: "Made by splitting another card" },
  { key: "stale", label: "Slot in the past", hint: "Planned on a date that has gone; needs a new slot" },
  { key: "waiting", label: "Waiting for previous stage", hint: "The previous stage is not finished yet" },
  { key: "split_plan", label: "Split plan", hint: "One card planned in parts (time slots)" },
]

export const SORT_OPTIONS: Array<{ key: QueueSort; label: string }> = [
  { key: "due", label: "Due first" },
  { key: "qty", label: "Largest first" },
  { key: "created", label: "Oldest release" },
  { key: "customer", label: "Customer A–Z" },
  { key: "priority", label: "Priority" },
]

export type QuickBadgeKey = "all" | "priority" | "overdue" | "missed" | "emergency"
export const QUICK_BADGES: Array<{ key: QuickBadgeKey; label: string; preset: Partial<QueueFilters> }> = [
  { key: "all", label: "All", preset: {} },
  { key: "priority", label: "Due ≤3d", preset: { due: "3d" } },
  { key: "overdue", label: "Overdue", preset: { due: "overdue" } },
  { key: "missed", label: "Missed slot", preset: { flags: ["missed"] } },
  { key: "emergency", label: "Emergency", preset: { flags: ["emergency"] } },
]

const positive = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0)
const text = (value: unknown) => String(value ?? "").trim()
const uniqueSorted = (values: unknown[]) => Array.from(new Set(values.map(text).filter(Boolean))).sort((a, b) => a.localeCompare(b))

/** Fill gaps and drop unknown keys so filters from localStorage or a saved view are always complete. */
export function normalizeQueueFilters(input: unknown): QueueFilters {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>
  const list = (value: unknown) => (Array.isArray(value) ? uniqueSorted(value) : [])
  const number = (value: unknown) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value))
  const date = (value: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : null)
  const due = DUE_OPTIONS.some((option) => option.key === raw.due) ? (raw.due as QueueDue) : "any"
  const sort = SORT_OPTIONS.some((option) => option.key === raw.sort) ? (raw.sort as QueueSort) : "due"
  const flags = list(raw.flags).filter((flag): flag is QueueFlag => FLAG_OPTIONS.some((option) => option.key === flag))
  return {
    search: text(raw.search),
    machines: list(raw.machines),
    due,
    due_from: due === "custom" ? date(raw.due_from) : null,
    due_to: due === "custom" ? date(raw.due_to) : null,
    customers: list(raw.customers),
    colours: list(raw.colours),
    sizes: list(raw.sizes),
    qty_min: number(raw.qty_min),
    qty_max: number(raw.qty_max),
    flags,
    show_waiting: raw.show_waiting === undefined ? true : Boolean(raw.show_waiting),
    sort,
  }
}

export function queueFiltersEqual(left: QueueFilters, right: QueueFilters, ignore: Array<keyof QueueFilters> = []) {
  const strip = (filters: QueueFilters) => {
    const copy: Record<string, unknown> = { ...normalizeQueueFilters(filters) }
    for (const key of ignore) delete copy[key]
    return JSON.stringify(copy, Object.keys(copy).sort())
  }
  return strip(left) === strip(right)
}

export function isLocked(job: any) {
  return Boolean(job?.planning_locked)
}

export function lockReason(job: any) {
  return text(job?.planning_locked_reason) || (job?.waiting_for_stage ? `Waiting for the ${String(job.waiting_for_stage).toLowerCase()} plan` : "Waiting for the previous plan")
}

export function isSplitCard(job: any) {
  return Boolean(job?.split_kind) || Boolean(job?.parent_job_card_id) || /-[A-Z]+$/.test(String(job?.job_card_no || ""))
}

export function isSplitPlan(job: any) {
  const source = String(job?.split_source || "NONE").toUpperCase()
  return positive(job?.remaining_segments) > 1 || positive(job?.segment_no) > 1 || (source !== "NONE" && source !== "")
}

export function queueQty(job: any) {
  return positive(job?.segment_planned_qty ?? job?.planned_qty)
}

export function queueColour(job: any) {
  return text(job?.parchment_color) || PLAIN_COLOUR
}

export function queueSize(job: any) {
  return text(job?.product_size_label && job.product_size_label !== "-" ? job.product_size_label : job?.spec_reference || job?.product_code)
}

export function queueCustomer(job: any) {
  return text(job?.customer_name)
}

/** Days from today to the due date, or null without a due date. */
export function dueInDays(job: any, today: string) {
  const due = String(job?.due_date || "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return null
  const toUtc = (value: string) => {
    const [year, month, day] = value.split("-").map(Number)
    return Date.UTC(year, month - 1, day)
  }
  return Math.round((toUtc(due) - toUtc(today)) / 86_400_000)
}

/** Everything the search box looks in: card, customer (name + code), order, PO, size, colour, product code. */
export function searchHaystack(job: any) {
  return [
    job?.job_card_no,
    job?.job_card_ref,
    job?.customer_name,
    job?.customer_code,
    job?.sales_order_ref,
    job?.sales_order_no,
    job?.order_no,
    job?.po_number,
    job?.customer_po_no,
    job?.customer_po_number,
    job?.product_code,
    job?.spec_reference,
    job?.product_size_label,
    job?.parchment_color,
  ]
    .map(text)
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

export function matchesSearch(job: any, search: string) {
  const tokens = text(search).toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  const haystack = searchHaystack(job)
  return tokens.every((token) => haystack.includes(token))
}

export function hasFlag(job: any, flag: QueueFlag, stage: string) {
  switch (flag) {
    case "missed":
      return Boolean(job?.missed_slot_open)
    case "emergency":
      return Boolean(job?.is_emergency)
    case "split_card":
      return isSplitCard(job)
    case "stale":
      return Boolean(job?.stale_slot)
    case "waiting":
      return isLocked(job) || (Boolean(job?.current_stage) && String(job.current_stage).toUpperCase() !== stage.toUpperCase())
    case "split_plan":
      return isSplitPlan(job)
    default:
      return true
  }
}

export function matchesDue(job: any, filters: QueueFilters, today: string) {
  if (filters.due === "any") return true
  const days = dueInDays(job, today)
  if (days === null) return false
  if (filters.due === "overdue") return days < 0
  if (filters.due === "today") return days === 0
  if (filters.due === "3d") return days >= 0 && days <= 3
  if (filters.due === "7d") return days >= 0 && days <= 7
  const due = String(job.due_date).slice(0, 10)
  if (filters.due_from && due < filters.due_from) return false
  if (filters.due_to && due > filters.due_to) return false
  return true
}

export function matchesQueueFilters(
  job: any,
  filters: QueueFilters,
  context: { today: string; stage: string; grouping?: WorkloadGrouping },
) {
  if (!filters.show_waiting && isLocked(job)) return false
  if (!matchesSearch(job, filters.search)) return false
  if (filters.machines.length && !filters.machines.includes(workloadMachine(job, context.stage, context.grouping || "release"))) return false
  if (!matchesDue(job, filters, context.today)) return false
  if (filters.customers.length && !filters.customers.includes(queueCustomer(job))) return false
  if (filters.colours.length && !filters.colours.includes(queueColour(job))) return false
  if (filters.sizes.length && !filters.sizes.includes(queueSize(job))) return false
  const qty = queueQty(job)
  if (filters.qty_min !== null && qty < filters.qty_min) return false
  if (filters.qty_max !== null && qty > filters.qty_max) return false
  for (const flag of filters.flags) if (!hasFlag(job, flag, context.stage)) return false
  return true
}

function priorityRank(job: any) {
  if (job?.is_emergency) return 0
  if (job?.missed_slot_open) return 1
  if (job?.stale_slot) return 2
  return 3
}

export function sortQueue<T = any>(jobs: T[], sort: QueueSort): T[] {
  const byDue = (a: any, b: any) => String(a.due_date || "9999").localeCompare(String(b.due_date || "9999"))
  const emergencyFirst = (a: any, b: any) => (Boolean(a.is_emergency) === Boolean(b.is_emergency) ? 0 : a.is_emergency ? -1 : 1)
  return [...jobs].sort((a: any, b: any) => {
    if (sort === "qty") return queueQty(b) - queueQty(a) || byDue(a, b)
    if (sort === "created") return String(a.created_at || "").localeCompare(String(b.created_at || "")) || byDue(a, b)
    if (sort === "customer") return queueCustomer(a).localeCompare(queueCustomer(b)) || byDue(a, b)
    if (sort === "priority") {
      const rank = priorityRank(a) - priorityRank(b)
      if (rank) return rank
      const priority = positive(b.priority) - positive(a.priority)
      return priority || byDue(a, b)
    }
    return emergencyFirst(a, b) || byDue(a, b)
  })
}

/** Quick badges keep the search, sort and waiting toggle; everything else becomes the preset. */
export function applyQuickBadge(filters: QueueFilters, key: QuickBadgeKey): QueueFilters {
  const badge = QUICK_BADGES.find((row) => row.key === key) || QUICK_BADGES[0]
  return normalizeQueueFilters({ ...EMPTY_QUEUE_FILTERS, search: filters.search, sort: filters.sort, show_waiting: filters.show_waiting, ...badge.preset })
}

const QUICK_IGNORE: Array<keyof QueueFilters> = ["search", "sort", "show_waiting"]

/** Which quick badge the current filters are (null when a custom mix is active). */
export function activeQuickBadge(filters: QueueFilters): QuickBadgeKey | null {
  for (const badge of QUICK_BADGES) {
    if (queueFiltersEqual(filters, applyQuickBadge(filters, badge.key), QUICK_IGNORE)) return badge.key
  }
  return null
}

/** A saved view is "on" while its filters are the current ones (its own search/sort count only when it set them). */
export function viewMatchesFilters(viewFilters: unknown, current: QueueFilters) {
  const saved = normalizeQueueFilters(viewFilters)
  const ignore: Array<keyof QueueFilters> = ["show_waiting"]
  if (!saved.search) ignore.push("search")
  if (saved.sort === "due") ignore.push("sort")
  return queueFiltersEqual(saved, current, ignore)
}

export type FilterChip = { key: string; label: string; clear: (filters: QueueFilters) => QueueFilters }

function without<K extends "machines" | "customers" | "colours" | "sizes" | "flags">(key: K, value: string) {
  return (filters: QueueFilters): QueueFilters => ({ ...filters, [key]: (filters[key] as string[]).filter((item) => item !== value) } as QueueFilters)
}

const formatDay = (value: string | null) => {
  if (!value) return ""
  const [year, month, day] = value.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" })
}

/** The removable chips under the search box. The search box and sort are not chips. */
export function describeQueueFilters(filters: QueueFilters, labels: { machine: (id: string) => string }): FilterChip[] {
  const chips: FilterChip[] = []
  for (const id of filters.machines) chips.push({ key: `machine:${id}`, label: `Machine: ${id === "unassigned" ? "not selected" : labels.machine(id)}`, clear: without("machines", id) })
  if (filters.due !== "any") {
    const label =
      filters.due === "custom"
        ? `Due ${filters.due_from && filters.due_to ? `${formatDay(filters.due_from)} – ${formatDay(filters.due_to)}` : filters.due_from ? `from ${formatDay(filters.due_from)}` : filters.due_to ? `to ${formatDay(filters.due_to)}` : "between dates"}`
        : DUE_OPTIONS.find((option) => option.key === filters.due)?.label || "Due"
    chips.push({ key: "due", label, clear: (current) => ({ ...current, due: "any", due_from: null, due_to: null }) })
  }
  for (const name of filters.customers) chips.push({ key: `customer:${name}`, label: `Customer: ${name}`, clear: without("customers", name) })
  for (const colour of filters.colours) chips.push({ key: `colour:${colour}`, label: `Colour: ${colour}`, clear: without("colours", colour) })
  for (const size of filters.sizes) chips.push({ key: `size:${size}`, label: `Size: ${size}`, clear: without("sizes", size) })
  if (filters.qty_min !== null || filters.qty_max !== null) {
    const fmt = (value: number) => value.toLocaleString("en-IN")
    const label =
      filters.qty_min !== null && filters.qty_max !== null
        ? `Qty ${fmt(filters.qty_min)} – ${fmt(filters.qty_max)} pcs`
        : filters.qty_min !== null
          ? `Qty ≥ ${fmt(filters.qty_min)} pcs`
          : `Qty ≤ ${fmt(filters.qty_max as number)} pcs`
    chips.push({ key: "qty", label, clear: (current) => ({ ...current, qty_min: null, qty_max: null }) })
  }
  for (const flag of filters.flags) chips.push({ key: `flag:${flag}`, label: FLAG_OPTIONS.find((option) => option.key === flag)?.label || flag, clear: without("flags", flag) })
  if (!filters.show_waiting) chips.push({ key: "waiting", label: "Waiting cards hidden", clear: (current) => ({ ...current, show_waiting: true }) })
  return chips
}

/** Distinct values in the queue, for the pop-up's pick lists. */
export function queueFilterOptions(jobs: any[]) {
  return {
    customers: uniqueSorted(jobs.map(queueCustomer)),
    customerCodes: new Map(jobs.map((job) => [queueCustomer(job), text(job?.customer_code)])),
    colours: uniqueSorted(jobs.map(queueColour)),
    sizes: uniqueSorted(jobs.map(queueSize)),
  }
}

/** Key a queue card by the part on the board (one card can have several parts). */
export function queueKey(job: any) {
  return String(job?.segment_id || job?.active_segment_id || job?.job_card_id || job?.id || "")
}

/** Shift-click range: every card between the last click and this one (in the visible order), inclusive. */
export function rangeBetween(ids: string[], from: string | null, to: string) {
  const start = from ? ids.indexOf(from) : -1
  const end = ids.indexOf(to)
  if (start < 0 || end < 0) return [to]
  const [low, high] = start < end ? [start, end] : [end, start]
  return ids.slice(low, high + 1)
}

export const PLANNER_VIEW_MEMORY_PREFIX = "planner-view:v1"

export type PlannerViewMemory = { viewId?: string; quick?: QuickBadgeKey }

export function rememberPlannerView(scope: string, stage: string, memory: PlannerViewMemory) {
  try {
    localStorage.setItem(`${PLANNER_VIEW_MEMORY_PREFIX}:${scope}:${stage}`, JSON.stringify(memory))
  } catch {
    /* Preferences may be disabled; the view still applies for this visit. */
  }
}

export function recallPlannerView(scope: string, stage: string): PlannerViewMemory | null {
  try {
    const stored = JSON.parse(localStorage.getItem(`${PLANNER_VIEW_MEMORY_PREFIX}:${scope}:${stage}`) || "null")
    if (!stored || typeof stored !== "object") return null
    const memory: PlannerViewMemory = {}
    if (typeof stored.viewId === "string" && stored.viewId) memory.viewId = stored.viewId
    if (QUICK_BADGES.some((badge) => badge.key === stored.quick)) memory.quick = stored.quick
    return memory
  } catch {
    return null
  }
}
