"use client"

import Link from "next/link"
import dayjs from "dayjs"
import { ArrowLeft, ClipboardCheck, Factory, Layers3, ScrollText } from "lucide-react"
import { useMemo } from "react"
import { useParams } from "next/navigation"

import { ExecutiveHero, EmptyState, MetricCard, MetricRail, Panel, StatusBadge } from "@/components/erp/shell"
import { useCustomers } from "@/hooks/use-master-data"
import { usePlanningJobCards } from "@/hooks/use-production"
import { useSalesOrder } from "@/hooks/use-sales"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"

function formatDate(value?: string | null) {
  if (!value) return "-"
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format("DD MMM YYYY") : String(value)
}

export default function SalesOrderDetailPage() {
  const params = useParams()
  const orderId = String(params?.orderId || "")

  const orderQuery = useSalesOrder(orderId)
  const customersQuery = useCustomers()
  const jobCardsQuery = usePlanningJobCards({ search: orderId, limit: 100 }, Boolean(orderId))

  const customerMap = useMemo(
    () =>
      new Map<string, string>(
        (Array.isArray(customersQuery.data) ? customersQuery.data : []).map((customer: any) => [
          String(customer.id),
          customer.customer_code ? `${customer.customer_code} · ${customer.name}` : customer.name,
        ]),
      ),
    [customersQuery.data],
  )

  const order = orderQuery.data
  const orderJobs = useMemo(
    () =>
      (Array.isArray(jobCardsQuery.data) ? jobCardsQuery.data : []).filter(
        (job: any) => String(job.sales_order_id || "") === orderId,
      ),
    [jobCardsQuery.data, orderId],
  )

  const customerLabel = useMemo(() => {
    if (!order) return "-"
    return customerMap.get(String(order.customer_id || "")) || order.customer_name || String(order.customer_id || "-")
  }, [customerMap, order])

  if (orderQuery.isLoading) {
    return <EmptyState label="Loading sales order..." />
  }

  if (!order) {
    return <EmptyState label="Sales order not found." />
  }

  return (
    <div className="space-y-6" data-testid="sales-orders:tracking-page">
      <ExecutiveHero
        appearance={MODULE_APPEARANCES.sales}
        badge="Sales Tracking"
        title={order.order_no || `Sales order ${orderId}`}
        description="Commercial truth, release state, and planner job-card sync stay on one tracking page."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/sales-orders" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <ArrowLeft className="h-4 w-4" />
              Back to queue
            </Link>
            <Link href={`/sales-orders/${order.id}/audit`} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <ScrollText className="h-4 w-4" />
              Audit timeline
            </Link>
          </div>
        }
        aside={
          <div className="space-y-3">
            <div className="rounded-[1.15rem] border border-white/10 bg-white/10 p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-emerald-100">Current Status</p>
              <div className="mt-3">
                <StatusBadge value={order.status} className="border-white/20 bg-white/10 text-white" />
              </div>
            </div>
            <div className="rounded-[1.15rem] border border-white/10 bg-white/10 p-4 text-sm text-emerald-100">
              <p>{customerLabel}</p>
              <p className="mt-1 text-xs text-emerald-100/80">Created {formatDate(order.created_at)}</p>
            </div>
          </div>
        }
      />

      <MetricRail>
        <MetricCard label="Line Count" value={order.line_count} detail="Commercial buckets under this PO" icon={Layers3} tone="cyan" />
        <MetricCard label="Open Qty" value={Number(order.remaining_qty || 0).toFixed(0)} detail="Quantity still not fulfilled" icon={Factory} tone="amber" />
        <MetricCard label="Released Qty" value={Number(order.released_qty || 0).toFixed(0)} detail="Already moved into production" icon={ClipboardCheck} tone="emerald" />
        <MetricCard label="Planner Cards" value={orderJobs.length} detail="Synced job cards for this order" icon={ScrollText} tone="violet" />
      </MetricRail>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel title="Commercial Header" subtitle="High-signal order context for sales, planning, and dispatch.">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Customer</p>
              <p className="mt-2 font-semibold text-slate-950">{customerLabel}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">PO Context</p>
              <p className="mt-2 font-semibold text-slate-950">{order.po_number || order.order_no || "-"}</p>
              <p className="mt-1 text-slate-600">PO Date {formatDate(order.po_date)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Notes</p>
              <p className="mt-2 text-slate-700">{order.notes || "No commercial notes recorded."}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Approved</p>
              <p className="mt-2 text-slate-700">{formatDate(order.approved_at)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Released</p>
              <p className="mt-2 text-slate-700">{formatDate(order.released_at)}</p>
            </div>
          </div>
        </Panel>

        <Panel title="Planner Sync" subtitle="Recovered job-card truth linked back to the sales order.">
          {orderJobs.length === 0 ? (
            <EmptyState label="No job cards have been synced for this sales order yet." />
          ) : (
            <div className="space-y-3">
              {orderJobs.slice(0, 6).map((job: any) => (
                <Link
                  key={job.id}
                  href={`/production/job-cards/${job.id}`}
                  className="block rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:bg-white hover:shadow-md"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{job.job_card_ref || String(job.id).slice(0, 8)}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {job.current_stage} · {Number(job.planned_qty || 0).toFixed(0)} pcs · Due {formatDate(job.due_date)}
                      </p>
                    </div>
                    <StatusBadge value={job.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Order Lines" subtitle="The exact release and fulfillment posture for every commercial line.">
        <div className="overflow-x-auto rounded-[1.35rem] border border-slate-200">
          <table className="min-w-full">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">Line</th>
                <th className="px-4 py-3 text-left">Product Code</th>
                <th className="px-4 py-3 text-left">Approved Spec</th>
                <th className="px-4 py-3 text-left">Parchment</th>
                <th className="px-4 py-3 text-left">Due</th>
                <th className="px-4 py-3 text-right">Rate</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Released</th>
                <th className="px-4 py-3 text-right">Fulfilled</th>
                <th className="px-4 py-3 text-right">Remaining</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {(order.lines || []).map((line: any, index: number) => (
                <tr key={line.id}>
                  <td className="px-4 py-3 text-sm font-semibold text-slate-900">Line {line.line_no || index + 1}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{line.product_code || "-"}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{String(line.approved_spec_id || "-").slice(0, 8)}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{line.parchment_color || "-"}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{formatDate(line.due_date)}</td>
                  <td className="px-4 py-3 text-right text-sm text-slate-700">{line.rate_per_pc ? Number(line.rate_per_pc).toFixed(2) : "-"}</td>
                  <td className="px-4 py-3 text-right text-sm text-slate-700">{Number(line.qty || 0).toFixed(0)}</td>
                  <td className="px-4 py-3 text-right text-sm text-slate-700">{Number(line.released_qty || 0).toFixed(0)}</td>
                  <td className="px-4 py-3 text-right text-sm text-slate-700">{Number(line.fulfilled_qty || 0).toFixed(0)}</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-slate-950">{Number(line.remaining_qty || 0).toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
