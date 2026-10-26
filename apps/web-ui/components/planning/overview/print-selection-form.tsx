"use client"

import { useMemo } from "react"
import dayjs from "dayjs"

import { cn } from "@/lib/utils"

import { MAX_RANGE_DAYS, SHIFTS, STAGE_LABEL, STAGE_ORDER, addDays, isoDate, shiftLabel, type PrintSelection, type Stage } from "./lib"
import { Checkbox } from "./ui"
import type { OverviewMachine, ShiftCode } from "./types"

const QUICK_DAYS: { label: string; range: (today: string) => [string, string] }[] = [
  { label: "Today", range: (t) => [t, t] },
  { label: "Tomorrow", range: (t) => [addDays(t, 1), addDays(t, 1)] },
  { label: "Next 3 days", range: (t) => [t, addDays(t, 2)] },
  { label: "This week", range: (t) => { const start = dayjs(t).subtract((dayjs(t).day() + 6) % 7, "day"); return [isoDate(start), isoDate(start.add(6, "day"))] } },
  { label: "Next 7 days", range: (t) => [t, addDays(t, 6)] },
]

export function PrintSelectionForm({ value, onChange, machines, today, selectedSlotCount = 0, onlySelected, onOnlySelected, dense }: { value: PrintSelection; onChange: (next: PrintSelection) => void; machines: OverviewMachine[]; today: string; selectedSlotCount?: number; onlySelected?: boolean; onOnlySelected?: (on: boolean) => void; dense?: boolean }) {
  const stages = value.stages.length ? value.stages : STAGE_ORDER
  const allStages = stages.length === STAGE_ORDER.length
  const shifts = value.shifts.length ? value.shifts : SHIFTS
  const machinesByStage = useMemo(
    () => STAGE_ORDER.filter((stage) => stages.includes(stage)).map((stage) => ({ stage, rows: machines.filter((m) => m.stage === stage).sort((a, b) => String(a.name || a.code).localeCompare(String(b.name || b.code))) })).filter((group) => group.rows.length),
    [machines, stages],
  )
  const allMachines = value.machines.length === 0
  const dayCount = dayjs(value.to).diff(value.from, "day") + 1

  const setStages = (next: Stage[]) => {
    const ordered = STAGE_ORDER.filter((s) => next.includes(s))
    const keptMachines = value.machines.filter((id) => machines.some((m) => String(m.id) === id && ordered.includes(m.stage)))
    onChange({ ...value, stages: ordered.length === STAGE_ORDER.length ? [] : ordered, machines: keptMachines })
  }
  const toggleStage = (stage: Stage) => {
    const next = stages.includes(stage) ? stages.filter((s) => s !== stage) : [...stages, stage]
    if (next.length) setStages(next)
  }
  const toggleShift = (shift: ShiftCode) => {
    const next = shifts.includes(shift) ? shifts.filter((s) => s !== shift) : [...shifts, shift]
    if (next.length) onChange({ ...value, shifts: next.length === SHIFTS.length ? [] : next })
  }
  const toggleMachine = (id: string) => {
    const current = allMachines ? machines.filter((m) => stages.includes(m.stage)).map((m) => String(m.id)) : value.machines
    const next = current.includes(id) ? current.filter((m) => m !== id) : [...current, id]
    const everyMachine = machines.filter((m) => stages.includes(m.stage)).every((m) => next.includes(String(m.id)))
    onChange({ ...value, machines: everyMachine ? [] : next })
  }
  const isMachineOn = (id: string) => allMachines || value.machines.includes(id)

  return (
    <div className={cn("grid gap-4", dense ? "md:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]")} data-testid="print-selection">
      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">Stages</legend>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <Checkbox checked={allStages} onChange={(on) => (on ? setStages(STAGE_ORDER) : null)} label={<strong>All stages</strong>} />
          {STAGE_ORDER.map((stage) => (
            <Checkbox key={stage} checked={stages.includes(stage)} onChange={() => toggleStage(stage)} label={STAGE_LABEL[stage]} />
          ))}
        </div>
      </fieldset>

      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">Days</legend>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
            From
            <input type="date" value={value.from} onChange={(event) => onChange({ ...value, from: event.target.value, to: dayjs(value.to).isBefore(event.target.value) ? event.target.value : value.to })} className="h-8 rounded-lg border border-input bg-card px-2 text-[12.5px] text-foreground" />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
            To
            <input type="date" value={value.to} min={value.from} max={addDays(value.from, MAX_RANGE_DAYS - 1)} onChange={(event) => onChange({ ...value, to: event.target.value })} className="h-8 rounded-lg border border-input bg-card px-2 text-[12.5px] text-foreground" />
          </label>
          <span className="text-[12px] text-muted-foreground">{Number.isFinite(dayCount) && dayCount > 0 ? `${dayCount} day${dayCount === 1 ? "" : "s"}` : ""}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {QUICK_DAYS.map((quick) => {
            const [from, to] = quick.range(today)
            const active = value.from === from && value.to === to
            return (
              <button key={quick.label} type="button" aria-pressed={active} onClick={() => onChange({ ...value, from, to })} className={cn("h-7 rounded-md border px-2 text-[11.5px] font-semibold", active ? "border-primary bg-accent text-accent-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
                {quick.label}
              </button>
            )
          })}
        </div>
      </fieldset>

      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">Shifts</legend>
        <div className="flex flex-wrap items-center gap-x-3">
          {SHIFTS.map((shift) => (
            <Checkbox key={shift} checked={shifts.includes(shift)} onChange={() => toggleShift(shift)} label={shiftLabel(shift)} />
          ))}
        </div>
        {selectedSlotCount > 0 && onOnlySelected ? (
          <div className="mt-2 rounded-lg border border-primary/40 bg-accent px-3 py-1.5">
            <Checkbox checked={Boolean(onlySelected)} onChange={onOnlySelected} label={<span className="text-accent-foreground">Only the <strong>{selectedSlotCount}</strong> selected slot{selectedSlotCount === 1 ? "" : "s"}</span>} />
          </div>
        ) : null}
      </fieldset>

      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">Machines</legend>
        <Checkbox checked={allMachines} onChange={(on) => (on ? onChange({ ...value, machines: [] }) : null)} label={<strong>All machines</strong>} />
        <div className={cn("mt-1 grid gap-x-4 gap-y-0.5", dense ? "" : "sm:grid-cols-2", "max-h-48 overflow-y-auto pr-1")}>
          {machinesByStage.map((group) => (
            <div key={group.stage} className="min-w-0">
              <p className="mt-1 text-[11px] font-semibold uppercase text-muted-foreground">{STAGE_LABEL[group.stage]}</p>
              {group.rows.map((m) => (
                <Checkbox key={m.id} checked={isMachineOn(String(m.id))} onChange={() => toggleMachine(String(m.id))} label={m.name || m.code} title={m.name || m.code} truncate className="!min-h-7 w-full" />
              ))}
            </div>
          ))}
          {!machinesByStage.length ? <p className="text-[12px] text-muted-foreground">No machines for these stages.</p> : null}
        </div>
      </fieldset>
    </div>
  )
}
