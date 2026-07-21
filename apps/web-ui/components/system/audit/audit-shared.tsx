"use client"

import {
  Activity,
  Bell,
  Boxes,
  ClipboardCheck,
  Database,
  Factory,
  FileStack,
  LogIn,
  Package,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Truck,
  Wrench,
  type LucideIcon,
} from "lucide-react"

/* =========================================================================
 *  Types
 * ========================================================================= */

export type AuditStream =
  | "sales"
  | "production"
  | "inventory"
  | "dispatch"
  | "quality"
  | "master"
  | "users"
  | "notifications"
  | "system"
  | "session"

export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"

export type DateRange = "1h" | "today" | "24h" | "7d" | "30d" | "all"

export interface AuditEvent {
  id: string
  stream: AuditStream
  streamLabel: string
  action: string
  actor: string
  role: string
  entityType: string
  reference: string
  summary: string
  timestamp: string | null
  severity: Severity
  href?: string
  details?: Record<string, unknown>
}

export interface StreamMeta {
  id: AuditStream
  label: string
  short: string
  color: string
  icon: LucideIcon
  description: string
}

/* =========================================================================
 *  Stream catalog
 * ========================================================================= */

export const STREAMS: StreamMeta[] = [
  {
    id: "sales",
    label: "Sales Orders",
    short: "Sales",
    color: "#0e7490",
    icon: ShoppingCart,
    description: "PO creation, approval, release — the commercial spine.",
  },
  {
    id: "production",
    label: "Production",
    short: "Production",
    color: "#7c3aed",
    icon: Factory,
    description: "Job cards, stage transitions, holds, scrap and release events.",
  },
  {
    id: "inventory",
    label: "Inventory",
    short: "Inventory",
    color: "#f59e0b",
    icon: Boxes,
    description: "RM inward, issue, ledger and stock certification movement.",
  },
  {
    id: "dispatch",
    label: "Dispatch",
    short: "Dispatch",
    color: "#059669",
    icon: Truck,
    description: "Finished-goods handoff, challan and customer delivery.",
  },
  {
    id: "quality",
    label: "Quality",
    short: "Quality",
    color: "#be123c",
    icon: ShieldCheck,
    description: "Inspections, holds, release decisions and audit evidence.",
  },
  {
    id: "master",
    label: "Master Data",
    short: "Masters",
    color: "#60a5fa",
    icon: Database,
    description: "Customer, vendor, paper, recipe and tool master changes.",
  },
  {
    id: "users",
    label: "Users & Access",
    short: "Access",
    color: "#ef4444",
    icon: ShieldCheck,
    description: "Role assignments, permission grants, plant scope changes.",
  },
  {
    id: "notifications",
    label: "Notifications",
    short: "Alerts",
    color: "#ec4899",
    icon: Bell,
    description: "Cross-app workflow notifications routed by role.",
  },
  {
    id: "system",
    label: "System",
    short: "System",
    color: "#64748b",
    icon: Settings,
    description: "Plant scope, feature flags and configuration drift.",
  },
  {
    id: "session",
    label: "Session",
    short: "Sessions",
    color: "#14b8a6",
    icon: LogIn,
    description: "Logins, logouts, session anomalies.",
  },
]

export const RANGE_OPTIONS: Array<{ value: DateRange; label: string }> = [
  { value: "1h", label: "Last hour" },
  { value: "today", label: "Today" },
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7d" },
  { value: "30d", label: "This month" },
  { value: "all", label: "All audit" },
]

export const SEVERITY_ORDER: Record<Severity, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
}

export const SEVERITY_COLORS: Record<Severity, { fg: string; bg: string; ring: string }> = {
  LOW: { fg: "#047857", bg: "#ecfdf5", ring: "#bbf7d0" },
  MEDIUM: { fg: "#a16207", bg: "#fffbeb", ring: "#fde68a" },
  HIGH: { fg: "#c2410c", bg: "#fff7ed", ring: "#fed7aa" },
  CRITICAL: { fg: "#be123c", bg: "#fff1f2", ring: "#fecdd3" },
}

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
export const ACTION_COLORS = ["#0e7490", "#7c3aed", "#f59e0b", "#059669", "#be123c", "#0891b2", "#ec4899", "#64748b"]

/* =========================================================================
 *  Helpers
 * ========================================================================= */

export function streamMeta(id: AuditStream): StreamMeta {
  return STREAMS.find((s) => s.id === id) || STREAMS[0]
}

export function asString(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback
  const t = String(value).trim()
  return t || fallback
}

export function parseTimestamp(value: unknown): Date | null {
  const raw = asString(value)
  if (!raw) return null
  const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function timestampText(value: string | null, compact = false) {
  const parsed = parseTimestamp(value)
  if (!parsed) return value || "—"
  return compact
    ? parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : parsed.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
}

export function relativeTime(value: string | null) {
  const parsed = parseTimestamp(value)
  if (!parsed) return "—"
  const diff = Date.now() - parsed.getTime()
  const m = Math.round(Math.abs(diff) / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function dateBucket(value: string | null) {
  const parsed = parseTimestamp(value)
  if (!parsed) return "Undated"
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (parsed.toDateString() === today.toDateString()) return "Today"
  if (parsed.toDateString() === yesterday.toDateString()) return "Yesterday"
  return parsed.toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short" })
}

export function rangeStart(range: DateRange): Date | null {
  const now = new Date()
  if (range === "all") return null
  if (range === "1h") return new Date(now.getTime() - 60 * 60_000)
  if (range === "24h") return new Date(now.getTime() - 24 * 60 * 60_000)
  if (range === "7d") return new Date(now.getTime() - 7 * 24 * 60 * 60_000)
  if (range === "30d") return new Date(now.getTime() - 30 * 24 * 60 * 60_000)
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  return start
}

export function eventBlob(event: AuditEvent) {
  return [
    event.action,
    event.actor,
    event.role,
    event.entityType,
    event.reference,
    event.summary,
    event.streamLabel,
  ]
    .join(" ")
    .toLowerCase()
}

export function initials(name: string | null | undefined) {
  const t = String(name || "").trim()
  if (!t) return "SY"
  return t
    .split(/[.\s_-]+/)
    .map((p) => p[0] || "")
    .join("")
    .slice(0, 3)
    .toUpperCase()
}

export function avatarTone(name: string) {
  const palette = [
    "from-cyan-700 to-sky-400",
    "from-emerald-700 to-teal-400",
    "from-violet-700 to-fuchsia-400",
    "from-amber-700 to-yellow-400",
    "from-rose-700 to-pink-400",
    "from-teal-700 to-cyan-400",
  ]
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return palette[Math.abs(hash) % palette.length]
}

export function inferSeverity(action: string, fallback: Severity = "LOW"): Severity {
  const h = action.toUpperCase()
  if (h.includes("DENIED") || h.includes("FAIL") || h.includes("CRITICAL") || h.includes("MISMATCH") || h.includes("ERROR"))
    return "CRITICAL"
  if (h.includes("ROLE") || h.includes("OVERRIDE") || h.includes("VOID") || h.includes("SCRAP") || h.includes("HOLD") || h.includes("BLOCK"))
    return "HIGH"
  if (
    h.includes("WARNING") ||
    h.includes("PENDING") ||
    h.includes("ADJUST") ||
    h.includes("APPROV") ||
    h.includes("RELEASE") ||
    h.includes("ISSUE")
  )
    return "MEDIUM"
  return fallback
}

export function formatNumber(value: unknown, digits = 0) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n.toLocaleString("en-IN", { maximumFractionDigits: digits }) : "0"
}

export function hourOf(value: string | null) {
  const parsed = parseTimestamp(value)
  return parsed ? parsed.getHours() : -1
}

export function dayOf(value: string | null) {
  const parsed = parseTimestamp(value)
  if (!parsed) return -1
  return (parsed.getDay() + 6) % 7
}

/* =========================================================================
 *  Signal synthesis — pull AuditEvents from operational data
 * ========================================================================= */

function evt(partial: Omit<AuditEvent, "severity"> & { severity?: Severity }): AuditEvent {
  const severity = partial.severity || inferSeverity(partial.action)
  return { ...partial, severity }
}

/** From sales order list — emit created/approved/released events. */
export function eventsFromSalesOrders(orders: any[] | undefined | null): AuditEvent[] {
  if (!Array.isArray(orders)) return []
  const out: AuditEvent[] = []
  orders.forEach((o: any) => {
    const id = String(o?.id || o?.order_id || "")
    const ref = String(o?.order_no || o?.sales_order_no || o?.so_no || id || "")
    const customer = String(o?.customer_name || o?.customer_id || "")
    if (o?.created_at) {
      out.push(
        evt({
          id: `${id}:created`,
          stream: "sales",
          streamLabel: "Sales Orders",
          action: "SO_CREATED",
          actor: asString(o?.created_by || "system"),
          role: "sales",
          entityType: "Sales Order",
          reference: ref,
          summary: `${customer} — order created (${o?.line_count || 0} lines, ${asString(o?.total_qty, "0")} pcs)`,
          timestamp: asString(o.created_at),
          href: `/sales-orders/${id}`,
        }),
      )
    }
    if (o?.approved_at) {
      out.push(
        evt({
          id: `${id}:approved`,
          stream: "sales",
          streamLabel: "Sales Orders",
          action: "SO_APPROVED",
          actor: asString(o?.approved_by || "system"),
          role: "approver",
          entityType: "Sales Order",
          reference: ref,
          summary: `${customer} — commercially approved`,
          timestamp: asString(o.approved_at),
          severity: "MEDIUM",
          href: `/sales-orders/${id}`,
        }),
      )
    }
    if (o?.released_at) {
      out.push(
        evt({
          id: `${id}:released`,
          stream: "sales",
          streamLabel: "Sales Orders",
          action: "SO_RELEASED",
          actor: asString(o?.released_by || "approver"),
          role: "planner",
          entityType: "Sales Order",
          reference: ref,
          summary: `${customer} — released for planning · ${asString(o?.released_qty, "0")} pcs`,
          timestamp: asString(o.released_at),
          severity: "MEDIUM",
          href: `/sales-orders/${id}`,
        }),
      )
    }
    if (o?.cancelled_at) {
      out.push(
        evt({
          id: `${id}:cancelled`,
          stream: "sales",
          streamLabel: "Sales Orders",
          action: "SO_CANCELLED",
          actor: asString(o?.cancelled_by || "system"),
          role: "approver",
          entityType: "Sales Order",
          reference: ref,
          summary: `${customer} — order cancelled`,
          timestamp: asString(o.cancelled_at),
          severity: "HIGH",
          href: `/sales-orders/${id}`,
        }),
      )
    }
  })
  return out
}

/** From job cards — emit release/hold/complete events when timestamps are present. */
export function eventsFromJobCards(jobs: any[] | undefined | null): AuditEvent[] {
  if (!Array.isArray(jobs)) return []
  const out: AuditEvent[] = []
  jobs.forEach((j: any) => {
    const id = String(j?.id || j?.job_card_id || "")
    const ref = String(j?.job_card_no || j?.ref_no || id)
    const customer = asString(j?.customer_name || j?.product_code || "")
    if (j?.created_at) {
      out.push(
        evt({
          id: `jc-${id}:created`,
          stream: "production",
          streamLabel: "Production",
          action: "JOB_CARD_CREATED",
          actor: asString(j?.created_by || "planner"),
          role: "planner",
          entityType: "Job Card",
          reference: ref,
          summary: `${customer} — job card released to floor`,
          timestamp: asString(j.created_at),
          severity: "MEDIUM",
          href: `/production/job-cards`,
        }),
      )
    }
    if (j?.completed_at) {
      out.push(
        evt({
          id: `jc-${id}:completed`,
          stream: "production",
          streamLabel: "Production",
          action: "JOB_CARD_COMPLETED",
          actor: asString(j?.completed_by || "operator"),
          role: "operator",
          entityType: "Job Card",
          reference: ref,
          summary: `${customer} — completed`,
          timestamp: asString(j.completed_at),
          severity: "LOW",
          href: `/production/job-cards`,
        }),
      )
    }
    const status = String(j?.status || "").toUpperCase()
    if (status.includes("BLOCK") || status.includes("HOLD")) {
      out.push(
        evt({
          id: `jc-${id}:blocked`,
          stream: "production",
          streamLabel: "Production",
          action: status.includes("HOLD") ? "JOB_HOLD" : "JOB_BLOCKED",
          actor: asString(j?.blocked_by || j?.held_by || "system"),
          role: "supervisor",
          entityType: "Job Card",
          reference: ref,
          summary: `${customer} — currently ${status.toLowerCase()}`,
          timestamp: asString(j?.updated_at || j?.created_at),
          severity: status.includes("HOLD") ? "HIGH" : "CRITICAL",
          href: `/production/job-cards`,
        }),
      )
    }
  })
  return out
}

/** From inventory transactions / ledger. */
export function eventsFromTransactions(txns: any[] | undefined | null): AuditEvent[] {
  if (!Array.isArray(txns)) return []
  return txns.map((t: any, idx: number) =>
    evt({
      id: String(t?.id || t?.transaction_id || `txn-${idx}`),
      stream: "inventory",
      streamLabel: "Inventory",
      action: asString(t?.type || t?.transaction_type, "TXN").toUpperCase().replaceAll(" ", "_"),
      actor: asString(t?.created_by || t?.user || "store"),
      role: "store",
      entityType: asString(t?.entity_type || "Inventory Txn", "Inventory Txn"),
      reference: asString(t?.reference || t?.external_ref || t?.id, ""),
      summary: asString(
        t?.description || t?.notes,
        `${asString(t?.type || "Movement")} · qty ${asString(t?.qty_change ?? t?.quantity, "0")}`,
      ),
      timestamp: asString(t?.date || t?.created_at || t?.timestamp),
      href: "/inventory/ledger",
    }),
  )
}

/** From cross-app notifications. */
export function eventsFromNotifications(items: any[] | undefined | null): AuditEvent[] {
  if (!Array.isArray(items)) return []
  return items.map((n: any, idx: number) =>
    evt({
      id: String(n?.id || `notif-${idx}`),
      stream: "notifications",
      streamLabel: "Notifications",
      action: asString(n?.event_type || n?.type, "NOTIFICATION").toUpperCase().replaceAll(" ", "_"),
      actor: asString(n?.actor || n?.from || n?.role_context, "system"),
      role: asString(n?.role_context || n?.role, "system"),
      entityType: asString(n?.entity_type, "Notification"),
      reference: asString(n?.reference || n?.id, ""),
      summary: asString(n?.message || n?.title, "Workflow alert"),
      timestamp: asString(n?.created_at || n?.timestamp),
      href: n?.href || undefined,
    }),
  )
}

/** From dispatch ready jobs. */
export function eventsFromDispatch(rows: any[] | undefined | null): AuditEvent[] {
  if (!Array.isArray(rows)) return []
  return rows.map((d: any, idx: number) =>
    evt({
      id: String(d?.id || `dispatch-${idx}`),
      stream: "dispatch",
      streamLabel: "Dispatch",
      action: "DISPATCH_READY",
      actor: asString(d?.created_by || d?.completed_by || "dispatch"),
      role: "dispatch",
      entityType: "FG Job",
      reference: asString(d?.job_card_no || d?.ref || d?.id, ""),
      summary: asString(d?.customer_name, "Finished-goods job awaiting handoff"),
      timestamp: asString(d?.completed_at || d?.created_at),
      severity: "LOW",
      href: "/logistics/dispatch",
    }),
  )
}

/** From user list — synthesize "user active" events using last_login. */
export function eventsFromUsers(users: any[] | undefined | null): AuditEvent[] {
  if (!Array.isArray(users)) return []
  return users
    .filter((u: any) => u?.last_login_at || u?.last_seen_at)
    .map((u: any) =>
      evt({
        id: `user-${u.id}-login`,
        stream: "session",
        streamLabel: "Session",
        action: "USER_LOGIN",
        actor: asString(u?.email || u?.name || u?.id, "user"),
        role: asString(u?.role || (Array.isArray(u?.roles) ? u.roles[0] : "") || "user").toLowerCase(),
        entityType: "Session",
        reference: asString(u?.id, ""),
        summary: `${asString(u?.name || u?.email, "user")} — last seen`,
        timestamp: asString(u?.last_login_at || u?.last_seen_at),
        severity: "LOW",
      }),
    )
}

/* =========================================================================
 *  Aggregators
 * ========================================================================= */

export function bucketBySeverity(events: AuditEvent[]) {
  const acc: Record<Severity, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 }
  events.forEach((e) => {
    acc[e.severity] += 1
  })
  return acc
}

export function bucketByActor(events: AuditEvent[], limit = 8) {
  const map = new Map<string, { actor: string; role: string; count: number; lastSeen: string | null }>()
  events.forEach((e) => {
    const cur = map.get(e.actor) || { actor: e.actor, role: e.role, count: 0, lastSeen: null }
    cur.count += 1
    if (!cur.lastSeen || (e.timestamp && e.timestamp > (cur.lastSeen || ""))) cur.lastSeen = e.timestamp
    if (e.role) cur.role = e.role
    map.set(e.actor, cur)
  })
  return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, limit)
}

export function bucketByAction(events: AuditEvent[], limit = 8) {
  const map = new Map<string, number>()
  events.forEach((e) => map.set(e.action, (map.get(e.action) || 0) + 1))
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([action, count], idx) => ({ action, count, color: ACTION_COLORS[idx % ACTION_COLORS.length] }))
}

export function bucketByStream(events: AuditEvent[]) {
  const map = new Map<AuditStream, number>()
  events.forEach((e) => map.set(e.stream, (map.get(e.stream) || 0) + 1))
  return STREAMS.map((s) => ({
    id: s.id,
    label: s.short,
    color: s.color,
    count: map.get(s.id) || 0,
  }))
}

export function activityHeatmap(events: AuditEvent[]) {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  events.forEach((e) => {
    const d = dayOf(e.timestamp)
    const h = hourOf(e.timestamp)
    if (d >= 0 && h >= 0) grid[d][h] += 1
  })
  return grid
}

export function severityTrend(events: AuditEvent[]) {
  const now = new Date()
  const buckets: Array<{ hour: string; LOW: number; MEDIUM: number; HIGH: number; CRITICAL: number }> = []
  for (let i = 11; i >= 0; i -= 1) {
    const t = new Date(now.getTime() - i * 60 * 60_000)
    buckets.push({
      hour: t.toLocaleTimeString([], { hour: "2-digit" }),
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      CRITICAL: 0,
    })
  }
  events.forEach((e) => {
    const parsed = parseTimestamp(e.timestamp)
    if (!parsed) return
    const diffH = Math.floor((now.getTime() - parsed.getTime()) / 3_600_000)
    if (diffH < 0 || diffH > 11) return
    const idx = 11 - diffH
    buckets[idx][e.severity] += 1
  })
  return buckets
}

export function severityClass(severity: Severity) {
  if (severity === "CRITICAL") return "border-rose-200 bg-rose-50 text-rose-700"
  if (severity === "HIGH") return "border-orange-200 bg-orange-50 text-orange-700"
  if (severity === "MEDIUM") return "border-amber-200 bg-amber-50 text-amber-700"
  return "border-emerald-200 bg-emerald-50 text-emerald-700"
}

export function downloadCsv(filename: string, rows: AuditEvent[]) {
  const header = ["timestamp", "stream", "severity", "action", "actor", "role", "entity", "reference", "summary"]
  const esc = (v: unknown) => `"${asString(v).replaceAll('"', '""')}"`
  const lines = [header.join(",")].concat(
    rows.map((e) =>
      [e.timestamp, e.streamLabel, e.severity, e.action, e.actor, e.role, e.entityType, e.reference, e.summary]
        .map(esc)
        .join(","),
    ),
  )
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
