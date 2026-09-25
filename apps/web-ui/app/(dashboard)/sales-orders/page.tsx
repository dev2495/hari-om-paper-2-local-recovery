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
  ListChecks,
  LoaderCircle,
  Plus,
  Search,
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
  usePreflightSalesOrderRelease,
  useReleaseSyncSalesOrder,
} from "@/hooks/use-production"
import {
  useApproveSalesOrder,
  useHoldSalesOrder,
  useResumeSalesOrder,
  useReleaseSalesOrderLine,
  useSalesOrderAggregates,
  useSalesOrders,
} from "@/hooks/use-sales"
import { type ReleaseMachine } from "@/lib/sales-release"
import {
  isInternalOrigin,
  parchmentLineLabel,
  salesOrderOriginLabel,
  salesOrderReferenceLabel,
} from "@/lib/sales-order-entry"

type SyncResultMap = Record<string, string[]>

type ReleaseDraftRow = {
  sales_order_line_id: string
  release_lot_id: string
  product_code: string
  due_date: string | null
  remaining_qty: number
  release_qty: string
  winder_machine_id: string
  mode: "new" | "resume"
  authorized_winders: ReleaseMachine[]
  compatible_winders: ReleaseMachine[]
  compatibility_warning: string | null
  blocker: string | null
}

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

function formatCapacityUnit(value?: string | null) {
  const normalized = String(value || "").toUpperCase()
  if (normalized === "METERS_PER_DAY") return "meters/shift"
  if (normalized === "BAMBOOS_PER_DAY") return "bamboo/shift"
  if (normalized === "BATCHES_PER_DAY") return "batch cycles/shift"
  if (normalized === "TUBES_PER_DAY") return "tubes/shift"
  if (normalized === "REELS_PER_DAY") return "reels/shift"
  return normalized ? normalized.toLowerCase().replace(/_/g, " ") : ""
}

function buildReleaseRows(order: any, selectedLineIds: string[], defaultMachineId: string) {
  return (order.lines || [])
    .filter((line: any) => selectedLineIds.includes(String(line.id)))
    .flatMap((line: any) => {
      const pendingLots = (Array.isArray(line.release_lots) ? line.release_lots : [])
        .filter((lot: any) => !lot.job_card_id && String(lot.status || "").toLowerCase() !== "cancelled")
      if (pendingLots.length > 0) {
        return pendingLots.map((lot: any) => ({
          sales_order_line_id: String(line.id),
          release_lot_id: String(lot.release_lot_id || lot.id),
          product_code: String(lot.product_code || line.product_code || order.po_number || order.order_no || "").trim(),
          due_date: line.due_date || null,
          remaining_qty: Number(lot.release_qty || 0),
          release_qty: Number(lot.release_qty || 0).toFixed(0),
          winder_machine_id: String(lot.winder_machine_id || defaultMachineId),
          mode: "resume" as const,
          authorized_winders: [],
          compatible_winders: [],
          compatibility_warning: null,
          blocker: null,
        }))
      }
      const releaseRemainingQty = Number(line.release_remaining_qty ?? line.remaining_qty ?? line.qty ?? 0)
      return [{
        sales_order_line_id: String(line.id),
        release_lot_id: crypto.randomUUID(),
        product_code: String(line.product_code || order.po_number || order.order_no || "").trim(),
        due_date: line.due_date || null,
        remaining_qty: releaseRemainingQty,
        release_qty: releaseRemainingQty.toFixed(0),
        winder_machine_id: defaultMachineId,
        mode: "new" as const,
        authorized_winders: [],
        compatible_winders: [],
        compatibility_warning: null,
        blocker: null,
      }]
    })
}

function orderPlantId(order: any) {
  const value = String(order?.plant_id || order?.plant || "").trim()
  return value && value.toUpperCase() !== "ALL" ? value : undefined
}

function assignedReleaseBlocker(
  selectedWinder: string,
  authorizedCount: number,
  preflightBlocker: string | null | undefined,
) {
  if (!authorizedCount) {
    return String(preflightBlocker || "No authorized same-plant winder queue is available.")
  }
  const text = String(preflightBlocker || "").trim()
  if (selectedWinder && /select a winder queue/i.test(text)) {
    return null
  }
  return text || null
}

export default function SalesOrdersPage() {
  const { showToast } = useApp()
  const { setActivePlant } = useAuth()
  const [search, setSearch] = useState("")
  const [selectedLines, setSelectedLines] = useState<Record<string, string[]>>({})
  const [syncResults, setSyncResults] = useState<SyncResultMap>({})
  const [releaseDialogOrder, setReleaseDialogOrder] = useState<any | null>(null)
  const [releaseDraftRows, setReleaseDraftRows] = useState<ReleaseDraftRow[]>([])
  const [releaseMachinesLoadingOrderId, setReleaseMachinesLoadingOrderId] = useState<string | null>(null)
  const [releaseOutcome, setReleaseOutcome] = useState<{
    orderId: string
    winderMachineId: string
    lotIds: string[]
    jobCardIds: string[]
    syncPending: boolean
  } | null>(null)
  const searchParams = useSearchParams()
  const [statusFilter, setStatusFilter] = useState(() => searchParams?.get("status") || "open")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [holdOrder, setHoldOrder] = useState<any | null>(null)
  const [holdReason, setHoldReason] = useState("")
  const holdSalesOrder = useHoldSalesOrder()
  const resumeSalesOrder = useResumeSalesOrder()
  const [pageSize, setPageSize] = useState(25)
  const [pageIndex, setPageIndex] = useState(0)
  const deferredSearch = useDeferredValue(search.trim())
  const offset = pageIndex * pageSize

  const salesQueryParams = useMemo(
    () => ({
      search: deferredSearch || undefined,
      status: statusFilter === "open" || statusFilter === "all" ? undefined : statusFilter,
      status_group: statusFilter === "open" ? "open" : undefined,
      limit: pageSize + 1,
      offset,
    }),
    [deferredSearch, offset, pageSize, statusFilter],
  )

  const ordersQuery = useSalesOrders(salesQueryParams)
  const aggregatesQuery = useSalesOrderAggregates()
  const customersQuery = useCustomers()
  const jobCardsQuery = usePlanningJobCards({ limit: 250 })

  const approveOrder = useApproveSalesOrder()
  const releaseOrderLine = useReleaseSalesOrderLine()
  const releasePreflight = usePreflightSalesOrderRelease()
  const releaseSync = useReleaseSyncSalesOrder()

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
  }, [deferredSearch, pageSize, statusFilter])

  const serverRows = useMemo(() => (Array.isArray(ordersQuery.data) ? ordersQuery.data : []), [ordersQuery.data])
  const hasNextPage = serverRows.length > pageSize
  const orders = useMemo(() => serverRows.slice(0, pageSize), [serverRows, pageSize])
  const aggregates = aggregatesQuery.data || {}
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

  const openReleaseDialog = async (order: any) => {
    const selectedLineIds = selectedLines[String(order.id)] || []
    if (selectedLineIds.length === 0) {
      showToast("Select one or more lines before opening the release planner.", "error")
      return
    }

    const orderId = String(order.id)
    if (releaseMachinesLoadingOrderId === orderId) return

    setReleaseMachinesLoadingOrderId(orderId)
    try {
      const plantId = orderPlantId(order)
      const draftRows = buildReleaseRows(order, selectedLineIds, "")
      const response = await releasePreflight.mutateAsync({
        salesOrderId: orderId,
        plantId,
        data: {
          release_rows: draftRows.map((row) => ({
            sales_order_line_id: row.sales_order_line_id,
            release_lot_id: row.mode === "resume" ? row.release_lot_id : null,
            release_qty: Number(row.release_qty),
            winder_machine_id: row.winder_machine_id || null,
          })),
        },
      })
      const results = Array.isArray(response?.data?.line_results) ? response.data.line_results : []
      const hydratedRows = draftRows.map((row) => {
        const result = results.find(
          (entry: any) =>
            String(entry.sales_order_line_id) === row.sales_order_line_id &&
            String(entry.release_lot_id || "") === (row.mode === "resume" ? row.release_lot_id : ""),
        )
        const authorizedWinders = Array.isArray(result?.authorized_winders) && result.authorized_winders.length
          ? result.authorized_winders
          : Array.isArray(result?.compatible_winders) ? result.compatible_winders : []
        const selectedWinder = authorizedWinders.some((machine: ReleaseMachine) => String(machine.id) === row.winder_machine_id)
          ? row.winder_machine_id
          : String(authorizedWinders[0]?.id || "")
        return {
          ...row,
          authorized_winders: authorizedWinders,
          compatible_winders: Array.isArray(result?.compatible_winders) ? result.compatible_winders : [],
          winder_machine_id: selectedWinder,
          compatibility_warning: result?.compatibility_warning || null,
          blocker: assignedReleaseBlocker(selectedWinder, authorizedWinders.length, result?.blocker),
        }
      })
      setReleaseDialogOrder(order)
      setReleaseDraftRows(hydratedRows)
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Unable to validate this release against live machine masters."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    } finally {
      setReleaseMachinesLoadingOrderId(null)
    }
  }

  const exportRegister = async () => {
    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Sales orders")
    sheet.addRow(["SO No", "Customer", "PO Date", "PO No", "Line", "Size", "Color", "PO Qty", "Released", "Delivered", "Pending", "Hold", "Expiry", "Due", "Status"])
    for (const order of orders as any[]) {
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

  const closeReleaseDialog = () => {
    setReleaseDialogOrder(null)
    setReleaseDraftRows([])
    setReleaseOutcome(null)
  }

  const updateReleaseDraftRow = (releaseLotId: string, patch: Partial<ReleaseDraftRow>) => {
    setReleaseDraftRows((current) =>
      current.map((row) => (row.release_lot_id === releaseLotId ? { ...row, ...patch } : row)),
    )
  }

  const releaseSummary = useMemo(() => {
    const selectedCount = releaseDraftRows.length
    const totalQty = releaseDraftRows.reduce((sum, row) => sum + Number(row.release_qty || 0), 0)
    const machineCount = new Set(releaseDraftRows.map((row) => row.winder_machine_id).filter(Boolean)).size
    const pendingCount = releaseDraftRows.filter((row) => row.mode === "resume").length
    const blockers = releaseDraftRows.filter((row) => {
      const quantity = Number(row.release_qty || 0)
      return row.blocker || !row.winder_machine_id || quantity <= 0 || quantity > row.remaining_qty
    }).length
    return { selectedCount, totalQty, machineCount, pendingCount, blockers }
  }, [releaseDraftRows])

  const handleConfirmRelease = async () => {
    if (!releaseDialogOrder) return

    const normalizedRows = releaseDraftRows
      .map((row) => ({
        ...row,
        release_qty: Number(row.release_qty || 0),
      }))
      .filter((row) => row.release_qty > 0)

    if (normalizedRows.length === 0) {
      showToast("Enter at least one positive release quantity.", "error")
      return
    }

    const invalidRow = normalizedRows.find(
      (row) =>
        row.release_qty <= 0 ||
        row.release_qty > row.remaining_qty ||
        !row.winder_machine_id,
    )
    if (invalidRow) {
      showToast("Each release row needs a winder and a quantity within the remaining balance.", "error")
      return
    }

    try {
      const preflightResponse = await releasePreflight.mutateAsync({
        salesOrderId: String(releaseDialogOrder.id),
        plantId: orderPlantId(releaseDialogOrder),
        data: {
          release_rows: normalizedRows.map((row) => ({
            sales_order_line_id: row.sales_order_line_id,
            release_lot_id: row.mode === "resume" ? row.release_lot_id : null,
            release_qty: row.release_qty,
            winder_machine_id: row.winder_machine_id,
          })),
        },
      })
      if (!preflightResponse?.data?.ready) {
        const results = Array.isArray(preflightResponse?.data?.line_results) ? preflightResponse.data.line_results : []
        setReleaseDraftRows((current) => current.map((row) => {
          const result = results.find(
            (entry: any) => String(entry.sales_order_line_id) === row.sales_order_line_id &&
              String(entry.release_lot_id || "") === (row.mode === "resume" ? row.release_lot_id : ""),
          )
          return result ? { ...row, blocker: result.blocker || null } : row
        }))
        const firstBlocker = results.find((row: any) => row.blocker)?.blocker
        showToast(firstBlocker || "Resolve the release blockers before continuing.", "error")
        return
      }

      const persistedRows = []
      for (const row of normalizedRows) {
        const response = await releaseOrderLine.mutateAsync({
            lineId: row.sales_order_line_id,
            plantId: orderPlantId(releaseDialogOrder),
            data: {
              release_qty: row.release_qty,
              winder_machine_id: row.winder_machine_id,
              product_code: row.product_code || null,
              release_lot_id: row.release_lot_id,
            },
        })
        const persistedRow = {
          ...row,
          release_lot_id: String(response?.data?.release_lot_id || row.release_lot_id),
          mode: "resume" as const,
        }
        persistedRows.push(persistedRow)
        setReleaseDraftRows((current) => current.map((entry) =>
          entry.release_lot_id === row.release_lot_id
            ? { ...entry, release_lot_id: persistedRow.release_lot_id, release_qty: String(persistedRow.release_qty), mode: "resume" }
            : entry,
        ))
      }

      let jobCardIds: string[] = []
      let syncPending = false
      try {
        const response = await releaseSync.mutateAsync({
          salesOrderId: String(releaseDialogOrder.id),
          plantId: orderPlantId(releaseDialogOrder),
          data: {
            line_ids: persistedRows.map((row) => row.sales_order_line_id),
            release_rows: persistedRows.map((row) => ({
              release_lot_id: row.release_lot_id,
              sales_order_line_id: row.sales_order_line_id,
              release_qty: row.release_qty,
              winder_machine_id: row.winder_machine_id,
              product_code: row.product_code || null,
            })),
          },
        })
        jobCardIds = Array.isArray(response?.data?.line_results)
          ? response.data.line_results.map((row: any) => String(row.job_card_id)).filter(Boolean)
          : []
        syncPending = jobCardIds.length === 0
      } catch {
        syncPending = true
      }

      setSelectedLines((current) => ({ ...current, [String(releaseDialogOrder.id)]: [] }))
      setSyncResults((current) => ({ ...current, [String(releaseDialogOrder.id)]: jobCardIds }))
      const releasedPlantId = orderPlantId(releaseDialogOrder)
      if (releasedPlantId) setActivePlant(releasedPlantId)
      setReleaseOutcome({
        orderId: String(releaseDialogOrder.id),
        winderMachineId: String(persistedRows[0]?.winder_machine_id || ""),
        lotIds: persistedRows.map((row) => String(row.release_lot_id)),
        jobCardIds,
        syncPending,
      })
      showToast(
        syncPending
          ? "Release recorded — planning synchronization pending."
          : `Released ${persistedRows.length} line bucket(s) into the selected winder queue.`,
        syncPending ? "error" : "success",
      )
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Release sync failed."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    }
  }

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
              <Link href="/sales-orders/pending" className="erp-btn-secondary">
                <ListChecks className="h-4 w-4" />
                Pending register
              </Link>
              <Link href="/sales-orders/new" className="erp-btn-primary">
                <Plus className="h-4 w-4" />
                New sales order
              </Link>
            </>
          }
        />

        <MetricRail className="md:grid-cols-3 2xl:grid-cols-6">
          <button type="button" className="text-left" onClick={() => setStatusFilter("draft")}>
            <MetricCard label="Awaiting approval" value={metrics.draftOrders.toLocaleString("en-IN")} detail="Draft orders waiting for commercial approval" icon={CheckCircle2} tone="amber" />
          </button>
          <button type="button" className="text-left" onClick={() => setStatusFilter("open")}>
            <MetricCard label="Ready to release" value={metrics.readyOrders.toLocaleString("en-IN")} detail="Approved orders with lines still to release" icon={ArrowRightLeft} tone="cyan" />
          </button>
          <MetricCard label="Linked to planning" value={metrics.syncedOrders.toLocaleString("en-IN")} detail="Orders already mapped to job cards" icon={ClipboardCheck} tone="emerald" />
          <MetricCard label="Open quantity" value={`${metrics.openQty.toLocaleString("en-IN", { maximumFractionDigits: 0 })} pcs`} detail="Pieces still open across all in-scope orders" icon={Factory} tone="violet" />
          <MetricCard label="Expired SOs" value={metrics.expiredOpen.toLocaleString("en-IN")} detail={`${metrics.expiringSoon} more expire within 7 days · consider a customer hold`} icon={TimerOff} tone={metrics.expiredOpen ? "rose" : "slate"} />
          <MetricCard label="On customer hold" value={`${metrics.holdQty.toLocaleString("en-IN", { maximumFractionDigits: 0 })} pcs`} detail={`${metrics.heldOrders} order${metrics.heldOrders === 1 ? "" : "s"} held and closed`} icon={PauseCircle} tone="amber" />
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
            <button type="button" className="erp-btn-secondary !h-9" onClick={() => void exportRegister()} disabled={!orders.length}><Download className="h-4 w-4" /><span className="hidden sm:inline">Excel</span></button>
            <button type="button" className="erp-btn-secondary !h-9" onClick={() => window.print()}><Printer className="h-4 w-4" /><span className="hidden sm:inline">Print</span></button>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {ordersQuery.isFetching ? "Refreshing…" : orders.length ? `${offset + 1}–${offset + orders.length}${hasNextPage ? "+" : ""}` : ""}
            </span>
          </div>

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
                  const releaseBusy = releaseMachinesLoadingOrderId === orderId
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
                              disabled={releaseSync.isPending || releasePreflight.isPending || releaseBusy || selectedLineIds.length === 0 || !canRelease}
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

      <Dialog open={Boolean(releaseDialogOrder)} onOpenChange={(open) => (!open ? closeReleaseDialog() : null)}>
        <DialogContent
          data-testid="sales-orders:release-dialog"
          className="max-h-[calc(100vh-2rem)] overflow-hidden rounded-[1.75rem] border-border bg-muted p-0 shadow-2xl"
          style={{ width: "min(1180px, calc(100vw - 2rem))", maxWidth: "none" }}
        >
          <div className="flex max-h-[calc(100vh-2rem)] min-h-[560px] flex-col">
            <DialogHeader className="shrink-0 border-b border-border bg-card px-5 py-4 sm:px-7">
              <div className="flex items-start gap-3 pr-8">
                <div className="mt-0.5 rounded-xl bg-foreground p-2.5 text-background">
                  <Factory className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-xl text-foreground sm:text-2xl">Release to planning</DialogTitle>
                  <DialogDescription className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
                    Choose a winder name or number as a planning hint. The planner can use any available winder; geometry and mandrel differences are advisory.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {releaseOutcome ? (
                <section className="space-y-4 px-5 py-6 sm:px-7" data-testid="sales-orders:release-next-step">
                  {releaseOutcome.syncPending ? (
                    <div className="rounded-2xl border border-signal-amber-line bg-signal-amber-soft px-4 py-3 text-sm text-signal-amber-ink">
                      Release recorded — planning synchronization pending. Do not create a second release; retry the handoff from this lot.
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-signal-emerald-line bg-signal-emerald-soft px-4 py-3 text-sm text-signal-emerald-ink">
                      Job card created. Open the planning queue and schedule on any available winder.
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground">
                    Release lots: {releaseOutcome.lotIds.map((id) => id.slice(0, 8)).join(", ") || "recorded"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`/planning/board?section=winder&machine_id=${releaseOutcome.winderMachineId}&order_id=${releaseOutcome.orderId}`}
                      className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
                      data-testid="sales-orders:open-winder-queue"
                    >
                      Open planning queue
                    </a>
                    <Link
                      href={`/sales-orders/${releaseOutcome.orderId}`}
                      className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-muted-foreground"
                    >
                      Stay on this order
                    </Link>
                  </div>
                </section>
              ) : null}
              {releaseDialogOrder && !releaseOutcome ? (
                <section className="border-b border-border bg-card px-5 py-4 sm:px-7">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-lg font-semibold text-foreground">
                          {releaseDialogOrder.po_number || releaseDialogOrder.order_no}
                        </p>
                        <StatusBadge value={releaseDialogOrder.status} />
                        {releaseSummary.pendingCount > 0 ? (
                          <span className="rounded-full border border-signal-amber-line bg-signal-amber-soft px-2.5 py-1 text-[11px] font-semibold text-signal-amber-ink">
                            {releaseSummary.pendingCount} handoff{releaseSummary.pendingCount === 1 ? "" : "s"} to recover
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {resolveCustomerLabel(releaseDialogOrder, customerMap)}
                      </p>
                    </div>
                    <div className="grid grid-cols-3 overflow-hidden rounded-2xl border border-border bg-muted lg:min-w-[420px]">
                      {[
                        ["Lines", releaseSummary.selectedCount.toFixed(0)],
                        ["Release now", `${releaseSummary.totalQty.toFixed(0)} pcs`],
                        ["Winders", releaseSummary.machineCount.toFixed(0)],
                      ].map(([label, value], index) => (
                        <div key={label} className={`px-4 py-3 ${index > 0 ? "border-l border-border" : ""}`}>
                          <p className="text-[11.5px] font-semibold text-muted-foreground">{label}</p>
                          <p className="mt-1 text-base font-semibold text-foreground">{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}

              {!releaseOutcome ? (
              <div className="space-y-3 px-5 py-5 sm:px-7">
                {releaseDraftRows.map((row) => {
                  const line = releaseDialogOrder?.lines?.find((entry: any) => String(entry.id) === row.sales_order_line_id)
                  const fullQty = Math.max(1, Math.floor(row.remaining_qty))
                  const halfQty = Math.max(1, Math.floor(row.remaining_qty / 2))
                  const quarterQty = Math.max(1, Math.floor(row.remaining_qty / 4))
                  const releaseQty = Number(row.release_qty || 0)
                  const balanceAfter = row.mode === "resume" ? 0 : Math.max(row.remaining_qty - releaseQty, 0)
                  const selectedMachine = (row.authorized_winders.length ? row.authorized_winders : row.compatible_winders).find((machine) => String(machine.id) === row.winder_machine_id)
                  const rowIssue = row.blocker || (
                    releaseQty <= 0 || releaseQty > row.remaining_qty
                      ? `Line ${line?.line_no || "-"}: quantity must be between 1 and ${row.remaining_qty.toFixed(0)} pcs`
                      : !row.winder_machine_id
                        ? `Line ${line?.line_no || "-"}: select a winder queue`
                        : null
                  )
                  return (
                    <article
                      key={row.release_lot_id}
                      className={`overflow-hidden rounded-[1.35rem] border bg-card shadow-sm ${rowIssue ? "border-signal-rose-line" : "border-border"}`}
                    >
                      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(190px,1.1fr)_180px_minmax(280px,1.25fr)_150px] lg:items-start">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[12px] font-semibold text-muted-foreground">
                              Line {line?.line_no || "-"}
                            </span>
                            <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${row.mode === "resume" ? "bg-signal-amber-soft text-signal-amber-ink" : "bg-signal-cyan-soft text-signal-cyan-ink"}`}>
                              {row.mode === "resume" ? "Pending handoff" : "New release"}
                            </span>
                          </div>
                          <h4 className="mt-2 truncate text-lg font-semibold text-foreground">{row.product_code || "No product code"}</h4>
                          <p className="mt-1 text-sm text-muted-foreground">Due {formatDate(row.due_date)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {parchmentLineLabel(line || {})}
                          </p>
                        </div>

                        <div>
                          <label className="text-[11.5px] font-semibold text-muted-foreground">
                            Production quantity
                          </label>
                          <div className="relative mt-2">
                            <input
                              data-testid="sales-orders:release-qty"
                              type="number"
                              min="1"
                              max={row.remaining_qty}
                              readOnly={row.mode === "resume"}
                              value={row.release_qty}
                              onChange={(event) => updateReleaseDraftRow(row.release_lot_id, { release_qty: event.target.value, blocker: null })}
                              className="h-11 w-full rounded-xl border border-border bg-card px-3 pr-11 text-base font-semibold text-foreground read-only:bg-muted read-only:text-muted-foreground"
                            />
                            <span className="pointer-events-none absolute right-3 top-3 text-xs font-semibold text-muted-foreground">pcs</span>
                          </div>
                          {row.mode === "new" ? (
                            <div className="mt-2 flex gap-1.5">
                              {[
                                { label: "25%", qty: quarterQty },
                                { label: "50%", qty: halfQty },
                                { label: "Full", qty: fullQty },
                              ].map((preset) => (
                                <button
                                  key={preset.label}
                                  type="button"
                                  onClick={() => updateReleaseDraftRow(row.release_lot_id, { release_qty: String(preset.qty), blocker: null })}
                                  className="rounded-lg border border-border bg-muted px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:border-border hover:bg-card"
                                >
                                  {preset.label}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-2 text-[11px] leading-4 text-signal-amber-ink">Already reserved; quantity is locked.</p>
                          )}
                        </div>

                        <div>
                          <div className="flex items-center justify-between gap-3">
                            <label className="text-[11.5px] font-semibold text-muted-foreground">Winder queue</label>
                            {row.compatibility_warning ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-signal-amber-ink">
                                Advisory mismatch
                              </span>
                            ) : row.winder_machine_id ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-signal-emerald-ink">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Queue ready
                              </span>
                            ) : null}
                          </div>
                          <select
                            data-testid="sales-orders:release-winder"
                            value={row.winder_machine_id}
                            onChange={(event) => updateReleaseDraftRow(row.release_lot_id, { winder_machine_id: event.target.value, blocker: null })}
                            className="mt-2 h-11 w-full rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground"
                          >
                            <option value="">Select winder queue</option>
                            {(row.authorized_winders.length ? row.authorized_winders : row.compatible_winders).map((machine) => (
                              <option key={machine.id} value={machine.id}>
                                {machine.code || machine.name} · {machine.capacity_value || "-"} {formatCapacityUnit(machine.capacity_unit || machine.capacity_type)}
                              </option>
                            ))}
                          </select>
                          {selectedMachine ? (
                            <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                              ID {selectedMachine.id_min_mm || "-"}–{selectedMachine.id_max_mm || "-"} · OD {selectedMachine.od_min_mm || "-"}–{selectedMachine.od_max_mm || "-"} · Length {selectedMachine.length_min_mm || "-"}–{selectedMachine.length_max_mm || "-"} mm
                              {row.compatibility_warning ? ` · ${row.compatibility_warning}` : ""}
                            </p>
                          ) : (
                            <p className="mt-2 text-[11px] leading-4 text-muted-foreground">Any authorized same-plant winder queue can be selected. Geometry mismatch is advisory only.</p>
                          )}
                        </div>

                        <div className="rounded-xl bg-foreground px-4 py-3 text-background">
                          <p className="text-[11.5px] font-semibold text-muted-foreground">
                            {row.mode === "resume" ? "Planner handoff" : "Balance after"}
                          </p>
                          <p className="mt-1 text-xl font-semibold">
                            {row.mode === "resume" ? "Ready to retry" : `${balanceAfter.toFixed(0)} pcs`}
                          </p>
                          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                            {row.mode === "resume" ? "No quantity will be released twice." : `${row.remaining_qty.toFixed(0)} pcs available now`}
                          </p>
                        </div>
                      </div>

                      {rowIssue ? (
                        <div className="border-t border-signal-rose-line bg-signal-rose-soft px-5 py-3 text-sm font-medium text-signal-rose-ink" data-testid="sales-orders:release-blocker">
                          {rowIssue}
                        </div>
                      ) : null}
                    </article>
                  )
                })}
              </div>
              ) : null}
            </div>

            <DialogFooter className="shrink-0 items-center border-t border-border bg-card px-5 py-4 sm:flex-row sm:justify-between sm:px-7 sm:space-x-0">
              {releaseOutcome ? (
                <div className="flex w-full justify-end">
                  <button
                    type="button"
                    onClick={closeReleaseDialog}
                    className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted"
                  >
                    Close
                  </button>
                </div>
              ) : (
              <>
              <div className="mb-3 flex items-center gap-2 text-sm sm:mb-0">
                {releaseSummary.blockers > 0 ? (
                  <span className="font-semibold text-signal-rose-ink">{releaseSummary.blockers} blocker{releaseSummary.blockers === 1 ? "" : "s"} to resolve</span>
                ) : (
                  <span className="inline-flex items-center gap-2 font-semibold text-signal-emerald-ink">
                    <CheckCircle2 className="h-4 w-4" /> All lines ready for planning
                  </span>
                )}
                <span className="hidden text-muted-foreground sm:inline">|</span>
                <span className="hidden text-muted-foreground sm:inline">{releaseSummary.totalQty.toFixed(0)} pcs across {releaseSummary.selectedCount} line{releaseSummary.selectedCount === 1 ? "" : "s"}</span>
              </div>
              <div className="flex w-full gap-2 sm:w-auto">
                <button
                  type="button"
                  onClick={closeReleaseDialog}
                  className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted sm:flex-none"
                >
                  Cancel
                </button>
                <button
                  data-testid="sales-orders:confirm-release"
                  type="button"
                  onClick={handleConfirmRelease}
                  disabled={releaseSummary.blockers > 0 || releasePreflight.isPending || releaseOrderLine.isPending || releaseSync.isPending}
                  className="flex-1 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
                >
                  {releasePreflight.isPending || releaseOrderLine.isPending || releaseSync.isPending
                    ? "Validating and releasing..."
                    : releaseSummary.pendingCount === releaseSummary.selectedCount
                      ? "Complete planner handoff"
                      : `Release ${releaseSummary.totalQty.toFixed(0)} pcs`}
                </button>
              </div>
              </>
              )}
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
