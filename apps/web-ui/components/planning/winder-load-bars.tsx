"use client"

import { useWinderLoad } from "@/hooks/use-lifecycle"
import { cn } from "@/lib/utils"

const fmt = (value: number) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })

/**
 * Open winder load in pcs, one bar per winder: running · scheduled · waiting in queue.
 * Sits above the planner queue; clicking a bar filters the queue to that winder
 * (the release winder is a queue hint — planning may still use any winder).
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
  const rows = (query.data?.machines || []).filter((row) => row.open_pcs > 0)
  const max = Math.max(1, ...rows.map((row) => row.open_pcs))
  const total = rows.reduce((sum, row) => sum + row.open_pcs, 0)
  return (
    <section className={cn("rounded-xl border border-border bg-card p-3", className)} aria-label="Open load per winder" data-testid="winder-load-bars">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-semibold">Load per winder</p>
        <span className="text-[11.5px] tabular-nums text-muted-foreground">{fmt(total)} pcs open</span>
      </div>
      {query.isLoading ? (
        <div className="mt-2 space-y-1.5">{[0, 1, 2].map((n) => <div key={n} className="skeleton h-5 rounded" />)}</div>
      ) : rows.length ? (
        <ul className="mt-2 space-y-1">
          {rows.map((row) => {
            const active = selected === row.machine_id
            const label = row.machine_id === "unassigned" ? "No winder" : machineLabel(row.machine_id)
            return (
              <li key={row.machine_id}>
                <button
                  type="button"
                  onClick={() => onSelect?.(active ? null : row.machine_id)}
                  aria-pressed={active}
                  title={`${label}: ${fmt(row.running_pcs)} running · ${fmt(row.scheduled_pcs)} scheduled · ${fmt(row.queued_pcs)} in queue · ${row.cards} cards`}
                  className={cn("grid w-full grid-cols-[64px_minmax(0,1fr)_64px] items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors", active ? "bg-primary/10 ring-1 ring-inset ring-primary/30" : "hover:bg-muted/60")}
                >
                  <span className="truncate text-[12px] font-semibold">{label}</span>
                  <span className="flex h-3 overflow-hidden rounded-full bg-muted">
                    <span className="h-full origin-left animate-[bar-grow_700ms_var(--ease-workspace)_both] bg-signal-amber-ink/80" style={{ width: `${(row.running_pcs / max) * 100}%` }} />
                    <span className="h-full origin-left animate-[bar-grow_700ms_var(--ease-workspace)_both] bg-[hsl(var(--chart-3))]" style={{ width: `${(row.scheduled_pcs / max) * 100}%` }} />
                    <span className="h-full origin-left animate-[bar-grow_700ms_var(--ease-workspace)_both] bg-[hsl(var(--chart-2))]" style={{ width: `${(row.queued_pcs / max) * 100}%` }} />
                  </span>
                  <span className="text-right text-[12px] font-semibold tabular-nums">{fmt(row.open_pcs)}</span>
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
        {onSelect ? <span className="ml-auto">Click a bar to filter the queue</span> : null}
      </div>
    </section>
  )
}
