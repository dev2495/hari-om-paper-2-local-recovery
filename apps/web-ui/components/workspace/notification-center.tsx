"use client"

import { Bell, CheckCheck } from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useNotifications, useNotificationUnreadCount } from "@/hooks/use-workspace"
import { authApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import { StatusBadge } from "@/components/erp/shell"

type NotificationItem = {
  id: string
  title: string
  message?: string
  href?: string
  role_context?: string | null
  is_read?: boolean
  created_at?: string
  event_type?: string
}

function formatWhen(value?: string) {
  if (!value) return "Now"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Now"
  return date.toLocaleString()
}

export function NotificationCenter() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const { data } = useNotifications(true)
  const unreadCount = useNotificationUnreadCount()
  const unread = Number(unreadCount.data?.count || 0)

  const notifications = useMemo(() => (Array.isArray(data?.items) ? (data.items as NotificationItem[]) : []), [data?.items])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["workspace-notifications"] }),
      queryClient.invalidateQueries({ queryKey: ["workspace-notifications-unread"] }),
    ])
  }

  const handleMarkAllRead = async () => {
    await authApi.markAllNotificationsRead()
    await refresh()
  }

  const handleOpen = async (item: NotificationItem) => {
    if (!item.is_read) {
      await authApi.markNotificationRead(item.id)
      await refresh()
    }
    setOpen(false)
    if (item.href) {
      router.push(item.href)
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid="workspace-notifications-trigger"
        onClick={() => setOpen(true)}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-[1rem] border border-border bg-card/90 text-muted-foreground shadow-sm transition hover:border-border hover:bg-card"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex min-w-[1.2rem] items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {unread}
          </span>
        ) : null}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl overflow-hidden rounded-[1.7rem] border border-border/60 bg-muted p-0">
          <DialogHeader className="border-b border-border bg-card/90 px-6 py-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <DialogTitle className="text-xl text-foreground">Notification Center</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  Cross-role alerts from specs, sales, planning, production, stores, QC, dispatch, and reports.
                </DialogDescription>
              </div>
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:border-border"
              >
                <CheckCheck className="h-4 w-4" />
                Mark all read
              </button>
            </div>
          </DialogHeader>

          <div className="max-h-[70vh] space-y-3 overflow-y-auto px-6 py-5">
            {notifications.length === 0 ? (
              <div className="rounded-[1.2rem] border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                No notifications yet.
              </div>
            ) : null}
            {notifications.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleOpen(item)}
                className={cn(
                  "w-full rounded-[1.2rem] border px-4 py-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg",
                  item.is_read ? "border-border bg-card/90" : "border-signal-cyan-line bg-signal-cyan-soft/60",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{item.title}</p>
                      {item.role_context ? <StatusBadge value={item.role_context} label={item.role_context} /> : null}
                      {!item.is_read ? <StatusBadge value="ACTIVE" label="Unread" /> : null}
                    </div>
                    {item.message ? <p className="text-sm leading-6 text-muted-foreground">{item.message}</p> : null}
                  </div>
                  <p className="shrink-0 text-xs text-muted-foreground">{formatWhen(item.created_at)}</p>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
