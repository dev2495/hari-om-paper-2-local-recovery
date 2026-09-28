"use client"

import { useState } from "react"
import { X } from "lucide-react"

import { useWinderLoad, type WinderLoadRow } from "@/hooks/use-lifecycle"
import { cn } from "@/lib/utils"

const fmt = (value: number, digits = 0) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })
type Measure = "m" | "pcs"

/**
 * Open winder load, one bar per winder: running · on the calendar · waiting in queue.
 * Every row shows both winding metres (what capacity is set in) and pieces; the switch only
 * changes what the bar length is scaled by. Clicking a bar filters the queue to that winder
 * (the release winder is a hint — planning may still use any winder).
 */
export function WinderLoadBars({
  machineLabel,
  selected,
  onSelect,
  className,
}: {
  machineLabel: (id: string) => string
  selected?: string | null
  onSelect?: (machineId: string | null) => void
  className?: string
}) {
  const query = useWinderLoad(true)
  const [measure, setMeasure] = useState<Measure>("m")
  const rows: WinderLoadRow[] = (query.data?.machines || []).filter((row) => row.open_pcs > 0)
  const value = (row: WinderLoadRow, kind: "running" | "scheduled" | "queued" | "open") => Number(row[`${kind}_${measure}` as keyof WinderLoadRow] || 0)
  const max = Math.max(1, ...rows.map((row) => value(row, "open")))
  const totalM = rows.reduce((sum, row) => sum + Number(row.open_m || 0), 0)
  const totalPcs = rows.reduce((sum, row) => sum + Number(row.open_pcs || 0), 0)
  const selectedLabel = selected ? (selected === "unassigned" ? "No winder" : machineLabel(selected)) : null
  return (
    <section className={cn("rounded-xl border border-border bg-card p-3", className)} aria-label="Open load per winder" data-testid="winder-load-bars">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">Load per winder</p>
          <p className="text-[11.5px] tabular-nums text-muted-foreground">{fmt(totalM)} m · {fmt(totalPcs)} pcs open</p>
        </div>
        <div className="tube-segment !h-7 shrink-0 text-[11px]" role="group" aria-label="Scale bars by">
          <button type="button" aria-pressed={measure === "m"} onClick={() => setMeasure("m")}>m</button>
          <button type="button" aria-pressed={measure === "pcs"} onClick={() => setMeasure("pcs")}>pcs</button>
        </div>
      </div>
      {selectedLabel && onSelect ? (
        <button type="button" onClick={() => onSelect(null)} className="mt-2 inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11.5px] font-semibold text-primary animate-scale-in">
          Queue: {selectedLabel} <X className="h-3 w-3" />
        </button>
      ) : null}
      {query.isError ? (
        <p className="mt-2 text-[12px] text-signal-rose-ink">Winder load did not load.</p>
      ) : query.isLoading ? (
        <div className="mt-2 space-y-1.5">{[0, 1, 2].map((n) => <div key={n} className="skeleton h-7 rounded" />)}</div>
      ) : rows.length ? (
        <ul className="mt-2 space-y-1">
          {rows.map((row) => {
            const active = selected === row.machine_id
            const dimmed = Boolean(selected) && !active
            const label = row.machine_id === "unassigned" ? "No winder" : machineLabel(row.machine_id)
            const overloaded = row.days_of_work !== null && row.days_of_work > 3
            return (
              <li key={row.machine_id}>
                <button
                  type="button"
                  onClick={() => onSelect?.(active ? null : row.machine_id)}
                  aria-pressed={active}
                  title={`${label}: ${fmt(row.running_m)} m running · ${fmt(row.scheduled_m)} m scheduled · ${fmt(row.queued_m)} m in queue · ${row.cards} cards${row.capacity_m_per_day ? ` · capacity ${fmt(row.capacity_m_per_day)} m/day` : ""}`}
                  className={cn(
                    "w-full rounded-md px-1.5 py-1 text-left transition-all duration-200",
                    active ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : "hover:bg-muted/60",
                    dimmed && "opacity-45 hover:opacity-100",
                  )}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[12px] font-semibold">{label}</span>
                    <span className="shrink-0 text-[11.5px] tabular-nums">
                      <strong className={cn(measure === "m" ? "text-foreground" : "text-muted-foreground")}>{fmt(row.open_m)} m</strong>
                      <span className="text-muted-foreground"> · </span>
                      <strong className={cn(measure === "pcs" ? "text-foreground" : "text-muted-foreground")}>{fmt(row.open_pcs)} pcs</strong>
                    </span>
                  </span>
                  <span className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-muted">
                    <span className="h-full origin-left bg-signal-amber-ink/80 transition-[width] duration-500" style={{ width: `${(value(row, "running") / max) * 100}%` }} />
                    <span className="h-full origin-left bg-[hsl(var(--chart-3))] transition-[width] duration-500" style={{ width: `${(value(row, "scheduled") / max) * 100}%` }} />
                    <span className="h-full origin-left bg-[hsl(var(--chart-2))] transition-[width] duration-500" style={{ width: `${(value(row, "queued") / max) * 100}%` }} />
                  </span>
                  {row.days_of_work !== null ? (
                    <span className={cn("mt-0.5 block text-[10.5px] tabular-nums", overloaded ? "font-semibold text-signal-rose-ink" : "text-muted-foreground")}>
                      ≈ {fmt(row.days_of_work, 1)} day{row.days_of_work === 1 ? "" : "s"} of work at {fmt(row.capacity_m_per_day || 0)} m/day · {row.cards} card{row.cards === 1 ? "" : "s"}
                    </span>
                  ) : (
                    <span className="mt-0.5 block text-[10.5px] text-muted-foreground">{row.cards} card{row.cards === 1 ? "" : "s"}{row.machine_id !== "unassigned" ? " · no m/day capacity set" : ""}</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-2 text-[12px] text-muted-foreground">No open winder work.</p>
      )}
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-signal-amber-ink/80" />Running</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[hsl(var(--chart-3))]" />Scheduled</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[hsl(var(--chart-2))]" />In queue</span>
        {onSelect ? <span className="ml-auto">Click a winder to filter the queue</span> : null}
      </div>
    </section>
  )
}
