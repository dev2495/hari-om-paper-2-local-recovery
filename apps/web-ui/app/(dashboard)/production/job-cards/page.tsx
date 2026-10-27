"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, ChevronDown, ClipboardCheck, ClipboardList, Download, Factory, Flag, GitBranch, PauseOctagon, Printer, Search, Settings2, ShieldAlert, ShoppingCart, TimerReset, X } from "lucide-react"

import { HoverCard } from "@/components/common/hover-card"
import { RowMenu } from "@/components/common/row-menu"
import { ColorChip, JobCardNo, TrackBadge } from "@/components/production/lifecycle-chips"
import { SavedViewsMenu } from "@/components/production/saved-views-menu"
import { PageHeader } from "@/components/workspace/page-header"
import { QuerySwitch } from "@/components/workspace/query-state"
import { useMissedSlotSweep } from "@/hooks/use-lifecycle"
import type { PlannerView } from "@/hooks/use-planner-views"
import { useJobCardRows } from "@/hooks/use-job-card-rows"
import { useMachines, useJobCardAggregates, useQualityHolds } from "@/hooks/use-production"
import { dueRiskLabel, overdueLabel } from "@/lib/due-risk"
import { compactRef, jobCardRef } from "@/lib/job-card-display"
import {
  GROUP_OPTIONS,
  TRACK_STATUSES,
  dayText,
  downloadText,
  dueInDays,
  dueText,
  groupRows,
  jobCardsCsv,
  orderRef,
  shiftText,
  stageTrack,
  stageWord,
  trackStatus,
  type GroupBy,
  type TrackStatus,
} from "@/lib/job-card-tracking"
import { matchesSearch } from "@/lib/planner-queue-filters"
import { cn } from "@/lib/utils"

const STAGE_TILES = ["SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING", "QC", "DISPATCH"]
const PAGE_VIEW_KEY = "JOB_CARDS"
/** Rows drawn at a time; "Show more" adds the next batch (print shows them all). */
const PAGE_ROWS = 60

/**
 * Plan status of the current stage (client 2026-10-26): planning is only the plan and never blocks the
 * floor, so this is information with the planner as the next step, not a gate.
 */
type PlanInfo = { status: string; planned: boolean; short: string; detail: string; tone: "planned" | "split" | "attention" | "neutral" }
function planInfo(job: any): PlanInfo {
  const status = String(job.plan_status || "")
  const label = String(job.plan_status_label || "")
  const short = label.includes(": ") ? label.split(": ").slice(1).join(": ") : label
  const tones: Record<string, PlanInfo["tone"]> = { PLANNED: "planned", RUNNING: "planned", SPLIT: "split", MISSED: "attention", PAST: "attention", NOT_PLANNED: "neutral", WAITING: "neutral", NO_PLAN_NEEDED: "neutral", DONE: "neutral" }
  const details: Record<string, string> = {
    PLANNED: "The current stage has a planner slot. The floor logs runs on the job card; Planning overview shows if it ran in its slot.",
    RUNNING: "Runs are being logged for the current stage. Planning overview shows how they match the plan.",
    SPLIT: "The plan for this stage is in parts (several shifts or machines). The floor logs runs as usual; each run is matched to its part by date and shift.",
    MISSED: "The planned slot passed and nothing was logged for 36 hours, so the card went back to the planner queue. Plan it again, or log the run if it did happen.",
    PAST: "The planned slot has passed and nothing is logged yet. Log the run on the job card, or move the slot in the planner. After 36 hours it goes back to the queue.",
    NOT_PLANNED: "Not on the planner yet. The floor can still log runs (flagged as run before planning).",
    WAITING: "This stage opens for planning once the stage before it has a slot.",
    NO_PLAN_NEEDED: "Packing and QC follow the Process close; nothing to plan.",
    DONE: "All stages are done.",
  }
  return { status, planned: ["PLANNED", "RUNNING", "SPLIT"].includes(status), short: short || "—", detail: details[status] || label, tone: tones[status] || "neutral" }
}

type PlanFilter = "all" | "planned" | "unplanned"
type QcFilter = "all" | "flagged" | "hold"
type StatusFilter = "ALL" | TrackStatus

type ListFilters = { status: StatusFilter; group: GroupBy; search: string; plan: PlanFilter; qc: QcFilter; stage: string; due: string }

const INTERACTIVE = "a,button,input,select,textarea,[role=menu],[role=tooltip]"

/** Six thin segments under the status (one per stage): done, now, to do. The letters column shows on wide screens. */
function StageBar({ job }: { job: any }) {
  const steps = stageTrack(job)
  const now = steps.find((step) => step.state === "current")
  return (
    <span className="mt-0.5 flex w-[120px] max-w-full gap-0.5" role="img" aria-label={`Stages: ${steps.filter((step) => step.state === "done").length} of ${steps.length} done${now ? `, now ${now.label}` : ""}`} title={steps.map((step) => `${step.label}: ${step.state === "done" ? "done" : step.state === "current" ? "now" : "to do"}`).join(" · ")}>
      {steps.map((step) => (
        <span key={step.stage} className={cn("h-1.5 flex-1 rounded-full", step.state === "done" ? "bg-signal-emerald-ink/70" : step.state === "current" ? "bg-signal-blue-ink" : "bg-muted-foreground/20")} />
      ))}
    </span>
  )
}

function StageTrackCells({ job }: { job: any }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Stages: now at ${stageWord(job.current_stage)}`}>
      {stageTrack(job).map((step) => (
        <span
          key={step.stage}
          title={`${step.label}: ${step.state === "done" ? "done" : step.state === "current" ? "now" : "to do"}`}
          className={cn(
            "grid h-5 min-w-[22px] place-items-center rounded px-1 text-[10.5px] font-bold ring-1 ring-inset",
            step.state === "done" ? "bg-signal-emerald-soft text-signal-emerald-ink ring-signal-emerald-line" : step.state === "current" ? "bg-signal-blue-soft text-signal-blue-ink ring-signal-blue-line" : "bg-muted text-muted-foreground/70 ring-transparent",
          )}
        >
          {step.short}
        </span>
      ))}
    </span>
  )
}

function Tile({ label, value, detail, active, onClick, href, tone = "neutral", testId }: { label: string; value: number; detail?: string; active?: boolean; onClick?: () => void; href?: string; tone?: "neutral" | "amber" | "rose" | "emerald"; testId?: string }) {
  const className = cn(
    "flex min-w-[128px] shrink-0 snap-start flex-col rounded-xl border px-3 py-2 text-left transition hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:min-w-0 sm:shrink",
    active ? "border-primary/50 bg-primary/10" : "border-border bg-card",
  )
  const body = (
    <>
      <span className="truncate text-[11.5px] font-semibold text-muted-foreground">{label}</span>
      <span className={cn("mt-0.5 text-[20px] font-semibold leading-tight tabular-nums", tone === "amber" && value ? "text-signal-amber-ink" : tone === "rose" && value ? "text-signal-rose-ink" : tone === "emerald" && value ? "text-signal-emerald-ink" : "text-foreground")}>{value.toLocaleString("en-IN")}</span>
      {detail ? <span className="truncate text-[11px] text-muted-foreground">{detail}</span> : null}
    </>
  )
  if (href) return <Link href={href} className={className} data-testid={testId} aria-current={active ? "true" : undefined}>{body}</Link>
  return <button type="button" className={className} onClick={onClick} aria-pressed={active} data-testid={testId}>{body}</button>
}

/** One card on a phone: everything the table row says, stacked, the whole card opens the job card. */
function PhoneCard({ job, track, hold, machineLabel }: { job: any; track: TrackStatus; hold: string | null; machineLabel: (id: string) => string }) {
  const days = dueInDays(job.due_date)
  const flagged = Number(job.qc_flagged_runs || 0)
  const plan = planInfo(job)
  return (
    <li>
      <Link href={`/production/job-cards/${job.id}`} className="block rounded-xl border border-border bg-card p-3 shadow-sm active:bg-muted" data-testid="job-cards:phone-card">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <JobCardNo job={job} className="flex-wrap" />
            <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{orderRef(job)} · {job.customer_name || "—"}</span>
          </span>
          <TrackBadge status={track} />
        </span>
        <span className="mt-2 flex items-end justify-between gap-2">
          <span className="min-w-0 text-[12px] text-muted-foreground">
            <span className="block truncate">{job.product_size_label || job.product_code || "—"} · {job.parchment_color ? String(job.parchment_color).split(/[·/]/)[0].trim() : "plain"}</span>
            <span className="block truncate">{track === "QUEUE" ? `next: ${stageWord(job.current_stage)}` : stageWord(job.current_stage)}{track !== "QUEUE" && job.current_machine_id ? ` · ${machineLabel(String(job.current_machine_id))}` : ""} · {plan.short}</span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-[15px] font-semibold tabular-nums">{Number(job.planned_qty || 0).toLocaleString("en-IN")}<span className="ml-0.5 text-[11px] font-normal text-muted-foreground">pcs</span></span>
            {job.due_date ? <span className={cn("block text-[11.5px]", days !== null && days < 0 ? "font-semibold text-signal-rose-ink" : days !== null && days <= 3 ? "font-semibold text-signal-amber-ink" : "text-muted-foreground")}>due {dayText(job.due_date)} · {dueText(days)}</span> : null}
          </span>
        </span>
        <StageBar job={job} />
        {hold || flagged > 0 ? (
          <span className="mt-1.5 flex flex-wrap gap-1">
            {hold ? <span className="inline-flex max-w-full items-center gap-1 truncate rounded bg-signal-rose-soft px-1.5 py-0.5 text-[11px] font-semibold text-signal-rose-ink"><PauseOctagon className="h-3 w-3 shrink-0" aria-hidden="true" />Hold · {hold}</span> : null}
            {flagged > 0 ? <span className="inline-flex items-center gap-1 rounded bg-signal-amber-soft px-1.5 py-0.5 text-[11px] font-semibold text-signal-amber-ink" data-testid="job-cards:qc-flag-phone"><Flag className="h-3 w-3" aria-hidden="true" />Flagged QC · {flagged} run{flagged > 1 ? "s" : ""}</span> : null}
          </span>
        ) : null}
      </Link>
    </li>
  )
}

export default function JobCardsPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const stageFilter = String(searchParams?.get("stage") || "").trim().toUpperCase()
  const dueFilter = String(searchParams?.get("due") || "").trim().toLowerCase()
  const dueRiskParam = dueFilter === "priority" ? "PRIORITY" : dueFilter === "overdue" ? "OVERDUE" : undefined
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<StatusFilter>("ALL")
  const [group, setGroup] = useState<GroupBy>("none")
  const [planFilter, setPlanFilter] = useState<PlanFilter>("all")
  const [qcFilter, setQcFilter] = useState<QcFilter>("all")
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const deferredSearch = useDeferredValue(search.trim())
  const machinesQuery = useMachines()
  const aggregatesQuery = useJobCardAggregates()
  const holdsQuery = useQualityHolds({ status: "ACTIVE" })
  useMissedSlotSweep()

  // Every card of the plant, page by page (not a 250 window), with the sales order number filled in.
  const jobCardsQuery = useJobCardRows({ stage: stageFilter || undefined, due_risk: dueRiskParam })
  const jobCards = jobCardsQuery.rows
  const [rowLimit, setRowLimit] = useState(PAGE_ROWS)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const aggregates = useMemo(() => (aggregatesQuery.data as Record<string, any>) || {}, [aggregatesQuery.data])
  const machineLabelMap = useMemo(
    () => new Map((Array.isArray(machinesQuery.data) ? machinesQuery.data : []).map((machine: any) => [String(machine.id), String(machine.code || machine.name || String(machine.id).slice(0, 8))])),
    [machinesQuery.data],
  )
  const machineLabel = (id: string) => machineLabelMap.get(id) || compactRef(id, "MC")
  const holdByCard = useMemo(() => {
    const map = new Map<string, string>()
    for (const hold of Array.isArray(holdsQuery.data) ? holdsQuery.data : []) {
      if (String(hold?.status || "ACTIVE").toUpperCase() !== "ACTIVE") continue
      const id = String(hold?.job_card_id || "")
      if (id && !map.has(id)) map.set(id, String(hold?.reason || "Quality hold"))
    }
    return map
  }, [holdsQuery.data])
  const holdReason = (job: any) => holdByCard.get(String(job.id)) || null
  const statusOf = useCallback((job: any) => trackStatus(job, Boolean(holdByCard.get(String(job?.id)))), [holdByCard])

  const stageCounts = useMemo(() => {
    const fromServer = Array.isArray(aggregates.stage_counts) ? aggregates.stage_counts : []
    const byStage = new Map(fromServer.map((row: any) => [String(row.stage).toUpperCase(), Number(row.count || 0)]))
    return STAGE_TILES.map((stage) => ({ stage, count: Number(byStage.get(stage) || 0) })).filter((row) => row.count > 0 || row.stage !== "SLITTING")
  }, [aggregates])

  // Touching any filter by hand leaves the saved view (its badge would lie otherwise).
  const touch = () => setActiveViewId(null)
  const replaceQuery = (patch: Record<string, string | null>, options: { keepView?: boolean } = {}) => {
    if (!options.keepView) touch()
    const next = new URLSearchParams(searchParams?.toString() || "")
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) next.delete(key)
      else next.set(key, value)
    })
    const query = next.toString()
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  // Status per card, counted on the loaded window (search applies first so the chips answer "of these").
  const searched = useMemo(() => jobCards.filter((job: any) => matchesSearch(job, deferredSearch)), [jobCards, deferredSearch])
  const withStatus = useMemo(() => searched.map((job: any) => ({ job, status: trackStatus(job, Boolean(holdReason(job))), plan: planInfo(job) })), [searched, holdByCard]) // eslint-disable-line react-hooks/exhaustive-deps
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: withStatus.length }
    for (const row of withStatus) counts[row.status] = (counts[row.status] || 0) + 1
    return counts
  }, [withStatus])
  const visible = useMemo(
    () =>
      withStatus
        .filter((row) => status === "ALL" || row.status === status)
        .filter((row) => planFilter === "all" || (planFilter === "planned") === row.plan.planned)
        .filter((row) => qcFilter === "all" || (qcFilter === "flagged" ? Number(row.job.qc_flagged_runs || 0) > 0 : Boolean(holdReason(row.job))))
        .map((row) => row.job),
    [withStatus, status, planFilter, qcFilter, holdByCard], // eslint-disable-line react-hooks/exhaustive-deps
  )
  // Long lists draw in batches; any filter change starts again at the first batch.
  useEffect(() => { setRowLimit(PAGE_ROWS) }, [status, group, deferredSearch, planFilter, qcFilter, stageFilter, dueFilter])
  useEffect(() => {
    const all = () => setRowLimit(Number.POSITIVE_INFINITY)
    window.addEventListener("beforeprint", all)
    return () => window.removeEventListener("beforeprint", all)
  }, [])
  // "/" jumps to the search box from anywhere on the page.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key !== "/" || event.metaKey || event.ctrlKey || target?.closest("input,textarea,select,[contenteditable=true],[role=dialog]")) return
      event.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  const shown = useMemo(() => visible.slice(0, rowLimit), [visible, rowLimit])
  const groups = useMemo(() => groupRows(shown, group, machineLabel, statusOf), [shown, group, machineLabelMap, statusOf]) // eslint-disable-line react-hooks/exhaustive-deps
  const openCount = withStatus.filter((row) => TRACK_STATUSES.find((meta) => meta.key === row.status)?.open).length
  const flaggedCount = withStatus.filter((row) => Number(row.job.qc_flagged_runs || 0) > 0).length
  const priorityCount = Number(aggregates.due_priority || 0)
  const overdueCount = Number(aggregates.due_overdue || 0)

  const currentFilters: ListFilters = { status, group, search: search.trim(), plan: planFilter, qc: qcFilter, stage: stageFilter, due: dueFilter }
  const filterSummary = [
    status !== "ALL" ? TRACK_STATUSES.find((meta) => meta.key === status)?.label : null,
    group !== "none" ? `grouped by ${GROUP_OPTIONS.find((option) => option.key === group)?.label.toLowerCase()}` : null,
    search.trim() ? `search "${search.trim()}"` : null,
    planFilter !== "all" ? (planFilter === "planned" ? "planned" : "not planned") : null,
    qcFilter !== "all" ? (qcFilter === "flagged" ? "QC flagged" : "on hold") : null,
    stageFilter ? `stage ${stageWord(stageFilter)}` : null,
    dueFilter ? (dueFilter === "priority" ? "priority 3 days" : "overdue") : null,
  ].filter(Boolean).join(" · ")
  const applyView = (view: PlannerView) => {
    const filters = (view.filters || {}) as Partial<ListFilters>
    setStatus((filters.status as StatusFilter) || "ALL")
    setGroup((filters.group as GroupBy) || "none")
    setSearch(String(filters.search || ""))
    setPlanFilter((filters.plan as PlanFilter) || "all")
    setQcFilter((filters.qc as QcFilter) || "all")
    setActiveViewId(view.id)
    replaceQuery({ stage: filters.stage ? String(filters.stage).toUpperCase() : null, due: filters.due ? String(filters.due) : null }, { keepView: true })
  }
  const clearAll = () => {
    setStatus("ALL"); setGroup("none"); setSearch(""); setPlanFilter("all"); setQcFilter("all")
    replaceQuery({ stage: null, due: null })
  }

  const exportCards = () => {
    downloadText(`job-cards-${new Date().toLocaleDateString("en-CA")}.csv`, jobCardsCsv(visible, { machineLabel, holdReason }))
  }

  const openCard = (job: any) => router.push(`/production/job-cards/${job.id}`)
  const onRowClick = (event: MouseEvent<HTMLTableRowElement>, job: any) => {
    if ((event.target as HTMLElement).closest(INTERACTIVE)) return
    if (event.metaKey || event.ctrlKey) {
      window.open(`/production/job-cards/${job.id}`, "_blank")
      return
    }
    openCard(job)
  }
  const onRowKey = (event: KeyboardEvent<HTMLTableRowElement>, job: any) => {
    if (event.target !== event.currentTarget) return
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      openCard(job)
    }
  }

  const activeChips = [
    stageFilter ? { key: "stage", label: `Stage: ${stageWord(stageFilter)}`, clear: () => replaceQuery({ stage: null }) } : null,
    dueRiskParam ? { key: "due", label: dueRiskParam === "PRIORITY" ? "Priority (3 plant days)" : "Overdue", clear: () => replaceQuery({ due: null }) } : null,
    planFilter !== "all" ? { key: "plan", label: planFilter === "planned" ? "Planned" : "Not planned yet", clear: () => setPlanFilter("all") } : null,
    qcFilter !== "all" ? { key: "qc", label: qcFilter === "flagged" ? "QC flagged" : "On hold", clear: () => setQcFilter("all") } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>

  return (
    <div className="space-y-4" data-testid="job-cards-page">
      <PageHeader
        badge="Production · tracking"
        title="Job cards"
        description="Every card in the plant, where it is and what it is waiting for. Click a row to open the card. Logging and QC happen from the card or on the floor; lifecycle changes (split, edit, force close) in the Job card manager."
        actions={
          <>
            <button type="button" onClick={() => window.print()} className="erp-btn-secondary !h-9 print:hidden"><Printer className="h-4 w-4" />Print list</button>
            <button type="button" onClick={exportCards} className="erp-btn-secondary !h-9 print:hidden" data-testid="job-cards:export"><Download className="h-4 w-4" />Export CSV</button>
            <Link href="/planning/board?section=winder" className="erp-btn-secondary !h-9"><Factory className="h-4 w-4" />Planner board</Link>
            <Link href="/production/job-cards/manage" className="erp-btn-primary !h-9" data-testid="job-cards:manager-link"><Settings2 className="h-4 w-4" />Job card manager</Link>
          </>
        }
      />

      <section className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-5 2xl:grid-cols-10" aria-label="Where the cards are (whole plant)">
        <Tile label="Open cards" value={Number(aggregates.open_cards ?? openCount)} detail="whole plant" active={!stageFilter && !dueRiskParam} onClick={() => replaceQuery({ due: null, stage: null })} testId="job-cards:open-count" />
        <Tile label="Priority · 3 days" value={priorityCount} detail={dueRiskParam === "PRIORITY" ? "showing" : "due soon"} tone="amber" active={dueRiskParam === "PRIORITY"} onClick={() => replaceQuery({ due: dueFilter === "priority" ? null : "priority", stage: null })} />
        <Tile label="Overdue" value={overdueCount} detail={dueRiskParam === "OVERDUE" ? "showing" : "past due date"} tone="rose" active={dueRiskParam === "OVERDUE"} onClick={() => replaceQuery({ due: dueFilter === "overdue" ? null : "overdue", stage: null })} />
        <Tile label="QC holds" value={Number(aggregates.qc_holds ?? holdByCard.size)} detail="active holds" tone="rose" active={qcFilter === "hold"} onClick={() => { touch(); setQcFilter(qcFilter === "hold" ? "all" : "hold") }} />
        <Tile label="Dispatch ready" value={Number(aggregates.dispatch_ready ?? 0)} detail="at dispatch" tone="emerald" active={stageFilter === "DISPATCH"} href={stageFilter === "DISPATCH" ? "/production/job-cards" : "/production/job-cards?stage=DISPATCH"} />
        {stageCounts.filter((row) => row.stage !== "DISPATCH").map((row) => {
          const active = stageFilter === row.stage
          const href = active ? "/production/job-cards" : `/production/job-cards?stage=${row.stage}`
          return <Tile key={row.stage} label={stageWord(row.stage)} value={row.count} detail="open cards here" active={active} href={href} testId={`job-cards:stage-tile:${row.stage}`} />
        })}
      </section>
      {Number(aggregates.blocked || 0) ? (
        <p className="flex items-start gap-2 rounded-xl border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-[12.5px] text-signal-rose-ink" data-testid="job-cards:blocked">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{aggregates.blocked} open card{Number(aggregates.blocked) === 1 ? " has" : "s have"} an active quality hold or wait at final QC. <Link href="/quality" className="font-semibold underline">Quality desk</Link> before dispatch.</span>
        </p>
      ) : null}

      <section className="erp-panel min-w-0 rounded-xl p-3 sm:p-4" data-testid="job-cards:list">
        <div className="flex flex-wrap items-center gap-2">
          <div className="tube-segment !h-auto flex-wrap" role="group" aria-label="Status">
            {([{ key: "ALL", label: "All" }, ...TRACK_STATUSES] as Array<{ key: StatusFilter; label: string }>).map((chip) => (
              <button key={chip.key} type="button" aria-pressed={status === chip.key} onClick={() => { touch(); setStatus(chip.key) }} data-testid={`job-cards:status:${chip.key}`}>
                {chip.label}<span className="tabular-nums text-muted-foreground">{statusCounts[chip.key] || 0}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex h-9 min-w-0 flex-1 basis-full items-center gap-2 rounded-lg border border-input bg-card px-2.5 focus-within:ring-2 focus-within:ring-ring/30 sm:max-w-sm sm:basis-56">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              aria-label="Search job cards"
              value={search}
              onChange={(event) => { touch(); setSearch(event.target.value) }}
              ref={searchRef}
              onKeyDown={(event) => { if (event.key === "Escape") { touch(); setSearch("") } }}
              placeholder="Search card, order, customer, PO, size, colour…"
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
              data-testid="job-cards:search"
            />
            {search ? <button type="button" aria-label="Clear search" onClick={() => { touch(); setSearch("") }} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button> : <kbd className="hidden rounded border border-border bg-muted px-1.5 text-[10.5px] text-muted-foreground sm:inline">/</kbd>}
          </div>
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            Group by
            <select aria-label="Group by" value={group} onChange={(event) => { touch(); setGroup(event.target.value as GroupBy) }} className="h-9 rounded-lg border border-input bg-card px-2 text-[13px] text-foreground" data-testid="job-cards:group">
              {GROUP_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </label>
          <select aria-label="Plan status filter" value={planFilter} onChange={(event) => { touch(); setPlanFilter(event.target.value as PlanFilter) }} className="h-9 rounded-lg border border-input bg-card px-2 text-[13px]" data-testid="job-cards:plan-filter">
            <option value="all">Plan: any</option>
            <option value="planned">Planned</option>
            <option value="unplanned">Not planned yet</option>
          </select>
          <select aria-label="QC filter" value={qcFilter} onChange={(event) => { touch(); setQcFilter(event.target.value as QcFilter) }} className="h-9 rounded-lg border border-input bg-card px-2 text-[13px]" data-testid="job-cards:qc-filter">
            <option value="all">QC: any</option>
            <option value="flagged">Flagged readings ({flaggedCount})</option>
            <option value="hold">On hold ({withStatus.filter((row) => row.status === "ON_HOLD").length})</option>
          </select>
          <SavedViewsMenu viewKey={PAGE_VIEW_KEY} current={currentFilters as unknown as Record<string, unknown>} activeViewId={activeViewId} onApply={applyView} onClearActive={clearAll} summary={filterSummary} />
          <span className="ml-auto text-[12.5px] tabular-nums text-muted-foreground" data-testid="job-cards:count">{visible.length} of {jobCards.length} cards</span>
        </div>
        {activeChips.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Active filters">
            {activeChips.map((chip) => (
              <button key={chip.key} type="button" onClick={chip.clear} className="inline-flex h-7 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 text-[12px] font-semibold text-primary">
                {chip.label}<X className="h-3 w-3" aria-hidden="true" />
              </button>
            ))}
            <button type="button" onClick={clearAll} className="text-[12px] font-semibold text-muted-foreground hover:text-foreground">Clear all</button>
          </div>
        ) : null}

        {jobCardsQuery.isLoading || jobCardsQuery.isError || jobCards.length === 0 ? (
          <div className="mt-3">
            <QuerySwitch
              isLoading={jobCardsQuery.isLoading}
              isError={jobCardsQuery.isError}
              isEmpty={jobCards.length === 0}
              loadingLabel="Loading recovered job cards..."
              emptyTitle="No job cards matched this filter."
              emptyMessage="Clear the stage or due-risk filter, or wait for a sales release."
              errorMessage="Job cards could not be loaded. Counts on this page must not be treated as zero."
              onRetry={() => {
                void jobCardsQuery.refetch()
              }}
            >
              {null}
            </QuerySwitch>
          </div>
        ) : visible.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-border px-4 py-10 text-center text-[13px] text-muted-foreground">
            No cards match these filters. <button type="button" className="font-semibold text-primary hover:underline" onClick={clearAll}>Clear all</button>
          </div>
        ) : (
          <>
          <ul className="mt-3 space-y-2 sm:hidden print:hidden" data-testid="job-cards:phone-list">
            {groups.map((bucket) => (
              <li key={bucket.key} className="space-y-2">
                {group !== "none" ? <p className="px-1 text-[12px] font-semibold text-muted-foreground" data-testid="job-cards:group-row">{bucket.label}{bucket.sub ? <span className="font-normal"> · {bucket.sub}</span> : null} · {bucket.rows.length}</p> : null}
                <ul className="space-y-2">
                  {bucket.rows.map((job: any) => <PhoneCard key={job.id} job={job} track={statusOf(job)} hold={holdReason(job)} machineLabel={machineLabel} />)}
                </ul>
              </li>
            ))}
          </ul>
          <div className="tube-print-expand mt-3 hidden max-h-[calc(100dvh-280px)] overflow-auto rounded-xl border border-border sm:block print:block">
            <table className="tube-grid" data-testid="job-cards:table">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th>Card · size · colour</th>
                  <th className="hidden xl:table-cell">Order · customer</th>
                  <th className="num">Qty</th>
                  <th className="hidden min-[1700px]:table-cell">Stages</th>
                  <th>Status · machine</th>
                  <th className="hidden min-[1400px]:table-cell">Plan status</th>
                  <th>Due</th>
                  <th className="hidden xl:table-cell">QC</th>
                  <th className="text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              {groups.map((bucket) => (
                <tbody key={bucket.key} data-group={group !== "none" ? bucket.key : undefined}>
                  {group !== "none" ? (
                    <tr className="grp" data-testid="job-cards:group-row">
                      <td colSpan={9} className="!bg-[hsl(var(--surface-2))] !py-1.5 text-[12px]">
                        <span className="font-semibold text-foreground">{bucket.label}</span>
                        {bucket.sub ? <span className="text-muted-foreground"> · {bucket.sub}</span> : null}
                        <span className="text-muted-foreground"> · {bucket.rows.length} card{bucket.rows.length === 1 ? "" : "s"} · {bucket.rows.reduce((sum: number, job: any) => sum + Number(job.planned_qty || 0), 0).toLocaleString("en-IN")} pcs</span>
                      </td>
                    </tr>
                  ) : null}
                  {bucket.rows.map((job: any) => {
                    const plan = planInfo(job)
                    const hold = holdReason(job)
                    const track = trackStatus(job, Boolean(hold))
                    const stage = String(job.current_stage || "").toLowerCase()
                    const planHref = ["winder", "oven", "process", "slitting"].includes(stage) ? `/planning/${stage}?order_id=${job.sales_order_id}` : `/planning/board?order_id=${job.sales_order_id}`
                    const days = dueInDays(job.due_date)
                    const flagged = Number(job.qc_flagged_runs || 0)
                    const href = `/production/job-cards/${job.id}`
                    return (
                      <tr
                        key={job.id}
                        tabIndex={0}
                        onClick={(event) => onRowClick(event, job)}
                        onKeyDown={(event) => onRowKey(event, job)}
                        className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                        data-testid="job-cards:row"
                        data-track={track}
                        data-due-risk={job.due_risk_bucket || ""}
                        data-plan-status={plan.status || undefined}
                        aria-label={`Open job card ${jobCardRef(job)}`}
                      >
                        <td className="max-w-[200px]">
                          <Link href={href} className="hover:text-primary" onClick={(event) => event.stopPropagation()}><JobCardNo job={job} /></Link>
                          <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[11.5px] text-muted-foreground">
                            <span className="truncate">{job.product_size_label || job.product_code || "—"}</span>
                            {job.parchment_color ? <ColorChip color={job.parchment_color} className="!text-[11.5px]" /> : <span className="text-[11px]">plain</span>}
                          </span>
                          <span className="block truncate text-[11.5px] text-muted-foreground xl:hidden">{orderRef(job)} · {job.customer_name || "—"}</span>
                        </td>
                        <td className="hidden max-w-[180px] xl:table-cell">
                          <span className="block truncate text-foreground/90">{orderRef(job)}</span>
                          <span className="block truncate text-[11.5px] text-muted-foreground">{job.customer_name || "—"}{job.customer_code ? ` · ${job.customer_code}` : ""}</span>
                        </td>
                        <td className="num">
                          <span className="font-semibold">{Number(job.planned_qty || 0).toLocaleString("en-IN")}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {job.pcs_per_bamboo ? `${Math.ceil(Number(job.planned_qty || 0) / Number(job.pcs_per_bamboo)).toLocaleString("en-IN")} bamboo` : job.planned_weight_kg ? `${Number(job.planned_weight_kg).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg` : "pcs"}
                          </span>
                          {Number(job.returned_qty || 0) > 0 ? <span className="block text-[11px] tabular-nums text-signal-rose-ink">{Number(job.returned_qty).toLocaleString("en-IN")} back to SO</span> : null}
                        </td>
                        <td className="hidden min-[1700px]:table-cell"><StageTrackCells job={job} /></td>
                        <td className="max-w-[180px]">
                          <div className="flex min-w-0 flex-col items-start gap-0.5">
                            <TrackBadge status={track} />
                            <span className="block max-w-full truncate text-[11.5px] text-muted-foreground" title={job.current_machine_id ? machineLabel(String(job.current_machine_id)) : undefined}>
                              {track === "QUEUE" ? `next: ${stageWord(job.current_stage)}` : stageWord(job.current_stage)}
                              {track !== "QUEUE" && job.current_machine_id ? ` · ${machineLabel(String(job.current_machine_id))}` : ""}
                              {track !== "QUEUE" && job.current_plan_date && !["NOT_PLANNED", "WAITING", "NO_PLAN_NEEDED"].includes(plan.status) ? ` · ${dayText(job.current_plan_date)}` : ""}
                              {track !== "QUEUE" && job.current_shift_code && !["NOT_PLANNED", "WAITING", "NO_PLAN_NEEDED"].includes(plan.status) ? ` ${shiftText(job.current_shift_code).replace("Shift ", "")}` : ""}
                            </span>
                            {plan.tone === "attention" ? <span className="inline-flex max-w-full items-center gap-1 truncate text-[11.5px] font-medium text-signal-amber-ink min-[1400px]:hidden" title={plan.detail}><AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />{plan.short}</span> : null}
                            <span className="min-[1700px]:hidden"><StageBar job={job} /></span>
                            {hold ? <span className="inline-flex max-w-full items-center gap-1 truncate text-[11.5px] text-signal-rose-ink"><PauseOctagon className="h-3 w-3 shrink-0" aria-hidden="true" />{hold}</span> : null}
                            {!hold && flagged > 0 ? <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-signal-amber-ink xl:hidden"><Flag className="h-3 w-3 shrink-0" aria-hidden="true" />Flagged QC · {flagged} run{flagged > 1 ? "s" : ""}</span> : null}
                          </div>
                        </td>
                        <td className="hidden max-w-[160px] min-[1400px]:table-cell">
                          <HoverCard
                            label={`Plan for ${jobCardRef(job)}`}
                            trigger={
                              <button
                                type="button"
                                data-testid="job-card-plan-status"
                                className={cn(
                                  "group inline-flex max-w-[146px] items-center gap-1.5 rounded-full border px-2 py-0.5 text-left text-[11.5px] font-medium",
                                  plan.tone === "planned" ? "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink"
                                    : plan.tone === "split" ? "border-signal-blue-line bg-signal-blue-soft text-signal-blue-ink"
                                      : plan.tone === "attention" ? "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink"
                                        : "border-border bg-muted text-muted-foreground",
                                )}
                              >
                                {plan.tone === "planned" ? <CheckCircle2 className="h-3 w-3 shrink-0" /> : plan.tone === "attention" ? <AlertTriangle className="h-3 w-3 shrink-0" /> : <CalendarClock className="h-3 w-3 shrink-0" />}
                                <span className="truncate">{plan.short}</span>
                              </button>
                            }
                          >
                            <p className="font-semibold text-foreground">{job.plan_status_label || "Plan"}</p>
                            <p className="mt-1 text-muted-foreground">{plan.detail}</p>
                            <Link href={planHref} className="erp-btn-secondary mt-3 !h-8 w-full">Open in planner<ArrowRight className="h-3.5 w-3.5" /></Link>
                          </HoverCard>
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">released {dayText(job.created_at)}</span>
                        </td>
                        <td className="whitespace-nowrap">
                          <span className="block tabular-nums text-foreground/90">{job.due_date ? dayText(job.due_date) : "—"}</span>
                          {days !== null ? <span className={cn("text-[11.5px] font-medium", days < 0 ? "text-signal-rose-ink" : days <= 3 ? "text-signal-amber-ink" : "text-muted-foreground")}>{dueText(days)}</span> : null}
                        </td>
                        <td className="hidden whitespace-nowrap xl:table-cell">
                          {hold ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-signal-rose-soft px-2 py-0.5 text-[11.5px] font-semibold text-signal-rose-ink ring-1 ring-inset ring-signal-rose-line"><PauseOctagon className="h-3 w-3" aria-hidden="true" />Hold</span>
                          ) : flagged > 0 ? (
                            <Link href={`${href}?tab=qc`} onClick={(event) => event.stopPropagation()} title="A reading outside its band: allowed, flagged, never held" className="inline-flex items-center gap-1 rounded-full bg-signal-amber-soft px-2 py-0.5 text-[11.5px] font-semibold text-signal-amber-ink ring-1 ring-inset ring-signal-amber-line" data-testid="job-cards:qc-flag">
                              <Flag className="h-3 w-3" aria-hidden="true" />Flagged · {flagged} run{flagged > 1 ? "s" : ""}
                            </Link>
                          ) : track === "WAITING_QC" ? (
                            <span className="text-[11.5px] font-medium text-signal-amber-ink">Final QC due</span>
                          ) : (
                            <span className="text-[11.5px] text-muted-foreground">—</span>
                          )}
                        </td>
                        <td>
                          <div className="flex justify-end">
                            <RowMenu
                              label={`Actions for ${jobCardRef(job)}`}
                              items={[
                                { label: "Open", href, icon: ClipboardCheck },
                                { label: "Log output", href: `/production/entry/${job.id}?mode=output`, icon: ClipboardList },
                                { label: "Log QC", href: `/production/entry/${job.id}?mode=qc`, icon: CheckCircle2 },
                                { label: "Print card (A4)", href: `${href}/print`, icon: Printer },
                                { label: "Manage card", href: `/production/job-cards/manage?card=${job.id}`, icon: Settings2 },
                                { label: "Plan / reschedule", href: planHref, icon: CalendarClock },
                                { label: "Material genealogy", href: `/inventory/genealogy?job_card_id=${job.id}`, icon: GitBranch },
                                { label: "Sales order", href: `/sales-orders/${job.sales_order_id}`, icon: ShoppingCart },
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              ))}
            </table>
          </div>
          {visible.length > shown.length ? (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-3 print:hidden">
              <span className="text-[12.5px] text-muted-foreground">Showing {shown.length.toLocaleString("en-IN")} of {visible.length.toLocaleString("en-IN")}</span>
              <button type="button" className="erp-btn-secondary !h-9" onClick={() => setRowLimit((value) => value + PAGE_ROWS)} data-testid="job-cards:show-more"><ChevronDown className="h-4 w-4" />Show {Math.min(PAGE_ROWS, visible.length - shown.length)} more</button>
              <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={() => setRowLimit(Number.POSITIVE_INFINITY)}>Show all</button>
            </div>
          ) : null}
          </>
        )}
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{visible.length} card{visible.length === 1 ? "" : "s"} match · open {openCount}{!jobCardsQuery.complete ? " · first 4,000 cards loaded (tiles are whole-plant totals)" : ""}</span>
          <span className="hidden items-center gap-1 min-[1700px]:inline-flex"><span className="grid h-4 min-w-[18px] place-items-center rounded bg-signal-emerald-soft px-1 text-[10px] font-bold text-signal-emerald-ink">W</span> done</span>
          <span className="hidden items-center gap-1 min-[1700px]:inline-flex"><span className="grid h-4 min-w-[18px] place-items-center rounded bg-signal-blue-soft px-1 text-[10px] font-bold text-signal-blue-ink">O</span> now</span>
          <span className="hidden items-center gap-1 min-[1700px]:inline-flex"><span className="grid h-4 min-w-[18px] place-items-center rounded bg-muted px-1 text-[10px] font-bold text-muted-foreground/70">P</span> to do</span>
          <span className="inline-flex items-center gap-1"><TimerReset className="h-3 w-3" />{dueRiskLabel()}</span>
          <span>{overdueLabel()}</span>
        </p>
      </section>
    </div>
  )
}
