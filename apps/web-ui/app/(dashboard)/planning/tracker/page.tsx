"use client"

import Link from "next/link"
import dayjs from "dayjs"
import { useMemo, useState } from "react"
import { AlertTriangle, Clock3, Factory, Search, TimerReset, Truck } from "lucide-react"
import { useSearchParams } from "next/navigation"

import { EmptyState, ExecutiveHero, MetricCard, MetricRail, Panel, StatusBadge } from "@/components/erp/shell"
import { useMachines, usePlanningJobCards } from "@/hooks/use-production"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"

function formatDate(value?: string | null) {
  if (!value) return "-"
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format("DD MMM YYYY") : String(value)
}

export default function PlanningTrackerPage() {
  const searchParams = useSearchParams()
  const section = String(searchParams?.get("section") || "winder").toLowerCase()
  const [search, setSearch] = useState("")
  const jobsQuery = usePlanningJobCards({ limit: 500 })
  const machinesQuery = useMachines()

  const jobs = Array.isArray(jobsQuery.data) ? jobsQuery.data : []
  const deferredSearch = search.trim().toLowerCase()
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

  const scopedJobs = useMemo(() => {
    const filteredBySearch = deferredSearch
      ? jobs.filter((job: any) =>
          [
            job.job_card_ref,
            job.product_code,
            job.customer_name,
            job.current_stage,
            job.status,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(deferredSearch),
        )
      : jobs

    return filteredBySearch
  }, [deferredSearch, jobs])

  const activeJobs = scopedJobs.filter((job: any) => String(job.status || "").toUpperCase() !== "COMPLETED")
  const completedJobs = scopedJobs.filter((job: any) => String(job.status || "").toUpperCase() === "COMPLETED")
  const blockedJobs = activeJobs.filter((job: any) => Boolean(job.blocked_reason))
  const dueRiskJobs = activeJobs.filter((job: any) => job.due_date && dayjs(job.due_date).isBefore(dayjs().add(1, "day"), "day"))
  const dispatchJobs = activeJobs.filter((job: any) => String(job.current_stage || "").toUpperCase() === "DISPATCH")

  return (
    <div className="space-y-6">
      <ExecutiveHero
        appearance={MODULE_APPEARANCES.planning}
        badge="Job Tracker"
        title="Track released work across WIP, completion, and stage stalls"
        description="Recovered tracker page for planners and supervisors. Use this to answer where every released job is standing, what is blocked, and what already cleared the floor."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/planning/board?section=${section}`} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Return to planner
            </Link>
            <Link href="/production/job-cards" className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
              Job card queue
            </Link>
          </div>
        }
      />

      <MetricRail>
        <MetricCard label="Active WIP" value={activeJobs.length} detail="Released jobs still moving through the plant" icon={Factory} tone="cyan" />
        <MetricCard label="Blocked" value={blockedJobs.length} detail="Jobs carrying a blocking reason or stage hold" icon={AlertTriangle} tone="rose" />
        <MetricCard label="Due Risk" value={dueRiskJobs.length} detail="Need intervention before the next day window" icon={TimerReset} tone="amber" />
        <MetricCard label="Dispatch Stage" value={dispatchJobs.length} detail="Finished jobs waiting for outward truth" icon={Truck} tone="emerald" />
        <MetricCard label="Completed" value={completedJobs.length} detail="Recovered history already closed on the floor" icon={Clock3} tone="violet" />
      </MetricRail>

      <Panel
        title="Tracker Grid"
        subtitle="Search by job card, product code, customer, or stage. Active rows stay on top and completed history remains in the same surface."
        actions={
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search job card, product, customer, stage..."
              className="w-80 bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </div>
        }
      >
        {jobsQuery.isLoading ? (
          <EmptyState label="Loading recovered job tracker..." />
        ) : scopedJobs.length === 0 ? (
          <EmptyState label="No jobs matched this tracker filter." />
        ) : (
          <div className="overflow-x-auto rounded-[1.35rem] border border-slate-200">
            <table className="min-w-full">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Job Card</th>
                  <th className="px-4 py-3 text-left">Product</th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left">Release</th>
                  <th className="px-4 py-3 text-left">Target Winder</th>
                  <th className="px-4 py-3 text-left">Stage</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-left">Plan Slot</th>
                  <th className="px-4 py-3 text-left">Due</th>
                  <th className="px-4 py-3 text-left">Block / Context</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {scopedJobs.map((job: any) => (
                  <tr key={job.id}>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-900">
                      <Link href={`/production/job-cards/${job.id}`} className="hover:text-cyan-700">
                        {job.job_card_ref || String(job.id).slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">{job.product_code || "-"}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{job.customer_name || "-"}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      <div>{job.release_lot_id ? `Lot ${String(job.release_lot_id).slice(0, 8)}` : "-"}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        Line {job.sales_order_line_id ? String(job.sales_order_line_id).slice(0, 8) : "-"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {job.assigned_winder_machine_id
                        ? machineLabelMap.get(String(job.assigned_winder_machine_id)) || String(job.assigned_winder_machine_id).slice(0, 8)
                        : "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">{job.current_stage || "-"}</td>
                    <td className="px-4 py-3">
                      <div className="space-y-2">
                        <StatusBadge value={job.status || "-"} />
                        <StatusBadge value={job.planner_gate_ready ? "READY" : "BLOCKED"} label={job.planner_gate_ready ? "Planner ready" : "Planner gate"} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-slate-700">{Number(job.planned_qty || 0).toFixed(0)}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {job.active_segment_plan_date ? formatDate(job.active_segment_plan_date) : "-"}
                      <div className="mt-1 text-xs text-slate-500">
                        {job.active_segment_machine_id
                          ? machineLabelMap.get(String(job.active_segment_machine_id)) || String(job.active_segment_machine_id).slice(0, 8)
                          : "No active machine"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">{formatDate(job.due_date)}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {job.blocked_reason || job.planner_gate_reason || job.current_machine_id || job.current_shift_code || "Flowing"}
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
