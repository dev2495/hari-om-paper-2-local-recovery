"use client"

import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

import { TONE, dueTone, fmtDay, resultMeta, type Tone } from "./lib"

export function Section({ title, subtitle, children, action, className, bodyClassName, id }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; action?: ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return (
    <section id={id} className={cn("overflow-hidden rounded-xl border border-border bg-card shadow-premium", className)}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[12.5px] text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
      </header>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  )
}

export function ToneChip({ tone, Icon, children, className, title }: { tone: Tone; Icon?: LucideIcon; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-semibold leading-4", TONE[tone].chip, className)}>
      {Icon ? <Icon className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
      <span className="truncate">{children}</span>
    </span>
  )
}

export function ResultChip({ result, short, className }: { result?: string | null; short?: boolean; className?: string }) {
  const meta = resultMeta(result)
  return (
    <ToneChip tone={meta.tone} Icon={meta.Icon} className={className} title={meta.hint}>
      {short ? meta.short : meta.label}
    </ToneChip>
  )
}

export function DueChip({ due, today, className }: { due?: string | null; today?: string; className?: string }) {
  // Delivery date is optional on orders (client 2026-10-28): say so, never count it as late.
  if (!due) return <span className={cn("whitespace-nowrap text-muted-foreground", className)}>No date</span>
  const tone = dueTone(due, today)
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap tabular-nums", tone === "neutral" ? "text-foreground" : cn("font-semibold", TONE[tone].ink), className)}>
      {fmtDay(due)}
      {tone === "rose" ? <span className="text-[10.5px] font-semibold uppercase">late</span> : tone === "amber" ? <span className="text-[10.5px] font-semibold uppercase">soon</span> : null}
    </span>
  )
}

/** Made vs planned. Overrun past the plan shows as a full bar with a darker cap. */
export function ProgressBar({ value, max, tone, className, height = "h-1.5" }: { value: number; max: number; tone: Tone; className?: string; height?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : value > 0 ? 100 : 0
  return (
    <div className={cn("w-full overflow-hidden rounded-full bg-foreground/[.08]", height, className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", TONE[tone].bar)} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function loadTone(pct?: number | null): Tone {
  if (pct == null) return "neutral"
  if (pct > 100) return "rose"
  if (pct >= 85) return "amber"
  if (pct > 0) return "emerald"
  return "neutral"
}

/** Capacity used in one machine-shift. Text always sits beside the colour. */
export function LoadBar({ pct, label, className }: { pct?: number | null; label?: string; className?: string }) {
  const tone = loadTone(pct)
  const width = pct == null ? 0 : Math.min(100, Math.max(0, Number(pct)))
  return (
    <div className={cn("flex items-center gap-1.5", className)} title={label}>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/[.08]">
        <div className={cn("h-full rounded-full", TONE[tone].bar)} style={{ width: `${width}%` }} />
      </div>
      <span className={cn("shrink-0 text-[10.5px] font-semibold tabular-nums", pct == null ? "text-muted-foreground" : TONE[tone].ink)}>{pct == null ? "free" : `${Math.round(Number(pct))}%`}</span>
    </div>
  )
}

export function Tile({ label, value, hint, tone, Icon, onClick, active, testId }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; Icon?: LucideIcon; onClick?: () => void; active?: boolean; testId?: string }) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="tube-kpi-label">{label}</p>
        {Icon ? (
          <span className={cn("tube-kpi-icon", tone ? TONE[tone].soft : "bg-muted", tone ? TONE[tone].ink : "text-muted-foreground")}>
            <Icon aria-hidden="true" />
          </span>
        ) : null}
      </div>
      <p className={cn("tube-kpi-value", tone && tone !== "neutral" ? TONE[tone].ink : "")}>{value}</p>
      {hint ? <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{hint}</p> : null}
    </>
  )
  if (onClick) {
    return (
      <button type="button" data-testid={testId} onClick={onClick} aria-pressed={active} className={cn("tube-kpi text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "border-primary ring-1 ring-primary" : "")}>
        {inner}
      </button>
    )
  }
  return (
    <div className="tube-kpi" data-testid={testId}>
      {inner}
    </div>
  )
}

export function Checkbox({ checked, onChange, label, className, disabled, indeterminate, truncate, title }: { checked: boolean; onChange: (checked: boolean) => void; label: ReactNode; className?: string; disabled?: boolean; indeterminate?: boolean; truncate?: boolean; title?: string }) {
  return (
    <label title={title} className={cn("inline-flex min-h-8 max-w-full cursor-pointer items-center gap-2 text-[13px]", disabled ? "cursor-not-allowed opacity-60" : "", className)}>
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-input"
        checked={checked}
        disabled={disabled}
        ref={(node) => {
          if (node) node.indeterminate = Boolean(indeterminate) && !checked
        }}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={cn("min-w-0", truncate ? "flex-1 truncate" : "")}>{label}</span>
    </label>
  )
}

export function Legend({ items, className }: { items: { tone: Tone; label: string; Icon?: LucideIcon; count?: number }[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground", className)} aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          <span className={cn("inline-block h-2.5 w-2.5 rounded-sm", TONE[item.tone].bar)} aria-hidden="true" />
          {item.Icon ? <item.Icon className={cn("h-3 w-3", TONE[item.tone].ink)} aria-hidden="true" /> : null}
          <span>{item.label}</span>
          {item.count != null ? <span className="tabular-nums font-semibold text-foreground">{item.count}</span> : null}
        </li>
      ))}
    </ul>
  )
}

export function EmptyNote({ Icon, children, className }: { Icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
      {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
      <span>{children}</span>
    </p>
  )
}
