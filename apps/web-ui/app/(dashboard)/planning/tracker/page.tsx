"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import dayjs from "dayjs"
import { AlertTriangle, ClipboardList, Factory, Search, TimerReset, Truck } from "lucide-react"
import { useMemo, useState } from "react"

import { ExecutiveHero, MetricCard, MetricRail, Panel, StatusBadge } from "@/components/erp/shell"
import { PaginationBar, QuerySwitch } from "@/components/workspace/query-state"
import { useCustomers } from "@/hooks/use-master-data"
import { usePendingJobCardsByOrder } from "@/hooks/use-production"
import { usePendingSalesOrders } from "@/hooks/use-sales"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"
import { dueRiskLabel, overdueLabel } from "@/lib/due-risk"
import { compactRef, jobCardRef } from "@/lib/job-card-display"

function formatDate(value?: string | null) {
  if (!value) return "-"
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format("DD MMM YYYY") : String(value)
}

function stageLabel(stageCounts: Record<string, number> | undefined) {
  const entries = Object.entries(stageCounts || {}).sort((a, b) => b[1] - a[1])
  if (!entries.length) return "Not released"
  return entries.map(([stage, count]) => `${stage} ${count}`).join(" · ")
}

export default function PlanningTrackerPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const section = String(searchParams?.get("section") || "winder").toLowerCase()
  const search = String(searchParams?.get("search") || "")
  const flow = String(searchParams?.get("status") || "ALL")
  const page = Math.max(0, Number(searchParams?.get("page") || 0))
  const pageSize = 25
  const [searchDraft, setSearchDraft] = useState(search)

  const pendingQuery = usePendingSalesOrders({
    search: search || undefined,
    limit: pageSize,
    offset: page * pageSize,
    sort: "due_date",
    direction: "asc",
  })
  const productionQuery = usePendingJobCardsByOrder()
  const customersQuery = useCustomers()

  const payload = pendingQuery.data || {}
  const summary = payload.summary || {}
  const productionSummary = productionQuery.data?.summary || {}
  const items = Array.isArray(payload.items) ? payload.items : []
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

  const rows = items
    .map((order: any) => {
      const production = productionByOrder.get(String(order.id))
      const flowStatus = production?.flow_status || (Number(order.unreleased_qty || 0) === Number(order.outstanding_qty || 0) ? "Commercial open" : "In production")
      return { order, production, flowStatus }
    })
    .filter((row: any) => flow === "ALL" || row.flowStatus === flow)

  return (
    <div className="space-y-6" data-testid="planning-tracker-page">
      <ExecutiveHero
        appearance={MODULE_APPEARANCES.planning}
        badge="Sales Order Tracker"
        title="Order tracker"
        description="Counts come from the pending-orders server workspace and a server job-card grouping. This page no longer joins hundreds of job cards in the browser."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/sales-orders/pending" className="rounded-xl bg-card px-4 py-2.5 text-sm font-semibold text-foreground">
              Pending workspace
            </Link>
            <Link href={`/planning/board?section=${section}`} className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted">
              Planning board
            </Link>
            <Link href="/production/job-cards" className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">
              Job-card register
            </Link>
          </div>
        }
      />

      <MetricRail>
        <MetricCard label="Open Orders" value={Number(summary.order_count || 0)} detail="Server pending-order total" icon={ClipboardList} tone="cyan" />
        <MetricCard label="Not Released" value={formatUnreleased(summary)} detail="Commercial demand still unreleased" icon={Factory} tone="amber" />
        <MetricCard label="Blocked" value={Number(productionSummary.blocked_order_count || 0)} detail="Server job-card overlay" icon={AlertTriangle} tone="rose" />
        <MetricCard label="Priority (3 plant days)" value={Number(summary.due_priority_count || 0)} detail={summary.priority_label || dueRiskLabel()} icon={TimerReset} tone="amber" />
        <MetricCard label="Overdue" value={Number(summary.due_overdue_count || 0)} detail={summary.overdue_label || overdueLabel()} icon={TimerReset} tone="rose" />
        <MetricCard label="Dispatch Ready" value={Number(productionSummary.dispatch_ready_order_count || 0)} detail="At least one open card at dispatch" icon={Truck} tone="emerald" />
      </MetricRail>

      <Panel
        title="Sales Order Tracking Grid"
        subtitle={`Server window of ${items.length} / ${Number(payload.total_count || 0)} pending orders. Production stage mix is grouped by sales order on the server.`}
        actions={
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              replaceQuery({ search: searchDraft.trim() || null })
            }}
          >
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search SO, customer, product..." className="w-80 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            </div>
            <select value={flow} onChange={(event) => replaceQuery({ status: event.target.value === "ALL" ? null : event.target.value })} className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-muted-foreground">
              <option value="ALL">All flow states</option>
              <option value="Commercial open">Commercial open</option>
              <option value="In production">In production</option>
              <option value="Dispatch ready">Dispatch ready</option>
              <option value="Blocked">Blocked</option>
              <option value="Completed">Completed</option>
            </select>
          </form>
        }
      >
        {pendingQuery.isLoading || productionQuery.isLoading || pendingQuery.isError || rows.length === 0 ? (
          <QuerySwitch
            isLoading={pendingQuery.isLoading || productionQuery.isLoading}
            isError={pendingQuery.isError}
            isEmpty={rows.length === 0}
            loadingLabel="Loading sales-order tracker..."
            emptyTitle="No sales orders matched this tracker filter."
            emptyMessage="Try another flow state or search term."
            errorMessage="The tracker could not be loaded. Counts must not be treated as zero."
            onRetry={() => {
              void pendingQuery.refetch()
            }}
          >
            {null}
          </QuerySwitch>
        ) : (
          <div className="overflow-x-auto rounded-[1.35rem] border border-border">
            <table className="min-w-full">
              <thead className="bg-muted text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Sales Order</th>
                  <th className="px-4 py-3 text-left">Customer / PO</th>
                  <th className="px-4 py-3 text-right">Demand</th>
                  <th className="px-4 py-3 text-right">Released</th>
                  <th className="px-4 py-3 text-left">Flow State</th>
                  <th className="px-4 py-3 text-left">Stage Mix</th>
                  <th className="px-4 py-3 text-left">Job Cards</th>
                  <th className="px-4 py-3 text-left">Due / Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {rows.map((row: any) => {
                  const order = row.order
                  const production = row.production
                  return (
                    <tr key={order.id} className="transition hover:bg-signal-cyan-soft/40">
                      <td className="px-4 py-4">
                        <Link href={`/sales-orders/${order.id}`} className="text-sm font-black text-foreground hover:text-signal-cyan-ink">
                          {order.order_no}
                        </Link>
                        <div className="mt-1 text-xs text-muted-foreground">Internal {compactRef(order.id, "SO")}</div>
                      </td>
                      <td className="px-4 py-4 text-sm text-muted-foreground">
                        <div className="font-semibold text-foreground">{customerMap.get(String(order.customer_id)) || "Customer"}</div>
                        <div className="mt-1 text-xs text-muted-foreground">PO {order.po_number || "not entered"} · {order.line_count || 0} line(s)</div>
                      </td>
                      <td className="px-4 py-4 text-right text-sm font-semibold text-foreground">
                        {Number(order.outstanding_qty || 0).toLocaleString("en-IN")}
                        <div className="mt-1 text-xs text-muted-foreground">open</div>
                      </td>
                      <td className="px-4 py-4 text-right text-sm font-semibold text-foreground">
                        {Number((order.outstanding_qty || 0) - (order.unreleased_qty || 0)).toLocaleString("en-IN")}
                        <div className="mt-1 text-xs text-muted-foreground">{Number(order.unreleased_qty || 0).toLocaleString("en-IN")} unreleased</div>
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge value={row.flowStatus} />
                        <div className="mt-2 text-xs text-muted-foreground">{production?.job_count ? "Production card(s) linked" : "Release from sales order required"}</div>
                      </td>
                      <td className="px-4 py-4 text-sm text-muted-foreground">
                        {stageLabel(production?.stage_counts)}
                        {production?.blocked_job_count ? <div className="mt-1 text-xs font-semibold text-signal-rose-ink">{production.blocked_job_count} blocked job(s)</div> : null}
                      </td>
                      <td className="px-4 py-4 text-sm text-muted-foreground">
                        {!production?.job_card_ids?.length ? (
                          <span className="text-muted-foreground">No cards yet</span>
                        ) : (
                          <div className="flex max-w-[260px] flex-wrap gap-1.5">
                            {production.job_card_ids.slice(0, 4).map((jobId: string) => (
                              <Link key={jobId} href={`/production/job-cards/${jobId}`} className="rounded-full border border-border bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground hover:border-signal-cyan-line hover:bg-signal-cyan-soft">
                                {jobCardRef({ id: jobId })}
                              </Link>
                            ))}
                            {production.job_card_ids.length > 4 ? (
                              <span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">+{production.job_card_ids.length - 4}</span>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm text-muted-foreground">
                        <div className={order.due_risk === "OVERDUE" ? "font-semibold text-signal-rose-ink" : order.due_risk === "PRIORITY" ? "font-semibold text-signal-amber-ink" : ""}>
                          Due {formatDate(order.earliest_due)}
                          {order.due_risk === "OVERDUE" ? " · Overdue" : order.due_risk === "PRIORITY" ? " · Priority" : ""}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Link href={`/sales-orders/${order.id}`} className="text-xs font-black text-signal-cyan-ink hover:text-signal-cyan-ink">View SO</Link>
                          <Link href={`/planning/board?section=${section}`} className="text-xs font-black text-foreground hover:text-foreground">Plan</Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <PaginationBar
          page={page + 1}
          hasPrevious={page > 0}
          hasNext={Boolean(payload.has_more)}
          onPrevious={() => replaceQuery({ page: page > 1 ? String(page - 1) : null })}
          onNext={() => replaceQuery({ page: String(page + 1) })}
        />
      </Panel>
    </div>
  )
}

function formatUnreleased(summary: any) {
  const outstanding = Number(summary.outstanding_qty || 0)
  const unreleased = Number(summary.unreleased_qty || 0)
  if (!outstanding) return unreleased
  return unreleased
}
