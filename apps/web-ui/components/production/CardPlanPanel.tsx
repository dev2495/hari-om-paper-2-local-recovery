"use client"

import Link from "next/link"
import { CalendarClock, CalendarRange } from "lucide-react"
import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"

import { useMachines } from "@/hooks/use-production"
import { describeApiError } from "@/lib/api-error"
import { productionApi } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * The card's plan, read-only (client 2026-10-26): planning is only the plan and the job card log is the
 * truth. Each planner slot (a split plan has several parts) with what the floor logged in it, runs that
 * happened on another day/shift, and stages still waiting for a slot.
 */
const STAGES = ["SLITTING", "WINDER", "OVEN", "PROCESS"]
const STAGE_LABEL: Record<string, string> = { SLITTING: "Slitting", WINDER: "Winding", OVEN: "Oven", PROCESS: "Process" }
const RESULT_TONE: Record<string, string> = {
  DONE: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
  IN_PROGRESS: "border-signal-blue-line bg-signal-blue-soft text-signal-blue-ink",
  PARTLY: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink",
  MOVED: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink",
  NOT_RUN: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink",
  FLOOR_PLACED: "border-signal-violet-line bg-signal-violet-soft text-signal-violet-ink",
}
const fmt = (value: any) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })
const day = (value?: string | null) => (value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—")
const shift = (value?: string | null) => (value ? value.replace("SHIFT_", "Shift ") : "—")

export function CardPlanPanel({ jobCardId, plantId, open = true }: { jobCardId: string; plantId?: string; open?: boolean }) {
  const machines = useMachines()
  const plan = useQuery({
    queryKey: ["job-card-plan", jobCardId],
    enabled: Boolean(jobCardId),
    queryFn: async () => (await productionApi.getJobCardPlan(jobCardId, plantId)).data,
  })
  const machineName = (id?: string | null) => {
    const rows: any[] = Array.isArray(machines.data) ? machines.data : machines.data?.items || []
    const row = rows.find((item: any) => String(item.id) === String(id))
    return row ? row.name || row.code : "machine"
  }
  const data: any = plan.data
  const stages = useMemo(() => {
    const slots: any[] = data?.slots || []
    const runs: any[] = data?.runs || []
    const waiting: any[] = data?.unplanned_stages || []
    return STAGES.map((stage) => ({
      stage,
      slots: slots.filter((slot) => slot.stage === stage),
      offPlan: runs.filter((run) => run.stage === stage && ["EARLY", "LATE", "OTHER_SHIFT"].includes(run.match)),
      waiting: waiting.find((row) => row.stage === stage),
    })).filter((row) => row.slots.length || row.offPlan.length || row.waiting)
  }, [data])

  const summary = data?.summary
  return (
    <details open={open} className="rounded-[1.1rem] border border-border bg-card p-4 shadow-sm" data-testid="card-plan-panel">
      <summary className="flex cursor-pointer items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[14px] font-semibold">
          <CalendarRange className="h-4 w-4 text-primary" aria-hidden="true" />
          Plan for this card
          <span className="font-normal text-muted-foreground">· planner slots against what the floor logged</span>
        </span>
        {summary?.slots ? (
          <span className="text-[12px] text-muted-foreground">
            {summary.slots} slot{summary.slots === 1 ? "" : "s"}
            {summary.adherence_pct != null ? ` · ${fmt(summary.adherence_pct)} % done in slot` : ""}
          </span>
        ) : null}
      </summary>

      <div className="mt-3 space-y-3 text-[13px]">
        {plan.isLoading ? <p role="status" className="text-muted-foreground">Loading the plan…</p> : null}
        {plan.isError ? <p role="alert" className="text-signal-rose-ink">The plan could not be loaded: {describeApiError(plan.error, "try again")}.</p> : null}
        {data && !stages.length ? (
          <p className="text-muted-foreground">Not on the planner yet. The floor can still log runs; they show as run before planning.</p>
        ) : null}
        {data?.missed_slot_open && data?.last_missed_slot ? (
          <p className="rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-signal-amber-ink">
            The {STAGE_LABEL[data.last_missed_slot.stage] || "stage"} slot on {day(data.last_missed_slot.plan_date)} · {shift(data.last_missed_slot.shift_code)} passed with nothing logged for 36 h, so the card went back to the planner queue.
          </p>
        ) : null}
        {stages.map((row) => (
          <div key={row.stage} className="grid gap-1.5 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
            <p className="font-semibold">{STAGE_LABEL[row.stage]}</p>
            <div className="space-y-1.5">
              {row.slots.map((slot: any) => {
                const pct = slot.planned_qty ? Math.min(100, (Number(slot.made_in_slot || 0) * 100) / Number(slot.planned_qty)) : 0
                return (
                  <div key={slot.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2" data-testid="card-plan-slot">
                    <span className="flex items-center gap-1.5 font-medium">
                      <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      {day(slot.plan_date)} · {shift(slot.shift_code)} · {machineName(slot.machine_id)}
                    </span>
                    {slot.parts > 1 ? <span className="text-[12px] text-muted-foreground">part {slot.part_no} of {slot.parts}</span> : null}
                    <span className="tabular-nums text-muted-foreground">
                      {fmt(slot.made_in_slot)} / {fmt(slot.planned_qty)} {slot.unit} in slot
                      {slot.made_elsewhere ? ` · ${fmt(slot.made_elsewhere)} on another day/shift` : ""}
                    </span>
                    <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </span>
                    <span className={cn("rounded-full border px-2 py-0.5 text-[11.5px] font-medium", RESULT_TONE[slot.result] || "border-border bg-muted text-muted-foreground")}>{slot.result_label}</span>
                    {slot.hours_to_requeue != null ? (
                      <span className="text-[12px] text-signal-amber-ink">goes back to the queue in {fmt(Math.max(0, slot.hours_to_requeue))} h if nothing is logged</span>
                    ) : null}
                  </div>
                )
              })}
              {row.offPlan.map((run: any) => (
                <p key={run.key} className="text-[12.5px] text-muted-foreground">
                  {run.run || "Run"} on {day(run.date)} · {shift(run.shift_code)}: {String(run.match_label || "").toLowerCase()}
                  {run.days_off ? ` by ${Math.abs(run.days_off)} day${Math.abs(run.days_off) === 1 ? "" : "s"}` : ""}
                </p>
              ))}
              {row.waiting ? (
                <p className="text-muted-foreground">
                  {row.waiting.waiting_for ? `Waiting for the ${STAGE_LABEL[row.waiting.waiting_for]?.toLowerCase() || "previous stage"} plan` : row.slots.length ? "Rest not planned yet" : "Not planned yet"}
                </p>
              ) : null}
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 pt-1">
          <Link href={`/planning/board?section=${String(data?.unplanned_stages?.[0]?.stage || "WINDER").toLowerCase()}&view=schedule&job_card_id=${jobCardId}`} className="erp-btn-secondary !h-8">Open in planner</Link>
          <Link href="/planning/overview" className="erp-btn-secondary !h-8">Planning overview</Link>
        </div>
      </div>
    </details>
  )
}
