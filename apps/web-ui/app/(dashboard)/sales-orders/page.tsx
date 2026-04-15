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
      router.push(`/planning?section=winder&order_id=${releaseDialogOrder.id}`)
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
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900"
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
          title="Commercial Release Queue"
          subtitle="Filter by customer, PO, product code, or parchment. Release only the quantity production needs, line by line."
          actions={
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => {
                  const nextValue = event.target.value
                  startTransition(() => setSearch(nextValue))
                }}
                placeholder="Search PO, customer, product code, parchment..."
                className="w-80 bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </div>
          }
        >
          {ordersQuery.isLoading ? (
            <EmptyState label="Loading live sales orders..." />
          ) : orders.length === 0 ? (
            <EmptyState label="No sales orders matched this queue yet." />
          ) : (
            <div className="overflow-x-auto rounded-[1.35rem] border border-slate-200">
              <table className="min-w-full">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Order</th>
                    <th className="px-4 py-3 text-left">Customer</th>
                    <th className="px-4 py-3 text-left">Timeline</th>
                    <th className="px-4 py-3 text-left">Commercial Lines</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {orders.map((order: any) => {
                    const selectedLineIds = selectedLines[String(order.id)] || []
                    const linkedJobs = jobsByOrderId.get(String(order.id)) || []
                    const locallySynced = syncResults[String(order.id)] || []
                    const hasSyncedJobs = linkedJobs.length > 0 || locallySynced.length > 0

                    return (
                      <tr key={order.id} data-order-id={order.id} className="align-top">
                        <td className="px-4 py-4">
                          <div className="space-y-2">
                            <Link
                              href={`/sales-orders/${order.id}`}
                              className="text-sm font-semibold text-slate-950 hover:text-cyan-700"
                            >
                              {order.po_number || order.order_no || order.id}
                            </Link>
                            <div className="text-xs text-slate-500">
                              Internal {order.order_no || String(order.id).slice(0, 8)}
                            </div>
                            <div className="text-xs text-slate-500">
                              {Number(order.total_qty || 0).toFixed(0)} pcs ordered
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-700">
                          <div className="font-semibold text-slate-900">
                            {resolveCustomerLabel(order, customerMap)}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {order.po_number ? `PO ${order.po_number}` : "No customer PO number"}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-700">
                          <div>PO date {formatDate(order.po_date || order.created_at)}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            Earliest due{" "}
                            {formatDate(
                              [...(order.lines || [])]
                                .map((line: any) => line.due_date)
                                .filter(Boolean)
                                .sort()[0],
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="space-y-2">
                            {(order.lines || []).map((line: any) => (
                              <label
                                key={line.id}
                                className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedLineIds.includes(String(line.id))}
                                  disabled={Number(line.remaining_qty || 0) <= 0}
                                  onChange={(event) =>
                                    updateSelectedLines(
                                      String(order.id),
                                      String(line.id),
                                      event.target.checked,
                                    )
                                  }
                                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                                />
                                <span className="min-w-0">
                                  <span className="block font-semibold text-slate-900">
                                    Line {line.line_no || "-"} · {line.product_code || "No product code"}
                                  </span>
                                  <span className="block text-xs text-slate-500">
                                    Qty {Number(line.qty || 0).toFixed(0)} · Remaining{" "}
                                    {Number(line.remaining_qty || 0).toFixed(0)} · Due {formatDate(line.due_date)}
                                  </span>
                                  {line.parchment_color ? (
                                    <span className="block text-xs text-slate-500">
                                      Parchment {line.parchment_color}
                                    </span>
                                  ) : null}
                                </span>
                              </label>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="space-y-2">
                            <StatusBadge value={order.status} />
                            <div className="text-xs text-slate-500">
                              Released {Number(order.released_qty || 0).toFixed(0)} / Fulfilled{" "}
                              {Number(order.fulfilled_qty || 0).toFixed(0)}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="space-y-3">
                            <div className="flex flex-wrap gap-2">
                              <Link
                                href={`/sales-orders/${order.id}`}
                                className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                View
                              </Link>
                              <Link
                                href={`/sales-orders/${order.id}/audit`}
                                className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                Audit
                              </Link>
                              {order.status === "draft" || order.status === "submitted" ? (
                                <button
                                  type="button"
                                  onClick={() => handleApprove(String(order.id))}
                                  disabled={approveOrder.isPending}
                                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 disabled:opacity-60"
                                >
                                  Approve
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
                                className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Release selected
                              </button>
                            </div>

                            {hasSyncedJobs ? (
                              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                                <div className="font-semibold">Job card(s) synced</div>
                                <div className="mt-1 flex flex-wrap gap-2">
                                  {[...linkedJobs.map((job: any) => String(job.id)), ...locallySynced]
                                    .filter((value, index, rows) => rows.indexOf(value) === index)
                                    .slice(0, 6)
                                    .map((jobCardId) => (
                                      <Link
                                        key={jobCardId}
                                        href={`/production/job-cards/${jobCardId}`}
                                        className="rounded-lg border border-emerald-300 bg-white px-2 py-1 font-semibold text-emerald-800"
                                      >
                                        {jobCardId.slice(0, 8)}
                                      </Link>
                                    ))}
                                </div>
                              </div>
                            ) : (
                              <div className="text-xs text-slate-500">
                                Partial releases will create planner-ready job cards here.
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Dialog open={Boolean(releaseDialogOrder)} onOpenChange={(open) => (!open ? closeReleaseDialog() : null)}>
        <DialogContent className="max-w-5xl rounded-[1.75rem] border-slate-200 p-0">
          <div className="rounded-[1.75rem] bg-white">
            <DialogHeader className="border-b border-slate-200 px-6 py-5">
              <DialogTitle className="text-2xl text-slate-950">
                Release to planner and choose the target winder
              </DialogTitle>
              <DialogDescription className="text-slate-600">
                Each selected line can release a different quantity and a different winder. This is the operational demand cut from the long-horizon customer PO.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 px-6 py-5">
              {releaseDialogOrder ? (
                <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-semibold text-slate-900">
                      {releaseDialogOrder.po_number || releaseDialogOrder.order_no}
                    </span>
                    <StatusBadge value={releaseDialogOrder.status} />
                    <span>{resolveCustomerLabel(releaseDialogOrder, customerMap)}</span>
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-[0.7fr_1.1fr_0.8fr_0.8fr_1fr] gap-3 rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <div>Line</div>
                <div>Product</div>
                <div>Remaining</div>
                <div>Release Qty</div>
                <div>Target Winder</div>
              </div>
              <div className="space-y-3">
                {releaseDraftRows.map((row) => (
                  <div
                    key={row.sales_order_line_id}
                    className="grid grid-cols-[0.7fr_1.1fr_0.8fr_0.8fr_1fr] gap-3 rounded-[1.2rem] border border-slate-200 bg-white px-4 py-4"
                  >
                    <div className="text-sm font-semibold text-slate-900">
                      {releaseDialogOrder?.lines?.find((line: any) => String(line.id) === row.sales_order_line_id)?.line_no || "-"}
                    </div>
                    <div className="text-sm text-slate-700">
                      <div className="font-semibold text-slate-900">{row.product_code || "No product code"}</div>
                      <div className="mt-1 text-xs text-slate-500">Due {formatDate(row.due_date)}</div>
                    </div>
                    <div className="text-sm font-semibold text-slate-900">
                      {row.remaining_qty.toFixed(0)} pcs
                    </div>
                    <div>
                      <input
                        type="number"
                        min="1"
                        max={row.remaining_qty}
                        value={row.release_qty}
                        onChange={(event) =>
                          updateReleaseDraftRow(row.sales_order_line_id, { release_qty: event.target.value })
                        }
                        className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                      />
                    </div>
                    <div>
                      <select
                        value={row.winder_machine_id}
                        onChange={(event) =>
                          updateReleaseDraftRow(row.sales_order_line_id, {
                            winder_machine_id: event.target.value,
                          })
                        }
                        className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                      >
                        <option value="">Select winder</option>
                        {winderMachines.map((machine: any) => (
                          <option key={machine.id} value={machine.id}>
                            {machine.code || machine.name} · {machine.capacity_value || "-"}{" "}
                            {machine.capacity_unit || ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-[1.2rem] border border-cyan-200 bg-cyan-50 px-4 py-4 text-sm text-cyan-950">
                <div className="flex items-center gap-2 font-semibold">
                  <PackageSearch className="h-4 w-4" />
                  Planner handoff
                </div>
                <p className="mt-2">
                  Confirming this release will create or refresh planner job cards and open the winder planning workspace filtered to this sales order.
                </p>
              </div>
            </div>

            <DialogFooter className="border-t border-slate-200 px-6 py-5">
              <button
                type="button"
                onClick={closeReleaseDialog}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRelease}
                disabled={releaseOrder.isPending || releaseSync.isPending}
                className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
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
