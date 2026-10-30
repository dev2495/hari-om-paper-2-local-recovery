"use client"

import { useSyncExternalStore, type ReactNode } from "react"
import { AlertTriangle, CheckCircle2, Clock3, Hourglass, MessageSquareText, Minus } from "lucide-react"

import { qty, type MonthEndItem } from "@/lib/api-month-end"
import { cn } from "@/lib/utils"

export type ItemTone = "need" | "explained" | "ok" | "sofar" | "waiting" | "nouse"

/** What a card is, in one word set: needs a note / explained / within limit / so far / waiting for count / no use. */
export function itemTone(item: MonthEndItem, running: boolean): ItemTone {
  if (item.status === "OVER" || item.status === "UNDER") return item.note ? "explained" : "need"
  // Nothing posted, issued or corrected: say so, rather than "Within limit" on a zero row.
  if (!item.has_use) return "nouse"
  if (item.status === "OK") return "ok"
  return running ? "sofar" : "waiting"
}

const TONE_STYLE: Record<ItemTone, { pill: string; edge: string; label: string; icon: typeof CheckCircle2 }> = {
  need: { pill: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink", edge: "before:bg-signal-amber-ink", label: "Needs a note", icon: AlertTriangle },
  explained: { pill: "border-signal-blue-line bg-signal-blue-soft text-signal-blue-ink", edge: "before:bg-signal-blue-ink", label: "Explained", icon: MessageSquareText },
  ok: { pill: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink", edge: "before:bg-signal-emerald-ink", label: "Within limit", icon: CheckCircle2 },
  sofar: { pill: "border-border bg-muted text-muted-foreground", edge: "before:bg-border", label: "So far", icon: Clock3 },
  waiting: { pill: "border-border bg-muted text-muted-foreground", edge: "before:bg-border", label: "Waiting for count", icon: Hourglass },
  nouse: { pill: "border-border bg-[hsl(var(--surface-2))] text-muted-foreground", edge: "before:bg-border", label: "No use", icon: Minus },
}

export function toneEdge(tone: ItemTone) {
  return TONE_STYLE[tone].edge
}

export function StatusPill({ tone, className }: { tone: ItemTone; className?: string }) {
  const style = TONE_STYLE[tone]
  const Icon = style.icon
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[12px] font-semibold", style.pill, className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {style.label}
    </span>
  )
}

/**
 * While the status is not known yet (so far / waiting for count), whether the floor gap is inside its
 * limit, in words: the meter's dot colour alone must never say it.
 */
export function SoFarLimit({ tone, gap, allowed, className }: { tone: ItemTone; gap: number | null | undefined; allowed: number; className?: string }) {
  if (tone !== "sofar" && tone !== "waiting") return null
  const outside = Math.abs(Number(gap || 0)) > Math.max(Number(allowed || 0), 0) + 0.0005
  const Icon = outside ? AlertTriangle : CheckCircle2
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[12px] font-semibold",
        outside ? "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink" : "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
        className,
      )}
      data-testid="month-end-sofar-limit"
      data-outside={outside ? "true" : "false"}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {outside ? "Outside limit" : "Within limit"}
    </span>
  )
}

/**
 * Diverging gap meter: a track centred on "exactly the spec + wastage", the allowed band shaded around
 * it, and a marker at the item's gap. The sentence beside it carries the same numbers in words, so the
 * meter never has to be read on its own.
 */
export function GapMeter({ gap, allowed, unit, label, className, compact }: { gap: number; allowed: number; unit: string; label: string; className?: string; compact?: boolean }) {
  const value = Number(gap || 0)
  const band = Math.max(Number(allowed || 0), 0.0001)
  const span = Math.max(Math.abs(value) * 1.15, band * 2)
  const position = (amount: number) => 50 + (Math.max(-span, Math.min(span, amount)) / span) * 50
  const inside = Math.abs(value) <= band + 0.0005
  const description = `${label}: ${value > 0 ? "+" : value < 0 ? "−" : ""}${qty(Math.abs(value), unit)} against a limit of ± ${qty(band, unit)}`
  return (
    <div className={cn("min-w-0", className)}>
      <div role="img" aria-label={description} title={description} className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
        <div
          className="absolute top-1/2 h-3 -translate-y-1/2 rounded-[4px] border border-signal-emerald-line bg-signal-emerald-soft"
          style={{ left: `${position(-band)}%`, right: `${100 - position(band)}%` }}
        />
        <div className="absolute left-1/2 top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 bg-foreground/35" />
        <div
          className={cn(
            "absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card transition-[left] duration-500 ease-out",
            inside ? "bg-signal-emerald-ink" : "bg-signal-amber-ink",
          )}
          style={{ left: `${position(value)}%` }}
        />
      </div>
      {compact ? null : (
        <div className="mt-0.5 flex justify-between gap-1 whitespace-nowrap text-[12px] font-medium leading-4 text-muted-foreground" aria-hidden="true">
          <span>Less</span>
          <span>Spec + wastage</span>
          <span>More</span>
        </div>
      )}
    </div>
  )
}

/** One labelled number in a card ("Spec allows · 10.16 kg"). */
export function Figure({ label, value, hint, muted, className, testId }: { label: string; value: ReactNode; hint?: ReactNode; muted?: boolean; className?: string; testId?: string }) {
  return (
    <div className={cn("min-w-0 rounded-lg bg-[hsl(var(--surface-2))] px-2 py-2 ring-1 ring-inset ring-border/60 sm:px-3", className)} data-testid={testId}>
      <p className="text-[12px] font-medium leading-tight text-muted-foreground sm:truncate">{label}</p>
      <p className={cn("mt-0.5 break-words font-semibold leading-tight", muted ? "text-[12.5px] text-muted-foreground sm:text-[15px]" : "text-[14px] text-foreground sm:text-[15px]")}>{value}</p>
      {hint ? <p className="mt-0.5 break-words text-[12px] leading-4 text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** Section card used across the page. */
export function Section({ id, title, subtitle, action, children, className, testId }: { id?: string; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <section id={id} data-testid={testId} className={cn("scroll-mt-24 rounded-xl border border-border bg-card p-4 shadow-premium sm:p-5", className)}>
      {title || action ? (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title ? <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2> : null}
            {subtitle ? <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{subtitle}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  )
}

const WIDE_QUERY = "(min-width: 1024px)"

/** True on a desktop-width screen (lg and up): items show as a table there and as cards on a phone. */
export function useWideScreen(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => undefined
      const query = window.matchMedia(WIDE_QUERY)
      query.addEventListener("change", onChange)
      return () => query.removeEventListener("change", onChange)
    },
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(WIDE_QUERY).matches : false),
    () => false,
  )
}
