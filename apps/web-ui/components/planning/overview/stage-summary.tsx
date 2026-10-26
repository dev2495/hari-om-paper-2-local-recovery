"use client"

import { useMemo } from "react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { cn } from "@/lib/utils"

import { RESULT_META, STAGE_LABEL, STAGE_ORDER, TONE, fmtNum, fmtPct, unitLabel, type OverviewState } from "./lib"
import type { OverviewLoad, OverviewSlot, SlotResult, Stage } from "./types"

const CHART_RESULTS: SlotResult[] = ["DONE", "PARTLY", "MOVED", "NOT_RUN", "IN_PROGRESS", "UPCOMING", "FLOOR_PLACED", "NOT_NEEDED"]

type StageStat = {
  stage: Stage
  slots: number
  cards: number
  plannedQty: number
  plannedPcs: number
  made: number
  unit: string
  counts: Record<SlotResult, number>
  adherence: number | null
  avgLoad: number | null
  machines: number
}

export function stageStats(slots: OverviewSlot[], loads: OverviewLoad[], state: Pick<OverviewState, "stages" | "machine" | "shift">): StageStat[] {
  const stages = state.stages.length ? state.stages : STAGE_ORDER
  return STAGE_ORDER.filter((stage) => stages.includes(stage)).map((stage) => {
    const rows = slots.filter((slot) => slot.stage === stage)
    const counts = Object.fromEntries(CHART_RESULTS.map((key) => [key, 0])) as Record<SlotResult, number>
    const cards = new Set<string>()
    const machines = new Set<string>()
    let plannedQty = 0
    let plannedPcs = 0
    let made = 0
    let unit = ""
    for (const slot of rows) {
      counts[slot.result] = (counts[slot.result] || 0) + 1
      cards.add(slot.job_card_id)
      machines.add(String(slot.machine_id))
      plannedQty += Number(slot.planned_qty || 0)
      plannedPcs += Number(slot.planned_pcs || 0)
      made += Number(slot.made_in_slot || 0)
      if (!unit && slot.unit) unit = slot.unit
    }
    const finished = counts.DONE + counts.PARTLY + counts.MOVED + counts.NOT_RUN
    const stageLoads = loads.filter((row) => row.stage === stage && row.pct != null && (!state.machine || String(row.machine_id) === state.machine) && (!state.shift || row.shift_code === state.shift))
    const avgLoad = stageLoads.length ? stageLoads.reduce((sum, row) => sum + Number(row.pct), 0) / stageLoads.length : null
    return { stage, slots: rows.length, cards: cards.size, plannedQty, plannedPcs, made, unit, counts, adherence: finished ? (counts.DONE / finished) * 100 : null, avgLoad, machines: machines.size }
  })
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number; name: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  const rows = payload.filter((row) => Number(row.value) > 0)
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-[12px] shadow-pop">
      <p className="font-semibold text-foreground">{label}</p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((row) => (
          <li key={row.dataKey} className="flex items-center justify-between gap-4 text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("inline-block h-2 w-2 rounded-sm", TONE[RESULT_META[row.dataKey as SlotResult]?.tone || "neutral"].bar)} aria-hidden="true" />
              {row.name}
            </span>
            <span className="tabular-nums font-semibold text-foreground">{fmtNum(row.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function StageSummary({ slots, loads, state }: { slots: OverviewSlot[]; loads: OverviewLoad[]; state: Pick<OverviewState, "stages" | "machine" | "shift"> }) {
  const stats = useMemo(() => stageStats(slots, loads, state), [slots, loads, state])
  const chart = stats.map((row) => ({ stage: STAGE_LABEL[row.stage], ...row.counts }))
  const anySlots = stats.some((row) => row.slots)
  if (!stats.length) return <p className="text-sm text-muted-foreground">No stage selected.</p>
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        {anySlots ? (
          <div className="h-[200px]" aria-label="Slots by stage and result">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} layout="vertical" margin={{ left: 0, right: 16, top: 4, bottom: 0 }} barCategoryGap={8}>
                <CartesianGrid horizontal={false} stroke="hsl(var(--chart-grid))" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="stage" width={62} tick={{ fontSize: 12 }} />
                <Tooltip cursor={{ fill: "hsl(var(--foreground) / .04)" }} content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11.5 }} iconSize={10} />
                {CHART_RESULTS.map((key, index, all) => (
                  <Bar key={key} dataKey={key} name={RESULT_META[key].short} stackId="slots" fill={TONE[RESULT_META[key].tone].chart} stroke="hsl(var(--card))" strokeWidth={2} radius={index === all.length - 1 ? [0, 4, 4, 0] : 0} maxBarSize={22} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No planned slots for these stages in this period.</p>
        )}
      </div>
      <div className="-mx-4 -mb-4 overflow-x-auto xl:mx-0 xl:mb-0">
        <table className="tube-grid w-full">
          <thead>
            <tr>
              <th>Stage</th>
              <th className="num">Slots</th>
              <th className="num">Planned</th>
              <th className="num">Made in slot</th>
              <th className="num">Done in slot</th>
              <th className="num">Load</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((row) => (
              <tr key={row.stage}>
                <td>
                  <span className="font-semibold">{STAGE_LABEL[row.stage]}</span>
                  <span className="block text-[11px] text-muted-foreground">{row.cards} card{row.cards === 1 ? "" : "s"} · {row.machines} machine{row.machines === 1 ? "" : "s"}</span>
                </td>
                <td className="num">{fmtNum(row.slots)}</td>
                <td className="num">
                  {fmtNum(row.plannedQty, 1)} <span className="text-[11px] text-muted-foreground">{unitLabel(row.unit) || "pcs"}</span>
                  <span className="block text-[11px] text-muted-foreground">{fmtNum(row.plannedPcs)} pcs</span>
                </td>
                <td className="num">
                  {fmtNum(row.made, 1)} <span className="text-[11px] text-muted-foreground">{unitLabel(row.unit)}</span>
                </td>
                <td className={cn("num font-semibold", row.adherence == null ? "text-muted-foreground" : row.adherence >= 85 ? "text-signal-emerald-ink" : row.adherence >= 60 ? "text-signal-amber-ink" : "text-signal-rose-ink")}>{fmtPct(row.adherence)}</td>
                <td className={cn("num", row.avgLoad != null && row.avgLoad > 100 ? "font-semibold text-signal-rose-ink" : "")}>{fmtPct(row.avgLoad)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
