"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowRight, Bell, CheckCheck, Circle, Inbox } from "lucide-react"

import { WorkQueue } from "@/components/workspace/work-queue"
import { useApp } from "@/context/AppContext"
import { useNotifications, useNotificationSummary, useNotificationUnreadCount } from "@/hooks/use-workspace"
import { authApi } from "@/lib/api"
import {
  ACTION_LABELS,
  NOTIFICATION_CATEGORIES,
  groupByDay,
  notificationCategory,
  notificationPriority,
  relativeTime,
  type InboxNotification,
} from "@/lib/notifications"
import { cn } from "@/lib/utils"

type Tab = "all" | "action" | "unread"

export async function invalidateInbox(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["workspace-notifications"] }),
    queryClient.invalidateQueries({ queryKey: ["workspace-notifications-unread"] }),
    queryClient.invalidateQueries({ queryKey: ["workspace-notifications-summary"] }),
  ])
}

export function NotificationRow({
  item,
  onOpen,
  onToggleRead,
  compact = false,
}: {
  item: InboxNotification
  onOpen: (item: InboxNotification) => void
  onToggleRead: (item: InboxNotification) => void
  compact?: boolean
}) {
  const category = NOTIFICATION_CATEGORIES[notificationCategory(item)]
  const priority = notificationPriority(item)
  const Icon = category.icon
  const actionLabel = item.action ? ACTION_LABELS[item.action] : null
  return (
    <div
      className={cn(
        "group relative flex gap-3 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-foreground/[.035]",
        !item.is_read && "bg-primary/[.035]",
      )}
    >
      <span className={cn("relative mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset", category.chip)}>
        <Icon className="h-4 w-4" aria-hidden="true" />
        {priority === "critical" ? <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-popover" aria-label="Critical" /> : null}
      </span>
      <button type="button" className="min-w-0 flex-1 text-left outline-none" onClick={() => onOpen(item)}>
        <span className="flex items-start gap-2">
          <span className={cn("min-w-0 flex-1 text-[13px] leading-5", item.is_read ? "font-medium text-foreground/80" : "font-semibold text-foreground")}>{item.title}</span>
          <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground">{relativeTime(item.created_at)}</span>
        </span>
        {item.message ? <span className={cn("mt-0.5 block text-[12.5px] leading-5 text-muted-foreground", compact ? "line-clamp-2" : "line-clamp-3")}>{item.message}</span> : null}
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">{category.label}</span>
          {item.role_context ? <span className="text-[11px] text-muted-foreground/70">· for {item.role_context}</span> : null}
          {priority !== "info" && actionLabel && item.href ? (
            <span className={cn("ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", priority === "critical" ? "bg-signal-rose-soft text-signal-rose-ink" : "bg-primary/10 text-primary")}>
              {actionLabel}
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </span>
          ) : null}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onToggleRead(item)}
        className="mt-1 grid h-6 w-6 shrink-0 place-items-center self-start rounded-md text-muted-foreground opacity-60 transition hover:bg-foreground/[.06] hover:text-foreground hover:opacity-100 focus-visible:opacity-100"
        aria-label={item.is_read ? "Mark as unread" : "Mark as read"}
        title={item.is_read ? "Mark as unread" : "Mark as read"}
      >
        {item.is_read ? <Circle className="h-2.5 w-2.5" /> : <span className="h-2 w-2 rounded-full bg-primary" />}
      </button>
    </div>
  )
}

export function NotificationCenter() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { showToast } = useApp()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>("all")
  const wrapper = useRef<HTMLDivElement | null>(null)
  const seenIds = useRef(new Set<string>())
  const mountedAt = useRef(Date.now())
  const { data, isLoading } = useNotifications({ limit: 40, unread_only: tab === "unread" })
  const unreadCount = useNotificationUnreadCount()
  const summary = useNotificationSummary()
  const unread = Number(summary.data?.unread ?? unreadCount.data?.count ?? 0)
  const urgent = Number(summary.data?.by_priority?.critical || 0)

  const notifications = useMemo(() => (Array.isArray(data?.items) ? (data.items as InboxNotification[]) : []), [data?.items])
  const visible = useMemo(
    () => (tab === "action" ? notifications.filter((item) => notificationPriority(item) !== "info" && !item.is_read) : notifications),
    [notifications, tab],
  )

  // Surface freshly-arrived urgent work as a toast, once per notification, never for history.
  useEffect(() => {
    const fresh = notifications.filter((item) => {
      if (seenIds.current.has(item.id)) return false
      seenIds.current.add(item.id)
      const created = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(item.created_at || "") ? String(item.created_at) : `${item.created_at}Z`)
      return Number.isFinite(created) && created > mountedAt.current
    })
    const loud = fresh.find((item) => !item.is_read && notificationPriority(item) !== "info")
    if (loud && document.visibilityState === "visible") showToast(loud.title, notificationPriority(loud) === "critical" ? "error" : "info")
  }, [notifications, showToast])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false) }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey) }
  }, [open])

  const handleMarkAllRead = async () => {
    await authApi.markAllNotificationsRead()
    await invalidateInbox(queryClient)
  }

  const handleToggle = async (item: InboxNotification) => {
    if (item.is_read) await authApi.markNotificationUnread(item.id)
    else await authApi.markNotificationRead(item.id)
    await invalidateInbox(queryClient)
  }

  const handleOpen = async (item: InboxNotification) => {
    setOpen(false)
    if (item.href) router.push(item.href)
    if (!item.is_read) {
      try { await authApi.markNotificationRead(item.id) } finally { await invalidateInbox(queryClient) }
    }
  }

  const groups = groupByDay(visible.slice(0, 25))

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        data-testid="workspace-notifications-trigger"
        onClick={() => setOpen((value) => !value)}
        className="tube-icon-button relative"
        aria-label={unread ? `Inbox, ${unread} unread` : "Inbox"}
        title="Inbox"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Bell className={cn(unread > 0 && "origin-top", urgent > 0 && "animate-[bell-ring_1.2s_ease-in-out_2]")} />
        {unread > 0 ? (
          <span
            key={unread}
            className={cn(
              "animate-scale-in absolute -right-0.5 -top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums ring-2 ring-background",
              urgent > 0 ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground",
            )}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div role="dialog" aria-label="Inbox" className="tube-popover right-0 top-[calc(100%+8px)] flex max-h-[min(640px,calc(100dvh-80px))] w-[min(420px,calc(100vw-20px))] flex-col !p-0 max-sm:fixed max-sm:inset-x-2.5 max-sm:top-[60px] max-sm:w-auto">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 pb-2 pt-3">
            <div>
              <p className="text-[14px] font-semibold">Inbox</p>
              <p className="text-[11.5px] text-muted-foreground">{unread ? `${unread} unread${urgent ? ` · ${urgent} urgent` : ""}` : "You're all caught up"}</p>
            </div>
            <button type="button" onClick={handleMarkAllRead} disabled={!unread} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition hover:bg-foreground/[.06] hover:text-foreground disabled:opacity-40">
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          </div>
          <div className="px-3.5 pt-2.5">
            <WorkQueue variant="compact" onNavigate={() => setOpen(false)} />
          </div>
          <div className="px-3.5 pb-1 pt-3">
            <div className="tube-segment w-full" role="tablist" aria-label="Inbox filter">
              {([
                ["all", "For you"],
                ["action", `Action${summary.data ? ` · ${Number(summary.data.by_priority.action || 0) + Number(summary.data.by_priority.critical || 0)}` : ""}`],
                ["unread", "Unread"],
              ] as const).map(([value, label]) => (
                <button key={value} type="button" role="tab" aria-selected={tab === value} data-state={tab === value ? "active" : undefined} className="flex-1 justify-center" onClick={() => setTab(value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
            {isLoading ? (
              <div className="space-y-2 p-2" aria-hidden="true">{[0, 1, 2].map((n) => <div key={n} className="skeleton h-14" />)}</div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-signal-emerald-soft text-signal-emerald-ink ring-1 ring-signal-emerald-line"><CheckCheck className="h-5 w-5" /></span>
                <p className="text-[13px] font-semibold">Nothing waiting on you</p>
                <p className="text-xs text-muted-foreground">Handoffs, holds and approvals for your role land here as they happen.</p>
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.label}>
                  <p className="sticky top-0 z-[1] bg-popover/95 px-2.5 pb-1 pt-2.5 text-[11px] font-semibold text-muted-foreground backdrop-blur">{group.label}</p>
                  {group.items.map((item) => <NotificationRow key={item.id} item={item} onOpen={handleOpen} onToggleRead={handleToggle} compact />)}
                </div>
              ))
            )}
          </div>
          <Link href="/inbox" onClick={() => setOpen(false)} className="flex items-center justify-center gap-1.5 border-t border-border bg-[hsl(var(--surface-2))] px-3 py-2.5 text-[12.5px] font-medium text-foreground transition hover:bg-muted">
            <Inbox className="h-3.5 w-3.5" />
            Open full inbox
          </Link>
        </div>
      ) : null}
    </div>
  )
}
