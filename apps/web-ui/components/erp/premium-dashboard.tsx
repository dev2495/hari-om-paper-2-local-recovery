"use client"

import type { ReactNode } from "react"
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

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
  slate: "border-slate-200 bg-white text-slate-950",
  cyan: "border-cyan-200 bg-cyan-50/80 text-cyan-950",
  amber: "border-amber-200 bg-amber-50/85 text-amber-950",
  emerald: "border-emerald-200 bg-emerald-50/85 text-emerald-950",
  rose: "border-rose-200 bg-rose-50/85 text-rose-950",
  violet: "border-violet-200 bg-violet-50/85 text-violet-950",
}

const lineColors: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  slate: "#334155",
  cyan: "#0e7490",
  amber: "#d97706",
  emerald: "#15803d",
  rose: "#be123c",
  violet: "#6d28d9",
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
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-[2rem] border border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(8,145,178,0.14),transparent_26%),radial-gradient(circle_at_top_right,rgba(245,158,11,0.14),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.98))] px-6 py-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)]",
        className,
      )}
    >
      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr] xl:items-end">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-800/70">{eyebrow}</p>
          <h1 className="mt-3 max-w-4xl text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">{title}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
          {actions ? <div className="mt-5 flex flex-wrap items-center gap-3">{actions}</div> : null}
        </div>
        {aside ? (
          <div className="rounded-[1.6rem] border border-slate-200 bg-slate-950 p-5 text-white shadow-[0_20px_50px_rgba(15,23,42,0.18)]">
            {aside}
          </div>
        ) : null}
      </div>
    </section>
  )
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
          : "border-slate-200 bg-white text-slate-600 hover:border-cyan-200 hover:text-cyan-900",
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
        "group flex min-h-[184px] flex-col justify-between overflow-hidden rounded-[1.6rem] border p-5 text-left shadow-[0_18px_50px_rgba(15,23,42,0.06)] transition duration-200",
        toneClasses[tone],
        isClickable && "hover:-translate-y-0.5 hover:shadow-[0_24px_60px_rgba(15,23,42,0.10)]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-60">{label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
          {detail ? <p className="mt-2 text-sm leading-5 opacity-75">{detail}</p> : null}
        </div>
        {Icon ? (
          <div className="rounded-[1rem] border border-current/10 bg-white/60 p-3 shadow-sm">
            <Icon className="h-4 w-4 opacity-75" />
          </div>
        ) : null}
      </div>
      <div className="mt-4 space-y-3">
        {delta ? (
          <div className="flex items-center justify-between gap-3 text-xs font-semibold">
            <span className={cn("inline-flex items-center gap-1", delta.positive ? "text-emerald-700" : "text-rose-700")}>
              {delta.positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
              {formatCompactNumber(Math.abs(delta.value), delta.suffix === "%" ? 1 : 0)}
              {delta.suffix || ""}
            </span>
            <span className="text-slate-500">{delta.label || "vs prior window"}</span>
          </div>
        ) : null}
        {sparkline?.length ? (
          <div className="h-14">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkline}>
                <Tooltip formatter={(point: number) => [formatCompactNumber(point, 0), label]} contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0" }} />
                <Line type="monotone" dataKey="value" stroke={lineColors[tone]} strokeWidth={2.4} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : null}
        {hrefLabel ? <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{hrefLabel}</p> : null}
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
    <section className={cn("min-w-0 rounded-[1.9rem] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)]", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">{eyebrow}</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
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
            item.tone === "critical" && "border-rose-200 bg-rose-50 text-rose-950",
            item.tone === "warn" && "border-amber-200 bg-amber-50 text-amber-950",
            (!item.tone || item.tone === "good") && "border-emerald-200 bg-emerald-50 text-emerald-950",
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
            <p className="truncate text-sm font-medium text-slate-700">{row.label}</p>
            <p className="shrink-0 text-sm font-semibold text-slate-950">
              {formatter ? formatter(row.value) : formatCompactNumber(row.value)}
            </p>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-gradient-to-r from-cyan-700 via-cyan-600 to-emerald-500" style={{ width: `${Math.max(8, (row.value / max) * 100)}%` }} />
          </div>
          {row.hint ? <p className="text-xs text-slate-500">{row.hint}</p> : null}
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
    <div className="max-w-full overflow-x-auto rounded-[1.4rem] border border-slate-200">
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
        <tbody className="bg-white">
          {rows.length ? (
            rows.map((row, index) => (
              <tr key={String(row.id || row.key || row.code || index)} className="border-t border-slate-100">
                {columns.map((column) => (
                  <td key={column.key} className="px-4 py-3 text-slate-700">
                    {column.render ? column.render(row) : String(row[column.key] ?? "-")}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-slate-500">
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
          <Tooltip contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0" }} />
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
          <Tooltip contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0" }} />
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
