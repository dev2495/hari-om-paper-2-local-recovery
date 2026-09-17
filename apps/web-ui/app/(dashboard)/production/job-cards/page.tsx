"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import dayjs from "dayjs"
import { ArrowRight, ClipboardCheck, Factory, PackageCheck, Search, ShieldCheck, TimerReset, Truck } from "lucide-react"
import { useDeferredValue, useMemo, useState } from "react"

import { ExecutiveHero, MetricCard, MetricRail, Panel, StatusBadge } from "@/components/erp/shell"
import { QuerySwitch } from "@/components/workspace/query-state"
import { useMachines, useJobCardAggregates, usePlanningJobCards } from "@/hooks/use-production"
import { productionApi } from "@/lib/api"
import { dueRiskLabel, overdueLabel } from "@/lib/due-risk"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"
import { compactRef, jobCardRef } from "@/lib/job-card-display"

const STAGE_TILES = ["SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING", "QC", "DISPATCH"]

function formatDate(value?: string | null) {
  if (!value) return "-"
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format("DD MMM YYYY") : String(value)
}

function dueBucketLabel(bucket?: string | null) {
  if (bucket === "PRIORITY") return "Priority (3 plant days)"
  if (bucket === "OVERDUE") return "Overdue"
  return null
}

export default function JobCardsPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const stageFilter = String(searchParams?.get("stage") || "").trim().toUpperCase()
  const dueFilter = String(searchParams?.get("due") || "").trim().toLowerCase()
  const dueRiskParam = dueFilter === "priority" ? "PRIORITY" : dueFilter === "overdue" ? "OVERDUE" : undefined
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("ALL")
  const deferredSearch = useDeferredValue(search.trim())
  const machinesQuery = useMachines()
  const aggregatesQuery = useJobCardAggregates()

  const jobCardsQuery = usePlanningJobCards(
    {
      limit: 250,
      ...(deferredSearch ? { search: deferredSearch } : {}),
      ...(status !== "ALL" ? { status } : {}),
      ...(stageFilter ? { stage: stageFilter } : {}),
      ...(dueRiskParam ? { due_risk: dueRiskParam } : {}),
    },
    true,
  )

  const jobCards = useMemo(() => (Array.isArray(jobCardsQuery.data) ? jobCardsQuery.data : []), [jobCardsQuery.data])
  const aggregates = useMemo(() => (aggregatesQuery.data as Record<string, any>) || {}, [aggregatesQuery.data])
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

  const stageCounts = useMemo(() => {
    const fromServer = Array.isArray(aggregates.stage_counts) ? aggregates.stage_counts : []
    const byStage = new Map(fromServer.map((row: any) => [String(row.stage).toUpperCase(), Number(row.count || 0)]))
    return STAGE_TILES.map((stage) => ({ stage, count: Number(byStage.get(stage) || 0) }))
  }, [aggregates])

  const replaceQuery = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams?.toString() || "")
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) next.delete(key)
      else next.set(key, value)
    })
    const query = next.toString()
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const visibleCards = jobCards.length
  const priorityCount = Number(aggregates.due_priority || 0)
  const overdueCount = Number(aggregates.due_overdue || 0)
  const priorityDetail = aggregates.priority_label || dueRiskLabel()
  const overdueDetail = aggregates.overdue_label || overdueLabel()

  const exportCards = async () => {
    const response = await productionApi.exportJobCards({
      ...(deferredSearch ? { search: deferredSearch } : {}),
      ...(status !== "ALL" ? { status } : {}),
      ...(stageFilter ? { stage: stageFilter } : {}),
      ...(dueRiskParam ? { due_risk: dueRiskParam } : {}),
    })
    const blob = new Blob([response.data], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "job-cards.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <ExecutiveHero
        appearance={MODULE_APPEARANCES.jobCards}
        badge="Job Card Truth"
        title="Execution-ready job cards, planner truth, and downstream floor visibility"
        description="Stage and due-risk tiles are server totals for the authorized plant, not a page-sized sample. Click a stage to open that exact set."
        aside={
          <div className="space-y-3">
            <div className="rounded-[1.15rem] border border-white/10 bg-white/10 p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-emerald-100">Open Cards</p>
              <p className="mt-2 text-3xl font-semibold" data-testid="job-cards:open-count">{Number(aggregates.open_cards ?? visibleCards)}</p>
              <p className="mt-1 text-xs text-emerald-100/80">Server aggregate across all job cards in plant scope</p>
            </div>
            <Link href="/planning/board?section=winder" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900">
              <Factory className="h-4 w-4" />
              Open planning board
            </Link>
          </div>
        }
      />

      <MetricRail className="2xl:grid-cols-5">
        <button type="button" className="text-left" onClick={() => replaceQuery({ due: null, stage: null })}>
          <MetricCard label="Open Cards" value={Number(aggregates.open_cards ?? 0)} detail="Still active across production stages" icon={ClipboardCheck} tone="cyan" />
        </button>
        <button type="button" className="text-left" onClick={() => replaceQuery({ due: dueFilter === "priority" ? null : "priority", stage: null })}>
          <MetricCard label="Priority (3 plant days)" value={priorityCount} detail={priorityDetail} icon={TimerReset} tone="amber" />
        </button>
        <button type="button" className="text-left" onClick={() => replaceQuery({ due: dueFilter === "overdue" ? null : "overdue", stage: null })}>
          <MetricCard label="Overdue" value={overdueCount} detail={overdueDetail} icon={TimerReset} tone="rose" />
        </button>
        <MetricCard label="QC Holds" value={Number(aggregates.qc_holds ?? 0)} detail="Active holds attached to open job cards" icon={ShieldCheck} tone={aggregates.qc_holds ? "rose" : "emerald"} />
        <MetricCard label="Dispatch Ready" value={Number(aggregates.dispatch_ready ?? 0)} detail="Already at dispatch stage" icon={Truck} tone="emerald" />
      </MetricRail>

      <Panel
        title="WIP and QC Movement Snapshot"
        subtitle="Open production is grouped by current stage. Tile counts are a full-scope server aggregate; the list below uses the same stage filter."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/inventory/production-issue" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-700 hover:border-cyan-300 hover:text-cyan-900">
              <PackageCheck className="h-3.5 w-3.5" />
              Issue to WIP
            </Link>
            <Link href="/quality" className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white hover:bg-slate-800">
              Quality desk <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        }
      >
        <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
          {stageCounts.map((row) => {
            const active = stageFilter === row.stage
            const href = active ? "/production/job-cards" : `/production/job-cards?stage=${row.stage}`
            return (
              <Link
                key={row.stage}
                href={href}
                data-testid={`job-cards:stage-tile:${row.stage}`}
                className={`rounded-[1.15rem] border px-4 py-3 transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600 ${
                  active ? "border-cyan-400 bg-cyan-50" : "border-slate-200 bg-slate-50"
                }`}
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{row.stage.replace(/_/g, " ")}</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{row.count}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {row.stage === "QC" ? "Final gate cards" : row.stage === "DISPATCH" ? "Ready for dispatch check" : "Open cards in this stage"}
                </p>
              </Link>
            )
          })}
        </div>
        {Number(aggregates.blocked || 0) ? (
          <div className="mt-4 rounded-[1.15rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            {aggregates.blocked} open card(s) have an active quality hold or final QC stage. Use the quality desk before dispatch.
          </div>
        ) : null}
      </Panel>

      <Panel
        title="Job Card Queue"
        subtitle="Search across job card id, order id, product code, or customer snapshot. Stage and due-risk filters are URL-driven."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {stageFilter ? (
              <button type="button" onClick={() => replaceQuery({ stage: null })} className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-800">
                Stage {stageFilter} ×
              </button>
            ) : null}
            {dueRiskParam ? (
              <button type="button" onClick={() => replaceQuery({ due: null })} className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-amber-800">
                {dueRiskParam === "PRIORITY" ? "Priority 3-day" : "Overdue"} ×
              </button>
            ) : null}
            <button type="button" onClick={() => exportCards().catch(() => undefined)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-700">
              Export CSV
            </button>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                aria-label="Search job cards"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search job cards..."
                className="w-64 bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </div>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="ALL">All statuses</option>
              <option value="CREATED">Created</option>
              <option value="PLANNED">Planned</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </div>
        }
      >
        {jobCardsQuery.isLoading || jobCardsQuery.isError || jobCards.length === 0 ? (
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
        ) : (
          <div className="overflow-x-auto rounded-[1.35rem] border border-slate-200">
            <table className="min-w-full">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Job Card</th>
                  <th className="px-4 py-3 text-left">Order / Customer</th>
                  <th className="px-4 py-3 text-left">Release / Winder</th>
                  <th className="px-4 py-3 text-left">Current Stage</th>
                  <th className="px-4 py-3 text-right">Planned Qty</th>
                  <th className="px-4 py-3 text-left">Machine / Shift</th>
                  <th className="px-4 py-3 text-left">Due / Alerts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {jobCards.map((job: any) => (
                  <tr key={job.id} data-due-risk={job.due_risk_bucket || ""}>
                    <td className="px-4 py-4">
                      <div className="space-y-2">
                        <Link href={`/production/job-cards/${job.id}`} className="text-sm font-semibold text-slate-950 hover:text-cyan-700">
                          {jobCardRef(job)}
                        </Link>
                        <div className="text-xs text-slate-500">
                          Release lot {job.release_lot_id ? compactRef(job.release_lot_id, "LOT") : "-"}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-700">
                      <div className="font-semibold text-slate-900">{job.customer_name || String(job.customer_id || "-")}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        SO {job.sales_order_ref || (job.sales_order_id ? compactRef(job.sales_order_id, "SO") : "-")} · Spec {job.spec_reference || compactRef(job.spec_id, "SPEC")}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-700">
                      <div>{job.release_lot_id ? compactRef(job.release_lot_id, "LOT") : "-"}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {job.assigned_winder_machine_id
                          ? machineLabelMap.get(String(job.assigned_winder_machine_id)) || String(job.assigned_winder_machine_id).slice(0, 8)
                          : "No target winder"}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="space-y-2">
                        <StatusBadge value={job.current_stage} />
                        <StatusBadge value={job.status} />
                        <StatusBadge value={job.planner_gate_ready ? "READY" : "BLOCKED"} label={job.planner_gate_ready ? "Planner ready" : "Planner gate"} />
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-semibold text-slate-950">
                      {Number(job.planned_qty || 0).toFixed(0)}
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-700">
                      <div>{job.current_machine_id ? machineLabelMap.get(String(job.current_machine_id)) || compactRef(job.current_machine_id, "MC") : "Unassigned"}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {job.current_shift_code || "No shift"} · {job.current_plan_date ? formatDate(job.current_plan_date) : "No plan date"}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-700">
                      <div>Due {formatDate(job.due_date)}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {dueBucketLabel(job.due_risk_bucket) || job.blocked_reason || job.planner_gate_reason || `${job.open_segment_count || 0} open segment(s)`}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">Showing the loaded job-card window (up to 250). Stage tiles use the server aggregate, not this page size.</p>
      </Panel>
    </div>
  )
}
