"use client"

import Link from "next/link"
import dayjs from "dayjs"
import { ArrowLeft, ArrowRight, ClipboardCheck, Factory, Layers3, ScrollText } from "lucide-react"
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

  const earliestDue = useMemo(
    () =>
      [...(order?.lines || [])]
        .map((line: any) => line.due_date)
        .filter(Boolean)
        .sort()[0] || null,
    [order?.lines],
  )

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
        title={order.po_number || order.order_no || `Sales order ${orderId}`}
        description="One PO, many release moments. Use this page to read commercial truth, line posture, and current planner handoff together."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/sales-orders" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-sm">
              <ArrowLeft className="h-4 w-4" />
              Back to queue
            </Link>
            <Link href={`/planning/board?section=winder&order_id=${order.id}`} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-lg">
              Open planner handoff
              <ArrowRight className="h-4 w-4" />
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
        <MetricCard label="Line Count" value={order.line_count} detail="Commercial product buckets under this PO" icon={Layers3} tone="cyan" />
        <MetricCard label="Open Qty" value={Number(order.remaining_qty || 0).toFixed(0)} detail="Quantity still waiting for dispatch closure" icon={Factory} tone="amber" />
        <MetricCard label="Released Qty" value={Number(order.released_qty || 0).toFixed(0)} detail="Already cut into production demand" icon={ClipboardCheck} tone="emerald" />
        <MetricCard label="Planner Cards" value={orderJobs.length} detail="Job cards already synced from this PO" icon={ScrollText} tone="violet" />
      </MetricRail>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel title="Commercial Header" subtitle="The sales truth that planning and dispatch should read, not reinterpret.">
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
              <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Commercial Notes</p>
              <p className="mt-2 text-slate-700">{order.notes || "No commercial notes recorded."}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Earliest Due</p>
              <p className="mt-2 text-slate-700">{formatDate(earliestDue)}</p>
              <p className="mt-1 text-xs text-slate-500">Use this to prioritize release planning.</p>
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

        <Panel title="Flow Next" subtitle="What this PO should do next in the sales -> planning -> production path.">
          <div className="space-y-4">
            <div className="rounded-[1.25rem] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#ecfeff_100%)] p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Planner Handoff</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">Release exact line quantities and schedule them into the next 3 days.</p>
              <p className="mt-2 text-sm text-slate-600">Each job becomes floor-executable only after the planner assigns a valid machine, shift, and plan date.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Link
                href={`/planning/board?section=winder&order_id=${order.id}`}
                className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm font-semibold text-slate-900 transition hover:-translate-y-0.5 hover:shadow-md"
              >
                Open winder board
              </Link>
              <Link
                href={`/planning/tracker?section=winder`}
                className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm font-semibold text-slate-900 transition hover:-translate-y-0.5 hover:shadow-md"
              >
                Open tracker
              </Link>
            </div>
            <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              {orderJobs.length === 0
                ? "No job cards are synced from this PO yet."
                : `${orderJobs.length} planner-linked job card(s) already exist for this PO.`}
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Planner Sync" subtitle="Released job-card truth linked back to this customer PO.">
        {orderJobs.length === 0 ? (
          <EmptyState label="No job cards have been synced for this sales order yet." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {orderJobs.slice(0, 8).map((job: any) => (
              <Link
                key={job.id}
                href={`/production/job-cards/${job.id}`}
                className="block rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">{job.job_card_ref || String(job.id).slice(0, 8)}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {job.product_code || "No product code"} · {job.current_stage} · {Number(job.planned_qty || 0).toFixed(0)} pcs
                    </p>
                  </div>
                  <StatusBadge value={job.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Order Lines" subtitle="Every line stays visible as its own long-running release bucket under the same PO.">
        <div className="grid gap-4">
          {(order.lines || []).map((line: any, index: number) => (
            <div key={line.id} className="rounded-[1.35rem] border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Line {line.line_no || index + 1}</p>
                  <h3 className="mt-2 text-lg font-semibold text-slate-950">{line.product_code || "No product code"}</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Spec {String(line.approved_spec_id || "-").slice(0, 8)} · Parchment {line.parchment_color || "-"} · Due {formatDate(line.due_date)}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Qty</p>
                    <p className="mt-1 text-base font-semibold text-slate-950">{Number(line.qty || 0).toFixed(0)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Released</p>
                    <p className="mt-1 text-base font-semibold text-slate-950">{Number(line.released_qty || 0).toFixed(0)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Fulfilled</p>
                    <p className="mt-1 text-base font-semibold text-slate-950">{Number(line.fulfilled_qty || 0).toFixed(0)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Remaining</p>
                    <p className="mt-1 text-base font-semibold text-slate-950">{Number(line.remaining_qty || 0).toFixed(0)}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
