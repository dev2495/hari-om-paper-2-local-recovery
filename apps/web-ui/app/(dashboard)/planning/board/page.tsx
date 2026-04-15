"use client"

import Link from "next/link"
import dayjs from "dayjs"
import { useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Factory,
  GripVertical,
  Layers3,
  MoveHorizontal,
  Scissors,
  Sparkles,
  TimerReset,
} from "lucide-react"

import {
  EmptyState,
  ExecutiveHero,
  MetricCard,
  MetricRail,
  Panel,
  StatusBadge,
} from "@/components/erp/shell"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import {
  usePlanningBoard,
  usePlanningBoardMove,
  usePlanningJobCards,
  useSplitPlanningSegment,
} from "@/hooks/use-production"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"

const SECTION_STAGE_MAP: Record<string, string> = {
  winder: "WINDER",
  oven: "OVEN",
  process: "PROCESS",
  slitting: "SLITTING",
}

const SECTION_META: Record<
  string,
  { title: string; subtitle: string; accent: string }
> = {
  winder: {
    title: "Winder planner",
    subtitle: "Release-to-machine planning with split-aware capacity handling.",
    accent: "Queue is per machine and shift. Over-capacity moves auto-split across shifts.",
  },
  oven: {
    title: "Oven planner",
    subtitle: "Batch curing overview with carry-forward control for the next three days.",
    accent: "Use this when winding is done and oven loading has to be sequenced cleanly.",
  },
  process: {
    title: "Process planner",
    subtitle: "Downstream finishing schedule for open WIP after oven completion.",
    accent: "Cards stay here until process entry clears the remaining stage load.",
  },
  slitting: {
    title: "Slitting planner",
    subtitle: "Only use when released work requires reel conversion before winding.",
    accent: "This tab appears for the recovered edge-case routing only.",
  },
}

function formatDate(value?: string | null, template = "DD MMM") {
  if (!value) return "-"
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format(template) : String(value)
}

function formatLoad(value?: number | null) {
  const numeric = Number(value || 0)
  return Number.isFinite(numeric) ? numeric.toFixed(1) : "0.0"
}

function loadRatio(currentLoad?: number | null, capacityValue?: number | null) {
  const load = Number(currentLoad || 0)
  const capacity = Number(capacityValue || 0)
  if (!capacity) return 0
  return Math.max(0, Math.min(100, (load / capacity) * 100))
}

function dayKey(value: string) {
  return dayjs(value).format("ddd DD MMM")
}

type DropTarget = {
  machine_id: string | null
  plan_date: string | null
  shift_code: string | null
  sequence_no: number
}

export default function PlanningBoardPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { showToast } = useApp()
  const { activePlant, user, isLoading: authLoading } = useAuth()
  const [draggedJob, setDraggedJob] = useState<any | null>(null)
  const [splitDialogJob, setSplitDialogJob] = useState<any | null>(null)
  const [splitQty, setSplitQty] = useState("")

  const section = String(searchParams?.get("section") || "winder").toLowerCase()
  const stage = SECTION_STAGE_MAP[section] || "WINDER"
  const startDate = searchParams?.get("plan_date") || dayjs().format("YYYY-MM-DD")
  const scopedPlantId = activePlant === "ALL" ? undefined : activePlant || undefined
  const canQuery = !authLoading && Boolean(user)

  const day0 = dayjs(startDate).format("YYYY-MM-DD")
  const day1 = dayjs(startDate).add(1, "day").format("YYYY-MM-DD")
  const day2 = dayjs(startDate).add(2, "day").format("YYYY-MM-DD")

  const board0 = usePlanningBoard(stage, day0, true, scopedPlantId, canQuery)
  const board1 = usePlanningBoard(stage, day1, true, scopedPlantId, canQuery)
  const board2 = usePlanningBoard(stage, day2, true, scopedPlantId, canQuery)
  const jobsQuery = usePlanningJobCards({ limit: 400 }, canQuery)
  const moveCard = usePlanningBoardMove()
  const splitSegment = useSplitPlanningSegment()

  const meta = SECTION_META[section] || SECTION_META.winder
  const boards = [
    { date: day0, response: board0.data as any },
    { date: day1, response: board1.data as any },
    { date: day2, response: board2.data as any },
  ]

  const stageViews = useMemo(
    () =>
      boards.map((entry) => {
        const view = Array.isArray(entry.response?.stages)
          ? entry.response.stages.find((row: any) => String(row.stage || "").toUpperCase() === stage)
          : null
        return {
          date: entry.date,
          stageView: view,
          suggestions: Array.isArray(entry.response?.suggestions) ? entry.response.suggestions : [],
        }
      }),
    [boards, stage],
  )

  const unscheduledLane = useMemo(() => {
    const lanes = Array.isArray(stageViews[0]?.stageView?.lanes) ? stageViews[0].stageView.lanes : []
    return lanes.find((lane: any) => !lane.machine_id && !lane.shift_code) || null
  }, [stageViews])

  const scheduledDays = useMemo(
    () =>
      stageViews.map((entry) => {
        const lanes = Array.isArray(entry.stageView?.lanes) ? entry.stageView.lanes : []
        return {
          date: entry.date,
          suggestions: entry.suggestions,
          lanes: lanes
            .filter((lane: any) => lane.machine_id || lane.shift_code)
            .sort((left: any, right: any) =>
              `${left.machine_code || left.machine_name}-${left.shift_code || ""}`.localeCompare(
                `${right.machine_code || right.machine_name}-${right.shift_code || ""}`,
              ),
            ),
        }
      }),
    [stageViews],
  )

  const allVisibleJobs = useMemo(
    () => scheduledDays.flatMap((entry) => entry.lanes.flatMap((lane: any) => lane.jobs || [])),
    [scheduledDays],
  )
  const completedJobs = useMemo(
    () =>
      (Array.isArray(jobsQuery.data) ? jobsQuery.data : []).filter(
        (job: any) => String(job.status || "").toUpperCase() === "COMPLETED",
      ),
    [jobsQuery.data],
  )
  const dueRiskCount = useMemo(
    () =>
      allVisibleJobs.filter((job: any) => job.due_date && dayjs(job.due_date).isBefore(dayjs().add(1, "day"), "day"))
        .length,
    [allVisibleJobs],
  )
  const overloadedLaneCount = useMemo(
    () => scheduledDays.flatMap((entry) => entry.lanes).filter((lane: any) => Boolean(lane.warning)).length,
    [scheduledDays],
  )
  const suggestionCount = useMemo(
    () => scheduledDays.reduce((sum, entry) => sum + entry.suggestions.length, 0),
    [scheduledDays],
  )

  const loading = board0.isLoading || board1.isLoading || board2.isLoading || jobsQuery.isLoading
  const requiresExplicitPlant = boards.some((entry) => entry.response?.requires_explicit_plant)

  const tabs = Object.entries(SECTION_STAGE_MAP)
    .filter(([key]) => key !== "slitting" || allVisibleJobs.some((job: any) => job.current_stage === "SLITTING"))
    .map(([key, value]) => ({
      key,
      value,
      href: `/planning/board?section=${key}&plan_date=${startDate}`,
    }))

  async function handleDrop(target: DropTarget) {
    if (!draggedJob) return
    try {
      await moveCard.mutateAsync({
        segment_id: draggedJob.segment_id,
        stage,
        machine_id: target.machine_id,
        plan_date: target.plan_date,
        shift_code: target.shift_code,
        sequence_no: target.sequence_no,
      })
      showToast("Planner card moved.", "success")
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Unable to move planner card."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    } finally {
      setDraggedJob(null)
    }
  }

  async function handleSplit() {
    if (!splitDialogJob) return
    const primaryQty = Number(splitQty || 0)
    if (primaryQty <= 0 || primaryQty >= Number(splitDialogJob.segment_planned_qty || 0)) {
      showToast("Split quantity must be positive and below the segment planned quantity.", "error")
      return
    }
    try {
      await splitSegment.mutateAsync({
        segment_id: splitDialogJob.segment_id,
        stage,
        primary_qty: primaryQty,
      })
      showToast("Planner segment split.", "success")
      setSplitDialogJob(null)
      setSplitQty("")
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Unable to split planner segment."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    }
  }

  if (loading) {
    return <EmptyState label="Loading planner workspace..." />
  }

  if (requiresExplicitPlant) {
    return <EmptyState label="Select one concrete plant before opening the planner workspace." />
  }

  return (
    <>
      <div className="space-y-6" data-testid="planner-page">
        <ExecutiveHero
          appearance={MODULE_APPEARANCES.planning}
          badge="Planner Workspace"
          title={meta.title}
          description={meta.subtitle}
          aside={
            <div className="space-y-3">
              <div className="rounded-[1.15rem] border border-white/10 bg-white/10 p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-100">Window</p>
                <p className="mt-2 text-2xl font-semibold">{formatDate(day0)} - {formatDate(day2)}</p>
                <p className="mt-1 text-xs text-cyan-100/80">{meta.accent}</p>
              </div>
              <div className="grid gap-2">
                <Link
                  href={`/planning/tracker?section=${section}`}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900"
                >
                  Open job tracker
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                tab.key === section
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              {tab.value}
            </Link>
          ))}
          <Link
            href={`/planning?section=${section}`}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Planner landing
          </Link>
        </div>

        <MetricRail>
          <MetricCard
            label="Open Queue"
            value={(unscheduledLane?.jobs || []).length}
            detail="Unscheduled cards waiting for assignment"
            icon={Layers3}
            tone="cyan"
          />
          <MetricCard
            label="Live Cards"
            value={allVisibleJobs.length}
            detail="Visible machine-shift allocations across 3 days"
            icon={Factory}
            tone="violet"
          />
          <MetricCard
            label="Due Risk"
            value={dueRiskCount}
            detail="Cards due today or tomorrow"
            icon={TimerReset}
            tone="amber"
          />
          <MetricCard
            label="Lane Alerts"
            value={overloadedLaneCount}
            detail="Capacity or constraint warnings"
            icon={CalendarClock}
            tone="rose"
          />
          <MetricCard
            label="Completed"
            value={completedJobs.length}
            detail="Recovered completion history available in tracker"
            icon={CheckCircle2}
            tone="emerald"
          />
        </MetricRail>

        <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
          <div className="space-y-6">
            <Panel
              title="Open Queue"
              subtitle="Drag from here to a machine shift. Winder and process auto-split when the shift capacity is exceeded."
            >
              <div
                className="space-y-3"
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => handleDrop({ machine_id: null, plan_date: null, shift_code: null, sequence_no: 1 })}
              >
                {(unscheduledLane?.jobs || []).length === 0 ? (
                  <EmptyState label="No unscheduled cards in this stage." />
                ) : (
                  (unscheduledLane?.jobs || []).map((job: any) => (
                    <article
                      key={job.segment_id}
                      draggable
                      onDragStart={() => setDraggedJob(job)}
                      onDragEnd={() => setDraggedJob(null)}
                      className="rounded-[1.2rem] border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {job.product_code || job.spec_reference || "Pending product"}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-slate-950">
                            {job.job_card_ref || String(job.job_card_id).slice(0, 8)}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {job.customer_name || "-"} · Due {formatDate(job.due_date)}
                          </p>
                        </div>
                        <GripVertical className="h-4 w-4 text-slate-400" />
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-slate-600">
                        <p>Qty {Number(job.segment_planned_qty || 0).toFixed(0)} pcs</p>
                        <p>Bamboo {Number(job.target_bamboo_count || 0).toFixed(0)} · {Number(job.pcs_per_bamboo || 0)} pcs / bamboo</p>
                        <p>Capacity need {formatLoad(job.required_capacity)}</p>
                      </div>
                      {(stage === "WINDER" || stage === "PROCESS") && Number(job.segment_planned_qty || 0) > 1 ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSplitDialogJob(job)
                            setSplitQty(String(Math.floor(Number(job.segment_planned_qty || 0) / 2)))
                          }}
                          className="mt-3 inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <Scissors className="h-3.5 w-3.5" />
                          Manual split
                        </button>
                      ) : null}
                    </article>
                  ))
                )}
              </div>
            </Panel>

            <Panel title="Planner Suggestions" subtitle="Suggested placements recovered from the live planning service.">
              <div className="space-y-3">
                {suggestionCount === 0 ? (
                  <EmptyState label="No placement suggestions for this three-day window." />
                ) : (
                  scheduledDays.flatMap((entry) =>
                    entry.suggestions.slice(0, 3).map((suggestion: any) => (
                      <div key={`${entry.date}-${suggestion.job_card_id}`} className="rounded-[1.1rem] border border-slate-200 bg-slate-50 p-3 text-sm">
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-cyan-700" />
                          <p className="font-semibold text-slate-900">{suggestion.machine_name || suggestion.machine_code || "Suggested lane"}</p>
                        </div>
                        <p className="mt-2 text-xs text-slate-600">
                          {formatDate(entry.date)} · {suggestion.shift_code || "Unscheduled"} · seq {suggestion.sequence_no}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">{String(suggestion.job_card_id).slice(0, 8)}</p>
                      </div>
                    )),
                  )
                )}
              </div>
            </Panel>
          </div>

          <Panel
            title="Three-Day Machine Board"
            subtitle="Drop cards into machine-shift lanes. Machine cards show stage load in bamboo or tube capacity units."
          >
            <div className="grid gap-5 xl:grid-cols-3">
              {scheduledDays.map((entry) => (
                <section key={entry.date} className="space-y-4">
                  <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Plan Day</p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-950">{dayKey(entry.date)}</h3>
                  </div>

                  <div className="space-y-4">
                    {entry.lanes.length === 0 ? (
                      <EmptyState label="No machine lanes for this date." />
                    ) : (
                      entry.lanes.map((lane: any) => (
                        <div
                          key={lane.lane_id}
                          className="rounded-[1.35rem] border border-slate-200 bg-white p-4 shadow-sm"
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() =>
                            handleDrop({
                              machine_id: lane.machine_id || null,
                              plan_date: entry.date,
                              shift_code: lane.shift_code || null,
                              sequence_no: (lane.jobs || []).length + 1,
                            })
                          }
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                                {lane.shift_label || lane.shift_code || "Unscheduled"}
                              </p>
                              <h4 className="mt-1 text-base font-semibold text-slate-950">
                                {lane.machine_code || lane.machine_name || "Open lane"}
                              </h4>
                              <p className="mt-1 text-xs text-slate-500">
                                {formatLoad(lane.current_load)} / {formatLoad(lane.capacity_value)} {lane.capacity_unit || ""}
                              </p>
                            </div>
                            {lane.warning ? <StatusBadge value="BLOCKED" label={lane.warning} /> : <StatusBadge value="READY" label="On plan" />}
                          </div>

                          <div className="mt-3 h-2 rounded-full bg-slate-100">
                            <div
                              className={`h-2 rounded-full ${lane.warning ? "bg-amber-500" : "bg-cyan-700"}`}
                              style={{ width: `${loadRatio(lane.current_load, lane.capacity_value)}%` }}
                            />
                          </div>

                          <div className="mt-4 space-y-3">
                            {(lane.jobs || []).map((job: any) => (
                              <article
                                key={job.segment_id}
                                draggable
                                onDragStart={() => setDraggedJob(job)}
                                onDragEnd={() => setDraggedJob(null)}
                                className={`rounded-[1.1rem] border p-3 text-sm transition ${
                                  draggedJob?.segment_id === job.segment_id
                                    ? "border-cyan-300 bg-cyan-50 shadow-md"
                                    : "border-slate-200 bg-slate-50 hover:bg-white"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="font-semibold text-slate-950">
                                      {job.job_card_ref || String(job.job_card_id).slice(0, 8)}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500">
                                      {job.product_code || "No product code"} · {job.customer_name || "-"}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <StatusBadge value={job.segment_status || job.status} />
                                    <MoveHorizontal className="h-4 w-4 text-slate-400" />
                                  </div>
                                </div>
                                <div className="mt-3 grid gap-2 text-xs text-slate-600">
                                  <p>Qty {Number(job.segment_planned_qty || 0).toFixed(0)} pcs</p>
                                  <p>Bamboo {Number(job.target_bamboo_count || 0).toFixed(0)} · {Number(job.pcs_per_bamboo || 0)} pcs / bamboo</p>
                                  <p>Capacity need {formatLoad(job.required_capacity)} · Due {formatDate(job.due_date)}</p>
                                </div>
                                {(stage === "WINDER" || stage === "PROCESS") && Number(job.segment_planned_qty || 0) > 1 ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSplitDialogJob(job)
                                      setSplitQty(String(Math.floor(Number(job.segment_planned_qty || 0) / 2)))
                                    }}
                                    className="mt-3 inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-white"
                                  >
                                    <Scissors className="h-3.5 w-3.5" />
                                    Split card
                                  </button>
                                ) : null}
                              </article>
                            ))}

                            {(lane.jobs || []).length === 0 ? (
                              <div className="rounded-[1rem] border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
                                Drop planner cards here
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <Dialog open={Boolean(splitDialogJob)} onOpenChange={(open) => !open && setSplitDialogJob(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Split planner segment</DialogTitle>
            <DialogDescription>
              Use manual split only when the automatic capacity split is not the right break. The remaining balance will stay as the follow-up segment.
            </DialogDescription>
          </DialogHeader>
          {splitDialogJob ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-950">{splitDialogJob.job_card_ref || String(splitDialogJob.job_card_id).slice(0, 8)}</p>
                <p className="mt-1">Current segment qty {Number(splitDialogJob.segment_planned_qty || 0).toFixed(0)} pcs</p>
                <p className="mt-1">Current required capacity {formatLoad(splitDialogJob.required_capacity)}</p>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-slate-700">Primary segment qty</label>
                <input
                  type="number"
                  min="1"
                  max={Math.max(1, Number(splitDialogJob.segment_planned_qty || 0) - 1)}
                  value={splitQty}
                  onChange={(event) => setSplitQty(event.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <button
              type="button"
              onClick={() => setSplitDialogJob(null)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSplit}
              disabled={splitSegment.isPending}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              Confirm split
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
