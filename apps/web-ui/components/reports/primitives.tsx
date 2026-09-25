"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowRight, ChevronRight } from "lucide-react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { cn } from "@/lib/utils"

// ---------- formatters (re-exported for callers) ----------

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number.isFinite(value) ? value : 0)
}

export function formatNumber(value: number, digits = 0) {
  return Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })
}

export function formatPct(value: number, digits = 1) {
  return `${formatNumber(value, digits)}%`
}

// ---------- ReportHero ----------

export function ReportHero({
  eyebrow,
  title,
  description,
  chips,
  accent = "slate",
  children,
}: {
  eyebrow: string
  title: string
  description?: string
  chips?: Array<{ label: string; tone?: "ok" | "warn" | "critical" | "neutral" }>
  accent?: "slate" | "cyan" | "amber" | "rose" | "violet" | "emerald"
  children?: ReactNode
}) {
  const glow: Record<string, string> = {
    slate: "var(--chart-2)",
    cyan: "var(--chart-1)",
    amber: "var(--chart-6)",
    rose: "var(--chart-5)",
    violet: "var(--chart-3)",
    emerald: "var(--chart-7)",
  }
  const toneClass = (tone?: string) => {
    if (tone === "ok") return "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink"
    if (tone === "warn") return "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink"
    if (tone === "critical") return "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink"
    return "border-border bg-muted text-muted-foreground"
  }
  return (
    <section
      className="report-hero relative overflow-hidden rounded-2xl border border-border bg-card px-5 py-5 shadow-[var(--shadow-premium)] animate-enter-up sm:px-6"
      style={{ backgroundImage: `radial-gradient(120% 140% at 0% 0%, hsl(${glow[accent]} / .12) 0%, transparent 55%), radial-gradient(80% 120% at 100% 0%, hsl(${glow[accent]} / .06) 0%, transparent 60%)` }}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: `hsl(${glow[accent]})` }} aria-hidden="true" />
      <p className="tube-page-eyebrow !mb-2">{eyebrow}</p>
      <h1 className="max-w-4xl text-[22px] font-semibold tracking-tight text-foreground md:text-[26px]">{title}</h1>
      {description ? <p className="mt-1.5 max-w-3xl text-[13.5px] leading-6 text-muted-foreground">{description}</p> : null}
      {chips?.length ? (
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span key={c.label} className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-medium", toneClass(c.tone))}>
              {c.label}
            </span>
          ))}
        </div>
      ) : null}
      {children}
    </section>
  )
}

// ---------- ReportFilterBar ----------

export function ReportFilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="tube-filter">
      {children}
    </div>
  )
}

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-[12.5px] font-medium text-muted-foreground">
      <span>{label}</span>
      <span className="text-[13px] font-medium text-foreground">{children}</span>
    </label>
  )
}

// ---------- KpiRail ----------

export type KpiTone = "slate" | "cyan" | "amber" | "emerald" | "rose" | "violet"

export type KpiRailItem = {
  label: string
  value: string
  delta?: { value: string; direction?: "up" | "down" | "flat"; label?: string }
  detail?: string
  tone?: KpiTone
  href?: string
  onClick?: () => void
}

const railTone: Record<KpiTone, string> = {
  slate: "before:bg-muted-foreground/30",
  cyan: "before:bg-signal-cyan-ink/70",
  amber: "before:bg-signal-amber-ink/70",
  emerald: "before:bg-signal-emerald-ink/70",
  rose: "before:bg-signal-rose-ink/70",
  violet: "before:bg-signal-violet-ink/70",
}

export function KpiRail({ items, columns = 6 }: { items: KpiRailItem[]; columns?: 3 | 4 | 5 | 6 }) {
  const colsClass =
    columns === 6
      ? "grid-cols-2 md:grid-cols-3 xl:grid-cols-6"
      : columns === 5
        ? "grid-cols-2 md:grid-cols-3 xl:grid-cols-5"
        : columns === 4
          ? "grid-cols-2 md:grid-cols-2 xl:grid-cols-4"
          : "grid-cols-2 md:grid-cols-3"
  return (
    <div className={cn("stagger grid gap-3", colsClass)}>
      {items.map((item) => {
        const inner = (
          <div
            className={cn(
              "tube-kpi relative flex h-full flex-col !py-3.5 before:absolute before:left-0 before:top-3.5 before:h-6 before:w-[3px] before:rounded-r-full",
              railTone[item.tone || "slate"],
              (item.href || item.onClick) && "cursor-pointer hover:border-primary/30",
            )}
          >
            <p className="truncate text-[12px] font-medium text-muted-foreground">{item.label}</p>
            <p className="mt-1.5 text-[22px] font-semibold leading-tight tracking-tight tabular-nums text-foreground">{item.value}</p>
            {item.detail ? <p className="mt-1 line-clamp-2 text-[11.5px] leading-4 text-muted-foreground">{item.detail}</p> : null}
            {item.delta ? (
              <p
                className={cn(
                  "mt-auto pt-2 text-[11.5px] font-semibold tabular-nums",
                  item.delta.direction === "up" && "text-signal-emerald-ink",
                  item.delta.direction === "down" && "text-signal-rose-ink",
                  (!item.delta.direction || item.delta.direction === "flat") && "text-muted-foreground",
                )}
              >
                {item.delta.direction === "up" ? "▲ " : item.delta.direction === "down" ? "▼ " : "• "}
                {item.delta.value}
                {item.delta.label ? <span className="ml-1 font-normal text-muted-foreground">{item.delta.label}</span> : null}
              </p>
            ) : null}
          </div>
        )
        if (item.href) {
          return (
            <Link href={item.href} key={item.label}>
              {inner}
            </Link>
          )
        }
        if (item.onClick) {
          return (
            <button type="button" onClick={item.onClick} key={item.label} className="text-left">
              {inner}
            </button>
          )
        }
        return <div key={item.label}>{inner}</div>
      })}
    </div>
  )
}

// ---------- Panel ----------

export function Panel({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
}: {
  eyebrow?: string
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("erp-panel min-w-0 rounded-xl p-4 sm:p-5", className)}>
      {(eyebrow || title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {eyebrow ? <p className="text-[11.5px] font-medium text-muted-foreground">{eyebrow}</p> : null}
            {title ? <h2 className="mt-0.5 text-[15px] font-semibold tracking-tight text-foreground">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      )}
      {children}
    </section>
  )
}

// ---------- DrillLink ----------

export function DrillLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-1 text-[12.5px] font-medium text-primary hover:underline">
      {children} <ChevronRight className="h-3.5 w-3.5" />
    </Link>
  )
}

// ---------- NoteCallout ----------

export function NoteCallout({
  tone = "warn",
  children,
}: {
  tone?: "ok" | "warn" | "critical" | "neutral"
  children: ReactNode
}) {
  const toneClass =
    tone === "critical"
      ? "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink"
      : tone === "ok"
        ? "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink"
        : tone === "neutral"
          ? "border-border bg-muted text-muted-foreground"
          : "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink"
  return <p className={cn("mt-3 rounded-xl border px-3 py-2 text-sm font-medium leading-5", toneClass)}>{children}</p>
}

// ---------- Waterfall chart ----------

export type WaterfallBar = {
  label: string
  value: number // signed; positive = add, negative = subtract; mark `total: true` for absolute bars
  total?: boolean
  tone?: "positive" | "negative" | "anchor" | "neutral"
}

export function Waterfall({ bars, unit = "kg" }: { bars: WaterfallBar[]; unit?: string }) {
  // build cumulative positions
  let running = 0
  const data = bars.map((b) => {
    if (b.total) {
      running = b.value
      return { ...b, start: 0, end: b.value, delta: b.value }
    }
    const start = running
    const end = running + b.value
    running = end
    return { ...b, start, end, delta: b.value }
  })
  const allVals = data.flatMap((d) => [d.start, d.end])
  const maxVal = Math.max(1, ...allVals)
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${Math.max(640, bars.length * 110)} 320`} className="w-full" style={{ minWidth: bars.length * 80 }} preserveAspectRatio="xMidYMid meet">
        {/* grid */}
        {[0.25, 0.5, 0.75, 1].map((p) => (
          <line key={p} x1="60" x2={Math.max(640, bars.length * 110) - 20} y1={260 - p * 220} y2={260 - p * 220} stroke="hsl(var(--chart-grid))" strokeDasharray="3 3" />
        ))}
        {data.map((d, i) => {
          const x = 80 + i * 110
          const yTop = 260 - (Math.max(d.start, d.end) / maxVal) * 220
          const yBot = 260 - (Math.min(d.start, d.end) / maxVal) * 220
          const h = Math.max(2, yBot - yTop)
          const isAnchor = d.tone === "anchor" || d.total
          const fill = isAnchor
            ? "hsl(var(--foreground))"
            : d.tone === "positive" || (!d.tone && d.delta > 0)
              ? "hsl(var(--chart-7))"
              : d.tone === "negative" || (!d.tone && d.delta < 0)
                ? "hsl(var(--chart-5))"
                : "hsl(var(--chart-axis))"
          return (
            <g key={`${d.label}-${i}`}>
              <rect x={x} y={yTop} width="70" height={h} rx="6" fill={fill} opacity={isAnchor ? 0.95 : 0.85} />
              <text x={x + 35} y={yTop - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="hsl(var(--foreground))">
                {formatNumber(d.delta, d.delta > 1000 ? 0 : 1)} {unit}
              </text>
              <text x={x + 35} y={278} textAnchor="middle" fontSize="11" fontWeight="700" fill="hsl(var(--chart-axis))">
                {d.label}
              </text>
              {/* connector */}
              {i < data.length - 1 && !data[i + 1].total ? (
                <line
                  x1={x + 70}
                  x2={x + 110}
                  y1={260 - (d.end / maxVal) * 220}
                  y2={260 - (d.end / maxVal) * 220}
                  stroke="hsl(var(--chart-grid))"
                  strokeDasharray="3 3"
                />
              ) : null}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ---------- Funnel ----------

export type FunnelStage = { label: string; value: number; tone?: string }

export function Funnel({ stages, unit = "" }: { stages: FunnelStage[]; unit?: string }) {
  if (!stages.length) return null
  const max = Math.max(1, stages[0].value)
  return (
    <div className="space-y-1.5">
      {stages.map((stage, i) => {
        const width = (stage.value / max) * 100
        const drop = i > 0 ? stages[i - 1].value - stage.value : 0
        const dropPct = i > 0 && stages[i - 1].value > 0 ? (drop / stages[i - 1].value) * 100 : 0
        return (
          <div key={stage.label}>
            <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
              <span className="uppercase tracking-wide">{stage.label}</span>
              <span>
                <span className="font-bold text-foreground">{formatNumber(stage.value)}</span>
                {unit ? <span className="ml-1 text-muted-foreground">{unit}</span> : null}
              </span>
            </div>
            <div className="mt-1 h-7 w-full rounded-md bg-muted">
              <div
                className="h-7 rounded-md transition-all"
                style={{
                  width: `${Math.max(6, width)}%`,
                  background: i === 0 ? "hsl(var(--chart-1))" : i === stages.length - 1 ? "hsl(var(--chart-7))" : "hsl(var(--chart-8))",
                }}
              />
            </div>
            {i > 0 && drop > 0 ? (
              <div className="mt-0.5 pl-1 text-[11px] font-semibold text-signal-rose-ink">
                ▼ {formatNumber(drop)} ({formatPct(dropPct)}) dropped
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

// ---------- CalendarHeatmap (machine x hour or day x hour) ----------

export function CalendarHeatmap({
  rows,
  cols,
  values,
  rowLabels,
  colLabels,
  unit = "",
}: {
  rows: number
  cols: number
  values: number[] // length = rows*cols, row-major; 0..1 normalized recommended
  rowLabels: string[]
  colLabels: string[]
  unit?: string
}) {
  const max = Math.max(0.0001, ...values)
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-separate border-spacing-1 text-[10px]">
        <thead>
          <tr>
            <th className="text-left text-muted-foreground font-semibold uppercase tracking-wider px-1">&nbsp;</th>
            {colLabels.map((cl) => (
              <th key={cl} className="text-center text-muted-foreground font-semibold w-7">
                {cl}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={rowLabels[r] || r}>
              <td className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap pr-2">
                {rowLabels[r] || `R${r}`}
              </td>
              {Array.from({ length: cols }).map((__, c) => {
                const v = values[r * cols + c] || 0
                const intensity = Math.min(1, Math.max(0, v / max))
                const bg = `rgba(14,116,144,${0.08 + intensity * 0.82})`
                return (
                  <td
                    key={c}
                    title={`${rowLabels[r]} · ${colLabels[c]} · ${formatNumber(v, 1)}${unit}`}
                    className="h-6 w-7 rounded-[5px] text-center align-middle font-semibold"
                    style={{ backgroundColor: bg, color: intensity > 0.55 ? "hsl(var(--card))" : "hsl(var(--foreground))" }}
                  >
                    {intensity > 0.6 ? formatNumber(v, 0) : ""}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- DonutWithCenter ----------

export type DonutSlice = { label: string; value: number; color: string }

export function DonutWithCenter({
  slices,
  centerTop,
  centerBottom,
  size = 200,
}: {
  slices: DonutSlice[]
  centerTop: string
  centerBottom?: string
  size?: number
}) {
  const total = slices.reduce((acc, s) => acc + s.value, 0) || 1
  const r = 70
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg width={size} height={size} viewBox="0 0 200 200">
        <circle cx="100" cy="100" r={r} fill="none" stroke="hsl(var(--chart-grid))" strokeWidth="22" />
        {slices.map((s) => {
          const portion = s.value / total
          const dash = portion * c
          const gap = c - dash
          const dashoffset = -offset
          offset += dash
          return (
            <circle
              key={s.label}
              cx="100"
              cy="100"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth="22"
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={dashoffset}
              transform="rotate(-90 100 100)"
            />
          )
        })}
        <text x="100" y="96" textAnchor="middle" fontSize="20" fontWeight="800" fill="hsl(var(--foreground))">
          {centerTop}
        </text>
        {centerBottom ? (
          <text x="100" y="118" textAnchor="middle" fontSize="10" fontWeight="700" letterSpacing="2" fill="hsl(var(--chart-axis))">
            {centerBottom}
          </text>
        ) : null}
      </svg>
      <div className="flex-1 min-w-[180px] space-y-1.5">
        {slices.map((s) => {
          const pct = (s.value / total) * 100
          return (
            <div key={s.label} className="grid grid-cols-[120px_1fr_48px] items-center gap-2 text-xs">
              <span className="truncate">
                <span style={{ color: s.color }} className="font-extrabold">
                  ●
                </span>{" "}
                {s.label}
              </span>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-2" style={{ width: `${pct}%`, background: s.color }} />
              </div>
              <span className="text-right font-semibold text-muted-foreground">{formatPct(pct, 0)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------- MiniLadder ----------

export function MiniLadder({
  rows,
  formatter,
}: {
  rows: Array<{ label: string; value: number; hint?: string; tone?: string }>
  formatter?: (v: number) => string
}) {
  const max = Math.max(1, ...rows.map((r) => r.value || 0))
  return (
    <ul className="space-y-1.5">
      {rows.map((row) => {
        const pct = (row.value / max) * 100
        const fmt = formatter ? formatter(row.value) : formatNumber(row.value)
        return (
          <li key={row.label} className="grid grid-cols-[140px_1fr_80px] items-center gap-2 text-xs">
            <span className="truncate font-medium text-muted-foreground">{row.label}</span>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-2 rounded-full"
                style={{
                  width: `${pct}%`,
                  background:
                    row.tone === "critical"
                      ? "hsl(var(--chart-5))"
                      : row.tone === "warn"
                        ? "hsl(var(--chart-6))"
                        : row.tone === "ok"
                          ? "hsl(var(--chart-7))"
                          : "hsl(var(--chart-1))",
                }}
              />
            </div>
            <span className="text-right font-bold text-foreground">{fmt}</span>
            {row.hint ? <span className="col-span-3 -mt-0.5 pl-1 text-[10px] text-muted-foreground">{row.hint}</span> : null}
          </li>
        )
      })}
    </ul>
  )
}

// ---------- Pareto ----------

export function ParetoChart({
  bars,
  unit = "",
}: {
  bars: Array<{ label: string; value: number }>
  unit?: string
}) {
  const total = bars.reduce((acc, b) => acc + b.value, 0) || 1
  let running = 0
  const data = bars.map((b) => {
    running += b.value
    return { ...b, cumPct: (running / total) * 100 }
  })
  return (
    <div className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval={0} />
          <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip
            formatter={(v: number, name: string) => (name === "cumPct" ? [`${formatPct(v, 1)}`, "Cumulative"] : [`${formatNumber(v)} ${unit}`, "Value"])}
            contentStyle={{ borderRadius: 14, border: "1px solid hsl(var(--chart-grid))" }}
          />
          <Bar yAxisId="left" dataKey="value" radius={[6, 6, 0, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={i === 0 ? "hsl(var(--chart-5))" : i < 3 ? "hsl(var(--chart-5))" : i < 6 ? "hsl(var(--chart-6))" : "hsl(var(--chart-1))"} />
            ))}
          </Bar>
          <Area yAxisId="right" type="monotone" dataKey="cumPct" stroke="hsl(var(--foreground))" strokeWidth={2} fill="none" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------- ReportTable (lightweight, audit-grade) ----------

export type Column<T> = {
  key: keyof T | string
  label: string
  align?: "left" | "right" | "center"
  render?: (row: T) => ReactNode
  width?: string
}

export function ReportTable<T extends Record<string, any>>({
  columns,
  rows,
  empty,
  caption,
}: {
  columns: Column<T>[]
  rows: T[]
  empty?: string
  caption?: string
}) {
  if (!rows?.length) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-[hsl(var(--surface-2))] px-4 py-8 text-center text-[13px] text-muted-foreground">
        {empty || "No data for this window."}
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      {caption ? <p className="border-b border-border bg-[hsl(var(--surface-2))] px-3 py-1.5 text-[12px] font-medium text-muted-foreground">{caption}</p> : null}
      <table className="w-full text-[13px]">
        <thead className="bg-[hsl(var(--surface-2))]">
          <tr className="border-b border-border text-left text-[11.5px] font-semibold text-muted-foreground">
            {columns.map((c) => (
              <th
                key={String(c.key)}
                style={{ width: c.width, textAlign: c.align || (typeof rows[0]?.[c.key] === "number" ? "right" : "left") }}
                className="h-9 whitespace-nowrap px-3"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/70 transition-colors last:border-b-0 hover:bg-foreground/[.025]">
              {columns.map((c) => (
                <td
                  key={String(c.key)}
                  style={{ textAlign: c.align || (typeof row[c.key] === "number" ? "right" : "left") }}
                  className="px-3 py-2 tabular-nums text-foreground/85"
                >
                  {c.render ? c.render(row) : String(row[c.key as keyof T] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Pill ----------

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "ok" | "warn" | "critical" | "info" | "neutral"
  children: ReactNode
}) {
  const toneClass =
    tone === "ok"
      ? "bg-signal-emerald-soft text-signal-emerald-ink border-signal-emerald-line"
      : tone === "warn"
        ? "bg-signal-amber-soft text-signal-amber-ink border-signal-amber-line"
        : tone === "critical"
          ? "bg-signal-rose-soft text-signal-rose-ink border-signal-rose-line"
          : tone === "info"
            ? "bg-signal-cyan-soft text-signal-cyan-ink border-signal-cyan-line"
            : "bg-muted text-muted-foreground border-border"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        toneClass,
      )}
    >
      {children}
    </span>
  )
}

// ---------- VelocityMatrix (scatter: x = days-on-hand, y = value, r = burn) ----------

export type VelocityPoint = {
  code: string
  daysOnHand: number
  valueINR: number
  burnRate?: number
  tone?: "critical" | "warn" | "ok-rm" | "ok-fg" | "dead"
}

export function VelocityMatrix({ points, reorderDays = 10 }: { points: VelocityPoint[]; reorderDays?: number }) {
  const xMax = Math.max(90, ...points.map((p) => p.daysOnHand))
  const yMax = Math.max(50_00_000, ...points.map((p) => p.valueINR))
  const W = 600
  const H = 320
  const padL = 50
  const padR = 30
  const padT = 30
  const padB = 50
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const xScale = (d: number) => padL + Math.min(1, d / xMax) * innerW
  const yScale = (v: number) => padT + (1 - Math.min(1, v / yMax)) * innerH
  const toneColor = (t?: string) => {
    if (t === "critical") return "hsl(var(--chart-5))"
    if (t === "warn") return "hsl(var(--chart-6))"
    if (t === "ok-rm") return "hsl(var(--chart-1))"
    if (t === "ok-fg") return "hsl(var(--chart-7))"
    if (t === "dead") return "hsl(var(--chart-6))"
    return "hsl(var(--chart-axis))"
  }
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 320 }}>
        {/* quadrant tints */}
        <rect x={padL} y={padT} width={innerW * 0.25} height={innerH * 0.5} fill="rgba(220,38,38,0.06)" />
        <rect x={padL + innerW * 0.6} y={padT + innerH * 0.5} width={innerW * 0.4} height={innerH * 0.5} fill="rgba(245,158,11,0.05)" />
        <text x={padL + 10} y={padT + 18} fontSize="10" fontWeight="800" fill="hsl(var(--chart-5))">
          FIREFIGHT
        </text>
        <text x={padL + innerW - 90} y={padT + innerH - 6} fontSize="10" fontWeight="800" fill="hsl(var(--chart-6))">
          DEAD STOCK
        </text>
        {/* grid */}
        {[0.25, 0.5, 0.75].map((p) => (
          <line key={p} x1={padL} x2={W - padR} y1={padT + innerH * p} y2={padT + innerH * p} stroke="hsl(var(--chart-grid))" strokeDasharray="3 3" />
        ))}
        {/* reorder line */}
        <line
          x1={xScale(reorderDays)}
          x2={xScale(reorderDays)}
          y1={padT}
          y2={H - padB}
          stroke="hsl(var(--chart-5))"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          opacity="0.7"
        />
        <text x={xScale(reorderDays) + 6} y={padT + 12} fontSize="9" fill="hsl(var(--chart-5))" fontWeight="800">
          REORDER
        </text>
        {/* axes */}
        <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="hsl(var(--chart-axis))" />
        <line x1={padL} x2={padL} y1={padT} y2={H - padB} stroke="hsl(var(--chart-axis))" />
        {/* axis labels */}
        <text x={W / 2} y={H - 10} textAnchor="middle" fontSize="10" fontWeight="800" fill="hsl(var(--foreground))">
          DAYS ON HAND →
        </text>
        <text x={padL - 14} y={H - padB} fontSize="9" textAnchor="end" fill="hsl(var(--chart-axis))">
          0
        </text>
        <text x={padL - 14} y={padT + innerH * 0.5} fontSize="9" textAnchor="end" fill="hsl(var(--chart-axis))">
          {formatCurrency(yMax / 2)}
        </text>
        <text x={padL - 14} y={padT + 8} fontSize="9" textAnchor="end" fill="hsl(var(--chart-axis))">
          {formatCurrency(yMax)}
        </text>
        {/* points */}
        {points.map((p, i) => {
          const x = xScale(p.daysOnHand)
          const y = yScale(p.valueINR)
          const r = Math.max(7, Math.min(20, (p.burnRate || 8) / 1.2))
          return (
            <g key={`${p.code}-${i}`}>
              <circle cx={x} cy={y} r={r} fill={toneColor(p.tone)} opacity={0.8} />
              <text x={x} y={y + 3} textAnchor="middle" fontSize="8" fontWeight="800" fill="hsl(var(--card))">
                {p.code.length > 9 ? `${p.code.slice(0, 8)}…` : p.code}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-rose-600 align-middle mr-1" /> Reorder now</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 align-middle mr-1" /> Watch</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-cyan-700 align-middle mr-1" /> Healthy RM</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-700 align-middle mr-1" /> Healthy FG</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-700 align-middle mr-1" /> Dead/obsolete</span>
      </div>
    </div>
  )
}

// ---------- LeadTimeAnatomy ----------

export type LeadStage = { label: string; days: number; cumulative?: number; tone?: "ok" | "warn" | "critical" }

export function LeadTimeAnatomy({ stages, totalLabel = "Total" }: { stages: LeadStage[]; totalLabel?: string }) {
  const total = stages.reduce((acc, s) => acc + s.days, 0) || 1
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        <span>Order created → dispatch</span>
        <span>
          {totalLabel}: <span className="font-bold text-foreground">{formatNumber(total, 1)} d</span>
        </span>
      </div>
      <div className="flex h-8 w-full overflow-hidden rounded-xl border border-border">
        {stages.map((s, i) => {
          const w = (s.days / total) * 100
          const color =
            s.tone === "critical" ? "hsl(var(--chart-5))" : s.tone === "warn" ? "hsl(var(--chart-6))" : s.tone === "ok" ? "hsl(var(--chart-7))" : i % 2 === 0 ? "hsl(var(--chart-1))" : "hsl(var(--chart-8))"
          return (
            <div
              key={s.label}
              title={`${s.label} · ${formatNumber(s.days, 1)} d`}
              className="flex items-center justify-center text-[10px] font-bold text-white"
              style={{ width: `${Math.max(2, w)}%`, background: color }}
            >
              {w > 8 ? `${formatNumber(s.days, 1)}d` : ""}
            </div>
          )
        })}
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground md:grid-cols-3">
        {stages.map((s, i) => (
          <li key={s.label} className="flex justify-between">
            <span>
              <span className="font-bold text-muted-foreground">{i + 1}.</span> {s.label}
            </span>
            <span className="font-semibold text-foreground">{formatNumber(s.days, 1)} d</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------- ReportTileLink (used by landing) ----------

export function ReportTileLink({
  href,
  title,
  description,
  accent = "slate",
  chips,
}: {
  href: string
  title: string
  description: string
  accent?: "owner" | "ops" | "sales" | "inv" | "qc" | "disp" | "slate"
  chips?: Array<{ label: string }>
}) {
  const accentClass: Record<string, string> = {
    owner: "from-card to-signal-teal-soft text-foreground",
    ops: "from-card to-signal-cyan-soft text-foreground",
    sales: "from-card to-signal-amber-soft text-foreground",
    inv: "from-card to-signal-emerald-soft text-foreground",
    qc: "from-card to-signal-violet-soft text-foreground",
    disp: "from-card to-signal-rose-soft text-foreground",
    slate: "from-card to-muted text-foreground",
  }
  return (
    <Link
      href={href}
      className={cn(
        "group block rounded-xl border border-border bg-gradient-to-br px-4 py-4 shadow-[var(--shadow-premium)] transition duration-200 hover:border-primary/30 hover:shadow-[var(--shadow-premium-hover)]",
        accentClass[accent],
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
        <ArrowRight className="h-4 w-4 opacity-60 transition group-hover:translate-x-1 group-hover:text-primary group-hover:opacity-100" />
      </div>
      <p className="mt-1.5 text-[12.5px] leading-5 text-muted-foreground">{description}</p>
      {chips?.length ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span key={c.label} className="rounded-full border border-border bg-card/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {c.label}
            </span>
          ))}
        </div>
      ) : null}
    </Link>
  )
}
