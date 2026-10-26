import dayjs from "dayjs"
import {
  Activity,
  ArrowRightLeft,
  CheckCircle2,
  CircleDashed,
  CircleMinus,
  ClipboardCheck,
  Clock3,
  XCircle,
  type LucideIcon,
} from "lucide-react"

import type {
  OverviewLoad,
  OverviewMachine,
  OverviewSlot,
  PlanningOverview,
  RunMatch,
  Severity,
  ShiftCode,
  SlotResult,
  Stage,
} from "./types"

export type { Stage, ShiftCode, SlotResult, RunMatch, Severity } from "./types"

/* ───────────────────────── Stages & shifts ───────────────────────── */

export const STAGE_ORDER: Stage[] = ["SLITTING", "WINDER", "OVEN", "PROCESS"]
export const STAGE_LABEL: Record<Stage, string> = { SLITTING: "Slitting", WINDER: "Winding", OVEN: "Oven", PROCESS: "Process" }
/** Planner board section names (`/planning/board?section=…`). */
export const STAGE_SECTION: Record<Stage, string> = { SLITTING: "slitting", WINDER: "winder", OVEN: "oven", PROCESS: "process" }
export const SECTION_STAGE: Record<string, Stage> = { slitting: "SLITTING", winder: "WINDER", oven: "OVEN", process: "PROCESS" }
export const SHIFTS: ShiftCode[] = ["SHIFT_A", "SHIFT_B"]

export const stageLabel = (stage?: string | null) => (stage ? STAGE_LABEL[stage as Stage] || stage : "—")
export const shiftLabel = (code?: string | null) => (code ? String(code).replace("SHIFT_", "Shift ") : "—")
export const shiftShort = (code?: string | null) => (code ? String(code).replace("SHIFT_", "") : "—")
export const isStage = (value: string): value is Stage => (STAGE_ORDER as string[]).includes(value)

/* ───────────────────────── Result meta ───────────────────────── */

export type Tone = "blue" | "violet" | "emerald" | "amber" | "orange" | "rose" | "teal" | "neutral"

export const TONE: Record<Tone, { chip: string; soft: string; ink: string; line: string; bar: string; chart: string }> = {
  blue: { chip: "border-signal-blue-line bg-signal-blue-soft text-signal-blue-ink", soft: "bg-signal-blue-soft", ink: "text-signal-blue-ink", line: "border-signal-blue-line", bar: "bg-signal-blue-ink", chart: "hsl(var(--signal-blue-ink))" },
  violet: { chip: "border-signal-violet-line bg-signal-violet-soft text-signal-violet-ink", soft: "bg-signal-violet-soft", ink: "text-signal-violet-ink", line: "border-signal-violet-line", bar: "bg-signal-violet-ink", chart: "hsl(var(--signal-violet-ink))" },
  emerald: { chip: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink", soft: "bg-signal-emerald-soft", ink: "text-signal-emerald-ink", line: "border-signal-emerald-line", bar: "bg-signal-emerald-ink", chart: "hsl(var(--signal-emerald-ink))" },
  amber: { chip: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink", soft: "bg-signal-amber-soft", ink: "text-signal-amber-ink", line: "border-signal-amber-line", bar: "bg-signal-amber-ink", chart: "hsl(var(--signal-amber-ink))" },
  orange: { chip: "border-signal-orange-line bg-signal-orange-soft text-signal-orange-ink", soft: "bg-signal-orange-soft", ink: "text-signal-orange-ink", line: "border-signal-orange-line", bar: "bg-signal-orange-ink", chart: "hsl(var(--signal-orange-ink))" },
  rose: { chip: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink", soft: "bg-signal-rose-soft", ink: "text-signal-rose-ink", line: "border-signal-rose-line", bar: "bg-signal-rose-ink", chart: "hsl(var(--signal-rose-ink))" },
  teal: { chip: "border-signal-teal-line bg-signal-teal-soft text-signal-teal-ink", soft: "bg-signal-teal-soft", ink: "text-signal-teal-ink", line: "border-signal-teal-line", bar: "bg-signal-teal-ink", chart: "hsl(var(--signal-teal-ink))" },
  neutral: { chip: "border-border bg-muted text-muted-foreground", soft: "bg-muted", ink: "text-muted-foreground", line: "border-border", bar: "bg-muted-foreground", chart: "hsl(var(--muted-foreground))" },
}

export type ResultMeta = { label: string; short: string; tone: Tone; Icon: LucideIcon; hint: string }

/** Plain words for floor people. Colour always travels with a word and an icon. */
export const RESULT_META: Record<SlotResult, ResultMeta> = {
  UPCOMING: { label: "Upcoming", short: "Upcoming", tone: "blue", Icon: Clock3, hint: "The slot has not started yet." },
  IN_PROGRESS: { label: "Running now", short: "Running", tone: "violet", Icon: Activity, hint: "The shift is on and a run has been logged for this slot." },
  DONE: { label: "Done in slot", short: "Done", tone: "emerald", Icon: CheckCircle2, hint: "The floor made the planned quantity in this slot." },
  PARTLY: { label: "Partly done", short: "Partly", tone: "amber", Icon: CircleDashed, hint: "Some of the planned quantity was made in this slot." },
  MOVED: { label: "Ran on another day or shift", short: "Moved", tone: "orange", Icon: ArrowRightLeft, hint: "The floor ran this card and stage, but not in the planned slot." },
  NOT_RUN: { label: "Not run", short: "Not run", tone: "rose", Icon: XCircle, hint: "The slot passed and nothing was logged for it." },
  NOT_NEEDED: { label: "Not needed", short: "Not needed", tone: "neutral", Icon: CircleMinus, hint: "The stage finished before this slot." },
  FLOOR_PLACED: { label: "Logged before planning", short: "Floor placed", tone: "teal", Icon: ClipboardCheck, hint: "The floor logged this run before the planner placed it; the slot was made from the log." },
}
export const RESULT_ORDER: SlotResult[] = ["IN_PROGRESS", "NOT_RUN", "PARTLY", "MOVED", "UPCOMING", "DONE", "FLOOR_PLACED", "NOT_NEEDED"]
export const resultMeta = (result?: string | null): ResultMeta => RESULT_META[(result || "UPCOMING") as SlotResult] || RESULT_META.UPCOMING

export const MATCH_TONE: Record<RunMatch, Tone> = { ON_PLAN: "emerald", OTHER_MACHINE: "amber", OTHER_SHIFT: "amber", EARLY: "orange", LATE: "orange", UNPLANNED: "teal" }
export const SEVERITY_TONE: Record<Severity, Tone> = { high: "rose", medium: "amber", low: "blue" }
export const SEVERITY_LABEL: Record<Severity, string> = { high: "Urgent", medium: "Soon", low: "Note" }

/* ───────────────────────── Formatting ───────────────────────── */

export const isoDate = (date: Date | dayjs.Dayjs) => dayjs(date).format("YYYY-MM-DD")
export const addDays = (iso: string, days: number) => dayjs(iso).add(days, "day").format("YYYY-MM-DD")
export const fmtDay = (iso?: string | null) => (iso ? dayjs(iso).format("D MMM") : "—")
export const fmtDayLong = (iso?: string | null) => (iso ? dayjs(iso).format("ddd D MMM YYYY") : "—")
export const fmtDow = (iso?: string | null) => (iso ? dayjs(iso).format("ddd") : "")
export const fmtDateTime = (iso?: string | null) => (iso ? dayjs(iso).format("D MMM HH:mm") : "—")
export const fmtClock = (iso?: string | null) => (iso && String(iso).includes("T") ? dayjs(iso).format("HH:mm") : "")
export const fmtNum = (value?: number | null, digits = 0) =>
  value == null || !Number.isFinite(Number(value)) ? "—" : Number(value).toLocaleString("en-IN", { maximumFractionDigits: digits })
export const fmtPct = (value?: number | null, digits = 0) => (value == null || !Number.isFinite(Number(value)) ? "—" : `${Number(value).toLocaleString("en-IN", { maximumFractionDigits: digits })}%`)
export const fmtQty = (value?: number | null, unit?: string | null) => `${fmtNum(value, 1)}${unit ? ` ${unitLabel(unit)}` : ""}`
export const unitLabel = (unit?: string | null) => {
  const u = String(unit || "").toUpperCase()
  if (u === "METERS_PER_DAY" || u === "METERS" || u === "M") return "m"
  if (u === "BAMBOOS_PER_DAY" || u === "BAMBOO" || u === "BAMBOOS") return "bamboo"
  if (u === "TUBES_PER_DAY" || u === "PCS" || u === "TUBES" || u === "PIECES") return "pcs"
  return unit || ""
}
export const plural = (count: number, one: string, many = `${one}s`) => `${fmtNum(count)} ${count === 1 ? one : many}`

/** "in 32 h", "in 45 min", "any moment now" — from the slot's requeue_at against the clock. */
export function requeueCountdown(slot: Pick<OverviewSlot, "requeue_at" | "hours_to_requeue">, now: Date): { hours: number; text: string } | null {
  let hours: number | null = null
  if (slot.requeue_at) hours = (new Date(slot.requeue_at).getTime() - now.getTime()) / 3_600_000
  else if (slot.hours_to_requeue != null) hours = Number(slot.hours_to_requeue)
  if (hours == null || !Number.isFinite(hours)) return null
  if (hours <= 0.05) return { hours, text: "any moment now" }
  if (hours < 1) return { hours, text: `in ${Math.max(1, Math.round(hours * 60))} min` }
  if (hours < 10) return { hours, text: `in ${hours.toFixed(1).replace(/\.0$/, "")} h` }
  return { hours, text: `in ${Math.round(hours)} h` }
}

export const isSilentSlot = (slot: OverviewSlot) => slot.result === "NOT_RUN" && (slot.requeue_at != null || slot.hours_to_requeue != null)

export const dueTone = (due?: string | null, today?: string): Tone => {
  if (!due) return "neutral"
  const diff = dayjs(due).diff(dayjs(today || undefined), "day")
  if (diff < 0) return "rose"
  if (diff <= 3) return "amber"
  return "neutral"
}

/* ───────────────────────── Links ───────────────────────── */

export const cardHref = (jobCardId: string) => `/production/job-cards/${jobCardId}`

export function boardHref(input: { stage?: string | null; plan_date?: string | null; job_card_id?: string | null; machine_id?: string | null; shift_code?: string | null }) {
  const params = new URLSearchParams()
  params.set("section", STAGE_SECTION[(input.stage || "WINDER") as Stage] || "winder")
  if (input.plan_date) params.set("plan_date", input.plan_date)
  params.set("view", "schedule")
  if (input.job_card_id) params.set("job_card_id", input.job_card_id)
  if (input.machine_id) params.set("machine_id", input.machine_id)
  if (input.shift_code) params.set("shift", input.shift_code)
  return `/planning/board?${params.toString()}`
}

export type PrintSelection = {
  stages: Stage[]
  from: string
  to: string
  machines: string[] // empty = all
  shifts: ShiftCode[] // empty = both
  slots: string[] // empty = every slot that matches
}

export function printHref(selection: PrintSelection) {
  const params = new URLSearchParams()
  params.set("stages", (selection.stages.length ? selection.stages : STAGE_ORDER).join(","))
  params.set("date_from", selection.from)
  params.set("date_to", selection.to)
  if (selection.machines.length) params.set("machines", selection.machines.join(","))
  if (selection.shifts.length && selection.shifts.length < SHIFTS.length) params.set("shifts", selection.shifts.join(","))
  if (selection.slots.length) params.set("slots", selection.slots.join(","))
  return `/planning/print?${params.toString()}`
}

/* ───────────────────────── Period presets & URL state ───────────────────────── */

export type PeriodKey = "window" | "yesterday" | "today" | "tomorrow" | "next3" | "week" | "next7" | "custom"
export const PERIODS: { key: PeriodKey; label: string; hint: string; range: (today: string) => [string, string] }[] = [
  { key: "window", label: "Yesterday → +5 days", hint: "The standard planning window", range: (t) => [addDays(t, -1), addDays(t, 5)] },
  { key: "yesterday", label: "Yesterday", hint: "What ran and what did not", range: (t) => [addDays(t, -1), addDays(t, -1)] },
  { key: "today", label: "Today", hint: "Both shifts today", range: (t) => [t, t] },
  { key: "tomorrow", label: "Tomorrow", hint: "Both shifts tomorrow", range: (t) => [addDays(t, 1), addDays(t, 1)] },
  { key: "next3", label: "Next 3 days", hint: "Today and the two days after", range: (t) => [t, addDays(t, 2)] },
  { key: "week", label: "This week", hint: "Monday to Sunday", range: (t) => { const start = dayjs(t).subtract((dayjs(t).day() + 6) % 7, "day"); return [isoDate(start), isoDate(start.add(6, "day"))] } },
  { key: "next7", label: "Next 7 days", hint: "Today and six days ahead", range: (t) => [t, addDays(t, 6)] },
]
export const MAX_RANGE_DAYS = 62

export type OverviewView = "timeline" | "table"
export type OverviewState = {
  period: PeriodKey
  from: string
  to: string
  stages: Stage[]
  machine: string
  shift: "" | ShiftCode
  q: string
  view: OverviewView
}

export function resolveRange(state: Pick<OverviewState, "period" | "from" | "to">, today: string): [string, string] {
  if (state.period !== "custom") {
    const preset = PERIODS.find((p) => p.key === state.period) || PERIODS[0]
    return preset.range(today)
  }
  let from = dayjs(state.from).isValid() ? state.from : today
  let to = dayjs(state.to).isValid() ? state.to : from
  if (dayjs(to).isBefore(from)) to = from
  if (dayjs(to).diff(from, "day") >= MAX_RANGE_DAYS) to = addDays(from, MAX_RANGE_DAYS - 1)
  from = dayjs(from).format("YYYY-MM-DD")
  return [from, to]
}

export function parseState(params: URLSearchParams | null | undefined): OverviewState {
  const get = (key: string) => String(params?.get(key) || "")
  const periodRaw = get("period")
  const hasCustom = Boolean(get("from") || get("to"))
  const period: PeriodKey = (PERIODS.some((p) => p.key === periodRaw) ? periodRaw : periodRaw === "custom" || hasCustom ? "custom" : "window") as PeriodKey
  const stages = get("stages").split(",").map((s) => s.trim().toUpperCase()).filter(isStage)
  const shiftRaw = get("shift").toUpperCase()
  return {
    period,
    from: get("from"),
    to: get("to"),
    stages,
    machine: get("machine"),
    shift: shiftRaw === "SHIFT_A" || shiftRaw === "SHIFT_B" ? shiftRaw : "",
    q: get("q"),
    view: get("view") === "table" ? "table" : "timeline",
  }
}

export function stateToQuery(state: OverviewState) {
  const params = new URLSearchParams()
  if (state.period !== "window") params.set("period", state.period)
  if (state.period === "custom") {
    if (state.from) params.set("from", state.from)
    if (state.to) params.set("to", state.to)
  }
  if (state.stages.length && state.stages.length < STAGE_ORDER.length) params.set("stages", state.stages.join(","))
  if (state.machine) params.set("machine", state.machine)
  if (state.shift) params.set("shift", state.shift)
  if (state.q) params.set("q", state.q)
  if (state.view !== "timeline") params.set("view", state.view)
  return params.toString()
}

/* ───────────────────────── Derived data ───────────────────────── */

export const loadKey = (machineId: string, date: string, shift: string) => `${machineId}|${date}|${shift}`

export function machineMap(machines: OverviewMachine[] | undefined) {
  return new Map((machines || []).map((m) => [String(m.id), m]))
}

export const machineName = (machines: Map<string, OverviewMachine>, id?: string | null) =>
  (id && (machines.get(String(id))?.name || machines.get(String(id))?.code)) || (id ? String(id).slice(0, 8) : "—")

export function slotMatchesSearch(slot: OverviewSlot, needle: string) {
  if (!needle) return true
  const hay = [slot.job_card_no, slot.customer_name, slot.customer_code, slot.sales_order_no, slot.po_number, slot.product_size_label, slot.parchment_color]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  return needle
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term))
}

export function filterSlots(slots: OverviewSlot[], state: Pick<OverviewState, "stages" | "machine" | "shift" | "q">) {
  const stages = state.stages.length ? new Set(state.stages) : null
  const needle = state.q.trim()
  return slots.filter(
    (slot) =>
      (!stages || stages.has(slot.stage)) &&
      (!state.machine || String(slot.machine_id) === state.machine) &&
      (!state.shift || slot.shift_code === state.shift) &&
      slotMatchesSearch(slot, needle),
  )
}

/** Shift that is on the clock right now: Shift A 08–20 on the same date, Shift B 20–08 belongs to the date it started. */
export function currentShift(now: Date): { date: string; shift: ShiftCode } {
  const hour = now.getHours()
  const date = isoDate(now)
  if (hour < 8) return { date: addDays(date, -1), shift: "SHIFT_B" }
  if (hour < 20) return { date, shift: "SHIFT_A" }
  return { date, shift: "SHIFT_B" }
}

export type TimelineColumn = { key: string; date: string; shift: ShiftCode; closed: boolean; isToday: boolean; isNow: boolean }
export type TimelineCell = { slots: OverviewSlot[]; load: OverviewLoad | null }
export type TimelineRow = { machine: OverviewMachine; cells: Map<string, TimelineCell>; slotCount: number; peakPct: number }
export type TimelineGroup = { stage: Stage; label: string; rows: TimelineRow[]; slotCount: number }
export type TimelineModel = {
  days: { date: string; closed: boolean; isToday: boolean }[]
  columns: TimelineColumn[]
  groups: TimelineGroup[]
}

export function buildTimeline(data: PlanningOverview, slots: OverviewSlot[], state: Pick<OverviewState, "stages" | "machine" | "shift">, now: Date): TimelineModel {
  const closed = new Set(data.closed_days || [])
  const live = currentShift(now)
  const days = (data.days || []).map((date) => ({ date, closed: closed.has(date), isToday: date === data.today }))
  const shifts = state.shift ? [state.shift] : SHIFTS
  const columns: TimelineColumn[] = days.flatMap((day) =>
    shifts.map((shift) => ({ key: `${day.date}|${shift}`, date: day.date, shift, closed: day.closed, isToday: day.isToday, isNow: live.date === day.date && live.shift === shift })),
  )
  const stages = state.stages.length ? state.stages : STAGE_ORDER
  const loads = new Map((data.load || []).map((row) => [loadKey(row.machine_id, row.plan_date, row.shift_code), row]))
  const slotsByCell = new Map<string, OverviewSlot[]>()
  for (const slot of slots) {
    const key = loadKey(slot.machine_id, slot.plan_date, slot.shift_code)
    const list = slotsByCell.get(key)
    if (list) list.push(slot)
    else slotsByCell.set(key, [slot])
  }
  const groups: TimelineGroup[] = []
  for (const stage of STAGE_ORDER) {
    if (!stages.includes(stage)) continue
    const machines = (data.machines || [])
      .filter((m) => m.stage === stage && (!state.machine || String(m.id) === state.machine))
      .sort((a, b) => String(a.name || a.code).localeCompare(String(b.name || b.code)))
    const rows: TimelineRow[] = machines.map((machine) => {
      const cells = new Map<string, TimelineCell>()
      let slotCount = 0
      let peakPct = 0
      for (const column of columns) {
        const key = loadKey(machine.id, column.date, column.shift)
        const cellSlots = (slotsByCell.get(key) || []).slice().sort((a, b) => a.part_no - b.part_no || a.job_card_no.localeCompare(b.job_card_no))
        const load = loads.get(key) || null
        slotCount += cellSlots.length
        if (load?.pct != null) peakPct = Math.max(peakPct, Number(load.pct))
        cells.set(column.key, { slots: cellSlots, load })
      }
      return { machine, cells, slotCount, peakPct }
    })
    if (!rows.length && !(data.machines || []).some((m) => m.stage === stage)) continue
    groups.push({ stage, label: STAGE_LABEL[stage], rows, slotCount: rows.reduce((sum, row) => sum + row.slotCount, 0) })
  }
  return { days, columns, groups }
}

/* ───────────────────────── Excel ───────────────────────── */

export async function downloadWorkbook(build: (workbook: import("exceljs").Workbook) => void, filename: string) {
  const ExcelJS = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  build(workbook)
  const buffer = await workbook.xlsx.writeBuffer()
  const link = document.createElement("a")
  link.href = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }))
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

export function slotRow(slot: OverviewSlot, machines: Map<string, OverviewMachine>) {
  return [
    slot.job_card_no,
    slot.customer_name || "",
    slot.customer_code || "",
    slot.sales_order_no || "",
    slot.po_number || "",
    stageLabel(slot.stage),
    machineName(machines, slot.machine_id),
    slot.plan_date,
    shiftLabel(slot.shift_code),
    slot.parts > 1 ? `${slot.part_no}/${slot.parts}` : "",
    Number(slot.planned_qty || 0),
    unitLabel(slot.unit),
    Number(slot.planned_pcs || 0),
    Number(slot.made_in_slot || 0),
    Number(slot.made_elsewhere || 0),
    resultMeta(slot.result).label,
    slot.product_size_label || "",
    slot.parchment_color || "",
    slot.due_date || "",
    slot.is_emergency ? "Yes" : "",
    slot.requeue_at || "",
  ]
}
export const SLOT_HEADERS = ["Job card", "Customer", "Customer code", "Sales order", "PO", "Stage", "Machine", "Date", "Shift", "Part", "Planned qty", "Unit", "Planned pcs", "Made in slot", "Made elsewhere", "Result", "Size", "Colour", "Due", "Emergency", "Goes back to queue at"]
