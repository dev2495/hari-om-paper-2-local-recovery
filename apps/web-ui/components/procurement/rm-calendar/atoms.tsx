"use client"

import type { DragEvent, ReactNode } from "react"
import { AlarmClock, AlertTriangle, BadgeCheck, CalendarCheck2, CheckCircle2, CircleDashed, FileText, FileX2, PackageCheck, Send, ShieldCheck, TrendingDown } from "lucide-react"

import type { Arrival, CalendarMaterial } from "@/lib/api-rm-calendar"
import { cn } from "@/lib/utils"

import { CHIP_CLASSES, LEGEND, chipState, compactQty, coverDays, coverWord, qty, shortDate, type ChipTone, type CoverWord } from "./format"

const CHIP_ICONS: Record<ChipTone, typeof CircleDashed> = {
  proposed: CircleDashed, approved: BadgeCheck, onpo: FileText, sent: Send, confirmed: CalendarCheck2, received: PackageCheck, overdue: AlarmClock, rejected: FileX2,
}

/** One arrival: state colour + icon + word + quantity. Drag it to another day when allowed.
 *  The state word is never cut ("Ov…" could be anything): when a day cell is too narrow for word and
 *  quantity on one line, the quantity wraps under the word (checker 2026-10-29). */
export function ArrivalChip({ arrival, uom, size = "sm", draggable = false, onDragStart, showDate = false, hideAmount = false, className }: {
  arrival: Arrival
  uom: string
  size?: "sm" | "md"
  /** State only, when the line beside it already says the quantities in words. */
  hideAmount?: boolean
  draggable?: boolean
  onDragStart?: (event: DragEvent<HTMLSpanElement>) => void
  showDate?: boolean
  className?: string
}) {
  const state = chipState(arrival)
  const Icon = CHIP_ICONS[state.tone]
  // A partly received line shows what is still to come (the same figure the balance counts);
  // the part already in says so in the label (checker 2026-10-30).
  const partly = arrival.state !== "RECEIVED" && Number(arrival.received_qty || 0) > 0
  const amount = arrival.state === "RECEIVED" ? arrival.received_qty : partly ? Number(arrival.open_qty ?? arrival.qty) : arrival.qty
  const early = arrival.state === "RECEIVED" && arrival.planned_date && arrival.planned_date !== arrival.date ? `, planned for ${shortDate(arrival.planned_date)}` : ""
  const receivedNote = partly ? ` still to come · ${qty(arrival.received_qty, uom)} received` : ""
  const label = `${state.label}: ${qty(amount, uom)}${receivedNote}${arrival.supplier_name ? ` from ${arrival.supplier_name}` : ""} on ${shortDate(arrival.date)}${early}${arrival.po_no ? `, ${arrival.po_no}` : ""}`
  return (
    <span
      draggable={draggable}
      onDragStart={onDragStart}
      title={label}
      aria-label={label}
      data-arrival={arrival.id}
      className={cn(
        "inline-flex max-w-full select-none flex-wrap items-center gap-x-1 gap-y-0.5 rounded-md border font-semibold leading-none",
        size === "sm" ? "min-h-[22px] px-1.5 py-[4px] text-[11px]" : "min-h-7 px-2 py-[6px] text-[12px]",
        CHIP_CLASSES[state.tone],
        draggable && "cursor-grab active:cursor-grabbing",
        className,
      )}
    >
      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
        <Icon className={size === "sm" ? "h-3 w-3 shrink-0" : "h-3.5 w-3.5 shrink-0"} aria-hidden="true" />
        {state.label}
      </span>
      {hideAmount ? null : <span className="shrink-0 whitespace-nowrap tabular-nums opacity-90">{size === "sm" ? compactQty(amount, uom) : qty(amount, uom)}</span>}
      {showDate ? <span className="shrink-0 font-medium opacity-80">· {shortDate(arrival.date)}</span> : null}
    </span>
  )
}

/** Thin projected-balance bar: teal while above the minimum, amber below it, rose below zero. */
export function BalanceBar({ value, scale, minimum, uom, className, hideValue = false }: { value: number; scale: number; minimum?: number | null; uom: string; className?: string; hideValue?: boolean }) {
  const negative = value < -0.0005
  const low = !negative && Boolean(minimum) && value < (minimum || 0) - 0.0005
  const width = scale > 0 ? Math.min(100, Math.max(negative ? 6 : value > 0 ? 4 : 0, (Math.abs(value) / scale) * 100)) : 0
  return (
    <div className={cn("flex items-center gap-1.5", className)} title={`Projected balance at day end: ${qty(value, uom)}`}>
      <div className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/[.07]">
        <div className={cn("absolute inset-y-0 left-0 rounded-full", negative ? "bg-signal-rose-ink/80" : low ? "bg-signal-amber-ink/80" : "bg-signal-teal-ink/70")} style={{ width: `${width}%` }} />
      </div>
      {hideValue ? null : <span className={cn("shrink-0 text-[11.5px] font-semibold tabular-nums", negative ? "text-signal-rose-ink" : low ? "text-signal-amber-ink" : "text-muted-foreground")}>{compactQty(value, uom)}</span>}
    </div>
  )
}

export function CoverBadge({ material, weeks, today, className, withDays = false, cover: given }: { material: CalendarMaterial; weeks: number; today: string; className?: string; withDays?: boolean; cover?: CoverWord }) {
  const cover = given || coverWord(material, weeks, today)
  const Icon = cover.tone === "ok" ? ShieldCheck : cover.tone === "low" ? TrendingDown : AlertTriangle
  const days = withDays && material.first_short ? coverDays(material, weeks) : ""
  return (
    <span title={[cover.text, days, cover.detail].filter(Boolean).join(" · ")} className={cn(
      "inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold",
      cover.tone === "ok" ? "bg-signal-emerald-soft text-signal-emerald-ink" : cover.tone === "low" ? "bg-signal-amber-soft text-signal-amber-ink" : "bg-signal-rose-soft text-signal-rose-ink",
      className,
    )}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{cover.text}{days ? <span className="font-medium"> · {days}</span> : null}</span>
    </span>
  )
}

/** Segmented control with real buttons (44 px tall on a phone). */
export function Segmented<T extends string>({ value, onChange, options, label, className, fill = false }: {
  value: T
  onChange: (value: T) => void
  /** count stays neutral (how many rows); short is a separate rose "N short" flag, never a red count (checker r4).
   *  flag marks a tab that needs action with an amber icon whose words ("11 drafts to send") screen readers hear. */
  options: Array<{ id: T; label: ReactNode; count?: number; flag?: string; short?: number }>
  label: string
  className?: string
  /** Full width on a phone, equal buttons; natural width from the small breakpoint up. */
  fill?: boolean
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex shrink-0 rounded-lg border border-border bg-muted/60 p-0.5", fill && "flex w-full sm:inline-flex sm:w-auto", className)}>
      {options.map((option) => {
        const active = option.id === value
        const badges = option.count !== undefined || Boolean(option.short) || Boolean(option.flag)
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.id)}
            className={cn(
              "inline-flex h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150 sm:h-8 sm:px-3",
              fill ? "min-w-0 flex-1 px-1.5 sm:flex-none" : "px-3",
              // Four equal tabs on a 390 px phone: the name sits over its badges, so nothing is cut.
              fill && badges && "max-sm:flex-col max-sm:gap-0.5 max-sm:leading-4",
              active ? "bg-card text-foreground shadow-[var(--shadow-xs)]" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
            {badges ? (
              <span className="inline-flex items-center gap-1">
                {option.count !== undefined ? (
                  <span className="rounded bg-foreground/[.06] px-1 text-[12px] font-semibold leading-4 tabular-nums text-foreground/80">{option.count}</span>
                ) : null}
                {option.flag ? (
                  <span className="inline-flex h-4 items-center rounded bg-signal-amber-soft px-0.5 text-signal-amber-ink" title={option.flag}>
                    <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="sr-only">{option.flag}</span>
                  </span>
                ) : null}
                {option.short ? (
                  <span className="inline-flex items-center gap-0.5 rounded bg-signal-rose-soft px-1 text-[12px] font-semibold leading-4 tabular-nums text-signal-rose-ink" aria-label={`${option.short} short`} title={`${option.short} short`}>
                    <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span aria-hidden="true">{option.short}<span className="hidden sm:inline"> short</span></span>
                  </span>
                ) : null}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

export function Legend({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", compact && "gap-x-1.5 gap-y-1.5", className)} aria-label="What the colours mean">
      {LEGEND.map((row) => {
        const Icon = CHIP_ICONS[row.tone]
        return (
          <li key={row.tone} className="flex items-center gap-1.5 text-[12px] text-muted-foreground" title={row.meaning}>
            <span className={cn("inline-flex h-[22px] items-center gap-1 rounded-md border px-1.5 text-[11px] font-semibold", CHIP_CLASSES[row.tone])}>
              <Icon className="h-3 w-3" aria-hidden="true" />{row.label}
            </span>
            {compact ? null : <span>{row.meaning}</span>}
          </li>
        )
      })}
      <li className="flex items-center gap-1.5 text-[12px] text-muted-foreground" title="Balance below zero (or below the minimum stock)">
        <span className="inline-flex h-[22px] items-center gap-1 rounded-md bg-signal-rose-soft px-1.5 text-[11px] font-semibold text-signal-rose-ink"><AlertTriangle className="h-3 w-3" aria-hidden="true" />Short</span>
        {compact ? null : <span>Balance below zero (or below the minimum stock)</span>}
      </li>
      <li className="flex items-center gap-1.5 text-[12px] text-muted-foreground" title="Material the plan uses that day">
        <span className="inline-flex h-[22px] items-center gap-1 rounded-md bg-signal-amber-soft px-1.5 text-[11px] font-semibold text-signal-amber-ink">Need</span>
        {compact ? null : <span>Material the plan uses that day</span>}
      </li>
    </ul>
  )
}

export function StatPair({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: "rose" | "amber" | "emerald" | "muted"; hint?: string }) {
  return (
    <div className="min-w-0" title={hint}>
      <dt className="text-[11.5px] font-medium text-muted-foreground">{label}</dt>
      {/* Wraps instead of truncating: a second line such as "+ 120 kg passing QC" must read in full. */}
      <dd className={cn("mt-0.5 break-words text-[14px] font-semibold leading-snug tabular-nums",
        tone === "rose" ? "text-signal-rose-ink" : tone === "amber" ? "text-signal-amber-ink" : tone === "emerald" ? "text-signal-emerald-ink" : tone === "muted" ? "text-muted-foreground" : "text-foreground")}>{value}</dd>
    </div>
  )
}

export function OkMark({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-1 text-[12px] font-medium text-signal-emerald-ink"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />{children}</span>
}
