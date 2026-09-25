"use client"

import { ArrowDownRight, ArrowUpRight, Download, FileDown, LucideIcon, Minus, Printer } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

import { getAppearance, MODULE_APPEARANCES, type ModuleAppearance } from "@/lib/erp-appearance"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/workspace/page-header"

export function ExecutiveHero({
  appearance,
  title,
  description,
  badge,
  actions,
  aside,
  testId,
}: {
  appearance?: ModuleAppearance
  title?: string
  description?: string
  badge?: string
  actions?: ReactNode
  aside?: ReactNode
  testId?: string
}) {
  const resolvedAppearance = appearance || MODULE_APPEARANCES.dashboard
  return (
    <PageHeader
      variant="hero"
      appearance={resolvedAppearance}
      title={title || resolvedAppearance.title}
      description={description || resolvedAppearance.description}
      badge={badge}
      actions={actions}
      aside={aside}
      testId={testId}
    />
  )
}

export function MetricRail({
  children,
  className,
  testId,
}: {
  children: ReactNode
  className?: string
  testId?: string
}) {
  return (
    <section data-testid={testId} className={cn("stagger grid gap-3 sm:grid-cols-2 2xl:grid-cols-4", className)}>
      {children}
    </section>
  )
}

export type MetricTone = "slate" | "cyan" | "emerald" | "amber" | "rose" | "violet" | "blue" | "teal"

const METRIC_TONES: Record<MetricTone, { chip: string; stroke: string }> = {
  slate: { chip: "bg-muted text-muted-foreground ring-border", stroke: "hsl(var(--muted-foreground))" },
  cyan: { chip: "bg-signal-cyan-soft text-signal-cyan-ink ring-signal-cyan-line", stroke: "hsl(var(--chart-8))" },
  emerald: { chip: "bg-signal-emerald-soft text-signal-emerald-ink ring-signal-emerald-line", stroke: "hsl(var(--chart-7))" },
  amber: { chip: "bg-signal-amber-soft text-signal-amber-ink ring-signal-amber-line", stroke: "hsl(var(--chart-6))" },
  rose: { chip: "bg-signal-rose-soft text-signal-rose-ink ring-signal-rose-line", stroke: "hsl(var(--chart-5))" },
  violet: { chip: "bg-signal-violet-soft text-signal-violet-ink ring-signal-violet-line", stroke: "hsl(var(--chart-3))" },
  blue: { chip: "bg-signal-blue-soft text-signal-blue-ink ring-signal-blue-line", stroke: "hsl(var(--chart-2))" },
  teal: { chip: "bg-signal-teal-soft text-signal-teal-ink ring-signal-teal-line", stroke: "hsl(var(--chart-1))" },
}

/** Tiny inline trend line; no axes, no library, safe at any width. */
export function Sparkline({ values, stroke = "hsl(var(--chart-1))", className }: { values: number[]; stroke?: string; className?: string }) {
  const points = values.filter((value) => Number.isFinite(value))
  if (points.length < 2) return null
  const width = 120
  const height = 32
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const step = width / (points.length - 1)
  const coords = points.map((value, index) => [index * step, height - 3 - ((value - min) / span) * (height - 6)])
  const line = coords.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ")
  const area = `${line} L${width},${height} L0,${height} Z`
  const gradientId = `spark-${Math.abs(points.reduce((acc, value) => acc * 31 + value, 7) | 0)}`
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={cn("h-8 w-full overflow-visible", className)} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" style={{ strokeDasharray: 400, ["--dash" as any]: 400, animation: "draw-line 900ms var(--ease-workspace) both" }} />
    </svg>
  )
}

export function TrendPill({ value, suffix = "%", invert = false, label }: { value: number | null | undefined; suffix?: string; invert?: boolean; label?: string }) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null
  const numeric = Number(value)
  const good = invert ? numeric < 0 : numeric > 0
  const flat = Math.abs(numeric) < 0.05
  const Arrow = flat ? Minus : numeric > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
        flat ? "bg-muted text-muted-foreground" : good ? "bg-signal-emerald-soft text-signal-emerald-ink" : "bg-signal-rose-soft text-signal-rose-ink",
      )}
      title={label}
    >
      <Arrow className="h-3 w-3" aria-hidden="true" />
      {Math.abs(numeric).toLocaleString("en-IN", { maximumFractionDigits: 1 })}
      {suffix}
    </span>
  )
}

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "slate",
  testId,
  trend,
  trendLabel,
  invertTrend,
  spark,
  href,
  progress,
}: {
  label: string
  value: string | number
  detail?: string
  icon: LucideIcon
  tone?: MetricTone
  testId?: string
  /** Signed percentage change vs the comparison period. */
  trend?: number | null
  trendLabel?: string
  /** Set when a fall is good news (e.g. scrap, overdue). */
  invertTrend?: boolean
  spark?: number[]
  href?: string
  /** 0–100 fill for a thin progress track under the value. */
  progress?: number | null
}) {
  const palette = METRIC_TONES[tone] || METRIC_TONES.slate
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tube-kpi-label truncate">{label}</p>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="tube-kpi-value">{value}</p>
            <TrendPill value={trend} invert={invertTrend} label={trendLabel} />
          </div>
        </div>
        <span className={cn("tube-kpi-icon ring-1 ring-inset", palette.chip)}>
          <Icon aria-hidden="true" />
        </span>
      </div>
      {typeof progress === "number" && Number.isFinite(progress) ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${Math.max(0, Math.min(100, progress))}%`, background: palette.stroke }} />
        </div>
      ) : null}
      {spark && spark.length > 1 ? <Sparkline values={spark} stroke={palette.stroke} className="mt-2" /> : null}
      {detail ? <p className="mt-2 line-clamp-2 text-[12.5px] leading-5 text-muted-foreground">{detail}</p> : null}
    </>
  )
  if (href) {
    return (
      <Link href={href} data-testid={testId} className="tube-kpi erp-metric-card group block hover:border-primary/30">
        {body}
      </Link>
    )
  }
  return (
    <article data-testid={testId} className="tube-kpi erp-metric-card">
      {body}
    </article>
  )
}

export function StickyFilterBar({
  children,
  className,
  testId,
}: {
  children: ReactNode
  className?: string
  testId?: string
}) {
  return (
    <section
      data-testid={testId}
      className={cn(
        "tube-filter",
        className,
      )}
    >
      <div className="grid w-full gap-3 xl:grid-cols-[1fr_auto] xl:items-end">{children}</div>
    </section>
  )
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  testId,
  id,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  testId?: string
  id?: string
}) {
  return (
    <section
      id={id}
      data-testid={testId}
      className={cn("erp-panel min-w-0 rounded-xl p-4 sm:p-5", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
          {subtitle ? <p className="mt-0.5 max-w-3xl text-[13px] leading-5 text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="mt-4 min-w-0">{children}</div>
    </section>
  )
}

export function ExceptionList({
  items,
  emptyLabel,
}: {
  items: Array<{ id: string; title: string; detail: string; tone?: string }>
  emptyLabel: string
}) {
  if (items.length === 0) {
    return <EmptyState label={emptyLabel} />
  }

  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {items.map((item) => {
        const appearance = getAppearance(item.tone || "BLOCKED", item.tone || "Exception")
        const Icon = appearance.icon
        return (
          <div key={item.id} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-foreground/[.02]">
            <div className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg border", appearance.className)}>
              <Icon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-foreground">{item.title}</p>
              <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{item.detail}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function EmptyState({
  label,
  className,
}: {
  label: string
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-[hsl(var(--surface-2))] px-4 py-10 text-center text-[13px] text-muted-foreground", className)}>
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true" className="text-muted-foreground/60">
        <rect x="6" y="10" width="28" height="22" rx="4" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 18h8l2 3h8l2-3h8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M14 6l2 3M26 6l-2 3M20 4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {label}
    </div>
  )
}

export function StatusBadge({
  value,
  label,
  className,
}: {
  value?: string | null
  label?: string
  className?: string
}) {
  const appearance = getAppearance(value, label)

  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-medium leading-4", appearance.className, className)}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", appearance.dotClassName)} />
      {appearance.label}
    </span>
  )
}

export function ExportActions({
  onExportCsv,
  printHref,
  printLabel = "Print / PDF",
}: {
  onExportCsv?: () => void
  printHref?: string
  printLabel?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {onExportCsv ? (
        <button type="button" onClick={onExportCsv} className="erp-btn-secondary">
          <FileDown className="h-4 w-4" />
          Export CSV
        </button>
      ) : null}
      {printHref ? (
        <Link href={printHref} data-testid="erp-export-print" className="erp-btn-secondary">
          <Printer className="h-4 w-4" />
          {printLabel}
        </Link>
      ) : null}
      {!onExportCsv && !printHref ? (
        <button type="button" className="erp-btn-secondary">
          <Download className="h-4 w-4" />
          Export
        </button>
      ) : null}
    </div>
  )
}
