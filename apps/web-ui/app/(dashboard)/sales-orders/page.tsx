"use client"

import dayjs from "dayjs"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowRightLeft,
  CheckCircle2,
  ClipboardCheck,
  Factory,
  PackageSearch,
  Plus,
  Search,
} from "lucide-react"
import { startTransition, useDeferredValue, useMemo, useState } from "react"

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
import { useCustomers } from "@/hooks/use-master-data"
import {
  useMachines,
  usePlanningJobCards,
  useReleaseSyncSalesOrder,
} from "@/hooks/use-production"
import {
  useApproveSalesOrder,
  useReleaseSalesOrder,
  useSalesOrders,
} from "@/hooks/use-sales"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"

type SyncResultMap = Record<string, string[]>

type ReleaseDraftRow = {
  sales_order_line_id: string
  release_lot_id: string
  product_code: string
  due_date: string | null
  remaining_qty: number
  release_qty: string
  winder_machine_id: string
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

function buildReleaseRows(order: any, selectedLineIds: string[], defaultMachineId: string) {
  return (order.lines || [])
    .filter((line: any) => selectedLineIds.includes(String(line.id)))
    .map((line: any) => ({
      sales_order_line_id: String(line.id),
      release_lot_id: crypto.randomUUID(),
      product_code: String(line.product_code || order.po_number || order.order_no || "").trim(),
      due_date: line.due_date || null,
      remaining_qty: Number(line.remaining_qty || line.qty || 0),
      release_qty: Number(line.remaining_qty || line.qty || 0).toFixed(0),
      winder_machine_id: defaultMachineId,
    }))
}

export default function SalesOrdersPage() {
  const router = useRouter()
  const { showToast } = useApp()
  const [search, setSearch] = useState("")
  const [selectedLines, setSelectedLines] = useState<Record<string, string[]>>({})
  const [syncResults, setSyncResults] = useState<SyncResultMap>({})
  const [releaseDialogOrder, setReleaseDialogOrder] = useState<any | null>(null)
  const [releaseDraftRows, setReleaseDraftRows] = useState<ReleaseDraftRow[]>([])
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())

  const ordersQuery = useSalesOrders()
  const customersQuery = useCustomers()
  const machinesQuery = useMachines()
  const jobCardsQuery = usePlanningJobCards({ limit: 500 })

  const approveOrder = useApproveSalesOrder()
  const releaseOrder = useReleaseSalesOrder()
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

  const winderMachines = useMemo(
    () =>
      ((Array.isArray(machinesQuery.data) ? machinesQuery.data : []) as any[])
        .filter((machine) => String(machine?.department || "").toUpperCase() === "WINDER")
        .sort((left, right) => String(left?.code || left?.name || "").localeCompare(String(right?.code || right?.name || ""))),
    [machinesQuery.data],
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

  const orders = useMemo(() => {
    const rows = Array.isArray(ordersQuery.data) ? ordersQuery.data : []
    if (!deferredSearch) return rows

    return rows.filter((order: any) => {
      const haystack = [
        order.order_no,
        order.po_number,
        resolveCustomerLabel(order, customerMap),
        order.status,
        ...(order.lines || []).flatMap((line: any) => [
          line.id,
          line.line_no,
          line.product_code,
          line.parchment_color,
          line.qty,
          line.due_date,
        ]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(deferredSearch)
    })
  }, [customerMap, deferredSearch, ordersQuery.data])

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

  const handleApprove = async (orderId: string) => {
    try {
      await approveOrder.mutateAsync(orderId)
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
    const defaultMachineId = String(winderMachines[0]?.id || "")
    if (!defaultMachineId) {
      showToast("No winder machine is available in master data for release sync.", "error")
      return
    }
    setReleaseDialogOrder(order)
    setReleaseDraftRows(buildReleaseRows(order, selectedLineIds, defaultMachineId))
  }

  const closeReleaseDialog = () => {
    setReleaseDialogOrder(null)
    setReleaseDraftRows([])
  }

  const updateReleaseDraftRow = (lineId: string, patch: Partial<ReleaseDraftRow>) => {
    setReleaseDraftRows((current) =>
      current.map((row) => (row.sales_order_line_id === lineId ? { ...row, ...patch } : row)),
    )
  }

  const releaseSummary = useMemo(() => {
    const selectedCount = releaseDraftRows.length
    const totalQty = releaseDraftRows.reduce((sum, row) => sum + Number(row.release_qty || 0), 0)
    const machineCount = new Set(releaseDraftRows.map((row) => row.winder_machine_id).filter(Boolean)).size
    return { selectedCount, totalQty, machineCount }
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
      if (String(releaseDialogOrder.status) === "approved") {
        await releaseOrder.mutateAsync(String(releaseDialogOrder.id))
      }

      const response = await releaseSync.mutateAsync({
        salesOrderId: String(releaseDialogOrder.id),
        data: {
          line_ids: normalizedRows.map((row) => row.sales_order_line_id),
          release_rows: normalizedRows.map((row) => ({
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
      showToast(`Released ${normalizedRows.length} line bucket(s) into planner.`, "success")
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
            detail="Needs maker-checker approval"
            icon={CheckCircle2}
            tone="amber"
          />
          <MetricCard
            label="Release Ready"
            value={metrics.readyOrders.length}
            detail="Approved orders waiting for winder selection"
            icon={ArrowRightLeft}
            tone="cyan"
          />
          <MetricCard
            label="Planner Synced"
            value={metrics.syncedOrders.length}
            detail="Orders already mapped to job cards"
            icon={ClipboardCheck}
            tone="emerald"
          />
          <MetricCard
            label="Open Qty"
            value={metrics.openQty.toFixed(0)}
            detail="Pieces still open across all commercial lines"
            icon={Factory}
            tone="violet"
          />
        </MetricRail>

        <Panel
          title="Commercial Release Studio"
          subtitle="Scan each PO as a long-running commercial contract, select the exact live line buckets, then release only what production needs."
          actions={
            <div className="flex w-full max-w-[26rem] items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3 shadow-sm">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => {
                  const nextValue = event.target.value
                  startTransition(() => setSearch(nextValue))
                }}
                placeholder="Search PO, customer, product code, parchment..."
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </div>
          }
        >
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
                            const releaseable = Number(line.remaining_qty || 0) > 0
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
                                    <span>Remaining {Number(line.remaining_qty || 0).toFixed(0)} pcs</span>
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
                              onClick={() => handleApprove(String(order.id))}
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
                              releaseOrder.isPending ||
                              selectedLineIds.length === 0 ||
                              !["approved", "released", "partially_released", "partially_dispatched"].includes(order.status)
                            }
                            className="w-full rounded-[1.1rem] bg-slate-900 px-4 py-3.5 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Release selected lines to planner
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
        </Panel>
      </div>

      <Dialog open={Boolean(releaseDialogOrder)} onOpenChange={(open) => (!open ? closeReleaseDialog() : null)}>
        <DialogContent className="max-w-6xl rounded-[2rem] border-slate-200 p-0">
          <div className="rounded-[1.75rem] bg-white">
            <DialogHeader className="border-b border-slate-200 px-6 py-5">
              <DialogTitle className="text-2xl text-slate-950">
                Release lines into planning
              </DialogTitle>
              <DialogDescription className="text-slate-600">
                Set the exact production quantity and target winder for each selected line. This is the live production cut from the long-horizon customer PO.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-0 xl:grid-cols-[320px_minmax(0,1fr)]">
              {releaseDialogOrder ? (
                <aside className="border-b border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#eff6ff_100%)] p-6 xl:border-b-0 xl:border-r">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Commercial Source</p>
                  <h3 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                    {releaseDialogOrder.po_number || releaseDialogOrder.order_no}
                  </h3>
                  <div className="mt-3">
                    <StatusBadge value={releaseDialogOrder.status} />
                  </div>
                  <p className="mt-4 text-sm font-semibold text-slate-900">
                    {resolveCustomerLabel(releaseDialogOrder, customerMap)}
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    This PO can release multiple times. Each selected row on the right becomes one planner-ready production cut.
                  </p>

                  <div className="mt-6 space-y-3">
                    <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Selected lines</p>
                      <p className="mt-1 text-2xl font-semibold text-slate-950">{releaseSummary.selectedCount}</p>
                    </div>
                    <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Planned release qty</p>
                      <p className="mt-1 text-2xl font-semibold text-slate-950">{releaseSummary.totalQty.toFixed(0)} pcs</p>
                    </div>
                    <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Target winders</p>
                      <p className="mt-1 text-2xl font-semibold text-slate-950">{releaseSummary.machineCount}</p>
                    </div>
                  </div>

                  <div className="mt-6 rounded-[1.25rem] border border-cyan-200 bg-cyan-50 px-4 py-4 text-sm text-cyan-950">
                    <div className="flex items-center gap-2 font-semibold">
                      <PackageSearch className="h-4 w-4" />
                      Planner handoff
                    </div>
                    <p className="mt-2">
                      Confirm release, then jump straight into the winder board with this PO focused for scheduling.
                    </p>
                  </div>
                </aside>
              ) : null}

              <div className="space-y-4 px-6 py-5">
                <div className="grid gap-3 md:grid-cols-2">
                  {releaseDraftRows.map((row) => {
                    const line = releaseDialogOrder?.lines?.find((entry: any) => String(entry.id) === row.sales_order_line_id)
                    const fullQty = Math.max(1, Math.floor(row.remaining_qty))
                    const halfQty = Math.max(1, Math.floor(row.remaining_qty / 2))
                    const quarterQty = Math.max(1, Math.floor(row.remaining_qty / 4))
                    return (
                      <article
                        key={row.sales_order_line_id}
                        className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                              Line {line?.line_no || "-"}
                            </p>
                            <h4 className="mt-2 text-lg font-semibold text-slate-950">{row.product_code || "No product code"}</h4>
                            <p className="mt-2 text-sm text-slate-600">
                              Due {formatDate(row.due_date)} · Remaining {row.remaining_qty.toFixed(0)} pcs
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {line?.parchment_color ? `Parchment ${line.parchment_color}` : "No parchment note"}
                            </p>
                          </div>
                          <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                            {row.remaining_qty.toFixed(0)} pcs open
                          </div>
                        </div>

                        <div className="mt-5 grid gap-4 lg:grid-cols-[160px_minmax(0,1fr)]">
                          <div>
                            <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                              Release qty
                            </label>
                            <input
                              type="number"
                              min="1"
                              max={row.remaining_qty}
                              value={row.release_qty}
                              onChange={(event) =>
                                updateReleaseDraftRow(row.sales_order_line_id, { release_qty: event.target.value })
                              }
                              className="mt-2 h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-base font-semibold text-slate-950"
                            />
                            <div className="mt-3 flex flex-wrap gap-2">
                              {[
                                { label: "25%", qty: quarterQty },
                                { label: "50%", qty: halfQty },
                                { label: "Full", qty: fullQty },
                              ].map((preset) => (
                                <button
                                  key={preset.label}
                                  type="button"
                                  onClick={() =>
                                    updateReleaseDraftRow(row.sales_order_line_id, { release_qty: String(preset.qty) })
                                  }
                                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white"
                                >
                                  {preset.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                              Target winder
                            </label>
                            <select
                              value={row.winder_machine_id}
                              onChange={(event) =>
                                updateReleaseDraftRow(row.sales_order_line_id, {
                                  winder_machine_id: event.target.value,
                                })
                              }
                              className="mt-2 h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm"
                            >
                              <option value="">Select winder</option>
                              {winderMachines.map((machine: any) => (
                                <option key={machine.id} value={machine.id}>
                                  {machine.code || machine.name} · {machine.capacity_value || "-"} {machine.capacity_unit || ""}
                                </option>
                              ))}
                            </select>
                            <p className="mt-3 text-xs text-slate-500">
                              Pick the machine production wants this line to land in before scheduling starts.
                            </p>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </div>
            </div>

            <DialogFooter className="border-t border-slate-200 px-6 py-5">
              <button
                type="button"
                onClick={closeReleaseDialog}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRelease}
                disabled={releaseOrder.isPending || releaseSync.isPending}
                className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-lg disabled:opacity-60"
              >
                {releaseOrder.isPending || releaseSync.isPending ? "Sending to planner..." : "Confirm release"}
              </button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
