"use client"

import Link from "next/link"
import dayjs from "dayjs"
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
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

import { EmptyState } from "@/components/erp/shell"
import { ColorChip, JobCardNo, LifecycleBadge, lifecycleFromSummary, swatchFor } from "@/components/production/lifecycle-chips"
import { EVENT_LABEL, JobCardLifecycleSheet, eventText } from "@/components/production/job-card-lifecycle-sheet"
import { PageHeader } from "@/components/workspace/page-header"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { ReleaseToQueueDialog } from "@/components/sales/release-to-queue-dialog"
import { LineDeliveryEditor } from "@/components/sales/line-delivery-editor"
import { useApp } from "@/context/AppContext"
import { apiErrorText, useOrderProductionTrail, useUpdateLineColors } from "@/hooks/use-lifecycle"
import { useCustomers, useParchments } from "@/hooks/use-master-data"
import { usePlanningJobCards } from "@/hooks/use-production"
import { useApproveSalesOrder, useMoveDeliverySchedule, useOrderDeliverySchedules, useSalesOrder, useSalesOrderTimeline } from "@/hooks/use-sales"
import { cn } from "@/lib/utils"
import { isInternalOrigin, salesOrderOriginLabel, salesOrderReferenceLabel } from "@/lib/sales-order-entry"

const fmt = (value: unknown) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })

function formatDate(value?: string | null, template = "DD MMM YYYY") {
  if (!value) return "—"
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format(template) : String(value)
}

const SALES_ICON: Record<string, any> = {
  SALES_ORDER_CREATED: ClipboardCheck,
  SALES_ORDER_APPROVED: CheckCircle2,
  SALES_ORDER_RELEASED: Rocket,
  SALES_ORDER_LINE_CREATED: Layers3,
  SALES_ORDER_LINE_RELEASED: Factory,
  SALES_ORDER_LOT_RETURNED: Undo2,
  SALES_ORDER_DISPATCH_RECORDED: Truck,
}
const STAGE_ORDER = ["SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING", "QC"]
const PRODUCTION_LABEL: Record<string, string> = {
  ...EVENT_LABEL,
  completed: "Stage completed",
  stage_batch_completed: "Whole card entered",
  moved: "Moved on the planner",
  reordered: "Moved on the planner",
  assigned: "Placed on the planner",
}

/** Where each piece of the order is: one strip instead of six tiles and a meter. */
function orderFlow(lines: any[], jobs: any[]) {
  const sum = (key: string) => lines.reduce((acc, line) => acc + Number(line[key] || 0), 0)
  const byState = (state: string) => jobs.filter((job) => lifecycleFromSummary(job) === state).reduce((acc, job) => acc + Number(job.planned_qty || 0), 0)
  const ordered = sum("qty")
  const dispatched = sum("fulfilled_qty")
  const hold = sum("hold_qty")
  const released = sum("released_qty")
  const made = byState("COMPLETED") + jobs.filter((job) => lifecycleFromSummary(job) === "FORCE_CLOSED").reduce((acc, job) => acc + Number(job.planned_qty || 0), 0)
  const running = byState("RUNNING")
  const scheduled = byState("SCHEDULED")
  const queued = byState("QUEUED")
  const runningByStage = new Map<string, number>()
  for (const job of jobs.filter((row) => lifecycleFromSummary(row) === "RUNNING")) {
    const stage = String(job.current_stage || "").toUpperCase()
    runningByStage.set(stage, (runningByStage.get(stage) || 0) + Number(job.planned_qty || 0))
  }
  const returned = lines.flatMap((line) => line.release_lots || []).reduce((acc: number, lot: any) => acc + Number(lot.returned_qty || 0), 0)
  return { ordered, released, queued, scheduled, running, made, dispatched, hold, returned, runningByStage,
    unreleased: Math.max(0, ordered - released - hold), pending: Math.max(0, ordered - dispatched - hold) }
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
  const trailQuery = useOrderProductionTrail(orderId)
  const schedulesQuery = useOrderDeliverySchedules(orderId)
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
  const flow = useMemo(() => orderFlow(order?.lines || [], orderJobs), [order?.lines, orderJobs])
  const scheduleItems: any[] = useMemo(() => (Array.isArray((schedulesQuery.data as any)?.items) ? (schedulesQuery.data as any).items : []), [schedulesQuery.data])
  const scheduleRevision = Number((schedulesQuery.data as any)?.schedule_revision ?? order?.schedule_revision ?? 0)
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
    if (!ids.length) { showToast("This order has no lines to release.", "error"); return }
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
    <div className="space-y-4" data-testid="sales-orders:tracking-page">
      <PageHeader
        badge={`${salesOrderOriginLabel(order.origin)} · ${String(order.status || "").replaceAll("_", " ")}`}
        title={`${order.order_no || "Sales order"} · ${customerLabel}`}
        description={`${salesOrderReferenceLabel(order)} · ${isInternalOrigin(order.origin) ? `internal ${formatDate(order.internal_order_date)}` : `PO date ${formatDate(order.po_date)}`} · valid till ${formatDate(order.expiry_date)}${order.is_held ? " · on customer hold" : ""}`}
        actions={
          <>
            <Link href="/sales-orders" className="erp-btn-secondary"><ArrowLeft className="h-4 w-4" />Orders</Link>
            {canApprove ? <Link href={`/sales-orders/${order.id}/edit`} className="erp-btn-secondary"><Pencil className="h-4 w-4" />Edit</Link> : null}
            <button type="button" className="erp-btn-secondary" onClick={() => window.print()}><Printer className="h-4 w-4" />Print</button>
            <Link href={`/planning/board?section=winder&order_id=${order.id}&view=calendar`} className="erp-btn-secondary">Planner<ArrowRight className="h-4 w-4" /></Link>
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

      <OrderFlowStrip flow={flow} jobsFailed={jobCardsQuery.isError} jobCount={orderJobs.length} />

      {unsyncedReleaseLots.length > 0 ? (
        <div data-testid="sales-order-detail:unsynced-release-lots" className="rounded-xl border border-signal-rose-line bg-signal-rose-soft px-4 py-2.5 text-[13px] text-signal-rose-ink">
          {unsyncedReleaseLots.length} released lot{unsyncedReleaseLots.length === 1 ? " is" : "s are"} not in planning yet — the job card sync did not finish. Click Release to resume; the pending lot is picked up automatically.
        </div>
      ) : null}
      {jobCardsQuery.isError ? (
        <div role="alert" className="rounded-xl border border-signal-rose-line bg-signal-rose-soft px-4 py-2.5 text-[13px] text-signal-rose-ink">
          Job cards for this order did not load, so production figures are not shown.{" "}
          <button type="button" className="font-semibold underline" onClick={() => jobCardsQuery.refetch()}>Try again</button>
        </div>
      ) : null}

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-3">
          {(order.lines || []).map((line: any, index: number) => (
            <LineTracker
              key={line.id}
              orderId={orderId}
              line={line}
              index={index}
              jobs={orderJobs.filter((job: any) => String(job.sales_order_line_id || "") === String(line.id))}
              jobById={jobById}
              schedule={scheduleItems}
              scheduleRevision={scheduleRevision}
              scheduleLoading={schedulesQuery.isLoading}
              selected={selectedLineIds.includes(String(line.id))}
              onSelect={(checked) => setSelectedLineIds((current) => (checked ? [...current, String(line.id)] : current.filter((value) => value !== String(line.id))))}
              onRelease={canRelease ? () => handleOpenRelease([String(line.id)]) : canApprove ? async () => { if (await handleApprove()) handleOpenRelease([String(line.id)]) } : undefined}
              onOpenCard={setSheetJobId}
              editable={!["closed"].includes(status)}
            />
          ))}
        </div>

        <div className="space-y-3 2xl:sticky 2xl:top-3 2xl:self-start">
          <DeliveryPlan order={order} items={scheduleItems} revision={scheduleRevision} loading={schedulesQuery.isLoading} failed={schedulesQuery.isError} />
          <ActivityTrail
            sales={timeline}
            production={trailQuery.data || []}
            salesState={timelineQuery.isLoading ? "loading" : timelineQuery.isError ? "error" : "ok"}
            productionState={trailQuery.isLoading ? "loading" : trailQuery.isError ? "error" : "ok"}
            derived={timeline.some((event: any) => event.derived)}
            onOpenCard={setSheetJobId}
          />
        </div>
      </div>

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

function OrderFlowStrip({ flow, jobsFailed, jobCount }: { flow: ReturnType<typeof orderFlow>; jobsFailed: boolean; jobCount: number }) {
  const total = Math.max(1, flow.ordered)
  const running = Array.from(flow.runningByStage.entries()).sort((a, b) => STAGE_ORDER.indexOf(a[0]) - STAGE_ORDER.indexOf(b[0]))
  const steps = [
    { key: "ordered", label: "Ordered", value: flow.ordered, hint: "", tone: "bg-foreground/40" },
    { key: "released", label: "Released", value: flow.released, hint: flow.returned ? `${fmt(flow.returned)} returned by force-close` : `${fmt(flow.unreleased)} not released`, tone: "bg-[hsl(var(--chart-2))]" },
    { key: "queued", label: "In queue", value: jobsFailed ? null : flow.queued, hint: "Released, not on the board", tone: "bg-[hsl(var(--chart-2))]/60" },
    { key: "scheduled", label: "On the board", value: jobsFailed ? null : flow.scheduled, hint: "Machine + shift planned", tone: "bg-[hsl(var(--chart-3))]" },
    { key: "running", label: "Running", value: jobsFailed ? null : flow.running, hint: running.length ? running.map(([stage, pcs]) => `${stage.toLowerCase()} ${fmt(pcs)}`).join(" · ") : "Nothing on the floor", tone: "bg-signal-amber-ink/80" },
    { key: "made", label: "Made", value: jobsFailed ? null : flow.made, hint: `${jobCount} job card${jobCount === 1 ? "" : "s"}`, tone: "bg-signal-emerald-ink/70" },
    { key: "dispatched", label: "Dispatched", value: flow.dispatched, hint: `${fmt(flow.pending)} still to send`, tone: "bg-[hsl(var(--chart-7))]" },
    { key: "hold", label: "On hold", value: flow.hold, hint: flow.hold ? "Customer hold" : "No hold", tone: "bg-signal-rose-ink/70" },
  ]
  return (
    <section className="grid overflow-hidden rounded-xl border border-border bg-card shadow-sm sm:grid-cols-4 xl:grid-cols-8" aria-label="Order flow" data-testid="order-flow-strip">
      {steps.map((step, index) => (
        <div key={step.key} className={cn("relative min-w-0 px-3 py-2.5", index > 0 && "border-l border-border", step.key === "hold" && !flow.hold && "opacity-60")}>
          <p className="flex items-center gap-1 text-[11.5px] font-semibold text-muted-foreground">{step.label}{index > 0 && index < 7 ? <ArrowRight className="h-3 w-3 opacity-40" /> : null}</p>
          <p className="text-[18px] font-semibold tabular-nums leading-tight">{step.value === null ? "—" : fmt(step.value)}</p>
          <p className="truncate text-[11px] text-muted-foreground" title={step.hint}>{step.value === null ? "Job cards did not load" : step.hint || "pcs"}</p>
          <span className="absolute inset-x-0 bottom-0 h-1 bg-muted"><span className={cn("block h-full transition-[width] duration-700", step.tone)} style={{ width: `${Math.min(100, ((step.value || 0) / total) * 100)}%` }} /></span>
        </div>
      ))}
    </section>
  )
}

function StageStepper({ job }: { job: any }) {
  const route: string[] = (Array.isArray(job?.routing_stages) && job.routing_stages.length ? job.routing_stages : ["WINDER", "OVEN", "PROCESS", "PACKING"]).map((stage: string) => String(stage).toUpperCase())
  const current = String(job?.current_stage || "").toUpperCase()
  const done = String(job?.status || "").toUpperCase() === "COMPLETED" || current === "DONE"
  const at = route.indexOf(current)
  return (
    <span className="inline-flex items-center gap-1" title={done ? "All stages done" : `At ${current.toLowerCase()}`}>
      {route.map((stage, index) => {
        const state = done || (at >= 0 && index < at) ? "done" : index === at ? "now" : "todo"
        return (
          <span key={stage} className="inline-flex items-center gap-1">
            <span className={cn("grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9.5px] font-bold", state === "done" ? "bg-signal-emerald-ink text-background" : state === "now" ? "bg-primary text-primary-foreground ring-2 ring-primary/25" : "bg-muted text-muted-foreground")}>
              {stage.slice(0, 1)}
            </span>
            {index < route.length - 1 ? <span className={cn("h-px w-2", state === "done" ? "bg-signal-emerald-ink" : "bg-border")} /> : null}
          </span>
        )
      })}
    </span>
  )
}

function LineTracker({
  orderId, line, index, jobs, jobById, schedule, scheduleRevision, scheduleLoading, selected, onSelect, onRelease, onOpenCard, editable,
}: {
  orderId: string
  line: any
  index: number
  jobs: any[]
  jobById: Map<string, any>
  schedule: any[]
  scheduleRevision: number
  scheduleLoading: boolean
  selected: boolean
  onSelect: (checked: boolean) => void
  onRelease?: () => void
  onOpenCard: (id: string) => void
  editable: boolean
}) {
  const lots: any[] = (Array.isArray(line.release_lots) ? line.release_lots : []).slice().sort((a: any, b: any) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
  const callOffs = schedule.filter((row) => String(row.line_id) === String(line.id) && row.status !== "cancelled").sort((a, b) => String(a.delivery_date).localeCompare(String(b.delivery_date)))
  const nextCallOff = callOffs.find((row) => !dayjs(row.delivery_date).isBefore(dayjs(), "day") && !row.immutable)
  const [tab, setTab] = useState<"cards" | "deliveries" | "colors">(lots.length ? "cards" : "deliveries")
  const qty = Number(line.qty || 0)
  const splits: any[] = Array.isArray(line.color_splits) ? line.color_splits : []
  const made = jobs.filter((job) => ["COMPLETED", "FORCE_CLOSED"].includes(lifecycleFromSummary(job))).reduce((sum, job) => sum + Number(job.planned_qty || 0), 0)
  const dispatched = Number(line.fulfilled_qty || 0)
  const released = Number(line.released_qty || 0)
  const hold = Number(line.hold_qty || 0)
  const unreleased = Number(line.release_remaining_qty ?? Math.max(0, qty - released - hold))
  const parts = [
    { label: "dispatched", value: dispatched, className: "bg-[hsl(var(--chart-7))]" },
    { label: "made", value: Math.max(0, made - dispatched), className: "bg-signal-emerald-ink/70" },
    { label: "in production", value: Math.max(0, released - Math.max(made, dispatched)), className: "bg-[hsl(var(--chart-3))]" },
    { label: "not released", value: unreleased, className: "bg-[hsl(var(--chart-2))]/35" },
    { label: "hold", value: hold, className: "bg-signal-rose-ink/60" },
  ]
  return (
    <section className="erp-panel rounded-xl p-4" data-testid={`order-line:${line.id}`}>
      <div className="flex flex-wrap items-start gap-3">
        <label className="mt-1 flex items-center gap-2 text-[12px] text-muted-foreground">
          <input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} aria-label={`Select line ${line.line_no || index + 1}`} />
          Line {line.line_no || index + 1}
        </label>
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold tracking-tight">
            {line.product_code || "No product code"}
            {line.size_label ? <span className="font-normal text-muted-foreground">{line.size_label}</span> : null}
            {line.parchment_required ? (splits.length ? splits.map((split) => <ColorChip key={split.color} color={split.color} className="!text-[11.5px]" />) : <span className="text-[12px] font-normal text-signal-amber-ink">colour not decided</span>) : <span className="text-[12px] font-normal text-muted-foreground">plain</span>}
          </h3>
          <p className="text-[12.5px] text-muted-foreground">
            <strong className="text-foreground tabular-nums">{fmt(qty)} pcs</strong> · due {formatDate(line.due_date)}
            {nextCallOff ? <> · next delivery <strong className="text-foreground">{formatDate(nextCallOff.delivery_date, "DD MMM")}</strong> ({fmt(nextCallOff.quantity)})</> : null}
            {line.rate_per_pc ? ` · ₹${Number(line.rate_per_pc).toLocaleString("en-IN")}/pc` : ""}
          </p>
        </div>
        {onRelease && unreleased > 0 ? (
          <button type="button" className="erp-btn-primary !h-8" onClick={onRelease}><Rocket className="h-3.5 w-3.5" />Release {fmt(unreleased)}</button>
        ) : null}
      </div>

      <div className="mt-3">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-label="Line progress">
          {parts.map((part) => part.value > 0 ? <span key={part.label} title={`${fmt(part.value)} ${part.label}`} className={cn("h-full transition-[width] duration-700", part.className)} style={{ width: `${(part.value / Math.max(1, qty)) * 100}%` }} /> : null)}
        </div>
        <p className="mt-1 flex flex-wrap gap-x-3 text-[11.5px] text-muted-foreground">
          {parts.filter((part) => part.value > 0).map((part) => (
            <span key={part.label} className="inline-flex items-center gap-1"><span className={cn("h-2 w-2 rounded-full", part.className)} /><strong className="tabular-nums text-foreground">{fmt(part.value)}</strong> {part.label}</span>
          ))}
        </p>
      </div>

      <div className="mt-3 flex items-center gap-1 border-b border-border" role="tablist" aria-label={`Line ${line.line_no} details`}>
        {([["cards", `Job cards · ${lots.length}`], ["deliveries", `Deliveries · ${callOffs.length}`], ...(line.parchment_required ? [["colors", "Colours"]] : [])] as Array<[typeof tab, string]>).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={cn("-mb-px border-b-2 px-3 py-1.5 text-[12.5px] font-semibold transition-colors", tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {label}
          </button>
        ))}
      </div>

      <div className="pt-3">
        {tab === "cards" ? (
          <div className="space-y-2">
            {lots.length ? (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="tube-grid">
                  <thead>
                    <tr><th>Job card</th><th>Colour</th><th className="num">Pcs</th><th>Progress</th><th>Plan</th><th>State</th><th /></tr>
                  </thead>
                  <tbody>
                    {lots.map((lot: any) => {
                      const job = lot.job_card_id ? jobById.get(String(lot.job_card_id)) : null
                      const returned = Number(lot.returned_qty || 0)
                      return (
                        <tr key={lot.id}>
                          <td>
                            {lot.job_card_id ? (
                              <button type="button" onClick={() => onOpenCard(String(lot.job_card_id))} className="text-left hover:text-primary"><JobCardNo job={job || { id: lot.job_card_id }} /></button>
                            ) : <span className="text-[12px] text-signal-amber-ink">Waiting for planner sync</span>}
                          </td>
                          <td>{lot.parchment_color ? <ColorChip color={lot.parchment_color} /> : <span className="text-muted-foreground">plain</span>}</td>
                          <td className="num">
                            {fmt(lot.release_qty)}
                            {returned ? <span className="block text-[11px] text-signal-rose-ink">{fmt(returned)} returned</span> : null}
                          </td>
                          <td>{job ? <StageStepper job={job} /> : <span className="text-muted-foreground">—</span>}</td>
                          <td className="whitespace-nowrap text-[12px] text-muted-foreground">
                            {job?.current_plan_date ? `${formatDate(job.current_plan_date, "DD MMM")} · ${String(job.current_shift_code || "").replace("SHIFT_", "Shift ")}` : job ? "in queue" : "—"}
                          </td>
                          <td>{job ? <LifecycleBadge state={lifecycleFromSummary(job)} compact /> : String(lot.status || "").toLowerCase() === "cancelled" ? <LifecycleBadge state="CANCELLED" compact /> : null}</td>
                          <td className="whitespace-nowrap text-right">
                            {lot.job_card_id ? (
                              <>
                                <button type="button" onClick={() => onOpenCard(String(lot.job_card_id))} className="text-[12px] font-semibold text-primary hover:underline">Open</button>
                                <Link href={`/inventory/genealogy?job_card_id=${lot.job_card_id}`} className="ml-3 text-[12px] font-semibold text-muted-foreground hover:text-foreground">Trace</Link>
                              </>
                            ) : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
            {unreleased > 0 ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2 text-[12.5px]">
                <Factory className="h-4 w-4 text-muted-foreground" />
                <span><strong className="tabular-nums">{fmt(unreleased)} pcs</strong> not released to production yet{lots.length ? "" : " — nothing is on the floor for this line"}.</span>
                {onRelease ? <button type="button" onClick={onRelease} className="ml-auto text-[12.5px] font-semibold text-primary hover:underline">Release with colour + winder →</button> : null}
              </div>
            ) : !lots.length ? <p className="text-[12.5px] text-muted-foreground">Everything on this line is dispatched or on hold.</p> : null}
          </div>
        ) : tab === "deliveries" ? (
          scheduleLoading ? <p className="text-[12.5px] text-muted-foreground">Loading call-offs…</p> : <LineDeliveryEditor orderId={orderId} line={line} schedule={schedule} revision={scheduleRevision} disabled={!editable} />
        ) : (
          <ColorsTab line={line} editable={editable} qty={qty} splits={splits} />
        )}
      </div>
    </section>
  )
}

function ColorsTab({ line, editable, qty, splits }: { line: any; editable: boolean; qty: number; splits: any[] }) {
  const [editing, setEditing] = useState(false)
  return (
    <div>
      <div className="flex items-center gap-2">
        <Palette className="h-4 w-4 text-muted-foreground" />
        <span className="text-[12.5px] text-muted-foreground">{fmt(line.unassigned_color_qty)} pcs colour not decided</span>
        {editable ? <button type="button" onClick={() => setEditing((value) => !value)} className="ml-auto text-[12.5px] font-semibold text-primary hover:underline">{editing ? "Close" : "Edit colours"}</button> : null}
      </div>
      {qty > 0 ? (
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-muted">
          {splits.map((split) => <div key={split.color} className="h-full" title={`${split.color}: ${fmt(split.qty)}`} style={{ width: `${(Number(split.qty) / qty) * 100}%`, background: swatchFor(split.color) }} />)}
        </div>
      ) : null}
      {editing ? <ColorEditor line={line} onDone={() => setEditing(false)} /> : splits.length ? (
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {splits.map((split) => (
            <li key={split.color} className="flex items-center gap-2 rounded-md bg-[hsl(var(--surface-2))] px-2 py-1.5 text-[12.5px]">
              <ColorChip color={split.color} />
              <span className="ml-auto tabular-nums">{fmt(split.qty)}</span>
              <span className="w-28 text-right text-[11.5px] tabular-nums text-muted-foreground">{fmt(split.released_qty)} rel · {fmt(split.open_qty)} open</span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-[12.5px] text-muted-foreground">No colour decided yet — pick one per job card when releasing.</p>}
    </div>
  )
}

/** Every call-off of the order in date order, with whether production has covered it yet. */
function DeliveryPlan({ order, items, revision, loading, failed }: { order: any; items: any[]; revision: number; loading: boolean; failed: boolean }) {
  const { showToast } = useApp()
  const move = useMoveDeliverySchedule()
  const [shift, setShift] = useState("")
  const [shiftPreview, setShiftPreview] = useState<any>(null)
  const lineById = new Map((order.lines || []).map((line: any) => [String(line.id), line]))
  const rows = items.filter((row) => row.status !== "cancelled").sort((a, b) => String(a.delivery_date).localeCompare(String(b.delivery_date)))
  // Released pcs cover a line's call-offs in date order: a call-off is "released" once enough is released for it.
  const coverage = new Map<string, boolean>()
  const running = new Map<string, number>()
  for (const row of rows) {
    const line: any = lineById.get(String(row.line_id))
    const upTo = (running.get(String(row.line_id)) || 0) + Number(row.quantity || 0)
    running.set(String(row.line_id), upTo)
    coverage.set(String(row.id), Number(line?.released_qty || 0) + 0.001 >= upTo)
  }
  const unscheduled = (order.lines || []).map((line: any) => {
    const onCallOffs = rows.filter((row) => String(row.line_id) === String(line.id)).reduce((sum, row) => sum + Number(row.quantity || 0), 0)
    return { line, qty: Math.max(0, Number(line.qty || 0) - onCallOffs - Number(line.fulfilled_qty || 0)) }
  }).filter((row: any) => row.qty > 0)
  const runShift = async (previewOnly: boolean) => {
    const delta = Number(shift)
    if (!Number.isInteger(delta) || delta === 0) { showToast("Enter whole days to shift, e.g. 3 or -2.", "error"); return }
    try {
      const response = await move.mutateAsync({ orderId: String(order.id), data: { day_delta: previewOnly ? delta : shiftPreview.day_delta, expected_revision: previewOnly ? revision : shiftPreview.schedule_revision, preview_only: previewOnly } })
      if (previewOnly) setShiftPreview(response.data)
      else { setShiftPreview(null); setShift(""); showToast(response.data?.message || "Delivery dates shifted.", "success") }
    } catch (error) { setShiftPreview(null); showToast(apiErrorText(error), "error") }
  }
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm" data-testid="delivery-plan">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-primary" />
        <h2 className="text-[14px] font-semibold">Delivery plan</h2>
        <span className="ml-auto text-[11.5px] text-muted-foreground">Edit call-offs in each line&apos;s Deliveries tab</span>
      </div>
      {loading ? <p className="mt-2 text-[12.5px] text-muted-foreground">Loading…</p> : failed ? <p className="mt-2 text-[12.5px] text-signal-rose-ink">Delivery schedule did not load.</p> : (
        <>
          <ol className="mt-2 max-h-[40vh] space-y-1 overflow-y-auto">
            {rows.map((row) => {
              const line: any = lineById.get(String(row.line_id))
              const isCovered = coverage.get(String(row.id))
              const late = dayjs(row.delivery_date).isBefore(dayjs(), "day") && !row.immutable
              return (
                <li key={row.id} data-testid={`delivery-schedule-row:${row.id}`} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] hover:bg-muted/60">
                  <span className={cn("w-16 shrink-0 font-semibold tabular-nums", late && "text-signal-rose-ink")}>{formatDate(row.delivery_date, "DD MMM")}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">L{line?.line_no} · {line?.product_code}</span>
                  <span className="tabular-nums font-semibold">{fmt(row.quantity)}</span>
                  <span className={cn("w-20 shrink-0 text-right text-[11px]", row.immutable ? "text-muted-foreground" : isCovered ? "text-signal-emerald-ink" : "text-signal-amber-ink")}>{row.immutable ? row.status : isCovered ? "released" : "not released"}</span>
                </li>
              )
            })}
            {unscheduled.map(({ line, qty }: any) => (
              <li key={`due-${line.id}`} className="flex items-center gap-2 rounded-md bg-[hsl(var(--surface-2))] px-1.5 py-1 text-[12.5px]">
                <span className="w-16 shrink-0 font-semibold tabular-nums">{formatDate(line.due_date, "DD MMM")}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">L{line.line_no} · no call-off yet (line date)</span>
                <span className="tabular-nums font-semibold">{fmt(qty)}</span>
                <span className="w-20 shrink-0" />
              </li>
            ))}
            {!rows.length && !unscheduled.length ? <li className="text-[12.5px] text-muted-foreground">Everything is delivered.</li> : null}
          </ol>
          {rows.some((row) => !row.immutable) ? (
            <div className="mt-3 border-t border-border pt-2.5">
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-0.5 text-[11px] text-muted-foreground">Shift by days
                  <input type="number" step="1" value={shift} onChange={(event) => { setShift(event.target.value); setShiftPreview(null) }} className="h-8 w-24 rounded-md border border-input bg-card px-2 text-[12.5px] text-foreground" />
                </label>
                <button type="button" onClick={() => void runShift(true)} disabled={!shift || move.isPending} className="erp-btn-secondary !h-8">Preview date shift</button>
                <button type="button" onClick={() => void runShift(false)} disabled={!shiftPreview?.moved?.length || move.isPending} className="erp-btn-primary !h-8">Save date shift</button>
              </div>
              {shiftPreview ? (
                <div className="mt-2 space-y-0.5 text-[12px]" data-testid="delivery-shift-preview" aria-live="polite">
                  {shiftPreview.moved.map((row: any) => <p key={row.id}>{formatDate(row.previous_date, "DD MMM")} → <strong>{formatDate(row.delivery_date, "DD MMM")}</strong> · {fmt(row.quantity)} pcs</p>)}
                  {shiftPreview.kept.map((row: any) => <p key={row.id} className="text-signal-amber-ink">{formatDate(row.delivery_date, "DD MMM")} · {fmt(row.quantity)} pcs · preserved ({String(row.reason || "").replaceAll("_", " ")})</p>)}
                  {!shiftPreview.moved.length ? <p>No open call-off can move.</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}

/** Sales events and every production event on the order's job cards, newest first. */
function ActivityTrail({ sales, production, salesState, productionState, derived, onOpenCard }: {
  sales: any[]
  production: Array<{ id: string; action: string; job_card_id: string; job_card_no: string | null; actor: string | null; at: string | null; payload: Record<string, any> }>
  salesState: "loading" | "error" | "ok"
  productionState: "loading" | "error" | "ok"
  derived: boolean
  onOpenCard: (id: string) => void
}) {
  const [filter, setFilter] = useState<"all" | "sales" | "production">("all")
  const [limit, setLimit] = useState(40)
  const events = [
    ...sales.map((event: any) => ({ kind: "sales" as const, id: `s:${event.id}`, at: event.created_at, title: event.title, detail: event.message, actor: event.actor, icon: SALES_ICON[event.event_type] || History, jobCardId: event.metadata?.job_card_id ? String(event.metadata.job_card_id) : null, jobNo: null as string | null, tone: event.event_type === "SALES_ORDER_LOT_RETURNED" ? "rose" : "primary" })),
    ...production.map((event) => ({ kind: "production" as const, id: `p:${event.id}`, at: event.at, title: PRODUCTION_LABEL[event.action] || event.action.replaceAll("_", " "), detail: [event.payload?.stage ? String(event.payload.stage).toLowerCase() : null, eventText({ action: event.action, payload: event.payload })].filter(Boolean).join(" · "), actor: event.actor, icon: Factory, jobCardId: event.job_card_id, jobNo: event.job_card_no, tone: event.action.includes("force") || event.action.includes("missed") ? "amber" : "violet" })),
  ].filter((event) => filter === "all" || event.kind === filter).sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm" data-testid="order-activity">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-primary" />
        <h2 className="text-[14px] font-semibold">Activity</h2>
        <div className="tube-segment ml-auto !h-7 text-[11px]" role="group" aria-label="Activity filter">
          {(["all", "sales", "production"] as const).map((key) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{key === "all" ? "All" : key === "sales" ? "Sales" : "Production"}</button>)}
        </div>
      </div>
      {derived ? <p className="mt-1 text-[11.5px] text-muted-foreground">Basic sales history only — this server has no full sales audit trail.</p> : null}
      {salesState === "error" || productionState === "error" ? <p className="mt-1 text-[11.5px] text-signal-rose-ink">{salesState === "error" ? "Sales" : "Production"} activity did not load — refresh to try again.</p> : null}
      {events.length ? (
        <ol className="relative mt-3 max-h-[55vh] space-y-3 overflow-y-auto border-l border-border pl-5">
          {events.slice(0, limit).map((event) => {
            const Icon = event.icon
            return (
              <li key={event.id} className="relative">
                <span className={cn("absolute -left-[31px] top-0 grid h-6 w-6 place-items-center rounded-full border-2 border-card", event.tone === "rose" ? "bg-signal-rose-soft text-signal-rose-ink" : event.tone === "amber" ? "bg-signal-amber-soft text-signal-amber-ink" : event.tone === "violet" ? "bg-signal-violet-soft text-signal-violet-ink" : "bg-primary/10 text-primary")}>
                  <Icon className="h-3 w-3" />
                </span>
                <p className="text-[13px] font-medium">
                  {event.title}
                  {event.jobCardId ? <button type="button" onClick={() => onOpenCard(String(event.jobCardId))} className="ml-1.5 font-mono text-[12px] font-semibold text-primary hover:underline">{event.jobNo || "job card"}</button> : null}
                </p>
                {event.detail ? <p className="text-[12px] text-muted-foreground">{event.detail}</p> : null}
                <p className="text-[11px] text-muted-foreground">{event.actor || "system"} · {formatDate(event.at, "DD MMM, HH:mm")}</p>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="mt-3 text-[12.5px] text-muted-foreground">{salesState === "loading" || productionState === "loading" ? "Loading activity…" : "No activity yet."}</p>
      )}
      {events.length > limit ? <button type="button" onClick={() => setLimit((value) => value + 40)} className="mt-2 text-[12.5px] font-semibold text-primary hover:underline">Show {Math.min(40, events.length - limit)} more</button> : null}
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
