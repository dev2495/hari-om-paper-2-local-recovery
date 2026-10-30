"use client"

import { AlertTriangle, Ban, CalendarCheck2, CheckCircle2, Clock3, Flag, PauseCircle, Pencil, PlayCircle, Truck } from "lucide-react"

import { cn } from "@/lib/utils"
import { CARD_STAGES, STAGE_LABEL, STAGE_SHORT, cardState, routeStage, formatShortDate, orderDue, orderStatus, type CardMixChip, type OrderDue } from "@/lib/sales-order-tracker"

const fmt = (value: unknown) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })

export const TONE_CHIP: Record<string, string> = {
  slate: "border-border bg-muted text-muted-foreground",
  blue: "border-signal-blue-line bg-signal-blue-soft text-signal-blue-ink",
  violet: "border-signal-violet-line bg-signal-violet-soft text-signal-violet-ink",
  amber: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink",
  emerald: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
  teal: "border-signal-teal-line bg-signal-teal-soft text-signal-teal-ink",
  rose: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink",
}

export function Chip({ tone = "slate", icon: Icon, children, className, title, size = "sm" }: { tone?: keyof typeof TONE_CHIP; icon?: any; children: React.ReactNode; className?: string; title?: string; size?: "xs" | "sm" }) {
  return (
    <span title={title} className={cn("inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border font-medium", size === "xs" ? "h-[18px] px-1.5 text-[10.5px]" : "h-[22px] px-2 text-[11.5px]", TONE_CHIP[tone], className)}>
      {Icon ? <Icon className={size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3"} aria-hidden="true" /> : null}
      <span className="truncate">{children}</span>
    </span>
  )
}

const STATUS_STYLE: Record<string, { tone: keyof typeof TONE_CHIP; icon: any }> = {
  draft: { tone: "slate", icon: Pencil },
  approval: { tone: "amber", icon: Clock3 },
  ready: { tone: "violet", icon: PlayCircle },
  production: { tone: "blue", icon: PlayCircle },
  partly: { tone: "teal", icon: Truck },
  hold: { tone: "rose", icon: PauseCircle },
  closed: { tone: "emerald", icon: CheckCircle2 },
  cancelled: { tone: "slate", icon: Ban },
}

/** Order status in plain words with a colour and an icon (never colour alone). */
export function OrderStatusChip({ order, className, size }: { order: any; className?: string; size?: "xs" | "sm" }) {
  const status = orderStatus(order)
  const style = STATUS_STYLE[status.key] || STATUS_STYLE.draft
  const title = order?.is_held ? [order.hold_reason, order.hold_reason_code].filter(Boolean).join(" · ") || undefined : order?.closure_reason ? `${order.closure_reason}${order.closure_note ? ` — ${order.closure_note}` : ""}` : undefined
  return <Chip tone={style.tone} icon={style.icon} className={className} title={title} size={size}>{status.label}</Chip>
}

/** Due date with the risk in words: "Overdue 3 d", "Due today", "in 4 days". */
export function DueCell({ order, due: given, compact }: { order?: any; due?: OrderDue; compact?: boolean }) {
  const due = given || orderDue(order)
  // Delivery dates are optional (client 2026-10-28): no date is "No date", never overdue.
  if (!due.date) return <span className="text-muted-foreground" data-testid="due-no-date">No date</span>
  const tone = due.risk === "overdue" ? "rose" : due.risk === "today" || due.risk === "soon" ? "amber" : "slate"
  const icon = due.risk === "overdue" ? AlertTriangle : due.risk === "today" || due.risk === "soon" ? Clock3 : undefined
  return (
    <span className={cn("inline-flex", compact ? "flex-row items-center gap-1.5" : "flex-col gap-0.5")}>
      <span className={cn("tabular-nums", due.risk === "overdue" ? "font-semibold text-signal-rose-ink" : "text-foreground/90")}>{formatShortDate(due.date)}</span>
      {due.label ? <Chip tone={tone} icon={icon} size="xs">{due.label}</Chip> : null}
    </span>
  )
}

/** ordered → released → made → dispatched as one bar with the numbers under it. */
export function FulfilmentBar({ ordered, released, made, dispatched, compact, className, madeUnknown }: {
  ordered: number
  released: number
  made: number
  dispatched: number
  compact?: boolean
  className?: string
  madeUnknown?: boolean
}) {
  const base = Math.max(1, ordered)
  const pct = (value: number) => `${Math.max(0, Math.min(100, (value / base) * 100))}%`
  const safeMade = Math.max(made, dispatched)
  return (
    <div className={cn("min-w-[150px]", className)} aria-label={`Fulfilment: ${fmt(dispatched)} dispatched, ${fmt(safeMade)} made, ${fmt(released)} released of ${fmt(ordered)} ordered`}>
      <div className="relative h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span className="absolute inset-y-0 left-0 rounded-full bg-signal-blue-ink/35 transition-[width] duration-500" style={{ width: pct(released) }} />
        {!madeUnknown ? <span className="absolute inset-y-0 left-0 rounded-full bg-signal-teal-ink/70 transition-[width] duration-500" style={{ width: pct(safeMade) }} /> : null}
        <span className="absolute inset-y-0 left-0 rounded-full bg-signal-emerald-ink transition-[width] duration-500" style={{ width: pct(dispatched) }} />
      </div>
      <p className={cn("mt-1 flex flex-wrap gap-x-1.5 text-muted-foreground", compact ? "text-[11px]" : "text-[11.5px]")}>
        <span><strong className="tabular-nums text-foreground">{fmt(dispatched)}</strong> dispatched</span>
        <span aria-hidden="true">·</span>
        {madeUnknown ? <span>made —</span> : <span><strong className="tabular-nums text-foreground">{fmt(safeMade)}</strong> made</span>}
        <span aria-hidden="true">·</span>
        <span><strong className="tabular-nums text-foreground">{fmt(released)}</strong> released</span>
        <span aria-hidden="true">·</span>
        <span>of <strong className="tabular-nums text-foreground">{fmt(ordered)}</strong></span>
      </p>
    </div>
  )
}

export function FulfilmentLegend({ className }: { className?: string }) {
  return (
    <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground", className)}>
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-signal-emerald-ink" />dispatched</span>
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-signal-teal-ink/70" />made (cards done or packed)</span>
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-signal-blue-ink/35" />released to job cards</span>
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted ring-1 ring-inset ring-border" />ordered</span>
    </p>
  )
}

/** Job card state mix as chips: "2 running", "1 scheduled", "1 ready to dispatch"… */
export function CardMixChips({ chips, flagged, size = "xs" }: { chips: CardMixChip[]; flagged?: number; size?: "xs" | "sm" }) {
  return (
    <span className="flex flex-wrap gap-1">
      {chips.map((chip) => <Chip key={chip.key} tone={chip.tone} size={size}>{chip.count} {chip.label}</Chip>)}
      {flagged ? <Chip tone="amber" icon={Flag} size={size} title="A QC reading outside its band — allowed, flagged for review">{flagged} flagged QC</Chip> : null}
    </span>
  )
}

/** The flag words for a card with readings outside their band (amber, icon + words, never a hold). */
export function QcFlagChip({ runs, size = "xs" }: { runs: number; size?: "xs" | "sm" }) {
  if (!runs) return null
  return <Chip tone="amber" icon={Flag} size={size} title="QC reading outside its band — allowed and flagged, not held">Flagged · {runs} run{runs === 1 ? "" : "s"}</Chip>
}

/** Plan status of the current stage from the planner summary, in words. */
export function PlanChip({ job, size = "xs" }: { job: any; size?: "xs" | "sm" }) {
  const status = String(job?.plan_status || "").toUpperCase()
  const label = String(job?.plan_status_label || "")
  const short = label.includes(": ") ? label.split(": ").slice(1).join(": ") : label
  if (!status || status === "DONE" || status === "NO_PLAN_NEEDED") return null
  const tone = ["PLANNED", "RUNNING", "SPLIT"].includes(status) ? "blue" : ["MISSED", "PAST"].includes(status) ? "amber" : "slate"
  const icon = ["PLANNED", "RUNNING", "SPLIT"].includes(status) ? CalendarCheck2 : ["MISSED", "PAST"].includes(status) ? AlertTriangle : Clock3
  return <Chip tone={tone} icon={icon} size={size} title={label}>{short || "Not planned"}</Chip>
}

/** Compact stage dots from a planner summary row: done · now · to do. */
export function StageDots({ job, className }: { job: any; className?: string }) {
  const route = (job?.requires_slitting ? [...CARD_STAGES] : CARD_STAGES.filter((stage) => stage !== "SLITTING")) as string[]
  const current = routeStage(job?.current_stage)
  const state = cardState(job)
  const done = state === "COMPLETED" || current === "DONE"
  const at = route.indexOf(current)
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} title={done ? "All stages done" : state === "FORCE_CLOSED" ? `Closed early at ${STAGE_LABEL[current] || current}` : `At ${STAGE_LABEL[current] || current.toLowerCase()}`} aria-label={done ? "All stages done" : `At ${STAGE_LABEL[current] || current}`}>
      {route.map((stage, index) => {
        const step = done || (at >= 0 && index < at) ? "done" : index === at && state !== "FORCE_CLOSED" ? "now" : "todo"
        return (
          <span key={stage} className="inline-flex items-center">
            <span className={cn("grid h-[18px] min-w-[18px] place-items-center rounded px-1 text-[9.5px] font-bold leading-none", step === "done" ? "bg-signal-emerald-soft text-signal-emerald-ink ring-1 ring-inset ring-signal-emerald-line" : step === "now" ? "bg-signal-blue-ink text-background ring-2 ring-signal-blue-ink/25" : "bg-muted text-muted-foreground")}>
              {STAGE_SHORT[stage] || stage.slice(0, 1)}
            </span>
            {index < route.length - 1 ? <span className={cn("h-px w-1", step === "done" ? "bg-signal-emerald-ink" : "bg-border")} /> : null}
          </span>
        )
      })}
    </span>
  )
}
