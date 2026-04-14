"use client"

import { AlertTriangle, PackageSearch, ShieldAlert, Truck } from "lucide-react"

import { AnalyticsFilters } from "@/components/erp/analytics-filters"
import { DataGrid } from "@/components/erp/data-grid"
import { ExecutiveHero, MetricCard, MetricRail, Panel, StatusBadge } from "@/components/erp/shell"
import { useAnalyticsContext } from "@/components/providers/analytics-provider"
import { useSyncAnalyticsRange } from "@/hooks/use-analytics-range"
import { useExceptionReport } from "@/hooks/use-analytics"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"
import { formatMetric } from "@/lib/reporting"

export default function ExceptionCenterPage() {
  const { startDate, endDate, plantScope, granularity } = useAnalyticsContext()
  const plant = plantScope === "ALL" ? undefined : plantScope || undefined
  const { data } = useExceptionReport({ startDate, endDate, plant, granularity })
  useSyncAnalyticsRange(data?.available_range)

  const summary: any = data?.summary || {}
  const delayedOrders = Array.isArray((data as any)?.delayed_orders) ? (data as any).delayed_orders : []
  const lowStock = Array.isArray((data as any)?.low_stock) ? (data as any).low_stock : []
  const overstock = Array.isArray((data as any)?.overstock) ? (data as any).overstock : []
  const blockedJobs = Array.isArray((data as any)?.blocked_jobs) ? (data as any).blocked_jobs : []
  const activeHolds = Array.isArray((data as any)?.active_holds) ? (data as any).active_holds : []

  return (
    <div className="space-y-6">
      <ExecutiveHero
        appearance={MODULE_APPEARANCES.analytics}
        badge="Exception Center"
        testId="analytics-exceptions-hero"
        title="Delayed, blocked, held, and low-stock signals in one queue"
        description="This page collapses commercial, production, inventory, and QC exceptions into a single owner-ready action surface."
        aside={<StatusBadge value={Number(summary.active_qc_holds || 0) > 0 ? "QC_HOLD" : "ACTIVE"} label={`${formatMetric(summary.active_qc_holds)} active holds`} />}
      />

      <AnalyticsFilters />

      <MetricRail>
        <MetricCard label="Delayed Orders" value={formatMetric(summary.delayed_orders)} detail="Open beyond due date" icon={Truck} tone="rose" />
        <MetricCard label="Low Stock" value={formatMetric(summary.low_stock_items)} detail="Under minimum availability" icon={PackageSearch} tone="amber" />
        <MetricCard label="Overstock" value={formatMetric(summary.overstock_items)} detail="Availability materially above normal" icon={AlertTriangle} tone="violet" />
        <MetricCard label="Blocked Jobs" value={formatMetric(summary.blocked_jobs)} detail="Execution waiting on clean release" icon={ShieldAlert} tone="rose" />
      </MetricRail>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Delayed Orders" subtitle="Orders already late and still open.">
          <DataGrid
            rows={delayedOrders}
            emptyLabel="No delayed orders are currently flagged."
            rowKey={(row: any) => row.order_id}
            columns={[
              { key: "order_no", label: "Order" },
              { key: "customer_name", label: "Customer" },
              { key: "due_date", label: "Due Date" },
              { key: "status", label: "Status", render: (row: any) => <StatusBadge value={row.status} /> },
            ]}
          />
        </Panel>

        <Panel title="Blocked Jobs" subtitle="Job cards held in planned, assigned, or QC-blocked states.">
          <DataGrid
            rows={blockedJobs}
            emptyLabel="No blocked job cards are currently flagged."
            rowKey={(row: any) => row.job_card_id}
            columns={[
              { key: "job_card_no", label: "Job Card" },
              { key: "customer_name", label: "Customer" },
              { key: "current_stage", label: "Stage", render: (row: any) => <StatusBadge value={row.current_stage} /> },
              { key: "status", label: "Status", render: (row: any) => <StatusBadge value={row.status} /> },
            ]}
          />
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Low Stock" subtitle="Items already close to issue or dispatch pressure.">
          <DataGrid
            rows={lowStock}
            emptyLabel="No low-stock items are currently flagged."
            rowKey={(row: any) => row.id}
            columns={[
              { key: "name", label: "Item" },
              { key: "type", label: "Type", render: (row: any) => <StatusBadge value={row.type} label={row.type} /> },
              { key: "available_qty", label: "Available", align: "right", render: (row: any) => formatMetric(row.available_qty) },
            ]}
          />
        </Panel>

        <Panel title="QC Holds and Overstock" subtitle="Quality blocks and excess stock both need explicit review.">
          <div className="space-y-4">
            <DataGrid
              rows={activeHolds}
              emptyLabel="No active QC holds are currently flagged."
              rowKey={(row: any, index) => String(row.id || row.job_card_id || index)}
              columns={[
                { key: "job_card_id", label: "Job / Lot", render: (row: any) => String(row.job_card_id || row.batch_id || row.id || "-").slice(0, 12) },
                { key: "status", label: "Status", render: (row: any) => <StatusBadge value={row.status || "QC_HOLD"} /> },
                { key: "reason", label: "Reason", render: (row: any) => row.reason || row.hold_reason || "-" },
              ]}
            />
            <DataGrid
              rows={overstock}
              emptyLabel="No overstock items are currently flagged."
              rowKey={(row: any) => row.id}
              columns={[
                { key: "name", label: "Item" },
                { key: "available_qty", label: "Available", align: "right", render: (row: any) => formatMetric(row.available_qty) },
              ]}
            />
          </div>
        </Panel>
      </div>
    </div>
  )
}
