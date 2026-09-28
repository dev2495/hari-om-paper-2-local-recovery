"use client"

import Link from "next/link"
import dayjs from "dayjs"
import type { MouseEvent } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
  Search,
  Settings2,
  TimerReset,
} from "lucide-react"
import { PlannerCalendar } from "@/components/planning/planner-calendar"
import { CustomerCommitments } from "@/components/planning/customer-commitments"
import { ScheduleBoard, type BoardTarget, type CardAction } from "@/components/planning/schedule-board"
import { FloatingWorkload } from "@/components/planning/floating-workload"
import { workloadMachine, type WorkloadGrouping } from "@/lib/planner-workload"
import { ColorChip, JobCardNo, swatchFor } from "@/components/production/lifecycle-chips"
import { JobCardLifecycleSheet } from "@/components/production/job-card-lifecycle-sheet"
import { useMissedSlotSweep } from "@/hooks/use-lifecycle"
import { usePrefetchPlanningWindow } from "@/hooks/use-production"

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

/** Where a date sits in the month calendar (queue column + 7x6 grid), as a transform origin. */
function monthCellOrigin(date: string) {
  const day = dayjs(date)
  const first = day.startOf("month")
  const gridStart = first.subtract((first.day() + 6) % 7, "day")
  const index = Math.max(0, day.diff(gridStart, "day"))
  const col = index % 7
  const row = Math.floor(index / 7)
  const x = 28 + ((col + 0.5) / 7) * 72
  const y = 12 + ((row + 0.5) / 6) * 80
  return `${x.toFixed(1)}% ${Math.min(95, y).toFixed(1)}%`
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
  const [queueMachine, setQueueMachine] = useState<string | null>(null)
  const [workloadGrouping, setWorkloadGrouping] = useState<WorkloadGrouping>("release")
  const [hoverDetail, setHoverDetail] = useState<HoverDetail | null>(null)
  const [dateDraft, setDateDraft] = useState("")
  const [queueSearch, setQueueSearch] = useState("")
  const [queueSort, setQueueSort] = useState<"due" | "qty" | "age">("due")
  const [sheetJobId, setSheetJobId] = useState<string | null>(null)
  const [sheetAction, setSheetAction] = useState<"split" | "emergency" | "edit" | "force_close" | null>(null)
  useMissedSlotSweep()

  const section = String(sectionOverride || searchParams?.get("section") || "winder").toLowerCase()
  const isSummaryView = section === "summary"
  // Landing (bare /planning/board) opens the month calendar; deep links with a section/date open the 3-day board.
  const bareLanding = !sectionOverride && !searchParams?.get("section") && !searchParams?.get("plan_date") && !searchParams?.get("order_id") && !searchParams?.get("job_card_id")
  const plannerView = String(searchParams?.get("view") || (bareLanding ? "calendar" : "schedule")).toLowerCase() === "calendar" ? "calendar" : "schedule"
  const stage = isSummaryView ? "WINDER" : SECTION_STAGE_MAP[section] || "WINDER"
  useEffect(() => { setQueueMachine(null); setWorkloadGrouping("release") }, [stage, activePlant])
  const startDate = searchParams?.get("plan_date") || dayjs().format("YYYY-MM-DD")
  const focusedOrderId = String(searchParams?.get("order_id") || "")
  const focusedJobCardId = String(searchParams?.get("job_card_id") || "")
  const scopedPlantId = activePlant === "ALL" ? undefined : activePlant || undefined
  const needsConcretePlant = activePlant === "ALL"
  const canQuery = !authLoading && Boolean(user) && !needsConcretePlant

  // Board window: 2 days by default (bigger, easier to plan), 3 on request.
  const windowDays = searchParams?.get("days") === "3" ? 3 : 2
  const day0 = dayjs(startDate).format("YYYY-MM-DD")
  const day1 = dayjs(startDate).add(1, "day").format("YYYY-MM-DD")
  const day2 = dayjs(startDate).add(2, "day").format("YYYY-MM-DD")
  const previousWindowDate = dayjs(startDate).subtract(windowDays, "day").format("YYYY-MM-DD")
  const todayWindowDate = dayjs().format("YYYY-MM-DD")
  const nextWindowDate = dayjs(startDate).add(windowDays, "day").format("YYYY-MM-DD")
  const maxPlannerDate = dayjs().add(3, "month").format("YYYY-MM-DD")
  const monthStartDate = dayjs(startDate).startOf("month").format("YYYY-MM-DD")
  const previousMonthDate = dayjs(startDate).subtract(1, "month").startOf("month").format("YYYY-MM-DD")
  const nextMonthDate = dayjs(startDate).add(1, "month").startOf("month").format("YYYY-MM-DD")

  const boardHref = useCallback((next: { section?: string; date?: string; view?: string; days?: number } = {}) => {
    const params = new URLSearchParams()
    if ((next.days ?? windowDays) === 3) params.set("days", "3")
    params.set("section", next.section || section)
    params.set("plan_date", next.date || startDate)
    params.set("view", (next.view || plannerView) === "calendar" ? "calendar" : "schedule")
    if (focusedOrderId) params.set("order_id", focusedOrderId)
    if (focusedJobCardId) params.set("job_card_id", focusedJobCardId)
    if (sectionOverride) {
      const target = next.section || section
      params.delete("section")
      return `/planning/${target === "summary" ? "overview" : target}?${params.toString()}`
    }
    return `/planning/board?${params.toString()}`
  }, [focusedJobCardId, focusedOrderId, plannerView, section, startDate, sectionOverride, windowDays])

  // ---- zoom between the month calendar and the 3-day board -------------------------------
  // The motion is decided once per view/window (a key), so later re-renders never cut it off.
  const viewKey = plannerView === "schedule" ? `schedule:${day0}` : `calendar:${monthStartDate}`
  const lastView = useRef<{ key: string; view: string; day0: string } | null>(null)
  const motion = useRef<{ key: string; className: string; origin: string; recentWindow: string | null }>({ key: "", className: "", origin: "50% 50%", recentWindow: null })
  if (motion.current.key !== viewKey) {
    const previous = lastView.current
    let className = ""
    let origin = "50% 40%"
    let recentWindow: string | null = null
    if (previous && previous.key !== viewKey) {
      if (previous.view !== plannerView) {
        recentWindow = plannerView === "calendar" ? previous.day0 : null
        className = plannerView === "schedule" ? "planner-zoom-in" : "planner-zoom-out"
        origin = monthCellOrigin(plannerView === "schedule" ? day0 : previous.day0)
      } else if (plannerView === "schedule") {
        className = day0 > previous.day0 ? "planner-slide-next" : "planner-slide-prev"
      } else {
        className = "planner-slide-" + (monthStartDate > dayjs(previous.day0).startOf("month").format("YYYY-MM-DD") ? "next" : "prev")
      }
    }
    motion.current = { key: viewKey, className, origin, recentWindow }
  }
  useEffect(() => {
    lastView.current = { key: viewKey, view: plannerView, day0 }
  }, [viewKey, plannerView, day0])
  const dialogOpen = Boolean(sheetJobId || pendingDrop || splitDialogJob)
  useEffect(() => {
    if (plannerView !== "schedule") return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || dialogOpen || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target && (target.closest("input, textarea, select, [contenteditable=true]") || target.closest("[role=dialog]"))) return
      router.push(boardHref({ view: "calendar" }), { scroll: false })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [boardHref, dialogOpen, plannerView, router])
  const prefetchWindow = usePrefetchPlanningWindow()
  const prefetchFrom = useCallback((date: string) => {
    if (!canQuery) return
    const start = dayjs(date)
    prefetchWindow(stage, [0, 1, 2].map((offset) => start.add(offset, "day").format("YYYY-MM-DD")), scopedPlantId)
  }, [canQuery, prefetchWindow, scopedPlantId, stage])

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

  const visibleQueueGroups = useMemo(() => {
    const needle = queueSearch.trim().toLowerCase()
    return queueGroups
      .map((group) => ({
        ...group,
        jobs: group.jobs
          .filter((job: any) => !queueMachine || workloadMachine(job, stage, workloadGrouping) === queueMachine)
          .filter((job: any) =>
            !needle ||
            [job.job_card_no, job.job_card_ref, job.customer_name, job.product_code, job.product_size_label, job.parchment_color, job.sales_order_ref]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(needle),
          )
          .sort((a: any, b: any) => {
            if (a.is_emergency !== b.is_emergency) return a.is_emergency ? -1 : 1
            if (queueSort === "qty") return Number(b.segment_planned_qty || 0) - Number(a.segment_planned_qty || 0)
            if (queueSort === "age") return String(a.created_at || "").localeCompare(String(b.created_at || ""))
            return String(a.due_date || "9999").localeCompare(String(b.due_date || "9999"))
          }),
      }))
      .filter((group) => group.jobs.length > 0)
  }, [queueMachine, workloadGrouping, stage, queueGroups, queueSearch, queueSort])

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
  // Full-page loader only on the very first load; moving windows keeps the last board visible.
  const loading = jobsQuery.isLoading || [board0, board1, board2].some((board) => board.isLoading && !board.data)
  const windowRefreshing = [board0, board1, board2].some((board) => board.isPlaceholderData || (board.isFetching && !board.isLoading))
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
                  capacity_value: null,
                  capacity_unit: machine.capacity_unit,
                  batch_bamboo_capacity: machine.batch_bamboo_capacity,
                  cycle_time_hours: machine.cycle_time_hours,
                  current_load: 0,
                  warning: "No verified shift capacity returned for this slot",
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
      machine.dayColumns.filter((column: any) => [day0, day1, day2].slice(0, windowDays).includes(column.date)).flatMap((dayColumn: any) => dayColumn.shifts || []),
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
  }, [machineRows, machineStatsMap, queuedJobs, section, day0, day1, day2, windowDays])

  const heroMetricCards = [
    {
      label: "Open queue",
      value: queuedJobs.length,
      hint: `${section === "winder" ? formatLoad(plannerMetrics.queueLoad) : formatWhole(plannerMetrics.queueLoad)} ${capacityUnitFor(section)} waiting`,
      className: "border-signal-cyan-line bg-signal-cyan-soft/90 text-signal-cyan-ink",
      icon: Layers3,
    },
    {
      label: "Queued pieces",
      value: `${formatWhole(plannerMetrics.queueTubes)} pcs`,
      hint: `${formatOne(plannerMetrics.queueWeight)} kg pending`,
      className: "border-signal-blue-line bg-signal-blue-soft/90 text-signal-blue-ink",
      icon: Factory,
    },
    {
      label: "Scheduled load",
      value: `${formatWhole(plannerMetrics.scheduledLoad)} ${capacityUnitFor(section)}`,
      hint: `${windowDays}-day visible board; nominal capacity depends on available machines and shifts`,
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

  const moveInFlight = useRef(false)
  async function scheduleSegment(job: any, target: DropTarget) {
    if (!job || moveInFlight.current) return
    moveInFlight.current = true
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
      moveInFlight.current = false
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

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
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
        {/* One slim toolbar: stage, view, window, live figures. The board gets the rest of the screen. */}
        <section className="sticky top-0 z-30 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/95 px-3 py-2 shadow-sm backdrop-blur" data-testid="planner-toolbar">
          <label className="sr-only" htmlFor="planner-stage">Planning workspace</label>
          <select id="planner-stage" aria-label="Planning workspace" value={section} className="h-8 rounded-lg border border-border bg-card px-2 text-[13px] font-semibold text-foreground" onChange={event => {
            const params = new URLSearchParams(searchParams?.toString())
            params.delete("section")
            const target = event.target.value
            router.push(`/planning/${target === "summary" ? "overview" : target}?${params.toString()}`)
          }}>
            {tabs.map(tab => <option key={tab.key} value={tab.key}>{tab.key === "summary" ? "Planning overview" : `${tab.key.charAt(0).toUpperCase()}${tab.key.slice(1)} planning`} · {stageCounts.get(tab.key) || 0}</option>)}
          </select>
          <div className="tube-segment !h-8" role="group" aria-label="Planner view">
            <Link href={boardHref({ view: "calendar" })} aria-current={plannerView === "calendar" ? "page" : undefined} className="inline-flex items-center px-3">Month</Link>
            <Link href={boardHref({ view: "schedule" })} aria-current={plannerView === "schedule" ? "page" : undefined} className="inline-flex items-center px-3">Board</Link>
          </div>
          {plannerView === "schedule" ? (
            <>
              <div className="flex items-center gap-1">
                <Link href={boardHref({ date: previousWindowDate, view: "schedule" })} className="tube-icon-button !h-8 !w-8" aria-label={`Previous ${windowDays} days`}><ChevronLeft size={16} /></Link>
                <span className="min-w-[9.5rem] text-center text-[13px] font-semibold tabular-nums" data-testid="planner-window">
                  {dayjs(day0).format("ddd D")} – {dayjs(windowDays === 3 ? day2 : day1).format("ddd D MMM")}
                </span>
                <Link href={boardHref({ date: dayjs(nextWindowDate).isAfter(dayjs(maxPlannerDate), "day") ? maxPlannerDate : nextWindowDate, view: "schedule" })} className="tube-icon-button !h-8 !w-8" aria-label={`Next ${windowDays} days`}><ChevronRight size={16} /></Link>
                <Link href={boardHref({ date: todayWindowDate, view: "schedule" })} className="erp-btn-secondary !h-8 !px-2.5 text-[12px]">Today</Link>
              </div>
              <div className="tube-segment !h-8" role="group" aria-label="Days shown">
                <Link href={boardHref({ days: 2 })} aria-current={windowDays === 2 ? "page" : undefined} className="inline-flex items-center px-2.5">2 days</Link>
                <Link href={boardHref({ days: 3 })} aria-current={windowDays === 3 ? "page" : undefined} className="inline-flex items-center px-2.5">3 days</Link>
              </div>
              <input type="date" aria-label="Jump to date" value={dateDraft} max={maxPlannerDate} onChange={(event) => { setDateDraft(event.target.value); if (event.target.value) router.push(boardHref({ date: event.target.value, view: "schedule" })) }} className="h-8 rounded-lg border border-border bg-card px-2 text-[12px]" />
            </>
          ) : null}
          {dayjs(startDate).isBefore(dayjs(), "day") && plannerView === "schedule" ? (
            <span className="rounded-full border border-signal-amber-line bg-signal-amber-soft px-2 py-0.5 text-[11px] font-semibold text-signal-amber-ink">Past window</span>
          ) : null}
          {focusedOrderId || focusedJobCardId ? (
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${stageTheme.pill}`}>Focused on {focusedJobCardId ? "one job card" : "one order"}</span>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-1.5 text-[11.5px]">
            {heroMetricCards.filter(card => ["Open queue", "Scheduled load", "Priority (3 plant days)"].includes(card.label)).map((card) => (
              <span key={card.label} title={card.hint} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold ${card.className}`}>
                <card.icon className="h-3 w-3 opacity-70" />{card.label} <span className="tabular-nums">{card.value}</span>
              </span>
            ))}
            <Link href={`/planning/print?section=${section}&plan_date=${startDate}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground">
              Print<ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {plannerView === "schedule" ? <span className="hidden basis-full text-[11px] text-muted-foreground xl:block">Drag cards onto a machine and shift · card actions: manage, edit, split · drag a placed card back to the queue to unschedule · Esc returns to the month</span> : null}
        </section>



        {plannerView === "schedule" ? <FloatingWorkload key={`${stage}:${activePlant}`} jobs={queuedJobs} stage={stage} scope={String(activePlant)} machineLabel={(id) => machineLabelMap.get(id) || id.slice(0, 8)} selected={queueMachine} grouping={workloadGrouping} onGrouping={setWorkloadGrouping} onSelect={setQueueMachine} refreshing={windowRefreshing} /> : null}
        {plannerView === "schedule" ? <CustomerCommitments dateFrom={day0} dateTo={windowDays === 3 ? day2 : day1} onDate={date => router.push(boardHref({ date, view: "schedule" }))} /> : null}
        <div key={viewKey} className={motion.current.className} style={{ transformOrigin: motion.current.origin }} data-testid="planner-view" data-view={plannerView}>
        {plannerView === "calendar" ? (
          <PlannerCalendar
            key={`${stage}:${activePlant}`}
            stage={stage}
            scope={String(activePlant)}
            jobs={allJobCards}
            queueEntries={queuedJobs}
            workloadLabel={(id) => machineLabelMap.get(id) || id.slice(0, 8)}
            machines={machineRows.map((machine: any) => ({ id: String(machine.id), code: String(machine.code || machine.name || ""), capacity_value: machine.capacity_value, capacity_unit: machine.capacity_unit, status: machine.status }))}
            monthDate={startDate}
            maxPlannerDate={maxPlannerDate}
            hrefFor={(next) => boardHref(next)}
            onOpenCard={(id, action) => { setSheetAction(action || null); setSheetJobId(id) }}
            onPrefetchWindow={prefetchFrom}
            onZoom={(date) => router.push(boardHref({ date, view: "schedule" }), { scroll: false })}
            recentWindow={motion.current.recentWindow}
            windowDays={windowDays}
          />
        ) : (
        <ScheduleBoard
          days={[day0, day1, day2].slice(0, windowDays)}
          shifts={plannerShifts.map((shift: any) => ({ code: String(shift.code || ""), label: shift.label }))}
          machines={machineRows as any}
          queueGroups={visibleQueueGroups}
          queueTotal={queuedJobs.length}
          queueSearch={queueSearch}
          onQueueSearch={setQueueSearch}
          queueSort={queueSort}
          onQueueSort={setQueueSort}
          queueFilterLabel={queueMachine ? (queueMachine === "unassigned" ? "Unassigned" : machineLabelMap.get(queueMachine) || queueMachine.slice(0, 8)) : undefined}
          onClearQueueFilter={() => setQueueMachine(null)}
          machineLabel={(id) => machineLabelMap.get(id) || id.slice(0, 8)}
          loadOf={(job) => capacityNeedFor(section, job)}
          unit={capacityUnitFor(section)}
          busy={moveCard.isPending || windowRefreshing}
          onSchedule={(job, target: BoardTarget) => void scheduleSegment(job, target)}
          onOverCapacity={(job, target: BoardTarget, label, overBy, unitLabel) => setPendingDrop({ job, target, label, overBy, unit: unitLabel })}
          onAction={(job, action: CardAction) => {
            if (action === "segment_split") { setSplitDialogJob(job); setSplitQty(""); return }
            setSheetAction(action === "manage" ? null : action)
            setSheetJobId(String(job.job_card_id || job.id))
          }}
          keyboardForm={
            <KeyboardScheduleForm
              jobs={queuedJobs}
              machines={machineRows}
              dates={[day0, day1, day2].slice(0, windowDays)}
              shifts={plannerShifts.map((shift: any) => ({ code: String(shift.code || ""), label: shift.label }))}
              selectedJob={keyboardJob}
              onSelectJob={setKeyboardJob}
              onSchedule={scheduleSegment}
              busy={moveCard.isPending}
            />
          }
        />
        )}
        </div>
      </div>

      <JobCardLifecycleSheet jobCardId={sheetJobId} initialAction={sheetAction} open={Boolean(sheetJobId)} onOpenChange={(next) => { if (!next) { setSheetJobId(null); setSheetAction(null) } }} />

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
