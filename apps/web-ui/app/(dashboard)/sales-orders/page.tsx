"use client"

import dayjs from "dayjs"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowRightLeft,
  CheckCircle2,
  ClipboardCheck,
  Factory,
  Plus,
  Search,
} from "lucide-react"
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react"

import {
  EmptyState,
  ExecutiveHero,
  MetricCard,
  MetricRail,
  Panel,
  StatusBadge,
} from "@/components/erp/shell"
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
  useReleaseSalesOrderLine,
  useSalesOrders,
} from "@/hooks/use-sales"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"
import { type ReleaseMachine } from "@/lib/sales-release"

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
  compatible_winders: ReleaseMachine[]
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
          compatible_winders: [],
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
        compatible_winders: [],
        blocker: null,
      }]
    })
}

function orderPlantId(order: any) {
  const value = String(order?.plant_id || order?.plant || "").trim()
  return value && value.toUpperCase() !== "ALL" ? value : undefined
}

export default function SalesOrdersPage() {
  const router = useRouter()
  const { showToast } = useApp()
  const { setActivePlant } = useAuth()
  const [search, setSearch] = useState("")
  const [selectedLines, setSelectedLines] = useState<Record<string, string[]>>({})
  const [syncResults, setSyncResults] = useState<SyncResultMap>({})
  const [releaseDialogOrder, setReleaseDialogOrder] = useState<any | null>(null)
  const [releaseDraftRows, setReleaseDraftRows] = useState<ReleaseDraftRow[]>([])
  const [releaseMachinesLoadingOrderId, setReleaseMachinesLoadingOrderId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState("open")
  const [pageSize, setPageSize] = useState(10)
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

  const metrics = useMemo(() => {
    const draftOrders = orders.filter((order: any) => order.status === "draft" || order.status === "submitted")
    const readyOrders = orders.filter((order: any) =>
      ["approved", "released", "partially_released", "partially_dispatched"].includes(order.status),
    )
    const syncedOrders = orders.filter((order: any) => (jobsByOrderId.get(String(order.id)) || []).length > 0)
    const openQty = orders.reduce((sum: number, order: any) => sum + Number(order.remaining_qty || 0), 0)
    return {
      draftOrders,
      readyOrders,
      syncedOrders,
      openQty,
    }
  }, [jobsByOrderId, orders])

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
        const compatibleWinders = Array.isArray(result?.compatible_winders) ? result.compatible_winders : []
        const selectedWinder = result?.selected_winder_compatible
          ? row.winder_machine_id
          : String(compatibleWinders[0]?.id || "")
        return {
          ...row,
          compatible_winders: compatibleWinders,
          winder_machine_id: selectedWinder,
          blocker: compatibleWinders.length > 0 ? null : String(result?.blocker || "No compatible winder is available."),
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

  const closeReleaseDialog = () => {
    setReleaseDialogOrder(null)
    setReleaseDraftRows([])
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

      const jobCardIds = Array.isArray(response?.data?.line_results)
        ? response.data.line_results.map((row: any) => String(row.job_card_id)).filter(Boolean)
        : []

      setSelectedLines((current) => ({ ...current, [String(releaseDialogOrder.id)]: [] }))
      setSyncResults((current) => ({ ...current, [String(releaseDialogOrder.id)]: jobCardIds }))
      showToast(`Released ${persistedRows.length} line bucket(s) into planner.`, "success")
      const releasedPlantId = orderPlantId(releaseDialogOrder)
      if (releasedPlantId) setActivePlant(releasedPlantId)
      closeReleaseDialog()
      router.push(`/planning/board?section=winder&order_id=${releaseDialogOrder.id}`)
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Release sync failed."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    }
  }

  return (
    <>
      <div className="space-y-6" data-testid="sales-orders:page">
        <ExecutiveHero
          appearance={MODULE_APPEARANCES.sales}
          badge="Sales Queue"
          title="Long-horizon POs, partial releases, and planner handoff"
          description="Customer POs can span weeks. Each line keeps its own product code, parchment condition, and repeated release flow into planning whenever production asks for more."
          aside={
            <div className="space-y-3">
              <div className="rounded-[1.15rem] border border-white/10 bg-white/10 p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-emerald-100">Release Discipline</p>
                <p className="mt-2 text-3xl font-semibold">{metrics.readyOrders.length}</p>
                <p className="mt-1 text-xs text-emerald-100/80">Orders ready for line-level release planning</p>
              </div>
              <Link
                href="/sales-orders/new"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-lg"
              >
                <Plus className="h-4 w-4" />
                New sales order
              </Link>
            </div>
          }
        />

        <MetricRail>
          <MetricCard
            label="Draft Queue"
            value={metrics.draftOrders.length}
            detail="Draft orders awaiting commercial approval"
            icon={CheckCircle2}
            tone="amber"
          />
          <MetricCard
            label="Release Ready"
            value={metrics.readyOrders.length}
            detail="Approved rows waiting for winder selection"
            icon={ArrowRightLeft}
            tone="cyan"
          />
          <MetricCard
            label="Planner Synced"
            value={metrics.syncedOrders.length}
            detail="Visible orders already mapped to job cards"
            icon={ClipboardCheck}
            tone="emerald"
          />
          <MetricCard
            label="Open Qty"
            value={metrics.openQty.toFixed(0)}
            detail="Pieces still open in this loaded window"
            icon={Factory}
            tone="violet"
          />
        </MetricRail>

        <Panel
          title="Commercial Release Studio"
          subtitle="Scan each PO as a long-running commercial contract, select the exact live line buckets, then release only what production needs."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex w-full min-w-[18rem] items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3 shadow-sm sm:w-[26rem]">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => {
                    const nextValue = event.target.value
                    startTransition(() => setSearch(nextValue))
                  }}
                  placeholder="Search PO, product code, parchment..."
                  className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-12 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
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
              <select
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
                className="h-12 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
              >
                <option value={10}>10 / page</option>
                <option value={25}>25 / page</option>
                <option value={50}>50 / page</option>
              </select>
            </div>
          }
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[1.2rem] border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-600">
            <span>
              Window {offset + 1}-{offset + orders.length} · Page {pageIndex + 1} · {statusFilter === "open" ? "open orders" : statusFilter.replaceAll("_", " ")}
            </span>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              {ordersQuery.isFetching ? "Refreshing..." : hasNextPage ? "More rows available" : "End of current window"}
            </span>
          </div>
          {ordersQuery.isLoading ? (
            <EmptyState label="Loading live sales orders..." />
          ) : orders.length === 0 ? (
            <EmptyState label="No sales orders matched this queue yet." />
          ) : (
            <div className="space-y-5">
              {orders.map((order: any) => {
                const selectedLineIds = selectedLines[String(order.id)] || []
                const linkedJobs = jobsByOrderId.get(String(order.id)) || []
                const locallySynced = syncResults[String(order.id)] || []
                const hasSyncedJobs = linkedJobs.length > 0 || locallySynced.length > 0

                return (
                  <section
                    key={order.id}
                    data-order-id={order.id}
                    className="overflow-hidden rounded-[1.9rem] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.08)]"
                  >
                    <div className="grid gap-0 xl:grid-cols-[320px_minmax(0,1fr)_340px]">
                      <div className="border-b border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#eff6ff_100%)] p-6 xl:border-b-0 xl:border-r">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Customer PO</p>
                        <Link
                          href={`/sales-orders/${order.id}`}
                          data-testid="sales-orders:detail-link"
                          className="mt-3 block text-[1.8rem] font-semibold leading-tight tracking-tight text-slate-950 transition-colors duration-200 hover:text-cyan-700"
                        >
                          {order.po_number || order.order_no || order.id}
                        </Link>
                        <p className="mt-3 text-sm font-semibold text-slate-900">{resolveCustomerLabel(order, customerMap)}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          Internal {order.order_no || String(order.id).slice(0, 8)}
                        </p>

                        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                          <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
                            <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Commercial Volume</p>
                            <p className="mt-1 text-xl font-semibold text-slate-950">{Number(order.total_qty || 0).toFixed(0)} pcs</p>
                          </div>
                          <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
                            <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Selected For Release</p>
                            <p className="mt-1 text-xl font-semibold text-slate-950">{selectedLineIds.length} line(s)</p>
                          </div>
                        </div>

                        <div className="mt-5 text-sm text-slate-600">
                          <p>PO date {formatDate(order.po_date || order.created_at)}</p>
                          <p className="mt-1">
                            Earliest due{" "}
                            {formatDate(
                              [...(order.lines || [])]
                                .map((line: any) => line.due_date)
                                .filter(Boolean)
                                .sort()[0],
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="p-6">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Release Buckets</p>
                            <p className="mt-1 text-sm text-slate-600">
                              Pick the exact line items production needs right now. One PO can release many times over its life.
                            </p>
                          </div>
                          <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                            {order.lines?.length || 0} line(s)
                          </div>
                        </div>

                        <div className="grid gap-3 lg:grid-cols-2">
                          {(order.lines || []).map((line: any) => {
                            const checked = selectedLineIds.includes(String(line.id))
                            const releaseRemainingQty = Number(line.release_remaining_qty ?? line.remaining_qty ?? 0)
                            const releaseable = releaseRemainingQty > 0
                            return (
                              <label
                                key={line.id}
                                className={`group relative flex cursor-pointer gap-3 rounded-[1.35rem] border px-4 py-4 transition-all duration-200 ${
                                  checked
                                    ? "border-cyan-300 bg-cyan-50/80 shadow-[0_14px_30px_rgba(14,165,233,0.10)]"
                                    : "border-slate-200 bg-slate-50/80 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white"
                                } ${!releaseable ? "cursor-not-allowed opacity-60" : ""}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!releaseable}
                                  onChange={(event) =>
                                    updateSelectedLines(String(order.id), String(line.id), event.target.checked)
                                  }
                                  className="mt-1 h-4 w-4 rounded border-slate-300"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-semibold text-slate-950">
                                    Line {line.line_no || "-"} · {line.product_code || "No product code"}
                                  </span>
                                  <span className="mt-2 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                                    <span>Ordered {Number(line.qty || 0).toFixed(0)} pcs</span>
                                    <span>Remaining {releaseRemainingQty.toFixed(0)} pcs</span>
                                    <span>Due {formatDate(line.due_date)}</span>
                                    <span>{line.parchment_color ? `Parchment ${line.parchment_color}` : "No parchment note"}</span>
                                  </span>
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      </div>

                      <div className="border-t border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-6 xl:border-l xl:border-t-0">
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Release Posture</p>
                              <div className="mt-2">
                                <StatusBadge value={order.status} />
                              </div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-right">
                              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Released / Fulfilled</p>
                              <p className="mt-1 text-lg font-semibold text-slate-950">
                                {Number(order.released_qty || 0).toFixed(0)} / {Number(order.fulfilled_qty || 0).toFixed(0)}
                              </p>
                            </div>
                          </div>

                          <div className="grid gap-2 sm:grid-cols-2">
                            <Link
                              href={`/sales-orders/${order.id}`}
                              data-testid="sales-orders:view-link"
                              className="rounded-xl border border-slate-300 px-3 py-3 text-center text-sm font-semibold text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-sm"
                            >
                              View order
                            </Link>
                            <Link
                              href={`/sales-orders/${order.id}/audit`}
                              className="rounded-xl border border-slate-300 px-3 py-3 text-center text-sm font-semibold text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-sm"
                            >
                              Audit trail
                            </Link>
                          </div>

                          {order.status === "draft" || order.status === "submitted" ? (
                            <button
                              type="button"
                              onClick={() => handleApprove(order)}
                              disabled={approveOrder.isPending}
                              className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 transition-all duration-200 hover:-translate-y-0.5 hover:bg-emerald-100 hover:shadow-sm disabled:opacity-60"
                            >
                              Approve commercial PO
                            </button>
                          ) : null}

                          <button
                            type="button"
                            onClick={() => openReleaseDialog(order)}
                            disabled={
                              releaseSync.isPending ||
                              releasePreflight.isPending ||
                              releaseMachinesLoadingOrderId === String(order.id) ||
                              selectedLineIds.length === 0 ||
                              !["approved", "released", "partially_released", "partially_dispatched"].includes(order.status)
                            }
                            className="w-full rounded-[1.1rem] bg-slate-900 px-4 py-3.5 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {releaseMachinesLoadingOrderId === String(order.id)
                              ? "Checking machine compatibility..."
                              : "Release selected lines to planner"}
                          </button>

                          {hasSyncedJobs ? (
                            <div className="rounded-[1.35rem] border border-emerald-200 bg-emerald-50/90 p-4 text-sm text-emerald-900">
                              <div className="font-semibold">Planner-linked job cards</div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {[...linkedJobs.map((job: any) => String(job.id)), ...locallySynced]
                                  .filter((value, index, rows) => rows.indexOf(value) === index)
                                  .slice(0, 6)
                                  .map((jobCardId) => (
                                    <Link
                                      key={jobCardId}
                                      href={`/production/job-cards/${jobCardId}`}
                                      className="rounded-full border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:-translate-y-0.5 hover:shadow-sm"
                                    >
                                      {jobCardId.slice(0, 8)}
                                    </Link>
                                  ))}
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-[1.2rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                              No planner job cards yet. The release action above will create the production cut for the selected lines.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>
                )
              })}
            </div>
          )}
          {orders.length > 0 ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[1.2rem] border border-slate-200 bg-white px-4 py-3">
              <p className="text-sm text-slate-600">
                Large queue mode keeps only {pageSize} order cards mounted at once.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
                  disabled={pageIndex === 0 || ordersQuery.isFetching}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPageIndex((current) => current + 1)}
                  disabled={!hasNextPage || ordersQuery.isFetching}
                  className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </Panel>
      </div>

      <Dialog open={Boolean(releaseDialogOrder)} onOpenChange={(open) => (!open ? closeReleaseDialog() : null)}>
        <DialogContent
          data-testid="sales-orders:release-dialog"
          className="max-h-[calc(100vh-2rem)] overflow-hidden rounded-[1.75rem] border-slate-200 bg-slate-50 p-0 shadow-2xl"
          style={{ width: "min(1180px, calc(100vw - 2rem))", maxWidth: "none" }}
        >
          <div className="flex max-h-[calc(100vh-2rem)] min-h-[560px] flex-col">
            <DialogHeader className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
              <div className="flex items-start gap-3 pr-8">
                <div className="mt-0.5 rounded-xl bg-slate-950 p-2.5 text-white">
                  <Factory className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-xl text-slate-950 sm:text-2xl">Release to planning</DialogTitle>
                  <DialogDescription className="mt-1 max-w-3xl text-sm leading-5 text-slate-600">
                    Make one safe production cut from this PO. Only winders that cover the approved specification are available.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {releaseDialogOrder ? (
                <section className="border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-lg font-semibold text-slate-950">
                          {releaseDialogOrder.po_number || releaseDialogOrder.order_no}
                        </p>
                        <StatusBadge value={releaseDialogOrder.status} />
                        {releaseSummary.pendingCount > 0 ? (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                            {releaseSummary.pendingCount} handoff{releaseSummary.pendingCount === 1 ? "" : "s"} to recover
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-sm text-slate-600">
                        {resolveCustomerLabel(releaseDialogOrder, customerMap)}
                      </p>
                    </div>
                    <div className="grid grid-cols-3 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 lg:min-w-[420px]">
                      {[
                        ["Lines", releaseSummary.selectedCount.toFixed(0)],
                        ["Release now", `${releaseSummary.totalQty.toFixed(0)} pcs`],
                        ["Winders", releaseSummary.machineCount.toFixed(0)],
                      ].map(([label, value], index) => (
                        <div key={label} className={`px-4 py-3 ${index > 0 ? "border-l border-slate-200" : ""}`}>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
                          <p className="mt-1 text-base font-semibold text-slate-950">{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}

              <div className="space-y-3 px-5 py-5 sm:px-7">
                {releaseDraftRows.map((row) => {
                  const line = releaseDialogOrder?.lines?.find((entry: any) => String(entry.id) === row.sales_order_line_id)
                  const fullQty = Math.max(1, Math.floor(row.remaining_qty))
                  const halfQty = Math.max(1, Math.floor(row.remaining_qty / 2))
                  const quarterQty = Math.max(1, Math.floor(row.remaining_qty / 4))
                  const releaseQty = Number(row.release_qty || 0)
                  const balanceAfter = row.mode === "resume" ? 0 : Math.max(row.remaining_qty - releaseQty, 0)
                  const selectedMachine = row.compatible_winders.find((machine) => String(machine.id) === row.winder_machine_id)
                  const rowIssue = row.blocker || (
                    releaseQty <= 0 || releaseQty > row.remaining_qty
                      ? `Line ${line?.line_no || "-"}: quantity must be between 1 and ${row.remaining_qty.toFixed(0)} pcs`
                      : !row.winder_machine_id
                        ? `Line ${line?.line_no || "-"}: select a compatible winder`
                        : null
                  )
                  return (
                    <article
                      key={row.release_lot_id}
                      className={`overflow-hidden rounded-[1.35rem] border bg-white shadow-sm ${rowIssue ? "border-rose-200" : "border-slate-200"}`}
                    >
                      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(190px,1.1fr)_180px_minmax(280px,1.25fr)_150px] lg:items-start">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                              Line {line?.line_no || "-"}
                            </span>
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${row.mode === "resume" ? "bg-amber-50 text-amber-800" : "bg-cyan-50 text-cyan-800"}`}>
                              {row.mode === "resume" ? "Pending handoff" : "New release"}
                            </span>
                          </div>
                          <h4 className="mt-2 truncate text-lg font-semibold text-slate-950">{row.product_code || "No product code"}</h4>
                          <p className="mt-1 text-sm text-slate-600">Due {formatDate(row.due_date)}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {line?.parchment_color ? `Parchment: ${line.parchment_color}` : "No parchment condition"}
                          </p>
                        </div>

                        <div>
                          <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
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
                              className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 pr-11 text-base font-semibold text-slate-950 read-only:bg-slate-50 read-only:text-slate-600"
                            />
                            <span className="pointer-events-none absolute right-3 top-3 text-xs font-semibold text-slate-500">pcs</span>
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
                                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:border-slate-300 hover:bg-white"
                                >
                                  {preset.label}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-2 text-[11px] leading-4 text-amber-700">Already reserved; quantity is locked.</p>
                          )}
                        </div>

                        <div>
                          <div className="flex items-center justify-between gap-3">
                            <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Starting winder</label>
                            {!rowIssue && row.winder_machine_id ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Compatible
                              </span>
                            ) : null}
                          </div>
                          <select
                            data-testid="sales-orders:release-winder"
                            value={row.winder_machine_id}
                            onChange={(event) => updateReleaseDraftRow(row.release_lot_id, { winder_machine_id: event.target.value, blocker: null })}
                            className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900"
                          >
                            <option value="">Select compatible winder</option>
                            {row.compatible_winders.map((machine) => (
                              <option key={machine.id} value={machine.id}>
                                {machine.code || machine.name} · {machine.capacity_value || "-"} {formatCapacityUnit(machine.capacity_unit || machine.capacity_type)}
                              </option>
                            ))}
                          </select>
                          {selectedMachine ? (
                            <p className="mt-2 text-[11px] leading-4 text-slate-500">
                              ID {selectedMachine.id_min_mm || "-"}–{selectedMachine.id_max_mm || "-"} · OD {selectedMachine.od_min_mm || "-"}–{selectedMachine.od_max_mm || "-"} · Length {selectedMachine.length_min_mm || "-"}–{selectedMachine.length_max_mm || "-"} mm
                            </p>
                          ) : (
                            <p className="mt-2 text-[11px] leading-4 text-slate-500">Only live, active, specification-compatible machines appear.</p>
                          )}
                        </div>

                        <div className="rounded-xl bg-slate-950 px-4 py-3 text-white">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300">
                            {row.mode === "resume" ? "Planner handoff" : "Balance after"}
                          </p>
                          <p className="mt-1 text-xl font-semibold">
                            {row.mode === "resume" ? "Ready to retry" : `${balanceAfter.toFixed(0)} pcs`}
                          </p>
                          <p className="mt-1 text-[11px] leading-4 text-slate-300">
                            {row.mode === "resume" ? "No quantity will be released twice." : `${row.remaining_qty.toFixed(0)} pcs available now`}
                          </p>
                        </div>
                      </div>

                      {rowIssue ? (
                        <div className="border-t border-rose-200 bg-rose-50 px-5 py-3 text-sm font-medium text-rose-800" data-testid="sales-orders:release-blocker">
                          {rowIssue}
                        </div>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            </div>

            <DialogFooter className="shrink-0 items-center border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-between sm:px-7 sm:space-x-0">
              <div className="mb-3 flex items-center gap-2 text-sm sm:mb-0">
                {releaseSummary.blockers > 0 ? (
                  <span className="font-semibold text-rose-700">{releaseSummary.blockers} blocker{releaseSummary.blockers === 1 ? "" : "s"} to resolve</span>
                ) : (
                  <span className="inline-flex items-center gap-2 font-semibold text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> All lines ready for planning
                  </span>
                )}
                <span className="hidden text-slate-300 sm:inline">|</span>
                <span className="hidden text-slate-600 sm:inline">{releaseSummary.totalQty.toFixed(0)} pcs across {releaseSummary.selectedCount} line{releaseSummary.selectedCount === 1 ? "" : "s"}</span>
              </div>
              <div className="flex w-full gap-2 sm:w-auto">
                <button
                  type="button"
                  onClick={closeReleaseDialog}
                  className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:flex-none"
                >
                  Cancel
                </button>
                <button
                  data-testid="sales-orders:confirm-release"
                  type="button"
                  onClick={handleConfirmRelease}
                  disabled={releaseSummary.blockers > 0 || releasePreflight.isPending || releaseOrderLine.isPending || releaseSync.isPending}
                  className="flex-1 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
                >
                  {releasePreflight.isPending || releaseOrderLine.isPending || releaseSync.isPending
                    ? "Validating and releasing..."
                    : releaseSummary.pendingCount === releaseSummary.selectedCount
                      ? "Complete planner handoff"
                      : `Release ${releaseSummary.totalQty.toFixed(0)} pcs`}
                </button>
              </div>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
