"use client"

import { useEffect, useMemo, useState } from "react"
import { CalendarRange, LayoutGrid, Rows3, Search, X } from "lucide-react"
import dayjs from "dayjs"

import { cn } from "@/lib/utils"

import { MAX_RANGE_DAYS, PERIODS, SHIFTS, STAGE_LABEL, STAGE_ORDER, addDays, fmtDay, shiftLabel, type OverviewState, type Stage } from "./lib"
import type { OverviewMachine } from "./types"

export function FiltersBar({
  state,
  onChange,
  machines,
  range,
  today,
  stageCounts,
}: {
  state: OverviewState
  onChange: (patch: Partial<OverviewState>) => void
  machines: OverviewMachine[]
  range: [string, string]
  today: string
  stageCounts: Record<string, number>
}) {
  const [search, setSearch] = useState(state.q)
  useEffect(() => setSearch(state.q), [state.q])
  useEffect(() => {
    if (search === state.q) return
    const timer = setTimeout(() => onChange({ q: search }), 250)
    return () => clearTimeout(timer)
  }, [search, state.q, onChange])

  const dayCount = dayjs(range[1]).diff(range[0], "day") + 1
  const stagesActive = state.stages.length ? state.stages : STAGE_ORDER
  const machineOptions = useMemo(
    () =>
      STAGE_ORDER.filter((stage) => stagesActive.includes(stage)).map((stage) => ({
        stage,
        rows: machines.filter((m) => m.stage === stage).sort((a, b) => String(a.name || a.code).localeCompare(String(b.name || b.code))),
      })),
    [machines, stagesActive],
  )
  const hasFilters = Boolean(state.machine || state.shift || state.q || (state.stages.length && state.stages.length < STAGE_ORDER.length))

  const toggleStage = (stage: Stage) => {
    const current = state.stages.length ? state.stages : STAGE_ORDER
    const next = current.includes(stage) ? current.filter((s) => s !== stage) : [...current, stage]
    const ordered = STAGE_ORDER.filter((s) => next.includes(s))
    const machineStillValid = !state.machine || machines.some((m) => String(m.id) === state.machine && ordered.includes(m.stage))
    onChange({ stages: ordered.length === STAGE_ORDER.length ? [] : ordered.length ? ordered : [stage], machine: machineStillValid ? state.machine : "" })
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card px-4 py-3 shadow-premium" data-testid="overview-filters">
      <div className="flex flex-wrap items-center gap-3">
        <div className="tube-segment" role="group" aria-label="Period">
          {PERIODS.map((period) => (
            <button key={period.key} type="button" title={period.hint} aria-pressed={state.period === period.key} onClick={() => onChange({ period: period.key })}>
              {period.label}
            </button>
          ))}
          <button type="button" aria-pressed={state.period === "custom"} onClick={() => onChange({ period: "custom", from: state.from || range[0], to: state.to || range[1] })}>
            Custom
          </button>
        </div>
        {state.period === "custom" ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
              From
              <input type="date" value={range[0]} onChange={(event) => onChange({ period: "custom", from: event.target.value, to: dayjs(range[1]).isBefore(event.target.value) ? event.target.value : range[1] })} className="h-9 rounded-lg border border-input bg-card px-2 text-[13px] text-foreground" />
            </label>
            <label className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
              To
              <input type="date" value={range[1]} min={range[0]} max={addDays(range[0], MAX_RANGE_DAYS - 1)} onChange={(event) => onChange({ period: "custom", from: range[0], to: event.target.value })} className="h-9 rounded-lg border border-input bg-card px-2 text-[13px] text-foreground" />
            </label>
          </div>
        ) : null}
        <p className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground" data-testid="overview-range">
          <CalendarRange className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="font-semibold text-foreground">{fmtDay(range[0])}{range[0] !== range[1] ? ` – ${fmtDay(range[1])}` : ""}</span>
          <span>· {dayCount} day{dayCount === 1 ? "" : "s"}{range[0] <= today && today <= range[1] ? " · includes today" : ""}</span>
          {dayCount >= MAX_RANGE_DAYS ? <span className="text-signal-amber-ink">· capped at {MAX_RANGE_DAYS} days</span> : null}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Stages">
          <button
            type="button"
            aria-pressed={!state.stages.length}
            onClick={() => onChange({ stages: [] })}
            className={cn("inline-flex h-8 items-center rounded-lg border px-2.5 text-[12.5px] font-semibold transition-colors", !state.stages.length ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground")}
          >
            All stages
          </button>
          {STAGE_ORDER.map((stage) => {
            const active = stagesActive.includes(stage)
            return (
              <button
                key={stage}
                type="button"
                aria-pressed={active}
                onClick={() => toggleStage(stage)}
                className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-semibold transition-colors", active ? "border-primary/40 bg-accent text-accent-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground")}
              >
                {STAGE_LABEL[stage]}
                <span className={cn("rounded-full px-1.5 text-[10.5px] tabular-nums", active ? "bg-card/70 text-foreground" : "bg-muted")}>{stageCounts[stage] || 0}</span>
              </button>
            )
          })}
        </div>

        <label className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
          <span className="sr-only">Machine</span>
          <select value={state.machine} onChange={(event) => onChange({ machine: event.target.value })} className="h-8 max-w-[220px] rounded-lg border border-input bg-card px-2 text-[12.5px] text-foreground" aria-label="Machine">
            <option value="">All machines</option>
            {machineOptions.map((group) => (
              <optgroup key={group.stage} label={STAGE_LABEL[group.stage]}>
                {group.rows.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.code}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <div className="tube-segment" role="group" aria-label="Shift">
          <button type="button" aria-pressed={!state.shift} onClick={() => onChange({ shift: "" })}>Both shifts</button>
          {SHIFTS.map((shift) => (
            <button key={shift} type="button" aria-pressed={state.shift === shift} onClick={() => onChange({ shift })}>{shiftLabel(shift)}</button>
          ))}
        </div>

        <label className="relative flex min-w-[200px] flex-1 items-center sm:max-w-[320px]">
          <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Card no, customer, code, order or PO"
            aria-label="Search slots"
            className="h-8 w-full rounded-lg border border-input bg-card pl-8 pr-2 text-[12.5px] text-foreground placeholder:text-muted-foreground"
          />
        </label>

        <div className="ml-auto flex items-center gap-2">
          {hasFilters ? (
            <button type="button" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground" onClick={() => onChange({ stages: [], machine: "", shift: "", q: "" })}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Clear filters
            </button>
          ) : null}
          <div className="tube-segment" role="group" aria-label="View">
            <button type="button" aria-pressed={state.view === "timeline"} onClick={() => onChange({ view: "timeline" })}>
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
              Timeline
            </button>
            <button type="button" aria-pressed={state.view === "table"} onClick={() => onChange({ view: "table" })}>
              <Rows3 className="h-3.5 w-3.5" aria-hidden="true" />
              Table
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
