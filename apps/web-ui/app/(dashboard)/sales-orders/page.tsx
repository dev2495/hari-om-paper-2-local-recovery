"use client"

import Link from "next/link"
import dayjs from "dayjs"
import { ArrowRightLeft, CheckCircle2, ClipboardCheck, Factory, Plus, Search } from "lucide-react"
import { useDeferredValue, useMemo, useState } from "react"

import { ExecutiveHero, EmptyState, MetricCard, MetricRail, Panel, StatusBadge } from "@/components/erp/shell"
import { useApp } from "@/context/AppContext"
import { useCustomers } from "@/hooks/use-master-data"
import { useMachines, usePlanningJobCards, useReleaseSyncSalesOrder } from "@/hooks/use-production"
import { useApproveSalesOrder, useReleaseSalesOrder, useSalesOrders } from "@/hooks/use-sales"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"

type SyncResultMap = Record<string, string[]>

function resolveCustomerLabel(order: any, customerMap: Map<string, string>) {
  return customerMap.get(String(order.customer_id || "")) || order.customer_name || String(order.customer_id || "-")
}

function formatDate(value?: string | null) {
  if (!value) return "-"
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format("DD MMM YYYY") : String(value)
}

function pickWinderMachine(machines: any[]) {
  return (machines || []).find((machine: any) => String(machine?.department || "").toUpperCase() === "WINDER") || machines?.[0] || null
}

export default function SalesOrdersPage() {
  const { showToast } = useApp()
  const [search, setSearch] = useState("")
  const [selectedLines, setSelectedLines] = useState<Record<string, string[]>>({})
  const [syncResults, setSyncResults] = useState<SyncResultMap>({})
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
        resolveCustomerLabel(order, customerMap),
        order.status,
        ...(order.lines || []).flatMap((line: any) => [
          line.id,
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
    return { draftOrders, readyOrders, syncedOrders, openQty }
  }, [jobsByOrderId, orders])

  const handleToggleLine = (orderId: string, lineId: string, checked: boolean) => {
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

  const handleReleaseSelected = async (order: any) => {
    const selectedLineIds = selectedLines[String(order.id)] || []
    if (selectedLineIds.length === 0) {
      showToast("Select at least one line before release sync.", "error")
      return
    }

    const selectedMachine = pickWinderMachine(Array.isArray(machinesQuery.data) ? machinesQuery.data : [])
    if (!selectedMachine?.id) {
      showToast("No winder machine is available in master data for release sync.", "error")
      return
    }

    if (!["approved", "released", "partially_released", "partially_dispatched"].includes(String(order.status))) {
      showToast("Approve the order before syncing selected lines into planning.", "error")
      return
    }

    try {
      if (String(order.status) === "approved") {
        await releaseOrder.mutateAsync(String(order.id))
      }

      const releaseRows = (order.lines || [])
        .filter((line: any) => selectedLineIds.includes(String(line.id)))
        .map((line: any) => ({
          release_lot_id: crypto.randomUUID(),
          sales_order_line_id: String(line.id),
          release_qty: Number(line.remaining_qty || line.qty || 0),
          winder_machine_id: String(selectedMachine.id),
        }))
        .filter((line: any) => line.release_qty > 0)

      if (releaseRows.length === 0) {
        showToast("Selected lines do not have any remaining quantity to release.", "error")
        return
      }

      const response = await releaseSync.mutateAsync({
        salesOrderId: String(order.id),
        data: { line_ids: selectedLineIds, release_rows: releaseRows },
      })

      const jobCardIds = Array.isArray(response?.data?.line_results)
        ? response.data.line_results.map((row: any) => String(row.job_card_id)).filter(Boolean)
        : []

      setSelectedLines((current) => ({ ...current, [String(order.id)]: [] }))
      setSyncResults((current) => ({ ...current, [String(order.id)]: jobCardIds }))
      showToast(`Planning sync complete for ${releaseRows.length} line(s).`, "success")
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Release sync failed."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    }
  }

  return (
    <div className="space-y-6" data-testid="sales-orders:page">
      <ExecutiveHero
        appearance={MODULE_APPEARANCES.sales}
        badge="Sales Queue"
        title="Sales POs, Product Buckets, and Release Lots"
        description="Approve demand, release only the right lines, and sync real job cards back into planning without losing the commercial trail."
        aside={
          <div className="space-y-3">
            <div className="rounded-[1.15rem] border border-white/10 bg-white/10 p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-emerald-100">Release Discipline</p>
              <p className="mt-2 text-3xl font-semibold">{metrics.readyOrders.length}</p>
              <p className="mt-1 text-xs text-emerald-100/80">Orders ready for planner sync</p>
            </div>
            <Link href="/sales-orders/new" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900">
              <Plus className="h-4 w-4" />
              New sales order
            </Link>
          </div>
        }
      />

      <MetricRail>
        <MetricCard label="Draft Queue" value={metrics.draftOrders.length} detail="Needs maker-checker approval" icon={CheckCircle2} tone="amber" />
        <MetricCard label="Release Ready" value={metrics.readyOrders.length} detail="Approved or already released" icon={ArrowRightLeft} tone="cyan" />
        <MetricCard label="Synced to Planning" value={metrics.syncedOrders.length} detail="Orders already mapped to job cards" icon={ClipboardCheck} tone="emerald" />
        <MetricCard label="Open Qty" value={metrics.openQty.toFixed(0)} detail="Remaining pieces still open in the queue" icon={Factory} tone="violet" />
      </MetricRail>

      <Panel
        title="Commercial Release Queue"
        subtitle="Search the queue, approve orders, then select the exact lines to push into planning."
        actions={
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search order, customer, line, or parchment..."
              className="w-72 bg-transparent text-sm outline-none placeholder:text-slate-400"
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
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Lines</th>
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
                          <Link href={`/sales-orders/${order.id}`} className="text-sm font-semibold text-slate-950 hover:text-cyan-700">
                            {order.order_no || order.id}
                          </Link>
                          <div className="text-xs text-slate-500">
                            {Number(order.total_qty || 0).toFixed(0)} pcs ordered
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-700">
                        {resolveCustomerLabel(order, customerMap)}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-700">
                        <div>{formatDate(order.created_at)}</div>
                        <div className="text-xs text-slate-500">
                          Due {formatDate(order.lines?.map((line: any) => line.due_date).sort()?.[0])}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="space-y-2">
                          {(order.lines || []).map((line: any, index: number) => (
                            <label
                              key={line.id}
                              className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                            >
                              <input
                                type="checkbox"
                                checked={selectedLineIds.includes(String(line.id))}
                                disabled={Number(line.remaining_qty || 0) <= 0}
                                onChange={(event) =>
                                  handleToggleLine(String(order.id), String(line.id), event.target.checked)
                                }
                                className="mt-0.5 h-4 w-4 rounded border-slate-300"
                              />
                              <span className="min-w-0">
                                <span className="block font-semibold text-slate-900">Line {index + 1}</span>
                                <span className="block text-xs text-slate-500">
                                  Qty {Number(line.qty || 0).toFixed(0)} · Remaining {Number(line.remaining_qty || 0).toFixed(0)} · Due {formatDate(line.due_date)}
                                </span>
                                {line.parchment_color ? (
                                  <span className="block text-xs text-slate-500">Parchment {line.parchment_color}</span>
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
                            Released {Number(order.released_qty || 0).toFixed(0)} / Fulfilled {Number(order.fulfilled_qty || 0).toFixed(0)}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-2">
                            <Link href={`/sales-orders/${order.id}`} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                              View
                            </Link>
                            <Link href={`/sales-orders/${order.id}/audit`} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                              Audit
                            </Link>
                            {(order.status === "draft" || order.status === "submitted") ? (
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
                              onClick={() => handleReleaseSelected(order)}
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
                            <div className="text-xs text-slate-500">No planner job cards synced yet.</div>
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
  )
}
