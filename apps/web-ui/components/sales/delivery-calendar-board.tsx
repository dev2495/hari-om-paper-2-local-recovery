"use client"

import dayjs from "dayjs"
import Link from "next/link"
import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { AlertTriangle, CalendarDays, CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, List, PackageCheck, Search, X } from "lucide-react"

import { MetricCard } from "@/components/erp/shell"
import { ErrorState } from "@/components/workspace/query-state"
import { useDeliveryCalendar } from "@/hooks/use-sales"
import { cn } from "@/lib/utils"

type Entry = {
  id: string
  kind: "call_off" | "unscheduled"
  delivery_date: string | null
  quantity: number
  status: string
  delivered: boolean
  overdue: boolean
  locked: boolean
  order_id: string
  order_ref: string
  order_no?: string
  customer_id?: string | null
  line_no: number
  product_code?: string | null
  ordered_qty: number
  fulfilled_qty: number
}
type Day = { date: string; entries: Entry[]; total_qty: number; order_count: number; overdue: boolean }

const pcs = (value: number) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function entryTone(entry: Entry) {
  if (entry.delivered) return "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink"
  if (entry.overdue) return "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink"
  if (entry.kind === "unscheduled") return "border-dashed border-signal-amber-line bg-signal-amber-soft/70 text-signal-amber-ink"
  if (entry.locked) return "border-signal-violet-line bg-signal-violet-soft text-signal-violet-ink"
  return "border-signal-blue-line bg-signal-blue-soft text-signal-blue-ink"
}

function entryLabel(entry: Entry) {
  if (entry.delivered) return "Delivered"
  if (entry.overdue) return entry.kind === "unscheduled" ? "Late · no call-off" : "Late"
  if (entry.kind === "unscheduled") return "Due · no call-off"
  return entry.status.charAt(0).toUpperCase() + entry.status.slice(1)
}

function EntryRow({ entry, customer }: { entry: Entry; customer: (id?: string | null) => string }) {
  return (
    <Link
      href={`/sales-orders/${entry.order_id}`}
      className="group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 transition hover:border-input hover:bg-muted/60"
    >
      <span className={cn("h-8 w-1 shrink-0 rounded-full", entry.delivered ? "bg-signal-emerald-ink/70" : entry.overdue ? "bg-signal-rose-ink/70" : entry.kind === "unscheduled" ? "bg-signal-amber-ink/60" : "bg-signal-blue-ink/60")} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-foreground">{entry.order_ref}</span>
          <span className="text-[11.5px] text-muted-foreground">L{entry.line_no}</span>
          <span className={cn("ml-auto shrink-0 rounded-full border px-1.5 py-px text-[10.5px] font-medium", entryTone(entry))}>{entryLabel(entry)}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-[12px] text-muted-foreground">
          <span className="truncate">{entry.product_code || "No product code"} · {customer(entry.customer_id)}</span>
          <span className="ml-auto shrink-0 font-semibold tabular-nums text-foreground">{pcs(entry.quantity)} pcs</span>
        </span>
      </span>
    </Link>
  )
}

/**
 * Portfolio delivery calendar for the sales desk: every in-scope order's customer
 * call-offs plus demand that has no call-off yet, by day. Read-only — editing stays
 * on the order's own schedule panel so the preview → commit safety is preserved.
 */
export function DeliveryCalendarBoard({ customerName }: { customerName: (id?: string | null) => string }) {
  const [month, setMonth] = useState(() => dayjs().startOf("month"))
  const [mode, setMode] = useState<"month" | "agenda">("month")
  const [search, setSearch] = useState("")
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [focus, setFocus] = useState<"overdue" | "unscheduled" | null>(null)
  const deferredSearch = useDeferredValue(search.trim())

  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) setMode("agenda")
  }, [])

  const gridStart = month.subtract((month.day() + 6) % 7, "day")
  const weeks = Math.ceil(((month.day() + 6) % 7 + month.daysInMonth()) / 7)
  const gridEnd = gridStart.add(weeks * 7 - 1, "day")
  const query = useDeliveryCalendar({ start: gridStart.format("YYYY-MM-DD"), end: gridEnd.format("YYYY-MM-DD"), search: deferredSearch || undefined })
  const data = query.data as undefined | { plant_today: string; days: Day[]; overdue: Entry[]; unscheduled: Entry[]; summary: Record<string, number> }
  const today = data?.plant_today || dayjs().format("YYYY-MM-DD")
  const dayMap = useMemo(() => new Map((data?.days || []).map((day) => [day.date, day])), [data?.days])
  const maxQty = useMemo(() => Math.max(1, ...(data?.days || []).map((day) => day.total_qty)), [data?.days])
  const summary = data?.summary || {}
  const selected = selectedDay ? dayMap.get(selectedDay) : null
  const agendaDays = (data?.days || []).filter((day) => day.entries.length && dayjs(day.date).isSame(month, "month"))

  const sideList = focus === "overdue" ? data?.overdue || [] : focus === "unscheduled" ? data?.unscheduled || [] : null

  return (
    <div className="space-y-4" data-testid="sales-delivery-calendar">
      <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Call-offs this view" value={`${pcs(summary.call_off_qty)} pcs`} detail={`${summary.orders_in_window || 0} orders with deliveries in the visible weeks`} icon={CalendarRange} tone="blue" />
        <MetricCard label="Delivered" value={`${pcs(summary.delivered_qty)} pcs`} detail="Call-offs already marked delivered" icon={PackageCheck} tone="emerald" progress={summary.call_off_qty ? (Number(summary.delivered_qty) / Number(summary.call_off_qty)) * 100 : null} />
        <button type="button" className="text-left" onClick={() => setFocus(focus === "unscheduled" ? null : "unscheduled")} aria-pressed={focus === "unscheduled"}>
          <MetricCard label="No call-off yet" value={`${pcs(summary.unscheduled_qty)} pcs`} detail={`${summary.unscheduled_count || 0} lines need delivery dates split`} icon={CircleDashed} tone="amber" />
        </button>
        <button type="button" className="text-left" onClick={() => setFocus(focus === "overdue" ? null : "overdue")} aria-pressed={focus === "overdue"}>
          <MetricCard label="Overdue" value={`${pcs(summary.overdue_qty)} pcs`} detail={`${summary.overdue_count || 0} commitments past date and not delivered`} icon={AlertTriangle} tone="rose" />
        </button>
      </div>

      <div className="erp-panel overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
          <div className="flex items-center gap-1">
            <button type="button" className="tube-icon-button" aria-label="Previous month" onClick={() => setMonth(month.subtract(1, "month"))}><ChevronLeft /></button>
            <h3 className="min-w-[132px] text-center text-[15px] font-semibold tracking-tight">{month.format("MMMM YYYY")}</h3>
            <button type="button" className="tube-icon-button" aria-label="Next month" onClick={() => setMonth(month.add(1, "month"))}><ChevronRight /></button>
            <button type="button" className="erp-btn-secondary !h-8 !px-2.5 !text-xs" onClick={() => { setMonth(dayjs().startOf("month")); setSelectedDay(today) }}>Today</button>
          </div>
          <label className="ml-auto flex h-8 min-w-[180px] flex-1 items-center gap-2 rounded-lg border border-border bg-card px-2.5 sm:max-w-[280px] focus-within:border-ring/70 focus-within:ring-[3px] focus-within:ring-ring/15">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Filter calendar</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="PO, order or product…" className="h-full min-w-0 flex-1 border-0 bg-transparent text-[13px] shadow-none outline-none focus:shadow-none" />
          </label>
          <div className="tube-segment" role="group" aria-label="Calendar layout">
            <button type="button" aria-pressed={mode === "month"} onClick={() => setMode("month")}><CalendarDays size={14} />Month</button>
            <button type="button" aria-pressed={mode === "agenda"} onClick={() => setMode("agenda")}><List size={14} />Agenda</button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-[hsl(var(--surface-2))] px-3 py-1.5 text-[11.5px] text-muted-foreground">
          {[["bg-signal-blue-ink/60", "Committed call-off"], ["bg-signal-violet-ink/60", "Locked"], ["bg-signal-emerald-ink/70", "Delivered"], ["bg-signal-amber-ink/60", "Due, no call-off"], ["bg-signal-rose-ink/70", "Late"]].map(([color, label]) => (
            <span key={label} className="inline-flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-full", color)} />{label}</span>
          ))}
          {query.isFetching ? <span className="ml-auto animate-fade-in">Updating…</span> : null}
        </div>

        {query.isError ? (
          <ErrorState className="m-3" message="Delivery commitments could not be loaded. The calendar is not empty — retry." onRetry={() => void query.refetch()} />
        ) : mode === "month" ? (
          <div className="grid lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 overflow-x-auto">
              <div className="grid min-w-[720px] grid-cols-7 border-b border-border text-[11.5px] font-semibold text-muted-foreground">
                {WEEKDAYS.map((day) => <div key={day} className="px-2 py-1.5">{day}</div>)}
              </div>
              <div className="grid min-w-[720px] grid-cols-7">
                {Array.from({ length: weeks * 7 }, (_, index) => {
                  const date = gridStart.add(index, "day")
                  const key = date.format("YYYY-MM-DD")
                  const day = dayMap.get(key)
                  const inMonth = date.isSame(month, "month")
                  const isToday = key === today
                  const isSelected = key === selectedDay
                  const entries = day?.entries || []
                  return (
                    <button
                      type="button"
                      key={key}
                      onClick={() => { setSelectedDay(isSelected ? null : key); setFocus(null) }}
                      aria-label={`${date.format("D MMMM")}: ${entries.length} deliveries, ${pcs(day?.total_qty || 0)} pieces`}
                      aria-pressed={isSelected}
                      className={cn(
                        "group relative flex min-h-[112px] flex-col gap-1 border-b border-r border-border p-1.5 text-left transition-colors",
                        (index + 1) % 7 === 0 && "border-r-0",
                        !inMonth && "bg-[hsl(var(--surface-sunken))]",
                        index % 7 >= 5 && inMonth && "bg-[hsl(var(--surface-2))]",
                        isSelected ? "bg-primary/[.06] ring-2 ring-inset ring-primary/50" : "hover:bg-foreground/[.025]",
                      )}
                    >
                      <span className="flex items-center justify-between gap-1">
                        <span className={cn("grid h-6 min-w-6 place-items-center rounded-full px-1 text-[12px] font-semibold tabular-nums", isToday ? "bg-primary text-primary-foreground" : inMonth ? "text-foreground" : "text-muted-foreground/60")}>{date.date()}</span>
                        {day?.total_qty ? <span className={cn("text-[11px] font-semibold tabular-nums", day.overdue ? "text-signal-rose-ink" : "text-muted-foreground")}>{pcs(day.total_qty)}</span> : null}
                      </span>
                      {day?.total_qty ? (
                        <span className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                          <span className={cn("block h-full rounded-full", day.overdue ? "bg-signal-rose-ink/60" : "bg-primary/60")} style={{ width: `${Math.max(8, (day.total_qty / maxQty) * 100)}%` }} />
                        </span>
                      ) : null}
                      {entries.slice(0, 3).map((entry) => (
                        <span key={entry.id} className={cn("truncate rounded border px-1.5 py-0.5 text-[11px] leading-4", entryTone(entry))} title={`${entry.order_ref} · ${entry.product_code || ""} · ${pcs(entry.quantity)} pcs`}>
                          <span className="font-semibold">{entry.order_ref}</span> · {pcs(entry.quantity)}
                        </span>
                      ))}
                      {entries.length > 3 ? <span className="px-1 text-[11px] font-medium text-muted-foreground">+{entries.length - 3} more</span> : null}
                    </button>
                  )
                })}
              </div>
            </div>
            <aside className="border-t border-border lg:border-l lg:border-t-0">
              {selected || sideList ? (
                <div className="flex max-h-[720px] flex-col">
                  <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                    <div>
                      <p className="text-[13px] font-semibold">{sideList ? (focus === "overdue" ? "Overdue commitments" : "Lines without call-offs") : dayjs(selected!.date).format("dddd, D MMM")}</p>
                      <p className="text-[11.5px] text-muted-foreground">{sideList ? `${sideList.length} across all in-scope orders` : `${selected!.entries.length} deliveries · ${pcs(selected!.total_qty)} pcs · ${selected!.order_count} orders`}</p>
                    </div>
                    <button type="button" className="tube-icon-button" aria-label="Close" onClick={() => { setSelectedDay(null); setFocus(null) }}><X /></button>
                  </div>
                  <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2.5 animate-fade-in">
                    {(sideList || selected!.entries).length === 0 ? <p className="px-2 py-8 text-center text-[13px] text-muted-foreground">Nothing scheduled.</p> : null}
                    {(sideList || selected!.entries).map((entry) => (
                      <div key={entry.id}>
                        {sideList ? <p className="px-1 pb-0.5 text-[11px] font-medium text-muted-foreground">{entry.delivery_date ? dayjs(entry.delivery_date).format("DD MMM YYYY") : "No date"}</p> : null}
                        <EntryRow entry={entry} customer={customerName} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-3 p-3">
                  <p className="text-[13px] font-semibold">Needs attention</p>
                  {(data?.overdue || []).slice(0, 4).map((entry) => <EntryRow key={entry.id} entry={entry} customer={customerName} />)}
                  {!data?.overdue?.length ? (
                    <p className="flex items-center gap-2 rounded-lg border border-signal-emerald-line bg-signal-emerald-soft px-3 py-2 text-[12.5px] text-signal-emerald-ink"><CheckCircle2 className="h-4 w-4" />No overdue customer commitments.</p>
                  ) : null}
                  {(data?.unscheduled || []).length ? (
                    <button type="button" onClick={() => setFocus("unscheduled")} className="w-full rounded-lg border border-dashed border-signal-amber-line bg-signal-amber-soft/60 px-3 py-2 text-left text-[12.5px] text-signal-amber-ink transition hover:bg-signal-amber-soft">
                      <span className="font-semibold">{data?.unscheduled.length} lines</span> have no delivery call-off. Open one to split it into dated deliveries.
                    </button>
                  ) : null}
                  <p className="text-[11.5px] leading-5 text-muted-foreground">Select a day to see its deliveries. Call-offs are edited on each order&apos;s delivery schedule, with preview before commit.</p>
                </div>
              )}
            </aside>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {query.isLoading ? <div className="space-y-2 p-3">{[0, 1, 2].map((n) => <div key={n} className="skeleton h-14" />)}</div> : null}
            {!query.isLoading && agendaDays.length === 0 ? <p className="px-4 py-12 text-center text-[13px] text-muted-foreground">No customer deliveries in {month.format("MMMM")}.</p> : null}
            {agendaDays.map((day) => (
              <div key={day.date} className="grid gap-2 px-3 py-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                <div className="flex items-baseline gap-2 sm:block">
                  <p className={cn("text-[13px] font-semibold", day.date === today && "text-primary")}>{dayjs(day.date).format("ddd, D MMM")}</p>
                  <p className={cn("text-[12px] tabular-nums", day.overdue ? "text-signal-rose-ink" : "text-muted-foreground")}>{pcs(day.total_qty)} pcs</p>
                </div>
                <div className="grid gap-1.5 md:grid-cols-2">{day.entries.map((entry) => <EntryRow key={entry.id} entry={entry} customer={customerName} />)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
