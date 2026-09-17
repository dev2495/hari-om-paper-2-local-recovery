"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import dayjs from "dayjs"
import { ArrowRight, ClipboardList, Download, Factory, Search, TimerReset } from "lucide-react"
import { useMemo, useState } from "react"

import { ExecutiveHero, MetricCard, MetricRail, Panel, StatusBadge } from "@/components/erp/shell"
import { PaginationBar, QuerySwitch } from "@/components/workspace/query-state"
import { useCustomers } from "@/hooks/use-master-data"
import { usePendingJobCardsByOrder } from "@/hooks/use-production"
import { usePendingSalesOrders } from "@/hooks/use-sales"
import { salesApi } from "@/lib/api"
import { dueRiskLabel, overdueLabel } from "@/lib/due-risk"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"

function formatDate(value?: string | null) {
  if (!value) return "-"
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format("DD MMM YYYY") : String(value)
}

function formatQty(value: unknown) {
  return Number(value || 0).toLocaleString("en-IN")
}

export default function PendingOrdersWorkspacePage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = String(searchParams?.get("search") || "")
  const source = String(searchParams?.get("source") || "")
  const status = String(searchParams?.get("status") || "")
  const product = String(searchParams?.get("product") || "")
  const dueRisk = String(searchParams?.get("due_risk") || "")
  const missingSchedule = String(searchParams?.get("missing_schedule") || "")
  const sort = String(searchParams?.get("sort") || "due_date")
  const direction = String(searchParams?.get("direction") || "asc")
  const page = Math.max(0, Number(searchParams?.get("page") || 0))
  const pageSize = 25
  const [searchDraft, setSearchDraft] = useState(search)

  const queryParams = useMemo(
    () => ({
      search: search || undefined,
      source: source || undefined,
      status: status || undefined,
      product: product || undefined,
      due_risk: dueRisk || undefined,
      missing_schedule: missingSchedule === "1" ? true : undefined,
      sort,
      direction,
      limit: pageSize,
      offset: page * pageSize,
    }),
    [direction, dueRisk, missingSchedule, page, product, search, sort, source, status],
  )

  const pendingQuery = usePendingSalesOrders(queryParams)
  const productionQuery = usePendingJobCardsByOrder()
  const customersQuery = useCustomers()

  const payload = pendingQuery.data || {}
  const summary = payload.summary || {}
  const items = Array.isArray(payload.items) ? payload.items : []
  const totalCount = Number(payload.total_count || 0)
  const hasMore = Boolean(payload.has_more)
  const productionByOrder = useMemo(() => {
    const map = new Map<string, any>()
    for (const row of Array.isArray(productionQuery.data?.items) ? productionQuery.data.items : []) {
      map.set(String(row.sales_order_id), row)
    }
    return map
  }, [productionQuery.data])
  const customerMap = useMemo(
    () =>
      new Map(
        (Array.isArray(customersQuery.data) ? customersQuery.data : []).map((customer: any) => [
          String(customer.id),
          customer.name || customer.customer_name || customer.code,
        ]),
      ),
    [customersQuery.data],
  )

  const replaceQuery = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams?.toString() || "")
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) next.delete(key)
      else next.set(key, value)
    })
    if (!("page" in patch)) next.delete("page")
    const query = next.toString()
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const exportRows = async () => {
    const response = await salesApi.exportPendingOrders({
      search: search || undefined,
      source: source || undefined,
      status: status || undefined,
      product: product || undefined,
      due_risk: dueRisk || undefined,
      missing_schedule: missingSchedule === "1" ? true : undefined,
      sort,
      direction,
    })
    const blob = new Blob([response.data], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "pending-orders.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6" data-testid="pending-orders-workspace">
      <ExecutiveHero
        appearance={MODULE_APPEARANCES.sales}
        badge="Pending orders"
        title="All in-scope pending demand, not the first page"
        description="Filters, sort, counts and export run on the server for the authorized plant. Production WIP is an overlay; supplier calendars and BOM shortages are deferred."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void exportRows()} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900" data-testid="pending-orders:export">
              <Download className="h-4 w-4" />
              Export full set
            </button>
            <Link href="/sales-orders" className="rounded-xl border border-white/30 px-4 py-2.5 text-sm font-semibold text-white">
              Sales queue
            </Link>
          </div>
        }
      />

      <MetricRail>
        <MetricCard label="Pending orders" value={Number(summary.order_count || 0)} detail={`${Number(summary.line_count || 0)} lines · server total`} icon={ClipboardList} tone="cyan" />
        <MetricCard label="Outstanding qty" value={formatQty(summary.outstanding_qty)} detail="Ordered minus fulfilled" icon={Factory} tone="amber" />
        <MetricCard label="Unreleased qty" value={formatQty(summary.unreleased_qty)} detail="Not yet in a release lot" icon={Factory} tone="violet" />
        <MetricCard label="Missing schedule" value={Number(summary.missing_schedule_count || 0)} detail="Call-off remainder still open" icon={TimerReset} tone="rose" />
        <MetricCard label="Priority (3 plant days)" value={Number(summary.due_priority_count || 0)} detail={summary.priority_label || dueRiskLabel()} icon={TimerReset} tone="amber" />
        <MetricCard label="Overdue" value={Number(summary.due_overdue_count || 0)} detail={summary.overdue_label || overdueLabel()} icon={TimerReset} tone="rose" />
      </MetricRail>

      <Panel
        title="Pending order lines"
        subtitle={`Window ${Number(payload.offset || 0) + 1}-${Number(payload.offset || 0) + items.length} of ${totalCount} matching orders. Totals above are the full filtered set.`}
        actions={
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              replaceQuery({ search: searchDraft.trim() || null })
            }}
          >
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                aria-label="Search pending orders"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Search SO, PO, product"
                className="w-64 bg-transparent text-sm outline-none"
              />
            </div>
            <select value={source} onChange={(event) => replaceQuery({ source: event.target.value || null })} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="">All sources</option>
              <option value="customer_po">Customer PO</option>
              <option value="internal">Internal</option>
            </select>
            <select value={dueRisk} onChange={(event) => replaceQuery({ due_risk: event.target.value || null })} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="">All due risk</option>
              <option value="PRIORITY">Priority (3 plant days)</option>
              <option value="OVERDUE">Overdue</option>
            </select>
            <select value={missingSchedule} onChange={(event) => replaceQuery({ missing_schedule: event.target.value || null })} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="">Schedule any</option>
              <option value="1">Missing schedule</option>
            </select>
            <input value={product} onChange={(event) => replaceQuery({ product: event.target.value || null })} placeholder="Product" className="w-36 rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <select value={`${sort}:${direction}`} onChange={(event) => {
              const [nextSort, nextDir] = event.target.value.split(":")
              replaceQuery({ sort: nextSort, direction: nextDir })
            }} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="due_date:asc">Due date</option>
              <option value="outstanding_qty:desc">Outstanding qty</option>
              <option value="unreleased_qty:desc">Unreleased qty</option>
              <option value="open_value:desc">Open value</option>
              <option value="order_no:asc">Order no</option>
            </select>
          </form>
        }
      >
        {pendingQuery.isLoading || pendingQuery.isError || items.length === 0 ? (
          <QuerySwitch
            isLoading={pendingQuery.isLoading}
            isError={pendingQuery.isError}
            isEmpty={items.length === 0}
            loadingLabel="Loading pending orders from the server..."
            emptyTitle="No pending orders matched these server filters."
            emptyMessage="Clear filters or wait for new commercial demand."
            errorMessage="Pending orders could not be loaded. Totals on this page must not be treated as zero."
            onRetry={() => {
              void pendingQuery.refetch()
            }}
          >
            {null}
          </QuerySwitch>
        ) : (
          <div className="overflow-x-auto rounded-[1.35rem] border border-slate-200">
            <table className="min-w-full">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Order</th>
                  <th className="px-4 py-3 text-left">Customer / source</th>
                  <th className="px-4 py-3 text-left">Line / product</th>
                  <th className="px-4 py-3 text-right">Ordered / open</th>
                  <th className="px-4 py-3 text-right">Unreleased</th>
                  <th className="px-4 py-3 text-right">Scheduled</th>
                  <th className="px-4 py-3 text-left">Due / production</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {items.map((order: any) => {
                  const production = productionByOrder.get(String(order.id))
                  return (order.lines || []).map((line: any, index: number) => (
                    <tr key={`${order.id}:${line.line_id}`} className="align-top">
                      {index === 0 ? (
                        <td className="px-4 py-4" rowSpan={(order.lines || []).length}>
                          <Link href={`/sales-orders/${order.id}`} className="text-sm font-black text-slate-950 hover:text-cyan-700">
                            {order.order_no}
                          </Link>
                          <div className="mt-1 text-xs text-slate-500">{order.status}</div>
                        </td>
                      ) : null}
                      {index === 0 ? (
                        <td className="px-4 py-4" rowSpan={(order.lines || []).length}>
                          <div className="font-semibold text-slate-900">{customerMap.get(String(order.customer_id)) || order.customer_id}</div>
                          <div className="mt-1 text-xs text-slate-500">{order.source === "customer_po" ? `PO ${order.po_number}` : "Internal sales order"}</div>
                        </td>
                      ) : null}
                      <td className="px-4 py-4 text-sm">
                        <div className="font-semibold text-slate-900">Line {line.line_no} · {line.product_code || "No product code"}</div>
                        <div className="mt-1 text-xs text-slate-500">Spec {(line.approved_spec_id || "").slice(0, 8)} · Parchment {line.parchment_color || "-"}</div>
                      </td>
                      <td className="px-4 py-4 text-right text-sm">
                        {formatQty(line.ordered_qty)}
                        <div className="mt-1 text-xs text-slate-500">{formatQty(line.outstanding_qty)} outstanding</div>
                      </td>
                      <td className="px-4 py-4 text-right text-sm">{formatQty(line.unreleased_qty)}</td>
                      <td className="px-4 py-4 text-right text-sm">
                        {formatQty(line.scheduled_qty)}
                        {line.missing_schedule ? <div className="mt-1 text-xs font-semibold text-amber-700">Remainder {formatQty(line.remaining_to_schedule_qty)}</div> : null}
                      </td>
                      <td className="px-4 py-4 text-sm">
                        <div className={line.due_risk === "OVERDUE" ? "font-semibold text-rose-700" : line.due_risk === "PRIORITY" ? "font-semibold text-amber-700" : ""}>
                          {formatDate(line.due_date)} {line.due_risk === "OVERDUE" ? "· Overdue" : line.due_risk === "PRIORITY" ? "· Priority" : ""}
                        </div>
                        {index === 0 ? (
                          <div className="mt-2 text-xs text-slate-500">
                            {production ? `${production.flow_status} · ${production.job_count} job card(s)` : "No production overlay yet"}
                            <div className="mt-2 flex gap-2">
                              <Link href={`/sales-orders/${order.id}`} className="font-black text-cyan-800">Schedule PO</Link>
                              <Link href={`/planning/board?section=winder&order_id=${order.id}`} className="inline-flex items-center gap-1 font-black text-slate-800">
                                Plan <ArrowRight className="h-3 w-3" />
                              </Link>
                            </div>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))
                })}
              </tbody>
            </table>
          </div>
        )}
        <div data-testid="pending-orders:total-count">
          <PaginationBar
            page={page + 1}
            hasPrevious={page > 0}
            hasNext={hasMore}
            onPrevious={() => replaceQuery({ page: page > 1 ? String(page - 1) : null })}
            onNext={() => replaceQuery({ page: String(page + 1) })}
            label={`Server total ${totalCount}`}
          />
        </div>
      </Panel>
    </div>
  )
}
