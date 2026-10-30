"use client"

/**
 * Job card management actions (client 2026-10-27): Split into a new card, Edit qty / colour,
 * Emergency insert, Force close and Cancel card. One implementation for the lifecycle sheet and the
 * Job card manager: each action is a focused step with a live "what will happen" preview, the
 * reason the audit needs, a confirm summary and a success state with links. The backend holds the
 * rules; this file only explains them in plain words.
 */

import Link from "next/link"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, Ban, CalendarClock, Check, ChevronLeft, ExternalLink, Eye, Flame, LoaderCircle, Pencil, Printer, Scissors, ShoppingCart, Undo2, type LucideIcon } from "lucide-react"

import { useApp } from "@/context/AppContext"
import { useParchments } from "@/hooks/use-master-data"
import { apiErrorText, newRequestId, useAmendJobCard, useEmergencyInsert, useForceCloseJobCard, useSplitJobCard, type JobCardLifecycle } from "@/hooks/use-lifecycle"
import { productionApi } from "@/lib/api"
import { dayText, shiftText, stageWord } from "@/lib/job-card-tracking"
import { cn } from "@/lib/utils"
import { addDays, istToday } from "@/lib/shift"

export type LifecycleAction = "split" | "edit" | "emergency" | "force_close" | "cancel"

export const fmt = (value: number | null | undefined, digits = 0) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })

export const inputClass = "h-10 w-full rounded-lg border border-input bg-card px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60"

export function Field({ label, children, hint, required }: { label: string; children: ReactNode; hint?: string; required?: boolean }) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className="text-[12px] font-medium text-muted-foreground">
        {label}
        {required ? <span className="ml-1 text-signal-rose-ink" aria-hidden="true">*</span> : null}
      </span>
      {children}
      {hint ? <span className="block text-[11.5px] text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

export function isBatchEntry(entryModel?: string | null) {
  return String(entryModel || "").toUpperCase() === "V2"
}

export function machineLabelOf(machines: any[], id?: string | null) {
  if (!id) return ""
  const row = (machines || []).find((machine: any) => String(machine.id) === String(id))
  return String(row?.code || row?.name || "").trim() || `machine ${String(id).slice(0, 6)}`
}

export function unitWord(data: Pick<JobCardLifecycle, "pcs_per_bamboo">, pcs: number) {
  return data.pcs_per_bamboo ? `${fmt(pcs)} pcs · ${fmt(Math.ceil(pcs / data.pcs_per_bamboo))} bamboo` : `${fmt(pcs)} pcs`
}

export type ActionInfo = {
  key: LifecycleAction
  label: string
  icon: LucideIcon
  hint: string
  allowed: boolean
  /** Exactly why the action is not available right now (plain words), or null. */
  why: string | null
  danger?: boolean
  /** Where to go instead when the action is locked (e.g. Close stage on the job card page). */
  instead?: { label: string; href: string } | null
}

function closedWord(state: string) {
  return state === "COMPLETED" ? "done" : state === "CANCELLED" ? "cancelled" : "force-closed"
}

/** The lifecycle state in plain words (queued, scheduled, running, done, force-closed, cancelled). */
export function stateWord(state: string) {
  return ({ QUEUED: "queued", SCHEDULED: "scheduled", RUNNING: "running", COMPLETED: "done", FORCE_CLOSED: "force-closed", CANCELLED: "cancelled" } as Record<string, string>)[state] || state.toLowerCase().replace(/_/g, " ")
}

/** Which management actions this card allows now, and exactly why the others are not available. */
export function actionAvailability(data: JobCardLifecycle, entryModel?: string | null): ActionInfo[] {
  const closed = ["COMPLETED", "FORCE_CLOSED", "CANCELLED"].includes(data.state)
  const closedWhy = `Card is ${closedWord(data.state)}: nothing more to change here.`
  const noLot = "No sales release lot on this card, so the order cannot be kept in step."
  const batch = isBatchEntry(data.entry_model || entryModel)
  const batchWhy = "Batch-entry card: close it short with Close stage on the job card page, with a reason. Force close is only for cards still on the old form."
  // A batch-entry card can be cancelled while nothing at all (no run, no QC) is logged on it.
  const batchLogged = batch && (data.floor_entries ?? 1) > 0
  const batchCancelWhy = "Runs or QC are already logged on this card: close it short with Close stage on the job card page, with a reason."
  const cardPage = { label: "Close stage on the card page", href: `/production/job-cards/${data.id}` }
  const made = Math.min(data.made_qty, data.planned_qty)

  const edit = closed ? closedWhy
    : data.state === "SCHEDULED" ? `On the board already: qty and colour are locked. Take it back to the queue on the planner, or split it${batch ? "" : " / force close"}.`
      : data.state === "RUNNING" ? `Already running: qty and colour are fixed now. Split the unstarted part into a new card${batch ? ", or close it short on the card page" : ", or force close"}.`
        : !data.release_lot_id ? noLot : null
  const split = closed ? closedWhy
    : !data.release_lot_id ? noLot
      : data.open_first_stage_qty <= 1 ? "Nothing unstarted is left on the first stage: it is all running or done." : null
  const emergency = closed ? closedWhy
    : data.state === "RUNNING" ? "Already running on a machine: nothing to jump ahead of."
      : data.open_first_stage_qty <= 0 ? "No unstarted work left on the first stage." : null
  const forceClose = closed ? closedWhy
    : batch ? batchWhy
      : !data.release_lot_id ? noLot
        : made <= 0 ? "Nothing is made yet: use Cancel card instead (the whole qty goes back to the order)."
          : made >= data.planned_qty ? "Everything planned is already made: finish the card normally." : null
  const cancel = closed ? closedWhy
    : batchLogged ? batchCancelWhy
      : !data.release_lot_id ? noLot
        : made > 0 ? `${fmt(made)} pcs are already made: use Force close instead; it keeps what was made.` : null

  return [
    { key: "split", label: "Split into a new card", icon: Scissors, hint: `Move part of the ${fmt(data.open_first_stage_qty)} unstarted pcs to a separate card`, allowed: data.actions.split && !split, why: split || (data.actions.split ? null : "Not possible in this state.") },
    { key: "edit", label: "Edit qty / colour", icon: Pencil, hint: "Change qty or colour while the card is queued", allowed: data.actions.edit && !edit, why: edit || (data.actions.edit ? null : "Only a queued card can be edited.") },
    { key: "emergency", label: "Emergency insert", icon: Flame, hint: "Run first in a chosen shift; others make room", allowed: data.actions.emergency && !emergency, why: emergency || (data.actions.emergency ? null : "Only a queued or scheduled card.") },
    { key: "force_close", label: "Force close", icon: Undo2, hint: `Close at ${fmt(made)} pcs made; the rest goes back to the order`, allowed: data.actions.force_close && !forceClose, why: forceClose || (data.actions.force_close ? null : "Card is already closed."), danger: true, instead: batch && !closed ? cardPage : null },
    { key: "cancel", label: "Cancel card", icon: Ban, hint: "Nothing made: the whole qty goes back to the order", allowed: data.actions.force_close && !cancel, why: cancel || (data.actions.force_close ? null : "Card is already closed."), danger: true, instead: batchLogged && !closed ? cardPage : null },
  ]
}

/** Quick reasons per action (one click fills the reason; it can still be edited). */
export const REASON_PRESETS: Record<LifecycleAction, string[]> = {
  split: ["Customer call-off earlier", "Second machine free", "Urgent part dispatch", "Colour / print change on part"],
  edit: ["Customer changed the PO", "Entry mistake at release", "Colour per customer artwork"],
  emergency: ["Customer line down", "Truck booked today", "Rush order from the owner"],
  force_close: ["Material short", "Customer reduced the PO", "Machine down, re-plan on a new card", "Quality: rest scrapped"],
  cancel: ["Released by mistake", "Customer cancelled the line", "Merged into another card"],
}

const SHIFT_ORDER = ["SHIFT_A", "SHIFT_B"]

type Segment = JobCardLifecycle["stages"][number]["segments"][number]

export function firstStageSegments(data: JobCardLifecycle) {
  return data.stages.find((row) => row.stage === data.first_stage)?.segments || []
}

export function unstartedSlots(data: JobCardLifecycle) {
  return firstStageSegments(data).filter((row) => ["PLANNED", "QUEUED", "ASSIGNED"].includes(row.status))
}

/** The same order the server uses when a split takes qty from the unstarted slots: latest first. */
export function splitSlotChanges(data: JobCardLifecycle, qty: number): Array<{ segment: Segment; from: number; to: number }> {
  const ordered = [...unstartedSlots(data)].sort((a, b) => {
    const keyA = `${a.plan_date || "9999-12-31"}|${a.shift_code ? SHIFT_ORDER.indexOf(a.shift_code) : 9}|${String(a.sequence_no).padStart(4, "0")}`
    const keyB = `${b.plan_date || "9999-12-31"}|${b.shift_code ? SHIFT_ORDER.indexOf(b.shift_code) : 9}|${String(b.sequence_no).padStart(4, "0")}`
    return keyB.localeCompare(keyA)
  })
  let remaining = qty
  const changes: Array<{ segment: Segment; from: number; to: number }> = []
  for (const segment of ordered) {
    if (remaining <= 1e-6) break
    const take = Math.min(segment.planned_qty, remaining)
    changes.push({ segment, from: segment.planned_qty, to: Math.round((segment.planned_qty - take) * 100) / 100 })
    remaining -= take
  }
  return changes
}

export function slotText(segment: Pick<Segment, "plan_date" | "shift_code" | "machine_id">, machines: any[]) {
  if (!segment.plan_date && !segment.machine_id) return "Queue (no date yet)"
  return [segment.plan_date ? dayText(segment.plan_date) : "no date", shiftText(segment.shift_code), machineLabelOf(machines, segment.machine_id)].filter(Boolean).join(" · ")
}

const SUFFIXES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")

/** The number the new card will most likely get: the next free letter after the family's last one. */
export function nextChildNumber(data: JobCardLifecycle) {
  const root = String(data.job_card_no || "").split("-")[0]
  if (!root) return "a new number"
  const used = new Set(data.family.map((row) => String(row.job_card_no || "")).filter((no) => no.startsWith(`${root}-`)).map((no) => no.slice(root.length + 1)))
  const letter = SUFFIXES.find((candidate) => !used.has(candidate)) || "?"
  return `${root}-${letter}`
}

// ── shared pieces ─────────────────────────────────────────────────────────

type Step = "form" | "confirm" | "done"

function Frame({ icon: Icon, title, intro, danger, children, testId }: { icon: LucideIcon; title: string; intro: ReactNode; danger?: boolean; children: ReactNode; testId: string }) {
  return (
    <section className="space-y-3" data-testid={testId} aria-label={title}>
      <header className="flex items-start gap-2.5">
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", danger ? "bg-signal-rose-soft text-signal-rose-ink" : "bg-primary/10 text-primary")}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold leading-tight">{title}</h3>
          <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{intro}</p>
        </div>
      </header>
      {children}
    </section>
  )
}

export function Preview({ title = "What will happen", children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-dashed border-border bg-[hsl(var(--surface-2))] p-3", className)} data-testid="action-preview">
      <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
        {title}
      </p>
      <div className="mt-2 space-y-2 text-[12.5px] leading-5">{children}</div>
    </div>
  )
}

function CardTile({ no, badge, value, sub, lines, tone = "neutral" }: { no: string; badge?: string; value: string; sub?: string; lines?: string[]; tone?: "neutral" | "new" | "closed" }) {
  return (
    <div className={cn("min-w-0 rounded-lg border px-3 py-2", tone === "new" ? "border-signal-violet-line bg-signal-violet-soft" : tone === "closed" ? "border-signal-rose-line bg-signal-rose-soft" : "border-border bg-card")}>
      <p className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[12.5px] font-semibold">{no}</span>
        {badge ? <span className={cn("rounded px-1 text-[10.5px] font-semibold", tone === "new" ? "bg-signal-violet-ink/10 text-signal-violet-ink" : tone === "closed" ? "bg-signal-rose-ink/10 text-signal-rose-ink" : "bg-muted text-muted-foreground")}>{badge}</span> : null}
      </p>
      <p className="mt-0.5 text-[16px] font-semibold tabular-nums leading-tight">{value}</p>
      {sub ? <p className="text-[11.5px] text-muted-foreground">{sub}</p> : null}
      {lines?.length ? <ul className="mt-1 space-y-0.5 text-[11.5px] text-muted-foreground">{lines.map((line) => <li key={line}>{line}</li>)}</ul> : null}
    </div>
  )
}

export function Change({ label, before, after, same }: { label: string; before: string; after: string; same?: boolean }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5">
      <span className="text-muted-foreground">{label}:</span>
      <span className={cn("tabular-nums", !same && "line-through decoration-signal-rose-ink/60")}>{before}</span>
      {!same ? (
        <>
          <ArrowRight className="h-3 w-3 self-center text-muted-foreground" aria-hidden="true" />
          <strong className="tabular-nums text-foreground">{after}</strong>
        </>
      ) : (
        <span className="text-muted-foreground">(unchanged)</span>
      )}
    </p>
  )
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-0.5 pl-4">
      {items.map((item, index) => <li key={index}>{item}</li>)}
    </ul>
  )
}

/** The server's plain refusal, kept on screen (a toast alone is gone before the planner reads it). */
function Refusal({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="basis-full rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-[12.5px] text-signal-rose-ink" data-testid="action-refusal">
      <strong>Not done:</strong> {message}
    </p>
  )
}

function Footer({ step, busy, canReview, missing, error, onReview, onBack, onConfirm, onCancel, reviewLabel, confirmLabel, danger, testId }: {
  step: Step
  busy: boolean
  canReview: boolean
  missing: string | null
  error?: string | null
  onReview: () => void
  onBack: () => void
  onConfirm: () => void
  onCancel: () => void
  reviewLabel: string
  confirmLabel: string
  danger?: boolean
  testId: string
}) {
  const primary = cn("erp-btn-primary !h-9", danger && "!bg-signal-rose-ink !text-white hover:!opacity-90")
  if (step === "confirm") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        <Refusal message={error || null} />
        <button type="button" className="erp-btn-secondary !h-9" onClick={onBack} disabled={busy}><ChevronLeft className="h-4 w-4" />Back</button>
        <button type="button" className={primary} onClick={onConfirm} disabled={busy} data-testid={`${testId}-confirm`}>
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
      <Refusal message={error || null} />
      {!canReview && missing ? <span className="mr-auto text-[12px] text-signal-rose-ink">{missing}</span> : null}
      <button type="button" className="erp-btn-secondary !h-9" onClick={onCancel}>Cancel</button>
      <button type="button" className={primary} onClick={onReview} disabled={!canReview} data-testid={`${testId}-review`}>
        {reviewLabel}<ArrowRight className="h-4 w-4" />
      </button>
    </div>
  )
}

function ConfirmPanel({ title, lines, reason }: { title: string; lines: ReactNode[]; reason: string }) {
  return (
    <div className="animate-enter-up rounded-xl border border-primary/30 bg-primary/5 p-3" data-testid="action-confirm">
      <p className="text-[13px] font-semibold">{title}</p>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[12.5px] leading-5">{lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
      <p className="mt-2 text-[12.5px]"><span className="text-muted-foreground">Reason:</span> {reason}</p>
    </div>
  )
}

export type DoneLink = { label: string; href?: string; onClick?: () => void; icon?: LucideIcon; primary?: boolean; external?: boolean }

export function DonePanel({ title, lines, links, onDone, tone = "ok" }: { title: string; lines: ReactNode[]; links: DoneLink[]; onDone: () => void; tone?: "ok" | "closed" }) {
  return (
    <div className={cn("animate-enter-up rounded-xl border p-4", tone === "closed" ? "border-signal-rose-line bg-signal-rose-soft" : "border-signal-emerald-line bg-signal-emerald-soft")} data-testid="action-done">
      <p className={cn("flex items-center gap-2 text-[14px] font-semibold", tone === "closed" ? "text-signal-rose-ink" : "text-signal-emerald-ink")}>
        <Check className="h-4 w-4" aria-hidden="true" />{title}
      </p>
      <ul className="mt-2 space-y-0.5 text-[12.5px] leading-5 text-foreground/90">{lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
      <div className="mt-3 flex flex-wrap gap-2">
        {links.map((link) => {
          const Icon = link.icon
          const className = cn(link.primary ? "erp-btn-primary" : "erp-btn-secondary", "!h-9")
          return link.href ? (
            <Link key={link.label} href={link.href} className={className} target={link.external ? "_blank" : undefined}>{Icon ? <Icon className="h-4 w-4" /> : null}{link.label}</Link>
          ) : (
            <button key={link.label} type="button" className={className} onClick={link.onClick}>{Icon ? <Icon className="h-4 w-4" /> : null}{link.label}</button>
          )
        })}
        <button type="button" className="erp-btn-secondary !h-9" onClick={onDone}>Done</button>
      </div>
    </div>
  )
}

function ReasonField({ value, onChange, placeholder, rows = 1, presets = [] }: { value: string; onChange: (value: string) => void; placeholder: string; rows?: number; presets?: string[] }) {
  return (
    <div className="space-y-1.5">
      <Field label="Reason" required hint="Goes into the card history and the order history, with your name.">
        {rows > 1 ? (
          <textarea className={cn(inputClass, "h-auto py-2")} rows={rows} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} data-testid="action-reason" />
        ) : (
          <input className={inputClass} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} data-testid="action-reason" />
        )}
      </Field>
      {presets.length ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Quick reasons">
          {presets.map((preset) => {
            const on = value.trim() === preset
            return (
              <button
                key={preset}
                type="button"
                onClick={() => onChange(on ? "" : preset)}
                aria-pressed={on}
                className={cn("inline-flex h-7 items-center rounded-full border px-2.5 text-[12px] font-medium transition-colors", on ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground")}
                data-testid="action-reason-preset"
              >
                {on ? <Check className="mr-1 h-3 w-3" aria-hidden="true" /> : null}{preset}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/** Form (or confirm summary) and the live preview: side by side when there is room, else stacked. */
function ActionBody({ wide, main, preview }: { wide?: boolean; main: ReactNode; preview: ReactNode }) {
  return (
    <div className={cn("grid gap-3", wide && "min-[1600px]:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] min-[1600px]:items-start")}>
      <div className="min-w-0 space-y-3">{main}</div>
      <div className={cn("min-w-0", wide && "min-[1600px]:sticky min-[1600px]:top-[calc(var(--topbar-h,56px)+12px)]")}>{preview}</div>
    </div>
  )
}

/** Proportion bar for a split or a close: who keeps what of the card's qty. */
function QtySplitBar({ parts }: { parts: Array<{ label: string; value: number; tone: "primary" | "violet" | "rose" | "muted" }> }) {
  const total = Math.max(1, parts.reduce((sum, part) => sum + Math.max(0, part.value), 0))
  const tone = { primary: "bg-primary", violet: "bg-signal-violet-ink", rose: "bg-signal-rose-ink", muted: "bg-muted-foreground/40" }
  return (
    <div aria-hidden="true">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {parts.map((part) => (
          <span key={part.label} className={cn("h-full transition-[width] duration-300 ease-out first:rounded-l-full last:rounded-r-full", tone[part.tone])} style={{ width: `${(Math.max(0, part.value) / total) * 100}%` }} />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[11.5px] text-muted-foreground">
        {parts.map((part) => (
          <span key={part.label} className="inline-flex items-center gap-1"><span className={cn("h-2 w-2 rounded-full", tone[part.tone])} />{part.label} <strong className="tabular-nums text-foreground">{fmt(part.value)}</strong></span>
        ))}
      </div>
    </div>
  )
}

export type ActionProps = {
  data: JobCardLifecycle
  machines?: any[]
  onDone: () => void
  /** Open another card (the new split card) in the same surface. */
  onOpenCard?: (id: string) => void
  /** Wide surface (the manager): form and preview side by side on big screens. */
  wide?: boolean
}

const REASON_MIN = 3

/** After a refusal the card may have changed under us (another planner, the floor): reload it so the preview tells the truth. */
function useRefreshCard() {
  const queryClient = useQueryClient()
  return () => {
    for (const key of ["job-card-lifecycle", "planning-job-cards", "job-card-history"]) queryClient.invalidateQueries({ queryKey: [key] })
  }
}

// ── Split into a new card ────────────────────────────────────────────────

export function SplitAction({ data, machines = [], onDone, onOpenCard, wide }: ActionProps) {
  const { showToast } = useApp()
  const split = useSplitJobCard()
  const refresh = useRefreshCard()
  const max = Math.max(1, Math.floor(Math.min(data.open_first_stage_qty, data.planned_qty - 1)))
  // Start at half the unstarted qty, in whole bamboo where the card has pcs per bamboo.
  const [qty, setQty] = useState(() => {
    const ppb = data.pcs_per_bamboo || 1
    const half = ppb > 1 ? Math.max(ppb, Math.floor(max / 2 / ppb) * ppb) : Math.floor(max / 2)
    return String(Math.min(max, Math.max(1, half)))
  })
  const [reason, setReason] = useState("")
  const [step, setStep] = useState<Step>("form")
  const [refusal, setRefusal] = useState<string | null>(null)
  // Snapshot at submit time: the card refetches after the split, so the success text must not move with it.
  const [result, setResult] = useState<{ id: string; no: string; qty: number; keeps: number } | null>(null)
  // An empty or out-of-range box is not 1 pc (client 2026-10-26): the split waits for a real quantity.
  const typed = Number(qty)
  const valid = qty.trim() !== "" && Number.isInteger(typed) && typed >= 1 && typed <= max
  const value = valid ? typed : Math.min(max, Math.max(1, Math.round(typed) || 1))
  const reasonOk = reason.trim().length >= REASON_MIN
  const requestId = useRef<string | null>(null)
  const changes = useMemo(() => splitSlotChanges(data, value), [data, value])
  const childNo = nextChildNumber(data)
  const familyTotal = data.family.reduce((sum, row) => sum + row.planned_qty, 0)
  const keeps = data.planned_qty - value
  // Quick picks in whole bamboo where the card has a pcs-per-bamboo, so the split does not leave a part bamboo.
  const quickQtys = useMemo(() => {
    const ppb = data.pcs_per_bamboo || 1
    const round = (qty: number) => Math.min(max, Math.max(1, ppb > 1 ? Math.max(ppb, Math.floor(qty / ppb) * ppb) : Math.round(qty)))
    const picks = [
      { label: `¼ · ${fmt(round(max / 4))}`, qty: round(max / 4) },
      { label: `½ · ${fmt(round(max / 2))}`, qty: round(max / 2) },
      { label: `¾ · ${fmt(round((max * 3) / 4))}`, qty: round((max * 3) / 4) },
      { label: `All unstarted · ${fmt(max)}`, qty: max },
    ]
    return picks.filter((pick, index) => picks.findIndex((other) => other.qty === pick.qty) === index)
  }, [data.pcs_per_bamboo, max])

  // The card changed under the confirm step (a refusal reloads it): back to the form with the message.
  useEffect(() => {
    if (step === "confirm" && !valid) setStep("form")
  }, [step, valid])

  const submit = async () => {
    if (!valid || !reasonOk) return
    requestId.current ||= newRequestId()
    try {
      const response = await split.mutateAsync({ jobCardId: data.id, qty: value, reason: reason.trim(), requestId: requestId.current })
      requestId.current = null
      const no = String(response?.data?.child_job_card_no || childNo)
      setResult({ id: String(response?.data?.child_job_card_id || ""), no, qty: value, keeps })
      setStep("done")
      showToast(`${no} created with ${fmt(value)} pcs — place it on the planner board.`, "success")
    } catch (error: any) {
      if (error?.response) {
        requestId.current = null // the server answered, so a new attempt is a new split
        refresh()
      }
      setRefusal(apiErrorText(error)) // shown inline (role=alert also mirrors it as a toast)
    }
  }

  if (step === "done" && result) {
    return (
      <DonePanel
        title={`${result.no} created with ${fmt(result.qty)} pcs`}
        lines={[
          <>{data.job_card_no} keeps <strong>{fmt(result.keeps)} pcs</strong> and its plan; {result.no} is in the planner queue, unplaced.</>,
          <>Same colour and size; its own lot, print, QC samples and dispatch.</>,
        ]}
        links={[
          ...(result.id && onOpenCard ? [{ label: `Open ${result.no}`, onClick: () => onOpenCard(result.id), icon: ExternalLink, primary: true }] : []),
          { label: "Place it on the planner board", href: `/planning/board?section=${String(data.first_stage || "winder").toLowerCase()}&order_id=${data.sales_order_id}`, icon: CalendarClock },
          ...(result.id ? [{ label: "Print new card", href: `/production/job-cards/${result.id}/print`, icon: Printer }] : []),
        ]}
        onDone={onDone}
      />
    )
  }

  return (
    <Frame
      icon={Scissors}
      title="Split into a new card"
      testId="action-split"
      intro={<>Makes a <b className="text-foreground">separate job card</b> from the not-yet-started qty: its own number, lot, print, QC and dispatch, same colour. To run this card over more shifts, days or machines, use <b className="text-foreground">Split plan</b> on the planner instead; that keeps one card.</>}
    >
      <ActionBody
        wide={wide}
        main={step === "form" ? (
          <>
            <p className="text-[12.5px] text-muted-foreground">Unstarted on this card: <strong className="text-foreground">{unitWord(data, data.open_first_stage_qty)}</strong>. Move part of it to <strong className="font-mono text-foreground">{childNo}</strong>.</p>
            <div className="rounded-xl border border-border bg-card p-3">
              <Field label={`New card gets (pcs, 1–${fmt(max)})`} required>
                <div className="flex items-center gap-3">
                  <input type="range" min={1} max={max} value={value} onChange={(event) => setQty(event.target.value)} className="min-w-0 flex-1 accent-[hsl(var(--primary))]" aria-label="Split quantity" />
                  <input className={cn(inputClass, "!w-28 text-right text-[15px] font-semibold tabular-nums")} type="number" min={1} max={max} step={1} value={qty} onChange={(event) => setQty(event.target.value)} aria-invalid={!valid} data-testid="split-card-qty" />
                </div>
              </Field>
              <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Quick quantities">
                {quickQtys.map((pick) => (
                  <button key={pick.label} type="button" onClick={() => setQty(String(pick.qty))} aria-pressed={valid && typed === pick.qty} className={cn("inline-flex h-7 items-center rounded-md border px-2 text-[12px] font-medium tabular-nums", valid && typed === pick.qty ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-[hsl(var(--surface-2))] text-muted-foreground hover:text-foreground")} data-testid="split-quick-qty">
                    {pick.label}
                  </button>
                ))}
              </div>
              {!valid ? <p className="mt-2 text-[12.5px] text-signal-rose-ink" aria-live="polite">Type how many pcs the new card gets: a whole number from 1 to {fmt(max)} (what is not started yet, leaving at least 1 pc on {data.job_card_no}).</p> : null}
            </div>
            <ReasonField value={reason} onChange={setReason} placeholder="e.g. second winder free · customer wants part by Friday" presets={REASON_PRESETS.split} />
          </>
        ) : (
          <ConfirmPanel
            title={`Split ${fmt(value)} pcs from ${data.job_card_no} into ${childNo}`}
            lines={[
              <>{data.job_card_no}: {fmt(data.planned_qty)} → <strong>{fmt(keeps)} pcs</strong>, keeps its plan.</>,
              <>{childNo}: <strong>{fmt(value)} pcs</strong>, planner queue, unplaced.</>,
              ...changes.map((change) => <>Slot {slotText(change.segment, machines)}: {fmt(change.from)} → {change.to > 0 ? `${fmt(change.to)} pcs` : "taken off the board"}</>),
            ]}
            reason={reason.trim()}
          />
        )}
        preview={(
          <Preview>
            {!valid ? <p className="rounded-lg bg-signal-amber-soft px-2.5 py-1.5 text-signal-amber-ink">Fix the qty (1 to {fmt(max)}) to see the result.</p> : null}
            <div className={cn("grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] items-stretch gap-2 transition-opacity", !valid && "pointer-events-none opacity-40")} aria-hidden={!valid || undefined}>
              <CardTile no={data.job_card_no || "This card"} badge="keeps its plan" value={unitWord(data, keeps)} sub={`was ${fmt(data.planned_qty)} pcs · stays ${stateWord(data.state)}`} />
              <CardTile no={childNo} badge="new" tone="new" value={unitWord(data, value)} sub="planner queue · unplaced" lines={[data.parchment_color ? `Colour ${data.parchment_color}` : "Plain (no parchment)", "own lot · print · QC · dispatch"]} />
            </div>
            <QtySplitBar parts={[{ label: `${data.job_card_no} keeps`, value: keeps, tone: "primary" }, { label: `${childNo} gets`, value: value, tone: "violet" }]} />
            <Bullets
              items={[
                changes.length === 0
                  ? "No planner slot changes."
                  : <>Plan slots that change: {changes.map((change, index) => <span key={change.segment.id}>{index ? "; " : ""}{slotText(change.segment, machines)} {fmt(change.from)} → {change.to > 0 ? fmt(change.to) : <strong>off the board</strong>}</span>)}.</>,
                <>Still unstarted on {data.job_card_no} after the split: <strong>{fmt(Math.max(0, data.open_first_stage_qty - value))} pcs</strong>; runs already logged stay on {data.job_card_no}.</>,
                <>Order line stays <strong>{fmt(familyTotal)} pcs</strong>: now on {data.family.length + 1} cards.</>,
                "Recorded in both cards' history with your reason.",
              ]}
            />
          </Preview>
        )}
      />

      <Footer
        step={step}
        busy={split.isPending}
        canReview={valid && reasonOk}
        missing={!valid ? "Qty needed" : !reasonOk ? "Reason needed" : null}
        error={refusal}
        onReview={() => { setRefusal(null); setStep("confirm") }}
        onBack={() => { setRefusal(null); setStep("form") }}
        onConfirm={() => void submit()}
        onCancel={onDone}
        reviewLabel={`Review split of ${fmt(value)} pcs`}
        confirmLabel={`Yes, create ${childNo} with ${fmt(value)} pcs`}
        testId="split-card"
      />
    </Frame>
  )
}

// ── Edit qty / colour ────────────────────────────────────────────────────

export function EditAction({ data, machines = [], onDone, wide }: ActionProps) {
  const { showToast } = useApp()
  const amend = useAmendJobCard()
  const refresh = useRefreshCard()
  const { data: parchments } = useParchments()
  const options = (Array.isArray(parchments) ? parchments : []).filter((row: any) => row?.color_name && row?.id && !String(row.id).startsWith("vendor:"))
  const [qty, setQty] = useState(String(Math.round(data.planned_qty)))
  const [colorId, setColorId] = useState("")
  const [reason, setReason] = useState("")
  const [step, setStep] = useState<Step>("form")
  const [refusal, setRefusal] = useState<string | null>(null)
  // Snapshot at submit time: the card refetches after the edit, so the success text must not move with it.
  const [result, setResult] = useState<{ qtyFrom: number; qtyTo: number | null; colourFrom: string; colourTo: string | null } | null>(null)
  const chosen = options.find((row: any) => String(row.id) === colorId)
  const colorName = chosen ? String(chosen.display_name || [chosen.color_name, chosen.vendor_name].filter(Boolean).join(" / ")) : ""
  const qtyNum = Number(qty)
  const qtyOk = qty.trim() !== "" && Number.isInteger(qtyNum) && qtyNum >= 1
  const qtyChanged = qtyOk && qtyNum !== Math.round(data.planned_qty)
  const colourChanged = Boolean(colorId) && colorName !== (data.parchment_color || "")
  const changed = qtyChanged || colourChanged
  const reasonOk = reason.trim().length >= REASON_MIN
  const delta = qtyOk ? qtyNum - data.planned_qty : 0
  const queueSlot = unstartedSlots(data)[0]

  const submit = async () => {
    const snapshot = { qtyFrom: data.planned_qty, qtyTo: qtyChanged ? qtyNum : null, colourFrom: data.parchment_color || "plain", colourTo: colourChanged ? colorName : null }
    try {
      await amend.mutateAsync({
        jobCardId: data.id,
        data: {
          ...(qtyChanged ? { planned_qty: qtyNum } : {}),
          ...(colourChanged ? { parchment_color: colorName, parchment_color_id: colorId } : {}),
          reason: reason.trim(),
        },
      })
      setResult(snapshot)
      setStep("done")
      showToast("Job card updated — the sales release lot changed with it.", "success")
    } catch (error: any) {
      if (error?.response) refresh()
      setRefusal(apiErrorText(error)) // shown inline (role=alert also mirrors it as a toast)
    }
  }

  if (step === "done" && result) {
    return (
      <DonePanel
        title={`${data.job_card_no} updated`}
        lines={[
          result.qtyTo !== null ? <>Qty {fmt(result.qtyFrom)} → <strong>{fmt(result.qtyTo)} pcs</strong>; the release lot on the order changed with it.</> : null,
          result.colourTo !== null ? <>Colour {result.colourFrom} → <strong>{result.colourTo}</strong>.</> : null,
          "Recorded in the card and order history with your reason.",
        ].filter(Boolean)}
        links={[
          { label: "Open card page", href: `/production/job-cards/${data.id}`, icon: ExternalLink },
          { label: "Sales order", href: `/sales-orders/${data.sales_order_id}`, icon: ShoppingCart },
        ]}
        onDone={onDone}
      />
    )
  }

  return (
    <Frame icon={Pencil} title="Edit qty / colour" testId="action-edit" intro="This card is still in the queue, so its qty and colour can change. The sales order release lot updates in step and the change is audited.">
      <ActionBody
        wide={wide}
        main={step === "form" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Quantity (pcs)" required hint={data.pcs_per_bamboo ? `${data.pcs_per_bamboo} pcs per bamboo${qtyOk ? ` · ${fmt(Math.ceil(qtyNum / data.pcs_per_bamboo))} bamboo` : ""}` : undefined}>
                <input className={cn(inputClass, "text-[15px] font-semibold tabular-nums")} type="number" min={1} step={1} value={qty} onChange={(event) => setQty(event.target.value)} aria-invalid={!qtyOk} data-testid="edit-card-qty" />
              </Field>
              {data.parchment_color !== null ? (
                <Field label="Colour" hint={`Now: ${data.parchment_color || "—"}`}>
                  <select className={inputClass} value={colorId} onChange={(event) => setColorId(event.target.value)} data-testid="edit-card-colour">
                    <option value="">Keep current colour</option>
                    {options.map((row: any) => <option key={row.id} value={row.id}>{row.display_name || row.color_name}</option>)}
                  </select>
                </Field>
              ) : (
                <p className="self-end rounded-lg bg-muted px-3 py-2 text-[12px] text-muted-foreground">Plain card (no parchment colour): only the qty can change.</p>
              )}
            </div>
            {!qtyOk ? <p className="text-[12.5px] text-signal-rose-ink" aria-live="polite">Quantity must be a whole number of at least 1.</p> : null}
            <ReasonField value={reason} onChange={setReason} placeholder="e.g. customer changed the colour to red" presets={REASON_PRESETS.edit} />
          </>
        ) : (
          <ConfirmPanel
            title={`Change ${data.job_card_no}`}
            lines={[
              qtyChanged ? <>Qty {fmt(data.planned_qty)} → <strong>{fmt(qtyNum)} pcs</strong> ({delta > 0 ? "+" : ""}{fmt(delta)})</> : <>Qty stays {fmt(data.planned_qty)} pcs</>,
              colourChanged ? <>Colour {data.parchment_color || "plain"} → <strong>{colorName}</strong></> : <>Colour stays {data.parchment_color || "plain"}</>,
              <>Release lot on the order: {fmt(data.released_qty)} → <strong>{fmt(qtyChanged ? qtyNum : data.released_qty)} pcs</strong></>,
            ]}
            reason={reason.trim()}
          />
        )}
        preview={(
          <Preview>
            <Change label="Qty" before={unitWord(data, data.planned_qty)} after={qtyOk ? unitWord(data, qtyNum) : "—"} same={!qtyChanged} />
            <Change label="Colour" before={data.parchment_color || "plain"} after={colorName || "—"} same={!colourChanged} />
            <Change label="Release lot on the order" before={`${fmt(data.released_qty)} pcs`} after={`${fmt(qtyChanged ? qtyNum : data.released_qty)} pcs`} same={!qtyChanged} />
            {queueSlot ? <Change label={`${stageWord(data.first_stage)} slot (${slotText(queueSlot, machines)})`} before={`${fmt(queueSlot.planned_qty)} pcs`} after={`${fmt(qtyChanged ? qtyNum : queueSlot.planned_qty)} pcs`} same={!qtyChanged} /> : null}
            <Bullets items={[
              <>The released total of the order moves by <strong>{delta > 0 ? "+" : ""}{fmt(delta)} pcs</strong>{delta !== 0 ? (delta < 0 ? `; ${fmt(-delta)} pcs go back to "not released" on the order line.` : "; the order line must have that much not yet released, or the sales order refuses it.") : "."}</>,
              colourChanged ? "The paper on the material plan follows the new colour; the planner slot stays." : "The card stays in the planner queue where it is.",
              "Recorded in the card and order history with your reason.",
            ]} />
          </Preview>
        )}
      />

      <Footer
        step={step}
        busy={amend.isPending}
        canReview={changed && qtyOk && reasonOk}
        missing={!qtyOk ? "Qty needed" : !changed ? "Nothing changed yet" : !reasonOk ? "Reason needed" : null}
        error={refusal}
        onReview={() => { setRefusal(null); setStep("confirm") }}
        onBack={() => { setRefusal(null); setStep("form") }}
        onConfirm={() => void submit()}
        onCancel={onDone}
        reviewLabel="Review change"
        confirmLabel="Yes, save the change"
        testId="edit-card"
      />
    </Frame>
  )
}

// ── Force close / Cancel card ────────────────────────────────────────────

export function ForceCloseAction({ data, machines = [], onDone, wide }: ActionProps) {
  const { showToast } = useApp()
  const close = useForceCloseJobCard()
  const refresh = useRefreshCard()
  const [reason, setReason] = useState("")
  const [step, setStep] = useState<Step>("form")
  const [refusal, setRefusal] = useState<string | null>(null)
  // Snapshot at submit time: after the close the card's planned qty becomes what was made.
  const [result, setResult] = useState<{ made: number; back: number; cancel: boolean } | null>(null)
  const live = { made: Math.min(data.made_qty, data.planned_qty), back: Math.max(0, data.planned_qty - Math.min(data.made_qty, data.planned_qty)) }
  const made = result ? result.made : live.made
  const back = result ? result.back : live.back
  const cancel = result ? result.cancel : made <= 0
  const reasonOk = reason.trim().length >= REASON_MIN
  const freed = unstartedSlots(data)
  const laterStages = data.stages.filter((row) => row.stage !== data.first_stage && row.status !== "COMPLETED").map((row) => stageWord(row.stage).toLowerCase().replace("qc", "QC"))

  const submit = async () => {
    const snapshot = { made: live.made, back: live.back, cancel: live.made <= 0 }
    try {
      await close.mutateAsync({ jobCardId: data.id, reason: reason.trim() })
      setResult(snapshot)
      setStep("done")
      showToast(cancel ? `${data.job_card_no} cancelled — ${fmt(back)} pcs back on the sales order.` : `${data.job_card_no} closed at ${fmt(made)} pcs — ${fmt(back)} pcs back on the sales order.`, "success")
    } catch (error: any) {
      if (error?.response) refresh()
      setRefusal(apiErrorText(error)) // shown inline (role=alert also mirrors it as a toast)
    }
  }

  if (step === "done") {
    return (
      <DonePanel
        tone="closed"
        title={cancel ? `${data.job_card_no} cancelled` : `${data.job_card_no} force-closed at ${fmt(made)} pcs`}
        lines={[
          <><strong>{fmt(back)} pcs</strong> are back on the sales order as not released. Re-release them as a new card (new colour or qty if needed).</>,
          cancel ? "All its planner slots are freed." : <>The {fmt(made)} pcs made keep going through {laterStages.length ? laterStages.join(", ") : "the remaining stages"} on this card.</>,
        ]}
        links={[
          { label: "Sales order (re-release)", href: `/sales-orders/${data.sales_order_id}`, icon: ShoppingCart, primary: true },
          { label: "Open card page", href: `/production/job-cards/${data.id}`, icon: ExternalLink },
        ]}
        onDone={onDone}
      />
    )
  }

  return (
    <Frame
      icon={cancel ? Ban : Undo2}
      danger
      title={cancel ? "Cancel card" : "Force close"}
      testId={cancel ? "action-cancel" : "action-force-close"}
      intro={cancel
        ? "Nothing is made yet, so the card is cancelled and its whole quantity goes back to the order. Use it when the card cannot start (PO cut, colour changed, material short)."
        : `Close ${data.job_card_no} now with what is made. Use it when the card cannot continue (material short, PO cut, machine down).`}
    >
      <ActionBody
        wide={wide}
        main={step === "form" ? (
          <ReasonField value={reason} onChange={setReason} placeholder={cancel ? "e.g. customer cancelled the PO" : "e.g. customer changed colour to red; rest re-released"} rows={2} presets={REASON_PRESETS[cancel ? "cancel" : "force_close"]} />
        ) : (
          <ConfirmPanel
            title={cancel ? `Cancel ${data.job_card_no}` : `Force close ${data.job_card_no} at ${fmt(made)} pcs`}
            lines={[
              cancel ? <>Whole qty <strong>{fmt(back)} pcs</strong> goes back to the sales order.</> : <><strong>{fmt(made)} pcs</strong> stay on this card; <strong>{fmt(back)} pcs</strong> go back to the sales order.</>,
              freed.length ? <>{freed.length} unstarted slot{freed.length > 1 ? "s" : ""} freed on the planner.</> : <>No planner slots to free.</>,
              <>The card shows <strong>{cancel ? "Cancelled" : "Closed early"}</strong>.</>,
            ]}
            reason={reason.trim()}
          />
        )}
        preview={(
          <Preview>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] items-stretch gap-2">
              <CardTile no={data.job_card_no || "This card"} badge={cancel ? "cancelled" : "closes at what is made"} tone="closed" value={cancel ? "0 pcs" : unitWord(data, made)} sub={cancel ? "nothing made" : `made so far at ${stageWord(data.anchor_stage).toLowerCase()}${data.pcs_per_bamboo ? ` · ${fmt(data.made_in_anchor_unit)} bamboo` : ""}`} />
              <CardTile no="Sales order" badge="gets back" value={`${fmt(back)} pcs`} sub="not released · re-release as a new card" />
            </div>
            {!cancel ? <QtySplitBar parts={[{ label: "Stays on the card", value: made, tone: "primary" }, { label: "Back to the order", value: back, tone: "rose" }]} /> : null}
            <Bullets
              items={[
                cancel
                  ? "Nothing is made, so every planned slot of this card is freed and the card is cancelled."
                  : <>The {fmt(made)} pcs made keep going through {laterStages.length ? laterStages.join(", ") : "the remaining stages"} on this card and lot.</>,
                freed.length
                  ? <>Planner slots freed: {freed.map((slot, index) => <span key={slot.id}>{index ? "; " : ""}{slotText(slot, machines)} ({fmt(slot.planned_qty)} pcs)</span>)}.</>
                  : "No unstarted planner slots on the first stage.",
                <>Card shows <strong>{cancel ? "Cancelled" : "Closed early"}</strong>; recorded in the card and order history with your reason.</>,
              ]}
            />
          </Preview>
        )}
      />

      <Footer
        step={step}
        busy={close.isPending}
        canReview={reasonOk}
        missing={!reasonOk ? "Reason needed" : null}
        error={refusal}
        onReview={() => { setRefusal(null); setStep("confirm") }}
        onBack={() => { setRefusal(null); setStep("form") }}
        onConfirm={() => void submit()}
        onCancel={onDone}
        reviewLabel={cancel ? "Review cancel" : "Review force close"}
        confirmLabel={cancel ? `Yes, cancel ${data.job_card_no}` : `Yes, close at ${fmt(made)} pcs`}
        danger
        testId={cancel ? "cancel-card" : "force-close-card"}
      />
    </Frame>
  )
}

// ── Emergency insert ─────────────────────────────────────────────────────

export function EmergencyAction({ data, machines = [], onDone, wide }: ActionProps) {
  const { showToast } = useApp()
  const insert = useEmergencyInsert()
  const refresh = useRefreshCard()
  const stage = String(data.first_stage || "WINDER").toUpperCase()
  const stageMachines = machines.filter((row: any) => {
    const dept = String(row.department || row.stage || row.machine_type || "").toUpperCase()
    return stage === "SLITTING" ? dept.includes("SLIT") : dept.includes(stage === "WINDER" ? "WIND" : stage)
  })
  const today = istToday()
  const [machineId, setMachineId] = useState(String(stageMachines[0]?.id || ""))
  const [planDate, setPlanDate] = useState(today)
  const [shift, setShift] = useState("SHIFT_A")
  const [reason, setReason] = useState("")
  const [step, setStep] = useState<Step>("form")
  const [refusal, setRefusal] = useState<string | null>(null)
  const [result, setResult] = useState<any[] | null>(null)
  useEffect(() => {
    if (!machineId && stageMachines[0]?.id) setMachineId(String(stageMachines[0].id))
  }, [machineId, stageMachines])
  const reasonOk = reason.trim().length >= REASON_MIN
  const dateOk = Boolean(planDate) && planDate >= today
  const machineName = machineLabelOf(machines, machineId)

  const slotQuery = useQuery({
    queryKey: ["planning-board", "emergency-preview", stage, planDate],
    queryFn: async () => (await productionApi.getPlanningBoard({ stage, plan_date: planDate, include_unscheduled: false })).data,
    enabled: step !== "done" && Boolean(planDate) && dateOk,
    staleTime: 30_000,
  })
  const lane = useMemo(() => {
    const stages: any[] = Array.isArray(slotQuery.data?.stages) ? slotQuery.data.stages : []
    const lanes: any[] = stages.flatMap((row: any) => (Array.isArray(row?.lanes) ? row.lanes : []))
    return lanes.find((row: any) => String(row.machine_id || "") === machineId && String(row.shift_code || "") === shift && String(row.plan_date || "").slice(0, 10) === planDate) || null
  }, [slotQuery.data, machineId, shift, planDate])
  const slotJobs: any[] = Array.isArray(lane?.jobs) ? lane.jobs.filter((job: any) => String(job.job_card_id) !== data.id) : []
  const slotLoad = lane ? Number(lane.current_load || 0) : null
  const slotCapacity = lane ? Number(lane.capacity_value || 0) : null
  const capacityUnit = lane ? String(lane.capacity_unit || "").replace(/_/g, " ").toLowerCase() : ""
  const when = `${dayText(planDate)} · ${shiftText(shift)}${machineName ? ` · ${machineName}` : ""}`
  const quickSlots = useMemo(() => {
    const tomorrow = addDays(today, 1)
    return [
      { label: "Today · Shift A", date: today, shift: "SHIFT_A" },
      { label: "Today · Shift B", date: today, shift: "SHIFT_B" },
      { label: "Tomorrow · Shift A", date: tomorrow, shift: "SHIFT_A" },
    ]
  }, [today])

  const submit = async () => {
    try {
      const response = await insert.mutateAsync({ job_card_id: data.id, machine_id: machineId, plan_date: planDate, shift_code: shift, reason: reason.trim() })
      const bumped = response?.data?.bumped || []
      setResult(bumped)
      setStep("done")
      showToast(bumped.length ? `${data.job_card_no} runs first — ${bumped.length} card(s) pushed to later shifts.` : `${data.job_card_no} runs first — the slot had room.`, "success")
    } catch (error: any) {
      if (error?.response) refresh()
      setRefusal(apiErrorText(error)) // shown inline (role=alert also mirrors it as a toast)
    }
  }

  if (step === "done" && result) {
    return (
      <DonePanel
        title={`${data.job_card_no} runs first on ${when}`}
        lines={[
          result.length ? <>{result.length} card{result.length > 1 ? "s" : ""} pushed later to make room:</> : "Nothing had to move: the slot had room.",
          ...result.map((row: any) => (
            <span key={row.segment_id} className="tabular-nums"><span className="font-mono font-semibold">{row.job_card_no}</span> {dayText(row.from?.date)} {shiftText(row.from?.shift)} → {dayText(row.to?.date)} {shiftText(row.to?.shift)}</span>
          )),
          "Everyone affected is notified.",
        ]}
        links={[
          { label: "See it on the planner board", href: `/planning/board?section=${stage.toLowerCase()}&plan_date=${planDate}&job_card_id=${data.id}`, icon: CalendarClock, primary: true },
          { label: "Print card", href: `/production/job-cards/${data.id}/print`, icon: Printer },
        ]}
        onDone={onDone}
      />
    )
  }

  return (
    <Frame icon={Flame} title="Emergency insert" testId="action-emergency" intro={`Put ${data.job_card_no}'s ${stageWord(stage).toLowerCase()} first on a machine, date and shift. If that shift is then over capacity, the lowest-priority cards move to the next shift (and onward); running cards never move.`}>
      <ActionBody
        wide={wide}
        main={step === "form" ? (
          <>
            <div className="flex flex-wrap gap-1.5" aria-label="Quick slots">
              {quickSlots.map((slot) => {
                const on = planDate === slot.date && shift === slot.shift
                return (
                  <button key={slot.label} type="button" onClick={() => { setPlanDate(slot.date); setShift(slot.shift) }} aria-pressed={on} className={cn("inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-[12px] font-semibold", on ? "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink" : "border-border bg-card text-muted-foreground hover:text-foreground")} data-testid="emergency-quick-slot">
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />{slot.label}
                  </button>
                )
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Machine" required>
                <select className={inputClass} value={machineId} onChange={(event) => setMachineId(event.target.value)} data-testid="emergency-machine">
                  {stageMachines.length === 0 ? <option value="">No {stageWord(stage).toLowerCase()} machine</option> : null}
                  {stageMachines.map((row: any) => <option key={row.id} value={row.id}>{row.code || row.name}</option>)}
                </select>
              </Field>
              <Field label="Date" required><input className={inputClass} type="date" min={today} value={planDate} onChange={(event) => setPlanDate(event.target.value)} data-testid="emergency-date" /></Field>
              <Field label="Shift" required>
                <select className={inputClass} value={shift} onChange={(event) => setShift(event.target.value)} data-testid="emergency-shift">
                  <option value="SHIFT_A">Shift A</option>
                  <option value="SHIFT_B">Shift B</option>
                </select>
              </Field>
            </div>
            {!dateOk ? <p className="text-[12.5px] text-signal-rose-ink" aria-live="polite">Pick today or a later date.</p> : null}
            <ReasonField value={reason} onChange={setReason} placeholder="e.g. customer line-down, truck at 6 pm" presets={REASON_PRESETS.emergency} />
          </>
        ) : (
          <ConfirmPanel
            title={`Insert ${data.job_card_no} first on ${when}`}
            lines={[
              <>Whole card ({unitWord(data, data.open_first_stage_qty)}) goes first in that shift and is marked <strong>Emergency</strong>.</>,
              slotJobs.length ? <>{slotJobs.length} card{slotJobs.length > 1 ? "s" : ""} already in the slot may move one shift later if it goes over capacity.</> : "The slot is empty right now.",
            ]}
            reason={reason.trim()}
          />
        )}
        preview={(
          <Preview title="What will happen">
            <p><span className="font-mono font-semibold">{data.job_card_no}</span> goes <strong>first</strong> in {when}, as one slot of {unitWord(data, data.open_first_stage_qty)}, marked Emergency.</p>
            {slotQuery.isLoading ? (
              <p className="text-muted-foreground">Looking at that slot…</p>
            ) : lane ? (
              <>
                {slotCapacity ? (
                  <div>
                    <p className="text-muted-foreground">
                      Load in that slot now: <strong className="tabular-nums text-foreground">{fmt(slotLoad, 1)}</strong> of {fmt(slotCapacity, 1)} {capacityUnit}
                      {lane.warning ? <> · {String(lane.warning)}</> : null}
                    </p>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <div className={cn("h-full rounded-full", (slotLoad || 0) > slotCapacity ? "bg-signal-rose-ink" : "bg-signal-amber-ink")} style={{ width: `${Math.min(100, ((slotLoad || 0) / slotCapacity) * 100)}%` }} />
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground">Load in that slot now: <strong className="tabular-nums text-foreground">{fmt(slotLoad, 1)}</strong>{lane.warning ? <> · {String(lane.warning)}</> : null}</p>
                )}
                {slotJobs.length ? (
                  <div className="rounded-lg border border-border bg-card px-2.5 py-2">
                    <p className="text-[11.5px] font-semibold text-muted-foreground">Already in this slot: the lowest priority ones move to the next shift if it goes over capacity</p>
                    <ul className="mt-1 space-y-0.5">
                      {slotJobs.map((job: any) => (
                        <li key={job.segment_id || job.queue_id} className="flex flex-wrap items-center gap-x-2 tabular-nums">
                          <span className="font-mono font-semibold">{job.job_card_no || job.job_card_ref}</span>
                          <span className="text-muted-foreground">{fmt(job.segment_planned_qty ?? job.planned_qty)} pcs · {String(job.segment_status || job.status || "").toLowerCase()}{job.is_emergency ? " · emergency (stays)" : ""}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-muted-foreground">Nothing else is planned in this slot, so nothing has to move.</p>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">{machineId ? "The board shows nothing planned on that machine and shift, so nothing should have to move." : "Pick a machine to see the slot."}</p>
            )}
            <Bullets items={["Running cards never move. Everyone affected is notified.", "Recorded in the card history (and in each moved card's history) with your reason."]} />
          </Preview>
        )}
      />

      <Footer
        step={step}
        busy={insert.isPending}
        canReview={Boolean(machineId) && dateOk && reasonOk}
        missing={!machineId ? "Machine needed" : !dateOk ? "Date needed" : !reasonOk ? "Reason needed" : null}
        error={refusal}
        onReview={() => { setRefusal(null); setStep("confirm") }}
        onBack={() => { setRefusal(null); setStep("form") }}
        onConfirm={() => void submit()}
        onCancel={onDone}
        reviewLabel="Review insert"
        confirmLabel={`Yes, insert ${data.job_card_no} first`}
        testId="emergency-card"
      />
    </Frame>
  )
}

/** The action panel for one key; the caller decides where it lives. */
export function ActionPanel({ action, ...props }: ActionProps & { action: LifecycleAction }) {
  if (action === "split") return <SplitAction {...props} />
  if (action === "edit") return <EditAction {...props} />
  if (action === "emergency") return <EmergencyAction {...props} />
  return <ForceCloseAction {...props} />
}
