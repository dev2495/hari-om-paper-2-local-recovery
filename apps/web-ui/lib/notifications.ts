import type { LucideIcon } from "lucide-react"
import {
  Bell,
  ClipboardList,
  Factory,
  FileText,
  Package,
  PencilRuler,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Truck,
} from "lucide-react"

export type NotificationPriority = "critical" | "action" | "info"

export type InboxNotification = {
  id: string
  title: string
  message?: string
  href?: string | null
  role_context?: string | null
  is_read?: boolean
  created_at?: string
  event_type?: string
  category?: string
  priority?: NotificationPriority
  action?: string | null
  payload?: Record<string, any>
}

export type CategoryMeta = { label: string; icon: LucideIcon; chip: string }

export const NOTIFICATION_CATEGORIES: Record<string, CategoryMeta> = {
  sales: { label: "Sales", icon: ShoppingCart, chip: "bg-signal-emerald-soft text-signal-emerald-ink ring-signal-emerald-line" },
  planning: { label: "Planning", icon: Sparkles, chip: "bg-signal-violet-soft text-signal-violet-ink ring-signal-violet-line" },
  production: { label: "Production", icon: Factory, chip: "bg-signal-blue-soft text-signal-blue-ink ring-signal-blue-line" },
  quality: { label: "Quality", icon: ShieldCheck, chip: "bg-signal-amber-soft text-signal-amber-ink ring-signal-amber-line" },
  stores: { label: "Stores", icon: Package, chip: "bg-signal-teal-soft text-signal-teal-ink ring-signal-teal-line" },
  purchase: { label: "Purchase", icon: FileText, chip: "bg-signal-indigo-soft text-signal-indigo-ink ring-signal-indigo-line" },
  dispatch: { label: "Dispatch", icon: Truck, chip: "bg-signal-cyan-soft text-signal-cyan-ink ring-signal-cyan-line" },
  design: { label: "Design", icon: PencilRuler, chip: "bg-signal-orange-soft text-signal-orange-ink ring-signal-orange-line" },
  system: { label: "System", icon: Bell, chip: "bg-muted text-muted-foreground ring-border" },
}

export const CATEGORY_ORDER = ["sales", "planning", "production", "quality", "stores", "purchase", "dispatch", "design", "system"]

/** Mirrors the auth-service taxonomy so older rows without `category` still group sensibly. */
const CATEGORY_PREFIXES: Array<[string, string]> = [
  ["JOB_CARD_READY_FOR", "production"],
  ["JOB_CARD_CLOSED", "production"],
  ["JOB_CARD_SHORT", "production"],
  ["JOB_CARDS_READY", "planning"],
  ["JOB_CARD_SCHEDULED", "planning"],
  ["JOB_CARD_STAGE", "planning"],
  ["MACHINE_", "planning"],
  ["MRP_", "planning"],
  ["INVENTORY_QC_", "quality"],
  ["QC_", "quality"],
  ["RECIPE_", "quality"],
  ["SALES_", "sales"],
  ["CUSTOMER_", "sales"],
  ["INVENTORY_", "stores"],
  ["FG_", "stores"],
  ["TOOL_", "stores"],
  ["PURCHASE_", "purchase"],
  ["DISPATCH_", "dispatch"],
  ["SPEC_", "design"],
  ["STATUS_CHANGE", "production"],
  ["COIL_", "production"],
  ["REEL_", "production"],
]

export function notificationCategory(item: InboxNotification): string {
  if (item.category && NOTIFICATION_CATEGORIES[item.category]) return item.category
  const type = String(item.event_type || "").toUpperCase()
  return CATEGORY_PREFIXES.find(([prefix]) => type.startsWith(prefix))?.[1] || "system"
}

export function notificationPriority(item: InboxNotification): NotificationPriority {
  if (item.priority === "critical" || item.priority === "action" || item.priority === "info") return item.priority
  const declared = String(item.payload?.priority || "").toLowerCase()
  if (declared === "critical" || declared === "action") return declared
  return "info"
}

export const ACTION_LABELS: Record<string, string> = {
  schedule: "Schedule",
  start: "Open card",
  review_hold: "Review hold",
  resume: "Resume",
  dispatch: "Plan dispatch",
  attach_qc: "Attach QC",
  continue: "Open card",
  resolve: "Resolve",
  review: "Review",
  reschedule: "Reschedule",
}

export function relativeTime(value?: string, now = Date.now()) {
  if (!value) return "now"
  // Server timestamps are naive UTC.
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`)
  const time = date.getTime()
  if (Number.isNaN(time)) return ""
  const seconds = Math.round((now - time) / 1000)
  if (seconds < 45) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
}

export function dayBucket(value?: string, now = new Date()) {
  if (!value) return "Today"
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`)
  if (Number.isNaN(date.getTime())) return "Earlier"
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const time = date.getTime()
  if (time >= start) return "Today"
  if (time >= start - 86_400_000) return "Yesterday"
  if (time >= start - 6 * 86_400_000) return "This week"
  return "Earlier"
}

export function groupByDay<T extends InboxNotification>(items: T[]) {
  const groups: Array<{ label: string; items: T[] }> = []
  for (const item of items) {
    const label = dayBucket(item.created_at)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}

/* ───────────── Role work queues: live counts, not notifications ───────────── */

export type QueueSource = "sales" | "jobs"
export type QueueItem = {
  id: string
  label: string
  hint: string
  href: string
  source: QueueSource
  field: string
  tone: "rose" | "amber" | "emerald" | "cyan" | "violet" | "blue"
  icon: LucideIcon
}

const Q = {
  approve: { id: "approve", label: "Orders to approve", hint: "Draft and submitted customer POs", href: "/sales-orders?status=draft", source: "sales", field: "draft_count", tone: "amber", icon: ClipboardList },
  release: { id: "release", label: "Ready to release", hint: "Approved lines waiting for a winder", href: "/sales-orders", source: "sales", field: "ready_count", tone: "cyan", icon: ShoppingCart },
  overdue: { id: "overdue", label: "Overdue job cards", hint: "Past the promised date", href: "/production/job-cards?due=overdue", source: "jobs", field: "due_overdue", tone: "rose", icon: Factory },
  priority: { id: "priority", label: "Due this window", hint: "Job cards due in the priority window", href: "/production/job-cards?due=priority", source: "jobs", field: "due_priority", tone: "violet", icon: Sparkles },
  blocked: { id: "blocked", label: "Blocked cards", hint: "Waiting on material, machine or decision", href: "/planning/board", source: "jobs", field: "blocked", tone: "rose", icon: Factory },
  holds: { id: "holds", label: "Open QC holds", hint: "Need a quality decision", href: "/quality", source: "jobs", field: "qc_holds", tone: "amber", icon: ShieldCheck },
  dispatch: { id: "dispatch", label: "Ready to dispatch", hint: "Finished and cleared for shipping", href: "/logistics/dispatch", source: "jobs", field: "dispatch_ready", tone: "emerald", icon: Truck },
  open: { id: "open", label: "Open job cards", hint: "Released work in progress", href: "/production/job-cards", source: "jobs", field: "open_cards", tone: "blue", icon: Factory },
} satisfies Record<string, QueueItem>

export const ROLE_WORK_QUEUES: Record<string, QueueItem[]> = {
  Owner: [Q.approve, Q.overdue, Q.holds, Q.dispatch],
  Admin: [Q.approve, Q.overdue, Q.holds, Q.dispatch],
  Sales: [Q.approve, Q.release, Q.overdue, Q.dispatch],
  Planner: [Q.release, Q.priority, Q.overdue, Q.blocked],
  PlantManager: [Q.overdue, Q.blocked, Q.holds, Q.dispatch],
  QC: [Q.holds, Q.blocked, Q.priority],
  Dispatch: [Q.dispatch, Q.overdue],
  Store: [Q.open, Q.priority, Q.dispatch],
  Operator: [Q.priority, Q.open],
}

export function queueForRoles(roles: string[], activeRole?: string | null) {
  const ordered = [activeRole, ...roles].filter(Boolean) as string[]
  for (const role of ordered) if (ROLE_WORK_QUEUES[role]) return { role, items: ROLE_WORK_QUEUES[role] }
  return { role: "Operator", items: ROLE_WORK_QUEUES.Operator }
}
