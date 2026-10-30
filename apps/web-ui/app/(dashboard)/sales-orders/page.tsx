"use client"

import dayjs from "dayjs"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleSlash2,
  ClipboardCheck,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Factory,
  History,
  LoaderCircle,
  PackageCheck,
  PauseCircle,
  PlayCircle,
  Plus,
  Printer,
  Search,
  Send,
  SlidersHorizontal,
  TimerReset,
  X,
} from "lucide-react"
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react"

import { RowMenu } from "@/components/common/row-menu"
import { SavedViewsSelect } from "@/components/common/saved-views-select"
import { ColorChip, JobCardNo, LifecycleBadge } from "@/components/production/lifecycle-chips"
import { CardMixChips, Chip, DueCell, FulfilmentBar, FulfilmentLegend, OrderStatusChip, PlanChip, QcFlagChip, StageDots } from "@/components/sales/order-chips"
import { OrderClosureDialog, orderClosureAction, orderPlantId } from "@/components/sales/order-closure-dialog"
import { OrderHoldDialog } from "@/components/sales/order-hold-dialog"
import { ReleaseToQueueDialog } from "@/components/sales/release-to-queue-dialog"
import { PageHeader } from "@/components/workspace/page-header"
import { QuerySwitch } from "@/components/workspace/query-state"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { useCustomers } from "@/hooks/use-master-data"
import { usePendingJobCardsByOrder, usePlanningJobCards } from "@/hooks/use-production"
import { fetchAllSalesOrders, useApproveSalesOrder, usePendingSalesOrders, useResumeSalesOrder, useSalesOrderAggregates, useSalesOrders, useSubmitSalesOrder } from "@/hooks/use-sales"
import { describeErrorDetail } from "@/lib/api-error"
import { salesOrderReferenceLabel } from "@/lib/sales-order-entry"
import { lineHasReleaseWork } from "@/lib/sales-release"
import { awaitingCustomerPo } from "@/components/sales/customer-po-dialog"
import {
  ORDER_TABS,
  STAGE_LABEL,
  cardState,
  cardSummary,
  formatShortDate,
  isOrderTab,
  kpiTileParams,
  nextAction,
  canMakeChallan,
  orderDue,
  orderStatus,
  orderTabParams,
  orderTotals,
  routeStage,
  selfApprovalRole,
  tabCount,
  waitsForAnotherApprover,
  type KpiTile,
  type OrderTabKey,
} from "@/lib/sales-order-tracker"
import { cn } from "@/lib/utils"

const fmt = (value: unknown) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })
const orders_ = (value: unknown) => `${fmt(value)} order${Number(value || 0) === 1 ? "" : "s"}`

type Filters = { origin: string; due: string; expired: boolean; date_from: string; date_to: string; sort: string }
const EMPTY_FILTERS: Filters = { origin: "", due: "", expired: false, date_from: "", date_to: "", sort: "newest" }

/** Old links (`?status=open`, `?unreleased=1`, `?due=overdue`…) land on the matching tab and tile. */
function initialFromParams(params: URLSearchParams | null): { tab: OrderTabKey; tile: KpiTile | null; filters: Filters; search: string } {
  const status = String(params?.get("status") || params?.get("tab") || "").toLowerCase()
  const tabByStatus: Record<string, OrderTabKey> = { draft: "draft", submitted: "approval", approval: "approval", approved: "ready", ready: "ready", released: "production", partially_released: "production", production: "production", partially_dispatched: "partly", partly: "partly", closed: "closed", cancelled: "cancelled", hold: "hold", all: "all" }
  let tab: OrderTabKey = isOrderTab(status) ? status : tabByStatus[status] || "all"
  let tile: KpiTile | null = null
  const due = String(params?.get("due") || params?.get("due_risk") || "").toLowerCase()
  if (status === "open") tile = "open"
  if (params?.get("unreleased") === "1") tile = "unreleased"
  if (params?.get("held") === "1") tab = "hold"
  if (due === "overdue") tile = "overdue"
  if (due === "priority") tile = "priority"
  if (params?.get("ready") === "1") tile = "ready"
  return {
    tab,
    tile,
    search: String(params?.get("search") || ""),
    filters: {
      ...EMPTY_FILTERS,
      origin: String(params?.get("origin") || params?.get("source") || "").toUpperCase(),
      due: due === "week" ? "week" : "",
      expired: params?.get("expired") === "1",
      date_from: String(params?.get("date_from") || ""),
      date_to: String(params?.get("date_to") || ""),
      sort: String(params?.get("sort") || "newest"),
    },
  }
}

const KPI_TILES: Array<{ key: KpiTile; label: string; icon: any; tone: string }> = [
  { key: "open", label: "Open pieces", icon: Factory, tone: "text-primary" },
  { key: "unreleased", label: "Not released", icon: Send, tone: "text-signal-violet-ink" },
  { key: "priority", label: "Due in 3 days", icon: TimerReset, tone: "text-signal-amber-ink" },
  { key: "overdue", label: "Overdue", icon: AlertTriangle, tone: "text-signal-rose-ink" },
  { key: "ready", label: "Ready to dispatch", icon: PackageCheck, tone: "text-signal-emerald-ink" },
  { key: "hold", label: "On hold", icon: PauseCircle, tone: "text-signal-rose-ink" },
]

export default function SalesOrdersPage() {
  const { showToast } = useApp()
  const { user, setActivePlant, activePlant } = useAuth()
  // Sales views challans only; the row's "Dispatch" action goes to the roles that can seal one.
  const canChallan = canMakeChallan(user)
  const router = useRouter()
  const searchParams = useSearchParams()
  const [initial] = useState(() => initialFromParams(searchParams))
  const [tab, setTab] = useState<OrderTabKey>(initial.tab)
  const [tile, setTile] = useState<KpiTile | null>(initial.tile)
  const [search, setSearch] = useState(initial.search)
  const [filters, setFilters] = useState<Filters>(initial.filters)
  const [filtersOpen, setFiltersOpen] = useState(() => Boolean(initial.filters.origin || initial.filters.due || initial.filters.expired || initial.filters.date_from))
  const [pageSize, setPageSize] = useState(25)
  const [pageIndex, setPageIndex] = useState(0)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set())
  const [selectedLines, setSelectedLines] = useState<Record<string, string[]>>({})
  const [releaseOrder, setReleaseOrder] = useState<any | null>(null)
  const [holdOrders, setHoldOrders] = useState<any[]>([])
  const [closureOrder, setClosureOrder] = useState<any | null>(null)
  const [busyOrder, setBusyOrder] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const approveOrder = useApproveSalesOrder()
  const submitOrder = useSubmitSalesOrder()
  const resumeOrder = useResumeSalesOrder()

  const deferredSearch = useDeferredValue(search.trim())
  const customersQuery = useCustomers()
  const customers: any[] = useMemo(() => (Array.isArray(customersQuery.data) ? customersQuery.data : []), [customersQuery.data])
  const customerById = useMemo(() => new Map<string, any>(customers.map((customer) => [String(customer.id), customer])), [customers])
  // Customer name / code live in master data: send the ids that match the text so the server can OR them in.
  const searchCustomerIds = useMemo(() => {
    const needle = deferredSearch.toLowerCase()
    if (!needle) return ""
    return customers.filter((customer) => [customer.name, customer.customer_code].some((value) => String(value || "").toLowerCase().includes(needle))).map((customer) => String(customer.id)).slice(0, 50).join(",")
  }, [customers, deferredSearch])

  const clientFiltered = tile === "ready"
  const activeFilterCount = [filters.origin, filters.due, filters.expired, filters.date_from, filters.date_to, filters.sort !== "newest"].filter(Boolean).length
  const offset = pageIndex * pageSize
  const queryParams = useMemo(() => {
    const tabParams = orderTabParams(tab)
    const tileParams = kpiTileParams(tile)
    // A KPI tile narrows whatever the tab shows; "open" only matters on All.
    if (tab !== "all") delete tileParams.status_group
    return {
      ...tabParams,
      ...tileParams,
      search: deferredSearch || undefined,
      search_customer_ids: deferredSearch && searchCustomerIds ? searchCustomerIds : undefined,
      origin: filters.origin || undefined,
      due: tileParams.due || (filters.due || undefined),
      expired: filters.expired || undefined,
      date_from: filters.date_from || undefined,
      date_to: filters.date_to || undefined,
      sort: filters.sort !== "newest" ? filters.sort : undefined,
      ...(clientFiltered ? { status_group: tab === "all" ? "open" : undefined, limit: 500, offset: 0 } : { limit: pageSize + 1, offset }),
    }
  }, [tab, tile, deferredSearch, searchCustomerIds, filters, clientFiltered, pageSize, offset])

  const ordersQuery = useSalesOrders(queryParams)
  const aggregatesQuery = useSalesOrderAggregates()
  const pendingQuery = usePendingSalesOrders({ limit: 1 })
  const byOrderQuery = usePendingJobCardsByOrder()
  const jobCardsQuery = usePlanningJobCards({ limit: 250 })

  useEffect(() => { setPageIndex(0) }, [deferredSearch, filters, pageSize, tab, tile])
  useEffect(() => { setSelectedOrders(new Set()) }, [tab, tile, deferredSearch, pageIndex])

  const jobsByOrder = useMemo(() => {
    const buckets = new Map<string, any[]>()
    for (const job of Array.isArray(jobCardsQuery.data) ? jobCardsQuery.data : []) {
      const orderId = String(job?.sales_order_id || "")
      if (!orderId) continue
      buckets.set(orderId, [...(buckets.get(orderId) || []), job])
    }
    return buckets
  }, [jobCardsQuery.data])
  const byOrderMap = useMemo(() => {
    const map = new Map<string, any>()
    for (const row of Array.isArray(byOrderQuery.data?.items) ? byOrderQuery.data.items : []) map.set(String(row.sales_order_id), row)
    return map
  }, [byOrderQuery.data])

  const serverRows: any[] = useMemo(() => (Array.isArray(ordersQuery.data) ? ordersQuery.data : []), [ordersQuery.data])
  const readyRows = useMemo(() => (clientFiltered ? serverRows.filter((order) => cardSummary(jobsByOrder.get(String(order.id)) || []).ready > 0 || Number(byOrderMap.get(String(order.id))?.dispatch_ready_job_count || 0) > 0) : serverRows), [clientFiltered, serverRows, jobsByOrder, byOrderMap])
  const hasNextPage = clientFiltered ? readyRows.length > offset + pageSize : serverRows.length > pageSize
  const orders = useMemo(() => (clientFiltered ? readyRows.slice(offset, offset + pageSize) : serverRows.slice(0, pageSize)), [clientFiltered, readyRows, serverRows, offset, pageSize])

  const aggregates: any = aggregatesQuery.data || {}
  const aggReady = Boolean(aggregatesQuery.data) && !aggregatesQuery.isError
  const counts: Record<string, number> | undefined = aggReady ? aggregates.status_counts || {} : undefined
  const pendingSummary: any = pendingQuery.data?.summary || {}
  const byOrderSummary: any = byOrderQuery.data?.summary || {}
  const dash = (ready: boolean, text: string) => (ready ? text : "—")
  const kpi: Record<KpiTile, { value: string; sub: string }> = {
    open: { value: dash(aggReady, `${fmt(aggregates.open_qty)} pcs`), sub: dash(aggReady, `${orders_(aggregates.open_order_count)} open`) },
    unreleased: { value: dash(Boolean(pendingQuery.data), `${fmt(pendingSummary.unreleased_qty)} pcs`), sub: "not yet on job cards" },
    priority: { value: dash(Boolean(pendingQuery.data), orders_(pendingSummary.due_priority_count)), sub: pendingSummary.priority_start ? `${formatShortDate(pendingSummary.priority_start)} – ${formatShortDate(pendingSummary.priority_end)}` : "next 3 plant days" },
    overdue: { value: dash(Boolean(pendingQuery.data), orders_(pendingSummary.due_overdue_count)), sub: "due before today" },
    ready: { value: dash(Boolean(byOrderQuery.data), orders_(byOrderSummary.dispatch_ready_order_count)), sub: "packed, waiting for a challan" },
    hold: { value: dash(aggReady, orders_(aggregates.held_order_count)), sub: dash(aggReady, `${fmt(aggregates.hold_qty)} pcs held`) },
  }

  const viewFilters = useMemo(() => ({ tab, tile, search: search.trim(), filters }), [tab, tile, search, filters])
  const isDefaultView = tab === "all" && !tile && !search.trim() && activeFilterCount === 0
  const applyView = (saved: Record<string, unknown>) => {
    startTransition(() => {
      setTab(isOrderTab(saved.tab) ? saved.tab : "all")
      setTile(["open", "unreleased", "priority", "overdue", "ready", "hold"].includes(String(saved.tile)) ? (saved.tile as KpiTile) : null)
      setSearch(String(saved.search || ""))
      setFilters({ ...EMPTY_FILTERS, ...((saved.filters as Partial<Filters>) || {}) })
    })
  }
  const resetView = () => { setTab("all"); setTile(null); setSearch(""); setFilters(EMPTY_FILTERS) }

  const customerLabel = (order: any) => {
    const customer = customerById.get(String(order.customer_id || ""))
    return { name: customer?.name || order.customer_name || "Customer", code: customer?.customer_code || "" }
  }
  const releasableLineIds = (order: any) =>
    (["closed", "cancelled"].includes(String(order.status || "")) || order.is_held ? [] : order.lines || [])
      .filter((line: any) => lineHasReleaseWork(line))
      .map((line: any) => String(line.id))
  const canRelease = (order: any) => ["approved", "released", "partially_released", "partially_dispatched"].includes(String(order.status || "")) && !order.is_held && releasableLineIds(order).length > 0
  const canApprove = (order: any) => ["draft", "submitted"].includes(String(order.status || ""))
  // Owner and Admin may approve an order they entered themselves (user decision 2026-10-30).
  const selfApprove = selfApprovalRole(user)
  const isMine = (order: any) => waitsForAnotherApprover(order, user?.email, selfApprove)

  const run = async (order: any, action: () => Promise<unknown>, done: string) => {
    setBusyOrder(String(order.id))
    try {
      await action()
      showToast(done, "success")
    } catch (error: any) {
      showToast(describeErrorDetail(error?.response?.data?.detail || error?.message || "The action did not go through."), "error")
    } finally {
      setBusyOrder(null)
    }
  }
  const handleApprove = (order: any) => run(order, () => approveOrder.mutateAsync({ orderId: String(order.id), plantId: orderPlantId(order) }), `${order.order_no || "Order"} approved. Next: release its lines.`)
  const handleSubmit = (order: any) => run(order, () => submitOrder.mutateAsync({ orderId: String(order.id) }), `${order.order_no || "Order"} sent for approval.`)
  const handleResume = (order: any) => run(order, () => resumeOrder.mutateAsync({ orderId: String(order.id), plantId: orderPlantId(order) }), `Customer hold lifted on ${order.order_no || "the order"}.`)
  const openRelease = (order: any) => {
    const ticked = (selectedLines[String(order.id)] || []).filter((id) => releasableLineIds(order).includes(id))
    if (!ticked.length) setSelectedLines((current) => ({ ...current, [String(order.id)]: releasableLineIds(order) }))
    setReleaseOrder(order)
  }
  const toggleExpanded = (orderId: string) => setExpanded((current) => { const next = new Set(current); if (next.has(orderId)) next.delete(orderId); else next.add(orderId); return next })
  const toggleSelected = (orderId: string, checked: boolean) => setSelectedOrders((current) => { const next = new Set(current); if (checked) next.add(orderId); else next.delete(orderId); return next })
  const updateSelectedLines = (orderId: string, lineId: string, checked: boolean) =>
    setSelectedLines((current) => { const set = new Set(current[orderId] || []); if (checked) set.add(lineId); else set.delete(lineId); return { ...current, [orderId]: Array.from(set) } })

  const selected = orders.filter((order) => selectedOrders.has(String(order.id)))
  const bulkApprove = selected.filter((order) => canApprove(order) && !isMine(order))
  const bulkSubmit = selected.filter((order) => String(order.status) === "draft")
  const bulkHold = selected.filter((order) => !order.is_held && orderTotals(order).pending > 0 && !["closed", "cancelled"].includes(String(order.status)))
  const runBulk = async (rows: any[], action: (order: any) => Promise<unknown>, label: string) => {
    let done = 0
    for (const order of rows) {
      try { await action(order); done += 1 } catch (error: any) { showToast(`${order.order_no}: ${describeErrorDetail(error?.response?.data?.detail || error?.message || "failed")}`, "error") }
    }
    if (done) showToast(`${done} order${done === 1 ? "" : "s"} ${label}.`, "success")
    setSelectedOrders(new Set())
  }

  const exportRegister = async (rowsOnly?: any[]) => {
    setExporting(true)
    let allOrders: any[] = rowsOnly || []
    let complete = true
    if (!rowsOnly) {
      try {
        const { limit: _limit, offset: _offset, ...filterParams } = queryParams as any
        const result = await fetchAllSalesOrders(filterParams)
        allOrders = clientFiltered ? result.rows.filter((order) => cardSummary(jobsByOrder.get(String(order.id)) || []).ready > 0) : result.rows
        complete = result.complete
      } catch (error: any) {
        setExporting(false)
        showToast(`Export failed: ${error?.response?.data?.detail || error?.message || "orders did not load"}. Nothing was downloaded.`, "error")
        return
      }
    }
    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Orders")
    sheet.addRow(["SO No", "Status", "Customer", "Code", "PO No", "PO Date", "Due", "Line", "Size", "Colour", "Ordered", "Released", "Made (cards done)", "Dispatched", "Pending", "Hold", "Job cards", "Flagged QC", "Expiry"])
    if (!complete) showToast("Export stopped at 10,000 orders — narrow the filters for the rest.", "error")
    for (const order of allOrders) {
      const customer = customerLabel(order)
      const cards = cardSummary(jobsByOrder.get(String(order.id)) || [])
      for (const line of order.lines || []) {
        const pendingQty = Number(line.pending_qty ?? Math.max(0, Number(line.qty || 0) - Number(line.fulfilled_qty || 0) - Number(line.hold_qty || 0)))
        sheet.addRow([
          order.order_no, orderStatus(order).label, customer.name, customer.code, awaitingCustomerPo(order) ? "Internal order - waiting for customer PO" : order.po_number || "", awaitingCustomerPo(order) ? order.internal_order_date : order.po_date, line.due_date || "No date",
          line.line_no, line.size_label || line.product_code || "", line.parchment_required ? line.parchment_color || (line.color_splits || []).map((split: any) => split.color).join(", ") : "plain",
          Number(line.qty || 0), Number(line.released_qty || 0), cards.made, Number(line.fulfilled_qty || 0), pendingQty, Number(line.hold_qty || 0), cards.total, cards.flagged, order.expiry_date || "",
        ])
      }
    }
    sheet.getRow(1).font = { bold: true }
    sheet.views = [{ state: "frozen", ySplit: 1 }]
    sheet.columns.forEach((column) => { column.width = 16 })
    sheet.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    const blob = new Blob([await workbook.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `orders-${tab}-${dayjs().format("YYYY-MM-DD")}.xlsx`
    link.click()
    URL.revokeObjectURL(url)
    setExporting(false)
  }

  const plantId = activePlant && String(activePlant).toUpperCase() !== "ALL" ? String(activePlant) : undefined
  const rangeText = ordersQuery.isFetching ? "Refreshing…" : orders.length ? `${offset + 1}–${offset + orders.length}${hasNextPage ? "+" : ""}${clientFiltered ? ` of ${readyRows.length}` : tab === "all" && !tile && !search.trim() && activeFilterCount === 0 && aggReady ? ` of ${fmt(aggregates.total_order_count)}` : ""}` : ""

  return (
    <>
      <div className="space-y-4" data-testid="sales-orders:page">
        <PageHeader
          badge="Sales · Operations"
          title="Orders"
          description="Every customer PO from draft to closed. One list for the sales desk, planners and the owner — status, fulfilment, job cards and the next action, in one row. Expand a row to see its lines and job cards."
          actions={
            <>
              <button type="button" className="erp-btn-secondary !h-11 sm:!h-9" onClick={() => window.print()}><Printer className="h-4 w-4" />Print</button>
              <button type="button" className="erp-btn-secondary !h-11 sm:!h-9" onClick={() => void exportRegister()} disabled={!orders.length || exporting}><Download className="h-4 w-4" />{exporting ? "Exporting…" : "Excel"}</button>
              <Link href="/sales-orders/new" className="erp-btn-primary !h-11 sm:!h-9" data-testid="sales-orders:new"><Plus className="h-4 w-4" />New sales order</Link>
            </>
          }
        />

        {aggregatesQuery.isError ? <p role="alert" className="text-[13px] text-signal-rose-ink">Order summary did not load — the figures show “—” instead of zero. <button type="button" className="font-semibold underline" onClick={() => aggregatesQuery.refetch()}>Try again</button></p> : null}

        <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6" aria-label="Order summary" data-testid="sales-orders:kpis">
          {KPI_TILES.map((item) => {
            const Icon = item.icon
            const active = tile === item.key
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                data-testid={`sales-orders:kpi-${item.key}`}
                onClick={() => setTile(active ? null : item.key)}
                className={cn("tube-kpi erp-metric-card text-left transition-colors", active && "!border-primary ring-2 ring-primary/20")}
              >
                <p className="tube-kpi-label flex items-center gap-1.5"><Icon className={cn("h-3.5 w-3.5", item.tone)} aria-hidden="true" />{item.label}</p>
                <p className="tube-kpi-value !text-[20px] sm:!text-[22px]">{kpi[item.key].value}</p>
                <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{kpi[item.key].sub}</p>
              </button>
            )
          })}
        </section>

        <section className="erp-panel min-w-0 overflow-hidden rounded-xl" aria-label="Orders list">
          {/* Phone: one 44 px status picker instead of a strip of tabs that scrolls sideways. */}
          <label className="flex items-center gap-2 border-b border-border px-3 py-2 sm:hidden">
            <span className="shrink-0 text-[12px] font-semibold text-muted-foreground">Status</span>
            <select value={tab} onChange={(event) => setTab(event.target.value as typeof tab)} className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-card px-2.5 text-sm font-medium" data-testid="sales-orders:tab-select">
              {ORDER_TABS.map((item) => {
                const count = tabCount(counts, item.key)
                return <option key={item.key} value={item.key}>{item.label}{count === null ? "" : ` (${count})`}</option>
              })}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-x-1 border-b border-border px-2 pt-1 max-sm:hidden" role="tablist" aria-label="Order status">
            {ORDER_TABS.map((item) => {
              const count = tabCount(counts, item.key)
              const active = tab === item.key
              return (
                <button key={item.key} type="button" role="tab" aria-selected={active} data-testid={`sales-orders:tab-${item.key}`} onClick={() => setTab(item.key)} className={cn("-mb-px inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 text-[13px] font-medium transition-colors", active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                  {item.label}
                  <span className={cn("rounded px-1.5 text-[11px] font-semibold tabular-nums", active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{count === null ? "—" : count}</span>
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 max-sm:[&>label]:!h-11">
            <label className="flex h-9 min-w-0 basis-full flex-1 sm:min-w-[220px] sm:basis-auto items-center gap-2 rounded-lg border border-border bg-card px-2.5 sm:max-w-[380px] focus-within:border-ring/70 focus-within:ring-[3px] focus-within:ring-ring/15">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">Search orders</span>
              <input value={search} onChange={(event) => { const next = event.target.value; startTransition(() => setSearch(next)) }} placeholder="Search SO no, PO, customer or code, product, colour" className="h-full min-w-0 flex-1 border-0 bg-transparent text-[13px] shadow-none outline-none focus:shadow-none" data-testid="sales-orders:search" />
              {search ? <button type="button" aria-label="Clear search" onClick={() => setSearch("")} className="grid h-11 w-11 shrink-0 place-items-center text-muted-foreground hover:text-foreground sm:h-7 sm:w-7"><X className="h-3.5 w-3.5" /></button> : null}
            </label>
            <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)} className={cn("erp-btn-secondary !h-11 sm:!h-9", activeFilterCount && "!border-primary/40 !text-primary")}>
              <SlidersHorizontal className="h-4 w-4" />Filters{activeFilterCount ? <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{activeFilterCount}</span> : null}
            </button>
            <SavedViewsSelect viewKey="ORDERS" plantId={plantId} filters={viewFilters} isDefault={isDefaultView} defaultLabel="All orders" onApply={applyView} onReset={resetView} testId="sales-orders:views" />
            {tile ? <Chip tone="blue" className="!h-11 sm:!h-9 !rounded-lg !px-2.5 !text-[12.5px]">{KPI_TILES.find((item) => item.key === tile)?.label}<button type="button" aria-label="Clear tile filter" onClick={() => setTile(null)} className="-my-1 ml-1 grid h-11 w-9 place-items-center opacity-70 hover:opacity-100 sm:h-6 sm:w-6"><X className="h-3 w-3" /></button></Chip> : null}
            <span className="ml-auto text-xs tabular-nums text-muted-foreground" aria-live="polite">{rangeText}</span>
          </div>

          {filtersOpen ? (
            <div className="grid gap-3 border-b border-border bg-[hsl(var(--surface-2))] px-3 py-3 animate-enter-up max-sm:[&_button]:min-h-11 max-sm:[&_input]:!h-11 max-sm:[&_select]:!h-11 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]" aria-label="More filters">
              <label className="space-y-1">
                <span className="text-[12px] font-medium text-muted-foreground">Source</span>
                <select value={filters.origin} onChange={(event) => setFilters((current) => ({ ...current, origin: event.target.value }))} className="h-9 w-full rounded-lg border border-input bg-card px-2.5 text-[13px]">
                  <option value="">Customer PO + internal</option>
                  <option value="CUSTOMER_PO">Customer PO</option>
                  <option value="INTERNAL">Internal order</option>
                </select>
              </label>
              <div className="space-y-1">
                <span className="text-[12px] font-medium text-muted-foreground">Delivery</span>
                <div className="tube-segment w-full" role="group" aria-label="Delivery filter">
                  {([["", "Any"], ["overdue", "Overdue"], ["priority", "3 days"], ["week", "7 days"]] as const).map(([value, label]) => (
                    <button key={value || "any"} type="button" className="flex-1 justify-center" aria-pressed={filters.due === value} onClick={() => setFilters((current) => ({ ...current, due: value }))}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-[12px] font-medium text-muted-foreground">PO / order date</span>
                <div className="flex items-center gap-1.5">
                  <input type="date" aria-label="From date" value={filters.date_from} onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value }))} className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-card px-2 text-[13px]" />
                  <span className="text-muted-foreground">–</span>
                  <input type="date" aria-label="To date" value={filters.date_to} onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value }))} className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-card px-2 text-[13px]" />
                </div>
              </div>
              <label className="space-y-1">
                <span className="text-[12px] font-medium text-muted-foreground">Sort</span>
                <select value={filters.sort} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value }))} className="h-9 w-full rounded-lg border border-input bg-card px-2.5 text-[13px]">
                  <option value="newest">Newest first</option>
                  <option value="due">Earliest delivery first</option>
                  <option value="po_date">PO date (latest)</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <button type="button" aria-pressed={filters.expired} onClick={() => setFilters((current) => ({ ...current, expired: !current.expired }))} className={cn("h-9 rounded-full border px-3 text-[12.5px] font-medium transition-colors", filters.expired ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground")}>PO validity expired</button>
                {activeFilterCount ? <button type="button" className="h-9 px-2 text-[12.5px] font-semibold text-primary hover:underline" onClick={() => setFilters(EMPTY_FILTERS)}>Clear</button> : null}
              </div>
            </div>
          ) : null}

          {selected.length ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-primary/30 bg-primary/[.06] px-3 py-2 text-[12.5px]" data-testid="sales-orders:bulk" aria-live="polite">
              <strong>{selected.length} selected</strong>
              <button type="button" className="erp-btn-secondary !h-11 sm:!h-8" disabled={!bulkApprove.length || approveOrder.isPending} onClick={() => void runBulk(bulkApprove, (order) => approveOrder.mutateAsync({ orderId: String(order.id), plantId: orderPlantId(order) }), "approved")}><CheckCircle2 className="h-3.5 w-3.5" />Approve{bulkApprove.length ? ` ${bulkApprove.length}` : ""}</button>
              <button type="button" className="erp-btn-secondary !h-11 sm:!h-8" disabled={!bulkSubmit.length || submitOrder.isPending} onClick={() => void runBulk(bulkSubmit, (order) => submitOrder.mutateAsync({ orderId: String(order.id) }), "sent for approval")}><Send className="h-3.5 w-3.5" />Send for approval{bulkSubmit.length ? ` ${bulkSubmit.length}` : ""}</button>
              <button type="button" className="erp-btn-secondary !h-11 sm:!h-8 !text-signal-amber-ink" disabled={!bulkHold.length} onClick={() => setHoldOrders(bulkHold)}><PauseCircle className="h-3.5 w-3.5" />Hold…{bulkHold.length ? ` ${bulkHold.length}` : ""}</button>
              <button type="button" className="erp-btn-secondary !h-11 sm:!h-8" disabled={exporting} onClick={() => void exportRegister(selected)}><Download className="h-3.5 w-3.5" />Excel</button>
              <button type="button" className="ml-auto min-h-11 px-2 text-[12.5px] font-semibold text-primary hover:underline sm:min-h-8" onClick={() => setSelectedOrders(new Set())}>Clear</button>
            </div>
          ) : null}

          {ordersQuery.isLoading || ordersQuery.isError || orders.length === 0 ? (
            <div className="p-3">
              <QuerySwitch
                isLoading={ordersQuery.isLoading}
                isError={ordersQuery.isError}
                isEmpty={orders.length === 0}
                loadingLabel="Loading orders…"
                emptyTitle={tile ? `No order matches “${KPI_TILES.find((item) => item.key === tile)?.label}” here.` : "No orders in this tab yet."}
                emptyMessage={tile ? "Clear the tile or pick another tab." : search ? "Try another search — SO no, PO, customer, code, product or colour." : "Pick another tab or create a new sales order."}
                errorMessage="Orders could not be loaded. This is not an empty list — refresh to retry."
                onRetry={() => { void ordersQuery.refetch() }}
              >
                {null}
              </QuerySwitch>
            </div>
          ) : (
            <div className="tube-print-expand max-h-[calc(100dvh-300px)] min-h-[320px] overflow-auto max-sm:max-h-none max-sm:min-h-0 max-sm:overflow-visible">
              {/* Phone (< 640 px): every order is a card — the same cells, stacked; nothing scrolls sideways. */}
              <table className="tube-grid max-sm:block" data-testid="sales-orders:register">
                <thead className="max-sm:hidden">
                  <tr>
                    <th className="w-[60px] !pr-0"><span className="sr-only">Select and expand</span></th>
                    <th>Order</th>
                    <th className="hidden xl:table-cell">Customer</th>
                    <th className="hidden 2xl:table-cell">PO</th>
                    <th>Due</th>
                    <th className="hidden 2xl:table-cell">Fulfilment</th>
                    <th className="hidden 2xl:table-cell">Job cards</th>
                    <th>Status</th>
                    <th className="w-[1%] whitespace-nowrap text-right">Next action</th>
                  </tr>
                </thead>
                {orders.map((order: any) => {
                  const orderId = String(order.id)
                  const lines: any[] = order.lines || []
                  const jobs = jobsByOrder.get(orderId) || []
                  const overlay = byOrderMap.get(orderId)
                  const cards = cardSummary(jobs)
                  const cardTotal = Math.max(cards.total, Number(overlay?.job_count || 0))
                  const totals = orderTotals(order)
                  const due = orderDue(order)
                  const action = nextAction(order, cards, user?.email, canChallan, selfApprove)
                  const customer = customerLabel(order)
                  const closure = orderClosureAction(order)
                  const isOpen = expanded.has(orderId)
                  const isSelected = selectedOrders.has(orderId)
                  const busy = busyOrder === orderId
                  const colours = Array.from(new Set(lines.flatMap((line) => (line.parchment_required ? (line.color_splits?.length ? line.color_splits.map((split: any) => String(split.color)) : [line.parchment_color || "colour not decided"]) : ["plain"]))))
                  const ticked = (selectedLines[orderId] || []).filter((id) => releasableLineIds(order).includes(id))
                  const actionButton = (() => {
                    const base = cn("inline-flex h-11 items-center gap-1 whitespace-nowrap rounded-md px-3 sm:h-8 sm:px-2.5 text-[12.5px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50", action.tone === "primary" ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90" : action.tone === "secondary" ? "border border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink hover:brightness-[.97]" : "border border-border bg-card text-foreground hover:bg-muted")
                    const testId = `sales-orders:next-${action.key}`
                    if (action.key === "open") return <Link href={`/sales-orders/${orderId}`} className={base} data-testid={testId}>{action.label}</Link>
                    if (action.href) return <Link href={action.href} className={base} title={action.hint} data-testid={testId}>{action.label}</Link>
                    if (action.key === "waiting") return <span className={cn(base, "cursor-default opacity-70")} title={action.hint} data-testid={testId}>{action.label}</span>
                    const onClick = action.key === "approve" ? () => void handleApprove(order) : action.key === "submit" ? () => void handleSubmit(order) : action.key === "resume" ? () => void handleResume(order) : () => openRelease(order)
                    return (
                      <button type="button" className={base} title={action.hint} onClick={onClick} disabled={busy} data-testid={testId}>
                        {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : action.key === "release" ? <Send className="h-3.5 w-3.5" /> : action.key === "approve" ? <CheckCircle2 className="h-3.5 w-3.5" /> : action.key === "resume" ? <PlayCircle className="h-3.5 w-3.5" /> : null}
                        {action.label}{action.key === "release" && ticked.length && ticked.length < releasableLineIds(order).length ? <span className="rounded bg-primary-foreground/20 px-1 text-[11px] tabular-nums">{ticked.length} line{ticked.length === 1 ? "" : "s"}</span> : null}
                      </button>
                    )
                  })()
                  return (
                    <tbody key={orderId} data-order-id={orderId} className="group/order max-sm:block max-sm:border-b max-sm:border-border">
                      <tr data-state={isSelected ? "selected" : undefined} data-expanded={isOpen || undefined} className="max-sm:grid max-sm:grid-cols-[44px_minmax(0,1fr)] max-sm:gap-x-2 max-sm:gap-y-2 max-sm:px-2 max-sm:py-2.5 max-sm:[&>td]:!border-0 max-sm:[&>td]:!p-0">
                        <td className="!pr-0 align-top max-sm:row-span-4">
                          <div className="flex items-center gap-0.5 pt-0.5 max-sm:flex-col max-sm:pt-0">
                            <label className="grid cursor-pointer place-items-center max-sm:h-11 max-sm:w-11">
                              <input type="checkbox" aria-label={`Select ${salesOrderReferenceLabel(order)}`} checked={isSelected} onChange={(event) => toggleSelected(orderId, event.target.checked)} className="h-3.5 w-3.5 cursor-pointer max-sm:h-5 max-sm:w-5" />
                            </label>
                            <button type="button" onClick={() => toggleExpanded(orderId)} aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} ${lines.length} line${lines.length === 1 ? "" : "s"} and job cards`} data-testid="sales-orders:expand" className="grid h-11 w-11 sm:h-7 sm:w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-foreground/[.06] hover:text-foreground">
                              <ChevronRight className={cn("h-4 w-4 transition-transform duration-200", isOpen && "rotate-90")} />
                            </button>
                          </div>
                        </td>
                        <td className="max-w-[240px] align-top max-sm:col-start-2 max-sm:max-w-none xl:max-w-[170px]">
                          <Link href={`/sales-orders/${orderId}`} data-testid="sales-orders:detail-link" className="font-semibold text-foreground transition-colors hover:text-primary max-sm:inline-flex max-sm:min-h-11 max-sm:items-center max-sm:text-[15px]">{order.order_no || orderId.slice(0, 8)}</Link>
                          <span className="block truncate text-[11.5px] text-muted-foreground" title={colours.join(", ")}>{lines.length} line{lines.length === 1 ? "" : "s"} · {colours.join(", ")}</span>
                          <span className="block truncate text-[11.5px] text-muted-foreground xl:hidden" title={`${customer.name}${customer.code ? ` · ${customer.code}` : ""}`}>{customer.name}{customer.code ? ` · ${customer.code}` : ""}</span>
                          {awaitingCustomerPo(order) ? <span className="block text-[11.5px] leading-snug text-signal-amber-ink xl:hidden">Internal order · waiting for customer PO</span> : null}
                          {/* Narrow screens: the fulfilment bar sits under the order number instead of its own column. */}
                          <FulfilmentBar ordered={totals.ordered} released={totals.released} made={cards.made} dispatched={totals.dispatched} compact madeUnknown={jobCardsQuery.isError} className="mt-1.5 max-w-[230px] max-sm:max-w-none 2xl:hidden" />
                        </td>
                        <td className="hidden max-w-[190px] align-top xl:table-cell">
                          <span className="block truncate font-medium text-foreground/90" title={customer.name}>{customer.name}</span>
                          <span className="block truncate text-[11.5px] text-muted-foreground" title={customer.code || undefined}>{customer.code || "—"}</span>
                          {/* Below 2xl the PO number and date are their own line, never cut: Sales looks orders up by the PO. */}
                          <span className="block break-words text-[11.5px] leading-snug text-muted-foreground 2xl:hidden" data-testid="sales-orders:customer-po">{awaitingCustomerPo(order) ? formatShortDate(order.internal_order_date) : <>{order.po_number || "PO —"} · <span className="whitespace-nowrap">{formatShortDate(order.po_date)}</span></>}</span>
                          {/* The client's label is never cut: it wraps on its own line until the PO column shows (2xl). */}
                          {awaitingCustomerPo(order) ? <span className="mt-0.5 block text-[11.5px] leading-snug text-signal-amber-ink 2xl:hidden">Internal order · waiting for customer PO</span> : null}
                        </td>
                        <td className="hidden max-w-[150px] align-top 2xl:table-cell">
                          <span className="block truncate text-foreground/90" title={awaitingCustomerPo(order) ? "Internal order · waiting for customer PO" : order.po_number || undefined}>{awaitingCustomerPo(order) ? <span className="text-signal-amber-ink" data-testid="sales-orders:awaiting-po">Internal order · waiting for customer PO</span> : order.po_number || "—"}</span>
                          <span className="block text-[11.5px] tabular-nums text-muted-foreground">{formatShortDate(awaitingCustomerPo(order) ? order.internal_order_date : order.po_date)}</span>
                        </td>
                        <td className="whitespace-nowrap align-top max-sm:col-start-2 max-sm:flex max-sm:items-center max-sm:gap-2 max-sm:[&>span:last-child]:flex-row max-sm:[&>span:last-child]:items-center max-sm:[&>span:last-child]:gap-1.5"><span className="text-[12px] text-muted-foreground sm:hidden">Delivery</span><DueCell due={due} /></td>
                        <td className="hidden align-top 2xl:table-cell"><FulfilmentBar ordered={totals.ordered} released={totals.released} made={cards.made} dispatched={totals.dispatched} compact madeUnknown={jobCardsQuery.isError} /></td>
                        <td className="hidden align-top 2xl:table-cell">
                          {cardTotal ? (
                            <div className="space-y-1">
                              <span className="text-[13px] font-semibold tabular-nums">{cardTotal}</span>
                              {cards.total ? <CardMixChips chips={cards.chips} flagged={cards.flagged} /> : <span className="block text-[11px] text-muted-foreground">{overlay?.flow_status || "cards"}</span>}
                            </div>
                          ) : <span className="text-[12px] text-muted-foreground">{String(order.status) === "approved" ? "release to create" : "none yet"}</span>}
                        </td>
                        <td className="max-w-[150px] align-top max-sm:col-start-2 max-sm:max-w-none">
                          <OrderStatusChip order={order} />
                          {cardTotal ? <span className="mt-1 block text-[11px] text-muted-foreground 2xl:hidden">{cardTotal} card{cardTotal === 1 ? "" : "s"}{cards.flagged ? ` · ${cards.flagged} flagged QC` : ""}{cards.ready ? ` · ${cards.ready} ready` : ""}</span> : null}
                          {order.is_held ? <span className="mt-1 block truncate text-[11px] text-muted-foreground" title={`${order.hold_reason || ""}${order.hold_reason_code ? ` (${order.hold_reason_code})` : ""}`}>since {formatShortDate(order.held_at)}{order.hold_reason ? ` · ${order.hold_reason}` : ""}</span> : null}
                          {order.closure_kind ? <span className="mt-1 block truncate text-[11px] text-muted-foreground" title={`${order.closure_reason || ""}${order.closure_reason_code ? ` (${order.closure_reason_code})` : ""}`}>{formatShortDate(order.closure_at)} · {order.closure_reason || order.closure_reason_code}</span> : null}
                        </td>
                        <td className="w-[1%] whitespace-nowrap align-top max-sm:col-start-2 max-sm:w-auto">
                          <div className="flex items-center justify-end gap-1 max-sm:justify-start max-sm:[&_button[aria-haspopup=menu]]:h-11 max-sm:[&_button[aria-haspopup=menu]]:w-11">
                            {actionButton}
                            <RowMenu
                              items={[
                                { label: "Open order", href: `/sales-orders/${orderId}`, icon: Eye, testId: "sales-orders:view-link" },
                                { label: "History", href: `/sales-orders/${orderId}?tab=history`, icon: History },
                                { label: "Print", href: `/sales-orders/${orderId}?print=1`, icon: Printer },
                                { label: "Copy as new order", href: `/sales-orders/new?copy=${orderId}`, icon: Copy },
                                ...(canApprove(order) && action.key !== "approve" && !isMine(order) ? [{ label: "Approve", icon: CheckCircle2, onSelect: () => void handleApprove(order) }] : []),
                                ...(canRelease(order) && action.key !== "release" ? [{ label: "Release lines…", icon: Send, onSelect: () => openRelease(order) }] : []),
                                ...(order.is_held
                                  ? [{ label: "Resume (lift hold)", icon: PlayCircle, onSelect: () => void handleResume(order) }]
                                  : totals.pending > 0 && !["closed", "cancelled"].includes(String(order.status))
                                    ? [{ label: "Customer hold & close…", icon: PauseCircle, tone: "warn" as const, testId: "sales-orders:hold", onSelect: () => setHoldOrders([order]) }]
                                    : []),
                                ...(closure.kind === "cancel"
                                  ? [{ label: "Cancel order…", icon: Ban, tone: "danger" as const, testId: "sales-orders:cancel", onSelect: () => setClosureOrder(order) }]
                                  : closure.kind === "short_close"
                                    ? [{ label: "Short close balance…", icon: CircleSlash2, tone: "warn" as const, testId: "sales-orders:short-close", onSelect: () => setClosureOrder(order) }]
                                    : []),
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="sub-row max-sm:block">
                          <td colSpan={9} className="!p-0 max-sm:block">
                            <OrderLinesExpansion
                              order={order}
                              jobs={jobs}
                              overlay={overlay}
                              jobsFailed={jobCardsQuery.isError}
                              releasable={releasableLineIds(order)}
                              selectedLineIds={ticked}
                              onToggleLine={(lineId, checked) => updateSelectedLines(orderId, lineId, checked)}
                              onRelease={canRelease(order) ? () => openRelease(order) : undefined}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  )
                })}
              </table>
            </div>
          )}
          {orders.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Rows
                <select aria-label="Rows per page" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="h-11 rounded-md border border-border bg-card px-2 text-xs text-foreground sm:h-8">
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
              <FulfilmentLegend className="hidden md:flex" />
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums text-muted-foreground">Page {pageIndex + 1}</span>
                <button type="button" onClick={() => setPageIndex((current) => Math.max(0, current - 1))} disabled={pageIndex === 0 || ordersQuery.isFetching} aria-label="Previous page" className="grid h-11 w-11 sm:h-8 sm:w-8 place-items-center rounded-md border border-border bg-card text-muted-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" onClick={() => setPageIndex((current) => current + 1)} disabled={!hasNextPage || ordersQuery.isFetching} aria-label="Next page" className="grid h-11 w-11 sm:h-8 sm:w-8 place-items-center rounded-md border border-border bg-card text-muted-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <OrderHoldDialog orders={holdOrders} open={holdOrders.length > 0} onOpenChange={(open) => { if (!open) setHoldOrders([]) }} />
      <OrderClosureDialog order={closureOrder} open={Boolean(closureOrder)} onOpenChange={(open) => { if (!open) setClosureOrder(null) }} />
      <ReleaseToQueueDialog
        order={releaseOrder}
        selectedLineIds={releaseOrder ? (selectedLines[String(releaseOrder.id)] || []).filter((id) => releasableLineIds(releaseOrder).includes(id)) : []}
        open={Boolean(releaseOrder)}
        onOpenChange={(open) => { if (!open) setReleaseOrder(null) }}
        testIdPrefix="sales-orders"
        onReleased={() => {
          if (!releaseOrder) return
          // Keep the plant scope on the order's plant (same id, case-insensitive, is left alone).
          const releasedPlantId = orderPlantId(releaseOrder)
          if (releasedPlantId && String(activePlant || "").toLowerCase() !== releasedPlantId.toLowerCase()) setActivePlant(releasedPlantId.toLowerCase())
          setSelectedLines((current) => ({ ...current, [String(releaseOrder.id)]: [] }))
          setExpanded((current) => new Set(current).add(String(releaseOrder.id)))
          router.refresh()
        }}
      />
    </>
  )
}

/** Lines → job cards under an expanded order row: card no, stages, state, plan · QC, quick links. */
function OrderLinesExpansion({ order, jobs, overlay, jobsFailed, releasable, selectedLineIds, onToggleLine, onRelease }: {
  order: any
  jobs: any[]
  overlay?: any
  jobsFailed: boolean
  releasable: string[]
  selectedLineIds: string[]
  onToggleLine: (lineId: string, checked: boolean) => void
  onRelease?: () => void
}) {
  const lines: any[] = order.lines || []
  const status = String(order.status || "")
  const missing = Math.max(0, Number(overlay?.job_count || 0) - jobs.length)
  return (
    // width 0 + min-width 100%: the inner table scrolls on its own and never widens the orders table.
    <div className="overflow-x-auto bg-[hsl(var(--surface-sunken))] px-3 py-2.5 pl-10 animate-fade-in max-sm:overflow-visible max-sm:pl-3" style={{ width: 0, minWidth: "100%" }} data-testid={`sales-orders:lines-${order.id}`}>
      <table className="tube-grid w-full min-w-[620px] !text-[12.5px] max-sm:block max-sm:min-w-0 max-sm:[&_tbody]:block max-sm:[&_td]:!border-0 max-sm:[&_td]:!p-0 max-sm:[&_tr]:flex max-sm:[&_tr]:flex-wrap max-sm:[&_tr]:items-start max-sm:[&_tr]:gap-x-3 max-sm:[&_tr]:gap-y-1.5 max-sm:[&_tr]:py-2">
        <thead className="max-sm:hidden">
          <tr>
            <th className="!bg-transparent">Job card</th>
            <th className="!bg-transparent">Stages <span className="font-normal normal-case text-muted-foreground">W · O · P · D</span></th>
            <th className="!bg-transparent">State</th>
            <th className="!bg-transparent">Plan · QC</th>
            <th className="!bg-transparent text-right"><span className="sr-only">Quick links</span></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line: any) => {
            const lineJobs = jobs.filter((job) => String(job.sales_order_line_id || "") === String(line.id)).sort((a, b) => String(a.job_card_no || "").localeCompare(String(b.job_card_no || "")))
            const released = Number(line.released_qty || 0)
            const lineReleasable = releasable.includes(String(line.id))
            const colour = line.parchment_required ? (line.color_splits?.length ? line.color_splits.map((split: any) => `${split.color} ${fmt(split.qty)}`).join(", ") : line.parchment_color || "colour not decided") : "plain"
            // One slim strip per line: what was ordered; its job cards follow underneath.
            const lineHead = (
              <tr key={`${line.id}:head`} className="[&>td]:!border-b-0 [&>td]:!pb-0.5 [&>td]:!pt-2">
                <td colSpan={5} className="max-sm:w-full">
                  <label className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] max-sm:min-h-11">
                    {lineReleasable ? <input type="checkbox" aria-label={`Select line ${line.line_no} to release`} checked={selectedLineIds.includes(String(line.id))} onChange={(event) => onToggleLine(String(line.id), event.target.checked)} className="h-3.5 w-3.5 cursor-pointer max-sm:h-5 max-sm:w-5" /> : null}
                    <strong className="text-foreground">Line {line.line_no}</strong>
                    <span className="whitespace-nowrap text-foreground/85">{line.size_label || line.product_code || "—"}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="max-w-[260px] truncate text-muted-foreground" title={colour}>{colour}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="whitespace-nowrap tabular-nums"><strong>{fmt(line.qty)}</strong> pcs <span className="text-muted-foreground">{released ? `(${fmt(released)} released${Number(line.short_closed_qty || 0) > 0 ? `, ${fmt(line.short_closed_qty)} dropped` : ""})` : "(not released)"}</span></span>
                    {line.due_date ? <span className="whitespace-nowrap text-muted-foreground">· due {formatShortDate(line.due_date)}</span> : null}
                  </label>
                </td>
              </tr>
            )
            if (!lineJobs.length) {
              return [
                lineHead,
                <tr key={line.id}>
                  <td colSpan={5} className="text-muted-foreground max-sm:w-full">
                    {jobsFailed ? "Job cards did not load." : released > 0 ? "Job card not in the latest 250 cards — open the order to see it." : status === "approved" ? "No job card yet — release this line to create one." : ["draft", "submitted"].includes(status) ? "No job card yet — waiting for approval." : "No job card yet."}
                  </td>
                </tr>,
              ]
            }
            return [lineHead, ...lineJobs.map((job) => {
              const state = cardState(job)
              const parentNo = job.parent_job_card_id ? jobs.find((row) => String(row.id) === String(job.parent_job_card_id))?.job_card_no : null
              return (
                <tr key={job.id} data-testid={`sales-orders:card-${job.job_card_no || job.id}`}>
                  <td className="align-top">
                    <Link href={`/production/job-cards/${job.id}`} className="hover:text-primary max-sm:inline-flex max-sm:min-h-11 max-sm:items-center"><JobCardNo job={job} /></Link>
                    <span className="block text-[11px] text-muted-foreground">{fmt(job.planned_qty)} pcs{job.target_bamboo_count ? ` · ${fmt(job.target_bamboo_count)} bamboo` : ""}{job.parchment_color ? <> · <ColorChip color={job.parchment_color} className="!text-[11px]" /></> : ""}{parentNo ? ` · ${job.split_kind === "CARRY_FORWARD" ? "top-up of" : "split of"} ${parentNo}` : ""}</span>
                  </td>
                  <td className="align-top"><StageDots job={job} /></td>
                  <td className="whitespace-nowrap align-top"><LifecycleBadge state={state} /><span className="ml-1.5 text-[11.5px] text-muted-foreground">{job.current_stage && String(job.current_stage).toUpperCase() !== "DONE" ? STAGE_LABEL[routeStage(job.current_stage)] || String(job.current_stage) : ""}</span></td>
                  <td className="align-top"><span className="flex flex-col items-start gap-1"><PlanChip job={job} /><QcFlagChip runs={Number(job.qc_flagged_runs || 0)} /></span></td>
                  <td className="whitespace-nowrap text-right align-top max-sm:ml-auto">
                    <span className="inline-flex items-center gap-1">
                      {state !== "COMPLETED" && state !== "FORCE_CLOSED" && state !== "CANCELLED" ? (
                        <>
                          <Link href={`/production/job-cards/${job.id}?log=output`} title="Log output" aria-label={`Log output on ${job.job_card_no}`} className="grid h-11 w-11 place-items-center rounded-md text-muted-foreground hover:bg-foreground/[.06] hover:text-foreground sm:h-7 sm:w-7"><Factory className="h-3.5 w-3.5" /></Link>
                          <Link href={`/production/job-cards/${job.id}?log=qc`} title="Log QC" aria-label={`Log QC on ${job.job_card_no}`} className="grid h-11 w-11 place-items-center rounded-md text-muted-foreground hover:bg-foreground/[.06] hover:text-foreground sm:h-7 sm:w-7"><ClipboardCheck className="h-3.5 w-3.5" /></Link>
                        </>
                      ) : null}
                      <Link href={`/production/job-cards/${job.id}`} title="Open card" aria-label={`Open card ${job.job_card_no}`} className="grid h-11 w-11 place-items-center rounded-md text-muted-foreground hover:bg-foreground/[.06] hover:text-foreground sm:h-7 sm:w-7"><ExternalLink className="h-3.5 w-3.5" /></Link>
                    </span>
                  </td>
                </tr>
              )
            })]
          })}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        <span>
          {order.is_held ? `On customer hold since ${formatShortDate(order.held_at)}${order.hold_reason ? ` — ${order.hold_reason}` : ""}.`
            : onRelease ? (selectedLineIds.length ? `${selectedLineIds.length} line${selectedLineIds.length === 1 ? "" : "s"} ticked. Release makes one job card per line and colour and puts it in the winder queue.` : "Tick the lines production needs now, or release everything open. A PO can release many times over its life.")
            : ["draft", "submitted"].includes(status) ? "Approve this order to release its lines to planning." : "Open the order for deliveries and the full history."}
          {missing ? ` ${missing} older card${missing === 1 ? "" : "s"} not shown here.` : ""}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {onRelease ? <button type="button" className="erp-btn-primary !h-11 sm:!h-8" onClick={onRelease} data-testid="sales-orders:release-lines"><Send className="h-3.5 w-3.5" />Release lines…</button> : null}
          <Link href={`/sales-orders/${order.id}`} className="erp-btn-secondary !h-11 sm:!h-8"><ExternalLink className="h-3.5 w-3.5" />Open order</Link>
        </span>
      </div>
    </div>
  )
}
