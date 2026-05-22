"use client"

import { useMemo } from "react"
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Database,
  Gauge,
  Layers,
  Sparkles,
  Users,
} from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Panel } from "@/components/erp/shell"
import { cn } from "@/lib/utils"

import {
  DAY_LABELS,
  SEVERITY_COLORS,
  activityHeatmap,
  avatarTone,
  bucketByAction,
  bucketByActor,
  bucketByStream,
  bucketBySeverity,
  formatNumber,
  initials,
  relativeTime,
  severityClass,
  severityTrend,
  streamMeta,
  timestampText,
  type AuditEvent,
  type Severity,
} from "./audit-shared"

function heatmapColor(count: number, max: number) {
  if (count === 0) return "rgba(8, 145, 178, 0.06)"
  const t = Math.min(1, count / Math.max(1, max))
  const r = Math.round(189 + (8 - 189) * t)
  const g = Math.round(232 + (145 - 232) * t)
  const b = Math.round(249 + (178 - 249) * t)
  return `rgb(${r}, ${g}, ${b})`
}

function KpiTile({
  label,
  value,
  hint,
  tone = "cyan",
}: {
  label: string
  value: string | number
  hint?: string
  tone?: "cyan" | "emerald" | "amber" | "rose" | "violet" | "slate"
}) {
  const toneClass: Record<string, string> = {
    cyan: "border-cyan-200 bg-cyan-50/70",
    emerald: "border-emerald-200 bg-emerald-50/70",
    amber: "border-amber-200 bg-amber-50/70",
    rose: "border-rose-200 bg-rose-50/70",
    violet: "border-violet-200 bg-violet-50/70",
    slate: "border-slate-200 bg-white/90",
  }
  return (
    <div className={cn("rounded-[1.3rem] border px-4 py-3 shadow-sm", toneClass[tone])}>
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold leading-none text-slate-950">{value}</p>
      {hint ? <p className="mt-1.5 text-xs leading-5 text-slate-600">{hint}</p> : null}
    </div>
  )
}

export function AuditOverview({
  events,
  onSelect,
  lastSynced,
  activeUserCount,
  totalUserCount,
}: {
  events: AuditEvent[]
  onSelect: (event: AuditEvent) => void
  lastSynced: string
  activeUserCount: number
  totalUserCount: number
}) {
  const sev = useMemo(() => bucketBySeverity(events), [events])
  const actors = useMemo(() => bucketByActor(events, 6), [events])
  const actions = useMemo(() => bucketByAction(events, 7), [events])
  const streams = useMemo(() => bucketByStream(events), [events])
  const heatmap = useMemo(() => activityHeatmap(events), [events])
  const trend = useMemo(() => severityTrend(events), [events])
  const recentCritical = events.filter((e) => e.severity === "CRITICAL" || e.severity === "HIGH").slice(0, 6)
  const heatmapMax = Math.max(1, ...heatmap.flat())
  const totalEvents = events.length
  const totalActors = new Set(events.map((e) => e.actor)).size
  const totalCritical = sev.CRITICAL + sev.HIGH

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Events Indexed" value={formatNumber(totalEvents)} hint="In current window" tone="cyan" />
        <KpiTile label="Active Actors" value={formatNumber(totalActors)} hint={`${activeUserCount}/${totalUserCount} users`} tone="violet" />
        <KpiTile label="Critical + High" value={formatNumber(totalCritical)} hint={`${sev.CRITICAL} crit · ${sev.HIGH} high`} tone={totalCritical > 0 ? "rose" : "emerald"} />
        <KpiTile label="Medium Signals" value={formatNumber(sev.MEDIUM)} hint="Approvals + adjustments" tone="amber" />
        <KpiTile label="Streams Online" value={formatNumber(streams.filter((s) => s.count > 0).length)} hint={`${streams.length} configured`} tone="emerald" />
        <KpiTile label="Data Freshness" value={lastSynced} hint="Last sync" tone="slate" />
      </section>

      {/* Heatmap + severity gauge */}
      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel
          title="Activity heatmap"
          subtitle="7-day × 24-hour heat. Darker cells = more events. Spot off-hours anomalies and peak load."
        >
          <div className="flex flex-col gap-1">
            <div className="grid grid-cols-[32px_repeat(24,minmax(0,1fr))] gap-[3px] text-center">
              <span />
              {Array.from({ length: 24 }).map((_, h) => (
                <span key={h} className="text-[9.5px] font-bold text-slate-400">
                  {h % 6 === 0 ? `${h}` : ""}
                </span>
              ))}
            </div>
            {heatmap.map((row, d) => (
              <div key={d} className="grid grid-cols-[32px_repeat(24,minmax(0,1fr))] gap-[3px] items-center">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.04em]">{DAY_LABELS[d]}</span>
                {row.map((count, h) => (
                  <span
                    key={h}
                    className="aspect-square rounded transition-transform hover:scale-110"
                    style={{ background: heatmapColor(count, heatmapMax) }}
                    title={`${DAY_LABELS[d]} ${h}:00 — ${count} event${count === 1 ? "" : "s"}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Signal severity" subtitle="Severity inferred from action + status keywords across all streams.">
          <div className="grid grid-cols-2 gap-3">
            {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as Severity[]).map((sv) => (
              <div
                key={sv}
                className="rounded-2xl border px-4 py-3"
                style={{ background: SEVERITY_COLORS[sv].bg, borderColor: SEVERITY_COLORS[sv].ring, color: SEVERITY_COLORS[sv].fg }}
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-85">{sv}</p>
                <p className="mt-1 text-2xl font-semibold leading-none">{formatNumber(sev[sv])}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 h-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id="grad-crit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="grad-high" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f97316" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#f97316" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e2e8f0" vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 11 }} />
                <Area type="monotone" dataKey="HIGH" stroke="#f97316" strokeWidth={1.8} fill="url(#grad-high)" stackId="sev" />
                <Area type="monotone" dataKey="CRITICAL" stroke="#f43f5e" strokeWidth={1.8} fill="url(#grad-crit)" stackId="sev" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {/* Actor + action + system pulse */}
      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Top actors" subtitle="By total events in this window.">
          {actors.length === 0 ? (
            <p className="text-sm text-slate-500">No actors yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {actors.map((a) => {
                const max = Math.max(...actors.map((x) => x.count))
                const pct = (a.count / max) * 100
                return (
                  <li key={a.actor} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2">
                        <span className={cn("flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br text-[10px] font-bold text-white shadow-sm", avatarTone(a.actor))}>
                          {initials(a.actor)}
                        </span>
                        <span>
                          <span className="block text-sm font-semibold text-slate-900">{a.actor}</span>
                          <span className="block text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">{a.role || "—"}</span>
                        </span>
                      </span>
                      <span className="text-sm font-bold text-slate-900">{a.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100">
                      <div
                        className="h-1.5 rounded-full bg-gradient-to-r from-cyan-700 via-cyan-600 to-emerald-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Action mix" subtitle="Most common verbs across the audit signal.">
          {actions.length === 0 ? (
            <p className="text-sm text-slate-500">No actions yet.</p>
          ) : (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={actions} dataKey="count" nameKey="action" innerRadius={52} outerRadius={88} paddingAngle={3} stroke="#fff" strokeWidth={2}>
                    {actions.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {actions.slice(0, 6).map((a) => (
              <span
                key={a.action}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10.5px] font-bold text-slate-700"
              >
                <span className="h-2 w-2 rounded-full" style={{ background: a.color }} />
                {a.action.replaceAll("_", " ")} · {a.count}
              </span>
            ))}
          </div>
        </Panel>

        <Panel title="Stream lanes" subtitle="Volume across audit channels.">
          {streams.every((s) => s.count === 0) ? (
            <p className="text-sm text-slate-500">No stream activity yet.</p>
          ) : (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={streams} margin={{ top: 8, right: 8, bottom: 6, left: -10 }}>
                  <CartesianGrid stroke="#e2e8f0" vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 9.5, fill: "#475569" }} tickLine={false} axisLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 11 }} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {streams.map((s, i) => (
                      <Cell key={i} fill={s.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      {/* Recent critical feed */}
      <Panel
        title="Critical feed"
        subtitle="Highest-severity events in the current window — click any to drill into payload."
      >
        {recentCritical.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />
            <span className="font-semibold">All clear — no critical or high events in this window.</span>
          </div>
        ) : (
          <ul className="space-y-2">
            {recentCritical.map((ev) => {
              const meta = streamMeta(ev.stream)
              const Icon = meta.icon
              return (
                <li
                  key={ev.id}
                  onClick={() => onSelect(ev)}
                  className="group flex cursor-pointer items-start gap-3 rounded-[1.15rem] border border-slate-200 bg-white px-4 py-3 transition hover:-translate-y-0.5 hover:border-cyan-200 hover:shadow-md"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && onSelect(ev)}
                >
                  <span
                    className="mt-1 flex h-2 w-2 shrink-0 rounded-full"
                    style={{ background: SEVERITY_COLORS[ev.severity].fg }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]"
                        style={{ background: meta.color + "1a", borderColor: meta.color + "55", color: meta.color }}
                      >
                        <Icon className="h-3 w-3" />
                        {meta.short}
                      </span>
                      <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]", severityClass(ev.severity))}>
                        {ev.severity}
                      </span>
                      <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">
                        {timestampText(ev.timestamp, true)} · {relativeTime(ev.timestamp)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm font-semibold text-slate-900">{ev.action.replaceAll("_", " ")}</p>
                    <p className="mt-0.5 text-[12.5px] text-slate-600">
                      <span className="font-semibold text-slate-700">{ev.actor}</span> — {ev.summary}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </div>
  )
}
