"use client"

import Link from "next/link"
import dayjs from "dayjs"
import type { MouseEvent } from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Factory,
  GripVertical,
  Layers3,
  MoveHorizontal,
  Scissors,
  TimerReset,
} from "lucide-react"

import { KeyboardScheduleForm } from "@/components/planning/keyboard-schedule-form"
import { EmptyState, StatusBadge } from "@/components/erp/shell"
import { LoadingState, ErrorState } from "@/components/workspace/query-state"
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
import { classifyDueRisk, DUE_RISK_OVERDUE, DUE_RISK_PRIORITY } from "@/lib/due-risk"
import { jobCardRef } from "@/lib/job-card-display"

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
    accent: "This workspace is used when the released job requires reel conversion.",
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
    tint: "from-signal-cyan-soft via-card to-signal-blue-soft",
    border: "border-signal-cyan-line",
    fill: "bg-cyan-600",
    text: "text-signal-cyan-ink",
    pill: "bg-signal-cyan-soft text-signal-cyan-ink border-signal-cyan-line",
    accentBar: "from-cyan-500 to-sky-500",
    dropRing: "shadow-[0_0_0_1px_rgba(8,145,178,0.18),0_18px_40px_rgba(8,145,178,0.10)]",
    header: "text-signal-cyan-ink",
  },
  oven: {
    tint: "from-signal-amber-soft via-card to-signal-orange-soft",
    border: "border-signal-amber-line",
    fill: "bg-amber-500",
    text: "text-signal-amber-ink",
    pill: "bg-signal-amber-soft text-signal-amber-ink border-signal-amber-line",
    accentBar: "from-amber-500 to-orange-500",
    dropRing: "shadow-[0_0_0_1px_rgba(245,158,11,0.18),0_18px_40px_rgba(245,158,11,0.10)]",
    header: "text-signal-amber-ink",
  },
  process: {
    tint: "from-signal-indigo-soft via-card to-signal-violet-soft",
    border: "border-signal-indigo-line",
    fill: "bg-indigo-600",
    text: "text-signal-indigo-ink",
    pill: "bg-signal-indigo-soft text-signal-indigo-ink border-signal-indigo-line",
    accentBar: "from-indigo-500 to-violet-500",
    dropRing: "shadow-[0_0_0_1px_rgba(79,70,229,0.18),0_18px_40px_rgba(79,70,229,0.10)]",
    header: "text-signal-indigo-ink",
  },
  slitting: {
    tint: "from-muted via-card to-muted",
    border: "border-border",
    fill: "bg-slate-600",
    text: "text-foreground",
    pill: "bg-muted text-foreground border-border",
    accentBar: "from-slate-500 to-foreground",
    dropRing: "shadow-[0_0_0_1px_rgba(71,85,105,0.18),0_18px_40px_rgba(71,85,105,0.10)]",
    header: "text-muted-foreground",
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

function winderMeterLoad(job: any) {
  const requiredCapacity = Number(job?.required_capacity ?? 0)
  if (Number.isFinite(requiredCapacity) && requiredCapacity > 0) return requiredCapacity
  const bambooCount = Number(job?.target_bamboo_count ?? 0)
  const bambooLengthMm = Number(job?.selected_bamboo_length_mm ?? 0)
  if (bambooCount > 0 && bambooLengthMm > 0) return (bambooCount * bambooLengthMm) / 1000
  return 0
}

function capacityNeedFor(section: string, job: any) {
  if (section === "winder") return winderMeterLoad(job)
  return Number(job?.required_capacity ?? 0)
}

function capacityUnitFor(section: string) {
  if (section === "winder") return "m"
  if (section === "oven") return "batch"
  return "tubes"
}

function formatCapacityUnit(value?: string | null, perShift = true) {
  const normalized = String(value || "").toUpperCase()
  if (normalized === "METERS_PER_DAY") return perShift ? "m/shift" : "meters/day"
  if (normalized === "BAMBOOS_PER_DAY") return perShift ? "bamboo/shift" : "bamboo/day"
  if (normalized === "BATCHES_PER_DAY") return perShift ? "batch cycles/shift" : "batch cycles/day"
  if (normalized === "TUBES_PER_DAY") return perShift ? "tubes/shift" : "tubes/day"
  if (normalized === "REELS_PER_DAY") return perShift ? "reels/shift" : "reels/day"
  return normalized ? normalized.toLowerCase().replace(/_/g, " ") : ""
}

function machineCapacitySummary(machine: any) {
  const department = String(machine?.department || machine?.machine_department || "").toUpperCase()
  if (department === "OVEN") {
    const batches = Number(machine?.raw_capacity_value || machine?.capacity_batches_per_day || 0)
    const batchSize = Number(machine?.batch_bamboo_capacity || 0)
    const cycleHours = Number(machine?.cycle_time_hours || 0)
    const shiftBamboo = batches > 0 && batchSize > 0 ? batches * batchSize : Number(machine?.capacity_value || 0)
    return `${formatWhole(shiftBamboo)} bamboo/shift · ${formatOne(batches)} batch/shift · ${formatWhole(batchSize)} bamboo/batch · ${formatOne(cycleHours)}h cycle`
  }
  return `Capacity ${formatWhole(machine?.capacity_value)} ${machine?.capacity_unit || ""}`
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

function monthKey(value: string) {
  return dayjs(value).format("MMMM YYYY")
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

function plannerJobCardId(job: any) {
  return String(job?.job_card_id || job?.id || job?.segment_id || "")
}

function CarryForwardBadge({ job }: { job: any }) {
  if (!job?.is_carry_forward) return null
  const sourceId = job?.carry_forward_source_job_card_id ? String(job.carry_forward_source_job_card_id) : ""
  const reasonCode = job?.carry_forward_reason_code ? String(job.carry_forward_reason_code) : ""
  const title = sourceId
    ? `From JC ${sourceId}${reasonCode ? ` · ${reasonCode}` : ""}`
    : "Carry-forward top-up"
  return (
    <span
      title={title}
      className="shrink-0 rounded-full border border-signal-amber-line bg-signal-amber-soft px-1.5 py-0.5 text-[9px] font-bold text-signal-amber-ink"
    >
      ↻ Carry-forward
    </span>
  )
}

function StaleSlotBadge({ job }: { job: any }) {
  if (!job?.stale_slot) return null
  const was = job?.stale_plan_date ? dayjs(job.stale_plan_date).format("DD MMM") : ""
  return (
    <span
      title="This card's planner slot is in the past. Drag it into the next three days before floor entry."
      data-testid="planner-stale-slot"
      className="shrink-0 rounded-full border border-signal-rose-line bg-signal-rose-soft px-1.5 py-0.5 text-[9px] font-bold text-signal-rose-ink"
    >
      Missed slot{was ? ` · ${was}` : ""}
    </span>
  )
}

type DropTarget = {
  machine_id: string | null
  plan_date: string | null
  shift_code: string | null
  sequence_no: number
}

type HoverDetail = {
  job: any
  label: string
  x: number
  y: number
  placement: "left" | "right"
}

export function PlanningWorkspace({ sectionOverride }: { sectionOverride?: string }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { showToast } = useApp()
  const { activePlant, user, isLoading: authLoading } = useAuth()
  const [draggedJob, setDraggedJob] = useState<any | null>(null)
  const [hoverSlot, setHoverSlot] = useState<string | null>(null)
  const [pendingDrop, setPendingDrop] = useState<{ job: any; target: DropTarget; label: string; overBy: number; unit: string } | null>(null)
  const [keyboardJob, setKeyboardJob] = useState<any | null>(null)
  const [splitDialogJob, setSplitDialogJob] = useState<any | null>(null)
  const [splitQty, setSplitQty] = useState("")
  const [queueFilter, setQueueFilter] = useState("all")
  const [hoverDetail, setHoverDetail] = useState<HoverDetail | null>(null)
  const [dateDraft, setDateDraft] = useState("")

  const section = String(sectionOverride || searchParams?.get("section") || "winder").toLowerCase()
  const isSummaryView = section === "summary"
  const plannerView = String(searchParams?.get("view") || "schedule").toLowerCase() === "calendar" ? "calendar" : "schedule"
  const stage = isSummaryView ? "WINDER" : SECTION_STAGE_MAP[section] || "WINDER"
  const startDate = searchParams?.get("plan_date") || dayjs().format("YYYY-MM-DD")
  const focusedOrderId = String(searchParams?.get("order_id") || "")
  const focusedJobCardId = String(searchParams?.get("job_card_id") || "")
  const scopedPlantId = activePlant === "ALL" ? undefined : activePlant || undefined
  const needsConcretePlant = activePlant === "ALL"
  const canQuery = !authLoading && Boolean(user) && !needsConcretePlant

  const day0 = dayjs(startDate).format("YYYY-MM-DD")
  const day1 = dayjs(startDate).add(1, "day").format("YYYY-MM-DD")
  const day2 = dayjs(startDate).add(2, "day").format("YYYY-MM-DD")
  const previousWindowDate = dayjs(startDate).subtract(3, "day").format("YYYY-MM-DD")
  const todayWindowDate = dayjs().format("YYYY-MM-DD")
  const nextWindowDate = dayjs(startDate).add(3, "day").format("YYYY-MM-DD")
  const maxPlannerDate = dayjs().add(3, "month").format("YYYY-MM-DD")
  const monthStartDate = dayjs(startDate).startOf("month").format("YYYY-MM-DD")
  const previousMonthDate = dayjs(startDate).subtract(1, "month").startOf("month").format("YYYY-MM-DD")
  const nextMonthDate = dayjs(startDate).add(1, "month").startOf("month").format("YYYY-MM-DD")

  const boardHref = useCallback((next: { section?: string; date?: string; view?: string } = {}) => {
    const params = new URLSearchParams()
    params.set("section", next.section || section)
    params.set("plan_date", next.date || startDate)
    if ((next.view || plannerView) === "calendar") params.set("view", "calendar")
    if (focusedOrderId) params.set("order_id", focusedOrderId)
    if (focusedJobCardId) params.set("job_card_id", focusedJobCardId)
    if (sectionOverride) {
      const target = next.section || section
      params.delete("section")
      return `/planning/${target === "summary" ? "overview" : target}?${params.toString()}`
    }
    return `/planning/board?${params.toString()}`
  }, [focusedJobCardId, focusedOrderId, plannerView, section, startDate, sectionOverride])

  useEffect(() => {
    setDateDraft(dayjs(startDate).isValid() ? dayjs(startDate).format("YYYY-MM-DD") : dayjs().format("YYYY-MM-DD"))
  }, [startDate])

  const board0 = usePlanningBoard(stage, day0, true, scopedPlantId, canQuery)
  const board1 = usePlanningBoard(stage, day1, true, scopedPlantId, canQuery)
  const board2 = usePlanningBoard(stage, day2, true, scopedPlantId, canQuery)
  const jobsQuery = usePlanningJobCards({ limit: 400 }, canQuery)
  const machinesQuery = useMachines()
  const moveCard = usePlanningBoardMove()
  const splitSegment = useSplitPlanningSegment()

  const meta = isSummaryView ? { title: "Planner summary", subtitle: "Six-day live WIP, schedule, and risk control.", accent: "" } : SECTION_META[section] || SECTION_META.winder
  const stageTheme = isSummaryView ? STAGE_THEME.winder : STAGE_THEME[section] || STAGE_THEME.winder
  const boards = useMemo(
    () => [
      { date: day0, response: board0.data as any },
      { date: day1, response: board1.data as any },
      { date: day2, response: board2.data as any },
    ],
    [board0.data, board1.data, board2.data, day0, day1, day2],
  )

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
              capacity_unit: formatCapacityUnit(lane.capacity_unit, true),
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
    const staleJobs = queuedJobs.filter((job: any) => job?.stale_slot)
    const staleGroup = staleJobs.length
      ? [{
          key: "stale",
          title: "Missed slot · re-plan",
          subtitle: "Slotted on a past date and not finished. Drag into the next three days.",
          jobs: staleJobs,
        }]
      : []
    const liveJobs = queuedJobs.filter((job: any) => !job?.stale_slot)
    if (section !== "winder") {
      const readyNow = liveJobs.filter((job: any) => String(job.current_stage || "").toUpperCase() === stage)
      const waitingOnUpstream = liveJobs.filter((job: any) => String(job.current_stage || "").toUpperCase() !== stage)
      return [
        ...staleGroup,
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
    for (const job of liveJobs) {
      const machineId = String(job?.assigned_winder_machine_id || "unassigned")
      const title =
        machineId === "unassigned"
          ? "Winder not selected"
          : machineLabelMap.get(machineId) || String(machineId).slice(0, 8)
      const bucket = grouped.get(machineId) || {
        key: machineId,
        title,
        subtitle: machineId === "unassigned" ? "Needs release-side machine choice" : "Release hint · any available winder",
        jobs: [],
      }
      bucket.jobs.push(job)
      grouped.set(machineId, bucket)
    }
    return [...staleGroup, ...Array.from(grouped.values()).sort((left, right) => left.title.localeCompare(right.title))]
  }, [machineLabelMap, queuedJobs, section, stage])

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
    () => allPlannerJobs.filter((job: any) => classifyDueRisk(job.due_date) === DUE_RISK_PRIORITY).length,
    [allPlannerJobs],
  )
  const overloadedLaneCount = useMemo(
    () => scheduledDays.flatMap((entry) => entry.lanes).filter((lane: any) => Boolean(lane.warning)).length,
    [scheduledDays],
  )
  const loading = board0.isLoading || board1.isLoading || board2.isLoading || jobsQuery.isLoading
  const loadFailed = board0.isError || board1.isError || board2.isError || jobsQuery.isError
  const requiresExplicitPlant = boards.some((entry) => entry.response?.requires_explicit_plant)

  const tabs = useMemo(
    () => [
      {
        key: "summary",
        value: "SUMMARY",
        href: boardHref({ section: "summary" }),
      },
      ...Object.entries(SECTION_STAGE_MAP)
        .filter(([key]) => key !== "slitting" || allVisibleJobs.some((job: any) => job.current_stage === "SLITTING"))
        .map(([key, value]) => ({
          key,
          value,
          href: boardHref({ section: key }),
        })),
    ],
    [allVisibleJobs, boardHref],
  )

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
    counts.set("summary", jobs.filter((job: any) => String(job.status || "").toUpperCase() !== "COMPLETED").length)
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
        { code: "SHIFT_A", label: "Shift A", capacity_share: 1 },
        { code: "SHIFT_B", label: "Shift B", capacity_share: 1 },
      ]
    }
    const order = ["SHIFT_A", "SHIFT_B"]
    return Array.from(buckets.values()).sort((left: any, right: any) => {
      const leftIndex = order.indexOf(String(left.code || ""))
      const rightIndex = order.indexOf(String(right.code || ""))
      return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex)
    })
  }, [boards])

  const machineRows = useMemo(() => {
    const catalog = new Map<string, any>()
    const liveMachines = Array.isArray(machinesQuery.data) ? machinesQuery.data : []

    for (const machine of liveMachines) {
      const department = String(machine?.department || machine?.machine_department || "").toUpperCase()
      if (department !== stage) continue
      if (String(machine?.status || "UP").toUpperCase() !== "UP") continue
      catalog.set(String(machine.id), {
        id: String(machine.id),
        code: machine.code || machine.name || String(machine.id).slice(0, 8),
        name: machine.name || machine.code || String(machine.id).slice(0, 8),
        status: String(machine.status || "UP").toUpperCase(),
        raw_capacity_value: machine.capacity_value || null,
        capacity_value:
          department === "OVEN" && Number(machine.batch_bamboo_capacity || 0) > 0
            ? Number(machine.capacity_value || 0) * Number(machine.batch_bamboo_capacity || 0)
            : machine.capacity_value || null,
        capacity_unit:
          department === "OVEN" && Number(machine.batch_bamboo_capacity || 0) > 0
            ? "bamboo/shift"
            : formatCapacityUnit(machine.capacity_unit || machine.capacity_type),
        department,
        batch_bamboo_capacity: machine.batch_bamboo_capacity || null,
        cycle_time_hours: machine.cycle_time_hours || null,
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
            department: stage,
            batch_bamboo_capacity: lane.batch_bamboo_capacity || null,
            cycle_time_hours: lane.cycle_time_hours || null,
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
                  batch_bamboo_capacity: machine.batch_bamboo_capacity,
                  cycle_time_hours: machine.cycle_time_hours,
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
    const mustSplitCount = queuedJobs.filter((job: any) => {
      const assignedMachine = machineStatsMap.get(String(job.assigned_winder_machine_id || ""))
      const assignedCapacity = Number(assignedMachine?.capacity_value || 0)
      const effectiveCapacity = assignedCapacity > 0 ? assignedCapacity : maxShiftCapacity
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
  }, [machineRows, machineStatsMap, queuedJobs, section])

  const heroMetricCards = [
    {
      label: "Open queue",
      value: queuedJobs.length,
      hint: `${section === "winder" ? formatLoad(plannerMetrics.queueLoad) : formatWhole(plannerMetrics.queueLoad)} ${capacityUnitFor(section)} waiting`,
      className: "border-signal-cyan-line bg-signal-cyan-soft/90 text-signal-cyan-ink",
      icon: Layers3,
    },
    {
      label: "Tube load",
      value: formatWhole(plannerMetrics.queueTubes),
      hint: `${formatOne(plannerMetrics.queueWeight)} kg pending`,
      className: "border-signal-blue-line bg-signal-blue-soft/90 text-signal-blue-ink",
      icon: Factory,
    },
    {
      label: "Free capacity",
      value: section === "winder" ? formatLoad(plannerMetrics.freeCapacity) : formatWhole(plannerMetrics.freeCapacity),
      hint: `${plannerMetrics.utilization}% slot usage`,
      className: "border-signal-emerald-line bg-signal-emerald-soft/90 text-signal-emerald-ink",
      icon: TimerReset,
    },
    {
      label: "Needs split",
      value: plannerMetrics.mustSplitCount,
      hint: "Too large for one shift",
      className: "border-signal-amber-line bg-signal-amber-soft/90 text-signal-amber-ink",
      icon: Scissors,
    },
    {
      label: "Priority (3 plant days)",
      value: dueRiskCount,
      hint: `${overloadedLaneCount} lane alert(s)`,
      className: "border-signal-rose-line bg-signal-rose-soft/90 text-signal-rose-ink",
      icon: CalendarClock,
    },
  ]

  const allJobCards = useMemo(() => (Array.isArray(jobsQuery.data) ? jobsQuery.data : []), [jobsQuery.data])
  const activeJobCards = useMemo(
    () => allJobCards.filter((job: any) => String(job.status || "").toUpperCase() !== "COMPLETED"),
    [allJobCards],
  )
  const monthCalendarDays = useMemo(() => {
    const monthStart = dayjs(startDate).startOf("month")
    const gridStart = monthStart.subtract(monthStart.day(), "day")
    const jobsByDate = new Map<string, any[]>()
    for (const job of activeJobCards) {
      const planDate = job.active_segment_plan_date || job.plan_date || job.due_date || job.created_at
      if (!planDate || !dayjs(planDate).isValid()) continue
      const key = dayjs(planDate).format("YYYY-MM-DD")
      const bucket = jobsByDate.get(key) || []
      bucket.push(job)
      jobsByDate.set(key, bucket)
    }
    return Array.from({ length: 42 }, (_, index) => {
      const dateValue = gridStart.add(index, "day")
      const key = dateValue.format("YYYY-MM-DD")
      const jobs = jobsByDate.get(key) || []
      const scheduled = jobs.filter((job: any) => Boolean(job.active_segment_machine_id)).length
      const blocked = jobs.filter((job: any) => Boolean(job.blocked_reason) || !job.planner_gate_ready).length
      const stageLoad = jobs.reduce((acc: Record<string, number>, job: any) => {
        const stageName = String(job.current_stage || "UNKNOWN").toUpperCase()
        acc[stageName] = (acc[stageName] || 0) + 1
        return acc
      }, {})
      return {
        date: key,
        inMonth: dateValue.isSame(monthStart, "month"),
        isToday: dateValue.isSame(dayjs(), "day"),
        isBeyondPlanningLimit: dateValue.isAfter(dayjs(maxPlannerDate), "day"),
        jobs,
        scheduled,
        unscheduled: Math.max(jobs.length - scheduled, 0),
        blocked,
        stageLoad,
      }
    })
  }, [activeJobCards, maxPlannerDate, startDate])
  const calendarMonthMetrics = useMemo(() => {
    const currentMonthRows = monthCalendarDays.filter((row) => row.inMonth)
    const jobs = currentMonthRows.flatMap((row) => row.jobs)
    const scheduled = currentMonthRows.reduce((sum, row) => sum + row.scheduled, 0)
    const blocked = currentMonthRows.reduce((sum, row) => sum + row.blocked, 0)
    return {
      jobs: jobs.length,
      scheduled,
      unscheduled: Math.max(jobs.length - scheduled, 0),
      blocked,
      busyDays: currentMonthRows.filter((row) => row.jobs.length > 0).length,
    }
  }, [monthCalendarDays])
  const completedJobCards = useMemo(
    () => allJobCards.filter((job: any) => String(job.status || "").toUpperCase() === "COMPLETED"),
    [allJobCards],
  )
  const lastSixDays = useMemo(
    () => Array.from({ length: 6 }, (_, index) => dayjs().subtract(5 - index, "day").format("YYYY-MM-DD")),
    [],
  )
  const summaryStageRows = useMemo(() => {
    const rows = ["SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING", "QC", "DISPATCH"].map((stageName) => {
      const jobs = activeJobCards.filter((job: any) => String(job.current_stage || "").toUpperCase() === stageName)
      const blocked = jobs.filter((job: any) => Boolean(job.blocked_reason) || !job.planner_gate_ready)
      const due = jobs.filter((job: any) => classifyDueRisk(job.due_date) === DUE_RISK_PRIORITY)
      return {
        stage: stageName,
        jobs,
        blocked: blocked.length,
        due: due.length,
        qty: jobs.reduce((sum: number, job: any) => sum + Number(job.planned_qty || job.segment_planned_qty || 0), 0),
      }
    })
    return rows.filter((row) => row.jobs.length > 0 || ["WINDER", "OVEN", "PROCESS"].includes(row.stage))
  }, [activeJobCards])
  const summaryDayRows = useMemo(
    () =>
      lastSixDays.map((dateValue) => {
        const jobs = activeJobCards.filter((job: any) => {
          const planDate = job.active_segment_plan_date || job.due_date || job.created_at
          return planDate && dayjs(planDate).isSame(dayjs(dateValue), "day")
        })
        return {
          date: dateValue,
          jobs,
          scheduled: jobs.filter((job: any) => Boolean(job.active_segment_machine_id)).length,
          unscheduled: jobs.filter((job: any) => !job.active_segment_machine_id).length,
          blocked: jobs.filter((job: any) => Boolean(job.blocked_reason) || !job.planner_gate_ready).length,
        }
      }),
    [activeJobCards, lastSixDays],
  )
  const plannerActionJobs = useMemo(
    () =>
      activeJobCards
        .filter((job: any) => Boolean(job.blocked_reason) || !job.planner_gate_ready || classifyDueRisk(job.due_date) === DUE_RISK_PRIORITY || classifyDueRisk(job.due_date) === DUE_RISK_OVERDUE)
        .slice(0, 8),
    [activeJobCards],
  )

  function showJobDetail(event: MouseEvent<HTMLElement>, job: any, label: string) {
    const rect = event.currentTarget.getBoundingClientRect()
    const popoverWidth = 380
    const popoverHeight = 390
    const gap = 14
    const viewportWidth = typeof window === "undefined" ? 1440 : window.innerWidth
    const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight
    const hasRoomRight = rect.right + gap + popoverWidth <= viewportWidth - 12
    const x = hasRoomRight ? rect.right + gap : Math.max(12, rect.left - popoverWidth - gap)
    const y = Math.min(Math.max(12, rect.top - 18), Math.max(12, viewportHeight - popoverHeight - 12))
    setHoverDetail({ job, label, x, y, placement: hasRoomRight ? "right" : "left" })
  }

  async function scheduleSegment(job: any, target: DropTarget) {
    if (!job) return
    let preflightWarning = ""
    if (stage === "WINDER" && target.machine_id) {
      const assignedWinder = job.assigned_winder_machine_id
      if (!assignedWinder) {
        preflightWarning = "No release winder was captured; planner is assigning this WINDER job manually."
      } else if (String(assignedWinder) !== String(target.machine_id)) {
        const assignedMachine = machineStatsMap.get(String(assignedWinder))
        const targetMachine = machineStatsMap.get(String(target.machine_id))
        preflightWarning = `Other winder used. Release selected ${assignedMachine?.code || assignedMachine?.name || "target winder"}; planner assigned ${targetMachine?.code || targetMachine?.name || "this winder"}.`
      }
    }
    try {
      const response = await moveCard.mutateAsync({
        segment_id: job.segment_id,
        stage,
        machine_id: target.machine_id,
        plan_date: target.plan_date,
        shift_code: target.shift_code,
        sequence_no: target.sequence_no,
      })
      const warnings = Array.isArray(response?.data?.warnings) ? response.data.warnings.filter(Boolean) : []
      const warningMessage = warnings.length ? warnings.join(" ") : preflightWarning
      showToast(warningMessage || "Planner card moved.", warningMessage ? "info" : "success")
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Unable to move planner card."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    } finally {
      setDraggedJob(null)
    }
  }

  async function handleDrop(target: DropTarget) {
    if (!draggedJob) return
    await scheduleSegment(draggedJob, target)
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

  function applyDateDraft(targetView = plannerView) {
    const parsed = dayjs(dateDraft)
    if (!parsed.isValid()) {
      showToast("Select a valid planner date.", "error")
      return
    }
    if (parsed.isAfter(dayjs(maxPlannerDate), "day")) {
      showToast("Planner future window is limited to the next 3 months.", "error")
      return
    }
    router.push(boardHref({ date: parsed.format("YYYY-MM-DD"), view: targetView }))
  }

  const plannerControls = (
    <div className="mt-3 grid gap-2 rounded-[1.15rem] border border-border/80 bg-card/70 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: "schedule", label: "3-day board" },
          { key: "calendar", label: "Month calendar" },
        ].map((item) => {
          const active = plannerView === item.key
          return (
            <Link
              key={item.key}
              href={boardHref({ view: item.key })}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-all duration-200 ${
                active
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-card/80 text-muted-foreground hover:-translate-y-0.5 hover:bg-card"
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,13rem)_auto_auto] sm:items-end">
        <label className="grid gap-1">
          <span className="text-[11.5px] font-semibold text-muted-foreground">Planner start date</span>
          <input
            type="date"
            value={dateDraft}
            max={maxPlannerDate}
            onChange={(event) => setDateDraft(event.target.value)}
            className="h-9 rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground outline-none transition focus:border-input"
          />
        </label>
        <button
          type="button"
          onClick={() => applyDateDraft(plannerView)}
          className="h-9 rounded-full border border-primary bg-primary px-4 text-xs font-semibold text-primary-foreground transition hover:-translate-y-0.5 active:translate-y-0"
        >
          Show window
        </button>
        <p className="text-[11px] leading-4 text-muted-foreground">
          Future planning is capped at {formatDate(maxPlannerDate, "DD MMM YYYY")}.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
        {plannerView === "calendar" ? (
          <>
            <Link
              href={boardHref({ date: previousMonthDate, view: "calendar" })}
              className="inline-flex h-9 items-center gap-1 rounded-full border border-border bg-card/85 px-3 text-[11px] font-semibold text-muted-foreground transition hover:-translate-y-0.5"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prior month
            </Link>
            <Link
              href={boardHref({ date: dayjs(nextMonthDate).isAfter(dayjs(maxPlannerDate), "day") ? maxPlannerDate : nextMonthDate, view: "calendar" })}
              className={`inline-flex h-9 items-center gap-1 rounded-full border px-3 text-[11px] font-semibold transition ${
                dayjs(nextMonthDate).isAfter(dayjs(maxPlannerDate), "day")
                  ? "border-border bg-muted text-muted-foreground"
                  : "border-border bg-card/85 text-muted-foreground hover:-translate-y-0.5"
              }`}
            >
              Next month
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </>
        ) : (
          [
            { label: "Previous 3 days", date: previousWindowDate },
            { label: "Today window", date: todayWindowDate },
            { label: "Next 3 days", date: dayjs(nextWindowDate).isAfter(dayjs(maxPlannerDate), "day") ? maxPlannerDate : nextWindowDate },
          ].map((control) => (
            <Link
              key={control.label}
              href={boardHref({ date: control.date, view: "schedule" })}
              className="rounded-full border border-border bg-card/85 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition hover:-translate-y-0.5 hover:bg-card"
            >
              {control.label}
            </Link>
          ))
        )}
      </div>
    </div>
  )

  const calendarBoard = (
    <section className="overflow-hidden rounded-[1.65rem] border border-border bg-card shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
      <div className="border-b border-border bg-muted/70 px-4 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11.5px] font-semibold ${stageTheme.pill}`}>
              <CalendarDays className="h-3.5 w-3.5" />
              Monthly planning map
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{monthKey(monthStartDate)}</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              A month-level control surface for future planning. Pick any valid day to open its 3-day machine window.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-5 xl:w-[44rem]">
            {[
              ["Jobs", calendarMonthMetrics.jobs],
              ["Scheduled", calendarMonthMetrics.scheduled],
              ["Unscheduled", calendarMonthMetrics.unscheduled],
              ["Blocked", calendarMonthMetrics.blocked],
              ["Busy days", calendarMonthMetrics.busyDays],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-[1rem] border border-border bg-card px-3 py-2 shadow-sm">
                <p className="text-[12px] font-semibold text-muted-foreground">{label}</p>
                <p className="mt-1 text-xl font-semibold leading-none text-foreground">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-7 gap-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
            <div key={label} className="rounded-full bg-muted px-3 py-2 text-center text-[11.5px] font-semibold text-muted-foreground">
              {label}
            </div>
          ))}
          {monthCalendarDays.map((day) => {
            const dominantStage = Object.entries(day.stageLoad).sort((left, right) => Number(right[1]) - Number(left[1]))[0]?.[0]
            const canOpenDay = !day.isBeyondPlanningLimit
            return (
              <Link
                key={day.date}
                href={canOpenDay ? boardHref({ date: day.date, view: "schedule" }) : boardHref({ date: maxPlannerDate, view: "schedule" })}
                className={`group min-h-[150px] rounded-[1.25rem] border p-3 transition-all duration-300 ${
                  day.isToday
                    ? "border-primary bg-primary text-primary-foreground shadow-[0_18px_44px_rgba(15,23,42,0.18)]"
                    : day.inMonth
                      ? "border-border bg-card hover:-translate-y-1 hover:border-border hover:shadow-[0_18px_42px_rgba(15,23,42,0.08)]"
                      : "border-border bg-muted/70 text-muted-foreground"
                } ${day.isBeyondPlanningLimit ? "pointer-events-none opacity-50" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className={`text-[11.5px] font-semibold ${day.isToday ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                      {dayjs(day.date).format("MMM")}
                    </p>
                    <p className="mt-1 text-2xl font-semibold leading-none">{dayjs(day.date).format("DD")}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${day.isToday ? "bg-primary-foreground/15 text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {day.jobs.length}
                  </span>
                </div>

                <div className="mt-4 space-y-2">
                  <div className={`h-1.5 overflow-hidden rounded-full ${day.isToday ? "bg-primary-foreground/15" : "bg-muted"}`}>
                    <div
                      className={`h-full rounded-full ${day.blocked ? "bg-rose-500" : day.scheduled ? "bg-emerald-500" : stageTheme.fill}`}
                      style={{ width: `${Math.min(100, Math.max(8, day.jobs.length * 14))}%` }}
                    />
                  </div>
                  <div className={`grid grid-cols-3 gap-1 text-[10px] ${day.isToday ? "text-primary-foreground/75" : "text-muted-foreground"}`}>
                    <span>{day.scheduled} planned</span>
                    <span>{day.unscheduled} queue</span>
                    <span className={day.blocked ? "font-semibold text-signal-rose-ink" : ""}>{day.blocked} blocked</span>
                  </div>
                </div>

                <div className="mt-3 space-y-1">
                  {day.jobs.slice(0, 3).map((job: any) => (
                    <div
                      key={job.id || job.job_card_id || job.segment_id}
                      className={`truncate rounded-lg px-2 py-1.5 text-[10px] font-semibold ${
                        day.isToday ? "bg-primary-foreground/12 text-primary-foreground" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {jobCardRef(job)} · {String(job.current_stage || "-").toUpperCase()}
                    </div>
                  ))}
                  {day.jobs.length > 3 ? (
                    <p className={`text-[10px] font-semibold ${day.isToday ? "text-primary-foreground/55" : "text-muted-foreground"}`}>
                      {day.jobs.length - 3} more jobs
                    </p>
                  ) : null}
                </div>

                <div className={`mt-3 text-[11.5px] font-semibold ${day.isToday ? "text-primary-foreground/50" : "text-muted-foreground"}`}>
                  {dominantStage || (day.isBeyondPlanningLimit ? "Beyond 3 months" : "Open day")}
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )

  if (loading) {
    return (
      <div data-testid="planner-page">
        <LoadingState label="Loading planner workspace..." />
      </div>
    )
  }

  if (loadFailed) {
    return (
      <div data-testid="planner-page">
        <ErrorState
          title="Planner workspace could not be loaded"
          message="Machine queues and calendar slots are unavailable. This is not an empty board."
          onRetry={() => {
            void board0.refetch()
            void board1.refetch()
            void board2.refetch()
            void jobsQuery.refetch()
          }}
        />
      </div>
    )
  }

  if (needsConcretePlant || requiresExplicitPlant) {
    return (
      <div data-testid="planner-page" className={`rounded-xl border bg-gradient-to-br ${stageTheme.tint} p-6 shadow-[0_18px_52px_rgba(15,23,42,0.07)]`}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className={`inline-flex rounded-full border px-3 py-1 text-[11.5px] font-semibold ${stageTheme.pill}`}>
              Plant required
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">Select one plant before scheduling</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Planner boards are machine, shift, and capacity specific. Global `ALL` view is available for analytics/tracker,
              but scheduling needs one concrete plant so queues and machine rows do not disappear or mix capacity.
            </p>
          </div>
          <div className="rounded-[1.25rem] border border-border/80 bg-card/85 p-4 shadow-sm">
            <p className="mb-3 text-[12px] font-semibold text-muted-foreground">Change scope</p>
            <PlantSwitcher />
          </div>
        </div>
      </div>
    )
  }

  if (isSummaryView) {
    return (
      <div className="space-y-3 pb-3" data-testid="planner-page">
        <section className={`overflow-hidden rounded-[1.45rem] border bg-gradient-to-br ${stageTheme.tint} px-4 py-3 shadow-[0_18px_52px_rgba(15,23,42,0.07)]`}>
          <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div>
              <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11.5px] font-semibold ${stageTheme.pill}`}>
                <Layers3 className="h-3.5 w-3.5" />
                Summary board
              </div>
              <h1 className="mt-2 text-[1.7rem] font-semibold tracking-tight text-foreground">
                Live production standing across the last 6 days
              </h1>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
                One planner view for owner and planner: active WIP by stage, stuck jobs, due pressure, scheduled vs unscheduled work, and what needs action before floor entry.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-5 2xl:w-[52rem]">
              {[
                ["Active WIP", activeJobCards.length, "Not completed"],
                ["Completed", completedJobCards.length, "Closed history"],
                ["Blocked", activeJobCards.filter((job: any) => Boolean(job.blocked_reason) || !job.planner_gate_ready).length, "Needs action"],
                ["Priority (3 plant days)", activeJobCards.filter((job: any) => classifyDueRisk(job.due_date) === DUE_RISK_PRIORITY).length, "Today through today+2"],
                ["Overdue", activeJobCards.filter((job: any) => classifyDueRisk(job.due_date) === DUE_RISK_OVERDUE).length, "Due before today"],
              ].map(([label, value, hint]) => (
                <div key={String(label)} className="rounded-xl border border-border/80 bg-card/85 px-3 py-2 shadow-sm">
                  <p className="text-[12px] font-semibold text-muted-foreground">{label}</p>
                  <p className="mt-1 text-xl font-semibold leading-none text-foreground">{value}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
            <label className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">Planning workspace
                <select aria-label="Planning workspace" value={section} className="h-10 rounded-lg border border-border bg-card px-3 text-foreground" onChange={event => {
                  const params = new URLSearchParams(searchParams?.toString())
                  params.delete("section")
                  const target = event.target.value
                  router.push(`/planning/${target === "summary" ? "overview" : target}?${params.toString()}`)
                }}>
                  {tabs.map(tab => <option key={tab.key} value={tab.key}>{tab.key === "summary" ? "Planning overview" : `${tab.key.charAt(0).toUpperCase()}${tab.key.slice(1)} planning`} · {stageCounts.get(tab.key) || 0}</option>)}
                </select>
              </label>
            <Link
              href={`/planning/print?section=winder&plan_date=${todayWindowDate}`}
              className="inline-flex items-center gap-2 rounded-[0.95rem] border border-border/80 bg-card/85 px-3 py-2 text-xs font-semibold text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-card"
            >
              Print scheduled plan
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {plannerControls}
        </section>

        <div className="grid gap-3 xl:grid-cols-[1fr_0.9fr]">
          <section className="rounded-[1.55rem] border border-border bg-card p-4 shadow-[0_18px_60px_rgba(15,23,42,0.06)]">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[11.5px] font-semibold text-muted-foreground">Last 6 days</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">Daily planning control</h2>
              </div>
              <p className="text-xs text-muted-foreground">Rows use plan date first, then due/created date when not scheduled.</p>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-3 2xl:grid-cols-6">
              {summaryDayRows.map((row) => (
                <div key={row.date} className="rounded-[1.2rem] border border-border bg-muted p-3">
                  <p className="text-[11.5px] font-semibold text-muted-foreground">{formatDate(row.date, "ddd DD")}</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{row.jobs.length}</p>
                  <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                    <p>{row.scheduled} scheduled</p>
                    <p>{row.unscheduled} unscheduled</p>
                    <p className={row.blocked ? "font-semibold text-signal-rose-ink" : ""}>{row.blocked} blocked</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[1.55rem] border border-border bg-card p-4 shadow-[0_18px_60px_rgba(15,23,42,0.06)]">
            <p className="text-[11.5px] font-semibold text-muted-foreground">Planner action list</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">What needs attention</h2>
            <div className="mt-4 space-y-2">
              {plannerActionJobs.map((job: any) => (
                  <div key={job.id || job.job_card_id} className="rounded-xl border border-border bg-muted px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{jobCardRef(job)}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{job.customer_name || "-"} · {job.current_stage || "-"}</p>
                      </div>
                      <span className="rounded-full border border-signal-rose-line bg-signal-rose-soft px-2 py-1 text-[10px] font-semibold text-signal-rose-ink">Action</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{job.blocked_reason || job.planner_gate_reason || "Due risk. Confirm schedule/output."}</p>
                  </div>
                ))}
              {plannerActionJobs.length === 0 ? <EmptyState label="No planner action needed." /> : null}
            </div>
          </section>
        </div>

        <section className="rounded-[1.55rem] border border-border bg-card p-4 shadow-[0_18px_60px_rgba(15,23,42,0.06)]">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11.5px] font-semibold text-muted-foreground">All steps</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">Stage-wise WIP and bottleneck board</h2>
            </div>
            <p className="text-xs text-muted-foreground">Use stage tabs above for actual drag/drop scheduling.</p>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3 2xl:grid-cols-4">
            {summaryStageRows.map((row) => (
              <div key={row.stage} className="rounded-[1.25rem] border border-border bg-muted p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11.5px] font-semibold text-muted-foreground">{row.stage}</p>
                    <p className="mt-1 text-2xl font-semibold text-foreground">{row.jobs.length}</p>
                  </div>
                  <div className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${row.blocked ? "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink" : "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink"}`}>
                    {row.blocked ? `${row.blocked} blocked` : "Flowing"}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                  <div className="rounded-lg bg-card px-2 py-1.5">
                    <p className="text-muted-foreground">Qty</p>
                    <p className="font-semibold text-foreground">{formatWhole(row.qty)}</p>
                  </div>
                  <div className="rounded-lg bg-card px-2 py-1.5">
                    <p className="text-muted-foreground">Due</p>
                    <p className="font-semibold text-foreground">{row.due}</p>
                  </div>
                  <div className="rounded-lg bg-card px-2 py-1.5">
                    <p className="text-muted-foreground">Jobs</p>
                    <p className="font-semibold text-foreground">{row.jobs.length}</p>
                  </div>
                </div>
                <div className="mt-3 space-y-1.5">
                  {row.jobs.slice(0, 4).map((job: any) => (
                    <div key={job.id || job.job_card_id} className="truncate rounded-lg bg-card px-2 py-1.5 text-[11px] text-muted-foreground">
                      <span className="font-semibold">{jobCardRef(job)}</span>
                      <span className="text-muted-foreground"> · </span>
                      <span>{job.customer_name || "-"}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    )
  }

  return (
    <>
      <div
        className="min-w-0 max-w-full space-y-3 overflow-x-hidden pb-3"
        data-testid="planner-page"
      >
        <section
          className={`shrink-0 overflow-hidden rounded-[1.45rem] border bg-gradient-to-br ${stageTheme.tint} px-4 py-2.5 shadow-[0_18px_52px_rgba(15,23,42,0.07)]`}
        >
          <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11.5px] font-semibold ${stageTheme.pill}`}>
                  <Layers3 className="h-3.5 w-3.5" />
                  Planning board
                </div>
                <div className="rounded-full border border-border/80 bg-card/80 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                  {formatDate(day0, "DD MMM")} - {formatDate(day2, "DD MMM")}
                </div>
              <div className="rounded-full border border-border/80 bg-card/80 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                {plannerShifts.map((shift: any) => shift.label || shift.code).join(" · ")}
              </div>
              {dayjs(startDate).isBefore(dayjs(), "day") ? (
                <div className="rounded-full border border-signal-amber-line bg-signal-amber-soft px-3 py-1 text-[11px] font-semibold text-signal-amber-ink">
                  Past window: check unfinished output
                </div>
              ) : null}
              </div>
              <div className="mt-2 flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="text-[11.5px] font-semibold text-muted-foreground">{meta.title}</p>
                  <h1 className="mt-1 text-[1.65rem] font-semibold tracking-tight text-foreground">
                    Machine scheduling across 3 days
                  </h1>
                </div>
                <p className="max-w-2xl text-xs leading-5 text-muted-foreground">{meta.subtitle}</p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-5 2xl:w-[45rem]">
              {heroMetricCards.map((card) => (
                <div key={card.label} className={`rounded-[1.05rem] border px-3 py-2 shadow-sm ring-1 ring-white/70 ${card.className}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-semibold opacity-70">{card.label}</p>
                    <card.icon className="h-3.5 w-3.5 opacity-70" />
                  </div>
                  <p className="mt-1 text-xl font-semibold leading-none">{card.value}</p>
                  <p className="mt-1 text-[10px] leading-4 opacity-75">{card.hint}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2 border-t border-border/70 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">Planning workspace
                <select aria-label="Planning workspace" value={section} className="h-10 rounded-lg border border-border bg-card px-3 text-foreground" onChange={event => {
                  const params = new URLSearchParams(searchParams?.toString())
                  params.delete("section")
                  const target = event.target.value
                  router.push(`/planning/${target === "summary" ? "overview" : target}?${params.toString()}`)
                }}>
                  {tabs.map(tab => <option key={tab.key} value={tab.key}>{tab.key === "summary" ? "Planning overview" : `${tab.key.charAt(0).toUpperCase()}${tab.key.slice(1)} planning`} · {stageCounts.get(tab.key) || 0}</option>)}
                </select>
              </label>
              <Link
                href={`/planning/print?section=${section}&plan_date=${startDate}`}
                className="inline-flex items-center gap-2 rounded-[0.95rem] border border-border/80 bg-card/85 px-3 py-2 text-xs font-semibold text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-card"
              >
                Print shop-floor plan
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              {focusedOrderId || focusedJobCardId ? (
                <div className={`rounded-full border px-3 py-2 text-xs font-semibold ${stageTheme.pill}`}>
                  Focused on {focusedJobCardId ? `job ${focusedJobCardId.slice(0, 8)}` : `order ${focusedOrderId.slice(0, 8)}`}
                </div>
              ) : null}
            </div>
            {plannerControls}
          </div>
        </section>

        <KeyboardScheduleForm
          jobs={queuedJobs}
          machines={machineRows}
          dates={[day0, day1, day2]}
          shifts={plannerShifts.map((shift: any) => ({ code: String(shift.code || ""), label: shift.label }))}
          selectedJob={keyboardJob}
          onSelectJob={setKeyboardJob}
          onSchedule={scheduleSegment}
          busy={moveCard.isPending}
        />

        {plannerView === "calendar" ? calendarBoard : (
        <div className="grid h-[calc(100vh-9rem)] min-h-[650px] min-w-0 gap-3 xl:grid-cols-[minmax(0,330px)_minmax(0,1fr)]">
          <aside className="min-h-0 min-w-0">
            <section className="flex h-full min-h-0 flex-col rounded-[1.65rem] border border-border bg-card p-3 shadow-[0_16px_45px_rgba(15,23,42,0.06)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[12px] font-semibold text-muted-foreground">Open queue</p>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                    {section === "winder" ? "Grouped by release hint" : "Shared stage backlog"}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {section === "winder"
                      ? "The release winder is a hint. Schedule on any available winder; capacity splits apply."
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
                            ? "border-primary bg-primary text-primary-foreground shadow-sm"
                            : "border-border bg-muted text-muted-foreground hover:-translate-y-0.5 hover:bg-card"
                        }`}
                      >
                        {option.label} · {option.count}
                      </button>
                    )
                  })}
                </div>
              ) : null}

              <div
                className={`mt-3 shrink-0 rounded-[1.1rem] border border-dashed bg-muted/80 px-3 py-3 text-xs text-muted-foreground transition-all ${
                  draggedJob ? `${stageTheme.border} ${stageTheme.dropRing}` : "border-border"
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
                    <div key={group.key} className="rounded-[1.25rem] border border-border bg-muted/75 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[12px] font-semibold text-muted-foreground">{group.title}</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">{group.subtitle}</p>
                        </div>
                        <div className="rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground">
                          {group.jobs.length}
                        </div>
                      </div>

                      <div className="mt-3 space-y-1.5">
                        {group.jobs.map((job: any) => {
                          const assignedMachine = machineStatsMap.get(String(job.assigned_winder_machine_id || ""))
                          const preferredCapacity = Number(
                            assignedMachine?.capacity_value || job.machine_capacity_value || 0,
                          )
                          const perShiftCapacity = preferredCapacity > 0 ? preferredCapacity : 0
                          const capacityNeed = capacityNeedFor(section, job)
                          const mustSplit = perShiftCapacity > 0 && capacityNeed > perShiftCapacity
                          const dueRisk = classifyDueRisk(job.due_date)
                          const dueSoon = dueRisk === DUE_RISK_PRIORITY
                          const overdue = dueRisk === DUE_RISK_OVERDUE

                          return (
                            <article
                              key={job.segment_id}
                              data-testid={`planner-card:${plannerJobCardId(job)}`}
                              draggable
                              tabIndex={0}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault()
                                  setKeyboardJob(job)
                                }
                              }}
                              onMouseEnter={(event) => showJobDetail(event, job, "Queue card")}
                              onMouseMove={(event) => showJobDetail(event, job, "Queue card")}
                              onMouseLeave={() => setHoverDetail(null)}
                              onDragStart={() => {
                                setHoverDetail(null)
                                setDraggedJob(job)
                              }}
                              onDragEnd={() => { setDraggedJob(null); setHoverSlot(null) }}
                              className={`group relative overflow-hidden rounded-[0.85rem] border bg-card px-2.5 py-1.5 transition-all duration-200 ${
                                draggedJob?.segment_id === job.segment_id
                                  ? `${stageTheme.border} ${stageTheme.dropRing}`
                                  : "border-border shadow-sm hover:-translate-y-0.5 hover:shadow-md"
                              }`}
                            >
                              <div className={`absolute inset-y-1.5 left-1.5 w-1 rounded-full bg-gradient-to-b ${stageTheme.accentBar}`} />
                              <div className="min-w-0 pl-3">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                                    <span data-testid={`planner-job-link:${plannerJobCardId(job)}`}>
                                      {jobCardRef(job)}
                                    </span>
                                  </p>
                                  <CarryForwardBadge job={job} />
                                  <StaleSlotBadge job={job} />
                                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">
                                    {formatWhole(job.segment_planned_qty)}
                                  </span>
                                  {mustSplit ? <span className="shrink-0 rounded-full bg-signal-rose-soft px-1.5 py-0.5 text-[9px] font-bold text-signal-rose-ink">Split</span> : null}
                                  {dueSoon ? <span className="shrink-0 rounded-full bg-signal-amber-soft px-1.5 py-0.5 text-[9px] font-bold text-signal-amber-ink">Priority</span> : null}
                                  {overdue ? <span className="shrink-0 rounded-full bg-signal-rose-soft px-1.5 py-0.5 text-[9px] font-bold text-signal-rose-ink">Overdue</span> : null}
                                  <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                </div>
                                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
                                  <span className="truncate font-semibold text-muted-foreground">{plannerSize(job)}</span>
                                  <span className="shrink-0 text-muted-foreground">|</span>
                                  <span className="truncate">{job.customer_name || "-"}</span>
                                  <span className="shrink-0 text-muted-foreground">|</span>
                                  <span className="truncate">
                                    {assignedMachine
                                      ? `Pref ${assignedMachine.code}`
                                      : section === "winder"
                                        ? "No winder selected"
                                        : "Free assignment"}
                                  </span>
                                </div>
                                <div className="mt-1 flex items-center justify-end gap-2 text-[10px] text-muted-foreground">
                                  {(stage === "WINDER" || stage === "PROCESS") && Number(job.segment_planned_qty || 0) > 1 ? (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        setSplitDialogJob(job)
                                        setSplitQty(String(Math.floor(Number(job.segment_planned_qty || 0) / 2)))
                                      }}
                                      className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground transition hover:bg-muted"
                                    >
                                      Split
                                    </button>
                                  ) : null}
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

          <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.65rem] border border-border bg-card shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
            <div className="shrink-0 border-b border-border px-4 py-2.5">
              <div className="flex flex-col gap-1.5 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="text-[11.5px] font-semibold text-muted-foreground">Schedule canvas</p>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                    Machine rows across {scheduledDays.length} days and {plannerShifts.length} shifts
                  </h2>
                </div>
                <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
                  Empty and scheduled machines stay visible; drag queue cards into exact machine-shift slots.
                </p>
              </div>
            </div>

            <div className="min-h-0 min-w-0 flex-1 overflow-auto">
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
                      className="rounded-[1.2rem] border border-border bg-muted px-4 py-3"
                    >
                      <p className="text-[12px] font-semibold text-muted-foreground">Plan day</p>
                      <p className="mt-1 text-base font-semibold text-foreground">{dayKey(entry.date)}</p>
                    </div>
                  ))}

                  <div className="rounded-[1.15rem] border border-border bg-muted px-4 py-3 text-sm font-semibold text-muted-foreground">
                    Machine lane
                  </div>
                  {shiftHeaders.map((header, index) => (
                    <div key={`${header.date}-${header.shift_code}-${index}`} className="rounded-[1.15rem] border border-border bg-muted px-3 py-3">
                      <p className="text-[11.5px] font-semibold text-muted-foreground">
                        {formatDate(header.date, "ddd DD MMM")}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-foreground">{header.shift_label}</p>
                    </div>
                  ))}

                  {machineRows.length === 0 ? (
                    <div
                      className="rounded-[1.4rem] border border-dashed border-border bg-muted px-4 py-10 text-center text-sm text-muted-foreground"
                      style={{ gridColumn: `span ${Math.max(shiftHeaders.length + 1, 2)}` }}
                    >
                      No machine rows are available for this stage yet.
                    </div>
                  ) : (
                    machineRows.map((machine) => (
                      <div key={machine.id} className="contents">
                        <div className="rounded-[1.4rem] border border-border bg-muted/85 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[12px] font-semibold text-muted-foreground">Machine</p>
                              <h3 className="mt-1 text-lg font-semibold text-foreground">{machine.code}</h3>
                              <p className="mt-1 text-xs text-muted-foreground">{machine.name}</p>
                            </div>
                            <div className="rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                              {machine.status}
                            </div>
                          </div>
                          <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                            <p>{machineCapacitySummary(machine)}</p>
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
                            const capacity = Number(lane.capacity_value || 0)
                            const alreadyHere = draggedJob && (lane.jobs || []).some((job: any) => job.segment_id === draggedJob.segment_id)
                            const dragNeed = draggedJob && !alreadyHere ? capacityNeedFor(section, draggedJob) : 0
                            const projected = Number(lane.current_load || 0) + dragNeed
                            const projectedRatio = capacity > 0 ? (projected / capacity) * 100 : 0
                            const fit: "none" | "ok" | "tight" | "over" | "blocked" = !draggedJob ? "none" : isBlockedMachine ? "blocked" : capacity <= 0 || dragNeed <= 0 ? "ok" : projectedRatio > 100 ? "over" : projectedRatio >= 85 ? "tight" : "ok"
                            const isHover = hoverSlot === flatIndex
                            const slotTarget = { machine_id: lane.machine_id || machine.id, plan_date: dayColumn.date, shift_code: lane.shift_code || null, sequence_no: (lane.jobs || []).length + 1 }

                            return (
                              <div
                                key={flatIndex}
                                data-fit={fit}
                                data-hover={isHover || undefined}
                                className={`planner-slot relative flex min-h-[210px] flex-col rounded-xl border p-3 transition-all duration-200 ${isBlockedMachine ? "bg-muted/80" : "bg-card"} ${fit === "none" ? "border-border" : ""}`}
                                onDragOver={(event) => { event.preventDefault(); if (hoverSlot !== flatIndex) setHoverSlot(flatIndex) }}
                                onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setHoverSlot((current) => (current === flatIndex ? null : current)) }}
                                onDrop={() => {
                                  setHoverSlot(null)
                                  if (isBlockedMachine) {
                                    setDraggedJob(null)
                                    showToast(`Cannot schedule on ${machine.code} while it is ${machine.status}.`, "error")
                                    return
                                  }
                                  if (fit === "over" && draggedJob) {
                                    setPendingDrop({ job: draggedJob, target: slotTarget, label: `${machine.code || machine.name} · ${dayjs(dayColumn.date).format("DD MMM")} · ${lane.shift_label || lane.shift_code || "shift"}`, overBy: projected - capacity, unit: lane.capacity_unit || capacityUnitFor(section) })
                                    setDraggedJob(null)
                                    return
                                  }
                                  void handleDrop(slotTarget)
                                }}
                              >
                                {draggedJob && isHover ? (
                                  <span className={`pointer-events-none absolute -top-2.5 left-3 z-10 rounded-full px-2 py-0.5 text-[10.5px] font-semibold shadow-sm animate-scale-in ${fit === "over" ? "bg-signal-rose-ink text-background" : fit === "tight" ? "bg-signal-amber-ink text-background" : fit === "blocked" ? "bg-muted-foreground text-background" : "bg-signal-emerald-ink text-background"}`}>
                                    {fit === "blocked" ? "Machine unavailable" : fit === "over" ? `Over by ${formatLoad(projected - capacity)} — will split` : capacity > 0 ? `Fits · ${Math.round(projectedRatio)}% after drop` : "Drop here"}
                                  </span>
                                ) : null}
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <p className="text-[11.5px] font-semibold text-muted-foreground">
                                      {lane.shift_label || lane.shift_code || "Shift"}
                                    </p>
                                    <p className="mt-1 text-xs text-muted-foreground">{dayjs(dayColumn.date).format("DD MMM")}</p>
                                  </div>
                                  {lane.warning ? <StatusBadge value="BLOCKED" label={lane.warning} /> : null}
                                </div>

                                <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-muted">
                                  {draggedJob && dragNeed > 0 && capacity > 0 ? (
                                    <div
                                      className={`planner-projection absolute inset-y-0 left-0 rounded-full ${projectedRatio > 100 ? "bg-signal-rose-ink/40" : projectedRatio >= 85 ? "bg-signal-amber-ink/40" : "bg-signal-emerald-ink/35"}`}
                                      style={{ width: `${Math.min(100, projectedRatio)}%` }}
                                    />
                                  ) : null}
                                  <div
                                    className={`relative h-2 rounded-full transition-[width] duration-500 ${
                                      ratio >= 100 ? "bg-rose-500" : ratio >= 85 ? "bg-amber-500" : stageTheme.fill
                                    }`}
                                    style={{ width: `${ratio}%` }}
                                  />
                                </div>

                                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                                  <span>
                                    {formatLoad(lane.current_load)} / {formatLoad(lane.capacity_value)} {lane.capacity_unit || ""}
                                  </span>
                                  <span>{Math.round(ratio)}%</span>
                                </div>

                                <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
                                  {(lane.jobs || []).map((job: any) => {
                                    const otherWinderUsed =
                                      stage === "WINDER" &&
                                      job.assigned_winder_machine_id &&
                                      lane.machine_id &&
                                      String(job.assigned_winder_machine_id) !== String(lane.machine_id)
                                    return (
                                    <article
                                      key={job.segment_id}
                                      data-testid={`planner-card:${plannerJobCardId(job)}`}
                                      draggable
                                      tabIndex={0}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                          event.preventDefault()
                                          setKeyboardJob(job)
                                        }
                                      }}
                                      onMouseEnter={(event) => showJobDetail(event, job, "Pinned card")}
                                      onMouseMove={(event) => showJobDetail(event, job, "Pinned card")}
                                      onMouseLeave={() => setHoverDetail(null)}
                                      onDragStart={() => {
                                        setHoverDetail(null)
                                        setDraggedJob(job)
                                      }}
                                      onDragEnd={() => { setDraggedJob(null); setHoverSlot(null) }}
                                      className={`group relative overflow-hidden rounded-lg border px-2 py-1 text-xs transition-all duration-200 ${
                                        draggedJob?.segment_id === job.segment_id
                                          ? `${stageTheme.border} bg-card ${stageTheme.dropRing}`
                                          : "border-border bg-muted hover:-translate-y-0.5 hover:bg-card hover:shadow-md"
                                      }`}
                                    >
                                      <div className={`absolute inset-y-1.5 left-1.5 w-1 rounded-full bg-gradient-to-b ${stageTheme.accentBar}`} />
                                      <div className="flex min-w-0 items-center gap-2 pl-3">
                                        <p className="min-w-0 flex-1 truncate font-semibold text-foreground">
                                          <span data-testid={`planner-job-link:${plannerJobCardId(job)}`}>
                                            {jobCardRef(job)}
                                          </span>
                                        </p>
                                        <CarryForwardBadge job={job} />
                                        <StaleSlotBadge job={job} />
                                        <span className="shrink-0 rounded-full bg-card px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                                          {formatWhole(job.segment_planned_qty)}
                                        </span>
                                        <MoveHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                      </div>
                                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 pl-3 text-[9px] text-muted-foreground">
                                        <span className="truncate font-semibold">{plannerSize(job)}</span>
                                        <span className="shrink-0 text-muted-foreground">|</span>
                                        <span className="truncate">{job.customer_name || "-"}</span>
                                        <span className="shrink-0 text-muted-foreground">|</span>
                                        <span>
                                          {stage === "WINDER"
                                            ? `${formatLoad(winderMeterLoad(job))} m`
                                            : `${formatWhole(job.target_bamboo_count)} bmb`}
                                        </span>
                                      </div>
                                      {otherWinderUsed ? (
                                        <div className="mt-0.5 pl-3">
                                          <span className="rounded-full bg-signal-amber-soft px-2 py-0.5 text-[12px] font-semibold text-signal-amber-ink">
                                            Other winder used
                                          </span>
                                        </div>
                                      ) : null}
                                    </article>
                                    )
                                  })}

                                  {(lane.jobs || []).length === 0 ? (
                                    <div
                                      className={`rounded-[1.05rem] border border-dashed px-3 py-6 text-center text-xs text-muted-foreground ${
                                        isBlockedMachine
                                          ? "border-border bg-muted"
                                          : `${stageTheme.border} bg-muted/70`
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
        )}
      </div>

      {hoverDetail ? (
        <div
          className="pointer-events-none fixed z-[80] w-[380px] rounded-[1.35rem] border border-border bg-card/95 p-4 text-muted-foreground shadow-[0_28px_80px_rgba(15,23,42,0.22)] ring-1 ring-white/80 backdrop-blur-xl transition-opacity duration-150"
          data-testid="planner-hover-popover"
          style={{ left: hoverDetail.x, top: hoverDetail.y }}
        >
          <div
            className={`absolute top-8 h-3 w-3 rotate-45 border-b border-l border-border bg-card ${
              hoverDetail.placement === "right" ? "-left-1.5" : "-right-1.5 border-l-0 border-r"
            }`}
          />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11.5px] font-semibold text-muted-foreground">{hoverDetail.label} details</p>
              <p className="mt-1 truncate text-xl font-semibold tracking-tight text-foreground">
                {jobCardRef(hoverDetail.job)}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{hoverDetail.job.customer_name || "-"}</p>
            </div>
            <div className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${stageTheme.pill}`}>
              {String(hoverDetail.job.current_stage || stage).toUpperCase()}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-border bg-muted p-2">
              <p className="text-[12px] text-muted-foreground">Tubes</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{formatWhole(hoverDetail.job.segment_planned_qty)}</p>
            </div>
            <div className="rounded-xl border border-border bg-muted p-2">
              <p className="text-[12px] text-muted-foreground">{stage === "WINDER" ? "Meters" : "Bamboo"}</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {stage === "WINDER" ? `${formatLoad(winderMeterLoad(hoverDetail.job))} m` : formatWhole(hoverDetail.job.target_bamboo_count)}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-muted p-2">
              <p className="text-[12px] text-muted-foreground">Weight</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{formatOne(hoverDetail.job.planned_weight_kg)} kg</p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs leading-5 text-muted-foreground">
            <p className="col-span-2"><span className="font-semibold text-foreground">Product:</span> {hoverDetail.job.product_code || hoverDetail.job.spec_reference || "-"}</p>
            <p className="col-span-2"><span className="font-semibold text-foreground">Size:</span> {plannerSize(hoverDetail.job)}</p>
            <p><span className="font-semibold text-foreground">Tube wt:</span> {formatOne(hoverDetail.job.tube_weight_g || hoverDetail.job.target_tube_weight)} g</p>
            <p><span className="font-semibold text-foreground">PCS/bamboo:</span> {formatWhole(hoverDetail.job.pcs_per_bamboo)}</p>
            <p><span className="font-semibold text-foreground">Tube load:</span> {formatOne(hoverDetail.job.bamboo_weight_kg)} kg</p>
            <p><span className="font-semibold text-foreground">CS:</span> {formatOne(hoverDetail.job.required_cs)}</p>
            <p className="col-span-2">
              <span className="font-semibold text-foreground">Bamboo:</span>{" "}
              {formatWhole(hoverDetail.job.selected_bamboo_length_mm)} mm · usable {formatWhole(hoverDetail.job.usable_length_mm)} mm
            </p>
            <p><span className="font-semibold text-foreground">Due:</span> {formatDate(hoverDetail.job.due_date)}</p>
            <p><span className="font-semibold text-foreground">Status:</span> {hoverDetail.job.segment_status || hoverDetail.job.status || "PLANNED"}</p>
          </div>
        </div>
      ) : null}

      <Dialog open={Boolean(pendingDrop)} onOpenChange={(open) => !open && setPendingDrop(null)}>
        <DialogContent className="sm:max-w-md" data-testid="planner-capacity-confirm">
          <DialogHeader>
            <DialogTitle>Slot will be over capacity</DialogTitle>
            <DialogDescription>
              {pendingDrop ? `${jobCardRef(pendingDrop.job)} needs more than ${pendingDrop.label} has left — over by ${formatLoad(pendingDrop.overBy)} ${pendingDrop.unit}. The planner keeps what fits here and splits the rest into the next shift.` : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className="erp-btn-secondary" onClick={() => setPendingDrop(null)}>Choose another slot</button>
            <button type="button" className="erp-btn-primary" onClick={() => { const drop = pendingDrop; setPendingDrop(null); if (drop) void scheduleSegment(drop.job, drop.target) }}>Schedule and split</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              <div className="rounded-2xl border border-border bg-muted p-4 text-sm text-muted-foreground">
                <p className="font-semibold text-foreground">{jobCardRef(splitDialogJob)}</p>
                <p className="mt-1">Current segment qty {Number(splitDialogJob.segment_planned_qty || 0).toFixed(0)} pcs</p>
                <p className="mt-1">Current required capacity {formatLoad(splitDialogJob.required_capacity)}</p>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-muted-foreground">Primary segment qty</label>
                <input
                  type="number"
                  min="1"
                  max={Math.max(1, Number(splitDialogJob.segment_planned_qty || 0) - 1)}
                  value={splitQty}
                  onChange={(event) => setSplitQty(event.target.value)}
                  className="h-11 w-full rounded-xl border border-border px-3 text-sm"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <button
              type="button"
              onClick={() => setSplitDialogJob(null)}
              className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-muted-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSplit}
              disabled={splitSegment.isPending}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              Confirm split
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
