"use client"

import Link from "next/link"
import dayjs from "dayjs"
import { ClipboardCheck, Factory, Search, TimerReset, Truck } from "lucide-react"
import { useDeferredValue, useMemo, useState } from "react"

import { ExecutiveHero, EmptyState, MetricCard, MetricRail, Panel, StatusBadge } from "@/components/erp/shell"
import { usePlanningJobCards } from "@/hooks/use-production"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"

function formatDate(value?: string | null) {
  if (!value) return "-"
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format("DD MMM YYYY") : String(value)
}

export default function JobCardsPage() {
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("ALL")
  const deferredSearch = useDeferredValue(search.trim())

  const jobCardsQuery = usePlanningJobCards(
    {
      limit: 250,
      ...(deferredSearch ? { search: deferredSearch } : {}),
      ...(status !== "ALL" ? { status } : {}),
    },
    true,
  )

  const jobCards = useMemo(() => (Array.isArray(jobCardsQuery.data) ? jobCardsQuery.data : []), [jobCardsQuery.data])

  const metrics = useMemo(() => {
    const openCards = jobCards.filter((job: any) => String(job.status || "").toUpperCase() !== "COMPLETED")
    const dueRisk = openCards.filter((job: any) => {
      if (!job.due_date) return false
      return dayjs(job.due_date).isBefore(dayjs().add(1, "day"), "day")
    })
    const dispatchReady = openCards.filter((job: any) => String(job.current_stage || "").toUpperCase() === "DISPATCH")
    const blocked = openCards.filter((job: any) => Boolean(job.blocked_reason))
    return { openCards, dueRisk, dispatchReady, blocked }
  }, [jobCards])

  return (
    <div className="space-y-6">
      <ExecutiveHero
        appearance={MODULE_APPEARANCES.jobCards}
        badge="Job Card Truth"
        title="Execution-ready job cards, planner truth, and downstream floor visibility"
        description="Recovered job-card queue with stage, machine, due-risk, and direct document links instead of the old stub planner page."
        aside={
          <div className="space-y-3">
            <div className="rounded-[1.15rem] border border-white/10 bg-white/10 p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-emerald-100">Visible Cards</p>
              <p className="mt-2 text-3xl font-semibold">{jobCards.length}</p>
              <p className="mt-1 text-xs text-emerald-100/80">Loaded from production planning service</p>
            </div>
            <Link href="/planning/board?section=winder" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900">
              <Factory className="h-4 w-4" />
              Open planning board
            </Link>
          </div>
        }
      />

      <MetricRail>
        <MetricCard label="Open Cards" value={metrics.openCards.length} detail="Still active across production stages" icon={ClipboardCheck} tone="cyan" />
        <MetricCard label="Due Risk" value={metrics.dueRisk.length} detail="Due today or tomorrow" icon={TimerReset} tone="amber" />
        <MetricCard label="Dispatch Ready" value={metrics.dispatchReady.length} detail="Already at dispatch stage" icon={Truck} tone="emerald" />
        <MetricCard label="Blocked" value={metrics.blocked.length} detail="Needs planner or supervisor intervention" icon={Factory} tone="rose" />
      </MetricRail>

      <Panel
        title="Job Card Queue"
        subtitle="Search across job card id, order id, product code, or customer snapshot."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input
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
        {jobCardsQuery.isLoading ? (
          <EmptyState label="Loading recovered job cards..." />
        ) : jobCards.length === 0 ? (
          <EmptyState label="No job cards matched this filter." />
        ) : (
          <div className="overflow-x-auto rounded-[1.35rem] border border-slate-200">
            <table className="min-w-full">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Job Card</th>
                  <th className="px-4 py-3 text-left">Order / Customer</th>
                  <th className="px-4 py-3 text-left">Current Stage</th>
                  <th className="px-4 py-3 text-right">Planned Qty</th>
                  <th className="px-4 py-3 text-left">Machine / Shift</th>
                  <th className="px-4 py-3 text-left">Due / Alerts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {jobCards.map((job: any) => (
                  <tr key={job.id}>
                    <td className="px-4 py-4">
                      <div className="space-y-2">
                        <Link href={`/production/job-cards/${job.id}`} className="text-sm font-semibold text-slate-950 hover:text-cyan-700">
                          {job.job_card_ref || String(job.id).slice(0, 8)}
                        </Link>
                        <div className="text-xs text-slate-500">
                          Release lot {job.release_lot_id ? String(job.release_lot_id).slice(0, 8) : "-"}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-700">
                      <div className="font-semibold text-slate-900">{job.customer_name || String(job.customer_id || "-")}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        SO {job.sales_order_id ? String(job.sales_order_id).slice(0, 8) : "-"} · Spec {job.spec_reference || String(job.spec_id || "").slice(0, 8)}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="space-y-2">
                        <StatusBadge value={job.current_stage} />
                        <StatusBadge value={job.status} />
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-semibold text-slate-950">
                      {Number(job.planned_qty || 0).toFixed(0)}
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-700">
                      <div>{job.current_machine_id ? String(job.current_machine_id).slice(0, 8) : "Unassigned"}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {job.current_shift_code || "No shift"} · {job.current_plan_date ? formatDate(job.current_plan_date) : "No plan date"}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-700">
                      <div>Due {formatDate(job.due_date)}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {job.blocked_reason || `${job.open_segment_count || 0} open segment(s)`}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
