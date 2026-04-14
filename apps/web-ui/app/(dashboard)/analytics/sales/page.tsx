"use client"

import { CalendarClock, ClipboardList, PackageCheck, TrendingUp } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Line, XAxis, YAxis } from "recharts"

import { AnalyticsFilters } from "@/components/erp/analytics-filters"
import { ChartBox, ChartEmptyState, ChartPanel, ChartTooltip } from "@/components/erp/charts"
import { DataGrid } from "@/components/erp/data-grid"
import { ExecutiveHero, ExportActions, MetricCard, MetricRail, Panel, StatusBadge } from "@/components/erp/shell"
import { useAnalyticsContext } from "@/components/providers/analytics-provider"
import { useSyncAnalyticsRange } from "@/hooks/use-analytics-range"
import { useSalesReport } from "@/hooks/use-analytics"
import { ERP_CHART_THEME, MODULE_APPEARANCES } from "@/lib/erp-appearance"
import { downloadCsv, formatMetric } from "@/lib/reporting"

function hasSeries(rows: any[]) {
  return rows.some((row) =>
    ["orders_created", "released_or_better", "orders_closed", "dispatch_qty"].some((key) => Number(row?.[key] || 0) > 0),
  )
}

export default function SalesAnalyticsPage() {
  const { startDate, endDate, plantScope, granularity } = useAnalyticsContext()
  const plant = plantScope === "ALL" ? undefined : plantScope || undefined
  const { data } = useSalesReport({ startDate, endDate, plant, granularity })
  useSyncAnalyticsRange(data?.available_range)

  const summary: any = data?.summary || {}
  const series = Array.isArray((data as any)?.series) ? (data as any).series : []
  const delayedRows = Array.isArray((data as any)?.delayed_rows) ? (data as any).delayed_rows : []

  return (
    <div className="space-y-6">
      <ExecutiveHero
        appearance={MODULE_APPEARANCES.analytics}
        badge="Sales and OTIF"
        testId="analytics-sales-hero"
        title="Sales release discipline, OTIF, lead time, and delayed-order pressure"
        description="This surface follows the full commercial path from order creation to dispatch close, using the same timeline truth that feeds production and dispatch."
        aside={
          <div className="space-y-3">
            <div className="rounded-[1.15rem] border border-white/10 bg-white/10 p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-100">Release to Dispatch</p>
              <p className="mt-2 text-3xl font-semibold">{formatMetric(summary.release_to_dispatch_days, "days", 1)}</p>
            </div>
            <StatusBadge value={delayedRows.length > 0 ? "BLOCKED" : "ACTIVE"} label={`${delayedRows.length} delayed orders`} />
          </div>
        }
      />

      <AnalyticsFilters />

      <MetricRail>
        <MetricCard label="Backlog Orders" value={formatMetric(summary.backlog_orders)} detail="Partially released, released, or partially dispatched" icon={ClipboardList} tone="amber" />
        <MetricCard label="Closed Orders" value={formatMetric(summary.closed_orders)} detail="Commercially completed in scope" icon={PackageCheck} tone="emerald" />
        <MetricCard label="OTIF" value={formatMetric(summary.otif_percent, "%", 1)} detail="Closed on or before committed due date" icon={TrendingUp} tone="cyan" />
        <MetricCard label="Delayed Orders" value={formatMetric(summary.delayed_orders)} detail="Still open beyond due date" icon={CalendarClock} tone="rose" />
      </MetricRail>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <ChartPanel title="Order Lifecycle Velocity" subtitle="Orders created, released, closed, and final dispatch volume by period.">
          {hasSeries(series) ? (
            <ChartBox height={340}>
              <BarChart data={series}>
                <CartesianGrid stroke={ERP_CHART_THEME.grid} vertical={false} />
                <XAxis dataKey="label" stroke={ERP_CHART_THEME.axis} tick={{ fill: ERP_CHART_THEME.axis, fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="left" stroke={ERP_CHART_THEME.axis} tick={{ fill: ERP_CHART_THEME.axis, fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="right" orientation="right" stroke={ERP_CHART_THEME.axis} tick={{ fill: ERP_CHART_THEME.axis, fontSize: 12 }} tickLine={false} axisLine={false} />
                <ChartTooltip />
                <Bar yAxisId="left" dataKey="orders_created" fill={ERP_CHART_THEME.palette[0]} radius={[6, 6, 0, 0]} name="Created" />
                <Bar yAxisId="left" dataKey="released_or_better" fill={ERP_CHART_THEME.palette[1]} radius={[6, 6, 0, 0]} name="Released+" />
                <Bar yAxisId="left" dataKey="orders_closed" fill={ERP_CHART_THEME.palette[2]} radius={[6, 6, 0, 0]} name="Closed" />
                <Line yAxisId="right" type="monotone" dataKey="dispatch_qty" stroke={ERP_CHART_THEME.palette[4]} strokeWidth={2.5} dot={false} name="Dispatch Qty" />
              </BarChart>
            </ChartBox>
          ) : (
            <ChartEmptyState label="No sales lifecycle activity is available in the selected window." />
          )}
        </ChartPanel>

        <Panel title="Commercial Snapshot" subtitle="Current order-health mix for the selected reporting scope.">
          <div className="space-y-3">
            <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">OTIF</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{formatMetric(summary.otif_percent, "%", 1)}</p>
              <p className="mt-2 text-sm text-slate-600">On-time in-full performance for closed orders.</p>
            </div>
            <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Release to Dispatch</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{formatMetric(summary.release_to_dispatch_days, "days", 1)}</p>
              <p className="mt-2 text-sm text-slate-600">Average time from order creation to final dispatch confirmation.</p>
            </div>
            <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Release Backlog</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{formatMetric(summary.backlog_orders)}</p>
              <p className="mt-2 text-sm text-slate-600">Orders partially released or released into manufacturing but not yet fully dispatched.</p>
            </div>
          </div>
        </Panel>
      </div>

      <Panel
        title="Delayed Orders"
        subtitle="Open orders already beyond due date and still waiting on production or dispatch completion."
        actions={<ExportActions onExportCsv={() => downloadCsv("sales-delayed-orders.csv", delayedRows)} />}
      >
        <DataGrid
          rows={delayedRows}
          emptyLabel="No delayed sales orders were found for the current filter set."
          rowKey={(row: any) => row.order_id}
          columns={[
            {
              key: "order_no",
              label: "Order",
              render: (row: any) => (
                <div>
                  <p className="font-semibold text-slate-900">{row.order_no || row.order_id}</p>
                  <p className="text-xs text-slate-500">{row.customer_name || "-"}</p>
                </div>
              ),
            },
            { key: "due_date", label: "Due Date" },
            { key: "plant_id", label: "Plant" },
            { key: "status", label: "Status", render: (row: any) => <StatusBadge value={row.status} /> },
          ]}
        />
      </Panel>
    </div>
  )
}
