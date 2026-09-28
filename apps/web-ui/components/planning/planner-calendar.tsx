"use client"

import Link from "next/link"
import dayjs from "dayjs"
import { useMemo, useState } from "react"
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Flame, GripVertical, Scissors, Search, Pencil, Settings2, Truck, ZoomIn } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { ColorChip, JobCardNo, swatchFor } from "@/components/production/lifecycle-chips"
import { useApp } from "@/context/AppContext"
import { apiErrorText } from "@/hooks/use-lifecycle"
import { usePlanningBoardMove } from "@/hooks/use-production"
import { useDeliveryCalendar } from "@/hooks/use-sales"
import { useCustomers } from "@/hooks/use-master-data"
import { WinderLoadBars } from "@/components/planning/winder-load-bars"
import { cn } from "@/lib/utils"

type Machine = { id: string; code: string; name?: string; capacity_value?: number | null; capacity_unit?: string | null; status?: string }

const fmt = (value: number) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })
const OPEN_STATUSES = (job: any) => !["COMPLETED", "CANCELLED"].includes(String(job?.status || "").toUpperCase())

function queueFilterMatch(job: any, filter: string) {
  const days = job.due_date ? dayjs(job.due_date).startOf("day").diff(dayjs().startOf("day"), "day") : null
  if (filter === "priority") return days !== null && days >= 0 && days <= 3
  if (filter === "overdue") return days !== null && days < 0
  if (filter === "missed") return Boolean(job.missed_slot_open)
  if (filter === "emergency") return Boolean(job.is_emergency)
  return true
}

export function PlannerCalendar({
  stage,
  jobs,
  machines,
  monthDate,
  maxPlannerDate,
  hrefFor,
  onOpenCard,
  onZoom,
  onPrefetchWindow,
  recentWindow,
  windowDays = 2,
}: {
  stage: string
  jobs: any[]
  machines: Machine[]
  monthDate: string
  maxPlannerDate: string
  hrefFor: (next: { date?: string; view?: string }) => string
  onOpenCard: (jobCardId: string, action?: "split" | "emergency" | "edit" | "force_close") => void
  /** Open the 3-day board starting at this date (the workspace animates the zoom). */
  onZoom?: (date: string) => void
  onPrefetchWindow?: (date: string) => void
  /** The 3-day window just left, briefly highlighted after zooming out. */
  recentWindow?: string | null
  /** Days the board shows (2 or 3): the hover highlight matches. */
  windowDays?: number
}) {
  const { showToast } = useApp()
  const moveCard = usePlanningBoardMove()
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState("all")
  const [sort, setSort] = useState<"due" | "qty" | "age">("due")
  const [winderFilter, setWinderFilter] = useState<string | null>(null)
  const [dragged, setDragged] = useState<any | null>(null)
  const [hoverDay, setHoverDay] = useState<string | null>(null)
  const [windowStart, setWindowStart] = useState<string | null>(null)
  const inWindow = (key: string, start: string | null | undefined) => {
    if (!start) return false
    const offset = dayjs(key).diff(dayjs(start), "day")
    return offset >= 0 && offset < windowDays
  }
  const hoverWindow = (key: string) => {
    if (dragged || windowStart === key) return
    setWindowStart(key)
    onPrefetchWindow?.(key)
  }
  const [placing, setPlacing] = useState<{ job: any; date: string } | null>(null)
  const [placeMachine, setPlaceMachine] = useState("")
  const [placeShift, setPlaceShift] = useState("SHIFT_A")

  const stageJobs = useMemo(() => jobs.filter((job) => OPEN_STATUSES(job) && String(job.current_stage || "").toUpperCase() === stage), [jobs, stage])
  const queue = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const rows = stageJobs
      .filter((job) => !job.current_shift_code)
      .filter((job) => queueFilterMatch(job, filter))
      .filter((job) => !winderFilter || String(job.assigned_winder_machine_id || "unassigned") === winderFilter)
      .filter((job) =>
        !needle ||
        [job.job_card_no, job.job_card_ref, job.customer_name, job.product_code, job.product_size_label, job.parchment_color, job.sales_order_ref]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
    return rows.sort((a, b) => {
      if (sort === "qty") return Number(b.planned_qty || 0) - Number(a.planned_qty || 0)
      if (sort === "age") return String(a.created_at || "").localeCompare(String(b.created_at || ""))
      if (a.is_emergency !== b.is_emergency) return a.is_emergency ? -1 : 1
      return String(a.due_date || "9999").localeCompare(String(b.due_date || "9999"))
    })
  }, [filter, search, sort, stageJobs, winderFilter])
  const allQueued = stageJobs.filter((job) => !job.current_shift_code)
  const queueCounts = {
    all: allQueued.length,
    priority: allQueued.filter((job) => queueFilterMatch(job, "priority")).length,
    overdue: allQueued.filter((job) => queueFilterMatch(job, "overdue")).length,
    missed: allQueued.filter((job) => queueFilterMatch(job, "missed")).length,
    emergency: allQueued.filter((job) => queueFilterMatch(job, "emergency")).length,
  }

  const monthStart = dayjs(monthDate).startOf("month")
  const gridStart = monthStart.subtract((monthStart.day() + 6) % 7, "day") // weeks start Monday
  const machineCode = useMemo(() => new Map(machines.map((machine) => [machine.id, machine.code])), [machines])
  // Customer delivery commitments (sales call-offs + unscheduled line balances) for the visible 6 weeks.
  const deliveries = useDeliveryCalendar(gridStart.format("YYYY-MM-DD"), gridStart.add(41, "day").format("YYYY-MM-DD"))
  const customersQuery = useCustomers()
  const customerName = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of (Array.isArray(customersQuery.data) ? customersQuery.data : (customersQuery.data as any)?.items || []) as any[]) map.set(String(row.id), row.name || row.customer_name || row.code)
    return (id?: string | null) => (id ? map.get(String(id)) || "Customer" : "Internal")
  }, [customersQuery.data])
  const deliveriesByDay = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const row of deliveries.data || []) map.set(row.date, [...(map.get(row.date) || []), row])
    return map
  }, [deliveries.data])

  const days = useMemo(() => {
    const scheduledByDay = new Map<string, any[]>()
    const dueByDay = new Map<string, number>()
    for (const job of stageJobs) {
      if (job.current_shift_code && job.current_plan_date) {
        const key = dayjs(job.current_plan_date).format("YYYY-MM-DD")
        scheduledByDay.set(key, [...(scheduledByDay.get(key) || []), job])
      }
    }
    for (const job of jobs.filter(OPEN_STATUSES)) {
      if (job.due_date) {
        const key = dayjs(job.due_date).format("YYYY-MM-DD")
        dueByDay.set(key, (dueByDay.get(key) || 0) + 1)
      }
    }
    return Array.from({ length: 42 }, (_, index) => {
      const date = gridStart.add(index, "day")
      const key = date.format("YYYY-MM-DD")
      const scheduled = (scheduledByDay.get(key) || []).sort((a, b) => String(a.current_shift_code).localeCompare(String(b.current_shift_code)))
      const byMachine = new Map<string, number>()
      for (const job of scheduled) {
        const machine = String(job.current_machine_id || "")
        byMachine.set(machine, (byMachine.get(machine) || 0) + Number(job.planned_qty || 0))
      }
      return {
        key,
        date,
        inMonth: date.isSame(monthStart, "month"),
        isToday: date.isSame(dayjs(), "day"),
        isPast: date.isBefore(dayjs(), "day"),
        beyond: date.isAfter(dayjs(maxPlannerDate), "day"),
        scheduled,
        pcs: scheduled.reduce((sum, job) => sum + Number(job.planned_qty || 0), 0),
        byMachine: Array.from(byMachine.entries()),
        due: dueByDay.get(key) || 0,
        dueCards: jobs.filter((job) => OPEN_STATUSES(job) && job.due_date && dayjs(job.due_date).format("YYYY-MM-DD") === key),
        deliveries: deliveriesByDay.get(key) || [],
        missed: scheduled.filter((job) => String(job.planner_gate_reason || job.blocked_reason || "").toLowerCase().includes("stale")).length,
      }
    })
  }, [deliveriesByDay, gridStart, jobs, maxPlannerDate, monthStart, stageJobs])
  const maxDayPcs = Math.max(1, ...days.map((day) => day.pcs))
  const monthDays = days.filter((day) => day.inMonth)
  const monthPcs = monthDays.reduce((sum, day) => sum + day.pcs, 0)
  const monthDue = monthDays.reduce((sum, day) => sum + day.due, 0)
  const monthDeliveryPcs = monthDays.reduce((sum, day) => sum + day.deliveries.reduce((total: number, row: any) => total + Number(row.qty || 0), 0), 0)
  const queuePcs = allQueued.reduce((sum, job) => sum + Number(job.planned_qty || 0), 0)

  const openPlacer = (job: any, date: string) => {
    setPlacing({ job, date })
    setPlaceMachine(String(job.assigned_winder_machine_id || machines[0]?.id || ""))
    setPlaceShift("SHIFT_A")
  }

  const place = async () => {
    if (!placing) return
    try {
      const response = await moveCard.mutateAsync({
        segment_id: placing.job.active_segment_id,
        job_card_id: placing.job.id,
        stage,
        machine_id: placeMachine,
        plan_date: placing.date,
        shift_code: placeShift,
        sequence_no: 999,
      })
      const warnings = Array.isArray(response?.data?.warnings) ? response.data.warnings.filter(Boolean) : []
      showToast(warnings.length ? warnings.join(" ") : `${placing.job.job_card_no || "Card"} placed on ${dayjs(placing.date).format("DD MMM")} · ${placeShift.replace("SHIFT_", "Shift ")}.`, warnings.length ? "info" : "success")
      setPlacing(null)
    } catch (error) {
      showToast(apiErrorText(error), "error")
    }
  }

  return (
    <div className="grid min-w-0 gap-3 xl:grid-cols-[340px_minmax(0,1fr)]" data-testid="planner-calendar">
      <div className="flex min-h-0 flex-col gap-3 xl:h-[calc(100dvh-13rem)] xl:min-h-[640px]">
      {stage === "WINDER" ? (
        <details className="rounded-xl border border-border bg-card p-3"><summary className="cursor-pointer text-xs font-semibold text-muted-foreground">Open workload by release winder</summary><WinderLoadBars className="mt-2 !border-0 !p-0" machineLabel={(id) => machineCode.get(id) || id.slice(0, 8)} selected={winderFilter} onSelect={setWinderFilter} /></details>
      ) : null}
      <aside className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold">Open queue</h2>
            <span className="text-[12px] tabular-nums text-muted-foreground">{fmt(allQueued.length)} cards · {fmt(queuePcs)} pcs</span>
          </div>
          <div className="mt-2 flex h-9 items-center gap-2 rounded-lg border border-input bg-card px-2.5 focus-within:ring-2 focus-within:ring-ring/30">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input aria-label="Search queue" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Card no, customer, size, color…" className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground" />
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {([["all", "All"], ["priority", "Due ≤3d"], ["overdue", "Overdue"], ["missed", "Missed slot"], ["emergency", "Emergency"]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={cn(
                  "h-7 rounded-full border px-2.5 text-[11.5px] font-medium transition-colors",
                  filter === key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {label} <span className="tabular-nums opacity-75">{queueCounts[key]}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11.5px] text-muted-foreground">
            <span>Drag a card onto a day to place it</span>
            <select aria-label="Sort queue" value={sort} onChange={(event) => setSort(event.target.value as any)} className="h-7 rounded-md border border-input bg-card px-1.5 text-[11.5px]">
              <option value="due">Due first</option>
              <option value="qty">Largest first</option>
              <option value="age">Oldest release</option>
            </select>
          </div>
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {queue.length ? queue.map((job) => {
            const dueDays = job.due_date ? dayjs(job.due_date).startOf("day").diff(dayjs().startOf("day"), "day") : null
            return (
              <li
                key={job.id}
                draggable
                onDragStart={() => setDragged(job)}
                onDragEnd={() => { setDragged(null); setHoverDay(null) }}
                className={cn("group flex cursor-grab items-start gap-2 px-3 py-2 transition-colors hover:bg-muted/50 active:cursor-grabbing", dragged?.id === job.id && "bg-primary/5 opacity-60")}
              >
                <span className="mt-1 h-7 w-1 shrink-0 rounded-full" style={{ background: job.parchment_color ? swatchFor(job.parchment_color) : "hsl(var(--border))" }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <JobCardNo job={job} />
                    <span className="ml-auto text-[12.5px] font-semibold tabular-nums">{fmt(job.planned_qty)}</span>
                  </div>
                  <p className="truncate text-[12px] text-muted-foreground">{job.customer_name || "—"} · {job.product_size_label || job.product_code || "—"}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-[11.5px]">
                    {job.parchment_color ? <ColorChip color={job.parchment_color} className="!text-[11.5px]" /> : <span className="text-muted-foreground">Plain</span>}
                    {job.assigned_winder_machine_id ? <span className="text-muted-foreground">· pref {machineCode.get(String(job.assigned_winder_machine_id)) || "winder"}</span> : null}
                    {dueDays !== null ? (
                      <span className={cn("ml-auto tabular-nums", dueDays < 0 ? "font-semibold text-signal-rose-ink" : dueDays <= 3 ? "font-semibold text-signal-amber-ink" : "text-muted-foreground")}>
                        {dueDays < 0 ? `${Math.abs(dueDays)}d late` : dueDays === 0 ? "due today" : `due ${dueDays}d`}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <button type="button" aria-label="Manage card" title="Manage (edit, emergency, force close)" onClick={() => onOpenCard(String(job.id))} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground group-hover:opacity-100">
                    <Settings2 className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" aria-label="Edit card" title="Edit qty / colour (queued card)" onClick={() => onOpenCard(String(job.id), "edit")} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground group-hover:opacity-100">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {Number(job.planned_qty || 0) > 1 ? (
                    <button type="button" aria-label="Split card" title="Split into two cards" onClick={() => onOpenCard(String(job.id), "split")} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground group-hover:opacity-100">
                      <Scissors className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60" />
                </div>
              </li>
            )
          }) : (
            <li className="px-4 py-10 text-center text-[13px] text-muted-foreground">{allQueued.length ? "No card matches this filter." : "Queue is empty — everything released is on the calendar."}</li>
          )}
        </ul>
      </aside>
      </div>

      <section className="min-w-0 rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <CalendarDays className="h-4 w-4 text-primary" />
          <h2 className="text-[16px] font-semibold tracking-tight">{monthStart.format("MMMM YYYY")}</h2>
          <div className="flex items-center gap-1">
            <Link aria-label="Previous month" href={hrefFor({ date: monthStart.subtract(1, "month").format("YYYY-MM-DD"), view: "calendar" })} className="tube-icon-button"><ChevronLeft size={16} /></Link>
            <Link href={hrefFor({ date: dayjs().format("YYYY-MM-DD"), view: "calendar" })} className="erp-btn-secondary !h-8 !px-2.5 text-[12px]">Today</Link>
            <Link aria-label="Next month" href={hrefFor({ date: monthStart.add(1, "month").format("YYYY-MM-DD"), view: "calendar" })} className="tube-icon-button"><ChevronRight size={16} /></Link>
          </div>
          <div className="ml-auto flex flex-wrap gap-4 text-[12px] text-muted-foreground">
            <span><strong className="tabular-nums text-foreground">{fmt(monthPcs)}</strong> pcs scheduled</span>
            <span><strong className="tabular-nums text-foreground">{fmt(monthDeliveryPcs)}</strong> pcs to deliver</span>
            <span><strong className="tabular-nums text-foreground">{fmt(monthDue)}</strong> cards due</span>
            <span><strong className="tabular-nums text-foreground">{fmt(queuePcs)}</strong> pcs waiting</span>
          </div>
        </div>
        <div className="overflow-x-auto p-3">
          <div className="grid min-w-[760px] grid-cols-7 gap-1.5" onMouseLeave={() => setWindowStart(null)}>
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
              <div key={label} className="px-2 pb-1 text-[11.5px] font-semibold text-muted-foreground">{label}</div>
            ))}
            {days.map((day, dayIndex) => {
              const droppable = !day.isPast && !day.beyond && Boolean(dragged)
              const deliveryPcs = day.deliveries.reduce((sum: number, row: any) => sum + Number(row.qty || 0), 0)
              const hasDetail = day.scheduled.length > 0 || day.deliveries.length > 0 || day.dueCards.length > 0
              return (
                <div
                  key={day.key}
                  onMouseEnter={() => { if (!day.beyond) hoverWindow(day.key) }}
                  onClick={(event) => {
                    if (dragged || day.beyond || !onZoom) return
                    if ((event.target as HTMLElement).closest("button, a")) return
                    onZoom(day.key)
                  }}
                  onDragOver={(event) => { if (!day.isPast && !day.beyond) { event.preventDefault(); if (hoverDay !== day.key) setHoverDay(day.key) } }}
                  onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setHoverDay((current) => (current === day.key ? null : current)) }}
                  onDrop={() => { setHoverDay(null); if (dragged && !day.isPast && !day.beyond) openPlacer(dragged, day.key); setDragged(null) }}
                  className={cn(
                    "group relative flex min-h-[132px] flex-col rounded-lg border p-2 transition-all duration-200",
                    onZoom && !day.beyond && !dragged && "cursor-zoom-in",
                    day.inMonth ? "bg-card" : "bg-muted/40",
                    !dragged && inWindow(day.key, windowStart) && "border-primary/50 bg-primary/[.045]",
                    recentWindow && inWindow(day.key, recentWindow) && "planner-window-pulse ring-1 ring-primary/40",
                    day.isToday ? "border-primary ring-2 ring-primary/25" : "border-border",
                    droppable && "border-dashed",
                    hoverDay === day.key && droppable && "scale-[1.02] border-primary bg-primary/5 shadow-md",
                    day.beyond && "opacity-50",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <Link href={hrefFor({ date: day.key, view: "schedule" })} className={cn("grid h-6 min-w-6 place-items-center rounded-md px-1 text-[12.5px] font-semibold hover:bg-muted", day.isToday && "bg-primary text-primary-foreground hover:bg-primary", !day.inMonth && "text-muted-foreground")}>
                      {day.date.format("D")}
                    </Link>
                    {day.deliveries.length ? <span title={`${fmt(deliveryPcs)} pcs promised to customers`} className="inline-flex items-center gap-0.5 rounded bg-signal-violet-soft px-1 text-[10.5px] font-semibold text-signal-violet-ink"><Truck className="h-2.5 w-2.5" />{fmt(deliveryPcs)}</span> : null}
                    {day.due ? <span title={`${day.due} job card(s) due to the customer`} className="rounded bg-signal-rose-soft px-1 text-[10.5px] font-semibold text-signal-rose-ink">{day.due} due</span> : null}
                    {day.missed ? <span title="Slot passed without entry" className="text-signal-amber-ink"><AlertTriangle className="h-3 w-3" /></span> : null}
                    {day.pcs ? <span className="ml-auto text-[11px] font-semibold tabular-nums text-muted-foreground">{fmt(day.pcs)}</span> : null}
                    {!day.beyond && windowStart === day.key && !dragged ? (
                      <Link
                        href={hrefFor({ date: day.key, view: "schedule" })}
                        onClick={(event) => { if (onZoom) { event.preventDefault(); onZoom(day.key) } }}
                        className={cn("inline-flex h-5 items-center gap-0.5 rounded bg-primary px-1 text-[10.5px] font-semibold text-primary-foreground shadow-sm animate-scale-in", !day.pcs && "ml-auto")}
                        aria-label={`Open ${day.date.format("D")}–${day.date.add(windowDays - 1, "day").format("D MMM")} on the board`}
                      >
                        <ZoomIn className="h-3 w-3" />{windowDays}d
                      </Link>
                    ) : null}
                  </div>
                  {day.pcs ? (
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full origin-left animate-[bar-grow_600ms_var(--ease-workspace)_both] rounded-full bg-primary/70" style={{ width: `${(day.pcs / maxDayPcs) * 100}%` }} />
                    </div>
                  ) : null}
                  <ul className="mt-1.5 space-y-0.5">
                    {day.scheduled.slice(0, 4).map((job) => (
                      <li key={job.id}>
                        <button type="button" onClick={() => onOpenCard(String(job.id))} className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] hover:bg-muted" title={`${job.job_card_no || job.job_card_ref} · ${job.customer_name || ""} · ${machineCode.get(String(job.current_machine_id)) || ""} ${String(job.current_shift_code || "").replace("SHIFT_", "")}`}>
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: job.parchment_color ? swatchFor(job.parchment_color) : "hsl(var(--muted-foreground) / .4)" }} />
                          {job.is_emergency ? <Flame className="h-3 w-3 shrink-0 text-signal-rose-ink" /> : null}
                          <span className="truncate font-mono font-semibold">{job.job_card_no || job.job_card_ref}</span>
                          <span className="ml-auto shrink-0 text-muted-foreground">{String(job.current_shift_code || "").replace("SHIFT_", "")}·{machineCode.get(String(job.current_machine_id)) || ""}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {day.scheduled.length > 4 ? (
                    <Link href={hrefFor({ date: day.key, view: "schedule" })} className="mt-auto pt-1 text-[11px] font-semibold text-primary hover:underline">+{day.scheduled.length - 4} more</Link>
                  ) : null}
                  {hoverDay === day.key && droppable ? (
                    <span className="pointer-events-none absolute inset-x-2 bottom-2 rounded-md bg-primary px-2 py-1 text-center text-[11px] font-semibold text-primary-foreground shadow animate-scale-in">Drop to place</span>
                  ) : null}
                  {hasDetail && !dragged && windowStart === day.key ? (
                    <DayDetail
                      day={day}
                      machineCode={machineCode}
                      customerName={customerName}
                      align={dayIndex % 7 >= 4 ? "right" : "left"}
                      below={dayIndex < 21}
                      windowDays={windowDays}
                    />
                  ) : null}
                </div>
              )
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[11.5px] text-muted-foreground">
            <span>Hover a day for its details and board window; click to zoom into the machine board.</span>
            <span className="inline-flex items-center gap-1"><Flame className="h-3 w-3 text-signal-rose-ink" />emergency</span>
            <span className="inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-signal-amber-ink" />slot passed, no entry</span>
            <span className="inline-flex items-center gap-1"><span className="rounded bg-signal-rose-soft px-1 font-semibold text-signal-rose-ink">n due</span>customer due date</span>
          </div>
        </div>
      </section>

      <Dialog open={Boolean(placing)} onOpenChange={(next) => { if (!next) setPlacing(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Place {placing?.job?.job_card_no || "card"} on {placing ? dayjs(placing.date).format("ddd DD MMM") : ""}</DialogTitle>
          <DialogDescription>
            {fmt(placing?.job?.planned_qty || 0)} pcs{placing?.job?.parchment_color ? ` · ${placing.job.parchment_color}` : ""}. Pick the machine and shift; capacity is checked and warned on save.
          </DialogDescription>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[12px] font-medium text-muted-foreground">Machine</span>
              <select value={placeMachine} onChange={(event) => setPlaceMachine(event.target.value)} className="h-10 w-full rounded-lg border border-input bg-card px-2.5 text-[13px]">
                {machines.map((machine) => (
                  <option key={machine.id} value={machine.id}>{machine.code}{String(placing?.job?.assigned_winder_machine_id || "") === machine.id ? " (release pick)" : ""}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[12px] font-medium text-muted-foreground">Shift</span>
              <div className="tube-segment w-full">
                {["SHIFT_A", "SHIFT_B"].map((code) => (
                  <button key={code} type="button" aria-pressed={placeShift === code} onClick={() => setPlaceShift(code)} className="flex-1 justify-center">{code.replace("SHIFT_", "Shift ")}</button>
                ))}
              </div>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="erp-btn-secondary" onClick={() => setPlacing(null)}>Cancel</button>
            <button type="button" className="erp-btn-primary" disabled={!placeMachine || moveCard.isPending} onClick={() => void place()}>{moveCard.isPending ? "Placing…" : "Place card"}</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}


/** Everything about one day, shown on hover: machine/shift load, customer deliveries, cards due. */
function DayDetail({ day, machineCode, customerName, align, below, windowDays }: {
  day: any
  machineCode: Map<string, string>
  customerName: (id?: string | null) => string
  align: "left" | "right"
  below: boolean
  windowDays: number
}) {
  const slots = new Map<string, { label: string; cards: number; pcs: number }>()
  for (const job of day.scheduled as any[]) {
    const machine = machineCode.get(String(job.current_machine_id)) || "Machine"
    const shift = String(job.current_shift_code || "").replace("SHIFT_", "")
    const key = `${machine}|${shift}`
    const row = slots.get(key) || { label: `${machine} · Shift ${shift}`, cards: 0, pcs: 0 }
    row.cards += 1
    row.pcs += Number(job.planned_qty || 0)
    slots.set(key, row)
  }
  const deliveries = day.deliveries as any[]
  return (
    <div
      role="tooltip"
      className={cn(
        "pointer-events-none absolute z-40 w-[300px] rounded-xl border border-border bg-card/98 p-3 text-left shadow-[0_18px_50px_rgba(15,23,42,.18)] backdrop-blur animate-scale-in",
        align === "right" ? "right-0" : "left-0",
        below ? "top-[calc(100%+6px)]" : "bottom-[calc(100%+6px)]",
      )}
    >
      <p className="text-[12.5px] font-semibold">{day.date.format("dddd, D MMMM")}</p>
      {slots.size ? (
        <div className="mt-2">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">On the machines</p>
          <ul className="mt-1 space-y-0.5 text-[12px]">
            {Array.from(slots.values()).sort((a, b) => a.label.localeCompare(b.label)).map((row) => (
              <li key={row.label} className="flex justify-between gap-2"><span>{row.label}</span><span className="tabular-nums text-muted-foreground">{row.cards} card{row.cards === 1 ? "" : "s"} · {fmt(row.pcs)} pcs</span></li>
            ))}
          </ul>
        </div>
      ) : null}
      {deliveries.length ? (
        <div className="mt-2">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Customer deliveries</p>
          <ul className="mt-1 space-y-1 text-[12px]">
            {deliveries.slice(0, 6).map((row) => (
              <li key={`${row.line_id}:${row.schedule_id || "due"}`} className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-medium">{row.order_no}</span> <span className="text-muted-foreground">· {customerName(row.customer_id)}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{row.size_label || row.product_code}{row.parchment_color ? ` · ${row.parchment_color}` : ""}{row.source === "LINE_DUE" ? " · no call-off yet" : ""}</span>
                </span>
                <span className="shrink-0 tabular-nums font-semibold">{fmt(row.qty)}</span>
              </li>
            ))}
            {deliveries.length > 6 ? <li className="text-[11px] text-muted-foreground">+{deliveries.length - 6} more</li> : null}
          </ul>
        </div>
      ) : null}
      {day.dueCards.length ? (
        <p className="mt-2 text-[11.5px] text-signal-rose-ink">{day.dueCards.length} job card{day.dueCards.length === 1 ? "" : "s"} due: {day.dueCards.slice(0, 4).map((job: any) => job.job_card_no || job.job_card_ref).join(", ")}{day.dueCards.length > 4 ? "…" : ""}</p>
      ) : null}
      <p className="mt-2 border-t border-border pt-1.5 text-[11px] text-muted-foreground">Click to open {windowDays} days from here on the board</p>
    </div>
  )
}
