"use client"

import dayjs from "dayjs"
import Link from "next/link"
import {
  ArrowRightLeft,
  CheckCircle2,
  ChevronLeft,
  Download,
  Printer,
  ChevronRight,
  ClipboardCheck,
  Eye,
  Factory,
  History,
  PauseCircle,
  PlayCircle,
  TimerOff,
  LoaderCircle,
  Plus,
  Search,
  SlidersHorizontal,
  Send,
} from "lucide-react"
import { useSearchParams } from "next/navigation"
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react"

import {
  MetricCard,
  MetricRail,
  StatusBadge,
} from "@/components/erp/shell"
import { PageHeader } from "@/components/workspace/page-header"
import { ReleaseToQueueDialog } from "@/components/sales/release-to-queue-dialog"
import { RowMenu } from "@/components/common/row-menu"
import { QuerySwitch } from "@/components/workspace/query-state"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { useCustomers } from "@/hooks/use-master-data"
import {
  usePlanningJobCards,
} from "@/hooks/use-production"
import {
  useApproveSalesOrder,
  useHoldSalesOrder,
  useResumeSalesOrder,
  useSalesOrderAggregates,
  useSalesOrders,
  fetchAllSalesOrders,
} from "@/hooks/use-sales"
import {
  isInternalOrigin,
  parchmentLineLabel,
  salesOrderOriginLabel,
  salesOrderReferenceLabel,
} from "@/lib/sales-order-entry"

type SyncResultMap = Record<string, string[]>


function formatDate(value?: string | null) {
  if (!value) return "-"
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format("DD MMM YYYY") : String(value)
}

function resolveCustomerLabel(order: any, customerMap: Map<string, string>) {
  return (
    customerMap.get(String(order.customer_id || "")) ||
    order.customer_name ||
    String(order.customer_id || "-")
  )
}

function orderPlantId(order: any) {
  const value = String(order?.plant_id || order?.plant || "").trim()
  return value && value.toUpperCase() !== "ALL" ? value : undefined
}

export default function SalesOrdersPage() {
  const { showToast } = useApp()
  const { setActivePlant } = useAuth()
  const [search, setSearch] = useState("")
  const [selectedLines, setSelectedLines] = useState<Record<string, string[]>>({})
  const [syncResults, setSyncResults] = useState<SyncResultMap>({})
  const [releaseDialogOrder, setReleaseDialogOrder] = useState<any | null>(null)
  const searchParams = useSearchParams()
  const [statusFilter, setStatusFilter] = useState(() => searchParams?.get("status") || "open")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [holdOrder, setHoldOrder] = useState<any | null>(null)
  const [holdReason, setHoldReason] = useState("")
  const holdSalesOrder = useHoldSalesOrder()
  const resumeSalesOrder = useResumeSalesOrder()
  const [pageSize, setPageSize] = useState(25)
  const [pageIndex, setPageIndex] = useState(0)
  const initialDue = String(searchParams?.get("due") || searchParams?.get("due_risk") || "").toLowerCase()
  const [filters, setFilters] = useState(() => ({
    origin: String(searchParams?.get("origin") || searchParams?.get("source") || "").toUpperCase(),
    due: initialDue === "overdue" ? "overdue" : initialDue === "priority" || initialDue === "week" ? "week" : "",
    unreleased: searchParams?.get("unreleased") === "1",
    held: searchParams?.get("held") === "1",
    expired: searchParams?.get("expired") === "1",
    date_from: String(searchParams?.get("date_from") || ""),
    date_to: String(searchParams?.get("date_to") || ""),
    sort: String(searchParams?.get("sort") || "newest"),
  }))
  const [filtersOpen, setFiltersOpen] = useState(() => Boolean(searchParams?.get("due") || searchParams?.get("due_risk") || searchParams?.get("origin") || searchParams?.get("source") || searchParams?.get("unreleased")))
  const activeFilterCount = [filters.origin, filters.due, filters.unreleased, filters.held, filters.expired, filters.date_from, filters.date_to, filters.sort !== "newest"].filter(Boolean).length
  const setFilter = (patch: Partial<typeof filters>) => setFilters((current) => ({ ...current, ...patch }))
  const deferredSearch = useDeferredValue(search.trim())
  const offset = pageIndex * pageSize

  const salesQueryParams = useMemo(
    () => ({
      search: deferredSearch || undefined,
      status: statusFilter === "open" || statusFilter === "all" ? undefined : statusFilter,
      status_group: statusFilter === "open" ? "open" : undefined,
      origin: filters.origin || undefined,
      due: filters.due || undefined,
      unreleased: filters.unreleased || undefined,
      held: filters.held || undefined,
      expired: filters.expired || undefined,
      date_from: filters.date_from || undefined,
      date_to: filters.date_to || undefined,
      sort: filters.sort !== "newest" ? filters.sort : undefined,
      limit: pageSize + 1,
      offset,
    }),
    [deferredSearch, filters, offset, pageSize, statusFilter],
  )

  const ordersQuery = useSalesOrders(salesQueryParams)
  const aggregatesQuery = useSalesOrderAggregates()
  const customersQuery = useCustomers()
  const jobCardsQuery = usePlanningJobCards({ limit: 250 })

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

  const jobsByOrderId = useMemo(() => {
    const buckets = new Map<string, any[]>()
    for (const job of Array.isArray(jobCardsQuery.data) ? jobCardsQuery.data : []) {
      const orderId = String(job?.sales_order_id || "")
      if (!orderId) continue
      const bucket = buckets.get(orderId) || []
      bucket.push(job)
      buckets.set(orderId, bucket)
    }
    return buckets
  }, [jobCardsQuery.data])

  useEffect(() => {
    setPageIndex(0)
  }, [deferredSearch, filters, pageSize, statusFilter])

  const serverRows = useMemo(() => (Array.isArray(ordersQuery.data) ? ordersQuery.data : []), [ordersQuery.data])
  const hasNextPage = serverRows.length > pageSize
  const orders = useMemo(() => serverRows.slice(0, pageSize), [serverRows, pageSize])
  const aggregates = aggregatesQuery.data || {}
  // Never show zeros for a summary that did not load.
  const aggReady = Boolean(aggregatesQuery.data) && !aggregatesQuery.isError
  const aggValue = (text: string) => (aggReady ? text : "—")
  const metrics = {
    draftOrders: Number(aggregates.draft_count || 0),
    readyOrders: Number(aggregates.ready_count || 0),
    syncedOrders: Number(aggregates.planner_synced_count || 0),
    openQty: Number(aggregates.open_qty || 0),
    expiredOpen: Number(aggregates.expired_open_count || 0),
    expiringSoon: Number(aggregates.expiring_7d_count || 0),
    heldOrders: Number(aggregates.held_order_count || 0),
    holdQty: Number(aggregates.hold_qty || 0),
  }

  const updateSelectedLines = (orderId: string, lineId: string, checked: boolean) => {
    setSelectedLines((current) => {
      const previous = new Set(current[orderId] || [])
      if (checked) previous.add(lineId)
      else previous.delete(lineId)
      return { ...current, [orderId]: Array.from(previous) }
    })
  }

  const handleApprove = async (order: any) => {
    try {
      await approveOrder.mutateAsync({ orderId: String(order.id), plantId: orderPlantId(order) })
      showToast("Sales order approved.", "success")
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Approval failed."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    }
  }

  const openReleaseDialog = (order: any) => {
    const selectedLineIds = selectedLines[String(order.id)] || []
    if (selectedLineIds.length === 0) {
      showToast("Select one or more lines before opening the release planner.", "error")
      return
    }
    // One shared release dialog everywhere: one color per card, winder queue required, queue load bars.
    setReleaseDialogOrder(order)
  }

  const [exporting, setExporting] = useState(false)
  const exportRegister = async () => {
    // Every order matching the filters, not only the page on screen.
    setExporting(true)
    let allOrders: any[] = []
    let complete = true
    try {
      const { limit: _limit, offset: _offset, ...filterParams } = salesQueryParams as any
      const result = await fetchAllSalesOrders(filterParams)
      allOrders = result.rows
      complete = result.complete
    } catch (error: any) {
      setExporting(false)
      showToast(`Export failed: ${error?.response?.data?.detail || error?.message || "orders did not load"}. Nothing was downloaded.`, "error")
      return
    }
    setExporting(false)
    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Sales orders")
    sheet.addRow(["SO No", "Customer", "PO Date", "PO No", "Line", "Size", "Color", "PO Qty", "Released", "Delivered", "Pending", "Hold", "Expiry", "Due", "Status"])
    if (!complete) showToast("Export stopped at 10,000 orders — narrow the filters for the rest.", "error")
    for (const order of allOrders) {
      for (const line of order.lines || []) {
        const pendingQty = Number(line.pending_qty ?? Math.max(0, Number(line.qty || 0) - Number(line.fulfilled_qty || 0) - Number(line.hold_qty || 0)))
        sheet.addRow([
          order.order_no, resolveCustomerLabel(order, customerMap), isInternalOrigin(order.origin) ? order.internal_order_date : order.po_date, order.po_number || "Internal",
          line.line_no, line.size_label || line.product_code || "", line.parchment_required ? line.parchment_color || "" : "",
          Number(line.qty || 0), Number(line.released_qty || 0), Number(line.fulfilled_qty || 0), pendingQty, Number(line.hold_qty || 0),
          order.expiry_date || "", line.due_date || "", order.is_held ? "Customer hold" : String(order.status || "").replaceAll("_", " "),
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
    link.download = `sales-orders-${statusFilter}-${dayjs().format("YYYY-MM-DD")}.xlsx`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleHold = async () => {
    if (!holdOrder || holdReason.trim().length < 3) return
    try {
      await holdSalesOrder.mutateAsync({ orderId: String(holdOrder.id), reason: holdReason.trim() })
      showToast(`${holdOrder.order_no || "Order"} is on customer hold. The pending balance is held and the PO closed.`, "success")
      setHoldOrder(null)
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Could not put the order on hold."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    }
  }

  const handleResume = async (order: any) => {
    try {
      await resumeSalesOrder.mutateAsync({ orderId: String(order.id) })
      showToast(`Customer hold lifted on ${order.order_no || "the order"}.`, "success")
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Could not lift the hold."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    }
  }

  const closeReleaseDialog = () => setReleaseDialogOrder(null)

  const releasableStatuses = ["approved", "released", "partially_released", "partially_dispatched"]
  const releasableLineIds = (order: any) =>
    (order.lines || [])
      .filter((line: any) => Number(line.release_remaining_qty ?? line.remaining_qty ?? 0) > 0)
      .map((line: any) => String(line.id))
  const toggleAllLines = (order: any, checked: boolean) => {
    const ids = releasableLineIds(order)
    setSelectedLines((current) => ({ ...current, [String(order.id)]: checked ? ids : [] }))
    if (checked) setExpanded((current) => new Set(current).add(String(order.id)))
  }
  const toggleExpanded = (orderId: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  const customerName = (id?: string | null) => {
    const label = customerMap.get(String(id || "")) || ""
    return label.includes(" · ") ? label.split(" · ").slice(1).join(" · ") : label || "Customer"
  }

  return (
    <>
      <div className="space-y-5" data-testid="sales-orders:page">
        <PageHeader
          badge="Sales"
          title="Sales orders"
          description="Every customer PO with released, delivered, pending and held quantity. Expand an order to release its lines to planning."
          actions={
            <>
              <Link href="/sales-orders/new" className="erp-btn-primary">
                <Plus className="h-4 w-4" />
                New sales order
              </Link>
            </>
          }
        />

        {aggregatesQuery.isError ? <p role="alert" className="text-[13px] text-signal-rose-ink">Order summary did not load — the figures below show “—” instead of zero. <button type="button" className="font-semibold underline" onClick={() => aggregatesQuery.refetch()}>Try again</button></p> : null}
        <MetricRail className="md:grid-cols-3 2xl:grid-cols-6">
          <button type="button" className="text-left" onClick={() => setStatusFilter("draft")}>
            <MetricCard label="Awaiting approval" value={aggValue(metrics.draftOrders.toLocaleString("en-IN"))} detail="Draft orders waiting for commercial approval" icon={CheckCircle2} tone="amber" />
          </button>
          <button type="button" className="text-left" onClick={() => setStatusFilter("open")}>
            <MetricCard label="Ready to release" value={aggValue(metrics.readyOrders.toLocaleString("en-IN"))} detail="Approved orders with lines still to release" icon={ArrowRightLeft} tone="cyan" />
          </button>
          <MetricCard label="Linked to planning" value={aggValue(metrics.syncedOrders.toLocaleString("en-IN"))} detail="Orders already mapped to job cards" icon={ClipboardCheck} tone="emerald" />
          <MetricCard label="Open quantity" value={aggValue(`${metrics.openQty.toLocaleString("en-IN", { maximumFractionDigits: 0 })} pcs`)} detail="Pieces still open across all in-scope orders" icon={Factory} tone="violet" />
          <MetricCard label="Expired SOs" value={aggValue(metrics.expiredOpen.toLocaleString("en-IN"))} detail={`${metrics.expiringSoon} more expire within 7 days · consider a customer hold`} icon={TimerOff} tone={metrics.expiredOpen ? "rose" : "slate"} />
          <MetricCard label="On customer hold" value={aggValue(`${metrics.holdQty.toLocaleString("en-IN", { maximumFractionDigits: 0 })} pcs`)} detail={`${metrics.heldOrders} order${metrics.heldOrders === 1 ? "" : "s"} held and closed`} icon={PauseCircle} tone="amber" />
        </MetricRail>

        <section className="erp-panel min-w-0 overflow-hidden rounded-xl" aria-label="Sales order register">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
            <label className="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-border bg-card px-2.5 sm:max-w-[360px] focus-within:border-ring/70 focus-within:ring-[3px] focus-within:ring-ring/15">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">Search sales orders</span>
              <input
                value={search}
                onChange={(event) => {
                  const nextValue = event.target.value
                  startTransition(() => setSearch(nextValue))
                }}
                placeholder="Search PO, product code, parchment…"
                className="h-full min-w-0 flex-1 border-0 bg-transparent text-[13px] shadow-none outline-none focus:shadow-none"
              />
            </label>
            <div className="tube-segment max-w-full overflow-x-auto" role="group" aria-label="Quick status filter">
              {[
                ["open", "Open"],
                ["draft", "Draft"],
                ["approved", "Approved"],
                ["partially_released", "Partial"],
                ["all", "All"],
              ].map(([value, label]) => (
                <button key={value} type="button" aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>
                  {label}
                </button>
              ))}
            </div>
            <select
              aria-label="Status filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-9 rounded-lg border border-border bg-card px-2.5 text-[13px] text-foreground"
            >
              <option value="open">Open queue</option>
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
              <option value="released">Released</option>
              <option value="partially_released">Partially released</option>
              <option value="partially_dispatched">Partially dispatched</option>
              <option value="closed">Closed</option>
            </select>
            <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)} className={`erp-btn-secondary !h-9 ${activeFilterCount ? "!border-primary/40 !text-primary" : ""}`}>
              <SlidersHorizontal className="h-4 w-4" />Filters{activeFilterCount ? <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{activeFilterCount}</span> : null}
            </button>
            <button type="button" className="erp-btn-secondary !h-9" onClick={() => void exportRegister()} disabled={!orders.length || exporting}><Download className="h-4 w-4" /><span className="hidden sm:inline">Excel</span></button>
            <button type="button" className="erp-btn-secondary !h-9" onClick={() => window.print()}><Printer className="h-4 w-4" /><span className="hidden sm:inline">Print</span></button>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {ordersQuery.isFetching ? "Refreshing…" : orders.length ? `${offset + 1}–${offset + orders.length}${hasNextPage ? "+" : ""}` : ""}
            </span>
          </div>

          {filtersOpen ? (
            <div className="grid gap-3 border-b border-border bg-[hsl(var(--surface-2))] px-3 py-3 animate-enter-up sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]" aria-label="More filters">
              <label className="space-y-1">
                <span className="text-[12px] font-medium text-muted-foreground">Source</span>
                <select value={filters.origin} onChange={(event) => setFilter({ origin: event.target.value })} className="h-9 w-full rounded-lg border border-input bg-card px-2.5 text-[13px]">
                  <option value="">Customer PO + internal</option>
                  <option value="CUSTOMER_PO">Customer PO</option>
                  <option value="INTERNAL">Internal order</option>
                </select>
              </label>
              <div className="space-y-1">
                <span className="text-[12px] font-medium text-muted-foreground">Delivery</span>
                <div className="tube-segment w-full" role="group" aria-label="Delivery filter">
                  {([["", "Any"], ["overdue", "Overdue"], ["week", "Due in 7 days"]] as const).map(([value, label]) => (
                    <button key={value || "any"} type="button" className="flex-1 justify-center" aria-pressed={filters.due === value} onClick={() => setFilter({ due: value })}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-[12px] font-medium text-muted-foreground">PO / order date</span>
                <div className="flex items-center gap-1.5">
                  <input type="date" aria-label="From date" value={filters.date_from} onChange={(event) => setFilter({ date_from: event.target.value })} className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-card px-2 text-[13px]" />
                  <span className="text-muted-foreground">–</span>
                  <input type="date" aria-label="To date" value={filters.date_to} onChange={(event) => setFilter({ date_to: event.target.value })} className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-card px-2 text-[13px]" />
                </div>
              </div>
              <label className="space-y-1">
                <span className="text-[12px] font-medium text-muted-foreground">Sort</span>
                <select value={filters.sort} onChange={(event) => setFilter({ sort: event.target.value })} className="h-9 w-full rounded-lg border border-input bg-card px-2.5 text-[13px]">
                  <option value="newest">Newest first</option>
                  <option value="due">Earliest delivery first</option>
                  <option value="po_date">PO date (latest)</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </label>
              <div className="flex flex-wrap items-end gap-2">
                {([["unreleased", "Has unreleased qty"], ["held", "On hold"], ["expired", "Expired"]] as const).map(([key, label]) => (
                  <button key={key} type="button" aria-pressed={filters[key]} onClick={() => setFilter({ [key]: !filters[key] } as any)} className={`h-9 rounded-full border px-3 text-[12.5px] font-medium transition-colors ${filters[key] ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}>
                    {label}
                  </button>
                ))}
                {activeFilterCount ? (
                  <button type="button" className="h-9 px-2 text-[12.5px] font-semibold text-primary hover:underline" onClick={() => setFilters({ origin: "", due: "", unreleased: false, held: false, expired: false, date_from: "", date_to: "", sort: "newest" })}>Clear</button>
                ) : null}
              </div>
            </div>
          ) : null}

          {ordersQuery.isLoading || ordersQuery.isError || orders.length === 0 ? (
            <div className="p-3">
              <QuerySwitch
                isLoading={ordersQuery.isLoading}
                isError={ordersQuery.isError}
                isEmpty={orders.length === 0}
                loadingLabel="Loading live sales orders..."
                emptyTitle="No sales orders matched this queue yet."
                emptyMessage="Adjust the status filter or create a new sales order."
                errorMessage="Sales orders could not be loaded. This is not an empty queue — refresh to retry."
                onRetry={() => {
                  void ordersQuery.refetch()
                }}
              >
                {null}
              </QuerySwitch>
            </div>
          ) : (
            <div className="tube-print-expand max-h-[calc(100dvh-240px)] min-h-[320px] overflow-auto">
              <table className="tube-grid" data-testid="sales-orders:register">
                <thead>
                  <tr>
                    <th className="w-[64px] !pr-0"><span className="sr-only">Select and expand</span></th>
                    <th>SO No.</th>
                    <th className="hidden lg:table-cell">Customer</th>
                    <th className="hidden md:table-cell">PO date</th>
                    <th>PO No.</th>
                    <th className="hidden xl:table-cell">Size</th>
                    <th className="hidden xl:table-cell">Color</th>
                    <th className="num">PO qty</th>
                    <th className="num hidden md:table-cell">Released</th>
                    <th className="num hidden md:table-cell">Delivered</th>
                    <th className="num">Pending</th>
                    <th className="num hidden sm:table-cell">Hold</th>
                    <th className="hidden lg:table-cell">Expiry</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                {orders.map((order: any) => {
                  const orderId = String(order.id)
                  const lines: any[] = order.lines || []
                  const selectedLineIds = selectedLines[orderId] || []
                  const linkedJobs = jobsByOrderId.get(orderId) || []
                  const locallySynced = syncResults[orderId] || []
                  const jobIds = [...linkedJobs.map((job: any) => String(job.id)), ...locallySynced].filter((value, index, rows) => rows.indexOf(value) === index)
                  const releasable = releasableLineIds(order)
                  const allSelected = releasable.length > 0 && releasable.every((id: string) => selectedLineIds.includes(id))
                  const someSelected = selectedLineIds.length > 0 && !allSelected
                  const isOpen = expanded.has(orderId)
                  const sum = (key: string) => lines.reduce((total, line) => total + Number(line[key] || 0), 0)
                  const ordered = sum("qty")
                  const released = sum("released_qty")
                  const delivered = sum("fulfilled_qty")
                  const hold = sum("hold_qty")
                  const pending = lines.reduce((total, line) => total + Number(line.pending_qty ?? Math.max(0, Number(line.qty || 0) - Number(line.fulfilled_qty || 0) - Number(line.hold_qty || 0))), 0)
                  const sizes = Array.from(new Set(lines.map((line) => String(line.size_label || line.product_code || "").trim()).filter(Boolean)))
                  const colors = Array.from(new Set(lines.filter((line) => line.parchment_required && line.parchment_color).map((line) => String(line.parchment_color))))
                  const expiryDays = order.expiry_date ? dayjs(order.expiry_date).startOf("day").diff(dayjs().startOf("day"), "day") : null
                  const isHeld = Boolean(order.is_held)
                  const canApprove = order.status === "draft" || order.status === "submitted"
                  const canRelease = releasableStatuses.includes(order.status) && !isHeld
                  const releaseBusy = false
                  const fmt = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 0 })
                  return (
                    <tbody key={order.id} data-order-id={order.id} className="group/order">
                      <tr data-state={selectedLineIds.length ? "selected" : undefined} data-expanded={isOpen || undefined}>
                        <td className="!pr-0">
                          <div className="flex items-center gap-0.5">
                            <input
                              type="checkbox"
                              aria-label={`Select releasable lines of ${salesOrderReferenceLabel(order)}`}
                              checked={allSelected}
                              ref={(element) => { if (element) element.indeterminate = someSelected }}
                              disabled={!releasable.length || isHeld}
                              onChange={(event) => toggleAllLines(order, event.target.checked)}
                              className="h-3.5 w-3.5 cursor-pointer disabled:cursor-not-allowed"
                            />
                            <button
                              type="button"
                              onClick={() => toggleExpanded(orderId)}
                              aria-expanded={isOpen}
                              aria-label={`${isOpen ? "Hide" : "Show"} ${lines.length} lines`}
                              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-foreground/[.06] hover:text-foreground"
                            >
                              <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
                            </button>
                          </div>
                        </td>
                        <td className="whitespace-nowrap">
                          <Link href={`/sales-orders/${order.id}`} data-testid="sales-orders:detail-link" className="font-semibold text-foreground transition-colors hover:text-primary">
                            {order.order_no || orderId.slice(0, 8)}
                          </Link>
                          <span className="block text-[11px] text-muted-foreground">{lines.length} line{lines.length === 1 ? "" : "s"}<span className="lg:hidden"> · {resolveCustomerLabel(order, customerMap)}</span></span>
                        </td>
                        <td className="hidden max-w-[220px] lg:table-cell"><span className="block truncate text-foreground/90" title={resolveCustomerLabel(order, customerMap)}>{resolveCustomerLabel(order, customerMap)}</span></td>
                        <td className="hidden whitespace-nowrap tabular-nums text-foreground/85 md:table-cell">{isInternalOrigin(order.origin) ? formatDate(order.internal_order_date) : formatDate(order.po_date)}</td>
                        <td className="max-w-[160px]">
                          <span className="block truncate text-foreground/90" title={order.po_number || undefined}>{isInternalOrigin(order.origin) ? <span className="text-muted-foreground">Internal</span> : order.po_number || "—"}</span>
                        </td>
                        <td className="hidden max-w-[170px] xl:table-cell">
                          <span className="block truncate text-foreground/85" title={sizes.join(", ")}>{sizes[0] || "—"}{sizes.length > 1 ? <span className="text-muted-foreground"> +{sizes.length - 1}</span> : null}</span>
                        </td>
                        <td className="hidden max-w-[120px] xl:table-cell"><span className="block truncate text-foreground/85" title={colors.join(", ")}>{colors.length ? colors.join(", ") : <span className="text-muted-foreground">—</span>}</span></td>
                        <td className="num font-medium">{fmt(ordered)}</td>
                        <td className="num hidden text-foreground/85 md:table-cell">{fmt(released)}</td>
                        <td className="num hidden text-foreground/85 md:table-cell">
                          {fmt(delivered)}
                          {ordered > 0 ? <div className="ml-auto mt-1 h-1 w-14 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className="h-full rounded-full bg-signal-emerald-ink/70" style={{ width: `${Math.min(100, (delivered / ordered) * 100)}%` }} /></div> : null}
                        </td>
                        <td className={`num font-semibold ${pending > 0 ? "text-foreground" : "text-muted-foreground"}`}>{fmt(pending)}</td>
                        <td className={`num hidden sm:table-cell ${hold > 0 ? "font-semibold text-signal-amber-ink" : "text-muted-foreground"}`}>{hold > 0 ? fmt(hold) : "—"}</td>
                        <td className="hidden whitespace-nowrap lg:table-cell">
                          {order.expiry_date ? (
                            <>
                              <span className="block tabular-nums text-foreground/85">{formatDate(order.expiry_date)}</span>
                              {pending > 0 && !isHeld && order.status !== "closed" && expiryDays !== null ? (
                                <span className={`text-[11px] font-medium ${expiryDays < 0 ? "text-signal-rose-ink" : expiryDays <= 7 ? "text-signal-amber-ink" : "text-muted-foreground"}`}>
                                  {expiryDays < 0 ? `Expired ${Math.abs(expiryDays)}d ago` : expiryDays === 0 ? "Expires today" : `${expiryDays}d left`}
                                </span>
                              ) : null}
                            </>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td>
                          {isHeld ? (
                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-signal-amber-line bg-signal-amber-soft px-2 py-0.5 text-[11.5px] font-medium text-signal-amber-ink" title={order.hold_reason || undefined}>
                              <PauseCircle className="h-3 w-3" />Customer hold
                            </span>
                          ) : <StatusBadge value={order.status} />}
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-1">
                            {canApprove ? (
                              <button
                                type="button"
                                onClick={() => handleApprove(order)}
                                disabled={approveOrder.isPending}
                                aria-label="Approve commercial PO"
                                className="inline-flex h-8 items-center gap-1 rounded-md border border-signal-emerald-line bg-signal-emerald-soft px-2.5 text-[12.5px] font-semibold text-signal-emerald-ink transition hover:brightness-[.97] disabled:opacity-60"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Approve
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => openReleaseDialog(order)}
                              aria-label="Release selected lines to planner"
                              title={isHeld ? "Lift the customer hold to release" : !canRelease ? "Approve the order before releasing" : !selectedLineIds.length ? "Select lines to release" : undefined}
                              disabled={releaseBusy || selectedLineIds.length === 0 || !canRelease}
                              className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2.5 text-[12.5px] font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {releaseBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                              <span className="hidden sm:inline">Release</span>
                              {selectedLineIds.length ? <span className="rounded bg-primary-foreground/20 px-1 text-[11px] tabular-nums">{selectedLineIds.length}</span> : null}
                            </button>
                            <RowMenu
                              items={[
                                { label: "View order", href: `/sales-orders/${order.id}`, icon: Eye, testId: "sales-orders:view-link" },
                                { label: "Audit trail", href: `/sales-orders/${order.id}/audit`, icon: History },
                                ...(isHeld
                                  ? [{ label: "Lift customer hold", icon: PlayCircle, onSelect: () => void handleResume(order) }]
                                  : pending > 0 && order.status !== "closed"
                                    ? [{ label: "Customer hold & close…", icon: PauseCircle, tone: "warn" as const, onSelect: () => { setHoldOrder(order); setHoldReason("") } }]
                                    : []),
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                      {isOpen ? lines.map((line: any) => {
                        const checked = selectedLineIds.includes(String(line.id))
                        const releaseRemainingQty = Number(line.release_remaining_qty ?? line.remaining_qty ?? 0)
                        const lineReleasable = releaseRemainingQty > 0 && !isHeld
                        const linePending = Number(line.pending_qty ?? Math.max(0, Number(line.qty || 0) - Number(line.fulfilled_qty || 0) - Number(line.hold_qty || 0)))
                        return (
                          <tr key={line.id} className="sub-line animate-fade-in bg-[hsl(var(--surface-sunken))] text-[12.5px]" data-state={checked ? "selected" : undefined}>
                            <td className="!pr-0">
                              <div className="flex justify-end pr-2">
                                <input
                                  type="checkbox"
                                  aria-label={`Select line ${line.line_no || "-"} ${line.product_code || ""}`}
                                  checked={checked}
                                  disabled={!lineReleasable}
                                  onChange={(event) => updateSelectedLines(orderId, String(line.id), event.target.checked)}
                                  className="h-3.5 w-3.5 cursor-pointer disabled:cursor-not-allowed"
                                />
                              </div>
                            </td>
                            <td className="whitespace-nowrap text-muted-foreground">
                              <span className="font-medium text-foreground/90">Line {line.line_no || "-"}</span>
                              <span className="block text-[11px]">Due {formatDate(line.due_date)}</span>
                            </td>
                            <td className="hidden lg:table-cell" />
                            <td className="hidden md:table-cell" />
                            <td className="max-w-[160px]"><span className="block truncate text-muted-foreground" title={line.product_code || undefined}>{line.product_code || "—"}</span></td>
                            <td className="hidden max-w-[170px] xl:table-cell"><span className="block truncate text-foreground/85">{line.size_label || line.product_code || "—"}</span></td>
                            <td className="hidden xl:table-cell text-foreground/85">{line.parchment_required ? line.parchment_color || "—" : <span className="text-muted-foreground">—</span>}</td>
                            <td className="num">{fmt(Number(line.qty || 0))}</td>
                            <td className="num hidden md:table-cell">{fmt(Number(line.released_qty || 0))}</td>
                            <td className="num hidden md:table-cell">{fmt(Number(line.fulfilled_qty || 0))}</td>
                            <td className="num font-medium">{fmt(linePending)}</td>
                            <td className={`num hidden sm:table-cell ${Number(line.hold_qty || 0) > 0 ? "text-signal-amber-ink" : "text-muted-foreground"}`}>{Number(line.hold_qty || 0) > 0 ? fmt(Number(line.hold_qty)) : "—"}</td>
                            <td className="hidden lg:table-cell text-muted-foreground">{releaseRemainingQty > 0 ? `${fmt(releaseRemainingQty)} to release` : "Fully released"}</td>
                            <td colSpan={2} className="text-muted-foreground">{parchmentLineLabel(line)}</td>
                          </tr>
                        )
                      }) : null}
                      {isOpen ? (
                        <tr className="sub-line bg-[hsl(var(--surface-sunken))]">
                          <td colSpan={15} className="!py-2">
                            <div className="flex flex-wrap items-center gap-2 pl-[64px] text-[12px] text-muted-foreground">
                              {isHeld ? (
                                <span className="text-signal-amber-ink">On customer hold since {formatDate(order.held_at)}{order.hold_reason ? ` — ${order.hold_reason}` : ""}.</span>
                              ) : canRelease ? (
                                <span>{selectedLineIds.length ? `${selectedLineIds.length} line${selectedLineIds.length === 1 ? "" : "s"} selected. Use Release to open the winder planner.` : "Tick the lines production needs now. A PO can release many times over its life."}</span>
                              ) : (
                                <span>Approve this order to release its lines to planning.</span>
                              )}
                              {jobIds.length ? (
                                <span className="ml-auto flex flex-wrap items-center gap-1">
                                  Job cards:
                                  {jobIds.slice(0, 6).map((jobCardId) => (
                                    <Link key={jobCardId} href={`/production/job-cards/${jobCardId}`} className="rounded-md border border-signal-emerald-line bg-signal-emerald-soft px-1.5 py-0.5 font-mono text-[11px] text-signal-emerald-ink hover:underline">
                                      {jobCardId.slice(0, 8)}
                                    </Link>
                                  ))}
                                </span>
                              ) : null}
                            </div>
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
                <select
                  aria-label="Rows per page"
                  value={pageSize}
                  onChange={(event) => setPageSize(Number(event.target.value))}
                  className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums text-muted-foreground">Page {pageIndex + 1}</span>
                <button
                  type="button"
                  onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
                  disabled={pageIndex === 0 || ordersQuery.isFetching}
                  aria-label="Previous page"
                  className="grid h-8 w-8 place-items-center rounded-md border border-border bg-card text-muted-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPageIndex((current) => current + 1)}
                  disabled={!hasNextPage || ordersQuery.isFetching}
                  aria-label="Next page"
                  className="grid h-8 w-8 place-items-center rounded-md border border-border bg-card text-muted-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <Dialog open={Boolean(holdOrder)} onOpenChange={(open) => (!open ? setHoldOrder(null) : null)}>
        <DialogContent data-testid="sales-orders:hold-dialog" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Customer hold &amp; close</DialogTitle>
            <DialogDescription>
              Use this when the customer is not lifting material. The undelivered balance becomes hold qty and the PO closes. Delivered quantities and job cards are not changed, and you can lift the hold later.
            </DialogDescription>
          </DialogHeader>
          {holdOrder ? (
            <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-border text-center">
              {[
                ["SO", holdOrder.order_no || "—"],
                ["PO", holdOrder.po_number || "Internal"],
                ["Will hold", `${(holdOrder.lines || []).reduce((total: number, line: any) => total + Math.max(0, Number(line.qty || 0) - Number(line.fulfilled_qty || 0)), 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })} pcs`],
              ].map(([label, value], index) => (
                <div key={label} className={`px-3 py-2 ${index ? "border-l border-border" : ""}`}>
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <p className="truncate text-[13px] font-semibold">{value}</p>
                </div>
              ))}
            </div>
          ) : null}
          <label className="grid gap-1.5 text-[13px] font-medium">
            Reason
            <textarea
              value={holdReason}
              onChange={(event) => setHoldReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="e.g. Customer has not lifted material since July; confirmed on call."
              className="rounded-lg border border-input bg-card px-3 py-2 text-[13px] font-normal"
            />
          </label>
          <DialogFooter>
            <button type="button" className="erp-btn-secondary" onClick={() => setHoldOrder(null)}>Cancel</button>
            <button type="button" className="erp-btn-primary !bg-signal-amber-ink !text-background" disabled={holdReason.trim().length < 3 || holdSalesOrder.isPending} onClick={() => void handleHold()}>
              {holdSalesOrder.isPending ? "Holding…" : "Hold & close PO"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReleaseToQueueDialog
        order={releaseDialogOrder}
        selectedLineIds={releaseDialogOrder ? selectedLines[String(releaseDialogOrder.id)] || [] : []}
        open={Boolean(releaseDialogOrder)}
        onOpenChange={(open) => { if (!open) closeReleaseDialog() }}
        testIdPrefix="sales-orders"
        onReleased={({ lotIds }) => {
          if (!releaseDialogOrder) return
          const releasedPlantId = orderPlantId(releaseDialogOrder)
          if (releasedPlantId) setActivePlant(releasedPlantId)
          setSelectedLines((current) => ({ ...current, [String(releaseDialogOrder.id)]: [] }))
          setSyncResults((current) => ({ ...current, [String(releaseDialogOrder.id)]: lotIds }))
        }}
      />
    </>
  )
}
