"use client"

import Link from "next/link"
import dayjs from "dayjs"
import { ArrowLeft, ArrowRight, ClipboardCheck, Factory, Layers3, ScrollText } from "lucide-react"
import { useMemo, useState } from "react"
import { useParams } from "next/navigation"

import { ExecutiveHero, EmptyState, MetricCard, MetricRail, Panel, StatusBadge } from "@/components/erp/shell"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { ReleaseToQueueDialog } from "@/components/sales/release-to-queue-dialog"
import { DeliverySchedulePanel } from "@/components/sales/delivery-schedule-panel"
import { useApp } from "@/context/AppContext"
import { useCustomers } from "@/hooks/use-master-data"
import { usePlanningJobCards } from "@/hooks/use-production"
import { useApproveSalesOrder, useSalesOrder } from "@/hooks/use-sales"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"
import { jobCardRef } from "@/lib/job-card-display"
import {
  isInternalOrigin,
  parchmentLineLabel,
  salesOrderOriginLabel,
  salesOrderReferenceLabel,
} from "@/lib/sales-order-entry"

function formatDate(value?: string | null) {
  if (!value) return "-"
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format("DD MMM YYYY") : String(value)
}

export default function SalesOrderDetailPage() {
  const params = useParams()
  const orderId = String(params?.orderId || "")
  const { showToast } = useApp()
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([])
  const [releaseOpen, setReleaseOpen] = useState(false)

  const orderQuery = useSalesOrder(orderId)
  const customersQuery = useCustomers()
  const jobCardsQuery = usePlanningJobCards({ sales_order_id: orderId, limit: 250 }, Boolean(orderId))
  const approveOrder = useApproveSalesOrder()

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
        .map((line: any) => line.earliest_delivery_date ?? line.due_date)
        .filter(Boolean)
        .sort()[0] || null,
    [order?.lines],
  )

  const canApprove = ["draft", "submitted"].includes(String(order?.status || "").toLowerCase())
  const canRelease = ["approved", "released", "partially_released", "partially_dispatched"].includes(String(order?.status || "").toLowerCase())

  const handleApprove = async () => {
    try {
      await approveOrder.mutateAsync({ orderId, plantId: String(order?.plant_id || order?.plant || "") || undefined })
      showToast("Sales order approved.", "success")
      return true
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Approval failed."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
      return false
    }
  }

  const handleOpenRelease = () => {
    const lineIds = selectedLineIds.length ? selectedLineIds : (order?.lines || []).map((line: any) => String(line.id))
    if (!lineIds.length) {
      showToast("This order has no lines to release.", "error")
      return
    }
    setSelectedLineIds(lineIds)
    setReleaseOpen(true)
  }

  if (orderQuery.isLoading) {
    return <LoadingState label="Loading sales order..." />
  }

  if (orderQuery.isError) {
    return (
      <ErrorState
        title="Sales order could not be loaded"
        message="Refresh to retry. This is not a missing order."
        onRetry={() => {
          void orderQuery.refetch()
        }}
      />
    )
  }

  if (!order) {
    return <EmptyState label="Sales order not found." />
  }

  return (
    <div className="space-y-6" data-testid="sales-orders:tracking-page">
      <ExecutiveHero
        appearance={MODULE_APPEARANCES.sales}
        badge="Sales Tracking"
        title={salesOrderReferenceLabel(order)}
        description={`${salesOrderOriginLabel(order.origin)} for ${customerLabel}. Created ${formatDate(order.created_at)}.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/sales-orders" className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-muted hover:shadow-sm">
              <ArrowLeft className="h-4 w-4" />
              Back to queue
            </Link>
            {order.status === "draft" || order.status === "submitted" ? (
              <Link href={`/sales-orders/${order.id}/edit`} className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-muted hover:shadow-sm">
                Edit order
              </Link>
            ) : null}
            {canApprove || canRelease ? (
              <button
                type="button"
                data-testid="sales-order-detail:approve-release"
                onClick={async () => {
                  if (canApprove) {
                    const approved = await handleApprove()
                    if (!approved) return
                  }
                  handleOpenRelease()
                }}
                disabled={approveOrder.isPending}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
              >
                Approve + Release
              </button>
            ) : null}
            <Link href="/sales-orders/pending" className="inline-flex items-center gap-2 rounded-xl border border-border/30 px-4 py-2.5 text-sm font-semibold text-white">
              Pending workspace
            </Link>
            <Link href={`/planning/board?section=winder&order_id=${order.id}`} className="inline-flex items-center gap-2 rounded-xl bg-card/10 px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-card/20">
              Open planner handoff
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        }
        aside={
          <div className="space-y-3">
            <div className="rounded-[1.15rem] border border-border/10 bg-card/10 p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-emerald-100">Current Status</p>
              <div className="mt-3">
                <StatusBadge value={order.status} className="border-border/20 bg-card/10 text-white" />
              </div>
            </div>
            <div className="rounded-[1.15rem] border border-border/10 bg-card/10 p-4 text-sm text-emerald-100">
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
            <div className="rounded-2xl border border-border bg-muted p-4 text-sm">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Customer</p>
              <p className="mt-2 font-semibold text-foreground">{customerLabel}</p>
            </div>
            <div className="rounded-2xl border border-border bg-muted p-4 text-sm">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Order source</p>
              <p className="mt-2 font-semibold text-foreground">{salesOrderOriginLabel(order.origin)}</p>
              <p className="mt-1 text-muted-foreground">{salesOrderReferenceLabel(order)}</p>
              {isInternalOrigin(order.origin) ? (
                <p className="mt-1 text-muted-foreground">Internal order date {formatDate(order.internal_order_date)}</p>
              ) : (
                <p className="mt-1 text-muted-foreground">Customer PO Date {formatDate(order.po_date)}</p>
              )}
            </div>
            <div className="rounded-2xl border border-border bg-muted p-4 text-sm">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Commercial Notes</p>
              <p className="mt-2 text-muted-foreground">{order.notes || "No commercial notes recorded."}</p>
            </div>
            <div className="rounded-2xl border border-border bg-muted p-4 text-sm">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Earliest Delivery Date</p>
              <p className="mt-2 text-muted-foreground">{formatDate(earliestDue)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Earliest outstanding call-off, or unscheduled line delivery date.</p>
            </div>
            <div className="rounded-2xl border border-border bg-muted p-4 text-sm">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Approved</p>
              <p className="mt-2 text-muted-foreground">{formatDate(order.approved_at)}</p>
            </div>
            <div className="rounded-2xl border border-border bg-muted p-4 text-sm">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Released</p>
              <p className="mt-2 text-muted-foreground">{formatDate(order.released_at)}</p>
            </div>
          </div>
        </Panel>

        <Panel title="Flow Next" subtitle="What this PO should do next in the sales -> planning -> production path.">
          <div className="space-y-4">
            <div className="rounded-[1.25rem] border border-border bg-card p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Planner Handoff</p>
              <p className="mt-2 text-lg font-semibold text-foreground">Release exact line quantities and schedule them into the next 3 days.</p>
              <p className="mt-2 text-sm text-muted-foreground">Each job becomes floor-executable only after the planner assigns a valid machine, shift, and plan date.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Link
                href={`/planning/board?section=winder&order_id=${order.id}`}
                className="rounded-xl border border-border bg-card px-4 py-4 text-sm font-semibold text-foreground transition hover:-translate-y-0.5 hover:shadow-md"
              >
                Open winder board
              </Link>
              <Link
                href={`/planning/tracker?section=winder`}
                className="rounded-xl border border-border bg-card px-4 py-4 text-sm font-semibold text-foreground transition hover:-translate-y-0.5 hover:shadow-md"
              >
                Open tracker
              </Link>
            </div>
            <div className="rounded-[1.2rem] border border-border bg-muted p-4 text-sm text-muted-foreground">
              {orderJobs.length === 0
                ? "No job cards are synced from this PO yet."
                : `${orderJobs.length} planner-linked job card(s) already exist for this PO. One PO can safely split into many job cards.`}
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Planner Sync" subtitle="Released job-card truth linked back to this customer PO.">
        {orderJobs.length === 0 ? (
          <EmptyState label="No job cards have been synced for this sales order yet." />
        ) : (
          <div className="max-h-[34rem] overflow-y-auto pr-1">
            <div className="grid gap-4 lg:grid-cols-2">
              {orderJobs.map((job: any) => (
                <div
                  key={job.id}
                  className="rounded-2xl border border-border bg-muted p-4 transition hover:-translate-y-0.5 hover:bg-card hover:shadow-md"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{jobCardRef(job)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {job.product_code || "No product code"} · {job.current_stage} · {Number(job.planned_qty || 0).toFixed(0)} pcs
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Line {String(job.sales_order_line_id || "").slice(0, 8)} · Release {String(job.release_lot_id || "").slice(0, 8)}
                      </p>
                    </div>
                    <StatusBadge value={job.status} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href={`/production/job-cards/${job.id}`}
                      className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted"
                    >
                      Job card
                    </Link>
                    <Link
                      href={`/inventory/genealogy?job_card_id=${job.id}`}
                      className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                    >
                      Full trace
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Order Lines" subtitle="Every line stays visible as its own long-running release bucket under the same PO.">
        <div className="grid gap-4">
          {(order.lines || []).map((line: any, index: number) => (
            <div key={line.id} className="rounded-[1.35rem] border border-border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <div>
                  <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={selectedLineIds.includes(String(line.id))}
                      onChange={(event) => {
                        const id = String(line.id)
                        setSelectedLineIds((current) => event.target.checked ? [...current, id] : current.filter((value) => value !== id))
                      }}
                    />
                    Line {line.line_no || index + 1}
                  </label>
                  <h3 className="mt-2 text-lg font-semibold text-foreground">{line.product_code || "No product code"}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Spec {String(line.approved_spec_id || "-").slice(0, 8)} · {parchmentLineLabel(line)} · Delivery {formatDate(line.due_date)}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-border bg-muted px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Qty</p>
                    <p className="mt-1 text-base font-semibold text-foreground">{Number(line.qty || 0).toFixed(0)}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Released</p>
                    <p className="mt-1 text-base font-semibold text-foreground">{Number(line.released_qty || 0).toFixed(0)}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Fulfilled</p>
                    <p className="mt-1 text-base font-semibold text-foreground">{Number(line.fulfilled_qty || 0).toFixed(0)}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Remaining</p>
                    <p className="mt-1 text-base font-semibold text-foreground">{Number(line.remaining_qty || 0).toFixed(0)}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <DeliverySchedulePanel order={order} />
      <ReleaseToQueueDialog
        order={order}
        selectedLineIds={selectedLineIds.length ? selectedLineIds : (order.lines || []).map((line: any) => String(line.id))}
        open={releaseOpen}
        onOpenChange={setReleaseOpen}
      />
    </div>
  )
}
