"use client"

import { Ban, CalendarCheck2, CheckCircle2, Clock3, Flame, Loader, Scissors, Undo2 } from "lucide-react"

import { cn } from "@/lib/utils"

const STATE_STYLE: Record<string, { label: string; className: string; icon: any; hint: string }> = {
  QUEUED: { label: "In queue", className: "bg-signal-blue-soft text-signal-blue-ink ring-signal-blue-line", icon: Clock3, hint: "Released, not on the calendar — qty and color can still be edited" },
  SCHEDULED: { label: "Scheduled", className: "bg-signal-violet-soft text-signal-violet-ink ring-signal-violet-line", icon: CalendarCheck2, hint: "On the calendar — locked; force-close to change" },
  RUNNING: { label: "Running", className: "bg-signal-amber-soft text-signal-amber-ink ring-signal-amber-line", icon: Loader, hint: "Floor is recording output" },
  COMPLETED: { label: "Completed", className: "bg-signal-emerald-soft text-signal-emerald-ink ring-signal-emerald-line", icon: CheckCircle2, hint: "All stages done" },
  FORCE_CLOSED: { label: "Force-closed", className: "bg-signal-rose-soft text-signal-rose-ink ring-signal-rose-line", icon: Undo2, hint: "Closed at the qty made; balance returned to the order" },
  CANCELLED: { label: "Cancelled", className: "bg-muted text-muted-foreground ring-border", icon: Ban, hint: "Nothing made; whole qty returned to the order" },
}

/** Lifecycle from a planner summary row (no extra request). */
export function lifecycleFromSummary(job: any): string {
  const status = String(job?.status || "").toUpperCase()
  if (job?.close_mode === "FORCE") return status === "COMPLETED" ? "COMPLETED" : "FORCE_CLOSED"
  if (status === "CANCELLED" || job?.close_mode === "CANCELLED") return "CANCELLED"
  if (status === "COMPLETED") return "COMPLETED"
  if (status === "IN_PROGRESS" || String(job?.active_segment_status || "").toUpperCase() === "RUNNING") return "RUNNING"
  if (job?.current_shift_code || String(job?.active_segment_status || "").toUpperCase() === "ASSIGNED") return "SCHEDULED"
  return "QUEUED"
}

export function LifecycleBadge({ state, className, compact }: { state: string; className?: string; compact?: boolean }) {
  const style = STATE_STYLE[state] || STATE_STYLE.QUEUED
  const Icon = style.icon
  return (
    <span title={style.hint} className={cn("inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full px-2 text-[11.5px] font-semibold ring-1 ring-inset", style.className, className)}>
      <Icon className={cn("h-3 w-3", state === "RUNNING" && "animate-spin [animation-duration:2.4s]")} aria-hidden="true" />
      {compact ? null : style.label}
    </span>
  )
}

export function lifecycleLabel(state: string) {
  return (STATE_STYLE[state] || STATE_STYLE.QUEUED).label
}

const NAMED_COLORS: Array<[RegExp, string]> = [
  [/\b(royal |navy |sky |light |dark )?blue\b/i, "#3b82f6"],
  [/\bred|maroon|crimson\b/i, "#ef4444"],
  [/\byellow|golden|gold\b/i, "#eab308"],
  [/\bgreen|olive\b/i, "#22c55e"],
  [/\bpink|rose\b/i, "#ec4899"],
  [/\borange\b/i, "#f97316"],
  [/\bpurple|violet\b/i, "#8b5cf6"],
  [/\bbrown|kraft|natural|khaki\b/i, "#a16207"],
  [/\bblack\b/i, "#111827"],
  [/\bwhite|cream|ivory\b/i, "#f5f5f4"],
  [/\bgr[ae]y|silver\b/i, "#9ca3af"],
]

export function swatchFor(color?: string | null) {
  const text = String(color || "")
  for (const [pattern, value] of NAMED_COLORS) if (pattern.test(text)) return value
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `hsl(${hash % 360} 55% 55%)`
}

export function ColorChip({ color, className, empty = "No color" }: { color?: string | null; className?: string; empty?: string }) {
  if (!color) return <span className={cn("text-[12px] text-muted-foreground", className)}>{empty}</span>
  const name = String(color).split(/[·/]/)[0].trim()
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5 text-[12.5px]", className)} title={String(color)}>
      <span className="h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-black/15" style={{ background: swatchFor(color) }} />
      <span className="truncate">{name}</span>
    </span>
  )
}

/** Job card number in a mono chip, with family/emergency markers. */
export function JobCardNo({ job, className }: { job: any; className?: string }) {
  const number = job?.job_card_no || job?.job_card_ref || (job?.id ? `JC-${String(job.id).slice(0, 8).toUpperCase()}` : "—")
  const child = /-[A-Z]+$/.test(String(job?.job_card_no || ""))
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className="font-mono text-[12.5px] font-semibold tracking-tight text-foreground">{number}</span>
      {job?.is_emergency ? (
        <span title="Emergency — runs first" className="inline-flex h-[18px] items-center gap-0.5 rounded bg-signal-rose-soft px-1 text-[10.5px] font-bold text-signal-rose-ink ring-1 ring-inset ring-signal-rose-line">
          <Flame className="h-3 w-3" />Emergency
        </span>
      ) : null}
      {child ? (
        <span title={job?.split_kind === "CARRY_FORWARD" ? "Top-up of an earlier card" : "Split from a parent card"} className="inline-flex h-[18px] items-center rounded bg-muted px-1 text-[10.5px] font-semibold text-muted-foreground">
          <Scissors className="mr-0.5 h-2.5 w-2.5" />{job?.split_kind === "CARRY_FORWARD" ? "Top-up" : "Split"}
        </span>
      ) : null}
    </span>
  )
}
