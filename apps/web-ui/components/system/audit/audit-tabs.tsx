"use client"

import { useMemo } from "react"
import Link from "next/link"
import { Download, ShieldCheck, UserCog, Users } from "lucide-react"
import {
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
  ACTION_COLORS,
  bucketByAction,
  bucketByActor,
  bucketBySeverity,
  dateBucket,
  downloadCsv,
  formatNumber,
  initials,
  avatarTone,
  relativeTime,
  severityClass,
  streamMeta,
  timestampText,
  type AuditEvent,
  type AuditStream,
} from "./audit-shared"

/* ============================================================
 *  Activity Feed (chronological, grouped by date bucket)
 * ============================================================ */

export function AuditFeed({
  events,
  onSelect,
}: {
  events: AuditEvent[]
  onSelect: (event: AuditEvent) => void
}) {
  const grouped = useMemo(() => {
    const acc: Array<{ label: string; rows: AuditEvent[] }> = []
    events.forEach((event) => {
      const label = dateBucket(event.timestamp)
      const existing = acc.find((g) => g.label === label)
      if (existing) existing.rows.push(event)
      else acc.push({ label, rows: [event] })
    })
    return acc
  }, [events])

  if (events.length === 0) {
    return (
      <Panel title="Activity feed" subtitle="No events match the current filters.">
        <p className="rounded-2xl border border-dashed border-border bg-muted/60 px-4 py-10 text-center text-sm text-muted-foreground">
          Activity will appear here once operational signals flow.
        </p>
      </Panel>
    )
  }

  return (
    <Panel
      title="Activity feed"
      subtitle={`${formatNumber(events.length)} events grouped by date — click any row for the full payload.`}
      actions={
        <button
          onClick={() => downloadCsv(`audit-feed-${new Date().toISOString().slice(0, 10)}.csv`, events)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-[12px] font-semibold text-muted-foreground transition hover:border-signal-cyan-line hover:text-signal-cyan-ink"
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </button>
      }
    >
      <div className="space-y-5">
        {grouped.map((group) => (
          <div key={group.label} className="space-y-2">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
              {group.label} <span className="text-slate-300">·</span> {group.rows.length}
            </p>
            <ul className="space-y-2">
              {group.rows.slice(0, 60).map((event) => {
                const meta = streamMeta(event.stream)
                const Icon = meta.icon
                return (
                  <li
                    key={event.id}
                    onClick={() => onSelect(event)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && onSelect(event)}
                    className="group flex cursor-pointer items-start gap-3 rounded-[1.15rem] border border-border bg-card px-4 py-3 transition hover:-translate-y-0.5 hover:border-signal-cyan-line hover:shadow-md"
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-white shadow-md ring-1 ring-white/40"
                      style={{ background: `linear-gradient(135deg, ${meta.color}, ${meta.color}cc)` }}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{event.action.replaceAll("_", " ")}</span>
                        <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]", severityClass(event.severity))}>
                          {event.severity}
                        </span>
                        <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                          {timestampText(event.timestamp, true)} · {relativeTime(event.timestamp)}
                        </span>
                      </div>
                      <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                        <span className="font-semibold text-foreground">{event.actor}</span> · {event.summary}
                        {event.reference ? (
                          <span className="ml-2 font-mono text-[11.5px] text-signal-cyan-ink">[{event.reference}]</span>
                        ) : null}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/* ============================================================
 *  Users & Access tab
 * ============================================================ */

const ROLE_COLORS: Record<string, string> = {
  Owner: "#0e7490",
  Admin: "#7c3aed",
  Planner: "#0891b2",
  PlantManager: "#059669",
  Sales: "#f59e0b",
  Store: "#be185d",
  Dispatch: "#0f766e",
  Operator: "#64748b",
  QC: "#dc2626",
}

function roleColor(role: string) {
  return ROLE_COLORS[role] || "#64748b"
}

export function AuditUsers({
  users,
  events,
  onSelect,
}: {
  users: any[]
  events: AuditEvent[]
  onSelect: (event: AuditEvent) => void
}) {
  const roleDist = useMemo(() => {
    const map = new Map<string, number>()
    users.forEach((u: any) => {
      const role = String(u?.role || (Array.isArray(u?.roles) ? u.roles[0] : "") || "user")
      map.set(role, (map.get(role) || 0) + 1)
    })
    return Array.from(map.entries()).map(([role, count]) => ({ role, count, color: roleColor(role) }))
  }, [users])

  const sessionEvents = useMemo(() => events.filter((e) => e.stream === "session").slice(0, 8), [events])

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Headcount" subtitle="Active users across the workspace.">
          <div className="text-4xl font-semibold tracking-tight text-foreground">{formatNumber(users.length)}</div>
          <p className="mt-1 text-sm text-muted-foreground">
            {users.filter((u: any) => u.is_active !== false).length} active · {users.filter((u: any) => u.is_active === false).length} inactive
          </p>
        </Panel>

        <Panel title="Role distribution" subtitle="Who holds which role across the team.">
          {roleDist.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users loaded.</p>
          ) : (
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={roleDist} dataKey="count" nameKey="role" innerRadius={46} outerRadius={76} paddingAngle={3} stroke="#fff" strokeWidth={2}>
                    {roleDist.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {roleDist.map((r) => (
              <span
                key={r.role}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[10.5px] font-bold text-muted-foreground"
              >
                <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
                {r.role} · {r.count}
              </span>
            ))}
          </div>
        </Panel>

        <Panel title="Recent sessions" subtitle="Last-seen users derived from login timestamps.">
          {sessionEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No session signals yet.</p>
          ) : (
            <ul className="space-y-2">
              {sessionEvents.map((event) => (
                <li
                  key={event.id}
                  onClick={() => onSelect(event)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && onSelect(event)}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 transition hover:border-signal-cyan-line"
                >
                  <span className={cn("flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br text-[10.5px] font-bold text-white", avatarTone(event.actor))}>
                    {initials(event.actor)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{event.actor}</p>
                    <p className="text-[11px] text-muted-foreground">{relativeTime(event.timestamp)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="User directory" subtitle="All users in the current plant scope with role and access posture.">
        {users.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-muted/60 px-4 py-10 text-center text-sm text-muted-foreground">
            No users loaded.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="max-h-[460px] overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-950 text-[10px] uppercase tracking-[0.18em] text-white">
                  <tr>
                    <th className="px-4 py-3 text-left">User</th>
                    <th className="px-4 py-3 text-left">Role</th>
                    <th className="px-4 py-3 text-left">Plant</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u: any) => {
                    const role = String(u?.role || (Array.isArray(u?.roles) ? u.roles[0] : "") || "user")
                    return (
                      <tr key={u.id} className="border-t border-border transition hover:bg-signal-cyan-soft/30">
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-2.5">
                            <span className={cn("flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br text-[10.5px] font-bold text-white", avatarTone(u?.name || u?.email || ""))}>
                              {initials(u?.name || u?.email || "")}
                            </span>
                            <span>
                              <span className="block font-semibold text-foreground">{u?.name || u?.email || "—"}</span>
                              <span className="block text-[11px] font-medium text-muted-foreground">{u?.email || ""}</span>
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em]"
                            style={{ borderColor: roleColor(role) + "55", background: roleColor(role) + "1a", color: roleColor(role) }}
                          >
                            {role}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11.5px] text-muted-foreground">{u?.plant_id || "—"}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em]",
                            u?.is_active === false ? "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink" : "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
                          )}>
                            <span className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              u?.is_active === false ? "bg-rose-500" : "bg-emerald-500",
                            )} />
                            {u?.is_active === false ? "Inactive" : "Active"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-[12.5px] text-muted-foreground">
                          {u?.last_login_at ? relativeTime(u.last_login_at) : "—"}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="mt-3 flex items-center justify-end">
          <Link href="/system/users" className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.12em] text-signal-cyan-ink hover:text-signal-cyan-ink">
            <UserCog className="h-3.5 w-3.5" />
            Manage users & roles
          </Link>
        </div>
      </Panel>
    </div>
  )
}

/* ============================================================
 *  Notifications tab
 * ============================================================ */

export function AuditNotifications({
  events,
  onSelect,
}: {
  events: AuditEvent[]
  onSelect: (event: AuditEvent) => void
}) {
  const filtered = useMemo(() => events.filter((e) => e.stream === "notifications"), [events])
  const byRole = useMemo(() => {
    const map = new Map<string, number>()
    filtered.forEach((e) => map.set(e.role || "system", (map.get(e.role || "system") || 0) + 1))
    return Array.from(map.entries()).map(([role, count], i) => ({ role, count, color: ACTION_COLORS[i % ACTION_COLORS.length] }))
  }, [filtered])
  const sev = useMemo(() => bucketBySeverity(filtered), [filtered])

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-signal-cyan-line bg-signal-cyan-soft/70 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Total Alerts</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatNumber(filtered.length)}</p>
        </div>
        <div className="rounded-2xl border border-signal-rose-line bg-signal-rose-soft/70 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Critical / High</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatNumber(sev.CRITICAL + sev.HIGH)}</p>
        </div>
        <div className="rounded-2xl border border-signal-amber-line bg-signal-amber-soft/70 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Medium</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatNumber(sev.MEDIUM)}</p>
        </div>
        <div className="rounded-2xl border border-signal-emerald-line bg-signal-emerald-soft/70 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Info</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatNumber(sev.LOW)}</p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_1.4fr]">
        <Panel title="By role" subtitle="Which role channels are loudest right now.">
          {byRole.length === 0 ? (
            <p className="text-sm text-muted-foreground">No role-tagged notifications yet.</p>
          ) : (
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byRole} layout="vertical">
                  <CartesianGrid horizontal={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="role" tick={{ fontSize: 10.5, fill: "#475569" }} tickLine={false} axisLine={false} width={100} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 11 }} />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                    {byRole.map((r, i) => (
                      <Cell key={i} fill={r.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel
          title="Notification feed"
          subtitle="Workflow signals routed across the ERP — click to drill in."
        >
          {filtered.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border bg-muted/60 px-4 py-8 text-center text-sm text-muted-foreground">
              No notifications in this window.
            </p>
          ) : (
            <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {filtered.slice(0, 60).map((event) => (
                <li
                  key={event.id}
                  onClick={() => onSelect(event)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && onSelect(event)}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 transition hover:border-signal-cyan-line hover:bg-signal-cyan-soft/30"
                >
                  <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]", severityClass(event.severity))}>
                    {event.severity}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{event.action.replaceAll("_", " ")}</p>
                    <p className="text-[12.5px] text-muted-foreground">{event.summary}</p>
                  </div>
                  <span className="shrink-0 text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    {relativeTime(event.timestamp)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}

/* ============================================================
 *  Stream-scoped tab (Sales/Production, Inventory, Master, etc.)
 * ============================================================ */

export function AuditStreamTab({
  events,
  streams,
  title,
  subtitle,
  onSelect,
  emptyHint,
}: {
  events: AuditEvent[]
  streams: AuditStream[]
  title: string
  subtitle: string
  onSelect: (event: AuditEvent) => void
  emptyHint?: string
}) {
  const filtered = useMemo(() => events.filter((e) => streams.includes(e.stream)), [events, streams])
  const actors = useMemo(() => bucketByActor(filtered, 6), [filtered])
  const actions = useMemo(() => bucketByAction(filtered, 8), [filtered])
  const sev = useMemo(() => bucketBySeverity(filtered), [filtered])

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-signal-cyan-line bg-signal-cyan-soft/70 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Events</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatNumber(filtered.length)}</p>
        </div>
        <div className="rounded-2xl border border-signal-violet-line bg-signal-violet-soft/70 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Actors</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatNumber(new Set(filtered.map((e) => e.actor)).size)}</p>
        </div>
        <div className="rounded-2xl border border-signal-rose-line bg-signal-rose-soft/70 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Critical / High</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatNumber(sev.CRITICAL + sev.HIGH)}</p>
        </div>
        <div className="rounded-2xl border border-signal-emerald-line bg-signal-emerald-soft/70 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Healthy</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatNumber(sev.LOW + sev.MEDIUM)}</p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Top actors" subtitle="Who's driving this stream.">
          {actors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No actors yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {actors.map((a) => {
                const max = Math.max(...actors.map((x) => x.count))
                const pct = (a.count / max) * 100
                return (
                  <li key={a.actor} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2">
                        <span className={cn("flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br text-[10px] font-bold text-white", avatarTone(a.actor))}>
                          {initials(a.actor)}
                        </span>
                        <span className="block text-sm font-semibold text-foreground truncate max-w-[12rem]">{a.actor}</span>
                      </span>
                      <span className="text-sm font-bold text-foreground">{a.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted">
                      <div className="h-1.5 rounded-full bg-gradient-to-r from-cyan-700 via-cyan-600 to-emerald-500" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Top actions" subtitle="Most-used verbs in this stream.">
          {actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No actions yet.</p>
          ) : (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={actions} layout="vertical">
                  <CartesianGrid horizontal={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="action" tick={{ fontSize: 10.5, fill: "#475569" }} tickLine={false} axisLine={false} width={130} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 11 }} />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                    {actions.map((a, i) => (
                      <Cell key={i} fill={a.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="Severity mix" subtitle="Distribution of signals by intensity.">
          <div className="grid grid-cols-2 gap-2">
            {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((sv) => (
              <div key={sv} className={cn("rounded-xl border px-3 py-2.5", severityClass(sv as any))}>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-85">{sv}</p>
                <p className="mt-1 text-xl font-semibold leading-none">{formatNumber(sev[sv as keyof typeof sev])}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel
        title={title}
        subtitle={subtitle}
        actions={
          filtered.length > 0 ? (
            <button
              onClick={() => downloadCsv(`audit-${streams.join("-")}-${new Date().toISOString().slice(0, 10)}.csv`, filtered)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-[12px] font-semibold text-muted-foreground transition hover:border-signal-cyan-line hover:text-signal-cyan-ink"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
          ) : null
        }
      >
        {filtered.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-muted/60 px-4 py-10 text-center text-sm text-muted-foreground">
            {emptyHint || "No events yet — they will surface here as the system records them."}
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="max-h-[460px] overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-950 text-[10px] uppercase tracking-[0.18em] text-white">
                  <tr>
                    <th className="px-4 py-3 text-left">When</th>
                    <th className="px-4 py-3 text-left">Severity</th>
                    <th className="px-4 py-3 text-left">Action</th>
                    <th className="px-4 py-3 text-left">Actor</th>
                    <th className="px-4 py-3 text-left">Entity / Reference</th>
                    <th className="px-4 py-3 text-left">Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 100).map((event) => (
                    <tr
                      key={event.id}
                      onClick={() => onSelect(event)}
                      className="cursor-pointer border-t border-border transition hover:bg-signal-cyan-soft/30"
                    >
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <span className="block font-semibold text-foreground">{timestampText(event.timestamp, true)}</span>
                        <span className="block text-[11px] text-muted-foreground">{relativeTime(event.timestamp)}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]", severityClass(event.severity))}>
                          {event.severity}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-foreground">{event.action.replaceAll("_", " ")}</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <span className={cn("flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br text-[10px] font-bold text-white", avatarTone(event.actor))}>
                            {initials(event.actor)}
                          </span>
                          <span>
                            <span className="block font-semibold text-foreground">{event.actor}</span>
                            <span className="block text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{event.role || "—"}</span>
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block font-semibold text-foreground">{event.entityType}</span>
                        <span className="block font-mono text-[11.5px] text-signal-cyan-ink">{event.reference || "—"}</span>
                      </td>
                      <td className="max-w-md px-4 py-2.5 text-[12.5px] text-muted-foreground">{event.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Panel>
    </div>
  )
}
