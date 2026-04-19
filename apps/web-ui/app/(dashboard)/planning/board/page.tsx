"use client"

import Link from "next/link"
import dayjs from "dayjs"
import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  ArrowRight,
  CalendarClock,
  Factory,
  GripVertical,
  Layers3,
  MoveHorizontal,
  Scissors,
  TimerReset,
} from "lucide-react"

import { EmptyState, StatusBadge } from "@/components/erp/shell"
import { PlantSwitcher } from "@/components/PlantSwitcher"
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
  useMachines,
  useSplitPlanningSegment,
} from "@/hooks/use-production"

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

const STAGE_THEME: Record<
  string,
  {
    tint: string
    border: string
    fill: string
    text: string
    pill: string
    accentBar: string
    dropRing: string
    header: string
  }
> = {
  winder: {
    tint: "from-cyan-50 via-white to-sky-50",
    border: "border-cyan-200",
    fill: "bg-cyan-600",
    text: "text-cyan-900",
    pill: "bg-cyan-50 text-cyan-900 border-cyan-200",
    accentBar: "from-cyan-500 to-sky-500",
    dropRing: "shadow-[0_0_0_1px_rgba(8,145,178,0.18),0_18px_40px_rgba(8,145,178,0.10)]",
    header: "text-cyan-700",
  },
  oven: {
    tint: "from-amber-50 via-white to-orange-50",
    border: "border-amber-200",
    fill: "bg-amber-500",
    text: "text-amber-900",
    pill: "bg-amber-50 text-amber-900 border-amber-200",
    accentBar: "from-amber-500 to-orange-500",
    dropRing: "shadow-[0_0_0_1px_rgba(245,158,11,0.18),0_18px_40px_rgba(245,158,11,0.10)]",
    header: "text-amber-700",
  },
  process: {
    tint: "from-indigo-50 via-white to-violet-50",
    border: "border-indigo-200",
    fill: "bg-indigo-600",
    text: "text-indigo-900",
    pill: "bg-indigo-50 text-indigo-900 border-indigo-200",
    accentBar: "from-indigo-500 to-violet-500",
    dropRing: "shadow-[0_0_0_1px_rgba(79,70,229,0.18),0_18px_40px_rgba(79,70,229,0.10)]",
    header: "text-indigo-700",
  },
  slitting: {
    tint: "from-slate-100 via-white to-slate-50",
    border: "border-slate-200",
    fill: "bg-slate-600",
    text: "text-slate-900",
    pill: "bg-slate-50 text-slate-900 border-slate-200",
    accentBar: "from-slate-500 to-slate-700",
    dropRing: "shadow-[0_0_0_1px_rgba(71,85,105,0.18),0_18px_40px_rgba(71,85,105,0.10)]",
    header: "text-slate-700",
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

function formatWhole(value?: number | string | null) {
  const numeric = Number(value || 0)
  return Number.isFinite(numeric) ? numeric.toFixed(0) : "0"
}

function formatOne(value?: number | string | null) {
  const numeric = Number(value || 0)
  return Number.isFinite(numeric) ? numeric.toFixed(1) : "0.0"
}

function plannerSize(job: any) {
  return job?.product_size_label && job.product_size_label !== "-"
    ? job.product_size_label
    : job?.spec_reference || job?.product_code || "Spec pending"
}

function capacityNeedFor(section: string, job: any) {
  if (section === "winder") return Number(job?.target_bamboo_count ?? job?.required_capacity ?? 0)
  return Number(job?.required_capacity ?? 0)
}

function capacityUnitFor(section: string) {
  if (section === "winder") return "bamboo"
  if (section === "oven") return "batch"
  return "tubes"
}

function formatCapacityUnit(value?: string | null) {
  const normalized = String(value || "").toUpperCase()
  if (normalized === "BAMBOOS_PER_DAY") return "bamboo/day"
  if (normalized === "BATCHES_PER_DAY") return "batch cycles/day"
  if (normalized === "TUBES_PER_DAY") return "tubes/day"
  if (normalized === "REELS_PER_DAY") return "reels/day"
  return normalized ? normalized.toLowerCase().replace(/_/g, " ") : ""
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

function matchesPlannerFocus(job: any, focusedOrderId?: string, focusedJobCardId?: string) {
  if (focusedJobCardId && String(job?.job_card_id || job?.id || "") !== focusedJobCardId) {
    return false
  }
  if (focusedOrderId && String(job?.sales_order_id || "") !== focusedOrderId) {
    return false
  }
  return true
}

type DropTarget = {
  machine_id: string | null
  plan_date: string | null
  shift_code: string | null
  sequence_no: number
}

export default function PlanningBoardPage() {
  const searchParams = useSearchParams()
  const { showToast } = useApp()
  const { activePlant, user, isLoading: authLoading } = useAuth()
  const [draggedJob, setDraggedJob] = useState<any | null>(null)
  const [splitDialogJob, setSplitDialogJob] = useState<any | null>(null)
  const [splitQty, setSplitQty] = useState("")
  const [queueFilter, setQueueFilter] = useState("all")

  const section = String(searchParams?.get("section") || "winder").toLowerCase()
  const stage = SECTION_STAGE_MAP[section] || "WINDER"
  const startDate = searchParams?.get("plan_date") || dayjs().format("YYYY-MM-DD")
  const focusedOrderId = String(searchParams?.get("order_id") || "")
  const focusedJobCardId = String(searchParams?.get("job_card_id") || "")
  const scopedPlantId = activePlant === "ALL" ? undefined : activePlant || undefined
  const needsConcretePlant = activePlant === "ALL"
  const canQuery = !authLoading && Boolean(user) && !needsConcretePlant

  const day0 = dayjs(startDate).format("YYYY-MM-DD")
  const day1 = dayjs(startDate).add(1, "day").format("YYYY-MM-DD")
  const day2 = dayjs(startDate).add(2, "day").format("YYYY-MM-DD")

  const board0 = usePlanningBoard(stage, day0, true, scopedPlantId, canQuery)
  const board1 = usePlanningBoard(stage, day1, true, scopedPlantId, canQuery)
  const board2 = usePlanningBoard(stage, day2, true, scopedPlantId, canQuery)
  const jobsQuery = usePlanningJobCards({ limit: 400 }, canQuery)
  const machinesQuery = useMachines()
  const moveCard = usePlanningBoardMove()
  const splitSegment = useSplitPlanningSegment()

  const meta = SECTION_META[section] || SECTION_META.winder
  const stageTheme = STAGE_THEME[section] || STAGE_THEME.winder
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
        }
      }),
    [boards, stage],
  )

  const unscheduledLane = useMemo(() => {
    const lanes = Array.isArray(stageViews[0]?.stageView?.lanes) ? stageViews[0].stageView.lanes : []
    return lanes.find((lane: any) => !lane.machine_id && !lane.shift_code) || null
  }, [stageViews])

  const machineLabelMap = useMemo(
    () =>
      new Map(
        (Array.isArray(machinesQuery.data) ? machinesQuery.data : []).map((machine: any) => [
          String(machine.id),
          machine.code || machine.name || String(machine.id).slice(0, 8),
        ]),
      ),
    [machinesQuery.data],
  )

  const scheduledDays = useMemo(
    () =>
      stageViews.map((entry) => {
        const lanes = Array.isArray(entry.stageView?.lanes) ? entry.stageView.lanes : []
        return {
          date: entry.date,
          lanes: lanes
            .filter((lane: any) => lane.machine_id || lane.shift_code)
            .map((lane: any) => ({
              ...lane,
              jobs: (lane.jobs || []).filter((job: any) => matchesPlannerFocus(job, focusedOrderId, focusedJobCardId)),
            }))
            .sort((left: any, right: any) =>
              `${left.machine_code || left.machine_name}-${left.shift_code || ""}`.localeCompare(
                `${right.machine_code || right.machine_name}-${right.shift_code || ""}`,
              ),
            ),
        }
      }),
    [focusedJobCardId, focusedOrderId, stageViews],
  )

  const queuedJobs = useMemo(
    () => (unscheduledLane?.jobs || []).filter((job: any) => matchesPlannerFocus(job, focusedOrderId, focusedJobCardId)),
    [focusedJobCardId, focusedOrderId, unscheduledLane],
  )

  const queueGroups = useMemo(() => {
    if (section !== "winder") {
      const readyNow = queuedJobs.filter((job: any) => String(job.current_stage || "").toUpperCase() === stage)
      const waitingOnUpstream = queuedJobs.filter((job: any) => String(job.current_stage || "").toUpperCase() !== stage)
      return [
        {
          key: "ready",
          title: "Ready to schedule",
          subtitle: "Current-stage cards that can be planned immediately.",
          jobs: readyNow,
        },
        {
          key: "upstream",
          title: "Waiting on previous step",
          subtitle: "Plan ahead here even before the previous stage entry is completed.",
          jobs: waitingOnUpstream,
        },
      ].filter((group) => group.jobs.length > 0)
    }
    const grouped = new Map<string, { key: string; title: string; subtitle: string; jobs: any[] }>()
    for (const job of queuedJobs) {
      const machineId = String(job?.assigned_winder_machine_id || "unassigned")
      const title =
        machineId === "unassigned"
          ? "Winder not selected"
          : machineLabelMap.get(machineId) || String(machineId).slice(0, 8)
      const bucket = grouped.get(machineId) || {
        key: machineId,
        title,
        subtitle: machineId === "unassigned" ? "Needs release-side machine choice" : "Released to this winder",
        jobs: [],
      }
      bucket.jobs.push(job)
      grouped.set(machineId, bucket)
    }
    return Array.from(grouped.values()).sort((left, right) => left.title.localeCompare(right.title))
  }, [machineLabelMap, queuedJobs, section])

  const queueFilterOptions = useMemo(
    () => [
      { key: "all", label: "All", count: queuedJobs.length },
      ...queueGroups.map((group) => ({ key: group.key, label: group.title, count: group.jobs.length })),
    ],
    [queueGroups, queuedJobs.length],
  )

  useEffect(() => {
    if (queueFilter === "all") return
    if (!queueGroups.some((group) => group.key === queueFilter)) {
      setQueueFilter("all")
    }
  }, [queueFilter, queueGroups])

  const visibleQueueGroups = useMemo(
    () => (queueFilter === "all" ? queueGroups : queueGroups.filter((group) => group.key === queueFilter)),
    [queueFilter, queueGroups],
  )

  const filteredQueuedJobs = useMemo(
    () => visibleQueueGroups.flatMap((group) => group.jobs),
    [visibleQueueGroups],
  )

  const allVisibleJobs = useMemo(
    () => scheduledDays.flatMap((entry) => entry.lanes.flatMap((lane: any) => lane.jobs || [])),
    [scheduledDays],
  )
  const allPlannerJobs = useMemo(() => [...queuedJobs, ...allVisibleJobs], [allVisibleJobs, queuedJobs])
  const dueRiskCount = useMemo(
    () =>
      allPlannerJobs.filter((job: any) => job.due_date && dayjs(job.due_date).isBefore(dayjs().add(1, "day"), "day"))
        .length,
    [allPlannerJobs],
  )
  const overloadedLaneCount = useMemo(
    () => scheduledDays.flatMap((entry) => entry.lanes).filter((lane: any) => Boolean(lane.warning)).length,
    [scheduledDays],
  )
  const loading = board0.isLoading || board1.isLoading || board2.isLoading || jobsQuery.isLoading
  const requiresExplicitPlant = boards.some((entry) => entry.response?.requires_explicit_plant)

  const tabs = Object.entries(SECTION_STAGE_MAP)
    .filter(([key]) => key !== "slitting" || allVisibleJobs.some((job: any) => job.current_stage === "SLITTING"))
    .map(([key, value]) => ({
      key,
      value,
      href: `/planning/board?section=${key}&plan_date=${startDate}${focusedOrderId ? `&order_id=${focusedOrderId}` : ""}${focusedJobCardId ? `&job_card_id=${focusedJobCardId}` : ""}`,
    }))

  const stageCounts = useMemo(() => {
    const counts = new Map<string, number>()
    const jobs = Array.isArray(jobsQuery.data) ? jobsQuery.data : []

    for (const tab of tabs) {
      counts.set(tab.key, 0)
    }

    for (const job of jobs) {
      const jobStage = String(job.current_stage || "").toUpperCase()
      if (String(job.status || "").toUpperCase() === "COMPLETED") continue
      const key = Object.entries(SECTION_STAGE_MAP).find(([, value]) => value === jobStage)?.[0]
      if (!key) continue
      counts.set(key, (counts.get(key) || 0) + 1)
    }

    counts.set(section, Math.max(counts.get(section) || 0, queuedJobs.length + allVisibleJobs.length))
    return counts
  }, [allVisibleJobs.length, jobsQuery.data, queuedJobs.length, section, tabs])

  const plannerShifts = useMemo(() => {
    const buckets = new Map<string, any>()
    for (const board of boards) {
      for (const shift of Array.isArray(board.response?.shifts) ? board.response.shifts : []) {
        const code = String(shift.code || "")
        if (!code) continue
        if (!buckets.has(code)) {
          buckets.set(code, shift)
        }
      }
    }
    if (buckets.size === 0) {
      return [
        { code: "SHIFT_A", label: "Shift A", capacity_share: 0.5 },
        { code: "SHIFT_B", label: "Shift B", capacity_share: 0.5 },
      ]
    }
    const order = ["SHIFT_A", "SHIFT_B", "SHIFT_C"]
    return Array.from(buckets.values()).sort(
      (left: any, right: any) => order.indexOf(String(left.code || "")) - order.indexOf(String(right.code || "")),
    )
  }, [boards])

  const machineRows = useMemo(() => {
    const catalog = new Map<string, any>()
    const liveMachines = Array.isArray(machinesQuery.data) ? machinesQuery.data : []

    for (const machine of liveMachines) {
      const department = String(machine?.department || machine?.machine_department || "").toUpperCase()
      if (department !== stage) continue
      catalog.set(String(machine.id), {
        id: String(machine.id),
        code: machine.code || machine.name || String(machine.id).slice(0, 8),
        name: machine.name || machine.code || String(machine.id).slice(0, 8),
        status: String(machine.status || "UP").toUpperCase(),
        capacity_value: machine.capacity_value || null,
        capacity_unit: formatCapacityUnit(machine.capacity_unit || machine.capacity_type),
      })
    }

    for (const entry of scheduledDays) {
      for (const lane of entry.lanes) {
        if (!lane.machine_id) continue
        if (!catalog.has(String(lane.machine_id))) {
          catalog.set(String(lane.machine_id), {
            id: String(lane.machine_id),
            code: lane.machine_code || lane.machine_name || String(lane.machine_id).slice(0, 8),
            name: lane.machine_name || lane.machine_code || String(lane.machine_id).slice(0, 8),
            status: "UP",
            capacity_value: lane.capacity_value || null,
            capacity_unit: lane.capacity_unit || null,
          })
        }
      }
    }

    return Array.from(catalog.values())
      .sort((left, right) => String(left.code || "").localeCompare(String(right.code || "")))
      .map((machine) => ({
        ...machine,
        dayColumns: scheduledDays.map((entry) => {
          const machineLanes = entry.lanes.filter((lane: any) => String(lane.machine_id || "") === machine.id)
          const byShift = new Map(machineLanes.map((lane: any) => [String(lane.shift_code || ""), lane]))
          return {
            date: entry.date,
            shifts: plannerShifts.map((shift: any) => {
              const lane = byShift.get(String(shift.code || ""))
              return (
                lane || {
                  lane_id: `${machine.id}-${entry.date}-${shift.code}`,
                  machine_id: machine.id,
                  machine_code: machine.code,
                  machine_name: machine.name,
                  shift_code: shift.code,
                  shift_label: shift.label,
                  capacity_value: machine.capacity_value,
                  capacity_unit: machine.capacity_unit,
                  current_load: 0,
                  warning: null,
                  jobs: [],
                }
              )
            }),
          }
        }),
      }))
  }, [machinesQuery.data, plannerShifts, scheduledDays, stage])

  const shiftHeaders = useMemo(
    () =>
      scheduledDays.flatMap((entry) =>
        plannerShifts.map((shift: any) => ({
          date: entry.date,
          shift_code: shift.code,
          shift_label: shift.label || String(shift.code || "").replace(/_/g, " "),
        })),
      ),
    [plannerShifts, scheduledDays],
  )

  const machineStatsMap = useMemo(
    () => new Map(machineRows.map((machine) => [String(machine.id), machine])),
    [machineRows],
  )

  const plannerMetrics = useMemo(() => {
    const lanes = machineRows.flatMap((machine) =>
      machine.dayColumns.flatMap((dayColumn: any) => dayColumn.shifts || []),
    )
    const totalCapacity = lanes.reduce((sum, lane: any) => sum + Number(lane.capacity_value || 0), 0)
    const scheduledLoad = lanes.reduce((sum, lane: any) => sum + Number(lane.current_load || 0), 0)
    const queueLoad = queuedJobs.reduce((sum: number, job: any) => sum + capacityNeedFor(section, job), 0)
    const queueTubes = queuedJobs.reduce((sum: number, job: any) => sum + Number(job.segment_planned_qty || 0), 0)
    const queueWeight = queuedJobs.reduce((sum: number, job: any) => sum + Number(job.planned_weight_kg || 0), 0)
    const maxShiftCapacity = Math.max(0, ...lanes.map((lane: any) => Number(lane.capacity_value || 0)))
    const defaultShiftShare = Number(plannerShifts[0]?.capacity_share || 1)
    const mustSplitCount = queuedJobs.filter((job: any) => {
      const assignedMachine = machineStatsMap.get(String(job.assigned_winder_machine_id || ""))
      const assignedCapacity = Number(assignedMachine?.capacity_value || 0)
      const effectiveCapacity = assignedCapacity > 0 ? assignedCapacity * defaultShiftShare : maxShiftCapacity
      return effectiveCapacity > 0 && capacityNeedFor(section, job) > effectiveCapacity
    }).length

    return {
      totalCapacity,
      scheduledLoad,
      freeCapacity: Math.max(totalCapacity - scheduledLoad, 0),
      queueLoad,
      queueTubes,
      queueWeight,
      mustSplitCount,
      utilization: totalCapacity > 0 ? Math.round((scheduledLoad / totalCapacity) * 100) : 0,
    }
  }, [machineRows, machineStatsMap, plannerShifts, queuedJobs, section])

  const heroMetricCards = [
    {
      label: "Open queue",
      value: queuedJobs.length,
      hint: `${formatWhole(plannerMetrics.queueLoad)} ${capacityUnitFor(section)} waiting`,
      className: "border-cyan-200 bg-cyan-50/90 text-cyan-950",
      icon: Layers3,
    },
    {
      label: "Tube load",
      value: formatWhole(plannerMetrics.queueTubes),
      hint: `${formatOne(plannerMetrics.queueWeight)} kg pending`,
      className: "border-sky-200 bg-sky-50/90 text-sky-950",
      icon: Factory,
    },
    {
      label: "Free capacity",
      value: formatWhole(plannerMetrics.freeCapacity),
      hint: `${plannerMetrics.utilization}% slot usage`,
      className: "border-emerald-200 bg-emerald-50/90 text-emerald-950",
      icon: TimerReset,
    },
    {
      label: "Needs split",
      value: plannerMetrics.mustSplitCount,
      hint: "Too large for one shift",
      className: "border-amber-200 bg-amber-50/90 text-amber-950",
      icon: Scissors,
    },
    {
      label: "Due risk",
      value: dueRiskCount,
      hint: `${overloadedLaneCount} lane alert(s)`,
      className: "border-rose-200 bg-rose-50/90 text-rose-950",
      icon: CalendarClock,
    },
  ]

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

  if (needsConcretePlant || requiresExplicitPlant) {
    return (
      <div className={`rounded-[1.75rem] border bg-gradient-to-br ${stageTheme.tint} p-6 shadow-[0_18px_52px_rgba(15,23,42,0.07)]`}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${stageTheme.pill}`}>
              Plant required
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Select one plant before scheduling</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Planner boards are machine, shift, and capacity specific. Global `ALL` view is available for analytics/tracker,
              but scheduling needs one concrete plant so queues and machine rows do not disappear or mix capacity.
            </p>
          </div>
          <div className="rounded-[1.25rem] border border-white/80 bg-white/85 p-4 shadow-sm">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Change scope</p>
            <PlantSwitcher />
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex h-[calc(100vh-6.35rem)] min-h-[590px] flex-col gap-2.5 overflow-hidden pb-2" data-testid="planner-page">
        <section
          className={`shrink-0 overflow-hidden rounded-[1.45rem] border bg-gradient-to-br ${stageTheme.tint} px-4 py-2.5 shadow-[0_18px_52px_rgba(15,23,42,0.07)]`}
        >
          <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${stageTheme.pill}`}>
                  <Layers3 className="h-3.5 w-3.5" />
                  Planning board
                </div>
                <div className="rounded-full border border-white/80 bg-white/80 px-3 py-1 text-[11px] font-semibold text-slate-700">
                  {formatDate(day0, "DD MMM")} - {formatDate(day2, "DD MMM")}
                </div>
                <div className="rounded-full border border-white/80 bg-white/80 px-3 py-1 text-[11px] font-semibold text-slate-700">
                  {plannerShifts.map((shift: any) => shift.label || shift.code).join(" · ")}
                </div>
              </div>
              <div className="mt-2 flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{meta.title}</p>
                  <h1 className="mt-1 text-[1.65rem] font-semibold tracking-tight text-slate-950">
                    Machine scheduling across 3 days
                  </h1>
                </div>
                <p className="max-w-2xl text-xs leading-5 text-slate-600">{meta.subtitle}</p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-5 2xl:w-[45rem]">
              {heroMetricCards.map((card) => (
                <div key={card.label} className={`rounded-[1.05rem] border px-3 py-2 shadow-sm ring-1 ring-white/70 ${card.className}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.16em] opacity-70">{card.label}</p>
                    <card.icon className="h-3.5 w-3.5 opacity-70" />
                  </div>
                  <p className="mt-1 text-xl font-semibold leading-none">{card.value}</p>
                  <p className="mt-1 text-[10px] leading-4 opacity-75">{card.hint}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2 border-t border-white/70 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              {tabs.map((tab) => {
                const active = tab.key === section
                const count = stageCounts.get(tab.key) || 0
                return (
                  <Link
                    key={tab.key}
                    href={tab.href}
                    className={`inline-flex items-center gap-2 rounded-[0.95rem] border px-3 py-2 text-xs font-semibold transition-all duration-200 ${
                      active
                        ? `border-transparent bg-slate-950 text-white shadow-[0_16px_32px_rgba(15,23,42,0.16)]`
                        : "border-white/80 bg-white/85 text-slate-700 hover:-translate-y-0.5 hover:bg-white"
                    }`}
                  >
                    <span>{tab.value}</span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        active ? "bg-white/15 text-white" : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {count}
                    </span>
                  </Link>
                )
              })}
              <Link
                href={`/planning/tracker?section=${section}`}
                className="inline-flex items-center gap-2 rounded-[0.95rem] border border-white/80 bg-white/85 px-3 py-2 text-xs font-semibold text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white"
              >
                Open tracker
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              {focusedOrderId || focusedJobCardId ? (
                <div className={`rounded-full border px-3 py-2 text-xs font-semibold ${stageTheme.pill}`}>
                  Focused on {focusedJobCardId ? `job ${focusedJobCardId.slice(0, 8)}` : `order ${focusedOrderId.slice(0, 8)}`}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[330px_minmax(0,1fr)]">
          <aside className="min-h-0">
            <section className="flex h-full min-h-0 flex-col rounded-[1.65rem] border border-slate-200 bg-white p-3 shadow-[0_16px_45px_rgba(15,23,42,0.06)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Open queue</p>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
                    {section === "winder" ? "Grouped by target winder" : "Shared stage backlog"}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    {section === "winder"
                      ? "Filter by release-selected winder, then drag into a machine-shift slot."
                      : "Plan ahead even before the previous stage entry lands."}
                  </p>
                </div>
                <div className={`rounded-full border px-3 py-2 text-xs font-semibold ${stageTheme.pill}`}>
                  {filteredQueuedJobs.length}/{queuedJobs.length}
                </div>
              </div>

              {queueFilterOptions.length > 1 ? (
                <div className="mt-3 flex shrink-0 gap-2 overflow-x-auto pb-1">
                  {queueFilterOptions.map((option) => {
                    const active = queueFilter === option.key
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setQueueFilter(option.key)}
                        className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-all duration-200 ${
                          active
                            ? "border-slate-950 bg-slate-950 text-white shadow-sm"
                            : "border-slate-200 bg-slate-50 text-slate-700 hover:-translate-y-0.5 hover:bg-white"
                        }`}
                      >
                        {option.label} · {option.count}
                      </button>
                    )
                  })}
                </div>
              ) : null}

              <div
                className={`mt-3 shrink-0 rounded-[1.1rem] border border-dashed bg-slate-50/80 px-3 py-3 text-xs text-slate-600 transition-all ${
                  draggedJob ? `${stageTheme.border} ${stageTheme.dropRing}` : "border-slate-200"
                }`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => handleDrop({ machine_id: null, plan_date: null, shift_code: null, sequence_no: 1 })}
              >
                Drag a planned slot back here to unschedule it and return it to the queue.
              </div>

              <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                {visibleQueueGroups.length === 0 || visibleQueueGroups.every((group) => group.jobs.length === 0) ? (
                  <EmptyState label="No unscheduled cards in this stage." />
                ) : (
                  visibleQueueGroups.map((group) => (
                    <div key={group.key} className="rounded-[1.25rem] border border-slate-200 bg-slate-50/75 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{group.title}</p>
                          <p className="mt-1 text-xs leading-5 text-slate-500">{group.subtitle}</p>
                        </div>
                        <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                          {group.jobs.length}
                        </div>
                      </div>

                      <div className="mt-3 space-y-2.5">
                        {group.jobs.map((job: any) => {
                          const assignedMachine = machineStatsMap.get(String(job.assigned_winder_machine_id || ""))
                          const preferredCapacity = Number(
                            assignedMachine?.capacity_value || job.machine_capacity_value || 0,
                          )
                          const perShiftCapacity =
                            preferredCapacity > 0 ? preferredCapacity * Number(plannerShifts[0]?.capacity_share || 1) : 0
                          const capacityNeed = capacityNeedFor(section, job)
                          const mustSplit = perShiftCapacity > 0 && capacityNeed > perShiftCapacity
                          const dueSoon = job.due_date ? dayjs(job.due_date).isBefore(dayjs().add(1, "day"), "day") : false

                          return (
                            <article
                              key={job.segment_id}
                              draggable
                              onDragStart={() => setDraggedJob(job)}
                              onDragEnd={() => setDraggedJob(null)}
                              className={`group relative overflow-visible rounded-[1.2rem] border bg-white p-3 transition-all duration-200 ${
                                draggedJob?.segment_id === job.segment_id
                                  ? `${stageTheme.border} ${stageTheme.dropRing}`
                                  : "border-slate-200 shadow-sm hover:-translate-y-0.5 hover:shadow-md"
                              }`}
                            >
                              <div className={`absolute inset-y-3 left-2.5 w-1 rounded-full bg-gradient-to-b ${stageTheme.accentBar}`} />
                              <div className="pl-3.5">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                                      {job.product_code || job.spec_reference || "Pending product"}
                                    </p>
                                    <p className="mt-1 text-sm font-semibold text-slate-950">
                                      {job.job_card_ref || String(job.job_card_id).slice(0, 8)}
                                    </p>
                                    <p className="mt-1 text-sm font-semibold text-slate-700">{plannerSize(job)}</p>
                                    <p className="mt-1 text-xs text-slate-500">
                                      {job.customer_name || "-"} · Due {formatDate(job.due_date)}
                                    </p>
                                  </div>
                                  <GripVertical className="h-4 w-4 text-slate-400" />
                                </div>

                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                                    {formatWhole(job.segment_planned_qty)} tubes
                                  </span>
                                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                                    {formatWhole(job.target_bamboo_count)} bamboo
                                  </span>
                                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                                    {formatOne(job.planned_weight_kg)} kg
                                  </span>
                                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                                    Cap {formatWhole(capacityNeed)} {capacityUnitFor(section)}
                                  </span>
                                  {mustSplit ? (
                                    <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700">
                                      Must split
                                    </span>
                                  ) : null}
                                  {dueSoon ? (
                                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                                      Due in 24h
                                    </span>
                                  ) : null}
                                </div>

                                <div className="mt-2 grid gap-1 text-[11px] text-slate-600">
                                  <p>
                                    {job.sales_order_id ? `SO ${String(job.sales_order_id).slice(0, 8)}` : "No sales order link"} · Release{" "}
                                    {formatWhole(job.segment_planned_qty)} tubes
                                  </p>
                                  <p>
                                    Capacity need {formatWhole(capacityNeed)} {capacityUnitFor(section)}
                                    {perShiftCapacity ? ` · slot cap ${formatWhole(perShiftCapacity)}` : ""}
                                  </p>
                                  <p>
                                    {assignedMachine
                                      ? `Preferred machine ${assignedMachine.code}`
                                      : section === "winder"
                                        ? "No winder assigned on release"
                                        : "Free assignment at this stage"}
                                  </p>
                                </div>

                                {(stage === "WINDER" || stage === "PROCESS") && Number(job.segment_planned_qty || 0) > 1 ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSplitDialogJob(job)
                                      setSplitQty(String(Math.floor(Number(job.segment_planned_qty || 0) / 2)))
                                    }}
                                    className="mt-3 inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50"
                                  >
                                    <Scissors className="h-3.5 w-3.5" />
                                    Manual split
                                  </button>
                                ) : null}
                              </div>

                              <div className="pointer-events-none absolute left-[calc(100%+0.75rem)] top-0 z-20 hidden w-72 rounded-[1.3rem] border border-slate-800 bg-slate-950/95 p-4 text-white shadow-2xl xl:group-hover:block">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Job detail</p>
                                <p className="mt-2 text-lg font-semibold">{job.job_card_ref || String(job.job_card_id).slice(0, 8)}</p>
                                <div className="mt-3 space-y-2 text-xs leading-5 text-slate-300">
                                  <p>Customer: {job.customer_name || "-"}</p>
                                  <p>Product: {job.product_code || job.spec_reference || "-"}</p>
                                  <p>Size: {plannerSize(job)}</p>
                                  <p>Tube qty: {formatWhole(job.segment_planned_qty)} pcs</p>
                                  <p>Bamboo req: {formatWhole(job.target_bamboo_count)} pcs</p>
                                  <p>Tube weight: {formatOne(job.tube_weight_g || job.target_tube_weight)} g</p>
                                  <p>Release weight: {formatOne(job.planned_weight_kg)} kg</p>
                                  <p>Tube load / bamboo: {formatOne(job.bamboo_weight_kg)} kg</p>
                                  <p>PCS / bamboo: {formatWhole(job.pcs_per_bamboo)}</p>
                                  <p>CS target: {formatOne(job.required_cs)}</p>
                                  <p>Bamboo length: {formatWhole(job.selected_bamboo_length_mm)} mm · usable {formatWhole(job.usable_length_mm)} mm</p>
                                  <p>Due: {formatDate(job.due_date)}</p>
                                  <p>Stage now: {String(job.current_stage || stage).toUpperCase()}</p>
                                </div>
                              </div>
                            </article>
                          )
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

          </aside>

          <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[1.65rem] border border-slate-200 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
            <div className="shrink-0 border-b border-slate-200 px-4 py-2.5">
              <div className="flex flex-col gap-1.5 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Schedule canvas</p>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
                    Machine rows across {scheduledDays.length} days and {plannerShifts.length} shifts
                  </h2>
                </div>
                <p className="max-w-2xl text-xs leading-5 text-slate-600">
                  Empty and scheduled machines stay visible; drag queue cards into exact machine-shift slots.
                </p>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <div className="min-w-[1720px] px-4 py-3">
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: `240px repeat(${Math.max(shiftHeaders.length, 1)}, minmax(170px, 1fr))` }}
                >
                  <div />
                  {scheduledDays.map((entry) => (
                    <div
                      key={`day-header-${entry.date}`}
                      style={{ gridColumn: `span ${plannerShifts.length}` }}
                      className="rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3"
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Plan day</p>
                      <p className="mt-1 text-base font-semibold text-slate-950">{dayKey(entry.date)}</p>
                    </div>
                  ))}

                  <div className="rounded-[1.15rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                    Machine lane
                  </div>
                  {shiftHeaders.map((header, index) => (
                    <div key={`${header.date}-${header.shift_code}-${index}`} className="rounded-[1.15rem] border border-slate-200 bg-slate-50 px-3 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        {formatDate(header.date, "ddd DD MMM")}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-950">{header.shift_label}</p>
                    </div>
                  ))}

                  {machineRows.length === 0 ? (
                    <div
                      className="rounded-[1.4rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500"
                      style={{ gridColumn: `span ${Math.max(shiftHeaders.length + 1, 2)}` }}
                    >
                      No machine rows are available for this stage yet.
                    </div>
                  ) : (
                    machineRows.map((machine) => (
                      <div key={machine.id} className="contents">
                        <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50/85 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Machine</p>
                              <h3 className="mt-1 text-lg font-semibold text-slate-950">{machine.code}</h3>
                              <p className="mt-1 text-xs text-slate-500">{machine.name}</p>
                            </div>
                            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700">
                              {machine.status}
                            </div>
                          </div>
                          <div className="mt-4 space-y-2 text-xs text-slate-600">
                            <p>
                              Capacity {formatWhole(machine.capacity_value)} {machine.capacity_unit || ""}
                              {machine.capacity_value
                                ? ` · ~${formatWhole(Number(machine.capacity_value) * Number(plannerShifts[0]?.capacity_share || 1))}/shift`
                                : ""}
                            </p>
                            <p>
                              {machine.status === "UP"
                                ? "Available for scheduling"
                                : machine.status === "MAINT"
                                  ? "Maintenance state"
                                  : "Unavailable until machine is restored"}
                            </p>
                          </div>
                        </div>

                        {machine.dayColumns.flatMap((dayColumn) =>
                          dayColumn.shifts.map((lane: any, slotIndex: number) => {
                            const isBlockedMachine = machine.status === "DOWN" || machine.status === "MAINT"
                            const ratio = loadRatio(lane.current_load, lane.capacity_value)
                            const flatIndex = `${machine.id}-${dayColumn.date}-${lane.shift_code}-${slotIndex}`

                            return (
                              <div
                                key={flatIndex}
                                className={`rounded-[1.35rem] border p-3 transition-all duration-200 ${
                                  draggedJob
                                    ? `${stageTheme.border} ${stageTheme.dropRing}`
                                    : "border-slate-200 bg-white"
                                } ${isBlockedMachine ? "bg-slate-100/80" : "bg-white"}`}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={() => {
                                  if (isBlockedMachine) {
                                    setDraggedJob(null)
                                    showToast(`Cannot schedule on ${machine.code} while it is ${machine.status}.`, "error")
                                    return
                                  }
                                  void handleDrop({
                                    machine_id: lane.machine_id || machine.id,
                                    plan_date: dayColumn.date,
                                    shift_code: lane.shift_code || null,
                                    sequence_no: (lane.jobs || []).length + 1,
                                  })
                                }}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                                      {lane.shift_label || lane.shift_code || "Shift"}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500">{dayjs(dayColumn.date).format("DD MMM")}</p>
                                  </div>
                                  {lane.warning ? <StatusBadge value="BLOCKED" label={lane.warning} /> : null}
                                </div>

                                <div className="mt-3 rounded-full bg-slate-100">
                                  <div
                                    className={`h-2 rounded-full ${
                                      ratio >= 100 ? "bg-rose-500" : ratio >= 85 ? "bg-amber-500" : stageTheme.fill
                                    }`}
                                    style={{ width: `${ratio}%` }}
                                  />
                                </div>

                                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                                  <span>
                                    {formatLoad(lane.current_load)} / {formatLoad(lane.capacity_value)} {lane.capacity_unit || ""}
                                  </span>
                                  <span>{Math.round(ratio)}%</span>
                                </div>

                                <div className="mt-3 space-y-2">
                                  {(lane.jobs || []).map((job: any) => (
                                    <article
                                      key={job.segment_id}
                                      draggable
                                      onDragStart={() => setDraggedJob(job)}
                                      onDragEnd={() => setDraggedJob(null)}
                                      className={`group relative overflow-visible rounded-xl border px-2.5 py-2 text-xs transition-all duration-200 ${
                                        draggedJob?.segment_id === job.segment_id
                                          ? `${stageTheme.border} bg-white ${stageTheme.dropRing}`
                                          : "border-slate-200 bg-slate-50 hover:-translate-y-0.5 hover:bg-white hover:shadow-md"
                                      }`}
                                    >
                                      <div className={`absolute inset-y-2 left-1.5 w-1 rounded-full bg-gradient-to-b ${stageTheme.accentBar}`} />
                                      <div className="pl-3">
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="min-w-0">
                                            <p className="truncate font-semibold text-slate-950">
                                              {job.job_card_ref || String(job.job_card_id).slice(0, 8)}
                                            </p>
                                            <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-700">
                                              {plannerSize(job)}
                                            </p>
                                            <p className="mt-0.5 truncate text-[10px] text-slate-500">
                                              {job.customer_name || "-"}
                                            </p>
                                          </div>
                                          <MoveHorizontal className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                        </div>

                                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                                          <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700">
                                            {formatWhole(job.target_bamboo_count)} bmb
                                          </span>
                                          <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700">
                                            {formatWhole(job.segment_planned_qty)} tubes
                                          </span>
                                          <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700">
                                            {formatOne(job.planned_weight_kg)} kg
                                          </span>
                                        </div>

                                        <div className="mt-1.5 grid gap-0.5 text-[10px] text-slate-600">
                                          <p>Need {formatWhole(capacityNeedFor(section, job))} {capacityUnitFor(section)}</p>
                                          <p>Due {formatDate(job.due_date)}</p>
                                        </div>

                                        {(stage === "WINDER" || stage === "PROCESS") && Number(job.segment_planned_qty || 0) > 1 ? (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setSplitDialogJob(job)
                                              setSplitQty(String(Math.floor(Number(job.segment_planned_qty || 0) / 2)))
                                            }}
                                            className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-700 transition hover:bg-white"
                                          >
                                            <Scissors className="h-3 w-3" />
                                            Split
                                          </button>
                                        ) : null}
                                      </div>

                                      <div className="pointer-events-none absolute left-[calc(100%+0.75rem)] top-0 z-20 hidden w-72 rounded-[1.3rem] border border-slate-800 bg-slate-950/95 p-4 text-white shadow-2xl xl:group-hover:block">
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Pinned card</p>
                                        <p className="mt-2 text-lg font-semibold">
                                          {job.job_card_ref || String(job.job_card_id).slice(0, 8)}
                                        </p>
                                        <div className="mt-3 space-y-2 text-xs leading-5 text-slate-300">
                                          <p>Customer: {job.customer_name || "-"}</p>
                                          <p>Product: {job.product_code || job.spec_reference || "-"}</p>
                                          <p>Size: {plannerSize(job)}</p>
                                          <p>Tube qty: {formatWhole(job.segment_planned_qty)} pcs</p>
                                          <p>Bamboo req: {formatWhole(job.target_bamboo_count)} pcs</p>
                                          <p>Tube weight: {formatOne(job.tube_weight_g || job.target_tube_weight)} g</p>
                                          <p>Release weight: {formatOne(job.planned_weight_kg)} kg</p>
                                          <p>Tube load / bamboo: {formatOne(job.bamboo_weight_kg)} kg</p>
                                          <p>PCS / bamboo: {formatWhole(job.pcs_per_bamboo)}</p>
                                          <p>CS target: {formatOne(job.required_cs)}</p>
                                          <p>Bamboo length: {formatWhole(job.selected_bamboo_length_mm)} mm · usable {formatWhole(job.usable_length_mm)} mm</p>
                                          <p>Due: {formatDate(job.due_date)}</p>
                                          <p>Status: {job.segment_status || job.status || "PLANNED"}</p>
                                        </div>
                                      </div>
                                    </article>
                                  ))}

                                  {(lane.jobs || []).length === 0 ? (
                                    <div
                                      className={`rounded-[1.05rem] border border-dashed px-3 py-6 text-center text-xs text-slate-500 ${
                                        isBlockedMachine
                                          ? "border-slate-300 bg-slate-100"
                                          : `${stageTheme.border} bg-slate-50/70`
                                      }`}
                                    >
                                      {isBlockedMachine ? `${machine.status} machine` : "Drop planner cards here"}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            )
                          }),
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>
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
