"use client"

import { useRouter } from "next/navigation"
import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { AlertOctagon, CheckCheck, Inbox, ListChecks, MailOpen, Search } from "lucide-react"

import { PageHeader } from "@/components/workspace/page-header"
import { NotificationRow, invalidateInbox } from "@/components/workspace/notification-center"
import { WorkQueue } from "@/components/workspace/work-queue"
import { ErrorState } from "@/components/workspace/query-state"
import { Button } from "@/components/ui/button"
import { useNotifications, useNotificationSummary } from "@/hooks/use-workspace"
import { authApi } from "@/lib/api"
import {
  CATEGORY_ORDER,
  NOTIFICATION_CATEGORIES,
  groupByDay,
  notificationPriority,
  type InboxNotification,
} from "@/lib/notifications"
import { cn } from "@/lib/utils"

type View = "all" | "action" | "unread"
const PAGE = 40

export default function InboxPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [view, setView] = useState<View>("all")
  const [category, setCategory] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [limit, setLimit] = useState(PAGE)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const deferredSearch = useDeferredValue(search.trim())
  const summary = useNotificationSummary()
  const query = useNotifications({
    limit,
    unread_only: view !== "all",
    category: category || undefined,
    search: deferredSearch || undefined,
    refetchInterval: 30_000,
  })

  useEffect(() => { setLimit(PAGE); setSelected(new Set()) }, [view, category, deferredSearch])

  const items = useMemo(() => {
    const rows = Array.isArray(query.data?.items) ? (query.data.items as InboxNotification[]) : []
    return view === "action" ? rows.filter((item) => notificationPriority(item) !== "info") : rows
  }, [query.data?.items, view])
  const total = Number(query.data?.total_count || 0)
  const counts = summary.data?.by_category || {}
  const priority = summary.data?.by_priority || { critical: 0, action: 0, info: 0 }

  const open = async (item: InboxNotification) => {
    if (item.href) router.push(item.href)
    if (!item.is_read) {
      try { await authApi.markNotificationRead(item.id) } finally { await invalidateInbox(queryClient) }
    }
  }
  const toggle = async (item: InboxNotification) => {
    if (item.is_read) await authApi.markNotificationUnread(item.id)
    else await authApi.markNotificationRead(item.id)
    await invalidateInbox(queryClient)
  }
  const markSelected = async () => {
    if (!selected.size) return
    await authApi.markNotificationsRead(Array.from(selected))
    setSelected(new Set())
    await invalidateInbox(queryClient)
  }
  const markAll = async () => {
    await authApi.markAllNotificationsRead()
    await invalidateInbox(queryClient)
  }

  const views: Array<[View, string, typeof Inbox, number | null]> = [
    ["all", "Everything", Inbox, null],
    ["action", "Needs action", AlertOctagon, Number(priority.critical || 0) + Number(priority.action || 0)],
    ["unread", "Unread", MailOpen, Number(summary.data?.unread || 0)],
  ]

  return (
    <div className="space-y-5" data-testid="inbox-page">
      <PageHeader
        badge="Inbox"
        title="Your work and handoffs"
        description="Live queues for your role on top; below, every release, schedule, stage handoff, QC decision and dispatch that involves you — scoped to your plants."
        actions={
          <Button variant="outline" onClick={markAll} disabled={!summary.data?.unread}>
            <CheckCheck className="h-4 w-4" />
            Mark all read
          </Button>
        }
      />

      <WorkQueue />

      <div className="grid gap-4 lg:grid-cols-[232px_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-[72px] lg:self-start">
          <nav aria-label="Inbox views" className="erp-panel rounded-xl p-1.5">
            {views.map(([value, label, Icon, count]) => (
              <button
                key={value}
                type="button"
                onClick={() => setView(value)}
                aria-pressed={view === value}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                  view === value ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-foreground/[.04] hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className="flex-1 text-left">{label}</span>
                {count ? <span className={cn("rounded-full px-1.5 text-[11px] font-semibold tabular-nums", value === "action" && priority.critical ? "bg-destructive text-destructive-foreground" : "bg-muted text-muted-foreground")}>{count}</span> : null}
              </button>
            ))}
          </nav>
          <nav aria-label="Inbox categories" className="erp-panel rounded-xl p-1.5">
            <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-muted-foreground">Areas</p>
            <button
              type="button"
              onClick={() => setCategory(null)}
              aria-pressed={category === null}
              className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors", category === null ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-foreground/[.04] hover:text-foreground")}
            >
              <ListChecks className="h-4 w-4" aria-hidden="true" />
              <span className="flex-1 text-left">All areas</span>
            </button>
            {CATEGORY_ORDER.map((key) => {
              const meta = NOTIFICATION_CATEGORIES[key]
              const Icon = meta.icon
              const count = Number(counts[key] || 0)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setCategory(category === key ? null : key)}
                  aria-pressed={category === key}
                  className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors", category === key ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-foreground/[.04] hover:text-foreground")}
                >
                  <span className={cn("grid h-5 w-5 place-items-center rounded-md ring-1 ring-inset", meta.chip)}><Icon className="h-3 w-3" aria-hidden="true" /></span>
                  <span className="flex-1 text-left">{meta.label}</span>
                  {count ? <span className="rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold tabular-nums text-primary">{count}</span> : null}
                </button>
              )
            })}
          </nav>
        </aside>

        <section className="erp-panel min-w-0 overflow-hidden rounded-xl">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
            <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-card px-2.5 focus-within:border-ring/70 focus-within:ring-[3px] focus-within:ring-ring/15">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">Search inbox</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search titles and details…" className="h-full min-w-0 flex-1 border-0 bg-transparent text-[13px] shadow-none outline-none focus:shadow-none" />
            </label>
            {selected.size ? (
              <div className="flex items-center gap-2 animate-fade-in">
                <span className="text-xs text-muted-foreground">{selected.size} selected</span>
                <Button size="sm" onClick={markSelected}><CheckCheck className="h-3.5 w-3.5" />Mark read</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
              </div>
            ) : (
              <span className="text-xs tabular-nums text-muted-foreground">{query.isFetching ? "Refreshing…" : `${total.toLocaleString("en-IN")} ${view === "all" ? "total" : "unread"}`}</span>
            )}
          </div>

          <div className="p-1.5">
            {query.isError ? (
              <ErrorState className="m-2" message="The inbox could not be loaded. Nothing has been marked read." onRetry={() => void query.refetch()} />
            ) : query.isLoading ? (
              <div className="space-y-2 p-2" aria-hidden="true">{Array.from({ length: 6 }, (_, n) => <div key={n} className="skeleton h-16" />)}</div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-signal-emerald-soft text-signal-emerald-ink ring-1 ring-signal-emerald-line"><CheckCheck className="h-5 w-5" /></span>
                <p className="text-sm font-semibold">{deferredSearch ? "No matches" : view === "all" ? "No notifications yet" : "Inbox zero"}</p>
                <p className="max-w-sm text-[13px] text-muted-foreground">{deferredSearch ? "Try a PO number, product code or job card." : "New releases, schedules, QC decisions and dispatch handoffs for your role will appear here."}</p>
              </div>
            ) : (
              groupByDay(items).map((group) => (
                <div key={group.label}>
                  <p className="sticky top-[56px] z-[1] bg-card/95 px-3 pb-1 pt-3 text-[11px] font-semibold text-muted-foreground backdrop-blur">{group.label}</p>
                  {group.items.map((item) => (
                    <div key={item.id} className="flex items-start gap-1">
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.title}`}
                        className="ml-2 mt-4 h-3.5 w-3.5 shrink-0 cursor-pointer"
                        checked={selected.has(item.id)}
                        disabled={item.is_read}
                        onChange={(event) => setSelected((current) => {
                          const next = new Set(current)
                          if (event.target.checked) next.add(item.id)
                          else next.delete(item.id)
                          return next
                        })}
                      />
                      <div className="min-w-0 flex-1"><NotificationRow item={item} onOpen={open} onToggleRead={toggle} /></div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
          {query.data?.has_more && limit < 200 ? (
            <div className="border-t border-border p-3 text-center">
              <Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => setLimit((value) => Math.min(200, value + PAGE))}>
                {query.isFetching ? "Loading…" : "Load older"}
              </Button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
