"use client"

import Link from "next/link"
import dayjs from "dayjs"
import { useDeferredValue, useMemo, useState } from "react"
import { AlertTriangle, ClipboardList, Factory, Search, TimerReset, Truck } from "lucide-react"
import { useSearchParams } from "next/navigation"

import { EmptyState, ExecutiveHero, MetricCard, MetricRail, Panel, StatusBadge } from "@/components/erp/shell"
import { useMachines, usePlanningJobCards } from "@/hooks/use-production"
import { useSalesOrders } from "@/hooks/use-sales"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"
import { compactRef, jobCardRef } from "@/lib/job-card-display"

function formatDate(value?: string | null) {
  if (!value) return "-"
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format("DD MMM YYYY") : String(value)
}

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function stageLabel(stageCounts: Record<string, number>) {
  const entries = Object.entries(stageCounts).sort((a, b) => b[1] - a[1])
  if (!entries.length) return "Not released"
  return entries.map(([stage, count]) => `${stage} ${count}`).join(" · ")
}

export default function PlanningTrackerPage() {
  const searchParams = useSearchParams()
  const section = String(searchParams?.get("section") || "winder").toLowerCase()
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("ALL")
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())

  const ordersQuery = useSalesOrders()
  const jobsQuery = usePlanningJobCards({ limit: 750 })
  const machinesQuery = useMachines()

  const orders = useMemo(() => (Array.isArray(ordersQuery.data) ? ordersQuery.data : []), [ordersQuery.data])
  const jobs = useMemo(() => (Array.isArray(jobsQuery.data) ? jobsQuery.data : []), [jobsQuery.data])
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

  const trackerRows = useMemo(() => {
    return orders.map((order: any) => {
      const lineIds = new Set((order.lines || []).map((line: any) => String(line.id || "")))
      const linkedJobs = jobs.filter((job: any) => {
        return String(job.sales_order_id || "") === String(order.id || "") || lineIds.has(String(job.sales_order_line_id || ""))
      })
      const stageCounts = linkedJobs.reduce((acc: Record<string, number>, job: any) => {
        const stage = String(job.current_stage || "CREATED").toUpperCase()
        acc[stage] = (acc[stage] || 0) + 1
        return acc
      }, {})
      const blockedJobs = linkedJobs.filter((job: any) => Boolean(job.blocked_reason || job.planner_gate_reason))
      const dispatchJobs = linkedJobs.filter((job: any) => String(job.current_stage || "").toUpperCase() === "DISPATCH")
      const completedJobs = linkedJobs.filter((job: any) => String(job.status || "").toUpperCase() === "COMPLETED")
      const dueDates = [
        ...(order.lines || []).map((line: any) => line.due_date).filter(Boolean),
        ...linkedJobs.map((job: any) => job.due_date).filter(Boolean),
      ]
      const earliestDue = dueDates
        .map((value) => dayjs(value))
        .filter((value) => value.isValid())
        .sort((a, b) => a.valueOf() - b.valueOf())[0]
      const dueRisk = earliestDue ? earliestDue.isBefore(dayjs().add(2, "day"), "day") : false
      const releasedQty = linkedJobs.reduce((sum: number, job: any) => sum + numberValue(job.planned_qty ?? job.segment_planned_qty), 0)
      const orderQty = numberValue(order.total_qty)
      const fulfilledQty = numberValue(order.fulfilled_qty)
      const orderRef = order.order_no || order.sales_order_no || order.so_no || order.po_number || compactRef(order.id, "SO")
      const currentStatus =
        blockedJobs.length > 0
          ? "Blocked"
          : completedJobs.length && completedJobs.length === linkedJobs.length
            ? "Completed"
            : dispatchJobs.length
              ? "Dispatch ready"
              : linkedJobs.length
                ? "In production"
                : "Commercial open"

      return {
        order,
        orderRef,
        linkedJobs,
        blockedJobs,
        dispatchJobs,
        completedJobs,
        stageCounts,
        stageSummary: stageLabel(stageCounts),
        dueRisk,
        earliestDue: earliestDue?.toISOString() || null,
        orderQty,
        releasedQty,
        fulfilledQty,
        remainingQty: numberValue(order.remaining_qty),
        currentStatus,
      }
    })
  }, [jobs, orders])

  const filteredRows = useMemo(() => {
    return trackerRows.filter((row: any) => {
      if (status !== "ALL" && row.currentStatus !== status) return false
      if (!deferredSearch) return true
      const haystack = [
        row.orderRef,
        row.order.customer_name,
        row.order.po_number,
        row.order.status,
        row.stageSummary,
        ...(row.order.lines || []).flatMap((line: any) => [line.product_code, line.parchment_color]),
        ...row.linkedJobs.flatMap((job: any) => [jobCardRef(job), job.product_code, job.customer_name, job.current_stage]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(deferredSearch)
    })
  }, [deferredSearch, status, trackerRows])

  const metrics = useMemo(() => {
    const openOrders = trackerRows.filter((row: any) => row.currentStatus !== "Completed")
    return {
      openOrders,
      unreleased: trackerRows.filter((row: any) => row.linkedJobs.length === 0),
      blocked: trackerRows.filter((row: any) => row.blockedJobs.length > 0),
      dueRisk: trackerRows.filter((row: any) => row.dueRisk),
      dispatchReady: trackerRows.filter((row: any) => row.dispatchJobs.length > 0),
    }
  }, [trackerRows])

  return (
    <div className="space-y-6">
      <ExecutiveHero
        appearance={MODULE_APPEARANCES.planning}
        badge="Sales Order Tracker"
        title="Customer order to dispatch tracker"
        description="This page tracks each sales order across commercial demand, release lots, job cards, WIP stages, and dispatch readiness. Use Job Cards for the individual production-card register."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/planning/board?section=${section}`} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Planning board
            </Link>
            <Link href="/production/job-cards" className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
              Job-card register
            </Link>
          </div>
        }
      />

      <MetricRail>
        <MetricCard label="Open Orders" value={metrics.openOrders.length} detail="Sales orders not fully completed" icon={ClipboardList} tone="cyan" />
        <MetricCard label="Not Released" value={metrics.unreleased.length} detail="Commercial demand without job cards" icon={Factory} tone="amber" />
        <MetricCard label="Blocked" value={metrics.blocked.length} detail="Any linked job card carrying a hold" icon={AlertTriangle} tone="rose" />
        <MetricCard label="Due Risk" value={metrics.dueRisk.length} detail="Due date inside the near window" icon={TimerReset} tone="amber" />
        <MetricCard label="Dispatch Ready" value={metrics.dispatchReady.length} detail="At least one linked card is at dispatch" icon={Truck} tone="emerald" />
      </MetricRail>

      <Panel
        title="Sales Order Tracking Grid"
        subtitle="One row per customer order. Expand from here into sales order detail, planner board, or job-card register."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search SO, customer, product, job card..."
                className="w-80 bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </div>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
            >
              <option value="ALL">All flow states</option>
              <option value="Commercial open">Commercial open</option>
              <option value="In production">In production</option>
              <option value="Dispatch ready">Dispatch ready</option>
              <option value="Blocked">Blocked</option>
              <option value="Completed">Completed</option>
            </select>
          </div>
        }
      >
        {ordersQuery.isLoading || jobsQuery.isLoading ? (
          <EmptyState label="Loading sales-order tracker..." />
        ) : filteredRows.length === 0 ? (
          <EmptyState label="No sales orders matched this tracker filter." />
        ) : (
          <div className="overflow-x-auto rounded-[1.35rem] border border-slate-200">
            <table className="min-w-full">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Sales Order</th>
                  <th className="px-4 py-3 text-left">Customer / PO</th>
                  <th className="px-4 py-3 text-right">Demand</th>
                  <th className="px-4 py-3 text-right">Released</th>
                  <th className="px-4 py-3 text-left">Flow State</th>
                  <th className="px-4 py-3 text-left">Stage Mix</th>
                  <th className="px-4 py-3 text-left">Job Cards</th>
                  <th className="px-4 py-3 text-left">Due / Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {filteredRows.map((row: any) => (
                  <tr key={row.order.id} className="transition hover:bg-cyan-50/40">
                    <td className="px-4 py-4">
                      <Link href={`/sales-orders/${row.order.id}`} className="text-sm font-black text-slate-950 hover:text-cyan-700">
                        {row.orderRef}
                      </Link>
                      <div className="mt-1 text-xs text-slate-500">Internal {compactRef(row.order.id, "SO")}</div>
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-700">
                      <div className="font-semibold text-slate-900">{row.order.customer_name || "Customer"}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        PO {row.order.po_number || "not entered"} · {row.order.line_count || 0} line(s)
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-semibold text-slate-900">
                      {row.orderQty.toLocaleString("en-IN")}
                      <div className="mt-1 text-xs text-slate-500">{row.remainingQty.toLocaleString("en-IN")} open</div>
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-semibold text-slate-900">
                      {row.releasedQty.toLocaleString("en-IN")}
                      <div className="mt-1 text-xs text-slate-500">{row.fulfilledQty.toLocaleString("en-IN")} fulfilled</div>
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge value={row.currentStatus} />
                      <div className="mt-2 text-xs text-slate-500">{row.linkedJobs.length ? "Production card(s) linked" : "Release from sales order required"}</div>
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-700">
                      {row.stageSummary}
                      {row.blockedJobs.length ? <div className="mt-1 text-xs font-semibold text-rose-700">{row.blockedJobs.length} blocked job(s)</div> : null}
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-700">
                      {row.linkedJobs.length === 0 ? (
                        <span className="text-slate-400">No cards yet</span>
                      ) : (
                        <div className="flex max-w-[260px] flex-wrap gap-1.5">
                          {row.linkedJobs.slice(0, 4).map((job: any) => (
                            <Link
                              key={job.id}
                              href={`/production/job-cards/${job.id}`}
                              className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700 hover:border-cyan-200 hover:bg-cyan-50"
                              title={`${jobCardRef(job)} · ${job.assigned_winder_machine_id ? machineLabelMap.get(String(job.assigned_winder_machine_id)) || "target winder" : "no winder"}`}
                            >
                              {jobCardRef(job)}
                            </Link>
                          ))}
                          {row.linkedJobs.length > 4 ? (
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500">+{row.linkedJobs.length - 4}</span>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-700">
                      <div className={row.dueRisk ? "font-semibold text-amber-700" : ""}>Due {formatDate(row.earliestDue)}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Link href={`/sales-orders/${row.order.id}`} className="text-xs font-black text-cyan-800 hover:text-cyan-950">
                          View SO
                        </Link>
                        <Link href={`/planning/board?section=${section}`} className="text-xs font-black text-slate-800 hover:text-slate-950">
                          Plan
                        </Link>
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
