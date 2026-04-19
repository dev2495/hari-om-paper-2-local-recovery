"use client"

import Link from "next/link"
import dayjs from "dayjs"
import { AlertTriangle, ArrowRight, CalendarClock, Factory, Layers3, Package2, TimerReset, Truck } from "lucide-react"
import { Suspense, useEffect, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { PlantSwitcher } from "@/components/PlantSwitcher"
import { ExecutiveHero, MetricCard, MetricRail, Panel, StatusBadge } from "@/components/erp/shell"
import { useAuth } from "@/context/AuthContext"
import { usePlanningBoard, usePlanningJobCards } from "@/hooks/use-production"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"

function metric(value: any) {
  const numeric = Number(value || 0)
  return Number.isFinite(numeric) ? numeric.toFixed(0) : "0"
}

function stageLabel(stage: string) {
  return String(stage || "").replace(/_/g, " ")
}

function compactUnitLabel(value: string | undefined) {
  return String(value || "TUBES_PER_DAY").replace(/_PER_DAY/g, "").replace(/_/g, " ").toLowerCase()
}

const SECTION_META = {
  WINDER: { title: "Winder board", subtitle: "Machine + shift scheduling for winding", href: "/planning/board?section=winder" },
  OVEN: { title: "Oven board", subtitle: "Batch loading and curing flow", href: "/planning/board?section=oven" },
  PROCESS: { title: "Process board", subtitle: "Finishing lanes and downstream readiness", href: "/planning/board?section=process" },
  SLITTING: { title: "Slitting board", subtitle: "Only use when inward needs reel conversion", href: "/planning/board?section=slitting" },
} as const

type StageCard = {
  stage: string
  jobs: number
  load: number
  unit: string
  overloaded: number
}

function PlanningLandingPageContent() {
  const { activePlant, user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const scopedPlantId = activePlant === "ALL" ? undefined : activePlant || undefined
  const needsConcretePlant = activePlant === "ALL"
  const selectedDate = dayjs().format("YYYY-MM-DD")
  const canQuery = !authLoading && !!user && !needsConcretePlant
  const { data: boardData, isLoading } = usePlanningBoard(undefined, selectedDate, true, scopedPlantId, canQuery)
  const { data: jobCards = [] } = usePlanningJobCards({ limit: 250 }, canQuery)

  useEffect(() => {
    const params = new URLSearchParams(searchParams?.toString() || "")
    if (!params.has("order_id") && !params.has("job_card_id")) return
    const nextParams = new URLSearchParams(params)
    if (!nextParams.has("section")) {
      nextParams.set("section", "winder")
    }
    router.replace(`/planning/board?${nextParams.toString()}`)
  }, [router, searchParams])

  const stages = Array.isArray((boardData as any)?.stages) ? (boardData as any).stages : []
  const suggestions = Array.isArray((boardData as any)?.suggestions) ? (boardData as any).suggestions : []
  const summary = (boardData as any)?.summary || {}
  const openCards = Array.isArray(jobCards)
    ? jobCards.filter((row: any) => String(row.status || "").toUpperCase() !== "COMPLETED")
    : []

  const blockedCards = openCards.filter((row: any) => {
    const stage = String(row.current_stage || "").toUpperCase()
    const qualityHold = Array.isArray(row?.quality_holds) && row.quality_holds.length > 0
    return qualityHold || stage === "QC"
  })
  const dueRiskCards = openCards.filter((row: any) => {
    const dueDate = row?.due_date || row?.spec_snapshot?.sales_order_line_due_date
    return dueDate ? dayjs(dueDate).isBefore(dayjs().add(1, "day"), "day") : false
  })
  const dispatchReadyCards = openCards.filter((row: any) => String(row.current_stage || "").toUpperCase() === "DISPATCH")
  const wipAging = useMemo(() => {
    const buckets = { "0-2d": 0, "3-7d": 0, "8d+": 0 }
    openCards.forEach((row: any) => {
      const createdAt = row?.created_at ? dayjs(row.created_at) : null
      const age = createdAt ? dayjs().diff(createdAt, "day") : 0
      if (age <= 2) buckets["0-2d"] += 1
      else if (age <= 7) buckets["3-7d"] += 1
      else buckets["8d+"] += 1
    })
    return Object.entries(buckets).map(([name, value]) => ({ name, value }))
  }, [openCards])

  const stageCards: StageCard[] = stages.map((stage: any) => ({
    stage: stage.stage,
    jobs: Number(stage?.summary?.jobs || 0),
    load: Number(stage?.summary?.capacity_load || 0),
    unit: String(stage?.summary?.capacity_unit || "TUBES_PER_DAY"),
    overloaded: Number(stage?.lanes?.filter((lane: any) => Boolean(lane.warning)).length || 0),
  }))
  const stagePressureData = stageCards.map((stage: StageCard) => ({
    stage: stageLabel(stage.stage),
    load: Number(stage.load.toFixed(2)),
    jobs: stage.jobs,
  }))

  const sectionLinks = useMemo(() => {
    const sections = ["WINDER", "OVEN", "PROCESS"] as const
    const result = sections.map((key) => ({
      key,
      ...SECTION_META[key],
      jobs: stageCards.find((row) => row.stage === key)?.jobs || 0,
      load: stageCards.find((row) => row.stage === key)?.load || 0,
      overloaded: stageCards.find((row) => row.stage === key)?.overloaded || 0,
    }))
    const needsSlitting = openCards.some((row: any) =>
      Boolean(
        row?.operational_requires_slitting ||
          row?.requires_slitting ||
          row?.spec_snapshot?.operational_requires_slitting ||
          row?.spec_snapshot?.requires_slitting,
      ),
    )
    if (needsSlitting) {
      result.unshift({
        key: "SLITTING",
        ...SECTION_META.SLITTING,
        jobs: stageCards.find((row) => row.stage === "SLITTING")?.jobs || 0,
        load: stageCards.find((row) => row.stage === "SLITTING")?.load || 0,
        overloaded: stageCards.find((row) => row.stage === "SLITTING")?.overloaded || 0,
      } as any)
    }
    return result
  }, [openCards, stageCards])

  const bottleneck = [...stageCards].sort((a, b) => b.load - a.load)[0]

  if (needsConcretePlant) {
    return (
      <div data-testid="planner-page" className="rounded-[2rem] border border-cyan-100 bg-gradient-to-br from-cyan-50 via-white to-slate-50 p-7 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-900">
              Planner scope
            </div>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">Select one plant to open planning</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Owner/Admin `ALL` scope is useful for dashboards, but planner capacity is tied to physical machines and shifts.
              Choose a plant from the switcher, then this landing will show that plant's queues, bottlenecks, and section boards.
            </p>
          </div>
          <div className="rounded-[1.4rem] border border-white/80 bg-white/90 p-5 shadow-sm">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Plant switcher</p>
            <PlantSwitcher />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="planner-page" className="space-y-6">
      <ExecutiveHero
        appearance={MODULE_APPEARANCES.planning}
        badge="Planning Command"
        title="Planner command center for demand, WIP, and bottlenecks"
        description="Read the plant picture here first. KPI cards, load charts, WIP aging, exceptions, and due-risk stay on the landing page. Use section boards only for actual machine and shift scheduling."
        aside={
          <div className="space-y-3">
            <div className="rounded-[1.15rem] border border-white/10 bg-white/10 p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-100">Plan Date</p>
              <p className="mt-2 text-3xl font-semibold">{dayjs(selectedDate).format("DD MMM")}</p>
              <p className="mt-1 text-xs text-cyan-100/80">
                {activePlant === "ALL" ? "All visible plants" : "Single plant view"}
              </p>
            </div>
            <Link href="/planning/board?section=winder" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900">
              Open winder board
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        }
      />

      <MetricRail>
        <MetricCard label="Open WIP" value={metric(openCards.length)} detail="Cards still active across sections" icon={Package2} tone="cyan" />
        <MetricCard label="Due Risk" value={metric(dueRiskCards.length)} detail="Cards due today or tomorrow" icon={CalendarClock} tone="rose" />
        <MetricCard label="Blocked Cards" value={metric(blockedCards.length)} detail="QC or stage blockers need intervention" icon={AlertTriangle} tone="amber" />
        <MetricCard label="Dispatch Ready" value={metric(dispatchReadyCards.length)} detail="Cards already at dispatch truth gate" icon={Truck} tone="emerald" />
        <MetricCard label="Board Pressure" value={metric(summary.capacity_load)} detail="Aggregate load points for today" icon={Factory} tone="violet" />
      </MetricRail>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <Panel title="Stage Pressure and Throughput" subtitle="Stage-wise load stays here so the board can stay clean and scheduling-focused.">
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-[1.3rem] border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Stage Load</p>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stagePressureData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="stage" tick={{ fontSize: 11 }} interval={0} angle={-12} textAnchor="end" height={56} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="load" radius={[8, 8, 0, 0]}>
                      {stagePressureData.map((entry, index) => (
                        <Cell key={`${entry.stage}-${index}`} fill={entry.load >= (bottleneck?.load || 0) ? "#f97316" : "#0891b2"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rounded-[1.3rem] border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">WIP Aging</p>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={wipAging} dataKey="value" nameKey="name" innerRadius={54} outerRadius={86} paddingAngle={4}>
                      <Cell fill="#06b6d4" />
                      <Cell fill="#f59e0b" />
                      <Cell fill="#ef4444" />
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Command Summary" subtitle="What a planner should act on next.">
          <div className="space-y-4">
            <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Bottleneck Section</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-slate-950">{bottleneck ? stageLabel(bottleneck.stage) : "No live load"}</p>
                  <p className="text-xs text-slate-500">
                    {bottleneck ? `${metric(bottleneck.jobs)} job(s) · ${metric(bottleneck.load)} ${compactUnitLabel(bottleneck.unit)}` : "Waiting for released work"}
                  </p>
                </div>
                <StatusBadge value={bottleneck && bottleneck.overloaded > 0 ? "BLOCKED" : "READY"} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Suggestions</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{metric(suggestions.length)}</p>
              </div>
              <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">WIP Aging 8d+</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{metric(wipAging.find((row) => row.name === "8d+")?.value)}</p>
              </div>
            </div>
            <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Dispatch Ready vs Blocked</p>
              <div className="mt-3 flex items-center gap-3">
                <StatusBadge value="READY" label={`${metric(dispatchReadyCards.length)} ready`} />
                <StatusBadge value="BLOCKED" label={`${metric(blockedCards.length)} blocked`} />
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Section Boards" subtitle="Open the section-specific drag and drop board only when you need to move work across machines or shifts.">
        <div className="grid gap-4 lg:grid-cols-3">
          {sectionLinks.map((section) => (
            <Link
              key={section.key}
              href={section.href}
              className="rounded-[1.35rem] border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-5 transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{section.key}</p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">{section.title}</p>
                  <p className="mt-1 text-sm text-slate-600">{section.subtitle}</p>
                </div>
                <ArrowRight className="h-5 w-5 text-slate-400" />
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-900 px-3 py-3 text-white">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-slate-300">Jobs</div>
                  <div className="mt-1 text-lg font-semibold">{metric(section.jobs)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Load</div>
                  <div className="mt-1 text-lg font-semibold text-slate-950">{metric(section.load)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Alerts</div>
                  <div className="mt-1 text-lg font-semibold text-slate-950">{metric(section.overloaded)}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Panel title="Due-Risk Queue" subtitle="Cards that need the planner’s decision before the next shift window.">
          <div className="space-y-3">
            {dueRiskCards.slice(0, 6).map((row: any) => (
              <Link
                key={row.id}
                href={`/planning/board/${String(row.current_stage || "WINDER").toLowerCase()}?job_card_id=${row.id}`}
                className="flex items-center justify-between gap-3 rounded-[1.1rem] border border-slate-200 bg-slate-50 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-950">{row.customer_name || `Job ${String(row.id).slice(0, 8)}`}</p>
                  <p className="text-xs text-slate-500">
                    {stageLabel(String(row.current_stage || "WIP"))} · Due {dayjs(row?.due_date || row?.spec_snapshot?.sales_order_line_due_date).format("DD MMM")}
                  </p>
                </div>
                <StatusBadge value="WIP" label={`${metric(row.planned_qty)} pcs`} />
              </Link>
            ))}
            {!dueRiskCards.length && !isLoading ? <p className="text-sm text-slate-500">No immediate due-risk cards.</p> : null}
          </div>
        </Panel>

        <Panel title="Planner Suggestions" subtitle="System suggestions remain visible here, not on the drag and drop board.">
          <div className="space-y-3">
            {suggestions.slice(0, 6).map((suggestion: any) => (
              <div key={`${suggestion.job_card_id}-${suggestion.stage}-${suggestion.lane_id}`} className="rounded-[1.1rem] border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">JC #{String(suggestion.job_card_id).slice(0, 8)}</p>
                    <p className="text-xs text-slate-500">
                      {stageLabel(suggestion.stage)} · {suggestion.reason || "Suggested based on current board pressure"}
                    </p>
                  </div>
                  <Link href={`/planning/board/${String(suggestion.stage || "WINDER").toLowerCase()}?job_card_id=${suggestion.job_card_id}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                    Review
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            ))}
            {!suggestions.length && !isLoading ? <p className="text-sm text-slate-500">No unresolved planner suggestions for today.</p> : null}
          </div>
        </Panel>
      </div>
    </div>
  )
}

export default function PlanningLandingPage() {
  return (
    <Suspense fallback={<div className="rounded-[1.5rem] border border-slate-200 bg-white p-8 text-sm text-slate-600">Loading planner command center...</div>}>
      <PlanningLandingPageContent />
    </Suspense>
  )
}
