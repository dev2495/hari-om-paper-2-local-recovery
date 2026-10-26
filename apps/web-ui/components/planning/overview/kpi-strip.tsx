"use client"

import { useMemo } from "react"
import { Activity, CalendarDays, CheckCircle2, Gauge, Layers, ListTodo, Undo2, XCircle } from "lucide-react"

import { STAGE_LABEL, STAGE_ORDER, fmtNum, fmtPct, isSilentSlot, plural, requeueCountdown, type OverviewState } from "./lib"
import { Tile } from "./ui"
import type { OverviewSlot, PlanningOverview } from "./types"

export type KpiFocus = "IN_PROGRESS" | "NOT_RUN" | "SILENT" | "DONE" | null

export function KpiStrip({ data, slots, state, now, focus, onFocus }: { data: PlanningOverview; slots: OverviewSlot[]; state: OverviewState; now: Date; focus: KpiFocus; onFocus: (focus: KpiFocus) => void }) {
  const stats = useMemo(() => {
    const cards = new Set<string>()
    let pcs = 0
    let made = 0
    let done = 0
    let partly = 0
    let moved = 0
    let notRun = 0
    let running = 0
    let soonestHours: number | null = null
    let silent = 0
    for (const slot of slots) {
      cards.add(slot.job_card_id)
      pcs += Number(slot.planned_pcs || 0)
      made += Number(slot.made_in_slot || 0)
      if (slot.result === "DONE") done += 1
      else if (slot.result === "PARTLY") partly += 1
      else if (slot.result === "MOVED") moved += 1
      else if (slot.result === "NOT_RUN") notRun += 1
      else if (slot.result === "IN_PROGRESS") running += 1
      if (isSilentSlot(slot)) {
        const countdown = requeueCountdown(slot, now)
        if (countdown && countdown.hours > 0) {
          silent += 1
          soonestHours = soonestHours == null ? countdown.hours : Math.min(soonestHours, countdown.hours)
        }
      }
    }
    const finished = done + partly + moved + notRun
    // Same rule as the service: done ÷ (done + partly + moved + not run); partly does not count as done.
    const adherence = finished ? (done / finished) * 100 : null
    const stages = state.stages.length ? state.stages : STAGE_ORDER
    const queue = (data.queue || []).filter((row) => stages.includes(row.stage))
    const openCards = queue.reduce((sum, row) => sum + Number(row.open_cards || 0), 0)
    const waiting = queue.reduce((sum, row) => sum + Number(row.waiting_cards || 0), 0)
    const machineIds = new Set(slots.map((slot) => String(slot.machine_id)))
    // With a search on, load only counts the machines whose slots matched; otherwise every machine of the stages shown.
    const loads = (data.load || []).filter(
      (row) => stages.includes(row.stage) && (!state.machine || String(row.machine_id) === state.machine) && (!state.shift || row.shift_code === state.shift) && (!state.q || machineIds.has(String(row.machine_id))),
    )
    const withPct = loads.filter((row) => row.pct != null)
    const avgLoad = withPct.length ? withPct.reduce((sum, row) => sum + Number(row.pct), 0) / withPct.length : null
    const overloaded = withPct.filter((row) => Number(row.pct) > 100).length
    const busiest = withPct.slice().sort((a, b) => Number(b.pct) - Number(a.pct))[0]
    const busiestName = busiest ? data.machines.find((m) => String(m.id) === String(busiest.machine_id))?.name : null
    return { cards: cards.size, pcs, made, done, partly, moved, notRun, running, silent, soonestHours, adherence, finished, openCards, waiting, queue, avgLoad, overloaded, busiest, busiestName }
  }, [slots, data, state, now])

  const days = (data.days || []).length
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8" data-testid="overview-kpis">
      <Tile label="Planned slots" value={fmtNum(slots.length)} hint={`${plural(stats.cards, "card")} · ${plural(days, "day")}`} Icon={CalendarDays} tone="blue" />
      <Tile label="Pieces planned" value={fmtNum(stats.pcs)} hint={`${fmtNum(stats.made)} made in slot so far`} Icon={Layers} tone="blue" />
      <Tile
        label="Done in slot"
        value={fmtPct(stats.adherence)}
        hint={stats.finished ? `${stats.done} done · ${stats.partly} partly · ${stats.moved} moved · ${stats.notRun} not run` : "No slot has finished yet"}
        Icon={CheckCircle2}
        tone={stats.adherence == null ? "neutral" : stats.adherence >= 85 ? "emerald" : stats.adherence >= 60 ? "amber" : "rose"}
        onClick={() => onFocus(focus === "DONE" ? null : "DONE")}
        active={focus === "DONE"}
        testId="kpi-done"
      />
      <Tile label="Running now" value={fmtNum(stats.running)} hint={stats.running ? "slots with a run logged this shift" : "no run logged in the current shift"} Icon={Activity} tone={stats.running ? "violet" : "neutral"} onClick={() => onFocus(focus === "IN_PROGRESS" ? null : "IN_PROGRESS")} active={focus === "IN_PROGRESS"} testId="kpi-running" />
      <Tile label="Not run" value={fmtNum(stats.notRun)} hint={stats.moved ? `${plural(stats.moved, "slot")} ran on another day or shift` : "slots that passed with nothing logged"} Icon={XCircle} tone={stats.notRun ? "rose" : "neutral"} onClick={() => onFocus(focus === "NOT_RUN" ? null : "NOT_RUN")} active={focus === "NOT_RUN"} testId="kpi-not-run" />
      <Tile
        label="Going back to the queue"
        value={fmtNum(stats.silent)}
        hint={stats.silent && stats.soonestHours != null ? `soonest ${requeueCountdown({ requeue_at: null, hours_to_requeue: stats.soonestHours }, now)?.text} · ${data.missed_slot_hours} h after the shift` : `nothing waiting · slots return ${data.missed_slot_hours} h after a silent shift`}
        Icon={Undo2}
        tone={stats.silent ? "amber" : "neutral"}
        onClick={() => onFocus(focus === "SILENT" ? null : "SILENT")}
        active={focus === "SILENT"}
        testId="kpi-silent"
      />
      <Tile
        label="Waiting to be planned"
        value={fmtNum(stats.openCards)}
        hint={
          stats.queue.length
            ? `${stats.queue.filter((row) => row.open_cards).map((row) => `${STAGE_LABEL[row.stage]} ${row.open_cards}`).join(" · ") || "no open cards"}${stats.waiting ? ` · ${stats.waiting} waiting for the previous stage` : ""}`
            : "no queue for these stages"
        }
        Icon={ListTodo}
        tone={stats.openCards ? "amber" : "neutral"}
      />
      <Tile
        label="Machine load"
        value={fmtPct(stats.avgLoad)}
        hint={stats.overloaded ? `${plural(stats.overloaded, "shift")} over 100%` : stats.busiest ? `busiest ${stats.busiestName || "machine"} at ${Math.round(Number(stats.busiest.pct))}%` : "no planned load in this period"}
        Icon={Gauge}
        tone={stats.overloaded ? "rose" : stats.avgLoad != null && stats.avgLoad >= 85 ? "amber" : stats.avgLoad ? "emerald" : "neutral"}
      />
    </div>
  )
}
