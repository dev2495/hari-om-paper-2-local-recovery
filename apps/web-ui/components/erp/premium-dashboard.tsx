"use client"

import type { ReactNode } from "react"
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { PageHeader } from "@/components/workspace/page-header"
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
  slate: "border-border bg-card text-foreground",
  cyan: "border-signal-cyan-line bg-signal-cyan-soft/80 text-signal-cyan-ink",
  amber: "border-signal-amber-line bg-signal-amber-soft/85 text-signal-amber-ink",
  emerald: "border-signal-emerald-line bg-signal-emerald-soft/85 text-signal-emerald-ink",
  rose: "border-signal-rose-line bg-signal-rose-soft/85 text-signal-rose-ink",
  violet: "border-signal-violet-line bg-signal-violet-soft/85 text-signal-violet-ink",
}

const lineColors: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  slate: "hsl(var(--foreground))",
  cyan: "hsl(var(--primary))",
  amber: "hsl(var(--brass))",
  emerald: "hsl(var(--signal-emerald-ink))",
  rose: "hsl(var(--signal-rose-ink))",
  violet: "hsl(var(--signal-violet-ink))",
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
        "rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition",
        active
          ? "border-slate-950 bg-slate-950 text-white"
          : "border-border bg-card text-muted-foreground hover:border-signal-cyan-line hover:text-signal-cyan-ink",
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
        "tube-kpi group flex min-h-[154px] flex-col justify-between overflow-hidden text-left transition-colors duration-150",
        isClickable && "hover:border-primary focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tube-kpi-label">{label}</p>
          <p className="tube-kpi-value">{value}</p>
          {detail ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p> : null}
        </div>
        {Icon ? (
          <div className="mt-1 text-muted-foreground">
            <Icon className="h-4 w-4 opacity-75" />
          </div>
        ) : null}
      </div>
      <div className="mt-4 space-y-3">
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
          <div className="h-14">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkline}>
                <Tooltip formatter={(point: number) => [formatCompactNumber(point, 0), label]} contentStyle={{ borderRadius: 10, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))", color: "hsl(var(--foreground))" }} />
                <Line type="monotone" dataKey="value" stroke={lineColors[tone]} strokeWidth={2.4} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : null}
        {hrefLabel ? <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{hrefLabel}</p> : null}
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
    <section className={cn("erp-panel min-w-0 rounded-xl p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="sr-only">{eyebrow}</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">{title}</h2>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
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
    <section className="space-y-3">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={item.onClick}
          className={cn(
            "flex w-full items-center justify-between gap-3 rounded-[1.35rem] border px-4 py-3 text-left shadow-sm transition",
            item.tone === "critical" && "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink",
            item.tone === "warn" && "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink",
            (!item.tone || item.tone === "good") && "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
          )}
        >
          <span className="text-sm font-medium">{item.title}</span>
          {item.action ? <span className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">{item.action}</span> : null}
        </button>
      ))}
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
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-medium text-muted-foreground">{row.label}</p>
            <p className="shrink-0 text-sm font-semibold text-foreground">
              {formatter ? formatter(row.value) : formatCompactNumber(row.value)}
            </p>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(0, (row.value / max) * 100)}%` }} />
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
    <div className="max-w-full overflow-x-auto rounded-[1.4rem] border border-border">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-950 text-white">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em]">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-card">
          {rows.length ? (
            rows.map((row, index) => (
              <tr key={String(row.id || row.key || row.code || index)} className="border-t border-border">
                {columns.map((column) => (
                  <td key={column.key} className="px-4 py-3 text-muted-foreground">
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
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))", color: "hsl(var(--foreground))" }} />
          {keys.map((entry) => (
            <Bar key={entry.key} dataKey={entry.key} fill={entry.color} radius={[6, 6, 0, 0]} />
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
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))", color: "hsl(var(--foreground))" }} />
          <Area type="monotone" dataKey={dataKey} stroke={color} fill={`url(#gradient-${dataKey})`} strokeWidth={2.5} />
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
        <Button key={item.label} variant={item.variant || "outline"} className="rounded-full" onClick={item.onClick}>
          {item.label}
        </Button>
      ))}
    </div>
  )
}
