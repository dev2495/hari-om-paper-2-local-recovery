"use client"

import Link from "next/link"
import dayjs from "dayjs"
import { useQueries } from "@tanstack/react-query"
import {
  ArrowLeft,
  Ban,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleSlash2,
  ClipboardCheck,
  ExternalLink,
  Factory,
  FileCheck2,
  History,
  Lock,
  MoreHorizontal,
  Palette,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  Printer,
  Rocket,
  Send,
  Settings2,
  Trash2,
  Truck,
  Zap,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation"

import { EmptyState } from "@/components/erp/shell"
import { ColorChip, JobCardNo, LifecycleBadge, lifecycleFromSummary, swatchFor } from "@/components/production/lifecycle-chips"
import { JobCardLifecycleSheet } from "@/components/production/job-card-lifecycle-sheet"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { ReleaseToQueueDialog } from "@/components/sales/release-to-queue-dialog"
import { OrderClosureDialog, orderClosureAction, orderPlantId } from "@/components/sales/order-closure-dialog"
import { OrderHoldDialog } from "@/components/sales/order-hold-dialog"
import { CustomerPoDialog, awaitingCustomerPo, poChangeOptions } from "@/components/sales/customer-po-dialog"
import { OrderCardStepper } from "@/components/sales/order-card-stepper"
import { Chip, DueCell, OrderStatusChip, PlanChip, QcFlagChip, StageDots } from "@/components/sales/order-chips"
import { OrderHistoryTimeline } from "@/components/sales/order-history-timeline"
import { LineDeliveryEditor } from "@/components/sales/line-delivery-editor"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { apiErrorText, useUpdateLineColors, type JobCardLifecycle } from "@/hooks/use-lifecycle"
import { useCustomers, useParchments } from "@/hooks/use-master-data"
import { usePlanningJobCards } from "@/hooks/use-production"
import { useApproveSalesOrder, useMoveDeliverySchedule, useOrderDeliverySchedules, useOrderHistory, useResumeSalesOrder, useSalesOrder, useSubmitSalesOrder } from "@/hooks/use-sales"
import { dispatchApi, productionApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import { peopleInText, personLabel } from "@/lib/people"
import { lineHasReleaseWork } from "@/lib/sales-release"
import { isInternalOrigin, salesOrderOriginLabel } from "@/lib/sales-order-entry"
import { canMakeChallan, cardReadyToDispatch, cardState, cardSummary, formatDateTime, formatShortDate, nextAction, orderDue, orderHealth, orderTotals, whatIsNext } from "@/lib/sales-order-tracker"

const fmt = (value: unknown) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })
/** Phone (< 640 px) table cells become labelled blocks: the label comes from data-label. */
const PHONE_LABEL = "max-sm:before:mb-0.5 max-sm:before:block max-sm:before:text-[11px] max-sm:before:font-semibold max-sm:before:text-muted-foreground max-sm:before:content-[attr(data-label)]"
/** Rates per piece always show paise: ₹2.40, never ₹2.4. */
const rateText = (value: unknown) => `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const money = (value: unknown) => `₹ ${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`

type TabKey = "overview" | "cards" | "deliveries" | "history"
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "cards", label: "Job cards" },
  { key: "deliveries", label: "Deliveries" },
  { key: "history", label: "History" },
]
const HEALTH_DOT: Record<string, string> = { blue: "bg-signal-blue-ink", emerald: "bg-signal-emerald-ink", teal: "bg-signal-teal-ink", amber: "bg-signal-amber-ink", rose: "bg-signal-rose-ink", slate: "bg-muted-foreground" }

export default function SalesOrderPage() {
  const params = useParams()
  const orderId = String(params?.orderId || "")
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { showToast } = useApp()
  const { user, activePlant } = useAuth()
  const tabParam = String(searchParams?.get("tab") || "overview")
  const tab: TabKey = (TABS.some((row) => row.key === tabParam) ? tabParam : "overview") as TabKey
  const setTab = (next: TabKey) => {
    const query = new URLSearchParams(searchParams?.toString() || "")
    if (next === "overview") query.delete("tab"); else query.set("tab", next)
    query.delete("print")
    router.replace(query.toString() ? `${pathname}?${query.toString()}` : pathname, { scroll: false })
  }

  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([])
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [holdOpen, setHoldOpen] = useState(false)
  const [closureOpen, setClosureOpen] = useState(false)
  const [poOpen, setPoOpen] = useState(false)
  const [sheetJobId, setSheetJobId] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)

  const orderQuery = useSalesOrder(orderId)
  const order = orderQuery.data
  const plantId = orderPlantId(order) || (activePlant && String(activePlant).toUpperCase() !== "ALL" ? String(activePlant) : undefined)
  const historyQuery = useOrderHistory(orderId, plantId)
  const schedulesQuery = useOrderDeliverySchedules(orderId)
  const customersQuery = useCustomers()
  const jobCardsQuery = usePlanningJobCards({ sales_order_id: orderId, limit: 250 }, Boolean(orderId))
  const approveOrder = useApproveSalesOrder()
  const submitOrder = useSubmitSalesOrder()
  const resumeOrder = useResumeSalesOrder()

  const orderJobs: any[] = useMemo(
    () => (Array.isArray(jobCardsQuery.data) ? jobCardsQuery.data : []).filter((job: any) => String(job.sales_order_id || "") === orderId).sort((a: any, b: any) => String(a.job_card_no || "").localeCompare(String(b.job_card_no || ""))),
    [jobCardsQuery.data, orderId],
  )
  const lifecycleQueries = useQueries({
    queries: orderJobs.map((job) => ({
      queryKey: ["job-card-lifecycle", String(job.id), plantId || null],
      // Under "All visible plants" the lifecycle needs one plant: send the order's own plant.
      queryFn: async () => (await productionApi.getJobCardLifecycle(String(job.id), plantId)).data as JobCardLifecycle,
      staleTime: 15_000,
    })),
  })
  const lifecycleById = useMemo(() => {
    const map = new Map<string, JobCardLifecycle>()
    lifecycleQueries.forEach((result, index) => { if (result.data) map.set(String(orderJobs[index]?.id), result.data) })
    return map
  }, [lifecycleQueries, orderJobs])
  const dispatchJobs = useMemo(() => orderJobs.filter((job) => cardState(job) === "COMPLETED" || cardReadyToDispatch(job) || String(job.current_stage || "").toUpperCase() === "DONE"), [orderJobs])
  const dispatchQueries = useQueries({
    queries: dispatchJobs.map((job) => ({
      queryKey: ["dispatch-by-job", String(job.id), false, plantId || null],
      queryFn: async () => { try { return (await dispatchApi.getDispatchByJob(String(job.id), false, plantId)).data } catch { return null } },
      staleTime: 30_000,
    })),
  })

  const customer = useMemo(() => (Array.isArray(customersQuery.data) ? customersQuery.data : []).find((row: any) => String(row.id) === String(order?.customer_id || "")), [customersQuery.data, order?.customer_id])
  const totals = useMemo(() => orderTotals(order), [order])
  const cards = useMemo(() => cardSummary(orderJobs), [orderJobs])
  const madeFromLifecycle = useMemo(() => {
    if (!orderJobs.length || lifecycleById.size < orderJobs.length) return null
    return orderJobs.reduce((sum, job) => sum + Number(lifecycleById.get(String(job.id))?.made_qty || 0), 0)
  }, [orderJobs, lifecycleById])
  const made = Math.max(madeFromLifecycle ?? cards.made, totals.dispatched)
  const due = useMemo(() => orderDue(order), [order])
  // Sales views challans only: the challan actions go to the roles that can seal one (Owner, Admin, Dispatch).
  const canChallan = canMakeChallan(user)
  const action = useMemo(() => nextAction(order, cards, user?.email, canChallan), [order, cards, user?.email, canChallan])
  const scheduleItems: any[] = useMemo(() => (Array.isArray((schedulesQuery.data as any)?.items) ? (schedulesQuery.data as any).items : []), [schedulesQuery.data])
  const scheduleRevision = Number((schedulesQuery.data as any)?.schedule_revision ?? order?.schedule_revision ?? 0)
  const health = useMemo(() => orderHealth(order, totals, { ...cards, made }, due), [order, totals, cards, made, due])
  const next = useMemo(() => whatIsNext(order, totals, cards, orderJobs, scheduleItems, canChallan), [order, totals, cards, orderJobs, scheduleItems, canChallan])
  const history = historyQuery.data
  const lastChange = history?.events?.[0]

  const status = String(order?.status || "").toLowerCase()
  const canApprove = ["draft", "submitted"].includes(status)
  const isMine = Boolean(user?.email) && String(order?.created_by || "").toLowerCase() === String(user?.email || "").toLowerCase()
  const releasableLineIds = (order?.lines || []).filter((line: any) => lineHasReleaseWork(line)).map((line: any) => String(line.id))
  const canRelease = ["approved", "released", "partially_released", "partially_dispatched"].includes(status) && !order?.is_held && releasableLineIds.length > 0
  const closure = orderClosureAction(order)
  const editable = !["closed", "cancelled"].includes(status) && !order?.is_held
  const finished = ["closed", "cancelled"].includes(status)
  const unsyncedReleaseLots = useMemo(
    () => (order?.lines || []).flatMap((line: any) => (Array.isArray(line.release_lots) ? line.release_lots : []).filter((lot: any) => !lot.job_card_id && String(lot.status || "").toLowerCase() !== "cancelled")),
    [order?.lines],
  )

  // Row menu "Print" on the Orders list opens the page and prints it once it has loaded.
  useEffect(() => {
    if (searchParams?.get("print") !== "1" || !order || orderQuery.isFetching) return
    const timer = window.setTimeout(() => window.print(), 600)
    return () => window.clearTimeout(timer)
  }, [searchParams, order, orderQuery.isFetching])

  const run = async (task: () => Promise<unknown>, done: string) => {
    try { await task(); showToast(done, "success"); return true } catch (error) { showToast(apiErrorText(error, "The action did not go through."), "error"); return false }
  }
  const handleApprove = () => run(() => approveOrder.mutateAsync({ orderId, plantId }), "Sales order approved. Next: release its lines.")
  const handleSubmit = () => run(() => submitOrder.mutateAsync({ orderId }), "Sent for approval.")
  const handleResume = () => run(() => resumeOrder.mutateAsync({ orderId, plantId }), "Customer hold lifted.")
  const handleOpenRelease = (lineIds?: string[]) => {
    const ids = lineIds?.length ? lineIds : selectedLineIds.length ? selectedLineIds : releasableLineIds
    if (!ids.length) { showToast("Nothing is left to release on this order.", "error"); return }
    setSelectedLineIds(ids)
    setReleaseOpen(true)
  }

  if (orderQuery.isLoading) return <LoadingState label="Loading order…" />
  if (orderQuery.isError) return <ErrorState title="Order could not be loaded" message="Refresh to retry. This is not a missing order." onRetry={() => { void orderQuery.refetch() }} />
  if (!order) return <EmptyState label="Sales order not found." />

  const customerName = customer?.name || order.customer_name || "Customer"
  const awaitingPo = awaitingCustomerPo(order)
  const poOptions = poChangeOptions(order)
  const poChanges: any[] = Array.isArray(order.po_changes) ? order.po_changes : []
  const poLocked = poOptions.mode === "locked" && poChanges.some((row: any) => row.after_release)
  const customerCode = customer?.customer_code || ""
  const firstReady = cards.firstReadyId
  const dcHref = firstReady ? `/logistics/dispatch/new?job_card_id=${firstReady}` : "/logistics/dispatch"
  const callOffs = scheduleItems.filter((row) => row.status !== "cancelled")
  const dcs = dispatchQueries.map((result, index) => ({ job: dispatchJobs[index], data: result.data })).filter((row) => row.data?.dispatch_snapshot || row.data?.challan_no)

  const actionBtn = "erp-btn-secondary !h-11 sm:!h-9 whitespace-nowrap"
  return (
    <div className="space-y-3" data-testid="sales-orders:tracking-page">
      <nav className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/sales-orders" className="inline-flex min-h-11 items-center gap-1 pr-1 hover:text-foreground sm:min-h-0"><ArrowLeft className="h-3.5 w-3.5" />Orders</Link>
        <ChevronRight className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
        <span className="font-semibold text-foreground">{order.order_no || "Sales order"}</span>
      </nav>

      <header className="erp-panel rounded-xl px-4 py-3.5 sm:px-5" data-testid="sales-order:header">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-[22px] font-semibold tracking-tight">{order.order_no || "Sales order"}</h1>
          <OrderStatusChip order={order} />
          {orderJobs.some((job) => String(job.priority || "").toUpperCase() === "RUSH" || job.is_emergency) ? <Chip tone="rose" icon={Zap}>Rush</Chip> : null}
          <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
          <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            <div><dt className="sr-only">Customer</dt><dd><strong className="text-foreground">{customerName}</strong>{customerCode ? ` · ${customerCode}` : ""}</dd></div>
            <div><dt className="sr-only">PO</dt><dd>{awaitingPo ? <Chip tone="amber" icon={FileCheck2} title={`Internal order made ${formatShortDate(order.internal_order_date)}`}>Internal order · waiting for customer PO</Chip> : <>PO <strong className="text-foreground">{order.po_number || "—"}</strong> · {formatShortDate(order.po_date)}{poLocked ? <Lock className="ml-1 inline h-3.5 w-3.5 align-[-2px]" aria-label="Customer PO locked" /> : null}</>}</dd></div>
            <div><dt className="sr-only">Due</dt><dd>{due.date ? <>Due <strong className="text-foreground">{formatShortDate(due.date)}</strong></> : <span data-testid="sales-order:no-date">No delivery date</span>}</dd></div>
            <div><dt className="sr-only">Quantity</dt><dd><strong className="text-foreground">{fmt(totals.ordered)}</strong> pcs · {totals.lines} line{totals.lines === 1 ? "" : "s"}</dd></div>
            <div><dt className="sr-only">Value</dt><dd>Value <strong className="text-foreground">{money(totals.value)}</strong> ex-GST</dd></div>
          </dl>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]" data-testid="sales-order:health">
          {health.map((item) => (
            <span key={item.text} className="inline-flex items-center gap-1.5"><span className={cn("h-2 w-2 shrink-0 rounded-full", HEALTH_DOT[item.tone])} aria-hidden="true" />{item.text}</span>
          ))}
        </p>
      </header>

      <div className="sticky top-[calc(var(--topbar-h)+6px)] z-20 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/95 px-3 py-2 shadow-sm backdrop-blur print:hidden" data-testid="sales-order:actions">
        {canApprove ? (
          isMine ? (
            status === "draft"
              ? <button type="button" className="erp-btn-primary !h-11 sm:!h-9" onClick={() => void handleSubmit()} disabled={submitOrder.isPending} title="You entered this order, so another user approves it (maker-checker)" data-testid="sales-order:submit"><Send className="h-4 w-4" />Send for approval</button>
              : <span className="rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-[12.5px] font-medium text-signal-amber-ink" title="Maker-checker: the person who created the order cannot approve it, even after switching role.">Waiting for another user to approve</span>
          ) : (
            <button type="button" className="erp-btn-primary !h-11 sm:!h-9" onClick={() => void handleApprove()} disabled={approveOrder.isPending} data-testid="sales-order:approve"><CheckCircle2 className="h-4 w-4" />Approve</button>
          )
        ) : null}
        <button type="button" className={cn(canApprove ? actionBtn : "erp-btn-primary !h-11 sm:!h-9")} disabled={!canRelease} title={!canRelease ? (order.is_held ? "Lift the customer hold to release" : canApprove ? "Approve the order first" : finished ? "The order is closed" : "All lines are already released to job cards") : "Make job cards for the open lines"} onClick={() => handleOpenRelease()} data-testid="sales-order:release"><Rocket className="h-4 w-4" />Release lines</button>
        {/* On a phone the buttons that cannot be used yet are left out so the bar stays short. */}
        {cards.total ? <Link href={`/planning/board?section=winder&order_id=${order.id}&view=calendar`} className={actionBtn}><CalendarDays className="h-4 w-4" />Plan</Link> : <button type="button" className={cn(actionBtn, "max-sm:!hidden")} disabled title="Nothing to plan — release the lines first"><CalendarDays className="h-4 w-4" />Plan</button>}
        {cards.ready && !canChallan ? <span className={cn(actionBtn, "cursor-default opacity-80")} data-testid="sales-order:waiting-dc" title="Dispatch makes the delivery challan for the packed pieces"><Truck className="h-4 w-4" />Waiting for dispatch · {fmt(cards.readyQty)} ready</span> : cards.ready ? <Link href={dcHref} className={actionBtn} data-testid="sales-order:make-dc" title="Make the delivery challan for the packed pieces"><Truck className="h-4 w-4" />Make challan · {fmt(cards.readyQty)} ready</Link> : canChallan ? <button type="button" className={cn(actionBtn, "max-sm:!hidden")} disabled title="No packed pieces waiting for a delivery challan"><Truck className="h-4 w-4" />Make challan</button> : null}
        <span className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
        {order.is_held ? (
          <button type="button" className={cn(actionBtn, "!text-signal-emerald-ink")} onClick={() => void handleResume()} disabled={resumeOrder.isPending} data-testid="sales-order:resume"><PlayCircle className="h-4 w-4" />Resume</button>
        ) : (
          <button type="button" className={cn(actionBtn, "!text-signal-amber-ink")} disabled={finished || totals.pending <= 0} title={finished ? "The order is closed" : totals.pending <= 0 ? "Nothing pending to hold" : "Customer hold: the undelivered balance is held and the PO closes until Resume"} onClick={() => setHoldOpen(true)} data-testid="sales-order:hold"><PauseCircle className="h-4 w-4" />Hold</button>
        )}
        <button type="button" className={cn(actionBtn, closure.kind === "cancel" ? "!text-signal-rose-ink" : "!text-signal-amber-ink")} disabled={!closure.kind} title={closure.kind === "cancel" ? "Nothing is released or dispatched yet: cancel the whole order with a reason" : closure.kind === "short_close" ? "Drop the balance not yet released; released job cards still finish" : closure.reason || "Nothing to close"} onClick={() => setClosureOpen(true)} data-testid={closure.kind === "cancel" ? "sales-order-detail:cancel" : "sales-order-detail:short-close"}>
          {closure.kind === "cancel" ? <Ban className="h-4 w-4" /> : <CircleSlash2 className="h-4 w-4" />}{closure.kind === "cancel" ? "Cancel order" : "Short close"}
        </button>
        <span className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
        <button type="button" className={cn(actionBtn, "max-sm:!hidden")} onClick={() => window.print()}><Printer className="h-4 w-4" />Print</button>
        {canApprove ? <Link href={`/sales-orders/${order.id}/edit`} className={actionBtn} title="Edit the order, its lines and the customer PO" data-testid="sales-order:edit"><Pencil className="h-4 w-4" />Edit</Link> : null}
        {awaitingPo && poOptions.allowed ? (
          <button type="button" className={cn(actionBtn, "!text-signal-amber-ink")} onClick={() => setPoOpen(true)} data-testid="sales-order:add-po" title={poOptions.mode === "once" ? "Released: the PO can be added once, then it locks" : "Add the customer's PO to confirm this order"}><FileCheck2 className="h-4 w-4" />Add customer PO</button>
        ) : !awaitingPo && poOptions.allowed && !canApprove ? (
          /* A draft changes its PO through Edit; one way to the same change is enough. */
          <button type="button" className={actionBtn} onClick={() => setPoOpen(true)} data-testid="sales-order:change-po" title={poOptions.reason || "Change the customer PO number"}><FileCheck2 className="h-4 w-4" />{poOptions.mode === "once" ? "Change PO (once)" : "Change PO"}</button>
        ) : poLocked && !finished ? (
          <span className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-[12.5px] text-muted-foreground sm:h-9" title={poOptions.reason || undefined} data-testid="sales-order:po-locked"><Lock className="h-3.5 w-3.5" aria-hidden="true" />PO locked</span>
        ) : null}
        <div className="relative">
          <button type="button" className="erp-btn-secondary !h-11 !w-11 !px-0 sm:!h-9 sm:!w-9" aria-label="More actions" aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}><MoreHorizontal className="h-4 w-4" /></button>
          {moreOpen ? (
            <div className="tube-popover right-0 top-full mt-1 w-56" role="menu" onMouseLeave={() => setMoreOpen(false)}>
              <Link role="menuitem" href={`/sales-orders/new?copy=${order.id}`} className="flex min-h-11 items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-foreground/[.05] sm:min-h-0"><Plus className="h-3.5 w-3.5 opacity-80" />Copy as new order</Link>
              <button role="menuitem" type="button" onClick={() => { setMoreOpen(false); window.print() }} className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-foreground/[.05] sm:hidden"><Printer className="h-3.5 w-3.5 opacity-80" />Print</button>
              <button role="menuitem" type="button" onClick={() => { setMoreOpen(false); setTab("history") }} className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-foreground/[.05] sm:min-h-0"><History className="h-3.5 w-3.5 opacity-80" />Full history</button>
              {cards.total ? <Link role="menuitem" href={`/inventory/genealogy?job_card_id=${orderJobs[0].id}`} className="flex min-h-11 items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-foreground/[.05] sm:min-h-0"><ExternalLink className="h-3.5 w-3.5 opacity-80" />Trace materials</Link> : null}
            </div>
          ) : null}
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-muted-foreground" data-testid="sales-order:last-change">
          <History className="h-3.5 w-3.5" aria-hidden="true" />
          {historyQuery.isLoading ? "Loading history…" : lastChange ? `Last change: ${formatDateTime(lastChange.at)} · ${lastChange.actor ? personLabel(lastChange.actor) : "system"}` : "No changes yet"}
        </span>
      </div>

      {order.closure_kind ? <ClosureBanner order={order} /> : null}
      {unsyncedReleaseLots.length > 0 ? (
        <div data-testid="sales-order-detail:unsynced-release-lots" className="rounded-xl border border-signal-rose-line bg-signal-rose-soft px-4 py-2.5 text-[13px] text-signal-rose-ink">
          {unsyncedReleaseLots.length} released lot{unsyncedReleaseLots.length === 1 ? " is" : "s are"} not in planning yet — the job card sync did not finish. Click Release lines to resume; the pending lot is picked up automatically.
        </div>
      ) : null}
      {jobCardsQuery.isError ? (
        <div role="alert" className="rounded-xl border border-signal-rose-line bg-signal-rose-soft px-4 py-2.5 text-[13px] text-signal-rose-ink">
          Job cards for this order did not load, so production figures are not shown. <button type="button" className="font-semibold underline" onClick={() => jobCardsQuery.refetch()}>Try again</button>
        </div>
      ) : null}

      <div className="flex items-center gap-1 overflow-x-auto border-b border-border print:hidden max-sm:flex-wrap max-sm:overflow-visible" role="tablist" aria-label="Order sections">
        {TABS.map((item) => {
          const count = item.key === "cards" ? cards.total : item.key === "deliveries" ? callOffs.length : item.key === "history" ? history?.summary?.events ?? null : null
          const active = tab === item.key
          return (
            <button key={item.key} type="button" role="tab" aria-selected={active} data-testid={`sales-order:tab-${item.key}`} onClick={() => setTab(item.key)} className={cn("-mb-px inline-flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[13px] font-medium transition-colors", active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {item.label}
              {count != null ? <span className={cn("rounded px-1.5 text-[11px] font-semibold tabular-nums", active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{count}</span> : null}
              {item.key === "history" && history?.summary?.flags ? <Chip tone="amber" size="xs">{history.summary.flags} flagged</Chip> : null}
            </button>
          )
        })}
      </div>

      {tab === "overview" ? (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(300px,2fr)]">
          <div className="space-y-3">
            <section className="erp-panel rounded-xl p-4" aria-label="Fulfilment" data-testid="order-flow-strip">
              <div className="flex flex-wrap items-baseline gap-2"><h2 className="text-[14px] font-semibold">Fulfilment</h2><span className="text-[12px] text-muted-foreground">ordered → released → made → dispatched</span></div>
              <div className="mt-3 grid gap-2">
                {([
                  ["Ordered", totals.ordered, "bg-foreground/30"],
                  ["Released", totals.released, "bg-signal-blue-ink"],
                  ["Made", jobCardsQuery.isError ? null : made, "bg-signal-teal-ink"],
                  ["Dispatched", totals.dispatched, "bg-signal-emerald-ink"],
                ] as Array<[string, number | null, string]>).map(([label, value, tone]) => (
                  <div key={label} className="grid grid-cols-[88px_minmax(0,1fr)_96px] items-center gap-3 text-[13px]">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="h-3 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className={cn("block h-full rounded-full transition-[width] duration-700", tone)} style={{ width: `${value == null ? 0 : Math.max(value > 0 ? 2 : 0, Math.min(100, (value / Math.max(1, totals.ordered)) * 100))}%` }} /></span>
                    <span className="text-right font-semibold tabular-nums">{value == null ? "—" : fmt(value)} <small className="font-normal text-muted-foreground">pcs</small></span>
                  </div>
                ))}
              </div>
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
                {totals.unreleased > 0 && !finished ? <span><strong className="tabular-nums text-foreground">{fmt(totals.unreleased)}</strong> not released</span> : null}
                {totals.hold > 0 ? <span className="text-signal-rose-ink"><strong className="tabular-nums">{fmt(totals.hold)}</strong> on customer hold</span> : null}
                {totals.shortClosed > 0 ? <span className="text-signal-amber-ink"><strong className="tabular-nums">{fmt(totals.shortClosed)}</strong> dropped by short close</span> : null}
                {!finished ? <span><strong className="tabular-nums text-foreground">{fmt(totals.pending)}</strong> still to send</span> : null}
              </p>
              {cards.readyQty > 0 ? <p className="mt-2 rounded-lg border border-signal-teal-line bg-signal-teal-soft px-3 py-2 text-[12.5px] text-signal-teal-ink">{fmt(cards.readyQty)} pcs through Process (packed, both QC readings in), waiting for a delivery challan.{canChallan ? <> <Link href={dcHref} className="inline-flex min-h-11 items-center font-semibold underline max-sm:flex max-sm:w-fit sm:min-h-0">Make challan</Link></> : " Dispatch makes it."}</p> : null}
            </section>

            <section className="erp-panel overflow-hidden rounded-xl" aria-label="Lines">
              <div className="flex flex-wrap items-baseline gap-2 px-4 pt-4"><h2 className="text-[14px] font-semibold">Lines</h2><span className="text-[12px] text-muted-foreground">with colour splits and rates</span></div>
              {/* Phone (< 640 px): each line is a card with labelled cells — nothing scrolls sideways. */}
              <div className="mt-3 overflow-x-auto max-sm:overflow-visible">
                <table className="tube-grid max-sm:block max-sm:[&>tbody]:block">
                  <thead className="max-sm:hidden">
                    <tr><th className="num">Line</th><th>Size</th><th>Colour · rate</th><th className="num 2xl:hidden">Pcs</th><th className="num hidden 2xl:table-cell">Ordered</th><th className="num hidden 2xl:table-cell">Released</th><th className="num hidden 2xl:table-cell">Made</th><th className="num hidden 2xl:table-cell">Dispatched</th><th>Job cards</th><th><span className="sr-only">Actions</span></th></tr>
                  </thead>
                  <tbody>
                    {(order.lines || []).map((line: any) => (
                      <LineRow
                        key={line.id}
                        line={line}
                        jobs={orderJobs.filter((job) => String(job.sales_order_line_id || "") === String(line.id))}
                        lifecycleById={lifecycleById}
                        editable={editable}
                        onOpenCard={setSheetJobId}
                        onRelease={canRelease && Number(line.release_remaining_qty ?? 0) > 0 ? () => handleOpenRelease([String(line.id)]) : undefined}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="space-y-3">
            <section className="erp-panel rounded-xl p-4" aria-label="What is next" data-testid="sales-order:next">
              <h2 className="text-[14px] font-semibold">What is next</h2>
              <ol className="mt-3 space-y-2">
                {next.map((item, index) => (
                  <li key={item.title} className="flex gap-3 rounded-lg bg-[hsl(var(--surface-2))] px-3 py-2">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground">{index + 1}</span>
                    <span className="min-w-0"><strong className="block text-[13px]">{item.title}</strong>{item.detail ? <span className="block text-[12px] text-muted-foreground">{item.detail}</span> : null}</span>
                  </li>
                ))}
              </ol>
              {action.key !== "open" && action.key !== "waiting" ? (
                <div className="mt-3">
                  {action.href ? <Link href={action.href} className="erp-btn-primary !h-11 sm:!h-9 w-full justify-center">{action.label}</Link>
                    : <button type="button" className="erp-btn-primary !h-11 sm:!h-9 w-full justify-center" onClick={() => { if (action.key === "approve") void handleApprove(); else if (action.key === "submit") void handleSubmit(); else if (action.key === "resume") void handleResume(); else handleOpenRelease() }}>{action.label}</button>}
                </div>
              ) : null}
            </section>

            <section className="erp-panel rounded-xl p-4" aria-label="Order details">
              <h2 className="text-[14px] font-semibold">Order details</h2>
              <dl className="mt-3 grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
                <dt className="text-muted-foreground">Customer</dt><dd>{customerName}{customerCode ? ` (${customerCode})` : ""}</dd>
                <dt className="text-muted-foreground">{awaitingPo ? "Order" : "PO"}</dt><dd>{awaitingPo ? <>{`Internal order · ${formatShortDate(order.internal_order_date)}`} <span className="text-signal-amber-ink">· waiting for customer PO</span></> : `${order.po_number || "—"} · ${formatShortDate(order.po_date)}${isInternalOrigin(order.origin) ? ` · ${salesOrderOriginLabel(order.origin)}` : ""}`}</dd>
                {poChanges.length ? <><dt className="text-muted-foreground">PO history</dt><dd data-testid="sales-order:po-history"><ul className="space-y-0.5">{poChanges.map((row: any) => <li key={row.id} className="text-[12.5px]">{row.kind === "CONFIRMED" ? `Confirmed with PO ${row.new_po_number}` : `${row.old_po_number || "—"} → ${row.new_po_number}`}{row.after_release ? " (after release, one-time)" : ""} <span className="text-muted-foreground">· {formatDateTime(row.changed_at)} · {personLabel(row.changed_by)}</span></li>)}</ul>{poLocked ? <span className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground"><Lock className="h-3 w-3" aria-hidden="true" />Locked: {peopleInText(poOptions.reason)}</span> : null}</dd></> : null}
                <dt className="text-muted-foreground">Due</dt><dd><DueCell due={due} compact /></dd>
                <dt className="text-muted-foreground">Rate</dt><dd>{(order.lines || []).map((line: any) => line.rate_per_pc != null ? `${rateText(line.rate_per_pc)} / pc${(order.lines || []).length > 1 ? ` (L${line.line_no})` : ""}` : null).filter(Boolean).join(" · ") || "—"}</dd>
                <dt className="text-muted-foreground">Value</dt><dd>{money(totals.value)} ex-GST</dd>
                <dt className="text-muted-foreground">Valid till</dt><dd>{formatShortDate(order.expiry_date)}</dd>
                <dt className="text-muted-foreground">Plant</dt><dd>{String(order.plant_id || "—").slice(-2).toUpperCase() === "A1" ? "Plant A" : String(order.plant_id || "—")}</dd>
                <dt className="text-muted-foreground">Created</dt><dd>{formatDateTime(order.created_at)} · {personLabel(order.created_by)}</dd>
                <dt className="text-muted-foreground">Approved</dt><dd>{order.approved_at ? `${formatDateTime(order.approved_at)} · ${personLabel(order.approved_by)}` : "—"}</dd>
                {order.released_at ? <><dt className="text-muted-foreground">Released</dt><dd>{formatDateTime(order.released_at)} · {personLabel(order.released_by)}</dd></> : null}
                {order.is_held ? <><dt className="text-muted-foreground">On hold</dt><dd>{formatDateTime(order.held_at)} · {personLabel(order.held_by)}{order.hold_reason ? ` · ${order.hold_reason}` : ""}</dd></> : null}
                {order.notes ? <><dt className="text-muted-foreground">Notes</dt><dd className="whitespace-pre-wrap">{order.notes}</dd></> : null}
              </dl>
            </section>
          </div>
        </div>
      ) : null}

      {tab === "cards" ? (
        <div className="space-y-3" data-testid="sales-order:cards">
          {(order.lines || []).map((line: any) => {
            const lineJobs = orderJobs.filter((job) => String(job.sales_order_line_id || "") === String(line.id))
            const colour = line.parchment_required ? (line.color_splits?.length ? line.color_splits.map((split: any) => split.color).join(", ") : line.parchment_color || "colour not decided") : "plain"
            return (
              <section key={line.id} className="erp-panel rounded-xl" aria-label={`Line ${line.line_no}`} data-testid={`order-line:${line.id}`}>
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
                  <h2 className="text-[14px] font-semibold">Line {line.line_no} · {line.size_label || line.product_code || "—"} · {colour}</h2>
                  <span className="text-[12px] text-muted-foreground">{fmt(line.qty)} pcs · {lineJobs.length} card{lineJobs.length === 1 ? "" : "s"}{Number(line.release_remaining_qty || 0) > 0 && !finished ? ` · ${fmt(line.release_remaining_qty)} not released` : ""}</span>
                  {canRelease && Number(line.release_remaining_qty ?? 0) > 0 ? <button type="button" className="erp-btn-primary ml-auto !h-11 sm:!h-8" onClick={() => handleOpenRelease([String(line.id)])}><Rocket className="h-3.5 w-3.5" />Release {fmt(line.release_remaining_qty)}</button> : null}
                </div>
                <div className="space-y-2.5 p-3 sm:p-4">
                  {lineJobs.length ? lineJobs.map((job) => <CardBlock key={job.id} job={job} jobs={orderJobs} lifecycle={lifecycleById.get(String(job.id))} onManage={() => setSheetJobId(String(job.id))} />) : <p className="text-[13px] text-muted-foreground">No job card yet{status === "approved" ? " — release this line to create one." : ["draft", "submitted"].includes(status) ? " — waiting for approval." : "."}</p>}
                </div>
              </section>
            )
          })}
        </div>
      ) : null}

      {tab === "deliveries" ? (
        <div className="grid gap-3 xl:grid-cols-2" data-testid="sales-order:deliveries">
          <div className="space-y-3">
            <DeliveryPlan order={order} items={scheduleItems} revision={scheduleRevision} loading={schedulesQuery.isLoading} failed={schedulesQuery.isError} totals={totals} />
            {(order.lines || []).map((line: any) => (
              <section key={line.id} className="erp-panel rounded-xl p-4" aria-label={`Call-offs of line ${line.line_no}`}>
                <h3 className="text-[13.5px] font-semibold">Line {line.line_no} · {line.size_label || line.product_code || "—"} · {fmt(line.qty)} pcs</h3>
                <p className="text-[12px] text-muted-foreground">Dispatched {fmt(line.fulfilled_qty)} · what the customer asked for, by date</p>
                <div className="mt-2">{schedulesQuery.isLoading ? <p className="text-[12.5px] text-muted-foreground">Loading call-offs…</p> : <LineDeliveryEditor orderId={orderId} line={line} schedule={scheduleItems} revision={scheduleRevision} disabled={!editable} />}</div>
              </section>
            ))}
          </div>
          <section className="erp-panel self-start overflow-hidden rounded-xl" aria-label="Delivery challans">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
              <h2 className="text-[14px] font-semibold">Delivery challans</h2>
              <span className="text-[12px] text-muted-foreground">{dcs.length} DC{dcs.length === 1 ? "" : "s"} · {fmt(totals.dispatched)} pcs dispatched</span>
              {cards.ready && !canChallan ? <span className="ml-auto text-[12.5px] text-muted-foreground">{fmt(cards.readyQty)} pcs ready · waiting for Dispatch to make the challan</span> : cards.ready ? <Link href={dcHref} className="erp-btn-primary ml-auto !h-11 sm:!h-8"><Truck className="h-3.5 w-3.5" />Make challan · {fmt(cards.readyQty)} ready</Link> : canChallan ? <button type="button" className="erp-btn-secondary ml-auto !h-11 sm:!h-8" disabled title="No packed pieces waiting"><Truck className="h-3.5 w-3.5" />Make challan</button> : null}
            </div>
            {dispatchQueries.some((result) => result.isLoading) ? <p className="px-4 py-3 text-[12.5px] text-muted-foreground">Loading challans…</p> : dcs.length ? (
              <table className="tube-grid max-sm:block max-sm:[&_tbody]:block max-sm:[&_td]:!border-0 max-sm:[&_td]:!px-0 max-sm:[&_td]:!py-0 max-sm:[&_tr]:flex max-sm:[&_tr]:flex-wrap max-sm:[&_tr]:items-center max-sm:[&_tr]:gap-x-3 max-sm:[&_tr]:gap-y-1 max-sm:[&_tr]:border-b max-sm:[&_tr]:border-border max-sm:[&_tr]:px-4 max-sm:[&_tr]:py-2">
                <thead className="max-sm:hidden"><tr><th>DC</th><th>When</th><th className="num">Pcs</th><th className="num">Boxes</th><th>Vehicle</th><th>Card</th><th><span className="sr-only">Print</span></th></tr></thead>
                <tbody>
                  {dcs.map(({ job, data }) => {
                    const snap = data?.dispatch_snapshot || {}
                    const boxes = (snap.items || []).reduce((sum: number, item: any) => sum + Number(item.qty_units || 0), 0)
                    return (
                      <tr key={String(data?.id || job.id)}>
                        <td className="font-semibold">{snap.challan_no || snap.dispatch_ref || data?.challan_no || "DC"}</td>
                        <td className="whitespace-nowrap">{formatShortDate(snap.date || data?.dispatch_date)}</td>
                        <td className="num">{fmt(snap.dispatch_qty || snap.qty || data?.dispatch_qty)}</td>
                        <td className="num">{boxes || "—"}</td>
                        <td>{snap.transporter?.vehicle_no || data?.vehicle_no || "—"}</td>
                        <td><button type="button" onClick={() => setSheetJobId(String(job.id))} className="inline-flex min-h-11 items-center hover:text-primary sm:min-h-0"><JobCardNo job={job} /></button></td>
                        <td className="text-right"><Link href={`/logistics/dispatch/${job.id}/print${data?.id ? `?dispatch_id=${data.id}` : ""}`} aria-label="Print challan" className="inline-grid h-11 w-11 place-items-center sm:h-7 sm:w-7 rounded-md text-muted-foreground hover:bg-foreground/[.06] hover:text-foreground"><Printer className="h-3.5 w-3.5" /></Link></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : <p className="px-4 py-3 text-[12.5px] text-muted-foreground">No DC yet.{totals.dispatched > 0 ? ` ${fmt(totals.dispatched)} pcs were dispatched on job cards not in the latest list.` : ""}</p>}
          </section>
        </div>
      ) : null}

      {tab === "history" ? (
        <OrderHistoryTimeline history={history} loading={historyQuery.isLoading} error={historyQuery.isError} onRetry={() => { void historyQuery.refetch() }} orderNo={order.order_no} onOpenCard={setSheetJobId} />
      ) : null}

      <ReleaseToQueueDialog
        order={order}
        selectedLineIds={selectedLineIds.length ? selectedLineIds : releasableLineIds}
        open={releaseOpen}
        onOpenChange={setReleaseOpen}
        onReleased={() => { setSelectedLineIds([]); void jobCardsQuery.refetch(); void historyQuery.refetch() }}
      />
      <OrderHoldDialog orders={holdOpen ? [order] : []} open={holdOpen} onOpenChange={setHoldOpen} testIdPrefix="sales-order:hold" />
      <OrderClosureDialog order={order} open={closureOpen} onOpenChange={setClosureOpen} />
      <CustomerPoDialog order={order} open={poOpen} onOpenChange={setPoOpen} />
      <JobCardLifecycleSheet jobCardId={sheetJobId} open={Boolean(sheetJobId)} onOpenChange={(open) => { if (!open) setSheetJobId(null) }} />
    </div>
  )
}

/** Who cancelled or short-closed the order, when and why. */
function ClosureBanner({ order }: { order: any }) {
  const cancelled = String(order.status || "") === "cancelled"
  const dropped = (order.lines || []).reduce((sum: number, line: any) => sum + Number(line.short_closed_qty || 0), 0)
  const stillOpen = !cancelled && String(order.status || "") !== "closed"
  return (
    <div data-testid="sales-order-detail:closure" className={cn("flex gap-3 rounded-xl border px-4 py-3 text-[13px]", cancelled ? "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink" : "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink")}>
      {cancelled ? <Ban className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleSlash2 className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="min-w-0">
        <p className="font-semibold">
          {cancelled ? "Order cancelled" : `Order short-closed · ${fmt(dropped)} pcs not released were dropped`}
          {" — "}{order.closure_reason || order.closure_reason_code} <span className="font-normal opacity-80">({order.closure_reason_code})</span>
        </p>
        <p className="opacity-90">
          {formatDateTime(order.closure_at)} by {personLabel(order.closure_by)}
          {order.closure_note ? ` · ${order.closure_note}` : ""}
          {cancelled ? " · it cannot be released or dispatched." : stillOpen ? " · job cards already released finish; the order closes once they are dispatched." : " · the order is closed."}
        </p>
      </div>
    </div>
  )
}

/** One line of the Overview table, with its colour splits and an inline colour editor. */
function LineRow({ line, jobs, lifecycleById, editable, onOpenCard, onRelease }: { line: any; jobs: any[]; lifecycleById: Map<string, JobCardLifecycle>; editable: boolean; onOpenCard: (id: string) => void; onRelease?: () => void }) {
  const [editing, setEditing] = useState(false)
  const splits: any[] = Array.isArray(line.color_splits) ? line.color_splits : []
  const made = jobs.reduce((sum, job) => sum + Number(lifecycleById.get(String(job.id))?.made_qty ?? ((cardState(job) === "COMPLETED" || cardState(job) === "FORCE_CLOSED") ? Number(job.planned_qty || 0) - Number(job.returned_qty || 0) : 0)), 0)
  const lineRate = line.rate_per_pc != null ? rateText(line.rate_per_pc) : null
  return (
    <>
      <tr data-testid={`order-line-row:${line.id}`} className="max-sm:grid max-sm:grid-cols-4 max-sm:gap-x-3 max-sm:gap-y-2.5 max-sm:border-b max-sm:border-border max-sm:px-4 max-sm:py-3 max-sm:[&>td]:!border-0 max-sm:[&>td]:!p-0 max-sm:[&>td.num]:!text-left">
        <td className={cn("num align-top font-semibold", PHONE_LABEL)} data-label="Line">{line.line_no}</td>
        <td className={cn("whitespace-nowrap align-top max-sm:col-span-3 max-sm:whitespace-normal", PHONE_LABEL)} data-label="Size">{line.size_label || line.product_code || "—"}{line.size_label && line.product_code ? <span className="block text-[11px] text-muted-foreground">{line.product_code}</span> : null}</td>
        <td className={cn("align-top max-sm:col-span-4", PHONE_LABEL)} data-label="Colour · rate">
          {line.parchment_required ? (
            splits.length ? (
              <span className="flex flex-col gap-0.5">
                {splits.map((split) => (
                  <span key={split.color} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px]">
                    <ColorChip color={split.color} />
                    <span className="tabular-nums text-muted-foreground">{fmt(split.qty)}</span>
                    <span className="whitespace-nowrap tabular-nums text-muted-foreground" title={split.rate_per_pc != null ? "Rate for this colour" : lineRate ? "The line's rate" : undefined}>{split.rate_per_pc != null ? rateText(split.rate_per_pc) : lineRate ? `${lineRate} line` : "—"}</span>
                  </span>
                ))}
                {Number(line.unassigned_color_qty || 0) > 0 ? <span className="text-[11.5px] text-signal-amber-ink">{fmt(line.unassigned_color_qty)} pcs colour not decided</span> : null}
              </span>
            ) : <span className="text-[12.5px] text-signal-amber-ink">colour not decided{lineRate ? ` · ${lineRate}` : ""}</span>
          ) : <span className="text-[12.5px]">plain{lineRate ? <span className="text-muted-foreground"> · {lineRate} / pc</span> : null}</span>}
        </td>
        {/* 640–1535 px: the four counts share one column, so the table fits the panel without scrolling sideways. */}
        <td className="num hidden whitespace-nowrap align-top sm:table-cell 2xl:hidden" data-label="Pcs">
          <span className="block font-semibold tabular-nums">{fmt(line.qty)} <small className="font-normal text-muted-foreground">ordered</small></span>
          {Number(line.short_closed_qty || 0) > 0 ? <span className="block text-[11px] text-signal-amber-ink">{fmt(line.short_closed_qty)} dropped</span> : null}
          {Number(line.hold_qty || 0) > 0 ? <span className="block text-[11px] text-signal-rose-ink">{fmt(line.hold_qty)} on hold</span> : null}
          <span className="block text-[11.5px] tabular-nums text-muted-foreground">{fmt(line.released_qty)} released</span>
          <span className="block text-[11.5px] tabular-nums text-muted-foreground">{jobs.length ? fmt(Math.max(made, Number(line.fulfilled_qty || 0))) : "—"} made</span>
          <span className="block text-[11.5px] tabular-nums text-muted-foreground">{fmt(line.fulfilled_qty)} dispatched</span>
        </td>
        <td className={cn("num align-top font-semibold max-sm:block sm:hidden 2xl:table-cell", PHONE_LABEL)} data-label="Ordered">{fmt(line.qty)}{Number(line.short_closed_qty || 0) > 0 ? <span className="block text-[11px] font-normal text-signal-amber-ink">{fmt(line.short_closed_qty)} dropped</span> : null}{Number(line.hold_qty || 0) > 0 ? <span className="block text-[11px] font-normal text-signal-rose-ink">{fmt(line.hold_qty)} on hold</span> : null}</td>
        <td className={cn("num align-top max-sm:block sm:hidden 2xl:table-cell", PHONE_LABEL)} data-label="Released">{fmt(line.released_qty)}</td>
        <td className={cn("num align-top max-sm:block sm:hidden 2xl:table-cell", PHONE_LABEL)} data-label="Made">{jobs.length ? fmt(Math.max(made, Number(line.fulfilled_qty || 0))) : "—"}</td>
        <td className={cn("num align-top max-sm:block sm:hidden 2xl:table-cell", PHONE_LABEL)} data-label="Dispatched">{fmt(line.fulfilled_qty)}</td>
        <td className={cn("align-top max-sm:col-span-4", PHONE_LABEL)} data-label="Job cards">
          {jobs.length ? (
            <span className="flex flex-col gap-1">
              {jobs.map((job) => (
                <span key={job.id} className="flex flex-wrap items-center gap-1.5">
                  <button type="button" onClick={() => onOpenCard(String(job.id))} className="inline-flex min-h-11 items-center text-left hover:text-primary sm:min-h-0"><JobCardNo job={job} /></button>
                  <LifecycleBadge state={lifecycleFromSummary(job)} />
                  <QcFlagChip runs={Number(job.qc_flagged_runs || 0)} />
                </span>
              ))}
            </span>
          ) : <span className="text-muted-foreground">—</span>}
        </td>
        {/* Release and Colours stack until 2xl, so the column stays narrow and nothing is cut at 1280. */}
        <td className="text-right align-top max-sm:col-span-4 max-sm:flex max-sm:flex-wrap max-sm:gap-2 max-sm:text-left sm:[&>button]:flex sm:[&>button]:ml-auto sm:[&>button]:min-h-9 sm:[&>button]:whitespace-nowrap 2xl:whitespace-nowrap 2xl:[&>button]:inline-flex">
          {onRelease ? <button type="button" className="text-[12px] font-semibold text-primary hover:underline max-sm:inline-flex max-sm:min-h-11 max-sm:items-center max-sm:rounded-md max-sm:bg-primary max-sm:px-3 max-sm:text-[13px] max-sm:text-primary-foreground max-sm:hover:no-underline" onClick={onRelease}>Release {fmt(line.release_remaining_qty)}</button> : null}
          {line.parchment_required && editable ? <button type="button" className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted-foreground hover:text-foreground 2xl:ml-3 max-sm:ml-0 max-sm:min-h-11 max-sm:rounded-md max-sm:border max-sm:border-border max-sm:px-3" onClick={() => setEditing((value) => !value)}><Palette className="h-3.5 w-3.5" />{editing ? "Close" : "Colours"}</button> : null}
        </td>
      </tr>
      {editing ? (
        <tr className="sub-row max-sm:block"><td colSpan={10} className="!px-4 !py-3 max-sm:block">
          {Number(line.qty || 0) > 0 && splits.length ? (
            <div className="mb-2 flex h-2.5 overflow-hidden rounded-full bg-muted">
              {splits.map((split) => <div key={split.color} className="h-full" title={`${split.color}: ${fmt(split.qty)}`} style={{ width: `${(Number(split.qty) / Number(line.qty)) * 100}%`, background: swatchFor(split.color) }} />)}
            </div>
          ) : null}
          <ColorEditor line={line} onDone={() => setEditing(false)} />
        </td></tr>
      ) : null}
    </>
  )
}

/** One job card under its line: number, state, family, plan · QC, notes and the stage stepper. */
function CardBlock({ job, jobs, lifecycle, onManage }: { job: any; jobs: any[]; lifecycle?: JobCardLifecycle; onManage: () => void }) {
  const state = cardState(job)
  const parent = job.parent_job_card_id ? jobs.find((row) => String(row.id) === String(job.parent_job_card_id)) : null
  const children = jobs.filter((row) => String(row.parent_job_card_id || "") === String(job.id))
  const family = lifecycle?.family?.filter((row) => !row.is_self) || []
  const dispatched = Number(lifecycle?.stages?.find((stage) => stage.stage === "DISPATCH")?.output_qty || 0)
  const open = state !== "COMPLETED" && state !== "FORCE_CLOSED" && state !== "CANCELLED"
  return (
    <article className="rounded-lg border border-border bg-[hsl(var(--surface-2))] px-3 py-2.5" data-testid={`sales-order:card-${job.job_card_no || job.id}`}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <Link href={`/production/job-cards/${job.id}`} className="inline-flex min-h-11 items-center hover:text-primary sm:min-h-0"><JobCardNo job={job} className="text-[15px]" /></Link>
        <LifecycleBadge state={state} />
        <span className="text-[12.5px] text-muted-foreground">{fmt(job.planned_qty)} pcs{job.target_bamboo_count ? ` · ${fmt(job.target_bamboo_count)} bamboo` : ""}{lifecycle ? ` · made ${fmt(lifecycle.made_qty)}` : ""}</span>
        {job.parchment_color ? <ColorChip color={job.parchment_color} /> : null}
        {parent ? <Chip tone="violet" size="xs" title={job.split_kind === "CARRY_FORWARD" ? "Top-up of an earlier card" : "A separate card split from its parent card"}>{job.split_kind === "CARRY_FORWARD" ? "top-up of" : "split of"} {parent.job_card_no}</Chip> : null}
        {children.length ? <Chip tone="violet" size="xs">family: {children.map((row) => row.job_card_no).join(", ")}</Chip> : family.length && !parent ? <Chip tone="violet" size="xs">family: {family.map((row) => row.job_card_no).join(", ")}</Chip> : null}
        <PlanChip job={job} />
        <QcFlagChip runs={Number(job.qc_flagged_runs || 0)} />
        <span className="ml-auto flex flex-wrap items-center justify-end gap-1">
          {open ? (
            <>
              <Link href={`/production/job-cards/${job.id}?log=output`} className="erp-btn-secondary !h-11 sm:!h-7 !px-2 !text-[12px]"><Factory className="h-3.5 w-3.5" />Log output</Link>
              <Link href={`/production/job-cards/${job.id}?log=qc`} className="erp-btn-secondary !h-11 sm:!h-7 !px-2 !text-[12px]"><ClipboardCheck className="h-3.5 w-3.5" />Log QC</Link>
            </>
          ) : null}
          <Link href={`/production/job-cards/${job.id}`} className="erp-btn-secondary !h-11 sm:!h-7 !px-2 !text-[12px]"><ExternalLink className="h-3.5 w-3.5" />Open</Link>
          <button type="button" onClick={onManage} className="erp-btn-secondary !h-11 sm:!h-7 !px-2 !text-[12px]" title="Split, edit qty / colour, force close, cancel"><Settings2 className="h-3.5 w-3.5" />Manage</button>
        </span>
      </div>
      {job.blocked_reason ? <p className="mt-2 rounded-md border border-signal-rose-line bg-signal-rose-soft px-2.5 py-1.5 text-[12.5px] text-signal-rose-ink"><PauseCircle className="mr-1 inline h-3.5 w-3.5" />{job.blocked_reason}</p> : null}
      {lifecycle?.close_reason ? <p className="mt-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-[12.5px] text-muted-foreground"><CircleSlash2 className="mr-1 inline h-3.5 w-3.5" />{state === "FORCE_CLOSED" ? "Force closed" : "Closed"} {formatDateTime(lifecycle.closed_at)} by {lifecycle.closed_by || "—"} · {lifecycle.close_reason}{Number(lifecycle.returned_qty || 0) > 0 ? ` · ${fmt(lifecycle.returned_qty)} pcs back to the order` : ""}</p> : null}
      {job.missed_slot_open ? <p className="mt-2 rounded-md border border-signal-amber-line bg-signal-amber-soft px-2.5 py-1.5 text-[12.5px] text-signal-amber-ink">Slot passed with nothing logged — back in the planner queue.</p> : null}
      <div className="mt-3">
        {lifecycle ? <OrderCardStepper lifecycle={lifecycle} dispatchedQty={dispatched} /> : <div className="flex items-center gap-2 text-[12px] text-muted-foreground"><StageDots job={job} /> loading stages…</div>}
      </div>
    </article>
  )
}

/** Every call-off of the order in date order, with whether production has covered it yet, and a date shift. */
function DeliveryPlan({ order, items, revision, loading, failed, totals }: { order: any; items: any[]; revision: number; loading: boolean; failed: boolean; totals: ReturnType<typeof orderTotals> }) {
  const { showToast } = useApp()
  const move = useMoveDeliverySchedule()
  const [shift, setShift] = useState("")
  const [shiftPreview, setShiftPreview] = useState<any>(null)
  const lineById = new Map((order.lines || []).map((line: any) => [String(line.id), line]))
  const rows = items.filter((row) => row.status !== "cancelled").sort((a, b) => String(a.delivery_date).localeCompare(String(b.delivery_date)))
  // Dispatched pcs cover a line's call-offs in date order; released pcs after that are "on cards".
  const dispatchedSoFar = new Map<string, number>()
  const releasedSoFar = new Map<string, number>()
  const covered = rows.map((row) => {
    const line: any = lineById.get(String(row.line_id))
    const before = dispatchedSoFar.get(String(row.line_id)) || 0
    const qty = Number(row.quantity || 0)
    const dispatched = Math.max(0, Math.min(qty, Number(line?.fulfilled_qty || 0) - before))
    dispatchedSoFar.set(String(row.line_id), before + qty)
    const releasedBefore = releasedSoFar.get(String(row.line_id)) || 0
    releasedSoFar.set(String(row.line_id), releasedBefore + qty)
    const released = Number(line?.released_qty || 0) + 0.001 >= releasedBefore + qty
    return { row, line, dispatched, balance: qty - dispatched, released }
  })
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
  const totalQty = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0)
  const totalDispatched = covered.reduce((sum, row) => sum + row.dispatched, 0)
  return (
    <section className="erp-panel overflow-hidden rounded-xl" data-testid="delivery-plan">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <CalendarDays className="h-4 w-4 text-primary" />
        <h2 className="text-[14px] font-semibold">Call-offs</h2>
        <span className="text-[12px] text-muted-foreground">what the customer asked for, by date · {fmt(totals.dispatched)} of {fmt(totals.ordered)} dispatched</span>
      </div>
      {loading ? <p className="px-4 py-3 text-[12.5px] text-muted-foreground">Loading…</p> : failed ? <p className="px-4 py-3 text-[12.5px] text-signal-rose-ink">Delivery schedule did not load.</p> : (
        <>
          <table className="tube-grid">
            <thead><tr><th>#</th><th>Date</th><th>Line</th><th className="num">Qty</th><th className="num">Dispatched</th><th className="num">Balance</th><th>Status</th></tr></thead>
            <tbody>
              {covered.map(({ row, line, dispatched, balance, released }, index) => {
                const late = dayjs(row.delivery_date).isBefore(dayjs(), "day") && !row.immutable && balance > 0
                return (
                  <tr key={row.id} data-testid={`delivery-schedule-row:${row.id}`}>
                    <td className="text-muted-foreground">{index + 1}</td>
                    <td className={cn("whitespace-nowrap font-semibold tabular-nums", late && "text-signal-rose-ink")}>{formatShortDate(row.delivery_date)}</td>
                    <td className="truncate text-muted-foreground">L{line?.line_no} · {line?.product_code}</td>
                    <td className="num">{fmt(row.quantity)}</td>
                    <td className="num">{fmt(dispatched)}</td>
                    <td className="num font-semibold">{fmt(balance)}</td>
                    <td>{balance <= 0 ? <Chip tone="emerald" size="xs">delivered</Chip> : row.immutable ? <Chip size="xs">{String(row.status)}</Chip> : late ? <Chip tone="rose" size="xs">late · {fmt(balance)} to send</Chip> : released ? <Chip tone="blue" size="xs">on job cards</Chip> : <Chip tone="amber" size="xs">not released</Chip>}</td>
                  </tr>
                )
              })}
              {unscheduled.map(({ line, qty }: any) => (
                <tr key={`due-${line.id}`} className="bg-[hsl(var(--surface-2))]">
                  <td className="text-muted-foreground">—</td>
                  <td className="whitespace-nowrap font-semibold tabular-nums">{line.due_date ? formatShortDate(line.due_date) : <span className="font-normal text-muted-foreground">No date</span>}</td>
                  <td className="text-muted-foreground">L{line.line_no} · no call-off yet{line.due_date ? " (line date)" : ""}</td>
                  <td className="num">{fmt(qty)}</td><td className="num">—</td><td className="num font-semibold">{fmt(qty)}</td><td><Chip size="xs">whole line due</Chip></td>
                </tr>
              ))}
              {rows.length ? <tr className="font-semibold"><td /><td>Total</td><td /><td className="num">{fmt(totalQty)}</td><td className="num">{fmt(totalDispatched)}</td><td className="num">{fmt(totalQty - totalDispatched)}</td><td /></tr> : null}
              {!rows.length && !unscheduled.length ? <tr><td colSpan={7} className="text-[12.5px] text-muted-foreground">Everything is delivered.</td></tr> : null}
            </tbody>
          </table>
          {rows.some((row) => !row.immutable) ? (
            <div className="border-t border-border px-4 py-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-0.5 text-[11px] text-muted-foreground">Shift all open call-offs by days
                  <input type="number" step="1" value={shift} onChange={(event) => { setShift(event.target.value); setShiftPreview(null) }} className="h-8 w-28 rounded-md border border-input bg-card px-2 text-[12.5px] text-foreground" />
                </label>
                <button type="button" onClick={() => void runShift(true)} disabled={!shift || move.isPending} className="erp-btn-secondary !h-11 sm:!h-8">Preview date shift</button>
                <button type="button" onClick={() => void runShift(false)} disabled={!shiftPreview?.moved?.length || move.isPending} className="erp-btn-primary !h-11 sm:!h-8">Save date shift</button>
              </div>
              {shiftPreview ? (
                <div className="mt-2 space-y-0.5 text-[12px]" data-testid="delivery-shift-preview" aria-live="polite">
                  {shiftPreview.moved.map((row: any) => <p key={row.id}>{formatShortDate(row.previous_date)} → <strong>{formatShortDate(row.delivery_date)}</strong> · {fmt(row.quantity)} pcs</p>)}
                  {shiftPreview.kept.map((row: any) => <p key={row.id} className="text-signal-amber-ink">{formatShortDate(row.delivery_date)} · {fmt(row.quantity)} pcs · preserved ({String(row.reason || "").replaceAll("_", " ")})</p>)}
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

function ColorEditor({ line, onDone }: { line: any; onDone: () => void }) {
  const { showToast } = useApp()
  const update = useUpdateLineColors()
  const { data: parchments } = useParchments()
  const options = (Array.isArray(parchments) ? parchments : []).filter((row: any) => row?.color_name && row?.id && !String(row.id).startsWith("vendor:"))
  const [rows, setRows] = useState<Array<{ key: string; color: string; color_id: string | null; qty: string; rate: string; released: number }>>(
    (Array.isArray(line.color_splits) ? line.color_splits : []).map((split: any, index: number) => ({ key: `r${index}`, color: split.color, color_id: split.color_id || null, qty: String(Math.round(Number(split.qty || 0))), rate: split.rate_per_pc == null ? "" : String(split.rate_per_pc), released: Number(split.released_qty || 0) })),
  )
  const total = rows.reduce((sum, row) => sum + Number(row.qty || 0), 0)
  const over = total > Number(line.qty || 0)
  const save = async () => {
    try {
      await update.mutateAsync({ lineId: String(line.id), colorSplits: rows.filter((row) => row.color && Number(row.qty) > 0).map((row) => ({ color: row.color, color_id: row.color_id, qty: Number(row.qty), rate_per_pc: row.rate.trim() === "" ? null : Number(row.rate) })) })
      showToast("Colours saved.", "success")
      onDone()
    } catch (error) {
      showToast(apiErrorText(error), "error")
    }
  }
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_96px_96px_32px] items-center gap-2">
          <select
            aria-label="Colour"
            value={row.color_id || row.color}
            disabled={row.released > 0}
            onChange={(event) => {
              const option = options.find((entry: any) => String(entry.id) === event.target.value)
              setRows((current) => current.map((entry) => (entry.key === row.key ? { ...entry, color_id: option ? String(option.id) : null, color: option ? String(option.display_name || option.color_name) : "" } : entry)))
            }}
            className="h-9 w-full rounded-lg border border-input bg-card px-2 text-[13px]"
          >
            {row.color && !row.color_id ? <option value={row.color}>{row.color}</option> : null}
            <option value="">Select colour</option>
            {options.map((option: any) => <option key={option.id} value={option.id}>{option.display_name || option.color_name}</option>)}
          </select>
          <input type="number" min={row.released} aria-label="Colour qty" value={row.qty} onChange={(event) => setRows((current) => current.map((entry) => (entry.key === row.key ? { ...entry, qty: event.target.value } : entry)))} className="h-9 w-full rounded-lg border border-input bg-card px-2 text-right text-[13px] tabular-nums" />
          <input type="number" min={0} step="0.01" aria-label="Colour rate per piece" title="Rate / pc of this colour. Blank = line rate." placeholder={line.rate_per_pc ? `₹${line.rate_per_pc}` : "Rate"} value={row.rate} onChange={(event) => setRows((current) => current.map((entry) => (entry.key === row.key ? { ...entry, rate: event.target.value } : entry)))} className="h-9 w-full rounded-lg border border-input bg-card px-2 text-right text-[13px] tabular-nums" />
          <button type="button" aria-label="Remove colour" disabled={row.released > 0} onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-signal-rose-soft hover:text-signal-rose-ink disabled:opacity-30">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setRows((current) => [...current, { key: `r${Date.now()}`, color: "", color_id: null, qty: "", rate: "", released: 0 }])} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline">
          <Plus className="h-3.5 w-3.5" />Add colour
        </button>
        <span className={cn("text-[12px] tabular-nums", over ? "font-semibold text-signal-rose-ink" : "text-muted-foreground")}>
          {fmt(total)} of {fmt(line.qty)} assigned{over ? " — too much" : ` · ${fmt(Number(line.qty || 0) - total)} undecided`}
        </span>
      </div>
      <p className="text-[11.5px] text-muted-foreground">A colour cannot go below what is already released in it. Released colours are locked here — force-close their job card to change them.</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="erp-btn-secondary !h-11 sm:!h-8" onClick={onDone}>Cancel</button>
        <button type="button" className="erp-btn-primary !h-11 sm:!h-8" disabled={over || update.isPending} onClick={() => void save()}>{update.isPending ? "Saving…" : "Save colours"}</button>
      </div>
    </div>
  )
}
