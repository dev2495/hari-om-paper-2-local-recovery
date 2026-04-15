"use client"

import Link from "next/link"
import dayjs from "dayjs"
import { CalendarClock, Factory, Layers3, TimerReset } from "lucide-react"
import { useMemo } from "react"
import { useSearchParams } from "next/navigation"

import { ExecutiveHero, EmptyState, MetricCard, MetricRail, Panel, StatusBadge } from "@/components/erp/shell"
import { useAuth } from "@/context/AuthContext"
import { usePlanningBoard } from "@/hooks/use-production"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"

const SECTION_STAGE_MAP: Record<string, string> = {
  winder: "WINDER",
  oven: "OVEN",
  process: "PROCESS",
  packing: "PACKING",
  qc: "QC",
  slitting: "SLITTING",
}

function formatDate(value?: string | null) {
  if (!value) return "-"
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format("DD MMM") : String(value)
}

export default function PlanningBoardPage() {
  const searchParams = useSearchParams()
  const { activePlant, user, isLoading } = useAuth()

  const section = String(searchParams?.get("section") || "winder").toLowerCase()
  const stage = SECTION_STAGE_MAP[section] || "WINDER"
  const planDate = searchParams?.get("plan_date") || dayjs().format("YYYY-MM-DD")
  const orderId = searchParams?.get("order_id") || ""
  const jobCardId = searchParams?.get("job_card_id") || ""
  const scopedPlantId = activePlant === "ALL" ? undefined : activePlant || undefined
  const canQuery = !isLoading && Boolean(user)

  const boardQuery = usePlanningBoard(stage, planDate, true, scopedPlantId, canQuery)

  const boardData = boardQuery.data as any
  const stageView = Array.isArray(boardData?.stages) ? boardData.stages[0] : null
  const lanes = Array.isArray(stageView?.lanes) ? stageView.lanes : []

  const filteredLanes = useMemo(() => {
    return lanes
      .map((lane: any) => ({
        ...lane,
        jobs: (lane.jobs || []).filter((job: any) => {
          if (orderId && String(job.sales_order_id || "") !== String(orderId)) return false
          if (jobCardId && String(job.job_card_id || "") !== String(jobCardId)) return false
          return true
        }),
      }))
      .filter((lane: any) => lane.jobs.length > 0 || (!orderId && !jobCardId))
  }, [jobCardId, lanes, orderId])

  const metrics = useMemo(() => {
    const allJobs = filteredLanes.flatMap((lane: any) => lane.jobs || [])
    const dueRisk = allJobs.filter((job: any) => job.due_date && dayjs(job.due_date).isBefore(dayjs().add(1, "day"), "day"))
    const overloaded = filteredLanes.filter((lane: any) => Boolean(lane.warning))
    return { allJobs, dueRisk, overloaded }
  }, [filteredLanes])

  if (boardQuery.isLoading) {
    return <EmptyState label="Loading machine and shift board..." />
  }

  if (boardData?.requires_explicit_plant) {
    return <EmptyState label="Select one concrete plant before opening the planning board." />
  }

  return (
    <div className="space-y-6" data-testid="planner-page">
      <ExecutiveHero
        appearance={MODULE_APPEARANCES.planning}
        badge={`${stage} Board`}
        title="Machine and shift board"
        description="Recovered section board for drag-ready planning visibility. This page now reads the live planning board service instead of the legacy thin queue route."
        aside={
          <div className="space-y-3">
            <div className="rounded-[1.15rem] border border-white/10 bg-white/10 p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-violet-100">Board Context</p>
              <p className="mt-2 text-2xl font-semibold">{stage}</p>
              <p className="mt-1 text-xs text-violet-100/80">{formatDate(planDate)}</p>
            </div>
            <Link href="/planning" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900">
              <Factory className="h-4 w-4" />
              Planner landing
            </Link>
          </div>
        }
      />

      <MetricRail>
        <MetricCard label="Visible Jobs" value={metrics.allJobs.length} detail="Cards visible on this board slice" icon={Layers3} tone="cyan" />
        <MetricCard label="Lanes" value={filteredLanes.length} detail="Machine and shift buckets for this stage" icon={Factory} tone="violet" />
        <MetricCard label="Due Risk" value={metrics.dueRisk.length} detail="Cards due today or tomorrow" icon={TimerReset} tone="amber" />
        <MetricCard label="Lane Alerts" value={metrics.overloaded.length} detail="Capacity or constraint warnings" icon={CalendarClock} tone="rose" />
      </MetricRail>

      <Panel title="Board Lanes" subtitle={`${stage} machine and shift board`}>
        {filteredLanes.length === 0 ? (
          <EmptyState label="No jobs matched this board filter." />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {filteredLanes.map((lane: any) => (
              <section key={lane.lane_id} className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{lane.shift_label || lane.shift_code || "Unscheduled"}</p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-950">{lane.machine_name || lane.machine_code || "Unassigned machine"}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Load {Number(lane.current_load || 0).toFixed(2)} / {Number(lane.capacity_value || 0).toFixed(2)} {lane.capacity_unit || ""}
                    </p>
                  </div>
                  {lane.warning ? <StatusBadge value="BLOCKED" label={lane.warning} /> : <StatusBadge value="READY" label="On plan" />}
                </div>

                <div className="mt-4 space-y-3">
                  {(lane.jobs || []).map((job: any) => (
                    <article
                      key={job.job_card_id}
                      data-testid={`planner-card:${job.job_card_id}`}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <Link
                            href={`/production/job-cards/${job.job_card_id}`}
                            data-testid={`planner-job-link:${job.job_card_id}`}
                            className="text-sm font-semibold text-slate-950 hover:text-cyan-700"
                          >
                            {job.job_card_ref || String(job.job_card_id).slice(0, 8)}
                          </Link>
                          <p className="mt-1 text-xs text-slate-500">
                            {job.customer_name || "-"} · SO {String(job.sales_order_id || "").slice(0, 8)}
                          </p>
                        </div>
                        <div className="text-right">
                          <StatusBadge value={job.segment_status || job.status} />
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-2">
                        <p>Qty {Number(job.segment_planned_qty || job.planned_qty || 0).toFixed(0)}</p>
                        <p>Seq {Number(job.sequence_no || 0)}</p>
                        <p>Due {formatDate(job.due_date)}</p>
                        <p>{job.product_code || job.spec_reference || "No product code"}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
