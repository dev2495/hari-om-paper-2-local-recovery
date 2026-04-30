"use client"

import Link from "next/link"
import dayjs from "dayjs"
import { ArrowLeft, ClipboardCheck, ScrollText } from "lucide-react"
import { useMemo } from "react"
import { useParams } from "next/navigation"

import { EmptyState, Panel, StatusBadge } from "@/components/erp/shell"
import { usePlanningJobCards } from "@/hooks/use-production"
import { useSalesOrder, useSalesOrderTimeline } from "@/hooks/use-sales"
import { jobCardRef } from "@/lib/job-card-display"

function formatDateTime(value?: string | null) {
  if (!value) return "-"
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format("DD MMM YYYY, hh:mm A") : String(value)
}

export default function SalesOrderAuditPage() {
  const params = useParams()
  const orderId = String(params?.orderId || "")

  const orderQuery = useSalesOrder(orderId)
  const timelineQuery = useSalesOrderTimeline(orderId)
  const jobCardsQuery = usePlanningJobCards({ search: orderId, limit: 100 }, Boolean(orderId))

  const order = orderQuery.data
  const events = useMemo(() => {
    const baseEvents = Array.isArray(timelineQuery.data) ? timelineQuery.data : []
    const jobEvents = (Array.isArray(jobCardsQuery.data) ? jobCardsQuery.data : [])
      .filter((job: any) => String(job.sales_order_id || "") === orderId)
      .map((job: any) => ({
        id: `${job.id}:job-card`,
        event_type: "JOB_CARD_SYNCED",
        title: `Job card synced: ${jobCardRef(job)}`,
        message: `${job.current_stage} queue created for ${Number(job.planned_qty || 0).toFixed(0)} pcs.`,
        created_at: job.created_at,
        actor: job.current_machine_id || "planner",
      }))

    return [...baseEvents, ...jobEvents].sort(
      (left: any, right: any) =>
        dayjs(right?.created_at || 0).valueOf() - dayjs(left?.created_at || 0).valueOf(),
    )
  }, [jobCardsQuery.data, orderId, timelineQuery.data])

  if (orderQuery.isLoading) {
    return <EmptyState label="Loading sales order audit trail..." />
  }

  if (!order) {
    return <EmptyState label="Sales order not found." />
  }

  return (
    <div className="space-y-6">
      <Panel
        title="Sales order audit timeline"
        subtitle="Commercial actions and planner sync events stitched into one trace."
        actions={
          <Link href={`/sales-orders/${order.id}`} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" />
            Back to tracking
          </Link>
        }
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Order</p>
            <p className="mt-2 text-sm font-semibold text-slate-950">{order.order_no}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Status</p>
            <div className="mt-2">
              <StatusBadge value={order.status} />
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Audit Events</p>
            <p className="mt-2 text-sm font-semibold text-slate-950">{events.length}</p>
          </div>
        </div>
      </Panel>

      <Panel title="Timeline" subtitle="Newest events first.">
        {timelineQuery.isLoading ? (
          <EmptyState label="Loading audit events..." />
        ) : events.length === 0 ? (
          <EmptyState label="No audit events were recorded for this order yet." />
        ) : (
          <div className="space-y-3">
            {events.map((event: any) => (
              <div key={event.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      {String(event.event_type || "").includes("JOB_CARD") ? (
                        <ClipboardCheck className="h-4 w-4 text-emerald-700" />
                      ) : (
                        <ScrollText className="h-4 w-4 text-slate-700" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{event.title || event.event_type}</p>
                      <p className="mt-1 text-sm text-slate-600">{event.message || "Event captured."}</p>
                    </div>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <div>{formatDateTime(event.created_at)}</div>
                    <div className="mt-1">{event.actor || "system"}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
