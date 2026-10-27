"use client"

// Shared words, rules and small helpers for the job card page, the floor forms and the QC desk.
// The backend enforces every rule; this file explains them in the same terms on every screen.

import { useMemo } from "react"
import { CheckCircle2, Flame, Package, Scissors, SlidersHorizontal, Truck, Wind, type LucideIcon } from "lucide-react"

import { useAuth } from "@/context/AuthContext"
import { displayStageRule } from "@/lib/qc-measurement"
import { OPTIONAL_QC_CODES } from "../SeasonQcMatrix"

export const STAGE_ORDER = ["SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING", "QC", "DISPATCH"]
export const STAGE_LABEL: Record<string, string> = { SLITTING: "Slitting", WINDER: "Winding", OVEN: "Oven", PROCESS: "Process", PACKING: "Packing", QC: "Final QC", DISPATCH: "Dispatch" }
export const STAGE_ICON: Record<string, LucideIcon> = { SLITTING: Scissors, WINDER: Wind, OVEN: Flame, PROCESS: SlidersHorizontal, PACKING: Package, QC: CheckCircle2, DISPATCH: Truck }
export const stageLabel = (stage: string) => STAGE_LABEL[stage] || (stage ? stage.charAt(0) + stage.slice(1).toLowerCase() : "")
/** Stages the floor logs runs on. Slitting has its own record, Final QC and Dispatch are system steps. */
export const LOGGABLE_STAGES = new Set(["WINDER", "OVEN", "PROCESS", "PACKING"])

export const REJECT_CODES: [string, string][] = [
  ["WL", "Winding loose"],
  ["PG", "Pasting / glue"],
  ["ID", "I.D. out"],
  ["OD", "O.D. out"],
  ["LN", "Length out"],
  ["WT", "Weight out"],
  ["CS", "C.S. low"],
  ["DM", "Damage / dent"],
  ["MS", "Moisture"],
  ["NT", "Notch"],
  ["OT", "Other"],
]
export const rejectCodeText = (code: string) => REJECT_CODES.find(([c]) => c === code)?.[1] || ""

export const machineLabelFor = (stage: string) => (stage === "WINDER" ? "Winder no." : stage === "OVEN" ? "Oven no." : stage === "PROCESS" ? "Line no." : stage === "PACKING" ? "Packing table" : "Machine")
export const helperLabelFor = (stage: string) => (stage === "WINDER" ? "Pattiwala" : stage === "PROCESS" ? "Packing name" : "Helper")

export const fmt = (value: any, digits = 1) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })
export const count = (value: string) => (value === "" ? 0 : Math.max(0, Math.floor(Number(value) || 0)))
export const dayLabel = (value: any) => (value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—")
export const shiftLabel = (value: any) => (value ? String(value).replace("SHIFT_", "Shift ") : "")
export const stampLabel = (value: any) => {
  if (!value) return ""
  const text = String(value)
  const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(text) ? text : `${text}Z`)
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}
/** The local day of a server timestamp (naive timestamps are UTC), e.g. "27 Oct". */
export const stampDay = (value: any) => {
  if (!value) return ""
  const text = String(value)
  const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(text) ? text : `${text}Z`)
  return Number.isNaN(date.getTime()) ? dayLabel(text) : date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })
}
export const today = () => new Date().toLocaleDateString("en-CA")
export const yesterday = () => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toLocaleDateString("en-CA")
}
export const clockShift = () => {
  const hour = new Date().getHours()
  return hour >= 8 && hour < 20 ? "SHIFT_A" : "SHIFT_B"
}
// "HH:MM" on the business date; an end time before the start is the next morning (night shift).
export const stamp = (day: string, time: string, after?: string) => {
  if (!day || !time) return null
  if (after && time < after) {
    const next = new Date(`${day}T00:00:00`)
    next.setDate(next.getDate() + 1)
    return `${next.toLocaleDateString("en-CA")}T${time}`
  }
  return `${day}T${time}`
}
export const clockOf = (value: any) => (value ? String(value).slice(11, 16) : "")
export const cycleText = (start: string | null, end: string | null) => {
  if (!start || !end) return ""
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return ""
  const minutes = Math.round(ms / 60000)
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`
}
export const remembered = (key: string) => {
  try {
    return window.localStorage.getItem(key) || ""
  } catch {
    return ""
  }
}
export const remember = (key: string, value: string) => {
  try {
    if (value) window.localStorage.setItem(key, value)
  } catch {}
}
export const memoryKey = (card: any, stage: string, what: string) => `hariom-floor-${what}:${card?.plant_id}:${stage}`

/** Who may do what on a card (client 2026-10-27: operators enter output and QC; supervisors submit, void, close). */
export function useCardRoles() {
  const { user } = useAuth()
  return useMemo(() => {
    const roles = new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[])
    const canSubmit = ["Owner", "Admin", "PlantManager"].some((r) => roles.has(r))
    return {
      roles,
      canSubmit,
      canReopen: ["Owner", "Admin"].some((r) => roles.has(r)),
      canQc: canSubmit || ["QC", "InProcessQC", "Operator"].some((r) => roles.has(r)),
      canDraft: canSubmit || roles.has("Operator"),
    }
  }, [user?.role, user?.roles])
}

/**
 * Process is the last floor step (client rule 2026-10-18): Packing and Final QC are system steps closed
 * with Process, so they are hidden. An older card already packing on the floor keeps its Packing stage,
 * and a card whose Packing closed before this rule shows Final QC to complete.
 */
export function visibleStages(flow: any): any[] {
  const all: any[] = flow?.stages || []
  const packing = all.find((s: any) => s.stage === "PACKING")
  return all.filter((s: any) => {
    if (s.stage === "PACKING") return !s.system_step
    if (s.stage === "QC") return s.status !== "COMPLETED" && packing?.status === "COMPLETED"
    return true
  })
}

export const stageState = (flow: any, stage: string) => (flow?.stages || []).find((s: any) => s.stage === stage)
export const previousStage = (stages: any[], stage: string) => stages[stages.findIndex((s: any) => s.stage === stage) - 1]?.stage as string | undefined
/** The stage the floor is on now: the first open loggable stage (with Final QC when it is the one left). */
export function currentFloorStage(stages: any[]): any | undefined {
  return stages.find((s: any) => s.status !== "COMPLETED" && (LOGGABLE_STAGES.has(s.stage) || s.stage === "QC"))
}
export const isLoggable = (state: any) => Boolean(state) && state.status !== "COMPLETED" && LOGGABLE_STAGES.has(state.stage)

/** QC checks of a stage as frozen on this card, in display words. */
export function stageParameters(card: any, stage: string): any[] {
  const rules: any[] = card?.spec_snapshot?.qc_profile?.stages?.[stage]?.parameters || []
  return rules.filter((r: any) => r.applicable).map((r: any) => displayStageRule(stage, r))
}
export const requiredReadings = (rule: any) => Math.max(2, Number(rule?.min_readings || 0))
/** Always offer at least as many sample columns as the strictest check needs (two by default). */
export function padSamples(list: any[], parameters: any[]) {
  const need = Math.max(2, ...parameters.map((r: any) => requiredReadings(r)))
  return [...list, ...Array.from({ length: Math.max(0, need - list.length) }, (_, i) => ({ sample_id: `${crypto.randomUUID()}-${list.length + i + 1}`, readings: {} }))]
}
export const filledSamples = (samples: any[]) =>
  samples
    .filter((s) => Object.values(s.readings || {}).some((v) => v !== "" && v != null))
    .map((s) => ({ ...s, readings: Object.fromEntries(Object.entries(s.readings).filter(([, v]) => v !== "" && v != null)) }))
/** Required checks (moisture is optional) with fewer typed readings than the minimum 2. */
export const shortChecks = (parameters: any[], filled: any[]) =>
  parameters
    .filter((rule: any) => !OPTIONAL_QC_CODES.has(rule.code))
    .filter((rule: any) => filled.filter((sample: any) => sample.readings?.[rule.code] !== undefined).length < requiredReadings(rule))

/** Same rule as the server: required checks on a saved run with fewer than 2 readings. */
export function qcReadingsShort(card: any, entry: any): Array<{ parameter: string; label: string; have: number; need: number }> {
  if (Array.isArray(entry?.qc_readings_short)) return entry.qc_readings_short
  if (entry?.evaluation?.covered_by_entry) return []
  const parameters = stageParameters(card, entry?.stage)
  const counts: Record<string, number> = {}
  for (const r of entry?.evaluation?.results || []) {
    if (["PASS", "FAIL", "OBSERVATION_ONLY"].includes(r.verdict)) counts[r.parameter] = (counts[r.parameter] || 0) + 1
  }
  return parameters
    .filter((p: any) => !OPTIONAL_QC_CODES.has(p.code))
    .map((p: any) => ({ parameter: p.code, label: p.label || p.code, have: counts[p.code] || 0, need: requiredReadings(p) }))
    .filter((row) => row.have < row.need)
}

export type RunQcState = {
  key: "draft" | "void" | "qc_only" | "no_qc" | "due" | "short" | "flagged" | "done"
  label: string
  tone: "amber" | "emerald" | "rose" | "muted"
  detail?: string
  flags: any[]
  /** The run's QC is recorded with the minimum readings: the next stage may take it (flagged or not). */
  accepted: boolean
}

/** A band in words: "76.2–76.5", "≥ 400", "≤ 12". */
const limit = (n: any) => (typeof n === "number" && Number.isFinite(n) ? Number(n.toFixed(3)) : n)
export const bandText = (min: any, max: any) => (min != null && max != null ? `${limit(min)}–${limit(max)}` : min != null ? `≥ ${limit(min)}` : max != null ? `≤ ${limit(max)}` : "no band")
export const flagText = (flag: any) => `${flag?.label || flag?.parameter || "Reading"} ${flag?.value ?? "—"}${flag?.unit ? ` ${flag.unit}` : ""} (band ${bandText(flag?.min, flag?.max)})`

/** "Still needed: the operator, 2 readings for C.S." — one full stop even when the last item ends with one. */
export const neededText = (items: string[]) => {
  const body = items.join(", ")
  return `Still needed: ${body}${body.endsWith(".") ? "" : "."}`
}

/** Run number with its stage letter, as written on the printed card: W#1, O#2, P#1, K#1. */
export const runNo = (entry: any) => `${({ WINDER: "W", OVEN: "O", PROCESS: "P", PACKING: "K", QC: "Q" } as Record<string, string>)[entry?.stage] || ""}#${entry?.entry_no ?? ""}`

/** Runs of a stage that still need QC before the next stage can take them (drafts included). */
export const runsWithoutQc = (card: any, entries: any[], stage: string) =>
  entries.filter((e) => e.stage === stage && ["SUBMITTED", "DRAFT"].includes(e.status) && e.kind !== "QC_ONLY" && stageParameters(card, stage).length > 0 && !runQcState(card, e).accepted)

/** When a run was made: its business date, or (QC without a run) the day it was logged. */
export const runDay = (entry: any) => (entry?.business_date ? dayLabel(entry.business_date) : stampDay(entry?.created_at))

/** One QC state per run, in words (out of band is flagged, never held — client 2026-10-27). */
export function runQcState(card: any, entry: any): RunQcState {
  const flags: any[] = Array.isArray(entry?.qc_flags) ? entry.qc_flags : []
  if (entry?.status === "DRAFT") return { key: "draft", label: flags.length ? "Draft · QC flagged" : entry?.samples?.length ? "Draft · QC recorded" : "Draft", tone: "amber", detail: flags.length ? flags.map(flagText).join(" · ") : "Counts once the supervisor submits it", flags, accepted: false }
  if (entry?.status === "VOID") return { key: "void", label: "Void", tone: "muted", flags, accepted: false }
  const verdict = entry?.evaluation?.verdict
  if (entry?.kind === "QC_ONLY") {
    return flags.length
      ? { key: "flagged", label: `Flagged · ${flags.map(flagText).join(" · ")}`, tone: "amber", flags, accepted: true }
      : { key: "qc_only", label: "QC without a run", tone: "muted", flags, accepted: true }
  }
  const parameters = stageParameters(card, entry?.stage)
  if (!parameters.length) return { key: "no_qc", label: "No QC on this stage", tone: "muted", flags, accepted: true }
  if (!entry?.samples?.length && !entry?.evaluation?.covered_by_entry) return { key: "due", label: "QC due", tone: "amber", detail: "No readings yet", flags, accepted: false }
  const short = qcReadingsShort(card, entry)
  if (short.length) return { key: "short", label: `Needs more readings: ${short.map((r) => `${r.label} ${r.have}/${r.need}`).join(", ")}`, tone: "amber", flags, accepted: false }
  if (verdict === "FAIL" || flags.length) return { key: "flagged", label: `Flagged · ${flags.map(flagText).join(" · ") || "reading outside the band"}`, tone: "amber", detail: "Accepted and flagged — the next stage can take it", flags, accepted: true }
  return { key: "done", label: "QC done", tone: "emerald", flags, accepted: true }
}

export const toneClass = (tone: RunQcState["tone"] | "blue" | "violet") =>
  tone === "emerald"
    ? "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink"
    : tone === "amber"
      ? "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink"
      : tone === "rose"
        ? "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink"
        : tone === "blue"
          ? "border-signal-blue-line bg-signal-blue-soft text-signal-blue-ink"
          : tone === "violet"
            ? "border-signal-violet-line bg-signal-violet-soft text-signal-violet-ink"
            : "border-border bg-muted text-muted-foreground"

export type PlanMatch = { label: string; tone: "emerald" | "amber" | "muted" }
/** Where a run lands against the plan (planning never blocks the floor; the slot is matched by date and shift). */
export function planMatchFor(state: any, businessDate: string, shift: string, machineId?: string): PlanMatch {
  const slots: any[] = (state?.segments || []).filter((s: any) => !["CANCELLED"].includes(s.status) && s.plan_date && s.shift_code)
  if (!slots.length) return { label: "Run before planning — no slot for this stage yet", tone: "muted" }
  const same = slots.find((s: any) => String(s.plan_date).slice(0, 10) === businessDate && s.shift_code === shift)
  if (same) {
    return !machineId || !same.machine_id || String(same.machine_id) === String(machineId)
      ? { label: `As planned · ${dayLabel(businessDate)} · ${shiftLabel(shift)}`, tone: "emerald" }
      : { label: "Planned shift, other machine", tone: "amber" }
  }
  const sameDay = slots.find((s: any) => String(s.plan_date).slice(0, 10) === businessDate)
  if (sameDay) return { label: `Same day, other shift — planned ${shiftLabel(sameDay.shift_code)}`, tone: "amber" }
  const ms = new Date(`${businessDate}T00:00:00`).getTime()
  const nearest = [...slots].sort((a, b) => Math.abs(new Date(`${String(a.plan_date).slice(0, 10)}T00:00:00`).getTime() - ms) - Math.abs(new Date(`${String(b.plan_date).slice(0, 10)}T00:00:00`).getTime() - ms))[0]
  const days = Math.round((ms - new Date(`${String(nearest.plan_date).slice(0, 10)}T00:00:00`).getTime()) / 86400000)
  if (!Number.isFinite(days) || days === 0) return { label: `Planned ${dayLabel(nearest.plan_date)} · ${shiftLabel(nearest.shift_code)}`, tone: "amber" }
  return days > 0
    ? { label: `${days} day${days === 1 ? "" : "s"} later than plan (${dayLabel(nearest.plan_date)} · ${shiftLabel(nearest.shift_code)})`, tone: "amber" }
    : { label: `${-days} day${days === -1 ? "" : "s"} earlier than plan (${dayLabel(nearest.plan_date)})`, tone: "amber" }
}

/** Plan match for a saved run: the planner's own label when the plan API has it, else matched here. */
export function savedRunPlanMatch(entry: any, state: any, planRuns?: any[]): PlanMatch {
  if (entry?.details?.unscheduled_entry) return { label: "Run before planning", tone: "muted" }
  const planned = planRuns?.find((run: any) => String(run.key || "") === `e:${entry?.id}`)
  if (planned?.match_label) return { label: planned.match_label, tone: planned.match === "ON_PLAN" ? "emerald" : planned.match === "UNPLANNED" ? "muted" : "amber" }
  if (!entry?.business_date) return { label: "—", tone: "muted" }
  return planMatchFor(state, String(entry.business_date).slice(0, 10), entry.shift_code, entry.machine_id)
}

export const verdictLabels: Record<string, string> = { NOT_MEASURED: "QC readings due", OBSERVATION_ONLY: "Recorded", PASS: "QC pass", FAIL: "Flagged", INCOMPLETE: "QC incomplete", INVALID: "QC invalid" }
export const verdictLabel = (value: string) => verdictLabels[value] || "QC readings due"

/** Card facts shown on every screen, from the card detail. */
export function cardFacts(card: any) {
  const header = card?.document_snapshot?.header || {}
  const snap = card?.spec_snapshot || {}
  const qty = Number(card?.released_qty || card?.planned_qty || 0)
  const pcsPerBamboo = Number(header.pcs_per_bamboo || snap.pcs_per_bamboo || 0)
  const bamboo = Number(header.target_bamboo_count || (pcsPerBamboo ? Math.ceil(qty / pcsPerBamboo) : 0))
  return {
    no: card?.job_card_no || card?.job_card_ref || (card?.id ? `JC-${String(card.id).slice(0, 8).toUpperCase()}` : "—"),
    customer: header.customer_name || snap.customer_name_snapshot || card?.customer_name || "—",
    customerCode: header.customer_code || snap.customer_code || "",
    orderNo: card?.sales_order?.order_no || snap.sales_order_order_no || header.sales_order_no || card?.sales_order_ref || "",
    orderId: card?.sales_order_id || card?.sales_order?.id || "",
    lineNo: snap.sales_order_line_no,
    po: header.po_number || snap.sales_order_po_number || "",
    due: card?.sales_order?.due_date || snap.sales_order_line_due_date || "",
    size: header.product_size_label || snap.sales_order_line_size_label || "",
    colour: header.color || header.approved_parchment_color || snap.parchment_color || snap.sales_order_line_parchment_color || "",
    product: header.product_code || card?.product_code || "",
    qty,
    pcsPerBamboo,
    bamboo,
    bambooLength: Number(header.selected_bamboo_length_mm || snap.selected_bamboo_length_mm || 0),
    lot: header.lot_number || snap.lot_number || "",
    priority: snap.priority || card?.sales_order?.priority || "",
    releasedAt: card?.created_at,
    isV2: snap.entry_model === "V2",
    open: !["COMPLETED", "CANCELLED"].includes(String(card?.status || "").toUpperCase()),
  }
}
