"use client"

import Link from "next/link"
import dayjs from "dayjs"
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Factory,
  History,
  Layers3,
  Palette,
  Pencil,
  Plus,
  Printer,
  Rocket,
  Trash2,
  Truck,
  Undo2,
} from "lucide-react"
import { useMemo, useState } from "react"
import { useParams } from "next/navigation"

import { EmptyState, MetricCard, MetricRail, Panel, StatusBadge } from "@/components/erp/shell"
import { StackedMeter } from "@/components/erp/viz"
import { ColorChip, JobCardNo, LifecycleBadge, lifecycleFromSummary, swatchFor } from "@/components/production/lifecycle-chips"
import { JobCardLifecycleSheet } from "@/components/production/job-card-lifecycle-sheet"
import { PageHeader } from "@/components/workspace/page-header"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { ReleaseToQueueDialog } from "@/components/sales/release-to-queue-dialog"
import { DeliverySchedulePanel } from "@/components/sales/delivery-schedule-panel"
import { useApp } from "@/context/AppContext"
import { apiErrorText, useUpdateLineColors } from "@/hooks/use-lifecycle"
import { useCustomers, useParchments } from "@/hooks/use-master-data"
import { usePlanningJobCards } from "@/hooks/use-production"
import { useApproveSalesOrder, useSalesOrder, useSalesOrderTimeline } from "@/hooks/use-sales"
import { cn } from "@/lib/utils"
import { isInternalOrigin, salesOrderOriginLabel, salesOrderReferenceLabel } from "@/lib/sales-order-entry"

const fmt = (value: unknown) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })

function formatDate(value?: string | null, template = "DD MMM YYYY") {
  if (!value) return "—"
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format(template) : String(value)
}

const TIMELINE_ICON: Record<string, any> = {
  SALES_ORDER_CREATED: ClipboardCheck,
  SALES_ORDER_APPROVED: CheckCircle2,
  SALES_ORDER_RELEASED: Rocket,
  SALES_ORDER_LINE_CREATED: Layers3,
  SALES_ORDER_LINE_RELEASED: Factory,
  SALES_ORDER_LOT_RETURNED: Undo2,
  SALES_ORDER_DISPATCH_RECORDED: Truck,
}

export default function SalesOrderDetailPage() {
  const params = useParams()
  const orderId = String(params?.orderId || "")
  const { showToast } = useApp()
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([])
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [sheetJobId, setSheetJobId] = useState<string | null>(null)

  const orderQuery = useSalesOrder(orderId)
  const timelineQuery = useSalesOrderTimeline(orderId)
  const customersQuery = useCustomers()
  const jobCardsQuery = usePlanningJobCards({ sales_order_id: orderId, limit: 250 }, Boolean(orderId))
  const approveOrder = useApproveSalesOrder()

  const customerMap = useMemo(
    () => new Map<string, string>((Array.isArray(customersQuery.data) ? customersQuery.data : []).map((customer: any) => [String(customer.id), customer.customer_code ? `${customer.customer_code} · ${customer.name}` : customer.name])),
    [customersQuery.data],
  )

  const order = orderQuery.data
  const orderJobs = useMemo(
    () => (Array.isArray(jobCardsQuery.data) ? jobCardsQuery.data : []).filter((job: any) => String(job.sales_order_id || "") === orderId),
    [jobCardsQuery.data, orderId],
  )
  const jobById = useMemo(() => new Map(orderJobs.map((job: any) => [String(job.id), job])), [orderJobs])
  const customerLabel = order ? customerMap.get(String(order.customer_id || "")) || order.customer_name || String(order.customer_id || "—") : "—"

  const totals = useMemo(() => {
    const lines = order?.lines || []
    const sum = (key: string) => lines.reduce((acc: number, line: any) => acc + Number(line[key] || 0), 0)
    const ordered = sum("qty")
    const released = sum("released_qty")
    const dispatched = sum("fulfilled_qty")
    const hold = sum("hold_qty")
    const returned = lines.flatMap((line: any) => line.release_lots || []).reduce((acc: number, lot: any) => acc + Number(lot.returned_qty || 0), 0)
    const inProduction = orderJobs.filter((job: any) => !["COMPLETED", "CANCELLED"].includes(String(job.status || "").toUpperCase())).reduce((acc: number, job: any) => acc + Number(job.planned_qty || 0), 0)
    return { ordered, released, dispatched, hold, returned, inProduction, unreleased: Math.max(0, ordered - released - hold) }
  }, [order?.lines, orderJobs])

  const unsyncedReleaseLots = useMemo(
    () => (order?.lines || []).flatMap((line: any) => (Array.isArray(line.release_lots) ? line.release_lots : []).filter((lot: any) => !lot.job_card_id && String(lot.status || "").toLowerCase() !== "cancelled")),
    [order?.lines],
  )

  const status = String(order?.status || "").toLowerCase()
  const canApprove = ["draft", "submitted"].includes(status)
  const canRelease = ["approved", "released", "partially_released", "partially_dispatched"].includes(status)

  const handleApprove = async () => {
    try {
      await approveOrder.mutateAsync({ orderId, plantId: String(order?.plant_id || order?.plant || "") || undefined })
      showToast("Sales order approved.", "success")
      return true
    } catch (error: any) {
      showToast(apiErrorText(error, "Approval failed."), "error")
      return false
    }
  }

  const handleOpenRelease = (lineIds?: string[]) => {
    const ids = lineIds?.length ? lineIds : selectedLineIds.length ? selectedLineIds : (order?.lines || []).map((line: any) => String(line.id))
    if (!ids.length) {
      showToast("This order has no lines to release.", "error")
      return
    }
    setSelectedLineIds(ids)
    setReleaseOpen(true)
  }

  if (orderQuery.isLoading) return <LoadingState label="Loading sales order..." />
  if (orderQuery.isError) {
    return <ErrorState title="Sales order could not be loaded" message="Refresh to retry. This is not a missing order." onRetry={() => { void orderQuery.refetch() }} />
  }
  if (!order) return <EmptyState label="Sales order not found." />

  const timeline: any[] = Array.isArray((timelineQuery.data as any)?.events) ? (timelineQuery.data as any).events : Array.isArray(timelineQuery.data) ? (timelineQuery.data as any) : []

  return (
    <div className="space-y-5" data-testid="sales-orders:tracking-page">
      <PageHeader
        badge={`${salesOrderOriginLabel(order.origin)} · ${String(order.status || "").replaceAll("_", " ")}`}
        title={`${order.order_no || "Sales order"} · ${customerLabel}`}
        description={`${salesOrderReferenceLabel(order)} · ${isInternalOrigin(order.origin) ? `internal ${formatDate(order.internal_order_date)}` : `PO date ${formatDate(order.po_date)}`} · valid till ${formatDate(order.expiry_date)}${order.is_held ? " · on customer hold" : ""}`}
        actions={
          <>
            <Link href="/sales-orders" className="erp-btn-secondary"><ArrowLeft className="h-4 w-4" />Orders</Link>
            {canApprove ? <Link href={`/sales-orders/${order.id}/edit`} className="erp-btn-secondary"><Pencil className="h-4 w-4" />Edit</Link> : null}
            <button type="button" className="erp-btn-secondary" onClick={() => window.print()}><Printer className="h-4 w-4" />Print</button>
            <Link href={`/planning/board?section=winder&order_id=${order.id}`} className="erp-btn-secondary">Planner<ArrowRight className="h-4 w-4" /></Link>
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
                className="erp-btn-primary"
              >
                <Rocket className="h-4 w-4" />{canApprove ? "Approve + Release" : "Release to production"}
              </button>
            ) : null}
          </>
        }
      />

      <MetricRail className="lg:grid-cols-3 2xl:grid-cols-6">
        <MetricCard label="Ordered" value={fmt(totals.ordered)} detail={`${(order.lines || []).length} line(s)`} icon={Layers3} tone="slate" />
        <MetricCard label="Released" value={fmt(totals.released)} detail={`${fmt(totals.unreleased)} not released yet`} icon={Rocket} tone="blue" progress={totals.ordered ? (totals.released / totals.ordered) * 100 : 0} />
        <MetricCard label="In production" value={jobCardsQuery.isError ? "—" : fmt(totals.inProduction)} detail={jobCardsQuery.isError ? "Job cards did not load" : `${orderJobs.length} job card(s)`} icon={Factory} tone={jobCardsQuery.isError ? "rose" : "violet"} />
        <MetricCard label="Dispatched" value={fmt(totals.dispatched)} detail={`${fmt(Math.max(0, totals.ordered - totals.dispatched - totals.hold))} pending`} icon={Truck} tone="emerald" progress={totals.ordered ? (totals.dispatched / totals.ordered) * 100 : 0} />
        <MetricCard label="Returned by force-close" value={fmt(totals.returned)} detail="Back to unreleased for re-release" icon={Undo2} tone={totals.returned ? "amber" : "slate"} />
        <MetricCard label="Customer hold" value={fmt(totals.hold)} detail={order.is_held ? order.hold_reason || "Held" : "No hold"} icon={History} tone={totals.hold ? "rose" : "slate"} />
      </MetricRail>

      <Panel title="Order flow" subtitle="Where every piece of this order is right now.">
        <StackedMeter
          total={Math.max(1, totals.ordered)}
          parts={[
            { label: "Dispatched", value: totals.dispatched, color: "hsl(var(--chart-7))" },
            { label: "In production", value: Math.max(0, totals.released - totals.dispatched), color: "hsl(var(--chart-3))" },
            { label: "Not released", value: totals.unreleased, color: "hsl(var(--chart-2) / .45)" },
            { label: "On hold", value: totals.hold, color: "hsl(var(--chart-5))" },
          ]}
        />
      </Panel>

      {unsyncedReleaseLots.length > 0 ? (
        <div data-testid="sales-order-detail:unsynced-release-lots" className="rounded-xl border border-signal-rose-line bg-signal-rose-soft px-4 py-3 text-sm text-signal-rose-ink">
          {unsyncedReleaseLots.length} released lot{unsyncedReleaseLots.length === 1 ? " is" : "s are"} not in planning yet — the job card sync did not finish. Click Release to resume; the pending lot is picked up automatically.
        </div>
      ) : null}
      {jobCardsQuery.isError ? (
        <div role="alert" className="rounded-xl border border-signal-rose-line bg-signal-rose-soft px-4 py-3 text-sm text-signal-rose-ink">
          Job cards for this order did not load, so production figures are not shown.{" "}
          <button type="button" className="font-semibold underline" onClick={() => jobCardsQuery.refetch()}>Try again</button>
        </div>
      ) : null}
      {orderJobs.length === 0 && unsyncedReleaseLots.length === 0 && !jobCardsQuery.isLoading && !jobCardsQuery.isError ? (
        <div data-testid="sales-order-detail:planner-handoff-hint" className="rounded-xl border border-signal-amber-line bg-signal-amber-soft px-4 py-3 text-sm text-signal-amber-ink">
          {canApprove
            ? "No job card yet. Click Approve + Release, pick one color per card, the winder queue and quantity — each row becomes one job card in the planner's open queue."
            : canRelease
              ? "Approved but not released to the floor. Click Release to production; each release row becomes one job card (one color)."
              : "No job card is linked to this order."}
        </div>
      ) : null}

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          {(order.lines || []).map((line: any, index: number) => (
            <LineTracker
              key={line.id}
              line={line}
              index={index}
              jobById={jobById}
              selected={selectedLineIds.includes(String(line.id))}
              onSelect={(checked) => setSelectedLineIds((current) => (checked ? [...current, String(line.id)] : current.filter((value) => value !== String(line.id))))}
              onRelease={canRelease ? () => handleOpenRelease([String(line.id)]) : undefined}
              onOpenCard={setSheetJobId}
              editable={!["closed"].includes(status)}
            />
          ))}
        </div>

        <Panel title="Audit trail" subtitle={timeline.some((event: any) => event.derived) ? "Basic history only — this server has no full audit trail." : "Every commercial and release event on this order."}>
          {timeline.length ? (
            <ol className="relative max-h-[70vh] space-y-3 overflow-y-auto border-l border-border pl-5">
              {[...timeline].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))).map((event: any) => {
                const Icon = TIMELINE_ICON[event.event_type] || History
                const jobId = event.metadata?.job_card_id
                return (
                  <li key={event.id} className="relative">
                    <span className={cn("absolute -left-[31px] top-0 grid h-6 w-6 place-items-center rounded-full border-2 border-card", event.event_type === "SALES_ORDER_LOT_RETURNED" ? "bg-signal-rose-soft text-signal-rose-ink" : "bg-primary/10 text-primary")}>
                      <Icon className="h-3 w-3" />
                    </span>
                    <p className="text-[13px] font-medium">{event.title}</p>
                    <p className="text-[12px] text-muted-foreground">{event.message}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{event.actor || "system"} · {formatDate(event.created_at, "DD MMM, HH:mm")}</span>
                      {jobId ? (
                        <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setSheetJobId(String(jobId))}>
                          {jobById.get(String(jobId))?.job_card_no || "job card"} →
                        </button>
                      ) : null}
                    </p>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className={timelineQuery.isError ? "text-[13px] text-signal-rose-ink" : "text-[13px] text-muted-foreground"}>{timelineQuery.isLoading ? "Loading trail…" : timelineQuery.isError ? "Audit trail did not load — refresh to try again." : "No events yet."}</p>
          )}
        </Panel>
      </div>

      <DeliverySchedulePanel order={order} />
      <ReleaseToQueueDialog
        order={order}
        selectedLineIds={selectedLineIds.length ? selectedLineIds : (order.lines || []).map((line: any) => String(line.id))}
        open={releaseOpen}
        onOpenChange={setReleaseOpen}
      />
      <JobCardLifecycleSheet jobCardId={sheetJobId} open={Boolean(sheetJobId)} onOpenChange={(next) => { if (!next) setSheetJobId(null) }} />
    </div>
  )
}

function LineTracker({
  line,
  index,
  jobById,
  selected,
  onSelect,
  onRelease,
  onOpenCard,
  editable,
}: {
  line: any
  index: number
  jobById: Map<string, any>
  selected: boolean
  onSelect: (checked: boolean) => void
  onRelease?: () => void
  onOpenCard: (id: string) => void
  editable: boolean
}) {
  const [editingColors, setEditingColors] = useState(false)
  const qty = Number(line.qty || 0)
  const lots: any[] = (Array.isArray(line.release_lots) ? line.release_lots : []).slice().sort((a: any, b: any) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
  const splits: any[] = Array.isArray(line.color_splits) ? line.color_splits : []
  return (
    <section className="erp-panel rounded-xl p-4">
      <div className="flex flex-wrap items-start gap-3">
        <label className="mt-0.5 flex items-center gap-2 text-[12px] text-muted-foreground">
          <input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} aria-label={`Select line ${line.line_no || index + 1}`} />
          Line {line.line_no || index + 1}
        </label>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold tracking-tight">{line.product_code || "No product code"} <span className="font-normal text-muted-foreground">{line.size_label ? `· ${line.size_label}` : ""}</span></h3>
          <p className="text-[12.5px] text-muted-foreground">Delivery {formatDate(line.earliest_delivery_date || line.due_date)}{line.rate_per_pc ? ` · ₹${Number(line.rate_per_pc).toLocaleString("en-IN")}/pc` : ""}{line.parchment_required ? " · parchment" : " · plain"}</p>
        </div>
        {onRelease && Number(line.release_remaining_qty || 0) > 0 ? (
          <button type="button" className="erp-btn-secondary !h-8" onClick={onRelease}><Rocket className="h-3.5 w-3.5" />Release {fmt(line.release_remaining_qty)}</button>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {[
          ["Ordered", line.qty],
          ["Released", line.released_qty],
          ["Unreleased", line.release_remaining_qty],
          ["Dispatched", line.fulfilled_qty],
          ["Pending", line.pending_qty ?? line.remaining_qty],
          ["Hold", line.hold_qty],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg bg-[hsl(var(--surface-2))] px-2.5 py-2">
            <p className="text-[11.5px] text-muted-foreground">{label}</p>
            <p className="text-[15px] font-semibold tabular-nums">{fmt(value)}</p>
          </div>
        ))}
      </div>

      {line.parchment_required ? (
        <div className="mt-3 rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-muted-foreground" />
            <p className="text-[13px] font-semibold">Colors</p>
            <span className="text-[12px] text-muted-foreground">{fmt(line.unassigned_color_qty)} not decided</span>
            {editable ? (
              <button type="button" onClick={() => setEditingColors((value) => !value)} className="ml-auto text-[12.5px] font-semibold text-primary hover:underline">{editingColors ? "Close" : "Edit colors"}</button>
            ) : null}
          </div>
          {qty > 0 ? (
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-muted">
              {splits.map((split) => (
                <div key={split.color} className="h-full" title={`${split.color}: ${fmt(split.qty)}`} style={{ width: `${(Number(split.qty) / qty) * 100}%`, background: swatchFor(split.color) }} />
              ))}
            </div>
          ) : null}
          {editingColors ? (
            <ColorEditor line={line} onDone={() => setEditingColors(false)} />
          ) : splits.length ? (
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {splits.map((split) => (
                <li key={split.color} className="flex items-center gap-2 rounded-md bg-[hsl(var(--surface-2))] px-2 py-1.5 text-[12.5px]">
                  <ColorChip color={split.color} />
                  <span className="ml-auto tabular-nums">{fmt(split.qty)}</span>
                  <span className="w-28 text-right text-[11.5px] tabular-nums text-muted-foreground">{fmt(split.released_qty)} rel · {fmt(split.open_qty)} open</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12.5px] text-muted-foreground">No color decided yet — pick one per job card when releasing.</p>
          )}
        </div>
      ) : null}

      <div className="mt-3">
        <p className="mb-1.5 text-[13px] font-semibold">Job cards</p>
        {lots.length ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="tube-grid">
              <thead>
                <tr>
                  <th>Job card</th>
                  <th>Color</th>
                  <th className="num">Released</th>
                  <th className="num">Returned</th>
                  <th>Lifecycle</th>
                  <th>Stage · plan</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lots.map((lot: any) => {
                  const job = lot.job_card_id ? jobById.get(String(lot.job_card_id)) : null
                  return (
                    <tr key={lot.id}>
                      <td>
                        {lot.job_card_id ? (
                          <button type="button" onClick={() => onOpenCard(String(lot.job_card_id))} className="text-left hover:text-primary">
                            <JobCardNo job={job || { id: lot.job_card_id }} />
                          </button>
                        ) : (
                          <span className="text-[12px] text-signal-amber-ink">Waiting for planner sync</span>
                        )}
                      </td>
                      <td>{lot.parchment_color ? <ColorChip color={lot.parchment_color} /> : <span className="text-muted-foreground">—</span>}</td>
                      <td className="num">{fmt(Number(lot.release_qty || 0) + Number(lot.returned_qty || 0))}</td>
                      <td className={cn("num", Number(lot.returned_qty || 0) > 0 && "text-signal-rose-ink")}>{Number(lot.returned_qty || 0) ? fmt(lot.returned_qty) : "—"}</td>
                      <td>{job ? <LifecycleBadge state={lifecycleFromSummary(job)} /> : String(lot.status || "").toLowerCase() === "cancelled" ? <LifecycleBadge state="CANCELLED" /> : <span className="text-muted-foreground">—</span>}</td>
                      <td className="whitespace-nowrap text-[12px] text-muted-foreground">
                        {job ? `${String(job.current_stage || "").toLowerCase()} · ${job.current_plan_date ? formatDate(job.current_plan_date, "DD MMM") : "queue"}${job.current_shift_code ? ` ${String(job.current_shift_code).replace("SHIFT_", "")}` : ""}` : "—"}
                      </td>
                      <td className="text-right">
                        {lot.job_card_id ? <Link href={`/inventory/genealogy?job_card_id=${lot.job_card_id}`} className="text-[12px] font-semibold text-primary hover:underline">Trace</Link> : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12.5px] text-muted-foreground">Nothing released from this line yet.</p>
        )}
      </div>
    </section>
  )
}

function ColorEditor({ line, onDone }: { line: any; onDone: () => void }) {
  const { showToast } = useApp()
  const update = useUpdateLineColors()
  const { data: parchments } = useParchments()
  const options = (Array.isArray(parchments) ? parchments : []).filter((row: any) => row?.color_name && row?.id && !String(row.id).startsWith("vendor:"))
  const [rows, setRows] = useState<Array<{ key: string; color: string; color_id: string | null; qty: string; released: number }>>(
    (Array.isArray(line.color_splits) ? line.color_splits : []).map((split: any, index: number) => ({ key: `r${index}`, color: split.color, color_id: split.color_id || null, qty: String(Math.round(Number(split.qty || 0))), released: Number(split.released_qty || 0) })),
  )
  const total = rows.reduce((sum, row) => sum + Number(row.qty || 0), 0)
  const over = total > Number(line.qty || 0)
  const save = async () => {
    try {
      await update.mutateAsync({ lineId: String(line.id), colorSplits: rows.filter((row) => row.color && Number(row.qty) > 0).map((row) => ({ color: row.color, color_id: row.color_id, qty: Number(row.qty) })) })
      showToast("Colors saved.", "success")
      onDone()
    } catch (error) {
      showToast(apiErrorText(error), "error")
    }
  }
  return (
    <div className="mt-2 space-y-2">
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_110px_32px] items-center gap-2">
          <select
            aria-label="Color"
            value={row.color_id || row.color}
            disabled={row.released > 0}
            onChange={(event) => {
              const option = options.find((entry: any) => String(entry.id) === event.target.value)
              setRows((current) => current.map((entry) => (entry.key === row.key ? { ...entry, color_id: option ? String(option.id) : null, color: option ? String(option.display_name || option.color_name) : "" } : entry)))
            }}
            className="h-9 w-full rounded-lg border border-input bg-card px-2 text-[13px]"
          >
            {row.color && !row.color_id ? <option value={row.color}>{row.color}</option> : null}
            <option value="">Select color</option>
            {options.map((option: any) => <option key={option.id} value={option.id}>{option.display_name || option.color_name}</option>)}
          </select>
          <input type="number" min={row.released} aria-label="Color qty" value={row.qty} onChange={(event) => setRows((current) => current.map((entry) => (entry.key === row.key ? { ...entry, qty: event.target.value } : entry)))} className="h-9 w-full rounded-lg border border-input bg-card px-2 text-right text-[13px] tabular-nums" />
          <button type="button" aria-label="Remove color" disabled={row.released > 0} onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-signal-rose-soft hover:text-signal-rose-ink disabled:opacity-30">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setRows((current) => [...current, { key: `r${Date.now()}`, color: "", color_id: null, qty: "", released: 0 }])} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline">
          <Plus className="h-3.5 w-3.5" />Add color
        </button>
        <span className={cn("text-[12px] tabular-nums", over ? "font-semibold text-signal-rose-ink" : "text-muted-foreground")}>
          {fmt(total)} of {fmt(line.qty)} assigned{over ? " — too much" : ` · ${fmt(Number(line.qty || 0) - total)} undecided`}
        </span>
      </div>
      <p className="text-[11.5px] text-muted-foreground">A color cannot go below what is already released in it. Released colors are locked here — force-close their job card to change them.</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="erp-btn-secondary !h-8" onClick={onDone}>Cancel</button>
        <button type="button" className="erp-btn-primary !h-8" disabled={over || update.isPending} onClick={() => void save()}>{update.isPending ? "Saving…" : "Save colors"}</button>
      </div>
    </div>
  )
}
