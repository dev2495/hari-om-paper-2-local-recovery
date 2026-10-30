"use client"

import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react"
import { AlertTriangle, CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, Plus, Truck } from "lucide-react"

import { primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import type { Arrival, CalendarData, CalendarMaterial } from "@/lib/api-rm-calendar"
import { cn } from "@/lib/utils"

import { ArrivalChip, BalanceBar, CoverBadge } from "./atoms"
import { balanceScale, type Permissions } from "./detail-sheet"
import { CLASS_LABEL, chunkDays, compactQty, coverDays, dayLabel, longDate, perUnit, qty, relativeDay, shortDate, unitWord, weekday, weeksOf } from "./format"

export type OpenDetail = (material: CalendarMaterial, day?: string | null) => void
export type MoveArrival = (arrival: Arrival, day: string) => void

const DRAG_TYPE = "application/x-rm-arrival"

export function canDrag(arrival: Arrival, permissions: Permissions): boolean {
  if (!arrival.entry_id || arrival.state === "RECEIVED") return false
  if (arrival.state === "PROPOSED") return permissions.canPropose
  return permissions.isOwner && arrival.movable
}

function onKeyOpen(event: KeyboardEvent<HTMLElement>, open: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault()
    open()
  }
}

/** Seven days per page from today (a rolling week, never past days): sticky material column, a cell
 * per day, drag chips between days. Fits a 1280 px screen without sideways scrolling. */
export function WeekGrid({ data, materials, permissions, weekIndex, onWeekChange, onOpen, onMove, onApproveWeek, approving }: {
  data: CalendarData
  materials: CalendarMaterial[]
  permissions: Permissions
  weekIndex: number
  onWeekChange: (index: number) => void
  onOpen: OpenDetail
  onMove: MoveArrival
  onApproveWeek: (week: string[]) => void
  approving: boolean
}) {
  const weeks = useMemo(() => chunkDays(data.days, 7), [data.days])
  const index = Math.min(Math.max(weekIndex, 0), Math.max(weeks.length - 1, 0))
  const week = weeks[index] || []
  const position = useMemo(() => Object.fromEntries(data.days.map((day, at) => [day, at])), [data.days])
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const dragging = useRef<null | { arrival: Arrival; itemId: string }>(null)
  const shownDay = (row: { date: string }) => (row.date < data.today ? data.today : row.date)
  const weekPending = data.pending_approval.entries.filter((row) => week.includes(shownDay(row)) && materials.some((material) => material.item_id === row.item_id))
  const weekReady = weekPending.filter((row) => row.supplier_id)
  const scales = useMemo(() => Object.fromEntries(materials.map((row) => [row.item_id, balanceScale(row)])), [materials])

  return (
    <section className="erp-panel min-w-0 overflow-hidden rounded-xl" aria-label="Week view">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-1.5">
          <button type="button" className={cn(secondaryButton, "w-9 px-0 max-sm:w-11")} onClick={() => onWeekChange(index - 1)} disabled={index <= 0} aria-label="Previous week"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" className={cn(secondaryButton, "w-9 px-0 max-sm:w-11")} onClick={() => onWeekChange(index + 1)} disabled={index >= weeks.length - 1} aria-label="Next week"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
          <p className="ml-1 text-[13.5px] font-semibold text-foreground">
            {week.length ? `${shortDate(week[0])} – ${shortDate(week[week.length - 1])}` : "—"}
            <span className="ml-2 text-[12px] font-normal text-muted-foreground">{index === 0 ? "Next 7 days" : `Days ${index * 7 + 1}–${index * 7 + week.length}`} of {data.days.length}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {index > 0 ? <button type="button" className={cn(secondaryButton, "max-sm:h-11")} onClick={() => onWeekChange(0)}>Back to today</button> : null}
          {permissions.isOwner && weekPending.length ? (
            weekReady.length ? (
              <button type="button" className={cn(primaryButton, "max-sm:h-11")} disabled={approving} onClick={() => onApproveWeek(week)}
                title={weekReady.length < weekPending.length ? `${weekPending.length - weekReady.length} need a vendor first` : undefined}>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />Approve these 7 days ({weekReady.length})
              </button>
            ) : <span className="text-[12.5px] font-medium text-signal-amber-ink">{weekPending.length} waiting · pick a vendor in Review</span>
          ) : null}
        </div>
      </div>
      <div className="max-h-[min(72vh,900px)] overflow-auto overscroll-x-contain" role="grid" aria-label={`Materials by day, ${shortDate(week[0])} to ${shortDate(week[week.length - 1])}`}>
        <div className="grid min-w-[912px] grid-cols-[198px_repeat(7,minmax(102px,1fr))]">
          <div role="row" className="contents">
            <div role="columnheader" className="sticky left-0 top-0 z-30 border-b border-r border-border bg-[hsl(var(--surface-2))] px-3 py-2 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Material · stock now</div>
            {week.map((day) => {
              const isToday = day === data.today
              const weekend = ["Sat", "Sun"].includes(weekday(day))
              return (
                <div key={day} role="columnheader" className={cn("sticky top-0 z-20 border-b border-r border-border px-2 py-2 last:border-r-0", isToday ? "bg-signal-cyan-soft" : "bg-[hsl(var(--surface-2))]")}>
                  <p className={cn("text-[11.5px] font-semibold uppercase tracking-[0.05em]", isToday ? "text-signal-cyan-ink" : "text-muted-foreground")}>{isToday ? "Today" : weekday(day)}{weekend && !isToday ? <span className="sr-only"> (weekend)</span> : null}</p>
                  <p className="text-[13px] font-semibold text-foreground">{shortDate(day)}</p>
                </div>
              )
            })}
          </div>
          {materials.map((material) => (
            <div role="row" key={material.item_id} className="contents group/row">
              <div role="rowheader" className="sticky left-0 z-10 flex min-h-[104px] flex-col justify-between gap-1.5 border-b border-r border-border bg-card px-3 py-2.5">
                <button type="button" onClick={() => onOpen(material, null)} className="min-w-0 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11">
                  <span className="block truncate text-[13px] font-semibold text-foreground hover:text-signal-cyan-ink">{material.item_name}</span>
                  <span className="block break-all text-[11.5px] text-muted-foreground">{material.item_code}</span>
                  <span className="block text-[11.5px] text-muted-foreground">figures in {unitWord(material.uom)}</span>
                </button>
                <p className="text-[11.5px] leading-4 text-muted-foreground">
                  <span className="font-semibold tabular-nums text-foreground">{qty(material.stock_now, material.uom)}</span> usable
                  {material.qc_pending ? <span className="block"><span className="tabular-nums">{qty(material.qc_pending, material.uom)}</span> in QC</span> : null}
                </p>
                <div className="space-y-0.5">
                  <CoverBadge material={material} weeks={data.weeks} today={data.today} />
                  {material.first_short && Number(material.days_of_cover) > 0 ? <p className="text-[11.5px] font-medium text-muted-foreground">{coverDays(material, data.weeks)}</p> : null}
                </div>
              </div>
              {week.map((day) => {
                const at = position[day]
                const need = material.need[at]
                const late = material.late_need[at]
                const balance = material.balance[at]
                const short = balance < -0.0005
                const low = !short && Boolean(material.min_stock) && balance < (material.min_stock || 0) - 0.0005
                const firstShort = material.first_short?.date === day
                const arrivals = material.arrivals.filter((row) => row.shown_date === day)
                const target = `${material.item_id}:${day}`
                const open = () => onOpen(material, day)
                return (
                  <div
                    key={day}
                    role="gridcell"
                    tabIndex={0}
                    aria-label={`${material.item_name}, ${dayLabel(day)}: need ${qty(need, material.uom)}, ${arrivals.length} arrival${arrivals.length === 1 ? "" : "s"}, balance ${qty(balance, material.uom)}${short ? ", short" : ""}`}
                    onClick={open}
                    onKeyDown={(event) => onKeyOpen(event, open)}
                    onDragOver={(event: DragEvent<HTMLDivElement>) => {
                      const current = dragging.current
                      if (!current || current.itemId !== material.item_id || current.arrival.shown_date === day) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = "move"
                      if (dropTarget !== target) setDropTarget(target)
                    }}
                    onDragLeave={() => { if (dropTarget === target) setDropTarget(null) }}
                    onDrop={(event) => {
                      event.preventDefault()
                      const current = dragging.current
                      setDropTarget(null)
                      dragging.current = null
                      if (current && current.itemId === material.item_id && current.arrival.shown_date !== day) onMove(current.arrival, day)
                    }}
                    className={cn(
                      "group relative flex min-h-[104px] min-w-0 cursor-pointer flex-col gap-1 border-b border-r border-border px-1.5 py-1.5 text-left outline-none transition-colors last:border-r-0",
                      "hover:bg-foreground/[.025] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      short ? "bg-signal-rose-soft/60" : low ? "bg-signal-amber-soft/50" : day === data.today ? "bg-signal-cyan-soft/30" : "",
                      dropTarget === target && "ring-2 ring-inset ring-signal-teal-ink/70 bg-signal-teal-soft/50",
                    )}
                  >
                    <div className="flex min-h-[18px] items-start justify-between gap-1">
                      {need > 0 ? (
                        <span className="min-w-0 text-[11.5px] font-semibold leading-4 text-signal-amber-ink" title={`Need ${qty(need, material.uom)}${late ? `, ${qty(late, material.uom)} of it late` : ""}`}>
                          Need {compactQty(need, material.uom)}
                          {late ? <span className="block text-[11.5px] font-semibold text-signal-rose-ink">{late >= need - 0.0005 ? "all of it late" : `${compactQty(late, material.uom)} late`}</span> : null}
                        </span>
                      ) : <span className="text-[11px] text-muted-foreground/50" aria-hidden="true">·</span>}
                      {permissions.canPropose ? <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" /> : null}
                    </div>
                    <div className="flex min-w-0 flex-col items-start gap-1">
                      {arrivals.slice(0, 2).map((arrival) => {
                        const draggable = canDrag(arrival, permissions)
                        return (
                          <ArrivalChip key={arrival.id} arrival={arrival} uom={material.uom} draggable={draggable}
                            onDragStart={(event) => {
                              dragging.current = { arrival, itemId: material.item_id }
                              event.dataTransfer.effectAllowed = "move"
                              event.dataTransfer.setData(DRAG_TYPE, arrival.id)
                              event.dataTransfer.setData("text/plain", arrival.id)
                            }} />
                        )
                      })}
                      {arrivals.length > 2 ? <span className="text-[11px] font-semibold text-muted-foreground">+{arrivals.length - 2} more</span> : null}
                    </div>
                    <div className="mt-auto space-y-0.5">
                      {firstShort ? (
                        <span className={cn("inline-flex max-w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded px-1 py-0.5 text-[11px] font-semibold", short ? "bg-signal-rose-soft text-signal-rose-ink" : "bg-signal-amber-soft text-signal-amber-ink")}>
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />{short ? "Short" : "Below min"} {compactQty(material.first_short!.qty, material.uom)}
                        </span>
                      ) : short ? <span className="text-[11.5px] font-semibold text-signal-rose-ink">Short</span> : null}
                      <BalanceBar value={balance} scale={scales[material.item_id]} minimum={material.min_stock} uom={material.uom} />
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="border-t border-border px-4 py-2 text-[12px] text-muted-foreground">
        Click a day to see who needs it and to add an arrival. {permissions.isOwner ? "Drag an arrival to another day to move it." : permissions.canPropose ? "Drag a proposed arrival to another day to move it." : ""}
      </p>
    </section>
  )
}

// Hatched, faded days outside the window, so the legend's words match what people see in light and dark.
const OUTSIDE_WINDOW = "bg-[repeating-linear-gradient(135deg,transparent_0_6px,hsl(var(--foreground)/0.06)_6px_7px)] text-muted-foreground"

/** Calendar grid of whole Monday weeks from the current week, five weeks a page (never a page of
 * past days): per day how many materials run short, what arrives and what is proposed. */
export function MonthView({ data, materials, onOpenDay }: { data: CalendarData; materials: CalendarMaterial[]; onOpenDay: (day: string) => void }) {
  const pages = useMemo(() => {
    const weeks = weeksOf(data.days)
    const out: Array<{ cells: string[]; first: string; last: string }> = []
    for (let index = 0; index < weeks.length; index += 5) {
      const cells = weeks.slice(index, index + 5).flat()
      const inside = cells.filter((day) => day >= data.days[0] && day <= data.days[data.days.length - 1])
      out.push({ cells, first: inside[0] || cells[0], last: inside[inside.length - 1] || cells[cells.length - 1] })
    }
    return out
  }, [data.days])
  const [pageIndex, setPageIndex] = useState(0)
  const page = pages[Math.min(pageIndex, pages.length - 1)]
  const position = useMemo(() => Object.fromEntries(data.days.map((day, at) => [day, at])), [data.days])
  const summary = useMemo(() => {
    const out: Record<string, { short: number; counted: number; proposed: number; received: number; need: Record<string, number> }> = {}
    for (const day of data.days) {
      const at = position[day]
      const row = { short: 0, counted: 0, proposed: 0, received: 0, need: {} as Record<string, number> }
      for (const material of materials) {
        if (material.first_short?.date === day) row.short += 1
        if (material.need[at] > 0) row.need[material.uom] = (row.need[material.uom] || 0) + material.need[at]
        for (const arrival of material.arrivals) {
          if (arrival.shown_date !== day) continue
          if (arrival.state === "PROPOSED") row.proposed += 1
          else if (arrival.state === "RECEIVED") row.received += 1
          else row.counted += 1
        }
      }
      out[day] = row
    }
    return out
  }, [data.days, materials, position])
  if (!page) return null
  return (
    <section className="erp-panel min-w-0 overflow-hidden rounded-xl" aria-label="Month view">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-1.5">
          <button type="button" className={cn(secondaryButton, "w-9 px-0 max-sm:w-11")} onClick={() => setPageIndex(Math.max(0, pageIndex - 1))} disabled={pageIndex <= 0} aria-label="Earlier weeks"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" className={cn(secondaryButton, "w-9 px-0 max-sm:w-11")} onClick={() => setPageIndex(Math.min(pages.length - 1, pageIndex + 1))} disabled={pageIndex >= pages.length - 1} aria-label="Later weeks"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
          <h2 className="ml-1 text-[14px] font-semibold text-foreground">{shortDate(page.first)} – {longDate(page.last)}</h2>
        </div>
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <span className={cn("inline-block h-3.5 w-5 rounded-sm border border-border", OUTSIDE_WINDOW)} aria-hidden="true" />
          Hatched days are outside the {data.weeks}-week window
        </p>
      </div>
      <div className="grid grid-cols-7 border-b border-border bg-[hsl(var(--surface-2))]">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => <div key={name} className="px-1 py-1.5 text-center text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground sm:px-2 sm:text-left">{name}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {page.cells.map((day, index) => {
          const inWindow = position[day] !== undefined
          const row = summary[day]
          const isToday = day === data.today
          const dayNumber = Number(day.slice(8, 10))
          // Name the month on the first cell of the page and on every 1st.
          const dayText = index === 0 || dayNumber === 1 ? shortDate(day) : String(dayNumber)
          if (!inWindow || !row) {
            return (
              <div key={day} className={cn("min-h-[64px] border-b border-r border-border p-1.5 sm:min-h-[104px] sm:p-2 [&:nth-child(7n)]:border-r-0", OUTSIDE_WINDOW)}>
                <span className="text-[12px] font-medium">{dayText}<span className="sr-only">, {day < data.today ? "past" : "outside the window"}</span></span>
              </div>
            )
          }
          const needText = perUnit(row.need)
          return (
            <button key={day} type="button" onClick={() => onOpenDay(day)}
              aria-label={`${dayLabel(day)}: ${row.short} running short, ${row.counted} arriving, ${row.proposed} proposed, need ${needText}`}
              className={cn(
                "flex min-h-[64px] flex-col items-stretch gap-1 border-b border-r border-border p-1.5 text-left transition-colors hover:bg-foreground/[.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-[104px] sm:p-2 [&:nth-child(7n)]:border-r-0",
                row.short ? "bg-signal-rose-soft/40" : "",
              )}>
              <span className={cn("inline-flex h-6 min-w-6 items-center justify-center self-start whitespace-nowrap rounded-full px-1.5 text-[12px] font-semibold", isToday ? "bg-primary text-primary-foreground" : "text-foreground")}>{isToday ? dayNumber : dayText}</span>
              <span className="flex flex-wrap gap-1 sm:hidden" aria-hidden="true">
                {row.short ? <span className="h-1.5 w-1.5 rounded-full bg-signal-rose-ink" /> : null}
                {row.counted ? <span className="h-1.5 w-1.5 rounded-full bg-signal-teal-ink" /> : null}
                {row.proposed ? <span className="h-1.5 w-1.5 rounded-full border border-foreground/50" /> : null}
              </span>
              <span className="hidden flex-col gap-1 sm:flex">
                {row.short ? <span className="inline-flex items-center gap-1 rounded bg-signal-rose-soft px-1.5 py-0.5 text-[11px] font-semibold text-signal-rose-ink"><AlertTriangle className="h-3 w-3" aria-hidden="true" />{row.short} run short</span> : null}
                {row.counted ? <span className="inline-flex items-center gap-1 rounded bg-signal-teal-soft px-1.5 py-0.5 text-[11px] font-semibold text-signal-teal-ink"><Truck className="h-3 w-3" aria-hidden="true" />{row.counted} arriving</span> : null}
                {row.proposed ? <span className="inline-flex items-center gap-1 rounded border border-dashed border-foreground/30 px-1.5 py-0.5 text-[11px] font-semibold text-foreground/80"><CircleDashed className="h-3 w-3" aria-hidden="true" />{row.proposed} proposed</span> : null}
                {row.received ? <span className="inline-flex items-center gap-1 rounded bg-signal-emerald-soft px-1.5 py-0.5 text-[11px] font-semibold text-signal-emerald-ink">{row.received} received</span> : null}
                {needText !== "0" ? <span className="truncate text-[11px] text-signal-amber-ink" title={`Need ${needText}`}>Need {needText}</span> : null}
              </span>
            </button>
          )
        })}
      </div>
      <p className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-2 text-[12px] text-muted-foreground sm:hidden">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-signal-rose-ink" />Runs short</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-signal-teal-ink" />Arriving</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full border border-foreground/50" />Proposed</span>
      </p>
    </section>
  )
}

/** "See today" / "See tomorrow", else "See Wed 11 Nov" (day and month names keep their capitals). */
function seeDay(day: string, today: string): string {
  const word = relativeDay(day, today)
  return ["Today", "Tomorrow", "Yesterday"].includes(word) ? word.toLowerCase() : word
}

/** Phone-first list: one card per material with the next shortage, cover and arrivals. */
export function ListView({ data, materials, permissions, onOpen, onAdd }: {
  data: CalendarData
  materials: CalendarMaterial[]
  permissions: Permissions
  onOpen: OpenDetail
  onAdd: (material: CalendarMaterial) => void
}) {
  return (
    <ul className="grid gap-3 lg:grid-cols-2" aria-label="Materials">
      {materials.map((material) => {
        const upcoming = material.arrivals.filter((row) => row.state !== "RECEIVED").slice(0, 4)
        const received = material.arrivals.filter((row) => row.state === "RECEIVED")
        const week = material.need.slice(0, 7).reduce((sum, value) => sum + value, 0)
        const scale = balanceScale(material)
        const end = material.balance[material.balance.length - 1]
        return (
          <li key={material.item_id} className={cn("erp-panel min-w-0 rounded-xl p-3.5 sm:p-4", material.first_short?.kind === "BELOW_ZERO" && "border-signal-rose-line")}>
            <div className="flex items-start justify-between gap-3">
              <button type="button" onClick={() => onOpen(material, null)} className="min-w-0 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11">
                <span className="block text-[14.5px] font-semibold text-foreground">{material.item_name}</span>
                {/* The code is what tells same-named materials apart: it wraps, never cut (checker r4). */}
                <span className="block break-all text-[12px] text-muted-foreground">{material.item_code} · {CLASS_LABEL[material.material_class]}</span>
              </button>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <CoverBadge material={material} weeks={data.weeks} today={data.today} />
                {material.first_short && Number(material.days_of_cover) > 0 ? <span className="text-[12px] font-medium text-muted-foreground">{coverDays(material, data.weeks)}</span> : null}
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
              <div className="rounded-lg bg-[hsl(var(--surface-2))] px-2.5 py-2"><dt className="text-muted-foreground">Usable now</dt><dd className="mt-0.5 font-semibold tabular-nums text-foreground">{qty(material.stock_now, material.uom)}</dd></div>
              <div className="rounded-lg bg-[hsl(var(--surface-2))] px-2.5 py-2"><dt className="text-muted-foreground">In QC</dt><dd className="mt-0.5 font-semibold tabular-nums text-foreground">{qty(material.qc_pending, material.uom)}</dd></div>
              <div className="rounded-lg bg-[hsl(var(--surface-2))] px-2.5 py-2"><dt className="text-muted-foreground">Need 7 days</dt><dd className={cn("mt-0.5 font-semibold tabular-nums", week ? "text-signal-amber-ink" : "text-foreground")}>{qty(week, material.uom)}</dd></div>
            </dl>
            <div className="mt-3">
              <p className="mb-1 flex items-center justify-between text-[11.5px] text-muted-foreground"><span>Balance at the end of {data.weeks} weeks</span><span className={cn("font-semibold tabular-nums", end < 0 ? "text-signal-rose-ink" : "text-foreground")}>{qty(end, material.uom)}</span></p>
              <BalanceBar value={end} scale={scale} minimum={material.min_stock} uom={material.uom} hideValue />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {upcoming.length ? upcoming.map((arrival) => <ArrivalChip key={arrival.id} arrival={arrival} uom={material.uom} showDate />) : <span className="text-[12px] text-muted-foreground">No arrival planned</span>}
              {received.length ? <span className="text-[12px] text-muted-foreground">· {received.length} received</span> : null}
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" className={cn(secondaryButton, "flex-1")} onClick={() => onOpen(material, material.first_short?.date || null)}>
                <CalendarRange className="h-4 w-4" aria-hidden="true" />{material.first_short ? `See ${seeDay(material.first_short.date, data.today)}` : "Day by day"}
              </button>
              {permissions.canPropose ? (
                <button type="button" className={cn(material.first_short ? primaryButton : secondaryButton, "flex-1")} onClick={() => onAdd(material)}>
                  <Plus className="h-4 w-4" aria-hidden="true" />Add arrival
                </button>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
