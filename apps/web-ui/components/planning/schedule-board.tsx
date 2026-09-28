"use client"

import dayjs from "dayjs"
import { useMemo, useState, type ReactNode } from "react"
import { ChevronDown, Flame, GripVertical, Keyboard, Pencil, Scissors, Search, Settings2, Undo2 } from "lucide-react"

import { ColorChip, JobCardNo, swatchFor } from "@/components/production/lifecycle-chips"
import { cn } from "@/lib/utils"

export type BoardTarget = { machine_id: string | null; plan_date: string | null; shift_code: string | null; sequence_no: number }
type Lane = { machine_id?: string; shift_code?: string; shift_label?: string; capacity_value?: number | null; capacity_unit?: string | null; current_load?: number | null; jobs?: any[] }
type Machine = { id: string; code: string; name?: string; status?: string; capacity_value?: number | null; capacity_unit?: string | null; dayColumns: Array<{ date: string; shifts: Lane[] }> }
type QueueGroup = { key: string; title: string; subtitle?: string; jobs: any[] }
export type CardAction = "manage" | "split" | "edit" | "segment_split"

const fmt = (value: number, digits = 0) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })

function dueInfo(due?: string | null) {
  if (!due) return null
  const days = dayjs(due).startOf("day").diff(dayjs().startOf("day"), "day")
  return { days, label: days < 0 ? `${Math.abs(days)}d late` : days === 0 ? "due today" : `due ${days}d`, tone: days < 0 ? "text-signal-rose-ink font-semibold" : days <= 3 ? "text-signal-amber-ink font-semibold" : "text-muted-foreground" }
}

/** One card, same look in the queue and on the board; actions appear on hover/focus. */
function PlanCard({ job, compact, machineLabel, loadOf, unit, onAction, onUnschedule, onDragStart, onDragEnd, dragging }: {
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
}) {
  const qty = Number(job.segment_planned_qty ?? job.planned_qty ?? 0)
  const due = dueInfo(job.due_date)
  const parts = Number(job.remaining_segments || 0)
  const queued = !job.machine_id || !job.shift_code
  const load = loadOf(job)
  const pref = job.assigned_winder_machine_id ? machineLabel(String(job.assigned_winder_machine_id)) : null
  const title = [
    job.job_card_no || job.job_card_ref,
    job.customer_name,
    job.product_size_label || job.product_code,
    job.parchment_color ? `colour ${job.parchment_color}` : null,
    `${fmt(qty)} pcs${load ? ` · ${fmt(load, 1)} ${unit}` : ""}`,
    job.due_date ? `due ${dayjs(job.due_date).format("DD MMM")}` : null,
    pref ? `release winder ${pref}` : null,
  ].filter(Boolean).join(" · ")
  return (
    <article
      draggable
      tabIndex={0}
      title={title}
      data-testid={`planner-card:${String(job.job_card_id || job.id || "")}`}
      onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; onDragStart(job) }}
      onDragEnd={onDragEnd}
      onDoubleClick={() => onAction(job, "manage")}
      className={cn(
        "group relative flex cursor-grab gap-2 rounded-lg border bg-card py-1.5 pl-2 pr-1.5 shadow-[0_1px_2px_rgba(15,23,42,.06)] transition-all duration-150 hover:-translate-y-px hover:shadow-md active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring/40",
        job.is_emergency ? "border-signal-rose-line" : job.missed_slot_open || job.stale_slot ? "border-signal-amber-line" : "border-border",
        dragging && "opacity-40",
      )}
    >
      <span className="w-1 shrink-0 self-stretch rounded-full" style={{ background: job.parchment_color ? swatchFor(job.parchment_color) : "hsl(var(--border))" }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {job.is_emergency ? <Flame className="h-3 w-3 shrink-0 text-signal-rose-ink" /> : null}
          <JobCardNo job={job} />
          {parts > 1 || Number(job.segment_no || 1) > 1 ? <span className="shrink-0 rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground" title="Part of a split card">part {job.segment_no || 1}</span> : null}
          <span className="ml-auto shrink-0 text-[12.5px] font-semibold tabular-nums">{fmt(qty)}</span>
        </div>
        <p className="truncate text-[11.5px] text-muted-foreground">{job.customer_name || "—"} · {job.product_size_label || job.product_code || "—"}</p>
        {!compact ? (
          <div className="mt-0.5 flex items-center gap-2 text-[11px]">
            {job.parchment_color ? <ColorChip color={job.parchment_color} className="!text-[11px]" /> : <span className="text-muted-foreground">Plain</span>}
            {load ? <span className="tabular-nums text-muted-foreground">{fmt(load, 0)} {unit}</span> : null}
            {pref && queued ? <span className="truncate text-muted-foreground">pref {pref}</span> : null}
            {due ? <span className={cn("ml-auto shrink-0 tabular-nums", due.tone)}>{due.label}</span> : null}
          </div>
        ) : due && due.days <= 3 ? <p className={cn("text-[10.5px] tabular-nums", due.tone)}>{due.label}</p> : null}
      </div>
      <div className="absolute -top-2 right-1 z-10 flex gap-0.5 rounded-md border border-border bg-card p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 group-focus-visible:opacity-100">
        <button type="button" aria-label="Manage card" title="Manage: edit, split, emergency, force close, trail" onClick={() => onAction(job, "manage")} className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><Settings2 className="h-3.5 w-3.5" /></button>
        {queued ? <button type="button" aria-label="Edit card" title="Edit qty / colour (queued cards)" onClick={() => onAction(job, "edit")} className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button> : null}
        {qty > 1 ? <button type="button" aria-label="Split card" title={queued ? "Split into two cards" : "Split this slot across shifts"} onClick={() => onAction(job, queued ? "split" : "segment_split")} className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><Scissors className="h-3.5 w-3.5" /></button> : null}
        {!queued && onUnschedule ? <button type="button" aria-label="Back to queue" title="Back to queue" onClick={() => onUnschedule(job)} className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><Undo2 className="h-3.5 w-3.5" /></button> : null}
      </div>
      <GripVertical className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground/50" />
    </article>
  )
}

export function ScheduleBoard({
  days, shifts, machines, queueGroups, queueTotal, queueSearch, onQueueSearch, queueSort, onQueueSort, loadBars,
  machineLabel, loadOf, unit, onSchedule, onOverCapacity, onAction, keyboardForm, busy,
}: {
  days: string[]
  shifts: Array<{ code: string; label?: string }>
  machines: Machine[]
  queueGroups: QueueGroup[]
  queueTotal: number
  queueSearch: string
  onQueueSearch: (value: string) => void
  queueSort: "due" | "qty" | "age"
  onQueueSort: (value: "due" | "qty" | "age") => void
  loadBars?: ReactNode
  machineLabel: (id: string) => string
  loadOf: (job: any) => number
  unit: string
  onSchedule: (job: any, target: BoardTarget) => void
  onOverCapacity: (job: any, target: BoardTarget, label: string, overBy: number, unitLabel: string) => void
  onAction: (job: any, action: CardAction) => void
  keyboardForm?: ReactNode
  busy?: boolean
}) {
  const [dragged, setDragged] = useState<any | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [queueHover, setQueueHover] = useState(false)
  const [barsOpen, setBarsOpen] = useState(true)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const queueJobs = useMemo(() => queueGroups.flatMap((group) => group.jobs), [queueGroups])
  const queuePcs = queueJobs.reduce((sum, job) => sum + Number(job.segment_planned_qty ?? job.planned_qty ?? 0), 0)
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
  const cardProps = { machineLabel, loadOf, unit, onAction, onDragStart: (job: any) => setDragged(job), onDragEnd: () => { setDragged(null); setHover(null); setQueueHover(false) } }

  return (
    <div className="grid h-[calc(100dvh-10.5rem)] min-h-[560px] min-w-0 gap-3 xl:grid-cols-[312px_minmax(0,1fr)]" data-testid="schedule-board">
      {/* Queue */}
      <aside className="flex min-h-0 min-w-0 flex-col gap-2">
        {loadBars ? (
          <div className="shrink-0">
            <button type="button" onClick={() => setBarsOpen((value) => !value)} aria-expanded={barsOpen} className="mb-1 flex w-full items-center justify-between px-1 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground">
              Load per winder <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !barsOpen && "-rotate-90")} />
            </button>
            {barsOpen ? <div className="max-h-[34dvh] overflow-y-auto animate-slide-down">{loadBars}</div> : null}
          </div>
        ) : null}
        <section
          className={cn("flex min-h-0 flex-1 flex-col rounded-xl border bg-card shadow-sm transition-colors", dragged && (dragged.machine_id && dragged.shift_code) ? "border-dashed border-primary/60" : "border-border", queueHover && "bg-primary/[.04]")}
          onDragOver={(event) => { if (dragged?.machine_id && dragged?.shift_code) { event.preventDefault(); setQueueHover(true) } }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setQueueHover(false) }}
          onDrop={() => { setQueueHover(false); if (dragged?.machine_id && dragged?.shift_code) unschedule(dragged); setDragged(null) }}
          aria-label="Open queue"
        >
          <div className="shrink-0 border-b border-border p-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[14px] font-semibold">Open queue</h2>
              <span className="text-[11.5px] tabular-nums text-muted-foreground">{queueJobs.length}/{queueTotal} cards · {fmt(queuePcs)} pcs</span>
            </div>
            <div className="mt-2 flex gap-1.5">
              <label className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-input bg-card px-2 focus-within:ring-2 focus-within:ring-ring/30">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input aria-label="Search queue" value={queueSearch} onChange={(event) => onQueueSearch(event.target.value)} placeholder="Card, customer, size, colour" className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground" />
              </label>
              <select aria-label="Sort queue" value={queueSort} onChange={(event) => onQueueSort(event.target.value as any)} className="h-8 rounded-lg border border-input bg-card px-1.5 text-[12px]">
                <option value="due">Due first</option>
                <option value="qty">Largest</option>
                <option value="age">Oldest</option>
              </select>
            </div>
            {dragged?.machine_id && dragged?.shift_code ? <p className="mt-2 rounded-md bg-primary/10 px-2 py-1 text-center text-[11.5px] font-semibold text-primary animate-scale-in">Drop here to send it back to the queue</p> : null}
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2.5">
            {queueGroups.every((group) => !group.jobs.length) ? (
              <p className="px-2 py-10 text-center text-[12.5px] text-muted-foreground">{queueSearch ? "No queued card matches the search." : "Queue is empty — everything released is on the board."}</p>
            ) : queueGroups.filter((group) => group.jobs.length).map((group) => (
              <div key={group.key}>
                <p className="sticky top-0 z-[1] mb-1.5 flex items-center justify-between bg-card/95 py-0.5 text-[11.5px] font-semibold text-muted-foreground backdrop-blur">
                  <span className="truncate">{group.title}</span><span className="tabular-nums">{group.jobs.length}</span>
                </p>
                <div className="space-y-1.5">
                  {group.jobs.map((job: any) => <PlanCard key={job.segment_id || job.id} job={job} dragging={dragged?.segment_id === job.segment_id} {...cardProps} />)}
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
          <div className="grid min-w-max" style={{ gridTemplateColumns: `128px repeat(${columns.length}, minmax(${days.length > 2 ? 190 : 250}px, 1fr))` }}>
            {/* Day headers */}
            <div className="sticky left-0 top-0 z-20 border-b border-r border-border bg-[hsl(var(--surface-2))]" />
            {days.map((date) => {
              const isToday = dayjs(date).isSame(dayjs(), "day")
              return (
                <div key={date} style={{ gridColumn: `span ${shifts.length}` }} className={cn("sticky top-0 z-10 border-b border-r border-border bg-[hsl(var(--surface-2))] px-3 py-1.5", isToday && "bg-primary/[.07]")}>
                  <p className={cn("text-[13px] font-semibold", isToday && "text-primary")}>{dayjs(date).format("dddd, D MMM")}{isToday ? " · today" : ""}</p>
                </div>
              )
            })}
            {/* Shift headers with load across all machines */}
            <div className="sticky left-0 top-[31px] z-20 border-b border-r border-border bg-card px-3 py-1 text-[11px] font-semibold text-muted-foreground">Machine</div>
            {columns.map(({ date, shift }) => {
              const total = dayTotals[`${date}|${shift.code}`] || { load: 0, capacity: 0, cards: 0 }
              const pct = total.capacity ? Math.round((total.load / total.capacity) * 100) : 0
              return (
                <div key={`${date}|${shift.code}`} className="sticky top-[31px] z-10 flex items-center justify-between gap-2 border-b border-r border-border bg-card px-3 py-1 text-[11px]">
                  <span className="font-semibold">{shift.label || shift.code.replace("SHIFT_", "Shift ")}</span>
                  <span className="tabular-nums text-muted-foreground">{total.cards} cards · {pct}%</span>
                </div>
              )
            })}
            {/* Machine rows */}
            {machines.length === 0 ? (
              <div className="col-span-full px-4 py-12 text-center text-[13px] text-muted-foreground">No machines for this stage yet.</div>
            ) : machines.map((machine) => {
              const blocked = machine.status === "DOWN" || machine.status === "MAINT"
              return (
                <div key={machine.id} className="contents">
                  <div className="sticky left-0 z-10 border-b border-r border-border bg-card px-3 py-2">
                    <p className="text-[14px] font-semibold leading-tight">{machine.code}</p>
                    <p className="truncate text-[10.5px] text-muted-foreground" title={machine.name}>{machine.name}</p>
                    <p className="mt-1 text-[10.5px] tabular-nums text-muted-foreground">{fmt(Number(machine.capacity_value || 0))} {machine.capacity_unit || ""}</p>
                    {blocked ? <p className="mt-1 text-[10.5px] font-semibold text-signal-rose-ink">{machine.status}</p> : null}
                  </div>
                  {machine.dayColumns.filter((column) => days.includes(column.date)).flatMap((column) => column.shifts.map((lane) => {
                    const cell = `${machine.id}|${column.date}|${lane.shift_code}`
                    const capacity = Number(lane.capacity_value || 0)
                    const current = Number(lane.current_load || 0)
                    const here = dragged && (lane.jobs || []).some((job: any) => job.segment_id === dragged.segment_id)
                    const need = dragged && !here ? loadOf(dragged) : 0
                    const projected = current + need
                    const ratio = capacity ? Math.min(100, (current / capacity) * 100) : 0
                    const projectedPct = capacity ? (projected / capacity) * 100 : 0
                    const fit = !dragged ? "none" : blocked ? "blocked" : !capacity || !need ? "ok" : projectedPct > 100 ? "over" : projectedPct >= 85 ? "tight" : "ok"
                    const past = dayjs(column.date).isBefore(dayjs(), "day")
                    const target: BoardTarget = { machine_id: machine.id, plan_date: column.date, shift_code: lane.shift_code || null, sequence_no: (lane.jobs || []).length + 1 }
                    const label = `${machine.code} · ${dayjs(column.date).format("DD MMM")} · ${lane.shift_label || String(lane.shift_code || "").replace("SHIFT_", "Shift ")}`
                    return (
                      <div
                        key={cell}
                        data-fit={fit}
                        onDragOver={(event) => { if (!blocked) { event.preventDefault(); if (hover !== cell) setHover(cell) } }}
                        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setHover((current) => (current === cell ? null : current)) }}
                        onDrop={() => {
                          const job = dragged
                          setHover(null); setDragged(null)
                          if (!job || blocked || here) return
                          if (fit === "over") onOverCapacity(job, target, label, projected - capacity, lane.capacity_unit || unit)
                          else onSchedule(job, target)
                        }}
                        className={cn(
                          "relative flex min-h-[104px] flex-col gap-1.5 border-b border-r border-border p-1.5 transition-colors duration-150",
                          blocked ? "bg-muted/60" : past ? "bg-[hsl(var(--surface-sunken))]" : "bg-card",
                          dragged && !blocked && "bg-primary/[.025]",
                          hover === cell && fit === "ok" && "bg-signal-emerald-soft/60 ring-2 ring-inset ring-signal-emerald-ink/40",
                          hover === cell && fit === "tight" && "bg-signal-amber-soft/60 ring-2 ring-inset ring-signal-amber-ink/40",
                          hover === cell && fit === "over" && "bg-signal-rose-soft/60 ring-2 ring-inset ring-signal-rose-ink/40",
                        )}
                      >
                        <div className="flex items-center gap-1.5" title={capacity ? `${fmt(current, 1)} of ${fmt(capacity)} ${lane.capacity_unit || unit}` : "No capacity set"}>
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <span className={cn("block h-full rounded-full transition-[width] duration-500", ratio >= 100 ? "bg-signal-rose-ink" : ratio >= 85 ? "bg-signal-amber-ink" : "bg-primary/70")} style={{ width: `${ratio}%` }} />
                          </span>
                          <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">{capacity ? `${Math.round((current / capacity) * 100)}%` : fmt(current, 0)}</span>
                        </div>
                        {(lane.jobs || []).map((job: any) => <PlanCard key={job.segment_id} job={job} compact dragging={dragged?.segment_id === job.segment_id} onUnschedule={unschedule} {...cardProps} />)}
                        {hover === cell && dragged && !here ? (
                          <span className={cn("pointer-events-none mt-auto rounded-md px-2 py-1 text-center text-[11px] font-semibold text-background shadow animate-scale-in", fit === "over" ? "bg-signal-rose-ink" : fit === "tight" ? "bg-signal-amber-ink" : fit === "blocked" ? "bg-muted-foreground" : "bg-signal-emerald-ink")}>
                            {fit === "blocked" ? "Machine unavailable" : fit === "over" ? `Over by ${fmt(projected - capacity, 0)} ${lane.capacity_unit || unit} — splits into next shift` : capacity ? `Fits · ${Math.round(projectedPct)}% after drop` : "Drop to place"}
                          </span>
                        ) : !(lane.jobs || []).length && !dragged ? <span className="mt-auto text-center text-[10.5px] text-muted-foreground/60">free</span> : null}
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
