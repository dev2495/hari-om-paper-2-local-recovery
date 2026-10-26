"use client"

import { DeliveryDayBadge } from "./customer-commitments"
import { useDeliveryCalendar } from "@/hooks/use-sales"
import dayjs from "dayjs"
import { memo, useCallback, useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react"
import { ChevronDown, Flame, GripVertical, Keyboard, Lock, Pencil, Scissors, Settings2, Undo2 } from "lucide-react"

import { ColorChip, JobCardNo, swatchFor } from "@/components/production/lifecycle-chips"
import { isLocked, lockReason, queueKey } from "@/lib/planner-queue-filters"
import { cn } from "@/lib/utils"

export type BoardTarget = { machine_id: string | null; plan_date: string | null; shift_code: string | null; sequence_no: number }
type Lane = { warning?: string | null; machine_id?: string; shift_code?: string; shift_label?: string; capacity_value?: number | null; capacity_unit?: string | null; current_load?: number | null; jobs?: any[] }
type Machine = { id: string; code: string; name?: string; status?: string; capacity_value?: number | null; capacity_unit?: string | null; dayColumns: Array<{ date: string; shifts: Lane[] }> }
type QueueGroup = { key: string; title: string; subtitle?: string; jobs: any[]; locked?: boolean }
export type CardAction = "manage" | "split" | "edit" | "segment_split"
export type FocusLane = { machine_id: string; shift_code?: string | null }

const fmt = (value: number, digits = 0) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })

function dueInfo(due?: string | null) {
  if (!due) return null
  const days = dayjs(due).startOf("day").diff(dayjs().startOf("day"), "day")
  return { days, label: days < 0 ? `${Math.abs(days)}d late` : days === 0 ? "due today" : `due ${days}d`, tone: days < 0 ? "text-signal-rose-ink font-semibold" : days <= 3 ? "text-signal-amber-ink font-semibold" : "text-muted-foreground" }
}

/** A "5 cards · 2,400 pcs" ghost under the pointer while a selection is dragged. */
function multiDragImage(event: DragEvent, count: number, pcs: number) {
  if (typeof document === "undefined") return
  const ghost = document.createElement("div")
  ghost.textContent = `${count} cards · ${fmt(pcs)} pcs`
  ghost.setAttribute("style", "position:fixed;top:-200px;left:-200px;padding:6px 10px;border-radius:8px;background:hsl(var(--primary));color:hsl(var(--primary-foreground));font:600 12px/1.2 system-ui,sans-serif;box-shadow:0 6px 18px rgba(15,23,42,.25);white-space:nowrap")
  document.body.appendChild(ghost)
  event.dataTransfer.setDragImage(ghost, 14, 14)
  setTimeout(() => ghost.remove(), 0)
}

/** One card, same look in the queue and on the board; actions appear on hover/focus. */
const PlanCard = memo(function PlanCard({ job, compact, machineLabel, loadOf, unit, onAction, onUnschedule, onDragStart, onDragEnd, dragging, selected, selectable, onToggleSelect, selectionCount, selectionPcs }: {
  job: any
  compact?: boolean
  machineLabel: (id: string) => string
  loadOf: (job: any) => number
  unit: string
  onAction: (job: any, action: CardAction) => void
  onUnschedule?: (job: any) => void
  onDragStart: (job: any) => void
  onDragEnd: () => void
  dragging: boolean
  /** Queue cards can be ticked and dragged together; placed and locked cards cannot. */
  selected?: boolean
  selectable?: boolean
  onToggleSelect?: (job: any, shiftKey: boolean) => void
  selectionCount?: number
  selectionPcs?: number
}) {
  const qty = Number(job.segment_planned_qty ?? job.planned_qty ?? 0)
  const due = dueInfo(job.due_date)
  const parts = Number(job.remaining_segments || 0)
  const queued = !job.machine_id || !job.shift_code
  const locked = queued && isLocked(job)
  const load = loadOf(job)
  const pref = job.assigned_winder_machine_id ? machineLabel(String(job.assigned_winder_machine_id)) : null
  const title = [
    job.job_card_no || job.job_card_ref,
    job.customer_code ? `${job.customer_name} (${job.customer_code})` : job.customer_name,
    job.product_size_label || job.product_code,
    job.parchment_color ? `colour ${job.parchment_color}` : null,
    `${fmt(qty)} pcs${load ? ` · ${fmt(load, 1)} ${unit}` : ""}`,
    job.due_date ? `due ${dayjs(job.due_date).format("DD MMM")}` : null,
    pref ? `release winder ${pref}` : null,
    locked ? lockReason(job) : null,
  ].filter(Boolean).join(" · ")
  return (
    <article
      draggable={!locked}
      tabIndex={0}
      title={title}
      data-testid={`planner-card:${String(job.job_card_id || job.id || "")}`}
      data-selected={selected || undefined}
      data-locked={locked || undefined}
      onDragStart={(event) => {
        if (locked) { event.preventDefault(); return }
        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData("text/plain", String(job.segment_id || job.job_card_id))
        if (selected && (selectionCount || 0) > 1) multiDragImage(event, selectionCount || 0, selectionPcs || 0)
        onDragStart(job)
      }}
      onDragEnd={onDragEnd}
      onDoubleClick={() => onAction(job, "manage")}
      className={cn(
        "planner-card group relative flex gap-2 rounded-lg border bg-card py-1.5 pl-2 pr-1.5 shadow-[0_1px_2px_rgba(15,23,42,.06)] transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-ring/40",
        locked ? "cursor-not-allowed border-dashed bg-muted/40" : "cursor-grab hover:border-primary/50 active:cursor-grabbing",
        job.is_emergency ? "border-signal-rose-line" : job.missed_slot_open || job.stale_slot ? "border-signal-amber-line" : "border-border",
        selected && "border-primary bg-primary/[.06] ring-1 ring-primary/40",
        dragging && "opacity-40",
      )}
    >
      <span className="w-1 shrink-0 self-stretch rounded-full" style={{ background: job.parchment_color ? swatchFor(job.parchment_color) : "hsl(var(--border))" }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {selectable && !locked && onToggleSelect ? (
            <input
              type="checkbox"
              aria-label={`Select ${job.job_card_no || job.job_card_ref || "card"}`}
              checked={Boolean(selected)}
              onChange={() => {}}
              onClick={(event) => { event.stopPropagation(); onToggleSelect(job, event.shiftKey) }}
              onDoubleClick={(event) => event.stopPropagation()}
              onDragStart={(event) => { event.preventDefault(); event.stopPropagation() }}
              draggable={false}
              className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
              data-testid={`planner-card-select:${String(job.job_card_id || job.id || "")}`}
            />
          ) : null}
          {locked ? <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden /> : null}
          {job.is_emergency ? <Flame className="h-3 w-3 shrink-0 text-signal-rose-ink" /> : null}
          <JobCardNo job={job} />
          {parts > 1 || Number(job.segment_no || 1) > 1 ? <span className="shrink-0 rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground" title={`Split plan · part ${job.segment_no || 1}${parts > 1 ? ` of ${parts}` : ""}`}>part {job.segment_no || 1}{parts > 1 ? ` of ${parts}` : ""}</span> : null}
          <span className="ml-auto shrink-0 text-[12.5px] font-semibold tabular-nums">{fmt(qty)} <span className="text-[10px] font-normal text-muted-foreground">pcs</span></span>
        </div>
        <p className="flex min-w-0 items-center gap-1 text-[11.5px] text-muted-foreground">
          {job.customer_code ? <span className="shrink-0 rounded bg-muted px-1 font-mono text-[10px] font-semibold text-foreground/80" title="Customer code">{job.customer_code}</span> : null}
          <span className="truncate">{job.customer_name || "—"} · {job.product_size_label || job.product_code || "—"}</span>
        </p>
        {locked ? (
          <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground" data-testid={`planner-locked:${String(job.job_card_id || job.id || "")}`}>
            <Lock className="h-3 w-3 shrink-0" />{lockReason(job)}
          </p>
        ) : !compact ? (
          <div className="mt-0.5 flex items-center gap-2 text-[11px]">
            {job.parchment_color ? <ColorChip color={job.parchment_color} className="!text-[11px]" /> : <span className="text-muted-foreground">Plain</span>}
            {load ? <span className="tabular-nums text-muted-foreground">{fmt(load, 0)} {unit}</span> : null}
            {pref && queued ? <span className="truncate text-muted-foreground">pref {pref}</span> : null}
            {due ? <span className={cn("ml-auto shrink-0 tabular-nums", due.tone)}>{due.label}</span> : null}
          </div>
        ) : due && due.days <= 3 ? <p className={cn("text-[10.5px] tabular-nums", due.tone)}>{due.label}</p> : null}
      </div>
      <div data-card-actions className="absolute -top-2 right-1 z-10 flex gap-0.5 rounded-md border border-border bg-card p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 group-focus-visible:opacity-100">
        <button type="button" aria-label="Manage card" title="Manage: edit, split, emergency, force close, trail" onClick={() => onAction(job, "manage")} className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><Settings2 className="h-3.5 w-3.5" /></button>
        {queued && !locked ? <button type="button" aria-label="Edit card" title="Edit qty / colour (queued cards)" onClick={() => onAction(job, "edit")} className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button> : null}
        {qty > 1 && !locked ? <button type="button" aria-label={queued ? "Split into a new card" : "Split plan"} title={queued ? "Split into a new card" : "Split plan: cut this slot into parts"} onClick={() => onAction(job, queued ? "split" : "segment_split")} className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><Scissors className="h-3.5 w-3.5" /></button> : null}
        {!queued && onUnschedule ? <button type="button" aria-label="Back to queue" title="Back to queue" onClick={() => onUnschedule(job)} className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><Undo2 className="h-3.5 w-3.5" /></button> : null}
      </div>
      {locked ? <Lock className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground/50" /> : <GripVertical className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground/50" />}
    </article>
  )
})

export function ScheduleBoard({
  days, shifts, machines, queueGroups, queueHeader, queueEmpty,
  machineLabel, loadOf, unit, onSchedule, onScheduleMany, onOverCapacity, onAction, keyboardForm, busy,
  selectedIds, onToggleSelect, focusLane,
}: {
  days: string[]
  shifts: Array<{ code: string; label?: string }>
  machines: Machine[]
  queueGroups: QueueGroup[]
  /** Search, badges, chips and the selection bar (rendered by the workspace, shared with the calendar). */
  queueHeader: ReactNode
  queueEmpty: string
  machineLabel: (id: string) => string
  loadOf: (job: any) => number
  unit: string
  onSchedule: (job: any, target: BoardTarget) => void
  /** Several selected queue cards dropped together, in queue order. */
  onScheduleMany: (jobs: any[], target: BoardTarget) => void
  onOverCapacity: (jobs: any[], target: BoardTarget, label: string, overBy: number, unitLabel: string, totalNeed: number) => void
  onAction: (job: any, action: CardAction) => void
  keyboardForm?: ReactNode
  busy?: boolean
  selectedIds: Set<string>
  onToggleSelect: (job: any, shiftKey: boolean) => void
  /** Deep link (?machine_id=…&shift=…): scroll to and pulse that lane on the first day. */
  focusLane?: FocusLane | null
}) {
  const [dragged, setDragged] = useState<any | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [queueHover, setQueueHover] = useState(false)
  const [pulseLane, setPulseLane] = useState<string | null>(null)
  const deliveries = useDeliveryCalendar(days[0], days[days.length - 1])
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const queueJobs = useMemo(() => queueGroups.flatMap((group) => group.jobs), [queueGroups])
  const selectedJobs = useMemo(() => queueJobs.filter((job) => selectedIds.has(queueKey(job)) && !isLocked(job)), [queueJobs, selectedIds])
  const selectionPcs = useMemo(() => selectedJobs.reduce((sum, job) => sum + Number(job.segment_planned_qty ?? job.planned_qty ?? 0), 0), [selectedJobs])
  // What is really being dragged: the whole selection when a ticked queue card is picked up, else the one card.
  const dragSet = useMemo(() => {
    if (!dragged) return [] as any[]
    const queued = !dragged.machine_id || !dragged.shift_code
    return queued && selectedIds.has(queueKey(dragged)) && selectedJobs.length > 1 ? selectedJobs : [dragged]
  }, [dragged, selectedIds, selectedJobs])
  const dragNeed = useMemo(() => dragSet.reduce((sum, job) => sum + loadOf(job), 0), [dragSet, loadOf])
  const columns = days.flatMap((date) => shifts.map((shift) => ({ date, shift })))
  const dayTotals = useMemo(() => {
    const out: Record<string, { load: number; capacity: number; cards: number }> = {}
    for (const machine of machines) {
      for (const column of machine.dayColumns) {
        if (!days.includes(column.date)) continue
        for (const lane of column.shifts) {
          const key = `${column.date}|${lane.shift_code}`
          const row = (out[key] ||= { load: 0, capacity: 0, cards: 0 })
          row.load += Number(lane.current_load || 0)
          row.capacity += Number(lane.capacity_value || 0)
          row.cards += (lane.jobs || []).length
        }
      }
    }
    return out
  }, [days, machines])
  const unschedule = (job: any) => onSchedule(job, { machine_id: null, plan_date: null, shift_code: null, sequence_no: 1 })
  const startDrag = useCallback((job: any) => setDragged(job), [])
  const endDrag = useCallback(() => { setDragged(null); setHover(null); setQueueHover(false) }, [])
  const cardProps = useMemo(() => ({ machineLabel, loadOf, unit, onAction, onDragStart: startDrag, onDragEnd: endDrag }), [machineLabel, loadOf, unit, onAction, startDrag, endDrag])

  // Deep link to one lane: bring it into view and pulse it for a moment.
  useEffect(() => {
    if (!focusLane?.machine_id || !days[0]) return
    const shift = focusLane.shift_code || shifts[0]?.code || ""
    const key = `${focusLane.machine_id}|${days[0]}|${shift}`
    const cell = document.querySelector<HTMLElement>(`[data-lane="${CSS.escape(key)}"]`)
    if (!cell) return
    cell.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" })
    setPulseLane(key)
    const timer = window.setTimeout(() => setPulseLane(null), 4000)
    return () => window.clearTimeout(timer)
  }, [days, focusLane, shifts, machines.length])

  return (
    <div className="grid h-[calc(100dvh-17rem)] min-h-[480px] min-w-0 gap-3 lg:grid-cols-[320px_minmax(0,1fr)]" data-testid="schedule-board">
      {/* Queue */}
      <aside className="flex min-h-0 min-w-0 flex-col gap-2">
        <section
          className={cn("flex min-h-0 flex-1 flex-col rounded-xl border bg-card shadow-sm transition-colors", dragged && (dragged.machine_id && dragged.shift_code) ? "border-dashed border-primary/60" : "border-border", queueHover && "bg-primary/[.04]")}
          onDragOver={(event) => { if (dragged?.machine_id && dragged?.shift_code) { event.preventDefault(); setQueueHover(true) } }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setQueueHover(false) }}
          onDrop={() => { setQueueHover(false); if (dragged?.machine_id && dragged?.shift_code && !busy) unschedule(dragged); setDragged(null) }}
          aria-label="Open queue"
        >
          {queueHeader}
          {dragged?.machine_id && dragged?.shift_code ? <p className="mx-2.5 mt-2 rounded-md bg-primary/10 px-2 py-1 text-center text-[11.5px] font-semibold text-primary animate-scale-in">Drop here to send it back to the queue</p> : null}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2.5">
            {queueGroups.every((group) => !group.jobs.length) ? (
              <p className="px-2 py-10 text-center text-[12.5px] text-muted-foreground">{queueEmpty}</p>
            ) : queueGroups.filter((group) => group.jobs.length).map((group) => (
              <div key={group.key} data-testid={`planner-queue-group:${group.key}`}>
                <p className={cn("sticky top-0 z-[1] mb-1.5 flex items-center justify-between bg-card/95 py-0.5 text-[11.5px] font-semibold text-muted-foreground backdrop-blur", group.locked && "border-t border-dashed border-border pt-2")} title={group.subtitle}>
                  <span className="flex min-w-0 items-center gap-1 truncate">{group.locked ? <Lock className="h-3 w-3 shrink-0" /> : null}{group.title}</span><span className="tabular-nums">{group.jobs.length}</span>
                </p>
                <div className="space-y-1.5">
                  {group.jobs.map((job: any) => (
                    <PlanCard
                      key={job.segment_id || job.id}
                      job={job}
                      dragging={dragSet.some((row) => row.segment_id === job.segment_id)}
                      selectable
                      selected={selectedIds.has(queueKey(job))}
                      onToggleSelect={onToggleSelect}
                      selectionCount={selectedJobs.length}
                      selectionPcs={selectionPcs}
                      {...cardProps}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {keyboardForm ? (
            <div className="shrink-0 border-t border-border">
              <button type="button" onClick={() => setKeyboardOpen((value) => !value)} aria-expanded={keyboardOpen} className="flex w-full items-center gap-1.5 px-3 py-2 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground">
                <Keyboard className="h-3.5 w-3.5" />Schedule with keyboard <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", !keyboardOpen && "-rotate-90")} />
              </button>
              {keyboardOpen ? <div className="max-h-[40dvh] overflow-y-auto px-2 pb-2">{keyboardForm}</div> : null}
            </div>
          ) : null}
        </section>
      </aside>

      {/* Board */}
      <section className="relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {busy ? <span className="absolute inset-x-0 top-0 z-30 h-0.5 overflow-hidden bg-muted"><span className="block h-full w-1/3 animate-[progress-indeterminate_1.1s_ease-in-out_infinite] bg-primary" /></span> : null}
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="grid min-w-max" style={{ gridTemplateColumns: `112px repeat(${columns.length}, minmax(${days.length > 2 ? 176 : 184}px, 1fr))` }}>
            {/* Day headers */}
            <div className="sticky left-0 top-0 z-20 border-b border-r border-border bg-[hsl(var(--surface-2))]" />
            {days.map((date) => {
              const isToday = dayjs(date).isSame(dayjs(), "day")
              return (
                <div key={date} style={{ gridColumn: `span ${shifts.length}` }} className={cn("sticky top-0 z-10 border-b border-r border-border bg-[hsl(var(--surface-2))] min-h-[61px] px-3 py-1.5", isToday && "bg-primary/[.07]")}>
                  <p className={cn("text-[13px] font-semibold", isToday && "text-primary")}>{dayjs(date).format("dddd, D MMM")}{isToday ? " · today" : ""}</p><DeliveryDayBadge rows={(deliveries.data || []).filter(row => row.date === date)} />
                </div>
              )
            })}
            {/* Shift headers with load across all machines */}
            <div className="sticky left-0 top-[61px] z-20 border-b border-r border-border bg-card px-3 py-1 text-[11px] font-semibold text-muted-foreground">Machine</div>
            {columns.map(({ date, shift }) => {
              const total = dayTotals[`${date}|${shift.code}`] || { load: 0, capacity: 0, cards: 0 }
              return (
                <div key={`${date}|${shift.code}`} className="sticky top-[61px] z-10 flex items-center justify-between gap-2 border-b border-r border-border bg-card px-3 py-1 text-[11px]">
                  <span className="font-semibold">{shift.label || shift.code.replace("SHIFT_", "Shift ")}</span>
                  <span className="tabular-nums text-muted-foreground">{total.cards} cards · {fmt(total.load)} {unit}</span>
                </div>
              )
            })}
            {/* Machine rows */}
            {machines.length === 0 ? (
              <div className="col-span-full px-4 py-12 text-center text-[13px] text-muted-foreground">No machines for this stage yet.</div>
            ) : machines.map((machine) => {
              const blocked = machine.status === "DOWN" || machine.status === "MAINT"
              const focused = focusLane?.machine_id === machine.id
              return (
                <div key={machine.id} className="contents">
                  <div className={cn("sticky left-0 z-10 border-b border-r border-border bg-card px-3 py-2", focused && pulseLane && "bg-primary/[.07]")} data-testid={`planner-machine-row:${machine.id}`}>
                    <p className="text-[14px] font-semibold leading-tight">{machine.code}</p>
                    <p className="truncate text-[10.5px] text-muted-foreground" title={machine.name}>{machine.name}</p>
                    <p className="mt-1 text-[10.5px] tabular-nums text-muted-foreground">{fmt(Number(machine.capacity_value || 0))} {machine.capacity_unit || ""}</p>
                    {blocked ? <p className="mt-1 text-[10.5px] font-semibold text-signal-rose-ink">{machine.status}</p> : null}
                  </div>
                  {machine.dayColumns.filter((column) => days.includes(column.date)).flatMap((column) => column.shifts.map((lane) => {
                    const cell = `${machine.id}|${column.date}|${lane.shift_code}`
                    const capacity = Number(lane.capacity_value || 0)
                    const current = Number(lane.current_load || 0)
                    const here = dragged && dragSet.length === 1 && (lane.jobs || []).some((job: any) => job.segment_id === dragged.segment_id)
                    const need = dragged && !here ? dragNeed : 0
                    const projected = current + need
                    const ratio = capacity ? Math.min(100, (current / capacity) * 100) : 0
                    const projectedPct = capacity ? (projected / capacity) * 100 : 0
                    const fit = !dragged ? "none" : blocked ? "blocked" : lane.warning ? "review" : !capacity || !need ? "ok" : projectedPct > 100 ? "over" : projectedPct >= 85 ? "tight" : "ok"
                    const past = dayjs(column.date).isBefore(dayjs(), "day")
                    const target: BoardTarget = { machine_id: machine.id, plan_date: column.date, shift_code: lane.shift_code || null, sequence_no: (lane.jobs || []).length + 1 }
                    const label = `${machine.code} · ${dayjs(column.date).format("DD MMM")} · ${lane.shift_label || String(lane.shift_code || "").replace("SHIFT_", "Shift ")}`
                    const many = dragSet.length > 1
                    return (
                      <div
                        key={cell}
                        data-fit={fit}
                        data-lane={cell}
                        onDragOver={(event) => { if (dragged && !blocked && !busy) { event.preventDefault(); if (hover !== cell) setHover(cell) } }}
                        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setHover((current) => (current === cell ? null : current)) }}
                        onDrop={() => {
                          const jobs = dragSet
                          setHover(null); setDragged(null)
                          if (!jobs.length || blocked || here || busy) return
                          if (fit === "over") onOverCapacity(jobs, target, label, projected - capacity, lane.capacity_unit || unit, need)
                          else if (jobs.length > 1) onScheduleMany(jobs, target)
                          else onSchedule(jobs[0], target)
                        }}
                        className={cn(
                          "relative flex min-h-[124px] flex-col gap-1.5 border-b border-r border-border p-1.5 transition-colors duration-150",
                          blocked ? "bg-muted/60" : past ? "bg-[hsl(var(--surface-sunken))]" : "bg-card",
                          dragged && !blocked && "bg-primary/[.025]",
                          hover === cell && fit === "ok" && "bg-signal-emerald-soft/60 ring-2 ring-inset ring-signal-emerald-ink/40",
                          hover === cell && (fit === "tight" || fit === "review") && "bg-signal-amber-soft/60 ring-2 ring-inset ring-signal-amber-ink/40",
                          hover === cell && fit === "over" && "bg-signal-rose-soft/60 ring-2 ring-inset ring-signal-rose-ink/40",
                          pulseLane === cell && "planner-window-pulse ring-2 ring-inset ring-primary/60 bg-primary/[.06]",
                        )}
                      >
                        <div className="flex items-center gap-1.5" title={capacity ? `${fmt(current, 1)} of ${fmt(capacity)} ${lane.capacity_unit || unit}` : "No capacity set"}>
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <span className={cn("block h-full rounded-full ", ratio >= 100 ? "bg-signal-rose-ink" : ratio >= 85 ? "bg-signal-amber-ink" : "bg-primary/70")} style={{ width: `${ratio}%` }} />
                          </span>
                          <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">{capacity ? `${fmt(current)} / ${fmt(capacity)} ${unit}` : `${fmt(current)} ${unit} · capacity unset`}</span>
                        </div>
                        {lane.warning ? <p className="rounded bg-signal-amber-soft p-1.5 text-[10.5px] text-signal-amber-ink">{lane.warning}</p> : null}
                        {(lane.jobs || []).map((job: any) => <PlanCard key={job.segment_id} job={job} compact dragging={dragged?.segment_id === job.segment_id} onUnschedule={unschedule} {...cardProps} />)}
                        {hover === cell && dragged && !here ? (
                          <span className={cn("pointer-events-none mt-auto rounded-md px-2 py-1 text-center text-[11px] font-semibold text-background shadow animate-scale-in", fit === "over" ? "bg-signal-rose-ink" : (fit === "tight" || fit === "review") ? "bg-signal-amber-ink" : fit === "blocked" ? "bg-muted-foreground" : "bg-signal-emerald-ink")}>
                            {fit === "blocked" ? "Machine unavailable" : fit === "review" ? "Review slot warning before scheduling" : fit === "over" ? `${many ? `${dragSet.length} cards · ` : ""}Over by ${fmt(projected - capacity, 0)} ${lane.capacity_unit || unit} — splits into next shift` : capacity ? `${many ? `${dragSet.length} cards fit` : "Fits"} · ${Math.round(projectedPct)}% after drop` : many ? `Drop ${dragSet.length} cards here` : "Drop to place"}
                          </span>
                        ) : !(lane.jobs || []).length && !dragged ? <span className="mt-auto text-center text-[10.5px] text-muted-foreground">{blocked ? "Unavailable" : lane.warning ? "Capacity needs review" : capacity ? `${fmt(Math.max(0, capacity - current))} ${unit} available · drop a card` : "Set machine capacity to check fit"}</span> : null}
                      </div>
                    )
                  }))}
                </div>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}
