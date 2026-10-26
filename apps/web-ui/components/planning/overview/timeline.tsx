"use client"

import { Fragment, memo, useState } from "react"
import { AlertTriangle, ChevronDown, ChevronRight, Lock, Undo2, Zap } from "lucide-react"

import { cn } from "@/lib/utils"

import { TONE, fmtDay, fmtDow, fmtNum, fmtQty, isSilentSlot, requeueCountdown, resultMeta, shiftLabel, unitLabel, type TimelineColumn, type TimelineModel } from "./lib"
import { LoadBar, ProgressBar } from "./ui"
import type { OverviewShift, OverviewSlot } from "./types"

const COLUMN_WIDTH = 172

export function SlotTile({ slot, now, onOpen, selectMode, selected, onToggle, dimmed, compact }: { slot: OverviewSlot; now: Date; onOpen: (slot: OverviewSlot) => void; selectMode?: boolean; selected?: boolean; onToggle?: (slot: OverviewSlot) => void; dimmed?: boolean; compact?: boolean }) {
  const meta = resultMeta(slot.result)
  const silent = isSilentSlot(slot) ? requeueCountdown(slot, now) : null
  const planned = Number(slot.planned_qty || 0)
  const made = Number(slot.made_in_slot || 0)
  return (
    <button
      type="button"
      data-testid="slot-tile"
      data-slot-id={slot.id}
      data-result={slot.result}
      aria-pressed={selectMode ? Boolean(selected) : undefined}
      onClick={() => (selectMode && onToggle ? onToggle(slot) : onOpen(slot))}
      title={`${slot.job_card_no} · ${slot.customer_name || ""} · ${meta.label}`}
      className={cn(
        "group block w-full rounded-md border border-l-[3px] px-1.5 py-1 text-left text-[11px] leading-tight transition-[box-shadow,opacity,transform] duration-150 hover:shadow-premium-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        TONE[meta.tone].soft,
        TONE[meta.tone].line,
        selected ? "ring-2 ring-primary ring-offset-1 ring-offset-card" : "",
        dimmed ? "opacity-35" : "",
      )}
    >
      <div className="flex items-center gap-1">
        {selectMode ? <input type="checkbox" readOnly tabIndex={-1} checked={Boolean(selected)} className="h-3.5 w-3.5 rounded border-input" aria-hidden="true" /> : null}
        <span className="truncate text-[12px] font-semibold tabular-nums text-foreground">{slot.job_card_no}</span>
        {slot.is_emergency ? (
          <span className="inline-flex items-center text-signal-rose-ink" title="Emergency card">
            <Zap className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">Emergency</span>
          </span>
        ) : null}
        {slot.parts > 1 ? <span className="ml-auto shrink-0 rounded border border-border bg-card/80 px-1 text-[10px] font-semibold text-foreground">part {slot.part_no}/{slot.parts}</span> : null}
      </div>
      <div className="mt-0.5 truncate text-muted-foreground">
        {slot.customer_code || slot.customer_name || "—"} · {fmtNum(planned, 1)} {unitLabel(slot.unit)}
        {!compact && slot.product_size_label ? <span className="hidden 2xl:inline"> · {slot.product_size_label}</span> : null}
      </div>
      <ProgressBar value={made} max={planned} tone={meta.tone} className="mt-1" height="h-1" />
      <div className="mt-0.5 flex items-center justify-between gap-1">
        <span className={cn("inline-flex min-w-0 items-center gap-1 font-semibold", TONE[meta.tone].ink)}>
          <meta.Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{meta.short}</span>
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {fmtNum(made, 1)}/{fmtNum(planned, 1)}
        </span>
      </div>
      {silent ? (
        <div className="mt-0.5 inline-flex items-center gap-1 font-semibold text-signal-rose-ink">
          <Undo2 className="h-3 w-3" aria-hidden="true" />
          Back to queue {silent.text}
        </div>
      ) : null}
      {slot.order_conflict ? (
        <div className="mt-0.5 inline-flex items-center gap-1 font-semibold text-signal-amber-ink">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          Order clash
        </div>
      ) : null}
    </button>
  )
}

function ColumnHeader({ column, shifts }: { column: TimelineColumn; shifts: OverviewShift[] }) {
  const shift = shifts.find((s) => s.code === column.shift)
  return (
    <th
      scope="col"
      style={{ minWidth: COLUMN_WIDTH, width: COLUMN_WIDTH }}
      className={cn(
        "sticky top-9 z-20 border-b border-l border-border bg-[hsl(var(--surface-2))] px-2 py-1 text-left text-[11px] font-semibold text-muted-foreground",
        column.isNow ? "text-primary" : "",
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        {shiftLabel(column.shift)}
        <span className="font-normal tabular-nums">{shift ? `${shift.start}–${shift.end}` : ""}</span>
        {column.isNow ? <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">now</span> : null}
      </span>
    </th>
  )
}

export const Timeline = memo(function Timeline({
  model,
  shifts,
  now,
  onOpenSlot,
  selectMode,
  selected,
  onToggleSelect,
  isDimmed,
}: {
  model: TimelineModel
  shifts: OverviewShift[]
  now: Date
  onOpenSlot: (slot: OverviewSlot) => void
  selectMode: boolean
  selected: Set<string>
  onToggleSelect: (slot: OverviewSlot) => void
  isDimmed?: (slot: OverviewSlot) => boolean
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const shiftsPerDay = model.columns.length && model.days.length ? model.columns.length / model.days.length : 2
  const totalColumns = model.columns.length + 1

  if (!model.groups.length) {
    return <p className="p-6 text-center text-sm text-muted-foreground">No machines for the chosen stages.</p>
  }

  return (
    <div className="relative max-h-[72vh] overflow-auto overscroll-contain rounded-lg border border-border" data-testid="overview-timeline">
      <table className="min-w-max border-separate border-spacing-0 text-[12px]">
        <thead>
          <tr className="h-9">
            <th scope="col" rowSpan={2} className="sticky left-0 top-0 z-30 w-[188px] min-w-[188px] border-b border-r border-border bg-[hsl(var(--surface-2))] px-3 text-left text-[11.5px] font-semibold text-muted-foreground">
              Machine
            </th>
            {model.days.map((day) => (
              <th
                key={day.date}
                scope="colgroup"
                colSpan={shiftsPerDay}
                className={cn("sticky top-0 z-20 h-9 border-b border-l border-border bg-[hsl(var(--surface-2))] px-2 text-left text-[12px] font-semibold", day.isToday ? "text-primary" : "text-foreground")}
              >
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-normal text-muted-foreground">{fmtDow(day.date)}</span>
                  {fmtDay(day.date)}
                  {day.isToday ? <span className="rounded-full border border-primary/40 bg-accent px-1.5 text-[10px] font-bold uppercase tracking-wide text-accent-foreground">today</span> : null}
                  {day.closed ? (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                      closed
                    </span>
                  ) : null}
                </span>
              </th>
            ))}
          </tr>
          <tr className="h-7">
            {model.columns.map((column) => (
              <ColumnHeader key={column.key} column={column} shifts={shifts} />
            ))}
          </tr>
        </thead>
        <tbody>
          {model.groups.map((group) => {
            const isCollapsed = Boolean(collapsed[group.stage])
            return (
              <Fragment key={group.stage}>
                <tr>
                  <th
                    scope="row"
                    colSpan={1}
                    className="sticky left-0 z-10 border-b border-r border-border bg-card px-2 py-1 text-left"
                  >
                    <button
                      type="button"
                      onClick={() => setCollapsed((prev) => ({ ...prev, [group.stage]: !isCollapsed }))}
                      aria-expanded={!isCollapsed}
                      className="inline-flex h-7 w-full items-center gap-1.5 rounded-md px-1 text-[12px] font-bold uppercase tracking-wide text-foreground hover:bg-muted"
                    >
                      {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
                      {group.label}
                      <span className="ml-auto rounded-full bg-muted px-1.5 text-[10.5px] font-semibold normal-case tracking-normal text-muted-foreground">
                        {group.rows.length} machine{group.rows.length === 1 ? "" : "s"} · {group.slotCount} slot{group.slotCount === 1 ? "" : "s"}
                      </span>
                    </button>
                  </th>
                  <td colSpan={totalColumns - 1} className="border-b border-border bg-[hsl(var(--surface-sunken))] px-3 py-1 text-[11px] text-muted-foreground">
                    {isCollapsed ? `${group.slotCount} slot${group.slotCount === 1 ? "" : "s"} hidden` : group.rows.length ? "" : "No machine set up for this stage"}
                  </td>
                </tr>
                {!isCollapsed
                  ? group.rows.map((row) => (
                      <tr key={row.machine.id} data-testid="timeline-row">
                        <th scope="row" className="sticky left-0 z-10 w-[188px] min-w-[188px] border-b border-r border-border bg-card px-3 py-1.5 text-left align-top">
                          <p className="truncate text-[12.5px] font-semibold text-foreground" title={row.machine.name}>
                            {row.machine.name || row.machine.code}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {row.machine.capacity_per_shift ? `${fmtQty(row.machine.capacity_per_shift, row.machine.capacity_unit)} / shift` : "capacity not set"}
                            {row.slotCount ? ` · ${row.slotCount} slot${row.slotCount === 1 ? "" : "s"}` : ""}
                          </p>
                        </th>
                        {model.columns.map((column) => {
                          const cell = row.cells.get(column.key)
                          const load = cell?.load
                          const loadLabel = load ? `${fmtNum(load.load, 1)} of ${fmtNum(load.capacity, 0)} ${unitLabel(load.unit)} planned` : undefined
                          return (
                            <td
                              key={column.key}
                              style={{ minWidth: COLUMN_WIDTH, width: COLUMN_WIDTH }}
                              className={cn(
                                "border-b border-l border-border p-1.5 align-top",
                                column.isToday ? "bg-primary/[.035]" : "",
                                column.isNow ? "shadow-[inset_0_2px_0_hsl(var(--primary))]" : "",
                              )}
                              {...(column.closed
                                ? { style: { minWidth: COLUMN_WIDTH, width: COLUMN_WIDTH, backgroundImage: "repeating-linear-gradient(135deg, hsl(var(--foreground) / .05) 0 5px, transparent 5px 12px)" } }
                                : {})}
                            >
                              {cell?.slots.length || load ? <LoadBar pct={load?.pct} label={loadLabel} className="mb-1" /> : null}
                              <div className="space-y-1">
                                {cell?.slots.map((slot) => (
                                  <SlotTile key={slot.id} slot={slot} now={now} onOpen={onOpenSlot} selectMode={selectMode} selected={selected.has(slot.id)} onToggle={onToggleSelect} dimmed={isDimmed ? isDimmed(slot) : false} compact />
                                ))}
                              </div>
                              {!cell?.slots.length && !load && !column.closed ? <span className="sr-only">Free</span> : null}
                            </td>
                          )
                        })}
                      </tr>
                    ))
                  : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
})
