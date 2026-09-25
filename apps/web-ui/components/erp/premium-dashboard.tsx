"use client"

import type { ReactNode } from "react"
import { AlertOctagon, AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, ChevronRight, type LucideIcon } from "lucide-react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { PageHeader } from "@/components/workspace/page-header"
import { ChartTooltip } from "@/components/erp/charts"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Delta = {
  value: number
  suffix?: string
  positive?: boolean
  label?: string
}

type KpiCardProps = {
  label: string
  value: string
  detail?: string
  icon?: LucideIcon
  tone?: "slate" | "cyan" | "amber" | "emerald" | "rose" | "violet"
  delta?: Delta
  sparkline?: Array<{ label: string; value: number }>
  onClick?: () => void
  hrefLabel?: string
}

const toneClasses: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  slate: "bg-muted text-muted-foreground ring-border",
  cyan: "bg-signal-cyan-soft text-signal-cyan-ink ring-signal-cyan-line",
  amber: "bg-signal-amber-soft text-signal-amber-ink ring-signal-amber-line",
  emerald: "bg-signal-emerald-soft text-signal-emerald-ink ring-signal-emerald-line",
  rose: "bg-signal-rose-soft text-signal-rose-ink ring-signal-rose-line",
  violet: "bg-signal-violet-soft text-signal-violet-ink ring-signal-violet-line",
}

const lineColors: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  slate: "hsl(var(--chart-axis))",
  cyan: "hsl(var(--chart-1))",
  amber: "hsl(var(--chart-6))",
  emerald: "hsl(var(--chart-7))",
  rose: "hsl(var(--chart-5))",
  violet: "hsl(var(--chart-3))",
}

export function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number.isFinite(value) ? value : 0)
}

export function formatCompactNumber(value: number, digits = 0) {
  return Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })
}

export function formatPercent(value: number, digits = 1) {
  return `${formatCompactNumber(value, digits)}%`
}

export function PageIntro({
  eyebrow,
  title,
  description,
  actions,
  aside,
  className,
}: {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
  aside?: ReactNode
  className?: string
}) {
  return <div className={className}><PageHeader title={title} description={description} actions={actions} aside={aside} /></div>
}

export function FilterChip({
  active,
  children,
  onClick,
}: {
  active?: boolean
  children: ReactNode
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center rounded-full border px-3 text-[12.5px] font-medium transition",
        active
          ? "border-foreground/10 bg-foreground text-background shadow-sm"
          : "border-border bg-card text-muted-foreground hover:border-input hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

export function KpiCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "slate",
  delta,
  sparkline,
  onClick,
  hrefLabel,
}: KpiCardProps) {
  const isClickable = Boolean(onClick)
  const Wrapper = isClickable ? "button" : "article"
  return (
    <Wrapper
      type={isClickable ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "tube-kpi group flex min-h-[132px] flex-col justify-between overflow-hidden text-left",
        isClickable && "cursor-pointer hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tube-kpi-label">{label}</p>
          <p className="tube-kpi-value">{value}</p>
          {detail ? <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-5 text-muted-foreground">{detail}</p> : null}
        </div>
        {Icon ? (
          <span className={cn("tube-kpi-icon ring-1 ring-inset", toneClasses[tone])}>
            <Icon aria-hidden="true" />
          </span>
        ) : null}
      </div>
      <div className="mt-3 space-y-2">
        {delta ? (
          <div className="flex items-center justify-between gap-3 text-xs font-semibold">
            <span className={cn("inline-flex items-center gap-1", delta.positive ? "text-signal-emerald-ink" : "text-signal-rose-ink")}>
              {delta.positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
              {formatCompactNumber(Math.abs(delta.value), delta.suffix === "%" ? 1 : 0)}
              {delta.suffix || ""}
            </span>
            <span className="text-muted-foreground">{delta.label || "vs prior window"}</span>
          </div>
        ) : null}
        {sparkline?.length ? (
          <div className="h-12">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkline} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
                <defs>
                  <linearGradient id={`kpi-${tone}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lineColors[tone]} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={lineColors[tone]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: "hsl(var(--foreground) / .15)" }} />
                <Area type="monotone" dataKey="value" name={label} stroke={lineColors[tone]} fill={`url(#kpi-${tone})`} strokeWidth={1.8} dot={false} animationDuration={700} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : null}
        {hrefLabel ? <p className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors group-hover:text-primary">{hrefLabel}<ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></p> : null}
      </div>
    </Wrapper>
  )
}

export function ChartCard({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
}: {
  eyebrow: string
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("erp-panel min-w-0 rounded-xl p-4 sm:p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="sr-only">{eyebrow}</p>
          <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
          {description ? <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="mt-4 min-w-0">{children}</div>
    </section>
  )
}

export function InsightStrip({
  items,
}: {
  items: Array<{ id: string; tone?: "good" | "warn" | "critical"; title: string; action?: string; onClick?: () => void }>
}) {
  if (!items.length) return null
  return (
    <section className="stagger grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const Icon = item.tone === "critical" ? AlertOctagon : item.tone === "warn" ? AlertTriangle : CheckCircle2
        return (
          <button
            key={item.id}
            type="button"
            onClick={item.onClick}
            className={cn(
              "group flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition hover:shadow-[var(--shadow-premium)]",
              item.tone === "critical" && "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink",
              item.tone === "warn" && "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink",
              (!item.tone || item.tone === "good") && "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-[13px] font-medium leading-5">{item.title}</span>
            {item.action ? <span className="inline-flex shrink-0 items-center gap-0.5 text-[12px] font-semibold opacity-80">{item.action}<ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></span> : null}
          </button>
        )
      })}
    </section>
  )
}

export function MiniBarList({
  rows,
  formatter,
}: {
  rows: Array<{ label: string; value: number; hint?: string }>
  formatter?: (value: number) => string
}) {
  const max = Math.max(1, ...rows.map((row) => row.value || 0))
  return (
    <div className="space-y-2.5">
      {rows.map((row, index) => (
        <div key={row.label} className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[13px] text-foreground/80">{row.label}</p>
            <p className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">
              {formatter ? formatter(row.value) : formatCompactNumber(row.value)}
            </p>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full origin-left rounded-full bg-gradient-to-r from-primary/70 to-primary animate-[bar-grow_700ms_var(--ease-workspace)_both]" style={{ width: `${Math.max(0, (row.value / max) * 100)}%`, animationDelay: `${index * 50}ms` }} />
          </div>
          {row.hint ? <p className="text-xs text-muted-foreground">{row.hint}</p> : null}
        </div>
      ))}
    </div>
  )
}

export function CompactTable({
  columns,
  rows,
  emptyLabel = "No rows available.",
}: {
  columns: Array<{ key: string; label: string; render?: (row: Record<string, any>) => ReactNode }>
  rows: Array<Record<string, any>>
  emptyLabel?: string
}) {
  return (
    <div className="max-w-full overflow-x-auto rounded-xl border border-border">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[hsl(var(--surface-2))] text-muted-foreground">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className="h-9 whitespace-nowrap px-3 text-[11.5px] font-semibold">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-card">
          {rows.length ? (
            rows.map((row, index) => (
              <tr key={String(row.id || row.key || row.code || index)} className="border-t border-border transition-colors hover:bg-foreground/[.025]">
                {columns.map((column) => (
                  <td key={column.key} className="px-3 py-2 text-[13px] text-foreground/85">
                    {column.render ? column.render(row) : String(row[column.key] ?? "-")}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">
                {emptyLabel}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export function TrendBars({
  rows,
  keys,
}: {
  rows: Array<Record<string, any>>
  keys: Array<{ key: string; label: string; color: string }>
}) {
  return (
    <div className="h-[320px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "hsl(var(--foreground) / .04)" }} />
          {keys.map((entry) => (
            <Bar key={entry.key} dataKey={entry.key} name={entry.label} fill={entry.color} radius={[4, 4, 0, 0]} maxBarSize={28} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function AreaTrend({
  rows,
  dataKey,
  color,
}: {
  rows: Array<Record<string, any>>
  dataKey: string
  color: string
}) {
  return (
    <div className="h-[320px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows}>
          <defs>
            <linearGradient id={`gradient-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.24} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: "hsl(var(--foreground) / .15)" }} />
          <Area type="monotone" dataKey={dataKey} stroke={color} fill={`url(#gradient-${dataKey})`} strokeWidth={2} activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ActionButtonRow({
  items,
}: {
  items: Array<{ label: string; onClick?: () => void; variant?: "default" | "outline" }>
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((item) => (
        <Button key={item.label} variant={item.variant || "outline"} onClick={item.onClick}>
          {item.label}
        </Button>
      ))}
    </div>
  )
}
